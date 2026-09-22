import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { argumentsOf } from '../src/common.mjs';
import { prepare } from '../src/prepare_video.mjs';
export * from '../src/prepare_video.mjs';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepare(argumentsOf(process.argv.slice(2), ['file', 'share', 'out', 'browser', 'cookies', 'resolution'])).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
