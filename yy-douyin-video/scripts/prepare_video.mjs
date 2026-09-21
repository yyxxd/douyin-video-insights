import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeMedia } from '../../qwen-media-runtime/scripts/media_probe.mjs';
import { argumentsOf, run, writeJson, inside } from './common.mjs';
import { withCookies } from './cookies.mjs';

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

async function download(share, output, browser, cookies) {
  const url = shareUrl(share);
  if (browser && !['chrome', 'edge', 'firefox'].includes(browser)) throw new Error('浏览器仅支持 chrome、edge、firefox。');
  if (browser && cookies) throw new Error('browser 与 cookies 不能同时指定。');
  const args = ['--ignore-config', '--no-playlist', '--no-progress', '--socket-timeout', '20', '--retries', '0', '--max-filesize', '500M', '--merge-output-format', 'mp4', '-o', path.join(output, 'source.%(ext)s'), '--print', 'after_move:filepath'];
  if (browser) args.push('--cookies-from-browser', browser);
  try {
    const result = await withCookies(cookies, (cookieFile) => run('yt-dlp', [...args, ...(cookieFile ? ['--cookies', cookieFile] : []), '--', url], 180000));
    const file = result.stdout.trim().split(/\r?\n/).at(-1);
    if (!file) throw new Error('下载工具未返回视频文件。');
    return inside(output, path.resolve(file));
  } catch (error) {
    if (/Could not copy.*cookie database/i.test(error.diagnostic || '')) throw new Error('Chrome Cookie 数据库无法复制。请用户自行关闭浏览器后重试，或提供本地视频。');
    if (/403/.test(error.diagnostic || '')) throw new Error('抖音接口返回 HTTP 403；仅凭此响应无法判定 Cookie 失效。请检查该链接在浏览器中是否可播放，或提供本地视频。');
    if (/cookies|login|DPAPI|decrypt/i.test(error.diagnostic || '')) throw new Error('抖音获取受访问权限或 Cookie 解密限制；请提供本地视频，或经授权使用可用的浏览器 Cookie。');
    throw new Error(`视频下载失败：${error.message} 可提供本地视频继续。`);
  }
}

export async function prepare(options) {
  if (!options.out || Boolean(options.file) === Boolean(options.share)) throw new Error('提供 --out 和 --file 或 --share 之一。');
  const output = path.resolve(options.out);
  await fs.mkdir(output, { recursive: true });
  await fs.writeFile(path.join(output, '.task'), '', { flag: 'wx' });
  const source = options.file ? path.resolve(options.file) : await download(options.share, output, options.browser, options.cookies);
  const probe = await probeMedia(source, 'omni');
  if (!Number.isFinite(probe.durationSeconds) || probe.durationSeconds <= 0) throw new Error('视频缺少有效时长。');
  const video = path.join(output, 'video.mp4');
  await run('ffmpeg', ['-v', 'error', '-nostdin', '-n', '-i', source, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-c:a', 'aac', '-movflags', '+faststart', video]);
  const media = await probeMedia(video, 'omni');
  let audio = null;
  if (media.audio) {
    audio = path.join(output, 'audio.wav');
    await run('ffmpeg', ['-v', 'error', '-nostdin', '-n', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', audio]);
  }
  const detection = await run('ffmpeg', ['-hide_banner', '-nostdin', '-i', video, '-an', '-vf', "select='gt(scene,0.3)',showinfo", '-f', 'null', '-']);
  const cuts = [...detection.stderr.matchAll(/pts_time:([\d.]+)/g)].map((match) => Number(match[1]));
  const manifest = { video, audio, durationSeconds: media.durationSeconds, width: media.video.width, height: media.video.height, candidateCuts: [...new Set(cuts)], timebase: 'seconds-from-video-start', source: options.share ? shareUrl(options.share) : source };
  await writeJson(path.join(output, 'media.json'), manifest);
  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepare(argumentsOf(process.argv.slice(2), ['file', 'share', 'out', 'browser', 'cookies'])).then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
