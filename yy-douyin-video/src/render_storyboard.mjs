import { validateMedia, speechTimeline } from './contracts.mjs';
import { withArtifactDirectory } from './artifacts.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { readJson, writeJson, run } from './common.mjs';
import { validateStoryboard, fields, escapeHtml as html, clock } from './storyboard.mjs';

async function extractFrames(shots, media, output) {
  for (const shot of shots) {
    shot.images = [];
    for (const [index, time] of shot.frames.entries()) {
      const relative = `frames/shot-${String(shot.id).padStart(3, '0')}-${index + 1}.jpg`;
      const result = await run('ffmpeg', ['-hide_banner', '-nostdin', '-n', '-i', media.video, '-vf', `select=gte(t\\,${time}),showinfo`, '-frames:v', '1', '-q:v', '2', path.join(output, relative)]);
      const actual = Number(result.stderr.match(/pts_time:([\d.]+)/)?.[1]);
      if (!Number.isFinite(actual) || actual < shot.start || actual >= shot.end) throw new Error(`镜头 ${shot.id} 未取到区间内的有效帧，请调整截图时间。`);
      await fs.access(path.join(output, relative));
      shot.images.push({ path: relative, requestedTime: time, actualTime: actual });
    }
  }
}

function card(shot) {
  const speech = shot.speech.map((s) => `[${clock(s.start)}–${clock(s.end)}] ${s.text}${s.continues ? '（跨镜头，完整原句）' : ''}`).join('\n') || '本镜无 ASR 台词';
  const pictures = shot.images.map((image) => `<figure><img src="${image.path}" alt="镜头 ${shot.id} 原片截图"><figcaption>${clock(image.actualTime)}</figcaption></figure>`).join('');
  const details = Object.entries(fields).map(([key, label]) => `<dt>${label}</dt><dd>${html(shot[key])}</dd>`).join('');
  return `<article><h2>镜头 ${shot.id} · ${clock(shot.start)}–${clock(shot.end)}</h2><div class="frames">${pictures}</div><dl>${details}<dt>原始台词</dt><dd>${html(speech)}</dd></dl></article>`;
}

export async function render(options) {
  if (!options.media || !options.shots || !options.out) throw new Error('需要 --media、--shots、--out，可选 --asr。');
  const media = validateMedia(await readJson(options.media)); const data = await readJson(options.shots);
  const asr = options.asr ? await readJson(options.asr) : null;
  const segments = speechTimeline(media, asr);
  const shots = validateStoryboard(data, media, segments);
  return withArtifactDirectory(options.out, output => renderReport(output, media, data, shots, segments));
}

async function renderReport(output, media, data, shots, segments) {
  await fs.mkdir(path.join(output, 'frames'));
  await extractFrames(shots, media, output);
  await writeJson(path.join(output, 'storyboard.json'), { schemaVersion: 1, summary: data.summary, durationSeconds: media.durationSeconds, shots, speechTimeline: segments });
  const style = 'body{max-width:1100px;margin:32px auto;padding:0 24px;background:#f5f4f0;color:#20242a;font:16px/1.7 system-ui}article{background:white;padding:24px;margin:24px 0;border-radius:12px}h1,h2{line-height:1.4}.frames{display:flex;gap:16px;flex-wrap:wrap}figure{margin:0;flex:1;min-width:160px}img{width:100%;max-height:460px;object-fit:contain;background:#eee}figcaption{color:#666}dt{font-weight:700;margin-top:14px}dd{margin:0;white-space:pre-wrap}@media print{article{break-inside:avoid}body{background:white}}';
  await fs.writeFile(path.join(output, 'report.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>视频图文分镜还原稿</title><style>${style}</style><h1>视频图文分镜还原稿</h1><p>${html(data.summary)}</p><p>原片截图 · 台词时间来自 ASR · 镜头边界与画面描述需对照原片复核</p>${shots.map(card).join('')}</html>`, { flag: 'wx' });
  const markdown = shots.map((shot) => `## 镜头 ${shot.id} · ${clock(shot.start)}–${clock(shot.end)}\n\n${shot.images.map((image) => `![原片 ${clock(image.actualTime)}](${image.path})`).join('\n\n')}\n\n${Object.entries(fields).map(([key, label]) => `**${label}**：${shot[key]}`).join('\n\n')}\n\n**台词引用**：${shot.speech.map((s) => `${s.id} [${clock(s.start)}–${clock(s.end)}] ${s.text}${s.continues ? '（跨镜头完整原句）' : ''}`).join('；') || '无'}\n`).join('\n');
  await fs.writeFile(path.join(output, 'report.md'), `# 视频图文分镜还原稿\n\n${data.summary}\n\n${markdown}`, { flag: 'wx' });
  return path.join(output, 'report.html');
}

