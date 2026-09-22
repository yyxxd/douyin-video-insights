import { getPrices } from './pricing.mjs';

const ceil = (value) => Math.ceil(value);

export function estimateOmni(probe, prompt = '', config) {
  const prices = getPrices(config.region, config.omniModel, 'omni', config.priceEnv);
  if (!prices.reliable) return { reliable: false, reason: prices.reason };
  const promptTokens = ceil(prompt.length / 2);
  const outputTokens = 800;
  const inputTokens = promptTokens + (probe.estimatedVideoTokens || 0) + (probe.estimatedAudioTokens || 0);
  const cost = inputTokens / 1e6 * prices.omniInputPerMillion + outputTokens / 1e6 * prices.omniOutputPerMillion;
  return { reliable: true, estimatedCost: cost, inputTokens, outputTokens };
}

export function estimateAsr(probe, config) {
  const model = probe.route === 'long_filetrans' ? config.asrLongModel : config.asrModel;
  const prices = getPrices(config.region, model, 'asr', config.priceEnv);
  if (!prices.reliable || !Number.isFinite(probe.durationSeconds)) return { reliable: false, reason: prices.reason || '缺少音频时长。' };
  return { reliable: true, estimatedCost: probe.durationSeconds * prices.asrPerSecond, seconds: probe.durationSeconds };
}

export function buildTaskPlan(operations, config) {
  const estimates = operations.map((operation) => ({
    ...operation,
    estimate: operation.kind === 'omni' ? estimateOmni(operation.probe, operation.prompt, config) : estimateAsr(operation.probe, config),
  }));
  const reliable = estimates.every((item) => item.estimate.reliable);
  const estimatedTotalCost = reliable ? estimates.reduce((sum, item) => sum + item.estimate.estimatedCost, 0) : null;
  return { operations: estimates, reliable, estimatedTotalCost, thresholdCny: config.thresholdCny };
}

export function evaluateTask(plan) {
  const requiresConfirmation = !plan.reliable || plan.estimatedTotalCost > plan.thresholdCny;
  return { ...plan, requiresConfirmation, decision: requiresConfirmation ? 'confirm' : 'auto' };
}

export function actualCost(kind, usage, fallbackProbe, config) {
  const model = kind === 'omni' ? config.omniModel : fallbackProbe?.route === 'long_filetrans' ? config.asrLongModel : config.asrModel;
  const prices = getPrices(config.region, model, kind, config.priceEnv);
  if (!prices.reliable) return { reliable: false };
  if (kind === 'omni') {
    const input = Number(usage?.prompt_tokens);
    const output = Number(usage?.completion_tokens);
    if (!Number.isFinite(input) || !Number.isFinite(output)) return { reliable: false };
    return { reliable: true, cost: input / 1e6 * prices.omniInputPerMillion + output / 1e6 * prices.omniOutputPerMillion };
  }
  if (usage?.seconds === undefined || usage?.seconds === null) return { reliable: false, source: 'duration-estimate' };
  const seconds = Number(usage.seconds);
  return Number.isFinite(seconds) ? { reliable: true, cost: seconds * prices.asrPerSecond } : { reliable: false };
}
