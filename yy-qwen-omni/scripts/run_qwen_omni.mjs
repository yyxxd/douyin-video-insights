import { parseModelArgs, printReport } from '../../qwen-media-runtime/src/cli.mjs';
import { printError } from '../../qwen-media-runtime/src/errors.mjs';
import { analyze } from '../src/analyze.mjs';

async function main() {
  const options = parseModelArgs(process.argv.slice(2), 'omni');
  printReport(await analyze(options), options);
}

main().catch(error => { printError(error, process.argv.includes('--json')); process.exitCode = 1; });
