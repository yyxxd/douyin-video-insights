"""浏览器下载适配器；命令行兼容入口转交统一下载策略。"""
import asyncio
import os
import re
from urllib.parse import urlparse

from download_support import DownloadError, MAX_BYTES, quality_choice


async def page_failure(page):
    if await page.locator('[id*="captcha"]:visible, [class*="captcha"]:visible').count():
        raise DownloadError('CAPTCHA_REQUIRED', '页面要求验证码，请在浏览器中人工完成验证。')
    text = await page.locator('body').inner_text(timeout=3000)
    if re.search(r'作品已删除|视频已删除|作品不存在|私密作品|无权查看', text):
        raise DownloadError('VIDEO_UNAVAILABLE', '页面明确提示作品已删除、私密或不可访问。')
    if re.search(r'登录后即可观看|请登录后观看', text):
        raise DownloadError('LOGIN_REQUIRED', '页面明确要求登录后观看。')


async def video_detail(page, url):
    details = {}
    async def capture(response):
        if '/aweme/v1/web/aweme/detail/' not in response.url or response.status != 200:
            return
        try:
            item = (await response.json()).get('aweme_detail')
            if item:
                details[str(item['aweme_id'])] = item
        except Exception:
            details['_capture_failed'] = True
    page.on('response', capture)
    await page.goto(url, wait_until='domcontentloaded', timeout=45000)
    await page_failure(page)
    match = re.search(r'(?:/video/|modal_id=)(\d+)', page.url)
    requested = re.search(r'(?:/video/|modal_id=)(\d+)', url)
    if not match or (requested and requested.group(1) != match.group(1)):
        raise DownloadError('ID_MISMATCH', '分享链接未跳转到对应的单个视频页面。')
    video_id = match.group(1)
    try:
        await page.wait_for_function('''() => [...document.querySelectorAll('video')].some(v => v.readyState >= 2 && Number.isFinite(v.duration) && v.duration > 0)''', timeout=45000)
    except Exception:
        await page_failure(page)
        raise DownloadError('PAGE_TIMEOUT', '页面等待视频播放超时，未确认具体拦截原因。') from None
    for _ in range(20):
        if video_id in details:
            return details[video_id]
        await page.wait_for_timeout(500)
    return await request_detail(page, video_id)


async def request_detail(page, video_id):
    result = await page.evaluate('''async id => {
        const response = await fetch('/aweme/v1/web/aweme/detail/?aweme_id=' + id);
        const text = await response.text();
        return {status:response.status, data:response.ok && text.trim() ? JSON.parse(text) : null};
    }''', video_id)
    detail = (result.get('data') or {}).get('aweme_detail')
    if not detail or str(detail.get('aweme_id')) != video_id:
        status = result['status']
        raise DownloadError('HTTP_FORBIDDEN' if status == 403 else 'DETAIL_FAILED', f'浏览器作品详情请求失败（HTTP {status}）。')
    return detail


def video_formats(detail):
    video = detail.get('video', {})
    addresses = [video.get('play_addr', {})]
    addresses += [item.get('play_addr', {}) for item in video.get('bit_rate', [])]
    result = []
    for address in addresses:
        urls = [url for url in address.get('url_list', []) if urlparse(url).scheme == 'https']
        if urls:
            result.append({'url': urls[0], 'width': address.get('width') or video.get('width', 0),
                           'height': address.get('height') or video.get('height', 0)})
    return result


def transfer_media(selected, output, jar):
    import urllib.request
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    request = urllib.request.Request(selected['url'], headers={'Referer': 'https://www.douyin.com/', 'User-Agent': 'Mozilla/5.0'})
    file = output / 'source.mp4'
    with opener.open(request, timeout=60) as response, file.open('wb') as target:
        size = 0
        while chunk := response.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_BYTES:
                raise DownloadError('FILE_TOO_LARGE', '下载文件超过 500 MiB。')
            target.write(chunk)
    return file


async def save_video(context, selected, output):
    # 流式下载限制内存占用，Cookie 由域匹配控制，不向 CDN 拼接 Cookie 头。
    import http.cookiejar
    from download_cookies import normalize, write_netscape
    cookie_file = output / 'media-cookies.txt'
    write_netscape(cookie_file, normalize(await context.cookies()))
    jar = http.cookiejar.MozillaCookieJar(str(cookie_file))
    jar.load(ignore_discard=True, ignore_expires=True)
    for cookie in jar:
        if cookie.expires == 0:
            cookie.expires = None
            cookie.discard = True
    return await asyncio.to_thread(transfer_media, selected, output, jar)


async def fetch_video(url, output, cookies, channel, resolution, purpose):
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        engine = p.firefox if channel == 'firefox' else p.chromium
        options = {'headless': True}
        if channel != 'firefox':
            options.update(channel=channel, args=['--mute-audio'])
        if os.environ.get('HTTPS_PROXY'):
            options['proxy'] = {'server': os.environ['HTTPS_PROXY']}
        try:
            browser = await engine.launch(**options)
        except Exception:
            raise DownloadError('BROWSER_START_FAILED', '配置的浏览器无法启动，请检查浏览器安装。') from None
        try:
            context = await browser.new_context()
            await context.add_cookies(cookies)
            detail = await video_detail(await context.new_page(), url)
            selected = quality_choice(video_formats(detail), resolution, purpose)
            file = await save_video(context, selected, output)
            return file, {'videoId': str(detail['aweme_id']), 'title': detail.get('desc'),
                          'duration': float(detail['video']['duration']) / 1000,
                          'allowDownload': detail.get('video_control', {}).get('allow_download'),
                          'hasAudio': bool(detail.get('music'))}
        finally:
            await browser.close()


if __name__ == '__main__':
    from download_video import main
    raise SystemExit(main())
