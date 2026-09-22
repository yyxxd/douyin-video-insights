# 抖音下载方案验证

当前入口执行 yt-dlp 优先、浏览器回退、双失败人工接管；下面的旧数据不能当作当前链路验收。

## 当前链路验收（2026-09-22）

四个真实样例均先运行 yt-dlp，再自动转浏览器成功：前三项在详情阶段返回 HTTP 403；第四项取得文件但未通过视频流／时长完整性校验。全部最终下载文件带音轨、时长匹配且全片解码通过。本次没有把抖音 yt-dlp 首路成功标记为已验证。

| 作品 ID | 入口及用途 | 成品分辨率 | 下载时长 |
| --- | --- | --- | --- |
| 7684213955167084657 | download / analysis 默认画质 | 720×1280 | 25.83 秒 |
| 7686769474703347007 | download / 用户指定 1080p | 1080×1920 | 54.93 秒 |
| 7627428410046552290 | setup Run / 加密登录复用 / analysis | 720×1280 | 28.57 秒 |
| 7681510657833727651 | prepare --share / analysis | 720×1280 | 15.51 秒 |

加密登录验收使用隔离配置目录，将既有测试 Cookie 经原 save_session / DPAPI 保存后调用 setup Run，不传 --cookies；任务结束删除隔离凭据。没有进行新的扫码登录，也没有修改日常配置。

1080p 成品另经 prepare --file --resolution 720 生成 720p 分析视频、音频和候选切点，全程不再次下载。测试产物位于本机 work/download-validation，不进入发布包。

离线覆盖首路成功、回退成功、双失败、取消、超时、凭据转换与清理、DPAPI 复用、输出目录保护、画质选择和媒体校验。使用本地 HTTP 合成素材调用真实 yt-dlp，验证 720p、1080p、best 格式选择与下载；仅元数据提取使用测试替身，不把它等同于抖音在线首路成功。

## 历史验证（2026-09-21，旧浏览器优先策略）

2026-09-21 旧策略：推荐独立 Chrome + Playwright，在浏览器内取得作品详情中的完整播放地址，再下载并核对时长、全片解码。四个分享链接均通过，已提供 `scripts/download_browser.py`。此入口不依赖 AIX、第三方解析服务、Docker 或模型 API。

| 样例 | 时长 | 分辨率 | 音轨 / 全片解码 |
| --- | --- | --- | --- |
| 不花钱的护牙小技巧 | 25.83 秒 | 1080×1920 | 通过 |
| 这2种情况不用种牙 | 54.93 秒 | 1080×1920 | 通过 |
| 怎么看牙医靠不靠谱 | 28.57 秒 | 1080×1920 | 通过 |
| 为什么牙齿不好 | 15.51 秒 | 1080×1920 | 通过 |

```powershell
uv run --no-project --with playwright==1.63.0 --with yt-dlp==2026.8.19 python yy-douyin-video/scripts/download_video.py --purpose download --resolution 1080 --share "https://v.douyin.com/vWhV5lbQYFc/" --cookies "<你的JSON Cookie文件绝对路径>" --out "work/我的视频下载"
```

从仓库根目录执行；输出目录必须不存在。要求本机 Chrome、FFmpeg、FFprobe 和 uv。测试安装在 `work/download-research/.venv`，也可使用其中的 Python 直接运行。无需执行 `playwright install`，脚本调用系统 Chrome。

下载结果包括 `video.mp4` 和不含 Cookie、媒体签名 URL 的 `download.json`。仅下载不调用 Qwen。后续如要分析：

```powershell
node yy-douyin-video/scripts/prepare_video.mjs --file "work/我的视频下载/video.mp4" --out "work/我的视频素材"
```

## 历史样例已确认的原因

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
