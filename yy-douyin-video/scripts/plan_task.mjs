import { argumentsOf } from '../src/common.mjs';
import { planTask } from '../src/plan_task.mjs';
planTask(argumentsOf(process.argv.slice(2), ['media', 'mode', 'out'])).then(result => { if (result) console.log(JSON.stringify(result, null, 2)); }).catch(error => { console.error(error.message); process.exitCode = 1; });
