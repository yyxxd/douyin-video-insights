import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function safeTaskId(taskId) {
  if (typeof taskId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(taskId)) throw new Error('Task/Operation ID 格式无效。');
  return taskId;
}

export function resolveTaskId(cliTaskId, env = process.env) {
  const supplied = cliTaskId || env.QWEN_TASK_ID;
  return { taskId: safeTaskId(supplied || randomUUID()), supplied: Boolean(supplied) };
}

export function taskPaths(taskId, env = process.env) {
  const dir = path.join(env.TEMP || os.tmpdir(), 'QwenMediaSkills', 'tasks');
  const safe = safeTaskId(taskId);
  return { dir, file: path.join(dir, `${safe}.json`), archive: path.join(dir, `${safe}.finalized.json`), lock: path.join(dir, `${safe}.lock`) };
}

function recalculate(budget) {
  budget.pendingEstimatedCost = budget.operations
    .filter((operation) => ['planned', 'running'].includes(operation.status))
    .reduce((sum, operation) => sum + (Number.isFinite(operation.estimatedCost) ? operation.estimatedCost : 0), 0);
  budget.unverifiedEstimatedCost = budget.operations
    .filter(operation => ['completed', 'failed'].includes(operation.status) && operation.actualCost === null)
    .reduce((sum, operation) => sum + (operation.estimatedCost ?? 0), 0);
  budget.updatedAt = new Date().toISOString();
  return budget;
}

function emptyBudget(taskId, thresholdCny) {
  if (!Number.isFinite(thresholdCny) || thresholdCny < 0) throw new Error('费用阈值必须为非负有限数。');
  return { schemaVersion: 2, taskId, autoThresholdCny: thresholdCny, approvedCostCeiling: null, actualCost: 0, unverifiedEstimatedCost: 0, pendingEstimatedCost: 0, operations: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
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
  try {
    const budget = JSON.parse(await fs.readFile(paths.file, 'utf8'));
    if (!Array.isArray(budget.operations) || ![undefined, 2].includes(budget.schemaVersion)) throw new Error('TaskBudget 格式或版本无效。');
    if (budget.taskId !== taskId || !Number.isFinite(budget.autoThresholdCny) || budget.autoThresholdCny < 0 || !Number.isFinite(budget.actualCost) || budget.actualCost < 0) throw new Error('TaskBudget 金额或 Task ID 无效。');
    if (budget.approvedCostCeiling !== null && (!Number.isFinite(budget.approvedCostCeiling) || budget.approvedCostCeiling < 0)) throw new Error('TaskBudget 授权上限无效。');
    const ids = new Set();
    for (const operation of budget.operations) {
      safeTaskId(operation.operationId);
      if (ids.has(operation.operationId) || !['planned', 'running', ...TERMINAL].includes(operation.status)) throw new Error('TaskBudget Operation 状态或 ID 无效。');
      for (const amount of [operation.estimatedCost, operation.actualCost]) if (amount !== null && (!Number.isFinite(amount) || amount < 0)) throw new Error('TaskBudget Operation 金额无效。');
      ids.add(operation.operationId);
    }
    if (!budget.schemaVersion) {
      budget.schemaVersion = 2;
      budget.actualCost = budget.operations.reduce((sum, operation) => sum + (operation.actualCost ?? 0), 0);
    }
    return recalculate(budget);
  }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    try {
      await fs.access(paths.archive);
      throw new Error('该 Task ID 已归档，不能重新执行；请查看归档记录或使用新的 Task ID。');
    } catch (archived) { if (archived.code !== 'ENOENT') throw archived; }
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
      safeTaskId(operation.operationId);
      if (operation.estimatedCost !== null && (!Number.isFinite(operation.estimatedCost) || operation.estimatedCost < 0)) throw new Error('Operation 估算费用无效。');
      const previous = budget.operations.find(item => item.operationId === operation.operationId);
      if (previous) {
        if (previous.model !== operation.model || previous.skill !== operation.skill) throw new Error('同一个 Operation 不能更换模型或能力。');
        if (previous.status === 'planned') previous.estimatedCost = operation.estimatedCost === null ? null : Math.max(previous.estimatedCost ?? 0, operation.estimatedCost);
      } else {
        budget.operations.push({ operationId: operation.operationId, skill: operation.skill, model: operation.model, estimatedCost: operation.estimatedCost, status: 'planned', actualCost: null });
      }
    }
    recalculate(budget);
    return budget;
  }, env);
}

export async function authorizeCurrentCost(taskId, config, ceiling, env = process.env) {
  return updateTaskBudget(taskId, config, (budget) => {
    if (ceiling !== undefined && (!Number.isFinite(ceiling) || ceiling < 0)) throw new Error('授权上限必须为非负有限数。');
    const projected = projectedCost(budget);
    budget.approvedCostCeiling = Number.isFinite(ceiling) ? ceiling : projected;
    return budget;
  }, env);
}

export async function startOperation(taskId, operationId, config, env = process.env) {
  return updateTaskBudget(taskId, config, (budget) => {
    const operation = budget.operations.find((item) => item.operationId === operationId);
    if (!operation) throw new Error(`TaskBudget 中不存在 Operation：${operationId}`);
    const effectiveCeiling = budget.approvedCostCeiling ?? budget.autoThresholdCny;
    const projected = projectedCost(budget);
    const reliable = budgetReliable(budget);
    if (operation.status !== 'planned') return { allowed: false, reason: 'OPERATION_STATE', status: operation.status, projected, effectiveCeiling, reliable };
    if (!reliable || projected > effectiveCeiling) return { allowed: false, projected, effectiveCeiling, reliable };
    operation.status = 'running';
    operation.ownerPid = process.pid;
    operation.startedAt = new Date().toISOString();
    return { allowed: true, projected, effectiveCeiling, reliable };
  }, env);
}

async function finishOperation(taskId, operationId, status, actualCost, config, env) {
  return updateTaskBudget(taskId, config, (budget) => {
    const operation = budget.operations.find((item) => item.operationId === operationId);
    if (!operation) throw new Error(`TaskBudget 中不存在 Operation：${operationId}`);
    if (TERMINAL.has(operation.status)) return budget;
    if (status === 'cancelled' ? operation.status !== 'planned' : operation.status !== 'running') throw new Error('不允许此 Operation 状态迁移。');
    if (actualCost !== null && (!Number.isFinite(actualCost) || actualCost < 0)) throw new Error('实际费用无效。');
    operation.status = status;
    operation.actualCost = Number.isFinite(actualCost) ? actualCost : null;
    operation.billingStatus = Number.isFinite(actualCost) ? 'calculated' : status === 'cancelled' ? 'not-submitted' : 'unverified';
    if (status === 'completed' || status === 'failed') {
      if (Number.isFinite(actualCost)) budget.actualCost += actualCost;
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
    budget.finalizedAt = new Date().toISOString();
    await writeBudget(paths, budget);
    await fs.rename(paths.file, paths.archive);
    return { finalized: true, budget };
  } finally {
    await lock.close();
    await fs.rm(paths.lock, { force: true });
  }
}

export async function cancelOpenOperations(taskId, config, env = process.env) {
  return updateTaskBudget(taskId, config, (budget) => {
    for (const operation of budget.operations) if (operation.status === 'planned') operation.status = 'cancelled';
    return budget;
  }, env);
}

export const projectedCost = budget => budget.actualCost + budget.pendingEstimatedCost + (budget.unverifiedEstimatedCost || 0);
export const budgetReliable = budget => budget.operations.every(operation => operation.status === 'cancelled' || Number.isFinite(operation.actualCost) || Number.isFinite(operation.estimatedCost));

