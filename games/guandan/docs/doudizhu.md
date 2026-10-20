# 牌馆：掼蛋 + 斗地主

> 掼蛋模块里两个玩法：掼蛋和斗地主（经典叫分）。本文写分层、两个玩法共用什么、斗地主各模式怎么接；
> 斗地主的规则取舍在 `docs/rules.md` 的"斗地主"一节，电脑在 `docs/ai.md` 的"斗地主"一节，实盘数字在 `docs/stake.md` 第 10 节。
> 不变的东西：模块 id `guandan`、Worker `guandan`、路径 `/games/guandan/`、存储前缀 `guandan.`、好友房的流程和按钮。
> 不做的东西：癞子、明牌、加倍、抢地主（叫分制本身就定地主）。以后要加再单独提。

## 1. 分层

```
src/core/                 通用层（纯函数，约束同规则核心：不碰 DOM、Date、Math.random），不引用任何玩法
  rng.ts                  带种子、按用途分流的随机数
  cards.ts                牌的编码（0..107，一副牌就是 0..53）、点数、花色、王
  seats.ts                n 人座位环
  play.ts                 牌型识别框架：一手牌的通用形状 Play 和 PatternSet 接口（interpret / beats / enumerate / choose），
                          "选中的牌 → 候选读法 → 首出让人挑、跟牌取压得上的"这套流程两个玩法共用
  stake.ts                实盘档位表（两个玩法同一套，钱包只认 small / mid / big / lux）
src/variants/guandan/     掼蛋：core、ai、net、stake
src/variants/doudizhu/    斗地主：core（patterns、game）、ai（hand 拆牌、search 残局、decide）、net（rules 房间规则、match 匹配档位）、stake
src/net/hall.ts           牌馆的房间规则：一个 kit RoomGame 按状态里的 variant 转给掼蛋或斗地主
src/view/                 画面层两个玩法共用：手牌、出牌区、座位、按钮、弹窗、牌面、音效、kit 的互动和聊天
```

- 玩法之间互不引用，通用层不引用任何 `variants/*`；`tests/architecture.test.ts` 守着，纯度约束覆盖 `variants/*/core|ai|stake`。
- 出牌轮转没有抽成通用的：两个玩法的接风、结束条件差得多，各写在自己的 `game.ts` 里比加钩子简单。
- 画面没有抽"玩法接口"：斗地主有自己的场景 `DdzScene` 和会话 `DdzSession`，复用掼蛋的部件；手牌和出牌区由玩法给"怎么理牌、一手牌怎么写"（`HandOrder`、`DescribePlay`，不给就是掼蛋原样）。

## 2. 掼蛋的金样

拆通用层时掼蛋行为一点不能变，靠金样证明，金样留下来当回归测试：

- 场景在 `tests/golden-scenarios.ts`，覆盖单机（三档难度短局和完整局、单机实盘四档、地方规则全反过来）、每副的复盘名场面称号、回放、
  房间规则层（娱乐、换人接管、实盘四档、再来一场、关房结回）。每一步的输出按固定顺序序列化后喂进 sha256，`tests/golden/guandan.json` 只存哈希和项数。
- `tests/golden.test.ts` 逐个比对；`node tools/golden.ts --dump <场景> <文件>` 导出一个场景的明细，改前改后 diff 找第一个不同的地方。
- 有意改了掼蛋行为的 PR 用 `node tools/golden.ts --write` 重写，并在说明里写为什么；没打算改行为的 PR，`git diff origin/main -- tests/golden` 必须为空。

## 3. 斗地主的规则核心

要点（细节和取舍见 `docs/rules.md`）：一副 54 张、3 人各 17 张、3 张底牌；叫 1 / 2 / 3 分，叫 3 分立刻结束；三家都不叫重发，连续 3 副都没人叫，第 4 副先叫的人以 1 分当地主。
一副的分 `s = 叫分 × 2^k`（k = 炸弹 + 王炸 + 春天 / 反春），地主赢 +2s、农民各 −s，反之相反，三家和恒为 0。

- 选项 `DdzOptions { deals, dealCap, cap }`：一场几副、每副封顶、一场累计封顶（到了就结束，最后那副截的是 `s`，仍然零和）。娱乐是 `DDZ_FUN`（6 副、不封顶）。
- 规则版本 `DDZ_RULES`（现在是 1），和掼蛋的分开记；存档、房间按它认旧局。
- 发牌：单机按种子派生；联机按房间的 256 位熵 `stream(key, 'deal', 第几副 × 4 + 第几次重发)`，同一副重发也不重复。
- 测试：`ddz-patterns`（每种牌型的边界）、`ddz-game`（回放确定性、零和、`viewDdz` 不泄漏手牌和未翻开的底牌）、`ddz-bots`（随机机器人大批量无非法动作、无死锁）。

## 4. 画面

- 三人桌：0 我（下）、1 老周（右，下家）、2 王姐（左，上家），锚点 `table/layout.ts` 的 `seatAnchors3`（两侧座位上提，让开地主标记和气泡）。
- 叫分时按钮区换成"不叫 / 1 分 / 2 分 / 3 分"（比当前低的灰掉，让开"理牌"）；顶上写底分、倍数和底牌（叫完才翻开）。
- 主页：入口先藏着，只有带 `?ddz=1` 时才有"掼蛋 / 斗地主"切换，面板标题换成"牌馆"，上次选的玩法存 `guandan.variant`。
- 斗地主的玩法说明只有一份：文字在 `src/view/ddz-rules.ts`（牌型 / 叫分 / 算分三页），牌型图示用 `ui/patterns.ts` 的 `DDZ_PATTERNS`，由 `openDdzRules` 打开；牌桌右上的"规则"和主页右上的"规则"（当前玩法是斗地主时）共用它，掼蛋的主页仍是掼蛋的规则。改规则要一起改这里和 `docs/rules.md`。
- 新手引导：第一次进单机娱乐牌桌，发完牌弹 4 步（先叫分 → 地主先出 → 出牌 / 提示 / 不要 → 分怎么来），外壳与掼蛋共用；看过记在 `guandan.ddz.tutorial`（只在本机，不进云同步）。好友房、实盘、每日挑战、托管和带 `seed` 的调试开局不弹。
- 冒烟：`npm run shot -- --only ddz`（引导、单机一整场和每日挑战）、`npm run stake-smoke -- --ddz-only`（单机实盘）、`npm run stake-smoke -- --ddz-room`（好友房实盘）、`npm run online-smoke -- --ddz`。

## 5. 模式

| 模式 | 现状 |
|---|---|
| 单机娱乐 | 我 + 两个电脑，三档难度，6 副一场；存档 `guandan.ddz.save`，战绩 `guandan.ddz.stats`（只在本机，不进云同步） |
| 每日挑战 | 种子只看北京时间的日期，两个普通电脑，6 副累计分交到平台的 `daily-<日期>-ddz`（`public/daily.json` 写分数怎么显示）；不存档、不记战绩，可以再打一次同一副 |
| 单机实盘 | 选档位 → 带入一份 → 8 副或我累计到 ±40 分 → 结回；存档 `guandan.ddz.stake`，ref 是 `solo-ddz-<档位>-<32 位十六进制>`，和掼蛋的分得开。数字、每档的电脑和模拟结果见 `docs/stake.md` 第 10 节 |
| 好友房 | 开房选项多一个 `variant: 'ddz'`（没有就是掼蛋，旧房间照常），3 个座位，缺人电脑补；进房、选座、开局、离开、旁观、聊天、邀请链接的流程和掼蛋一样。玩法由房间信息决定，输码、邀请链接进房不靠本机设置。页面的联机会话和掼蛋共用基类 `RoomLink`（`src/view/net.ts`） |
| 快速匹配 | 娱乐档位 `ddz-fun`，一桌 3 人，同一个排队类（`worker/match.ts` 按档位给桌大小） |
| 好友房实盘 | 开房请求体 `{ variant: 'ddz', stake: 档位 }`；6 副或任何一家到 ±40 分，规矩照掼蛋好友房（至少 2 个真人、离开结回、重新带入），通用部分在 `src/net/stake-table.ts`，斗地主的桌在 `src/variants/doudizhu/net/stake.ts`，ref `ddz-<16 位十六进制>`。见 `docs/stake.md` 10.4 |
| 实盘匹配 | 档位 `ddz-real-<档位>` 四档，一桌 3 人；选档页的"和电脑 / 快速匹配"，排不到转同档单机 |

- 平台那边：电脑名字老周、王姐登记在 `RESERVED_PERSONAS`；`games.ts` 掼蛋条目的每日子榜 `daily: [{ id: 'ddz', name: '斗地主' }]`。
