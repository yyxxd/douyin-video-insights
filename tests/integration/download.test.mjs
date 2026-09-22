import { spawnSync } from 'node:child_process';
for (const file of ['download_test.py', 'download_ytdlp_test.py']) {
  const result = spawnSync(process.env.QWEN_MEDIA_PYTHON || 'python', [`tests/integration/${file}`], { stdio: 'inherit', windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  if (result.error) throw result.error;
  if (result.status !== 0) { process.exitCode = result.status || 1; break; }
}
