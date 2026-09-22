import fs from 'node:fs/promises';
import { resolveConfig, statePath } from '../src/config.mjs';
import { printError } from '../src/errors.mjs';

import { checkEnvironment } from '../src/environment.mjs';
export { checkEnvironment } from '../src/environment.mjs';

async function main() {
  const json = process.argv.includes('--json');
  const config = resolveConfig();
  const report = await checkEnvironment(config);
  if (report.ready) {
    await fs.mkdir(config.configDir, { recursive: true });
    await fs.writeFile(statePath(config), `${JSON.stringify({ initialized: true, runtimeVersion: '1.0.0', region: config.region, checkedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
  }
  const output = report.ready ? { ok: true, ...report } : { ok: false, ...report, next: '请由 Agent 检查缺失的运行工具和 AI 配置。本地模型任务不要求抖音登录；统一首次引导仍可用于安装配置。' };
  console.log(json ? JSON.stringify(output) : JSON.stringify(output, null, 2));
  if (!report.ready) process.exitCode = 10;
}

main().catch((error) => { printError(error, process.argv.includes('--json')); process.exitCode = error.code === 'CONFIG_MISMATCH' ? 11 : 1; });
