import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { runModelTask } from '../../qwen-media-runtime/src/model_task.mjs';
import { checkEnvironment } from '../../qwen-media-runtime/src/environment.mjs';
import { parseModelArgs } from '../../qwen-media-runtime/src/cli.mjs';
import { registerOperations, loadTaskBudget } from '../../qwen-media-runtime/src/task_budget.mjs';
import { withTemporaryDirectory } from '../../scripts/temp-directory.mjs';

const config = { region: 'cn-beijing', omniModel: 'qwen3.8-omni-flash', thresholdCny: 10, apiKeyPresent: true, baseUrl: 'https://api.invalid', endpoints: { chat: 'https://api.invalid' }, guideStatus: 'not_started' };
function adapter(execute) {
  return { kind: 'omni', skill: 'Qwen Omni', model: () => config.omniModel, probe: async () => ({ durationSeconds: 1, estimatedVideoTokens: 1 }), execute };
}
const success = { result: { content: '合成结果', durationSeconds: 1 }, cost: { reliable: true, cost: 0.01 } };

test('本地模型任务不要求抖音登录或完整引导', async () => {
  const report = await checkEnvironment({ ...config, configDir: '.' }, async () => true);
  assert.equal(report.ready, true);
});

test('未知参数、缺参、重复 Operation ID 和非法授权金额均提前拒绝', () => {
  for (const args of [['--file'], ['--file', 'a', '--wat'], ['--file', 'a', '--file', 'b', '--operation-id', 'same', '--operation-id', 'same'], ['--file', 'a', '--confirm', '--approved-cost-ceiling', '-1']]) {
    assert.throws(() => parseModelArgs(args, 'asr'));
  }
});

test('已有输出或不存在的父目录在任何模型请求之前失败', async () => {
  await withTemporaryDirectory(async directory => {
    const file = path.join(directory, 'existing.json');
    await fs.writeFile(file, 'original');
    let calls = 0;
    const fake = adapter(async () => { calls++; return success; });
    const dependencies = { config: { ...config, configDir: directory }, requireEnvironment: async () => {} };
    for (const output of [file, path.join(directory, 'missing', 'output.json')]) {
      await assert.rejects(runModelTask({ files: ['a'], output }, fake, dependencies), { code: 'OUTPUT_UNAVAILABLE' });
    }
    assert.equal(calls, 0);
    assert.equal(await fs.readFile(file, 'utf8'), 'original');
  });
});

test('批量第二项失败仍可恢复第一项结果，后续调用没有自动重试', async () => {
  await withTemporaryDirectory(async directory => {
    const previousTemp = process.env.TEMP;
    process.env.TEMP = directory;
    let calls = 0;
    const fake = adapter(async () => { if (++calls === 2) throw new Error('模拟断线'); return success; });
    const output = path.join(directory, 'partial.json');
    try {
      await assert.rejects(runModelTask({ files: ['a', 'b'], output }, fake, { config: { ...config, configDir: directory }, requireEnvironment: async () => {} }), /模拟断线/);
      const report = JSON.parse(await fs.readFile(output, 'utf8'));
      assert.equal(report.status, 'partial');
      assert.deepEqual(report.results, [success.result]);
      assert.equal(calls, 2);
    } finally { if (previousTemp === undefined) delete process.env.TEMP; else process.env.TEMP = previousTemp; }
  });
});

test('共享任务等待授权不删除其他步骤或创建伪结果文件', async () => {
  await withTemporaryDirectory(async directory => {
    const previous = process.env.TEMP;
    process.env.TEMP = directory;
    const settings = { ...config, thresholdCny: 0, configDir: directory };
    try {
      await registerOperations('shared', [{ operationId: 'other', estimatedCost: 0.1 }], settings);
      let calls = 0;
      const output = path.join(directory, 'result.json');
      const report = await runModelTask({ files: ['a'], taskId: 'shared', output, finalizeTask: true }, adapter(async () => { calls++; return success; }), { config: settings, requireEnvironment: async () => {} });
      assert.equal(report.requiresConfirmation, true);
      assert.equal(calls, 0);
      assert.equal((await loadTaskBudget('shared', settings)).operations.find(item => item.operationId === 'other').status, 'planned');
      await assert.rejects(fs.access(output));
    } finally { if (previous === undefined) delete process.env.TEMP; else process.env.TEMP = previous; }
  });
});

test('首次模型请求失败保留未知费用证据，不提示不存在的结果文件', async () => {
  await withTemporaryDirectory(async directory => {
    const previous = process.env.TEMP;
    process.env.TEMP = directory;
    const output = path.join(directory, 'failed.json');
    try {
      const fake = adapter(async (_media, _options, _config, hooks) => { await hooks.beforeRequest(); throw new Error('模拟模型断线'); });
      await assert.rejects(runModelTask({ files: ['a'], taskId: 'failed-task', output }, fake, { config: { ...config, configDir: directory }, requireEnvironment: async () => {} }), error => error.message === '模拟模型断线');
      const budget = await loadTaskBudget('failed-task', config);
      assert.equal(budget.operations[0].failureStage, 'model-request');
      assert.equal(budget.actualCost, 0);
      assert.ok(budget.unverifiedEstimatedCost > 0);
      await assert.rejects(fs.access(output));
    } finally { if (previous === undefined) delete process.env.TEMP; else process.env.TEMP = previous; }
  });
});
