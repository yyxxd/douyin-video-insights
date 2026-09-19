const DEFAULT_PRICES = {
  'cn-beijing': {
    omniInputPerMillion: 0.8,
    omniOutputPerMillion: 2.7,
    asrPerSecond: 0.00022,
  },
};

const override = (env, name, fallback) => {
  const value = Number(env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

export function getPrices(region, env = process.env) {
  const base = DEFAULT_PRICES[region];
  if (!base) return { reliable: false, reason: `没有 ${region} 的默认价格配置。` };
  return {
    reliable: true,
    region,
    omniInputPerMillion: override(env, 'QWEN_OMNI_INPUT_PRICE_PER_MILLION_TOKENS', base.omniInputPerMillion),
    omniOutputPerMillion: override(env, 'QWEN_OMNI_OUTPUT_PRICE_PER_MILLION_TOKENS', base.omniOutputPerMillion),
    asrPerSecond: override(env, 'QWEN_ASR_PRICE_PER_SECOND_CNY', base.asrPerSecond),
  };
}
