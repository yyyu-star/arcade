# 《开盘》0.3 规则层接口（给画面层）

> 适用：v0.3 分支 `src/core`、`src/platform/storage.ts`、`src/platform/profile.ts`。第 1–13 节是 M0 原型的接口，
> **0.3.0 正式版的增量见第 14 节**（人设、难度、成就、图鉴、档案、每日挑战、新内容）。规则依据 `docs/design-0.3.md`；
> 数值都在 `src/core/balance.ts`（`BALANCE`、`fx(id, key)`），还会调，**画面不要写死数字**，一律从接口或查询函数取。
> 画面只从 `src/core/index.ts` 引用 core；存档、纪录从 `src/platform/storage.ts` 引用。

## 1. 基本约定

- 纯逻辑、完全确定：`createRun(seed, setup?)` 开局，`dispatch(state, action) → { state, events, error }` 推进。
  同一个种子 + 同一串操作（`state.actions`）永远得到同一个局面，`replay(seed, actions, setup)` 可以重建。
- `dispatch` 默认复制状态，不改传入的 `state`；`error` 非空时 `state` 原样返回、`events` 为空。
  按钮能不能点用 `validate(state, action)`（返回原因文字或 `null`），或者查询函数里的 `error / canSell` 字段，不要自己判断。
- 单位：
  - 涨跌幅、收益都是**百分点**（`5.2` 表示 +5.2%），显示用 `formatPoints(v)`。
  - 账户、月供是元，显示用 `formatMoney(v)`（≥1 万显示「万」）。
  - 热度 0..100（整数）。
  - 倍数用 `formatMult(v)` → `×1.3`。
- 规则表只有两张：玩家这边的 `Rules`（格数、每天买几只、两融倍数……，`rulesOf(state)`）和市场这边的
  `MarketRules`（当月日历、难度，`marketRulesFor(month, difficulty)`）。每个道具只改其中一格。
- **隐藏信息**画面不能显示，见第 9 节。查询函数（第 7 节）只返回能显示的东西，优先用查询函数。

## 2. GameState 关键字段（`src/core/types.ts`）

| 字段 | 说明 |
|---|---|
| `phase` | `'premarket'` 盘前（买、卖、开盘）/ `'reward'` 月度三选一 / `'event'` 事件二选一 / `'won'` / `'lost'` |
| `seed`, `setup`, `actions` | 回放三件套；`setup` 正常开局为 `null` |
| `difficulty` | 难度等级，M0 恒为 0 |
| `account` | **账户余额（元）**：唯一的分数和货币，开局 10 万 |
| `month` | 当前月份 1..12 |
| `dayInMonth` | 本月第几个交易日（0 起） |
| `dayIndex` | 全局交易日编号（0 起，= 已结算的交易日数），一局 58 天 |
| `themeIds` | 本局登场的 6 个题材（看板按这个顺序） |
| `themes[id]` | 题材：`heat`、`history`（近几天收盘热度，旧 → 新，最后一项 = heat）、`boost`（大V直播间加成）是公开的；`stage`、`lastStage`、`left`、`sure` **隐藏** |
| `stocks[id]` | 在场股票：`price`（展示用）、`move`（上一个交易日涨跌）、`boards`（连板数）、`history`（近 5 日涨跌）、`warnings`（ST 退市警告次数）、`uncap`（ST 摘帽后还要涨停几天）、`delisted` |
| `mood` | 大盘（上一个交易日）：`'bull' / 'flat' / 'bear'`，画面用窗外天气（`WEATHER_LABEL`：晴 / 多云 / 阴雨） |
| `slots` | 持仓格 `(Holding \| null)[]`，长度 = 格数（4，多开一格后 5） |
| `friends` | 群里的群友 `{ id, hits, total, topics }`（战绩 = 说中 hits / total） |
| `items` | 持有的道具 id（按获得顺序，结算时也按这个顺序触发） |
| `bill` | 本月月供 `{ month, name, amount, extras? }`（月初公布）。`amount` 是本月要还的**总额**（含突发账单）；`extras` 是本月的突发账单明细 `BillExtra[]`（`{ id, name, amount }`，没有时为空数组或缺省）。常规月供 = `amount − Σ extras.amount`，`billView` 直接给出 `base` |
| `nextBillMult` | 下个月月供倍数（信用卡代还后为 1.2） |
| `today` | 今天：`messages`（群聊消息）、`recs`（3 只推荐）、`buysLeft`（还能买几只）、`ops`（今天已买卖次数）；`plan` **隐藏** |
| `reward` | 月度奖励 `{ month, cards: RewardCard[] }`，只在 `phase === 'reward'` 时非空 |
| `event` | 当前事件 `EventState`，只在 `phase === 'event'` 时非空（展示用 `eventView`） |
| `lastDay` | 最近一天的结算明细 `DayReport`（第 5 节，结算动画的数据源） |
| `stats` | 复盘统计：`days`、`buys`、`sells`、`activeDays`、`limitUpDays`、`maxBoards`、`chains`、`peakAccount`、`billsPaid`、`trades`（每笔已了结的交易；其中 `stage` 隐藏）、`picked`、`events` |
| `endReason` | 结束原因，M0 只有 `'bankrupt'`（爆仓） |

`Holding`：`{ stockId, boughtDay, value, todayRet, lowBuy, buyFeel, buyStage(隐藏), source }`。
`value` 是买入以来的净值倍数（持有收益 = (value − 1) × 100）；`todayRet` 是上一个交易日这一格的收益（含道具），刚买入为 `null`；
`lowBuy` 表示买入时体感是冷门或降温（低吸大师用）。T+1：`dayIndex > boughtDay` 才能卖（用 `canSell(state, slot)`）。

`Message`：`{ friendId, theme, claim: 'up' | 'flat' | 'down', text, turn? }`，说的是**今天**该题材热度的变化方向；收盘后揭晓。
`turn`（可选，`'start' | 'top' | 'ebb'`）表示这条用了"拐点"说法（要起飞了 / 差不多到顶了 / 该跑了）：只由 `claim` 和公开体感决定
（冷门或降温时喊涨 → start；火热或过热时喊横 → top；不冷时喊跌 → ebb，见 `turnTalk`），不泄露真实阶段，画面可以据此换气泡样式。
群友更爱在题材的拐点（真实阶段刚切换的那天）开口，这是规则层的事，画面不用管。
`Rec`：`{ stockId, friendId, text, taken }`；`taken` 表示今天已经买过这条。

## 3. Action

| Action | 何时 | 说明 |
|---|---|---|
| `{ type: 'buy', rec, slot? }` | 盘前 | 买第 `rec` 条推荐。`slot` 缺省放进第一个空格；指定已有持仓的格子就是**替换**（原持仓卖出，算一次操作）。每天限 `buysLeft` 只（基础 1，手快 +1）。被替换的持仓也受 T+1 限制 |
| `{ type: 'sell', slot }` | 盘前 | 卖出第 `slot` 格，格子变成现金。当天买入的不能卖 |
| `{ type: 'open' }` | 盘前 | 开盘：结算今天（第 5 节），然后进入下一天或月底流程 |
| `{ type: 'pickReward', index, slot? }` | 奖励 | 选第 `index` 张奖励卡。股票卡要放进 `slot`（缺省第一个空格；满仓时必须指定，原持仓卖出） |
| `{ type: 'skipReward' }` | 奖励 | 都不要 |
| `{ type: 'choose', option }` | 事件 | 选 0 或 1 |

键盘快捷键（设计稿第 10 节）：1–3 → `buy rec 0..2`；Shift+1–8 → `sell slot 0..7`；空格 → `open`。

## 4. 事件（`GameEvent`）

`dispatch` 返回的 `events` 按发生顺序排列，画面可以逐条播放。主要类型：

| 类型 | 字段 | 何时 |
|---|---|---|
| `monthStarted` | `month, days, bill, calendar` | 月初（开局也有） |
| `dayStarted` | `day, month, dayInMonth` | 每个交易日盘前 |
| `chat` | `messages, recs` | 盘前群聊（紧跟 `dayStarted`） |
| `bought` | `rec, slot, stockId, replaced` | 买入（`replaced` 为被替换的股票或 null） |
| `sold` | `slot, stockId, holdRet` | 手动卖出 |
| `opened` | `day` | 开盘，结算动画开始 |
| `marketMoved` | `moodBefore, mood, ret` | ① 大盘天气变化 |
| `themeMoved` | `ThemeMove`（`stage` 隐藏） | ① 每个题材的热度变化，6 条 |
| `stockMoved` | `slot` + `HoldingMove` + `stock: StockMove` | ② 每格持仓揭晓涨跌（按格子顺序） |
| `chain` | `ChainLink` | ③ 龙头涨停带动同题材跟风 |
| `itemTriggered` | `itemId, slot, stockId, text, delta` | ④ 道具触发（`delta` 为这一下的改动，pp；月初打新为元） |
| `stockNews` | `stockId, news, warnings, held` | ST 摘帽 / 退市警告 / 退市（`news`：`uncap / warning / delisted`） |
| `autoSold` | `slot, stockId, reason, holdRet` | 止损单 / 止盈单 / 退市自动卖出 |
| `accountChanged` | `before, after, ret` | ⑤ 账户数字滚动 |
| `messageJudged` | `index, friendId, theme, claim, truth, hit` | 今天的消息揭晓说中没有 |
| `comment` | `friendId, text, mood` | ⑤ 群友吐槽 / 甩锅（`mood`：`smug` 得意 / `awkward` 尴尬 / `normal`） |
| `dayClosed` | `report: DayReport` | 一天结束（完整明细） |
| `billPaid` | `month, amount, before, after, credit` | 月底还月供（`credit` 为信用卡代还） |
| `bankrupt` / `runLost` | `month, amount/bill, account` | 爆仓，本局结束 |
| `rewardOffered` | `month, cards` | 三选一奖励 |
| `rewardPicked` / `rewardSkipped` | `card, slot, replaced` | 选了奖励 / 都不要 |
| `friendJoined` | `friendId, topics` | 新群友入群（开局 6 人也会发） |
| `eventStarted` / `eventResolved` | `event` / `id, option, text, delta` | 事件出现 / 选完（`text` 为结果文案，`delta` 为账户变化） |
| `runWon` | `account` | 还清 12 个月，通关 |

## 5. 一天的时序与结算明细

```
盘前：dayStarted → chat                      （玩家此时买 / 卖：bought / sold）
开盘：opened
  ① marketMoved、themeMoved × 6              题材热度变化（升温冒火、退潮结冰）、大盘天气
  ② stockMoved × 持仓数                       持仓小人依次做表情、头顶弹百分比
  ③ chain × n                                 龙头涨停 → 同题材跟风连线，跟风数字再跳一下
  ④ itemTriggered × n                         道具图标闪一下并写明改动
     stockNews、autoSold                      ST 消息、止损 / 止盈 / 退市自动卖出
  ⑤ accountChanged                            账户滚动；report.fireworks 放烟花、report.rain 下雨云
     messageJudged × n、comment × 0..2        消息揭晓、群友吐槽
  dayClosed { report }
月底（本月最后一个交易日收盘后）：billPaid（或 bankrupt → runLost）→ runWon（12 月）或 rewardOffered
选完奖励：rewardPicked / rewardSkipped →（约 40% 概率）eventStarted → 选完 eventResolved
→ monthStarted（含打新中签的 itemTriggered）→ dayStarted → chat
```

`DayReport`（`state.lastDay`、`dayClosed.report`）：

| 字段 | 说明 |
|---|---|
| `day, month, dayInMonth` | 哪一天 |
| `market` | `{ moodBefore, mood, ret }` |
| `themes: ThemeMove[]` | `{ id, heatBefore, heat, dH, ret, feelBefore, feel, stage(隐藏) }`；`dH` 是截断到 0..100 后的实际变化，`ret` 是题材当日涨幅 |
| `stocks: StockMove[]` | 当天**所有**在场股票：`{ id, move, limitUp, limitDown, boards, blown(炸板), jump(妖股跳空), chain(跟涨 pp), st }` |
| `holdings: HoldingMove[]` | 每格持仓：`{ slot, stockId, move(个股涨跌), ret(这一格最终收益), steps, holdRet, sold }`；`steps` 是收益拆解 `[{ source: 'move' 或道具 id, label, value(这一步之后的收益) }]`，画"数字再跳一下"用 |
| `chains: ChainLink[]` | `{ leader, followers, held, leaderHeld }`；`held` 是在持仓里的跟风股 |
| `triggers: ItemTrigger[]` | `{ itemId, slot, stockId, text, delta }` |
| `account` | `{ before, gross(各格加权和，两融前), ret(最终账户收益), after }` |
| `autoSold` | `[{ slot, stockId, reason: 'stop' / 'take' / 'delist' }]` |
| `messages: MessageJudge[]` | `{ index, friendId, theme, claim, truth, hit }`（收盘后可以显示 truth） |
| `comments: Comment[]` | `{ friendId, text, mood }` |
| `fireworks`, `rain` | 持仓里有涨停 / 跌停 |

账户日收益 = Σ 每格收益 × 权重，再 × 两融倍数。权重 = 1 / max(4, 持仓只数)：基础 4 格每格 1/4（空格是现金，不涨不跌）；
多开一格且拿满 5 只时每只 1/4.5（0.3.0 起，总仓位 111%；`HoldingCard.weight` 直接给出，`holdingBase(s)` 为 4.5）。

## 6. 月底与奖励、事件

- 月供在月初公布（`state.bill`、`billView`、`monthStarted.bill`），逐月上涨（12 月约为 1 月的 3–5 倍）。
  一局有 2–3 次**突发账单**（`bill.extras`，如"手机掉进马桶"），在某个月月初和月供一起公布，`amount` 已经含它们；
  画面可以把账单拆成"常规月供 `base` + 突发明细 `extras`"。哪个月会有突发是隐藏的（`surprisePlan` 只给测试和模拟用）。
- 本月最后一个交易日收盘后按总额自动扣：够还盖"已还清"（`billPaid`），
  不够且有信用卡就代还（`billPaid.credit = true`，信用卡用掉，下月月供 ×1.2），否则盖"逾期"（`bankrupt` → `runLost`）。
- 还清后三选一（`rewardView`）：道具、新群友（内幕哥、猪场老板）、稀有股票（所在题材这个月一定处于萌芽期，选了就放进持仓）。
  也可以都不要。12 月还清直接通关，没有奖励。
- 领完奖励后约 40% 概率出一个事件（`eventView`：`name, text, options[2]`），选完给出结果文案（`eventResolved.text`）。

## 7. 查询函数（`src/core/queries.ts`）

| 函数 | 返回 | 用途 |
|---|---|---|
| `themeBoard(s)` | `ThemeCard[]`：`id, name, desc, heat, trend(近 5 日热度变化), lastDelta, feel, feelLabel, stage/stageLabel(只有情绪指标时非空，为上一个交易日的真实阶段), boost, stocks` | 左栏题材看板 |
| `holdingCards(s)` | `(HoldingCard \| null)[]`：股票卡全部字段 + `slot, todayRet, holdRet, canSell, lowBuy, weight` | 中间持仓格 |
| `stockCard(s, id)` | `StockCard`：`name, theme, themeName, role, roleLabel, price, move, history, boards, face, warnings, uncap, delisted` | 推荐卡、持仓卡共用 |
| `faceOf(move, limit, delisted?)` | `'calm' / 'happy' / 'limitup' / 'worried' / 'limitdown' / 'delisted'` | 小人表情 |
| `chatView(s)` | `{ messages: MessageView[], recs: RecView[], buysLeft }`；消息带 `friend`（含战绩 `record`："准 3/5"，0.3.1 起）、`themeName`、`claimLabel`、`certain`（只有道具指定的必中才为 true，即老王的小本本；其余可信度都封顶 0.95，人设加成也不会到 1）、`turn`（"要变天了"的说法，普通消息为 `null`）；推荐带 `friend`、`stock`、`taken`、`error`（现在不能买的原因） | 右栏群聊 |
| `buyError(s, rec, slot?)` | 原因或 `null` | 替换买入前的提示 |
| `friendsView(s)` / `friendView(s, id)` | `FriendView`：`name, title, desc, hits, total, record, topics` | 群友头像、战绩 |
| `topBar(s)` | `month, day, daysInMonth, calendar, account, bill, billName, daysLeft, mood, weather, items, slots, buysLeft` | 顶栏 |
| `billView(s)` | `month, name, amount（总额）, base（常规月供）, extras（突发账单明细 `{ id, name, amount }[]`，没有时为空数组）, daysLeft, account, enough, credit` | "本月月供 ¥X · 还剩 N 天"、月初账单（含突发）、月底账单 |
| `calendarView(s)` / `currentCalendar(s)` | 12 个月 `{ month, id, name, desc, days, current, past }` | 日历（固定、提前可见） |
| `itemView(id)` | `name, kind, kindLabel, rarity, rarityLabel, desc, flavor` | 道具栏、道具说明 |
| `rewardView(s)` | 三张卡 `{ kind, kindLabel, id, name, desc, rarity, item / friend / stock }` | 月度三选一 |
| `eventView(s)` | `{ id, name, text, options }` 或 `null` | 事件 |
| `runSummary(s)` | 结束页小结：`won, account, peakAccount, month, billsPaid, limitUpDays, maxBoards, chains, bestTrade, title...` | 结束页 |
| `canSell(s, slot)`、`validate(s, action)` | | 按钮可用性 |
| `holdingBase(s)` | 每只持仓占账户比例的分母（4，或多开一格拿满 5 只时 4.5） | 一般直接用 `HoldingCard.weight` |
| `daysInMonth(m)`、`totalDays()`、`baseBill(m)` | | 日历、账单预览 |

标签表（`labels.ts`）：`FEEL_LABEL`（0.3.1 起：没人理 / 开始火 / 正火 / 太火了 / 在降温）、`STAGE_LABEL`、`ROLE_LABEL`、`MOOD_LABEL`、`WEATHER_LABEL`、
`DIR_LABEL`（涨 / 横 / 跌）、`RARITY_LABEL`、`ITEM_KIND_LABEL`、`REWARD_KIND_LABEL`、`AUTO_SELL_LABEL`、`END_REASON_LABEL`。

## 8. 内容与 id（美术按 id 出图）

- 题材 `THEMES`（8 个）：`ai, newenergy, consumer, pharma, finance, lowalt, gaming, pig`。
- 股票 `STOCKS`（26 只）：每个题材 3 只（`*_leader` 龙头，`*_follower` 跟风或 `*_blue` 白马，`*_meme` 妖股）+ `st_lazy`、`st_bye`。`stocksOf(theme)`。
- 群友 `FRIENDS`：开局 `xiaoli, laowang, zhangjie, qunzhu, laozhao, dav`；可加入 `neimu`（付费群或新群友卡）、`zhuchang`（新群友卡，需要养猪题材在场）。
- 道具 `ITEMS`（16 个）：`longtou, genfeng, baima, yaogu, lianban, dixi, zhisun, zhiying, extra_slot, double_buy, margin, ipo, credit, paid_group, notebook, mood_meter`。
- 日历 `CALENDAR`：`newyear, spring, policy_spring, annual, wuqiong, liujue, qifanshen, interim, jinjiu, guoqing, double11, yearend`（1..12 月）。
- 事件 `EVENTS`：`cousin, livestream, lottery_party, course, lottery, bonus`。
- 月供名目 `BILL_NAMES`（12 个）。
- 突发账单 `SURPRISE_BILLS`（8 个，`BillExtra.id`）：`vet, toilet_phone, wedding, wealth_class, wisdom_tooth, scratch_car, milk_tea_laptop, quantum_mattress`。
- 台词：`MESSAGE_LINES`、`TURN_LINES`（拐点说法）、`REC_LINES`、`BRAG_LINES`、`BLAME_LINES`、`CHEER_LINES`、`MOCK_LINES`（核心已经填好，画面直接显示 `text`）。

## 9. 隐藏信息（画面不能显示）

| 字段 | 说明 |
|---|---|
| `themes[id].stage`、`left`、`sure` | 题材真实阶段、阶段剩余天数、萌芽是否必成 |
| `themes[id].lastStage` | 上一个交易日的真实阶段：**只有持有情绪指标时**能显示（`themeBoard` 已处理） |
| `today.plan` | 今天预先掷好的行情（各题材热度变化、大盘）。开盘前显示等于剧透 |
| `Holding.buyStage`、`stats.trades[].stage` | 买入时的真实阶段（结束页复盘时可以考虑揭晓，局中不显示） |
| `ThemeMove.stage`（`themeMoved` 事件、`report.themes`） | 当天真实阶段：局中不显示（情绪指标的显示以 `themeBoard` 为准） |
| `turnOf(theme)`、`messageCred(...)` | 题材今天是不是拐点、消息实际说中的概率：只给测试和模拟用 |
| `surprisePlan(seed)` | 本局哪几个月有突发账单：只给测试和模拟用，画面只读当月的 `bill.extras` |

可以显示的：热度、走势、体感、大盘天气（上一个交易日）、消息与推荐、战绩、收盘后揭晓的 `truth`、低吸标记、连板、ST 警告。
注意：今天的天气（`today.plan.mood`）要等 `marketMoved` 才能换。

## 10. 存档与纪录（`src/platform/storage.ts`）

- `writeSave(state)` 每次 `dispatch` 后写；`loadSave()` 启动时读一次，返回 `{ state, notice, legacyFrom? }`：
  - `notice: 'legacy'`：读到 0.2（`legacyFrom: '0.2'`，备份在 `kaipan.save.v0.2`）或 0.1（备份在 `kaipan.save.v0.1`）的存档，提示 `LEGACY_NOTICE`（"版本大更新，旧进度无法继续"）后开新局；
  - `notice: 'corrupt'`：存档损坏，已备份到 `kaipan.save.corrupt`。
- 存档格式 `SAVE_FORMAT = 4`，存的是完整快照，不回放。`hasSave()`、`hasLegacySave()`、`clearSave()`。
- 纪录 `loadRecords()` / `recordRun(state)`：`{ version: 2, bestMonths, bestAccount, peakAccount, wins, runs }`，
  `recordRun` 返回本局刷新了哪几项（`bestMonths / bestAccount / peakAccount / wins`）。0.2 的纪录备份到 `kaipan.records.v0.2` 后重置。
- M0 没有教程，0.2 的教程标记函数已删除。

## 11. 难度接口

`DIFFICULTIES`（`content/difficulty.ts`）：M0 只有 0 级"标准"。每级可以带 `rules(r: Rules)`（如 `billMult`、`credDelta`）和
`market(r: MarketRules, month)`（如 `ebbMult`、`themeDH`），引擎按 0..level 叠加。`state.difficulty` 由 `setup.difficulty` 给定。

## 12. 调试与模拟用的开局设置

`createRun(seed, setup)` 的 `setup`：`account, items, friends, themes(6 个), holdings, difficulty, noChat`。
`noChat` 只给模拟用（关闭群聊：没有消息，推荐来自"行情软件"，`Rec.friendId` 为空串，`RecView.friend` 为 null）。

## 13. 接口变更记录

画面层按本文档开发，规则层不再随意改接口；必须改时在这里追加一条，并同步上面各节。

- 2026-10-10 首版。
- 2026-10-10 第二轮（只增不改，已有字段含义不变）：
  - 日历 3 月改名"开春政策窗口"，id `lianghui` → `policy_spring`（**唯一的改名**；画面如果按 id 取图，请同步）。
  - 突发账单：新增类型 `BillExtra { id, name, amount }`；`BillState.extras?: BillExtra[]`（`amount` 仍是总额，已含突发）；
    `BillView` 新增 `base`（常规月供）、`extras`（明细，没有时为空数组）；`monthStarted.bill` 同样带 `extras`。
    新增内容表 `SURPRISE_BILLS`，新增函数 `surprisePlan(seed, difficulty?)`（隐藏信息，只给测试和模拟用）。
  - 拐点消息：新增类型 `TurnTalk = 'start' | 'top' | 'ebb'`；`Message.turn?: TurnTalk`；`MessageView.turn: TurnTalk | null`；
    新增台词表 `TURN_LINES`，新增函数 `turnTalk(claim, feel)`（公开规则）、`turnOf(theme)` 和 `messageCred(...)`（隐藏，只给测试和模拟用）。
    `claim` 的含义不变（仍是今天热度的方向）。
- 2026-10-10 第三轮：接口无变化（只调月供数值、机器人和验收判定）。

## 14. 0.3.0 增量（正式版）

> 2026-10-10。只增不改：第 1–13 节的字段和含义不变，下面列出新增和少数行为变化（标 **变化**）。
> 内容 id 以 docs/design-0.3-release.md 第 2–4 节为准；数值都在 `BALANCE.fx[id]`，画面用查询函数和 `desc()` 取文案，不要写死。

### 14.1 开局：人设、难度、每日挑战

- 开局仍是 `createRun(seed, setup)`。正常开局的 `setup` 只带三个字段：
  `{ persona?: PersonaId, difficulty?: number, daily?: string }`（缺省 newbie、第 1 级、不是每日挑战）。
  其余字段（`account / items / friends / themes / holdings / noChat`）只给调试和模拟，带了它们的局 `isRankedSetup(setup) === false`，**不计入档案**。
- **变化**：`state.difficulty` 现在是 1..8（缺省 1；0.3.0-alpha.1 的 0 按 1 处理，>8 报错）。新增 `state.persona`。
- "同种子再来"沿用 `session.newRun(s.seed, s.setup)` 即可，人设和难度都在 `setup` 里。
- 每日挑战：`dailySetup('YYYY-MM-DD') → { date, seed, setup }`，同一天结果固定（种子 `daily-<日期>`；人设从 5 个里挑，**包括还没解锁的**，难度 2..5）。
  直接 `createRun(seed, setup)`。日期用玩家本地日期，由画面决定。
  `isDailyRun(date, seed, persona, difficulty)` 判断一局是不是货真价实的每日挑战（三者都和 `dailySetup(date)` 一致）；
  档案和"每日打卡"成就都用它校验，对不上的按普通局记。

| 人设 id | 名字 | 开局 | 解锁 |
|---|---|---|---|
| `newbie` | 职场新人阿韭 | 10 万、4 格、没有道具 | 开局可选 |
| `retiree` | 退休老周 | 8 万，白马信仰；金融、大消费必定登场；老王可信度 +0.05；常规月供 ×0.78 | 开局可选 |
| `mom` | 宝妈芳姐 | 9.4 万，打新中签；张姐可信度 +0.1 | 开局可选 |
| `coder` | 程序员小码 | 9.7 万，情绪指标；AI 必定登场；每天只能买 1 只（奖励里不出"手快"） | 银档成就 `data_driven` |
| `youzi` | 游资大佬 | 30 万，妖股猎人 + 连板梦；常规月供 ×3.25、突发账单 ×3；群主可信度 −0.1 且喊单更勤 | 金档成就 `limitup_crew` |

查询：`personasView()` / `personaView(id)` → `PersonaView { id, name, title, desc, flavor, account, items, themes, starter, unlockBy: { id, name, desc } | null }`。
内容表 `PERSONAS`、`PERSONA_IDS`，`personaById(id)`、`isPersonaId(id)`、`personaAccount(id)`。数值会调，文案一律用 `desc`。

难度（逐级叠加，`difficultiesView()` / `difficultyView(level)` → `{ level, id, name, desc, all: [{ level, name, desc }] }`；
`DIFFICULTIES`、`MIN_DIFFICULTY`(1)、`MAX_DIFFICULTY`(8)、`clampDifficulty(n)`）：

| 级 | id | 名字 |
|---|---|---|
| 1 | `slow_bull` | 慢牛 |
| 2 | `choppy` | 震荡 |
| 3 | `bear_market` | 熊出没 |
| 4 | `fake_news` | 消息失真 |
| 5 | `regulation` | 强监管 |
| 6 | `market_crash` | 股灾 |
| 7 | `inflation` | 通胀 |
| 8 | `doom` | 末日 |

每级具体加了什么看 `desc`（数值定稿见 docs/design-0.3.md 第 14 节）。哪些级别能选由档案决定（14.6）。

### 14.2 GameState 新字段（`version: 4`）

| 字段 | 公开？ | 说明 |
|---|---|---|
| `persona` | 公开 | 人设 id |
| `difficulty` | 公开 | 1..8 |
| `review` | 公开（有条件） | 熬夜复盘：`{ theme, stage, day }`，只在 `review.day === dayIndex − 1` 时有效；**直接用 `themeBoard`**，别自己读 |
| `notice` | 公开 | 本月的市场传闻（第 6 级股灾）：`MarketNotice { id: 'crash', month, name: '市场传闻', text }`，月初公布、下月清掉；没有为 null |
| `pending` | 公开 | 事件留下的延后结算 `PendingEffect[] { id(事件 id), month(哪个月月初结算), amount(本金或费用) }`；结果到期才掷 |
| `expiring` | 公开 | 临时道具 `{ id, month }[]`（量化软件试用：到那个月月底失效） |
| `busyDay` | 公开 | 这一个交易日没空看盘（加班事件），用 `topBar(s).busy` 判断 |
| `today.buys` | 公开 | 今天已经买了几只 |
| `stats.*` | 见下 | 新增 `limitDownDays, maxDayRet, surprisesPaid, creditUsed, maxThemes, maxSameTheme, monthRets, monthOpen, crashRet, acquired, itemsTaken, seenItems, seenFriends`，都是成就和图鉴用的局内统计 |

`Holding` 新增：`recBy`（推荐人 id，行情软件为空串，非推荐来的为 null）、`firstBuy`（当天第一只买入，游资席位用）、`contra`（买入当天群主唱空这个题材）、
`sawEbb`（**隐藏**：持有期间题材进过退潮）。`TradeLog` 新增 `recBy`、`contra`、`guard`（**隐藏**：高潮期买入并拿到退潮；结束页可以揭晓）。

`Message.reverse?: true`：反着信群主（道具）时群主的消息带这个标记。`MessageView` 新增 `reverse`、`readAs`（反过来读的方向）、`readAsLabel`。
画面可以把这类气泡标成"反指：实际看{readAsLabel}"。

`ThemeCard` 新增 `reviewed: boolean`：`stage / stageLabel` 现在有两个来源——情绪指标（每个题材都给）或熬夜复盘（只给被揭示的那一个，`reviewed = true`，只标注到这个盘前）。

`TopBar` 新增：`persona, personaName, difficulty, difficultyName, daily, notice, busy, expiring, pending: { id, name, month, amount }[]`。

`DayReport.crash: boolean`：今天股灾来了（收盘后才揭晓）。`RunSummary` 新增见 14.5。

### 14.3 新事件（`GameEvent`）

| 类型 | 字段 | 何时 |
|---|---|---|
| `marketNotice` | `notice: MarketNotice` | 股灾那个月月初（紧跟 `monthStarted`）。画面弹"市场传闻" |
| `crashHit` | `day, month` | 股灾当天收盘后（`dayClosed` 之前、`comment` 之后）。所有题材已经提前退潮，当天大盘暴跌 |
| `themeReviewed` | `theme, stage, day` | 熬夜复盘：每天收盘后揭示一个题材当天的阶段（在 `comment` 之后） |
| `pendingSettled` | `id, amount, delta, text` | 事件的延后结算到期（月初，`monthStarted` 之后、打新之前）；`delta` 是账户实际变化 |
| `itemExpired` | `itemId` | 临时道具到期（下个月 `monthStarted` 之前） |

道具新触发点（都走现有的 `itemTriggered`）：`value_eye` 在月底 `billPaid` 之前逐只触发（`slot/stockId` 有值，`delta` 为元）；
`diversify` 在账户结算时触发（`slot` 为 null，`delta` 为 pp），在 `accountChanged` 之前。

一天的时序补充：`… accountChanged → messageJudged × n → comment × 0..2 →（股灾日）crashHit →（熬夜复盘）themeReviewed → dayClosed`。
月初：`itemExpired × n → monthStarted →（股灾月）marketNotice → pendingSettled × n → itemTriggered(打新) → dayStarted → chat`。

### 14.4 新内容 id

- 股票（+14，共 40）：`ai_blue, ai_follower2, ne_blue, ne_follower2, con_follower, con_follower2, ph_follower, fin_follower, la_blue, gm_blue, gm_follower2, pig_blue, st_dream, st_ghost`。
- 道具（+8，共 24）：`hot_money` 游资席位、`value_eye` 价值眼光、`fan_qunzhu` 反着信群主、`diversify` 分散投资、`fomo` FOMO 体质、
  `night_review` 熬夜复盘、`crowd_fund` 众筹炒股、`rumor_mill` 小道消息。效果文案用 `itemView(id).desc`。
  **变化**：`fomo` 取消 T+1（`canSell` 对当天买的也为 true，止损/止盈当天生效）并且每天多 1 条推荐，所以 `chatView.recs` 可能有 4 条；
  `rumor_mill` 让消息最多 5 条；`zhiying` 止盈单改为"累计盈利超过 25% 之后哪天一跌就卖"（见 desc）；
  `extra_slot` 多开一格拿满 5 只时每只占 1/4.5（原来 1/5，总仓位 111%）。
- 事件（+9，共 15）：`landlord` 房东涨租、`classmate_loan` 老同学借钱、`side_hustle` 周末摆摊、`cat_keyboard` 猫踩键盘、`red_packet` 群里抢红包、
  `quant_trial` 量化软件试用、`blind_box` 炒股盲盒、`fund_manager` 理财经理来电、`overtime` 老板喊加班。仍是 `eventView` 两个选项。
- 日历：12 个月不变；`guoqing`（国庆长假）现在也有效果（节前缩量，波动变小），`desc` 已更新。
- 突发账单新增 `bailout`（"表舅在股灾里爆了仓，找你借钱救急"）：只在第 6 级以上股灾那个月月初出现在 `bill.extras` 里（美术如果按 id 出账单图标，需要补这一个）。
- 文案：core 里所有面向玩家的文案都不含 emoji（`tests/content-text.test.ts` 按 Unicode Extended_Pictographic 检查），群友台词里原来的 emoji 换成了文字。
- 推荐：**变化**（内部）同一题材里同角色的股票多了，推荐时按角色分摊权重。

### 14.5 成就、图鉴、结束页

- `ACHIEVEMENTS`（30 个，铜 10 / 银 12 / 金 8）：`AchievementDef { id, name, desc, tier: 'bronze'|'silver'|'gold', icon, unlocks?: PersonaId }`，
  `icon` 只取这 16 个：`chart_up, chart_down, fire, ice, rocket, crown, bill, cat, chat, megaphone, shield, skull, star, clover, coin, trophy`。
  查询 `achievementsView()` / `achievementView(id)` → `{ id, name, desc, tier, tierLabel(铜/银/金), icon, unlocks }`。清单见 docs/design-0.3.md 第 14 节。
- 判定：`achievementsOf(state)` 只在一局结束（`won/lost`）后返回本局达成的 id，局中返回 `[]`（有的成就用隐藏信息判定，局中判定会剧透）。
  所以"成就达成弹窗"放在结束页（或 `runWon/runLost` 之后）。
- 图鉴：`codex()` 给出全部条目 `{ stocks(40), friends(8), items(24), events(15), achievements(30) }`，每条 `CodexEntry { kind, id, name, desc, note, theme?, role?, itemKind?, rarity?, tier?, icon? }`；
  见没见过由档案的 `seen` / `achievements` 决定（画面决定点亮还是剪影）。`seenOf(state)` 给出本局见过的东西（`recordRun` 已经合并，画面一般不用直接调）。
- `runSummary(s)` 新增：`ended, seed, runId, persona, personaName, difficulty, difficultyName, daily, ranked, achievements(本局达成的 id), seen(SeenSets)`。

### 14.6 档案（`src/platform/profile.ts`，与单局存档独立）

```ts
loadProfile(store?) → { profile: Profile, notice: 'corrupt' | null }   // 启动时读一次；坏档案备份到 kaipan.profile.corrupt 并重建
saveProfile(profile, store?) → boolean                                  // 写入失败返回 false，不抛错
recordRun(profile, runSummary(state), today) → RecordResult              // 纯函数，一局结束时调用一次，然后 saveProfile；today 是玩家本地日期 'YYYY-MM-DD'（格式不对抛错）
isPersonaUnlocked(profile, id)、isDifficultyUnlocked(profile, level)、bestKey(persona, level)、emptyProfile()
```

- `Profile { version: 1, runs, wins, seen: SeenSets, achievements: Record<id, 第几局得到>, personas: PersonaId[], maxDifficulty, best: Record<'persona:level', BestRecord>, daily: Record<日期, DailyRecord>, last }`；
  `BestRecord { runs, wins, bestAccount(通关最高账户), bestMonths }`，`DailyRecord { persona, difficulty, attempts, won, bestAccount, bestMonths }`。
- `RecordResult { profile, ignored: 'unfinished'|'debug'|'duplicate'|'locked'|'future'|null, newAchievements, newPersonas, newDifficulty, newSeen, newBest, newDaily }`：
  结束页据此弹"新成就""解锁新人设""解锁第 N 级""新纪录"、图鉴新点亮。`ignored` 不为 null 时档案不变：
  - `'duplicate'`：同一局重复调用（按 `runSummary.runId` 判断；runId = 种子、人设、难度、操作数和全部操作的 FNV-1a 哈希，同种子再来、操作不同就是另一局）；
  - `'locked'`：人设或难度在档案里还没解锁（URL、调试参数等绕过标题页开的局）；**真正的每日挑战除外**（人设、难度由日期决定，可以没解锁）；
  - `'future'`：`summary.daily` 晚于 `today`（改了系统时钟或参数打开未来的每日挑战）。
- 规则：成就带来的人设随之解锁；**非每日挑战**的局通关第 N 级解锁第 N+1 级（最高 8）；每日挑战只记 `daily[日期]`、成就和图鉴，不解锁难度。
  每日挑战要校验种子、人设、难度都和 `dailySetup(日期)` 一致（`isDailyRun`），不一致的不进 `daily`，按普通局记进 `best` 并可以解锁难度。
- 旧的 `storage.ts` 的 `loadRecords / recordRun(state)`（version 2 纪录）还在、行为不变；正式版建议画面改用档案，旧纪录可以不再显示。

### 14.7 存档

- **变化**：`SAVE_FORMAT = 5`（状态 `version: 4`）。读到 0.3.0-alpha.1 的存档（format 4）：原样备份到 `kaipan.save.v0.3a`，
  `loadSave` 返回 `{ state: null, notice: 'legacy', legacyFrom: '0.3a' }`，按现有方式提示 `LEGACY_NOTICE` 后开新局（不迁移）。`hasLegacySave` 也认 format 4。
- 档案（`kaipan.profile`）和存档（`kaipan.save`）互不影响：任何一边坏了都不动另一边。

### 14.8 隐藏信息补充

| 字段 / 函数 | 说明 |
|---|---|
| `crashPlan(seed, difficulty)` | 股灾的月份和出事的交易日：只给测试和模拟用。画面只读 `state.notice`（月初才有）和收盘后的 `crashHit` / `report.crash` |
| `Holding.sawEbb`、`TradeLog.guard` | 站岗判定用，局中不显示 |
| `state.review` 以外的阶段 | 熬夜复盘只揭示一个题材、只到第二天盘前；其余题材的 `stage / lastStage` 仍然隐藏（以 `themeBoard` 为准） |
| `PendingEffect` 的结果 | 到期才掷（借钱会不会被"忘了"、摆摊分多少），画面只显示本金和到期月份 |
| `surprisePlan(seed, difficulty, persona)` | 签名多了人设（金额乘人设、难度的突发账单倍数），仍只给测试和模拟用 |

### 14.9 画面要做的改动（规则层不改 src/view）

1. 标题页：选人设（`personasView` + `isPersonaUnlocked`，锁定的显示 `unlockBy`）、选难度（`difficultiesView` + `isDifficultyUnlocked`）、每日挑战入口（`dailySetup(今天)`，显示 `daily[今天]` 纪录）。
2. 结束页：`recordRun(loadProfile().profile, runSummary(s))` → `saveProfile`；展示 `newAchievements / newPersonas / newDifficulty / newBest / newDaily`；最好成绩按 `best[bestKey(persona, difficulty)]`。
3. 图鉴页：`codex()` + `profile.seen / profile.achievements`。
4. 交易页：顶栏显示人设、难度、`notice`（市场传闻）、`busy`（加班日禁用买卖按钮——`validate` 也会给出"今天在加班，没空买卖"）、`pending`、`expiring`；
   群聊气泡处理 `reverse`；看板处理 `reviewed`；推荐可能 4 条；新事件 `marketNotice / crashHit / themeReviewed / pendingSettled / itemExpired` 的表现。
5. `src/debug/params.ts`：`difficulty` 现在是 1..8；可以加 `persona=`、`daily=`。

### 14.10 接口变更记录

- 2026-10-10 0.3.0 增量（本节）：人设、8 级难度、30 个成就、图鉴、档案、每日挑战、14 只股票、8 个道具、9 个事件。
  不兼容的只有：`state.difficulty` 取值 1..8、`SAVE_FORMAT` 5、止盈单效果、`surprisePlan` 多一个参数（有缺省值）。
- 2026-10-10 同日补充（画面层第二阶段之后，接口签名不变）：
  - `isDailyRun`；`recordRun` 和"每日打卡"都校验种子、人设、难度与 `dailySetup(日期)` 一致。
  - 文案去掉 emoji；第 6 级股灾月多一笔突发账单 `bailout`。
  - 多开一格拿满 5 只时每只 1/4.5（`holdingBase` 可能是 4.5，`HoldingCard.weight` 已按此计算）。
  - 人设数值定稿（上表）：老周常规月供 ×0.78；芳姐 9.4 万、月供不打折；小码 9.7 万；大佬常规月供 ×3.25、突发账单 ×3。文案随 `desc()` 自动更新。
  - 规则层内部（画面不用）：`MarketRules.failMult / dHNoise`、`Rules.msgNoise / turnCredMult`、`dayMarketRules(s)`、`recCredibility`。
  - **变化**（隐藏数值）：开局群友里靠谱的（小李、老王、张姐、老赵）聊擅长题材时，消息可信度 +0.15，所有加成之后封顶 0.95（`BALANCE.chat.expertMsg / credMax`）；
    `credibility()` 含这项加成，荐股用的 `recCredibility()` 不含。画面只显示战绩，不受影响。
  - 数值：月供 9,000 × 1.105^(月−1)（12 月仍约为 1 月的 3 倍）；第三个突发账单窗口改为 9–10 月。画面一律用 `billView`，不受影响。
- 2026-10-10 发布前审查修复：
  - **变化**：`recordRun(profile, summary, today)` 多了必填的 `today`（本地日期），`ignored` 多了 `'locked'`、`'future'`（见 14.6）。
  - `runSummary.runId` 加上全部操作的哈希（格式 `种子|人设|难度|操作数|8 位十六进制`），只用来判重，不要解析。
  - 可信度在所有加成之后封顶 `BALANCE.chat.credMax`（0.95，替代 `expertMsgMax`）；`MessageView.certain` 只认道具指定的必中（`credOverride`）。
    原来老周的老王、芳姐的张姐叠加人设加成后到 1，会显示"必中"并且真的必中，等于剧透当天方向。
  - `HoldingCard.canSell` 在加班日（`topBar.busy`）为 false。
  - `reviveState` 对 `stats` 里缺失或类型不对的字段补缺省值（新导出 `emptyStats(account)`）。

## 15. 0.3.1 增量（看得懂、说人话）

> 2026-10-10。规则和数值不变（同种子、同操作和 0.3.0 逐位相同，见 `tests/replay-030.test.ts`），id 不变；只加"解释"的数据和文案。
> 方案见 docs/design-0.3.1-friendly.md。新数据都只用当天已经揭晓的数，不含真实阶段，画面可以直接显示。

### 15.1 归因：今天的钱从哪来（F1）

`DayReport.holdings[]`（`HoldingMove`）新增：

| 字段 | 说明 |
|---|---|
| `parts: RetPart[]` | 这一格当天收益 `ret` 的拆解，各项 `value`（pp，两位小数）之和等于 `ret`（误差 ≤ 0.01）。第一项总是 `theme` |
| `amount: number` | 这一格今天给账户带来的盈亏（元，两位小数，不含账户层效果） |
| `lead: RetPart \| null` | 影响最大的一项（`parts` 里 `value` 绝对值最大的，相同时取靠前的；画面挑"主要原因"用）。0.3.0 旧存档为 `null` |

`DayReport.account.effects: AccountEffect[]`：账户层效果 `{ source, label, amount }`，`source` 是 `'leverage'`（借钱炒股的放大）或道具 id（如 `diversify`）。
**所有格的 `amount` 加上所有 `effects[].amount` 等于 `account.after − account.before`**（取到分，零头并进金额最大的一格）。

`RetPart { kind, value, label, theme?, dH?, itemId? }`，`kind`：

| kind | 含义 | 附带 |
|---|---|---|
| `theme` | 风口热度变化带来的涨跌（风口本身的涨跌） | `theme`、`dH`（当天热度变化） |
| `role` | 角色放大：带头大哥更猛、小弟和老实股更温和（可正可负） | |
| `market` | 今天大环境 | |
| `momentum` | 已经连续涨停的惯性 | |
| `chain` | 带头大哥涨停，带着小弟一起涨 | |
| `jump` | 过山车突然跳空 | |
| `news` | 个股消息：危险股翻身（问题解决，直接涨停）、退市 | |
| `blown` | 涨停没封住，被砸下来 | |
| `limit` | 涨跌停截断（一天最多涨 / 跌 10%，危险股 5%） | |
| `item` | 道具（每个道具一项） | `itemId` |
| `noise` | 运气：每天都有的小起伏（余项，含四舍五入） | |

- `label` 是规则层给的一整句大白话，已经带着这一项的百分比（写法见 15.7），画面直接用。
- 值为 0 的项不给（`theme` 除外）。顺序固定：theme, role, market, momentum, chain, jump, news, blown, limit, item…, noise。
- 小结卡的总账：`after − before`；"主要靠谁"可以按 `amount` 排序，或者按风口把各格 `amount` 加起来。

### 15.2 收盘新闻（F2）

`DayReport.news: NewsItem[]`，同时逐条发事件 `{ type: 'news', ...NewsItem }`（在 `comment` 事件之后、`dayClosed` 之前）。

`NewsItem { theme: ThemeId | null, dir: 'up' | 'down', value, text }`：
- 风口新闻：当天热度变化最大的风口一条（有变化就有），第二大的变化不小于 `BALANCE.news.minDH`（5）时再来一条；`value` 是热度变化。
- 全场新闻（`theme: null`）：今天大环境涨跌超过 `BALANCE.news.market`（1.2pp）时加一条，排在最前；`value` 是大环境涨跌（pp）。
- 结果揭晓后才抽，随机流独立（`rngFor(seed, 'news', day)`），不预告明天。文案池在 `THEME_NEWS`、`MARKET_NEWS`。

### 15.3 股票小人台词（F5）

`QuipMoment = 'limitUp' | 'limitDown' | 'streak' | 'delisted' | 'bought' | 'sold'`，`StockQuip { stockId, slot, moment, text }`。

- 收盘：`DayReport.quips`（并逐条发事件 `{ type: 'quip', ...StockQuip }`），每只持仓最多一句，优先级：退市 > 连续涨停（`streak`，连续涨停 ≥ 2 天）> 涨停 > 跌停 > 被止损 / 止盈自动卖出（`sold`）。
- 买入、卖出：`dispatch` 的事件里，`bought` / `sold` 之后跟一个 `quip` 事件（买入替换了旧持仓时，先给旧的 `sold` 再给新的 `bought`）。
- 也可以自己取：`stockQuip(state, stockId, moment, key?) → string | null`，同样的输入总是同一句（`key` 用来区分同一天的多次）；
  `quipLines(stockId, moment)` 给出整个台词池（这只股票自己的 + 角色通用的）。
- 随机流独立（`rngFor(seed, 'quip', …)`），不影响任何数值。

### 15.4 收盘吐槽

`DayReport.comments` 的类型不变（`Comment { friendId, text, mood }`）。第一条（任一群友）现在按优先级挑：
账户大赚（当天 ≥ `BALANCE.talk.bigWin` 4%，带金额）> 大亏（≤ −4%）> 持仓涨停 > 持仓跌停 > 踩空（某个风口热度涨了 ≥ 12 而你一只都没有）。第二条照旧是说中 / 说错的群友。

### 15.5 兼容

- 存档格式不变（`SAVE_FORMAT` 5）。0.3.0 的存档里，`lastDay` 没有上面这些字段：`reviveState` 补成空数组、`amount: 0`。
- 新导出：`makeNews`、`dayQuips`、`stockQuip`、`quipLines`、`THEME_NEWS`、`MARKET_NEWS`、`STOCK_QUIPS`、`ROLE_QUIPS`；类型 `RetPart`、`RetPartKind`、`AccountEffect`、`NewsItem`、`QuipMoment`、`StockQuip`。

### 15.6 文案

规则层所有面向玩家的文案（道具、事件、日历、人设、成就、难度、风口说明、群友台词、`labels.ts`、查询里的字符串）按 0.3.1 的词表改写（风口、带头大哥、小弟、老实股、过山车、危险股、连续涨停、涨停没封住、要变天了、不动……），
**id 不变**，名字和说明可能变化：画面一律从 `name` / `desc()` / 查询函数 / `labels.ts` 取，不要写死。

改写范围（2026-10-10 完成）：
- `labels.ts`：`FEEL_LABEL` 没人理 / 开始火 / 正火 / 太火了 / 在降温；`STAGE_LABEL` 没人理 / 开始火 / 快正火了（15.7 起） / 正火 / 太火了 / 在降温；
  `ROLE_LABEL` 带头大哥 / 小弟 / 老实股 / 过山车 / 危险股；`MOOD_LABEL`（今天大环境）好 / 一般 / 差；`DIR_LABEL` 涨 / 不动 / 跌；
  `ITEM_KIND_LABEL` 打法 / 工具 / 人脉；`AUTO_SELL_LABEL` 跌多了自动卖 / 赚够了自动卖 / 退市；`END_REASON_LABEL` 没还上钱，游戏结束（15.7 起）。`WEATHER_LABEL` 不变（只是图）。
- 道具改名（id 不变）：`longtou` 跟紧大哥、`genfeng` 小弟也吃肉、`baima` 老实人信仰、`yaogu` 过山车爱好者、`lianban` 连续涨停梦、`dixi` 抄底大师、
  `zhisun` 跌多了就跑、`zhiying` 赚够就跑、`margin` 借钱炒股、`ipo` 抽中新股、`mood_meter` 风口温度计、`hot_money` 大户专座、`fomo` 怕错过体质；其余名字不变。
  所有道具的说明改成"什么时候，发生什么"的大白话。
- 人设：`youzi` 改名"炒股大佬"（称号"大户"）；人设说明里的道具名跟着道具表走。
- 成就改名：`leader_chain` 大哥带我飞、`lianban_5` 涨停狂魔、`school_theme` 跟大哥流、`school_board` 追涨停流、`school_steady` 稳中求进流、`school_dip` 抄底流；
  流派成就的说明里的道具名跟着道具表走。
- 事件 `quant_trial` 改名"炒股软件试用"；突发账单"花呗"改成"网购分期"（不用真实产品名）。
- 风口说明（`THEMES[].desc`）、日历、难度、群友台词（消息、"要变天了"、荐股理由、得意、甩锅、道贺、调侃）、`validate` 的报错、市场传闻、群友战绩（15.7 起为"说对 3/5"，没说过话的是"新来的"）、
  奖励卡说明、结束页称号（"大户新秀"）都按新词表重写。
- `tests/content-terms.test.ts` 扫描规则层源码里的全部中文字符串、内容表和玩几局时出现的所有文案，A 股术语（题材、龙头、跟风、白马、妖股、拐点、炸板、连板、
  T+1、两融、打新、月供、大盘、说中、止损、止盈等）一律不得出现；股票名里的"ST"除外。

### 15.7 小白试读后的调整（2026-10-11）

依据 0.3.1 的新手体验评审（原始记录是临时文件，没有进仓库）。规则和数值仍不变（`tests/replay-030.test.ts` 照样逐位一致），只改数据的说法和少量字段。

**归因 `label` 的写法**（`src/core/explain.ts`）：
- 每一项都说它让这只股票涨 / 跌了百分之几；风口热度点数只当原因说："医药热度掉了 22，让它跌了 10%"。热度没变时说"风口自己小幅晃了晃"；热度方向和这一项相反时说"热度只涨了 N，风口自己反着晃了一下"。
- 跟着这只股票当天的最终方向说：和最终方向相反的项说"帮它少跌了 x%""让它少涨了 x%"；值为 0 的项说"对它没有影响"。
- 角色单列："它是带头大哥，风口的涨跌在它身上更猛，又多涨了 2.9%"；"它是小弟，只跟了风口的一半，让它跌了 3%"（老实股、危险股同理，比例来自 `BALANCE.roles[].beta`）。
- 大哥带小弟单列："大哥涨停，带着小弟一起涨，又多涨了 2%"；道具一律"道具「名字」又多涨了 / 帮它少跌了 x%"。
- 大环境："今天大环境好，大家都沾光，让它涨了 0.4%"；方向相反时"今天大环境好，帮它少跌了 0.8%，但没扛住"。
- 涨跌停："涨停了：股票一天最多涨 10%，多出来的 3% 不算（道具的加成另算，可以超过 10%）"；"跌停了：股票一天最多跌 10%，少亏了 4.6%（道具的效果另算）"。
- 余项："运气（每天都有的小起伏）让它涨了 0.3%"；个股消息"危险股翻身了（公司的问题解决了），直接涨停，……"。
- 百分比取一位小数，四舍五入为 0 时写"不到 0.1%"。`parts` 的顺序、取值、各项之和不变；新加 `lead`（见 15.1）。

**账户层效果 `AccountEffect.label`**：按最终金额说，"借钱炒股：多赚了 ¥361（亏的时候也会多亏）" / "借钱炒股：多亏了 ¥120（赚的时候也会多赚）"；道具"道具「分散投资」：少亏了 ¥88"。不再出现倍数。

**查询**：
- `ItemView.tag`、`RewardView.tag`：一行的分类"道具（常见）""新群友（稀有）""股票（传奇）"，画面用它代替"打法 / 工具 / 人脉"（`kindLabel` 还在，只给图鉴悬停用）。`RARITY_LABEL` 常见 / 稀有 / 传奇；`REWARD_KIND_LABEL` 道具 / 新群友 / 股票。
- `FriendView.record`："说对 3/5"；还没说过话（0/0）的是"新来的"。
- `difficultyView(level)` / `difficultiesView()` 新增 `detail: string | null`，`all[]` 每项也带 `detail`。`desc` 只有一句体感、不带数字；具体数字在 `detail`（画面悬停时显示）。`DifficultyDef` 新增可选的 `detail`。
- 结束页称号：账户 100 万以上为"百万韭菜王"。

**内容表**：
- `BRAG_LINES` 的类型改成 `Record<friendId, Record<Dir, string[]>>`：说对之后的得意跟着他早上说的方向（说"不动"说对了不会喊"起飞"）。`makeComments` 按 `claim` 取。
- "群主"只当韭菜收割机的身份标签（`FriendDef.title`、图鉴"群主：……"）；其余文案一律叫"韭菜收割机"：道具 `fan_qunzhu` 改名"反着信韭菜收割机"、事件 `course` 改名"韭菜收割机卖课"、`red_packet` 正文、人设 `youzi`、成就 `qunzhu_tuition` / `contrarian`、市场新闻、道贺台词、`EVENT_BLURB`。
- 道具、人设的说明不再用乘号：借钱炒股"每天赚的钱多 8%，亏的钱也多 8%"、众筹炒股"每月要还的钱少 8%"、分散投资"亏钱的日子只亏七成"、多开一格、小弟也吃肉、连续涨停梦、赚够就跑、付费群（"大约九成对"）、小道消息、风口温度计、价值眼光（"公司给股东发的钱"）、信用卡（"多 20%"）、老实人信仰（"只亏一半"）；数字都从 `BALANCE` / `fx` 取。
- 难度 8 级都改成一句体感 + `detail`；事件 `red_packet`、`livestream`、`fund_manager`、`blind_box` 的选项和结果按试读意见改写；群友台词去掉"有人要拉了""目标价翻三倍""大户在吓唬散户"；
  成就"韭菜的自我修养"说明改成"第一次没还上钱，游戏结束"，"猫比我有钱"说明引用那笔突发账单的名字；股灾那个月的突发账单改成"表舅在股灾里亏光了……"。
- 台词：带头大哥被买入时"跟着我，有肉吃。"；奶茶续命"第二杯半价，你先把第一杯买了。"

**术语扫描**（`tests/content-terms.test.ts`）新增：爆仓、种子、随机波动、摘帽；"分红"只许出现在括注里；"群主"只许当身份标签；"拉"只许用在"拉你、拉进群、拉扯"这类意思上（`拉` 后面必须跟"你我他她进群扯黑"之一），不许当"拉升"讲。

