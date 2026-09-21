import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export function netscapeCookies(text) {
  text = text.replace(/^\uFEFF/, '').trim();
  if (/^# (Netscape )?HTTP Cookie File/.test(text)) return `${text}\n`;
  let items;
  try { items = JSON.parse(text); } catch { throw new Error('Cookie 文件必须是 Netscape 格式或浏览器导出的 JSON 数组。'); }
  if (!Array.isArray(items)) throw new Error('Cookie JSON 必须是数组。');
  const rows = items.filter((c) => c && typeof c.domain === 'string' && /^(\.?douyin\.com|[\w.-]+\.douyin\.com)$/.test(c.domain)).map((c) => {
    if (typeof c.name !== 'string' || typeof c.value !== 'string') throw new Error('Cookie 名称或值无效。');
    const expires = c.session || c.expirationDate == null ? 0 : Math.floor(c.expirationDate);
    if (!Number.isFinite(expires) || expires < 0) throw new Error('Cookie 到期时间无效。');
    const subdomains = c.hostOnly === false || (c.hostOnly == null && c.domain.startsWith('.'));
    const domain = subdomains ? `.${c.domain.replace(/^\./, '')}` : c.domain.replace(/^\./, '');
    const fields = [domain, subdomains ? 'TRUE' : 'FALSE', c.path || '/', c.secure ? 'TRUE' : 'FALSE', String(expires), c.name, c.value];
    if (fields.some((field) => typeof field !== 'string' || /[\t\r\n\0]/.test(field))) throw new Error('Cookie 字段包含无效字符。');
    return fields.join('\t');
  });
  if (!rows.length) throw new Error('Cookie JSON 中没有抖音 Cookie。');
  return `# Netscape HTTP Cookie File\n${rows.join('\n')}\n`;
}

export async function withCookies(file, action) {
  if (!file) return action(null);
  const content = netscapeCookies(await fs.readFile(path.resolve(file), 'utf8'));
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'douyin-cookies-'));
  try {
    const temporary = path.join(directory, 'cookies.txt');
    await fs.writeFile(temporary, content, { mode: 0o600, flag: 'wx' });
    return await action(temporary);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
