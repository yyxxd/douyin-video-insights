import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';

export function run(command, args, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${command} 执行超时。`)); }, timeout);
    child.stdout.on('data', (data) => { stdout += data; });
    child.stderr.on('data', (data) => { stderr = (stderr + data).slice(-2000000); });
    child.on('error', (error) => { clearTimeout(timer); reject(new Error(`${command} 无法启动：${error.code}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) { const error = new Error(`${command} 执行失败（${code}）。`); error.diagnostic = stderr; reject(error); }
      else resolve({ stdout, stderr });
    });
  });
}

export function argumentsOf(args, names) {
  const result = {};
  for (let i = 0; i < args.length; i += 1) {
    const key = args[i].replace(/^--/, '');
    if (!args[i].startsWith('--') || !names.includes(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`无效参数：${args[i]}`);
    if (key in result) throw new Error(`重复参数：${key}`);
    result[key] = args[++i];
  }
  return result;
}

export const readJson = async (file) => JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
export const writeJson = (file, data) => fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
export function inside(root, file) {
  const relative = path.relative(path.resolve(root), path.resolve(file));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('输出路径超出任务目录。');
  return file;
}
