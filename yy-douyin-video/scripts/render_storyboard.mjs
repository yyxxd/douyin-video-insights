import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { argumentsOf } from '../src/common.mjs';
import { render } from '../src/render_storyboard.mjs';
export * from '../src/render_storyboard.mjs';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  render(argumentsOf(process.argv.slice(2), ['media', 'shots', 'asr', 'out'])).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
