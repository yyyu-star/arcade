# arcade-kit

小游戏共用的联机底座：Cloudflare Durable Object 房间、开房进房、浏览器连接、消息协议和每天的额度，各联机游戏（德州、掼蛋、麻将等）的好友房都用它。房间规范见仓库根 `docs/platform-backend.md` 第 4 节。

## Install

Published on npm as **`@yyyu-star/arcade-kit`**. Install it under the alias `arcade-kit` so imports stay `arcade-kit/room`, `arcade-kit/worker`, …:

```bash
npm i arcade-kit@npm:@yyyu-star/arcade-kit
```

(`package.json` then reads `"arcade-kit": "npm:@yyyu-star/arcade-kit@^0.10.1"`.)

Multiplayer toolkit for small turn-based games on Cloudflare Workers: a Durable Object room base class (`arcade-kit/room`),
create/join entry points for your game Worker (`arcade-kit/worker`), a reconnecting browser client (`arcade-kit/client`),
a daily write-quota meter (`arcade-kit/meter`), a seeded ChaCha20 RNG (`arcade-kit/rng`) and the wire protocol (`arcade-kit/protocol`).

- **Two modes.** With a service binding `ARCADE` to the Arcade platform, players are identified through the platform's `/api/me` (login required).
  Without it (and `GATE` not set to `"login"`), the game runs **standalone**: the Worker issues a long-lived guest cookie and anyone can play — no platform needed.
  See "两种部署方式" below.
- **Package format.** ESM only. Each subpath ships compiled JavaScript plus `.d.ts` (`dist/`, with source maps back to `src/`).
  Worker-side entries (`room`, `meter`, `testing`) import `cloudflare:workers` and need a Workers bundler (wrangler / esbuild,
  `@cloudflare/vitest-plugin`); browser-safe entries (`client`, `protocol`, `rng`, `game`, `guest`, `fun`) also load in plain Node.
  Types reference `@cloudflare/workers-types` (optional peer dependency). Node ≥ 22, TypeScript strict mode is fine.
- **Versioning.** Semver; before 1.0 a minor bump (0.x → 0.(x+1)) may change behaviour, see `CHANGELOG.md`.
  The room wire protocol only adds fields; incompatible changes bump `PROTOCOL_VERSION` (old pages are asked to reload).
- **Source / issues:** <https://github.com/yyyu-star/arcade/tree/main/packages/arcade-kit>. License: MIT.

下面的中文是细节。

## 功能

| 入口 | 用在哪 | 做什么 |
|---|---|---|
| `arcade-kit/room` | 游戏 Worker（Durable Object） | 房间基类 `GameRoom`：入座离座（开打后座位绑人）、房主开局、轮流出手或一组人同时出手、按座位过滤下发、断线保留座位、超时代出、掉线托管和交还、电脑批量出手、空房和超时清理、硬限制 |
| `arcade-kit/worker` | 游戏 Worker | `acceptCreate`（开房）、`acceptJoin`（进房）：查 Origin、认人、找房间打包在一起，游戏不用碰浏览器的原始请求；`loginGate`（0.8.0）：首页的登录闸门（独立模式下放行并发游客 cookie）；`standaloneRoot`、`isStandalone`（0.10.0）；`json`、`readJson`、`withCookies`：游戏自己的接口用的小工具 |
| `arcade-kit/auth` | 游戏 Worker | `whoIs`（0.3.1）：经平台 `/api/me` 认人，和开房进房同一个做法（只转发 Cookie 和 IP、3 秒超时、"没登录"和"平台不可用"分开、fail-closed），带回平台的 `Set-Cookie`；游戏自己的接口用它，不再各写一份（登录闸门直接用 `loginGate`）；`identify`（0.10.0）：按部署方式认人，有平台走 `whoIs`，独立模式认游客 |
| `arcade-kit/guest` | 游戏 Worker、浏览器 | 独立模式（0.10.0）：`isStandalone`、游客 cookie（`mintGuestCookie`、`readGuestCookie`）、`guestIdentity`、昵称清洗 `cleanNickname` |
| `arcade-kit/rng` | 两边、规则核心 | ChaCha20（RFC 8439，0.2.0）：256 位密钥按"用途 + 序号"分流、拒绝采样的均匀整数、Fisher–Yates 洗牌；纯函数 |
| `arcade-kit/meter` | 游戏 Worker（Durable Object） | 计量 `RoomMeter`（0.2.0）：每天的写入额度、按人和全站的开房名额，游戏原样导出、绑成 `METER` 就行；`meterReport` / `meterLevel`（0.3.0）给房间以外的 DO 记写入、问门槛 |
| `arcade-kit/game` | 两边、规则测试 | 规则接口 `RoomGame`；`snapshotBytes`：算进房快照最大有多大，游戏在自己的测试里断言上限 |
| `arcade-kit/client` | 浏览器 | `RoomClient`：退避加抖动重连、切回前台和网络恢复时马上连、认得出静默死掉的连接（0.11.1）、按 seq 去重、没确认的操作按原 moveId 和 baseSeq 重发、一直连不上就停下等用户点重试；`createRoom`、`createText`、`closeText`（0.8.0）：开房和给玩家看的默认文案；`detectPlatform`、`withNickname`（0.10.0）：独立部署时页面降级、带昵称 |
| `arcade-kit/testing` | 游戏的测试、本地开发 | 假平台钱包（0.8.0）：`WalletService`（0.13.0 起有搭子战绩的 `together`）、`FakeBank`、`walletHttp`，只复刻接口形状和关键规则；不进线上代码 |
| `arcade-kit/protocol` | 两边 | 消息类型、协议版本、关闭码、房间码格式 |
| `arcade-kit/share` | 浏览器 | 分享卡（0.12.0）：`drawShareCard` 画 1080×1350 的战绩图，`shareCard` 带文件调系统分享，不支持就出预览（保存图片、复制链接）；不上传、0 行写入 |
| `arcade-kit/social` | 浏览器 | 社交第一期（0.12.0）：`mountSocial` 报位置、收好友邀请并在顶上弹横条；`sendInvite`、`fetchFriends`、`setShowWhere`、`postMoment`（0.12.5）等接口小函数；只在有平台且已登录时挂 |
| `arcade-kit/chat` | 两边 | 好友房聊天的过滤（0.18.0）：`checkChat`（规整 → 字数 → 链接、号码、微信 QQ 整条拒发 → 脏话打码）、`chatRejectText`；纯函数，房间和页面用同一个 |
| `arcade-kit/match` | 游戏 Worker（Durable Object） | 快速匹配（0.20.0）：排队基类 `MatchQueue`，每个档位一个实例，0 行存储、一个闹钟，凑满或到点开一张匹配桌（`acceptMatch` 在 `worker`，`MatchClient` 在 `client`） |
| `arcade-kit/theme` | 浏览器 | DOM 组件的主题（0.16.0）：`KitTheme`、`themeVars`（主题对象 → `--ak-*` 变量列表，挡 CSS 注入）、`applyTheme`；分享预览、邀请横条和面板、牌桌互动菜单都认 |

**发布和仓库内引用是两种形态**（0.10.0）：
- npm 上的包是编译好的 `dist/`（JS + `.d.ts`），`exports` 每个入口给 `types` 和 `default`；
- 仓库里 `package.json` 的 `exports` 指向 `src/*.ts`：仓库内的游戏用 `file:` 引用时 npm 只建一个软链、不会替 kit 构建，
  指向源码才能 `npm ci` 后直接用（和 0.9 一样，游戏用 vite / wrangler / tsc 一起编译）。打包时 `prepack` 构建 dist 并把 `exports` 换成 dist 版，
  `postpack` 换回来（`scripts/manifest.mjs`）。所以**不要手改 package.json 里的 exports 成 dist**，新加入口照 `"./x": "./src/x.ts"` 写；
- `src/` 里相互引用写 `.js` 扩展名（`./auth.js`）：编出来的 JS 原样就能被 Node 原生 ESM 解析，vite、esbuild、tsc（bundler 解析）对源码会把它映射回 `.ts`。
游戏只用上面这几个入口；内部地址和身份头（`src/internal.ts`）不在 `exports` 里，游戏引用不到，免得自己拼内部请求。

## 游戏怎么接

1. `package.json` 加依赖：仓库外 `npm i arcade-kit@npm:@yyyu-star/arcade-kit`（npm 上的包名是 `@yyyu-star/arcade-kit`，装成别名 `arcade-kit`，代码里照旧 `arcade-kit/room`）；仓库内现在仍是 `"arcade-kit": "file:../../packages/arcade-kit"`（总仓库 AGENTS.md 第 1 节唯一允许的模块外引用），以后各游戏改用 npm 上的版本。
2. 写规则：实现 `RoomGame<S, A, V>`（`begin`、`parse`、`apply`、`turn`、`view`、`ai`、`timeout`、`over`，可选 `actors`、`turnMs`、`breakPoint`），都是纯函数，浏览器和房间共用。
   - **开局用 `begin(entropy, rulesVersion)`**（0.2.0）：`entropy` 是房间现生成的 256 位熵（8 个 u32），当 `arcade-kit/rng` 的密钥发牌，
     后面每一副从同一把密钥分出的流里取：`shuffle(deck, stream(key, 'deal', 第几副))`。密钥放在自己的状态里（只在服务端），`view` 绝不能带上它。
     旧的 `start(seed, rulesVersion)` 只给 32 位种子，玩家拿自己的手牌逐个试种子几分钟就能反推出全桌的牌——0.2.0 里还留着只为老游戏升级时能开局（`RoomGame` 里暂时仍是必填，写了 `begin` 的游戏让它抛错即可），
     房间见到没有 `begin` 的游戏会记警告；下一版去掉。单机要"同种子同结果"的复现可以照旧用带种子的随机数，联机房间一律用 `begin`；
     换开局方式时升 `rulesVersion`，已经开打的旧房间按开局时记下的版本打完。
   - `view(state, seat)` 只能放这个座位能看到的东西，房间只发它的结果；
   - **`apply` 返回的 `{ error }` 会原样发给出手的人**，所以错误码只能是固定的短码（小写字母、数字、下划线，最长 32），不能带牌面之类的隐藏信息。
     不合这个格式的，房间一律换成 `illegal_move`；
   - 不轮流的阶段（结算页大家点继续、倒计时后发下一副）用 `actors(state)` 返回这一刻能出手的全部座位、`turnMs(state)` 给这个阶段的时限：
     组里的电脑、托管马上代出，真人谁先发都收；时限从进入这组时起算、组里有人出手不重新计时，到点对还没出的真人逐个 `timeout`；
     同一组里别人先出了，后出的人不算 stale。**推荐返回 `{ seats, group }`**，`group` 是这一组的标识（比如 `settle-3`）：出手前后一样、而且出手的人离开了名单、没有新座位加入，才是同一组，否则是新的一手（一组里每个人最多出一次）。
     只返回数组时房间靠"出手的人离开名单、其他人原样留着"推断，所以每个人出手后都要从名单里拿掉；
     这有歧义：`[2, 3]` 里 2 出完剩 `[3]`，和"新的一手只有 3 能出"分不清（会当成同一组），会出现这种情况的游戏一定要给 `group`。
     牌局没打完时名单不能是空的，空了房间记日志、按打完处理（游戏写了 `waiting` 并返回 true 的、在停一会儿（`pause`，0.5.0）的除外，0.3.2）。有人接管组里还没出的电脑座位、收回托管，整组的期限不变；
     页面看 `room.turn.seats`（还没出的座位）和 `room.turn.deadline`（整组一个截止时间）。两个都不写就是一次一个人、30 秒，和 0.1.0 一样；
   - 在规则测试里挑几个最大的局面，断言 `snapshotBytes(rules, state)` 不超过自己定的上限（重连一律发全量快照，太大会拖慢手机重连）。
   - 可选 `breakPoint(state)`（0.2.0）：这一刻是不是"一段的结尾"（比如一副或一手打完、停在结算页）。当天写入到了 stopWrites，在打的房间走到这里就收场（见下面"每天的额度"）；
     不写的话房间一知道要收场就马上关。
   - 0.3.0 的可选接口（开局选项、座位换人、对外的事、不轮流的操作）见下面"可选接口（0.3.0 起）"，不写就和 0.2.0 一样。
   - 停一会儿再接着来（0.5.0，`pause` / `resume`）见下面"可选接口"的最后一条。
3. 房间类：`export class Room extends GameRoom<S, A, V, Env> { protected readonly game = rules; }`，需要时覆盖 `limits`（默认值是 4.5、4.6 那些数），
   写成 `{ ...DEFAULT_LIMITS, turnMs: 20_000 }` 这样只改要改的，以后加了新字段不用跟着改。
4. 计量（0.2.0）：Worker 的入口文件原样导出 `export { RoomMeter } from 'arcade-kit/meter';`，`wrangler.jsonc`：
   ```jsonc
   "durable_objects": { "bindings": [{ "name": "ROOM", "class_name": "Room" }, { "name": "METER", "class_name": "RoomMeter" }] },
   "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Room", "RoomMeter"] }],   // 免费版只能用 SQLite 后端
   "services": [{ "binding": "ARCADE", "service": "arcade" }],                       // 登录闸门已经有了
   "vars": { "KIT_QUOTA": { "dailyRooms": 300 } }                                     // 可选：只写要改的门槛，见下面"每天的额度"
   ```
   已经上线过 v1 的游戏不能改 v1，另加一条 `{ "tag": "v2", "new_sqlite_classes": ["RoomMeter"] }`。
   **正式环境一定要绑 `METER`**：没绑时不限额、不计数，只是为了 0.1.x 的游戏升级 kit 时不至于一下子开不了房。
5. 游戏 Worker 的路由（`test/worker.ts` 是完整例子），只接这两个，不要自己把浏览器的请求转给房间：
   - 开房：`POST …/rooms` → `acceptCreate(request, env)`：成功 201 `{ code }`；失败回 JSON `{ error, code? }`（`protocol.ts` 的 `CreateError`，0.2.0）：
     | 状态 | error | 意思 | 页面可以说 |
     |---|---|---|---|
     | 401 | `login` | 没登录 | 先登录再来 |
     | 403 | `forbidden` | 不是本站页面 | 从游戏大厅打开 |
     | 409 | `has_room` | 这个人已经有一个开着的房间，`code` 是它的码 | 你已经有一个房间了，先回去（给"回到房间"按钮） |
     | 429 | `daily_limit` | 这个人今天开房次数用完了 | 今天开房次数用完了，明天再来 |
     | 503 | `busy` | 今天联机的人太多（写入到了 busyWrites，或全站开房数到了） | 今天联机的人太多了，明天再来，单机照常玩 |
     | 503 | `unavailable` | 平台或计量暂时连不上、房间出错 | 暂时开不了房，稍后再试 |
     | 400 | `bad_options` | 开房时带的选项不合格（0.4.0，见"可选接口"的开局选项） | 页面自己的选项写错了，一般不会出现 |

     房间走 RPC 建，身份不经过任何请求头；
   - 进房：`GET …/rooms/<码>/ws`（WebSocket 升级）→ `acceptJoin(request, env, code)`。被拒时先接受升级再用关闭码关掉
     （浏览器的 WebSocket 拿不到 HTTP 状态码）：没登录 4401、别的网站 4403、码不对或没有这个房间 4004、页面太旧 4005、旁观的人满了 4003、
     这个人的重连次数用完 4029、这个人的入站额度用完 4030、今天联机的人太多不进新人 4503（0.2.0）——这些客户端都不再重连；平台暂时认不了人（503、超时）是 1013，客户端按退避重连，开房时则回 503。
6. 浏览器：`new RoomClient({ url, clientVersion, onMessage, onStatus })`，`sit`、`start`（只有房主能开）、`act`、`leave`、`close`。
   - 收到 `welcome`（进房、重连）整桌重画；收到 `state` 按 `frames` 依次播放（每帧带相对延迟，电脑连续出手时用）；
   - `act` 自动带上 `baseSeq`（看到的最新 seq）；牌局在那之后变过的，房间回 `stale`，界面按最新状态让玩家重新出；
   - 开打以后换座位有限制（见下面"座位绑人"）：坐过的人回别的座位是 `not_your_seat`，接管别人坐过的电脑座位是 `seat_reserved`，按"座位被占"提示；
   - 大厅和牌桌用这几个字段（0.1.1）：
     - `room.seats[i].reserved`：开打后这个座位绑了人（主人离座了也算）。`kind: 'ai'` 且 `reserved` 的座位别人接管不了，不要挂"接管"按钮；
     - `room.seats[i].name`：绑了人的电脑座位是原主人的昵称，可以显示"电脑代 小王 打"；没绑人的电脑座位是 null。判断是不是电脑看 `kind`，不看 `name`；
     - `you.bound`：这个人绑定的座位（离座了也还是它；没开打、没坐过是 null）。`you.seat` 是 null、`you.bound` 不是 null 时，给他显示"回到我的座位"（发 `sit(bound)`）；
     - 只下发"绑没绑"和公开的昵称，不下发 userId；
   - 开局选项（0.3.0）：房主 `start(opts)`，`opts` 是任意 JSON，游戏的 `options` 校验；不合格回 `bad_options`，有人坐在这一局用不到的座位上回 `seat_closed`；
   - `onStatus('reconnecting', 关闭码)`：正在重连，码是这次断开的原因（1006 网断了、1013 平台忙），可以据此换提示；
   - `onStatus('closed', 关闭码, 原因)`：按码提示（4401 去登录、4005 刷新页面、4503 今天人太多……）；4000 带原因 `CLOSE_REASON.quota`（0.2.0）是今天的额度满了、房间在这一副打完时收场，
     页面可以说"今天联机的人太多了，这一副打完先散了，单机照常玩"；`onStatus('failed')`：连着 20 次没进得了房间，提示"连不上"，用户点了调 `retry()`。
     退避和失败次数在收到 `welcome` 时才清零（被拒的连接也会先 open 再关）。
   - 断线怎么认（0.11.1）：每 25 秒的心跳和每次切回前台都发一个 `ping`，`PONG_WAIT_MS`（8 秒）内什么都没收到（房间自动回的 `pong` 也算）就判这条连接死了，
     不等 `close`、直接按 1006 重连——iOS 锁屏、切 App 后 socket 常常还显示 OPEN、也不触发 close。建连卡在 CONNECTING 超过 `CONNECT_MS`（10 秒）同样重连。
     监听 `document` 的 `visibilitychange`、`window` 的 `pageshow` 和 `online`：网络恢复、切回前台时别等退避；从往返缓存（bfcache，`pageshow` 带 `persisted`）回来的页面旧连接一律作废。
     测试和非浏览器环境可以传 `events`、`windowEvents` 注入事件源。

## 登录闸门、开房、假钱包（0.8.0）

几个游戏各抄一份的通用部分收进 kit。行为和游戏原来的写法一致，测试见 `test/gate.test.ts`、`test/create.test.ts`、`test/testing.test.ts`。

- **登录闸门** `loginGate(request, env, { downPage? })`（docs/platform-backend.md 5.8、15.8）：游戏 Worker 把首页（`/games/<id>/`、`/games/<id>/index.html`）交给它。
  `env` 要有 `ASSETS`、`ARCADE`，`GATE` 写 `"off"` 时不拦。处理分四种：
  - 登录了：回页面，带上平台续期的 `Set-Cookie`，不缓存；
  - 没登录：302 到 `/login?next=<原路径和查询参数>`（好友房链接的 `?room=` 原样带回），同样带 `Set-Cookie`；
  - 平台不可用：503 整页，`Retry-After: 30`；
  - 默认的 503 页不带游戏名，游戏可以传自己的 `downPage`（标题、配色）。

  游戏自己的接口（单机带入结回之类）用 `whoIs` 认人，回话用 `json(body, status, setCookie)`。认人之前读请求体用 `readJson(request, 最多几字节)`：
  不带 content-length 或超长的一律不读。
- **开房** `createRoom(url, opts)`：POST `{ opts }` 带 `X-Arcade: 1`，回 `{ code }` 或 `{ error, code? }`。401 当 `login`，回话不是 JSON 当 `unavailable`，网络断了是 `offline`。
  游戏 Worker 那边从请求体的 `opts` 取开局选项交给 `acceptCreate` 的 `options`。
- **默认文案** `createText(error, overrides?)`、`closeText(code, reason?, overrides?)`：开房失败、断开时给玩家看的话，只写各游戏通用的说法（表在 `ROOM_TEXT`）。
  游戏按 key 换掉个别措辞，比如 `{ roomClosed: '房间关了，桌上的筹码已经结回钱包', quota: '……这一手打完先散了……' }`。
  key 有两类：开房错误码，以及 `CLOSE` 里的名字，外加 `quota`、`other`。房间拒了某个操作（`ErrorMsg`）的话跟游戏规则走，不在这里。
- **假平台钱包** `arcade-kit/testing`：只给游戏的 workerd 测试、冒烟和本地 `wrangler dev` 用，不进线上代码（它依赖 `cloudflare:workers`，也不能进浏览器包）。
  - 复刻的范围：平台钱包的接口形状和关键规则，即带入、结回、放弃、只结一次、余额够这次才能带、操作 id 去重、按 `ref` 分份、到期退回、client 每天净赢上限、小结 `stats` 的上限、补给（5.9、5.10、15.9）。
    计量、熔断档、流水、战绩怎么存这些不复刻。
  - 规则数取平台默认值（`NEW_BALANCE`、`RELIEF_TO`、`WIN_UNITS`、`TIERS`）。
  - 测试辅助：`FakeBank` 的 `calls`、`writes` 数调了几次、写了几次；`stats` 记结回带的小结；`setBalance` 造余额。
  - **平台改了钱包接口，平台 PR 的描述里写"影响 kit/testing"，由维护者安排 kit 跟上**（一个 PR 只改一个模块）。
  - 接法：测试 Worker 的主模块 `export { FakeBank, WalletService } from 'arcade-kit/testing'`，wrangler 配置加 DO 绑定 `FAKE_BANK`（`FakeBank`）。
    `WALLET` 绑回这个测试 Worker 自己：
    ```jsonc
    "services": [{ "binding": "WALLET", "service": "<测试 Worker 名>", "entrypoint": "WalletService", "props": { "game": "<游戏 id>" } }]
    ```
    本地的假平台（假的 `ARCADE`）里先 `const r = await walletHttp(request, env); if (r) return r;` 接住 `/api/wallet*`。

**游戏从自己那份迁过来**：每个游戏一个 PR，升到 kit 0.8.0（`npm install` 刷新 lockfile）。

1. 假钱包：删掉自己的 `test/fake-wallet.ts`，用到的地方改成从 `arcade-kit/testing` 导入（类名、绑定名和原来一样）。和旧写法的差别：
   - 不维护游戏名单，只核对 `props.game` 和参数一致；
   - 同一个游戏按 `ref` 可以同时有好几份；
   - client 每天净赢上限是 `WIN_UNITS`（10 份，平台 0.10.2），原来写死 3 份的测试数字要跟着改；
   - 补给看余额加桌上的，桌上有筹码也能领；
   - `FakeBank.stats` 每条多了 `game`，只记结回成功的；
   - `walletHttp` 的回话多了 `winUnits`。
2. 登录闸门：首页的 `home()` 换成 `loginGate(request, env, { downPage: 自己的 503 页 })`，删掉自己的 `reply` / `json` / `readJson`，改用 kit 的。
   单机带入结回的转发各游戏参数不同，不搬。
3. 页面：开房换成 `createRoom('rooms', opts)`，开房失败和断开的话换成 `createText` / `closeText` 加自己的 `overrides`。
   原来说法和默认不同、又想保留的，写进 `overrides`。游戏专属的错误码仍在游戏自己的文案里。
4. 跑模块的 `npm test`、构建和登录、开房相关的冒烟，行为不变。

## 可选接口（0.3.0 起）

都是 `RoomGame` 上的可选纯函数（加一个房间类上的 `perform`），不写就和 0.2.0 一样；kit 里不写死任何一个游戏。完整例子是 `test/ledger.ts`（"记账桌"）。
类型上 `RoomGame<S, A, V, O, E>`、`GameRoom<S, A, V, Env, O, E>` 多了两个带默认值的参数：`O` 开局选项、`E` 对外的事（`extends RoomEffect`）。

- **开局选项** `options(raw)`、`seatCount(opts)`：房主 `start` 时带 `opts`，游戏校验（不合格返回 null，房间回 `bad_options`）；`seatCount` 是这一局用几个座位，
  只给前面这些座位补电脑，后面的一直空着、开打后谁也坐不进去，有真人坐在后面时回 `seat_closed`。`begin(entropy, rv, setup)` 的 `setup` 带上 `opts` 和每个座位坐的是谁（`seats: SeatKind[]`），
  游戏自己放进状态。
- **开房就定选项**（0.4.0，推荐）：游戏 Worker 从开房请求里取出房主选的选项，`acceptCreate(request, env, { ...gate, options })` 交给房间。
  房间开房时就用 `options` 校验（不合格回 400 `bad_options`，不占名额、不建房间），校验过的存进房间、随 `RoomInfo.opts` 发给每个进房的人，
  进房的人开打前就知道这一局怎么打（比如要从钱包带多少、几个人一桌）。规则：
  - **定下以后不能改**：开打时以开房的为准，`start` 带的 `opts` 不看（合格的不换、不合格的也不拒）。要换就关掉重开；
  - 等人时坐到 `seatCount` 以外的座位直接回 `seat_closed`（不用等房主开打时才被拒）；
  - 选项是房主选的、谁都能看，**不能放隐藏信息**；开房仍是那一步（建表 + 状态 + 闹钟），选项和状态在同一行里；
  - 不带 `options`（或游戏没写 `options`）的房间和 0.3.x 完全一样：没有 `RoomInfo.opts`，开打时由 `start` 定。
- **座位换人** `seated(state, seat, 'human' | 'ai')`：开打后有人坐下（接管电脑、或者主人回到自己的座位）、离座交给电脑时调，和那一步一起写 1 行（不额外写）。
  托管不算换人、不调。房间不把 userId 交给规则，主人回来和新人接管都是 `human`，游戏按自己的状态分（`test/ledger.ts` 用"这个座位的筹码是不是真人买入的"）。
- **对外的事** `effects(state)`、`settled(state, id, result)`、`closing(state)`，房间类实现 `perform(effect, userId)`：
  - 游戏在状态里记着要去外面办的事（比如从玩家的钱包扣买入、把筹码结回去），每笔 `{ id, seat, ... }`，`id` 一局里唯一；
  - 每一步之后房间把没在办的交给 `perform`（在 entry 之外 await，不打断"一步之内没有 await"），`userId` 是这个座位绑定的人；办完一步写回（`settled`，1 行，需要时再设闹钟）；
  - **同一笔可能办两次**（断线、被驱逐、写回前出错），办事的一方必须按 `id` 去重；
  - 失败（`perform` 抛错）记下退避时间，用那唯一的闹钟重试：15 秒起、每次翻倍、最多 10 分钟；没到点不重试，不会每一步都去碰一次；
  - 关房（寿命、没人、入站用完、额度满）：先调 `closing` 让游戏记下收场要办的（比如把所有人桌上的筹码结回去）。还有没办完的，房间断开所有人（4000），
    留着存储把它们办完再删；正在关的房间进不来（4000）。最多等 `limits.closingMs`（默认 1 小时），到了还办不完就记日志照样删，办事的一方要有自己的兜底（比如到期退回）；
  - 写入：写回 1 行；失败记退避 ≤ 2 行；进入"正在关" 2 行（状态 + 闹钟）；办完删掉 1 行。每步仍 ≤ 2 行。
- **不轮流的操作** `free(action)`：返回 true 的操作入座的人什么时候都能发，不看轮没轮到、不判 stale；该谁出手没变就不改这一手的期限和 `turnSeq`（轮到的人之前看到的 seq 照样有效）。
  **别人看不出来的就不广播**（0.7.1）：做完这一步、电脑也没接着出，比一比除出手人以外每个座位和没入座的人的视图、房间信息，都和做之前一样，
  就照常存（≤ 2 行）、只回给出手的连接（`StateMsg.quiet: true`，带 ack），**seq 不加**。不然哪怕广播一条内容一样的、或者 seq 跳一下，
  别人都知道"有人做了点什么"——比如麻将的声明窗口里，没选择的人不用答，有人答了就等于说他能碰、杠、胡。RoomClient 0.7.1 起认这种消息，
  旧的 RoomClient 当重复丢掉（只是出手人自己的画面等下一条消息才更新）。比较按每步重算视图，游戏的 view 要便宜（德州、掼蛋、麻将都是几十微秒）。
  照样过 `parse`、`apply`，照样占令牌桶和入站额度。适合离桌、暂离回来；只冒个气泡的用下面的快捷短语（不写存储）。
- **等外面的事** `waiting(state)`（0.3.2）：牌局没打完、这一刻谁也不用出手（比如德州能打的人不够两个，等有人坐下、补码、回来，或者买入到账）时返回 true，
  `actors` 可以是空的：房间不按出错处理，不计时、不驱动电脑、一行不写，牌局再变时重新看该谁出手。不写的话名单空了照旧记日志、按打完处理。
- **停一会儿再接着来** `pause(state)`、`resume(state)`（0.5.0）：比如一手打完固定停几秒让大家看清结果，再自动发下一手。
  不能等所有人点（有人走开就卡住），也不能指给某个座位计时（电脑、托管的座位会被房间立刻代出，停不住），所以交给房间停：
  - `pause` 返回要停的毫秒数（正的有限数），不在停就返回 null。**只在没人能出手（`actors` / `turn` 为空）时才问它，优先于 `waiting`**；
  - **计时从进入停顿那一刻算**：电脑连着出完进来的，从客户端播放完（最后一手电脑的播放延迟之后）算；开局就是停顿的从开局算；
    从 `waiting` 变成停顿的从变的那一刻算。停顿期间不轮流的操作、座位换人、对外的事办完照常做，**不重新计时**；轮流的操作回 `not_your_turn`；
  - 到点由房间用**唯一的那个闹钟**调 `resume` 做一步（比如发下一手），和这一步一起**最多写 2 行**，之后电脑照常接着出、帧照常广播；
  - `resume` 返回的状态不能还在停（要连着停两段就在一次 `pause` 里给总时长）。它抛错或者返回的还在停：记日志、不用它的结果、过 60 秒再试，不会在当前时刻反复响；
  - 页面看 **`room.pause.until`**（截止时间戳，毫秒）画倒计时，这时 `room.turn` 是 null；不在停时没有这个字段；
  - 写了 `pause` 就必须写 `resume`：只写 `pause` 的当作没有停顿（记一次日志），和 0.4.0 一样。都不写的游戏行为完全不变。
- **快捷短语** `emotes`（0.6.0）：游戏给一个正整数（短语表有几句），入座的人就能发 `0` 到 `emotes - 1` 的编号，房间转发给所有人。
  **只认编号、不收自由文本**：短语的文字、图标由游戏自己在页面里定，房间不知道内容，不用审、也没人能发骂人的话。
  - 浏览器：`client.emote(id)` 发；房间转发的 `{ t: 'emote', seat, id }`（`EmotedMsg`）交给 `RoomClientOptions.onEmote(seat, id)`，**不进 `onMessage`**
    （不在 `DownMsg` 里，不用短语的游戏一行不用改）。`seat` 是房间的座位号，游戏按自己的视角换算；发的人自己也会收到，收到再冒气泡。没连上时发的直接丢，不存着重发；
  - 房间：**0 行写入、不改 seq、不进状态**，断线时错过的不补发。入站照常计数（令牌桶、这个人的那一份、房间一生的 `maxInbound`），随下一次写库一起存；
  - **限速用户感觉不到**（0.7.0）：每个座位一个令牌桶，**每 `emoteMs`（默认 1000 毫秒）补 1 个、最多攒 `emoteBurst`（默认 3）个**，连扔三下没问题。
    两个值在游戏 `wrangler.jsonc` 的 `vars.KIT_QUOTA` 里改（`{ "emoteMs": 1000, "emoteBurst": 3 }`，`emoteMs: 0` 不限速），不用发版；没写就用 `RoomLimits` 里的默认。
    进房的快照（`welcome.emote`）带上这个节奏，`RoomClient.emote` 在本地按同样的节奏发：太快的排到下一个令牌，队列只留最后 2 个，多的丢掉，**界面上永远不提示"太快了"**；
    房间偶尔回的 `emote_too_fast`（刚重连、节奏刚调过）由 `RoomClient` 静默丢掉，不交给页面。
    账单：入站 WebSocket 消息按 20 条算 1 个请求、出站不计费，6 个人每秒一下连着扔一小时约 1,000 个请求；
  - **指定对象**（0.7.0）：`client.emote(id, to)`，`to` 是房间的座位号（扔道具、点名嘲讽、催促炸弹）。得是有人（真人或电脑）的别的座位，不然回 `bad_target`，不占令牌；
    转发时带上 `to`，`onEmote(seat, id, to)`。不带 `to` 和 0.6.0 完全一样；
  - **编号空间**（0.7.0）：短语、表情、道具共用 emote 的 id，不另开消息类型。每个游戏自己定编号表（比如 0–14 短语、15 起表情、再往后道具），
    `RoomGame.emotes` 是总数；房间不区分种类，只校验 id 范围和 `to`。表情、道具按"游戏的起始编号 + 下标"映射到 `arcade-kit/fun` 的 `STICKERS`、`PROPS`（顺序固定、只往后加）；
  - 被拒回 `error`（不带 moveId，页面可以不提示）：`no_emotes` 游戏没写 `emotes`；`bad_emote` 编号不是 0 到 `emotes - 1` 的整数；
    `not_seated` 没入座（来看的人不能发，免得旁观的刷屏）；`room_over` 房间打完了；`emote_too_fast` 这个座位没令牌了；`bad_target` 对象不对。
  - **电脑也会互动**（0.10.0）：房间子类覆盖 `protected onStep(state)`（每一步广播完调一次，同步、不能 await、不写存储，抛错只记日志），
    在里面看这一步的公开事件，需要时调 `protected botEmote(seat, id, to?): boolean` 让电脑座位发一句：
    ```ts
    class Room extends GameRoom<S, A, V, Env> {
      protected readonly game = rules;
      protected override onStep(state: S): void {
        const e = lastPublicEvent(state);          // 游戏自己的：谁出了什么、谁赢了一把（只取公开的）
        if (e?.bigWin) this.botEmote(e.seat, CHEER, e.loser);
      }
    }
    ```
    只有电脑在出手的座位能发（`kind` 是 `ai`，或真人掉线后电脑托管 `auto`）；真人座位、空位、编号或 `to` 不对、房间打完了、这个座位没令牌了都回 `false`、不广播。
    广播的消息和真人的一样（`{ t: 'emote', seat, id, to? }`），多带 `bot: true`（`onEmote` 的第 4 个参数），页面一般不用区分。
    和真人共用同一个座位的令牌桶（`emoteMs` / `emoteBurst`），不写存储、不改 seq。电脑短语即时到达，不跟着 `frames` 的播放延迟走：想让它落在某一帧之后，游戏在页面上自己按帧排队。
    **公平约束（游戏侧守，kit 只管广播）**：电脑发不发、发什么只看公开信息（出过的牌、结算结果），不读隐藏的牌，也不读任何真人的短语——
    kit 本来就不把真人短语交给规则和 `onStep`，游戏也不要自己记下来喂给电脑。电脑出牌的决策（`ai`）照旧不受短语影响。
  - **电脑回应真人的短语**（0.10.1）：覆盖 `protected onEmote(from, id, to?)`，真人发的短语校验通过、广播完之后调一次，**只许在里面调 `botEmote`**：
    ```ts
    protected override onEmote(from: number, id: number, to?: number): void {
      if (to !== undefined && id === TAUNT) this.botEmote(to, TALK_BACK, from);   // 被点名的电脑回嘴（to 是真人座位时 botEmote 回 false，不发）
    }
    ```
    故意不给牌局状态；同步、不能 await、不能写存储，抛错只记日志。电脑的 `botEmote` 不会再触发它（免得电脑互相回个没完），
    回应照样占那个电脑座位的令牌桶。**不许把真人短语记进状态、字段或存储**，电脑的出牌决策绝不能读到它。
- **好玩素材** `arcade-kit/fun`（0.7.0，浏览器用，纯 DOM + SVG + Web Animations，不依赖渲染库）：
  - **图层**：`createFunLayer({ zIndex?, parent? })` 往 `document.body` 挂一个 `position: fixed; inset: 0; pointer-events: none` 的层（class `arcade-fun`，默认 z-index 50），
    点击全部穿透。要比牌桌高、比游戏的弹窗低：**游戏的弹窗、确认框的 z-index 要高于它**。界面在自己的层叠上下文里的（`position: fixed` 的容器、带 transform 缩放的舞台），
    光靠 z-index 夹不到中间，这时**打开弹窗前 `layer.hide()`、关掉后 `layer.show()`**（`visibility: hidden`，正在播的动画不中断）。离开牌桌 `layer.destroy()`；
  - **坐标**：起点、终点都传**屏幕坐标的矩形**（`getBoundingClientRect()` 的 DOMRect，或任何有 `left/top/width/height` 的对象），kit 自己换算到图层里；
  - **表情包** `showSticker(layer, rect, id)`：12 个（`STICKERS`：得意、狗头、大哭、流汗、震惊、坏笑、比心、生气、睡着、鼓掌、笑哭、墨镜），冒在头像右上方，
    弹出来做 1 秒内的小动作，共约 2 秒淡出；
  - **互动道具** `throwAt(layer, from, to, prop, { sound?, onHit?, target? })`：8 种（`PROPS`：番茄、鸡蛋、臭鸡蛋、拖鞋、炸弹、玫瑰、点赞、干杯）。
    从 from 沿抛物线飞到 to，边飞边转，带两层残影，0.7 秒；命中：番茄爆开汁水四溅留果肉，鸡蛋蛋壳碎开、蛋清蛋黄糊上去往下流（臭鸡蛋再飘几缕绿色臭气），
    拖鞋拍扁弹开冒星星，炸弹引信闪三下再爆、冒烟、头像熏黑一下，玫瑰落下花瓣飘，点赞弹出带星星，干杯两杯碰一下冒泡沫。
    污渍在头像上留 3 秒再淡出（0.11.0 起，原来约 1.7 秒），同一个人（`target`，游戏传座位号最稳）最多叠 3 层；
  - **头像的受击反应**由游戏做（头像在游戏的画布或 DOM 里）：命中时 kit 调 `onHit(prop)`，游戏让头像抖一下、缩一下；
  - **音效**：`throwAt` 在起飞、炸弹引信、命中时调 `sound(prop, phase)`，游戏判断静音后用 `playFunSound(自己的 AudioContext, 输出节点, prop, phase)` 放（WebAudio 现场合成）；
  - **性能**：只动 `transform`、`opacity`（合成层完成，不触发重排，不读布局），图层 `contain: strict`；同一个图层同时最多 `MAX_PLAYING`（4）个效果，多的直接丢掉（返回 false）；
  - **素材**：全部是 kit 自己手写的 SVG（`src/fun-art.ts`，viewBox 0 0 100 100），不用 emoji 字体（有的设备显示成方框）、不引外部图片和字体，许可同 kit 本身；
  - **演示页**：`demo/index.html`，在 kit 目录里用任意能跑 TS 的开发服务器打开（如 `npx vite`，再访问 `/demo/`），每种道具、每个表情都有按钮。
- **牌桌互动组件** `arcade-kit/table-fun`（0.11.0）：头像菜单、互动面板、冷却护盾连击回敬、电脑反应整套，见下一节。
- **房间以外的 DO 用计量** `meterReport(env, writes)`、`meterLevel(env)`（`arcade-kit/meter`）：比如游戏自己的钱包 DO，每次写完报一次、写之前问一下门槛（`stop` 就别写了）。
  计量每收一次报数自己写 1 行，所以只适合写得少的地方；没绑 `METER` 时回 `ok`、什么都不做，连不上时抛错。

## 牌桌互动（table-fun，0.11.0）

几个牌桌游戏共用的一整套互动：外观、位置规则、节奏、电脑怎么反应都在 kit 里，游戏只做接线。规范正本是仓库根的 `docs/table-fun.md`（第 0 节分工，第 2–4 节的数字）。

| kit 管 | 游戏管 |
|---|---|
| 点头像菜单、互动面板（短语 / 表情 / 道具）、自己的表情菜单、首次提示 | 每个座位头像的**屏幕矩形**、名字、是不是自己、是不是电脑、互动性格 |
| 冷却（道具 1.5 秒、表情和短语 1 秒）、护盾（同一人 10 秒最多被扔 6 次）、连击 ×N、回敬 | 菜单不能盖的地方（手牌、操作按钮）的屏幕矩形 |
| 长按 0.4 秒连扔、菜单第一格是上次扔的道具、污渍 3 秒淡出 | 发送通道（好友房走 kit 的 emote，单机直接回给组件） |
| 电脑的反应 `botReact`（一定是表情 + 一句话，回扔时再带道具）、名场面横幅 | 把自己的公开事件映射成名场面（`bomb`、`first-out`、`big-win`、`kong`、`self-draw`……）、短语表 |

### 页面里接上

```ts
import { TableFun, funIdCount, type FunSeat } from 'arcade-kit/table-fun';

const fun = new TableFun({
  storageKey: 'mygame',                          // 存储前缀：mygame.hint.fun（localStorage）、mygame.fun.blocked（sessionStorage）；只认游戏 id 的写法，不合格构造时抛错（0.13.1）
  phrases: PHRASES,                              // 本游戏的短语表；编号 0..P-1 是短语，P..P+11 表情，P+12..P+19 道具
  named: [3, 4, 2],                              // 头像菜单里的 3 句点名短语（短语表下标）
  seats: (): (FunSeat | null)[] => view.seats.map((s, i) => s && ({
    rect: avatarRect(i),                         // 屏幕矩形（CSS 像素）；DOM 头像直接 getBoundingClientRect()
    name: s.name, me: i === 0, bot: s.bot, temper: s.temper,   // temper：'rowdy' | 'normal' | 'cool'
    plate: plateRect(i),                         // 可选（0.18.2）：名字和筹码那一块，气泡不盖它
    marks: tagRects(i),                          // 可选（0.20.1）：头像旁的小标签（缺门、庄家……），气泡和首次提示不盖
  })),
  avoid: () => [handRect(), actionBarRect()],    // 菜单、面板尽量不盖；放不下时选盖得最少的位置
  button: () => funButtonRect(),                 // "互动"按钮放哪；null 不画（没坐下）
  buttonStyle: () => ({ scale: stageScale, row: true }),  // 可选（0.18.2）：按钮字和图标跟着牌桌放大（≥ 1），row = 图标和字横排；0.20.1 起也可直接给 fontSize、icon（像素）；别再覆盖 .atf-btn
  send: (id, to) => (online ? client.emote(id, to) : fun.receive(0, id, to)),
  canSend: () => seated,
  hintSeat: () => (trickEmpty(1) ? 1 : null),     // 首次提示冒在哪家头像旁；null = 现在会挡住出牌，过 2 秒再问（0.17.0，不给就挑第一个电脑）
  enabled: () => settings.fun,                   // 设置里关掉：别人的一律不播，单机电脑也不反应
  scope: () => roomCode ?? 'solo',               // "屏蔽他""全部屏蔽"按房间分开
  localBots: !online,                            // 单机：电脑的反应由组件算、在本地播
  sound: (prop, phase) => muted || playFunSound(ac, sfxBus, prop, phase),
  onHit: (seat) => shakeAvatar(seat),
});
client.onEmote = (m) => fun.receive(m.from, m.id, m.to);   // 好友房收到的（自己发的也是从这里回来）
```

- **画布游戏**（Phaser 等）：`rect` 传头像换算到屏幕后的矩形，算法是 `canvas.getBoundingClientRect()` 的左上角加上"世界坐标 × 画布在屏幕上的缩放"。
  组件每次用到时现问，座位挪了、窗口变了都跟得上；窗口尺寸变了它自己 `refresh()`，游戏重排头像后也调一次。
- **气泡位置**（0.18.2）：先朝牌桌中间那侧放，再试另一侧、上、下，挑和"互动"按钮、各家名牌（`plate`）、别家头像、`avoid` 盖得最少的一个；
  纯函数 `placeBubble(anchor, w, h, view, avoid)` 在 `fun-logic` 里；聊天的版式（`chatMode`、`chatFont`、`danmakuLanes`、`pickLane`、`placeDock`、`barBottom`、`placeBeside`、`seatColor`，0.19.0）也在那里。
- **房间的编号数**：`RoomGame.emotes` 填 `funIdCount(PHRASES.length)`（短语 + 12 表情 + 8 道具）。
- **名场面**：游戏从**公开事件**里认出来，调 `fun.moment({ kind: 'moment', moment: 'bomb', winners: [0], losers: [1, 3], hand: 第几手 })`，
  单机时电脑按性格冲赢家撇嘴、或得意一下；要横幅就 `fun.banner('炸弹！', '小王 炸了 老李')`。
- **游戏自己的弹窗**：打开前 `fun.hide()`，关掉后 `fun.show()`（正在播的不中断）；离开牌桌 `fun.destroy()`。
- **冒烟**：`fun.controls()` 给每个能点的东西的屏幕中心和大小（`fun:button`、`fun:seat<i>`、菜单里的 `fun:prop<k>`、`fun:named<k>`、`fun:block`、
  表情菜单 `fun:sticker<k>`、面板 `fun:tab:phrase|sticker|prop`、`fun:phrase<i>`、`fun:psticker<k>`、`fun:pprop<k>`、`fun:target<i>`、`fun:blockAll`）；
  `log` 选项给一行行流水（`道具 0>1:tomato ×2 回敬`、`电脑 1:angry`、`护盾 1`、`提示 头像`），断言用它。
- 演示页 `demo/table-fun.html`（`npx vite` 后打开 `/demo/table-fun.html`）：我加三个不同性格的电脑，单机接法。

### 房间里的电脑（好友房）

纯逻辑在 `arcade-kit/fun-logic`（不碰 DOM，房间、测试都能 import；`table-fun` 也把它全部转出）：

```ts
import { botReact, botEmoteIds, hitEvent, newBotState, type BotState } from 'arcade-kit/fun-logic';

private bots = newBotState();                    // 只在内存里，不写存储；房间重启丢了没关系
protected override onEmote(from: number, id: number, to?: number): void {
  const ev = hitEvent(id, PHRASES.length, from, to);            // 冲人来的道具、点名短语才算
  if (!ev || !this.isBot(ev.to)) return;
  const a = botReact(ev, { seat: ev.to, temper: temperOf(ev.to) }, this.bots, Date.now(), Math.random);
  if (a) for (const e of botEmoteIds(a, PHRASES.length)) this.botEmote(a.from, e.id, e.to);
}
```

- 房间只有一个闹钟，`a.delay` 不用等，立刻发；页面上的 `TableFun` 收到电脑座位（`bot: true`）发来的东西会晚 0.9 秒再播，
  表情自动配一句话（`moodLines` 或 kit 默认），看起来和单机的电脑一样。名场面同理：在 `onStep` 里从公开事件认出来，每个电脑座位问一次 `botReact`。

- `botReact(事件, 电脑, 状态, 现在, 随机数, 参数?)` 返回 `null`（不理）或 `{ from, to?, delay, sticker, mood, prop? }`：被扔后 60% 回应（乘性格：爱闹 ×1.5、普通 ×1、高冷 ×0.3），
  其中四分之一同类回扔（鸡蛋回拖鞋；同一个电脑 20 秒最多回扔 2 次）；名场面输的一方 40% 冲赢家、赢的一方 30% 得意；每手最多主动 2 次；两次反应至少隔 1 秒。
  数字都在 `BOT_REACT`，第六个参数能整个换掉。
- 电脑的反应只是画面，**出牌决策绝不读它**；真人的短语、道具不记进牌局状态（见上面 `onEmote` 的规矩）。
- 其他纯函数：`stickerMood`（表情对应的情绪）、`FunCooldown`（冷却）、`FunTally`（护盾、连击、回敬）、`placeMenu`（菜单放哪，避开禁区；窄屏按 `fitMenuWidth` 收窄到屏幕宽减 16px，0.11.2）、`funItem`/`stickerId`/`propId`（编号换算），测试在 `test/fun-logic.test.ts`。

## 好友房聊天（chat，0.18.0）

设计和取舍见 [docs/chat.md](docs/chat.md)（主线 2026-10-17 审过）。只在好友房、入座的真人能说，一条 ≤ 30 个字；房间过滤、限速后只转发，**不写存储、不进快照、不进任何记录**，房间散了就没了。

- 房间：游戏的 `RoomGame` 写 `chat: true`（可选 `chatWords` 加打码词，删不了 kit 的）。限速 `chatMs`（默认 3000）、`chatPerMin`（默认 10）在 `RoomLimits`，`KIT_QUOTA` 里能改。
  真人说的话不交给规则、`onStep`、`onEmote`，电脑不读、不回自由文字。
- 页面：`new RoomClient({ ..., onChat: (seat, text, masked) => fun.chat(seat, text, masked), onChatError: (code) => fun.chatError(code) })`，
  `TableFun` 传 `chat: (text) => client.chat(text)` 和设置里的 `chatEnabled: () => …`（"聊天：开 / 不看"，和"互动"分开）。
  传了 `onChat` 连接才带 `chat=1`，房间只给这样的连接发（旧页面不认识这条消息），所以不加 `PROTOCOL_VERSION`。
- `client.chat(text)` 先在本地过一遍和房间一样的检查，不行直接返回原因（`chatRejectText(code, why)` 给说法）：链接"不能发链接"，号码"不能发号码，金额请写成 1,000,000"——
  标准千分位的金额（≤ 10 位）放行；太快的带 `waitMs`，"发送"按钮倒计时。
- 界面（0.18.0 的样子，0.19.0 的改动见下面）：头像旁冒 4 秒气泡（能折行，同一个人后一条顶掉前一条）；"互动"面板多一个"聊天"页：最近 30 条（只在内存里）、输入框（16px，iOS 不放大页面）和"发送"，回车发；
  键盘弹出时按 `visualViewport` 把面板挪到键盘上面；收起时有新消息，"互动"按钮上一个小红点。被屏蔽（单个、全部）的人说的不显示。
- 平台的屏蔽名单（`docs/social.md` 3.1）要平台出一个 RPC，出了以后 kit 小版本接上（docs/chat.md 第 6 节，主线定的 B 方案）；现在只有 kit 的本地屏蔽。
- **单机也能聊**（0.18.1）：`localChat(say, opts?)` 返回一个和 `client.chat` 一样用法的发送函数（结果同是 `ChatSendResult`），过同一套过滤和限速（默认 3 秒一条、一分钟 10 条，`words`、`ms`、`perMin` 可改），
  行就调 `say(打码后的字, masked)`。只在本机显示自己说的，不发到任何地方、不存；电脑不读、不回。接法：`const send = localChat((t, m) => fun.chat(mySeat, t, m)); new TableFun({ ..., chat: send })`。
- **0.19.0 聊天打磨**（`docs/chat.md` 第 5 节）：电脑上牌桌一角常驻聊天框（记录、快捷短语、输入框，可收起），手机上"互动"旁边一个"聊天"按钮（未读红点）+ 贴在手牌上面的输入条；
  所有人说的话从右往左飘弹幕（"弹幕：开 / 关"，默认开，减少动态效果或省内存时默认关）；气泡按屏幕放大（电脑 18–22px、手机 ≥ 15px），最多两行，停 5 秒。
  游戏不改代码就能用；要摆得准，给这几个（都可选）：

  ```ts
  new TableFun({
    ...,
    seats: () => view.seats.map((s, i) => s && ({ rect: avatarRect(i), plate: plateRect(i), name: s.name, me: i === 0 })),  // plate：名字和筹码那块，气泡、弹幕、聊天按钮都避开
    center: () => [potRect(), wallRect(), discardRect()],   // 牌桌中间的信息区（剩余张数、底池、牌墩、弃牌区）：弹幕不横穿、聊天框和气泡不压
    chatDock: () => ({ left: 24, top: tableTop + 12, width: 340, height: 0 }),  // 电脑版聊天框放哪（只用 left/top/width）；不给就自己挑角，可能压到牌墙
    chatFolded: () => true,  // 可选（0.20.1）：玩家没点过收起/展开时默认收着（给了 chatDock 也生效）；不给就是放不下才收
    chatButton: () => chatButtonRect(),                      // 手机版"聊天"按钮放哪；不给就挨着"互动"按钮，挤的牌桌（手机横屏）最好给
    danmakuArea: () => tableUpperHalf(),                      // 弹幕区；不给是屏幕 8%–58%，上沿压到对家那排名牌下面
    lite: () => settings.lowmem,                              // 省内存模式：弹幕默认关
    prefsKey: 'mygame.chat',                                  // 弹幕开关等存在哪；默认 '<storageKey>.chat'
  });
  settingsRow('弹幕', fun.danmaku(), (on) => fun.setDanmaku(on));  // 游戏设置里接同一份开关（可选）
  ```

  冒烟用的 `controls()` 多了：电脑版 `chat:dock`、`chat:input`、`chat:send`、`chat:phrase<i>`、`chat:danmaku`、`chat:more`、`chat:fold`（收起后是 `chat:open`）；
  手机版 `chat:button`、`chat:bar`、`chat:input`、`chat:send`、`chat:phrase<i>`、`chat:history`、`chat:close`；面板聊天页多一个 `fun:danmaku`。`log` 多 `弹幕 开|关`、`聊天 输入条`。
- **互动按钮的尺寸参数**（0.18.2）：`buttonStyle: () => ({ scale: stageScale, row: true })`，字（13px）和图标（22px）一起按 `scale`（≥ 1）放大，`row` 横排；
  0.20.1 起可以直接给 `fontSize`、`icon`（像素，优先于 `scale`）。手机的"聊天"按钮照同样画。
  用它替掉游戏自己对 `.atf-btn` 的 CSS 覆盖；不传就不写行内样式，旧的覆盖照样生效（迁移不急）。
- 演示页 `demo/table-fun.html` 里能直接试：右上聊天框打字，"电脑们说几句"看弹幕排轨道（单机演示，右家隔一秒回一句）。

## 快速匹配（match，0.20.0）

同一个游戏、同一个档位的人排在一起，凑满一桌立刻开，最多等 15 秒：到点 ≥ 2 个真人就开（空位电脑补），只剩自己就转本机单机。设计和边界见 [docs/match.md](docs/match.md)。

Worker 里加一个排队类、一条路由（`wrangler.jsonc` 加 DO 绑定 `MATCH` 和迁移 `new_sqlite_classes`，不新建 Worker）：

```ts
import { MatchQueue } from 'arcade-kit/match';
import { acceptMatch } from 'arcade-kit/worker';

export class Queue extends MatchQueue<Env> {
  protected readonly seats = 4; // 一桌最多几个真人
  // 按档位不同的：tableSize(tier)、roomOptions(tier)（开桌带的开局选项，房间照常用 RoomGame.options 校验）
}

// fetch 里：
const m = /^\/games\/mygame\/match\/([a-z0-9-]+)$/.exec(url.pathname);
if (m) return acceptMatch(request, env, m[1]!, { tiers: ['fun', 'real-1'], siteOrigin: env.SITE_ORIGIN });
```

页面：

```ts
import { MATCH_TEXT, MatchClient } from 'arcade-kit/client';

const mc = new MatchClient({
  url: `${wsBase}/match/${tier}`,
  onWaiting: (n, seats, leftMs) => showQueue(n, seats, leftMs), // 人数变了才推，倒计时页面自己走
  onMatched: (code) => enterRoom(code), // 照常 new RoomClient 进房；room.match 为 true 时藏起房间码、邀请、"开打"
  onHasRoom: (code) => enterRoom(code), // 已经有开着的房间
  onSolo: (why) => playSolo(tier, MATCH_TEXT[why]), // 只剩自己、今天局数用完、联机忙……转单机
});
mc.start(); // "取消""不等了"都是 mc.cancel()
```

- 档位配置在游戏自己的测试里查一遍：`expect(matchConfigErrors(game, tiers, tableSizeOf, roomOptionsOf)).toEqual([])`（`arcade-kit/game`），对不上的话线上每桌都会转单机。
- 房间不用改：匹配桌是普通的 `GameRoom`，排进来的人建房时已经坐好，人到齐（或等满 `RoomLimits.matchJoinMs`，默认 20 秒）自动开打，没来的电脑代打、来了交还；
  只有排进来的人能进（别人 4004），`start` 回 `not_host`。两个真人要坐特定座位（比如对家）的，房间类覆盖 `matchSeats(n, count)`。
- 额度：每张匹配桌每个真人占一个开房名额，和好友房共用 `dailyRoomsPerUser`（默认每天 6 个，游戏 `vars.KIT_QUOTA` 里改）；入队前就问计量，用完了直接 `solo: daily_limit`。
- 陌生人聊天：房间不用为匹配改，页面按设置"和陌生人打字聊天"（默认开）决定带不带 `chat=1`。平台的屏蔽名单（`ARCADE.blockedAmong`）由排队自动用，屏蔽过的人排不到一桌。

## 分享卡和邀请（share、social，0.12.0）

规范是仓库根 `docs/social.md` 1.1–1.3。两个入口都只在调用时碰 DOM，import 时不碰；纯的部分测试在 `test/share.test.ts`、`test/social.test.ts`。

### 分享卡

游戏只交数据，画法统一（主题色渐变底、图标、游戏名、一个大数字、最多 3 条小数据、一句名场面、昵称和称号、北京时间日期、右下角扫码来玩的二维码）：

```ts
import { shareCard } from 'arcade-kit/share';

const r = await shareCard(
  {
    game: '游戏名', title: '实盘小档 · 8 副', accent: '#b03a2e',
    big: { value: '+3.5', label: '份筹码' },
    stats: [{ label: '头游', value: '4 次' }, { label: '炸弹', value: '6 个' }],   // 最多 3 条，多的不画
    line: '最后一手四个 A 炸穿全场',                                               // 模板拼的，不收玩家自由文字
    art: { image: atlasImg, crop: { x: 128, y: 0, w: 128, h: 128 }, fit: 'contain' },
    player: { name: '小明', badge: '炸弹狂人' },
  },
  { url: './?room=123456' /* 只取路径，域名用运行时的 origin；好友房结算带房间码 */, log: (l) => smokeLog.push(l) },
);   // 'shared' | 'preview' | 'cancelled'
```

- `art` 可以直接给一个 `CanvasImageSource`（img、canvas、ImageBitmap），或者 `{ image, crop?, fit? }` 从图集里切一块（`crop` 是源图像素，`fit` 默认 `contain`，`cover` 铺满裁中间）。
  是 img 时先 `await img.decode()`，没加载完、坏图、跨域画不上都**不画 art、照常出卡**。
- **系统分享只给手机、平板**（0.15.1，`useSystemShare(ua, maxTouchPoints)`）：UA 带 Android、iPhone、iPad、iPod、HarmonyOS、Mobile，或者 Macintosh 且多点触控（iPadOS 默认报桌面 UA）才调；
  Windows、Mac、Linux 桌面（含触屏笔记本）一律直接出预览：Windows Chrome 的 `canShare` 对文件回 true，弹出系统共享，选微信后微信 PC 版是空白窗口、再报"共享失败"。
  桌面的预览第一个按钮是"复制图片"（`navigator.clipboard.write` + `ClipboardItem` 的 `image/png`，浏览器不支持就不摆），成功提示"已复制，去微信里粘贴"；按钮顺序：复制图片、保存图片、复制链接、关闭。
- 系统分享要 `navigator.canShare({ files })` 为真（手机浏览器）；不支持、或出错（用户取消除外）就出预览层：图 + "保存图片"（下载 `share.png`）+ "复制链接" + "关闭"。
  预览层 z-index 默认 11000（0.12.4 起），按钮的 `data-key` 是 `share:copy-image`（0.15.1，桌面）、`share:save`、`share:copy`、`share:close`，冒烟点这些；`log` 给 `分享 系统`、`分享 预览`、`分享 复制图片`、`分享 保存`、`分享 复制`。
- **结算页一出现就先画好**（0.12.3，iOS 必须）：iOS 只许在点击的那一下里调系统分享，点了再画就过期了、只能出预览。结算页出来时 `const p = prepareShare(card, opts)`，
  "分享"按钮的点击里直接 `void p.share()`（前面别 await）：画好了就同步调 `navigator.share`，没画好等画完再试、调不起来出预览。`shareCard` 是"点了才画"的简写。
- **二维码**（0.15.0）：朋友圈里的图不能点，扫码是唯一入口。码的内容是 `shareLink(opts.url, location.origin)`：运行时的 origin 加上 `url` 的路径、查询和 `#` 后面，
  游戏给相对路径还是绝对地址都行，kit 和游戏都不写域名（单独部署的游戏扫出来就是它自己的 `workers.dev`）。系统分享、"复制链接"也用这个链接，系统分享的 `text` 末尾自动带上它（有的 App 只取 text）。
  码画在右下角的纯白框里（`#111` 的格、每格整数像素、四周留白 ≥ 4 格、下面写"扫码来玩"），名场面和日期往左让；JPEG 压缩、缩到三分之一宽的截图实测照样解得出。
  编码器是 `src/qr.ts`，自己写的最小子集（字节模式、纠错 M、版本 1–10，最长 213 字节，约 9 KB 源码），不引运行时依赖：kit 一个运行时依赖都没有，引一个就进每个游戏的 lockfile 和审阅范围。
  链接太长编不了码就不画码，卡照常出。测试用 jsQR（Apache-2.0，只是 devDependency，不进包）把码解回原文，再对格式信息、版本信息做规范表的已知向量核对。
- **微信内置浏览器**（0.15.0，UA 带 `MicroMessenger`）：没有 `navigator.share`，下载链接也常常不生效。检测到微信就不试系统分享，直接出预览：图用 `data:` URL（`blob:` 的图在微信里长按经常存不下来），
  提示"长按图片 → 发送给朋友，或保存后发朋友圈"，不给"保存图片"按钮（"复制链接""关闭"照旧）。判断在 `isWeChat`、`previewMode`（纯函数）。
- 只要图不分享：`drawShareCard(card, canvas?, link?)` 返回画好的 canvas（给了 `link` 才画码），`shareCardBlob(card, link?)` 返回 PNG。
- **图上只有游戏给的数据**：别人没摊的牌、手牌这类隐藏信息游戏自己别放进来。

### 报位置、收邀请

```ts
import { mountSocial, sendInvite } from 'arcade-kit/social';

const social = await mountSocial({
  platform,                                         // 启动时 detectPlatform 的结果，不给就自己问一次 /api/me
  where: () => (room ? { place: 'room', game: 'mygame', room: room.code, seats: `${room.humans}/4` } : { place: 'game', game: 'mygame' }),
  gameName: (id) => GAME_NAMES[id],                 // 横条上"老王叫你来<名字>"；kit 不认识任何游戏，不给就说"一起玩"
  onGo: (inv) => confirmLeave(() => location.assign(`/games/${inv.game}/?room=${inv.room}`)),   // 可选：打到一半先确认
});
// 没平台、没登录：social 是 null，一个请求都不发
social?.presenceNow(true);                          // 进房、换房时马上报一次
```

- 页面在前台时每 2 分钟 `POST /api/presence`（`where()` 现问，返回 null 这次不报），每 30 秒 `GET /api/invites`；切后台就停，回到前台到点马上补。平台回 401 就自己停。
- 横条在页面顶上（让出刘海），一次一条，先到期的先弹；过期的、已经在那个房间里的不弹。"去"先 `dismiss`（keepalive）再跳 `/games/<id>/?room=<码>`，
  "不了"`dismiss` 后弹下一条，到期自己收起。按钮 `data-key` 是 `invite:go`、`invite:no`；`log` 给 `位置 204`、`邀请 弹 <id>`、`邀请 去`、`邀请 不了`、`邀请 过期`。
- 发邀请 `sendInvite({ to, game, room })` → `{ ok: true, id }` 或 `{ ok: false, error: 'limit' | 'blocked' | 'login' | 'failed', retryAfter? }`（429 是每天 50 条、同一好友 1 分钟 1 条超了）。
  `fetchFriends()` 把平台每项的公开资料 `{ userId, displayName, avatar }` 统一成 `id`、`name`（原样字段留着），带 `online`、`where`（对方关了开关就没有），`setShowWhere(bool)` 改"让好友看到我在哪"。都带同源 cookie，写的请求带 `x-arcade: 1`。
- 报名场面（0.12.5，好友动态）`postMoment(game, moment, n?, n2?, n3?)` → `POST /api/feed`：只报编号和最多 3 个整数，文字由游戏的 `public/moments.json` 给模板
  （`{"double_down": {"text": "{name}和搭档双下了对面"}}`，只认 `{name}`、`{n}`、`{n2}`、`{n3}`，≤ 40 字）。返回 HTTP 状态，平台超了每天 10 条也回 204，游戏不用管；
  编号要字母开头、1–24 位 `[a-z0-9_]`，不合格的本地就不发（回 400）。只在真有看头的时候报（一局一两条），平台每人每天 10 条是所有游戏合计。
- **"叫朋友来"面板**（0.12.2）：`social.openInvite({ game, room })`（`social` 是 `mountSocial` 的返回值；没挂上时用导出的 `openInvite({ game, room, friends: false })`，只有"复制邀请链接"）。
  列好友（在线的在前，写在哪），每人一个"叫他来"，发出后 1 分钟内是灰的"已叫"，叫不了的写成大白话；底下"复制邀请链接"（能系统分享就分享）。
  样式和 table-fun 一样，z-index 默认 10600（0.12.4 起；游戏自己的弹窗更高时传 `zIndex`）；好友"在哪"先用平台给的 `where.gameName`，没有再用 `gameName` 回调，都没有说"在玩游戏"；按钮的 `data-key` 是 `invite:call:<好友 id>`、`invite:copy`、`invite:close`，`log` 给 `叫人 打开 <n>`、`叫人 <id> ok|limit|blocked|…`、`叫人 复制`、`叫人 关闭`。
- 演示页 `demo/share.html`、`demo/social.html`（`npx vite` 后打开；社交用假 fetch，一进来就有几条邀请）。

## 主题（theme，0.16.0）

kit 的 DOM 组件（分享预览层、邀请横条、"叫朋友来"面板、牌桌互动的菜单和面板）的颜色、圆角、字体都走 CSS 自定义属性 `--ak-*`，每处写成 `var(--ak-xxx, <原来的值>)`：
**不传主题，外观和 0.15 完全一样**（`test/theme.test.ts` 扫源码守住：每个 `var(--ak-` 都带默认值）。`fun.ts` 的飞行道具图层只画素材，没有可换的样式，不在里面；分享卡本身（canvas 画的那张图）也不受影响，它的颜色由游戏给的 `card.accent` 决定。

| 变量 | `KitTheme` 字段 | 用在哪 | 默认值（随组件不同时写主要的） |
|---|---|---|---|
| `--ak-bg` | `bg` | 面板、菜单、邀请横条的底色 | 面板 `rgba(43,29,20,.96)`，横条 `rgba(28,28,32,.94)` |
| `--ak-fg` | `fg` | 面板和横条上的文字；分享预览的字、次按钮的字和边 | 面板 `#fff6e0`，横条和分享预览 `#fff` |
| `--ak-accent` | `accent` | 主按钮底色：横条的"去"、面板的"叫他来"、互动菜单的主按钮、分享预览的主按钮 | 面板 `#7a2a1e`，横条 `#f5c542`，分享预览 `#fff` |
| `--ak-accent-fg` | `accentFg` | 主按钮上的字 | 面板 `#fff6e0`，横条和分享预览 `#222` |
| `--ak-border` | `border` | 面板、菜单、按钮的边框 | 面板 `#d4a64a`，面板里的主按钮 `rgba(212,166,74,.6)`，分享预览按钮 `#fff` |
| `--ak-radius` | `radius` | 面板、菜单、横条、气泡、分享预览图的圆角 | 面板 `14px`，横条 `28px`，预览图 `16px` |
| `--ak-radius-btn` | `radiusBtn` | 按钮、头像格、好友行的圆角 | 按钮 `22px`（分享预览 `24px`），格子和行 `10px` |
| `--ak-font` | `font` | 字体（font-family 的值） | 继承页面；分享预览和横条是 kit 自带的中文字体栈 |
| `--ak-overlay` | `overlay` | 分享预览、"叫朋友来"面板背后的遮罩 | 预览 `rgba(0,0,0,.72)`，面板 `rgba(0,0,0,.5)` |
| `--ak-soft` | `soft` | 次按钮、头像格、好友行、"互动"按钮的底色 | 面板 `#4a3220`，横条的"不了" `rgba(255,255,255,.14)` |
| `--ak-title` | `title` | 标题、✕、飘字、横幅这些金色强调字，转圈的亮边 | `#f3d98b` |

没有主题化的：状态色（灰掉的按钮、"开着""选中"的绿红）、被扔的污渍和道具的素材、气泡的米色底（`#fffaf0`）、名场面横幅的红渐变，这些随游戏换意义不大，需要时再加。

两种用法，可以混着用（组件根节点上的变量盖过页面 CSS 里的）：

```ts
// 1. 传 theme：每个组件的选项里都有（ShareOptions、SocialOptions、InvitePanelOptions、TableFunOptions）
import type { KitTheme } from 'arcade-kit/theme';
const theme: KitTheme = { bg: '#1b120b', fg: '#f4e9d3', accent: '#e0b43c', accentFg: '#2a1a08', border: '#e0b43c', radius: '4px' };
new TableFun({ /* ... */ theme });
prepareShare(card, { url, theme });
const social = await mountSocial({ where, theme });   // social.openInvite(...) 打开的面板默认也用它，面板自己传 theme 则以面板的为准
```

```css
/* 2. 或者在自己的 CSS 里写变量，靠继承生效（kit 组件都挂在 body 下） */
:root { --ak-bg: #1b120b; --ak-fg: #f4e9d3; --ak-accent: #e0b43c; --ak-accent-fg: #2a1a08; --ak-radius: 4px; --ak-font: Georgia, serif; }
```

`themeVars(theme)` 是纯函数，返回 `[变量名, 值][]`；值必须是字符串，含 `;` `{` `}` `<` `>` `\`、`/*`、`url(`、`expression`、`@import`、`javascript:` 或超过 200 字的字段整个忽略，其他字段照常。游戏要自己的组件也用这套变量时可以直接用 `themeVars` / `applyTheme`。
演示页加 `?theme`（如 `/demo/table-fun.html?theme`）看深色木纹 + 金色强调的样子。

## 搭子战绩（reportTogether，0.13.0）

好友房打完一场，房间的服务端把同桌真人和各自输赢报给平台（`docs/platform-backend.md` 15.19），平台给其中已经是好友的每一对累计"一起打了几场、谁赢了几场、做搭档几场"。
只走钱包服务绑定 `WALLET` 的 `together()`，浏览器碰不到；娱乐、实盘都报，单机不报。

```ts
import { GameRoom } from 'arcade-kit/room';

export class CardRoom extends GameRoom<State, Action, View, Env> {
  protected override onStep(s: State): void {
    // 一场刚分出输赢的那一步报一次；"一场"和 win 怎么算由游戏定，写进 DESIGN
    if (justEnded(s)) this.reportMatch([0, 1, 2, 3].map((seat) => ({ seat, team: seat % 2, win: seat % 2 === s.winner })), s.matchNo);
  }
}
```

- `reportMatch(players, match)`（`GameRoom` 的 protected 方法）：players 按座位给，按开打后绑在座位上的人（`owners`）认 userId，没绑真人的座位（电脑）不报；
  `match` 是这一场在房间里的序号，op 拼成 `<房间码>-<开房时刻>-<match>`（`togetherOp`）——房间码会被别的房间重用，带上开房时刻才不会撞；同一场重报给同一个 match，平台按 op 去重。
  交给 `ctx.waitUntil` 去办、不 await：`onStep` 是同步的，不能卡住广播；也不走 `effects`/`perform`，那条路会退避重试、要写状态，而这件事平台忙（`busy`）时少记一场就算了。
- `reportTogether(env, op, players)`：底下那个函数，自己拼 userId 时直接用。没有 `env.WALLET`（单独部署）或它没有 `together` 时跳过；去重后少于 2 人、多于 8 人、op 不是 8–64 位 `[A-Za-z0-9_-]` 时跳过；
  回话原样返回（`{ ok: true, pairs }` 或 `{ ok: false, error }`），RPC 抛错吞掉、只记错误类型（不记 userId），都**不重试**。
- `team` 只有分队的游戏带（同一个数字是一队，0–3）；`win` 由游戏定、写进游戏自己的 DESIGN（分队的按这一场赢的那队，按分算的按这一场分数为正，平台 15.19 列了几种）。
- 测试：`arcade-kit/testing` 的假钱包有 `together`，形状照平台查、按 op 去重，每个人的 `FakeBank.together` 记一笔给测试核对（假钱包不管好友关系，两两都算一对）。

## 房间怎么守规矩

- **只用 `ctx.acceptWebSocket`、一个闹钟**：所有到期时间（房间寿命 3 小时、没人 10 分钟、这一手 30 秒、掉线宽限 60 秒、电脑没算完、停够了（0.5.0））取最早的；
  只有比现在设的更早才 `setAlarm`（它也算一行写入），期限往后推时不动，到点醒来没到期再改。心跳 `ping`/`pong` 由运行时自动应答。
  闹钟时间以 `getAlarm()` 读到的为准；写完状态后广播出错，算好的闹钟照样设；闹钟里游戏代码出错，60 秒后再醒来重试。
  `setAlarm` 自己出错（0.11.1）不往外抛：内存里记的闹钟改回"不知道"，下一个入口重新 `getAlarm()`、照常重排；出错的是闹钟里那一次，同样 60 秒后再醒来。
- **每步最多写 2 行**：房间状态一行（到期时间、计数都在里面），外加需要时的 `setAlarm`。实测：
  - 开房 4 行：建表 2 行（SQLite 记建表也算写入，一个房间只这一次）+ 状态 1 行 + 闹钟 1 行；
  - 进房、出牌 1 行；到点醒来但还没到期只改闹钟 1 行；
  - **状态没变不写**：没入座的人进出、在线时又从别的设备连进来，都是 0 行、不广播。只连着没入座的人也算"没人"，他们不能让房间一直活着；
  - 探一个不存在的房间码：0 行，不建表，存储里什么都不留（构造函数和读路径都不碰存储）。
  测试里每个用例都断言 ≤ 2（开房除外，如实断言 4）。
- **服务端说了算**：开局的 256 位熵用 `crypto.getRandomValues` 在房间里生成、只交给 `begin` 这一次、房间不存，规则在房间里算，下发前按座位过滤；userId、房主是谁都不下发。
  0.1.0 不记回放（没有地方读它，关房时也会删）；以后做终局导出时再加，带体积上限。
- **续局**：接受连接、发快照、记座位在同一段没有 `await` 的代码里；只向收到过快照的连接广播；广播在设闹钟之前。
  - 断线时座位留着；轮到他时 30 秒到了按 `timeout` 代出；掉线 60 秒后电脑托管；连回来交还。
  - 重连**不重置**这一手的 30 秒（不然隔 29 秒重连一次就能一直拖着）；只有托管被收回、又正好只轮到他一个人时才从头算（一组人时不改整组的期限）。
  - 超时代出：先用游戏的 `timeout`，被规则拒了改用 `ai`；还不行就记日志、这一手的期限推后 60 秒（不然闹钟会在当前时刻反复响、每次写一行）。
  - 同一个账号再连一次，旧连接 4001 让位。重连一律发全量快照，不补发漏掉的事件。
  - 客户端重发没确认的操作带原来的 `baseSeq`：牌局变过就回 `stale`，旧操作不会被套到新的一手上。有人进出不算牌局变了。
  - 重复的 moveId 每个座位记最近 8 个（0.11.1，和座位一起存在状态那一行里，不多写）：连发 A、B 时 A 的 ack 丢了，补发 A 仍然只回 ack，不轮流的操作不会做第二遍。
- **硬限制**（4.6）：
  - 单条入站消息 4 KB（1009）；每人每秒 5 条、最多攒 10 条（1008；0.14.0 起按人记，断开重连、多开标签页都还是同一个桶）；房间一生 3,000 条入站消息；寿命 3 小时；没人 10 分钟——到了就关房间：
    断开所有人（4000）、删闹钟、删存储；
  - 没入座的最多 4 个账号（4003）；入座的人、房主、开打后绑过座位（离座去看）的人不占这个数，也不受它限，旁观的再多也挡不住座位的主人回来；
  - 每人一生最多 300 次"掉线后回来"（只数会写库的那种，4029）。按 userId 记，只管他自己，别人刷不光，离座再坐下也不清零；
    这些重连同时算进房间一生的 3,000 条入站额度，所以房间一生的写入总数有上限。没入座的人进出不写库，不受这个管；
  - 一个人最多用掉房间入站额度的 `maxInboundShare`（默认四成，1,200 条）：超了只断开他（4030），以后也进不来，房间和别人照常；
  - 入站额度用完关房时，日志里记下发得最多的那个 userId 和条数（不记消息内容），方便事后查；
  - 每个入口都包一层，游戏代码抛错只记日志；闹钟里不往外抛（会自动重试 6 次，每次都计费）。
  - 闹钟设不上（0.13.1）：当场再试一次；还不行就按 `getAlarm()` 核对，存储里没有闹钟就补一个 60 秒后的（顶替没写成的那次，不多算一行）；
    补也补不上时，浏览器的 `RoomClient` 看门狗兜底：房间说的时限（按消息里房间给的 `now` 算，不看浏览器的钟）过了 20–30 秒还没有新状态，就重连一次，
    进房这个入口会让房间重排闹钟、把过期的那一手照常处理；同一个 seq 只踢一次。
- **座位绑人**（0.1.1）：开局时记下每个座位坐的是谁。开打后坐过某个座位的人只能回这个座位；没坐过的人只能接管没绑人的电脑座位，接管后绑给他；
  绑给别人的座位（主人离座了也算）谁也接管不了，电脑一直替主人打，主人回来照样能坐。一个 userId 一局只对应一个座位，所以离座、换到对手座位看牌、再回来这条路走不通；
  也不能由同伙先占掉你的原座位、把你变成"没绑座位"的人。0.1.0 存下的已开打房间读出来时，电脑座位一律算已绑（旧格式看不出谁离过座）。
- **只有房主能开局**（9.1）：房主是开房的人，别人发 `start` 回 `not_host`。
- **认人**：第一版不做 Ed25519 入场票。进房时游戏 Worker 经服务绑定问一次平台 `/api/me`（只转发 Cookie 和 cf-connecting-ip，3 秒超时），
  拿不到身份就拒绝。请求里根本没有平台的会话 cookie（`__Host-sid`，名字只在 `src/internal.ts` 定义一处）就直接 4401，不问平台。现在只有一个游戏、好友小范围开房，多问的这一次不贵，也不用管签名密钥；等开房要走平台登记和配额（5.3）再换入场票。
  - "没登录"（200 且 user 为 null）和"平台暂时不可用"（其他状态码、不是 JSON、缺字段、超时、没有绑定）分开：两种都拒绝（fail-closed），
    前者 4401 不重连，后者 1013 让客户端稍后重连，平台抖一下不会把正在打牌的人踢走；
  - 身份只经 `acceptJoin` 拼的内部请求（主机名 `KIT_HOST`）交给房间；房间不认别的地址，游戏把浏览器的原始请求转进来会被 400 拒掉，
    浏览器自己带的 `x-kit-user` 头不会被当真。开房走 RPC，身份是参数。
  - 每次进房（含被房间拒掉的）都要问平台一次：进房额度和连接上限管住了写库和广播，但管不住这次 `/api/me`，要靠平台自己的限流；换入场票后这次调用就没了。

## 每天的额度（0.2.0）

免费版 Durable Object 每天整个账户 10 万行写入（docs/platform-backend.md 4.7），所有游戏共用，UTC 0 点重置。每个游戏 Worker 有一个计量 `RoomMeter`
（全局只有一个实例），房间自己数写了几行报给它，开房先向它占名额：

| 门槛（`KIT_QUOTA` 里的字段） | 默认 | 到了以后 |
|---|---|---|
| `roomsPerUser` | 1 | 这个人再开房回 409 `has_room`（带开着的那个房间的码） |
| `dailyRoomsPerUser` | 6 | 这个人今天再开房回 429 `daily_limit` |
| `dailyRooms` | 300 | 全站今天不再开房，503 `busy`（最后一道闸） |
| `busyWrites` | 60,000 | 不开新房（503 `busy`）、不进新人（4503）；在打的照常打完，房主、坐过的人、已经连着的人照常进 |
| `stopWrites` | 85,000 | 在打的房间走到 `breakPoint`（这一副打完）时收场：把这一步发给大家，再以 4000 + 原因 `quota` 关房；等人的、已经打完的马上关 |
| `emoteMs`（0.7.0，房间读） | 1000 | 快捷短语每个座位多少毫秒补 1 个令牌，0 不限速 |
| `emoteBurst`（0.7.0，房间读） | 3 | 快捷短语每个座位最多攒几个令牌 |
| `joinMissesPerUser`（0.14.0） | 20 | 这个人这一小时进房时"码不存在"到了这么多次：进任何房间都回 1013（房间在不在都一样），只有这个房间的自己人（房主、坐着的、开打后绑过座位的）照常进 |
| `joinMissesPerIp`（0.14.0） | 60 | 同一个 IP 这一小时的"码不存在"次数，到了同上（一个 IP 后面可能是一家人、一个宿舍，放宽些） |

- **改门槛**：在游戏的 `wrangler.jsonc` 里写 `"vars": { "KIT_QUOTA": { "busyWrites": 50000 } }`（对象或 JSON 字符串都行），只写要改的字段，部署后生效；
  不认识的字段、不是非负整数的值记日志后忽略，用默认值。门槛按每个游戏各算各的，有几个联机游戏就要分一分（见下面"多个游戏怎么分额度"）。
- **名额什么时候还**：整场打完（`over`）、房间关掉（没人、到寿命、消息总数到了、收场）时房间去还。还不上（计量连不上、房间被驱逐时出错）也不会一直卡住：
  每个名额记着"开房时间 + 房间寿命 + 1 分钟"，到点自动作废。房间打完了但还开着的时候还没还上的，下次有事件（重试间隔 60 秒）接着还。
- **怎么报写入**：房间每一步都数自己写了几行（`setAlarm`、关房也算），攒够 `RoomLimits.meterBatch`（默认 200）行报一次，打完、关房时把剩下的随还名额一起报。
  计量每报一次写 1 行，200 行一报摊下来多花 0.5%；开房（这个人一行、当天一行）、还名额（同样两行）另算，也都记进当天的数。
  没报的数随房间那一行一起存，被驱逐后接着数；被驱逐前刚报过、还没存下去的那一批会再报一次，偏保守。房间跨 UTC 0 点报上来的记在新的一天。
- **计量连不上**：不开新房（503 `unavailable`）、不进新人（1013，客户端过会儿自己重试）；在打的照常，报不上的攒着，60 秒后再试。
- **进房猜码**（0.14.0，第三轮审计）：房间码只有 6 位，不限的话能一个个试出谁开着房、进去旁观或坐空位。`acceptJoin` 按人、按 IP 数"码不存在"（计量类的小实例 `kit-miss:u:<userId>` / `kit-miss:ip:<地址>`，每次各写 1 行、再报进当天的数；没绑 `METER` 不管，没有 `cf-connecting-ip` 只按人）。超了门槛不直接拒，而是带一个内部头进房，由房间判断是不是自己人：自己人照常进，别人一律 1013，这样超限的人说不出房间在不在，在打的人断线重连也不受牵连。计量连不上时同样处理。每次进房多问一次小实例（只读）。
- **房间怎么知道门槛**：每次报数、还名额时计量顺便回现在的门槛；有新人来进房时房间也会问（记 30 秒，只读不写）。所以 stop 以后在打的房间最晚再写一批（≤ 200 行）加上这一副剩下的才收场，
  按同时最多二三十个房间算，8.5 万离 10 万还有余量。
- 名额只按游戏算：同一个人在两个游戏里可以各开一个房间。

### 多个游戏怎么分额度

各游戏的额度在自己的 `wrangler.jsonc` 的 `KIT_QUOTA` 里，总账见仓库根 `docs/platform-backend.md` 4.7。

## 两种部署方式：平台模式和独立模式（0.10.0）

同一份游戏代码两种部署，**由 env 决定，不由代码决定**（`guest.ts` 的 `isStandalone(env)`）：

| | 平台模式（本站正式环境） | 独立模式（任何人单独部署一个游戏） |
|---|---|---|
| 条件 | 有服务绑定 `ARCADE`；或者写了 `GATE: "login"` | 没有 `ARCADE`，`GATE` 也不是 `"login"` |
| 认人 | 经 `ARCADE` 问平台 `/api/me`（`whoIs`），和 0.9 完全一样 | 游客 cookie：游戏 Worker 自己发，`userId` 是 `g:` 加 cookie 值的 SHA-256 前 128 位 |
| 首页 `loginGate` | 没登录 302 到 `/login`，平台不可用 503 | 放行，没有游客 cookie 就补发一个 |
| 开房 `acceptCreate` | 没登录 401 | 没有游客 cookie 就现发（回话带 Set-Cookie） |
| 进房 `acceptJoin` | 没登录 4401 | 没有游客 cookie 4401（进房不发 cookie，页面刷新首页即可） |
| 昵称 | 平台的 displayName | 地址上的 `?name=`，`cleanNickname` 清洗；不合格或没带是"游客"加 4 位数字 |
| 计量 `METER`、房间、协议 | 照常 | 照常（`KIT_QUOTA` 一样管额度） |

- **安全**：有 `ARCADE` 绑定时游客 cookie 一律不看（测试覆盖：本站带游客 cookie 开房 401、进房 4401、首页 302）。
  `GATE: "login"` 却没绑 `ARCADE`（部署工具漏了绑定）时**不退成游客模式**，按平台不可用拒绝（fail-closed）。同源检查两种模式都照旧。
- **游客 cookie**：https 下名字是 `__Host-kit-guest`（`HttpOnly; Secure; SameSite=Lax; Path=/`，约 400 天），值是 32 字节 `crypto.getRandomValues`。
  同一个站点下的几个游戏默认共用一个游客身份（和平台的一个账号一样），想分开就传 `guest: { cookie: '<游戏 id>-guest' }`，
  `loginGate`、`acceptCreate`、`acceptJoin` 三处要传同一个。http（`wrangler dev` 用局域网 IP 打开）下浏览器不收 Secure cookie，名字不带 `__Host-`、不带 Secure。
- **昵称**：NFKC 归一后只许字母（含汉字）、数字和空格 `_ - . ·`，1 到 12 个字；不能含保留词：kit 自带"电脑、机器人、游客、AI、bot……"（`RESERVED_NICKNAMES`），
  游戏把自己电脑人物的名字传进 `guest: { reserved: [...] }`。浏览器用 `withNickname(url, name)` 给开房、进房地址带上。
- **站点根路径**：独立部署到 `workers.dev` 时游戏仍挂在 `/games/<id>/`。Worker 入口最前面加
  `const root = standaloneRoot(request, env, '<id>'); if (root) return root;`，独立模式下 `/` 302 到 `/games/<id>/`，
  `/api/me` 回 200 `{ standalone: true }`（0.10.2，页面的 `detectPlatform` 认作没有平台，控制台不冒 404）；平台模式回 null，不管。
  这两个路径要先到 Worker：把 `"/"`、`"/api/me"` 加进 `assets.run_worker_first`。

**独立配置的 wrangler.jsonc**（游戏仓库里放这一份；本站正式部署时由维护者的部署工具补上 `ARCADE`、`WALLET` 和 `GATE: "login"`、路由）：

```jsonc
{
  "name": "<游戏 id>",
  "main": "worker/main.ts",
  "compatibility_date": "2026-10-01",
  "workers_dev": true,                    // 独立部署用 <name>.<子域>.workers.dev
  "assets": { "directory": "./dist-cf", "binding": "ASSETS", "run_worker_first": ["/", "/api/me", "/games/<id>/", "/games/<id>/rooms", "/games/<id>/rooms/*"] },
  "durable_objects": { "bindings": [{ "name": "ROOM", "class_name": "Room" }, { "name": "METER", "class_name": "RoomMeter" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["Room", "RoomMeter"] }]
  // 不写 services（没有 ARCADE、WALLET），不写 GATE
}
```

**页面怎么降级**：开局时 `const p = await detectPlatform()`（问同域 `/api/me`，默认 2.5 秒超时）：
- `{ platform: true, user }`：有平台，照常（`user` 为 null 是没登录）；
- `{ platform: false }`：404 或不是平台的 JSON，独立部署。藏起登录、云存档、排行榜、钱包（实盘），"回大厅"改成回游戏首页（`./`）；
- `{ platform: 'unknown' }`：5xx、429、断网、超时。平台可能只是抖了一下，按游戏自己的取舍（比如先按有平台、稍后再问一次）。

## 还没做的（以后按需加）

- 人机验证；跨游戏的统一房间登记（5.3）。开房名额现在由每个游戏的计量各管各的（上面"每天的额度"），开放注册前看一眼门槛够不够紧；
- Ed25519 入场票；观战（没入座的人现在能连、只看公开信息，最多 4 条连接）；
- 回放记录、终局导出；
- 用 `ctx.abort()` 强制正在打的房间换新代码；`cpu_ms` 要按各游戏的规则在房间里实测再定（4.4）；

## 本地开发

```bash
cd packages/arcade-kit
npm ci
npm test        # 类型检查 + vitest（本地 workerd 里跑真的 Durable Object、WebSocket 休眠接口和闹钟）+ 构建 dist 并检查每个入口都在、浏览器入口 Node 能直接 import
npm run build   # 只构建 dist/（tsconfig.build.json）
npm pack        # prepack 构建并把 exports 换成 dist 版，打出 arcade-kit-<版本>.tgz，postpack 换回来
```

测试用的游戏 Worker 在 `test/worker.ts`（一个最小的"比大小"规则；0.3.0 的可选接口用 `test/ledger.ts` 的"记账桌"和假银行测），平台的 `/api/me` 用假的服务绑定代替（`vitest.config.ts`），假钱包 `WALLET` 绑回测试 Worker 自己导出的 `WalletService`（`test/wrangler.jsonc`）。
测试里的站点一律是保留的示例域名 `game.example.com`。`demo/` 是一个能在浏览器里点的小例子。

## 部署

kit 自己不部署，也没有 Worker：发到 npm（`npm publish`，由维护者做；`publishConfig.access` 是 public），仓库内的游戏现在仍经 `"arcade-kit": "file:../../packages/arcade-kit"` 依赖源码，打包进游戏自己的 Worker 和页面。
CI 的 `pkg-arcade-kit.yml` 只跑测试；kit 改动时依赖它的游戏的流程也会跑一遍测试。用 kit 的游戏要准备这些（写在游戏自己的 `wrangler.jsonc` 里，整体部署见仓库根 README 的部署一节）：

- 绑定：`ROOM`（游戏的房间 DO）、`METER`（`RoomMeter`）、`ARCADE`（到平台 Worker 的服务绑定，`/api/me` 认人走它；独立部署不绑，见上面"两种部署方式"）；
- 变量：`GATE`（0.10.0 起有三种意思）：`"login"` 必须接平台（没绑 `ARCADE` 时 fail-closed）；`"off"` 本地开发不拦首页；不写时看有没有 `ARCADE`；
- 变量：`KIT_QUOTA`（可选，改每天的额度门槛，见上面"每天的额度"）；`SITE_ORIGIN`（可选，0.9.0）：Origin 只认这个站点。
  不设就认请求自己的 origin（游戏和平台挂在同一个站点下，浏览器从哪个站点打开、连的就是哪个），想更严的在部署时注入，再由游戏传给 `acceptCreate` / `acceptJoin` 的 `siteOrigin`；
- kit 里不写死站点地址：同站校验默认用请求的 origin，`/api/me` 按请求的 origin 拼地址、经 `ARCADE` 绑定去问。

## 目录结构

```
packages/arcade-kit/
├─ src/
│  ├─ room.ts        房间基类 GameRoom（Durable Object）
│  ├─ worker.ts      开房 acceptCreate、进房 acceptJoin、登录闸门 loginGate、json / readJson
│  ├─ auth.ts        经平台 /api/me 认人 whoIs、按部署方式认人 identify、同站校验 sameOrigin
│  ├─ guest.ts       独立模式：游客 cookie、游客身份、昵称清洗
│  ├─ match.ts       快速匹配的排队 MatchQueue（Durable Object，0.20.0）
│  ├─ meter.ts       每天的额度计量 RoomMeter
│  ├─ game.ts        规则接口 RoomGame、snapshotBytes
│  ├─ client.ts      浏览器连接器 RoomClient、createRoom、默认文案
│  ├─ protocol.ts    消息类型、关闭码、协议版本
│  ├─ rng.ts         ChaCha20 随机数
│  ├─ fun.ts、fun-art.ts  快捷短语、表情、道具的画面层
│  ├─ fun-logic.ts   牌桌互动的规则：冷却、护盾、连击、回敬、电脑反应、菜单位置（纯函数）
│  ├─ table-fun.ts   牌桌互动组件 TableFun（DOM：头像菜单、面板、提示、聊天页）
│  ├─ table-chat.ts  TableFun 里的聊天界面（0.19.0：电脑聊天框、手机输入条、弹幕、记录；不单独导出）
│  ├─ chat.ts、chat-words.ts  好友房聊天的过滤和打码词表（纯函数）
│  ├─ share.ts       分享卡（Canvas 画战绩图、系统分享或预览）
│  ├─ qr.ts          二维码编码器（字节模式、纠错 M、版本 1–10，纯函数，分享卡用）
│  ├─ social.ts      报位置、收邀请的横条、好友和邀请的接口小函数
│  ├─ testing.ts     假平台钱包（只给测试和本地开发）
│  └─ internal.ts    内部地址、身份头（不在 exports 里）
├─ scripts/manifest.mjs  打包时把 exports 换成 dist 版、换回来、检查 dist
├─ tsconfig.build.json   构建 dist 用
├─ test/             vitest（workerd），测试用的游戏 Worker 和 wrangler 配置
└─ demo/             浏览器里的小例子
```

## 许可证

MIT，见 `LICENSE`（和仓库根的同一份）。
