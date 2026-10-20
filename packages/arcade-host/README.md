# arcade-host

在自己的机器上跑本站：一个 [workerd](https://github.com/cloudflare/workerd)（Cloudflare Workers 开源的运行时）进程，跑平台和所有游戏，
模块代码和 `wrangler.jsonc` 一行不改。Cloudflare 上由平台替我们做的几件事，这个包补上：

| Cloudflare 上 | 这里 | 文件 |
|---|---|---|
| D1 | 自写的 SQLite 后端：一个 Durable Object 一个库，workerd 自带的 D1 客户端原样用；启动时自动跑迁移（和 wrangler 同一张 `d1_migrations` 表） | `src/runtime/d1.ts` |
| 静态资源（Workers Assets） | 按 Cloudflare asset-worker 的规则移植：`html_handling`、`not_found_handling`、`run_worker_first`、`_headers`、`_redirects`、ETag/304 | `src/runtime/assets.ts` |
| 路由 | 按路径分给各 Worker（游戏 `/games/<id>`、`/games/<id>/*`，其余给平台）；`/__health`；挡 `/cdn-cgi/*` | `src/runtime/router.ts` |
| Cron Triggers | 有 crons 的 Worker 多一个 DO（主模块换成包装入口，原样转出模块的导出）：闹钟到点在 Worker 里面调默认入口的 `scheduled`，停机错过的起来后补一次 | `src/runtime/cron-entry.ts`、`cron-expr.ts` |
| D1（PostgreSQL 模式） | `db: 'pg'`：同一个 D1 协议，后端换成 PostgreSQL（postgres.js，连接池常驻在一个 DO 里）；SQL 机械翻译 + 站点给的覆盖表，报错还原成 SQLite 原文 | `src/runtime/d1pg.ts`、`sql-translate.ts` |
| DO 存储（PostgreSQL 模式） | `db: 'pg'` + `storage: 'memory'`：给每个有 DO 的 Worker 注入 `KIT_STORE`（kit 0.21 起用它把房间、计量、排队存进 PG），重启后唤醒存了闹钟的对象 | `src/runtime/kitstore.ts` |
| `wrangler d1 export` | 内部管理入口（单独的监听，不在站点上）：整库导出、导入恢复、手动投定时任务 | `src/runtime/admin.ts` |

生成器（`src/gen/`，构建时用 Node 跑）把一份站点描述（`src/gen/site.ts`：各 Worker 的配置和打好的包在哪）变成一个发布目录：
`config.capnp` + 运行时 + 各模块的包 + 静态资源。服务器上只要 workerd 一个二进制和这个目录，不装 Node。

阶段 0 的实测结论（哪些和 Cloudflare 一样、哪些要注意）见 [docs/verify.md](docs/verify.md)。

## 用法

本包不读仓库里别的模块。本仓库里由 `tools/selfhost/` 读各模块的 `wrangler.jsonc`、按部署工具的规则叠加平台绑定、生成站点描述再调这里（见 `tools/selfhost/README.md`）。
单独用的话：

```js
import { generate } from 'arcade-host/src/gen/generate.ts';
generate(site, { out: 'release', storage: 'sqlite' });
```

```sh
cd release
workerd serve config.capnp --directory-path data=/var/lib/arcade
```

- 必须在发布目录里起：静态资源目录按相对当前目录找。
- `--directory-path data=…`：DO 和 D1 的数据目录，要先建好。`storage: 'memory'` 时不要这个参数，什么都不落盘。
- 监听：站点 `127.0.0.1:8787`、管理入口 `127.0.0.1:8788`，可以用 `--socket-addr http=… --socket-addr admin=…` 改。管理入口没有认证，只许听回环地址：生成器（`adminListen`）和 `tools/selfhost` 的启动脚本都会拦；Docker 里也只听容器内的 127.0.0.1，用 `docker exec` 进容器调。
- Secret：站点描述里列的 Secret 名从同名环境变量取（systemd 的 `EnvironmentFile`、Docker 的 `env_file`）。

管理入口（`curl` 就能用）：

| 请求 | 做什么 |
|---|---|
| `GET /d1` | 有哪些库 |
| `GET /d1/<库>/export` | 整库导出成 SQL（和 `wrangler d1 export` 同样的格式） |
| `POST /d1/<库>/import` | 用导出的 SQL 整库替换（一个事务，失败原样不动） |
| `POST /cron/run?worker=<名>&cron=<表达式>` | 立刻投一次这条定时任务 |

## PostgreSQL 模式

v2.1：部署时和 SQLite 二选一，PG 模式不留任何 SQLite 文件。`generate(site, { db: 'pg', storage: 'memory' })`，运行时设 `ARCADE_PG_URL`（连接串，Secret）。

- 站点描述里每个 D1 要带 `pg: { migrations_dir, overrides }`：PG 版的迁移（文件名和 SQLite 版一一对应，对不上生成时就报错）和覆盖表
  （JSON：规范化后的 SQLite 语句 → PG 版）。这两样是平台模块外的数据，本仓库放在 `tools/selfhost/pg/`。
- 机械翻译只做语义确定一致的改写（参数、标量 MIN/MAX、`IS`、`WITHOUT ROWID`），JSON 函数、日期函数、`INSERT OR`、`LIKE`、`random()` 这类一律要覆盖表，没有就报错，不猜。
- 和 SQLite 版的差别：`meta.last_row_id` 是 0（要新行的 id 用 `RETURNING`）；`rows_written` 只算改了的行（SQLite 连索引一起算），平台的写入预算在 PG 模式下只是近似。
- SQLite → PG 的数据迁移：在 PG 模式的站点上 `POST /d1/<库>/import`，内容是 SQLite 模式 `GET /d1/<库>/export` 的导出；整库清空重写、逐表核对行数和数字列总和，对不上整体回滚。
- PG 模式的备份用 `pg_dump`（`/d1/<库>/export` 回 501）。
- 出站：只有连 PG 的两个 Worker 能连内网和本机地址（`pg-network`），模块自己的 Worker 还是只许公网。

## 开发

```sh
npm ci
npm test        # 类型检查、打包运行时、起真的 workerd 跑测试（含和 wrangler dev 的静态资源对照、PG 模式，约 1 分钟）
npm run build   # 只打包运行时到 dist/runtime（生成器从这里拷）
```

测试的临时文件在 `os.tmpdir()` 下，测完删掉；`TMPDIR` 可以改位置。PG 模式的测试默认在本进程用 PGlite（WASM 的 PostgreSQL）起一个库，
设 `ARCADE_TEST_PG_URL` 就连真的 PostgreSQL（CI 的 test-pg 作业）。
