# 《开盘》规则层接口（现行）

> 这是规则层（`src/core`）对画面层、工具和测试的现行接口说明，按代码现状写；和代码对不上时以代码为准（先看 `src/core/index.ts` 的导出和 `src/core/types.ts`）。
> 各版本加了什么见 `CHANGELOG.md`；设计依据在 `docs/design-*.md`，数值的配平记录在 `docs/design-balance.md`。
> 画面只从 `src/core/index.ts` 引用 core；存档、档案、云同步在 `src/platform/`，不在本文范围。

## 1. 总则

- **纯函数、完全确定**：`createRun(seed, setup, opts)` 开局，`dispatch(state, action)` 推进，同一个种子 + 同一个行情段 + 同一串操作（`state.actions`）永远得到同一个局面；
  `replay(seed, actions, setup, opts)` 重建。行情段、`ext`、`tempo` 三个开局选项必须和原局一致，回放才逐位相同：
  `replay(seed, actions, setup, { segment, ext: !!state.ext, tempo: !!state.tempo })`（`segment` 要给同一个行情段，`state.real.segId` 是它的 id）。
- **随机一律用 `rngFor(seed, 用途, …)`**（`rng.ts`，sfc32）：按用途分流，行情、情报、商店、新闻、台词各用各的流，改一处不扰动别处。
  `hashSeed`、`createRng` 同在 `rng.ts`。
- **禁止的 API**：`src/core` 里不许 `Math.random`、`Date.now`、`new Date`，也不许结果依赖平台的数学函数（`Math.exp/log/pow/sin/cos` 等）；
  只用加减乘除、比较、`Math.imul` 之类。`tests/architecture.test.ts` 扫源码卡这条。真实行情的映射路径同样只有四则运算。
- **core 不依赖 DOM、Phaser、网络**；画面只读状态和事件，不自己算规则。按钮能不能点用 `validate(state, action)`（返回原因文字或 `null`），
  或查询函数里的 `error / canSell` 字段，不要自己判断。
- **`dispatch(state, action, opts?) → { state, events, error }`**：默认 `structuredClone` 后改副本，传入的 `state` 不动；
  `error` 非空时 `state` 原样返回、`events` 为空。`opts.events = false` 不收集事件、`opts.inPlace = true` 原地改（模拟器提速用，画面不要用）。
- **单位**：涨跌幅、收益都是百分点（`5.2` = +5.2%），显示用 `formatPoints`；账户、月供是元，显示用 `formatMoney`（≥1 万显示「万」）；
  热度是 0..100 的整数；倍数用 `formatMult`；`formatPct` 在 `format.ts`。
- **规则表只有两张**：玩家这边的 `Rules`（格数、每天买几只、杠杆、手续费、涨跌停倍数……，`rulesOf(state)`）和市场这边的 `MarketRules`
  （当月日历与难度对合成行情的修正，`marketRulesFor`）。难度、人设、道具、月度主题各改其中几格，叠加顺序在 `market.ts` 的 `rulesFor`。
- **数值都在 `balance.ts`**（`BALANCE`、`fx(id, key)`）。画面不要写死数字，一律从接口、查询函数或 `desc()` 取（见第 12 节）。
- 玩家看得见的文案不含 emoji、不用 A 股术语（`tests/content-text.test.ts`、`tests/content-terms.test.ts` 扫描）；名字和说明可能随版本改，id 不变，
  画面一律取 `name / desc()` / `labels.ts`。

## 2. 入口函数（`engine.ts`、`index.ts`）

```ts
createRun(seed: string, setup: RunSetup | null = null, opts: CreateOptions = {}): { state: GameState; events: GameEvent[] }
dispatch(prev: GameState, action: Action, opts?: DispatchOptions): DispatchResult
replay(seed, actions, setup, opts): GameState        // 任何一步非法都抛错
validate(state, action): string | null
```

`CreateOptions`：

| 字段 | 含义 |
|---|---|
| `segment` | 抽中的行情段（第 7 节）。缺省或 `null` = 合成行情：离线兜底、`?market=synthetic`、行情段下载失败时走它；一局最少要 `totalDays()`（58）天 |
| `ext` | 打开仓位、押跌、抵押（第 8 节）。正式游戏都开；不开时新操作报「这一局没有这个玩法」，新道具不进奖励池 |
| `tempo` | 月度主题、目标、高光、连击（第 9 节）。缺省：有行情段就开、合成行情关 |
| `legacyReal` | 真实行情用旧映射（风口热度推着个股走）。只给对照和读旧档的测试用 |

`createRun` 返回的 `events` 是第 1 个月的开场事件（`monthStarted`、`monthTheme`、`dayStarted`、`chat`）。

`RunSetup`（开局设置，存进 `state.setup`，正常开局为 `null` 或只带前几项）：

| 字段 | 说明 |
|---|---|
| `persona` | 人设（缺省 `newbie`），见第 11 节 |
| `difficulty` | 难度 1..8（缺省 1，`MIN_DIFFICULTY / MAX_DIFFICULTY / clampDifficulty`；超过 8 报错） |
| `daily` | 每日挑战日期 `YYYY-MM-DD`（由 `dailySetup` 给出） |
| `short` | 娱乐短局：`{ months, billMult, goal }`，由 `shortSetup(persona, difficulty)` 给出（第 10 节） |
| `live` | 实盘：`{ months, billMult, lev?, tier?, gear? }`，由 `liveSetup(tier, persona, x)` 给出（第 10 节） |
| `account / items / friends / themes / holdings / noChat` | 只给调试、测试、模拟：开局资金、道具、额外群友、指定 6 个风口、开局持仓、关闭群聊（推荐来自「行情软件」，`Rec.friendId` 为空串） |

`isRankedSetup(setup)`：只带 `persona / difficulty / daily / short` 才算正常开局，才计入档案和成就；带了调试字段的局不计。
`checkSetup` 会拒绝无效设置（未知 id、风口不是 6 个不重复、实盘与每日挑战同时给等）并抛错。

## 3. GameState（`types.ts`）

字段很多，类型看 `types.ts` 的 `GameState`，这里只讲不显然的。**标 隐藏 的画面不能显示**（显示等于剧透）。

| 字段 | 说明 |
|---|---|
| `phase` | `premarket` 盘前（买卖、开盘）/ `reward` 月度三选一 / `event` 事件二选一 / `won` / `lost` |
| `seed, setup, actions` | 回放三件套 |
| `persona, difficulty` | 人设、难度 |
| `account` | 账户余额（元），唯一的分数和货币。实盘的「资产」= 账户 − 欠银行的钱（`liveAssets`） |
| `month, dayInMonth, dayIndex` | 月份 1..12；本月第几个交易日（0 起）；全局交易日编号（0 起，= 已结算天数）。一局 58 天：每月 5 天，10 月 3 天（`BALANCE.monthDays`） |
| `themeIds / themes[id]` | 本局登场的 6 个风口（看板顺序）及状态。公开：`heat`、`history`（近几天收盘热度，最后一项 = heat）、`boost`（直播间加成）。**隐藏**：`stage`、`lastStage`、`left`、`sure`、`age`、`rebound` |
| `stocks[id]` | 在场股票：`price`（展示用）、`move`（上一交易日涨跌）、`boards`（连板数）、`history`（近 5 日）、`warnings`、`uncap`（ST 状态）、`delisted` |
| `mood` | 大盘（上一个交易日）`bull / flat / bear`，画面用窗外天气（`WEATHER_LABEL`）。今天的天气要等 `marketMoved` 才换 |
| `slots` | 持仓格 `(Holding \| null)[]`，基础 4 格（`extra_slot` 多一格）。只增不减 |
| `friends` | 群友 `{ id, hits, total, topics }`，战绩 = 说中 hits / total |
| `items` | 持有道具 id（按获得顺序，触发也按这个顺序） |
| `bill` | 本月账单 `{ month, name, amount, extras? }`。`amount` 是本月要还的总额（含突发账单、短局首付、杠杆利息）；常规月供 = `amount − Σextras.amount`，`billView` 直接给 `base` |
| `nextBillMult` | 下月月供倍数（信用卡代还后 1.2） |
| `today` | 今天：`messages`、`recs`、`buysLeft`、`ops`、`buys`、`quiet`（盘前平淡日，第 9 节）；**`plan` 隐藏**（今天预先掷好的行情） |
| `reward / event / lastDay` | 月度奖励（仅 `phase === 'reward'`）、当前事件（仅 `'event'`，展示用 `eventView`）、最近一天的结算明细 `DayReport` |
| `review / notice / pending / expiring / busyDay` | 熬夜复盘揭示（`review.day === dayIndex − 1` 时有效，**直接用 `themeBoard`**）、本月市场传闻、事件的延后结算、临时道具、加班日（用 `topBar(s).busy`） |
| `stats` | 复盘统计，成就和结束页用；`trades[]` 里的 `stage / guard` **隐藏**，结束页才能揭晓 |
| `endReason` | `bankrupt`（没还上账单）或 `margin`（实盘杠杆跌破清零线） |
| `real` | 本局的真实行情（第 7 节），**整段含未来的走势，画面绝对不能读**；合成行情为 `null` |
| `ext / tempo / watch` | 仓位押跌抵押状态；月度主题状态（`tempo.plan` 是 12 个月的主题，**只能显示已经到的月份**）；`watch` 是还没揭晓的多日消息（**隐藏**，只存说法） |

`Holding`：`stockId, boughtDay, value`（买入以来的净值倍数，持有收益 = (value − 1) × 100）、`todayRet`（刚买入为 `null`）、`lowBuy`、`recBy`、`units`、`short`、`squeezed` 等。
隐藏：`buyStage`、`sawEbb`。**T+1**：`dayIndex > boughtDay` 才能卖（`canSell(state, slot)`）；道具 `fomo` 取消 T+1。

`Message`：`{ friendId, theme, claim: 'up'|'flat'|'down', text, turn?, reverse?, days?, big? }`。`claim` 是群友对该风口方向的说法：
合成行情说的是「今天热度的变化」，真实行情说的是「从今天起 `days` 天（1–3）的累计涨跌」。`turn`（`start / top / ebb`）是拐点说法，只由说法方向和公开体感决定，不泄露真实阶段。
`Rec`：`{ stockId, friendId, text, taken, short?, days?, big? }`；`short` 是空军老周建议押它跌。

## 4. 操作（Action）

| Action | 何时 | 规则 |
|---|---|---|
| `{ type: 'buy', rec, slot?, size?, short? }` | 盘前 | 买第 `rec` 条推荐。`slot` 缺省放第一个空格；指定已有持仓的格子 = **替换**（原持仓卖出，也受 T+1）。每天限 `buysLeft` 只。`size`（`taste / half / heavy`）和 `short` 只在 `ext` 局可用 |
| `{ type: 'sell', slot }` | 盘前 | 卖出，格子变现金。当天买入的不能卖 |
| `{ type: 'add', slot }` | 盘前，ext | 加 1 份（现金不够有多少加多少），算一次买入（`freeAdd` 道具除外） |
| `{ type: 'trim', slot }` | 盘前，ext | 份数减半，至少留 0.5 份；T+1 同卖出；不记一笔交易 |
| `{ type: 'borrow', id }` / `{ type: 'repay', id }` | 盘前，ext | 抵押借钱 / 还钱赎回（第 8 节） |
| `{ type: 'open' }` | 盘前 | 开盘：结算今天，然后进入下一天或月底流程 |
| `{ type: 'pickReward', index, slot? }` / `{ type: 'skipReward' }` | 奖励 | 选第 `index` 张卡；股票卡要放进 `slot`（缺省第一个空格；满仓必须指定，原持仓卖出）/ 都不要 |
| `{ type: 'choose', option }` | 事件 | 选 0 或 1 |

加班日（`isBusy`）不能买卖；`rec.taken` 的推荐不能重复买；手里已有的股票不能再买。键盘快捷键是画面层的事（1–3 买、Shift+1–8 卖、空格开盘）。

## 5. 一天的时序与事件（GameEvent）

`dispatch` 返回的 `events` 按发生顺序排列，画面可以逐条播放。类型完整定义见 `types.ts` 的 `GameEvent`。

```
盘前：dayStarted → chat                       玩家买卖：bought / added / trimmed / sold（各自跟一个 quip）、borrowed / repaid
开盘：opened
  ① marketMoved、themeMoved × 6               大盘天气、风口热度变化
  ② stockMoved × 持仓数（按格子顺序）、squeezed   每格持仓揭晓涨跌
  ③ chain × n                                 龙头涨停带跟风（合成行情；真实行情只播报识别出的跟涨）
  ④ itemTriggered × n、stockNews、autoSold     道具、ST 消息、止损/止盈/退市自动卖出
  ⑤ accountChanged                            账户滚动
     bankCalled / seized                      银行打电话、收走抵押物（ext）
     messageJudged × n、intelJudged × n        今天的消息揭晓；前几天发的 2–3 天消息到期揭晓
     comment × 0..2、news × n、quip × n       群友吐槽、收盘新闻、股票小人台词
     crashHit（股灾日）                         
     spotted、highlight、combo、goalProgress/goalDone/goalFailed   节奏事件（第 9 节）
     themeReviewed（熬夜复盘）
  dayClosed { report }
月底（本月最后一个交易日收盘后）：
  [interestPaid（有借款）] → billPaid（含 credit: true 信用卡代还）或 bankrupt → runLost
  → [seized] → runWon（打完最后一个月）或 rewardOffered
选完奖励：rewardPicked / rewardSkipped（可能 friendJoined）→（约 40%）eventStarted → eventResolved
→ itemExpired × n → monthStarted → [marketNotice] → [pendingSettled × n] → [itemTriggered(打新)] → monthTheme → dayStarted → chat
```

要点：
- 实盘杠杆的 `gearWiped` + `runLost { reason: 'margin' }` 在收盘后（`dayClosed` 之后）和月底还完账单后各查一次。
- 道具触发点还有：`value_eye` 在月底 `billPaid` 之前逐只触发（`delta` 为元）；`diversify` 在账户结算时触发（`slot` 为 `null`，`delta` 为 pp），在 `accountChanged` 之前。

`DayReport`（`state.lastDay`、`dayClosed.report`，结算动画的数据源）：

| 字段 | 说明 |
|---|---|
| `market`, `themes[]` | 大盘 `{ moodBefore, mood, ret }`；每个风口 `{ id, heatBefore, heat, dH, ret, feelBefore, feel, stage(隐藏) }`，`dH` 是截断到 0..100 后的实际变化 |
| `stocks[]` | 当天**所有**在场股票 `StockMove`：`move, limitUp, limitDown, boards, blown, jump, chain, st, wild?, follow?` |
| `holdings[]` | 每格持仓 `HoldingMove`：`move`（个股）、`ret`（这格最终收益）、`parts`（归因）、`lead`（影响最大的一项）、`amount`（给账户带来的元）、`steps`、`holdRet`、`sold`、`units / short / squeeze` |
| `account` | `{ before, gross, ret, after, effects[] }`；**所有格的 `amount` 加上 `effects[].amount` 等于 `after − before`**（取到分，零头并进金额最大的一格） |
| `chains, triggers, autoSold, messages, intel?, comments, news, quips, bank?` | 如其名。`messages[].truth` 是收盘后才可以显示的真相 |
| `fireworks, rain, crash` | 持仓有涨停（烟花）/ 跌停（下雨）/ 今天股灾（收盘后才揭晓） |
| `tempo?` | `DayTempo { quiet, highlights, combos, goal, streak }`，无月度主题的局没有 |

**归因** `RetPart { kind, value, label, theme?, dH?, itemId? }`：`parts` 各项 `value` 之和等于 `ret`（误差 ≤ 0.01）；`label` 是规则层给的整句大白话，已带百分比，画面直接用。
`kind` 取 `theme / role / market / momentum / chain / jump / news / blown / limit / item / noise / short / squeeze`，顺序固定，值为 0 的项不给（`theme` 除外）。
真实行情下：`market` = 放大后的大盘，`theme` = 放大后的（行业 − 大盘），`noise` = 个股自身（股票 − 行业），`limit` = 涨跌停截断，之后才是道具。
账户日收益 = Σ 每格收益 × 份数 ÷ `holdingBase(s, Σ份数)`，再 × 杠杆倍数（借钱炒股道具）。
基础 4 格每格 1/4（空格是现金，不涨不跌）；多开一格拿满 5 只时每只 1/4.5（`extra_slot.share` 0.5，总仓位 111%），`HoldingCard.weight` 已算好。

## 6. 查询函数（`queries.ts`、`extview.ts`、`meta.ts`）

画面优先用查询函数：它们只返回能显示的东西，并处理了隐藏信息的条件（情绪指标、熬夜复盘等）。

| 函数 | 返回 / 用途 |
|---|---|
| `themeBoard(s)` | 风口看板 `ThemeCard[]`：`heat, trend, lastDelta, feel/feelLabel, stage/stageLabel`（只有持有情绪指标，或被熬夜复盘揭示的那个才非空，`reviewed` 标记后者）、`boost, stocks` |
| `holdingCards(s)` / `stockCard(s, id)` | 持仓格（空格为 `null`）/ 股票卡。`HoldingCard` 多 `slot, todayRet, holdRet, canSell, lowBuy, weight, units, short`；`canSell` 已考虑加班日 |
| `chatView(s)` | `{ messages: MessageView[], recs: RecView[], buysLeft }`。消息带 `friend`（含 `record`：「说对 3/5」，没发过言是「新来的」）、`certain`（只有道具指定的必中，即老王的小本本）、`turn`、`reverse / readAs`（反着信群主：「实际看…」）；推荐带 `error`（现在不能买的原因）、`short` |
| `buyError(s, rec, slot?)` | 替换买入前的提示 |
| `buyOptions(s, rec, slot?)` | 买法选项：`sizes[]`（每个带份数、`error`、重仓的冲击成本 `cost / note`）和 `short`（解锁与否、原因、是否群友建议） |
| `positionsView(s)` / `bankView(s)` / `bankRisk(s)` | 份数与现金份数、银行（欠款、警戒线、可押物品、月息）/ 月底付账单会不会跌破线（盘前提示用） |
| `friendsView / friendView` | 群友名、身份、战绩、擅长风口 |
| `topBar(s)` | 顶栏：月日、账户、账单、剩余天数、天气、道具、格数、人设难度、`daily`、`notice`、`busy`、`live`（实盘档位名/一份/按现在资产能结回多少）、`expiring`、`pending` |
| `billView(s)` | `amount`（总额）、`base`（常规）、`extras`（突发明细）、`enough`、`credit` |
| `calendarView / currentCalendar` | 12 个月日历；真实行情下 `desc` 自动换成 `realDesc`（老话说……涨跌照真的走） |
| `itemView(id)` / `rewardView(s)` / `eventView(s)` | 道具（`tag`「道具（常见）」、`brief` 短版）、三选一卡、事件（`brief`、`picks`） |
| `monthThemeView(s)` | 本月主题与目标（第 9 节） |
| `storyView(s)` | 局末「这段日子」（第 7 节） |
| `runSummary(s)` | 结束页小结：`won, account, peakAccount, month, billsPaid, bestTrade, title, style, startAccount / billMoney / tradeMoney / otherMoney / debtLeft`（账：本钱 + 炒股 − 账单 + 其他 + 没还的借款 = 最后剩）、`runId`（只用来判重，不要解析）、`ranked, short, live, achievements, seen, segment, knowledge, recap` |
| `preHistory(s)` | 开局前 `warm` 天已发生的走势（大盘、个股、风口热度），按交易日同样的放大与截断算；合成行情补 20 天。画面画「开局前走势」只用它 |
| `validate / canSell / canShortNow / holdingBase / daysInMonth / totalDays / baseBill` | 按钮可用性与日历、账单预览 |

标签表在 `labels.ts`（`FEEL_LABEL`、`STAGE_LABEL`、`ROLE_LABEL`、`WEATHER_LABEL`、`DIR_LABEL`、`RARITY_LABEL` 等）。

元数据查询（`meta.ts`）：`personasView / personaView`、`difficultiesView / difficultyView`（`desc` 只有一句体感，具体数字在 `detail`；真实行情下用 `realDesc / realDetail`）、
`achievementsView`、`achievementsOf(state)`（**一局结束后才返回**，局中判定会剧透）、`codex()`（图鉴全部条目，点亮由档案决定）、`seenOf`、`runId`。

## 7. 真实行情与行情段文件

### 7.1 两种行情模式

| 模式 | 条件 | 行为 |
|---|---|---|
| 真实行情 | `createRun` 给了 `segment`；`state.real.track === true` | 个股、风口、大盘照搬绑定的真实走势；情报读真实未来；`tempo` 默认打开 |
| 合成行情 | 不给 `segment` | 风口生命周期（冷门 → 萌芽 → 发酵 → 主升 → 高潮 → 退潮）、随机行情、日历与难度改走势；没有 `tempo` |

合成行情完整保留，`tests/replay-030.test.ts` 在这个模式下固定若干局，要求逐位不变：改合成路径的代码前先跑它。
`state.real` 里没有 `track` 的是旧存档，走旧映射（`market.ts` 的 `rl` 分支），没有月度主题。

### 7.2 真实行情怎么算（`market.ts` 的 `moveStocksTrack`、`real.ts`）

- 当天涨跌 = `BALANCE.track.amp`（2，所有股票相同）× 绑定的真实股票当天总收益，再按涨跌停截断：跌停 = 角色涨跌停（10，ST 5）× `rules.limitMult`，涨停再 × `rules.limitUpMult`。
  风口（看板）涨跌 = amp × 真实行业等权收益；大盘 = amp × 老三十。日历、难度、道具、事件、股灾都不再改大盘和个股。
- 风口热度和阶段（只是信息，不影响涨跌）：行业相对「所有行业平均」的超额收益按 `real.smooth`（0.35）指数均摊，让风口有惯性；
  热度变化 = `heatGain × ex / scale − heatPull × (热度 − heatBase)` + 加成。阶段是状态机（冷 → 冒头 → 发酵 → 主升 → 高潮 → 退潮 → 冷，冒头可夭折、发酵可证伪），
  门槛在 `BALANCE.real.stage`。大盘天气看最近 `moodDays`（3）天放大后的大盘均值，≥ `track.moodBull` 晴、≤ 负值雨。
- **识别**（只播报，不改涨跌，`StockMove` 上）：连板（触及涨停则 `boards + 1`，≥ 2 发 `spotted`）；炸板（前一天涨停、今天跌 ≤ `track.blown`）；
  妖股异动（过山车股 |涨跌| ≥ `track.wild`，`jump` 恒为 0）；跟涨（同风口大哥涨停、小弟涨 ≥ `track.follow`，`chain` 恒为 0）。
  危险股跌停记一次退市警告、有警告时涨停摘帽，真实行情下不会退市。
- **性格校正** `fitRoles`（开局）：每个风口内按这一段（开局前 + 一局）的真实表现重新分配绑定序列：过山车 ← 相对行业残差波动最大；危险股 ← 整段跌得最多；
  带头大哥 ← 对行业 β 最大；老实股 ← 波动最小；其余当小弟。只决定显示和情报口吻。`node tools/realness.ts` 实测个股逐日相关 ≥ 0.9。
- **股灾**（难度 6）：月份和日子对齐段内股灾可选月份里大盘真实跌得最多的一天（跌 ≥ 1.5% 才对齐，否则按种子，`real.crashReal`）；风口热度一起退潮，突发账单照旧，不再额外压大盘。
  `crashPlan(seed, difficulty, real?)` 是隐藏信息（只给测试和模拟）；画面只读 `state.notice` 和收盘后的 `crashHit / report.crash`。
- **情报从真实未来推算**（`chat.ts`）：
  - 消息：说的是风口接下来 `days` 天（含今天，1–3，权重 `intel.days` 8:3:1）的累计涨跌方向，累计在 ±`intel.flat[days−1]` 以内算「横」（`themeTruth`）。
    说中概率 `messageCred`：`intel.cred[群友]`（擅长 / 不擅长）+ 每局状态 `chat.form`（±0.05）+ 加成（开局靠谱群友聊擅长 `expertMsg`、拐点 `turnCred`）
    − `intel.diffStep` × (难度 − 1)，封顶 `chat.credMax` 0.95；只有道具指定的必中（`credOverride`）能到 1。说错时群主 80% 直接反着说，空军老周一律唱空，其余随机另一个方向。
  - `days = 1` 当天收盘揭晓（`messageJudged`）；`days > 1` 进 `state.watch`，到期那天收盘揭晓（`intelJudged`，`report.intel` 带 `day / days`）。战绩两种都算。
  - 推荐：推荐人对每只候选股以 `recCredibility` 的概率看对它接下来 `rec.days` 天的真实方向（±`intel.stockFlat`），在看涨的里按角色权重挑；空军老周挑看跌的押跌。
  - 重磅情报（`Message.big`）：今天真实涨跌幅度最大的风口，由群里最靠谱的人说，准确率 `intel.headline` 0.85；月末前一天本月还没有高光时，月度主题补一条（`needsHeadline`）。
  - 收盘新闻多一条预告（`NewsItem.ahead`，准确率 `intel.news`）；稀有股票奖励卡是「内部消息：下个月走势偏强」（`intel.headline` 的概率是真的）。
  - 隐藏、只给测试和模拟：`themeTruth / stockTruth / forwardRet / messageCred / turnOf`。画面显示的走势、强弱只能用已发生的数据和 `preHistory`。
- **月供**：真实行情下常规月供再 × `track.billMult`（0.5）× `track.regimeBill[市况]`（牛 1.1、泡沫 1.25、横盘 0.95、熊 0.9、崩盘 0.95）。市况不公开，局末才揭晓。

难度在真实行情下的效果由各难度的 `realRules` 给出（`realDesc / realDetail`）：震荡月供略增；熊出没每次买入收 `buyFee` 0.6%；消息失真；强监管涨停那一头 × 0.7；股灾见上；7、8 月供与坏事。道具、日历在真实行情下只剩信息或结算类效果，不改走势。

### 7.3 行情段文件

`public/data/segments/index.json`：`{ v: 1, source, segments: [{ id, file }] }`（目录顺序决定「按种子取第几个」，顺序不变则同一种子抽到同一段）。
`public/data/segments/<id>.json` 的类型是 `segment.ts` 的 `Segment`，要点：

| 字段 | 含义 |
|---|---|
| `id` | 不透明 id：`seg_` + 加盐哈希前 10 位十六进制；盐只在 `tools/data/segments.ts` |
| `warm / days` | 20 / 58；所有逐日数组长度 = `warm + days`，下标 `warm` 是第一个交易日 |
| `regime / title / stats` | 市况 `bull / bubble / flat / bear / crash`（`REGIME_LABEL`）、游戏化标题（`SEGMENT_TITLES`）、`{ ret, dd, ref }`（比例） |
| `events[]` | 最多 4–5 条大事 `{ day, t?, alt?, sectors }`：一局里第几个交易日、故事句（`t` 可含 `{股}{风口}`，对不上本局风口用 `alt`）、相关行业。不带真实日期和原文 |
| `market` | 大盘（老三十）逐日收益，**基点整数** |
| `themes.<风口>` | `{ sector, name, r, stocks }`：主行业 id、行业大白话、行业等权逐日收益（基点）、绑定股票；8 个风口全在文件里，开局才决定哪 6 个登场 |
| `themes.<风口>.stocks[]` | `{ slot, id, name, sec, r }`：游戏股票 id、段内编号（`<风口>_<n>`，不含真实代码）、`name` 恒为 null、真实行业、逐日总收益（基点，含拆股分红） |

规矩：
- **防泄漏**：玩家能在网络面板看到这些文件，所以文件名、目录、内容里都不能有年份、日期、大事原文、真实代码。`tests/segments-leak.test.ts` 扫所有文件。
  id 与真实年份的对照只在 `tools/data/segments-manifest.json`（工具和测试用，不进画面包）。不存任何价格，只存相对涨跌。
- 风口 ↔ 真实行业的对应在 `segment.ts` 的 `THEME_REAL`。`checkSegment(raw, themeIds)` 校验下载来的段，不对就退回合成行情。
- 开局 `realFromSegment(seg, themeIds, stockIds, smooth)` 只取登场风口和绑定股票的部分存进 `state.real`（约 15KB，进存档；读档、回放不再下载），并算好每个行业的 `ex`（均摊超额）与 `scale`（归一尺度）。
- `pickSegmentId(seed, ids, hash)`：同一种子同一份目录抽到同一段。每日挑战只在冻结的段池 `DAILY_SEGMENTS` 里抽（`dailySegmentId(date)`），段库加了新段也不变。
- 数据管线（`tools/data/`）在开发机上跑，产物进仓库、原始数据不进，见 `AGENTS.md` 第 5 节；段库现为 135 段，开局日两两至少隔 39 个交易日。

### 7.4 局末故事

`storyView(state)`（`reveal.ts`）→ `{ regime, regimeWord, title, lines, verdict, marks? }`；合成行情为 `null`。`runSummary(state).segment`（`SeenSegment`）带上故事，档案图鉴里可以重看。
拼法是确定的（按种子 + 段 id + 本局结果）：开头（按市况）→ 大环境和冷热风口 → 段内大事的故事版（最多 3 条，只讲玩家撑到的那段）→ 经历（被收走 > 赎回 > 押到年底 > 押跌 / 被轧 > 重仓，模板 `EXT_TALES`）
→ 赚得最多 / 亏得最多的一笔 → 跟得最多的群友 → 结局；超过 8 句时先省大环境、再省群友。时间一律说游戏内的「第二个月月底」。
伤亡、灾害、袭击、停市、选举类大事用 `SENSITIVE_WORDS` 过滤；故事里不能出现四位年份、真实日期、化名、内部 id、段 id（`tests/story.test.ts` 扫描）。

## 8. 仓位、押跌、抵押（`ext`）

`createRun` 带 `ext: true` 才有，`state.ext = { loans, called, learned, log }`。数值在 `BALANCE.ext`，`node tools/sim.ts --set ext.xxx=…` 可临时覆盖。

**仓位**：1 份 = 账户的 1/4，总份数 = 格子数。`taste` 1 份（`ext.taste`）、`half` 2 份、`heavy` 剩下全部现金；换股时那一格的份数先回来；现金不到半份（`minUnit` 0.5）不能买。
超过 1 份时这一笔多花 `impact`（1.2）× (份 − 1) pp 的冲击成本。`add` +1 份，`trim` 减半（至少留 0.5）。引擎：`unitsOf / usedUnits / freeUnits / sizeUnits`。

**押跌**：`canShortNow(s)` = `rules.canShort`（押跌许可证道具、人设炒股大佬）或 `difficulty ≥ ext.shortLevel`（现为 99，难度不送；送了会让难度梯度倒挂）。
押跌那一格收益 = −个股涨跌 − `shortFee`（0.3）+ 顺风逆风 `shortWind`：真实行情看开盘前 20 个交易日大盘累计涨跌 × −`shortWeather`/2，封顶 ±1.5 × `shortWeather`（2）pp；
合成行情晴天 −`shortWeather`、雨天 +`shortWeather`。个股涨停（被轧）时再 − 涨幅 × (`squeeze` 1.5 − 1) × `rules.squeezeMult`。归因只有「押跌」「被轧」两项（加道具）。

**抵押**（`borrow` / `repay`）：第 `bankMonth`（2）月起、盘前、借完后账户 ≥ 欠款 × `borrowLine`（1.6）才肯借，借款加进账户；还清拿回东西。难度每高一级借款额 +10%、利息 +10%。

| 抵押物 | 借款 | 月息 | 起始难度 |
|---|---|---|---|
| 金镯子 `bracelet` | 2 万 | 8% | 1 |
| 车 `car` | 5 万 | 10% | 1 |
| 房子 `house` | 12 万 | 9% | 3 |
| 爸妈的养老钱 `pension` | 8 万 | 6% | 5 |

银行每天收盘和每月还完钱后检查：账户 < 欠款 × `seizeLine`（1.25）时先收走借得最多的那件（账户 − 借款 − 借款 × `penalty` 0.2），直到回到线上；
账户 < 欠款 × `callLine`（1.45）打电话（跌破那一下才打，回到线上清掉）。月底先付利息（Σ 借款 × 月息）再还月供；最后一个月还完后银行收回没还的借款。
`loanOffer(s, id)`、`debtOf(s)`、`bankView(s)` 给出画面要的一切；`bankRisk(s)` 在月底前一天提示「付完账单会不会被收东西」。

小知识：`KNOWLEDGE` 11 条，第一次触发时发 `learned` 事件；`knowledgeView / knowledgeCard / extTip / extRecap` 在 `extview.ts`，档案里记 `Profile.knowledge`。

## 9. 节奏：月度主题、目标、高光、平淡日（`tempo.ts`、`content/monthThemes.ts`）

`state.tempo`（`TempoState`）：`plan`（12 个月主题 id，隐藏未来月份）、`cur`（本月 `MonthGoalState`）、`streak / bestStreak`、`shards`、`results`、`bonus`。

- **开局** `planTempo(seed, difficulty, real, ext)`：按种子、这一段每个月大盘的真实涨跌和最大单日跌幅、难度加权抽 12 个，不重复；第 4、8 个月（`tempo.bossMonths`）从 boss 池抽。需要 ext 的主题（押跌、抵押）只在 `ext` 时进池。
- **月初**：`beginMonth`（算月供之前，规则表从此叠加主题的 `rules`）→ `monthStarted` → `monthTheme` 事件（看点卡：`goal, name, intro, rule, goalText, rewardText, roast`）。
  顶栏用 `monthThemeView(s)`（`goal.progress / target / done / failed / boss`、`daysLeft`、短版 `ruleShort / line`）。
- **目标** `GoalKind`：`gain` 本月涨 X%、`keep` 最大回撤不超过 X%（破线当场失败）、`limitUp` 抓到涨停 N 次、`shortWin` 押跌赚 N 次、`streak` 连续 N 天赚钱、`themes` 同时拿 N 个风口、
  `beat` 跑赢大环境 X pp、`quickWin` 当天买当天赚 N 次、`bigDay` 持仓单日涨 ≥ X%。难度每高一级目标 × (1 + `tempo.goalStep` 0.08)（`keep` 反过来收紧，`goalTarget`）。
  计数类达成当场发奖；`gain / beat / keep` 月底还钱之前判定（`goalDone / goalFailed`）。
- **奖励**：现金 = 当月常规月供 × `tempo.cash`（0.2；boss `bossCash` 0.5），加碎片；boss 另给一个道具。
- **主题**（15 个普通 + 4 个 boss，`MONTH_THEMES`，规则与第 1 级目标见 `content/monthThemes.ts`；每个有一句开场白和一句群友吐槽，群友不在群里时换成群主）：
  过山车月（推荐里过山车股多三倍；抓涨停）、收割机带单月（群主说话和推荐翻三倍；涨 3%）、年终奖到账（月初多半个月的钱但这月要还的多 20%；涨 4%）、
  银行搞活动（ext，借款利息减半；涨 3%）、空头来袭（ext，白送押跌许可；押跌赚 2 次）、考试月（只能买老实股；回撤 ≤ 4%）、丈母娘查岗（回撤 ≤ 5%）、
  消息满天飞（每天多 2 条消息；当天买当天赚 2 次）、提前看一天（每天一条重磅情报；涨 5%）、券商送福利（免手续费、每天多买一只；同时拿 3 个风口）、
  涨跌停放宽（宽一倍；持仓一天涨 12%）、连胜挑战（连击奖励翻倍；连续 3 天赚钱）、鸡蛋别放一个篮子（每天多一条推荐；同时拿 3 个风口）、
  散户狂欢（每天多两条推荐；涨 5%）、逆风翻盘（跑赢大环境 2pp）；boss：股灾来袭（白送押跌、每天一条重磅情报；回撤 ≤ 6%）、年中考核（涨 6%）、
  庄家对决（过山车推荐 ×2、涨跌停宽一半；抓涨停 2 次）、基金经理挑战（跑赢大环境 4pp）。
  抽选偏好随这一段的真实行情（真实下跌月更容易抽到空头 / 逆风，上涨月更容易抽到散户狂欢；段内有真实大跌的月份几乎必抽股灾 boss）。主题只改规则和信息，不改走势。
- **收盘** `tempoClose` → `report.tempo`，同时发事件：
  - `spotted { kind: 'boards' | 'blown' | 'wild', stockId, move, boards, held }`：全场识别出的连板（≥ 2）、炸板、妖股异动；
  - `highlight { kind, text, stockId? }`：持仓涨停 / 跌停 / 连板 / 炸板 / 妖股 / 单日 ±5% / 账户 ±3% / 押跌跌停 / 连击 / 目标达成 / 股灾 / 重磅情报；
  - `combo { kind: 'streak' | 'shortWin' | 'limitUp' | 'shards', count, cash, shards, itemId? }`：连续 `tempo.streak`（3）天起每天赚钱给当月月供 × 1.5% 的红包（连胜挑战翻倍），
    押对跌、抓到涨停各 1 片碎片，集满 `tempo.shards`（3）片换一个道具；
  - `goalProgress / goalDone { cash, shards, itemId } / goalFailed`。
  每个月至少一次高光：月末前一天本月还没有高光时，主题放一条重磅情报。
- **平淡日**：`report.tempo.quiet` = 没有高光、连击、自动卖出、道具触发、银行电话，账户 |涨跌| < `quietAcc`（1%）、持仓 |涨跌| < `quietMove`（3%），画面可以快速翻过。
  盘前 `state.today.quiet`（`premarketQuiet(s)`，别名 `isQuietDay`）：不是月初、没有传闻、没有重磅情报、格子满了、没人聊你拿着的风口，画面可以自动开盘。
- 工具：`tools/tempo-check.ts`（节奏）、`tools/intel-check.ts`（情报准确率）、`tools/realness.ts`（真实度），参数见脚本顶部。

## 10. 局的种类：完整一年、娱乐短局、实盘、每日挑战、好友挑战

| 种类 | 开局 | 规则差别 |
|---|---|---|
| 完整一年 | `createRun(seed, { persona, difficulty })` | 12 个月，打完最后一个月月底的账单即通关（`runWon`），没有奖励 |
| 娱乐短局 | `shortSetup(persona, difficulty)` | 只打 `BALANCE.short.months`（5）个月；账单 × `billMult`（0.25）；最后一个月月底多交一笔「首付」（突发账单 `SHORT_GOAL_BILL`，金额 = 开局资产 × `short.goal[难度]`，`shortGoal(s)`）。`runMonths(s)` 给出这局打几个月 |
| 实盘 | `liveSetup(tier, persona, x)` | 档位 `small / mid / big / lux`（`LIVE_TIERS`：一份 2,000 / 10,000 / 50,000 / 200,000 筹码，难度 1/2/3/3）；打 5 个月；账单 × 档位 `billMult`。结回倍数见下 |
| 每日挑战 | `dailySetup(date)` → `{ date, seed, setup }` | 种子 `daily-<日期>`；人设从 5 个里挑（含未解锁的）、难度 2..5（`DAILY_LEVELS`）；段在冻结池里抽，大家同一段；日期用玩家本地日期，由画面决定 |
| 好友挑战 | `challengeOf(state, version)` → payload；`challengeSetup(p)` | 把一局的开局（种子 + 人设 + 难度 + 短局规则 + 行情段 id）存成一小段 JSON，好友打开是同一个开局。只发打完的娱乐局；payload 是别人交上来的，`parseChallenge` 按白名单逐项校验 |

**实盘结回**（`live.ts`、`liveTiers.ts`，Worker 也用后者）：不碰钱包，只算倍数。`liveMultipleBp(s)`（万分之几的整数，0..cap × 10000）= 1 + 档位涨跌倍数 `lev` ×（资产 ÷ 开局资产 − 1），破产为 0；
`liveReturn(stake, bp)` = ⌊一份 × bp ÷ 10000⌋，全是整数运算，不会因小数误差少给 1 筹码。`liveValue(s)` 给顶栏小牌子用。
**杠杆**：稳健 1× / 进取 2× / 疯狂 3×（`BALANCE.live.gears`：封顶 3 / 5 / 7 份，每月利息 0 / 1.3% / 2.24% 乘档位 `gearRate`，清零线 0 / 0.2 / 0.1）。
结回再按 x 放大一次；放大后的结回倍数跌到清零线就爆仓（`gearWiped` + `runLost { reason: 'margin' }`，`endReason = 'margin'`）；利息作为突发账单 `GEAR_INTEREST_BILL` 随月供扣（`gearInterest(s)`），
`gearLevered(s)` 给放大后的倍数，`warnGap` 内顶栏提醒（只是画面）。

每日挑战的分数：`dailyScore(won, account, billsPaid)`，通关的按最后账户（元，取整）排、都排在没通关的前面，没通关的按还上几个月排；`dailyScoreView` 还原，`dailyBoardId(date)` 是榜单 id（`DAILY_RULES` 随抽法或计分改动加一，新旧不在一个榜上比）。好友挑战沿用这个分数（`challengeScore`）。

## 11. 内容与 id

内容表在 `src/core/content/`，都从 `index.ts` 导出（`STOCKS / ITEMS / EVENTS / ACHIEVEMENTS / CALENDAR / PERSONAS / DIFFICULTIES / FRIENDS / MONTH_THEMES / KNOWLEDGE / COLLATERALS` 等）；美术按 id 出图。

- 风口 `THEME_IDS`（8 个）：`ai, newenergy, consumer, pharma, finance, lowalt, gaming, pig`。每局登场 6 个（人设可指定必登场）。
- 股票 `STOCKS`（40 只）：每个风口约 5 只，角色 `leader` 带头大哥 / `follower` 小弟 / `bluechip` 老实股 / `meme` 过山车 / `st` 危险股；`stocksOf(theme)`。
- 群友 `FRIENDS`：开局 `xiaoli, laowang, zhangjie, qunzhu, laozhao, dav`；后加入 `neimu`（付费群或新群友卡）、`zhuchang`（新群友卡，需要养猪风口在场）、`kongjun`（空军老周，只唱空，押跌解锁时入群）。
- 道具 `ITEMS`（28 个）；押跌、抵押相关的标 `ext`（`short_permit, sunglasses, banker, pyramid`……）。
- 事件 `EVENTS`（19 个）、日历 `CALENDAR`（12 个月）、成就 `ACHIEVEMENTS`（45 个，铜 / 银 / 金）、突发账单 `SURPRISE_BILLS`（9 个，`BillExtra.id`）、月供名目 `BILL_NAMES`。
- 人设 `PERSONA_IDS`：`newbie, retiree, mom, coder, youzi`（`coder`、`youzi` 由成就解锁，`personaView(id).unlockBy`）；难度 8 级 `slow_bull … doom`（`DIFFICULTIES`）。哪些人设、难度能选由档案决定（`src/platform/profile.ts` 的 `isPersonaUnlocked / isDifficultyUnlocked`）。

## 12. 隐藏信息（画面不能显示）

| 字段 / 函数 | 说明 |
|---|---|
| `themes[id].stage / lastStage / left / sure / age / rebound` | 风口真实阶段与内部计数。`lastStage` 只有持有情绪指标时才能显示，熬夜复盘只揭示一个、只到第二天盘前：一律以 `themeBoard` 为准 |
| `today.plan` | 今天预先掷好的行情，开盘前显示等于剧透 |
| `real`（整个对象）、`watch` | 含未来的走势序列；多日消息的说法在揭晓前不能被当作线索。画面只用 `preHistory` 和已发生的数据 |
| `tempo.plan` | 12 个月的主题，只显示已经到的月份 |
| `Holding.buyStage / sawEbb`、`TradeLog.stage / guard` | 买入时的阶段、站岗判定。结束页复盘可以揭晓，局中不显示 |
| `ThemeMove.stage`（`themeMoved` 事件、`report.themes`） | 当天真实阶段，局中不显示 |
| `PendingEffect` 的结果 | 到期才掷，画面只显示本金和到期月份 |
| `crashPlan / surprisePlan / turnOf / messageCred / themeTruth / stockTruth / forwardRet` | 只给测试和模拟用 |

可以显示的：热度、走势、体感、大盘天气（上一个交易日）、消息与推荐、战绩、收盘后揭晓的 `truth`、连板、ST 警告、当月的 `bill.extras`、本月 `notice`、已到月份的主题与目标。

## 13. 数值表（`balance.ts`）

`BALANCE` 的分组和关键值，具体数字以 `balance.ts` 为准（每项上面有注释）：

| 分组 | 内容与关键值 |
|---|---|
| 基础 | `startAccount` 10 万、`monthDays` [5×9, 3, 5, 5]（共 58 天）、`slots` 4、`buysPerDay` 1、`recs` 3、`messages` [2,4]、`activeThemes` 6 |
| `bills`、`surprise` | 月供 = 9,000 × 1.105^(月−1)，取整到百元（12 月约 1 月的 3 倍）；一局 2–3 次突发账单，窗口 [2,4] [5,8] [9,10]；金额范围按名目 |
| `heat`、`stages`、`themes`、`market`、`roles`、`boards`、`chain`、`st` | 合成行情的风口生命周期、角色参数（`beta / market / noise / limit / jump`）、连板、龙头带跟风、ST；真实行情下只有 `roles[].limit` 和显示相关的用到 |
| `real`、`track` | 真实行情映射：`smooth 0.35, themeK 11, heatGain 12, heatPull 0.2, heatBase 20`、阶段门槛 `real.stage`；个股照搬：`track.amp 2`、`billMult 0.5`、`regimeBill`、识别阈值 `blown −5 / wild 7 / follow 3` |
| `intel`、`chat`、`cred` | 情报与群聊：群友准确率表 `intel.cred`（合成行情用 `cred`）、`diffStep 0.02`、`qunzhuFlip 0.8`、`headline 0.85`、`news 0.65`、`cat 0.6`；`chat.credMax 0.95`、`form` 每局状态 |
| `ext` | 仓位 / 押跌 / 抵押（第 8 节） |
| `tempo` | 月度主题与高光（第 9 节） |
| `reward`、`events`、`crash` | 三选一卡数与权重、每月事件概率 0.4、股灾月份 [4–9, 11] 与出事日 |
| `short`、`live` | 短局 5 个月 / 账单 × 0.25 / 首付比例 [0.95, 1.05, 1.12]；实盘 5 个月、封顶 3 份、四档 `billMult / lev / gearRate`、三档杠杆 |
| `fx[id]` | 道具、日历、事件、人设、难度的效果数值，键为内容 id；文案的 `desc()` 从这里取数，改数值不用改文案。`fx(id, key)` 取值（缺省 0） |

改数值必须用 `npm run sim` 验证（难度梯度、牛熊都有通关路径、牛市不能躺赢、抵押不是最优解），不凭感觉。常用：

`node tools/sim.ts --real-table --ext --runs 540 --seed <种子>`（135 段 × 各难度通关率，真实行情）、`--diff-table`（合成行情）、`--set ext.xxx=…`（临时覆盖 BALANCE 某项）。

机器人在 `tools/bots.ts`（`random / follower / normal / truster / smart / oracle` 和 `heavy / shorter / gambler` 等变体）；`smart / oracle` 在真实行情下是 `trackBot`（知道群友真实准确率 / 直接看行情段的真实未来）。
配平目标与历次实测见 `docs/design-balance.md`。

## 14. URL 参数（调试和自动化，`src/debug/params.ts`、`src/main.ts`）

带了 `seed` 或任何开局参数就跳过开始菜单直接开局，**这一局不计入档案**（`session.markUnscored`），正式构建里已有存档时也不写存档。

| 参数 | 映射 |
|---|---|
| `seed` | 种子（不读存档） |
| `account`、`items=a,b`、`friends=a,b`、`themes=a,b,…`（6 个）、`holdings=a,b` | 对应 `RunSetup` 的调试字段 |
| `difficulty` | `RunSetup.difficulty`，截到 1..8 |
| `persona` | `RunSetup.persona`（须是有效人设 id） |
| `daily=1` / `daily=YYYY-MM-DD` | 用 `dailySetup` 开那天的每日挑战（种子、人设、难度、`daily`）；再带 `seed / persona / difficulty` 覆盖对应项，仅供调试，档案仍按那天的每日挑战记 |
| `ext=1` | URL 开的局也打开仓位、押跌、银行（缺省按基础玩法开，旧自动化脚本不受影响）。注意：URL 开局直接 `createRun`，**不带行情段**，是合成行情 |
| `market=synthetic` / `market=<段 id>` | 经界面「再开一局」开局时：`synthetic` 用合成行情，段 id 指定那一段真实行情（缺省 `real` = 按种子抽） |
| `anim=0/1`、`speed=N` | 关 / 开动画、动画倍速（优先于玩家设置） |
| `debug=1` | 调试浮层（显示隐藏信息）；这个会话里的局都不计入档案 |
| `scale=N`、`soundboard=1` | 强制渲染倍数、音频试听面板（在 `view/theme.ts`、`view/audio` 里读取） |

真实行情下用脚本开局：`window.__game.newRun(seed, setup)`（和界面同一条路，按种子异步抽段），或在 node 里 `createRun(seed, setup, { segment, ext: true })` 推进后 `__game.loadState(state)`；调试桥完整接口见 `src/debug/bridge.ts`。
