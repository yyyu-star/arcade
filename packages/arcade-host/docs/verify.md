# 和 Cloudflare 的对照（实测）

> 实测环境：workerd 1.20261006.1（和平台、各游戏 `node_modules` 里的同一版）、wrangler 4.151.0（和 `tools/deployer` 钉死的同一版，对照用）、Node 24、
> PostgreSQL 17（CI）。升 workerd 时这里的版本跟着改，下面每一条都写成了测试（`test/runtime.test.ts`、`test/assets-parity.test.ts`、`test/pg.test.ts`），CI 会重新验一遍；
> "站点"指拿平台 + 德州跑 `tools/selfhost/smoke.mjs`（CI 的 selfhost.yml）。

## 结论

本站的模块代码和 `wrangler.jsonc` 不改一行，就能在一个 workerd 进程里跑起来：平台的页面和 `/api`、D1（SQLite 或 PostgreSQL 后端，迁移自动跑）、
德州的登录闸门（`ARCADE` 服务绑定）、单机带入结回（`WALLET` 带 `props.game` 的 RPC）、好友房（DO + WebSocket 休眠）、平台的每日清理（cron）。
不用 workerd 的任何实验特性（不带 `--experimental`，没有实验兼容开关）。

| 项 | 结果 | 证据 |
|---|---|---|
| 重启后数据在 | 和 Cloudflare 一样：D1 和各 DO 的数据在 `<数据目录>/<uniqueKey>/<id>.sqlite`，重启后原样；迁移只跑没跑过的 | 测试"重启"；站点重启后再冒烟 |
| 闹钟 | 到点照响；停机时到点的，进程起来后立刻补响 | 测试"重启…没响的闹钟重启后照响" |
| WebSocket 休眠和 ping | `setWebSocketAutoResponse` 不唤醒对象就回 pong；空闲后对象被驱逐、连接不断，下一条消息到时重新构造 | 测试"WebSocket"；站点两人进房收到 welcome |
| 带 props 的服务绑定 RPC | `this.ctx.props` 拿得到 | 测试"带 props 的服务绑定 RPC"；站点带入、结回 |
| cron | 在 Worker 里面直接调默认入口的 `scheduled`（见下）；服务绑定上照旧 RPC 调不到 `scheduled`（平台的防护不变） | 测试"定时任务"；站点手动投平台清理 outcome=ok |
| locationHint | 忽略，`get(id, { locationHint })` 照常拿到对象 | 测试"DO" |
| D1 语义（SQLite） | 和 D1 / miniflare 一致：一个请求里的语句一个事务，batch 一条出错整体回滚；错误原文 `D1_ERROR: no such table: …`、`UNIQUE constraint failed: …`；`rows_written` 含索引；BLOB 来回不变 | 测试"D1" |
| D1 语义（PostgreSQL） | 同上几条都过，差别见 README 的 PostgreSQL 一节（`last_row_id` 是 0、`rows_written` 不含索引） | `test/pg.test.ts`；站点在 PG 模式冒烟 |
| SQLite 备份导进 PG | 跨行 DDL 不管，INSERT 逐行解析按参数写（`''`、`char(10)`、`X'…'`、NULL），核对行数和数字列总和，坏备份整体回滚 | `test/pg.test.ts`；站点 SQLite 档的备份迁进 PG 后逐行一致 |
| 内存存储 + KIT_STORE | load/commit/wipe 一个事务、闹钟整行覆盖；重启后按存的闹钟唤醒（`kitWake(name)`，过期的也唤醒） | `test/pg.test.ts`；站点 pg + memory 档重启后两人回到同一个房间 |
| Secret 没设 | 绑定是 `null`（Cloudflare 上是没有这个键）；平台、kit 都按"假值就当没设"处理，没有差别 | 站点没设 `SITE_ORIGIN` 时按请求自己的地址认 Origin |
| 静态资源 | 和 wrangler dev 逐条一样：5 种配置 × 27 个路径 × GET/页面跳转/HEAD/POST，比状态码、跳转、Content-Type、正文、`_headers`、Cache-Control，加 ETag 的 304 | `test/assets-parity.test.ts` |
| 调试端点 | 没有：不开 `--debug-port`、不配 inspector，只有站点和管理入口两个监听；管理入口只许回环地址 | 生成的 `config.capnp` |

## cron：在 Worker 里面直接调

workerd 没有调度器，服务绑定上的 `scheduled()` 又会被当成 RPC（平台故意把 `scheduled` 写成实例字段，不让绑了 `ARCADE` 的游戏调到）。
所以生成器把有 crons 的 Worker 的主模块换成 `runtime/cron-entry.js`：原样转出模块自己的全部导出（默认入口、服务绑定、DO 类不变），
再多导出一个 DO 类 `ArcadeHostCron`；闹钟到点时在同一个 Worker 里实例化默认入口（`new 默认入口类(ctx, env)`，`waitUntil` 收下的都等完）
或直接调对象写法的 `scheduled(controller, env, ctx)`。类写法、对象写法各有测试。

代价：有 crons 的 Worker 多一个 DO 类（存储键 `<Worker 名>-ArcadeHostCron`，只存"上次跑过"一行和一个闹钟）；模块自己不能有同名导出（生成器拦）。

## 内存存储没有 SQL

workerd 的 `durableObjectStorage = inMemory` 不带 SQLite：`ctx.storage.sql` 直接抛 "This Durable Object is not backed by SQLite storage"（`enableSql = true` 也一样），
键值接口和闹钟能用，重启后清空。kit 的房间、计量、排队默认用 `ctx.storage.sql`，所以不落盘的 PG 模式靠 kit 0.21.0 起的 KitStore：
有 `KIT_STORE` 绑定时，kit 的读写全打内存镜像，每一步的改动一个事务经 `KIT_STORE` 写进 PG；没有这个绑定时（Cloudflare、SQLite 模式）行为逐字不变。

## 其他细节

- 数据目录要先建好：workerd 不会自己建 `--directory-path` 指的目录（systemd 单元用 `StateDirectory=`，Docker 用卷）。
- DO 的磁盘存储（`localDisk`）在 workerd 的配置说明里标着"实验性、可能不兼容地改动"（不需要 `--experimental`）。文件布局是 `<uniqueKey>/<对象 id>.sqlite`（加 `-wal`/`-shm`），
  所以 uniqueKey 固定成 `<Worker 名>-<类名>`、D1 是 `d1-<Worker 名>-<绑定名>`，生成器保证不变；升 workerd 前先做逻辑备份（`/d1/<库>/export`）。
- 迁移文件整个交给 `ctx.storage.sql.exec` 执行，和 wrangler 是同一张 `d1_migrations` 表、同样的列，从 Cloudflare 导出的库（`wrangler d1 export`）可以直接导入。
- `request.cf` 是 `undefined`，本站代码没有用到。真实 IP 只认 `cf-connecting-ip` 头，要由前面的反向代理用真实地址覆盖（`tools/selfhost/docker/Caddyfile`）。
- ETag 的值和 Cloudflare 不同（Cloudflare 用 blake3，这里用 sha256），语义一样：内容加扩展名的哈希，带回来回 304。
- workerd 默认的出站网络只许公网地址（防 SSRF），连本机或内网的 PG 报 "cannot connect to the specified address"：连 PG 的 Worker 单独配 `pg-network`。
- postgres.js 的 workerd 版要 `node:buffer` 等：`nodejs_compat` 从 compat date 2026-08-04 起默认开着，再显式写 workerd 会报错，所以不写。
- workerd 不许一个请求里开的连接给别的请求用，所以 PG 连接池放在 DO 里（D1 后端、KitStore 各一个对象）。
