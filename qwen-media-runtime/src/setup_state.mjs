export const GUIDE_VERSION = 2;

export function guideState({ settings, loginSaved, aiSaved }) {
  const aiSkipped = settings.aiSkipped === true;
  const ready = loginSaved && ((aiSaved && settings.ai === 'connected') || aiSkipped);
  const status = ready ? (aiSkipped ? 'partial' : 'complete') : settings.guideStatus === 'cancelled' ? 'cancelled' : 'in_progress';
  return { version: GUIDE_VERSION, status, loginReady: loginSaved, aiReady: aiSaved && settings.ai === 'connected', aiSkipped };
}

export async function verifyAIKey(key, fetchImpl = fetch) {
  let response;
  try {
    response = await fetchImpl('https://dashscope.aliyuncs.com/compatible-mode/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError') throw new Error('连接检查超时，请检查网络后重试；当前配置没有改动。');
    throw new Error('无法连接百炼服务，请检查网络后重试；当前配置没有改动。');
  }
  if (response.status === 401) throw new Error('API Key 无效或已失效，请重新复制；当前配置没有改动。');
  if (response.status === 403) throw new Error('API Key 没有访问权限，请检查账号、地域或服务开通状态；当前配置没有改动。');
  if (response.status === 429) throw new Error('百炼服务请求过于频繁，请稍后重试；当前配置没有改动。');
  if (!response.ok) throw new Error(`百炼服务暂时不可用（HTTP ${response.status}），请稍后重试；当前配置没有改动。`);
  let body;
  try { body = await response.json(); } catch { throw new Error('百炼返回了无法识别的结果，请稍后重试；当前配置没有改动。'); }
  if (!Array.isArray(body?.data)) throw new Error('百炼返回的模型列表格式异常，请确认连接地址和服务状态；当前配置没有改动。');
  return true;
}
