import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { parseStoryboardResult } from '../../yy-douyin-video/src/parse_storyboard_result.mjs';
import { validateMedia, speechTimeline } from '../../yy-douyin-video/src/contracts.mjs';
import { withArtifactDirectory } from '../../yy-douyin-video/src/artifacts.mjs';
import { withTemporaryDirectory } from '../../scripts/temp-directory.mjs';

const content = await fs.readFile(new URL('../fixtures/storyboard.json', import.meta.url), 'utf8');
const response = text => ({ schemaVersion: 1, status: 'completed', results: [{ content: text }] });
const media = { durationSeconds: 2, video: path.resolve('synthetic.mp4'), audio: null, candidateCuts: [] };

test('严格解析 JSON 或完整代码围栏，并检查时间覆盖', () => {
  for (const text of [content, `\`\`\`json\n${content}\n\`\`\``]) assert.equal(parseStoryboardResult(response(text), media).shots.length, 1);
  for (const text of [`前文 ${content}`, `${content} 后文`, '{}', 'null']) assert.throws(() => parseStoryboardResult(response(text), media));
  assert.throws(() => parseStoryboardResult(response(content), { ...media, durationSeconds: 3 }));
});

test('缺失、多结果、部分完成或未知版本拒绝进入下游', () => {
  for (const report of [{}, { results: [] }, { results: [{ content }, { content }] }, { ...response(content), status: 'partial' }, { ...response(content), schemaVersion: 999 }]) assert.throws(() => parseStoryboardResult(report, media));
  assert.throws(() => validateMedia({ ...media, durationSeconds: NaN }));
  assert.throws(() => speechTimeline({ ...media, audio: 'audio.wav' }, null));
});

test('素材处理失败留下明确状态，原目录不被覆盖', async () => {
  await withTemporaryDirectory(async directory => {
    const output = path.join(directory, 'task');
    await assert.rejects(withArtifactDirectory(output, async () => { throw new Error('模拟失败'); }), /模拟失败/);
    assert.equal(JSON.parse(await fs.readFile(path.join(output, 'task-state.json'), 'utf8')).status, 'failed');
    await assert.rejects(withArtifactDirectory(output, async () => {}));
  });
});
