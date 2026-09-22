import { RuntimeError } from './errors.mjs';

export function asrSegments(response) {
  const sentences = response.transcripts?.flatMap((item) => item.sentences || []) || response.output?.sentences || [];
  return sentences.map((item, index) => {
    const start = (item.begin_time ?? item.beginTime) / 1000;
    const end = (item.end_time ?? item.endTime) / 1000;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || typeof item.text !== 'string') {
      throw new RuntimeError('ASR 返回无效的句子时间戳。', 'ASR_TIMESTAMPS_INVALID');
    }
    return { id: `speech-${index + 1}`, start, end, text: item.text, speaker: item.speaker_id ?? null };
  }).sort((a, b) => a.start - b.start);
}

export function requireTimestamps(segments, text) {
  if (!segments.length && text?.trim()) throw new RuntimeError('ASR 未返回所需时间戳，不能编造台词时间线。', 'ASR_TIMESTAMPS_MISSING');
}
