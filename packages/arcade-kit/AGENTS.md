# arcade-kit 模块约定

> 总规范见仓库根的 `AGENTS.md`（拆成独立仓库后，以本文件和随附的 docs 为准）。房间规范是 `docs/platform-backend.md` 第 4 节。每个版本改了什么看 `CHANGELOG.md`，本文只写现状和改代码时要守的规矩。

- 内容：联机底座，给各游戏的 Worker 和页面用。服务端：`src/room.ts`（Durable Object 房间基类）、`src/worker.ts`（开房、进房、匹配、登录闸门入口）、`src/meter.ts`（每天的额度计量）、
  `src/match.ts`（快速匹配的排队 DO，设计 `docs/match.md`）、`src/store.ts`（可插拔存储）、`src/together.ts`（搭子战绩）、`src/auth.ts`（经平台 `/api/me` 认人；`identify` 按部署方式认人）、
  `src/guest.ts`（独立模式的游客身份）、`src/internal.ts`（内部地址、身份头）；两边共用：`src/game.ts`（规则接口、快照体积）、`src/protocol.ts`（消息和关闭码）、`src/rng.ts`（ChaCha20 随机数，纯函数）、`src/chat.ts`；
  浏览器：`src/client.ts`（连接器）、`fun*.ts`、`table-fun.ts`、`table-chat.ts`、`share.ts`、`qr.ts`、`social.ts`、`theme.ts`、`report.ts`。`src/testing.ts` 是假平台钱包，只给测试和本地开发。文件和入口的完整清单看 README 的"功能"和"目录结构"。
  不部署，没有自己的 Worker。
- 两种形态：npm 上发 `dist/`（JS + `.d.ts`，`npm run build`）；仓库里 `package.json` 的 `exports` 一律写 `"./x": "./src/x.ts"`，
  仓库内游戏的 `file:` 引用直接用源码。`prepack` / `postpack`（`scripts/manifest.mjs`）在打包时换成 dist 版再换回来，不要手改 exports 指 dist，也不提交 `dist/`。
  `src/` 里相互引用写 `.js` 扩展名（`./auth.js`），游戏的 tsconfig 不用特别配置。发布（`npm publish`）由维护者做。
- 两种部署方式（`src/guest.ts`）：有 `ARCADE` 绑定是平台模式，游客 cookie 一律不认；没有 `ARCADE`、`GATE` 也不是 `"login"` 是独立模式（游客）。
  `GATE: "login"` 没绑 `ARCADE` 必须 fail-closed。改认人的代码时 `test/guest.test.ts` 的"平台模式不认游客"几条必须守住。
- 会进浏览器包或普通 Node 测试的文件（`client.ts`、`protocol.ts`、`chat.ts`、`chat-words.ts`、`game.ts`、`rng.ts`、`guest.ts`、`fun.ts`、`fun-art.ts`、`fun-logic.ts`、`table-fun.ts`、`table-chat.ts`、`share.ts`、`qr.ts`、`social.ts`、`theme.ts`、`report.ts`）
  不能引用 `room.ts`、`match.ts`、`meter.ts`（依赖 `cloudflare:workers`）。`worker.ts`、`auth.ts` 同样要能在普通 Node 里加载（只引类型），`internal.ts` 不依赖运行时以外的东西。
- 画面层的规矩（`fun.ts`、`table-fun.ts`、`share.ts`、`social.ts`）：import 时不碰 DOM，只在调用时碰；动画只动 `transform`、`opacity`，不读布局（量位置只在开菜单和 `controls()` 时）；
  素材只用 `fun-art.ts` 里手写的 SVG，不用 emoji 字体、不引外部资源，新素材也照这个来。
- 牌桌互动（规范是仓库根 `docs/table-fun.md`）：`fun-logic.ts` 是纯函数（不碰 DOM，时间和随机数由调用方给，房间也 import），数字的默认值就是规范，改了同步改测试和 README。
  kit 里不出现任何游戏的名字、短语和人物，这些都由游戏传进来。
- DOM 组件的主题（`src/theme.ts`）：颜色、圆角、字体走 `--ak-*` 变量，写成 `var(--ak-xxx, <默认值>)`，默认值就是原来的值（不传主题的游戏外观不变，`test/theme.test.ts` 扫源码守住）；
  新加的 DOM 样式照这个写，新变量同步加进 `theme.ts` 的表、README 的变量表和测试。`themeVars` 只放行安全的值（挡 `;` `{` `}` `<` `url(` `expression` 等），不要绕过它直接拼 CSS。
- 可插拔存储（`src/store.ts`，自托管 PG 模式）：有 `KIT_STORE` 绑定才走 `MirrorStore`，没有时房间、计量、排队原来直接用 `ctx.storage` 的代码一行不动（零退化靠"根本没换"）。
  改存储相关代码时两条路都要改、`npm test` 的两遍（默认、`vitest.pg.config.ts`）都要过；PG 路径里一步之内不 await、send/close 排队到 flush 之后、提交失败作废缓存不广播、`kitWake` 幂等，这几条 `test/store.test.ts` 守着。
  直接读写存储的测试一律用 `test/helpers.ts` 里两种存储都能用的帮手，不要再在测试里写 `state.storage.sql`。
- 游戏只经 `acceptCreate` / `acceptJoin` / `acceptMatch` 开房进房排队，不自己把浏览器的请求转给房间；房间的 `fetch` 只认 `KIT_HOST` 内部地址，开房走 RPC。
  `internal.ts` 不进 `package.json` 的 `exports`，游戏引用不到；新加的内部工具也放 `internal.ts`。`auth.ts` 只认人，不碰内部地址和身份头。
- 能被别人挤占的额度不能挂在房间上：按座位（人）分开算，没入座的连接单独封顶，入座的人回来永远进得了；一个人也不能用光整个房间的额度（`maxInboundShare`）。
- 开打后座位绑人（`owners`）：一个 userId 一局只对应一个座位，放宽这条就会漏别人的手牌。
- 进房猜码限次：超限的人进任何房间都同一个 1013，房间在不在不能从回话里看出来（关闭码、头都一样）；只有自己人放行。改 `acceptJoin` 或房间 `fetch` 时守住 `room.test` 的"第三轮审计"几条。
- 房间的硬规矩（每条都有测试，改的时候测试要跟着守住）：只用 `ctx.acceptWebSocket`、只用一个闹钟、不用 `setTimeout`/`setInterval`；
  每步写入 ≤ 2 行（开房含建表另算）、状态没变不写；构造函数和读路径不碰存储（探不存在的房间码不留东西）；下发前按座位过滤；
  续局"接受、快照、记座位"中间没有 `await`，广播在 `setAlarm` 之前；闹钟以 `getAlarm()` 为准、出错时不丢；闹钟里不往外抛异常。
- 额度：房间找计量（开房占名额、报写入、还名额、问门槛）一律在 `entry` 之外 await（同步的那一步做完、广播完以后），不打断"一步之内没有 await"；
  计量连不上时不开新房、不进新人，在打的照常；名额必须能自愈（到点作废），不能只靠房间来还。计量自己写的行也要记进当天的数。
- 对外的事（`RoomGame.effects` + `GameRoom.perform`）：只在 entry 之外 await；写回、记退避都是普通的一步（≤ 2 行、一个闹钟）；
  关房前先办完（`ending`），办不完到 `closingMs` 就删，不能让房间永远留着。kit 里不出现任何一个游戏的名字和概念（钱包、筹码只在测试的"记账桌"里）。
- 开局随机只经 `begin` 给 256 位熵（`rng.ts` 的 ChaCha20 用 RFC 8439 测试向量锁住，改它测试必须照样过）；不要再给游戏 32 位种子（旧的 `start` 已弃用）。
- 协议只加字段、不改含义（部署后正在打的房间还跑旧代码，4.5）。不兼容的改动要加 `PROTOCOL_VERSION`，并让房间用 `minClientVersion` 让旧页面刷新。
- 测试：`npm test`（类型检查、默认和假 PG 两遍 vitest、构建 dist 并检查入口）。改了房间行为就加测试并做反证（把代码改坏，确认测试会失败）。测试的假时间放在将来，闹钟只在测试调用时才跑（`test/helpers.ts`）。
- 版本号和 `CHANGELOG.md` 各自独立；提交信息以 `arcade-kit:` 开头，分支名 `<模块>/<简短说明>`（总规范第 5 节）。
- 电脑短语：`onStep` 是同步钩子（广播之后、不 await、不写存储、抛错只记日志），`botEmote` 只给电脑座位（`ai`、托管 `auto`），和真人共用座位令牌桶。
  真人的短语不交给规则、`onStep`，也不要加这样的入口（公平：电脑不读真人互动）。
  唯一的例外是 `onEmote`：真人短语广播后调，不给牌局状态，只许用来调 `botEmote` 让电脑回一句；`botEmote` 不触发它。改的时候这几条测试（`test/emote.test.ts` 的 ChattyRoom）要守住。
- 好友房聊天（设计 `docs/chat.md`）：`chat.ts` 的过滤是纯函数（房间和页面共用，不碰 DOM、时间、随机数、存储；单机 `localChat` 只默认读当前时间限速，也不碰 DOM、不存）；房间的 `chat()` 只校验、过滤、限速、转发给带 `chat=1` 的连接，
  不写存储、不进快照、不交给规则和 `onStep`/`onEmote`（电脑不读真人说的话）。`test/chat.test.ts` 的"不进快照、不进存储""架构"两条要守住；改过滤规则同步改 docs/chat.md 第 2 节和测试里的误伤清单。
  `chat.ts` 进浏览器包：正则不用后行断言（iOS 16.4 以前不认，整个模块解析失败），测试扫源码守着。
- 快速匹配（设计 `docs/match.md`）：排队 DO 0 行存储（排着的人就是 `ctx.getWebSockets()` 加附件）、一个闹钟，不 import 规则、不读房间状态；凑桌途中的外部调用都有 `MATCH_CALL_MS` 超时，不让锁被一连串超时占着。
  匹配桌是普通 `GameRoom`，改房间时别破坏 `kitCreateMatch`、自动开打、外人 4004 这几条（`test/match.test.ts` 守着）。
- 搭子战绩（`src/together.ts`，平台 15.19）：只在房间服务端经 `WALLET.together()` 报，不重试、不写房间状态（交给 `ctx.waitUntil`）；`reportMatch` 按 `owners` 认人，电脑座位不报。
  假钱包的 `together` 照平台的 parseTogether 查形状，平台改了同步改 `src/testing.ts` 和 `test/together.test.ts`。
- 分享卡和邀请（规范是仓库根 `docs/social.md`）：`share.ts`、`social.ts` 守上面画面层的规矩。
  `social.ts` 只在 `detectPlatform` 说有平台且已登录时挂，前台才发请求；接口形状以 `docs/platform-backend.md` 为准，改了同步改 `test/social.test.ts`。分享卡只画游戏给的数据，kit 不认识任何游戏（游戏名、图标、主题色都由游戏给）。
  分享卡的二维码：链接只用运行时的 `location.origin` 拼，代码里不写域名；`qr.ts` 是纯函数，改它时 `test/qr.test.ts` 的解码和已知向量都要过。kit 不加运行时依赖。
- 文档里不写正式域名和个人站点，示例域名一律用 `game.example.com`。
