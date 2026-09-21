import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from '../../qwen-media-runtime/scripts/config.mjs';
import { probeMedia } from '../../qwen-media-runtime/scripts/media_probe.mjs';
import { buildTaskPlan, actualCost } from '../../qwen-media-runtime/scripts/cost_guard.mjs';
import { chatCompletions, filetransSubmit, taskQuery, fetchResultJson } from '../../qwen-media-runtime/scripts/bailian_client.mjs';
import { uploadTemporary } from '../../qwen-media-runtime/scripts/temp_upload.mjs';
import { resolveTaskId, loadTaskBudget, registerOperations, authorizeCurrentCost, startOperation, completeOperation, failOperation, cancelOpenOperations, finalizeTask } from '../../qwen-media-runtime/scripts/task_budget.mjs';
import { RuntimeError, printError } from '../../qwen-media-runtime/scripts/errors.mjs';

import { asrSegments, requireTimestamps } from '../../qwen-media-runtime/scripts/asr_timeline.mjs';

const runtimeInit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../qwen-media-runtime/scripts/init_qwen_media.mjs');
const durationText = (seconds) => `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;
const mime = (file) => ({ mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg' }[path.extname(file).slice(1).toLowerCase()] || 'application/octet-stream');

function parseArgs(args) {
  const files = []; const options = { confirm: false, json: false, debug: false, language: undefined, itn: true, taskId: undefined, operationIds: [], approvedCostCeiling: undefined, finalizeTask: false };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--timestamps') options.timestamps = true; else if (args[index] === '--output') options.output = args[++index]; else if (args[index] === '--file') files.push(args[++index]); else if (args[index] === '--confirm') options.confirm = true; else if (args[index] === '--json') options.json = true; else if (args[index] === '--debug') options.debug = true; else if (args[index] === '--language') options.language = args[++index]; else if (args[index] === '--no-itn') options.itn = false; else if (args[index] === '--task-id') options.taskId = args[++index]; else if (args[index] === '--operation-id') options.operationIds.push(args[++index]); else if (args[index] === '--approved-cost-ceiling') options.approvedCostCeiling = Number(args[++index]); else if (args[index] === '--finalize-task') options.finalizeTask = true;
  }
  if (!files.length) throw new RuntimeError('用法：run_qwen_asr.mjs --file <path> [--language zh] [--task-id <id>] [--confirm]', 'USAGE');
  return { files, options };
}

function runInit() {
  return new Promise((resolve) => { const child = spawn(process.execPath, [runtimeInit, '--json'], { windowsHide: true }); let output = ''; child.stdout.on('data', (data) => { output += data; }); child.on('close', (code) => { try { resolve({ code, report: JSON.parse(output) }); } catch { resolve({ code, report: { ok: false, error: output } }); } }); });
}

async function encodeAudio(file) { const data = await fs.readFile(file); return `data:${mime(file)};base64,${data.toString('base64')}`; }

function filetransError(task) {
  const code = task.output?.code || task.code || task.output?.message;
  const message = task.output?.message || task.message || `Filetrans 任务未成功：${task.output?.task_status || 'UNKNOWN'}`;
  return new RuntimeError(message, code === 'FILE_DOWNLOAD_FAILED' ? 'FILE_DOWNLOAD_FAILED' : 'FILETRANS_FAILED', { code, message });
}

async function filetransOnce(config, ossUrl, endpoints) {
  const submitted = await filetransSubmit(config, { model: config.asrLongModel, input: { file_url: ossUrl } }, endpoints);
  const taskId = submitted.output?.task_id || submitted.output?.taskId || submitted.task_id;
  if (!taskId) throw new RuntimeError('Filetrans 未返回任务 ID。', 'FILETRANS_NO_TASK');
  const deadline = Date.now() + 30 * 60 * 1000;
  while (Date.now() < deadline) {
    const task = await taskQuery(config, taskId, endpoints); const status = task.output?.task_status || task.output?.taskStatus;
    if (['SUCCEEDED', 'FAILED', 'CANCELED'].includes(status)) {
      if (status !== 'SUCCEEDED') throw filetransError(task);
      const url = task.output?.result?.transcription_url || task.output?.transcription_url;
      if (!url) throw new RuntimeError('Filetrans 成功但未返回结果 JSON 地址。', 'FILETRANS_NO_RESULT');
      return fetchResultJson(config, url);
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  throw new RuntimeError('Filetrans 任务轮询超时。', 'FILETRANS_TIMEOUT');
}

async function filetrans(config, probe) {
  if (!config.allowUnverifiedFiletransLocal) throw new RuntimeError('本地长音频临时上传 → Filetrans 尚未完成 Endpoint 验证；请提供公网 HTTPS URL/正式 OSS，或设置 QWEN_ALLOW_UNVERIFIED_FILETRANS_LOCAL=1 进行专项验证。', 'FILETRANS_NOT_VERIFIED');
  const ossUrl = (await uploadTemporary(probe.file, config, config.asrLongModel)).ossUrl;
  try { return await filetransOnce(config, ossUrl, config.endpoints); }
  catch (error) {
    const resourceFailure = error.code === 'FILE_DOWNLOAD_FAILED' || error.details?.body?.code === 'Resource.AccessDenied' || /OSS Resource .* access denied/i.test(error.message || '');
    if (!resourceFailure || !config.workspaceEndpoints) throw error;
    return filetransOnce(config, ossUrl, config.workspaceEndpoints);
  }
}

function transcriptFrom(response) { const content = response.choices?.[0]?.message?.content; if (typeof content === 'string') return content; return JSON.stringify(content || response); }
function timestamped(response) {
  const sentences = response.transcripts?.flatMap((item) => item.sentences || []) || response.output?.sentences || [];
  if (sentences.length) return sentences.map((item) => `[${item.begin_time ?? item.beginTime}ms-${item.end_time ?? item.endTime}ms] ${item.text}`).join('\n');
  return Array.isArray(response.transcripts) ? response.transcripts.map((item) => item.text || '').join('\n') : transcriptFrom(response);
}

async function main() {
  const { files, options } = parseArgs(process.argv.slice(2)); const init = await runInit(); if (!init.report.ok) throw new RuntimeError(`环境尚未准备完成：${init.report.next || init.report.error}`, 'NOT_INITIALIZED');
  const config = resolveConfig(); const task = resolveTaskId(options.taskId); const probes = await Promise.all(files.map((file) => probeMedia(file, 'asr')));
  if (options.timestamps) for (const probe of probes) { if (probe.route === 'unsupported') throw new RuntimeError('媒体超出转写限制。', 'ASR_UNSUPPORTED'); probe.route = 'long_filetrans'; }
  const plan = buildTaskPlan(probes.map((probe) => ({ kind: 'asr', probe })), config); const operationIds = plan.operations.map((_, index) => options.operationIds[index] || `asr-${randomUUID()}`);
  await registerOperations(task.taskId, plan.operations.map((operation, index) => ({ operationId: operationIds[index], skill: 'Qwen ASR', model: operation.probe.route === 'long_filetrans' ? config.asrLongModel : config.asrModel, estimatedCost: operation.estimate.reliable ? operation.estimate.estimatedCost : null })), config);
  const budget = await loadTaskBudget(task.taskId, config); const projected = budget.actualCost + budget.pendingEstimatedCost; const requiresConfirmation = !plan.reliable || projected > (budget.approvedCostCeiling ?? budget.autoThresholdCny);
  if (requiresConfirmation && !options.confirm) { if (!task.supplied) { await cancelOpenOperations(task.taskId, config); await finalizeTask(task.taskId); } console.log(JSON.stringify({ requiresConfirmation: true, taskId: task.taskId, estimatedTotalCost: plan.estimatedTotalCost, projectedTotalCost: projected, reason: plan.reliable ? `任务预计总费用超过 ¥${(budget.approvedCostCeiling ?? budget.autoThresholdCny).toFixed(2)}。` : '任务费用无法可靠估算。' }, null, 2)); return; }
  if (options.confirm) await authorizeCurrentCost(task.taskId, config, Number.isFinite(options.approvedCostCeiling) ? options.approvedCostCeiling : projected);
  const results = []; let total = 0; let reliable = true;
  try {
    for (let index = 0; index < probes.length; index += 1) {
      const probe = probes[index]; const operationId = operationIds[index]; const reservation = await startOperation(task.taskId, operationId, config);
      if (!reservation.allowed) throw new RuntimeError(`新增调用预计费用约 ¥${reservation.projected.toFixed(2)}，超过当前授权上限 ¥${reservation.effectiveCeiling.toFixed(2)}，需要用户确认后继续。`, 'COST_CONFIRMATION_REQUIRED');
      let response;
      try {
        if (probe.route === 'short_base64') {
          const data = { model: config.asrModel, messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: await encodeAudio(probe.file), format: path.extname(probe.file).slice(1).toLowerCase() } }] }], stream: false };
          if (options.language) data.language = options.language; data.parameters = { enable_itn: options.itn }; response = await chatCompletions(config, data);
        } else if (probe.route === 'long_filetrans') response = await filetrans(config, probe);
        else throw new RuntimeError('当前音频超出已实现的本地输入限制，请提供符合官方限制的文件或公网 URL。', 'ASR_UNSUPPORTED');
      } catch (error) { await failOperation(task.taskId, operationId, null, config); throw error; }
      const cost = actualCost('asr', response.usage, probe, config); reliable &&= cost.reliable; if (cost.reliable) total += cost.cost; await completeOperation(task.taskId, operationId, cost.reliable ? cost.cost : null, config);
      const segments = probe.route === 'long_filetrans' ? asrSegments(response) : [];
      if (options.timestamps) requireTimestamps(segments, response.transcripts?.map((item) => item.text || '').join('') || response.output?.text || '');
      results.push({ segments, durationSeconds: probe.durationSeconds, text: probe.route === 'long_filetrans' ? timestamped(response) : transcriptFrom(response), usage: response.usage, route: probe.route });
    }
  } finally {
    if (!task.supplied || options.finalizeTask) await finalizeTask(task.taskId);
  }
  const report = { skill: 'Qwen ASR', taskId: task.taskId, results, actualTotalCost: reliable ? total : null, estimatedTotalCost: plan.estimatedTotalCost };
  if (options.output) await fs.writeFile(path.resolve(options.output), JSON.stringify(report, null, 2), { flag: 'wx' });
  if (options.json || options.debug) console.log(JSON.stringify(report, null, 2)); else {
    const costText = reliable ? `约 ¥${total.toFixed(2)}` : plan.estimatedTotalCost !== null ? `约 ¥${plan.estimatedTotalCost.toFixed(2)}（估算）` : '费用暂无法可靠计算';
    console.log(`已调用：Qwen ASR\n${results.map((result) => `音频时长：${durationText(result.durationSeconds)}`).join('\n')}\n本次花费：${costText}`); for (const result of results) console.log(`\n${result.text}`);
  }
}

main().catch((error) => { printError(error, process.argv.includes('--json')); process.exitCode = 1; });
