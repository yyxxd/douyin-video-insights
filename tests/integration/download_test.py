"""下载策略离线验收；不访问抖音，不读取真实凭据。"""
import argparse
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'yy-douyin-video/scripts'))
from download_cookies import normalize, private_workspace, read_cookies, write_netscape
from download_support import DownloadError, classify_error, finalize_media, quality_choice, run_process, share_url, verify_video
from download_video import attempt_routes, download, policy
from download_browser import video_formats
from browser_session import save_session


class DownloadTests(unittest.TestCase):
    def test_policy(self):
        self.assertEqual(policy('analysis', None), '720')
        with self.assertRaises(DownloadError) as error:
            policy('download', None)
        self.assertEqual(error.exception.code, 'RESOLUTION_REQUIRED')
        self.assertEqual(policy('download', 'best'), 'best')

    def test_quality(self):
        formats = [{'width': 1080, 'height': 1920}, {'width': 1280, 'height': 720}, {'width': 540, 'height': 960}]
        self.assertEqual(quality_choice(formats, '720', 'analysis'), formats[1])
        self.assertEqual(quality_choice(formats[:1], '720', 'download'), formats[0])
        self.assertEqual(quality_choice(formats, 'best', 'download'), formats[0])
        self.assertEqual(quality_choice(formats[2:], '720', 'analysis'), formats[2])
        with self.assertRaises(DownloadError) as error:
            quality_choice(formats[2:], '1080', 'download')
        self.assertEqual(error.exception.available, [540])

    def test_cookie_roundtrip(self):
        base = {'domain': '.douyin.com', 'name': 'sessionid', 'value': 'test', 'secure': True, 'httpOnly': True}
        future = int(time.time()) + 6000
        items = normalize([{**base, 'expires': -1}, {**base, 'name': 'future', 'expirationDate': future},
                           {**base, 'name': 'expired', 'expires': 1}, {**base, 'domain': '.example.com'}])
        self.assertEqual(len(items), 2)
        self.assertEqual(items[1]['expires'], future)
        with private_workspace() as directory:
            file = directory / 'cookies.txt'
            write_netscape(file, items)
            self.assertEqual(read_cookies(file), items)
        self.assertFalse(directory.exists())
        with self.assertRaises(DownloadError):
            normalize([{**base, 'value': 'secret\nunsafe'}])

    def test_cleanup_failure_and_active_lock(self):
        with private_workspace() as first:
            os.utime(first, (time.time() - 120, time.time() - 120))
            with self.assertRaises(RuntimeError):
                with private_workspace() as second:
                    self.assertTrue(first.exists())
                    raise RuntimeError('模拟失败')
            self.assertFalse(second.exists())
        self.assertFalse(first.exists())

    @unittest.skipUnless(os.name == 'nt', 'DPAPI 仅 Windows')
    def test_saved_session_reused(self):
        from download_cookies import credentials
        cookie = {'domain': '.douyin.com', 'name': 'sessionid', 'value': 'offline-secret', 'expires': -1}
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'QWEN_MEDIA_CONFIG_DIR': directory}):
            save_session([cookie], 'msedge')
            encrypted = (Path(directory) / 'douyin-session.protected').read_text(encoding='utf-8')
            self.assertNotIn('offline-secret', encrypted)
            cookies, channel = credentials()
            self.assertEqual(cookies[0]['value'], 'offline-secret')
            self.assertEqual(channel, 'msedge')

    def run_routes(self, failures, verification_failure=False):
        calls, attempts = [], []
        def runner(route, request, directory):
            calls.append(route)
            if route in failures:
                raise DownloadError('HTTP_FORBIDDEN', 'HTTP 403')
            return Path(route), {'duration': 1}
        def verifier(file, metadata, resolution, purpose):
            if verification_failure and str(file) == 'yt-dlp':
                raise DownloadError('INCOMPLETE_MEDIA', '不完整')
            return file, {'width': 720, 'height': 1280}
        try:
            result = attempt_routes({'resolution': '720', 'purpose': 'analysis'}, Path('.'), attempts, runner, verifier)
        except DownloadError as error:
            result = error.code
        return result, calls, attempts

    def test_first_success(self):
        result, calls, attempts = self.run_routes([])
        self.assertEqual(calls, ['yt-dlp'])
        self.assertEqual(result[-1], 'yt-dlp')

    def test_fallback_success(self):
        result, calls, attempts = self.run_routes(['yt-dlp'])
        self.assertEqual(calls, ['yt-dlp', 'browser'])
        self.assertEqual(result[-1], 'browser')
        self.assertEqual(attempts[0]['code'], 'HTTP_FORBIDDEN')

    def test_double_failure(self):
        result, calls, attempts = self.run_routes(['yt-dlp', 'browser'])
        self.assertEqual(result, 'DOWNLOAD_FAILED')
        self.assertEqual(len(attempts), 2)

    def test_invalid_file_falls_back(self):
        result, calls, attempts = self.run_routes([], True)
        self.assertEqual(result[-1], 'browser')
        self.assertEqual(attempts[0]['code'], 'INCOMPLETE_MEDIA')

    def test_cancel_does_not_fallback(self):
        with self.assertRaises(KeyboardInterrupt):
            attempt_routes({}, Path('.'), [], runner=lambda *args: (_ for _ in ()).throw(KeyboardInterrupt()))

    def test_timeout_and_redaction(self):
        with self.assertRaises(DownloadError) as error:
            run_process([sys.executable, '-c', 'import time; time.sleep(10)'], .2)
        self.assertEqual(error.exception.code, 'TIMEOUT')
        report = classify_error('403 Cookie: private https://example.com/?secret=token').report()
        self.assertNotIn('private', str(report))
        self.assertNotIn('token', str(report))

    def test_cooperative_cancel(self):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / 'cancel'
            timer = threading.Timer(.3, marker.touch)
            timer.start()
            try:
                with patch.dict(os.environ, {'QWEN_MEDIA_CANCEL_FILE': str(marker)}), self.assertRaises(KeyboardInterrupt):
                    run_process([sys.executable, '-c', 'import time; time.sleep(15)'])
            finally:
                timer.join()

    def test_output_conflict_and_login_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            args = argparse.Namespace(purpose='analysis', resolution=None, share='https://v.douyin.com/abc/',
                                      out=directory, cookies=None, browser=None)
            sentinel = Path(directory) / 'existing.txt'
            sentinel.write_text('unchanged')
            with self.assertRaises(DownloadError) as error:
                download(args)
            self.assertEqual(error.exception.code, 'OUTPUT_EXISTS')
            self.assertEqual(sentinel.read_text(), 'unchanged')
            args.out = str(Path(directory) / 'failed')
            with patch('download_video.credentials', side_effect=DownloadError('LOGIN_UNAVAILABLE', '重新连接')), self.assertRaises(DownloadError):
                download(args)
            report = json.loads((Path(args.out) / 'download-error.json').read_text(encoding='utf-8'))
            self.assertEqual(report['attempts'], [])
            self.assertFalse((Path(args.out) / 'video.mp4').exists())

    def test_validation_and_missing_selection(self):
        self.assertEqual(share_url('文案 https://v.douyin.com/abc/'), 'https://v.douyin.com/abc/')
        with self.assertRaises(DownloadError):
            share_url('https://v.douyin.com.evil.test/abc')
        args = argparse.Namespace(purpose='download', resolution=None, share='https://v.douyin.com/abc/', out='unused')
        with patch('download_video.credentials') as login, self.assertRaises(DownloadError):
            download(args)
        login.assert_not_called()

    def test_browser_variants(self):
        detail = {'video': {'width': 1080, 'height': 1920, 'play_addr': {'url_list': ['https://example.com/original']},
                           'bit_rate': [{'play_addr': {'width': 720, 'height': 1280, 'url_list': ['https://example.com/720']}}]}}
        selected = quality_choice(video_formats(detail), '720', 'analysis')
        self.assertEqual(selected['url'], 'https://example.com/720')

    def test_media(self):
        with tempfile.TemporaryDirectory() as temporary:
            for width, height in [(1280, 720), (720, 1280), (960, 540)]:
                directory = Path(temporary) / str(width)
                directory.mkdir()
                file = directory / 'source.mp4'
                run_process(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', f'color=s={width}x{height}:d=1', '-c:v', 'libx264', str(file)])
                result, probe = finalize_media(file, {'duration': 1}, '720', 'analysis')
                self.assertEqual(min(probe['width'], probe['height']), min(width, height))
                with self.assertRaises(DownloadError):
                    verify_video(file, 5)
                with self.assertRaises(DownloadError):
                    verify_video(file, 1, True)
            source = Path(temporary) / 'large.mp4'
            run_process(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=s=1080x1920:d=1', '-c:v', 'libx264', str(source)])
            result, probe = finalize_media(source, {'duration': 1}, '720', 'analysis')
            self.assertEqual((probe['width'], probe['height']), (720, 1280))
            source.write_bytes(b'not a video')
            with self.assertRaises(DownloadError):
                verify_video(source, 1)


if __name__ == '__main__':
    unittest.main()
