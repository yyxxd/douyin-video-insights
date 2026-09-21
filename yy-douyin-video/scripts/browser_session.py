"""只读写本工具的加密登录记录，不访问日常浏览器资料。"""
import json
import os
from pathlib import Path
import subprocess
import time


def config_dir():
    return Path(os.environ.get('QWEN_MEDIA_CONFIG_DIR') or Path(os.environ['LOCALAPPDATA']) / 'QwenMediaSkills')


def settings():
    file = config_dir() / 'setup.json'
    return json.loads(file.read_text(encoding='utf-8')) if file.exists() else {}


def vault(action, text):
    script = Path(__file__).resolve().parents[2] / 'qwen-media-runtime/scripts/vault.ps1'
    result = subprocess.run(['powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(script), '-Action', action], input=text, encoding='utf-8', capture_output=True, timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:
        raise ValueError('登录记录无法安全保存，请重新连接。')
    return result.stdout


def save_session(cookies, channel):
    data = {'cookies': [c for c in cookies if c['domain'].lstrip('.') == 'douyin.com' or c['domain'].endswith('.douyin.com')], 'channel': channel, 'savedAt': time.time()}
    file = config_dir() / 'douyin-session.protected'
    file.parent.mkdir(parents=True, exist_ok=True)
    temporary = file.with_suffix('.tmp')
    temporary.write_text(vault('protect', json.dumps(data)), encoding='utf-8')
    temporary.replace(file)


def load_session():
    file = config_dir() / 'douyin-session.protected'
    if not file.exists():
        raise ValueError('还没有连接抖音，请打开首次配置引导。')
    data = json.loads(vault('unprotect', file.read_text(encoding='utf-8')))
    return data['cookies'], data['channel']
