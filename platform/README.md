# 小游戏街机厅 · 平台（platform）

小游戏平台：大厅列出各个小游戏，`/api/*` 提供账号、云存档、好友、排行榜，钱包（筹码）经服务绑定 RPC 给游戏的服务端用。跑在 Cloudflare Workers + D1 上。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/yyyu-star/arcade/tree/main/platform)

本目录是仓库里的 `platform/` 模块，游戏在同一仓库的 `games/<id>/` 下，各自独立部署。架构和选型原则见仓库根的 `docs/architecture.md`；
后端方案和**接口约定**见 `docs/platform-backend.md`（第 5–7 节、第 15 节）。

## 功能

- **大厅**：游戏卡片（最近玩过的排前面）、提醒条（桌上的筹码、就地领补给）、本周净赢、公告。
  有好友房的游戏（`src/games.ts` 里写了 `online`）在"进入游戏"旁边多一个"好友房"按钮，链到游戏地址加参数（`?online=1`）。
- **账号**：注册、登录、找回密码（恢复码）、改昵称和密码、换恢复码、退出其他设备、注销。
- **好友**：好友码和好友链接（`/f/<码>`）、请求、屏蔽；对别人只给公开资料，不给用户名。
- **钱包**（`/wallet`）：筹码余额、每日补给、"最近进出"流水。带入、结回、放弃只能由游戏的服务端经 `WalletService` RPC 调。
- **战绩和排行榜**：战绩页（`/me/stats`、别人的 `/u/<id>`），排行榜（`/boards`：本周净赢、各游戏的每日挑战、称号收集，可只看好友）。
- **云存档**：`/api/saves/<游戏>/<槽>`，游戏白名单就是 `src/games.ts`。
- **邀请制**：不登录不能玩；注册默认关着，管理员在 `/admin` 或用命令行工具随时开关（存在 D1，不用重新部署）。
  `wrangler.jsonc` 的 `vars.REGISTRATION` 是紧急总闸：`"switch"`（默认）听上面的开关，改成别的值一定关。
- **管理页**（`/admin`）：今日概况和 7 天趋势、大厅公告、开放注册、钱包规则（即时生效、留记录）、给朋友建号、重设密码、删号、
  账号详情（钱包摘要、战绩、最近 30 笔流水）、筹码统计；大厅里有"管理筹码"小窗口。页面上动不了管理员账号，管理员只能用命令行工具建。
- **隐私说明**（`/privacy`）：其中"积分和筹码"一段适用于所有游戏：免费、没有充值，积分筹码没有现金价值，不能买、换、转让，不设奖品。
- **防刷和熔断**：持久限流、每天上限、内存令牌桶；按类别的写入预算和熔断档位（`docs/platform-backend.md` 5.4、6.6）。

## 本地开发

需要 Node 22（见 `.nvmrc`）。

```bash
cd platform
npm ci
npm run dev        # 界面开发服务器 0.0.0.0:5180（热更新，/api 转给 5181）
npm run dev:api    # 接口：本地 D1 应用迁移后起 wrangler dev，0.0.0.0:5181
npm test           # 类型检查 + vitest（跑在本地 workerd 里，D1 是本地库）
npm run build      # 类型检查 + 正式构建到 dist/
npm run preview    # 用正式构建启动服务 0.0.0.0:4180
npm run smoke      # 界面冒烟：临时本地 D1 + 无头浏览器走主流程，控制台零报错，截图到 shots/（5181 要空着）
npm run smoke -- --only=wallet   # 只跑一段：wallet chunk next stats boards friends rules overview notice nudge
```

起接口前先 `npm run build` 生成 `dist/`（wrangler 把它当静态资源目录；改了界面要重新 build），再把 `.dev.vars.example` 复制成 `.dev.vars`
（里面是本地专用的假 Secret，`.dev.vars` 不进 Git）：

```bash
npm run build
cp .dev.vars.example .dev.vars
npm run dev:api
curl http://localhost:5181/api/me
```

写请求要带 `X-Arcade: 1`，`Origin` 要等于站点地址（本地是 `http://localhost:5181`，见 `docs/platform-backend.md` 15.1）。
改界面时两个一起开：`npm run dev:api` 和 `npm run dev`；vite 把 `/api` 转给 5181，并把 Host、Origin 改成 5181 的。

本地注册默认也关着，先用命令行工具建一个管理员（令牌是 `.dev.vars.example` 里的本地假值）：

```bash
ARCADE_ADMIN_TOKEN=dev:local-dev-admin-token-000000 npm run admin -- create me 我自己 --admin --base=http://localhost:5181
```

## 部署

整个仓库怎么部署见仓库根 README 的部署一节。平台是一个 Worker（名字 `arcade`）加一个 D1 库，要先部署：游戏经服务绑定 `arcade` 调它。

### 绑定、变量和 Secret

| 名字 | 种类 | 说明 |
|---|---|---|
| `DB` | D1 | 账号、存档、好友、钱包等数据；表结构在 `migrations/`（只增不删） |
| `ASSETS` | 静态资源 | `dist/`，单页回退；`/api/*`、`/games/*` 先进 Worker |
| `SITE_ORIGIN` | 变量，可选 | 站点地址，如 `https://game.example.com`。设了 `/api` 只认这个主机名、写请求的 Origin 必须等于它；不设按请求自己的地址 |
| `REGISTRATION` | 变量 | 注册的紧急总闸，默认 `"switch"` |
| `LIMITS` | 变量 | 覆盖 `worker/api/config.ts` 里的上限和阈值，只写要改的项 |
| `PEPPER_PW`、`PEPPER_RC`、`PEPPER_SID`、`PEPPER_IP` | Secret，必填 | 各种哈希的 pepper，值写成 `<kid>:<随机串>`（随机串至少 16 个字符）。缺了 `/api` 返回 503 |
| `ADMIN_TOKEN` | Secret | 管理令牌，格式同上，给命令行工具 `npm run admin` 用；不设就只能在 `/admin` 页面里管理 |
| `API_MODE` | Secret，可选 | 紧急开关 `normal` / `readonly` / `off`（`docs/platform-backend.md` 6.6） |
| `PEPPER_*_PREV` | Secret，可选 | 换 pepper 时还要认的旧值（`PEPPER_IP` 没有，`docs/platform-backend.md` 5.1） |

每一项的说明也写在 `.dev.vars.example` 和 `package.json` 的 `cloudflare.bindings` 里。Secret 一律自己生成随机值（`openssl rand -hex 24`），
不要用 `.dev.vars.example` 里的本地假值。另有 Cron（每天 UTC 19:17）跑统计和清理，写在 `wrangler.jsonc` 里。

### 一键部署（Deploy to Cloudflare）

1. 点上面的按钮：Cloudflare 把本目录复制成你自己的仓库，自动建 D1 库，按提示填 Secret；`npm run deploy` 会先建表（D1 迁移）再部署。
2. **绑自定义域名**：`wrangler.jsonc` 关掉了 workers.dev 地址（它绕过网关限速），所以部署完要绑一个域名才能访问：
   在 Cloudflare 控制台的 Workers & Pages → `arcade` → Settings → Domains & Routes → Add → Custom domain，填你的主机名（域名要在这个账号下）。
   也可以在自己的仓库里给 `npx wrangler deploy` 加 `--domain <主机名>`。
3. （建议）把变量 `SITE_ORIGIN` 设成 `https://<你的主机名>`，`/api` 就只认这个地址。
4. **建第一个管理员**：新站点没有任何账号、注册默认关着。在自己的仓库目录里：

   ```bash
   npm ci
   export ARCADE_BASE_URL=https://game.example.com     # 换成你的地址
   read -rs ARCADE_ADMIN_TOKEN && export ARCADE_ADMIN_TOKEN   # 粘贴部署时填的 ADMIN_TOKEN，不回显、不进 shell 历史
   npm run admin -- create <用户名> <昵称> --admin
   ```

   打印出的密码和恢复码记好，用它登录后在 `/admin` 里建号、开放注册。

游戏要挂在同一个域名下：每个游戏的 Worker 用路径路由 `<主机名>/games/<id>/*`（路由优先于平台的自定义域名），见各游戏的 README。

### 本仓库的正式部署

正式站由 GitHub Actions 部署（仓库根的 `.github/workflows/platform.yml`）：改动经 PR 合并进 `main` 后，先测试，再用 `production` 环境里的 secret 部署。
仓库里不写正式站的域名和 D1 的 id，部署时注入：

- `D1_DATABASE_ID`：`node tools/deploy-config.ts` 照抄 `wrangler.jsonc`、填上这个 id，写出 `wrangler.deploy.json`（不进 Git），
  D1 迁移和部署都用 `-c wrangler.deploy.json`。id 为空或不像 id 时直接失败：没有 id 的 D1，wrangler 会自己新建一个空库。
- `SITE_HOST`：`wrangler deploy --domain "$SITE_HOST" --var "SITE_ORIGIN:https://$SITE_HOST"`，没设就失败。
- `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`：部署凭证。

正式站不用 `npm run deploy` 手动部署（它不带上面的注入）；Secret 用 `wrangler secret put` 单独设，不随部署变。

### 命令行工具

`tools/admin.ts`（`npm run admin`）调 `/api/admin/*`，令牌只从环境变量 `ARCADE_ADMIN_TOKEN` 读、不打印；站点地址必须用 `--base=<地址>` 或环境变量 `ARCADE_BASE_URL` 给，
只许 https（本机的 http://localhost 除外）。生成的密码和恢复码打印在终端。

```bash
npm run admin -- list
npm run admin -- create <用户名> <昵称> [--admin] [--password=<密码>]
npm run admin -- reset <用户名> [--new-recovery-code] [--password=<密码>]
npm run admin -- registration open|close|status
```

不给 `--password` 时由服务器生成一个好记的密码（推荐：命令行里的密码会留在 shell 历史里）。

## 加一个新游戏

见仓库根 `AGENTS.md` 第 2 节。在 `src/games.ts` 登记后，云存档、分数榜、钱包的游戏白名单和保留用户名就都认它了（都从 `GAMES` 派生，`GAME_IDS`）；
用钱包的游戏，服务绑定上写 `props.game`（`docs/platform-backend.md` 5.9）。有每日挑战榜的登记 `daily: true`，分数怎么显示由游戏自己的 `daily.json` 给（15.12）。
想先接钱包、存档，再正式上大厅：先登记成 `status: 'coming'`（大厅显示"即将上线"，进不去），上线时改成 `'playable'`。
有电脑人物的，把名字补进 `worker/api/validate.ts` 的 `RESERVED_PERSONAS`（按游戏 id 分组；没有电脑也要写一组空的，测试会查）。
封面放 `public/covers/<id>.webp`（16:9），来源写进 `ASSETS.md`。

## 目录结构

```
platform/
├─ src/                 界面（React + Vite）
│  ├─ App.tsx           大厅和页面切换
│  ├─ pages/            登录注册、找回密码、我的账号、好友、钱包、战绩、排行榜、隐私说明、管理页（admin/）
│  ├─ games.ts          游戏目录（界面和接口共用）
│  ├─ session.tsx       登录状态；wallet.tsx 钱包余额；api.ts 接口封装；router.tsx 极简路由
│  ├─ gamefile.ts       读各游戏公开的 JSON（titles.ts 读称号名，daily.ts 读每日榜分数写法）
│  └─ format.ts、ui.tsx、ledger.tsx、next.ts   格式化、表单和恢复码卡片、流水列表、登录后跳回的地址
├─ worker/              Worker
│  ├─ index.ts          入口：/api/* 交给 api/router.ts；Cron；导出钱包 RPC 入口 WalletService（wallet-service.ts）
│  └─ api/              接口：router.ts 路由表和通用检查；auth、account、admin、friends、boards、saves、stats、leaderboard、settings；
│                       钱包 wallet.ts（核心）→ wallet-store.ts（读写）→ wallet-api.ts（接口），只能 api → store → 核心这样 import；
│                       crypto、validate、ratelimit、meter、db、time、config（所有上限和阈值的默认值）
├─ migrations/          D1 迁移，只增不删
├─ public/              静态资源：_headers（CSP 等安全头）、covers/（游戏封面）
├─ test/                接口测试（每个接口断言写入行数，docs/platform-backend.md 7.2）
├─ tools/               smoke.ts 界面冒烟、admin.ts 命令行工具、cover.ts 封面、deploy-config.ts 正式部署配置
├─ wrangler.jsonc       Worker 配置（不含域名和正式库 id）
├─ .dev.vars.example    Secret 一览和本地假值
├─ ASSETS.md            素材来源
└─ CHANGELOG.md         更新日志
```

改界面时别用内联脚本、内联 style、外站资源：`public/_headers` 的 CSP 会拦，冒烟会把任何拦截当成失败。

## 第三方数据

- `worker/api/weak-passwords.ts`：常见弱密码表，取自 SecLists（MIT 许可，Copyright (c) 2018 Daniel Miessler）。

## 许可证

MIT，见仓库根的 `LICENSE`。
