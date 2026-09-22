import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from '../src/config.mjs';
import { RuntimeError, printError } from '../src/errors.mjs';
import { uploadTemporary } from '../src/temp_upload.mjs';
export * from '../src/temp_upload.mjs';

async function main() {
  const args = process.argv.slice(2); const value = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const file = value('--file'); const region = value('--region'); const model = value('--model'); const json = args.includes('--json');
  if (!file || !region || !model) throw new RuntimeError('用法：temp_upload.mjs --file <path> --region <region> --model <target-model>', 'USAGE');
  const config = resolveConfig({ ...process.env, QWEN_BAILIAN_REGION: region });
  const result = await uploadTemporary(file, config, model); console.log(json ? JSON.stringify({ ok: true, ...result }) : JSON.stringify(result, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { printError(error, process.argv.includes('--json')); process.exitCode = 1; });
}
