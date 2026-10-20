# 阶段 0 实测：workerd 能不能原样跑本站

> 2026-10-20 实测（0.2.0 补 cron 的做法）。版本：workerd 1.20261006.1（`workerd --version` = 2026-10-06，和平台、各游戏 `node_modules` 里的同一版）、
> wrangler 4.151.0（和 `tools/deployer` 钉死的同一版，对照用）、Node 24。方案正本是所有者批准的自托管 v2 / v2.1（SQLite 和 PostgreSQL 部署时二选一）。
> 下面每一条都写成了测试（`test/runtime.test.ts`、`test/assets-parity.test.ts`），以后升 workerd 时 CI 会重新验一遍；"站点"一列是拿真站（平台 + 德州）跑 `tools/selfhost/smoke.mjs` 的结果。

## 结论

本站的模块代码和 `wrangler.jsonc` 不改一行，就能在一个 workerd 进程里跑起来：平台的页面和 `/api`、D1（自写的 SQLite 后端，11 个迁移自动跑）、
德州的登录闸门（`ARCADE` 服务绑定）、单机带入结回（`WALLET` 带 `props.game` 的 RPC）、好友房（DO + WebSocket 休眠）、平台的每日清理（cron）。
有两处和预想不同，见"要注意的两件事"（第 1 件 0.2.0 已绕开）。

| 实测项 | 结果 | 证据 |
|---|---|---|
| 重启后数据在 | 通过：D1 和各 DO 的数据都在 `<数据目录>/<uniqueKey>/<id>.sqlite`，重启后原样；迁移只跑没跑过的 | 测试"重启"；站点重启后再冒烟，账号还在、迁移日志没再出现 |
| 闹钟 | 通过：到点照响；停机时到点的闹钟，进程起来后立刻补响 | 测试"重启…没响的闹钟重启后照响"（定 1.5 秒，马上重启，起来后已响、`getAlarm()` 为空） |
| WebSocket 休眠和 ping | 通过：`setWebSocketAutoResponse` 不唤醒对象就回 pong；空闲 10 秒后对象被驱逐、连接不断，下一条消息到时重新构造对象（构造时间变了） | 测试"WebSocket"（等 12 秒）；站点两人进房收到 welcome |
| 钱包 props 的 RPC | 通过：`service = (name, entrypoint = "WalletService", props = (json = …))`，`this.ctx.props` 拿得到 | 测试"带 props 的服务绑定 RPC"；站点带入 400、结回 500，余额 10000 → 10100 |
| cron 调用方式 | 通过，不用实验特性（0.2.0，见下） | 测试"定时任务"两条；站点手动投平台清理 outcome=ok |
| locationHint 被忽略 | 通过：kit 的 `get(id, { locationHint: 'apac' })` 照常拿到对象 | 测试"DO"；站点开房 |
| 内存存储下的 storage.sql | **不可用**（见下）；键值存储和闹钟可用，重启后清空 | 测试"memory 存储" |
| D1 语义 | 和 D1 / miniflare 一致：一个请求里的语句一个事务，batch 一条出错整体回滚；错误原文 `D1_ERROR: no such table: …`、`UNIQUE constraint failed: …`；`rows_written` 含索引（和 miniflare 同一个计数，平台按写入行数做的测试在两边一样）；BLOB 来回不变；`exec` 按行拆 | 测试"D1"两条 |
| Secret 没设 | 绑定是 `null`（Cloudflare 上是没有这个键）；平台、kit 读 Secret 都按"假值就当没设"处理，没有差别 | 站点没设 `SITE_ORIGIN` 时按请求自己的地址认 Origin |
| 静态资源 | 和 wrangler dev 逐条一样：5 种配置 × 27 个路径 × GET/页面跳转/HEAD/POST，比状态码、跳转、Content-Type、正文、`_headers` 的头、Cache-Control，加 ETag 的 304 | `test/assets-parity.test.ts` |
| 调试端点 | 裸 workerd 没有：不开 `--debug-port`、不配 inspector，只有生成器写的两个监听（站点、管理入口）；管理入口没有认证，生成器和启动脚本都只许回环地址 | 生成的 `config.capnp` |

## 要注意的两件事

### 1. cron：不经服务绑定，在 Worker 里面直接调（0.2.0 起不用 `--experimental`）

Cloudflare 按 `triggers.crons` 调 Worker 的 `scheduled()`；workerd 没有调度器。0.1.0 的做法是一个单独的 cron Worker 经服务绑定投：
服务绑定上的 `scheduled()` 默认被当成 **RPC 调用**，而平台故意把 `scheduled` 写成实例字段、不让 RPC 调到（`platform/worker/index.ts`：防止任何绑了 `ARCADE` 的游戏自己触发清理），
要投真的 scheduled 事件得开实验开关 `service_binding_extra_handlers`、workerd 带 `--experimental` 起。

0.2.0 换成第二条路（主线 10-20 要求先试这条）：生成器把有 crons 的 Worker 的主模块换成 `runtime/cron-entry.js`，它原样转出模块自己的全部导出
（默认入口不变，服务绑定、DO 类照旧），再多导出一个 DO 类 `ArcadeHostCron`；闹钟到点时在同一个 Worker 里把默认入口实例化
（`new 默认入口类(ctx, env)`，ctx 的 `waitUntil` 收下的都等完）或直接拿对象写法的 `scheduled(controller, env, ctx)` 调。实测：

- 平台（`WorkerEntrypoint` 子类、`scheduled` 是实例字段）手动投和真站冒烟都是 outcome=ok；测试里类写法和对象写法各一个，对象写法每分钟一次、闹钟自己投到；
- 服务绑定上照旧 RPC 调不到 `scheduled`（测试"定时任务"里锁住：平台的防护在自托管下不变）；
- 配置里没有任何实验开关，workerd 不带 `--experimental`。

代价：有 crons 的 Worker 多一个 DO 类（存储键 `<Worker 名>-ArcadeHostCron`，只存"上次跑过"一行和一个闹钟）；模块自己不能有同名导出（生成器拦）。

### 2. 内存存储没有 SQL：PostgreSQL 模式下房间不能只换成 inMemory

v2.1 写的是"PG 模式下 DO 改成 workerd 的内存存储，房间状态由 kit 的适配层快照到 PG"。实测这一版 workerd 的 `durableObjectStorage = inMemory`
**不带 SQLite**：`ctx.storage.sql` 直接抛 "This Durable Object is not backed by SQLite storage"，即使 `enableSql = true`。键值接口（`get`/`put`）和闹钟能用。
kit 的房间、计量、排队现在都用 `ctx.storage.sql`，所以 PG 模式要二选一：

1. **kit 的持久化接口把 sql 整个包进去**（推荐，和 v2.1 的方向一致，只是范围更大）：默认实现照旧用 `ctx.storage.sql`（Cloudflare、SQLite 模式零退化）；
   PG 模式注入的实现完全不碰 `ctx.storage.sql`，读写都走 host 提供的 PG 绑定（每步 ≤ 2 行的规矩不变）。接口需求另写给主线转 kit 持有者。
2. DO 存储放 tmpfs（`localDisk` 指向内存盘、每次启动清空）：kit 不用改，但"不留任何 SQLite 文件"只做到"不留在磁盘上"，而且重启后房间全丢，等于 PG 只管平台库。不符合 v2.1 的要求，只当备选。

## 其他实测到的细节

- 数据目录要先建好：workerd 不会自己建 `--directory-path` 指的目录（systemd 单元用 `StateDirectory=`，Docker 用卷）。
- DO 的磁盘存储（`localDisk`）在 workerd 的配置说明里标着"实验性、可能不兼容地改动"（不需要 `--experimental`）：文件布局是 `<uniqueKey>/<对象 id>.sqlite`（加 `-wal`/`-shm`）。
  所以 uniqueKey 固定成 `<Worker 名>-<类名>`、D1 是 `d1-<Worker 名>-<绑定名>`，生成器保证不变；升 workerd 前先做逻辑备份（`/d1/<库>/export`），CI 里做升级演练（阶段 4）。
- 迁移文件可以一次执行多条语句（`ctx.storage.sql.exec(整个文件)`），和 wrangler 用的是同一张 `d1_migrations` 表、同样的列，从 Cloudflare 导出的库（`wrangler d1 export`）可以直接导入。
- `request.cf` 在 workerd 里是 `undefined`；本站代码没有用到。真实 IP 只认 `cf-connecting-ip` 头，由前面的 Caddy 用真实地址覆盖（workerd 只听回环地址）。
- 页面和静态资源的 ETag 值和 Cloudflare 不同（Cloudflare 用 blake3，这里用 sha256），语义一样：内容加扩展名的哈希，带回来回 304。
