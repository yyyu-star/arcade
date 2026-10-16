# 《掼蛋》模块约定

> 总仓库规范见仓库根的 `AGENTS.md`，其中第 1、2 节的硬约束优先于本文件。本文件只写掼蛋特有的约定。2026-10-13 建立。

## 1. 目录

```
src/core/   规则核心（纯函数、确定性）：cards 牌与牌序、patterns 牌型/比大小/枚举、game 状态机与玩家视角、options 规则开关、rng
src/ai/     电脑对手：plan 理牌、bot 决策、persona 强弱五档和性格/状态/局面、venue 场地 → 电脑、random 随机机器人（模拟基准）
src/net/    联机（房间和页面共用，纯函数）：rules 把规则核心接成 arcade-kit 的 RoomGame、rotate 视角旋转（我总在下）、version 页面版本与房间、实盘路径、
            stake 好友房实盘的桌（开房选项、带入、每个座位的账、结回）
src/stake/  实盘的规则（纯函数，和 core 同样的约束）：档位、每副的分、封顶、结回额、钱包 ref / op 的拼法、单机一场和好友房每个座位的账（docs/stake.md 第 1 节）；
            titles 称号（只用公开信息，和 public/titles.json 对齐）、stats 结回时带给平台的战绩小结（平台 0.10.0）
src/view/   画面层（Phaser 4）：scenes 场景、table 牌桌部件（taunt 嘲讽面板和点头像菜单）、ui 组件与弹窗、art 程序生成 SVG、audio 合成音效、store 存储、
            recap 每副复盘、suggest 公开事件后的嘲讽建议、attention 轮到我时的振动和标题闪烁、lobby 回大厅
src/debug/  URL 参数、调试跳转（jump）、window.__game 调试桥
worker/     线上 Worker：main.ts 部署入口（默认导出 + Durable Object 类 Room）、index.ts 请求处理、gate.ts 登录闸门和房间路由、room.ts 联机房间、
            stake.ts 单机实盘的带入 / 结回 / 放弃（转给平台钱包 WALLET）
public/     favicon、cover.png（平台封面）、titles.json（称号表，平台按 id 显示）、_headers
tests/      vitest；architecture.test.ts 检查 core/ai 的纯度；tests/room/ 是在 workerd 里跑真房间的测试（`npm run test:room`，单独的配置）
tools/      sim.ts 机器人对打；probe.ts 跟牌积极度；replay-log.ts 试玩日志复盘；shot.ts 无头冒烟与截图；mem.ts 内存估算；build-cf.ts 部署构建；
            art-preview.ts / cover.ts 美术预览与封面；baseline-ai-<版本>/ 上一版电脑的副本（sim 的 prev 基准，不进产品包）；
            online-dev.ts 本地联机栈（wrangler dev + fake-platform/ 假平台，含假钱包 RPC）；online-smoke.ts 四客户端联机冒烟；room-sim.ts 房间规则层批量对打；
            quota-smoke.ts 额度提示冒烟；stake-sim.ts 实盘计分模拟（docs/stake.md 的数字）；ai-sim.ts 场地、性格、耗时模拟（docs/ai.md 的数字）；stake-smoke.ts 单机和好友房实盘冒烟
docs/       design.md 设计、rules.md 规则核实、core-api.md 接口、stake.md 实盘设计（0.4.0 单机、0.5.0 好友房）
```

## 2. 规则核心的约束

- `src/core`、`src/ai` 不依赖 DOM、Phaser、网络；禁止 `Math.random`、`Date`、`Math.exp/log/pow/sin` 等；随机一律 `rngFor(seed, 用途, …)`。
  `tsconfig.core.json` 只给 ES 库，误用浏览器全局会编译失败。
- 状态是纯 JSON（牌是 0..107 的整数），`dispatch` 不修改传入的状态。同一种子 + 同一串动作必须逐位相同（`tests/game.test.ts` 回放测试）。
- 电脑只能读 `viewFor(state, seat)`，不能碰 `GameState`；`viewFor` 不得包含别人的手牌（防泄漏测试）。联机时下发的也是它。
- 联机用的核心接口（`timeoutAction`、`previewNext`、规则版本、`SeatAction`/`TableAction`）见 `docs/core-api.md` 5.1，测试在 `tests/online.test.ts`。
  改了会影响牌局结果的规则要加 `RULES_VERSION`，并让旧版本的牌局能按旧规则打完。
- 规则有出入的点先查 `docs/rules.md`；改规则要同步改该文档、`docs/core-api.md` 和测试，地方差异做成 `options.ts` 开关。
- 改电脑策略后跑 `npm run sim`（`--mode random|greedy|ai|easy-vs-hard|normal-vs-prev`），确认无非法动作、无死锁、难度梯度还在。
  改强弱、性格、场地表后跑 `npm run ai-sim -- solo|room|style`，把新数字写进 `docs/ai.md` 和 `docs/stake.md` 1.3、3.1（好友房实盘每档要"两个普通真人搭档期望加两倍标准误 ≤ 0"）。
  没给性格时 `decide` 就是难度预设本身（聪明提示、代打、`sim` 都靠这个），新加的打法参数默认 0、不改原来的行为。
  发版时把这一版的 `src/ai` 复制成 `tools/baseline-ai-<版本>/`（改 import 路径），下一版用 `normal-vs-prev` 对比。

## 3. 画面层约定

- 推进状态只有一条路：`Session.apply(action)` → 核心 `dispatch` → 拿事件按顺序 `await` 播放 → `sync()` 按 `viewFor` 刷新 → `pump()` 决定下一步
  （电脑"想一会儿"再出、等玩家、弹结算）。画面不自己判断牌型和大小：能否出牌用 `interpret` + `beats`，提示用 `hintList`（首条 null = 建议不要），
  一副结束时的"下副谁进贡"用 `dispatch(state, nextDeal)` 推演（纯函数，不改当前状态）。
- 世界坐标高 720，宽 1280..1720 随窗口宽高比变（`worldWidthFor`）；画布按 `RENDER_SCALE`（1..3）倍像素绘制，相机同倍 zoom，
  Text 的 resolution 同倍，SVG 按目标像素栅格化（`textures.ts`）。新加文字一律走 `ui/kit.ts` 的 `text()`，最小字号 18（手机上约 10 CSS 像素）。
- 尺寸一律按实际可见区域（`device.ts` 的 `appBox`：visualViewport 量出的区域扣掉安全区），不用 `screen` 和 `100vh`——iOS Safari 的这两个是
  工具栏收起时的最大值，按它排顶栏会被地址栏盖住。`#app` 由 JS 钉成像素大小，CSS 里的 100vh/100dvh 只是 JS 跑之前的兜底（0.1.10）。
  尺寸没变不写、双指放大中不跟（`fitAppToViewport` 返回是否改了，改了才 `scale.refresh()`）。重建画面（换世界宽度 + `scene.restart`）会丢选牌、
  动画、弹层：触屏设备只在转屏时重建，电脑上宽度差 40 以上才重建；场景的 `canRebuild()` 为假（牌桌忙、有弹层、选着牌）时推迟到空闲。
- 内存（0.1.10，老 iPhone 2GB 内存超了 WebKit 直接杀页面）：iOS 上 `RENDER_SCALE` 封顶 2，2 倍时关 WebGL 多重采样；背景大图按世界宽度烘焙，
  换宽度后 `dropBackdrops` 删旧的；`guandan.boot` 记"前台开着"，被杀后下次自动降档（1 倍 → Canvas 渲染），换版本重置。
  量内存用 `node tools/mem.ts`（模拟 iPhone 8 / 8 Plus 横屏，按倍数列纹理、文字画布、主画布像素和 Chromium 进程 PSS）。
  新加大纹理先跑一遍它；冒烟 `viewport` 一段覆盖可见区、工具栏遮挡、降档和 Canvas 渲染。
- 动画时长一律经 `anim.ts` 的 `dur()`（设置里的速度、URL `anim=0` 瞬间完成）；冒烟靠 `anim=0` 和 `autoplay=1` 快速推进。
- 手牌分列是纯函数 `table/columns.ts`（有单测）；一列最多 5 张，保证手机横屏每张牌露出的部分都点得中（冒烟里逐张点验证）。
- 座位：0 我（下）、1 老张（右，下家）、2 小美（上，对家）、3 阿强（左，上家）。性格只影响台词/表情（`personas.ts`）。
- 存储只在 `store.ts` 里读写（测试检查）；调试桥 `window.__game` 只在开发模式或 `?debug=1` 时挂。
- 标题字体是内嵌的宋体子集（`fonts.ts`，README 素材一节）：新加的大字、横幅、弹窗标题如果用了字表里没有的字，`tests/view.test.ts` 会报缺字。
- 登录闸门（`worker/gate.ts`，0.1.4 起；0.6.5 起用 arcade-kit 的 `loginGate`）：线上只有三个首页路径（`wrangler.jsonc` 的 `assets.run_worker_first`）先进 Worker，js、图片照旧直接走静态资源。
  变量 `GATE`：`"off"` 原样放行；其他值（包括没配）都要登录：没带平台会话 cookie 的直接 302，带了的经服务绑定 `ARCADE` 问平台 `/api/me`（地址按请求的 origin 拼）。
  已登录放行、未登录 302 到 `/login?next=<请求的路径 + 查询>`（登录完回到原链接，房间链接直接进房），这两种都把平台下发的 Set-Cookie 原样带回浏览器（会话续期、清失效 cookie）；
  其他一切情况回掼蛋自己的 503 页（`DOWN_PAGE`）——fail-closed，宁可谁都进不去也不放行。kit 里的细节（转发哪些头、3 秒超时）以 kit 为准，测试在 kit 的 `auth.test.ts`。
  本地 `npm run dev` / 冒烟走 vite，不经过 Worker。要看运行时行为用 `npx wrangler dev --var GATE:login`（先 `npm run build:cf`）。
- 站点地址不进仓库（开源整改，0.6.5）：`wrangler.jsonc` 不写路由，部署时由 `.github/workflows/game-guandan.yml` 用部署环境的 secret `SITE_HOST`
  注入 `--route "$SITE_HOST/games/guandan"`、`--route "$SITE_HOST/games/guandan/*"` 和 `--var SITE_ORIGIN:https://$SITE_HOST`（没设就失败，不带着空路由部署）。
  代码里的同站校验用 `SITE_ORIGIN`，没设就按请求自己的 origin；给玩家看的话不写域名；测试夹具用 `game.example.com`。
- 云存档（`src/view/cloud.ts`，0.1.7 起；规格见仓库 `docs/platform-backend.md` 5.5、15.1–15.3）：只同步 `stats` 和 `tutorial` 两个槽，牌局和设置不同步。
  store 里改这两个槽的函数会发 `onSyncedChange`，`main.ts` 接到 `CloudSync.markDirty`；云同步写回本地走 `rawStore`，不再触发通知。
  合并：数字取大、布尔取或、数组并集。上传 10 秒防抖 + 同槽至少隔 5 分钟（每人每天 100 次 PUT）；切后台 / pagehide 用 keepalive 补传一个槽，
  但离上次上传不到 3 分钟不补；429 之后的改动也不早于 retryAfter。
  换账号（`/api/me` 的 user.id ≠ `guandan.cloud` 的 userId）不合并、不上传：识别到的当下就备份、清空本地、存盘，再去拉取新账号的数据
  （拉取失败或页面被关也不会留下"旧数据 + 新账号"）。没有提示 cookie `__Host-arcade_li` 时一个请求都不发。
  连不上、停服时登录状态不明：图标不显示"未登录"、点了只给说明，不引人去登录（15.1、5.7）。
  平台按 cookie 记账，页面开着时别的标签页可能换了账号：每个 PUT 都带 `/api/me` 给的 `userId`（平台 0.7.1 起），不是当前会话的账号时平台回
  409 `wrong_user`、一行不写——不合并、不重试，按换账号处理（备份到 pre-switch、清本地、元数据不记账号，再问 `/api/me`）。409 要按 `error` 区分 `conflict` 和 `wrong_user`。
  回到前台 / 拿到焦点（`resume`）也问一次 `/api/me`，按上次"尝试"的时间限 1 分钟一次（连不上时不会每次切回来都问）。
  换号前先看存盘的元数据：别的标签页已经换过号，就只跟上内存、不再备份清空。换号时清掉跟着旧账号的 413 封槽、429 等待、上传间隔。
  400 表示请求本身不合格：这个槽本次打开不再传，不算"连不上"。
  拉取也带预期账号：`GET /api/saves/guandan?userId=<user.id>`（平台 0.7.3），回 409 `wrong_user` 时走换号流程；GET 回来时本页账号已经变了就丢掉结果。
  多个标签页靠 `storage` 事件同步元数据：rev 取大；别的页传完、本页又没改过的槽，本页的待上传跟着清掉。
  本地联调：`npm run dev` 把 `/api` 代理到平台的 `npm run dev:api`（5181），浏览器先在 5181 登录。冒烟里 `/api` 由 `tools/shot.ts` 的假平台回答。
- 回大厅（`src/view/lobby.ts`，0.1.9 起，所有游戏统一）：左上角"大厅"（小房子）指向平台首页 `/`。标题页直接走；牌桌上打到一半先弹确认（这局会存着 / 调试开局不保存 / 好友房：头 60 秒轮到你时等 30 秒按"能不出就不出"代出，之后电脑替你打，回来接着打——回大厅不调 `leave()`，座位和 `guandan.room` 都留着）；
  手机竖屏时牌桌被"请横过来"盖住，提示层左上角也有一个（打到一半用浏览器自带的确认框）。离开前调一次 `cloud.flushOnHide()`（pagehide 时也会触发，同槽在途不重发）。
  小房子图标只用来表示"回大厅"；回掼蛋自己的首页用箭头。冒烟只断言跳到 `/`，不加载平台页面。
- 联机好友房（0.2.0-beta 起，0.3.0 正式放开；底座是 `packages/arcade-kit`，房间规范见仓库 `docs/platform-backend.md` 第 4 节）：
  - 每天的额度（0.3.0，kit 0.2.0 的计量）：`wrangler.jsonc` 绑 `METER`（`RoomMeter`，入口 `worker/main.ts` 导出），门槛在 `vars.KIT_QUOTA`（掼蛋 5 万停开新房、6 万收场；
    10 万行全账户共用，各游戏怎么分见仓库 `docs/platform-backend.md` 4.7）；每人同时 5 个房间、每天 100 个（0.6.0）。没绑 `METER` 时 kit 不限额，`tests/config.test.ts` 守着绑定和门槛。
    收场点 `breakPoint` 是结算页（一副打完）。页面上的几句话在 `src/view/quota-text.ts`，`npm run quota-smoke` 逐条核对。
  - 发牌（0.3.0，安全）：联机开局走 kit 的 `begin`（256 位熵），核心 `createKeyedGame` 把它存成 `GameState.key`，每一副从 `stream(key, 'deal', 第几副)` 发，`seed` 是空串；
    `key` 只在服务端，`viewFor` 不带。规则版本 2 = 按密钥发牌，1 = 按种子（单机，和 0.2.x 开的旧联机局）。不要再让联机牌局用种子发牌，也不要给 `rngFor` 喂密钥（它会压成 32 位）。
  - 服务端说了算：房间（`worker/room.ts`）只继承 arcade-kit 的 `GameRoom`，规则从 `src/net/rules.ts` 来；入座、轮流、30 秒超时代出、掉线 60 秒电脑托管、
    每步最多写 2 行都由底座管，这里不另写一套。下发的只有 `viewFor(state, 座位)`（没入座 = -1，空手牌）和这一步的事件，`tests/net.test.ts` 查泄漏。
  - 一副结束（docs 9.1、`docs/core-api.md` 的 nextDeal）：每个真人在结算页点"继续"（`ready`），电脑和托管座位由房间立刻代点，没点的真人 20 秒（`READY_MS`）到点由房间代点；
    最后一个人准备好的那一步里开下一副。玩家发不了开下一副的操作（`next` 解析不认）。这一刻谁能出手用 `actors()`、时限用 `turnMs()`（arcade-kit 0.1.1），
    双下的进贡、还贡也靠 `actors()` 两个人同时等。结算页开着时，别人点"继续"的帧（step 不变）要当场收下刷新，不然会堵住开下一副的那一帧。
  - 路由：`POST /games/guandan/room/rooms` 开房（`acceptCreate`），`GET /games/guandan/room/rooms/<6 位码>/ws` 进房（`acceptJoin`），都要登录（问平台 `/api/me`）、同源。
    变量 `ONLINE`：`"on"` 开放；`"off"`（以及配错的值）开房回 404（页面说"好友房暂时关了"），进房接上就以 4004 关掉（和"没有这个房间"一样，客户端不再重连）。
    标题页一直有"好友房"，本机记着这个账号的房间时旁边还有"回到房间"（0.3.0）；`?online=1` 是"打开就弹出好友房面板"（平台大厅的入口），邀请链接 `room=` 不带它也能进。
    房间路由不经过 `GATE`：认人由 arcade-kit 问平台，认不出就 4401。
  - 记着的房间分账号（`guandan.room` 带 `userId`）：进房后问一次 `/api/me` 记下是谁的；标题页"回到房间"、大厅"回到刚才的房间"、邀请链接带房主标记之前都现问 `/api/me` 核对，
    不是这个账号的（或旧记录没记账号）就不给并清掉（`myRoom`/`roomOwnerCheck`）；云同步发现换号、退出时也清（`CloudDeps.forgetRoom`）。回不去的关闭码（`isFinalForRoom`）都清。
  - 页面：`src/view/net.ts` 的 `NetSession` 和单机的 `Session` 实现同一个 `TableSession` 接口，牌桌场景不分单机联机；收到的帧排队，一帧帧播，
    出手发出去后锁住，等 ack 或报错再解锁。视角旋转在 `src/net/rotate.ts`：真实座位 s 显示在 (s − 我 + 4) % 4，按队记的值在我坐奇数位时对调。
    大厅是 DOM（`src/view/online.ts`）：开房、输码、选座、房主开局；刷新、切后台回来、掉线都自动接回原座位（进房后地址栏带 `room=<码>`，离开房间时去掉）；关闭码一律换成大白话（`closeText`），
    重连中、连不上时的话走 `NetSession.linkText`：上次断开是 1013 就说"平台有点忙"，不让玩家去查网络（关闭码由 kit 0.1.1 的 `onStatus` 带来，1006 是断网）；4030 是这个人的消息额度用完，不再重连。
  - 开打后座位绑人（arcade-kit 0.1.1）：坐过的人只能回自己的座位（别的回 `not_your_seat`），没坐过的人只能接管没绑人的电脑座位（`SeatInfo.reserved` 为 false），
    绑了别人的座位接管不了（`seat_reserved`），电脑一直替主人打、显示"电脑代 某某 打"。大厅按 `you.bound` 给离座的人"回到我的座位"，`reserved` 的电脑座位不挂"接管"。
    回归测试在 `tests/room/seats.spec.ts`（旧仓库 PR 50 的审阅：离座后接管对手的电脑座位能看到对手手牌）。
  - 改了房间和页面之间的约定（动作、视图形状）就加 `src/net/version.ts` 的 `CLIENT_VERSION`：旧页面进房会被 4005 请去刷新。改规则加 `RULES_VERSION`，打到一半的房间按旧规则打完。
  - 验收：`npm run test:room`（真房间机器人对打、写入行数、断线、让位、座位绑人、结算等人）、`npm run room-sim`（规则层大批量）、`npm run online-smoke`（四个浏览器端到端，约 5 分钟，`--quick` 跳过 70 秒托管那项）。
- 实盘（0.4.0 起单机；设计和数字在 `docs/stake.md`，钱包接口是仓库 `docs/platform-backend.md` 5.9）：
  - 规则都在 `src/stake/`（纯函数）：档位、每分 = 一份的 1/20、封顶 ±20 分、单机 8 副 / 好友房 5 副、单机每档的电脑、结回额、ref 和 op 的拼法。
    Worker、页面、以后的房间都从这里取，不各算一份。钱包的 ref、op 只能是 8–64 位的 `[A-Za-z0-9_-]`（不能带冒号），测试锁着。
  - 单机：`worker/stake.ts` 的 `POST /games/guandan/api/stake/{buyin,settle,refund}` 认人（kit 的 `whoIs`）、只认本站 Origin、查数在规则范围里，
    转给服务绑定 `WALLET`（`entrypoint: WalletService`、`props.game: guandan`，`tests/config.test.ts` 守着），`mode: client`。钱包的回话原样带回；
    业务上的拒绝走返回值（200 + `{ ok: false, error }`），HTTP 状态码只说"没到钱包"（400 / 401 / 403 / 503）。
  - 页面：`src/view/stake.ts`（存档 `guandan.stake`、`StakeSession`、结回和放弃）、`src/view/ui/stake.ts`（选模式、选档位）、`src/view/stake-text.ts`（说的话）。
    一场结束先把要结的数记进存档，再去结回；结回、放弃遇到 `busy` / `internal` / 连不上按同一个 op 重试，还不行留着存档下次再结；`no_stake`（结过）、`expired`（过期退回过）都算办完。
    实盘不计战绩、不写 `guandan.save`、规则用默认；标题页"开始"先选娱乐 / 实盘。冒烟 `npm run stake-smoke`（本地栈的假平台带一个内存里的假钱包 RPC）。
  - 好友房（0.5.0）：开房请求体 `{ stake: 档位 }` → kit 0.4.0 的开房选项（`RoomOpts`，规则的 `options` 校验）。桌在 `src/net/stake.ts`，状态里是 `NetState.stake`（娱乐房间没有这个字段，
    所有实盘的钩子对它原样返回）：`begin` 给每个真人记带入（真人不到 2 个整场不计输赢）、`seated` 管换人——
    接管开局时就是电脑的座位记一笔带入，点"离开"的人按当时的分马上结回（0.6.0），走了又回来用新的 ref `<ref>s<座位>n<第几份>` 再带入一份，
    带入被拒的人有"重新带入"（不轮流的 `buyin`）；每副 `stakeDeal` 记账，一场结束（5 副 / 过 A / 到账的都封顶）`over` 为真、记结回，`closing` 就地结束。
    结回带战绩小结 `stats`（`src/stake/stats.ts`）。房间的 `perform`（`worker/room.ts`）去钱包办：带入前先 `view`（钱包只记最近 32 个 op），
    `busy` / `internal` / 异常抛出去让 kit 退避重试，业务拒绝回 `{ ok: false, error }` 交给 `settled`。视图 `NetView.stake` 公开每个座位的分和到账，被拒原因只给自己。
    房间测试 `tests/room/stake.spec.ts` 用 `tests/room/wallet.ts` 的假钱包（测试入口 `tests/room/main.ts` 多导出 `FakeWallet` / `WalletBank`，WALLET 绑到自己）。
- 好友房的乐子（0.6.0 起，底座是 kit 的 `emote` 和 `arcade-kit/fun`；公平底线：人人一样、免费、不挂筹码，不停计时、不挡牌和按钮）：
  - 嘲讽、表情包、扔道具都是 kit 转发的编号（文字在 `src/net/emotes.ts`），面板和点头像菜单在 `src/view/table/taunt.ts`；设置里能整个关掉，点头像"屏蔽他"只管这个房间（sessionStorage `guandan.blocked`）。
  - 轮到我：提示音、振动、后台标题闪（振动和标题闪在 `attention.ts`），最后 5 秒嘀嗒；轮到的人想了 8 秒以上别人能扔"催促炸弹"，纯画面。
  - 称号和每副复盘只用公开信息（出牌记录、名次），电脑决策不读表情。
  - 再来一场（0.6.2）：娱乐房间打到 gameOver 先不 `over`，用 kit 的 `pause`/`resume` 停 `AGAIN_MS`（3 分钟）；有人发不轮流的 `again { code }`（他先开好新房间），
    大家跟过去按和他的相对位置自动坐（kit 让开房的人坐 0 号）。没人点就结束、还名额。实盘房间不等。
  - 走开了（0.6.3）：`timeout()` 给的操作带 `idle: true`（`parse` 会去掉，浏览器伪造不了），`NetState.idle` 数每个座位连着几手被代出，
    到 `IDLE_AFTER`（2）后这一手只等 `IDLE_MS`（3 秒）；自己出一手或发 `back`（"我回来了"）清零。代出什么不变，规则核心看不到这个记号。
    浏览器每次连上（welcome：打开页面、断线重连）看到自己还 afk 就自动发一次 `back`（0.6.4）：连得上说明人回来了；一直连着只是走开的照旧要自己点。
- 改了画面后跑 `npm run shot`，并亲自看 `shots/` 里 1280×720、844×390、1920×1080 的截图。

## 4. 常用命令（在本目录运行）

| 命令 | 用途 |
|---|---|
| `npm ci` | 安装依赖（本模块自带 lockfile） |
| `npm test` | vitest 全量 |
| `npm run typecheck` / `npm run typecheck:core` | 全量 / 只查核心与电脑 |
| `npm run sim -- --deals 5000 --mode random` | 机器人对打验收 |
| `npm run shot` / `npm run shot -- --playtest` | 无头冒烟截图 / 真实速度鼠标试玩一副 |
| `node tools/mem.ts [--scales auto,1,2,3]` | 内存估算：模拟老 iPhone 横屏，列纹理/画布像素（MB）和 Chromium PSS，再模拟地址栏收放看会不会攒背景图 |
| `node tools/replay-log.ts <log.jsonl>` | 试玩日志复盘：还原每一手，看现在的电脑和提示会怎么出 |
| `npm run build:cf` / `npm run deploy` | 部署产物 / 拆成独立仓库后才用；在总仓库里正式部署只经 PR 合并进 main 后由 CI 完成 |
| `npm run test:room` / `npm run room-sim` | 联机房间：workerd 里的真房间测试 / 规则层批量对打 |
| `npm run online-dev` / `npm run online-smoke` | 本地联机栈（系统分配端口，打印地址）/ 四客户端联机冒烟 |
| `npm run stake-smoke` / `node tools/stake-sim.ts` | 单机实盘冒烟（本地栈 + 假钱包）/ 实盘计分模拟 |
| `npm run ai-sim -- solo\|room\|style\|time` | 电脑的场地强弱、好友房实盘每档、性格风格指标、单次决策耗时（docs/ai.md） |
| `npm run dev` / `npm run preview` | 0.0.0.0:5174 / 4174 |

## 5. 浏览器存储 key（全部 `guandan.` 前缀）

| key | 内容 |
|---|---|
| `guandan.save` | 进行中的整局：`{ v, state: GameState, difficulty, counted, dealsCounted }`；整局结束即删除 |
| `guandan.settings` | 音量、背景音、动画速度、难度、地方规则、牌背 |
| `guandan.stats` | 战绩：局数、胜局、连胜、最高连胜、副数、头游次数 |
| `guandan.tutorial` | 新手引导是否看过 |
| `guandan.errors` | 最近 20 条未捕获错误（兜底面板写入） |
| `guandan.cloud` | 云存档元数据 `{ v, userId, rev: {stats?, tutorial?}, dirty: 槽[] }`（0.1.7 起） |
| `guandan.room` | 最近进的好友房 `{ code, host, at, userId }`，刷新、回来时接回去；只给 `userId` 那个账号看（0.2.1 起）；离开房间、回不去的关闭、换号、退出就删（0.2.0-beta 起） |
| `guandan.<槽>.pre-sync` | 云同步合并改了本地数据前的备份（槽 = `stats` / `tutorial`，只留最近一份） |
| `guandan.<槽>.pre-switch.<旧 userId>` | 换账号清空本地前的备份，每个旧账号一份（和 pre-sync 分开）；写时和已有的合并（只会变多），写完读回核对，没存上就不清空、暂停同步；之后再登录这个账号时并回本地、补传 |
| `guandan.boot` | iOS 防崩溃标记 `{ v, pending, low, ver }`：页面在前台时 pending=1，切后台/离开清 0；打开时还是 1 说明上次被系统杀了，low 升一档（1 = 一倍渲染，2 = 再换 Canvas 渲染）；ver 不是当前版本就整条作废（0.1.10 起，只在 iOS 上写） |
| `guandan.stake` | 单机实盘这一场（0.4.0 起）：`{ v, userId, ref, tier, share, until, match: { tier, deals }, state, settle }`；只在本机、不进云同步；结回或退回后删，过了 `until` 打开标题页时删 |
| `guandan.a2hs` | 标题页"添加到主屏幕玩更大"提示点过 ✕（值 1，0.1.10 起） |
| `guandan.blocked` | sessionStorage：点头像"屏蔽他"屏蔽了谁 `{ code, seats: [{ seat, name }] }`，只对这个房间、这个标签页，那个座位换了人就不算（0.6.0 起，0.6.4 加名字） |
| `guandan.<槽>.pre-switch.<userId>.restored` | 上面的备份并回本地、传上去之后改名到这里（安全副本），以后不再并——"当前连胜"会归零，反复并会被旧值抬回去 |

新增 key 必须带前缀、只在 `src/view/store.ts` 里读写，并补进这张表。

## 6. 待办（不阻塞）

- 简单难度对普通约 2 成：看试玩反馈再定。要调的话优先降记牌和配合，不再加失误率（失误多了看起来是"蠢"，不是"弱"）。
- 1280×720 下，手牌列数在"每列最多 4 张"和"5 张"之间切换时（`table/hand.ts` 的 `MIN_SPACING_SHORT`），布局会跳一下。
- 标题字体的缺字测试（`tests/view.test.ts`）按行用正则扫字符串，标题文字跨行写会漏检。
