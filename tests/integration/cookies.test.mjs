import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { netscapeCookies, withCookies } from '../../yy-douyin-video/src/cookies.mjs';

const cookie = { domain: '.douyin.com', hostOnly: false, path: '/', secure: true, name: '', value: 'test', session: true };
const content = netscapeCookies(JSON.stringify([cookie, { ...cookie, domain: '.example.com' }]));
assert.ok(content.includes('.douyin.com\tTRUE\t/\tTRUE\t0\t\ttest'));
assert.ok(!content.includes('example.com'));
assert.equal(netscapeCookies(content), content);
assert.throws(() => netscapeCookies(JSON.stringify([{ ...cookie, value: 'x\ny' }])));
assert.throws(() => netscapeCookies('{}'));
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cookie-test-'));
try {
  const source = path.join(directory, 'input.json');
  const original = JSON.stringify([cookie]);
  await fs.writeFile(source, original);
  let temporary;
  await assert.rejects(withCookies(source, async (file) => {
    temporary = file;
    assert.equal(await fs.readFile(file, 'utf8'), content);
    throw new Error('模拟下载失败');
  }), /模拟下载失败/);
  await assert.rejects(fs.access(temporary));
  assert.equal(await fs.readFile(source, 'utf8'), original);
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
console.log('COOKIE_TESTS_OK');
