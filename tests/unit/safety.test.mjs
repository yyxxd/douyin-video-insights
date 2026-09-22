import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { registerOperations, startOperation, completeOperation, loadTaskBudget, failOperation, finalizeTask, cancelOpenOperations, projectedCost } from '../../qwen-media-runtime/src/task_budget.mjs';
import { getPrices } from '../../qwen-media-runtime/src/pricing.mjs';
import { fetchResultJson } from '../../qwen-media-runtime/src/bailian_client.mjs';
import { actualCost } from '../../qwen-media-runtime/src/cost_guard.mjs';

async function withBudget(action) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qwen-budget-test-'));
  const env = { TEMP: dir };
  const config = { thresholdCny: 0.15 };
  try {
    await registerOperations('task', [{ operationId: 'omni', estimatedCost: 0.1 }], config, env);
    await action(config, env);
  } finally {
    const tasks = path.join(dir, 'QwenMediaSkills', 'tasks');
    for (const name of await fs.readdir(tasks)) await fs.unlink(path.join(tasks, name));
    await fs.rmdir(tasks);
    await fs.rmdir(path.dirname(tasks));
    await fs.rmdir(dir);
  }
}

test('同一 Operation 并发只允许启动一次，终态禁止重启', async () => {
  await withBudget(async (config, env) => {
    const starts = await Promise.all([startOperation('task', 'omni', config, env), startOperation('task', 'omni', config, env)]);
    assert.equal(starts.filter(item => item.allowed).length, 1);
    await completeOperation('task', 'omni', 0.1, config, env);
    assert.equal((await startOperation('task', 'omni', config, env)).allowed, false);
    assert.equal((await loadTaskBudget('task', config, env)).actualCost, 0.1);
  });
});

test('失败费用未知时保留估算占用，不冒充实际费用', async () => {
  await withBudget(async (config, env) => {
    await startOperation('task', 'omni', config, env);
    await failOperation('task', 'omni', null, config, env);
    const budget = await loadTaskBudget('task', config, env);
    assert.equal(budget.actualCost, 0);
    assert.equal(budget.unverifiedEstimatedCost, 0.1);
  });
});

test('结果文件下载不携带百炼 API Key，拒绝非 HTTPS URL', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    assert.equal(new Headers(options.headers).has('authorization'), false);
    assert.equal(options.redirect, 'error');
    return new Response('{}');
  };
  try {
    await fetchResultJson({ apiKey: 'fake-test-key' }, 'https://results.invalid/result.json');
    await assert.rejects(fetchResultJson({ apiKey: 'fake-test-key' }, 'http://results.invalid/result.json'));
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test('未登记的模型不能使用默认价格并声称可靠', () => {
  const cost = actualCost('omni', { prompt_tokens: 100, completion_tokens: 100 }, {}, { region: 'cn-beijing', omniModel: 'unknown-model' });
  assert.equal(cost.reliable, false);
});

test('未知模型价格必须显式绑定，空白价格不能变成零元', () => {
  const env = { QWEN_OMNI_INPUT_PRICE_PER_MILLION_TOKENS: '1', QWEN_OMNI_OUTPUT_PRICE_PER_MILLION_TOKENS: '2' };
  assert.equal(getPrices('cn-beijing', 'custom', 'omni', env).reliable, false);
  assert.equal(getPrices('cn-beijing', 'custom', 'omni', { ...env, QWEN_OMNI_PRICE_MODEL: 'custom' }).reliable, true);
  assert.equal(getPrices('cn-beijing', 'qwen3.8-omni-flash', 'omni', { ...env, QWEN_OMNI_INPUT_PRICE_PER_MILLION_TOKENS: '  ' }).reliable, false);
});

test('任务归档后不允许重新登记同一个 Task ID', async () => {
  await withBudget(async (config, env) => {
    await startOperation('task', 'omni', config, env);
    await completeOperation('task', 'omni', 0.1, config, env);
    assert.equal((await finalizeTask('task', env)).finalized, true);
    await assert.rejects(registerOperations('task', [{ operationId: 'new', estimatedCost: 0.1 }], config, env), /归档/);
  });
});

test('取消待执行步骤不取消其他正在运行的 Operation；未知费用仍占预算', async () => {
  await withBudget(async (config, env) => {
    await startOperation('task', 'omni', config, env);
    await cancelOpenOperations('task', config, env);
    assert.equal((await loadTaskBudget('task', config, env)).operations[0].status, 'running');
    await failOperation('task', 'omni', null, config, env);
    assert.equal(projectedCost(await loadTaskBudget('task', config, env)), 0.1);
  });
});

test('共享任务含未知费用时不能先执行其他模型，补齐价格后可以重算', async () => {
  await withBudget(async (config, env) => {
    await registerOperations('task', [{ operationId: 'asr', estimatedCost: null }], config, env);
    assert.equal((await startOperation('task', 'omni', config, env)).allowed, false);
    await registerOperations('task', [{ operationId: 'asr', estimatedCost: 0.01 }], config, env);
    assert.equal((await startOperation('task', 'omni', config, env)).allowed, true);
    await completeOperation('task', 'omni', 0.1, config, env);
  });
});
