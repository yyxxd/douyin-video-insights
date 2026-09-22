import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { RuntimeError } from './errors.mjs';

export async function reserveOutput(file) {
  file = path.resolve(file);
  try { const handle = await fs.open(file, 'wx', 0o600); await handle.close(); }
  catch { throw new RuntimeError('输出文件已存在或目录不可写，请指定现有目录中的新文件。', 'OUTPUT_UNAVAILABLE'); }
  let saved = false;
  return {
    get saved() { return saved; },
    async save(report) {
      const temporary = `${file}.${randomUUID()}.tmp`;
      const handle = await fs.open(temporary, 'wx', 0o600);
      try { await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`); await handle.sync(); }
      finally { await handle.close(); }
      // 先写完整检查点再替换，写入失败时保留上一个成功结果。
      try { await fs.rename(temporary, file); }
      catch { throw new RuntimeError(`结果已写入 ${temporary}，但无法替换目标文件。`, 'OUTPUT_COMMIT_FAILED'); }
      saved = true;
    },
    async close() {
      if (!saved) await fs.unlink(file);
    },
  };
}
