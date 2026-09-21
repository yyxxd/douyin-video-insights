import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from '../../qwen-media-runtime/scripts/config.mjs';
import { probeMedia } from '../../qwen-media-runtime/scripts/media_probe.mjs';
import { buildTaskPlan, actualCost } from '../../qwen-media-runtime/scripts/cost_guard.mjs';
import { chatCompletions } from '../../qwen-media-runtime/scripts/bailian_client.mjs';
import { uploadTemporary } from '../../qwen-media-runtime/scripts/temp_upload.mjs';
import { resolveTaskId, loadTaskBudget, registerOperations, authorizeCurrentCost, startOperation, completeOperation, failOperation, cancelOpenOperations, finalizeTask } from '../../qwen-media-runtime/scripts/task_budget.mjs';
import { RuntimeError, printError } from '../../qwen-media-runtime/scripts/errors.mjs';

const runtimeInit = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../qwen-media-runtime/scripts/init_qwen_media.mjs');
const mime = (file) => ({ mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm' }[path.extname(file).slice(1).toLowerCase()] || 'video/mp4');
const durationText = (seconds) => `${Math.floor(seconds / 60)} 分 ${Math.round(seconds % 60)} 秒`;

function argsOf(args) {
  const files = []; let prompt = ''; const options = { confirm: false, json: false, debug: false, forceTempUpload: false, taskId: undefined, operationIds: [], approvedCostCeiling: undefined, finalizeTask: false };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--prompt-file') options.promptFile = args[++index]; else if (args[index] === '--output') options.output = args[++index]; else if (args[index] === '--file') files.push(args[++index]); else if (args[index] === '--prompt') prompt = args[++index]; else if (args[index] === '--confirm') options.confirm = true; else if (args[index] === '--json') options.json = true; else if (args[index] === '--debug') options.debug = true; else if (args[index] === '--force-temp-upload') options.forceTempUpload = true; else if (args[index] === '--task-id') options.taskId = args[++index]; else if (args[index] === '--operation-id') options.operationIds.push(args[++index]); else if (args[index] === '--approved-cost-ceiling') options.approvedCostCeiling = Number(args[++index]); else if (args[index] === '--finalize-task') options.finalizeTask = true;
  }
  if (!files.length || (!prompt && !options.promptFile)) throw new RuntimeError('用法：run_qwen_omni.mjs --file <path> --prompt <需求> [--task-id <id>] [--confirm]', 'USAGE');
  return { files, prompt, options };
}

function runInit() {
  return new Promise((resolve) => { const child = spawn(process.execPath, [runtimeInit, '--json'], { windowsHide: true }); let output = ''; child.stdout.on('data', (data) => { output += data; }); child.on('close', (code) => { try { resolve({ code, report: JSON.parse(output) }); } catch { resolve({ code, report: { ok: false, error: output } }); } }); });
}

async function encodeVideo(file) { const data = await fs.readFile(file); return `data:${mime(file)};base64,${data.toString('base64')}`; }

async function main() {
  const { files, prompt: inlinePrompt, options } = argsOf(process.argv.slice(2)); const prompt = options.promptFile ? await fs.readFile(path.resolve(options.promptFile), 'utf8') : inlinePrompt; if (!prompt.trim()) throw new RuntimeError('分析要求不能为空。', 'USAGE'); const init = await runInit(); if (!init.report.ok) throw new RuntimeError(`环境尚未准备完成：${init.report.next || init.report.error}`, 'NOT_INITIALIZED');
  const config = resolveConfig(); const task = resolveTaskId(options.taskId); const probes = await Promise.all(files.map((file) => probeMedia(file, 'omni')));
  const plan = buildTaskPlan(probes.map((probe) => ({ kind: 'omni', probe, prompt })), config); const operationIds = plan.operations.map((_, index) => options.operationIds[index] || `omni-${randomUUID()}`);
  await registerOperations(task.taskId, plan.operations.map((operation, index) => ({ operationId: operationIds[index], skill: 'Qwen Omni', model: config.omniModel, estimatedCost: operation.estimate.reliable ? operation.estimate.estimatedCost : null })), config);
  const budget = await loadTaskBudget(task.taskId, config); const projected = budget.actualCost + budget.pendingEstimatedCost; const requiresConfirmation = !plan.reliable || projected > (budget.approvedCostCeiling ?? budget.autoThresholdCny);
  if (requiresConfirmation && !options.confirm) { if (!task.supplied) { await cancelOpenOperations(task.taskId, config); await finalizeTask(task.taskId); } console.log(JSON.stringify({ requiresConfirmation: true, taskId: task.taskId, estimatedTotalCost: plan.estimatedTotalCost, projectedTotalCost: projected, reason: plan.reliable ? `任务预计总费用超过 ¥${(budget.approvedCostCeiling ?? budget.autoThresholdCny).toFixed(2)}。` : '任务费用无法可靠估算。' }, null, 2)); return; }
  if (options.confirm) await authorizeCurrentCost(task.taskId, config, Number.isFinite(options.approvedCostCeiling) ? options.approvedCostCeiling : projected);
  const results = []; let actualTotal = 0; let actualReliable = true;
  try {
    for (let index = 0; index < probes.length; index += 1) {
      const probe = probes[index]; const operationId = operationIds[index];
      if (probe.route === 'url_or_unsupported') throw new RuntimeError('本地文件超过可用输入上限；请提供可访问 HTTPS URL/正式 OSS，当前版本不自动上传该文件。', 'URL_REQUIRED');
      if (probe.route === 'temporary_upload' && !options.forceTempUpload && !config.allowUnverifiedOmniTempUpload) throw new RuntimeError('Omni 临时上传链路尚未完成验证；请提供可访问 HTTPS URL/正式 OSS，或使用 --force-temp-upload 进行专项验证。', 'OMNI_UPLOAD_NOT_VERIFIED');
      const reservation = await startOperation(task.taskId, operationId, config);
      if (!reservation.allowed) throw new RuntimeError(`新增调用预计费用约 ¥${reservation.projected.toFixed(2)}，超过当前授权上限 ¥${reservation.effectiveCeiling.toFixed(2)}，需要用户确认后继续。`, 'COST_CONFIRMATION_REQUIRED');
      let mediaUrl;
      try {
        mediaUrl = probe.route === 'base64' && !options.forceTempUpload ? await encodeVideo(probe.file) : (await uploadTemporary(probe.file, config, config.omniModel)).ossUrl;
        const response = await chatCompletions(config, { model: config.omniModel, messages: [{ role: 'user', content: [{ type: 'video_url', video_url: { url: mediaUrl } }, { type: 'text', text: prompt }] }], reasoning_effort: 'none' }, mediaUrl.startsWith('oss://') ? { 'X-DashScope-OssResourceResolve': 'enable' } : {});
        const content = response.choices?.[0]?.message?.content || ''; const cost = actualCost('omni', response.usage, probe, config); actualReliable &&= cost.reliable; if (cost.reliable) actualTotal += cost.cost; await completeOperation(task.taskId, operationId, cost.reliable ? cost.cost : null, config); results.push({ durationSeconds: probe.durationSeconds, content, usage: response.usage, route: mediaUrl.startsWith('oss://') ? 'temporary_upload' : 'base64' });
      } catch (error) { await failOperation(task.taskId, operationId, null, config); throw error; }
    }
  } finally {
    if (!task.supplied || options.finalizeTask) await finalizeTask(task.taskId);
  }
  const report = { skill: 'Qwen Omni', taskId: task.taskId, results, actualTotalCost: actualReliable ? actualTotal : null, estimatedTotalCost: plan.estimatedTotalCost };
  if (options.output) await fs.writeFile(path.resolve(options.output), JSON.stringify(report, null, 2), { flag: 'wx' });
  if (options.json || options.debug) console.log(JSON.stringify(report, null, 2)); else {
    const costText = actualReliable ? `约 ¥${actualTotal.toFixed(2)}` : plan.estimatedTotalCost !== null ? `约 ¥${plan.estimatedTotalCost.toFixed(2)}（估算）` : '费用暂无法可靠计算';
    console.log(`已调用：Qwen Omni\n${results.map((result) => `视频时长：${durationText(result.durationSeconds)}`).join('\n')}\n本次花费：${costText}`); for (const result of results) console.log(`\n${result.content}`);
  }
}

main().catch((error) => { printError(error, process.argv.includes('--json')); process.exitCode = 1; });
