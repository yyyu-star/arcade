# tools/deployer：部署程序

部署作业（`.github/workflows/platform.yml`、`game-<id>.yml` 的 deploy）只执行这里的程序，用这里钉死版本的 wrangler，
不用模块自己的 `node_modules`。为什么要这样设计见 [docs/review-policy.md](../../docs/review-policy.md) 第 7 节。

## 做什么

- `deploy.mjs`：部署作业唯一执行的程序。按白名单检查审过的 `wrangler.jsonc` 和构建作业交来的产物（只当数据），生成最终配置
  （打包开关写死、入口复制到只有它的目录），用钉死的 wrangler 读回来再查一遍，然后 `wrangler deploy --no-bundle`；平台先迁移 D1。
  `--dry-run` 只跑到 `wrangler deploy --dry-run`，不连 Cloudflare，本机和 PR 上的预跑都用它。
- `lib.mjs`：读配置和白名单检查，PR 上的 `tools/check-deploy-config.mjs` 和 `deploy.mjs` 共用。vars 名和兼容开关的名单在
  `tools/deploy-allowlist.json`，Worker 名单在 `tools/workers.json`。
- `pack.mjs`：构建作业的最后一步，把打包产物和静态资源摆成 deploy.mjs 认的目录结构（不做把关）。

## 为什么钉死 wrangler

检查用的解析器必须和部署用的是同一份代码，否则检查看到的和实际部署的可能不一样（JSONC 边角写法、`__proto__` 之类）；
打包开关的默认值（比如 `--no-bundle` 时 `find_additional_modules` 默认打开）也随版本变，`lib.mjs` 的检查是按 4.151.0 的源码写的。
所以版本写死在 `package.json`（精确版本）和 `package-lock.json`，部署作业用 `npm ci --ignore-scripts` 装，`deploy.mjs` 启动时核对装的版本。

## 升级 wrangler

1. 改 `package.json` 里的版本号，在本目录执行 `npm install --ignore-scripts` 更新 `package-lock.json`，两个文件一起提交；
2. 对照新版本的 `node_modules/wrangler/wrangler-dist/cli.js` 看 `lib.mjs` 依赖的行为有没有变：
   `experimental_readRawConfig` / `unstable_readConfig`、`noBundleWorker` 找附加模块的默认值、source map 的读取、`.env` 的读取规则、
   新增的配置字段（白名单外的一律拒绝，但要确认没有新的"不写也生效"的默认值）；
3. 本机对五个模块各走一遍：构建 → `npx wrangler deploy --dry-run -c wrangler.jsonc --outdir <产物>/worker` → `pack.mjs <产物>` →
   `SITE_HOST=games.example.com node tools/deployer/deploy.mjs --module <模块> --artifact <产物> --work <新目录> --dry-run`
   （平台另加 `D1_DATABASE_ID=<任意 UUID>`）；
4. 开 PR，由维护者审（改 `tools/` 属于 needs-maintainer）；PR 上 `Check isolation` 会自动拿开盘预跑一遍部署。
