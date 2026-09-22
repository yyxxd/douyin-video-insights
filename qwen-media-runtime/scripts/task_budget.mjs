import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { registerOperations } from '../src/task_budget.mjs';
export * from '../src/task_budget.mjs';

async function main() {
  const args = process.argv.slice(2); const value = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const taskId = value('--task-id'); const thresholdCny = Number(value('--threshold') || process.env.QWEN_COST_CONFIRM_THRESHOLD_CNY || 0.5);
  const operationArgs = []; for (let index = 0; index < args.length; index += 1) if (args[index] === '--operation') operationArgs.push(args[++index]);
  if (!taskId || !operationArgs.length || !Number.isFinite(thresholdCny)) throw new Error('用法：task_budget.mjs --task-id <id> --operation <skill|model|estimated-cost> [...]');
  const config = { thresholdCny }; const operations = operationArgs.map((item) => { const [skill, model, estimatedCost] = item.split('|'); const cost = Number(estimatedCost); if (!skill || !model || !Number.isFinite(cost)) throw new Error('Operation 格式必须为 skill|model|estimated-cost。'); return { operationId: `planned-${randomUUID()}`, skill, model, estimatedCost: cost }; });
  const budget = await registerOperations(taskId, operations, config); console.log(JSON.stringify({ taskId, operations: budget.operations, pendingEstimatedCost: budget.pendingEstimatedCost }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(`失败：${error.message}`); process.exitCode = 1; });
