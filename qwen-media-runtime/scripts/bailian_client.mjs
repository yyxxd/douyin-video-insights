import { RuntimeError } from './errors.mjs';

async function request(url, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
    if (!response.ok) throw new RuntimeError(body.message || body.error?.message || `百炼请求失败（HTTP ${response.status}）。`, 'API_ERROR', { status: response.status, body });
    return body;
  } catch (error) {
    if (error.name === 'AbortError') throw new RuntimeError('百炼请求超时。', 'TIMEOUT');
    throw error;
  } finally { clearTimeout(timer); }
}

export function authHeaders(config, extra = {}) {
  return { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', ...extra };
}

export function chatCompletions(config, body, extraHeaders = {}) {
  return request(config.endpoints.compatibleChatCompletions, { method: 'POST', headers: authHeaders(config, extraHeaders), body: JSON.stringify(body) });
}

export function filetransSubmit(config, body, endpoints = config.endpoints) {
  return request(endpoints.filetransSubmit, { method: 'POST', headers: authHeaders(config, { 'X-DashScope-Async': 'enable', 'X-DashScope-OssResourceResolve': 'enable' }), body: JSON.stringify(body) });
}

export function taskQuery(config, taskId, endpoints = config.endpoints) {
  return request(endpoints.taskQuery.replace('{taskId}', encodeURIComponent(taskId)), { headers: { Authorization: `Bearer ${config.apiKey}` } });
}

export async function fetchResultJson(config, url) {
  return request(url, { headers: { Authorization: `Bearer ${config.apiKey}`, 'X-DashScope-OssResourceResolve': 'enable' } });
}

export { request };
