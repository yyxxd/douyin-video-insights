import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { root } from './project-files.mjs';
import { withTemporaryDirectory } from './temp-directory.mjs';

export const sha256 = data => createHash('sha256').update(data).digest('hex');
const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));

export function archive(mode, file, directory) {
  if (process.platform !== 'win32') throw new Error('当前 ZIP 发布工具仅验收 Windows。');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts/archive.ps1'), '-Mode', mode, '-Archive', file, '-Directory', directory], { encoding: 'utf8', windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || 'ZIP 操作失败。');
}

function sourceRevision() {
  const git = args => spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  const head = git(['rev-parse', 'HEAD']);
  const status = git(['status', '--porcelain']);
  return { gitSha: head.status === 0 ? head.stdout.trim() : null, dirty: status.status === 0 ? Boolean(status.stdout.trim()) : null };
}

async function stage(directory, files) {
  const hashes = {};
  for (const file of files) {
    if (!file || path.isAbsolute(file) || file.includes('\\') || file.split('/').some(part => ['..', '.', 'work', 'node_modules', '.venv', '__pycache__'].includes(part))) throw new Error(`发布路径无效：${file}`);
    const source = await fs.realpath(path.join(root, file));
    const relative = path.relative(root, source);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('发布来源超出仓库。');
    const data = await fs.readFile(source);
    hashes[file] = sha256(data);
    const target = path.join(directory, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data, { flag: 'wx' });
  }
  return hashes;
}

export async function buildPackage(output) {
  const project = await readJson(path.join(root, 'package.json'));
  const files = await readJson(path.join(root, 'release-files.json'));
  if (!Array.isArray(files) || files.length !== new Set(files).size) throw new Error('发布清单无效或包含重复项。');
  const target = path.resolve(output || path.join(root, 'work/releases', `${project.name}-${project.version}.zip`));
  await fs.mkdir(path.dirname(target), { recursive: true });
  for (const file of [target, `${target}.sha256`]) {
    try { await fs.access(file); throw new Error(`文件已存在，请使用新的发布路径：${file}`); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  await withTemporaryDirectory(async directory => {
    const hashes = await stage(directory, files);
    const manifest = { schemaVersion: 1, name: project.name, version: project.version, builtAt: new Date().toISOString(), source: sourceRevision(), platform: 'windows-x64', node: project.engines.node, files: hashes };
    await fs.writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2));
    archive('Create', target, directory);
  });
  await fs.writeFile(`${target}.sha256`, `${sha256(await fs.readFile(target))}  ${path.basename(target)}\n`, { flag: 'wx' });
  return target;
}

export async function verifyPackage(directory) {
  const manifest = await readJson(path.join(directory, 'manifest.json'));
  const expected = await readJson(path.join(directory, 'release-files.json'));
  if (manifest.schemaVersion !== 1 || !manifest.files || JSON.stringify(Object.keys(manifest.files).sort()) !== JSON.stringify([...expected].sort())) throw new Error('发布清单与文件集合不一致。');
  const actual = (await fs.readdir(directory, { recursive: true, withFileTypes: true })).filter(entry => entry.isFile()).map(entry => path.relative(directory, path.join(entry.parentPath || entry.path, entry.name)).replaceAll('\\', '/')).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected, 'manifest.json'].sort())) throw new Error('发布包有额外文件或缺失文件。');
  for (const [file, hash] of Object.entries(manifest.files)) {
    if (sha256(await fs.readFile(path.join(directory, file))) !== hash) throw new Error(`发布文件校验失败：${file}`);
  }
  return manifest;
}
