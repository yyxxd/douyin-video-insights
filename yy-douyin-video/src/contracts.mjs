import path from 'node:path';

export function validateVersion(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![undefined, 1].includes(value.schemaVersion)) throw new Error('数据对象或 schemaVersion 无效。');
  if (value.status !== undefined && value.status !== 'completed') throw new Error('不能将未完成的处理结果用于后续步骤。');
  return value;
}

export function validateMedia(value) {
  validateVersion(value);
  if (typeof value.video !== 'string' || !path.isAbsolute(value.video) || !Number.isFinite(value.durationSeconds) || value.durationSeconds <= 0) throw new Error('媒体清单需要视频绝对路径和有效时长。');
  if (value.audio !== null && value.audio !== undefined && (typeof value.audio !== 'string' || !path.isAbsolute(value.audio))) throw new Error('音轨路径无效。');
  if (!Array.isArray(value.candidateCuts) || value.candidateCuts.some(time => !Number.isFinite(time) || time < 0 || time > value.durationSeconds)) throw new Error('候选切点无效。');
  return value;
}

export function speechTimeline(media, asr) {
  if (!asr) {
    if (media.audio) throw new Error('有音轨的视频必须提供单文件结构化 ASR 结果。');
    return [];
  }
  validateVersion(asr);
  if (!Array.isArray(asr.results) || asr.results.length !== 1 || !Array.isArray(asr.results[0]?.segments)) throw new Error('ASR 结果必须包含一个带 segments 的结果。');
  const result = asr.results[0];
  if (!result.segments.length && result.text?.trim()) throw new Error('转写有文字但缺少时间戳。');
  return result.segments;
}
