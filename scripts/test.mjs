import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { withTemporaryDirectory } from './temp-directory.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const suites = [
  ['--test', ...fs.readdirSync(new URL('../tests/unit/', import.meta.url)).filter(name => name.endsWith('.test.mjs')).map(name => `tests/unit/${name}`)],
  ['tests/integration/task_plan.test.mjs'],
  ['tests/integration/temp_upload.test.mjs'],
  ['tests/integration/cookies.test.mjs'],
  ['tests/integration/workflow.test.mjs'],
];
if (process.platform === 'win32') suites.push(['tests/integration/setup.test.mjs']);
else console.log('SKIP: Windows DPAPI 配置集成测试（请在 Windows CI 验证）。');

await withTemporaryDirectory(async directory => {
  const env = { ...process.env, TEMP: directory, TMP: directory, QWEN_MEDIA_CONFIG_DIR: directory, QWEN_TEST_OUTPUT_DIR: directory, DASHSCOPE_API_KEY: 'offline-test-only' };
  for (const args of process.argv.includes('--unit') ? suites.slice(0, 1) : suites) {
    const result = spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit', windowsHide: true });
    if (result.error) throw result.error;
    if (result.status !== 0) { process.exitCode = result.status || 1; break; }
  }
});
