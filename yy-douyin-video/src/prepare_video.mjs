import { withArtifactDirectory } from './artifacts.mjs';
import path from 'node:path';
import { probeMedia } from '../../qwen-media-runtime/src/media_probe.mjs';
import { run, writeJson } from './common.mjs';
import { downloadVideo } from './download_video.mjs';

export function shareUrl(text) {
  const urls = text.replace(/\\_/g, '_').match(/https:\/\/[^\s<>"\])]+/g) || [];
  const valid = urls.filter((value) => {
    const url = new URL(value);
    return !url.username && !url.password && !url.port && ['v.douyin.com', 'www.douyin.com', 'douyin.com'].includes(url.hostname);
  });
  const unique = [...new Set(valid)];
  if (unique.length !== 1) throw new Error('每次提供一个抖音视频链接或包含该链接的分享文案。');
  return unique[0];
}

export async function prepare(options) {
  if (!options.out || Boolean(options.file) === Boolean(options.share)) throw new Error('提供 --out 和 --file 或 --share 之一。');
  if (options.resolution && !['720', '1080', 'best'].includes(options.resolution)) throw new Error('resolution 仅支持 720、1080、best。');
  return withArtifactDirectory(options.out, output => prepareMedia(options, output));
}

async function prepareMedia(options, output) {
  const source = options.file ? path.resolve(options.file) : await downloadVideo(options, path.join(output, 'download'));
  const probe = await probeMedia(source, 'omni');
  if (!Number.isFinite(probe.durationSeconds) || probe.durationSeconds <= 0) throw new Error('视频缺少有效时长。');
  const video = path.join(output, 'video.mp4');
  const target = options.resolution && options.resolution !== 'best' ? Number(options.resolution) : null;
  const scale = target && Math.min(probe.video.width, probe.video.height) > target
    ? ['-vf', `scale=if(gte(iw\\,ih)\\,-2\\,${target}):if(gte(iw\\,ih)\\,${target}\\,-2)`] : [];
  await run('ffmpeg', ['-v', 'error', '-nostdin', '-n', '-i', source, '-map', '0:v:0', '-map', '0:a:0?', ...scale, '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-c:a', 'aac', '-movflags', '+faststart', video]);
  const media = await probeMedia(video, 'omni');
  let audio = null;
  if (media.audio) {
    audio = path.join(output, 'audio.wav');
    await run('ffmpeg', ['-v', 'error', '-nostdin', '-n', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', audio]);
  }
  const detection = await run('ffmpeg', ['-hide_banner', '-nostdin', '-i', video, '-an', '-vf', "select='gt(scene,0.3)',showinfo", '-f', 'null', '-']);
  const cuts = [...detection.stderr.matchAll(/pts_time:([\d.]+)/g)].map((match) => Number(match[1]));
  const manifest = { schemaVersion: 1, video, audio, durationSeconds: media.durationSeconds, width: media.video.width, height: media.video.height, candidateCuts: [...new Set(cuts)], timebase: 'seconds-from-video-start', source: options.share ? shareUrl(options.share) : source };
  await writeJson(path.join(output, 'media.json'), manifest);
  return manifest;
}

