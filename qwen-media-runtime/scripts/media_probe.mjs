import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from '../src/config.mjs';
import { RuntimeError, printError } from '../src/errors.mjs';
import { probeMedia } from '../src/media_probe.mjs';
export * from '../src/media_probe.mjs';

async function main() {
  const args = process.argv.slice(2); const file = args.find((item) => !item.startsWith('--'));
  const kind = args.includes('--kind') ? args[args.indexOf('--kind') + 1] : undefined;
  const json = args.includes('--json');
  if (!file || !['omni', 'asr'].includes(kind)) throw new RuntimeError('用法：media_probe.mjs <file> --kind omni|asr [--json]', 'USAGE');
  const result = await probeMedia(file, kind); console.log(json ? JSON.stringify({ ok: true, ...result }) : JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { printError(error, process.argv.includes('--json')); process.exitCode = 1; });
}
