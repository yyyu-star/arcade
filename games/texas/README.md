# Arcade · Texas Hold'em

No-limit Texas Hold'em for 2–9 players, one of the games on the Arcade mini-game site, running on Cloudflare Workers.

- **Solo play** against 1–5 computer players, entirely in the browser: ten personalities, three fun difficulties (beginner / normal / expert) and four real-chip tables tuned against simulated players.
- **Friend rooms** with a six-digit code or an invite link (built on the shared `arcade-kit` room); empty seats are filled by the computer, and the server never sends anyone else's hole cards.
- **Table fun** — props, stickers and taunts, with computer players that react — from the shared `arcade-kit/table-fun` component.
- **Play chips only**: chips live in the platform wallet and have no cash value; they cannot be bought, exchanged or transferred.
- **Standalone deploy**: `wrangler.jsonc` deploys as-is without the platform (guest identity, solo and friend rooms, no wallet).

```bash
cd games/texas && npm ci
npm run dev        # page on :5175
npm test           # type check + vitest + Worker and room tests in workerd
npm run build:cf   # page bundle for the Worker
npm run smoke      # headless Chromium smoke test against a local Worker (run build:cf first)
```

The rest of this README, the design document (`DESIGN.md`) and the code comments are in Simplified Chinese. MIT licensed, see [LICENSE](LICENSE).

---

# 德州扑克（texas）

无限注德州扑克，一桌 2–9 人：单机对电脑（全在浏览器里跑）和好友房（基于 `arcade-kit`，空位电脑补）。
筹码跨场保留，存在平台的钱包里（几个游戏共用一个余额，`docs/economy.md`），先选娱乐（不碰钱包）或实盘；筹码只是游戏积分，**无任何现金价值**：不能买、不能换钱换物、不能转给别人，输光了靠每日补给。
也能不带平台单独部署（见下面"单独部署这个游戏"）：单机和游客好友房照常玩，没有登录、钱包和实盘。

- 路径：`/games/texas/`（Worker 名 `texas`），开发端口 5175，预览 4175
- 设计见 [DESIGN.md](DESIGN.md)，模块约定见 [AGENTS.md](AGENTS.md)，当前版本见 `package.json` 的 `version`，各版改了什么见 [CHANGELOG.md](CHANGELOG.md)。标题页左边牌扇下面显示版本号。

## 功能

- **单机**：对 1–5 个电脑，10 种性格，每一场的状态不一样（松紧、凶不凶、诈唬多少、出手快慢在性格的范围里浮动），会看对手的打法、按筹码深浅打；娱乐分新手、普通、高手三个难度，实盘四档，小桌电脑最弱、偶尔手软，往上逐档变强（DESIGN.md 4.10）；娱乐桌不碰钱包，实盘从平台钱包带一份上桌、离桌结回（经德州 Worker 转平台钱包）。牌局存在浏览器里，刷新接着打。
- **好友房**（都是实盘）：开房给六位房间码或邀请链接，2–9 人，空位电脑补；至少两个真人才发牌，电脑一律最强，一个人想玩实盘去单机（DESIGN.md 6.5）。服务端说了算，不下发别人的底牌。短语、表情、道具单机和好友房都有（kit 的 table-fun，单机里电脑会回），顶栏的笑脸能整体关掉，也能屏蔽某个人或一键屏蔽全桌（DESIGN.md 13.7）。
- **登录闸门**：首页要先在平台登录（`GATE=login`），平台有问题时回德州自己的 503 页，不放行。单独部署时没有闸门，认游客（DESIGN.md 10.1）。
- **战绩**：存在本机，登录后同步到平台云存档。

### 地址参数
| 参数 | 做什么 |
|---|---|
| `?room=123456` | 邀请链接：直接进这个房间（档位、人数由房间告诉他） |
| `?online=1` | 平台大厅卡片上的"好友房"按钮（和掼蛋同一个约定）：打开标题页、好友房那一行（开房间 / 输码进房间）滚到看得见并亮一下，有鼠标的光标直接在房间码里 |

两个参数读完都用 `history.replaceState` 去掉，刷新不会再触发。刷新前在好友房里的（6 小时内），标题页会给一条"回到房间"横幅，点了才进，不自动拉回去。

### 手机和平板
按仓库 AGENTS.md 第 4 节：高度按 `visualViewport` 算（`--app-h`，CSS 先 `100vh` 再 `100dvh`），转屏后补算一次；双指放大时不重排；
四边用 `env(safe-area-inset-*, 0px)` 让出刘海；竖着拿是竖屏牌桌（DESIGN.md 8.2）。牌桌是 DOM + CSS，没有画布和 WebGL，
"画布倍数封顶 2""整屏背景 1 倍""WebGL 上下文丢失"这三条不适用（DESIGN.md 8.1）。冒烟里模拟了省内存设备（CPU 降速 4 倍）和双指放大。

### 素材
全部由本模块的代码生成，没有图片、音频、字体文件，没有第三方素材。逐项来源见 [ASSETS.md](ASSETS.md)。

## 本地开发
```bash
npm ci
npm run dev           # 页面（vite，5175）；钱包连不上时娱乐照常，设 TEXAS_WORKER=<本地 Worker 端口> 把 api/、/api/wallet* 转给 Worker
npm run build:cf      # 页面打包到 dist-cf/games/texas/（Worker 的静态资源）
npm run smoke         # 冒烟：先 build:cf；本地起 Worker + 无头 Chromium 打满 30 手（一手打完不点"下一手"不发、自动下一手）、补码、离桌结算页、回大厅、手机横屏、双指放大、竖屏、好友房（两手之间的停顿、换设备开房 409）；
                      # 再用原样的 wrangler.jsonc 起一个单独部署的 Worker，跑单机和游客好友房（--only desktop|mobile|room|standalone 只跑一段）
node scripts/capture.ts [--device desk|phone|both] [--every 250] [--secs 40] [--auto] [--out 目录]
                      # 连拍：本地起页面、娱乐桌自动打，每隔固定毫秒截一张，拼成带时间的 4×4 大图，逐帧看节奏（不进 CI）
npm test              # 类型检查 + vitest（含全量 1.34 亿手的牌力测试、机器人对打 1 万手，约 10 秒）+ workerd 里的 Worker 和好友房测试
npm run test:worker   # 只跑 workerd 里的那部分：test/worker/（配置 test/wrangler.test.jsonc，平台和平台钱包用假的服务绑定，钱包是 arcade-kit/testing）
                      # 和 test/standalone/（单独部署，配置 test/wrangler.standalone.jsonc，没有平台）
npm run sim [手数] [档位] [--size=2–9] [--mix-only] [--no-form]  # 性格混桌对打（10 种里挑），打印每种性格每百手的输赢、入池/加注（含场与场之间的波动）和各热点的耗时；--no-form 去掉每场的状态
npm run gen:preflop   # 重新生成翻牌前胜率表 src/ai/preflop-table.ts（约 25 秒，固定种子）
```

依赖共用包 arcade-kit：装的是 npm 上发布的 `@yyyu-star/arcade-kit`（`package.json` 里起别名 `arcade-kit`，源码在仓库的 `packages/arcade-kit`），只经它的包入口用：`arcade-kit/rng`、`/room`、`/client`、`/auth` 等。脚本直接用 Node 跑 TypeScript（Node 22 的类型剥离）。

### 本地试 Worker
`npx wrangler dev`（用 `wrangler.jsonc`）就是单独部署的样子：游客、没有钱包。要试有平台的样子，在模块根放一份 `wrangler.local.jsonc`（已 gitignore：照 `wrangler.jsonc` 抄，
加上 `services`（`ARCADE`、`WALLET`，写法见 `test/wrangler.smoke.jsonc`）和 `GATE: "login"`，入口换成 `test/dev-entry.ts`，静态目录写 `./test/assets` 或 `./dist-cf`，`run_worker_first` 加 `/api/wallet`、`/api/wallet/*`，
`vars` 里加 `SITE_ORIGIN` 写页面的地址：经 vite 转发时请求落在 Worker 的端口，和页面的 Origin 对不上），
平台的 `/api/me` 和钱包用一个名叫 `arcade` 的假 Worker 代替（`test/arcade.dev.ts`，cookie `__Host-sid=<id>` 就认作这个人，钱包是 `arcade-kit/testing`），
入口写 `test/dev-entry.ts`（本地没有平台的路由，浏览器的 `/api/wallet*` 由它转给假平台），两份配置一起起：

```bash
TEXAS_WORKER=8775 npm run dev:worker   # Worker 的端口取 TEXAS_WORKER，不设就由系统分配（看输出的 Ready on），不占 5175 / 4175
TEXAS_WORKER=8775 npm run dev           # 页面在 5175，api/、/api/wallet* 转给上面的 Worker；SITE_ORIGIN 写页面的 http://localhost:5175
curl -b '__Host-sid=me' http://localhost:8775/api/wallet
```

## 单独部署这个游戏

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/yyyu-star/arcade/tree/main/games/texas)

`wrangler.jsonc` 是能原样部署的独立配置：点上面的按钮，或者 fork 后在本目录 `npm ci && npm run deploy`（先 `npx wrangler login`），
部署到你自己 Cloudflare 账号的 `texas.<你的子域>.workers.dev`，打开根路径会跳到 `/games/texas/`。只用到 Workers、静态资源和两个 Durable Object（免费版就够）。

单独部署有的和没有的（细节见 DESIGN.md 10.1）：

- 有：单机对电脑（娱乐，筹码不算数）；好友房（游客身份，浏览器记一个 cookie，昵称在大厅填，空位电脑补，至少两个真人才发牌）；嘲讽、表情、道具；战绩存在本机。
- 没有：登录、云存档、排行榜、钱包和实盘（单机只有娱乐，好友房的筹码不记账，离开就没了）。

每天开房数、写入预算照 `wrangler.jsonc` 里的 `KIT_QUOTA`，可以按自己的用量改。

## 本站部署

德州是一个 Cloudflare Worker（名字 `texas`），本站挂在平台同一个域名的 `/games/texas` 路径下，用平台的登录和钱包，按仓库根 README 的部署一节用 GitHub Actions 部署：
**先部署平台**（Worker 名 `arcade`，德州的服务绑定都指向它），再跑本模块的流程。

本仓库的正式站由 `.github/workflows/game-texas.yml` 部署：改动经 PR 合并进 `main` 且涉及 `games/texas/**` 或 `packages/arcade-kit/**` 时，先跑模块独立性检查，再 `npm ci`、`npm test`、`build:cf`，
然后由部署工具 `tools/deployer` 在 `wrangler.jsonc` 上补平台的东西：`ARCADE`、`WALLET` 两个服务绑定和 `GATE=login`（`tools/workers.json`）、
路由 `<站点>/games/texas`、`<站点>/games/texas/*` 和变量 `SITE_ORIGIN=https://<站点>`（站点的主机名在 GitHub `production` 环境的 secret `SITE_HOST` 里，没设就失败），关掉 `workers_dev`，再部署。
PR 上只测试不部署。在本仓库里不对正式环境手动部署（`npm run deploy` 是给单独部署用的）。

本模块要的绑定、变量和 secret：

| 名字 | 类型 | 说明 |
|---|---|---|
| `ASSETS` | 静态资源 | `dist-cf/`，由 `npm run build:cf` 生成 |
| `ROOM` | Durable Object `TexasRoom` | 好友房 |
| `METER` | Durable Object `RoomMeter` | kit 的每日额度计量 |
| `ARCADE` | 服务绑定 → `arcade`（本站部署时补） | 登录闸门和认人，问平台 `/api/me`；没有就是单独部署 |
| `WALLET` | 服务绑定 → `arcade` 的 `WalletService`，`props.game = texas`（本站部署时补） | 单机和好友房的带入、结回 |
| `GATE` | 变量（本站部署时补） | `login`（没登录跳平台登录页；没绑 ARCADE 时拒绝，不退成游客）或 `off`（不拦，本地试页面用）；不写时看有没有 ARCADE |
| `KIT_QUOTA` | 变量 | 每天的写入预算和每人开房数（DESIGN.md 第 7 节） |
| `SITE_ORIGIN` | 变量（可选，部署时注入） | 开房、进房、单机带入结回只认这个 Origin；没设就认请求自己的 origin |
| `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`SITE_HOST` | GitHub `production` 环境的 secret | 部署流程用，不进 Worker |

需要拆成单独仓库时，在仓库根运行 `tools/split-module.sh games/texas`。

## 目录结构
| 路径 | 内容 |
|---|---|
| `src/core/` | 规则（纯函数）：`table.ts` 一桌的规则、`eval.ts` 牌力评估、`view.ts` 每个座位看到的、`stakes.ts` 四档桌子、`cards.ts` |
| `src/ai/` | 电脑：`decide.ts` 决定、`equity.ts` 蒙特卡洛、`preflop.ts` 翻牌前查表、`personas.ts` 10 种性格 |
| `src/bot.ts` | 把状态换成视图、分好随机流再交给电脑（单机页面、房间、测试共用） |
| `src/solo.ts` | 单机的一桌：实盘先从钱包带一份再上桌、电脑按节奏出手、补码、离桌结回；每一步存本机（`texas.session`） |
| `src/online.ts` | 好友房的一局：连房间（kit 的 `RoomClient`）、按顺序播房间发来的帧、发操作；开房（`texas.room` 记着现在在的房间，标题页给"回到房间"，不自动进） |
| `src/main.ts` | 页面入口：大厅、等人页和牌桌，单机和好友房共用一套牌桌，接钱包、云存档、声音；`site.ts` 记着有没有平台（单独部署） |
| `src/view/` | 画面（DOM + CSS，不用画布），主要的几个：`table.ts` 牌桌和动画、`actions.ts` 操作区、`lobby.ts` 标题页兼选桌、`room.ts` 好友房的等人页、`art.ts` 牌面头像筹码、`viewport.ts` 看得见的区域、`sound.ts` 合成音效；其余见目录 |
| `src/net/` | `wallet.ts` 钱包（看钱包、领补给走平台的 `/api/wallet*`，单机带入结回走德州 Worker）、`cloud.ts` 云存档（战绩槽 `stats`，按平台的推荐做法） |
| `src/fun/` | 互动里德州自己的那部分：`taunts.ts` 短语表、`moments.ts` 名场面怎么认和电脑的互动性格（菜单、面板、电脑怎么回是 kit 的 `arcade-kit/table-fun`） |
| `src/room/` | 好友房的规则：把牌桌接到 kit 的 `RoomGame` 上（纯函数，房间和页面共用） |
| `worker/` | texas Worker：`main.ts` 路由、登录闸门（`arcade-kit/auth` 经平台 `/api/me` 认人，单独部署认游客）和单机带入结回（转平台钱包，client 模式）、`platform.ts` 平台钱包 RPC 的类型、`room.ts` 好友房 DO（server 模式调平台钱包） |
| `test/` | vitest；`bots.ts` 是机器人对打的驱动（测试和 `scripts/sim.ts` 共用）；`test/worker/` 跑在 workerd 里；`arcade.dev.ts` 假平台（钱包用 `arcade-kit/testing`）、`dev-entry.ts` 本地入口（测试、冒烟、本地试用，不部署） |
| `scripts/` | `sim.ts` 模拟和实测（`npm run sim -- --vs [每格场数] [档位,...] [策略,...]`：每档 × 每种策略一个玩家对电脑，打印每百手大盲）、`vs.ts` 是它的多线程部分（`--vs` 和性格混桌）、`gen-preflop.ts` 生成胜率表、`smoke.ts` 冒烟、`capture.ts` 连拍看节奏 |

## 许可证

MIT，见本目录的 [LICENSE](LICENSE)（和仓库根的一样，拆成单独仓库时直接带走）。
