import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

function userVariable(action, value = '') {
  if (process.platform !== 'win32') return '';
  const script = fileURLToPath(new URL('./ai-environment.ps1', import.meta.url));
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Action', action], { input: value, encoding: 'utf8', windowsHide: true, timeout: 10000 });
  if (result.status !== 0) throw new Error('无法访问当前用户的 AI 环境变量，请检查系统权限。');
  return result.stdout;
}

export function createAIEnvironment({ read = () => userVariable('read'), write = value => userVariable('write', value), env = process.env } = {}) {
  return {
    userValue: () => read(),
    value: () => read() || env.DASHSCOPE_API_KEY || '',
    status: () => ({ present: Boolean(read() || env.DASHSCOPE_API_KEY), userConfigured: Boolean(read()) }),
    save(key, confirmed = false) {
      const existing = read() || env.DASHSCOPE_API_KEY || '';
      if (existing && existing !== key && !confirmed) throw new Error('已有 AI 配置；替换可能影响其他工具，请先确认覆盖。');
      write(key);
      env.DASHSCOPE_API_KEY = key;
    },
    clear(confirmed = false) {
      if (!confirmed) throw new Error('清除环境变量可能影响其他工具，请先确认。');
      write('');
      delete env.DASHSCOPE_API_KEY;
    },
  };
}
export const aiEnvironment = createAIEnvironment();
