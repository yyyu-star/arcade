# arcade-host 模块约定

> 总规范见仓库根的 `AGENTS.md`（拆成独立仓库后，以本文件为准）。和 Cloudflare 的对照（实测）在 `docs/verify.md`。

- 内容：自托管的运行时（`src/runtime/`，跑在 workerd 里）和生成器（`src/gen/`，构建时用 Node 跑）。不部署，没有自己的 Cloudflare Worker；
  仓库里的用法在 `tools/selfhost/`（它读各模块的 `wrangler.jsonc`，本包不读任何别的模块）。
- 零退化：本包只在自托管时用，不改变 Cloudflare 上的任何行为；不要为了自托管去改模块代码，差别都在这里补，补不了的写进 `docs/verify.md` 报维护者。
- 行为照 Cloudflare：静态资源的规则逐条照 workers-shared 的 asset-worker、router-worker 移植，改了要过 `test/assets-parity.test.ts`（和 wrangler dev 逐条对照）；
  D1 的协议照 miniflare 的 D1DatabaseObject（workerd 自带的客户端只认这个），错误原文、`rows_written` 的算法不能变（平台的测试和写入预算按它算）。
- 存储键不能变：DO 的 uniqueKey 是 `<Worker 名>-<类名>`，D1 是 `d1-<Worker 名>-<绑定名>`，定时任务是 `<Worker 名>-ArcadeHostCron`；改了等于换了一个空库。
- workerd 版本钉死（`package.json` 精确版本 + lockfile），和平台、游戏 `node_modules` 里的保持一致；升级时 `npm test` 全过、`docs/verify.md` 开头的版本跟着改。
- 管理入口（`admin.ts`）没有认证，只许听回环地址（生成器的 `LOOPBACK` 断言、启动脚本的检查都要留着；Docker 里也只听容器内的 127.0.0.1）；不要把它挂到站点路由上，也不要加能读写任意 DO 的接口。
- 不用 workerd 的实验特性（`--experimental`、实验兼容开关）：定时任务就是为这个改成在 Worker 里面直接调的（`docs/verify.md`）。真要用，先在 verify.md 写清开了哪些、风险和替代计划，报维护者。
- 运行时里不用 `setTimeout`/`setInterval`（定时任务只用一个闹钟），日志一行一个 JSON，不记请求体、cookie、Secret。
- PG 模式：机械翻译只做两边语义确定一致的改写，拿不准的一律要覆盖表、没有就报错（`NeedsOverride`），不要为了"能跑"加猜测性的改写；覆盖表和 PG 版迁移是站点的数据，不放进本包。
  报错原文的还原（`sqliteMessage`）要守住平台认的那几种（`UNIQUE`、`Network connection lost`）。连 PG 的 Worker 才走 `pg-network`，别的 Worker 不放开内网出站。
- `KIT_STORE` 的接口（`load`/`commit`/`wipe`、`kitWake`、`props.game`、ns 只许 room/meter/match）和 arcade-kit 的 `src/store.ts` 是一对，改哪边都要两边的持有者一起定。
- capnp 字符串只放 ASCII：中文变量值、迁移 SQL、静态资源清单都写进 embed 的文件（`src/gen/capnp.ts` 会拦）。
- 测试：`npm test`（起真的 workerd，临时文件在 `os.tmpdir()`）。新加的运行时行为要有测试。
- 每次修改同步更新文档（所有者的合并门槛）：行为、用法变了改 `README.md`，和 Cloudflare 的差别变了改 `docs/verify.md`，发版写 `CHANGELOG.md`；文档只写现状，过程留给 CHANGELOG。
- 版本号和 `CHANGELOG.md` 各自独立；提交信息以 `arcade-host:` 开头，分支名 `host/<说明>`。
