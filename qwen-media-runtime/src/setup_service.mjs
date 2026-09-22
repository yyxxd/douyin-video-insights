import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readSettings, writeSettings, settingsDirectory } from './local_settings.mjs';
import { aiEnvironment } from './ai_environment.mjs';
import { GUIDE_VERSION, guideState, verifyAIKey } from './setup_state.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
function browsers() {
  const roots = [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean);
  return [{ id: 'chrome', label: 'Google Chrome', file: 'Google/Chrome/Application/chrome.exe' }, { id: 'msedge', label: 'Microsoft Edge', file: 'Microsoft/Edge/Application/msedge.exe' }]
    .filter(browser => roots.some(root => fs.existsSync(path.join(root, browser.file))));
}

function validations(directory) {
  return Object.fromEntries(['asr', 'omni'].map(kind => {
    try { return [kind, JSON.parse(fs.readFileSync(path.join(directory, `${kind}-validation.json`), 'utf8'))]; }
    catch (error) { return [kind, error.code === 'ENOENT' ? null : { status: 'invalid', message: '验证记录损坏，请在下一次获准任务中重新验证。' }]; }
  }));
}

export class SetupService {
  constructor(onFinish) {
    this.directory = settingsDirectory();
    this.job = { busy: false, message: '' };
    this.onFinish = onFinish;
    this.actionBusy = false;
  }

  status() {
    const saved = readSettings();
    const keys = ['browser', 'costMode', 'costLimit', 'mode', 'guideStatus'];
    const settings = Object.fromEntries(keys.filter(key => key in saved).map(key => [key, saved[key]]));
    const ai = aiEnvironment.status();
    const loginSaved = fs.existsSync(path.join(this.directory, 'douyin-session.protected'));
    return { settings, validations: validations(this.directory), browsers: browsers(), job: this.job, loginSaved, aiSaved: ai.present, aiUserConfigured: ai.userConfigured, guide: guideState({ settings: saved, loginSaved, aiSaved: ai.present }), directory: this.directory };
  }

  startJob(command, args, success, onSuccess = () => {}) {
    if (this.job.busy) throw new Error('正在处理上一项，请稍等或关闭登录窗口后继续。');
    this.job = { busy: true, message: '正在处理，请稍等；如已打开登录窗口，请在那里完成登录。' };
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, PYTHONIOENCODING: 'utf-8' } });
    child.stderr.resume();
    child.on('error', () => { this.job = { busy: false, message: '无法启动工具，请让 Agent 重新检查安装。' }; });
    child.on('close', code => {
      try {
        if (code === 0) onSuccess();
        this.job = { busy: false, message: code === 0 ? success : '未完成，请检查网络、浏览器和登录状态后重试。' };
      } catch { this.job = { busy: false, message: '结果无法保存，请检查本机目录权限。' }; }
    });
  }

  login(data) {
    if (!data.consent || !browsers().some(browser => browser.id === data.browser)) throw new Error('请选择可用浏览器，并同意连接抖音。');
    const tools = JSON.parse(fs.readFileSync(path.join(this.directory, 'toolchain.json'), 'utf8'));
    if (typeof tools.python !== 'string' || !path.isAbsolute(tools.python) || !fs.existsSync(tools.python)) throw new Error('Python 工具路径无效，请重新检查安装。');
    this.startJob(tools.python, [path.join(repo, 'yy-douyin-video/scripts/connect_browser.py'), '--browser', data.browser], '抖音登录已保存。', () => writeSettings({ browser: data.browser, login: 'saved' }));
    return { message: '请在新打开的抖音窗口扫码登录。原来的浏览器不受影响。' };
  }

  installBrowser(data) {
    if (!data.consent) throw new Error('请先同意安装 Google Chrome。');
    this.startJob('winget.exe', ['install', '--id', 'Google.Chrome', '--exact', '--scope', 'user', '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'], '浏览器安装完成，请选择 Google Chrome 连接抖音。');
    return { message: '正在通过 Windows 软件包管理器安装 Chrome；若系统阻止安装，请让 Agent 协助。' };
  }

  async saveAI(data) {
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
    if (supplied && oldKey !== key) this.clearValidations();
    writeSettings({ ai: 'connected', aiSkipped: false, guideStarted: true, guideStatus: 'in_progress', guideVersion: GUIDE_VERSION, environmentManaged: supplied ? true : readSettings().environmentManaged, costMode: data.costMode, costLimit: data.costMode === 'limit' ? limit : 0 });
    return { message: 'AI 服务连接检查通过，配置已保存。语音和画面处理需在获准的真实任务中分别验证。' };
  }

  clearValidations() {
    for (const kind of ['asr', 'omni']) fs.rmSync(path.join(this.directory, `${kind}-validation.json`), { force: true });
  }

  finish(cancelled = false) {
    if (this.job.busy) throw new Error('请先完成当前操作或关闭登录窗口。');
    const current = this.status();
    if (!cancelled && (!current.guide.loginReady || (!current.guide.aiReady && !current.guide.aiSkipped))) throw new Error('请先完成抖音登录和 AI 连接检查，或明确跳过 AI。');
    const status = cancelled ? 'cancelled' : current.guide.aiSkipped ? 'partial' : 'complete';
    writeSettings({ guideStatus: status, guideVersion: GUIDE_VERSION, ...(cancelled ? {} : { mode: status === 'complete' ? 'all' : 'download' }) });
    this.onFinish(status);
    return { status, message: cancelled ? '配置已暂停，已完成的内容会保留。' : '配置已保存，可以继续原任务。' };
  }

  forget(data) {
    if (this.job.busy) throw new Error('请先结束正在进行的连接。');
    if (!['api-key', 'douyin-session'].includes(data.name)) throw new Error('未知设置。');
    if (data.name === 'api-key') { aiEnvironment.clear(data.confirmClear === true); this.clearValidations(); }
    else fs.rmSync(path.join(this.directory, `${data.name}.protected`), { force: true });
    writeSettings(data.name === 'api-key' ? { ai: 'missing', environmentManaged: true } : { login: 'missing' });
    return { message: data.name === 'api-key' ? '已清除当前用户的 AI 环境变量；其他已运行软件可能需重新打开。' : '已清除抖音登录记录，日常浏览器不受影响。' };
  }

  async action(name, data) {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('请求必须是 JSON 对象。');
    if (this.actionBusy) throw new Error('正在保存上一项配置，请稍后重试。');
    this.actionBusy = true;
    try {
      if (name === 'login') return this.login(data);
      if (name === 'install-browser') return this.installBrowser(data);
      if (name === 'ai') return await this.saveAI(data);
      if (name === 'finish' || name === 'cancel') return this.finish(name === 'cancel');
      if (name === 'forget') return this.forget(data);
      if (name !== 'skip-ai') throw new Error('不支持的操作。');
      writeSettings({ mode: 'download', aiSkipped: true, guideStarted: true, guideStatus: 'in_progress', guideVersion: GUIDE_VERSION });
      return { message: '已明确跳过 AI；完成后将标记为部分配置。以后可随时回来补充。' };
    } finally { this.actionBusy = false; }
  }
}
