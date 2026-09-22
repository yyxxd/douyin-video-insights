import { validateStoryboard } from './storyboard.mjs';
import { validateVersion } from './contracts.mjs';

export function parseStoryboardResult(response, media, segments = []) {
  validateVersion(response);
  if (!Array.isArray(response.results) || response.results.length !== 1 || typeof response.results[0]?.content !== 'string') throw new Error('需要单文件 Omni 文本结果。');
  const content = response.results[0].content.trim();
  const fenced = content.match(/^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/i);
  let data;
  try { data = JSON.parse(fenced ? fenced[1] : content); }
  catch { throw new Error('Omni 结果不是完整 JSON 或完整 JSON 代码围栏，不能自动改写镜头。'); }
  validateVersion(data);
  validateStoryboard(data, media, segments);
  return { ...data, schemaVersion: 1 };
}
