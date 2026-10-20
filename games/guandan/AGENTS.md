# 《掼蛋》模块约定

> 总仓库规范见仓库根的 `AGENTS.md`，其中第 1、2 节的硬约束优先于本文件。本文件只写掼蛋特有的约定。

## 1. 目录

```
src/core/   牌馆通用层（docs/doudizhu.md 第 1 节；纯函数、确定性，不引用任何玩法）：cards 牌的编码、rng、seats n 人座位环、play 牌型识别框架 PatternSet、stake 实盘档位表
src/variants/guandan/   掼蛋（玩法之间互不引用，tests/architecture.test.ts 守着）：
  core/     规则核心（纯函数、确定性）：cards 两副牌与级牌牌序（再导出通用层的编码）、patterns 牌型/比大小/枚举（guandanPatterns 是它的 PatternSet）、game 状态机与玩家视角、options 规则开关
  ai/       电脑对手：plan 理牌、bot 决策、persona 强弱五档和性格/状态/局面、venue 场地 → 电脑、memory 记牌（只用公开信息）、hints "提示"按钮的轮换列表、random 随机机器人（模拟基准）
  net/      联机（房间和页面共用，纯函数）：rules 把规则核心接成 arcade-kit 的 RoomGame、rotate 视角旋转（我总在下）、
            stake 好友房实盘的桌（开房选项、带入、每个座位的账、结回）、match 快速匹配的档位和开桌选项、fun-moments 短语表、电脑互动性格、名场面映射（接 kit 的 table-fun）、awards 结束颁奖、together 搭子战绩
  stake/    实盘的规则（纯函数，和 core 同样的约束）：档位、每副的分、封顶、结回额、钱包 ref / op 的拼法、单机一场和好友房每个座位的账（docs/stake.md 第 1 节）；
            titles 称号（只用公开信息，和 public/titles.json 对齐）、stats 结回时带给平台的战绩小结
src/variants/doudizhu/   斗地主（同样的分层；规则取舍见 docs/rules.md、电脑见 docs/ai.md 的"斗地主"一节）：
  core/     规则核心：patterns 牌型（ddzPatterns 是它的 PatternSet）、game 叫分 / 出牌 / 翻倍 / 结算的状态机和玩家视角
  ai/       电脑：hand 拆牌、search 残局搜索、decide 叫分和出牌（新手 / 普通 / 高手）
  net/      联机：rules 斗地主房间规则（娱乐和实盘）、stake 好友房实盘的桌、match 快速匹配档位 ddz-fun 和 ddz-real-<档位>
  stake/    单机实盘的规则（docs/stake.md 第 10 节）：每分、封顶、一场几副、每档的电脑、ref 的拼法
src/net/    玩法无关的联机部分：hall 牌馆的房间规则（一个 RoomGame 按 variant 转给掼蛋或斗地主）、stake-table 好友房实盘的桌里玩法无关的部分（带入、结回、换人、再带入，掼蛋和斗地主各绑一份）、version 页面版本与房间、实盘路径，emotes 互动编号表
src/view/   画面层（Phaser 4）：scenes 场景、table 牌桌部件（nudge 顺手提示和催促炸弹；其余互动在 kit 的 table-fun）、ui 组件与弹窗（kit 按钮和弹窗、panels 设置/战绩/规则/确认框、patterns 牌型图示、cloud 云朵图标、stake 选档、focus 画布里的键盘焦点）、idle 闲着时降帧、art 程序生成 SVG、audio 合成音效、store 存储、
            recap 每副复盘、highlights 名场面、suggest 公开事件后的短语建议、attention 轮到我时的振动和标题闪烁、lobby 回大厅、platform 有没有平台（单独部署）、
            share-card 结算页的分享卡（kit 的 share）、social 报位置和收好友邀请（kit 的 social）；
            斗地主：scenes/DdzScene 三人桌、ddz-session 单机会话、ddz-view 理牌分列和牌型说法、ddz-daily 每日挑战（种子、榜名、交分）、ddz-rules 玩法说明文字（牌桌和主页的"规则"共用，`ui/panels.ts` 的 `openDdzRules`）、ddz-tutorial 新手引导（外壳与掼蛋共用 `tutorial.ts` 的 `runTutorialSteps`）
src/debug/  URL 参数、调试跳转（jump）、window.__game 调试桥
worker/     线上 Worker：main.ts 部署入口（只导出默认导出和 Durable Object 类：workerd 把入口的每个具名导出都当入口，多导出常量单独部署时起不来）、index.ts 请求处理、gate.ts 登录闸门和房间路由、room.ts 联机房间、match.ts 快速匹配的排队、
            stake.ts 单机实盘的带入 / 结回 / 放弃（转给平台钱包 WALLET）
public/     favicon、cover.png（平台封面）、titles.json（称号表，平台按 id 显示）、daily.json（斗地主每日挑战的分数怎么显示，平台读）、_headers
tests/      vitest；architecture.test.ts 检查通用层和各玩法 core/ai/stake 的纯度、互不引用；golden.test.ts 掼蛋金样（tests/golden/ 只放哈希，场景在 golden-scenarios.ts）；tests/room/ 是在 workerd 里跑真房间的测试（`npm run test:room`，单独的配置）
tools/      sim.ts 机器人对打；probe.ts 跟牌积极度；replay-log.ts 试玩日志复盘；shot.ts 无头冒烟与截图；mem.ts 内存估算；build-cf.ts 部署构建；
            art-preview.ts / cover.ts 美术预览与封面；baseline-ai/ 和 baseline-ai-0.1.2/ 旧版电脑的副本（sim 的 prev 基准，不进产品包）；
            online-dev.ts 本地联机栈（wrangler dev + fake-platform/ 假平台，含假钱包 RPC；standalone 时原样用 wrangler.jsonc）；standalone-smoke.ts 单独部署冒烟；online-smoke.ts 四客户端联机冒烟（`--ddz` 是斗地主三客户端）；room-sim.ts 房间规则层批量对打；
            ddz-sim.ts 斗地主机器人对打（稳定性、三档梯度、耗时）；ddz-stake-sim.ts 斗地主实盘模拟（docs/stake.md 第 10 节）；quota-smoke.ts 额度提示冒烟；match-smoke.ts 快速匹配冒烟；stake-sim.ts 实盘计分模拟（docs/stake.md 的数字）；ai-sim.ts 场地、性格、耗时模拟（docs/ai.md 的数字）；stake-smoke.ts 单机和好友房实盘冒烟
docs/       design.md 设计、rules.md 规则核实、core-api.md 接口、stake.md 实盘设计、ai.md 电脑的场地、性格、强弱数字、art-v3.md 主页和牌桌的美术现状、doudizhu.md 牌馆（掼蛋 + 斗地主）的分层、掼蛋金样、斗地主的画面和各模式
```

## 2. 规则核心的约束

- `src/core`、`src/variants/*/core`、`src/variants/*/ai`、`src/variants/*/stake` 不依赖 DOM、Phaser、网络；禁止 `Math.random`、`Date`、`Math.exp/log/pow/sin` 等；随机一律 `rngFor(seed, 用途, …)`。
  `tsconfig.core.json` 只给 ES 库，误用浏览器全局会编译失败。
- 状态是纯 JSON（牌是 0..107 的整数），`dispatch` 不修改传入的状态。同一种子 + 同一串动作必须逐位相同（`tests/game.test.ts` 回放测试）。
- 电脑只能读 `viewFor(state, seat)`，不能碰 `GameState`；`viewFor` 不得包含别人的手牌（防泄漏测试）。联机时下发的也是它。
  给电脑的随机种子、"这一场"的种子一律按用途派生（单机 `session.ts` 的 `soloSeeds`，房间 `rules.ts` 的 `aiSeed`、`formSeed`），不给牌局种子或密钥本身——
  拿着它就能重算发牌。守着的测试：`tests/ai.test.ts` 的反事实测试（单机和房间两条路径 0 不一致，外加阳性对照）、
  `tests/architecture.test.ts`（`src/variants/guandan/ai` 不引用 `GameState`、不出现 `'deal'`/`'firstLead'`）。README"电脑不看牌"一节是给外人看的版本。
- 联机用的核心接口（`timeoutAction`、`previewNext`、规则版本、`SeatAction`/`TableAction`）见 `docs/core-api.md` 5.1，测试在 `tests/online.test.ts`。
  改了会影响牌局结果的规则要加 `RULES_VERSION`，并让旧版本的牌局能按旧规则打完。
- 规则有出入的点先查 `docs/rules.md`；改规则要同步改该文档、`docs/core-api.md` 和测试，地方差异做成 `options.ts` 开关。
- 改电脑策略后跑 `npm run sim`（`--mode random|greedy|ai|easy-vs-hard|normal-vs-prev`），确认无非法动作、无死锁、难度梯度还在。
  改强弱、性格、场地表后跑 `npm run ai-sim -- solo|room|style`，把新数字写进 `docs/ai.md` 和 `docs/stake.md` 1.3、3.1（好友房实盘每档要"两个普通真人搭档期望加两倍标准误 ≤ 0"）。
  配平目标是仓库 `docs/balance.md`（两个玩家模型：普通、小白 `rookie`）：实盘小档、娱乐新手档按小白调，其余按普通调（掼蛋的例外，`docs/ai.md` 2.1）；`ai-sim -- grid` 量搭档 × 对手的每种组合。
  没给性格时 `decide` 就是难度预设本身（聪明提示、代打、`sim` 都靠这个），新加的打法参数默认 0、不改原来的行为。
  `normal-vs-prev` 的基准只在电脑 AI 有改动的版本复制：改了 `src/variants/guandan/ai` 打法的 PR 里，把这一版的 `src/variants/guandan/ai` 复制成
  `tools/baseline-ai-<版本>/`（改 import 路径）、把 `sim.ts` 的 prev 指过去，PR 说明写一句；普通发版不动。现在的基准是 0.1.2，强弱另用 `ai-sim` 的胜率表对比（docs/ai.md）。

## 3. 画面层约定

- 推进状态只有一条路：`Session.apply(action)`（`TableSession` 接口，单机 `session.ts`、联机 `net.ts`）→ 核心 `dispatch` → `TableScene` 拿事件按顺序 `await` 播放 → `sync()` 按 `viewFor` 刷新 → `pump()` 决定下一步
  （电脑"想一会儿"再出、等玩家、弹结算）。画面不自己判断牌型和大小：能否出牌用 `interpret` + `beats`，提示用 `hintList`（首条 null = 建议不要），
  一副结束时的"下副谁进贡"用 `dispatch(state, nextDeal)` 推演（纯函数，不改当前状态）。
- 世界坐标高 720，宽 1280..1720 随窗口宽高比变（`worldWidthFor`）；画布按 `RENDER_SCALE`（1..3）倍像素绘制，相机同倍 zoom，
  Text 的 resolution 同倍，SVG 按目标像素栅格化（`textures.ts`）。新加文字一律走 `ui/kit.ts` 的 `text()`，最小字号 18；手机横屏 `text()` 按 `theme.ts` 的 `typeFloor` 托底到字 12、纯数字 14 CSS 像素，
  放不下的地方按 `phoneType()` 删字（`fitWidth` 截断、少放一行），不缩字。改了画面跑 `npm run shot -- --gallery --audit --sizes 667x375,844x390` 看 `audit.md`。
- 尺寸一律按实际可见区域（`device.ts` 的 `appBox`：visualViewport 量出的区域扣掉安全区），不用 `screen` 和 `100vh`——iOS Safari 的这两个是
  工具栏收起时的最大值，按它排顶栏会被地址栏盖住。`#app` 由 JS 钉成像素大小，CSS 里的 100vh/100dvh 只是 JS 跑之前的兜底。
  尺寸没变不写、双指放大中不跟（`fitAppToViewport` 返回是否改了，改了才 `scale.refresh()`）。重建画面（换世界宽度 + `scene.restart`）会丢选牌、
  动画、弹层：触屏设备只在转屏时重建，电脑上宽度差 40 以上才重建；场景的 `canRebuild()` 为假（牌桌忙、有弹层、选着牌）时推迟到空闲。
- 闲着时降帧（`idle.ts`）：4 秒没有点按、按键，牌桌不忙（`isBusy`），也没有一次性补间在播，帧率上限降到 31；一秒看一次，不要改成每帧看（会拖住场景时钟）。
  `repeat: -1` 的装饰循环按 31 帧播，别在里面做重活。要 await 的动画一律走 `anim.ts` 的 `tweenP`、`wait`，或者自己包一层 `settle`：最多等"时长 + 500 毫秒"就当播完，动画出岔子也不卡牌局。
- 内存（老 iPhone 只有 2GB，超了 WebKit 直接杀页面）：iOS 上 `RENDER_SCALE` 封顶 2，2 倍时关 WebGL 多重采样；背景大图按世界宽度烘焙，
  换宽度后 `dropBackdrops` 删旧的；`guandan.boot` 记"前台开着"，被杀后下次自动降档（1 倍 → Canvas 渲染），换版本重置。
  量内存用 `node tools/mem.ts`（模拟 iPhone 8 / 8 Plus 横屏，按倍数列纹理、文字画布、主画布像素和 Chromium 进程 PSS）。
  新加大纹理先跑一遍它；冒烟 `viewport` 一段覆盖可见区、工具栏遮挡、降档和 Canvas 渲染。
- 动画时长一律经 `anim.ts` 的 `dur()`（设置里的速度、URL `anim=0` 瞬间完成）；冒烟靠 `anim=0` 和 `autoplay=1` 快速推进。
- 手牌分列是纯函数 `table/columns.ts`（有单测）；一列最多 5 张，保证手机横屏每张牌露出的部分都点得中（冒烟里逐张点验证）。
- 座位：0 我（下）、1 老张（右，下家）、2 小美（上，对家）、3 阿强（左，上家）。性格只影响台词/表情（`personas.ts`）。
  斗地主三人桌：0 我（下）、1 老周（右，下家）、2 王姐（左，上家），布局 `table/layout.ts` 的 `seatAnchors3`；`labels.ts` 的 `setTablePersons` 换成这两个人。
- 斗地主（牌馆，`docs/doudizhu.md`）：主页标题"牌馆"，下面是"掼蛋 / 斗地主"切换（控件 `variant:guandan` / `variant:ddz`），上次选的记在 `guandan.variant`，面板、主页"规则"跟着切。
  场景 `ddz`（`DdzScene`）复用掼蛋的手牌、出牌区、座位、按钮、弹窗、牌面、音效和 kit 的互动：手牌和出牌区由玩法给"怎么理牌、一手牌怎么写"（`HandOrder`、`DescribePlay`，不给就是掼蛋原样）。
  推进同样只走 `DdzSession.apply` → `dispatchDdz`；电脑只拿 `viewDdz`，随机数按 `ddzSeeds` 派生。URL 带 `?ddz=1&seed=…` 直接开一局（调试，已有存档时不写）。
  每日挑战（`ddz-daily.ts`）：种子只看北京时间的日期、两个普通难度电脑、6 副累计分交到平台 `daily-<日期>-ddz`，不存档、不记战绩。冒烟 `npm run shot -- --only ddz`。
  单机实盘（`ddz-stake.ts`，数字见 `docs/stake.md` 第 10 节）：`DdzStakeSession` 是 `DdzSession` 加一场的账，带入、结回、放弃走掼蛋同一套接口（请求体多 `variant: 'ddz'`），选档页是同一个（`ui/stake.ts` 的 `openTierPicker` 传 `DDZ_FLOW`），选档页里有"和电脑 / 快速匹配"（匹配排不到转同档单机）；
  ref `solo-ddz-…` 和掼蛋的互不匹配，"别的设备上开的那一份"各认各的（`strayStake` / `strayDdzStake`）。冒烟 `npm run stake-smoke -- --ddz-only`。
  好友房和快速匹配（娱乐和实盘）：房间是同一个 `worker/room.ts`，规则走 `src/net/hall.ts`（开房选项 `variant: 'ddz'`，状态里带 `variant` 的转给斗地主，没有的就是掼蛋、形状一点没动）。
  页面的联机会话基类是 `net.ts` 的 `RoomLink`（连接、座位、帧队列、出手锁到 ack、聊天、互动），掼蛋 `NetSession`、斗地主 `ddz-net.ts` 的 `DdzNetSession` 各自继承；`DdzScene` 经 `DdzTableSession` 接口同时用单机和联机会话，会话放在 `app.ddzNet`。
  玩法由房间信息 `room.opts.variant` 说了算，不看 `guandan.variant`：开房、匹配、记着的房间（`guandan.room` 的 `variant`）知道玩法就直接按它连，输码和邀请链接先当掼蛋连，发现不对就换会话重连。
  kit 的 `RoomInfo.seats` 按最大座位数给 4 个，斗地主只用前 3 个（`seatCountOf`）。匹配档位 `ddz-fun`、`ddz-real-<档位>`，一桌 3 人。冒烟 `npm run online-smoke -- --ddz`（三个浏览器，约 2 分钟）。
  斗地主好友房实盘：开房请求体 `{ variant: 'ddz', stake: 档位 }`（`hall.ts` 的 `parseHallOpts`），桌在 `src/variants/doudizhu/net/stake.ts`（状态 `DdzNet.stake`、视图 `DdzNetView.stake`），6 副或任何一家到 ±40 分，ref `ddz-<16 位十六进制>`；
  带入、结回、离开、再带入的规矩和掼蛋好友房是同一份实现（`src/net/stake-table.ts`），房间的 `perform` 也是同一个；电脑暂用最强一档。房间测试 `tests/room/ddz-stake.spec.ts`，规则层 `tests/ddz-net-stake.test.ts`，冒烟 `npm run stake-smoke -- --ddz-room`。
- 存储只在 `store.ts` 里读写（测试检查）；调试桥 `window.__game` 只在开发模式或 `?debug=1` 时挂。
- 标题字体是内嵌的宋体子集（`fonts.ts`，README 素材一节）：新加的大字、横幅、弹窗标题如果用了字表里没有的字，`tests/view.test.ts` 会报缺字。
- 两种部署（arcade-kit 的独立模式，由 env 决定）：`wrangler.jsonc` 是独立配置，不写 `ARCADE`、`WALLET`、`GATE`；本站部署时部署工具（`tools/deployer`）按 `tools/workers.json` 补上平台绑定和 `GATE=login`。
  没有 `ARCADE`、`GATE` 也不是 login 就是单独部署：`gate.ts` 先调 `standaloneRoot`（站点根转到 `/games/guandan/`），`loginGate`、`acceptCreate`、`acceptJoin` 传同一个 `GUEST`（昵称不许含电脑的名字，掼蛋三个、斗地主两个，`tests/gate.test.ts` 和画面上的名字核对），
  没有 `WALLET` 时单机实盘接口和实盘房间回 409 `no_wallet`、房间的 `perform` 兜底拒绝。页面在 `src/view/platform.ts`：启动时 kit 的 `detectPlatform` 问一次 `/api/me`（`main.ts` 和 `BootScene` 等它），
  回 `{ standalone: true }`（单独部署时 kit 的 `standaloneRoot` 接住 `/api/me`，所以 `run_worker_first` 里有它）或 404 是单独部署——不摆实盘和云存档（主页没有"实盘"卡）、"大厅"变"首页"回 `./`、`currentUserId` 回固定的游客（同一个浏览器就是同一个游客）、好友房面板填昵称（`guandan.nick`）并用 `withNickname` 带在开房、进房地址上；
  5xx、超时按有平台处理。本地：`npm run online-dev`（和 online/stake/quota 冒烟）写一份补了平台绑定的派生配置连假平台；`npm run standalone-smoke` 原样用 `wrangler.jsonc`。
- 健康检查和报错：`gate.ts` 的 `handle` 第一件事是 `GET /games/guandan/health`（`HEALTH_PATH`）→ `{ ok: true, version }`（版本取自 `package.json`，`no-store`；不认人、不读存储、不碰平台，单独部署也一样，`tests/gate.test.ts` 守着），`wrangler.jsonc` 的 `run_worker_first` 里有它、`observability.enabled` 开着（`tests/config.test.ts`）。
  页面 `main.ts` 开头挂 kit 的 `reportErrors({ game: 'guandan', version })`（`arcade-kit/report`）：没人接住的报错报给平台 `/api/client-error`，和本地的兜底面板（`errors.ts`、`guandan.errors`）互不影响。
- 登录闸门（`worker/gate.ts`，用 arcade-kit 的 `loginGate`）：线上只有三个首页路径（`wrangler.jsonc` 的 `assets.run_worker_first`）先进 Worker，js、图片照旧直接走静态资源。
  变量 `GATE`：`"off"` 原样放行；其他值（包括没配）都要登录：没带平台会话 cookie 的直接 302，带了的经服务绑定 `ARCADE` 问平台 `/api/me`（地址按请求的 origin 拼）。
  已登录放行、未登录 302 到 `/login?next=<请求的路径 + 查询>`（登录完回到原链接，房间链接直接进房），这两种都把平台下发的 Set-Cookie 原样带回浏览器（会话续期、清失效 cookie）；
  其他一切情况回掼蛋自己的 503 页（`DOWN_PAGE`）——fail-closed，宁可谁都进不去也不放行。kit 里的细节（转发哪些头、3 秒超时）以 kit 为准，测试在 kit 的 `auth.test.ts`。
  本地 `npm run dev` / 冒烟走 vite，不经过 Worker。要看平台模式的运行时行为用 `npm run online-dev`；`npx wrangler dev`（先 `npm run build:cf`）原样起来是单独部署。
- 站点地址不进仓库：`wrangler.jsonc` 不写路由，部署时由部署工具用部署环境的 secret `SITE_HOST`
  注入 `<站点>/games/guandan`、`<站点>/games/guandan/*` 两条路由和 `SITE_ORIGIN`（没设就失败，不带着空路由部署）。
  代码里的同站校验用 `SITE_ORIGIN`，没设就按请求自己的 origin；给玩家看的话不写域名；测试夹具用 `game.example.com`。
- 云存档（`src/view/cloud.ts`；规格见仓库 `docs/platform-backend.md` 5.5、15.1–15.3）：只同步 `stats` 和 `tutorial` 两个槽，牌局和设置不同步。
  store 里改这两个槽的函数会发 `onSyncedChange`，`main.ts` 接到 `CloudSync.markDirty`；云同步写回本地走 `rawStore`，不再触发通知。
  合并：数字取大、布尔取或、数组并集。上传 10 秒防抖 + 同槽至少隔 5 分钟（每人每天 100 次 PUT）；切后台 / pagehide 用 keepalive 补传一个槽，
  但离上次上传不到 3 分钟不补；429 之后的改动也不早于 retryAfter。
  换账号（`/api/me` 的 user.id ≠ `guandan.cloud` 的 userId）不合并、不上传：识别到的当下就备份、清空本地、存盘，再去拉取新账号的数据
  （拉取失败或页面被关也不会留下"旧数据 + 新账号"）。没有提示 cookie `__Host-arcade_li` 时一个请求都不发。
  单独部署不启动云存档；有没有平台由启动时那一次 `/api/me`（`platform.ts`）判断，没登录也会发这一个。
  连不上、停服时登录状态不明：图标不显示"未登录"、点了只给说明，不引人去登录（15.1、5.7）。
  平台按 cookie 记账，页面开着时别的标签页可能换了账号：每个 PUT 都带 `/api/me` 给的 `userId`，不是当前会话的账号时平台回
  409 `wrong_user`、一行不写——不合并、不重试，按换账号处理（备份到 pre-switch、清本地、元数据不记账号，再问 `/api/me`）。409 要按 `error` 区分 `conflict` 和 `wrong_user`。
  回到前台 / 拿到焦点（`resume`）也问一次 `/api/me`，按上次"尝试"的时间限 1 分钟一次（连不上时不会每次切回来都问）。
  换号前先看存盘的元数据：别的标签页已经换过号，就只跟上内存、不再备份清空。换号时清掉跟着旧账号的 413 封槽、429 等待、上传间隔。
  400 表示请求本身不合格：这个槽本次打开不再传，不算"连不上"。
  拉取也带预期账号：`GET /api/saves/guandan?userId=<user.id>`，回 409 `wrong_user` 时走换号流程；GET 回来时本页账号已经变了就丢掉结果。
  多个标签页靠 `storage` 事件同步元数据：rev 取大；别的页传完、本页又没改过的槽，本页的待上传跟着清掉。
  本地联调：`npm run dev` 把 `/api` 代理到平台的 `npm run dev:api`（5181），浏览器先在 5181 登录。冒烟里 `/api` 由 `tools/shot.ts` 的假平台回答。
- 主页（标题页，现状见 `docs/art-v3.md` 第 4 节）：左边茶馆一角（背景 SVG + 单独烘焙的灯笼 `home:lantern`、四个人 `home:fig:<id>`），右边一块面板；排版是纯函数 `src/view/home-layout.ts`，背景和场景共用，宽屏一起铺开。
  面板从上到下：标题"牌馆"、"掼蛋 / 斗地主"切换、主按钮（有实盘存档 `resumeStake`，否则有存档 `continue`，否则 `quick` 快速开始娱乐）、三张卡 `fun` / `stake` / `online`、战绩条（点开战绩）；右上 `stats`、`settings`、`rules`、`cloud`。括号里是冒烟用的控件名。
  灯笼晃、人物呼吸、火星只在 `LOW_MEMORY === 0` 且没关动画时开。
- 回大厅（`src/view/lobby.ts`，所有游戏统一）：左上角"大厅"（小房子）指向平台首页 `/`；单独部署叫"首页"、指向 `./`，标题页本身就是首页，不摆。标题页直接走；牌桌上打到一半先弹确认（这局会存着 / 调试开局不保存 / 好友房：头 60 秒轮到你时等 30 秒按"能不出就不出"代出，之后电脑替你打，回来接着打——回大厅不调 `leave()`，座位和 `guandan.room` 都留着）；
  手机竖屏时牌桌被"请横过来"盖住，提示层左上角也有一个（打到一半用浏览器自带的确认框）。离开前调一次 `cloud.flushOnHide()`（pagehide 时也会触发，同槽在途不重发）。
  小房子图标只用来表示"回大厅"；回掼蛋自己的首页用箭头。冒烟只断言跳到 `/`，不加载平台页面。
- 联机好友房（底座是 `packages/arcade-kit`，房间规范见仓库 `docs/platform-backend.md` 第 4 节）：
  - 每天的额度（kit 的计量）：`wrangler.jsonc` 绑 `METER`（`RoomMeter`，入口 `worker/main.ts` 导出），门槛在 `vars.KIT_QUOTA`（掼蛋 5 万停开新房、6 万收场；
    10 万行全账户共用，各游戏怎么分见仓库 `docs/platform-backend.md` 4.7）；每人同时 5 个房间、每天 100 个。没绑 `METER` 时 kit 不限额，`tests/config.test.ts` 守着绑定和门槛。
    收场点 `breakPoint` 是结算页（一副打完）。页面上的几句话在 `src/view/quota-text.ts`，`npm run quota-smoke` 逐条核对。
  - 发牌（安全）：联机开局走 kit 的 `begin`（256 位熵），核心 `createKeyedGame` 把它存成 `GameState.key`，每一副从 `stream(key, 'deal', 第几副)` 发，`seed` 是空串；
    `key` 只在服务端，`viewFor` 不带。规则版本 2 = 按密钥发牌，1 = 按种子（单机，和更早开的旧联机局）。不要再让联机牌局用种子发牌，也不要给 `rngFor` 喂密钥（它会压成 32 位）。
  - 服务端说了算：房间（`worker/room.ts`）只继承 arcade-kit 的 `GameRoom`，规则从 `src/variants/guandan/net/rules.ts` 来；入座、轮流、30 秒超时代出、掉线 60 秒电脑托管、
    每步最多写 2 行都由底座管，这里不另写一套。下发的只有 `viewFor(state, 座位)`（没入座 = -1，空手牌）和这一步的事件，`tests/net.test.ts` 查泄漏。
  - 一副结束（docs 9.1、`docs/core-api.md` 的 nextDeal）：每个真人在结算页点"继续"（`ready`），电脑和托管座位由房间立刻代点，没点的真人 20 秒（`READY_MS`）到点由房间代点；
    最后一个人准备好的那一步里开下一副。玩家发不了开下一副的操作（`next` 解析不认）。这一刻谁能出手用 `actors()`、时限用 `turnMs()`，
    双下的进贡、还贡也靠 `actors()` 两个人同时等。结算页开着时，别人点"继续"的帧（step 不变）要当场收下刷新，不然会堵住开下一副的那一帧。
  - 路由：`POST /games/guandan/room/rooms` 开房（`acceptCreate`），`GET /games/guandan/room/rooms/<6 位码>/ws` 进房（`acceptJoin`），都要登录（问平台 `/api/me`）、同源。
    变量 `ONLINE`：`"on"` 开放；`"off"`（以及配错的值）开房回 404（页面说"好友房暂时关了"），进房接上就以 4004 关掉（和"没有这个房间"一样，客户端不再重连）。
    标题页一直有"好友房"，本机记着这个账号的房间时旁边还有"回到房间"；`?online=1` 是"打开就弹出好友房面板"（平台大厅的入口），邀请链接 `room=` 不带它也能进。
    房间路由不经过 `GATE`：认人由 arcade-kit 问平台，认不出就 4401。
  - 记着的房间分账号（`guandan.room` 带 `userId`）：进房后问一次 `/api/me` 记下是谁的；标题页"回到房间"、大厅"回到刚才的房间"、邀请链接带房主标记之前都现问 `/api/me` 核对，
    不是这个账号的（或旧记录没记账号）就不给并清掉（`myRoom`/`roomOwnerCheck`）；云同步发现换号、退出时也清（`CloudDeps.forgetRoom`）。回不去的关闭码（`isFinalForRoom`）都清。
  - 页面：`src/view/net.ts` 的 `NetSession` 和单机的 `Session` 实现同一个 `TableSession` 接口，牌桌场景不分单机联机；收到的帧排队，一帧帧播，
    出手发出去后锁住，等 ack 或报错再解锁。视角旋转在 `src/variants/guandan/net/rotate.ts`：真实座位 s 显示在 (s − 我 + 4) % 4，按队记的值在我坐奇数位时对调。
    大厅是 DOM（`src/view/online.ts`）：开房、输码、选座、房主开局；刷新、切后台回来、掉线都自动接回原座位（进房后地址栏带 `room=<码>`，离开房间时去掉）；关闭码一律换成大白话（`closeText`），
    重连中、连不上时的话走 `NetSession.linkText`：上次断开是 1013 就说"平台有点忙"，不让玩家去查网络（关闭码由 kit 的 `onStatus` 带来，1006 是断网）；4030 是这个人的消息额度用完，不再重连。
  - 开打后座位绑人：坐过的人只能回自己的座位（别的回 `not_your_seat`），没坐过的人只能接管没绑人的电脑座位（`SeatInfo.reserved` 为 false），
    绑了别人的座位接管不了（`seat_reserved`），电脑一直替主人打、显示"电脑代 某某 打"。大厅按 `you.bound` 给离座的人"回到我的座位"，`reserved` 的电脑座位不挂"接管"。
    回归测试在 `tests/room/seats.spec.ts`（防离座后接管对手的电脑座位、看到对手手牌）。
  - 旁观（仓库根 `docs/social.md` 1.4）：开打后没坐下的人也进牌桌（`NetSession.watching`），看的是房间给没入座的公开视图（座位 -1，没有任何人的手牌，`tests/net.test.ts` 查泄漏）。
    画面座位 0 是真实 0 号座位上的人：`labels.ts` 的 `isWatching()` 为真时 `fullSeatName(0)` 不叫"你"，`SeatView.self` 为假（画名牌、剩余张数），
    牌桌里判断"是不是我"一律用 `TableScene.isMe(seat)`（旁观时谁都不是），两队叫一队、二队（`side()`；"一二队"在标题字体里）。
    不能出手、不能扔互动（kit `not_seated`），顶上写"旁观中"；`NetSession.freeSeat()` 给"坐下"：回自己绑着的座位，娱乐房间接管第一个没绑人的电脑座位，实盘房间只看。
    `autoSeat` 开打后不再替人接管（先旁观）。坐下后会话换座位、牌桌整个重画。结束页旁观的人只有"回首页"、没有分享。
  - 快速匹配（设计在 kit 的 `docs/match.md`，房间规范是仓库根 `docs/platform-backend.md` 4.6 的匹配桌一行）：
    排队是 `worker/match.ts` 的 `Queue`（kit `MatchQueue` 的子类，`wrangler.jsonc` 的 `MATCH`，每个档位一个实例），路由 `GET /games/guandan/room/match/<档位>` 走 kit 的 `acceptMatch`（`gate.ts`，同样受 `ONLINE` 开关；没有 `WALLET` 只开 `fun`）。
    档位在 `src/variants/guandan/net/match.ts`：`fun` 用娱乐好友房的规则，`real-<档位>` 用好友房实盘的规则（开桌选项 `{ stake }`，房间的 `parseRoomOpts` 校验）；改档位或桌大小跑 `tests/match.test.ts`（kit 的 `matchConfigErrors`）。
    页面：选难度页的 `match`、选档页的"和电脑 / 快速匹配"（控件 `mode:0` / `mode:1`）→ `online.ts` 的 `openMatch`（排队卡 `#ol-match-wait`，人数、倒计时、`#ol-match-solo` 不等了、`#ol-match-cancel` 取消）；
    排到了 `join(code, false, null, true)`，房间信息里 `room.match` 为真（`NetSession.match`）：大厅和牌桌不摆房间码、叫朋友、邀请、开局，分享卡不带房间码；`solo` 由标题页转同档单机（娱乐 `newGame`、实盘带入一份）。
    陌生人聊天：设置"聊天"一行的"不和陌生人"（`strangerChat` 为假，默认开；手机横屏左栏放不下第七行，和 `chat` 并成一行三档）时，匹配桌的 `NetSession` 不给 `onChat`（kit 不带 `chat=1`），`chatOn` 为假，牌桌不给聊天页；记着的房间带 `match: true`，刷新接回去也照这个设置。
  - 报位置、收邀请（`src/view/social.ts`）：kit 的 `mountSocial`，`main.ts` 在 `detectOnce` 之后挂，没平台、没登录不挂；`where()` 在好友房里报 `place: room`、房间码和真人几个（"3/4"），
    别的时候报 `place: game`；进房（第一次连上）、离开房间时 `presenceNow()` 补报一次。邀请横条和"去"（跳 `/games/<id>/?room=<码>`）都是 kit 的。
    房间大厅的"叫朋友来"（`ol-share`）和牌桌顶上的邀请图标（控件 `invite`）都调 `openInvitePanel`：kit 的"叫朋友来"面板，没挂上 social 时 `friends: false` 只有复制链接；链接按当前页面地址拼。
    面板传 `zIndex: INVITE_Z`（8800）：要盖住房间弹窗 `#online`（8500），在"请横过来"（9000）、出错面板（9500）之下；改这几个 DOM 层级时 `tests/share-card.test.ts` 会核对。
  - 改了房间和页面之间的约定（动作、视图形状）就加 `src/net/version.ts` 的 `CLIENT_VERSION`：旧页面进房会被 4005 请去刷新。改规则加 `RULES_VERSION`，打到一半的房间按旧规则打完。
  - 验收：`npm run test:room`（真房间机器人对打、写入行数、断线、让位、座位绑人、结算等人）、`npm run room-sim`（规则层大批量）、`npm run online-smoke`（四个浏览器端到端，约 5 分钟，`--quick` 跳过 70 秒托管那项）。
- 实盘（设计和数字在 `docs/stake.md`，钱包接口是仓库 `docs/platform-backend.md` 5.9）：
  - 规则都在 `src/variants/guandan/stake/`（纯函数）：档位、每分 = 一份的 1/20、封顶 ±20 分、单机 8 副 / 好友房 5 副、单机每档的电脑、结回额、ref 和 op 的拼法。
    Worker、页面、以后的房间都从这里取，不各算一份。钱包的 ref、op 只能是 8–64 位的 `[A-Za-z0-9_-]`（不能带冒号），测试锁着。
  - 掼蛋好友房和斗地主好友房的通用部分在 `src/net/stake-table.ts`（见下面斗地主一段）。
  - 单机：`worker/stake.ts` 的 `POST /games/guandan/api/stake/{buyin,settle,refund}` 认人（kit 的 `whoIs`）、只认本站 Origin、查数在规则范围里，
    转给服务绑定 `WALLET`（`entrypoint: WalletService`、`props.game: guandan`，`tests/config.test.ts` 守着），`mode: client`。钱包的回话原样带回；
    业务上的拒绝走返回值（200 + `{ ok: false, error }`），HTTP 状态码只说"没到钱包"（400 / 401 / 403 / 503）。
  - 页面：`src/view/stake.ts`（存档 `guandan.stake`、`StakeSession`、结回和放弃）、`src/view/ui/stake.ts`（选模式、选档位）、`src/view/stake-text.ts`（说的话）。
    一场结束先把要结的数记进存档，再去结回；结回、放弃遇到 `busy` / `internal` / 连不上按同一个 op 重试，还不行留着存档下次再结；`no_stake`（结过）、`expired`（过期退回过）都算办完。
    实盘不计战绩、不写 `guandan.save`、规则用默认；主页直接有"娱乐 / 实盘 / 好友房"三张卡，实盘卡进选档。冒烟 `npm run stake-smoke`（本地栈的假平台带一个内存里的假钱包 RPC）。
  - 好友房：开房请求体 `{ stake: 档位 }` → kit 的开房选项（`RoomOpts`，规则的 `options` 校验）。桌在 `src/variants/guandan/net/stake.ts`，状态里是 `NetState.stake`（娱乐房间没有这个字段，
    所有实盘的钩子对它原样返回）：`begin` 给每个真人记带入（真人不到 2 个整场不计输赢）、`seated` 管换人——
    接管开局时就是电脑的座位记一笔带入，点"离开"的人按当时的分马上结回（一副打到一半离开的，等这副打完再结，docs/stake.md 3.3），走了又回来用新的 ref `<ref>s<座位>n<第几份>` 再带入一份，
    带入被拒的人有"重新带入"（不轮流的 `buyin`）；每副 `stakeDeal` 记账，一场结束（5 副 / 过 A / 到账的都封顶）`over` 为真、记结回，`closing` 就地结束。
    结回带战绩小结 `stats`（`src/variants/guandan/stake/stats.ts`）。房间的 `perform`（`worker/room.ts`）去钱包办：带入前先 `view`（钱包只记最近 32 个 op），
    `busy` / `internal` / 异常抛出去让 kit 退避重试，业务拒绝回 `{ ok: false, error }` 交给 `settled`。视图 `NetView.stake` 公开每个座位的分和到账，被拒原因只给自己。
    房间测试 `tests/room/stake.spec.ts` 用 `tests/room/wallet.ts` 的假钱包（测试入口 `tests/room/main.ts` 多导出 `FakeWallet` / `WalletBank`，WALLET 绑到自己）。
- 牌桌互动（整套用 kit 的 `arcade-kit/table-fun`，规范是仓库根 `docs/table-fun.md`，和德州、麻将同一个组件；公平底线：人人一样、免费、不挂筹码，不停计时、不挡牌和按钮）：
  - kit 管头像菜单、互动面板、表情菜单、首次提示、冷却、护盾、连击、回敬、长按连扔、电脑反应（`botReact`）、污渍；掼蛋只接线（`TableScene.buildFun`）：
    头像的屏幕矩形（世界坐标 × 画布缩放，`worldRect`）、名字、谁是电脑和性格（`variants/guandan/net/fun-moments.ts` 的 `TEMPER`：阿强爱闹、老张普通、小美高冷）、
    不能盖的地方（操作按钮和手牌那一条）、"互动"按钮的位置（我的头像和"理牌"之间）、发送通道（好友房 `net.emote`，单机直接交回 `fun.receive`）。
  - kit 的 DOM 层盖在画布上：有弹窗（`overlay` 或 `ui/focus.ts` 的焦点层）时整个藏起来（`syncFunShown`，每 200 毫秒对一次、变了才写），不然会挡住弹窗上的按钮。
  - 编号（`src/net/emotes.ts`，只往后加）：客气话 0–7、嘲讽 8–19 合起来是 kit 的短语表（`PHRASES`），表情 20–31、道具 32–39 正好是 kit 的排法。
  - 名场面（`variants/guandan/net/fun-moments.ts`，纯函数有单测）：炸弹压了对方、头游、双下 → kit 的 `bomb`、`first-out`、`double-down`；单机交给 `fun.moment`，好友房在 `worker/room.ts` 的 `onStep` 里问每个电脑的 `botReact`、经 `botEmote` 发。
    真人冲电脑扔的在 `onEmote` 里用 kit 的 `hitEvent` 认、电脑回应。冷却只在内存里，不写存储、不记真人短语。电脑出牌（`src/variants/guandan/ai`）绝不读这些。
  - 电脑气泡里的话是掼蛋自己的台词（`MOOD_LINES`，按 kit 的六种情绪，经 `moodLines` 传给 kit），好友房的页面也用它配电脑的表情。
  - 掼蛋自己多的在 `table/nudge.ts`：公开事件后的顺手提示（`suggest.ts`）、好友房里轮到的人想了 8 秒以上别人能扔的"催促炸弹"、
    单机里我想了 8 秒以上爱闹的电脑按 `URGE_P` 扔一个催促炸弹（`slowUrge`，每手最多判一次，走 kit 的收，同样受护盾）。收到的短语、表情配掼蛋自己的提示音（`funIn`）。
  - 好友房聊天（kit 的 chat，设计在 kit 的 `docs/chat.md`）：房间 `rules.ts` 写 `chat: true`；页面 `NetSession` 的 `onChat` 换成画面座位交给 `chatSink`（牌桌挂上、关时摘掉），
    `TableFun` 给 `chat` / `chatEnabled`（设置"聊天：开 / 不看"，`guandan.settings` 的 `chat`）；kit 的聊天框、手机"聊天"按钮（掼蛋指定在顶栏 `chatButton`）、弹幕，牌桌给 `plate`（`SeatView.plateBox`）和 `center`（`TrickView.boxes`）让它避开；单机用 kit 的 `localChat`，只在自己头像旁冒，不发不存，电脑不读。房间只转发不存，规则、电脑都不读；`tests/room/routes.spec.ts` 走真路由核对，`online-smoke` 里 1 号打一句、房主看到。
  - 设置里能整个关掉（字段名仍是 `taunts`）；点头像"屏蔽他"、面板里"全部屏蔽"只管这个房间（kit 存 sessionStorage `guandan.fun.blocked`）。冒烟点的控件是 kit 的名字（`fun:button`、`fun:seat3`、`fun:prop0`……，换成世界坐标放进 `controls()`）。
  - 轮到我：提示音、振动、后台标题闪（振动和标题闪在 `attention.ts`），最后 5 秒嘀嗒；轮到的人想了 8 秒以上别人能扔"催促炸弹"，纯画面。
  - 称号和每副复盘只用公开信息（出牌记录、名次），电脑决策不读表情。
  - 再来一场：娱乐房间打到 gameOver 先不 `over`，用 kit 的 `pause`/`resume` 停 `AGAIN_MS`（3 分钟）；有人发不轮流的 `again { code }`（他先开好新房间），
    大家跟过去按和他的相对位置自动坐（kit 让开房的人坐 0 号）。没人点就结束、还名额。实盘房间不等。
  - 走开了：`timeout()` 给的操作带 `idle: true`（`parse` 会去掉，浏览器伪造不了），`NetState.idle` 数每个座位连着几手被代出，
    到 `IDLE_AFTER`（2）后这一手只等 `IDLE_MS`（3 秒）；自己出一手或发 `back`（"我回来了"）清零。代出什么不变，规则核心看不到这个记号。
    浏览器每次连上（welcome：打开页面、断线重连）看到自己还 afk 就自动发一次 `back`：连得上说明人回来了；一直连着只是走开的照旧要自己点。
- 分享卡（`src/view/share-card.ts`，仓库根 `docs/social.md` 1.1）：整局结束页、单机实盘结算、好友房实盘结算（到账的人）右上角一个"分享"图标，用 kit 的分享卡画 1080×1350 的战绩图。
  结算页一出来就 `prepareResult` 先画好（kit 的 `prepareShare`），按钮的点击里同步调 `share()`、前面不许 await：iOS 只许在点击的那一下里调系统分享。
  卡上只有公开的：胜负或这一场的筹码、打了几副、我的头游和炸弹次数、我的称号（模板拼的话）；图标是 `favicon.svg`。链接是游戏地址（`location.origin + location.pathname`，好友房带 `?room=`），kit 按它在卡的右下角画二维码。冒烟的控件名 `share`，`gameover` 一段点一次、把预览卡存成 `16b-share-card.png`。
- 结束颁奖（`src/variants/guandan/net/awards.ts`，设计 `docs/design.md` 4.1）：好友房一场打完评本场 MVP、最惨的人、炸弹王（2–3 个），数据是房间攒的 `NetState.log`（公开的名次、炸弹，随视图下发、`rotate.ts` 转座位），
  页面 `NetSession.matchLog` 取、`TableScene.roomAwards` 评、`addAwards` 画，分享卡经 `shareCardOf` 的 `awards` 写进去。只用公开信息、话从模板拼；改评法同步改 design.md 4.1 和 `tests/awards.test.ts`。
- 好友动态的名场面（`src/view/feed.ts`、`public/moments.json`，设计 `docs/design.md` 4.2）：一副打完 `TableScene.feedDeal` 从 `highlights.ts` 的名场面里挑和我有关的一条，经 `social.ts` 的 `postFeed`（kit 的 `postMoment`）报给平台；
  一局最多 `FEED_MAX`（2）条、同一种一次，只报娱乐、不是旁观。加编号同时加模板（只用 `{name}`、`{n}`，≤ 40 字），`tests/feed.test.ts` 核对。冒烟的假平台都回 204。
- 搭子战绩（`src/variants/guandan/net/together.ts`，设计 `docs/design.md` 4.3）：`worker/room.ts` 的 `onStep` 用 `matchEnd` 认"这一步刚打完一场"，调 kit 的 `reportMatch`（交给 waitUntil、不重试、不写状态）。
  win 的定义改了同步改 design.md 4.3 和 `tests/together.test.ts`；房间测试的假钱包（`tests/room/wallet.ts`）记下每次 `together`，`bots.spec`、`stake.spec` 核对报了几次、报了谁。
- 界面的刻度和按钮：间距、圆角、投影、按钮配色只从 `theme.ts` 取（`SPACE`、`RADIUS`、`SHADOW`、`BUTTON`），DOM 用 `THEME_CSS` 的 `--gd-` 变量和 `.gd-btn`（`tests/ui-theme.test.ts` 查 DOM 按钮）。
  画布里能点的一律用 `ui/kit.ts` 的 `Button`、`iconButton`、`segmented`（自带悬停、按下、禁用、加载中，登记进 `ui/focus.ts` 的键盘焦点；弹窗用 `modal()`，自带焦点层和 Esc）。
  点按区域至少 44 CSS 像素：`minHit()` 是按当前缩放换算的世界坐标（电脑 44、手机横屏约 82），按钮默认就扩到这么大；挨得近的用 `setHit` 收到间距，不许互相压着。
  调试桥 `hits()` 列出现在点得到的矩形，冒烟的 `checkHits` 用它查；新加能点的东西后跑一遍 `npm run shot`。画面上的人名用 `seatName`（最多 `NAME_MAX` 个字），认人用 `fullSeatName`。
- 改了画面后跑 `npm run shot`，并亲自看 `shots/` 里 1280×720、844×390、1920×1080 的截图。
- 截图里精灵随机缺一块方的（沿精灵中线整块透明，每次位置不同）：是无头 Chrome 的软件渲染（SwiftShader）下 Phaser 多纹理合批取错了纹理单元，
  不是素材或烘焙的问题（查过：画布 `toDataURL` 完整、GL 只上传一次、帧缓冲快照也缺）。`src/main.ts` 在自动化浏览器（`navigator.webdriver`）里设
  `render.maxTextures: 1` 绕开，真机照常合批。别的 Phaser 游戏碰到同样的现象，照这个改。

## 4. 常用命令（在本目录运行）

| 命令 | 用途 |
|---|---|
| `npm ci` | 安装依赖（本模块自带 lockfile） |
| `npm test` | vitest 全量 |
| `npm run typecheck` / `npm run typecheck:core` | 全量 / 只查核心与电脑 |
| `npm run sim -- --deals 5000 --mode random` | 机器人对打验收 |
| `npm run shot` / `npm run shot -- --playtest` | 无头冒烟截图 / 真实速度鼠标试玩一副 |
| `npm run shot -- --gallery --out <目录>` | 美术图集：1280 / 1920 / 手机三种尺寸 × 全部画面（主页、选难度、牌桌、结算、整局结束、分享、设置、规则、战绩、好友房）+ 竖屏，改前改后对比用（`docs/art-v3.md` 第 7 节）；加 `--audit --sizes 667x375,844x390` 逐屏量字号和点按区（写 `audit.md`，手机审计用）；浏览器任务一律 `flock -w 3600 <仓库>/.local/locks/browser.lock` 排队 |
| `node tools/mem.ts [--scales auto,1,2,3]` | 内存估算：模拟老 iPhone 横屏，列纹理/画布像素（MB）和 Chromium PSS，再模拟地址栏收放看会不会攒背景图 |
| `node tools/replay-log.ts <log.jsonl>` | 试玩日志复盘：还原每一手，看现在的电脑和提示会怎么出 |
| `node tools/golden.ts [--write \| --dump <场景> <文件>]` | 掼蛋金样（牌馆重构，`docs/doudizhu.md` 第 2 节）：重算各场景的哈希 / 有意改了掼蛋行为时重写 `tests/golden/guandan.json` / 导出一个场景的明细做 diff |
| `npm run build:cf` / `npm run deploy` | 部署产物 / 拆成独立仓库后才用；在总仓库里正式部署只经 PR 合并进 main 后由 CI 完成 |
| `npm run test:room` / `npm run room-sim` | 联机房间：workerd 里的真房间测试 / 规则层批量对打 |
| `npm run online-dev` / `npm run online-smoke` | 本地联机栈（系统分配端口，打印地址）/ 四客户端联机冒烟 |
| `npm run stake-smoke` / `node tools/stake-sim.ts` | 单机实盘冒烟（本地栈 + 假钱包）/ 实盘计分模拟 |
| `npm run match-smoke` | 快速匹配冒烟：两个浏览器排到同一桌、陌生人聊天开关、取消、一个人 15 秒转单机实盘（本地栈，约 2 分钟） |
| `npm run ai-sim -- solo\|room\|style\|time\|length` | 电脑的场地强弱、好友房实盘每档、性格风格指标、单次决策耗时、一局多长（docs/ai.md） |
| `npm run dev` / `npm run preview` | 0.0.0.0:5174 / 4174 |

## 5. 浏览器存储 key（全部 `guandan.` 前缀）

| key | 内容 |
|---|---|
| `guandan.save` | 进行中的整局：`{ v, state: GameState, difficulty, counted, dealsCounted }`；整局结束即删除 |
| `guandan.settings` | 音量、静音、背景音、动画速度、难度、地方规则、牌背、记牌器开关、互动开关（字段名仍是 `taunts`）、娱乐单机的局长 `length`（`short` / `full`）、快速匹配桌上和陌生人打字聊天 `strangerChat`（默认开） |
| `guandan.stats` | 战绩：局数、胜局、连胜、最高连胜、副数、头游次数 |
| `guandan.tutorial` | 新手引导是否看过 |
| `guandan.errors` | 最近 20 条未捕获错误（兜底面板写入） |
| `guandan.cloud` | 云存档元数据 `{ v, userId, rev: {stats?, tutorial?}, dirty: 槽[] }` |
| `guandan.room` | 最近进的好友房 `{ code, host, at, userId, match?, variant? }`（`match: true` 是快速匹配排到的桌，`variant: 'ddz'` 是斗地主房间），刷新、回来时接回去；只给 `userId` 那个账号看；离开房间、回不去的关闭、换号、退出就删 |
| `guandan.<槽>.pre-sync` | 云同步合并改了本地数据前的备份（槽 = `stats` / `tutorial`，只留最近一份） |
| `guandan.<槽>.pre-switch.<旧 userId>` | 换账号清空本地前的备份，每个旧账号一份（和 pre-sync 分开）；写时和已有的合并（只会变多），写完读回核对，没存上就不清空、暂停同步；之后再登录这个账号时并回本地、补传 |
| `guandan.boot` | iOS 防崩溃标记 `{ v, pending, low, ver }`：页面在前台时 pending=1，切后台/离开清 0；打开时还是 1 说明上次被系统杀了，low 升一档（1 = 一倍渲染，2 = 再换 Canvas 渲染）；ver 不是当前版本就整条作废（只在 iOS 上写） |
| `guandan.stake` | 单机实盘这一场：`{ v, userId, ref, tier, share, until, match: { tier, deals }, state, settle }`；只在本机、不进云同步；结回或退回后删，过了 `until` 打开标题页时删 |
| `guandan.a2hs` | 标题页"添加到主屏幕玩更大"提示点过 ✕（值 1） |
| `guandan.nick` | 单独部署时好友房里的昵称（字符串；有平台时不用，昵称以平台账号为准） |
| `guandan.chat` | 聊天的界面设置：弹幕开关、电脑版聊天框收起、记录展开（由 kit 的 table-fun 按 `storageKey: 'guandan'` 读写） |
| `guandan.hint.fun` | 首次进牌桌冒过"点头像扔道具，长按连扔"了（由 kit 的 table-fun 读写），只出一次 |
| `guandan.fun.blocked` | sessionStorage：点头像"屏蔽他"屏蔽了谁（由 kit 的 table-fun 读写，按房间码分开、记座位和名字，那个座位换了人就不算） |
| `guandan.variant` | 主页上次选的玩法：`'guandan'` / `'ddz'`（没有就是掼蛋） |
| `guandan.ddz.save` | 斗地主进行中的一局：`{ v, state: DdzState, level, counted, dealsCounted }`；规则版本不对或整局结束就删 |
| `guandan.ddz.stats` | 斗地主战绩：局数、胜局、副数、赢的副数、当地主几次、当地主赢几次、春天次数（只在本机，不进云同步） |
| `guandan.ddz.tutorial` | 斗地主单机的新手引导是否看过 `{ v, done }`（第一次进单机娱乐牌桌弹，4 步；好友房、实盘、每日、托管、带 seed 的调试开局不弹；设置里"重看引导"一并清掉；只在本机，不进云同步） |
| `guandan.ddz.stake` | 斗地主单机实盘这一场：`{ v, userId, ref, tier, share, until, state, settle }`；只在本机、不进云同步；结回或退回后删 |
| `guandan.<槽>.pre-switch.<userId>.restored` | 上面的备份并回本地、传上去之后改名到这里（安全副本），以后不再并——"当前连胜"会归零，反复并会被旧值抬回去 |

新增 key 必须带前缀、只在 `src/view/store.ts` 里读写（kit 的 table-fun 按 `storageKey: 'guandan'` 自己读写的三个除外），并补进这张表。

## 6. 待办（不阻塞）

- 1280×720 下，手牌列数在"每列最多 4 张"和"5 张"之间切换时（`table/hand.ts` 的 `MIN_SPACING_SHORT`），布局会跳一下。
- 标题字体的缺字测试（`tests/view.test.ts`）按行用正则扫字符串，标题文字跨行写会漏检。
- 多尺寸适配（手机竖横屏、平板、电脑共 27 个尺寸逐屏量溢出、点按区、重叠、字号）里掼蛋、斗地主共有的三处，要动共用部件，没在斗地主的 PR 里改：
  - 顶栏图标（左上"大厅"、右上规则 / 声音 / 返回）在手机横屏（568–932 宽）的点按区伸出屏幕上沿，露在屏内的不到 44 CSS 像素；主页和牌桌都有。
  - `ui/kit.ts` 的 `segmented`（主页"掼蛋 / 斗地主"、选难度）点按区按世界坐标 44 高，手机横屏只有约 27–36 CSS 像素。
  - kit 的 table-fun：竖屏手机时互动热区（`.atf-hot`）左边伸出屏幕几像素；竖屏平板（1024×1366）上聊天框的短语按钮 32–36 高。改在 kit。
- 斗地主新手档电脑变弱后（`NOVICE_BLUNDER`，docs/stake.md 10.2），娱乐单机"新手"难度对小白的胜率（仓库 `docs/balance.md`：≥ 60%）还没单独量。
