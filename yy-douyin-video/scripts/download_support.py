"""下载公共协议、进程管理与媒体校验。"""
import json
import math
import os
from pathlib import Path
import re
import signal
import subprocess
import time
from urllib.parse import urlparse

MAX_BYTES = 500 * 1024 * 1024


class DownloadError(Exception):
    def __init__(self, code, message, available=None):
        super().__init__(message)
        self.code = code
        self.available = available or []

    def report(self):
        return {'code': self.code, 'message': str(self), 'availableResolutions': self.available}


def share_url(text):
    urls = re.findall(r'https://[^\s<>"\])]+', text.replace('\\_', '_'))
    valid = set()
    for url in urls:
        parsed = urlparse(url)
        if parsed.hostname in ('v.douyin.com', 'www.douyin.com', 'douyin.com') and not parsed.username and not parsed.password and parsed.port is None:
            valid.add(url)
    if len(valid) != 1:
        raise DownloadError('INVALID_SHARE', '每次提供一个抖音链接或分享文案。')
    return valid.pop()


def stop_process(process):
    if process.poll() is not None:
        return
    if os.name == 'nt':
        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'], capture_output=True, timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
    else:
        os.killpg(process.pid, signal.SIGKILL)
    process.wait(timeout=15)


def run_process(command, timeout=180):
    options = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {'start_new_session': True}
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **options)
    try:
        deadline = time.monotonic() + timeout
        while True:
            if os.environ.get('QWEN_MEDIA_CANCEL_FILE') and Path(os.environ['QWEN_MEDIA_CANCEL_FILE']).exists():
                raise KeyboardInterrupt
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise subprocess.TimeoutExpired(command, timeout)
            try:
                stdout, stderr = process.communicate(timeout=min(.25, remaining))
                break
            except subprocess.TimeoutExpired:
                continue
    except subprocess.TimeoutExpired:
        stop_process(process)
        raise DownloadError('TIMEOUT', '当前下载或校验阶段超时。') from None
    except BaseException:
        stop_process(process)
        raise
    if os.environ.get('QWEN_MEDIA_CANCEL_FILE') and Path(os.environ['QWEN_MEDIA_CANCEL_FILE']).exists():
        raise KeyboardInterrupt
    if process.returncode:
        raise classify_error(stderr.decode('utf-8', errors='replace'))
    return stdout.decode('utf-8', errors='replace')


def classify_error(text):
    # 只输出固定文案，原始诊断可能包含 Cookie 或签名 URL。
    rules = [
        (r'403|Forbidden', 'HTTP_FORBIDDEN', '接口返回 HTTP 403，不能仅凭此判断 Cookie 已过期。'),
        (r'captcha|验证码', 'CAPTCHA_REQUIRED', '页面要求验证码，需人工完成验证。'),
        (r'Fresh cookies', 'ACCESS_REJECTED', '提取器要求可用 Cookie，但尚不能确认登录已过期。'),
        (r'login required|sign in|登录后', 'LOGIN_REQUIRED', '页面明确要求登录，请重新连接抖音。'),
        (r'timed out|timeout', 'TIMEOUT', '网络或页面等待超时。'),
        (r'No module named|Executable doesn.t exist', 'DEPENDENCY_MISSING', '该下载路线的运行依赖缺失，请重新准备工具。'),
        (r'Requested format is not available', 'QUALITY_UNAVAILABLE', '该路线未提供要求的画质。'),
        (r'cookie database|DPAPI|decrypt', 'COOKIE_READ_FAILED', '无法读取显式指定的浏览器登录记录。'),
    ]
    for pattern, code, message in rules:
        if re.search(pattern, text, re.I):
            return DownloadError(code, message)
    return DownloadError('ROUTE_FAILED', '该路线执行失败，未取得可确认的具体原因。')


def quality_choice(formats, resolution, purpose):
    valid = [f for f in formats if f.get('width', 0) and f.get('height', 0)]
    if not valid:
        raise DownloadError('METADATA_MISSING', '未取得有效的画质信息。')
    short = lambda f: min(int(f['width']), int(f['height']))
    if resolution == 'best':
        return max(valid, key=short)
    target = int(resolution)
    eligible = [f for f in valid if short(f) >= target]
    if eligible:
        return min(eligible, key=short)
    if purpose == 'analysis':
        return max(valid, key=short)
    raise DownloadError('QUALITY_UNAVAILABLE', '无法提供指定分辨率，请选择可用画质。', sorted({short(f) for f in valid}))


def verify_video(file, expected_duration, expected_audio=False):
    if not file.is_file() or not 0 < file.stat().st_size <= MAX_BYTES:
        raise DownloadError('INVALID_MEDIA', '视频为空、缺失或超过 500 MiB。')
    try:
        data = json.loads(run_process(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(file)], 30))
        duration = float(data.get('format', {}).get('duration', 0))
    except (DownloadError, ValueError, TypeError):
        raise DownloadError('INVALID_MEDIA', '视频无法读取或缺少有效时长。') from None
    video = next((s for s in data.get('streams', []) if s['codec_type'] == 'video'), None)
    if not video or not math.isfinite(duration) or duration <= 0:
        raise DownloadError('INVALID_MEDIA', '文件缺少有效视频流或时长。')
    if not math.isfinite(expected_duration) or expected_duration <= 0:
        raise DownloadError('METADATA_MISSING', '未取得可用于核对完整性的作品时长。')
    if abs(duration - expected_duration) > 1:
        raise DownloadError('INCOMPLETE_MEDIA', f'文件时长 {duration:.2f} 秒与作品预期 {expected_duration:.2f} 秒不符，可能是不完整分片。')
    audio = any(s['codec_type'] == 'audio' for s in data['streams'])
    if expected_audio and not audio:
        raise DownloadError('AUDIO_MISSING', '原素材有音轨，但下载文件缺少音轨。')
    try:
        run_process(['ffmpeg', '-v', 'error', '-xerror', '-nostdin', '-i', str(file), '-map', '0:v:0', '-map', '0:a?', '-f', 'null', '-'])
    except DownloadError as error:
        if error.code == 'TIMEOUT':
            raise
        raise DownloadError('DECODE_FAILED', '视频全片解码失败，未交付损坏文件。') from None
    return {'durationSeconds': duration, 'width': video['width'], 'height': video['height'], 'hasAudio': audio}


def finalize_media(file, metadata, resolution, purpose):
    try:
        duration = float(metadata.get('duration') or 0)
    except (TypeError, ValueError):
        raise DownloadError('METADATA_MISSING', '未取得有效的作品时长。') from None
    verified = verify_video(file, duration, metadata.get('hasAudio', False))
    quality_choice([verified], resolution, purpose)
    target = None if resolution == 'best' else int(resolution)
    if target and min(verified['width'], verified['height']) > target:
        scaled = file.with_name('scaled.mp4')
        scale = rf"scale=if(gte(iw\,ih)\,-2\,{target}):if(gte(iw\,ih)\,{target}\,-2)"
        run_process(['ffmpeg', '-v', 'error', '-nostdin', '-n', '-i', str(file), '-map', '0:v:0', '-map', '0:a:0?', '-vf', scale, '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-c:a', 'aac', '-movflags', '+faststart', str(scaled)])
        file = scaled
        verified = verify_video(file, float(metadata['duration']), metadata.get('hasAudio', False))
    return file, verified
