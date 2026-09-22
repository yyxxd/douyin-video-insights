# 开发与验证

## 环境

| 工具 | 要求与来源 |
| --- | --- |
| Node.js | 22+；本机安装器使用 setup-packages.json 中带 SHA256 的固定 ZIP |
| pnpm | packageManager 固定版本；项目无 npm 运行依赖，也可直接执行 node scripts/*.mjs |
| Python | 管理安装使用 3.11，Windows x64 |
| Playwright | requirements.in 指定直接依赖，requirements.lock 锁定传递依赖和 SHA256 |
| FFmpeg / FFprobe | 必须成对可用；安装器与 CI 共用固定版本及哈希 |
| Chrome / Edge | 仅抖音浏览器操作需要；本地模型离线测试不需要登录 |
| yt-dlp | 默认首选下载路线，失败自动转浏览器；专用 Python 环境锁定安装 |

```powershell
pnpm install --frozen-lockfile --ignore-scripts
pnpm check
pnpm test
pnpm test:unit
pnpm check:package
```

`check` 检查 JS 导入/语法、Python AST 与 Windows PowerShell 语法。`test` 运行单元和离线集成测试：预算、上传模拟、Cookie、合成媒体工作流及 Windows 配置服务；测试使用隔离目录与假密钥，不调用模型、不改真实登录或用户环境变量。非 Windows 会明确跳过 DPAPI 集成测试，不能代替 Windows CI 验收。

`check:package` 构建临时包、验证 ZIP 与每个文件的 SHA256，并在解压目录重新运行检查和测试。GitHub Actions 配置已经提供，远端通过状态以实际 CI 为准。

更新 Python 锁文件：

```powershell
uv pip compile qwen-media-runtime/requirements.in --python-version 3.11 --python-platform windows --generate-hashes --no-header --output-file qwen-media-runtime/requirements.lock --default-index https://pypi.org/simple
```

自动安装对专用虚拟环境使用 `uv pip sync --require-hashes`。Check 会核对工具路径、可执行性和版本；已有安装的工具损坏或锁文件哈希变化时，Guide 在已有安装许可范围内修复专用环境。不要对用户其他 Python 环境执行 sync。

## 配置与定价

主配置仍使用 `DASHSCOPE_API_KEY`、`QWEN_MEDIA_CONFIG_DIR`、`QWEN_BAILIAN_REGION` 和现有模型/费用环境变量。北京地域的既有默认价格保留，属于项目配置值，本次架构改造没有重新核验服务商价格。

未知 Omni 模型需要同时设置 `QWEN_OMNI_PRICE_MODEL` 为确切模型名，以及 `QWEN_OMNI_INPUT_PRICE_PER_MILLION_TOKENS`、`QWEN_OMNI_OUTPUT_PRICE_PER_MILLION_TOKENS`。未知 ASR 模型需要 `QWEN_ASR_PRICE_MODEL` 与 `QWEN_ASR_PRICE_PER_SECOND_CNY`。不能通过 `--confirm` 绕过未知价格。显式配置价格不代表已经验证模型的协议或上传兼容性。

Filetrans 配置 workspace endpoint 时直接使用该 endpoint；未配置时使用 region endpoint。失败不再自动切换 endpoint 重新提交同一个收费 Operation。

## 中断与恢复

1. 先检查稳定输出文件：`completed` 可继续下游；`partial` 仅包含已完成部分，需要核对后复用，不能当作完整输入。
2. 素材准备和报告目录的 `task-state.json` 标识 running/completed/failed。失败产物保留，新尝试使用新目录，不覆盖原文件。
3. 查看 `%TEMP%/QwenMediaSkills/tasks/<taskId>.json` 或 `.finalized.json`，核对 Operation、`ownerPid`、`remoteTaskId`、失败阶段及未知费用。远端任务超时不等于未收费。
4. 锁超时会拒绝写入，不自动判断锁过期。确认对应进程已退出、没有其他任务正在使用该 ID 后，备份相关 JSON；仅删除该任务的精确 `.lock` 文件。设置锁同理。禁止删除整个任务目录或正在执行的锁。
5. 运行中 Operation 不自动重置成 planned。核对远端任务与费用后，新请求使用新 Operation ID，并将未知费用保留在预算中；不要为绕过金额上限建立新任务。

配置损坏会明确报错；验证记录损坏显示 invalid，不自动宣称能力已验证。历史 `work/` 中的研究、安装测试与媒体未自动移动或删除；新自动测试统一使用临时目录，新手工产物建议使用 `work/research`、`work/tasks`、`work/releases`。

## 验收边界

离线测试只能证明协议处理、预算状态、数据校验、素材处理和报告生成。真实浏览器下载、真实模型连通与视频内容还原质量是独立验收项目，不能由离线通过推断。历史网络验收见 Skill references；重构后的真实网络链路须用获准素材和预算另行验收。
