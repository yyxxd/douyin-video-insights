import { argumentsOf } from '../src/common.mjs';
import { buildPrompt } from '../src/build_prompt.mjs';
buildPrompt(argumentsOf(process.argv.slice(2), ['media', 'asr', 'out'])).then(result => { if (result) console.log(JSON.stringify(result, null, 2)); }).catch(error => { console.error(error.message); process.exitCode = 1; });
