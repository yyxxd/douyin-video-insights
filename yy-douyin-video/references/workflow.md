# 执行方法

以下 `<repo>` 是四个 Skill 目录的共同父目录，`<task>` 是准备素材的任务目录。所有参数以独立参数传递，不把分享文案或模型输出拼成 shell 代码。

## 单模型模式

analysis 调用 `yy-qwen-omni/scripts/run_qwen_omni.mjs --file <task>/video.mp4 --prompt "用户分析要求" --task-id <id> --operation-id omni --output <task>/omni.json --json`。

transcript 调用 `yy-qwen-asr/scripts/run_qwen_asr.mjs --file <task>/audio.wav --task-id <id> --operation-id asr --output <task>/asr.json --json`。不要把 MP4 直接当音频送入短音频接口。

## 详细分镜

1. 按 SKILL.md 准备媒体并运行 storyboard 计划。无音轨时跳过 ASR；无语音但有音轨时接受经过成功识别得到的空时间线，不凭空补台词。
2. 读取 ASR Skill 后调用：

```text
node <repo>/yy-qwen-asr/scripts/run_qwen_asr.mjs --file <task>/audio.wav --timestamps --task-id <id> --operation-id asr --output <task>/asr.json --json
```

`--timestamps` 强制选择 Filetrans，即使只有几秒也不退回无时间戳接口。根据 ASR Skill 的临时上传说明，在本次进程启用 `QWEN_ALLOW_UNVERIFIED_FILETRANS_LOCAL=1`；账号或服务变更后真实验证。输出的 `segments` 包含秒级 start/end、原文与 ID。此处“秒级”指单位为秒，精度取决于模型，不能声称帧级精确。

3. 构造上下文：

```text
node <skill>/scripts/build_prompt.mjs --media <task>/media.json --asr <task>/asr.json --out <task>/prompt.txt
```

无音轨时省略 `--asr`。提示词把语音时间线和候选切点作为数据，与视频一起交给 Omni：

```text
node <repo>/yy-qwen-omni/scripts/run_qwen_omni.mjs --file <task>/video.mp4 --prompt-file <task>/prompt.txt --task-id <id> --operation-id omni --output <task>/omni.json --json
```

按 Omni Skill 的既有规则，临时上传时加 `--force-temp-upload`。需要费用确认时，只在获得具体金额授权后使用 `--confirm --approved-cost-ceiling <金额>`。普通结果里的 requiresConfirmation 不是成功分析。

4. 使用固定解析入口将 Omni 结果校验并保存为 `shots.json`：

```text
node <skill>/scripts/parse_storyboard_result.mjs --omni <task>/omni.json --media <task>/media.json --asr <task>/asr.json --out <task>/shots.json
```

无音轨时省略 `--asr`。只接受完整 JSON 或包裹完整结果的代码围栏，拒绝未完成结果、缺失字段和不完整时间覆盖，不用 eval，不改写时间线掩盖漏镜头。格式见 [storyboard-prompt.txt](storyboard-prompt.txt)。失败时报告原因，额外模型复核必须使用新的 Operation ID 并遵守预算。
5. 按候选切点和实际画面检查镜头划分。出现遗漏快切、动作不清或镜头边界可疑时，裁剪对应原片片段复核。保留 `offsetSeconds`，将模型片段时间加偏移映射回全片；片段不能冒充完整视频。新增调用单独登记预算，不能复用原来的 omni ID。
6. 渲染报告：

```text
node <skill>/scripts/render_storyboard.mjs --media <task>/media.json --asr <task>/asr.json --shots <task>/shots.json --out <task>/report
```

无音轨时省略 `--asr`。渲染器校验全片覆盖和镜内取帧，使用真实解码帧时间，自动按时间重叠关联原始台词。报告内容由程序 HTML 转义。
7. 查看截图与报告。对声音、细字或运镜不确定时保留具体说明。摘要不能替代逐镜动作过程。完成后输出报告绝对路径链接。

## 任务收尾与复用

同一任务不重复下载、转写。复用前核对 media.json 的源文件和时长，以及模式、模型、转写设置是否仍匹配；新文件不能直接沿用旧时间线。

所有已登记 Operation 达到 completed/failed/cancelled 后调用 runtime 的 `finalizeTask(taskId)`（从 `qwen-media-runtime/src/task_budget.mjs` 导入）。放弃后续步骤时先调用 `cancelOpenOperations(taskId, config)`，它只取消 planned 操作，不会取消正在执行的任务。finalize 保留 `.finalized.json` 费用归档，旧 Task ID 不可重用。保存本任务返回的实际或估算费用到交付说明，不能把二者混称；未知费用估算仍占预算。

## 已知验证边界

后续浏览器路线已使四个真实分享样例全部下载并通过全片解码（1080×1920，带音轨）；当前下载入口与详细证据见 [download-validation.md](download-validation.md)。这只更新下载验收，不代表这四个样例的模型分析、转写或分镜质量已验收。

2026-09-21 最新实测：yt-dlp 2026.08.19 携带用户 JSON 转换的 Netscape Cookie，第二个样例（7686769474703347007，54.93 秒）和第三个样例（7627428410046552290，28.57 秒）下载成功，均为 720×1280，通过 FFmpeg 全片解码及本地素材准备。第一个样例（7684213955167084657）初次及一次重试均在详情接口返回 HTTP 403。后续通过 JSON Cookie 入口再次请求第二个样例也返回 403，尚不能证明在线入口稳定；Cookie 转换和失败清理测试、本地 workflow 测试通过。三个样例全部下载的验收条件未满足，不应宣称下载 Skill 已完成真实验收。此前 Chrome Cookie 数据库复制失败；不自动读取其他浏览器凭据。

Filetrans 时间戳格式参考：https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference
下载工具参考：https://github.com/yt-dlp/yt-dlp

同日约 4.83 秒合成语音视频已完成真实 Filetrans → Omni → 报告链路，ASR 返回原文及 0–4.82 秒时间戳，Omni 返回合法镜头 JSON，截图渲染通过。运行时按配置单价计算合计约 ¥0.002661；这不是服务商账单，也不代表三个抖音样例的还原质量已验收。
