import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readSettings, writeSettings, settingsDirectory } from './local_settings.mjs';
import { aiEnvironment } from './ai_environment.mjs';
import { GUIDE_VERSION, guideState, verifyAIKey } from './setup_state.mjs';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(scriptDirectory, '../..');
const token = randomBytes(32).toString('hex');
const directory = settingsDirectory();
let job = { busy: false, message: '' };
let finished = false;

function browsers() {
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  return [{ id: 'chrome', label: 'Google Chrome', file: 'Google/Chrome/Application/chrome.exe' }, { id: 'msedge', label: 'Microsoft Edge', file: 'Microsoft/Edge/Application/msedge.exe' }]
    .filter(browser => roots.some(root => fs.existsSync(path.join(root, browser.file))));
}

function status() {
  const settings = readSettings();
  const validations = Object.fromEntries(['asr', 'omni'].map(kind => { const file = path.join(directory, `${kind}-validation.json`); return [kind, fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null]; }));
  const ai = aiEnvironment.status();
  const loginSaved = fs.existsSync(path.join(directory, 'douyin-session.protected'));
  return { settings, validations, browsers: browsers(), job, loginSaved, aiSaved: ai.present, aiUserConfigured: ai.userConfigured, guide: guideState({ settings, loginSaved, aiSaved: ai.present }), directory };
}

function startJob(command, args, success, onSuccess = () => {}) {
  if (job.busy) throw new Error('正在处理上一项，请稍等或关闭登录窗口后继续。');
  job = { busy: true, message: '正在处理，请稍等；如已打开登录窗口，请在那里完成登录。' };
  const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
  // 不回传第三方异常文本，避免其中包含凭据和签名 URL。
  child.stderr.resume();
  child.on('error', () => { job = { busy: false, message: '无法启动工具，请让 Agent 重新检查安装。' }; });
  child.on('close', code => {
    try { if (code === 0) onSuccess(); job = { busy: false, message: code === 0 ? success : '未完成。请确认网络、浏览器和登录状态；其他配置已保留，可以重试。' }; }
    catch { job = { busy: false, message: '结果无法保存，请检查本机目录权限。' }; }
  });
}

async function saveAI(data) {
  if (!data.consent) throw new Error('请先同意保存或使用 AI 环境变量并检查连接。');
  const supplied = typeof data.key === 'string' ? data.key.trim() : '';
  const key = supplied || aiEnvironment.value();
  if (!key || key.length > 1024 || /[\s\x00-\x1f]/.test(key)) throw new Error('服务密钥格式不正确，请重新复制。');
  if (!['always', 'limit'].includes(data.costMode)) throw new Error('请选择费用确认方式。');
  const limit = Number(data.costLimit);
  if (data.costMode === 'limit' && (!Number.isFinite(limit) || limit <= 0 || limit > 100)) throw new Error('请填写大于 0 且不超过 100 元的任务金额上限。');
  await verifyAIKey(key);
  const oldKey = aiEnvironment.value();
  if (supplied) aiEnvironment.save(key, data.confirmReplace === true);
  if (supplied && oldKey !== key) for (const kind of ['asr', 'omni']) fs.rmSync(path.join(directory, `${kind}-validation.json`), { force: true });
  writeSettings({ ai: 'connected', aiSkipped: false, guideStarted: true, guideStatus: 'in_progress', guideVersion: GUIDE_VERSION, environmentManaged: supplied ? true : readSettings().environmentManaged, costMode: data.costMode, costLimit: data.costMode === 'limit' ? limit : 0 });
  return { message: 'AI 服务连接检查通过，配置已保存。语音和画面处理需在获准的真实任务中分别验证。' };
}

async function action(name, data) {
  if (name === 'login') {
    if (!data.consent || !browsers().some(b => b.id === data.browser)) throw new Error('请选择可用浏览器，并同意连接抖音。');
    const tools = JSON.parse(fs.readFileSync(path.join(directory, 'toolchain.json'), 'utf8'));
    startJob(tools.python, [path.join(repo, 'yy-douyin-video/scripts/connect_browser.py'), '--browser', data.browser], '抖音登录已保存。下一步配置 AI，或回到 Agent 继续任务。', () => writeSettings({ browser: data.browser, login: 'saved' }));
    return { message: '请在新打开的抖音窗口扫码登录。原来的浏览器不受影响。' };
  }
  if (name === 'install-browser') {
    if (!data.consent) throw new Error('请先同意安装 Google Chrome。');
    startJob('winget.exe', ['install', '--id', 'Google.Chrome', '--exact', '--scope', 'user', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'], '浏览器安装完成，请选择 Google Chrome 连接抖音。');
    return { message: '正在通过 Windows 软件包管理器安装 Chrome；若系统阻止安装，请让 Agent 协助。' };
  }
  if (name === 'ai') return saveAI(data);
  if (name === 'skip-ai') { writeSettings({ mode: 'download', aiSkipped: true, guideStarted: true, guideStatus: 'in_progress', guideVersion: GUIDE_VERSION }); return { message: '已明确跳过 AI；完成后将标记为部分配置。以后可随时回来补充。' }; }
  if (name === 'finish') {
    const current = status();
    if (current.job.busy) throw new Error('请先完成当前操作。');
    if (!current.guide.loginReady) throw new Error('请先完成抖音登录。');
    if (!current.guide.aiReady && !current.guide.aiSkipped) throw new Error('请先通过 AI 连接检查，或明确选择暂时跳过 AI。');
    const guideStatus = current.guide.aiSkipped ? 'partial' : 'complete';
    writeSettings({ guideStatus, guideVersion: GUIDE_VERSION, mode: guideStatus === 'complete' ? 'all' : 'download' });
    finished = true;
    setImmediate(() => server.close());
    console.log(JSON.stringify({ event: 'guide-finished', status: guideStatus }));
    return { message: guideStatus === 'complete' ? '全部配置已完成，可以继续原任务。' : '基础下载配置已完成，AI 已跳过，可以继续原任务。', status: guideStatus };
  }
  if (name === 'cancel') {
    writeSettings({ guideStatus: 'cancelled', guideVersion: GUIDE_VERSION });
    finished = true;
    process.exitCode = 20;
    setImmediate(() => server.close());
    console.log(JSON.stringify({ event: 'guide-finished', status: 'cancelled' }));
    return { message: '配置已暂停，已完成的内容会保留。', status: 'cancelled' };
  }
  if (name === 'forget') {
    if (job.busy) throw new Error('请先结束正在进行的连接。');
    if (!['api-key', 'douyin-session'].includes(data.name)) throw new Error('未知设置。');
    if (data.name === 'api-key') aiEnvironment.clear(data.confirmClear === true);
    else fs.rmSync(path.join(directory, `${data.name}.protected`), { force: true });
    if (data.name === 'api-key') for (const kind of ['asr', 'omni']) fs.rmSync(path.join(directory, `${kind}-validation.json`), { force: true });
    writeSettings(data.name === 'api-key' ? { ai: 'missing', environmentManaged: true } : { login: 'missing' });
    return { message: data.name === 'api-key' ? '已清除当前用户的 AI 环境变量。本服务不再使用它；其他已运行软件可能需重新打开。' : '已清除抖音登录记录，日常浏览器不受影响。' };
  }
  throw new Error('不支持的操作。');
}

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
    if (req.method === 'GET' && req.url === '/status') { res.end(JSON.stringify(status())); return; }
    if (req.method !== 'POST' || req.headers.origin !== `http://${expectedHost}` || !req.headers['content-type']?.startsWith('application/json')) { res.writeHead(403).end(); return; }
    res.end(JSON.stringify(await action(req.url.slice(1), await bodyOf(req))));
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
setTimeout(() => { if (!job.busy && !finished) { process.exitCode = 21; console.log(JSON.stringify({ event: 'guide-finished', status: 'timeout' })); server.close(); } }, 30 * 60 * 1000).unref();
