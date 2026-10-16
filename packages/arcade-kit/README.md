# arcade-kit

小游戏共用的联机底座：Cloudflare Durable Object 房间、开房进房、浏览器连接、消息协议和每天的额度，各联机游戏（德州、掼蛋、麻将等）的好友房都用它。房间规范见仓库根 `docs/platform-backend.md` 第 4 节。

## 功能

| 入口 | 用在哪 | 做什么 |
|---|---|---|
| `arcade-kit/room` | 游戏 Worker（Durable Object） | 房间基类 `GameRoom`：入座离座（开打后座位绑人）、房主开局、轮流出手或一组人同时出手、按座位过滤下发、断线保留座位、超时代出、掉线托管和交还、电脑批量出手、空房和超时清理、硬限制 |
| `arcade-kit/worker` | 游戏 Worker | `acceptCreate`（开房）、`acceptJoin`（进房）：查 Origin、认人、找房间打包在一起，游戏不用碰浏览器的原始请求；`loginGate`（0.8.0）：首页的登录闸门；`json`、`readJson`、`withCookies`：游戏自己的接口用的小工具 |
| `arcade-kit/auth` | 游戏 Worker | `whoIs`（0.3.1）：经平台 `/api/me` 认人，和开房进房同一个做法（只转发 Cookie 和 IP、3 秒超时、"没登录"和"平台不可用"分开、fail-closed），带回平台的 `Set-Cookie`；游戏自己的接口用它，不再各写一份（登录闸门直接用 `loginGate`） |
| `arcade-kit/rng` | 两边、规则核心 | ChaCha20（RFC 8439，0.2.0）：256 位密钥按"用途 + 序号"分流、拒绝采样的均匀整数、Fisher–Yates 洗牌；纯函数 |
| `arcade-kit/meter` | 游戏 Worker（Durable Object） | 计量 `RoomMeter`（0.2.0）：每天的写入额度、按人和全站的开房名额，游戏原样导出、绑成 `METER` 就行；`meterReport` / `meterLevel`（0.3.0）给房间以外的 DO 记写入、问门槛 |
| `arcade-kit/game` | 两边、规则测试 | 规则接口 `RoomGame`；`snapshotBytes`：算进房快照最大有多大，游戏在自己的测试里断言上限 |
| `arcade-kit/client` | 浏览器 | `RoomClient`：退避加抖动重连、切回前台马上连、按 seq 去重、没确认的操作按原 moveId 和 baseSeq 重发、一直连不上就停下等用户点重试；`createRoom`、`createText`、`closeText`（0.8.0）：开房和给玩家看的默认文案 |
| `arcade-kit/testing` | 游戏的测试、本地开发 | 假平台钱包（0.8.0）：`WalletService`、`FakeBank`、`walletHttp`，只复刻接口形状和关键规则；不进线上代码 |
| `arcade-kit/protocol` | 两边 | 消息类型、协议版本、关闭码、房间码格式 |

包里直接发 TypeScript 源码（不另外构建），游戏用 vite / wrangler 打包时一起编译。
游戏只用上面这几个入口；内部地址和身份头（`src/internal.ts`）不在 `exports` 里，游戏引用不到，免得自己拼内部请求。

## 游戏怎么接

1. `package.json` 加依赖 `"arcade-kit": "file:../../packages/arcade-kit"`（总仓库 AGENTS.md 第 1 节唯一允许的模块外引用）。
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
    污渍在头像上留约 1.7 秒再淡出，同一个人（`target`，游戏传座位号最稳）最多叠 3 层；
  - **头像的受击反应**由游戏做（头像在游戏的画布或 DOM 里）：命中时 kit 调 `onHit(prop)`，游戏让头像抖一下、缩一下；
  - **音效**：`throwAt` 在起飞、炸弹引信、命中时调 `sound(prop, phase)`，游戏判断静音后用 `playFunSound(自己的 AudioContext, 输出节点, prop, phase)` 放（WebAudio 现场合成）；
  - **性能**：只动 `transform`、`opacity`（合成层完成，不触发重排，不读布局），图层 `contain: strict`；同一个图层同时最多 `MAX_PLAYING`（4）个效果，多的直接丢掉（返回 false）；
  - **素材**：全部是 kit 自己手写的 SVG（`src/fun-art.ts`，viewBox 0 0 100 100），不用 emoji 字体（有的设备显示成方框）、不引外部图片和字体，许可同 kit 本身；
  - **演示页**：`demo/index.html`，在 kit 目录里用任意能跑 TS 的开发服务器打开（如 `npx vite`，再访问 `/demo/`），每种道具、每个表情都有按钮。
- **房间以外的 DO 用计量**
- **房间以外的 DO 用计量** `meterReport(env, writes)`、`meterLevel(env)`（`arcade-kit/meter`）：比如游戏自己的钱包 DO，每次写完报一次、写之前问一下门槛（`stop` 就别写了）。
  计量每收一次报数自己写 1 行，所以只适合写得少的地方；没绑 `METER` 时回 `ok`、什么都不做，连不上时抛错。

## 房间怎么守规矩

- **只用 `ctx.acceptWebSocket`、一个闹钟**：所有到期时间（房间寿命 3 小时、没人 10 分钟、这一手 30 秒、掉线宽限 60 秒、电脑没算完、停够了（0.5.0））取最早的；
  只有比现在设的更早才 `setAlarm`（它也算一行写入），期限往后推时不动，到点醒来没到期再改。心跳 `ping`/`pong` 由运行时自动应答。
  闹钟时间以 `getAlarm()` 读到的为准；写完状态后广播出错，算好的闹钟照样设；闹钟里游戏代码出错，60 秒后再醒来重试。
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
- **硬限制**（4.6）：
  - 单条入站消息 4 KB（1009）；每连接每秒 5 条、最多攒 10 条（1008）；房间一生 3,000 条入站消息；寿命 3 小时；没人 10 分钟——到了就关房间：
    断开所有人（4000）、删闹钟、删存储；
  - 没入座的连接最多 4 条（4003）；入座的人不占这个数，旁观的再多也挡不住座位的主人回来；
  - 每人一生最多 300 次"掉线后回来"（只数会写库的那种，4029）。按 userId 记，只管他自己，别人刷不光，离座再坐下也不清零；
    这些重连同时算进房间一生的 3,000 条入站额度，所以房间一生的写入总数有上限。没入座的人进出不写库，不受这个管；
  - 一个人最多用掉房间入站额度的 `maxInboundShare`（默认四成，1,200 条）：超了只断开他（4030），以后也进不来，房间和别人照常；
  - 入站额度用完关房时，日志里记下发得最多的那个 userId 和条数（不记消息内容），方便事后查；
  - 每个入口都包一层，游戏代码抛错只记日志；闹钟里不往外抛（会自动重试 6 次，每次都计费）。
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

- **改门槛**：在游戏的 `wrangler.jsonc` 里写 `"vars": { "KIT_QUOTA": { "busyWrites": 50000 } }`（对象或 JSON 字符串都行），只写要改的字段，部署后生效；
  不认识的字段、不是非负整数的值记日志后忽略，用默认值。门槛按每个游戏各算各的，有几个联机游戏就要分一分（见下面"多个游戏怎么分额度"）。
- **名额什么时候还**：整场打完（`over`）、房间关掉（没人、到寿命、消息总数到了、收场）时房间去还。还不上（计量连不上、房间被驱逐时出错）也不会一直卡住：
  每个名额记着"开房时间 + 房间寿命 + 1 分钟"，到点自动作废。房间打完了但还开着的时候还没还上的，下次有事件（重试间隔 60 秒）接着还。
- **怎么报写入**：房间每一步都数自己写了几行（`setAlarm`、关房也算），攒够 `RoomLimits.meterBatch`（默认 200）行报一次，打完、关房时把剩下的随还名额一起报。
  计量每报一次写 1 行，200 行一报摊下来多花 0.5%；开房（这个人一行、当天一行）、还名额（同样两行）另算，也都记进当天的数。
  没报的数随房间那一行一起存，被驱逐后接着数；被驱逐前刚报过、还没存下去的那一批会再报一次，偏保守。房间跨 UTC 0 点报上来的记在新的一天。
- **计量连不上**：不开新房（503 `unavailable`）、不进新人（1013，客户端过会儿自己重试）；在打的照常，报不上的攒着，60 秒后再试。
- **房间怎么知道门槛**：每次报数、还名额时计量顺便回现在的门槛；有新人来进房时房间也会问（记 30 秒，只读不写）。所以 stop 以后在打的房间最晚再写一批（≤ 200 行）加上这一副剩下的才收场，
  按同时最多二三十个房间算，8.5 万离 10 万还有余量。
- 名额只按游戏算：同一个人在两个游戏里可以各开一个房间。

### 多个游戏怎么分额度

各游戏的额度在自己的 `wrangler.jsonc` 的 `KIT_QUOTA` 里，总账见仓库根 `docs/platform-backend.md` 4.7。

## 还没做的（以后按需加）

- 人机验证；跨游戏的统一房间登记（5.3）。开房名额现在由每个游戏的计量各管各的（上面"每天的额度"），开放注册前看一眼门槛够不够紧；
- Ed25519 入场票；观战（没入座的人现在能连、只看公开信息，最多 4 条连接）；
- 回放记录、终局导出；
- 用 `ctx.abort()` 强制正在打的房间换新代码；`cpu_ms` 要按各游戏的规则在房间里实测再定（4.4）；

## 本地开发

```bash
cd packages/arcade-kit
npm ci
npm test        # 类型检查 + vitest（本地 workerd 里跑真的 Durable Object、WebSocket 休眠接口和闹钟）
```

测试用的游戏 Worker 在 `test/worker.ts`（一个最小的"比大小"规则；0.3.0 的可选接口用 `test/ledger.ts` 的"记账桌"和假银行测），平台的 `/api/me` 用假的服务绑定代替（`vitest.config.ts`），假钱包 `WALLET` 绑回测试 Worker 自己导出的 `WalletService`（`test/wrangler.jsonc`）。
测试里的站点一律是保留的示例域名 `game.example.com`。`demo/` 是一个能在浏览器里点的小例子。

## 部署

kit 自己不部署，也没有 Worker：发的是 TypeScript 源码，游戏经 `package.json` 的 `"arcade-kit": "file:../../packages/arcade-kit"` 依赖它，打包进游戏自己的 Worker 和页面。
CI 的 `pkg-arcade-kit.yml` 只跑测试；kit 改动时依赖它的游戏的流程也会跑一遍测试。用 kit 的游戏要准备这些（写在游戏自己的 `wrangler.jsonc` 里，整体部署见仓库根 README 的部署一节）：

- 绑定：`ROOM`（游戏的房间 DO）、`METER`（`RoomMeter`）、`ARCADE`（到平台 Worker 的服务绑定，`/api/me` 认人走它）；
- 变量：`KIT_QUOTA`（可选，改每天的额度门槛，见上面"每天的额度"）；`SITE_ORIGIN`（可选，0.9.0）：Origin 只认这个站点。
  不设就认请求自己的 origin（游戏和平台挂在同一个站点下，浏览器从哪个站点打开、连的就是哪个），想更严的在部署时注入，再由游戏传给 `acceptCreate` / `acceptJoin` 的 `siteOrigin`；
- kit 里不写死站点地址：同站校验默认用请求的 origin，`/api/me` 按请求的 origin 拼地址、经 `ARCADE` 绑定去问。

## 目录结构

```
packages/arcade-kit/
├─ src/
│  ├─ room.ts        房间基类 GameRoom（Durable Object）
│  ├─ worker.ts      开房 acceptCreate、进房 acceptJoin、登录闸门 loginGate、json / readJson
│  ├─ auth.ts        经平台 /api/me 认人 whoIs、同站校验 sameOrigin
│  ├─ meter.ts       每天的额度计量 RoomMeter
│  ├─ game.ts        规则接口 RoomGame、snapshotBytes
│  ├─ client.ts      浏览器连接器 RoomClient、createRoom、默认文案
│  ├─ protocol.ts    消息类型、关闭码、协议版本
│  ├─ rng.ts         ChaCha20 随机数
│  ├─ fun.ts、fun-art.ts  快捷短语、表情、道具的画面层
│  ├─ testing.ts     假平台钱包（只给测试和本地开发）
│  └─ internal.ts    内部地址、身份头（不在 exports 里）
├─ test/             vitest（workerd），测试用的游戏 Worker 和 wrangler 配置
└─ demo/             浏览器里的小例子
```

## 许可证

MIT，见仓库根的 `LICENSE`。
