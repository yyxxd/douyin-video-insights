import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, projectFiles } from './project-files.mjs';

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${command} 检查失败。`);
}

const files = await projectFiles();
const published = new Set(JSON.parse(await fs.readFile(path.join(root, 'release-files.json'), 'utf8')));
for (const file of files.filter(file => /\.(mjs|js|py|ps1|md|json|yml|yaml|lock|in|html|css|txt|png)$/.test(file))) {
  if (!published.has(file)) throw new Error(`新文件尚未登记发布清单：${file}`);
}
for (const file of files.filter(file => /\.(mjs|js)$/.test(file))) {
  run(process.execPath, ['--check', file]);
  const source = await fs.readFile(path.join(root, file), 'utf8');
  if (source.split('\n').length > 500) throw new Error(`${file} 超过 500 行，请按职责拆分。`);
  for (const match of source.matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g)) await fs.access(path.resolve(root, path.dirname(file), match[1]));
}
const pythonFiles = files.filter(file => file.endsWith('.py'));
run('python', ['-c', 'import ast,pathlib,sys; [ast.parse(pathlib.Path(f).read_text(encoding="utf-8"),filename=f) for f in sys.argv[1:]]', ...pythonFiles]);
if (process.platform === 'win32') run('powershell.exe', ['-NoProfile', '-File', path.join(root, 'scripts/check-powershell.ps1')]);
console.log(`CHECK_OK: JavaScript 导入与语法、Python 语法${process.platform === 'win32' ? '、PowerShell 语法' : ''}`);
