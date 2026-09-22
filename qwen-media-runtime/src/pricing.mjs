const DEFAULT_PRICES = {
  'cn-beijing': {
    'qwen3.8-omni-flash': { omniInputPerMillion: 0.8, omniOutputPerMillion: 2.7 },
    'qwen3-asr-flash': { asrPerSecond: 0.00022 },
    'qwen3-asr-flash-filetrans': { asrPerSecond: 0.00022 },
  },
};

const VARIABLES = {
  omniInputPerMillion: 'QWEN_OMNI_INPUT_PRICE_PER_MILLION_TOKENS',
  omniOutputPerMillion: 'QWEN_OMNI_OUTPUT_PRICE_PER_MILLION_TOKENS',
  asrPerSecond: 'QWEN_ASR_PRICE_PER_SECOND_CNY',
};

export function getPrices(region, model, kind, env = process.env) {
  const base = DEFAULT_PRICES[region]?.[model];
  const boundModel = env[kind === 'omni' ? 'QWEN_OMNI_PRICE_MODEL' : 'QWEN_ASR_PRICE_MODEL'];
  if (!base && boundModel !== model) return { reliable: false, reason: `未知模型 ${model} 需要明确绑定模型名称和价格配置。` };
  const keys = kind === 'omni' ? ['omniInputPerMillion', 'omniOutputPerMillion'] : ['asrPerSecond'];
  const result = { reliable: true, region, model, source: base ? 'configured-default' : 'environment' };
  for (const key of keys) {
    const supplied = boundModel && boundModel !== model ? undefined : env[VARIABLES[key]];
    const value = supplied === undefined || supplied === '' ? base?.[key] : supplied.trim() ? Number(supplied) : NaN;
    if (!Number.isFinite(value) || value < 0) return { reliable: false, reason: `模型 ${model} 在 ${region} 缺少有效的 ${VARIABLES[key]} 价格配置。` };
    result[key] = value;
  }
  return result;
}
