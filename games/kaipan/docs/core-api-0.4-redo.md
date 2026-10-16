# 《开盘》0.4 重做：真实行情驱动（里程碑 B）接口与数值

> 2026-10-12。设计见 docs/design-0.4-redo.md。0.3.1 的规则层接口见 docs/core-api-0.3.md，本文只写新增和改动。
> 一句话：这是游戏，真实行情只用来让涨跌像真的。0.3 的风口生命周期、群聊情报、道具、难度、人设、事件全部照旧。

> 0.5（2026-10-13）：个股照搬真实走势、情报从真实未来推算、月度主题与节奏，见 docs/core-api-0.5.md。本文的真实行情映射（第 3 节）只对 0.4 旧存档和 `legacyReal` 生效。

## 1. 总览

| 层 | 文件 | 作用 |
|---|---|---|
| 数据 | `tools/data/segments.ts`、`tools/data/events.ts` | 从年度包切行情段 → `public/data/segments/` |
| 规则 | `src/core/segment.ts` | 行情段格式、校验、按种子抽段、取出本局要用的部分（`RealMarket`） |
| 规则 | `src/core/real.ts` | 真实行情 → 风口热度 / 阶段、大盘天气、风口与个股涨跌 |
| 规则 | `src/core/engine.ts`、`market.ts` | `createRun(seed, setup, { segment })`；`state.real` 不为 null 时走真实行情 |
| 规则 | `src/core/reveal.ts`、`src/core/content/tales.ts` | 局末"这段日子"小故事 `storyView(state)`、段标题 `assignTitles` / `displayTitle`；故事模板和标题表 |
| 画面 | `src/view/segments.ts`、`session.ts` | 开局异步下载抽中的段（"正在挑选行情……"），失败退回合成行情 |
| 画面 | `src/view/meta/revealPanel.ts`、`EndScene.ts`、`codexPanel.ts` | "这段日子"故事页、结束页按钮、图鉴"行情段"（重看故事） |
| 工具 | `tools/segments-disk.ts`、`tools/bots.ts`（`useMarket`）、`tools/sim.ts --real/--segment/--real-table`、`tools/shot.ts --real` | 机器人、浸泡、截图 |

合成行情（0.3 原样）仍是一个完整模式：`createRun(seed, setup)` 不给段、URL `?market=synthetic`、行情段下载失败时都走它；`tests/replay-030.test.ts` 只在这个模式下跑。

## 2. 行情段

### 2.1 生成

```
node tools/data/segments.ts --packs .data/wiki-prices/packs --gap 39 --step 1   # 现在的 135 段就是这样切的（年包不进仓库）
node tools/data/segments.ts --gap 39 --step 3   # 两段开局日至少隔 gap 个交易日；候选开局日每 step 天一个
node tools/data/segments.ts --full [--force]    # 全量数据到位后（见第 6 节）
```

- 一段 = 开局前 `warm = 20` 天 + 一局 `days = 58` 天（`BALANCE.monthDays` 之和）。
- 挑段（2026-10-12 全量）：开局日按全局交易日历两两相隔 ≥ gap（跨年包也算；gap 39 = 一局 58 天里相邻两段最多重叠 19 天，即三分之一）。用动态规划（带权区间调度）先让段数最多，再让稀有市况（崩盘 > 泡沫 > 熊 > 牛 > 横盘）和起伏大的多。开局日最早 1996-01-02。
- 市况阈值（`classify`）：崩盘 = 老三十段内回撤 ≤ −14% 或科综回撤 ≤ −30%；泡沫 = 科综 ≥ +20% 且领先老三十 ≥ 12 个百分点（原 25% / 18%）；牛 = 老三十 ≥ +6%；熊 = 老三十 ≤ −4.5%（原 −6%）或科综 ≤ −18%；其余横盘。放宽泡沫和熊市是因为 1996–2018 里按原阈值只有 8 段泡沫、13 段熊市。
- 全量额外检查（build.ts 清洗之外，按段做）：段内任一天总收益超过 ±40% 的（价格跳变）、零成交 ≥ 3 天或单日成交量超过段内中位数 60 倍的（成交量异常）不进行业平均和候选；逐日收益相关系数 ≥ 0.97 的两只（同一公司的 A/B 股、新旧代码）只留成交额大的。135 段累计剔除：跳变 578 次、成交量异常 30、零成交 6、同一公司重复 101。
- 大事：伤亡、灾害、袭击、停市、选举类（`tools/data/beats.ts` 的 `BEATS` 里标 skip 的，或文字里有 `SENSITIVE_WORDS` 的）不进段文件。
- 市况（按一局期间的"老三十"涨跌 ret、最大回撤 dd，"科综"涨跌 ref、回撤 refDD）：
  崩盘 dd ≤ −14% 或 refDD ≤ −30%；泡沫 ref ≥ 25% 且比大盘多涨 18pp；牛 ret ≥ 6%；熊 ret ≤ −6% 或 ref ≤ −18%；其余横盘。
- 标题：游戏化的说法，不透露年代和公司（`SEGMENT_TITLES`，例如"心电图行情""过山车没装刹车"）；同一市况按段 id 顺序依次分配（`assignTitles`），超过表长时加"第 N 季"。`node tools/data/segments.ts --retitle` 只改现有段文件的标题和大事行业，不动行情数字。
- 大事：`tools/data/events.ts`（80 条，改写自 timeline-*.md，不摘录原文）里日期在段内的，按重要度取 4 条。

### 2.2 文件

防泄漏（0.4.0）：玩家能在浏览器网络面板里看到这些文件，所以文件名、目录和段文件里都不能出现年份、日期、大事原文和真实代码
（`tests/segments-leak.test.ts` 扫所有文件名和内容）。

`public/data/segments/index.json`：`{ v: 1, source, segments: [{ id, file }] }`。目录顺序就是内部的"年-月-市况"顺序（开局按种子取第几个，
顺序不变则同一种子抽到同一段），但不带任何年份信息。

`public/data/segments/<id>.json`（约 19KB，gzip 8KB），类型见 `src/core/segment.ts` 的 `Segment`：

| 字段 | 含义 |
|---|---|
| `id` | 不透明 id：`seg_` + sha256(盐 + 内部 key) 的前 10 位十六进制；盐只在 `tools/data/segments.ts` |
| `warm` / `days` | 20 / 58；所有数组长度 = warm + days，第 warm 个是第一个交易日 |
| `regime` / `title` / `stats` | 市况、游戏化标题、`{ ret, dd, ref }`（比例） |
| `events` | `{ day, t?, alt?, sectors }[]`，最多 4 条：一局里第几个交易日（按真实日期折算）、故事句（`tools/data/beats.ts` 里按日期查好，没有时画面按大环境方向写通用句）、相关行业 |
| `market` | 大盘（老三十）逐日收益，**基点整数** |
| `themes.<风口>` | `{ sector, name, r, stocks }`：主行业 id、行业大白话（只在数据里）、行业等权逐日收益（基点）、绑定的股票 |
| `themes.<风口>.stocks[]` | `{ slot, id, name, sec, r }`：游戏股票 id、段内编号（`<风口>_<n>`，不含真实代码）、`name` 恒为 null（游戏里用小人的名字，局末故事不提公司）、真实行业、逐日总收益（基点，含拆股分红） |

`tools/data/segments-manifest.json`（只给数据工具和测试用，不进画面包）：`[{ id, key, from, to, year, regime, title }]`，
key 是内部的 `<开局年月>-<市况>`（例如 `2000-03-crash`），`from` / `to` 是一局对应的真实起止日期。工具里 `loadSegment()` 接受 id 或 key。
生成器内部仍按 key 排序、起标题，同一份年包重新生成时 id、文件、标题和目录顺序逐字节不变。

0.4 开发期的旧存档：`state.real` 里还有 `from` / `to` / `year` 和 `{ date, text, quip }` 格式的大事，照样能读（局末故事按日期折算成第几天，
用通用句）；旧档案图鉴里的旧段 id 和 year / from / to 读进来时丢掉年份字段，照常显示。

不存任何价格；8 个风口全在文件里（开局才决定哪 6 个登场）。

### 2.3 风口 ↔ 真实行业、性格分配

| 风口 | 真实行业（tools/data/sectors.ts 的 id） |
|---|---|
| AI | semis、hardware、netequip |
| 新能源 | energy、utility |
| 大消费 | retail、auto |
| 医药 | pharma、biotech、health |
| 金融 | bank、broker、finance、realestate |
| 低空经济 | industrial、telecom |
| 游戏传媒 | internet、media、software |
| 养猪 | consumer、materials |

行业收益 = 组内当天有行情的股票等权。性格分配（`assign`）：先挑过山车（相对行业的残差波动最大），再挑带头大哥（对行业 β 最大），老实股（波动最小），危险股（段内回撤最深），其余按与行业的相关性当小弟；有化名的优先（化名只用来挑股，不写进段文件）。

## 3. 规则层映射（`BALANCE.real`）

| 0.3 | 真实行情下 |
|---|---|
| 风口热度 ΔH（按阶段随机） | `heatGain × ex / scale − heatPull × (热度 − heatBase)` + 日历、直播间、稀有股票、震荡等加成。ex = 行业相对"所有行业平均"的日超额收益按 `smooth` 指数均摊（总和不变，有惯性）；scale = 未均摊超额收益的平均绝对值 |
| 风口阶段（按天数和失败概率） | 状态机，只能 冷 → 冒头 → 发酵 → 主升 → 高潮 → 退潮 → 冷；冒头可夭折回冷，发酵可证伪直接退潮。门槛见 `real.stage`（热度、当天 ΔH、在阶段里的天数 `ThemeState.age`）。阶段用当天的 ΔH 判定（和 0.3 一样"今天的阶段解释今天的热度变化"），群聊里的拐点、群主专挑高位喊单都照常 |
| 风口涨跌 = coef × ΔH + 噪声 | `themeK × 题材振幅 × ex / scale` + coef × 加成 ΔH |
| 大盘天气（马尔可夫） | 最近 3 天放大后大盘平均 ≥ 0.4pp 晴、≤ −0.4pp 雨 |
| 大盘涨跌 | `ampMarket × 老三十真实涨跌` + 日历 marketAdd；日历和难度的 bullBias / bearBias 按概率把那天变成晴 / 雨并叠加 0.3 的晴雨涨跌（±0.5pp） |
| 个股 = β × 风口 + 大盘 + 噪声 | 大盘系数 × 大盘 + 题材系数 × 风口 + `ownK × 角色噪声 × (股票 − 行业) / 该股平均幅度` + 连板惯性；之后照 0.3：炸板、妖股消息、ST 消息、龙头带小弟、涨跌停 |
| 日历"中报"（题材系数倍数）、"年报"（噪声倍数）、vol | 乘在风口那块 / 个股自身那块 / 全部 |
| 股灾（第 6 级） | 月份和日子对齐段内股灾可选月份里大盘真实跌得最多的一天（跌 ≥ 1.5% 才对齐，否则照 0.3 按种子）；当天还没退潮的风口一起退潮，热度额外 −30（× 退潮倍数 × 2.5），大盘再 −4pp；被打下来的风口回到冷门后报复性反弹（+6 热度 × 4 天） |
| 稀有股票奖励（必不夭折的冒头） | 风口拉到冒头、`sure`，之后 4 天每天 +5 热度 |
| 日历"更容易火" | 冷门风口按概率当天 +6 热度（点燃） |
| 难度"震荡" | ΔH 叠加 ±8 的均匀噪声（同 0.3） |

现值：`ampMarket 0.6, ownK 0.8, smooth 0.35, themeK 11, heatGain 12, heatPull 0.2, heatBase 20`。确定性：真实行情路径只用加减乘除和比较，没有 Math.random / exp / log / pow / sin。

## 4. 接口变化

- `createRun(seed, setup?, { segment?: Segment | null })`、`replay(seed, actions, setup?, { segment })`。
- `GameState.real?: RealMarket | null`：段 id、市况、标题、大事、本局 6 个风口的行业序列（含 `ex`、`scale`）和 40 只以内绑定股票的序列（含 `scale`）。约 15KB，进存档；读档、回放不用再下载。
- `DayPlan.base?: { market, dH }`：今天来自真实行情的部分（其余是加成），归因用。
- `ThemeState.age?`：真实行情下在当前阶段的天数（`left` 不用）。
- `crashPlan(seed, difficulty, real?)`。
- `pickSegmentId(seed, ids, hashSeed)`：每日挑战种子固定，所以同一天大家同一段。
- `storyView(state)`：局末"这段日子"（`{ title, regime, regimeWord, lines, verdict }`；合成行情为 null）。`runSummary(state).segment` 带上本局的故事和吐槽；档案 `Profile.segments`（`SegmentRecord`：段信息 + 玩过 / 通关次数 + 最近一局的 `story` / `verdict`，图鉴里重看），`RecordResult.newSegment`。
- 故事的拼法（确定性，按种子 + 段 id + 本局结果）：开头（按市况 5 选 1）→ 大环境和冷热风口一句 → 段内大事的故事版（最多 3 条，只讲玩家撑到的那段时间；按 `BEATS[日期]` 转写，大事行业对应到本局在场风口时用该风口的小人，否则用泛称；表里没有的按大环境方向用通用句；伤亡、选举类不写）→ 赚得最多 / 亏得最多的一笔 → 跟得最多的群友（赚 / 亏 / 没跟）→ 通关还是第几个月爆掉；超过 8 句时先省大环境那句、再省群友那句。另给一句按市况 × 输赢的结局吐槽。时间一律说游戏内的"第二个月月底"，真实日期按自然日比例折算到 58 个交易日。
- 不能出现：四位年份、真实日期、化名表里的化名和代码、`s_` / `tmp_` / `x_` / `N0` 这类 id、段 id（`tests/story.test.ts` 遍历所有段 × 种子 × 结局扫描）。

## 5. 平衡（2026-10-12 全量，`node tools/sim.ts --real-table [--ext] --runs 540 --seed f1`，135 段每段每级 4 局；合成行情是 `--diff-table --ext --runs 300 --seed f1`）

段库：1996-01 到 2018-03 共 135 段（牛 39、横盘 39、熊 20、崩盘 20、泡沫 17；每年 6–7 段，2018 年 1 段），单段 18–25KB，合计 2.46MB（gzip 1.05MB）。
150 段做不到：一局 58 天、相邻最多重叠三分之一 → 开局日至少隔 39 个交易日，1996-01 到 2018-03 约 5,550 个可用开局日，上限约 142 段。

| 机器人 | 模式 | L1 | L2 | L3 | L4 | L5 | L6 | L7 | L8 |
|---|---|---|---|---|---|---|---|---|---|
| normal | 真实 0.3 玩法 | 48.3 | 23.3 | 21.9 | 11.1 | 3.5 | 1.1 | 0.4 | 0.9 |
| smart | 真实 0.3 玩法 | 75.6 | 60.4 | 56.9 | 44.6 | 27.4 | 22.2 | 16.9 | 10.4 |
| oracle | 真实 0.3 玩法 | 98.9 | 96.7 | 95.7 | 95.7 | 84.8 | 80.2 | 73.1 | 63.7 |
| normal | 真实 + 新机制 | 47.2 | 22.6 | 20.7 | 9.1 | 3.5 | 2.0 | 1.1 | 0.9 |
| smart | 真实 + 新机制 | 74.6 | 60.0 | 57.6 | 39.3 | 25.2 | 20.6 | 15.4 | 12.8 |
| oracle | 真实 + 新机制 | 98.7 | 94.8 | 93.0 | 93.0 | 81.5 | 76.7 | 67.4 | 60.6 |
| follower（躺平） | 真实 + 新机制 | 7.8 | 6.3 | 5.4 | 5.2 | 3.0 | 1.3 | 1.1 | 1.1 |
| 重仓派 heavy | 真实 + 新机制 | 50.9 | 36.7 | 36.1 | 22.6 | 9.3 | 6.7 | 6.5 | 3.5 |
| 押跌派 shorter | 真实 + 新机制 | 40.9 | 15.7 | 14.8 | 6.3 | 2.8 | 1.9 | 1.1 | 0.9 |
| 抵押赌徒 gambler | 真实 + 新机制 | 60.6 | 28.7 | 15.4 | 2.8 | 3.3 | 1.9 | 1.5 | 1.1 |
| smart + 抵押 gambler-smart | 真实 + 新机制 | 71.7 | 62.2 | 47.0 | 30.4 | 18.5 | 16.1 | 11.9 | 9.4 |
| normal | 合成 + 新机制 | 37.0 | 19.0 | 14.7 | 5.7 | 3.7 | 1.0 | 0.7 | 0.7 |
| smart | 合成 + 新机制 | 84.0 | 69.3 | 61.3 | 51.7 | 44.7 | 34.3 | 25.0 | 19.3 |
| oracle | 合成 + 新机制 | 97.0 | 95.3 | 91.0 | 91.0 | 88.0 | 81.3 | 74.7 | 59.7 |
| heavy / shorter / gambler | 合成 + 新机制 | 51.0 / 40.0 / 56.7 | 37.3 / 17.7 / 25.7 | 28.7 / 18.7 / 6.0 | 21.3 / 11.3 / 0.0 | 16.3 / 10.0 / 2.0 | 9.7 / 6.7 / 0.7 | 7.3 / 2.3 / 0.0 | 6.0 / 0.7 / 0.7 |

第 1 级按市况（真实 + 新机制，normal / smart / oracle / follower / gambler）：
牛 50.6 / 67.3 / 98.7 / 7.1 / 64.7；泡沫 41.2 / 75.0 / 98.5 / 11.8 / 51.5；横盘 50.6 / 76.9 / 98.7 / 10.9 / 64.7；熊 45.0 / 81.3 / 98.8 / 6.3 / 55.0；崩盘 41.3 / 77.5 / 98.8 / 1.3 / 57.5。
各难度合计 normal：牛 13.7、泡沫 14.0、横盘 14.6、熊 11.1、崩盘 12.3。

对照第 5、7 节的要求：
- 难度梯度成立：normal、smart、oracle 随难度下降（oracle L3 = L4，第 4 级只影响群聊，和以前一样）；gambler L4 2.8 / L5 3.3 是 540 局里 15 对 18 局的噪声。
- 熊市、崩盘有通关路径：第 1 级 normal 45 / 41%、smart 81 / 78%、oracle 99%。
- 牛市不能躺赢：牛市段 follower 7.1%。
- 抵押不是最优解：第 1 级赌徒 60.6% 高于 normal、低于 smart；第 3 级起比 normal 差（15.4 vs 20.7），第 4 级起几乎全灭；smart 套上抵押每一级都比不套差（71.7 vs 74.6，L3 47.0 vs 57.6）。
- 都满足，所以 `BALANCE.real` 和 real.ts 的映射参数不动；只改了切段的市况阈值（见 2.1），没改规则层数字。
- 和 26 段时比：normal L1 41 → 47%、smart 78 → 75%、oracle 97 → 99%，方向和幅度在段库换代的正常范围内。
- 合成行情那两条 ✗（normal L7 = L8、smart L8 19.3% > 15%）是合成模式的老样子，和这次段库无关。

## 6. 全量数据到位后

1. 把 Nasdaq key 放进 `~/.config/nasdaq/nasdaq.env`，下载 WIKI Prices 全量到 `.data/wiki-prices/`；
2. 补 `tools/data/dow.ts`：1996–1997、2001–2006、2009–2018 的老三十成分与换股日（现在只有 1998–2000、2007–2008）；
3. 补 `tools/data/sectors.ts`：逐年跑 `node tools/data/candidates.ts --year <年> --missing` 给候选股标行业；
4. 可选：`tools/data/events.ts` 补其他年份的大事（新增的大事要在 `src/core/content/tales.ts` 的 `BEATS` 里写故事版，没写的按大环境方向用通用句），`aliases.ts` / story 补化名；
5. `node tools/data/segments.ts --full --force`：切片 → 建年包到 `.data/wiki-prices/packs`（不进仓库）→ 切段（gap 39，约 135 段）。build.ts 一次建 23 年会爆内存，要逐年跑（`--years <年>`，每次合并 index.json）；
   2026-10-12 已跑通：sectors.ts 补到 1,298 个代码（新年份候选 738 个里标了 713 个，25 个归不了的不进池），events.ts 的大事都有故事版；
6. 重跑 `node tools/sim.ts --real-table --runs 2000` 复核平衡。

## 7. 里程碑 C：仓位、押跌、抵押、小知识（2026-10-12）

设计见 `docs/design-0.4-c.md`（第 7 节是实现决定）。数值都在 `BALANCE.ext`，`node tools/sim.ts --set ext.xxx=…` 可以临时覆盖。

### 7.1 开关与状态

- `createRun(seed, setup, { segment, ext: true })` 打开新机制，`GameState.ext: ExtState`（`loans`、`called`、`learned`、`log`）。
  不开（缺省）时和 0.3.1 完全一样：新操作报"这一局没有这个玩法"，新道具不进奖励池和盲盒，新事件 `prepare` 返回 null，空军老周不入群；
  `tests/replay-030.test.ts` 逐位一致。回放要带同样的开关：`replay(seed, actions, setup, { segment, ext: !!state.ext })`。
- `Holding.units`（缺省 1）、`Holding.short`、`Holding.squeezed`；`TradeLog.short / units`；`HoldingMove.units / short / squeeze`；
  `DayReport.bank?: { called, seized }`；`Rec.short`（空军老周建议押跌）；`RetPartKind` 新增 `short`、`squeeze`。
- 规则表新增 `canShort`、`squeezeMult`、`interestMult`、`freeAdd`；`EventCtx` 新增 `takeLoan(id, rateMult)`、`setLoanRate(id, rate)`；`ItemDef.ext`。

### 7.2 操作与规则

| 操作 | 规则 |
|---|---|
| `buy { rec, slot?, size?, short? }` | `taste` 1 份、`half` 2 份、`heavy` 剩下全部（1 份 = 账户 1/4，总份数 = 格子数）；换股时那一格的份数先回来；现金不到半份不能买。超过 1 份时这一笔多花 `impact × (份 − 1)` pp（账户 × 份/4 × …）。`short` 要 `canShortNow` |
| `add { slot }` | +1 份（现金不够有多少加多少），算一次买入（`freeAdd` 除外）；持有收益按成本摊薄 |
| `trim { slot }` | 份数减半，按 0.5 份向下取整、至少留 0.5；T+1 同卖出；不记一笔交易，`stats.sells` +1 |
| `borrow { id }` | 第 `bankMonth` 月起、开盘前；借完 `账户 ≥ 欠款 × borrowLine` 才借；借款加进账户 |
| `repay { id }` | 开盘前、账户够还；还清就拿回东西 |

- 账户日收益 = Σ 每格收益 × 份数 / `holdingBase(s, Σ份数)`（0.3 的一格 = 1 份，结果不变）。
- 押跌那一格的收益 = −个股涨跌 − `shortFee` + 顺风逆风 `shortWind`（真实行情：开盘前 20 个交易日大盘累计涨跌 × −`shortWeather`/2，封顶 ±1.5 × `shortWeather` pp；合成行情：晴天 −`shortWeather`、雨天 +`shortWeather`）；涨停时再 − 涨幅 × (`squeeze` − 1) × `squeezeMult`；不走 `onHolding` 道具，只走 `onExit`（自动卖出）。
  押跌的跌停放烟花、涨停下雨；归因只有"押跌"和"被轧"两项（加道具）。
- 银行：每天收盘和每月还完钱后检查——账户 < 欠款 × `seizeLine` 时先收走借得最多的那件（账户 −借款 −借款 × `penalty`），直到回到线上；
  再看账户 < 欠款 × `callLine` 时打电话（跌破那一下才打，回到线上后清掉）。月底先付利息（`Σ 借款 × 月利率`）再还月供；第 12 个月还完后银行收回没还的借款。
- 押跌解锁 `canShortNow(s)`：规则表 `canShort`（押跌许可证、炒股大佬）或 `difficulty ≥ shortLevel`（现在 99 = 难度不送）。

现值：`taste 1, half 2, add 1, minUnit 0.5, impact 1.2, squeeze 1.5, shortFee 0.3, shortWeather 2, bankMonth 2, borrowLine 1.6, callLine 1.45, seizeLine 1.25, penalty 0.2, amountStep 0.1, rateStep 0.1`。
抵押物（第 1 级；难度每高一级借款额 +10%、利息 +10%）：金镯子 2 万 / 月息 8%；车 5 万 / 10%；房子 12 万 / 9%（第 3 级起）；爸妈的养老钱 8 万 / 6%（第 5 级起）。

### 7.3 新事件（GameEvent）与查询

- 事件：`added`、`trimmed`、`borrowed`、`repaid`、`interestPaid`、`bankCalled`、`seized`、`squeezed`、`learned`；`bought` 多了 `units / short / cost`；
  群友反应 `comment`（买重仓、押跌、借钱、赎回时，和收盘时的被轧、押中跌停、银行来电、收走）。
- 查询（`src/core/extview.ts`）：`buyOptions`、`positionsView`、`bankView`、`knowledgeView`、`knowledgeCard`、`extTip`、`extRecap`、`unitsWord`、`SIZE_LABEL`；
  引擎：`unitsOf`、`usedUnits`、`freeUnits`、`sizeUnits`、`canShortNow`、`debtOf`、`loanOffer`。
- 档案：`Profile.knowledge`、`learnKnowledge(profile, ids)`、`mergeKnowledge`；`RecordResult.newKnowledge`；`RunSummary.knowledge / recap`。
- 结局故事：`storyView` 在玩家自己那几句前面最多加两句经历（被收走 > 赎回 > 押到年底 > 押跌 / 被轧 > 重仓），模板 `EXT_TALES`。
  故事过滤词表 `SENSITIVE_WORDS` 补上海啸、爆炸、疫情和停市 / 休市 / 复市（灾难、袭击导致的停市），`tests/ext.test.ts` 核对已知的伤亡类大事都被滤掉。

### 7.4 平衡

全量 135 段的最新数字见第 5 节（2026-10-12）。下表是 26 段时的标定记录，留作对照。

（见下表；`node tools/sim.ts --diff-table --ext --runs 300` 与 `--real-table --ext --runs 520`，种子 c1-*；不带 `--ext` 是 0.3 玩法的对照。）

| 机器人 | 模式 | L1 | L2 | L3 | L4 | L5 | L6 | L7 | L8 |
|---|---|---|---|---|---|---|---|---|---|
| normal | 真实 0.3 玩法 | 40.0 | 21.3 | 20.2 | 7.3 | 3.7 | 2.1 | 1.3 | 0.6 |
| normal | 真实 + 新机制 | 41.2 | 21.2 | 19.2 | 8.7 | 2.9 | 1.2 | 0.4 | 0.4 |
| smart（重新标定） | 真实 + 新机制 | 77.5 | 61.2 | 59.6 | 45.4 | 28.1 | 22.9 | 17.9 | 14.2 |
| oracle | 真实 + 新机制 | 96.5 | 91.2 | 90.0 | 90.0 | 75.4 | 73.3 | 63.8 | 54.8 |
| follower | 真实 + 新机制 | 10.2 | 9.2 | 9.0 | 8.8 | 4.0 | 3.1 | 2.3 | 1.9 |
| 重仓派 heavy | 真实 + 新机制 | 47.7 | 31.5 | 31.0 | 22.9 | 9.8 | 8.7 | 6.3 | 4.0 |
| 押跌派 shorter | 真实 + 新机制 | 34.0 | 17.1 | 16.2 | 6.3 | 2.5 | 1.3 | 0.4 | 0.6 |
| 抵押赌徒 gambler | 真实 + 新机制 | 52.1 | 23.3 | 12.9 | 2.1 | 1.5 | 0.8 | 0.6 | 0.4 |
| normal | 合成 0.3 玩法 | 35.7 | 19.3 | 13.3 | 5.0 | 3.0 | 1.0 | 0.3 | 0.7 |
| normal | 合成 + 新机制 | 36.0 | 20.3 | 12.0 | 5.0 | 2.7 | 1.0 | 0.7 | 0.0 |
| smart | 合成 0.3 玩法 | 83.0 | 66.0 | 47.3 | 37.7 | 31.3 | 20.3 | 13.0 | 8.3 |
| smart | 合成 + 新机制 | 85.0 | 71.0 | 61.7 | 52.7 | 44.3 | 35.7 | 27.3 | 17.7 |
| oracle | 合成 + 新机制 | 97.0 | 94.7 | 88.7 | 88.7 | 86.7 | 79.7 | 72.7 | 57.3 |
| heavy / shorter / gambler | 合成 + 新机制 | 50.3 / 40.7 / 46.0 | 31.0 / 21.3 / 23.3 | 24.3 / 20.0 / 4.7 | 18.3 / 12.0 / 1.0 | 15.0 / 11.0 / 2.0 | 10.7 / 8.3 / 1.3 | 7.0 / 4.3 / 1.7 | 4.3 / 1.0 / 0.0 |

- smart 重新标定：0.3 的阶段贝叶斯模型在真实行情下不成立；真实行情里风口涨跌是行业超额收益按 `smooth` 均摊的，今天的期望 ≈ (1 − smooth) × 昨天的风口涨跌，
  再按群聊方向 × (可信度 − 1/3) × `REAL_MSG`（5，`--real-msg` 标定 2/5/9 → 5）加减。第 1 级 15.2% → 77.5%，各级高于 normal。
- oracle 第 8 级：真实行情下它的往后几天原来按合成行情的阶段剩余天数推（真实行情不用 `left`），改成直接看行情段往后两天的热度变化，52.5%（0.3 玩法）/ 54.8%（新机制）≥ 50%。
- 抵押放大方差、不是最优解：第 1 级真实行情 normal 终局账户均值 1.8 万、标准差 3.3 万；赌徒均值 4.6 万、标准差 7.6 万（p90 17 万）；第 3 级起赌徒明显比 normal 差；smart 套上赌徒在合成第 1、3 级是 84% / 37%，不套是 85% / 53%。
- 重仓：冲击成本 1.2 之后仍比 normal 高（normal 买得慢、现金常常闲着），但方差大得多（均值 6.8 万、标准差 11.7 万）；冲击成本 1.5 时第 1 级和 normal 持平。
- 押跌：真实行情第 1 级押跌派每局押跌赚亏：崩盘 +6,238、熊市 +5,448、横盘 +4,120、牛市 +1,773、泡沫 −617（顺风逆风之前五种市况几乎一样）。
- 押跌不由难度送：第 6 级起送时 smart 合成 L5 47% → L6 76%，梯度倒挂。
