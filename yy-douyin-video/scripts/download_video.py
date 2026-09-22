"""统一下载：yt-dlp 优先、浏览器回退、最终人工接管。"""
import argparse
import json
from pathlib import Path
import shutil
import signal
import sys

from download_cookies import credentials, private_workspace, write_netscape
from download_support import DownloadError, finalize_media, run_process, share_url


def policy(purpose, resolution):
    if not resolution and purpose == 'download':
        raise DownloadError('RESOLUTION_REQUIRED', '请选择下载分辨率：720p、1080p 或最高可用画质。', ['720', '1080', 'best'])
    return resolution or '720'


def run_route(route, request, directory):
    output = directory / route
    output.mkdir()
    file = output / 'request.json'
    file.write_text(json.dumps({**request, 'route': route, 'output': str(output)}), encoding='utf-8')
    worker = Path(__file__).with_name('download_worker.py')
    result = json.loads(run_process([sys.executable, str(worker), str(file)], 180))
    if result['status'] != 'success':
        raise DownloadError(result['code'], result['message'], result.get('availableResolutions'))
    source = Path(result['file']).resolve()
    if source.parent != output.resolve():
        raise DownloadError('INVALID_OUTPUT', '下载文件路径超出任务目录。')
    return source, result['metadata']


def attempt_routes(request, directory, attempts, runner=run_route, verifier=finalize_media):
    for route in ('yt-dlp', 'browser'):
        print('正在使用 yt-dlp 下载。' if route == 'yt-dlp' else 'yt-dlp 未完成，正在切换浏览器下载。', file=sys.stderr)
        try:
            file, metadata = runner(route, request, directory)
            file, verified = verifier(file, metadata, request['resolution'], request['purpose'])
            attempts.append({'route': route, 'status': 'success'})
            return file, metadata, verified, route
        except DownloadError as error:
            attempts.append({'route': route, 'status': 'failed', **error.report()})
            if error.code == 'LOCAL_IO_FAILED':
                raise
    available = sorted({value for attempt in attempts for value in attempt.get('availableResolutions', [])})
    if any(a.get('code') == 'QUALITY_UNAVAILABLE' for a in attempts):
        raise DownloadError('QUALITY_UNAVAILABLE', '两条路线均未交付指定画质，请选择已知可用画质，或手动下载后提供本地视频。', available)
    raise DownloadError('DOWNLOAD_FAILED', '自动下载失败。请在浏览器打开作品，手动下载后提供本地视频路径，即可继续原任务。')


def write_report(file, report):
    temporary = file.with_suffix('.tmp')
    temporary.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    temporary.replace(file)


def download(args):
    resolution = policy(args.purpose, args.resolution)
    url = share_url(args.share)
    if args.cookies and args.browser:
        raise DownloadError('INVALID_ARGUMENT', 'browser 与 cookies 不能同时指定。')
    for tool in ('ffmpeg', 'ffprobe'):
        if not shutil.which(tool):
            raise DownloadError('DEPENDENCY_MISSING', f'缺少 {tool}，请重新准备工具。')
        try:
            run_process([tool, '-version'], 15)
        except (DownloadError, OSError):
            raise DownloadError('DEPENDENCY_MISSING', f'{tool} 无法运行，请重新准备工具。') from None
    output = Path(args.out).resolve()
    if output.exists():
        raise DownloadError('OUTPUT_EXISTS', '输出目录已存在，请使用新的任务目录。')
    output.mkdir(parents=True)
    attempts = []
    try:
        return execute_download(args, resolution, url, output, attempts)
    except DownloadError as error:
        error.attempts = attempts
        write_report(output / 'download-error.json', {'status': 'failed', **error.report(), 'attempts': attempts})
        raise
    except KeyboardInterrupt:
        write_report(output / 'download-error.json', {'status': 'cancelled', 'code': 'CANCELLED', 'attempts': attempts})
        raise
    except OSError:
        error = DownloadError('LOCAL_IO_FAILED', '本地文件操作失败，请检查磁盘空间和目录权限。')
        error.attempts = attempts
        write_report(output / 'download-error.json', {'status': 'failed', **error.report(), 'attempts': attempts})
        raise error from None


def execute_download(args, resolution, url, output, attempts):
    with private_workspace() as temporary:
        cookies, channel = credentials(args.cookies, args.browser)
        cookie_file, session_file = temporary / 'cookies.txt', temporary / 'session.json'
        write_netscape(cookie_file, cookies)
        session_file.write_text(json.dumps(cookies), encoding='utf-8')
        request = {'url': url, 'cookiesFile': str(cookie_file), 'sessionFile': str(session_file),
                   'channel': channel, 'resolution': resolution, 'purpose': args.purpose}
        file, metadata, verified, route = attempt_routes(request, temporary, attempts)
        video = output / 'video.mp4'
        staging = output / 'video.part.mp4'
        report = {'status': 'success', 'source': url, 'videoId': metadata['videoId'], 'title': metadata.get('title'),
                  'allowDownload': metadata.get('allowDownload'),
                  'video': str(video), 'bytes': file.stat().st_size, 'fullDecodeVerified': True, **verified,
                  'purpose': args.purpose, 'requestedResolution': resolution, 'route': route, 'attempts': attempts}
        try:
            shutil.copyfile(file, staging)
            staging.replace(video)
            write_report(output / 'download.json', report)
        except BaseException:
            video.unlink(missing_ok=True)
            staging.unlink(missing_ok=True)
            raise
        return report


def main():
    def cancelled(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, cancelled)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--share', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--purpose', choices=('download', 'analysis'), default='download')
    parser.add_argument('--resolution', choices=('720', '1080', 'best'))
    parser.add_argument('--cookies')
    parser.add_argument('--browser', choices=('chrome', 'edge', 'firefox'))
    args = parser.parse_args()
    try:
        result = download(args)
        code = 0
    except DownloadError as error:
        result, code = {'status': 'failed', **error.report(), 'attempts': getattr(error, 'attempts', [])}, 1
    except KeyboardInterrupt:
        result, code = {'status': 'cancelled', 'code': 'CANCELLED', 'message': '用户已取消下载。'}, 130
    except Exception:
        result, code = {'status': 'failed', 'code': 'LOCAL_ERROR', 'message': '本地执行或文件操作失败，请检查工具和输出目录。'}, 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return code


if __name__ == '__main__':
    sys.exit(main())
