# arcade-kit 模块约定

> 总规范见仓库根的 `AGENTS.md`（拆成独立仓库后，以本文件和随附的 docs 为准）。房间规范是 `docs/platform-backend.md` 第 4 节。

- 内容：联机底座，给各游戏的 Worker 和页面用：`src/room.ts`（Durable Object 房间基类）、`src/worker.ts`（游戏 Worker 的开房、进房入口）、
  `src/meter.ts`（每天的额度计量，0.2.0）、`src/rng.ts`（ChaCha20 随机数，纯函数，0.2.0）、`src/auth.ts`（经平台 `/api/me` 认人；`identify` 按部署方式认人）、`src/guest.ts`（独立模式的游客身份，0.10.0）、`src/internal.ts`（内部地址、身份头）、`src/game.ts`（规则接口、快照体积）、`src/client.ts`（浏览器连接器）、`src/protocol.ts`（消息和关闭码）。
  不部署，没有自己的 Worker。
- 两种形态（0.10.0）：npm 上发 `dist/`（JS + `.d.ts`，`npm run build`）；仓库里 `package.json` 的 `exports` 一律写 `"./x": "./src/x.ts"`，
  仓库内游戏的 `file:` 引用直接用源码。`prepack` / `postpack`（`scripts/manifest.mjs`）在打包时换成 dist 版再换回来，不要手改 exports 指 dist，也不提交 `dist/`。
  `src/` 里相互引用写 `.js` 扩展名（`./auth.js`），游戏的 tsconfig 不用特别配置。发布（`npm publish`）由维护者做。
- 两种部署方式（0.10.0，`src/guest.ts`）：有 `ARCADE` 绑定是平台模式，行为和以前一样、游客 cookie 一律不认；没有 `ARCADE`、`GATE` 也不是 `"login"` 是独立模式（游客）。
  `GATE: "login"` 没绑 `ARCADE` 必须 fail-closed。改认人的代码时 `test/guest.test.ts` 的"平台模式不认游客"几条必须守住。
- `client.ts`、`protocol.ts`、`game.ts`、`rng.ts`、`guest.ts`、`fun.ts`、`fun-art.ts`、`fun-logic.ts`、`table-fun.ts` 会进浏览器包或普通 Node 测试：不能引用 `room.ts`、`worker.ts`（依赖 `cloudflare:workers`）。
  `fun.ts`（0.7.0）只在调用时碰 DOM，import 时不碰；只动 transform、opacity，不读布局；素材只用 `fun-art.ts` 里手写的 SVG，不用 emoji 字体、不引外部资源，新素材也照这个来。`auth.ts`、`internal.ts` 不依赖运行时以外的东西。
- 牌桌互动（0.11.0，规范是仓库根 `docs/table-fun.md`）：`fun-logic.ts` 是纯函数（不碰 DOM、时间和随机数由调用方给，房间也 import），数字的默认值就是规范，改了同步改测试和 README；
  `table-fun.ts` 和 `fun.ts` 同样的规矩：import 时不碰 DOM，动画只动 transform、opacity，量位置只在开菜单和 `controls()` 时。kit 里不出现任何游戏的名字、短语和人物，这些都由游戏传进来。
- 游戏只经 `acceptCreate` / `acceptJoin` 开房进房，不自己把浏览器的请求转给房间；房间的 `fetch` 只认 `KIT_HOST` 内部地址，开房走 RPC。
  `internal.ts` 不进 `package.json` 的 `exports`，游戏引用不到；新加的内部工具也放 `internal.ts`。`auth.ts` 从 0.3.1 起导出（游戏的登录闸门用），只认人，不碰内部地址和身份头。
- 能被别人挤占的额度不能挂在房间上：按座位（人）分开算，没入座的连接单独封顶，入座的人回来永远进得了；一个人也不能用光整个房间的额度（`maxInboundShare`）。
- 开打后座位绑人（`owners`）：一个 userId 一局只对应一个座位，放宽这条就会漏别人的手牌。
- 房间的硬规矩（每条都有测试，改的时候测试要跟着守住）：只用 `ctx.acceptWebSocket`、只用一个闹钟、不用 `setTimeout`/`setInterval`；
  每步写入 ≤ 2 行（开房含建表另算）、状态没变不写；构造函数和读路径不碰存储（探不存在的房间码不留东西）；下发前按座位过滤；
  续局"接受、快照、记座位"中间没有 `await`，广播在 `setAlarm` 之前；闹钟以 `getAlarm()` 为准、出错时不丢；闹钟里不往外抛异常。
- 额度（0.2.0）：房间找计量（开房占名额、报写入、还名额、问门槛）一律在 `entry` 之外 await（同步的那一步做完、广播完以后），不打断"一步之内没有 await"；
  计量连不上时不开新房、不进新人，在打的照常；名额必须能自愈（到点作废），不能只靠房间来还。计量自己写的行也要记进当天的数。
- 对外的事（0.3.0，`RoomGame.effects` + `GameRoom.perform`）：只在 entry 之外 await；写回、记退避都是普通的一步（≤ 2 行、一个闹钟）；
  关房前先办完（`ending`），办不完到 `closingMs` 就删，不能让房间永远留着。kit 里不出现任何一个游戏的名字和概念（钱包、筹码只在测试的"记账桌"里）。
- 开局随机只经 `begin` 给 256 位熵（`rng.ts` 的 ChaCha20 用 RFC 8439 测试向量锁住，改它测试必须照样过）；不要再给游戏 32 位种子。
- 协议只加字段、不改含义（部署后正在打的房间还跑旧代码，4.5）。不兼容的改动要加 `PROTOCOL_VERSION`，并让房间用 `minClientVersion` 让旧页面刷新。
- 测试：`npm test`。改了房间行为就加测试并做反证（把代码改坏，确认测试会失败）。测试的假时间放在将来，闹钟只在测试调用时才跑（`test/helpers.ts`）。
- 版本号和 `CHANGELOG.md` 各自独立；提交信息以 `arcade-kit:` 开头，分支名 `pkg/<说明>`。
- 电脑短语（0.10.0）：`onStep` 是同步钩子（广播之后、不 await、不写存储、抛错只记日志），`botEmote` 只给电脑座位（`ai`、托管 `auto`），和真人共用座位令牌桶。
  真人的短语不交给规则、`onStep`，也不要加这样的入口（公平：电脑不读真人互动）。
  唯一的例外是 `onEmote`（0.10.1）：真人短语广播后调，不给牌局状态，只许用来调 `botEmote` 让电脑回一句；`botEmote` 不触发它。改的时候这几条测试（`test/emote.test.ts` 的 ChattyRoom）要守住。
