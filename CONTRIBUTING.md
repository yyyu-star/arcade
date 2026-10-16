# 合作指南

> 适用于所有人：仓库所有者、协作者、AI 代理。技术规范（模块独立、代码规范）见 [AGENTS.md](AGENTS.md)；本文件只管"改动怎么进 main、怎么上线"。
> 2026-10-13 建立，起因是仓库开始有外部协作者。

## 1. 三条底线

1. **main 只接受 PR 合并**。不直接推 main，不 force push，不改写已推送的历史，不删除 main。
2. **只有经 PR 合并进 main 的提交会部署到线上**。部署由 GitHub Actions 完成，凭证只放在 `production` 环境里，该环境只允许 main 使用；
   不在本机对正式环境跑 `npm run deploy` / `wrangler deploy`，也不在功能分支上手动运行部署流程。
3. **合并前必须完整审阅**：CI 全绿，审阅人读完整个 diff，提出的问题全部修复或说清楚，再由**仓库所有者账号**合并
   （所有者本人，或代表所有者操作的主线代理）。协作者不合并 PR，包括自己的。

### 哪些是约定、哪些有兜底

这个仓库是公开仓库（2026-10-16 起；之前的历史留在所有者的私有存档里，不公开）。GitHub 的分支保护强制 main 只能经 PR 合并、
必须通过 `Check isolation`、禁止 force push 和删除；仓库管理员（所有者账号）可以绕过，所以下面几层兜底照旧保留：

| 兜底 | 能做到 | 做不到 |
|---|---|---|
| 部署前核对（`tools/verify-main.sh`） | 从上次核对通过的位置起，main 上每个提交都必须是 GitHub 生成的 PR 合并提交、合并人是所有者，否则不部署 | 有人直接推 main 时连同脚本和 workflow 一起改掉 |
| `production` 环境 | 部署凭证只给 `main` 上的任务用，其他分支、PR 都拿不到 | 同上：直接推进 main 的 workflow 能拿到 |
| `Main guard` 流程 | main 被 force push 或混进不合规的提交时，开 issue 指派给所有者 | 同上 |
| 本机 `tools/git-hooks/pre-push` | 本机（包括 AI 代理）推 arcade 时拦直接推 main 和 force push | 网页编辑、其他机器 |

违反约定的提交会被 revert，凭证会被轮换。

## 2. 改动的流程

1. **从最新的 main 开分支**：`git fetch && git switch -c <模块>/<简短说明> origin/main`，例如 `kaipan/bank-button-contrast`。
   第一次克隆后执行一次 `git config core.hooksPath tools/git-hooks`，启用推送拦截。
2. **一个 PR 只改一个模块**（`platform/`、`games/<id>/`、`packages/<name>/` 或仓库根）。跨模块的改动拆成几个 PR，在描述里写明合并顺序
   （带 D1 迁移的：迁移 → 平台 → 游戏）。
3. **本地先自查**：仓库根 `node tools/check-isolation.mjs`；模块里 `npm ci && npm test` 和构建；改了画面跑冒烟截图并亲自看；
   游戏的发版改动同时更新 `package.json` 版本号和 `CHANGELOG.md`。
4. **推分支、开 PR**：标题以模块名开头（`kaipan: …`、`guandan: …`、`platform: …`、`repo: …`），按模板写清改了什么、为什么、怎么验证的。
   在 PR 里 @yyyu-star 请所有者审阅。
   提交作者的邮箱会公开：只用 GitHub 的 noreply 地址（`<id>+<用户名>@users.noreply.github.com`），不用个人或公司邮箱。
5. **CI 必须全绿**：`Check isolation`，以及改动模块的流程里的 `test` 任务（PR 上只测试和构建，不部署、不接触凭证）。
6. **审阅与修复**：
   - 审阅人读完整个 diff，不只看描述：正确性、是否违反 AGENTS.md 的硬约束、测试是否覆盖、用户看到的文字和画面；
   - 每条意见作者都要处理：改代码，或者回复说明为什么不改；改完在同一个分支上追加提交（不要 force push），请审阅人再看；
   - 审阅人确认所有意见都处理完，才算通过。
   - **代理开的 PR**：作者代理自查后，由主线亲自审（所有者 2026-10-15 要求，代替原来"派一个不同于作者的代理审"；取证、跑测试可以派子代理，结论由主线下），作者自查和主线审阅都逐条过下面的清单：
     - **完整**：版本号、`CHANGELOG.md`、README、模块 `AGENTS.md` 跟着改了；新行为有测试；改了画面有冒烟截图；主流程里没有留半成品和 TODO。
     - **正确**：边界和出错路径（断网、401、`busy`、超时、重入）；同种子同结果；联机只下发自己能看的信息；每步存储写入不超过 2 行；涉及存储或接口的改动，在 PR 描述里写明每个操作的写入行数和请求次数。
     - **独立**：`check-isolation` 通过；不读、不引用别的模块；浏览器存储带 `<id>.` 前缀；资源用相对路径；模块能用 `tools/split-module.sh` 拆走。
       新增一个游戏只需要 AGENTS.md 第 2 节"新增一个游戏"那几步，不改其他游戏的代码。
     - **不耦合**：游戏和平台之间只走公开的 `/api` 和 `packages/arcade-kit`；kit 不写死任何一个游戏；平台不知道游戏内部的规则和存档格式；kit 和平台不依赖任何一个游戏的存在。
     - **高效**：热点路径（规则推演、牌力评估、电脑决策、渲染循环、房间消息）复杂度合理，有实测或估算；不在每帧分配大对象；Worker 和 DO 的 CPU 在免费版 10 ms 量级。
     - **简洁**：没有重复代码和死代码；能用现成的就不新写；命名清楚；注释写"为什么"；改动范围不超出这个 PR 要做的事。
7. **合并**：只用 **Squash and merge**，合并后的提交信息就是 PR 标题；分支合并后自动删除。
8. **合并后**：对应模块的流程自动部署。作者到线上实际打开验证（版本号、主流程、控制台零报错），有问题按第 4 节回滚。

## 3. 谁能做什么

下表是约定（技术上协作者有推送权限，见第 1 节）：

| 角色 | 做什么 | 不做什么 |
|---|---|---|
| 协作者 | 推自己的功能分支、开 PR、审阅、讨论 issue | 推 main、force push、合并 PR（包括自己的）、手动运行部署流程、在 workflow 里引用 `production` 环境或凭证 |
| AI 代理（本机） | 按第 2 节开分支和 PR；主线代理用所有者账号在 CI 全绿、审阅意见处理完后合并（主线自己写的改动仍由另一个代理独立审阅） | 绕过 pre-push 拦截（`--no-verify`）、在本机部署正式环境 |
| 仓库所有者 | 审阅、合并、管理设置和凭证 | 同样不直接推 main；紧急修复也走 PR，只是可以自己审 |

- 协作者改 `.github/`、`tools/`、`CONTRIBUTING.md`、`AGENTS.md` 的 PR，必须由所有者本人审阅后合并；
  代理按所有者要求做的这类改动，由主线安排独立审阅、修复后合并，并在汇报里向所有者列出。
- 凭证不进 Git、不贴进 PR 或 issue。协作者不需要 Cloudflare 凭证：本地开发用 `npm run dev`，要看线上效果就合并后看正式站。
- 所有者的管理员账号、密码、恢复码、`ADMIN_TOKEN`、pepper 永远不共享，不进仓库、PR、issue 或 GitHub Secrets；协作者需要管理功能时，由所有者给他单独开账号。
  这几样是整个账号系统的总钥匙：管理员能建号、重设别人的密码、删号；pepper 泄露了，库里的哈希就少了一层保护，而且换起来很麻烦（要等旧哈希清完，见 `docs/platform-backend.md` 5.1）。

## 4. 回滚

线上出问题时，在 GitHub 上对出问题的 PR 点 **Revert**（或本地 `git revert` 后推分支开 PR），走同样的审阅从快合并；合并后 CI 会重新部署。
不要直接推 main 修线上。

**有人直接推了 main 之后**：`Main guard` 会开 issue，之后所有部署都会停（核对卡在那个提交上）。所有者处理顺序：
1. 看 issue 里的对比链接，确认那次推送的内容；有问题就先开 revert PR 合并；
2. 开一个 PR，把 `tools/verify-main.sh` 的 `TRUSTED_BASE` 改成那次直接推送的提交（如果有多个，取最后一个）的完整 SHA，所有者本人审阅后合并；
3. 合并后部署恢复；必要时在 Actions 里对 main 重跑受影响模块的流程。如果怀疑凭证被动过，先在 Cloudflare 轮换 token，再更新 `production` 环境的 Secrets。

## 5. 仓库设置（所有者维护，改了同步更新本节）

- 合并方式：只开 Squash merge，提交标题取 PR 标题；合并后自动删除分支。合并提交由 GitHub 生成并签名，`verify-main.sh` 靠这一点认人。
- `production` 环境：只允许 `main` 部署；`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` 只放在这个环境里，仓库级不放凭证。
- Actions：默认令牌只读（workflow 可以自行申请更多权限，所以审阅时要看 `permissions:`）；外部贡献者（包括 fork）的 PR，流程要所有者批准后才运行；
  fork 来的 PR 拿不到任何 Secret。公开仓库用 GitHub 标准运行器不计分钟。
- 密钥扫描和推送保护：开着，推送里带密钥会被直接拦下。
- 可信起点：`tools/verify-main.sh` 里的 `TRUSTED_BASE`，初值是公开仓库的起点提交。只有所有者能通过 PR 把它往前移（见第 4 节）。
- main 的分支保护：必须经 PR（不要求批准：代理的 PR 由所有者账号开、所有者账号合，GitHub 不允许作者批准自己的 PR）、
  必须通过 `Check isolation`、禁止 force push 和删除；管理员可绕过。协作者的 PR 仍由所有者本人审阅、合并（第 3 节）。
