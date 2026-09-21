# 抖音下载方案验证

## 结论与执行方式

2026-09-21：推荐独立 Chrome + Playwright，在浏览器内取得作品详情中的完整播放地址，再下载并核对时长、全片解码。四个分享链接均通过，已提供 `scripts/download_browser.py`。此入口不依赖 AIX、第三方解析服务、Docker 或模型 API。

| 样例 | 时长 | 分辨率 | 音轨 / 全片解码 |
| --- | --- | --- | --- |
| 不花钱的护牙小技巧 | 25.83 秒 | 1080×1920 | 通过 |
| 这2种情况不用种牙 | 54.93 秒 | 1080×1920 | 通过 |
| 怎么看牙医靠不靠谱 | 28.57 秒 | 1080×1920 | 通过 |
| 为什么牙齿不好 | 15.51 秒 | 1080×1920 | 通过 |

```powershell
uv run --no-project --with playwright==1.63.0 python douyin-video/scripts/download_browser.py --share "https://v.douyin.com/vWhV5lbQYFc/" --cookies "<你的JSON Cookie文件绝对路径>" --out "work/我的视频下载"
```

从仓库根目录执行；输出目录必须不存在。要求本机 Chrome、FFmpeg、FFprobe 和 uv。测试安装在 `work/download-research/.venv`，也可使用其中的 Python 直接运行。无需执行 `playwright install`，脚本调用系统 Chrome。

下载结果包括 `video.mp4` 和不含 Cookie、媒体签名 URL 的 `download.json`。仅下载不调用 Qwen。后续如要分析：

```powershell
node douyin-video/scripts/prepare_video.mjs --file "work/我的视频下载/video.mp4" --out "work/我的视频素材"
```

## 已确认的原因

- 直接详情请求失败时，实际响应为 HTTP 403，正文为 `Blocked by ArgusSecurityPlugin Uifid Not Found`。这是接口请求门禁；不是 MP4 解码失败。
- 第一个作品 `7684213955167084657` 的页面详情返回 `allow_download=false`，但浏览器入口已下载完整视频。
- 新增作品 `7681510657833727651` 返回 `allow_download=true`，此前 yt-dlp 同样返回 403。因此不能把所有失败解释为作者关闭下载。
- curl_cffi 模拟 Chrome 的一轮请求曾取得三个作品详情；下一轮四个全部被上述门禁拦截。说明一次 HTTP 200 不能证明稳定性。

## 开源候选实测

| 候选 | 版本或提交 | 本机测试结论 |
| --- | --- | --- |
| yt-dlp | 2026.08.19 | 前次第二、第三个文件成功；第一、新增作品详情 403，重复请求不稳定 |
| Johnserf-Seed/f2 | 7dab3e2 / 0.0.1.7 | 安装官方源码依赖，调用 DouyinCrawler.fetch_post_detail；第一、新增作品均无有效详情 |
| jiji262/douyin-downloader | f7ec48f | 安装官方源码依赖，调用 DouyinAPIClient.get_video_detail；第一、新增作品均无有效详情 |
| curl_cffi | 0.16.3 | Chrome 指纹请求一轮成功、下一轮失败，不作为最终方案 |
| 独立 Chrome + Playwright | 系统 Chrome 153 / Playwright 1.63.0 | 四个原始分享链接全部完整下载与解码成功 |
| xifangczy/cat-catch | 8cdde7c / 2.7.2 | 检查了真实网络监听源码；尝试无头环境加载，但未取得扩展 worker，插件本体未完成实机验收 |

F2、douyin-downloader 测试限定为影响下载的单视频提取入口；没有把安装成功或无异常退出计作下载成功。没有启动第三方解析站点或向它们提交 Cookie。

## AIX 与浏览器路线

本机已安装 AIX 9.0.58。只读检查其 manifest 和脚本，确认有 `webRequest` 权限及 `onResponseStarted`、`onHeadersReceived` 网络响应监听。公开官网介绍网页视频提取与预览，但没有公开到足以完整复现其所有抖音逻辑的程度；不能宣称本脚本完整复刻 AIX。

猫抓是可检查源码的浏览器资源捕获替代品。源码在接收响应时识别媒体并记录请求信息。若使用现有 AIX 手工下载，得到的本地 MP4 也可直接交给 `prepare_video.mjs --file`；不必更换能正常工作的插件。

研究时抓到过 2.6 秒、无音轨的预加载 MP4，虽然能解码，却不是 25.83 秒完整作品。因此正式脚本只使用匹配作品 ID 的详情播放地址，并核对下载时长，不使用首次捕获响应作为成品。

## 限制

- 本次四个样例的结果不代表所有抖音视频永久可下载。登录状态、网页结构和风控变化仍可能导致失败。
- 无头会话遇到验证码或登录拦截时会失败；届时可用用户现有浏览器与 AIX 下载本地文件。
- 猫抓仅完成源码检查和加载尝试，未声称插件下载通过；Evil0ctal 服务型项目及旧版油猴脚本只做资料筛选，未安装实测，不列为已验证推荐方案。
- 本次 Playwright 自带 Chrome for Testing 遇到 Windows 并行配置启动失败；系统 Chrome 可用，所以最终入口使用系统 Chrome。

## 来源

- https://github.com/jiji262/douyin-downloader/blob/main/README.zh-CN.md
- https://github.com/Johnserf-Seed/f2
- https://github.com/xifangczy/cat-catch
- https://www.aixdownloader.com/zh/
