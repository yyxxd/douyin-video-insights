import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

async function pythonExecutable() {
  if (process.env.QWEN_MEDIA_PYTHON) return process.env.QWEN_MEDIA_PYTHON;
  const config = process.env.QWEN_MEDIA_CONFIG_DIR || (process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'QwenMediaSkills'));
  if (config) {
    try { return JSON.parse(await fs.readFile(path.join(config, 'toolchain.json'), 'utf8')).python || 'python'; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return 'python';
}

export async function downloadVideo(options, output) {
  const script = fileURLToPath(new URL('../scripts/download_video.py', import.meta.url));
  const args = [script, '--share', options.share, '--out', output, '--purpose', 'analysis', '--resolution', options.resolution || '720'];
  for (const key of ['cookies', 'browser']) if (options[key]) args.push(`--${key}`, options[key]);
  const python = await pythonExecutable();
  const cancelFile = path.join(path.dirname(output), '.download-cancel');
  return new Promise((resolve, reject) => {
    const child = spawn(python, args, { windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8', QWEN_MEDIA_CANCEL_FILE: cancelFile } });
    const cancel = () => fs.writeFile(cancelFile, '').catch(error => process.stderr.write(`无法通知下载取消：${error.code}\n`));
    process.once('SIGINT', cancel);
    process.once('SIGTERM', cancel);
    const cleanup = () => {
      process.removeListener('SIGINT', cancel);
      process.removeListener('SIGTERM', cancel);
      return fs.rm(cancelFile, { force: true });
    };
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => process.stderr.write(chunk));
    child.on('error', () => { cleanup().catch(reject); reject(new Error('统一下载入口无法启动，请重新准备 Python 工具。')); });
    child.on('close', async code => {
      try {
        await cleanup();
        const result = JSON.parse(stdout);
        if (code !== 0) {
          const detail = (result.attempts || []).map(a => `${a.route}：${a.message || a.status}`).join('\n');
          const error = new Error(`${result.message}\n${detail}`.trim());
          error.code = result.code;
          error.result = result;
          reject(error);
        } else resolve(result.video);
      } catch { reject(new Error('下载入口未返回有效结果，请检查工具环境。')); }
    });
  });
}
