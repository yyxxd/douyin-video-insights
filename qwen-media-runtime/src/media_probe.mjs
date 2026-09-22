import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { RuntimeError } from './errors.mjs';

function runFfprobe(file) {
  return new Promise((resolve, reject) => {
    const child = spawn('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { windowsHide: true });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (data) => { stdout += data; }); child.stderr.on('data', (data) => { stderr += data; });
    child.on('error', () => reject(new RuntimeError('未找到 ffprobe，请先安装 FFmpeg。', 'FFPROBE_MISSING')));
    child.on('close', code => {
      if (code !== 0) return reject(new RuntimeError(`媒体预检失败：${stderr.trim() || 'ffprobe 无法读取文件。'}`, 'MEDIA_INVALID'));
      try { resolve(JSON.parse(stdout)); }
      catch { reject(new RuntimeError('ffprobe 返回无效 JSON。', 'MEDIA_INVALID')); }
    });
  });
}

export async function probeMedia(file, kind) {
  const absolute = path.resolve(file);
  const stat = await fs.stat(absolute).catch(() => { throw new RuntimeError('媒体文件不存在或不可读取。', 'MEDIA_NOT_FOUND'); });
  if (!stat.isFile()) throw new RuntimeError('媒体路径不是文件。', 'MEDIA_NOT_FILE');
  const data = await runFfprobe(absolute);
  const streams = data.streams || [];
  const video = streams.find((item) => item.codec_type === 'video');
  const audio = streams.find((item) => item.codec_type === 'audio');
  const durationSeconds = Number(data.format?.duration || video?.duration || audio?.duration || 0);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new RuntimeError('媒体缺少有效时长。', 'MEDIA_INVALID');
  const fps = video?.avg_frame_rate && video.avg_frame_rate !== '0/0' ? video.avg_frame_rate : null;
  const fpsValue = fps ? Number(fps.split('/')[0]) / Number(fps.split('/')[1]) : null;
  if (kind === 'omni' && !video) throw new RuntimeError('Qwen Omni 需要包含视频轨道的文件。', 'MEDIA_NO_VIDEO');
  if (kind === 'asr' && !audio) throw new RuntimeError('未检测到可识别的音轨，无法进行语音转写。', 'MEDIA_NO_AUDIO');
  const maxBytes = 2 * 1024 ** 3;
  if (stat.size > maxBytes) throw new RuntimeError('文件超过 Qwen Omni/ASR URL 输入上限（2GB）。', 'MEDIA_TOO_LARGE');
  const result = { file: absolute, sizeBytes: stat.size, durationSeconds, format: data.format?.format_name, video: video && { codec: video.codec_name, width: video.width, height: video.height, fps: fpsValue }, audio: audio && { codec: audio.codec_name, sampleRate: Number(audio.sample_rate), channels: audio.channels } };
  if (kind === 'omni') {
    const pixels = Math.max(1, (video.width || 1) * (video.height || 1));
    result.estimatedVideoTokens = Math.ceil(Math.min(16384, Math.max(256, pixels / 32 ** 2)) * Math.ceil(durationSeconds * 2) / 2);
    result.estimatedAudioTokens = audio ? Math.ceil(durationSeconds) * 7 : 0;
    result.route = stat.size < 7.5 * 1024 ** 2 ? 'base64' : stat.size <= 1024 ** 3 ? 'temporary_upload' : 'url_or_unsupported';
    result.limit = { base64Bytes: 7.5 * 1024 ** 2, temporaryUploadBytes: 1024 ** 3, urlBytes: maxBytes, urlDurationSeconds: 2 * 3600 };
    if (durationSeconds > 2 * 3600) throw new RuntimeError('视频超过 Qwen Omni 的 2 小时限制。', 'MEDIA_DURATION_LIMIT');
  } else {
    result.route = durationSeconds <= 5 * 60 && stat.size <= 10 * 1024 ** 2 ? 'short_base64' : stat.size <= maxBytes && durationSeconds <= 12 * 3600 ? 'long_filetrans' : 'unsupported';
    result.limit = { shortBytes: 10 * 1024 ** 2, shortDurationSeconds: 5 * 60, longBytes: maxBytes, longDurationSeconds: 12 * 3600 };
  }
  return result;
}

