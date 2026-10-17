# Kaipan · 开盘

A stock-market roguelike deck-builder for the browser (Phaser 4 + TypeScript). You are a small-time retail trader: each morning read the
group-chat gossip, pick cartoon "stock buddies" for your hand, then hit **Open** and watch hot themes rotate, leaders drag their followers
up limit after limit, and your account swing. Pay the bill at the end of every month or the run is over.

- **Real price action, fictional everything else.** Every run replays a random slice of real 1996–2018 US market history (public-domain
  WIKI Prices data), scaled into the game; years, companies and tickers never appear on screen. All stocks, people, news, art and audio
  are original or procedurally generated.
- **Deterministic rules core.** `src/core/` is pure: same seed + same actions = the same run, bit for bit. Saves, replays, the daily
  challenge and bot simulations (`npm run sim`) all rely on it.
- **Modes.** Casual runs (a 5-month short run or a full year, three difficulties plus five harder market climates), a daily challenge with
  a leaderboard, and a "live" mode that stakes play chips from the Arcade platform wallet. Chips are play money only.
- **Runs standalone.** `wrangler.jsonc` deploys the game on its own as a single Worker; login, cloud saves, leaderboards and chips light up
  only when it is mounted next to the Arcade platform.

```bash
cd games/kaipan && npm ci
npm run dev      # http://localhost:5173
npm test         # vitest: rules, replays, content, workers, architecture checks
npm run build:cf # production build for /games/kaipan/
```

The rest of this README, the in-game text, code comments and design docs (`docs/`) are in Simplified Chinese. License: MIT (`LICENSE`).

---

# 开盘

散户炒股主题的肉鸽构筑游戏：每天看群聊里的小道消息，挑股票放进持仓，开盘后看它们跟着风口轮流火、
带头大哥带着小弟涨；每个月底账户里要留够钱还上一笔，还不上游戏就结束。打完一局（短局 5 个月，完整一年 12 个月），看你是韭菜还是股神。
画面一律用大白话，A 股原词（题材、龙头、跟风……）只出现在提示和图鉴的小白词典里。
浏览器运行（Phaser 4 + TypeScript），美术与音频全部为程序生成的原创内容；股票、公司、人物和消息全部虚构。

当前版本见 `package.json`，每版改了什么见 `CHANGELOG.md`。涨跌由真实历史行情驱动：每局从 135 段真实走势里随机抽一段，大环境、风口和股票小人跟着它走；
画面不说是哪一年、哪家公司，局末用花名讲一篇"这段日子"小故事。玩法上有仓位、押跌、银行抵押借钱、小知识；
局外有每日挑战和排行榜、带平台筹码进场的实盘、分享卡。

![开盘的开始菜单](public/assets/art/v3/scene/title_keyart.svg)

## 功能

开始菜单可以继续、快速开始（沿用上次的人设和难度，第一次是新手 + 第 1 级）、新游戏或实盘，另有每日挑战、图鉴、成就、
设置和关于，左上角常驻「大厅」，下方显示通关、难度、图鉴和成就进度。

- 人设 5 个：职场新人阿韭、退休老周、宝妈芳姐开局可选；程序员小码、炒股大佬靠成就解锁。
- 市场环境 8 级（慢牛 → 末日），逐级叠加约束，通关一级解锁下一级。
- 每日挑战：按日期固定种子、人设和难度，单独记录当天最好成绩；开始菜单的按钮角上写「新题」或今天全站第几名（0.6.9）。
- 群友各有性格和口头禅，每局状态不一样（这局可能特别准，也可能特别不靠谱，得看本局战绩）；收盘时会按局面接话（大赚大亏、连赚、月底钱不够、账户翻倍、大环境转牛转熊），股票小人也按行情改口（0.7.0，见 `docs/design-0.7-chat.md`）。
- 图鉴：股票、群友、道具、事件、成就，局里见过就点亮，另有行情段、小知识和小白词典；成就 45 个（含 4 个隐藏结局），分铜、银、金三档。
- 第一局有分步教程：先讲目标和办法，再在恰好用得上的时候讲群聊、推荐、开盘、风口看板、卖出、大哥带小弟、
  连续涨停和月底还钱，
  可以一键跳过，设置里可以重新开启。

你是刚入市的散户：每天开盘前看群聊里群友对风口的看法（头像旁是本局战绩「说对 3/5」），从 3 只推荐里买一只放进空格，
或者卖掉手里的（今天买的明天才能卖）；然后点「开盘」，看风口热度升温冒火、降温结冰，持仓小人跟着涨跌，
带头大哥涨停时带着同风口的小弟多涨。收盘后有小结卡讲清每只股票为什么涨跌，还有收盘新闻；开盘前小屋里的猫会给一句建议
（新手提示，可关）。每月最后一个交易日收盘后还钱，账户不够游戏就结束；还清后三选一领奖励，偶尔有事件二选一。
右上角「怎么玩」是三页图解。

每局的涨跌来自一段随机的真实历史行情（牛市、泡沫、横盘、熊市、崩盘五种市况），开局前不知道是哪段，游戏里也不说年份；
打完一局看"这段日子"小故事，图鉴"行情段"页能重看。行情没下载下来时自动改用模拟行情，照常计分。

0.4 新玩法（都用大白话，第一次出现时各有一句提示）：

- **买多少自己定**：买的时候选「试一口 / 半仓 / 重仓」（1 份、2 份、剩下的全部；1 份 = 账户的 1/4），持仓卡上能「加仓 / 减一半 / 清仓」，
  卡片上的筹码堆就是仓位大小。一次买超过 1 份，价格会被自己抬高一点。
- **押跌**：拿到「押跌许可证」（月底三选一、空头大V的体验卡）或用炒股大佬开局后，推荐旁多一个「押跌」：它跌你赚、它涨你亏，
  每天有一点手续费；大环境最近在涨时押跌逆风、在跌时顺风；它涨停时押跌的人被轧，亏得更狠。空军老周会进群专门唱空，说错的时候一律喊跌。
- **银行（抵押借钱）**：第 2 个月起可以把金镯子、车、房子、爸妈的养老钱押给银行借钱，借来的钱加进账户一起炒，月底另付利息；
  账户跌到欠款的 1.45 倍银行打电话，跌到 1.25 倍就收走东西、拿回借款（另扣两成）。随时可以还钱赎回；一年结束时银行收回没还的借款。
  难度越高，能押的东西越多、借得越多、利息越高。
- **小知识**：第一次碰到这些玩法时，图鉴「小知识」页点亮一张卡：一句大白话 + 真实世界里叫什么。

快捷键：1–3（有道具时到 4）买对应的推荐（满仓时先选一格替换，再确认），Shift+1–5 卖出第 1–5 格，空格开盘、跳过动画、
月底继续；月度奖励里 1–3 选卡、0 都不要；事件里 1 / 2 选选项；Esc 取消替换、关闭对话框。
触屏设备上不显示快捷键提示，点屏幕任意处跳过动画。

设置项包括主音量、音效音量、音乐音量、静音、动画速度（关闭 / 1× / 2× / 4×）、涨跌配色（红涨绿跌 / 绿涨红跌）
和减少动态效果（不震屏、不闪电、不放烟花，小人和小屋不再做待机动画），保存在浏览器本地。

### 存档、云同步和平台对接

- 存档保存完整的局面快照和写入时的版本号（格式 5），读档直接使用快照：小版本调整数值后，旧存档仍按当时的局面继续。
- 0.3 以前和撤回的 0.4.0-alpha.1 的存档（格式 ≤ 4、6）接不上：读到时清掉，开始菜单提示"版本大更新"后开新局。
  这些版本以前的备份和找回逻辑在 0.6.15 删了，启动时一次性清掉当年留下的备份 key 和 0.3 的本地纪录 `kaipan.records`（`src/platform/storage.ts` 的 `LEGACY_KEYS`，
  测试锁住只清这些，当前的存档、档案、设置不碰）。
- 档案（`kaipan.profile`）与单局存档分开保存，记录图鉴、成就、解锁和各人设、难度、每日挑战的最好成绩；
  损坏时备份到 `kaipan.profile.corrupt` 后重建，不影响单局存档。
- 存档损坏时先备份到 `kaipan.save.corrupt` 再清除。
- 云存档（0.5.7，`src/platform/cloud.ts`，槽的定义在 `src/view/cloudSync.ts`）：登录后同步档案（槽 `profile`）和教程标记（槽 `tutorial`：
  `kaipan.tutorial.v3` + `kaipan.extTips.v1`），打到一半的局（`kaipan.save`）和设置不同步。元数据在 `kaipan.cloud`（`{userId, rev, dirty}`），
  合并前的本地备份在 `kaipan.<槽>.pre-sync`；换账号时上一个账号的本地进度存在 `kaipan.<槽>.pre-switch.<旧 userId>`，它回来时并回去
  （先把元数据记成新账号再并，中途失败下次打开接着并；全部并完才改名为 `.restored`，每个账号每个槽留一份）。
  教程重新开启时记一次 `reset`，合并时次数多的一边整个说了算，不会被别的设备上看过的步骤抹掉。
  切回前台（隔 1 分钟以上）、上传前、收到 409 时重新确认账号；多个标签页靠 storage 事件互通元数据。接口和规矩见总仓库
  `docs/platform-backend.md` 5.5、15.3。本地联调见下面「本地开发」。
- 每日排行榜（0.5.10，交分和读榜在 `src/platform/board.ts`，一局的交分状态在 `src/view/dailyBoard.ts`，面板 `src/view/meta/boardPanel.ts`）：
  每日挑战结束时交一次分到 `daily-YYYY-MM-DD`（北京日期，规则版本 `DAILY_RULES` 大于 0 时加 `-v<n>`），分数是通关 1e11 + 账户元，没通关为还清月数。
  只有用当天冻结段池（`src/core/content/dailySegments.ts`）里那一段真实行情的局才交；段池顺序和数量不能改，要换就加版本。
  交分带确认过的 userId、用 keepalive，429 / busy / wrong_user 不重试，连不上给「重试」；200 但回话看不懂算"交了"，不给重试。
  云同步还没确认账号时，每日挑战开局（或恢复）后几秒先问一次 `/api/me`（0.5.11），免得结束页马上回大厅时这个普通请求被取消。
  读榜按榜和范围缓存 45 秒，交分后那次读也进缓存；交上分（含 odd）时作废这个榜，缓存带版本号，作废前发出的读晚回来不写进缓存（0.5.12）。接口见总仓库 `docs/platform-backend.md` 9.2、15.5。
- 实盘模式（设计 `docs/design-live.md`）：规则在开局设置 `RunSetup.live`（打几个月、账单倍数、涨跌倍数、档位，开局时从 `BALANCE.live` 抄进这局）和 `src/core/live.ts`
  （四档对应难度 1/2/3/3、当前资产 = 账户 − 借款、结回倍数用万分之几的整数、破产为 0）。0.11.0 起开局可选杠杆 1× / 2× / 3×（`live.gear`：封顶、每月利息、清零线，设计稿 2.6），`npm run sim -- --gear` 出杠杆表。`npm run sim -- --live` 出各档的结回分布，`tests/live-sim.test.ts` 锁住梯度。
- 配平（0.10.0，`docs/design-balance.md`）：模拟器里的小白 `xiaobai`、普通 `putong` 两个玩家模型，`npm run sim -- --balance --runs 2000` 出实盘四档、娱乐三档（短局和完整一年）的对照表和一局约几分钟。娱乐短局的规则在开局设置 `RunSetup.short`（`shortSetup`）。
  档位表和结回算法单放在 `src/core/liveTiers.ts`（Worker 也用，不把规则引擎打进 Worker）。
  - 钱包（0.6.0）：浏览器 → 开盘 Worker（同域 `POST api/live/{buyin,settle,refund}`，`src/worker/live.ts`，入口分流在 `route.ts`）→ 服务绑定 `WALLET`（平台的 `WalletService`，`props.game = kaipan`）。
    浏览器只给 `ref`、`tier`、`bp`，金额和到期时间由 Worker 定；认人沿用闸门的 `checkLogin`（为什么不用 kit 的 `whoIs` 见设计稿第 6 节）。
  - 这台设备上的账在 `kaipan.live`（`src/platform/live.ts`）：带入前记 `buying`（回话丢了下次先 `refund` 收回），结回 / 放弃先记 `settling` 再发，
    连不上、`busy`、`internal`、没认出人都留着，打开、回到前台、联网时重发；`expired` / `no_stake` 改成不算筹码；`bad_*` 等是开盘自己的 bug，不重发。
  - 画面：开始菜单「实盘」、开局面板的「娱乐 | 实盘」和四张档位卡、顶栏的实盘小牌子、设置里「提前收手」（还没开盘原样退回，开盘以后按现在的资产结）、
    结束页的结回和第 5 节的文案（`src/view/liveText.ts`，测试按词表查）。接线在 `src/view/live.ts`。冒烟 `npm run shot -- --live`（假钱包）。
  - 战绩小结（0.6.5，平台 5.10）：结回时带 `stats`（`src/core/career.ts`，Worker 原样转发）；称号的中文名在 `public/titles.json`（平台称号墙读 `/games/kaipan/titles.json`），
    由 `titlesJson()` 生成、测试锁一致。钱包和平台的错误照平台 15.10 的对照表说（设计稿第 6 节的表）。
- 每日榜的分数怎么显示（0.6.13）：`public/daily.json`（平台每日榜读 `/games/kaipan/daily.json`；通关分 = 1e11 + 账户元数，没通关 = 还上了几个月，`tests/daily-json.test.ts` 按平台的解析规则锁一致）。
- 分享卡（0.12.0，`src/view/shareCard.ts`，设计 `docs/design-share.md`）：结束页「分享」，开盘只交数据（大数字是资产涨跌幅或实盘结回倍数、最多 3 条小数据、一句名场面、最赚那只股票小人的图集切片），画卡和分享在共用包 `arcade-kit/share`：手机能带图片就调系统分享，不能就出预览（存图、复制链接）。分享的链接是 `gameLink` 按当前页面推的游戏地址，代码里不写站点地址。取代 0.6.5 起开盘自己画的结局海报。
- 社交（0.12.0，`src/main.ts`）：有登录提示 cookie 时挂共用包 `arcade-kit/social`，开着开盘就报"在玩开盘"、收好友的邀请；点"去"走回大厅那条路（先补传云存档）。单独部署、没登录不挂。
- 回大厅（0.5.8，`src/view/lobby.ts`）：跳平台首页 `/`。开始菜单左上角常驻「大厅」，点了直接走；一局里点齿轮 → 「回大厅」，先确认
  （这局存在这台设备上，不算放弃，回来点「继续」）；手机竖屏的"横过来"提示层左上角也有，一局里同样先问。点下后提示"正在离开……"；走之前先等还在确认账号的交分发出去（最多 1.5 秒），再把待上传的槽都补传一次（keepalive，连同在途的 keepalive 合起来不超 60 KB，
  记账在 `src/platform/keepalive.ts`；不受切后台 3 分钟间隔限制；普通请求在途的槽也补一个 keepalive，补过的不再补；额度不够没补成的，原来排好的普通上传照旧，没排的给排一个）。结束页左上角也有「大厅」，直接走。
- 未捕获的错误会弹出独立面板，可以继续、重新载入、放弃存档开新局或复制错误信息；最近 20 条错误记在 `kaipan.errors`。

## 本地开发

需要 Node 22（见 `.nvmrc`）。在本目录里：

```bash
npm ci
npm run dev          # 开发服务器 0.0.0.0:5173（热更新）
npm run build        # 类型检查 + 正式构建到 dist/（Phaser 单独成块；KP_SOURCEMAP=1 时带 sourcemap）
npm run build:cf     # 部署用的构建：产物在 dist-cf/games/kaipan/，适配 /games/kaipan/ 子路径
npm run preview      # 用正式构建启动服务 0.0.0.0:4173
npm test             # 单元测试：core 规则与回放、内容、机器人、平台层（设置/存档/档案）、Worker、音频纯逻辑、架构约束
npm run sim          # 数值模拟：--accept 跑设计稿第 11 节的验收（--part a|b 可并行），--value 测道具价值，--live 实盘各档的结回，--set 临时改数值（见 tools/sim.ts 顶部注释）
npm run shot         # 无头 Chromium 冒烟 + 截图到 shots/（vite 起在系统挑的空闲端口，KP_SHOT_PORT 可指定）；加 -- --main 只跑主流程，-- --playtest 用真实鼠标键盘打一局并计时
npm run audio-check  # 离线渲染所有音效与音乐，检查峰值/响度/时长/拖尾/节点泄漏
node tools/mem-probe.ts  # 按几种手机、平板、电脑的视口和 DPR 估算显存（渲染倍数、纹理、文字画布、主画布）
```

开发和预览服务监听所有网卡，同一局域网里的手机、平板可以直接用 `http://<电脑的局域网 IP>:5173` 打开测试（不登录，云存档、排行榜、实盘不可用，其余照常）。

和平台联调（登录、云存档、排行榜、实盘）：平台目录先 `npm run build` 再 `npm run dev:api`（5181），开盘 `npm run dev` 会把 `/api` 转过去；
先在 http://localhost:5181 登录，再用 http://localhost:5173 打开开盘（`__Host-` cookie 要求安全上下文，用 IP 打开时登录状态带不过来）。

### 调试用 URL 参数

开局参数映射到 core 的开局设置（RunSetup）：`seed`、`account`（开局账户，元）、`items=a,b`（道具 id）、
`friends=a,b`（额外群友）、`themes=a,b,…`（6 个登场题材）、`holdings=a,b`（开局持仓的股票 id，须属于登场题材）、
`difficulty`（难度 1–8）、`persona`（人设 id）、`daily=1|YYYY-MM-DD`（每日挑战）。
带调试开局参数的局不计入档案。
其余：`anim=0`（关闭动画）、`speed=N`（动画倍速，二者优先于设置）、`debug=1`（调试浮层，显示今天预先掷好的行情、
题材真实阶段等隐藏信息）、`scale=N`（强制渲染倍数）、`soundboard=1`（音频试听面板）、`atlas=0|1`（强制不用 / 使用图集）。
`market=synthetic`（用 0.3 的模拟行情）、`market=<段 id>`（指定一段真实行情，id 查 `tools/data/segments-manifest.json`）。
带 seed 或开局设置时跳过开始菜单。开发版和 debug=1 时挂出 `window.__game` 调试接口（见 `src/debug/bridge.ts`，
含 `controls()` 控件坐标、`loadState()`、`skip()` 等）。
例：`http://localhost:5173/?seed=demo&themes=ai,newenergy,consumer,pharma,lowalt,pig&holdings=ai_leader,ai_follower&items=longtou,margin&debug=1`

## 部署

开盘是一个 Cloudflare Worker（名字 `kaipan`）：静态资源加一小段 Worker 代码。`wrangler.jsonc` 是能单独部署的独立配置，不依赖平台；
挂到有平台的站点上时，平台的绑定由部署工具补上（见下面「和平台一起部署」）。

### 单独部署这个游戏

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/yyyu-star/arcade/tree/main/games/kaipan)

点上面的按钮，或在本目录 `npm ci && npm run deploy`（`build:cf` 加 `wrangler deploy`，需要环境变量 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`）。
部署完用 `https://kaipan.<你的 workers.dev 子域>/` 打开，根路径会跳到 `/games/kaipan/`；想挂自己的域名，在 Cloudflare 后台给 `kaipan` 加路由或自定义域名。

单独部署时：

- **有**：完整的单机游戏，存档、档案、设置都在浏览器里；每日挑战照常能打（成绩只记在本机）。
- **没有**：登录、云存档、每日排行榜、钱包和实盘。页面启动时问一次同域 `/api/me`，回 404 或不是 JSON 就当没有平台，把这些入口藏起来，
  "大厅"按钮换成回游戏首页；实盘接口 `/games/kaipan/api/live/*` 直接回 `501 no_wallet`。
- 开盘没有好友房，单独部署和本站一样，没有联机。

### 和平台一起部署

本站上开盘挂在平台同一个域名的 `/games/kaipan` 下，依赖平台（`platform/`，Worker 名 `arcade`）。部署时 `tools/deployer/deploy.mjs` 在独立配置上叠加：

| 名字 | 类型 | 说明 |
|---|---|---|
| `ARCADE` | 服务绑定 → `arcade` | 登录闸门问平台 `/api/me` |
| `WALLET` | 服务绑定 → `arcade` 的 `WalletService`，`props.game = kaipan` | 实盘的带入、结回、放弃 |
| `GATE` | 变量 `login` | 登录闸门：没登录跳 `/login?from=kaipan`，平台有问题回 503 不放行 |

另外关掉 `workers_dev`、`preview_urls`，注入两条路由 `<站点>/games/kaipan` 和 `<站点>/games/kaipan/*`。独立配置里只有 `ASSETS`（`dist-cf/`，由 `npm run build:cf` 生成），没有 secret。
写了 `GATE=login` 却没有 `ARCADE` 时按出错处理：首页回 503，不当成单独部署放行。

只有根路径、首页和实盘接口 `/games/kaipan/api/*` 进 Worker（`assets.run_worker_first`，分流在 `src/worker/route.ts`；接口不看 `GATE`，总要认人），其余静态资源不经过 Worker。
平台续期下发的 Set-Cookie 由闸门原样带回浏览器。

本仓库的正式站由 `.github/workflows/game-kaipan.yml` 部署：改动经 PR 合并进 `main` 且涉及 `games/kaipan/**` 时，先跑模块独立性检查，再 `npm ci`、`npm test`、`build:cf` 并打包，
然后由 `tools/deployer/deploy.mjs` 补上平台绑定和路由后部署（正式站的主机名在 GitHub `production` 环境的 secret `SITE_HOST` 里，没设就失败）；PR 上只测试不部署。
在本仓库里不对正式环境手动部署。需要拆成单独仓库时，在仓库根运行 `tools/split-module.sh games/kaipan`。

## 目录结构

- `src/core/`：游戏规则，纯逻辑且完全确定（种子 + 操作序列可回放），不依赖浏览器和 Phaser。
  数值集中在 `balance.ts`；题材生命周期、个股与连板在 `market.ts`；群聊与推荐在 `chat.ts`；
  股票、群友、道具、A 股日历、事件、人设、难度、成就在 `content/`；每日挑战在 `daily.ts`；画面用的查询函数在 `queries.ts`。
- `src/view/`：Phaser 画面。`session.ts` 持有状态并分发事件；`scenes/` 有启动加载、开始菜单、交易、结束界面；
  `trade/` 是交易主场景的各部分（小屋、顶栏、题材看板、持仓、群聊、月底流程、教程气泡）；
  `meta/` 是开局选择、每日挑战、图鉴与成就、解锁弹窗；`tutorial.ts` 是分步教程的触发逻辑；
  `assets.ts` 是素材清单和图集加载；`sound.ts` 把音频接入画面。
- `src/view/audio/`：程序化音频。合成音效、生成式背景音乐、试听面板；接口约定在 `types.ts`。
- `src/platform/`：设置（`settings.ts`）、存档（`storage.ts`）、档案（`profile.ts`：图鉴、成就、解锁、最好成绩）、
  全局错误兜底（`errors.ts`）、云存档、排行榜、实盘的本地账、横屏提示、版本号。
- `src/worker/`：开盘自己的 Worker：登录闸门（`gate.ts`）、实盘钱包接口（`live.ts`）、分流（`route.ts`）。
- `src/debug/`：URL 参数与 `window.__game` 调试接口。
- `public/assets/art/`：SVG 素材与美术规范；0.3 的股票小人、小屋、群聊等在 `v3/`，由 `tools/art/` 的脚本生成
  （`public/art-preview.html` 是美术预览页）。`v3/atlas/` 是烘焙好的 WebP 图集（`node tools/art/bake.ts`）：
  `game` 首屏加载，`meta`（人设、难度、成就、图鉴）进对应界面再加载；图集缺失时自动回退到单张 SVG。
- `tools/`：自动玩家与数值模拟（`bots.ts`、`sim.ts`）、截图冒烟（`shot.ts`）、音频检查、美术生成（`art/`）；
  `tools/data/` 是真实行情数据管线（WIKI Prices）：`segments.ts` 从年包切出一局用的行情段到 `public/data/segments/`。
- 行情段（`public/data/segments/`）：文件名和 id 是不透明的短哈希，目录只有 id 和文件名，段文件里只有相对涨跌（基点）、
  市况、游戏化标题和大事的故事句，没有年份、日期、公司和代码（`tests/segments-leak.test.ts` 把关）。id 和真实年份的对照只在
  `tools/data/segments-manifest.json`，大事的故事版在 `tools/data/beats.ts`，都不进画面包。重新生成：
  `node tools/data/segments.ts --packs .data/wiki-prices/packs --step 1`（同一份年包结果逐字节一致）。
- `docs/`：现行的是 `design-0.5.md`、`design-0.5-visual.md`、`core-api-0.5.md`、`design-live.md`（实盘）、`design-balance.md`（配平），其余带版本号的是历史稿，
  索引见 `docs/README.md`。

## 许可证

MIT，见本目录的 `LICENSE`（和仓库根目录的一样，拆成单独仓库时随模块带走）。
