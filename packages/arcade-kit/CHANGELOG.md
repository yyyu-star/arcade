# 更新日志

## 0.10.0

- **能发到 npm**：去掉 `private`，补 `repository`、`homepage`、`bugs`、`keywords`、`files`、`engines`（Node ≥ 22）、`sideEffects: false`、`publishConfig.access: public`、`LICENSE`；
  `@cloudflare/workers-types` 是可选的 peer 依赖（只用到类型）。
  - 发布内容是 `dist/`（tsc 按 `tsconfig.build.json` 编的 JS + `.d.ts` + map）和对照用的 `src/`；`build` 脚本，`prepack` 先构建。
  - 仓库里的 `exports` 仍指向 `src/*.ts`，仓库内游戏的 `file:` 引用 `npm ci` 后照旧能用（npm 不会替软链的依赖构建）；
    `prepack` 把 `exports` 换成 `{ types, default }` 指向 dist，`postpack` 换回来（`scripts/manifest.mjs`）。
  - `src/` 里相互引用改写 `.js` 扩展名，编出来的 JS Node 原生 ESM 也能解析（vite、esbuild、tsc 对源码照旧映射回 `.ts`）。行为不变。
  - `npm test` 末尾加 `check:dist`：构建 dist，检查每个入口的 JS 和 `.d.ts` 都在，浏览器能用的入口 Node 能直接 import。
- **独立模式**（游戏不带平台单独部署）：新入口 `arcade-kit/guest`。没有 `ARCADE` 绑定、`GATE` 也不是 `"login"` 时：
  - `loginGate` 不跳登录，回页面，补发游客 cookie（https 下 `__Host-kit-guest`，HttpOnly、Secure、SameSite=Lax、Path=/，值 32 字节随机）；
  - `acceptCreate` 认游客 cookie，没有就现发；`acceptJoin` 认游客 cookie，没有 4401；
  - 游客 `userId` 是 `g:` 加 cookie 值 SHA-256 的前 128 位，默认昵称"游客"加 4 位数字；开房、进房地址可带 `?name=`，`cleanNickname` 严格清洗（保留词由游戏传 `guest.reserved`）；
  - 新增 `identify`（auth）：按部署方式认人；`standaloneRoot(request, env, gameId)`：独立模式下 `/` 302 到 `/games/<id>/`；
    浏览器 `detectPlatform()`（同域 `/api/me`：有平台 / 没有 / 不知道）、`withNickname(url, name)`。
  - **有 `ARCADE` 绑定时行为完全不变**，游客 cookie 一律不认；`GATE: "login"` 却没绑 `ARCADE` 时 fail-closed（以前 GATE 不写也是这样，现在不写 GATE 又没绑 ARCADE 算独立模式）。
  - 测试 `test/guest.test.ts`：发 cookie、认人、重连还是同一个人、换 cookie 是另一个人、昵称清洗、本站带游客 cookie 不认、GATE=login 不退成游客、同源检查照旧；
    反证：让 `isStandalone` 忽略 `ARCADE`，平台模式那几条全部失败。
- **电脑也会互动**：`GameRoom` 加 `protected onStep(state)`（每步广播完调一次）和 `protected botEmote(seat, id, to?): boolean`：只有电脑座位（`ai`、托管 `auto`）能发，
  校验和限速同真人（同一个座位令牌桶），不写存储；广播的 `EmotedMsg` 多带 `bot: true`（协议只加字段），`onEmote` 多一个参数 `bot`。
  测试（`test/emote.test.ts` 的 `ChattyRoom`）：所有连接收到、真人座位发不出、限速生效、不写库；反证：去掉"必须是电脑座位"的判断，两条都失败。

## 0.9.1

- 只改测试：修 `quota.test.ts`"计量连不上"那条偶发的失败（CI 上 expected 201 to be 409）。房间代码不改。
  打完那一步还名额（`kitRelease`）是广播之后才 await 的，测试收到"打完了"马上恢复计量，这一下有时赶在恢复之后才到、直接还成功，
  接下来"还占着名额（409）"就不成立。现在 `FlakyMeter` 记下断线时拒掉了几次 `kitRelease`，测试等它真的被拒了再恢复。
  反证：让 `kitRelease` 等到恢复之后才进来，不改测试时稳定复现 201，改了以后通过。

## 0.9.0

- **kit 里不再写死站点地址**（开源整改）：
  - 删掉导出的 `SITE_ORIGIN`、`ME_URL` 两个常量。没有游戏用到它们，游戏原来的写法不用改。
  - 同站校验 `sameOrigin(request, siteOrigin?)` 的第二个参数变成可选：不给就认请求自己的 origin。
    `acceptCreate` / `acceptJoin` 的 `siteOrigin` 不给时也一样；给了（比如部署时注入的 `SITE_ORIGIN` 变量）就只认给的。
  - `whoIs`、`loginGate`、`acceptCreate`、`acceptJoin` 问 `/api/me` 时，地址按请求的 origin 拼（新导出 `ME_PATH`、`meUrlOf`），照旧经 `ARCADE` 服务绑定；`meUrl` 仍可覆盖。
  - 默认文案 `ROOM_TEXT.forbidden` 改成"请从游戏大厅打开"，不写域名；注释里的域名也去掉了。
- 测试里的站点换成保留的示例域名 `game.example.com`。`test/worker.ts` 不再传 `siteOrigin`、`meUrl`，直接测默认值；另加两条测试：`sameOrigin` 不给站点时的行为、`meUrl` 覆盖。
- 旧仓库的 PR 编号改成不带 # 的"旧仓库 PR N"，免得在新仓库里链到同号的无关 PR。
- README 按统一结构整理：简介、功能、本地开发、部署（游戏要准备的绑定和变量）、目录结构、许可证（MIT）。
  `package.json` 加了 `"license": "MIT"`。去掉了只对维护者自己环境成立的说法。

## 0.8.0

- **几个游戏各抄一份的通用部分收进 kit**（代码审阅：两个游戏的假钱包 97% 相同，开房、登录闸门大段重复）。只加不改，已有接口行为不变：
  - `arcade-kit/testing`（新入口）：假平台钱包 `WalletService`、`FakeBank`、`walletHttp`，只给测试和本地试用。
    - 只复刻接口形状和关键规则：带入、结回、放弃、只结一次、余额够这次、op 去重、按 ref 分份、到期退回、client 每天净赢上限、stats 上限、补给（docs/platform-backend.md 5.9、5.10、15.9）。
    - 规则数用平台现行默认值（净赢 10 份、补给看余额加桌上的）。
    - 不维护游戏名单，只核对 `props.game` 和参数一致，以后加游戏不用改它。
  - `arcade-kit/worker`：`loginGate`（首页登录闸门，和游戏原来的写法一致：放行带 Set-Cookie、没登录 302 带 next、平台不可用 503 页、`GATE=off` 不拦），默认 503 页不带游戏名，可以换；
    `json`、`readJson`、`withCookies` 三个小工具。
  - `arcade-kit/client`：`createRoom`（POST `{ opts }`，401 当 login、不是 JSON 当 unavailable、网断了 offline）；`createText`、`closeText` 和 `ROOM_TEXT`：开房失败、断开时的默认说法，游戏按 key 覆盖。
  - 包里不出现任何游戏 id 和游戏专属文案。README 加了"登录闸门、开房、假钱包"一节和各游戏的迁移步骤。
- `auth.ts`、`client.ts` 注释里只拿一个游戏举例的过时说法改成通用的；README 的额度总账指向 `docs/platform-backend.md` 4.7。

## 0.7.2

- **查清"`RoomInfo.pause.until` 比 `getAlarm()` 早 1–2 帧"：kit 没错，是对照的值取错了**（德州的测试注释，旧仓库 PR 97）。房间代码不改。
  在德州 workerd 测试里逐次对比同一条广播的 `room.pause.until` 和房间存的闹钟：300 多次停顿全部相等（seq 也相同）。对不上的都是同一个形状：
  停够了闹钟醒来，`resume` 发下一手，电脑（含托管）一口气打完这一手又进入停顿（resume 那一帧 + 1–2 帧电脑）。这时拿**上一次停顿**的 `until`
  （或"醒来时刻 + 停顿"）去比，新的截止时间多出的正是这一批电脑的播放时间（德州 `aiDelayMs` 1.6 秒 × 1–2 帧）——这是设计如此：
  停顿从这一批播放完算起，`land` 收到的计时起点是 `now + 第几帧 × aiDelayMs`（`runAuto`），`pausedUntil()` 和闹钟都走 `deadline()`，两者一定相等。
- 加测试锁住这一点（`test/pause.test.ts`"停够了接着来，电脑（含托管）一口气出完下一圈、最后一帧又进入停顿……"）：u1 掉线托管，闹钟 resume 后
  四帧电脑出完一圈又停，断言同一条广播 `pause.until` = `getAlarm()` = 醒来时刻 + 4 × `aiDelayMs` + 停顿、存的 seq 和广播一致、进房快照同一个时间、
  早 1 毫秒不推进、到点接着来。反证：把 `runAuto` 的计时起点改成 `now`（不算播放时间），这条和原有两条停顿测试失败；把闹钟单独往后推一帧，8 条停顿测试失败。
- README：删掉"多个游戏怎么分额度"里各游戏写入门槛的分配表和"加起来不能超过 10 万"那段，改成一句指向各游戏 `wrangler.jsonc` 的 `KIT_QUOTA`
  和仓库根 `docs/platform-backend.md` 的总账（共用包不管别的模块的配置）；开头"第一版只做掼蛋好友房间要用的部分"、`breakPoint` 只拿掼蛋举例、
  "上第二个联机游戏时"、`cpu_ms` 等掼蛋这些过时说法改成通用的（德州、掼蛋、麻将都在用）。

## 0.7.1

- **别人看不出来的不轮流操作不广播**（麻将旧仓库 PR 139 的审阅）：`free` 的操作做完、电脑也没接着出，如果除出手人以外每个座位和没入座的人的视图、房间信息都没变，
  房间照常存（≤ 2 行），只回给出手的连接，seq 不加。协议加可选字段 `StateMsg.quiet: true`（只和 ack 一起）；`RoomClient` 收到 seq 没变、带自己 ack 和 quiet 的消息交给页面一次。
  原来这类操作会广播一条新 seq 的状态，别人能看出"有人做了点什么"（麻将声明窗口里真人答碰杠胡就等于点名）。
  向后兼容：别人看得出来的 free 操作（德州的暂离、补码，掼蛋的买入）照旧广播；旧的 RoomClient 收到 quiet 消息当重复丢掉，只是出手人自己的画面晚一步更新。

## 0.7.0

- **限速用户感觉不到、后台可调**：快捷短语改成每个座位一个令牌桶，默认每 1 秒补 1 个、最多攒 3 个（`RoomLimits.emoteMs` 3000 → 1000，加 `emoteBurst`）。
  两个值可以在游戏 `wrangler.jsonc` 的 `vars.KIT_QUOTA` 里写 `emoteMs`、`emoteBurst` 覆盖，不用发版（计量认得这两个字段、不再记"不认识"）。
  进房快照加可选字段 `welcome.emote: { ms, burst }`；`RoomClient.emote` 在本地按这个节奏排队（太快的排到下一个令牌，只留最后 2 个），房间回的 `emote_too_fast` 静默丢掉，不交给页面。
- **短语可以指定对象**：`EmoteMsg`、`EmotedMsg` 加可选的 `to`（座位号），房间检查是有人的别的座位，不然回 `bad_target`（加进 `EMOTE_ERRORS`，不占令牌）；
  `RoomClient.emote(id, to?)`、`onEmote(seat, id, to?)`。不带 `to` 的和 0.6.0 一样，不写存储。
- **新模块 `arcade-kit/fun`**（浏览器用，纯 DOM + SVG + Web Animations）：`createFunLayer`（class `arcade-fun`，`hide`/`show`/`destroy`）、
  12 个表情 `STICKERS` + `showSticker`、8 种互动道具 `PROPS` + `throwAt`（抛物线飞行带残影、分道具的命中效果、污渍最多叠 3 层、同时最多 4 个）、
  道具音效配方 `playFunSound`（WebAudio 合成，游戏用自己的音频放、跟着自己的静音）。素材全部自己画（`src/fun-art.ts`），不用 emoji 字体。
  kit 不写死任何游戏：编号到内容的表由游戏定。演示页 `demo/`。
- 协议只加字段，`PROTOCOL_VERSION` 不变。加测试：令牌桶（连发 3 句、第 4 句被拒、过 1 秒补一句）、`KIT_QUOTA` 覆盖、快照带节奏、`to` 的校验、客户端排队；
  `test/fun.test.ts`（素材是自己画的 SVG、抛物线、同时最多 4 个、污渍最多 3 层）。

## 0.6.0

- **快捷短语**：`RoomGame` 加可选的 `emotes`（短语表有几句），入座的人发 `{ t: 'emote', id }`（`EmoteMsg`，`RoomClient.emote(id)`），
  房间校验编号（0 到 `emotes - 1` 的整数）、按座位限频（`RoomLimits.emoteMs`，默认 3 秒一句），然后把 `{ t: 'emote', seat, id }`（`EmotedMsg`）发给房间里所有人（含发的人）。
  **只认编号、不收自由文本**，短语内容由游戏自己定。**0 行写入、不改 seq、不进状态**；入站照常计数（令牌桶、个人份额、`maxInbound`）。
  被拒回 `error`：`no_emotes`、`bad_emote`、`not_seated`（旁观的不能发）、`room_over`、`emote_too_fast`（`EMOTE_ERRORS`）。
- 浏览器：`RoomClientOptions` 加可选的 `onEmote(seat, id)`。`EmotedMsg` **不在 `DownMsg` 里、不进 `onMessage`**：
  放进 `DownMsg` 会让按"不是 error 就是 welcome / state"写的游戏代码类型检查失败（掼蛋、德州都是这么写的），所以单独走一个回调。
- **协议只加消息、不改含义**，`PROTOCOL_VERSION` 不变；`RoomLimits` 多一个 `emoteMs`（从 `DEFAULT_LIMITS` 展开的游戏不用改）。
  不写 `emotes` 的游戏行为完全不变。加测试（`test/emote.test.ts`，客户端一条）。

## 0.5.0

- **停一会儿再接着来**：`RoomGame` 加两个可选的纯函数 `pause(state)`、`resume(state)`。没人能出手时房间先问 `pause`（优先于 `waiting`），
  给了正的毫秒数就停这么久：从进入停顿那一刻算（电脑连着出完进来的从播放完算），停顿期间不轮流的操作、座位换人、对外的事办完不重新计时；
  到点用唯一的闹钟调 `resume` 做一步（≤ 2 行），电脑接着出、照常广播。`resume` 抛错或返回的还在停：记日志、截止时间推后 60 秒再试。
  写了 `pause` 没写 `resume` 的当作没有停顿（记一次日志）。用在一手打完固定停几秒给大家看结果、再自动发下一手。
- 协议：`RoomInfo` 加可选字段 `pause: { until }`（停顿的截止时间戳），只在停时有，这时 `turn` 是 null；`PROTOCOL_VERSION` 不变。
  `RoomClient` 原样把 `room` 交给页面，不用改。`snapshotBytes` 对写了 `pause` 的游戏把这个字段算上。
- **只加可选接口和字段，不写 `pause` 的游戏（掼蛋）行为完全不变**，原有测试原样全过。加测试（`test/pause.test.ts`，含反证）。

## 0.4.0

- **开房就定选项**：`acceptCreate` 的第三个参数多一个可选的 `options`（`CreateOptions`），房间开房时用 `RoomGame.options` 校验，
  不合格回 400 `bad_options`（`CreateError` 加了这一项）、不占名额、不建房间；校验过的存进房间状态（和状态同一行，开房写入不变），
  经 `RoomInfo.opts`（新字段）发给每个进房的人。定下以后不能改：开打时以开房的为准，`start` 带的 `opts` 不看；
  等人时坐到 `seatCount` 以外的座位回 `seat_closed`。德州好友房用：输房间码进来的人开打前就知道档位、要带多少、哪些座位用得到。
- 只加字段、不改含义：不带 `options` 的房间（掼蛋）行为完全不变，掼蛋测试照样全过。加测试（含反证）。

## 0.3.2

- `RoomGame.waiting(state)`（可选）：牌局没打完、这一刻谁也不用出手、在等外面的事（有人坐下、补码、从暂离回来、买入到账）时返回 true，
  `actors`（`turn`）就可以是空的：房间不当作出错（原来记日志、按打完处理），不计时、不驱动电脑、不写；等不轮流的操作、座位换人、对外的事办完让牌局变了再看。
  德州的牌桌能打的人不够两个时就停在这里。不写就和以前一样。加测试（含反证）。

## 0.3.1

- `arcade-kit/auth` 导出 `whoIs`，结果多带 `setCookie`（平台续期、清失效会话时回的 Set-Cookie），游戏的登录闸门和自己的接口照转给浏览器；开房进房的行为不变。
- 游戏的 `settled` 写错了、办完的事还留在 `effects()` 里时：记一条错误日志、当失败交给退避，不在这一轮里接着重办（原来每步之后同一笔要重办 4 轮、每轮写 1 行）。加测试。

## 0.3.0（2026-10-15）

德州好友房要的几样通用接口（德州 DESIGN.md 6.2 第 2–6 条）：全部可选，不写就和 0.2.0 一样，kit 里不写死任何一个游戏；掼蛋不用改代码，测试照样全过。

- **开局选项**：`StartMsg` 多一个可选的 `opts`（`RoomClient.start(opts)`）。`RoomGame.options(raw)` 校验（不合格回 `bad_options`），
  `seatCount(opts)` 定这一局用几个座位：只给前面这些座位补电脑，后面的座位一直空着、开打后谁也坐不进去，有真人坐在后面时回 `seat_closed`。
  `begin` 多一个参数 `setup`：`{ opts, seats }`（每个座位坐的是谁）。
- **座位换人** `RoomGame.seated(state, seat, kind)`：开打后有人坐下（接管电脑或回到自己的座位）、离座交给电脑时调，和那一步一起写，不多写行。
- **对外的事**：游戏在状态里记着要去外面办的事（`RoomGame.effects`，每笔 `{ id, seat, ... }`），房间类实现 `GameRoom.perform(effect, userId)` 去办
  （比如经 DO 调用从玩家的钱包扣买入），办完用 `RoomGame.settled` 写回（1 行）。在 entry 之外 await；失败按 15 秒起、翻倍、最多 10 分钟的退避重试（还是那一个闹钟）；
  同一笔可能办两次，办事的一方按 id 去重。关房前先调 `RoomGame.closing` 记下收场要办的，有没办完的就断开所有人、留着存储办完再删，最多等 `RoomLimits.closingMs`（新字段，默认 1 小时）；
  正在关的房间进不来（4000）。`Persist` 只加字段（`effectsAt`、`effectTries`、`ending`）。
- **不轮流的操作** `RoomGame.free(action)`：入座的人什么时候都能发，不看轮没轮到、不判 stale，该谁出手没变就不改期限和 `turnSeq`。
  为此 `act` 先 `parse` 再判 stale 和轮次：既过时、格式又不对的消息，以前回 `stale`，现在回 `bad_action`（都是"不做"，页面按最新状态重来）。
- **房间以外的 DO 用计量**：`arcade-kit/meter` 新导出 `meterReport(env, writes)`、`meterLevel(env)`，给游戏自己的钱包之类记写入、问门槛；每报一次计量多写 1 行。

**兼容性**：协议版本不变（仍是 1），只加字段。`RoomLimits` 多了必填字段 `closingMs`：照 README 写成 `{ ...DEFAULT_LIMITS, ... }` 的不用改。
`RoomGame`、`GameRoom` 多了两个带默认值的类型参数，原来的写法照常编译。0.2.0 存下的房间读出来没有新字段，按"没有要办的事"处理。

## 0.2.0（2026-10-14）

好友房要正式放出来，先把额度管住（维护者："好友房需要放出来，让大家可以玩，但是需要控制额度"）。免费版 DO 每天整个账户 10 万行写入（docs 4.7），
4 真人一局约 1,133 行，不管的话一天九十来局就会把所有游戏的联机一起打停。

- **安全（阻塞修复）：开局随机从 32 位种子换成 256 位熵**。0.1.x 的房间用 `crypto.getRandomValues(new Uint32Array(1))` 生成种子，只有约 43 亿种，
  玩家拿自己的手牌逐个试种子几分钟就能反推出全桌的牌。现在：
  - 新入口 `arcade-kit/rng`：ChaCha20（RFC 8439，只用 32 位整数运算，用 RFC 的测试向量锁住，另和 OpenSSL 对拍过 2000 组），
    按"用途 + 序号"分流（`stream(key, 'deal', 3)`）、拒绝采样的均匀整数（`below`，没有取模偏差）、Fisher–Yates 洗牌（`shuffle`）。纯函数，浏览器和 DO 都能用；
  - `RoomGame` 新加 `begin(entropy, rulesVersion)`：房间用 `crypto.getRandomValues` 生成 8 个 u32 交给它，只用这一次、房间不存；游戏把它当密钥放进自己的状态，后面每一副也从这条流里取；
  - `start(seed)` 标成废弃：只为 0.1.x 的游戏升级 kit 时照常能开局，房间会记警告。已经开打的房间不会再开局，按开局时的规则版本打完。
    **掼蛋线上的好友房在掼蛋 0.3.0 换成 `begin` 之前仍有这个问题。**
- **计量 `RoomMeter`**（新入口 `arcade-kit/meter`）：每个游戏 Worker 一个全局实例，绑成 `METER`。里面放三样东西，一次 RPC 办完：
  当天（UTC）全站写入行数、当天全站开房数、每个人开着的房间和当天开了几个。比"每人一个小 DO + 一个计量"少一次请求，也不用每个人建一次表。
- **按人的开房名额**：默认每人同时 1 个自己开的房间（`has_room`，带那个房间的码，页面给"回到房间"）、每天 6 个（`daily_limit`）。
  整场打完或者房间关掉时还；还不上的到"开房时间 + 房间寿命 + 1 分钟"自动作废。房间打完了还开着时没还上的，60 秒后下次有事件接着还。
- **每日写入计量**：房间自己数写了几行（含 `setAlarm`、关房），攒够 `RoomLimits.meterBatch`（新字段，默认 200）行报一次，打完、关房时随还名额报最后一批；
  计量每报一次写 1 行（摊下来 0.5%），自己写的行也记进当天的数。没报的数随房间那一行存（`Persist.unmetered`，只加字段），被驱逐后接着数。
  - 到 `busyWrites`（默认 6 万）：不开新房（503 `busy`）、不进新人（新关闭码 **4503**，不重连）；在打的照常打完，房主、坐过的、已经连着的人照常进；
  - 到 `stopWrites`（默认 8.5 万）：在打的房间走到 `RoomGame.breakPoint`（新的可选函数，掼蛋是一副打完）时停下电脑、把这一步发给大家，再以 4000 加原因 `quota`（`CLOSE_REASON.quota`）关房；
    等人的、已经打完的、游戏没写 `breakPoint` 的马上关；
  - 计量连不上：不开新房（503 `unavailable`）、不进新人（1013，客户端过会儿重试），在打的照常，报不上的攒着 60 秒后再试。
- **全站每天开房上限**：默认 300（`dailyRooms`），最后一道闸，到了回 503 `busy`。
- **门槛可调**：游戏在 `wrangler.jsonc` 的 `vars.KIT_QUOTA` 里只写要改的字段（对象或 JSON 字符串），不用改代码；配错的字段记日志、用默认值。
  10 万行是全账户共用的，多个游戏怎么分写在 README（掼蛋 5 万 / 6 万，德州以后 1.5 万 / 2 万，留 2 万余量）。
- **开房的错误改成 JSON** `{ error, code? }`（`protocol.ts` 的 `CreateError`）：401 `login`、403 `forbidden`、409 `has_room`、429 `daily_limit`、503 `busy`、503 `unavailable`。
  状态码和 0.1.x 一样的那几种（401、403、503）照旧，只看状态码的页面不受影响。
- **客户端**：`onStatus` 多一个参数 `reason`（关闭原因），页面靠它认出"额度满了收场"的 4000。

**兼容性**：协议版本不变（仍是 1），都是加字段、加码。**没绑 `METER` 时不限额、不计数**，和 0.1.1 一样——只为了 0.1.x 的游戏升级 kit 时不至于开不了房，
正式环境一定要绑。已经上线过 v1 迁移的游戏，计量要另加一条迁移（`v2`，`new_sqlite_classes: ["RoomMeter"]`）。0.1.x 存下的房间读出来时 `unmetered` 从 0 算，
关房时去还名额（计量里没有就只记写入）。

## 0.1.1（2026-10-14）

堵住开打后换座位看牌的漏洞，按人拆入站额度，加"一组人同时出手"（掼蛋结算页大家点继续、20 秒后自动发下一副）。

- **座位绑人**（阻塞修复）：0.1.0 里开打后任何没入座的人都能坐进电脑座位，于是一个人可以离座、接管对手的电脑座位看牌、再回到自己的座位。
  现在开局时记下每个座位绑定的 userId：坐过某个座位的人只能回这个座位（别的回 `not_your_seat`）；没坐过的人只能接管没绑人的电脑座位，
  接管后绑给他；绑给别人的座位（主人离座了也算）谁也接管不了（`seat_reserved`），电脑一直替主人打。
  比"坐过的只能回原座"更严一点：不然同伙可以先占掉 A 的原座位，A 就成了"没绑座位"的人，又能去接管别的座位。一个 userId 一局只对应一个座位。
  大厅分得清座位：`SeatInfo.reserved`（开打后绑了人，主人离座也算）；绑了人的座位由电脑代打时 `name` 是原主人的昵称（"电脑代某某打"）；
  `welcome`、`state` 的 `you.bound` 是这个人绑定的座位（离座了也还是它，给"回到我的座位"用）。只下发"绑没绑"，不下发 userId。
- **按人拆入站额度**：新加 `RoomLimits.maxInboundShare`（默认 0.4）：一个人最多用掉房间一生入站额度的四成，超了只断开他（新关闭码 **4030**，不重连），
  以后也进不来，房间和别人照常。一个人刷不完整个房间。
- **一组人同时出手**：`RoomGame` 新加两个可选函数 `actors(state)`（这一刻能出手的座位）、`turnMs(state)`（这一手/这一组的时限）；
  `RoomInfo.turn` 新加可选的 `seats`（写了 `actors` 才有）。组里的电脑、托管马上代出，真人谁先发都收；组的时限从进入这组时起算，组里有人出手不重新计时，
  到点对还没出的真人逐个 `timeout`。stale 按"这一手（组）开始时的 seq"判：同一组里别人先出了，后出的人不算过时，组开始之前的决定才是 stale。
  `actors` 可以返回 `{ seats, group }` 明确告诉房间是不是同一组（推荐；group 一样还要出手的人离开名单、没有新座位加入才算）；只返回数组时按"出手的人离开名单、其他人不变"推断（有歧义，见 README）。
  有人接管组里还没出的电脑座位、或者收回托管时，整组的期限不变。
- **超时代出被规则拒绝**：`timeout` 给的操作不合法时改用 `ai` 再试；还不行就记日志、把这一手（组）的期限推后 60 秒。
  0.1.0 里这种情况闹钟会在当前时刻反复响、每次写一行，没有上限（分组以后组里任何一个人这样都会触发）。现在最多每分钟一次。
- **牌局没打完却没人能出**（`actors` 空了、`turn` 是 null 但 `over` 是 false）：记日志、按打完处理，不再一直卡着。
  两个函数都不写时和 0.1.0 完全一样（原有测试原样保留）。仍然一个闹钟、每步 ≤ 2 行。
- **认人**：请求里没有平台的会话 cookie（`__Host-sid`）就直接算没登录（4401），不再问平台；cookie 名只在 `src/internal.ts` 定义一处。
- **客户端**：`onStatus('reconnecting', code)` 带上这次断开的关闭码（1006、1013……），页面可以区分"网断了"和"平台忙"。
- 修：桌上真人都离座后电脑会停着，之后有人接管了一个**不是正轮到的**电脑座位时，轮到的电脑不会接着出，牌局卡住到房间寿命结束。现在坐下后电脑接着出到真人。
- 两处过时注释（`CLOSE.full`、客户端失败计数）。

**兼容性**：协议版本不变（仍是 1），都是加字段、加码，0.1.0 的页面能照常连 0.1.1 的房间；0.1.0 存下的房间读出来时补上座位绑定和 `turnSeq`，
正在打的房间换新代码后接着打。要注意的有三处：

1. 开打后换座位的规则变严了（上面第一条），页面要处理 `not_your_seat`、`seat_reserved` 两个新错误码（按"座位被占"提示即可）；
   电脑座位的 `name` 不再一定是 null（绑了人的是原主人昵称），按 `kind` 判断是不是电脑，不要按 `name` 判断；
   0.1.0 存下的已开打房间里，电脑座位一律算已绑（谁都不能接管，包括升级前离过座的人：旧格式看不出座位原来是谁的）；
2. 认人短路后，游戏测试里假平台的 cookie 名必须是 `__Host-sid`（掼蛋旧仓库 PR 50 的测试用的是 `gdsid`，要改，否则所有进房都会变成 4401）；
3. `RoomLimits` 多了必填字段 `maxInboundShare`：覆盖 `limits` 时照 README 写成 `{ ...DEFAULT_LIMITS, ... }` 就不用改，自己逐项写全的要补上。

还没做、要平台配合的：每人同时开几个房间、开房配额要平台的房间登记（docs/platform-backend.md 5.3），**开放注册前要先做**（见 README）。

## 0.1.0（2026-10-14）

第一版，给掼蛋好友联机（P1）打底。

- `room`：Durable Object 房间基类。WebSocket 休眠、一个闹钟、每步写入 ≤ 2 行（开房含建表 4 行）、状态没变不写；按座位过滤下发；
  房间码、开房、入座离座、房主开局、电脑补满；断线保留座位、30 秒超时代出（重连不重置）、掉线 60 秒电脑托管、回来交还；
  电脑一次算到下一个真人回合、每步带播放延迟；游戏错误码不合格式换成 illegal_move；
  单条消息 4 KB、每连接每秒 5 条、一生 3,000 条入站消息、每人 300 次掉线后回来（按 userId 记，离座再坐下不清零，同时算进入站额度）、没入座的连接最多 4 条、寿命 3 小时、
  没有入座的人连着 10 分钟等硬限制；
  同一账号只留一条连接；被驱逐后从存储重建；探不存在的房间码不留任何东西；不记回放。
- `worker`：游戏 Worker 的开房（RPC）、进房入口，查 Origin、经服务绑定问平台 `/api/me` 认人、找房间打包在一起。
  进房被拒时用关闭码关掉、不回 HTTP 错误：没登录 4401、别的网站 4403 等不重连，平台暂时不可用 1013 稍后重连。第一版不做入场票。
  游戏只用 `room`、`worker`、`game`、`client`、`protocol` 这几个入口，认人和内部地址不导出。
- `game`：规则接口，`snapshotBytes` 给游戏测快照体积。
- `client`：浏览器连接器，退避加抖动重连、切回前台马上连、按 seq 去重、没确认的操作按原 moveId 和 baseSeq 重发，1008/1009/4000 段不重连，
  连着 20 次没进得了房间就停下等用户点重试。
- `protocol`：消息类型、协议版本 1、关闭码。**上行 `act` 的 `baseSeq` 是必填字段**（做决定时看到的最新 seq，`RoomClient` 自动带上）：
  牌局在那之后变过的回 `stale`，没带的回 `bad_message`。
