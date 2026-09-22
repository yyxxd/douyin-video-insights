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

function renderGuide(data) {
  const labels = { complete: '全部配置完成', partial: '部分配置完成', cancelled: '配置已暂停', in_progress: '配置进行中' };
  $('progress').textContent = `${labels[data.guide.status]} · 抖音${data.guide.loginReady ? '已连接' : '待连接'} · AI${data.guide.aiReady ? '已验证' : data.guide.aiSkipped ? '已跳过' : '待验证'}`;
  $('summary').textContent = data.guide.status === 'complete' ? '全部配置已经就绪，可以通知 Agent 继续原任务。' : data.guide.aiSkipped ? '当前为部分配置：抖音下载可用，AI 功能尚未配置。' : '请完成抖音登录和 AI 连接检查，然后继续。';
  $('finish').textContent = data.guide.aiSkipped ? '完成基础配置并继续' : '完成全部配置并继续原任务';
  $('finish').disabled = data.job.busy || !data.guide.loginReady || (!data.guide.aiReady && !data.guide.aiSkipped);
}

async function refresh() {
  const data = await request('status');
  if (!initialized) {
    if (data.settings.costMode === 'limit') { document.querySelector('input[name=cost][value=limit]').checked = true; $('limit').value = data.settings.costLimit; }
    initialized = true;
  }
  const selected = $('browser').value || data.settings.browser;
  $('browser').replaceChildren(...data.browsers.map((b, i) => { const option = new Option(`${b.label}${i === 0 ? '（推荐）' : ''}`, b.id); option.selected = b.id === selected; return option; }));
  $('no-browser').hidden = data.browsers.length > 0;
  $('login').disabled = data.job.busy || !data.browsers.length;
  $('install-browser').disabled = data.job.busy;
  $('login-state').textContent = data.job.busy ? data.job.message : data.loginSaved ? '已记住抖音登录；实际下载时会再次检查。' : data.job.message || '尚未连接抖音。';
  aiPresent = data.aiSaved;
  $('existing-ai').textContent = aiPresent ? '检测到已有 AI 环境变量。留空可验证现有配置，输入新值可在验证成功后替换。' : '尚未配置 AI 环境变量。';
  $('ai-state').textContent = data.guide.aiReady ? 'AI 服务连接检查通过。' : data.guide.aiSkipped ? '已选择暂时跳过 AI。' : '尚未通过 AI 服务连接检查。';
  renderGuide(data);
}

function bind(id, route, getData) {
  $(id).onclick = async () => {
    $(id).disabled = true;
    let closed = false;
    try {
      const data = getData();
      if (data === null) return;
      const result = await request(route, data);
      if (route === 'ai') $('key').value = '';
      $('notice').textContent = result.message;
      closed = ['finish', 'cancel'].includes(route);
      if (closed) document.querySelectorAll('button,input,select').forEach(element => { element.disabled = true; });
      else await refresh();
    } catch (error) { $('notice').textContent = error.message; }
    finally { if (!closed) $(id).disabled = false; }
  };
}

bind('login', 'login', () => ({ browser: $('browser').value, consent: $('login-consent').checked }));
bind('install-browser', 'install-browser', () => ({ consent: $('install-consent').checked }));
bind('save-ai', 'ai', () => {
  const replacing = aiPresent && Boolean($('key').value.trim());
  if (replacing && !confirm('已有 AI 环境变量。新 Key 验证成功后才会覆盖，确定继续吗？')) return null;
  return { key: $('key').value, confirmReplace: replacing, consent: $('ai-consent').checked, costMode: document.querySelector('input[name=cost]:checked').value, costLimit: $('limit').value };
});
bind('skip-ai', 'skip-ai', () => confirm('跳过后将只完成下载配置，提取口播和视频分析暂不可用。确定跳过吗？') ? {} : null);
bind('forget-ai', 'forget', () => confirm('清除当前用户的 DASHSCOPE_API_KEY 可能影响其他工具，确定清除吗？') ? { name: 'api-key', confirmClear: true } : null);
bind('forget-login', 'forget', () => ({ name: 'douyin-session' }));
bind('finish', 'finish', () => ({}));
bind('cancel', 'cancel', () => confirm('暂停后 Agent 不会继续原任务，已完成的配置会保留。确定暂停吗？') ? {} : null);
$('refresh').onclick = () => refresh().catch(error => { $('notice').textContent = error.message; });
refresh().catch(error => { $('notice').textContent = error.message; });
setInterval(() => refresh().catch(() => {}), 4000);
