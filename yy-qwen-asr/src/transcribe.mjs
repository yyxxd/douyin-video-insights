import fs from 'node:fs/promises';
import path from 'node:path';
import { probeMedia } from '../../qwen-media-runtime/src/media_probe.mjs';
import { actualCost } from '../../qwen-media-runtime/src/cost_guard.mjs';
import { chatCompletions } from '../../qwen-media-runtime/src/bailian_client.mjs';
import { asrSegments, requireTimestamps } from '../../qwen-media-runtime/src/asr_timeline.mjs';
import { RuntimeError } from '../../qwen-media-runtime/src/errors.mjs';
import { runModelTask } from '../../qwen-media-runtime/src/model_task.mjs';
import { transcribeLong } from './filetrans.mjs';

const mime = { mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac', ogg: 'audio/ogg' };

async function probe(file, options, config) {
  const media = await probeMedia(file, 'asr');
  if (media.route === 'unsupported') throw new RuntimeError('媒体超出转写限制。', 'ASR_UNSUPPORTED');
  if (options.timestamps) media.route = 'long_filetrans';
  if (media.route === 'long_filetrans' && !config.allowUnverifiedFiletransLocal) throw new RuntimeError('Filetrans 本地临时上传需要按 Skill 说明显式启用并验证。', 'FILETRANS_NOT_VERIFIED');
  return media;
}

async function transcribeShort(config, media, options, hooks) {
  const extension = path.extname(media.file).slice(1).toLowerCase();
  const encoded = (await fs.readFile(media.file)).toString('base64');
  const body = {
    model: config.asrModel,
    messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:${mime[extension] || 'application/octet-stream'};base64,${encoded}`, format: extension } }] }],
    stream: false,
    parameters: { enable_itn: options.itn },
  };
  if (options.language) body.language = options.language;
  await hooks.beforeRequest();
  return chatCompletions(config, body);
}

function readTranscript(response, media, options) {
  if (media.route === 'short_base64') {
    const text = response.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new RuntimeError('ASR 响应缺少转写文本。', 'ASR_RESPONSE_INVALID');
    return { text, segments: [] };
  }
  if (!Array.isArray(response.transcripts) && !Array.isArray(response.output?.sentences)) throw new RuntimeError('Filetrans 返回的转写结构无效。', 'ASR_RESPONSE_INVALID');
  const segments = asrSegments(response);
  const text = response.transcripts?.map(item => item.text || '').join('\n') || response.output?.text || segments.map(item => item.text).join('\n');
  if (options.timestamps) requireTimestamps(segments, text);
  return { segments, text: segments.length ? segments.map(item => `[${item.start * 1000}ms-${item.end * 1000}ms] ${item.text}`).join('\n') : text };
}

async function execute(media, options, config, hooks) {
  const response = media.route === 'long_filetrans' ? await transcribeLong(config, media, hooks) : await transcribeShort(config, media, options, hooks);
  const result = { ...readTranscript(response, media, options), durationSeconds: media.durationSeconds, usage: response.usage, route: media.route };
  return { result, cost: actualCost('asr', response.usage, media, config) };
}

export const asrAdapter = { kind: 'asr', skill: 'Qwen ASR', probe, execute, model: (media, config) => media.route === 'long_filetrans' ? config.asrLongModel : config.asrModel };
export const transcribe = options => runModelTask(options, asrAdapter);
