# 架构与执行边界

本项目是 Windows 优先的本机 Skill 工具集。保持三个 Skill 与 `qwen-media-runtime` 同级，保留公开的 `scripts/` 命令路径；内部模块使用 `src/`，开发验证统一放在根目录。

## 职责

| 层 | 位置 | 职责 |
| --- | --- | --- |
| Agent 指令 | 各 Skill 的 SKILL.md、references | 意图路由、用户授权、内容质量复核 |
| CLI | 各目录 scripts | 解析参数、调用函数、输出 JSON/文本、退出码 |
| 业务能力 | ASR/Omni/Douyin 的 src | 转写协议、视频理解、素材准备、分镜与报告 |
| 共享运行时 | qwen-media-runtime/src | 配置、媒体检测、上传、费用、Operation 生命周期 |
| 配置页面 | setup + SetupService | 浏览器登录、AI 配置和费用偏好；HTTP 层仅处理传输边界 |
| 工程工具 | 根 scripts、tests、.github | 离线验证、依赖与打包 |

Node 负责媒体与模型编排，Python 负责 Playwright 浏览器适配，PowerShell 负责 Windows 安装、环境变量和 DPAPI。没有新增运行时 npm 依赖。

## 数据流

```mermaid
flowchart LR
  A[Skill 意图与授权] --> B[公开 CLI]
  B --> C[业务能力模块]
  C --> D[共享运行时与预算]
  D --> E[媒体工具 / 百炼]
  C --> F[结构化结果与报告]
```

本地 ASR/Omni 只要求 Node 22+、FFmpeg/FFprobe、有效配置和 API Key；不以抖音登录或 `guideStatus=complete` 作为硬门槛。统一引导仍负责完整产品首次配置。已有 Key 是否实际可用由服务响应验证，不能把变量存在当作联通成功。

## 预算和结果

- TaskBudget v2：`planned -> running -> completed|failed`，只允许 `planned -> cancelled`；同一 Operation 不能再次启动。
- 同 ID 重新登记不能改变模型/能力，规划阶段估算只可保守上调；未知价格不会通过金额确认自动变成可靠。
- `actualCost` 是基于已知用量和配置价格计算的金额，仍不是服务商账单。`unverifiedEstimatedCost` 是已提交但费用未知的保守占用。ASR 缺少服务用量时不把本地时长估算记为实际用量。
- 请求前的输入/上传失败记为已知零模型费用；模型请求开始后失败保留未知费用与阶段。Filetrans 返回的远端 Task ID 写入预算，失败不自动重新提交模型请求。
- 所有操作终态后预算移至 `<taskId>.finalized.json`。该 Task ID 不可重用，费用证据保留供核对。
- 模型调用前排他预留输出文件。每个已完成结果先写临时文件，再替换结果检查点；后续失败保留 `status=partial`，下游拒绝将它当作完整结果。
- 未指定 `--output` 时，结果保存在任务临时目录的 `results/`，JSON 返回恢复路径。指定输出时应使用工作区内的稳定路径。

## 数据与安全

媒体清单、计划、模型结果和分镜使用 `schemaVersion: 1`，读取器兼容没有版本号的旧文件，拒绝未知版本和未完成结果。分镜转换只接受完整 JSON 或完整代码围栏，再检查字段、时间覆盖和 ASR 时间线。

模型 API 和结果下载使用不同认证策略。结果下载只接受无内嵌凭据的 HTTPS URL，不发送 API Key，也不自动跟随重定向。配置服务保留 loopback、Host/Origin、随机 token、CSP 和输入大小限制；公开状态只返回所需设置字段。

配置文件采用版本校验、写锁、唯一临时文件和原子替换；凭据继续由当前 Windows 用户 DPAPI 或既有用户环境变量管理。不同职责的状态文件保持分离，没有合并成一个会被多个进程共同覆盖的大文件。
