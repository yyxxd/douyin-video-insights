export const fields = { composition: '画面与构图', action: '起始状态 → 动作 → 结束状态', camera: '景别、机位与运镜', transition: '剪辑与转场', screenText: '画面文字', sound: '音乐与音效', purpose: '叙事作用（分析）', uncertainty: '待确认信息' };

export function validateStoryboard(data, media, segments) {
  if (!Array.isArray(data.shots) || !data.shots.length || typeof data.summary !== 'string') throw new Error('缺少 summary 或 shots。');
  let previous = 0;
  for (const [index, shot] of data.shots.entries()) {
    if (!Number.isFinite(shot.start) || !Number.isFinite(shot.end) || shot.start < 0 || shot.end <= shot.start || shot.end > media.durationSeconds + 0.05) throw new Error(`镜头 ${index + 1} 时间无效。`);
    if (Math.abs(shot.start - previous) > 0.05) throw new Error(`镜头 ${index + 1} 存在时间空隙或重叠。`);
    for (const field of Object.keys(fields)) if (typeof shot[field] !== 'string' || !shot[field].trim()) throw new Error(`镜头 ${index + 1} 缺少 ${field}。`);
    if (!Array.isArray(shot.frames) || shot.frames.length < 1 || shot.frames.length > 3 || shot.frames.some((time) => !Number.isFinite(time) || time < shot.start || time >= shot.end)) throw new Error(`镜头 ${index + 1} 截图时间越界或数量无效。`);
    previous = shot.end;
  }
  if (Math.abs(previous - media.durationSeconds) > 0.05) throw new Error('镜头未覆盖视频结尾。');
  const ids = new Set();
  for (const segment of segments) {
    if (!segment.id || ids.has(segment.id) || typeof segment.text !== 'string' || !Number.isFinite(segment.start) || !Number.isFinite(segment.end) || segment.start < 0 || segment.end <= segment.start || segment.end > media.durationSeconds + 0.2) throw new Error('ASR 时间线无效或 ID 重复。');
    ids.add(segment.id);
  }
  return data.shots.map((shot, index) => ({ ...shot, id: index + 1, speech: segments.filter((segment) => segment.start < shot.end && segment.end > shot.start).map((segment) => ({ ...segment, continues: segment.start < shot.start || segment.end > shot.end })) }));
}

export const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
export const clock = (seconds) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toFixed(3).padStart(6, '0')}`;
