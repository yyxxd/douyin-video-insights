"""隔离单条下载路线；父进程负责总超时与进程树回收。"""
import asyncio
import json
from pathlib import Path
import sys

from download_support import DownloadError, classify_error


def main():
    request = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    output = Path(request['output'])
    try:
        if request['route'] == 'yt-dlp':
            from download_ytdlp import download
            file, metadata = download(request['url'], output, request['cookiesFile'], request['resolution'], request['purpose'])
        else:
            from download_browser import fetch_video
            cookies = json.loads(Path(request['sessionFile']).read_text(encoding='utf-8'))
            file, metadata = asyncio.run(fetch_video(request['url'], output, cookies, request['channel'], request['resolution'], request['purpose']))
        result = {'status': 'success', 'file': str(file), 'metadata': metadata}
    except DownloadError as error:
        result = {'status': 'failed', **error.report()}
    except OSError as error:
        code = 'LOCAL_IO_FAILED' if error.errno in (13, 28) else 'ROUTE_FAILED'
        result = {'status': 'failed', 'code': code, 'message': '本地文件写入失败。' if code == 'LOCAL_IO_FAILED' else '该路线无法启动或读取文件。'}
    except Exception as error:
        result = {'status': 'failed', **classify_error(str(error)).report()}
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
