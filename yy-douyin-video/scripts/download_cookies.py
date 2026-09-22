"""本工具凭据适配与受限临时目录。"""
from contextlib import contextmanager
import http.cookiejar
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

from browser_session import load_session
from download_support import DownloadError


def normalize(items):
    if not isinstance(items, list):
        raise DownloadError('COOKIE_INVALID', 'Cookie JSON 必须是数组。')
    result = []
    for item in items:
        if not isinstance(item, dict):
            raise DownloadError('COOKIE_INVALID', 'Cookie 记录格式无效。')
        domain = item.get('domain', '')
        if not isinstance(domain, str) or not (domain.lstrip('.') == 'douyin.com' or domain.endswith('.douyin.com')):
            continue
        if item.get('name') == '':
            continue
        domain = '.' + domain.lstrip('.') if item.get('hostOnly') is False else domain
        if item.get('hostOnly') is True:
            domain = domain.lstrip('.')
        fields = [domain, item.get('path', '/'), item.get('name'), item.get('value')]
        if any(not isinstance(v, str) or any(c in v for c in '\t\r\n\0') for v in fields) or not fields[2]:
            raise DownloadError('COOKIE_INVALID', 'Cookie 字段无效。')
        expires = item.get('expires', item.get('expirationDate', -1))
        expires = -1 if item.get('session') or expires is None or expires == 0 else float(expires)
        if not math.isfinite(expires):
            raise DownloadError('COOKIE_INVALID', 'Cookie 到期时间无效。')
        if expires > 0 and expires <= time.time():
            continue
        result.append({'domain': domain, 'path': fields[1], 'name': fields[2], 'value': fields[3],
                       'secure': bool(item.get('secure')), 'httpOnly': bool(item.get('httpOnly')),
                       'expires': expires if expires > 0 else -1})
    if not result:
        raise DownloadError('COOKIE_EMPTY', '没有可用的抖音 Cookie，请重新连接抖音。')
    return result


def read_cookies(file):
    text = Path(file).read_text(encoding='utf-8-sig')
    if text.lstrip().startswith('['):
        return normalize(json.loads(text))
    jar = http.cookiejar.MozillaCookieJar(str(file))
    jar.load(ignore_discard=True, ignore_expires=True)
    return normalize([{'domain': c.domain, 'path': c.path, 'name': c.name, 'value': c.value,
                       'secure': c.secure, 'expires': c.expires, 'httpOnly': c.has_nonstandard_attr('HTTPOnly')} for c in jar])


def credentials(file=None, browser=None):
    try:
        if file:
            return read_cookies(file), 'chrome'
        if browser:
            from yt_dlp.cookies import extract_cookies_from_browser
            jar = extract_cookies_from_browser(browser)
            items = [{'domain': c.domain, 'path': c.path, 'name': c.name, 'value': c.value,
                      'secure': c.secure, 'expires': c.expires} for c in jar]
            return normalize(items), 'msedge' if browser == 'edge' else browser
        items, channel = load_session()
        if channel not in ('chrome', 'msedge'):
            raise ValueError('未知浏览器')
        return normalize(items), channel
    except DownloadError:
        raise
    except Exception:
        raise DownloadError('LOGIN_UNAVAILABLE', '无法读取抖音登录，请在配置页面重新连接，或手动下载后提供本地视频。') from None


def write_netscape(file, cookies):
    rows = ['# Netscape HTTP Cookie File']
    for cookie in cookies:
        domain = cookie['domain']
        prefix = '#HttpOnly_' if cookie.get('httpOnly') else ''
        rows.append('\t'.join([prefix + domain, 'TRUE' if domain.startswith('.') else 'FALSE', cookie['path'],
                               'TRUE' if cookie['secure'] else 'FALSE', str(max(0, int(cookie['expires']))), cookie['name'], cookie['value']]))
    file.write_text('\n'.join(rows) + '\n', encoding='utf-8')


def lock_file(file):
    if os.name == 'nt':
        import msvcrt
        file.seek(0)
        msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
    else:
        import fcntl
        fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)


def restrict(directory):
    if os.name != 'nt':
        directory.chmod(0o700)
        return
    result = subprocess.run(['whoami', '/user', '/fo', 'csv', '/nh'], capture_output=True, check=True)
    import re
    sid = re.search(r'S-1-[0-9-]+', result.stdout.decode(errors='replace')).group()
    subprocess.run(['icacls', str(directory), '/inheritance:r', '/grant:r', f'*{sid}:(OI)(CI)F'], capture_output=True, check=True)


def remove_workspace(directory, root):
    if directory.resolve().parent != root.resolve() or not directory.name.startswith('task-'):
        raise DownloadError('INVALID_TEMP_PATH', '临时目录超出本工具范围，已停止清理。')
    shutil.rmtree(directory)


@contextmanager
def private_workspace():
    root = Path(tempfile.gettempdir()) / 'qwen-media-downloads'
    root.mkdir(exist_ok=True)
    restrict(root)
    for directory in root.glob('task-*'):
        if directory.is_symlink() or not directory.is_dir() or time.time() - directory.stat().st_mtime < 60:
            continue
        try:
            with (directory / 'active.lock').open('r+b') as active:
                lock_file(active)
            remove_workspace(directory, root)
        except (OSError, PermissionError):
            continue  # 活跃任务持有锁；只清理已释放的本工具任务。
    directory = Path(tempfile.mkdtemp(prefix='task-', dir=root))
    active = (directory / 'active.lock').open('w+b')
    active.write(b'1')
    active.flush()
    lock_file(active)
    try:
        yield directory
    finally:
        active.close()
        remove_workspace(directory, root)
