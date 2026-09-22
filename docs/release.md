# 发布与变更规则

版本来源是根 package.json。当前 1.1.0 为本次架构改造版本；没有自动发布或推送。

```powershell
pnpm check
pnpm test
pnpm package --out work/releases/douyin-video-insights-1.1.0-preview.zip
pnpm check:package work/releases/douyin-video-insights-1.1.0-preview.zip
```

旧入口 `qwen-media-runtime/scripts/package.ps1 -Out <新文件>` 保留，委托统一打包实现。已有 ZIP 或校验文件不会被覆盖。

release-files.json 是逐文件白名单。新增要交付的源码、测试、文档或锁文件时明确更新清单；打包不递归猜测哪些本机文件应发布。包包含完整运行时、三个 Skill、开发检查与脱敏测试，解压后无需 Git 即可验证。不得包含 work、凭据、虚拟环境和本机日志。

ZIP 根 manifest.json 记录版本、构建时间、平台、Node 要求、来源 Git SHA、工作区是否有未提交改动，以及逐文件 SHA256。ZIP 旁生成 .sha256。未提交改动构建会标记 dirty=true，因此本机预览包不能冒充某个干净提交的正式发布。

正式发布前，先完成审查与测试，通过 PR 合并到仓库实际稳定分支，再从干净提交构建。当前仓库没有 main，本次沿用已有 codex/youhua 分支，不擅自重命名稳定分支。

许可证仍未指定。本次没有代替作者选择许可证或授予新的使用许可；正式公开分发前由维护者明确。
