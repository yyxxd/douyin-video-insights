---
name: qwen-omni
description: 使用 Qwen Omni 理解用户明确要求分析的视频画面、内容、声音和镜头结构，支持摘要、问答、分镜和镜头分析。仅在用户明确提出视频理解需求时调用；仅提供视频文件不会自动调用。
---

# Qwen Omni

当用户明确说“理解一下这个视频”“分析这个视频”“这个视频讲了什么”“拆成分镜”“分析镜头设计”或要求分析画面、人物动作、场景和视频结构时，调用 `scripts/run_qwen_omni.mjs`。如果用户要求提取口播、台词、旁白或把视频语音转成文字，应选择 Qwen ASR，不要因为输入是视频而调用本 Skill。仅提供视频而没有处理要求时不要调用。

执行顺序：

1. 首次或每次运行先调用共享 runtime 的 `init_qwen_media.mjs`。
2. 对每个视频调用 `media_probe.mjs <file> --kind omni`。
3. 使用整个用户任务共享的 `QWEN_TASK_ID` 和 TaskBudget 计算 `estimated_total_cost`；总费用不超过有效预算上限且可可靠估算时自动执行，否则先向用户确认。
4. 小文件走 Base64；当前环境的 Omni 临时上传链路已于 2026-09-19 通过 44 秒视频真实验收。需走临时上传时使用 `--force-temp-upload` 显式启用；更换模型、账号或服务配置后需重新验证。超过临时上传限制的文件仍需可访问 URL/正式 OSS。

普通输出只包含 Skill 名称、视频时长、费用和视频理解结果。Token、Region、Endpoint、Header、OSS 地址等只允许进入 debug 输出。

任务编排：单 Skill 独立任务没有提供 `--task-id` 或 `QWEN_TASK_ID` 时，runtime 可以自动生成 Task ID。若同一用户请求还需要 Qwen ASR，必须在调用第一个 Skill 前由编排层生成一个共享 `QWEN_TASK_ID`，先使用共享 runtime 的 `task_budget.mjs --task-id ... --operation ...` 登记所有 Operation，再将相同的 `--task-id` 和对应 `--operation-id` 传给 Qwen ASR 和 Qwen Omni。单个 Skill 完成不得删除仍被其他 Operation 使用的 TaskBudget；只有所有 Operation 进入终态后才可 finalize。
