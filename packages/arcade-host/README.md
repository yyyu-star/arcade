# arcade-host

在自己的机器上跑本站：一个 [workerd](https://github.com/cloudflare/workerd)（Cloudflare Workers 开源的运行时）进程，跑平台和所有游戏，
模块代码和 `wrangler.jsonc` 一行不改。Cloudflare 上由平台替我们做的几件事，这个包补上：

| Cloudflare 上 | 这里 | 文件 |
|---|---|---|
| D1 | 自写的 SQLite 后端：一个 Durable Object 一个库，workerd 自带的 D1 客户端原样用；启动时自动跑迁移（和 wrangler 同一张 `d1_migrations` 表） | `src/runtime/d1.ts` |
| 静态资源（Workers Assets） | 按 Cloudflare asset-worker 的规则移植：`html_handling`、`not_found_handling`、`run_worker_first`、`_headers`、`_redirects`、ETag/304 | `src/runtime/assets.ts` |
| 路由 | 按路径分给各 Worker（游戏 `/games/<id>`、`/games/<id>/*`，其余给平台）；`/__health`；挡 `/cdn-cgi/*` | `src/runtime/router.ts` |
| Cron Triggers | 有 crons 的 Worker 多一个 DO（主模块换成包装入口，原样转出模块的导出）：闹钟到点在 Worker 里面调默认入口的 `scheduled`，停机错过的起来后补一次 | `src/runtime/cron-entry.ts`、`cron-expr.ts` |
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

## 开发

```sh
npm ci
npm test        # 类型检查、打包运行时、起真的 workerd 跑测试（含和 wrangler dev 的静态资源对照，约 40 秒）
npm run build   # 只打包运行时到 dist/runtime（生成器从这里拷）
```

测试的临时文件在 `os.tmpdir()` 下，测完删掉；`TMPDIR` 可以改位置。
