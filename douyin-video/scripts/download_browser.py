"""在独立 Chrome 会话中获取抖音播放地址并验证完整视频。"""
import argparse
import asyncio
import json
import math
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import urlparse

from playwright.async_api import async_playwright


def share_url(text):
    urls = re.findall(r'https://[^\s<>"\])]+', text.replace('\\_', '_'))
    valid = set()
    for url in urls:
        parsed = urlparse(url)
        if parsed.hostname in ('v.douyin.com', 'www.douyin.com', 'douyin.com') and not parsed.username and not parsed.password and parsed.port is None:
            valid.add(url)
    if len(valid) != 1:
        raise ValueError('每次提供一个抖音链接或分享文案。')
    return valid.pop()


def read_cookies(file):
    data = json.loads(Path(file).read_text(encoding='utf-8-sig'))
    if not isinstance(data, list):
        raise ValueError('此浏览器入口需要浏览器导出的 JSON Cookie 数组。')
    result = []
    for c in data:
        domain = c.get('domain', '')
        if domain.lstrip('.') != 'douyin.com' and not domain.endswith('.douyin.com'):
            continue
        if not c.get('name'):
            continue
        if not isinstance(c['name'], str) or not isinstance(c.get('value'), str):
            raise ValueError('Cookie 字段无效。')
        result.append({key: c[key] for key in ('name', 'value', 'domain')} | {
            'path': c.get('path', '/'), 'secure': bool(c.get('secure')),
            'httpOnly': bool(c.get('httpOnly')),
        })
    if not result:
        raise ValueError('未找到抖音 Cookie。')
    return result


async def video_detail(page, url):
    details = {}
    async def capture(response):
        if '/aweme/v1/web/aweme/detail/' not in response.url or response.status != 200:
            return
        text = await response.text()
        if not text.strip():
            return
        try:
            item = json.loads(text).get('aweme_detail')
        except json.JSONDecodeError:
            return
        if item:
            details[item['aweme_id']] = item
    page.on('response', capture)
    await page.goto(url, wait_until='domcontentloaded', timeout=45000)
    match = re.search(r'(?:/video/|modal_id=)(\d+)', page.url)
    if not match:
        raise ValueError('分享链接未跳转到单个视频页面。')
    video_id = match.group(1)
    await page.wait_for_function('''() => [...document.querySelectorAll('video')].some(v => v.readyState >= 2 && Number.isFinite(v.duration) && v.duration > 0)''', timeout=45000)
    await page.wait_for_timeout(10000)
    if video_id in details:
        return details[video_id]
    result = await page.evaluate('''async id => {
        const response = await fetch('/aweme/v1/web/aweme/detail/?aweme_id=' + id);
        const text = await response.text();
        return {status:response.status, data:response.ok && text.trim() ? JSON.parse(text) : null};
    }''', video_id)
    detail = (result.get('data') or {}).get('aweme_detail')
    if not detail or detail.get('aweme_id') != video_id:
        raise ValueError(f'浏览器详情请求失败（HTTP {result["status"]}），请确认页面能正常播放。')
    return detail


async def save_video(context, detail, output):
    urls = detail.get('video', {}).get('play_addr', {}).get('url_list', [])
    if not urls or urlparse(urls[0]).scheme != 'https':
        raise ValueError('未取得 HTTPS 播放地址。')
    response = await context.request.get(urls[0], headers={'Referer': 'https://www.douyin.com/'}, timeout=60000)
    if response.status != 200:
        raise ValueError(f'媒体请求失败（HTTP {response.status}）。')
    body = await response.body()
    if len(body) > 500 * 1024 * 1024 or b'ftyp' not in body[:32]:
        raise ValueError('返回内容不是允许大小内的 MP4。')
    temporary = output / 'video.part.mp4'
    temporary.write_bytes(body)
    return temporary


def verify_video(file, expected_duration):
    creationflags = subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
    probe = subprocess.run(['ffprobe', '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(file)], capture_output=True, check=True, timeout=30, creationflags=creationflags)
    data = json.loads(probe.stdout)
    duration = float(data['format']['duration'])
    video = next(s for s in data['streams'] if s['codec_type'] == 'video')
    if not math.isfinite(expected_duration) or expected_duration <= 0 or not math.isfinite(duration) or duration <= 0 or abs(duration - expected_duration) > 1:
        raise ValueError('下载文件时长与详情不一致，可能是分片或不完整视频。')
    subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-nostdin', '-i', str(file), '-f', 'null', '-'], capture_output=True, check=True, timeout=180, creationflags=creationflags)
    return {'durationSeconds': duration, 'width': video['width'], 'height': video['height'], 'hasAudio': any(s['codec_type'] == 'audio' for s in data['streams'])}


async def download(args):
    url = share_url(args.share)
    cookies = read_cookies(args.cookies)
    output = Path(args.out).resolve()
    output.mkdir(parents=True, exist_ok=False)
    async with async_playwright() as p:
        options = {'channel': 'chrome', 'headless': True, 'args': ['--mute-audio']}
        if os.environ.get('HTTPS_PROXY'):
            options['proxy'] = {'server': os.environ['HTTPS_PROXY']}
        browser = await p.chromium.launch(**options)
        try:
            context = await browser.new_context()
            await context.add_cookies(cookies)
            detail = await video_detail(await context.new_page(), url)
            temporary = await save_video(context, detail, output)
            expected = float(detail['video']['duration']) / 1000
            verified = await asyncio.to_thread(verify_video, temporary, expected)
            video = output / 'video.mp4'
            temporary.rename(video)
            report = {'source': url, 'videoId': detail['aweme_id'], 'title': detail.get('desc'), 'allowDownload': detail.get('video_control', {}).get('allow_download'), 'video': str(video), 'bytes': video.stat().st_size, 'fullDecodeVerified': True, **verified}
            (output / 'download.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
            print(json.dumps(report, ensure_ascii=False, indent=2))
        finally:
            await browser.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('share', 'cookies', 'out'):
        parser.add_argument(f'--{name}', required=True)
    try:
        asyncio.run(download(parser.parse_args()))
    except Exception as error:
        # 浏览器异常可能携带签名 URL；仅输出本脚本的受控错误。
        message = str(error) if isinstance(error, ValueError) else f'执行失败（{type(error).__name__}），检查 Chrome、网络和页面验证状态。'
        parser.exit(1, message + '\n')
