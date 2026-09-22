import { spawn } from 'node:child_process';
import { publicConfig, statePath } from './config.mjs';
import { RuntimeError } from './errors.mjs';

function commandExists(command) {
  return new Promise(resolve => {
    const child = spawn(command, ['-version'], { windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill(); resolve(false); }, 10000);
    child.on('error', () => { clearTimeout(timer); resolve(false); });
    child.on('close', code => { clearTimeout(timer); resolve(code === 0); });
  });
}

export async function checkEnvironment(config, checkCommand = commandExists) {
  const checks = {
    dashscopeApiKey: config.apiKeyPresent,
    region: Boolean(config.region),
    compatibleBaseUrl: Boolean(config.baseUrl),
    endpointMap: Boolean(config.endpoints) && Object.values(config.endpoints).every(Boolean),
    node: Number(process.versions.node.split('.')[0]) >= 22,
    ffmpeg: await checkCommand('ffmpeg'),
    ffprobe: await checkCommand('ffprobe'),
  };
  return { ready: Object.values(checks).every(Boolean), checks, config: publicConfig(config), stateFile: statePath(config) };
}

export async function requireEnvironment(config) {
  const report = await checkEnvironment(config);
  if (!report.ready) throw new RuntimeError(`运行环境未就绪：${Object.keys(report.checks).filter(key => !report.checks[key]).join('、')}。请由 Agent 检查工具和 AI 配置。`, 'NOT_INITIALIZED');
  return report;
}
