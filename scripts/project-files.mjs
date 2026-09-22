import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
const directories = ['qwen-media-runtime', 'yy-douyin-video', 'yy-qwen-asr', 'yy-qwen-omni', 'scripts', 'tests', 'docs', 'assets', '.github'];
const ignored = new Set(['node_modules', '__pycache__', '.venv']);

async function walk(directory) {
  const result = [];
  for (const entry of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.isSymbolicLink()) continue;
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) result.push(...await walk(relative));
    else result.push(relative);
  }
  return result;
}

export async function projectFiles() {
  const files = [];
  for (const directory of directories) {
    try { files.push(...await walk(directory)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return files.sort();
}
