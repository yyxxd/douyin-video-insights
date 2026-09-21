import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { argumentsOf, readJson, writeJson } from './common.mjs';
import { probeMedia } from '../../qwen-media-runtime/scripts/media_probe.mjs';
import { resolveConfig } from '../../qwen-media-runtime/scripts/config.mjs';
import { buildTaskPlan } from '../../qwen-media-runtime/scripts/cost_guard.mjs';
import { registerOperations } from '../../qwen-media-runtime/scripts/task_budget.mjs';

async function main() {
  const options = argumentsOf(process.argv.slice(2), ['media', 'mode', 'out']);
  if (!options.media || !options.out || !['analysis', 'transcript', 'storyboard'].includes(options.mode)) throw new Error('需要 --media、--mode analysis|transcript|storyboard、--out。');
  const media = await readJson(options.media); const config = resolveConfig(); const operations = [];
  if (options.mode !== 'analysis' && media.audio) operations.push({ kind: 'asr', probe: await probeMedia(media.audio, 'asr') });
  if (options.mode === 'transcript' && !media.audio) throw new Error('视频无音轨，无法提取口播稿。');
  if (options.mode !== 'transcript') operations.push({ kind: 'omni', probe: await probeMedia(media.video, 'omni'), prompt: '' });
  const plan = buildTaskPlan(operations, config);
  // 图文分镜的输出远长于摘要；为台词上下文、分镜输出和一次局部复核预留空间。
  if (options.mode === 'storyboard') {
    const omni = plan.operations.find((op) => op.kind === 'omni');
    if (omni.estimate.reliable) omni.estimate.estimatedCost = omni.estimate.estimatedCost * 2 + Math.max(0.1, media.durationSeconds * 0.003);
  }
  const taskId = `video-${randomUUID()}`;
  const registered = plan.operations.map((op) => ({ operationId: op.kind, skill: op.kind === 'asr' ? 'Qwen ASR' : 'Qwen Omni', model: op.kind === 'asr' ? (options.mode === 'storyboard' || op.probe.route === 'long_filetrans' ? config.asrLongModel : config.asrModel) : config.omniModel, estimatedCost: op.estimate.reliable ? op.estimate.estimatedCost : null }));
  const result = { taskId, mode: options.mode, operations: registered, estimatedTotalCost: plan.reliable ? registered.reduce((sum, op) => sum + op.estimatedCost, 0) : null, thresholdCny: config.thresholdCny };
  result.requiresConfirmation = result.estimatedTotalCost === null || result.estimatedTotalCost > result.thresholdCny;
  await fs.access(path.dirname(path.resolve(options.out)));
  await writeJson(options.out, result);
  await registerOperations(taskId, registered, config);
  console.log(JSON.stringify(result, null, 2));
}
main().catch((error) => { console.error(error.message); process.exitCode = 1; });
