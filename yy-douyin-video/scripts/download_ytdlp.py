"""通过受控 yt-dlp 子进程提取和下载，元数据只保存在私有临时目录。"""
import json
import os
from pathlib import Path
import re
import sys

from download_support import DownloadError, quality_choice, run_process


def download(url, output, cookie_file, resolution, purpose):
    base = [sys.executable, '-m', 'yt_dlp', '--ignore-config', '--no-playlist', '--no-progress',
            '--socket-timeout', '20', '--retries', '0', '--fragment-retries', '0', '--extractor-retries', '0',
            '--max-filesize', '500M', '--no-cache-dir', '--cookies', str(cookie_file)]
    if os.environ.get('HTTPS_PROXY'):
        base += ['--proxy', os.environ['HTTPS_PROXY']]
    info = json.loads(run_process(base + ['--skip-download', '--dump-single-json', '--', url]))
    video_id = str(info.get('id', ''))
    match = re.search(r'(?:/video/|modal_id=)(\d+)', url)
    if not video_id.isdigit() or (match and match.group(1) != video_id):
        raise DownloadError('ID_MISMATCH', '提取结果与目标作品 ID 不一致。')
    audio = [f for f in info.get('formats', []) if f.get('vcodec') == 'none' and f.get('acodec') not in (None, 'none')]
    formats = [f for f in info.get('formats', []) if f.get('vcodec') != 'none']
    muxed = [f for f in formats if f.get('acodec') not in (None, 'none')]
    selected = quality_choice(formats if audio or not muxed else muxed, resolution, purpose)
    selection = selected['format_id']
    has_audio = selected.get('acodec') not in (None, 'none')
    if selected.get('acodec') == 'none' and audio:
        selection += '+' + max(audio, key=lambda f: f.get('abr') or 0)['format_id']
        has_audio = True
    metadata = output / 'source.info.json'
    # load-info-json 失败时会用 webpage_url 重新提取；由统一编排回退，禁用隐式重试。
    info.pop('webpage_url', None)
    metadata.write_text(json.dumps(info), encoding='utf-8')
    result = run_process(base + ['--load-info-json', str(metadata), '-f', selection, '--merge-output-format', 'mp4',
                                '--remux-video', 'mp4', '-o', str(output / 'source.%(ext)s'), '--print', 'after_move:filepath'])
    file = Path(result.strip().splitlines()[-1]).resolve()
    if file.parent != output.resolve():
        raise DownloadError('INVALID_OUTPUT', '下载文件路径超出当前任务目录。')
    return file, {'videoId': video_id, 'title': info.get('title'), 'duration': info.get('duration'),
                  'hasAudio': has_audio or bool(muxed) or bool(info.get('track'))}
