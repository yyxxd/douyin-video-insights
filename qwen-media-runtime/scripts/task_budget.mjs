import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function safeTaskId(taskId) {
  if (!/^[A-Za-z0-9_-]+$/.test(taskId)) throw new Error('Task ID 格式无效。');
  return taskId;
}

export function resolveTaskId(cliTaskId, env = process.env) {
  const supplied = cliTaskId || env.QWEN_TASK_ID;
  return { taskId: safeTaskId(supplied || randomUUID()), supplied: Boolean(supplied) };
}

export function taskPaths(taskId, env = process.env) {
  const dir = path.join(env.TEMP || os.tmpdir(), 'QwenMediaSkills', 'tasks');
  const safe = safeTaskId(taskId);
  return { dir, file: path.join(dir, `${safe}.json`), lock: path.join(dir, `${safe}.lock`) };
}

function recalculate(budget) {
  budget.pendingEstimatedCost = budget.operations
    .filter((operation) => ['planned', 'running'].includes(operation.status))
    .reduce((sum, operation) => sum + (Number.isFinite(operation.estimatedCost) ? operation.estimatedCost : 0), 0);
  budget.updatedAt = new Date().toISOString();
  return budget;
}

function emptyBudget(taskId, thresholdCny) {
  return { taskId, autoThresholdCny: thresholdCny, approvedCostCeiling: null, actualCost: 0, pendingEstimatedCost: 0, operations: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}

async function acquireLock(paths) {
  await fs.mkdir(paths.dir, { recursive: true });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const handle = await fs.open(paths.lock, 'wx');
      await handle.writeFile(`${process.pid}\n`, 'utf8');
      return handle;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await sleep(40);
    }
  }
  throw new Error('TaskBudget 锁等待超时，拒绝覆盖其他 Skill 的任务状态。');
}

async function withLock(taskId, env, callback) {
  const paths = taskPaths(taskId, env);
  const lock = await acquireLock(paths);
  try { return await callback(paths); } finally {
    await lock.close();
    await fs.rm(paths.lock, { force: true });
  }
}

async function readBudget(paths, taskId, config) {
  try { return JSON.parse(await fs.readFile(paths.file, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return emptyBudget(taskId, config.thresholdCny);
  }
}

async function writeBudget(paths, budget) {
  const temp = `${paths.file}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(recalculate(budget), null, 2)}\n`, 'utf8');
  await fs.rename(temp, paths.file);
}

export async function loadTaskBudget(taskId, config, env = process.env) {
  return withLock(taskId, env, async (paths) => readBudget(paths, taskId, config));
}

export async function updateTaskBudget(taskId, config, mutate, env = process.env) {
  return withLock(taskId, env, async (paths) => {
    const budget = await readBudget(paths, taskId, config);
    const result = await mutate(budget);
    await writeBudget(paths, budget);
    return result ?? budget;
  });
}

export async function registerOperations(taskId, operations, config, env = process.env) {
  return updateTaskBudget(taskId, config, (budget) => {
    for (const operation of operations) {
      if (!budget.operations.some((item) => item.operationId === operation.operationId)) budget.operations.push({ status: 'planned', actualCost: null, ...operation });
    }
    recalculate(budget);
    return budget;
  }, env);
}

export async function authorizeCurrentCost(taskId, config, ceiling, env = process.env) {
  return updateTaskBudget(taskId, config, (budget) => {
    const projected = budget.actualCost + budget.pendingEstimatedCost;
    budget.approvedCostCeiling = Number.isFinite(ceiling) ? ceiling : projected;
    return budget;
  }, env);
}

export async function startOperation(taskId, operationId, config, env = process.env) {
  return updateTaskBudget(taskId, config, (budget) => {
    const operation = budget.operations.find((item) => item.operationId === operationId);
    if (!operation) throw new Error(`TaskBudget 中不存在 Operation：${operationId}`);
    const effectiveCeiling = budget.approvedCostCeiling ?? budget.autoThresholdCny;
    const projected = budget.actualCost + budget.pendingEstimatedCost;
    const reliable = Number.isFinite(operation.estimatedCost);
    if (!reliable || projected > effectiveCeiling) return { allowed: false, projected, effectiveCeiling, reliable };
    operation.status = 'running';
    return { allowed: true, projected, effectiveCeiling, reliable };
  }, env);
}

async function finishOperation(taskId, operationId, status, actualCost, config, env) {
  return updateTaskBudget(taskId, config, (budget) => {
    const operation = budget.operations.find((item) => item.operationId === operationId);
    if (!operation) throw new Error(`TaskBudget 中不存在 Operation：${operationId}`);
    if (TERMINAL.has(operation.status)) return budget;
    operation.status = status;
    operation.actualCost = Number.isFinite(actualCost) ? actualCost : null;
    if (status === 'completed' || status === 'failed') {
      const charged = Number.isFinite(actualCost) ? actualCost : (Number.isFinite(operation.estimatedCost) ? operation.estimatedCost : null);
      if (Number.isFinite(charged)) budget.actualCost += charged;
    }
    return budget;
  }, env);
}

export const completeOperation = (taskId, operationId, actualCost, config, env) => finishOperation(taskId, operationId, 'completed', actualCost, config, env);
export const failOperation = (taskId, operationId, actualCost, config, env) => finishOperation(taskId, operationId, 'failed', actualCost, config, env);
export const cancelOperation = (taskId, operationId, config, env) => finishOperation(taskId, operationId, 'cancelled', null, config, env);

export async function finalizeTask(taskId, env = process.env) {
  const paths = taskPaths(taskId, env);
  const lock = await acquireLock(paths);
  try {
    let budget;
    try { budget = JSON.parse(await fs.readFile(paths.file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return { finalized: true, missing: true }; throw error; }
    recalculate(budget);
    if (budget.operations.some((operation) => !TERMINAL.has(operation.status))) return { finalized: false, budget };
    await fs.rm(paths.file, { force: true });
    return { finalized: true, budget };
  } finally {
    await lock.close();
    await fs.rm(paths.lock, { force: true });
  }
}

export async function cancelOpenOperations(taskId, config, env = process.env) {
  return updateTaskBudget(taskId, config, (budget) => {
    for (const operation of budget.operations) if (!TERMINAL.has(operation.status)) operation.status = 'cancelled';
    return budget;
  }, env);
}

async function main() {
  const args = process.argv.slice(2); const value = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
  const taskId = value('--task-id'); const thresholdCny = Number(value('--threshold') || process.env.QWEN_COST_CONFIRM_THRESHOLD_CNY || 0.5);
  const operationArgs = []; for (let index = 0; index < args.length; index += 1) if (args[index] === '--operation') operationArgs.push(args[++index]);
  if (!taskId || !operationArgs.length || !Number.isFinite(thresholdCny)) throw new Error('用法：task_budget.mjs --task-id <id> --operation <skill|model|estimated-cost> [...]');
  const config = { thresholdCny }; const operations = operationArgs.map((item) => { const [skill, model, estimatedCost] = item.split('|'); const cost = Number(estimatedCost); if (!skill || !model || !Number.isFinite(cost)) throw new Error('Operation 格式必须为 skill|model|estimated-cost。'); return { operationId: `planned-${randomUUID()}`, skill, model, estimatedCost: cost }; });
  const budget = await registerOperations(taskId, operations, config); console.log(JSON.stringify({ taskId, operations: budget.operations, pendingEstimatedCost: budget.pendingEstimatedCost }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(`失败：${error.message}`); process.exitCode = 1; });
