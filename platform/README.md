# Arcade · Platform

The lobby and `/api` of the Arcade mini-game site, running on Cloudflare Workers + D1.

- **Lobby** with game cards, notices and this week's results; **accounts** (username + password + recovery code, invite-only by default).
- **Cloud saves, friends, leaderboards and match history** shared by every game through `/api/*`.
- **Play-chip wallet** — one balance across games; game servers buy in and settle through a service-binding RPC (`WalletService`), browsers can only look and claim the daily relief. Chips are play money only.
- **Admin console** at `/admin` and a command-line tool (`npm run admin`).
- **Abuse limits and circuit breakers** — persistent rate limits, per-category write budgets, read-only and off tiers.

```bash
cd platform && npm ci
npm run build && cp .dev.vars.example .dev.vars
npm run dev:api   # API on :5181 (local D1)
npm run dev       # UI on :5180, proxies /api to :5181
npm test          # type check + vitest in workerd
```

The rest of this README, the code comments and the API contract (`docs/platform-backend.md` in the repository root, sections 5–7 and 15) are in Simplified Chinese.

---

# 小游戏街机厅 · 平台（platform）

小游戏平台：大厅列出各个小游戏，`/api/*` 提供账号、云存档、好友、排行榜，钱包（筹码）经服务绑定 RPC 给游戏的服务端用。跑在 Cloudflare Workers + D1 上。

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/yyyu-star/arcade/tree/main/platform)

本目录是仓库里的 `platform/` 模块，游戏在同一仓库的 `games/<id>/` 下，各自独立部署。架构和选型原则见仓库根的 `docs/architecture.md`；
后端方案和**接口约定**见 `docs/platform-backend.md`（第 5–7 节、第 15 节）。

## 功能

- **大厅**：游戏卡片（最近玩过的排前面）、提醒条（桌上的筹码、就地领补给）、本周净赢、公告。
  卡片上只有一个"进入游戏"：好友房在游戏里开、进，叫人和邀请链接直接链到游戏的 `?room=`；卡片的标签里写着"好友房"。
- **账号**：注册、登录、找回密码（恢复码）、改昵称和密码、换恢复码、退出其他设备、注销。
- **邀请码**：每人在"我的"里生成邀请码（普通用户 3 个、管理员 50 个，7 天有效，管理后台能调），链接 `/i/<码>` 打开就是填好码的注册页；
  注册关着时必须凭码注册，用码注册的人和邀请人自动成为好友（`/api/invite-codes`）。
- **好友**：好友码和好友链接（`/f/<码>`）、请求、屏蔽；对别人只给公开资料，不给用户名；好友在不在线、在哪个游戏哪个房间（`POST /api/presence`），本人可以在"我的"里关掉。好友在房间里时一键"加入"，好友叫你时顶上弹一条、"好友"带红点（`/api/invites`）。好友动态：实盘赢了、新称号、游戏里的名场面，好友能赞、扔道具；顶栏"动态"按钮点开看最新几条，有新的带红点（电脑是浮层，手机是底部半屏面板），全部在动态页 `/feed`（分页加载、长说明能展开），好友页只留一行入口（`/api/feed`）。好友多了列表在卡片里滚，手机上加好友、好友码排在列表下面。搭子战绩：好友房打完，好友页写着和每个好友一起打了几场、各赢几场、谁是最佳搭档（房间服务端经钱包绑定的 `together()` 报，浏览器碰不到）。
- **钱包**（`/wallet`）：筹码余额、每日补给、"最近进出"流水。带入、结回、放弃只能由游戏的服务端经 `WalletService` RPC 调。
- **战绩和排行榜**：战绩页（`/me/stats`、别人的 `/u/<id>`），排行榜（`/boards`：本周净赢、各游戏的每日挑战、称号收集，可只看好友；每日挑战只看好友时比这周每人最好的一天，好友超过你时大厅提一句）。异步挑战：把一局的开局做成链接发出去，大家的成绩挂在一起（`/api/challenges`，开盘先用）。晒战绩：战绩页"晒一晒"、排行榜"晒名次"把成绩画成图发给朋友，链接是自己的好友链接（用 `arcade-kit/share`，图不上传）。
- **云存档**：`/api/saves/<游戏>/<槽>`，游戏白名单就是 `src/games.ts`。
- **邀请制**：不登录不能玩；注册默认关着，管理员在 `/admin` 或用命令行工具随时开关（存在 D1，不用重新部署）。
  `wrangler.jsonc` 的 `vars.REGISTRATION` 是紧急总闸：`"switch"`（默认）听上面的开关，改成别的值一定关。
- **管理页**（`/admin`，控制台布局，分区记在 `?s=`）：概览（数字卡片、7 天趋势图、今天各游戏、"管理筹码"小窗口）；用户（列表顶上"+ 建号"，左边列表、右边详情：钱包、战绩、
  最近 30 笔流水、重设密码、删号）；钱包统计；设置（大厅公告、开放注册、钱包规则，即时生效、留记录）。页面上动不了管理员账号，管理员只能用命令行工具建。
- **隐私说明**（`/privacy`）：其中"积分和筹码"一段适用于所有游戏：免费、没有充值，积分筹码没有现金价值，不能买、换、转让，不设奖品。
- **监控**：`/api/health`（版本和数据库）、`/api/client-error`（游戏浏览器报错上报，只存签名和计数）、每 5 分钟的巡检（游戏健康、报错数、钱包自检）和公开的 `/api/monitor`；告警由仓库的 GitHub Actions 读它开关 issue（`docs/platform-backend.md` 第 16 节）。Workers Logs 开着。
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
npm run smoke -- --only=devices  # 只跑一段，见下
```

冒烟的分段（`tools/smoke.ts` 末尾的 `only`）：`wallet` `chunk` `next` `stats` `desk` `phone` `devices` `boards` `feedpop` `friendsfeed` `friends` `rules` `invites` `overview` `notice` `nudge` `sound`。
改布局跑 `devices`：26 个尺寸（竖屏手机 9、横屏手机 7、平板和折叠屏 7、电脑 3）× 10 页，自动查整页横滑、伸出屏幕、点击区（手机平板 44，320 宽 40，电脑 24）、
字号（数字手机平板 14、电脑 12）、顶栏折行和重叠，每个尺寸截一张首页；`phone` 是四种常见屏幕的细查（第一屏、单手够得着、底部筹码条、转屏）。
`--out <目录>` 把截图放到别处。

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

平台是一个 Worker（名字 `arcade`）加一个 D1 库，要先于游戏部署：游戏经服务绑定 `arcade` 调它。

- **本仓库的正式站**：只由 `main` 上的 GitHub Actions 部署（见下面"本仓库的正式部署"），不手动部署。
- **fork 以后自己部署整站**（平台加游戏）：照仓库根 README 的部署一节做。
- **Deploy to Cloudflare 按钮**：只部署平台本身（下面"一键部署"），游戏要另外部署。

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

必填的几项也写在 `.dev.vars.example` 和 `package.json` 的 `cloudflare.bindings` 里。Secret 一律自己生成随机值（`openssl rand -hex 24`），
不要用 `.dev.vars.example` 里的本地假值。另有两个 Cron 写在 `wrangler.jsonc` 里：每天 UTC 19:17 跑统计和清理，每 5 分钟巡检一次（第 16 节）。

### 一键部署（Deploy to Cloudflare）

按钮只部署平台本身，不带游戏。

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

正式部署只走 `main` 上的 GitHub Actions（仓库根的 `.github/workflows/platform.yml`）：改动经 PR 合并进 `main` 后，先测试、构建、打包，
再由仓库级的部署程序 `tools/deployer` 部署；部署作业进 `production` 环境，要维护者批准。
部署程序从审过的 `wrangler.jsonc` 生成最终配置，填上 `production` 环境 secret 里的正式库 id（`D1_DATABASE_ID`）和站点域名（`SITE_HOST`），
先跑 D1 迁移再部署；仓库里不写这两个值。做法和理由见 `tools/deployer/README.md`。

正式站不用 `npm run deploy` 手动部署（它不带上面的注入和检查）；Secret 用 `wrangler secret put` 单独设，不随部署变。

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
│  ├─ pages/            登录注册、找回密码、我的账号、好友、动态、钱包、战绩、排行榜、隐私说明、管理页（admin/）
│  ├─ games.ts          游戏目录（界面和接口共用）
│  ├─ session.tsx       登录状态；wallet.tsx 钱包余额；api.ts 接口封装；router.tsx 极简路由
│  ├─ gamefile.ts       读各游戏公开的 JSON（titles.ts 读称号名，daily.ts 读每日榜分数写法）
│  ├─ icons.tsx、sound.ts  手写 SVG 图标和小插画、大厅点按声（WebAudio 合成，可关）
│  ├─ styles.css        全站样式：开头是主题变量（颜色、间距、字号、圆角、阴影），组件只用变量；配色表见 docs/style.md
│  └─ format.ts、ui.tsx、ledger.tsx、next.ts、play.ts   格式化、表单和恢复码卡片、流水列表、登录后跳回的地址、进游戏的地址
├─ worker/              Worker
│  ├─ index.ts          入口：默认导出 WorkerEntrypoint（fetch、给游戏的 RPC blockedAmong、Cron）；/api/* 交给 api/router.ts；导出钱包 RPC 入口 WalletService（wallet-service.ts）
│  └─ api/              接口：router.ts 路由表和通用检查；auth、account、admin、friends、presence、invites、feed、challenges、mates、invite-codes、boards、monitor、saves、stats、leaderboard、settings；
│                       钱包 wallet.ts（核心）→ wallet-store.ts（读写）→ wallet-api.ts（接口），只能 api → store → 核心这样 import；
│                       crypto、validate、ratelimit、meter、db、time、config（所有上限和阈值的默认值）
├─ migrations/          D1 迁移，只增不删
├─ public/              静态资源：_headers（CSP 等安全头）、covers/（游戏封面）、favicon.svg、bg.svg（底色小图案）
├─ docs/style.md        配色表和形状质感
├─ test/                接口测试（每个接口断言写入行数，docs/platform-backend.md 7.2）
├─ tools/               smoke.ts 界面冒烟、admin.ts 命令行工具、cover.ts 封面（covers/ 里是牌馆、雀馆封面的 SVG 源文件）
├─ wrangler.jsonc       Worker 配置（不含域名和正式库 id）
├─ .dev.vars.example    Secret 一览和本地假值
├─ ASSETS.md            素材来源
└─ CHANGELOG.md         更新日志
```

改界面时别用内联脚本、内联 style、外站资源：`public/_headers` 的 CSP 会拦，冒烟会把任何拦截当成失败。

## 第三方数据

- `worker/api/weak-passwords.ts`：常见弱密码表，取自 SecLists（MIT 许可，Copyright (c) 2018 Daniel Miessler）。

## 许可证

MIT，见本目录的 `LICENSE`（和仓库根的同一份，拆成单独的仓库时随模块带走）。
