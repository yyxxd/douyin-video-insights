"""打开独立的抖音登录窗口，由用户自行完成登录。"""
import argparse
import asyncio
import os
import time
from playwright.async_api import async_playwright
from browser_session import save_session


async def connect(channel):
    async with async_playwright() as p:
        options = {'channel': channel, 'headless': False}
        if os.environ.get('HTTPS_PROXY'):
            options['proxy'] = {'server': os.environ['HTTPS_PROXY']}
        browser = await p.chromium.launch(**options)
        try:
            context = await browser.new_context()
            page = await context.new_page()
            await page.goto('https://www.douyin.com/', wait_until='domcontentloaded', timeout=45000)
            deadline = time.monotonic() + 300
            while time.monotonic() < deadline:
                if page.is_closed():
                    raise ValueError('登录窗口已关闭，可以重新打开继续。')
                cookies = await context.cookies('https://www.douyin.com/')
                if any(c['name'] in ('sessionid', 'sessionid_ss', 'sid_guard') and c['value'] for c in cookies):
                    save_session(cookies, channel)
                    print('LOGIN_SAVED')
                    return
                await asyncio.sleep(1)
            raise ValueError('登录等待已结束，已完成的其他配置会保留。')
        finally:
            await browser.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--browser', choices=['chrome', 'msedge'], required=True)
    args = parser.parse_args()
    try:
        asyncio.run(connect(args.browser))
    except Exception as error:
        parser.exit(1, (str(error) if isinstance(error, ValueError) else '浏览器连接失败，请确认已安装所选浏览器并检查网络。') + '\n')
