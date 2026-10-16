@AGENTS.md

## Claude Code 补充

- 进入某个模块工作时，同时读该模块的 `AGENTS.md`（例如 `games/kaipan/AGENTS.md`）。
- 派子代理时，每个子代理只在一个模块内写文件；brief 里写明模块路径和"不得引用模块外文件"。
- 提交前在仓库根跑 `node tools/check-isolation.mjs`。
- 改动走功能分支 + PR（见 `CONTRIBUTING.md`），不直接推 main；合并由维护者在 CI 全绿、审阅意见处理完后做。
