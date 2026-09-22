import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeSettings } from '../src/local_settings.mjs';
import { SetupService } from '../src/setup_service.mjs';
import { GUIDE_VERSION } from '../src/setup_state.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const token = randomBytes(32).toString('hex');
let finished = false;
const service = new SetupService(status => {
  finished = true;
  if (status === 'cancelled') process.exitCode = 20;
  console.log(JSON.stringify({ event: 'guide-finished', status }));
  setImmediate(() => server.close());
});

async function bodyOf(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 8192) throw new Error('输入内容过长。');
  }
  return JSON.parse(body || '{}');
}

const server = http.createServer(async (req, res) => {
  const expectedHost = `127.0.0.1:${server.address().port}`;
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'");
  if (req.headers.host !== expectedHost) { res.writeHead(403).end(); return; }
  if (req.method === 'GET' && req.url === `/${token}`) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(scriptDirectory, '../setup/index.html'))); return;
  }
  const assets = { '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
  if (req.method === 'GET' && assets[req.url]) {
    const [file, type] = assets[req.url]; res.setHeader('Content-Type', `${type}; charset=utf-8`);
    res.end(fs.readFileSync(path.join(scriptDirectory, '../setup', file))); return;
  }
  const supplied = Buffer.from(String(req.headers['x-setup-token'] || ''));
  if (supplied.length !== token.length || !timingSafeEqual(supplied, Buffer.from(token))) { res.writeHead(403).end(); return; }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  try {
    if (req.method === 'GET' && req.url === '/status') { res.end(JSON.stringify(service.status())); return; }
    if (req.method !== 'POST' || req.headers.origin !== `http://${expectedHost}` || !req.headers['content-type']?.startsWith('application/json')) { res.writeHead(403).end(); return; }
    res.end(JSON.stringify(await service.action(req.url.slice(1), await bodyOf(req))));
  } catch (error) { res.statusCode = 400; res.end(JSON.stringify({ error: error.message })); }
});
server.requestTimeout = 20000;
server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/${token}`;
  writeSettings({ guideStarted: true, guideStatus: 'in_progress', guideVersion: GUIDE_VERSION });
  console.log(JSON.stringify({ setupUrl: url, message: '请在本机配置页面完成设置；完成后 Agent 会自动继续。' }));
  if (!process.argv.includes('--no-open')) {
    const child = spawn('powershell.exe', ['-NoProfile', '-Command', 'Start-Process $env:QWEN_SETUP_URL'], { windowsHide: true, env: { ...process.env, QWEN_SETUP_URL: url }, stdio: 'ignore' });
    child.on('error', () => console.error('请手动打开上面的本机配置链接。'));
    child.on('close', code => { if (code !== 0) console.error('浏览器未能自动打开，请手动打开上面的本机配置链接。'); });
  }
});
setTimeout(() => { if (!service.job.busy && !finished) { process.exitCode = 21; console.log(JSON.stringify({ event: 'guide-finished', status: 'timeout' })); server.close(); } }, 30 * 60 * 1000).unref();
