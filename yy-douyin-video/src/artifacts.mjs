import fs from 'node:fs/promises';
import path from 'node:path';

export async function withArtifactDirectory(directory, action) {
  const output = path.resolve(directory);
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.mkdir(output);
  const file = path.join(output, 'task-state.json');
  const save = async status => {
    await fs.writeFile(`${file}.tmp`, JSON.stringify({ schemaVersion: 1, ...status, updatedAt: new Date().toISOString() }));
    await fs.rename(`${file}.tmp`, file);
  };
  await save({ status: 'running' });
  try {
    const result = await action(output);
    await save({ status: 'completed' });
    return result;
  } catch (error) {
    await save({ status: 'failed', code: error.code || 'PROCESS_FAILED' });
    throw error;
  }
}
