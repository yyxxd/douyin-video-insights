import os from 'node:os';
import path from 'node:path';

export const DEFAULT_REGION = 'cn-beijing';
export const DEFAULT_COMPATIBLE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
export const DEFAULT_THRESHOLD_CNY = 0.5;

// These are deliberately separate endpoints. Do not derive them by appending paths to BASE_URL.
export const REGION_ENDPOINTS = Object.freeze({
  'cn-beijing': Object.freeze({
    compatibleChatCompletions: `${DEFAULT_COMPATIBLE_BASE_URL}/chat/completions`,
    filetransSubmit: 'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription',
    taskQuery: 'https://dashscope.aliyuncs.com/api/v1/tasks/{taskId}',
    temporaryUploadPolicy: 'https://dashscope.aliyuncs.com/api/v1/uploads',
    temporaryUploadHostResolver: 'policy.upload_host',
  }),
});

const envNumber = (env, name, fallback) => {
  const value = env[name];
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

function normalizeWorkspaceBaseUrl(value) {
  if (!value) return undefined;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('QWEN_BAILIAN_WORKSPACE_BASE_URL 必须是不包含认证信息的 HTTPS URL。');
  return url.toString().replace(/\/$/, '').endsWith('/api/v1') ? url.toString().replace(/\/$/, '') : `${url.toString().replace(/\/$/, '')}/api/v1`;
}

function workspaceBaseFromId(region, workspaceId) {
  if (!workspaceId) return undefined;
  if (!/^[A-Za-z0-9_-]+$/.test(workspaceId)) throw new Error('QWEN_BAILIAN_WORKSPACE_ID 格式无效。');
  if (region === 'cn-beijing') return `https://${workspaceId}.cn-beijing.maas.aliyuncs.com/api/v1`;
  return undefined;
}

function workspaceEndpoints(baseUrl) {
  if (!baseUrl) return undefined;
  return {
    filetransSubmit: `${baseUrl}/services/audio/asr/transcription`,
    taskQuery: `${baseUrl}/tasks/{taskId}`,
  };
}

function regionForBaseUrl(baseUrl) {
  const normalized = baseUrl.replace(/\/$/, '');
  return Object.entries(REGION_ENDPOINTS).find(([, endpoints]) =>
    endpoints.compatibleChatCompletions.startsWith(`${normalized}/`),
  )?.[0];
}

export function resolveConfig(env = process.env) {
  const requestedRegion = env.QWEN_BAILIAN_REGION?.trim() || undefined;
  const requestedBase = env.QWEN_BAILIAN_BASE_URL?.trim().replace(/\/$/, '') || undefined;
  let region = requestedRegion;
  if (!region && requestedBase) region = regionForBaseUrl(requestedBase);
  if (!region) region = DEFAULT_REGION;
  const endpoints = REGION_ENDPOINTS[region];
  if (!endpoints) throw new Error(`不支持的 QWEN_BAILIAN_REGION：${region}`);
  const expectedBase = endpoints.compatibleChatCompletions.replace(/\/chat\/completions$/, '');
  const baseUrl = requestedBase || expectedBase;
  const inferred = regionForBaseUrl(baseUrl);
  if (requestedBase && !inferred) throw new Error('QWEN_BAILIAN_BASE_URL 无法从已知 Endpoint Map 推断 Region。');
  if (requestedRegion && inferred && inferred !== requestedRegion) {
    throw new Error(`Region 与 Base URL 不匹配：${requestedRegion} ≠ ${inferred}。`);
  }
  if (requestedRegion && requestedBase && baseUrl !== expectedBase) {
    throw new Error(`Region ${requestedRegion} 的 Base URL 必须为已登记的兼容 Endpoint。`);
  }
  const workspaceId = env.QWEN_BAILIAN_WORKSPACE_ID?.trim() || undefined;
  const configuredWorkspaceBase = normalizeWorkspaceBaseUrl(env.QWEN_BAILIAN_WORKSPACE_BASE_URL?.trim());
  const derivedWorkspaceBase = workspaceBaseFromId(region, workspaceId);
  if (configuredWorkspaceBase && derivedWorkspaceBase && configuredWorkspaceBase !== derivedWorkspaceBase) throw new Error('QWEN_BAILIAN_WORKSPACE_ID 与 QWEN_BAILIAN_WORKSPACE_BASE_URL 不匹配。');
  const workspaceBaseUrl = configuredWorkspaceBase || derivedWorkspaceBase;
  return {
    apiKey: env.DASHSCOPE_API_KEY || '',
    apiKeyPresent: Boolean(env.DASHSCOPE_API_KEY),
    region,
    baseUrl,
    endpoints,
    workspaceId,
    workspaceBaseUrl,
    workspaceEndpoints: workspaceEndpoints(workspaceBaseUrl),
    workspaceEndpointAvailable: Boolean(workspaceBaseUrl),
    thresholdCny: envNumber(env, 'QWEN_COST_CONFIRM_THRESHOLD_CNY', DEFAULT_THRESHOLD_CNY),
    omniModel: env.QWEN_OMNI_MODEL || 'qwen3.8-omni-flash',
    asrModel: env.QWEN_ASR_MODEL || 'qwen3-asr-flash',
    asrLongModel: env.QWEN_ASR_LONG_MODEL || 'qwen3-asr-flash-filetrans',
    allowUnverifiedOmniTempUpload: env.QWEN_ALLOW_UNVERIFIED_OMNI_TEMP_UPLOAD === '1',
    allowUnverifiedFiletransLocal: env.QWEN_ALLOW_UNVERIFIED_FILETRANS_LOCAL === '1',
    configDir: env.QWEN_MEDIA_CONFIG_DIR || path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'QwenMediaSkills'),
  };
}

export function statePath(config) {
  return path.join(config.configDir, 'state.json');
}

export function publicConfig(config) {
  return {
    apiKeyPresent: config.apiKeyPresent,
    region: config.region,
    baseUrl: config.baseUrl,
    endpoints: config.endpoints,
    workspaceEndpointAvailable: config.workspaceEndpointAvailable,
    thresholdCny: config.thresholdCny,
    omniModel: config.omniModel,
    asrModel: config.asrModel,
    asrLongModel: config.asrLongModel,
    configDir: config.configDir,
  };
}
