---
name: qwen-asr
description: 使用 Qwen ASR 将用户明确要求转写的音频或含音轨视频转换为文字，并在可用时输出句子级时间戳。口播、台词、旁白和视频语音转写应调用本 Skill；仅提供媒体文件不会自动调用。
---

# Qwen ASR

当用户明确说“用 ASR 识别”“转写这个录音”“提取这个视频的口播稿”“把视频转成文字”“识别视频里的人说了什么”等，调用 `scripts/run_qwen_asr.mjs`。视频文件不应因为扩展名而自动调用 Qwen Omni；只要用户的意图是语音转写，就选择 Qwen ASR。仅提供音频或视频而没有处理要求时不要调用。

执行顺序：

1. 首次或每次运行先调用共享 runtime 的 `init_qwen_media.mjs`。
2. 对每个媒体调用 `media_probe.mjs <file> --kind asr`。
3. 使用整个用户任务共享的 `QWEN_TASK_ID` 和 TaskBudget 计算 `estimated_total_cost`；总费用不超过有效预算上限且可可靠估算时自动执行，否则先向用户确认。
4. 短音频使用 `qwen3-asr-flash`，本地文件必须转为 Base64 Data URL，不能发送 Windows 本地路径。
5. 当前环境的共享 Filetrans 临时上传链路已于 2026-09-19 通过 301 秒音频真实验收。使用本地长音频时，在本次进程设置 `QWEN_ALLOW_UNVERIFIED_FILETRANS_LOCAL=1` 显式启用（沿用现有开关名）；更换模型、账号或服务配置后需重新验证。Workspace 未验证，无需为已通过的共享链路创建 Workspace 或正式 OSS。

任务编排：单 Skill 独立任务没有提供 `--task-id` 或 `QWEN_TASK_ID` 时，runtime 可以自动生成 Task ID。若同一用户请求还需要 Qwen Omni，必须在调用第一个 Skill 前由编排层生成一个共享 `QWEN_TASK_ID`，先使用共享 runtime 的 `task_budget.mjs --task-id ... --operation ...` 登记所有 Operation，再将相同的 `--task-id` 和对应 `--operation-id` 传给 Qwen ASR 和 Qwen Omni。单个 Skill 完成不得删除仍被其他 Operation 使用的 TaskBudget；只有所有 Operation 进入终态后才可 finalize。

如果视频没有可识别音轨，返回“未检测到可识别的音轨，无法进行语音转写。”，不得自动切换到 Qwen Omni。

普通输出只包含 Skill 名称、音频时长、费用和识别结果。Token、Endpoint、Header、OSS 地址等只允许进入 debug 输出。
