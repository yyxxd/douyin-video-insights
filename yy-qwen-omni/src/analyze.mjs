import fs from 'node:fs/promises';
import path from 'node:path';
import { probeMedia } from '../../qwen-media-runtime/src/media_probe.mjs';
import { actualCost } from '../../qwen-media-runtime/src/cost_guard.mjs';
import { chatCompletions } from '../../qwen-media-runtime/src/bailian_client.mjs';
import { uploadTemporary } from '../../qwen-media-runtime/src/temp_upload.mjs';
import { RuntimeError } from '../../qwen-media-runtime/src/errors.mjs';
import { runModelTask } from '../../qwen-media-runtime/src/model_task.mjs';

async function probe(file, options, config) {
  const media = await probeMedia(file, 'omni');
  if (media.route === 'url_or_unsupported') throw new RuntimeError('本地文件超过当前输入上限。', 'URL_REQUIRED');
  if (media.route === 'temporary_upload' && !options.forceTempUpload && !config.allowUnverifiedOmniTempUpload) throw new RuntimeError('Omni 临时上传需要按 Skill 说明显式启用并验证。', 'OMNI_UPLOAD_NOT_VERIFIED');
  if (options.forceTempUpload) media.route = 'temporary_upload';
  return media;
}

async function encodeVideo(file) {
  const mime = { mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', webm: 'video/webm' };
  return `data:${mime[path.extname(file).slice(1).toLowerCase()] || 'video/mp4'};base64,${(await fs.readFile(file)).toString('base64')}`;
}

async function execute(media, options, config, hooks) {
  const url = media.route === 'base64' ? await encodeVideo(media.file) : (await uploadTemporary(media.file, config, config.omniModel)).ossUrl;
  await hooks.beforeRequest();
  const response = await chatCompletions(config, {
    model: config.omniModel,
    messages: [{ role: 'user', content: [{ type: 'video_url', video_url: { url } }, { type: 'text', text: options.prompt }] }],
    reasoning_effort: 'none',
  }, url.startsWith('oss://') ? { 'X-DashScope-OssResourceResolve': 'enable' } : {});
  const content = response.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new RuntimeError('Omni 未返回有效的分析结果。', 'OMNI_RESPONSE_INVALID');
  return { result: { durationSeconds: media.durationSeconds, content, usage: response.usage, route: media.route }, cost: actualCost('omni', response.usage, media, config) };
}

export const omniAdapter = { kind: 'omni', skill: 'Qwen Omni', probe, execute, model: (_media, config) => config.omniModel };
export async function analyze(options) {
  const prompt = options.promptFile ? await fs.readFile(path.resolve(options.promptFile), 'utf8') : options.prompt;
  if (typeof prompt !== 'string' || !prompt.trim()) throw new RuntimeError('需要非空的 --prompt 或 --prompt-file。', 'USAGE');
  return runModelTask({ ...options, prompt }, omniAdapter);
}
