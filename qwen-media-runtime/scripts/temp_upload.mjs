import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { URL } from 'node:url';
import { resolveConfig } from './config.mjs';
import { RuntimeError, printError } from './errors.mjs';

const MAX_BYTES = 1024 ** 3;
const ALLOWED_MODELS = new Set(['qwen3.8-omni-flash', 'qwen3-asr-flash-filetrans']);

function requestJson(url, options, body) {
  return new Promise((resolve, reject) => {
    const request = https.request(new URL(url), options, (response) => {
      let text = ''; response.setEncoding('utf8'); response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => { let value; try { value = JSON.parse(text); } catch { return reject(new RuntimeError('上传服务返回了非 JSON 响应。', 'UPLOAD_RESPONSE')); } response.statusCode >= 200 && response.statusCode < 300 ? resolve(value) : reject(new RuntimeError(value.message || `上传请求失败（HTTP ${response.statusCode}）。`, 'UPLOAD_ERROR')); });
    });
    request.on('error', reject); request.end(body);
  });
}

function multipartUpload(policy, file, key) {
  return new Promise((resolve, reject) => {
    const boundary = `----QwenMedia${Date.now().toString(16)}`;
    const fields = { OSSAccessKeyId: policy.oss_access_key_id, Signature: policy.signature, policy: policy.policy, 'x-oss-object-acl': policy.x_oss_object_acl, 'x-oss-forbid-overwrite': policy.x_oss_forbid_overwrite, key, success_action_status: '200' };
    const prefix = Object.entries(fields).map(([name, value]) => `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`).join('');
    const suffix = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="media"\r\nContent-Type: application/octet-stream\r\n\r\n`;
    const ending = `\r\n--${boundary}--\r\n`;
    const stat = fs.statSync(file); const url = new URL(policy.upload_host);
    const request = https.request(url, { method: 'POST', headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': Buffer.byteLength(prefix) + Buffer.byteLength(suffix) + stat.size + Buffer.byteLength(ending) } }, (response) => {
      let text = ''; response.on('data', (chunk) => { text += chunk; }); response.on('end', () => response.statusCode >= 200 && response.statusCode < 300 ? resolve() : reject(new RuntimeError(`临时文件上传失败（HTTP ${response.statusCode}）：${text.slice(0, 200)}`, 'UPLOAD_ERROR')));
    });
    request.on('error', reject); request.write(prefix); request.write(suffix);
    const stream = fs.createReadStream(file); stream.on('error', reject); stream.on('end', () => request.end(ending)); stream.pipe(request, { end: false });
  });
}

export async function uploadTemporary(file, config, targetModel) {
  if (!ALLOWED_MODELS.has(targetModel)) throw new RuntimeError('临时上传必须使用受支持且明确传入的目标模型。', 'UPLOAD_MODEL_REQUIRED');
  const stat = await fsPromises.stat(file); if (stat.size > MAX_BYTES) throw new RuntimeError('文件超过百炼临时上传 1GB 上限，不能走临时上传。', 'UPLOAD_TOO_LARGE');
  const policyUrl = new URL(config.endpoints.temporaryUploadPolicy); policyUrl.searchParams.set('action', 'getPolicy'); policyUrl.searchParams.set('model', targetModel);
  const policyResponse = await requestJson(policyUrl, { headers: { Authorization: `Bearer ${config.apiKey}` } });
  const policy = policyResponse.data || policyResponse.output || policyResponse;
  if (!policy.upload_host || !policy.policy || !policy.signature || !policy.upload_dir) {
    throw new RuntimeError('临时上传策略响应缺少必要字段。', 'UPLOAD_POLICY_INVALID');
  }
  const key = `${policy.upload_dir.replace(/\/+$/, '')}/${Date.now()}-${Math.random().toString(16).slice(2)}-${file.split(/[\\/]/).pop()}`;
  await multipartUpload(policy, file, key);
  return { ossUrl: `oss://${key}`, region: config.region, targetModel };
}

async function main() {
  const args = process.argv.slice(2); const value = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const file = value('--file'); const region = value('--region'); const model = value('--model'); const json = args.includes('--json');
  if (!file || !region || !model) throw new RuntimeError('用法：temp_upload.mjs --file <path> --region <region> --model <target-model>', 'USAGE');
  const config = resolveConfig({ ...process.env, QWEN_BAILIAN_REGION: region });
  const result = await uploadTemporary(file, config, model); console.log(json ? JSON.stringify({ ok: true, ...result }) : JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { printError(error, process.argv.includes('--json')); process.exitCode = 1; });
}
