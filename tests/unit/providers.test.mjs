import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import https from 'node:https';
import { PassThrough, Writable } from 'node:stream';
import { test } from 'node:test';
import { asrAdapter } from '../../yy-qwen-asr/src/transcribe.mjs';
import { omniAdapter } from '../../yy-qwen-omni/src/analyze.mjs';
import { withTemporaryDirectory } from '../../scripts/temp-directory.mjs';

const config = {
  apiKey: 'offline-fake-key', region: 'cn-beijing', priceEnv: {},
  asrModel: 'qwen3-asr-flash', asrLongModel: 'qwen3-asr-flash-filetrans', omniModel: 'qwen3.8-omni-flash',
  endpoints: { compatibleChatCompletions: 'https://api.invalid/chat', temporaryUploadPolicy: 'https://policy.invalid/upload', filetransSubmit: 'https://api.invalid/transcribe', taskQuery: 'https://api.invalid/tasks/{taskId}' },
};

test('短 ASR 和 Omni 请求保留协议字段，HTTP 成功但空结构不能当成结果', async () => {
  await withTemporaryDirectory(async directory => {
    const file = path.join(directory, 'sample.wav');
    await fs.writeFile(file, 'synthetic-not-real-media');
    const original = globalThis.fetch;
    const bodies = [];
    let submissions = 0;
    const hooks = { beforeRequest: async () => { submissions++; } };
    globalThis.fetch = async (_url, options) => {
      bodies.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ choices: [{ message: { content: '合成结果' } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }));
    };
    try {
      const asr = await asrAdapter.execute({ file, durationSeconds: 1, route: 'short_base64' }, { language: 'zh', itn: false }, config, hooks);
      const omni = await omniAdapter.execute({ file, durationSeconds: 1, route: 'base64' }, { prompt: '合成检查' }, config, hooks);
      assert.equal(asr.result.text, '合成结果');
      assert.equal(asr.cost.reliable, false);
      assert.equal(omni.result.content, '合成结果');
      assert.equal(bodies[0].parameters.enable_itn, false);
      assert.equal(bodies[0].language, 'zh');
      assert.equal(bodies[0].messages[0].content[0].input_audio.format, 'wav');
      assert.equal(bodies[1].reasoning_effort, 'none');
      assert.equal(bodies[1].messages[0].content[1].text, '合成检查');
      assert.equal(submissions, 2);
      globalThis.fetch = async () => new Response('{}');
      await assert.rejects(omniAdapter.execute({ file, route: 'base64' }, { prompt: 'x' }, config, hooks), { code: 'OMNI_RESPONSE_INVALID' });
    } finally { globalThis.fetch = original; }
  });
});

function mockUpload() {
  https.request = (url, _options, callback) => new Writable({
    write(_chunk, _encoding, done) { done(); },
    final(done) {
      const response = new PassThrough();
      response.statusCode = 200;
      callback(response);
      const policy = { data: { upload_host: 'https://upload.invalid', upload_dir: 'temporary/test', policy: 'test', signature: 'test', oss_access_key_id: 'test' } };
      response.end(url.hostname === 'policy.invalid' ? JSON.stringify(policy) : '');
      done();
    },
  });
}

test('Filetrans 只提交一次，保存远端 ID，下载结果不携带认证头', async () => {
  await withTemporaryDirectory(async directory => {
    const file = path.join(directory, 'sample.wav');
    await fs.writeFile(file, 'synthetic-not-real-media');
    const originalFetch = globalThis.fetch;
    const originalRequest = https.request;
    const requests = [];
    let remoteId;
    mockUpload();
    globalThis.fetch = async (url, options) => {
      requests.push({ url: String(url), options });
      const values = [{ output: { task_id: 'remote-test' } }, { output: { task_status: 'SUCCEEDED', result: { transcription_url: 'https://results.invalid/signed' } } }, { transcripts: [{ text: '合成台词', sentences: [{ begin_time: 0, end_time: 1000, text: '合成台词' }] }] }];
      return new Response(JSON.stringify(values[requests.length - 1]));
    };
    try {
      const result = await asrAdapter.execute({ file, durationSeconds: 1, route: 'long_filetrans' }, { timestamps: true }, config, { beforeRequest: async () => {}, remoteTask: async id => { remoteId = id; } });
      assert.equal(requests.filter(request => request.options.method === 'POST').length, 1);
      assert.equal(remoteId, 'remote-test');
      assert.equal(new Headers(requests[2].options.headers).has('authorization'), false);
      assert.equal(result.result.segments[0].end, 1);
    } finally { globalThis.fetch = originalFetch; https.request = originalRequest; }
  });
});
