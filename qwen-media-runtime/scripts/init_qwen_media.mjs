import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolveConfig, publicConfig, statePath } from './config.mjs';
import { RuntimeError, printError } from './errors.mjs';

function commandExists(command) {
  return new Promise((resolve) => {
    const child = spawn(command, ['-version'], { windowsHide: true });
    child.on('error', () => resolve(false)); child.on('close', (code) => resolve(code === 0));
  });
}

export async function checkEnvironment(config) {
  const checks = {
    dashscopeApiKey: config.apiKeyPresent,
    firstRunGuide: config.guideStatus === 'complete',
    region: Boolean(config.region),
    compatibleBaseUrl: Boolean(config.baseUrl),
    endpointMap: Object.values(config.endpoints).every(Boolean),
    node: Number(process.versions.node.split('.')[0]) >= 18,
    ffmpeg: await commandExists('ffmpeg'),
    ffprobe: await commandExists('ffprobe'),
    configDirectory: true,
  };
  const ready = Object.values(checks).every(Boolean);
  return { ready, checks, config: publicConfig(config), stateFile: statePath(config) };
}

async function main() {
  const json = process.argv.includes('--json');
  const config = resolveConfig();
  const report = await checkEnvironment(config);
  if (report.ready) {
    await fs.mkdir(config.configDir, { recursive: true });
    await fs.writeFile(statePath(config), `${JSON.stringify({ initialized: true, runtimeVersion: '1.0.0', region: config.region, checkedAt: new Date().toISOString() }, null, 2)}\n`, 'utf8');
  }
  const output = report.ready ? { ok: true, ...report } : { ok: false, ...report, next: '请由 Agent 执行首次配置引导：先运行 setup.ps1 -Action Check，说明缺失项并获得安装同意，再运行 setup.ps1 -Action Guide -Consent；等待 complete 后继续原任务。用户不需要手动安装或设置环境变量。' };
  console.log(json ? JSON.stringify(output) : JSON.stringify(output, null, 2));
  if (!report.ready) process.exitCode = 10;
}

main().catch((error) => { printError(error, process.argv.includes('--json')); process.exitCode = error.code === 'CONFIG_MISMATCH' ? 11 : 1; });
