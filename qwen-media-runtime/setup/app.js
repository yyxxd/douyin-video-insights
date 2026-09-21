const $ = id => document.getElementById(id);
const token = location.pathname.slice(1);
let initialized = false;
let aiPresent = false;
async function request(route, data) {
  const response = await fetch(`/${route}`, { method: data ? 'POST' : 'GET', headers: { 'X-Setup-Token': token, ...(data ? { 'Content-Type': 'application/json' } : {}) }, ...(data ? { body: JSON.stringify(data) } : {}) });
  if (response.status === 403) throw new Error('配置链接无效或已过期，请让 Agent 重新打开。');
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '操作未完成。');
  return result;
}
async function refresh() {
  const data = await request('status');
  if (!initialized) {
    document.querySelector(`input[name=mode][value="${data.settings.mode === 'download' ? 'download' : 'all'}"]`).checked = true;
    if (data.settings.costMode === 'limit') { document.querySelector('input[name=cost][value=limit]').checked = true; $('limit').value = data.settings.costLimit; }
    initialized = true;
  }
  const selected = $('browser').value || data.settings.browser;
  $('browser').replaceChildren(...data.browsers.map((b, i) => { const option = new Option(`${b.label}${i === 0 ? '（推荐）' : ''}`, b.id); option.selected = b.id === selected; return option; }));
  $('no-browser').hidden = data.browsers.length > 0;
  $('login').disabled = data.job.busy || !data.browsers.length;
  $('install-browser').disabled = data.job.busy;
  $('login-state').textContent = data.job.busy ? data.job.message : data.loginSaved ? '已记住抖音登录；实际下载时会检查是否仍可用。' : data.job.message || '尚未连接抖音，可以稍后再连接。';
  const ai = data.settings.ai;
  aiPresent = data.aiSaved;
  $('existing-ai').textContent = aiPresent ? '已检测到 AI 环境变量，无需重复输入。留空可使用已有配置检查连接。' : '尚未检测到 AI 环境变量，请在下面配置。';
  $('ai-state').textContent = !data.aiSaved ? '尚未连接 AI 服务。' : ai === 'connected' ? '服务连接检查通过，语音和画面能力等待真实任务验证。' : ai === 'rejected' ? '服务拒绝了此密钥，请重新配置。' : '密钥已保存，服务可用性待确认。';
  if (data.aiSaved && data.validations?.asr && data.validations?.omni) $('ai-state').textContent = '语音识别和画面分析均已完成真实任务验证。';
  $('progress').textContent = `工具已准备 · 抖音${data.loginSaved ? '已连接' : '待连接'} · AI${data.aiSaved ? '已保存配置' : '待配置'}`;
  $('summary').textContent = data.settings.mode === 'download' ? '当前选择：仅下载。以后说“配置 AI 功能”可继续。' : '当前选择：全部功能。请完成抖音和 AI 连接，然后回到 Agent 继续原任务。';
  $('ai-panel').hidden = document.querySelector('input[name=mode]:checked').value === 'download';
}
function bind(id, route, getData) {
  $(id).onclick = async () => {
    $(id).disabled = true;
    try { const data = getData(); if (data === null) return; const result = await request(route, data); if (route === 'ai') $('key').value = ''; $('notice').textContent = result.message; setTimeout(() => { $('notice').textContent = ''; }, 6000); await refresh(); }
    catch (error) { $('notice').textContent = error.message; }
    finally { $(id).disabled = false; if (['login', 'install-browser'].includes(id)) await refresh().catch(error => { $('notice').textContent = error.message; }); }
  };
}
bind('save-mode', 'preferences', () => ({ mode: document.querySelector('input[name=mode]:checked').value }));
bind('login', 'login', () => ({ browser: $('browser').value, consent: $('login-consent').checked }));
bind('install-browser', 'install-browser', () => ({ consent: $('install-consent').checked }));
bind('save-ai', 'ai', () => {
  const replacing = aiPresent && Boolean($('key').value.trim());
  if (replacing && !confirm('已有 AI 环境变量。覆盖可能影响其他使用百炼的工具，确定替换吗？')) return null;
  return { key: $('key').value, confirmReplace: replacing, consent: $('ai-consent').checked, costMode: document.querySelector('input[name=cost]:checked').value, costLimit: $('limit').value };
});
bind('skip-ai', 'skip-ai', () => { document.querySelector('input[name=mode][value=download]').checked = true; return {}; });
bind('forget-ai', 'forget', () => confirm('清除当前用户的 DASHSCOPE_API_KEY 可能影响其他工具，确定清除吗？') ? { name: 'api-key', confirmClear: true } : null);
bind('forget-login', 'forget', () => ({ name: 'douyin-session' }));
$('refresh').onclick = () => refresh().catch(error => { $('notice').textContent = error.message; });
document.querySelectorAll('input[name=mode]').forEach(input => input.onchange = () => { $('ai-panel').hidden = input.value === 'download'; });
refresh().catch(error => { $('notice').textContent = error.message; });
setInterval(() => refresh().catch(error => { $('notice').textContent = error.message; }), 4000);
