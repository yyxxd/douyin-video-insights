import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { resolveConfig } from './config.mjs';
import { requireEnvironment } from './environment.mjs';
import { buildTaskPlan } from './cost_guard.mjs';
import { reserveOutput } from './result_output.mjs';
import { recordCapability } from './local_settings.mjs';
import { RuntimeError } from './errors.mjs';
import { taskPaths, resolveTaskId, registerOperations, loadTaskBudget, authorizeCurrentCost, projectedCost, budgetReliable, startOperation, completeOperation, failOperation, cancelOpenOperations, finalizeTask, updateTaskBudget } from './task_budget.mjs';

async function authorize(task, plan, options, config) {
  const budget = await loadTaskBudget(task.taskId, config);
  const projected = projectedCost(budget);
  const ceiling = budget.approvedCostCeiling ?? budget.autoThresholdCny;
  const reliable = plan.reliable && budgetReliable(budget);
  if (!reliable || (!options.confirm && projected > ceiling)) {
    return { requiresConfirmation: true, taskId: task.taskId, estimatedTotalCost: plan.estimatedTotalCost, projectedTotalCost: reliable ? projected : null, reason: reliable ? '任务预计费用超过当前授权上限。' : '整个任务存在未知价格，请配置价格并重新规划；金额授权不能替代价格配置。' };
  }
  if (options.confirm) await authorizeCurrentCost(task.taskId, config, options.approvedCostCeiling ?? projected);
  return null;
}

async function executeOperation(taskId, operation, probe, adapter, options, config) {
  const reservation = await startOperation(taskId, operation.operationId, config);
  if (!reservation.allowed) throw new RuntimeError(reservation.reason === 'OPERATION_STATE' ? `Operation 已处于 ${reservation.status}，不能重复调用。` : '预计费用超过授权范围，需要重新确认。', reservation.reason || 'COST_CONFIRMATION_REQUIRED');
  let submitted = false;
  const record = async update => updateTaskBudget(taskId, config, budget => {
    Object.assign(budget.operations.find(item => item.operationId === operation.operationId), update);
  });
  const hooks = {
    beforeRequest: async () => { await record({ billingStatus: 'unverified', requestStartedAt: new Date().toISOString() }); submitted = true; },
    remoteTask: taskId => record({ remoteTaskId: taskId }),
  };
  try {
    const result = await adapter.execute(probe, options, config, hooks);
    await completeOperation(taskId, operation.operationId, result.cost.reliable ? result.cost.cost : null, config);
    return result;
  } catch (error) {
    await record({ failureStage: submitted ? 'model-request' : 'input-or-upload' });
    await failOperation(taskId, operation.operationId, submitted ? null : 0, config);
    throw error;
  }
}

async function executePlan(context) {
  const { adapter, options, config, task, plan, operations, probes, output, outputFile } = context;
  const report = { schemaVersion: 1, status: 'partial', skill: adapter.skill, taskId: task.taskId, results: [], actualTotalCost: 0, estimatedTotalCost: plan.estimatedTotalCost };
  for (let index = 0; index < probes.length; index++) {
    const { result, cost } = await executeOperation(task.taskId, operations[index], probes[index], adapter, options, config);
    report.results.push(result);
    report.actualTotalCost = report.actualTotalCost !== null && cost.reliable ? report.actualTotalCost + cost.cost : null;
    await output.save(report);
  }
  report.status = 'completed';
  try { recordCapability(adapter.kind, [...new Set(operations.map(operation => operation.model))], { ...process.env, QWEN_MEDIA_CONFIG_DIR: config.configDir }); }
  catch { report.warnings = ['处理结果已保存，但本机能力验证记录未能更新。']; }
  await output.save(report);
  if (!options.output) report.recoveryFile = outputFile;
  return report;
}

export async function runModelTask(options, adapter, dependencies = {}) {
  options = { operationIds: [], ...options };
  const task = resolveTaskId(options.taskId);
  const outputFile = options.output ? path.resolve(options.output) : path.join(taskPaths(task.taskId).dir, 'results', `${task.taskId}-${randomUUID()}.json`);
  if (!options.output) await fs.mkdir(path.dirname(outputFile), { recursive: true });
  const output = await reserveOutput(outputFile);
  let registered = false;
  let config;
  try {
    config = dependencies.config || resolveConfig();
    await (dependencies.requireEnvironment || requireEnvironment)(config);
    const probes = await Promise.all(options.files.map(file => adapter.probe(file, options, config)));
    const plan = buildTaskPlan(probes.map(probe => ({ kind: adapter.kind, probe, prompt: options.prompt })), config);
    const operations = plan.operations.map((operation, index) => ({ operationId: options.operationIds[index] || `${adapter.kind}-${randomUUID()}`, skill: adapter.skill, model: adapter.model(probes[index], config), estimatedCost: operation.estimate.reliable ? operation.estimate.estimatedCost : null }));
    await registerOperations(task.taskId, operations, config);
    registered = true;
    const confirmation = await authorize(task, plan, options, config);
    if (confirmation) return confirmation;
    return await executePlan({ adapter, options, config, task, plan, operations, probes, output, outputFile });
  } catch (error) {
    if (output.saved) error.message += ` 已完成的部分结果保存在：${outputFile}`;
    throw error;
  } finally {
    try {
      if (registered && (!task.supplied || options.finalizeTask)) {
        if (!task.supplied) await cancelOpenOperations(task.taskId, config);
        await finalizeTask(task.taskId);
      }
    } finally { await output.close(); }
  }
}
