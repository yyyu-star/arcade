# platform 模块约定

> 总规范见仓库根的 `AGENTS.md`（拆成独立仓库后，以本文件和随附的 docs 为准）。

- 内容：平台主界面（React + Vite，`src/`）和平台 Worker（`worker/`），Worker 名 `arcade`。站点域名和正式 D1 的 id 不写进仓库，部署时注入（README 的部署一节）；代码里不写死站点地址。
- `/api/*`（账号、云存档、好友、排行榜，以后还有房间登记）的方案和**接口约定**见仓库根的 `docs/platform-backend.md`（第 5–7 节、第 15 节）。
  拆分时把这份文档一起复制到 `platform/docs/`。
- 游戏目录在 `src/games.ts`，封面放在 `public/covers/<id>.webp`（16:9），来源写进 `ASSETS.md`。平台只负责展示和跳转，不引用任何游戏的代码。
- 正式环境只有这一个平台 Worker：不开 workers.dev（它绕过网关限速）、不建测试 Worker。测试全在本地：`npm test`（vitest 跑在本地 workerd 里）、
  `npm run dev:api`（wrangler dev + 本地 D1）。上线后由维护者在线上验证。
- 测试期是邀请制：注册默认关着，管理员可在 `/admin` 随时开关（D1 `settings`；`vars.REGISTRATION` 是紧急总闸，见 `worker/api/settings.ts`），账号由管理员在 `/admin` 或用
  `npm run admin` 建（维护者 2026-10-14 定）；0.20.0 起老用户也能生成邀请码，注册关着时凭码注册（`worker/api/invite-codes.ts`，15.20）。没登录的访客在首页一个 `/api` 请求都不发，只有打开登录页时问一次 `/api/me`。
- 管理接口 `/api/admin/*` 的两种认证（Bearer 令牌、管理员会话）和各自能做什么写在 `worker/api/admin.ts` 开头；改权限时同步改那里和测试。
- 改界面后跑 `npm run smoke`（无头浏览器走建号和账号主流程，控制台零报错、没有意料外的 4xx/5xx），并亲自看 `shots/` 里的截图。
- 命令：`npm run dev`（界面，5180）、`npm run dev:api`（接口，5181）、`npm test`、`npm run smoke`、`npm run build`、`npm run preview`（4180）、
  `npm run deploy`（一键部署或拆成独立仓库后用；本仓库的正式站只经 PR 合并进 main 后由 CI 部署，CI 注入域名和正式库 id，见 README）。
- 测试夹具里的站点用保留的示例域名（`game.example.com`、`game.test`），不写正式域名。
- 平台接口只增不改。游戏依赖平台，平台不依赖任何游戏，所以带接口变更的发布顺序是先迁移、再平台、后游戏。

## 写接口的规矩

- 每个接口都要有测试：正常路径、错误码、`rowsWritten()` 等于 `docs/platform-backend.md` 7.2 的写入行数；写请求测 CSRF（缺 `X-Arcade` 或 Origin 不对 403）、
  限流 429（被拒的请求写 0 行）。改了写入行数就同步改 7.2。
- D1 一律经 `worker/api/db.ts` 的 `Db` 调用，指定写入类别（6.6 的分类预算），不直接用 `env.DB`（计量会漏）。
- 限流计数用 `ratelimit.ts` 的带条件 UPSERT（超限 0 行写入）；匿名接口先过内存令牌桶。
- 密码、恢复码、会话令牌、IP 只存哈希；日志不记 cookie、请求体；错误日志只记路径和错误类型。
- 上限和阈值放 `worker/api/config.ts` 的默认值里，线上要调就改 `wrangler.jsonc` 的 `vars.LIMITS`，不在代码里散落数字。
- 迁移只增不删：加新文件 `migrations/000N_*.sql`，不改已合并的迁移。
