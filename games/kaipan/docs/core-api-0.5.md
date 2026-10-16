# 《开盘》0.5 规则层：真走势、真情报、有节奏

> 2026-10-13。设计见 docs/design-0.5.md；0.4 的接口与数值见 docs/core-api-0.4-redo.md，本文只写新增和改动。
> 一句话：真实行情模式下个股照搬绑定的真实股票（统一放大、按涨跌停截断），群聊情报按这段行情接下来 1–3 天的真实走势推算，
> 每个月一个月度主题 + 目标，第 4、8 个月是中场 boss，收盘有高光、连击和平淡日标记。合成行情（离线兜底）完全不变。

## 1. 开关与兼容

| 模式 | 怎么开 | 行为 |
|---|---|---|
| 0.5 真实行情 | `createRun(seed, setup, { segment, ext })` | `state.real.track = true`；个股照搬真实走势；情报读真实未来；`state.tempo` 打开 |
| 合成行情（离线兜底） | 不给 `segment` | 0.3 原样；没有 `tempo`；`tests/replay-030.test.ts` 逐位一致 |
| 0.4 旧存档 | `state.real` 里没有 `track` | 照 0.4 的映射（market.ts 的 `if (rl)` 分支原样保留），没有月度主题 |
| 对照 / 诊断 | `{ segment, legacyReal: true }` | 用 0.4 的映射开新局 |

- `CreateOptions.tempo?: boolean`：缺省 = 有行情段时开、合成行情关。回放：`replay(seed, actions, setup, { segment, ext: !!state.ext, tempo: !!state.tempo })`。
- 画面层不用改就能跑：新字段都是可选的，新事件旧画面会忽略。`src/view/session.ts` 现在的 `createRun(seed, setup, { segment: seg, ext: true })` 已经是 0.5 模式。

## 2. 个股照搬真实走势（`market.ts` 的 `moveStocksTrack`，`real.ts`）

- 当天涨跌 = `BALANCE.track.amp`（2，所有股票相同）× 绑定的真实股票当天总收益，再按涨跌停截断：
  跌停 = 角色涨跌停 × `rules.limitMult`，涨停再 × `rules.limitUpMult`。风口（看板）涨跌 = amp × 真实行业等权收益；大盘 = amp × 老三十。
  日历、难度、道具、事件、股灾都不再改大盘和个股（`trackPlan`）；风口热度和阶段照 0.4 用真实相对强弱推（加成只改热度，热度只是信息）。
- 识别（只播报，不改涨跌；`StockMove` 上）：
  - 连板：触及涨停 → `boards + 1`（`boards ≥ 2` 发 `spotted { kind: 'boards' }`）；
  - 炸板：前一天涨停、今天跌 ≤ `track.blown`（−5）→ `blown`；
  - 妖股异动：过山车股 |涨跌| ≥ `track.wild`（7）→ `wild`（`jump` 恒为 0）；
  - 跟涨：同风口大哥涨停、小弟涨 ≥ `track.follow`（3）→ `follow`（`chain` 恒为 0；`ChainLink` 照常按 follow 组）；
  - 危险股：跌停记一次退市警告、有警告时涨停摘帽（`stockNews`），真实行情下不会退市。
- 归因：持仓的 `parts` = 大盘（amp × 老三十）+ 风口（amp × (行业 − 老三十)）+ 个股自身（amp × (股票 − 行业)，kind `noise`）+ 涨跌停截断（`limit`），之和等于当天涨跌，再加道具。
- 性格校正（`fitRoles`，开局）：每个风口内按这一段（开局前 + 一局）的真实表现把绑定的序列重新分给游戏股票：
  过山车 ← 相对行业残差波动最大；危险股 ← 整段跌得最多；带头大哥 ← 对行业 β 最大；老实股 ← 波动最小；其余当小弟。只决定显示和情报口吻。
- 实测（`node tools/realness.ts`，135 段 × 约 30 只，normal 机器人）：

| | 0.4.0 | 0.5（amp 2） |
|---|---|---|
| 个股逐日相关（全部天）中位 / 均值 | 0.42（均值） | 0.98 / 0.95 |
| 个股逐日相关（剔除涨跌停截断日） | — | 1.00 / 1.00（截断日占 12.8%） |
| 个股逐日同向 | 65% | 100% |
| 个股整段方向一致 | 61% | 90%（放大 + 截断后复利不同） |
| 大盘逐日相关 | 0.91 | 1.00 |

  amp 1.5 / 2 / 2.5 时全部天相关均值 0.97 / 0.95 / 0.94、截断日 7.7% / 12.6% / 17.7%；选 2 是"够刺激（涨停常见）"和"像真的"的折中。

## 3. 情报从真实未来推算（`chat.ts` 的 `trackMessages`、`trackRecs`、`headline`）

- 群聊消息：说的是"这个风口接下来 `days` 天（含今天，1–3，权重 `intel.days` = 8 : 3 : 1）的累计涨跌方向"。
  真相 = amp × 行业接下来 days 天真实涨跌之和，±`intel.flat[days−1]`（0.8 / 1.2 / 1.5 pp）以内算横（`themeTruth`）。
  说中概率 = `messageCred`：`intel.cred[群友]`（擅长 / 不擅长）+ 0.3 的加成（开局靠谱群友聊擅长的 +0.1、拐点 +0.2）+ 难度（第 4 级消息失真；每高一级 −`intel.diffStep` 0.02），封顶 0.9。
  说错时：群主 80%（`qunzhuFlip`）直接反着说；空军老周一律唱空；其余随机挑另一个方向。
  `days = 1` 的当天收盘揭晓（`messageJudged`、`report.messages`）；`days > 1` 的进 `state.watch`，到期那天收盘揭晓（`intelJudged`、`report.intel`，带 `day`、`days`）。战绩 `FriendState.hits / total` 两种都算。
- 推荐：推荐人照 0.3 挑；推的票是他"觉得接下来 `rec.days` 天会涨"的：对每只候选股以 `recCredibility` 的概率看对它的真实方向（±`intel.stockFlat` 1.5 / 2 / 2.5 pp），在看涨的里按角色权重 × `rules.recRoleBoost` 挑；群主再按风口阶段偏好高位、过山车；空军老周挑看跌的押跌。
- 重磅情报（`Message.big`）：今天真实涨跌幅度最大的风口，由群里最靠谱的人说，准确率 `intel.headline` 0.85。来源：主题规则 `rules.headlines`、本月还没有高光时月末前一天主题补一条。
- 其余：新闻每天收盘多一条预告（`NewsItem.ahead` = 天数，从明天起，准确率 `intel.news` 0.65）；猫踩键盘有 `intel.cat` 0.6 的概率踩中接下来 2 天涨得最多的小弟；表哥的过山车股"说中"= 接下来 3 天真涨（0.3 照旧）；股票卡变成"内部消息：下个月走势偏强"（`intel.headline` 的概率是真的）。
- 准确率参数（`BALANCE.intel.cred`，第 1 级）与实测（`node tools/intel-check.ts --difficulty 1/4/8`，135 局）：

| 群友 | 擅长 / 不擅长 | 消息说中 L1 / L4 / L8 | 推荐接下来平均（pp）L1 / L8 |
|---|---|---|---|
| 老王 | 0.85 / 0.55 | 87% / 53% / 52% | +3.7 / +2.6 |
| 张姐 | 0.75 / 0.5 | 82% / 43% / 42% | +3.1 / +2.1 |
| 老赵 | 0.85 / 0.5 | 76% / 43% / 41% | +2.6 / +1.8 |
| 小李 | 0.7 / 0.5 | 68% / 46% / 45% | +2.7 / +1.8 |
| 股市小诸葛 | 0.55 / 0.55 | 55% / 37% / 35% | +1.9 / +1.1 |
| 韭菜收割机 | 0.3 / 0.3（说错 80% 反着说） | 29% / 32% / 30% | −1.6 / −3.4 |
| 内幕哥、猪场老板 | 0.9 / 0.9 | 92% / 63% / 61% | +5.3 / +3.3 |
| 空军老周 | 0.55 / 0.55 | — | 押跌推荐 |

  瞎猜是 33%。第 4 级"消息失真"起消息大幅变差，推荐不受失真影响（同 0.3）。

## 4. 月度主题、中场 boss、目标（`src/core/content/monthThemes.ts`、`src/core/tempo.ts`）

- 开局 `planTempo(seed, difficulty, real, ext)`：按种子、这一段每个月大盘的真实涨跌和最大单日跌幅、难度加权抽 12 个，不重复；第 4、8 个月从 boss 池抽。需要新机制的（押跌、抵押）只在 `ext` 时进池。
- 每月初 `beginMonth`（算月供之前，规则表从此叠加主题的 `rules`）→ `monthStarted` → `monthTheme` 事件（看点卡）→ 年终奖类的月初现金。
- 目标（`GoalKind`）：`gain` 本月涨 X%、`keep` 最大回撤不超过 X%（破线当场失败）、`limitUp` 抓到涨停 N 次、`shortWin` 押跌赚 N 次、`streak` 连续 N 天赚钱、`themes` 同时拿 N 个风口、`beat` 跑赢大环境 X pp、`quickWin` 当天买当天赚 N 次、`bigDay` 持仓单日涨 ≥ X%。
  难度每高一级目标 × (1 + `tempo.goalStep` 0.08)（keep 反过来收紧）。计数类达成当场发奖；gain / beat / keep 月底还钱之前判定。
- 奖励：现金 = 当月常规月供 × `tempo.cash` 0.2（boss `bossCash` 0.5），加碎片；boss 另给一个道具。

| id | 名字 | 一句话 | 目标（第 1 级） |
|---|---|---|---|
| meme_month | 过山车月 | 推荐里过山车股多三倍 | 抓到 1 次涨停 |
| qunzhu_month | 收割机带单月 | 群主说话和推荐翻三倍，信不信由你 | 本月涨 3% |
| payday | 年终奖到账 | 月初多半个月的钱，但这个月要还的钱多 20% | 本月涨 4% |
| bank_month | 银行搞活动 | 借款利息减半（ext） | 本月涨 3% |
| bear_month | 空头来袭 | 白送押跌许可（ext；真实下跌月更容易抽到） | 押跌赚 2 次 |
| exam_month | 考试月 | 只能买老实股（推荐里也只有老实股） | 回撤 ≤ 4% |
| inlaw_month | 丈母娘查岗 | 规则照常，亏多了挨骂 | 回撤 ≤ 5% |
| rumor_month | 消息满天飞 | 每天多 2 条消息 | 当天买当天赚 2 次 |
| insider_month | 提前看一天 | 每天一条重磅情报 | 本月涨 5% |
| fee_month | 券商送福利 | 免手续费、每天多买一只 | 同时拿 3 个风口 |
| wide_month | 涨跌停放宽 | 涨跌停宽一倍 | 持仓一天涨 12% |
| streak_month | 连胜挑战 | 连击小奖励翻倍 | 连续 3 天赚钱 |
| spread_month | 鸡蛋别放一个篮子 | 每天多一条推荐 | 同时拿 3 个风口 |
| fomo_month | 散户狂欢 | 每天多两条推荐（真实上涨月更容易抽到） | 本月涨 5% |
| beat_month | 逆风翻盘 | 规则照常（真实下跌月更容易抽到） | 跑赢大环境 2pp |
| crash_boss | 股灾来袭（boss） | 白送押跌、每天一条重磅情报；段内有真实大跌的月份几乎必抽 | 回撤 ≤ 6% |
| review_boss | 年中考核（boss） | 目标更高 | 本月涨 6% |
| banker_boss | 庄家对决（boss） | 过山车推荐 ×2、涨跌停宽一半 | 抓到 2 次涨停 |
| beat_boss | 基金经理挑战（boss） | 规则照常 | 跑赢大环境 4pp |

  每个主题还有一句开场白和一句群友吐槽（说话的人不在群里时换成群主）。

## 5. 高光、连击、平淡日

- 收盘 `tempoClose` → `report.tempo: DayTempo { quiet, highlights, combos, goal, streak }`，同时发事件：
  - `spotted { kind: 'boards' | 'blown' | 'wild', stockId, move, boards, held }`：全场识别出的连板（≥ 2）、炸板、妖股异动；
  - `highlight { kind, text, stockId? }`：持仓涨停 / 跌停 / 连板 / 炸板 / 妖股异动 / 单日 ±5% / 账户 ±3% / 押跌跌停 / 连击 / 目标达成 / 股灾；
  - `combo { kind: 'streak' | 'shortWin' | 'limitUp' | 'shards', count, cash, shards, itemId? }`：连续 3 天起每天赚钱给当月月供 × 1.5% 的红包（主题"连胜挑战"翻倍），押对跌、抓到涨停各 1 片碎片，3 片换一个道具；
  - `goalProgress` / `goalDone { cash, shards, itemId }` / `goalFailed`。
- 每个月至少一次高光：月末前一天本月还没有高光时，主题放一条重磅情报（`Message.big`，`highlight { kind: 'headline' }`）。实测 normal / smart 各 270 局，没有高光的月份 0。
- 平淡日：`report.tempo.quiet` = 没有高光、连击、自动卖出、道具触发、银行电话，账户 |涨跌| < 1%、持仓 |涨跌| < 3%（画面快速翻过）。
  盘前 `state.today.quiet`（= `premarketQuiet(s)`，导出别名 `isQuietDay`）：不是月初、没有传闻、没有重磅情报、格子满了、没人聊你拿着的风口（画面可以自动开盘）。
  实测第 1 级收盘平淡日：normal 17.5%（最长连续 6 天，多半是空仓），smart 7.6%。

## 6. 道具、难度、日历的改动（真实行情 0.5 下）

| 内容 | 0.4（改走势） | 0.5 |
|---|---|---|
| 难度 2 震荡 | 热度乱晃、月供 | 不变（热度只是信息） |
| 难度 3 熊出没 | 大环境更容易转熊（改大盘） | 每次买入收 0.6% 手续费（`rules.buyFee`，按这一笔金额） |
| 难度 4 消息失真 | 消息变差 | 不变；另外每级 −0.02 准确率 |
| 难度 5 强监管 | 炸板率 ×2、退市警告 ×2 | 涨停那一头 × 0.7（跌停不变，`rules.limitUpMult`） |
| 难度 6 股灾 | 风口一起退潮 + 大盘 −4pp | 对齐段内真实最大跌日；风口热度一起退潮、突发账单照旧；不再额外压大盘 |
| 难度 7 / 8 | 月供、奖励、坏事 | 不变 |
| 道具 连续涨停梦 | 连板惯性 ×2、炸板率 ×1.5 | 第 2 个起每个涨停再 +4%，炸板多亏 3%（`onHolding`，结算规则） |
| 道具 小弟也吃肉 | 跟涨幅度翻倍 | 识别出跟涨的那天 +chain × 2（4%） |
| 道具 跟紧大哥 / 过山车爱好者 / 老实人信仰 / 抄底大师 / 止损止盈 / 价值眼光 / 游资席位 / 分散 / 两融 | 结算规则 | 不变（本来就不改走势） |
| 道具 情报类（小本本、情绪指标、熬夜复盘、FOMO、小道消息、反着信群主……） | 信息 | 不变，作用在真实未来推算的情报上 |
| 日历 | 元旦、五穷六绝、七翻身、年报、中报、国庆、年底改大盘 / β / 噪声 | 不生效，`CalendarDef.realDesc` 改说"老话说……涨跌照真的走"；春季躁动、政策窗口、金九、双十一只改热度（信息） |
| 事件 大V直播间 | 热度加成带动涨幅 | 热度加成 + 手里这个风口每份马上多赚 6% |
| 稀有股票卡 | 风口必火 | 内部消息：下个月走势偏强（85% 是真的） |
| 月供 | — | 真实行情下 × `track.billMult` 0.5（0.10.0 配平前是 0.8，见 `design-balance.md`）× `track.regimeBill`（牛 1.1、泡沫 1.25、横盘 0.95、熊 0.9、崩盘 0.95；市况不公开） |

`DifficultyDef.realRules / realDesc / realDetail`：难度选择页在真实行情下应显示 realDesc / realDetail。

## 7. 平衡（2026-10-13，`node tools/sim.ts --real-table --ext --runs 540 --seed f5`，135 段每段每级 4 局）

### 7.1 结果

| 机器人 | L1 | L2 | L3 | L4 | L5 | L6 | L7 | L8 |
|---|---|---|---|---|---|---|---|---|
| random（乱买） | 5.2 | 3.0 | 1.7 | 2.4 | 1.7 | 0.4 | 0.6 | 0.2 |
| follower（躺平） | 16.7 | 9.3 | 7.0 | 8.0 | 7.4 | 4.8 | 2.8 | 1.7 |
| normal | 35.7 | 20.9 | 12.6 | 5.2 | 3.7 | 1.9 | 1.1 | 0.6 |
| truster（信靠谱群友，新） | 53.5 | 43.0 | 31.9 | 10.2 | 8.3 | 6.5 | 4.3 | 1.9 |
| smart | 63.9 | 52.8 | 40.6 | 24.4 | 26.1 | 19.1 | 14.4 | 8.5 |
| oracle | 100 | 100 | 99.8 | 99.6 | 99.8 | 99.4 | 99.4 | 97.6 |
| gambler（抵押赌徒） | 11.3 | 5.6 | 0.6 | 0.0 | 0.2 | 0.0 | 0.0 | 0.0 |
| gambler-smart | 36.9 | 24.3 | 4.8 | 2.6 | 3.9 | 2.0 | 1.9 | 1.1 |
| heavy / shorter | 6.3 / 28.7 | 4.1 / 18.3 | 3.1 / 14.6 | 0.9 / 7.0 | 0.0 / 5.6 | 0.2 / 3.5 | 0.2 / 2.6 | 0.2 / 1.1 |

第 1 级按市况（random / follower / normal / truster / smart）：牛 0.6 / 13.5 / 32.1 / 48.7 / 57.1；泡沫 2.9 / 25.0 / 36.8 / 55.9 / 69.1；
横盘 5.1 / 16.0 / 35.3 / 51.3 / 64.1；熊 7.5 / 11.3 / 35.0 / 56.3 / 63.7；崩盘 13.8 / 22.5 / 43.8 / 62.5 / 72.5。

- 难度梯度：各机器人随难度下降；smart L4 24.4 < L5 26.1 在 540 局的噪声内（±2pp），L4"消息失真"对看消息的打法最狠。
- 看情报、信靠谱群友明显强于乱买：truster 53.5% vs random 5.2%（第 1 级），每一级都高；smart 再高一截。
- 牛熊都有通关路径：五种市况 truster 49–63%、smart 57–73%。
- 牛市不能躺赢：牛市 follower 13.5%（normal 32%）；泡沫 25%（靠 `regimeBill` 1.25 压住，不加时 47%）。
- 抵押不是最优解：gambler 11.3% < normal 35.7%；smart 套上抵押 36.9% < 63.9%，第 3 级起几乎全灭。
- 和 0.4 比 normal L1 从 48% 降到 36%：个股不再被风口热度推着走，靠情报赚钱；需要真人试玩决定要不要把 `track.billMult` 从 0.8 降到 0.75（normal 41%、follower 20%）。

- `truster`（新）：信靠谱群友——只听战绩（说对 / 发言，带 50% 先验）≥ 55% 的人的推荐和消息，期望值决策。
- `smart`、`oracle` 在 0.5 下换成 `trackBot`：smart 知道每个群友真实的准确率（老玩家上限），oracle 直接看行情段今天和明天的真实涨跌。合成行情、0.4 旧档仍用原来的 SmartBot。
- 节奏：`node tools/tempo-check.ts --bot normal --runs 270 --ext`；情报：`node tools/intel-check.ts`；真实度：`node tools/realness.ts [--amp x]`。

## 8. 画面层要用的接口

| 用途 | 接口 |
|---|---|
| 本月看点卡 | 事件 `monthTheme { goal, name, intro, rule, goalText, rewardText, roast: { friendId, text } }`（月初，紧跟 `monthStarted`；第 1 个月在 `createRun` 的事件里） |
| 顶栏"本关目标 X / Y，还剩 N 天" | `monthThemeView(s)` → `{ goal: MonthGoalState, name, intro, rule, goalText, rewardText, daysLeft }`；`goal.progress / target / done / failed / boss`；进度变化发 `goalProgress` |
| 月底结算 | `goalDone { goal, cash, shards, itemId }` / `goalFailed`；`state.tempo.results` |
| 平淡日 / 自动快进 | 盘前 `state.today.quiet`（`isQuietDay(s)`）；收盘 `report.tempo.quiet` |
| 高光、连击 | 事件 `highlight`、`combo`；收盘汇总 `report.tempo.highlights / combos / streak`；碎片 `state.tempo.shards`（满 `BALANCE.tempo.shards` 换道具） |
| 识别出的连板、炸板、妖股异动 | 事件 `spotted { kind, stockId, move, boards, held }`；`StockMove.boards / blown / wild / follow` |
| 情报 | `Message.days / big`、`Rec.days / big`；多日消息揭晓 `intelJudged`、`report.intel`；预告新闻 `NewsItem.ahead` |
| 难度、日历在真实行情下的说法 | `DifficultyDef.realDesc / realDetail`、`calendarView(s)` 已自动换 `realDesc` |
| 判断模式 | `isTrack(state.real)` |

## 9. 未决

- 段文件不用改；性格校正用的是段内全部 warm + days 天。若想让"危险股"只按开局前的表现判（不偷看未来），需要更长的开局前历史（现在 warm = 20 天）。
- 月度主题、目标数值、`track.billMult / regimeBill` 都按机器人标定，需要真人试玩校准（特别是"牛市"段里的月供偏高是否被察觉）。
- 画面：多日消息的气泡要在揭晓前保留（`state.watch` 是隐藏的，只存说法）；难度选择页还在用 `desc`。
