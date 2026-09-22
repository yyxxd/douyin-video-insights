import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const settingsDirectory = (env = process.env) => env.QWEN_MEDIA_CONFIG_DIR || path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'QwenMediaSkills');
export function readSettings(env = process.env) {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(settingsDirectory(env), 'setup.json'), 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![undefined, 1].includes(value.schemaVersion)) throw new Error('设置版本无效');
    return value;
  }
  catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('本机设置无法读取，请重新打开配置引导。'); }
}
export function writeSettings(update, env = process.env) {
  const dir = settingsDirectory(env);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'setup.json');
  let lock;
  try { lock = fs.openSync(`${file}.lock`, 'wx'); }
  catch { throw new Error('本机设置正在写入或有中断遗留锁，请稍后重试或按开发文档恢复。'); }
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(lock, String(process.pid));
    const value = { ...readSettings(env), ...update, schemaVersion: 1, updatedAt: new Date().toISOString() };
    fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { flag: 'wx' });
    fs.renameSync(temporary, file);
    return value;
  } finally {
    fs.closeSync(lock);
    fs.rmSync(`${file}.lock`, { force: true });
    fs.rmSync(temporary, { force: true });
  }
}
export function crypt(action, input) {
  if (process.platform !== 'win32') throw new Error('本机凭据存储目前仅支持 Windows。');
  const script = fileURLToPath(new URL('../scripts/vault.ps1', import.meta.url));
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', action], { input, encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 });
  if (result.status !== 0) throw new Error('本机加密存储不可用，请重新配置。');
  return result.stdout;
}
export function saveSecret(name, secret, env = process.env) {
  if (name !== 'douyin-session') throw new Error('未知凭据类型。');
  const dir = settingsDirectory(env);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.protected`);
  fs.writeFileSync(`${file}.tmp`, crypt('protect', secret));
  fs.renameSync(`${file}.tmp`, file);
}
export function readSecret(name, env = process.env) {
  if (name !== 'douyin-session') throw new Error('未知凭据类型。');
  const file = path.join(settingsDirectory(env), `${name}.protected`);
  if (!fs.existsSync(file)) return '';
  return crypt('unprotect', fs.readFileSync(file, 'utf8'));
}
export function recordCapability(kind, model, env = process.env) {
  if (!readSettings(env).guideStarted) return;
  if (!['asr', 'omni'].includes(kind)) throw new Error('未知能力。');
  const file = path.join(settingsDirectory(env), `${kind}-validation.json`);
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ model, verifiedAt: new Date().toISOString() }));
  fs.renameSync(temp, file);
}
