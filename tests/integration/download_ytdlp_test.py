"""用本地 HTTP 素材检验真实 yt-dlp 画质选择与文件下载，不访问外网。"""
import functools
import http.server
import json
import os
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'yy-douyin-video/scripts'))
from download_support import run_process, verify_video
from download_ytdlp import download


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


class YtdlpTests(unittest.TestCase):
    def test_actual_download_uses_selected_resolution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for size in ('1280x720', '1920x1080'):
                run_process(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', f'color=s={size}:d=1', '-f', 'lavfi', '-i', 'sine=duration=1', '-c:v', 'libx264', '-c:a', 'aac', str(root / f'{size}.mp4')])
            run_process(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=s=1280x720:d=1', '-c:v', 'libx264', str(root / 'silent.mp4')])
            handler = functools.partial(QuietHandler, directory=str(root))
            server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), handler)
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                self.check_download(root, server.server_port)
            finally:
                server.shutdown()
                server.server_close()
                thread.join()

    def check_download(self, root, port):
        formats = [{'format_id': str(height), 'width': width, 'height': height, 'vcodec': 'h264', 'acodec': 'aac',
                    'ext': 'mp4', 'url': f'http://127.0.0.1:{port}/{width}x{height}.mp4'} for width, height in [(1280, 720), (1920, 1080)]]
        formats.insert(0, {**formats[0], 'format_id': 'silent', 'acodec': 'none', 'url': f'http://127.0.0.1:{port}/silent.mp4'})
        info = {'id': '1234', 'title': 'offline', 'duration': 1, 'extractor': 'generic', 'extractor_key': 'Generic',
                'webpage_url': 'https://www.douyin.com/video/1234', 'formats': formats, **formats[-1]}
        cookie_file = root / 'cookies.txt'
        cookie_file.write_text('# Netscape HTTP Cookie File\n', encoding='utf-8')
        for resolution, expected in [('720', 720), ('1080', 1080), ('best', 1080)]:
            output = root / resolution
            output.mkdir()
            def command(args, timeout=180):
                if '--dump-single-json' in args:
                    return json.dumps(info)
                return run_process(args, timeout)
            with patch('download_ytdlp.run_process', side_effect=command), patch.dict(os.environ, {'HTTPS_PROXY': '', 'HTTP_PROXY': '', 'ALL_PROXY': ''}):
                file, metadata = download('https://www.douyin.com/video/1234', output, cookie_file, resolution, 'analysis')
            self.assertEqual(verify_video(file, 1, True)['height'], expected)
            self.assertEqual(metadata['videoId'], '1234')


if __name__ == '__main__':
    unittest.main()
