import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildPackage, archive, verifyPackage, sha256 } from './release.mjs';
import { withTemporaryDirectory } from './temp-directory.mjs';

await withTemporaryDirectory(async directory => {
  const file = process.argv[2] ? path.resolve(process.argv[2]) : await buildPackage(path.join(directory, 'package.zip'));
  const expectedHash = (await fs.readFile(`${file}.sha256`, 'utf8')).split(/\s/)[0];
  if (sha256(await fs.readFile(file)) !== expectedHash) throw new Error('ZIP SHA256 校验失败。');
  const extracted = path.join(directory, 'extracted');
  archive('Extract', file, extracted);
  const manifest = await verifyPackage(extracted);
  for (const script of ['scripts/check.mjs', 'scripts/test.mjs']) {
    const result = spawnSync(process.execPath, [script], { cwd: extracted, encoding: 'utf8', windowsHide: true });
    if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stdout + result.stderr);
  }
  console.log(`PACKAGE_OK: ${manifest.version}，${Object.keys(manifest.files).length} 个清单文件，SHA256、解压后语法检查与离线回归通过。`);
});
