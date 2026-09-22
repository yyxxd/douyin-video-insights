import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function withTemporaryDirectory(action) {
  const base = path.resolve(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(base, 'qwen-test-'));
  try { return await action(directory); }
  finally {
    const relative = path.relative(base, path.resolve(directory));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('拒绝清理临时目录外的路径。');
    await fs.rm(directory, { recursive: true, force: true });
  }
}
