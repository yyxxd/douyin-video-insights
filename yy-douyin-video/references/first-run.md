# 首次配置与恢复（供 Agent 执行）

用户无需执行本文命令。由具有本机终端权限的 Agent 代为执行。首版自动安装支持 Windows x64，Chrome / Edge；其他环境先说明未验收，不假装安装成功。没有本机执行权限时，明确说明当前 Agent 无法代装。

## 入口与同意

安装 Skill 时就执行完整配置。Agent 必须先保留用户的原任务和参数，再启动引导并等待结构化结束状态；不先询问“全部功能还是仅下载”。手动复制安装无法触发安装钩子时，在第一次实际使用中执行同一流程兜底。

只做只读检查，不要求 Python、Node 或 uv 预先存在：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<repo>/qwen-media-runtime/scripts/setup.ps1" -Action Check
```

读取 missing、directory、environmentPrepared 和 configuration。存在缺失项时，再执行只读网络探测：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<repo>/qwen-media-runtime/scripts/setup.ps1" -Action Probe
```

将实际缺失项翻译为“运行工具、音视频处理工具、浏览器连接工具”，并根据 Probe 结果说明安装器会优先使用当前更快的官方源或国内镜像，失败时自动回退。下载的 ZIP 无论来自哪条线路都必须通过固定 SHA256 校验；Python 使用 requirements.lock 和 require-hashes，只同步本工具的专用虚拟环境。告知会下载安装到当前用户目录，不更改系统 PATH、不收费调用模型。不要捏造安装大小和耗时。取得安装同意后执行统一入口：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<repo>/qwen-media-runtime/scripts/setup.ps1" -Action Guide -Consent
```

`-Consent` 只能代表已经取得的安装许可，不能由 Agent 自行当作用户同意。许可覆盖已说明的这一批安装；不用重复询问每个组件。拒绝则停止安装，原任务保留。部分失败可以重试，已完成部分复用，不主动删改日常工具。检测到安装不完整、版本不可用再修复；已准备完成不反复安装。

## 图形引导

`Guide` 会补齐缺失工具、打开本机配置页并保持运行。没有自动打开时，把输出的 setupUrl 做成可点击链接。只监听 127.0.0.1；不要转发链接到第三方。不要以自动化方式替用户勾选登录、密钥或浏览器安装同意项。

页面直接引导完整配置，不再先让用户选择功能模式。用户仍可明确跳过 AI，此时结果是 `partial`，不能表述为“全部配置完成”。`Guide` 返回 `complete` 或 `partial` 后，Agent 自动继续保存的原任务；返回 `cancelled` 或 `timeout` 时不执行原任务，并说明已完成配置会保留。不要让用户重发链接。

### 抖音

用户看到“你平时用哪个浏览器看抖音？”，仅列出本机存在的 Chrome / Edge。不认识浏览器或只用手机时，推荐列表中的可用浏览器，让用户扫码一次。

首版采用独立窗口登录，不直接解密日常浏览器数据库、不关闭日常浏览器，也不要求导出 Cookie。页面必须明确这一点，不能声称会自动继承原浏览器登录。用户同意后打开所选浏览器的独立窗口；检测到登录后加密保存本工具所需的抖音记录并关闭该窗口。最多等待五分钟，超时或关闭窗口可重来。只有保存登录，不等于已通过下载验收。

没有兼容浏览器时，页面提供征得同意后通过 winget 安装 Chrome 的入口。没有 winget、安装需要额外权限或安装失败时说明具体边界；不要自动提权或修改安全策略。Chrome 自动安装尚需在无浏览器的干净 Windows 环境验证，不承诺任何受管电脑都能安装。

### AI（第一次就配置）

页面指导已有账号者输入百炼密钥，没有账号者打开官方控制台。当前只支持北京地域；注册、实名、付款由用户完成。密码和密钥只在本机页面或官方网页输入，不进入聊天、命令行参数或日志。

AI 密钥保存为当前 Windows 用户的 DASHSCOPE_API_KEY 环境变量，不是加密存储。先检测已有变量，不回显密钥；留空可检查已有连接。覆盖或清除需明确确认可能影响其他工具。Run 入口刷新当前用户变量，使后续任务立即使用；其他已运行软件可能需重新打开。页面查询官方模型列表并校验响应结构，不生成内容。必须先验证、后保存：认证、权限、限流、服务异常、超时、网络或响应格式错误都不得覆盖旧 Key、费用选择和能力验证记录。只有候选 Key 验证成功后才保存；同一个 Key 复检不清空 ASR / Omni 验证记录。不能把模型列表成功当成 ASR、Filetrans、Omni 都能用。

默认“每次询问”；用户可指定每个完整任务的金额上限。页面设置真正接入 TaskBudget，不能把一个任务拆成多个小任务规避限额。首次验证若要发送音视频并调用模型，先展示素材、用途和估算费用，按用户保存的授权范围执行；需要确认时使用既有 budget 流程。只配置服务不代表授权任意收费测试。

没有账号或暂时不想付费时，可跳过 AI，下载不受阻。以后说“配置 AI”就打开同一页面，保留已有工具和登录。

## 继续原任务

在 PowerShell 中调用（参数是数组，不拼接用户文案为脚本）：

```powershell
& "<repo>/qwen-media-runtime/scripts/setup.ps1" -Action Run -Task download -TaskArguments @('--share','<分享链接>','--out','<新目录>')
```

自动使用本机加密登录，无需 `--cookies`。支持的 Task 为 download、prepare、asr、omni；参数沿用原脚本。这个入口会设置本次进程工具路径，不依赖用户终端 PATH。后续编排的其他 Node 脚本也应在相同工具路径环境运行，或由 Agent 从 toolchain.json 取得可执行路径。

重新执行 Check 可读取不含密钥的配置状态。查看下载的 download.json，只有文件生成、时长匹配、全片解码通过才交付。ASR / Omni 成功的真实任务会分别写入 asr-validation.json、omni-validation.json；这些只说明当时该模型调用成功，不代表所有模型永久可用。更换密钥会清除这两项验证记录。

需要登录或验证码时重新打开连接流程，不要求用户导出文件。用户只配置未提供素材时，明确“环境已准备，真实任务待验证”，请其提供素材。已有原任务时继续完成任务，不以“配置成功”结束。

## 保存位置与清除

默认 `%LOCALAPPDATA%/QwenMediaSkills`，可用 QWEN_MEDIA_CONFIG_DIR 隔离测试。toolchain.json 只存工具路径，setup.json 只存选择，douyin-session.protected 存当前 Windows 用户加密登录记录；AI 密钥只使用环境变量。抖音清除按钮只清除本工具登录，不改浏览器；AI 清除按钮经确认删除用户环境变量。禁止打印解密结果或将配置目录打进发布包。
