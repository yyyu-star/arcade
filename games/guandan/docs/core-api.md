# 规则核心接口（给画面层）

> 0.1，2026-10-13。代码在 `src/core/`（规则）和 `src/ai/`（电脑）。画面层只从 `src/core/index.ts`、`src/ai/index.ts` import，
> 只读状态和事件，不自己算规则。所有数据都是普通 JSON，可直接存档。

## 1. 牌

- 一张牌是整数 `0..107`：`rankOf(c)` 点数（2..14，A=14；小王 16、大王 17），`suitOf(c)` 花色（0♠ 1♥ 2♣ 3♦，王为 -1）。
  `c` 和 `c+54` 是两副牌里同一张，画面上看起来一样。
- `isWild(c, level)` 是否逢人配（红桃级牌）；`cardValue(c, level)` 单张大小（级牌 15）。
- `sortHand(cards, level)` 理牌顺序（小到大，逢人配排在级牌之后）；`cardName(c)` 调试用文字。

## 2. 开局与推进

```ts
import { createGame, dispatch, viewFor, seatsToAct, legalPlays, canPass, hint, eventsFor } from './core/index.ts';
import { decide, suggest } from './ai/index.ts';

let { state, events } = createGame(seed, options?);   // options 见 options.ts，默认竞赛规则
const r = dispatch(state, action);                      // → { state, events, error? }
if (r.error) 显示 r.error（大白话中文），state 不变
```

- 座位 0..3 按出牌顺序排列，`nextSeat(s) = (s+1)%4` 是下家；对家 `partnerOf(s)`；队伍 `teamOf(s) = s % 2`。
  建议玩家坐 0，画面上 1 在右/左按出牌方向画。
- 同一种子 + 同一串动作 → 逐位相同的状态。`replay(seed, options, actions)` 可重放。

### 动作 `Action`

| 动作 | 何时 | 说明 |
|---|---|---|
| `{ type: 'play', seat, cards, as? }` | 出牌阶段轮到 seat | `cards` 是牌 id 数组；`as: { type, rank, extra? }` 指定解释（同一组牌有多种解释时）；不给就自动：领出取最强、跟牌取能压过的里面最小的 |
| `{ type: 'pass', seat }` | 轮到 seat 且不是领出 | 不要 |
| `{ type: 'tribute', seat, card }` | 进贡阶段 | 只能交 `view.myTribute.allowed` 里的牌 |
| `{ type: 'return', seat, card }` | 还贡阶段 | 同上 |
| `{ type: 'nextDeal' }` | `phase === 'dealEnd'` | 开下一副。**牌桌动作，不属于任何座位**：联机时只由房间在全员"准备"或倒计时结束后发出，玩家发来的一律不收；单机时本地会话代替房间发（玩家点"下一副"） |

前四种是玩家动作 `SeatAction`，`nextDeal` 是牌桌动作 `TableAction`，`Action = SeatAction | TableAction`。
房间收到玩家消息时先用 `isSeatAction(a)` 过滤，再核对 `a.seat` 是不是这条连接的座位。

### 判断轮到谁

- `seatsToAct(state)` 或 `view.toAct`：现在必须行动的座位。出牌阶段只有一个（`state.turn`）；进贡/还贡阶段可能两个人同时要做（双下），顺序不限。
- `phase`：`'tribute'` 进贡 → `'return'` 还贡 → `'play'` 出牌 → `'dealEnd'` 一副结束 → 下一副，或 `'gameOver'` 整局结束。
  第一副和抗贡时直接从 `'play'` 开始。
- 电脑行动：`decide(viewFor(state, seat), { seed, difficulty })` 返回一个 `Action`（不该它动时返回 `null`），再 `dispatch`。
  `difficulty`：`'novice' | 'easy' | 'normal' | 'good' | 'hard'`。同样的局面和种子决定相同。

## 3. 玩家视角 `viewFor(state, seat)` → `PlayerView`

只含这个座位能看到的信息（联机时下发的也是它）。`seat = -1` 是没入座的人看到的公开视图：手牌为空、没有 `myTribute`，`eventsFor(events, -1)` 同理。
每副开始（`startDeal`）清空 `trick`，上一副最后一手不会留到下一副的视图里。


| 字段 | 含义 |
|---|---|
| `seat` `phase` `dealNo` `step` | 我是谁、阶段、第几副、已执行动作数 |
| `level` `declarer` | 本副级数（级牌点数）、打哪一队的级（第一副为 -1） |
| `levels` `aFails` | 两队当前级数、打 A 未过次数 |
| `hand` | 我的手牌（已理好） |
| `counts` | 四家剩余张数（画面上 10 张以下显示数字） |
| `turn` `toAct` | 出牌阶段轮到谁；所有必须行动的座位 |
| `trick` | 本轮：`leader` 领出的人，`last` 当前最大的一手 `{ seat, play }`（null = 要领出），`passed[座位]` |
| `finished` | 已出完的座位（先后 = 头游、二游……） |
| `history` | 本副全部出牌记录 `{ seat, play | null }`（null 是不要） |
| `tribute` | 进贡情况：`entries[{ from, to, card, back }]`、`leader`；别人之间的还贡牌为 null |
| `antiTribute` | 本副抗贡 |
| `myTribute` | 我要进贡/还贡时：`{ kind, to, allowed }`（允许的牌，画面上只让点这些） |
| `lastDeal` | 上一副结果（结算画面用）：`order` 名次、`winnerTeam`、`up` 升几级、`doubleDown`、`levelsBefore/After`、`aFailedTeam`、`aResetTeam` |
| `winner` | 整局赢家队伍（未结束为 -1） |

## 4. 一手牌 `Play`

`{ type, rank, value, extra, cards }`：
- `type`：`single` 单张、`pair` 对子、`triple` 三同张、`fullHouse` 三带二、`straight` 顺子、`tube` 三连对、`plate` 钢板、
  `bomb` 炸弹、`straightFlush` 同花顺、`jokerBomb` 天王炸（中文名在 `PLAY_TYPE_NAMES`）。
- `rank`：主点数；顺子类是最大那张（A2345 记 5）。`extra`：三带二带的对子点数，同花顺的花色，其余 -1。
- `isBomb(play)` 是否炸弹类（画面上震屏用）；`beats(a, b)` a 能否压 b。
- `interpret(cards, level, options)`：玩家选的牌的全部合法解释。长度 0 = 不能出；>1 时可以让玩家选（例如逢人配补的顺子当 6 大还是 7 大），
  或者不传 `as` 让核心自动挑。

## 5. 提示

- `legalPlays(view)`：轮到我时所有合法出法（不含不要）；`canPass(view)` 能否不要。
- `hint(view)`：同上，排好序，"提示"按钮每点一次取下一个，循环。顺序：普通牌型在前、炸弹在后；同一档里先选不伤牌的
  （不拆炸弹/天王炸/天然同花顺、不用逢人配、不拆散对子三张），再按牌型、从小到大。
- `suggest(view)`（src/ai）：电脑（hard）在这个位置会出的那一手（会理牌、记牌、配合队友），null 表示建议不要。
- `hintList(view, seed)`（src/ai）：画面"提示"按钮用的完整列表：首条是 `suggest`，它判断该让时首条是 null（"建议不要"），
  后面接 `hint` 的全部出法（去重）。要不起时为空列表。

## 5.1 联机用（P1，0.1.11 起；房间和浏览器共用）

- `timeoutAction(view)`：超时或掉线时替这个座位代出，"能不出就不出，必须出就出最小的"。只看这个座位的视角，结果确定。
  出牌时能不要就不要（队友的牌也不接），必须领出时出一张最小的单牌（同样小先出不是逢人配的）；进贡、还贡交允许的牌里最小的；
  没轮到或一副结束时返回 null。掉线久了转电脑托管用 `src/ai` 的 `decide`，不用它。
- `previewNext(state)` → `{ anti, payers, to } | null`：一副结束（`dealEnd`）时下一副谁进贡（`payers`）、给谁（`to`，双下要等贡牌比大小，为 -1）、
  是不是抗贡（`anti`，这时 `payers` 是抗贡的人）。要用完整状态（下一副的牌）推演，所以联机时由房间算好随结算下发；其他阶段返回 null。
- 规则版本：`RULES_VERSION`（现在 1）。`createGame` 把它记进 `state.rules`，视角里也有 `view.rules`。改了会影响牌局结果的规则就加 1，
  并让 `rulesSupported` 继续认旧版本（旧版本的牌局要按旧规则打完）；`dispatch` 遇到不认的版本返回错误、状态不变。
  0.1.10 及以前的存档没有这个字段，`rulesOf(state)` 按 1 算，下一步的新状态会补上。
- 状态体积：整局里最大的一份状态 JSON 约 6 KB（测试卡 8 KB），房间每步整份存一次。

## 6. 事件 `GameEvent`（按顺序播放）

| 事件 | 字段 | 画面 |
|---|---|---|
| `dealStart` | `dealNo, level, declarer, levels` | 发牌动画，顶部显示本副打几 |
| `antiTribute` | `seats` | 抗贡提示 |
| `tributeAsked` | `payers` | 进贡提示 |
| `tribute` | `from, to, card` | 贡牌飞过去（公开） |
| `returnCard` | `from, to, card` | 还贡（别人视角里 `card` 为 null，用 `eventsFor(events, seat)` 裁剪） |
| `lead` | `seat` | 新一轮，谁领出 |
| `play` | `seat, play, left` | 出牌飞入；`left` 剩余张数 |
| `pass` | `seat` | 不要 |
| `trickWon` | `seat, leader, jiefeng` | 一轮结束、清桌；`jiefeng` 为真时提示"接风" |
| `finish` | `seat, place` | 头游/二游/三游标记 |
| `dealEnd` | `result`（同 `lastDeal`） | 结算弹窗 |
| `gameOver` | `winner, levels` | 整局胜负 |
| `turn` | `seat` | 轮到谁（倒计时、高亮） |

画面层拿到事件后播放，播完再用 `viewFor` 刷新静态画面；给玩家看的事件先过 `eventsFor(events, 玩家座位)`。

## 7. 存档

`state` 直接 `JSON.stringify` 存到 `localStorage['guandan.save']`（key 必须带 `guandan.` 前缀），读回来接着 `dispatch`。
`state.v` 是存档格式版本（现在为 1）；`state.rules` 是规则版本（见 5.1），两者分开：一个管存储格式，一个管玩法。

## 8. 配置项 `options`

见 `src/core/options.ts` 和 `docs/rules.md`：`fullHouseJokerPair`（三带二能否带王对，默认是）、`maxBombSize`（10）、
`aFailLimit`（打 A 失败几次退回 2，默认 3，0 = 不退回）、`endLevel`（打到几结束，默认 14 = 过 A；小于 14 时升到这一级就赢，0.25.0 的短局是 10，`endLevelOf(state)` 读，旧存档没有按 14）、`returnMaxRank`（还贡上限 10）、`antiTributeCombined`（双下合计两张大王抗贡，默认是）。
