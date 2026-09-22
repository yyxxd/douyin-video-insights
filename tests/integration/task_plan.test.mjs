import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { taskPaths, loadTaskBudget, registerOperations, startOperation, completeOperation, authorizeCurrentCost, cancelOpenOperations, finalizeTask } from '../../qwen-media-runtime/scripts/task_budget.mjs';

const config = { thresholdCny: 0.5 };
const id = () => `test-${randomUUID()}`;

async function cleanup(taskId) { await cancelOpenOperations(taskId, config); await finalizeTask(taskId); }

async function main() {
  const taskA = id();
  await registerOperations(taskA, [{ operationId: 'a', skill: 'Qwen ASR', model: 'qwen3-asr-flash', estimatedCost: 0.1 }, { operationId: 'b', skill: 'Qwen Omni', model: 'qwen3.8-omni-flash', estimatedCost: 0.2 }], config);
  let budget = await loadTaskBudget(taskA, config); assert.equal(Number(budget.pendingEstimatedCost.toFixed(2)), 0.3);
  assert.equal((await startOperation(taskA, 'a', config)).allowed, true); await completeOperation(taskA, 'a', 0.08, config);
  await fs.access(taskPaths(taskA).file);
  budget = await loadTaskBudget(taskA, config); assert.equal(Number(budget.actualCost.toFixed(2)), 0.08); assert.equal(Number(budget.pendingEstimatedCost.toFixed(2)), 0.2); assert.equal(Number((budget.actualCost + budget.pendingEstimatedCost).toFixed(2)), 0.28);
  await registerOperations(taskA, [{ operationId: 'c', skill: 'Qwen Omni', model: 'qwen3.8-omni-flash', estimatedCost: 0.4 }], config); assert.equal((await startOperation(taskA, 'c', config)).allowed, false);
  await authorizeCurrentCost(taskA, config, 0.68); assert.equal((await startOperation(taskA, 'c', config)).allowed, true); await completeOperation(taskA, 'c', 0.4, config);
  await registerOperations(taskA, [{ operationId: 'd', skill: 'Qwen ASR', model: 'qwen3-asr-flash', estimatedCost: 0.14 }], config); assert.equal((await startOperation(taskA, 'd', config)).allowed, false); await cleanup(taskA);

  const taskB = id();
  await registerOperations(taskB, [{ operationId: 'asr', skill: 'Qwen ASR', model: 'qwen3-asr-flash', estimatedCost: 0.15 }, { operationId: 'omni', skill: 'Qwen Omni', model: 'qwen3.8-omni-flash', estimatedCost: 0.42 }], config);
  assert.equal((await startOperation(taskB, 'asr', config)).allowed, false); await cleanup(taskB);

  const taskC = id();
  await registerOperations(taskC, [{ operationId: 'left', skill: 'Qwen ASR', model: 'qwen3-asr-flash', estimatedCost: 0.1 }, { operationId: 'right', skill: 'Qwen Omni', model: 'qwen3.8-omni-flash', estimatedCost: 0.1 }], config);
  await Promise.all([startOperation(taskC, 'left', config), startOperation(taskC, 'right', config)]);
  await Promise.all([completeOperation(taskC, 'left', 0.08, config), completeOperation(taskC, 'right', 0.09, config)]);
  budget = await loadTaskBudget(taskC, config); assert.equal(Number(budget.actualCost.toFixed(2)), 0.17); assert.equal(budget.pendingEstimatedCost, 0); assert.equal(budget.operations.every((item) => item.status === 'completed'), true);
  const finalized = await finalizeTask(taskC); assert.equal(finalized.finalized, true); await assert.rejects(fs.access(taskPaths(taskC).file));
  console.log('TASK_BUDGET_CASES_OK');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
