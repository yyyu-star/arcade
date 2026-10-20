# Arcade · Guandan

Guandan (掼蛋) — the four-player, two-deck partnership climbing game, from level 2 up to A. One of the games on the Arcade mini-game site, running on Cloudflare Workers.

- **Full rules** in a pure, deterministic rules core (`src/variants/guandan/core/`): every pattern including wild cards, tribute / refusal / return, *jiefeng*, level-ups and the A round; same seed + same actions = same game.
- **Solo play** against three computer players with personalities, entirely in the browser: three fun difficulties (beginner / normal / expert) and four real-chip tables, tuned against two simulated player models (`docs/ai.md`). The computer only reads its own hand and public information.
- **Friend rooms** via a six-digit code or an invite link (built on the shared `arcade-kit` room): reconnects, auto-play when someone is away, "play again"; the server never sends anyone else's cards.
- **Table fun** — props, stickers and phrases, with computer players that react — from the shared `arcade-kit/table-fun` component.
- **Play chips only**: chips live in the platform wallet and have no cash value; they cannot be bought, exchanged or transferred.
- **Standalone deploy**: `wrangler.jsonc` deploys as-is without the platform (guest identity, solo and friend rooms, no wallet).

```bash
cd games/guandan && npm ci
npm run dev        # page on :5174
npm test           # vitest (npm run typecheck for types)
npm run test:room  # friend-room tests on real Durable Objects in workerd
npm run shot       # headless Chromium smoke test with screenshots
```

The rest of this README, the design documents (`docs/`) and the code comments are in Simplified Chinese. MIT licensed, see [LICENSE](LICENSE).

---

# 掼蛋（guandan）

两副牌、四人、对家一队，从打 2 升到过 A 的掼蛋。单机和三个电脑打，也能开好友房四人联机；arcade 小游戏平台的一个独立模块，挂在平台的 `/games/guandan/` 下。

![封面](public/cover.png)

## 功能

- **完整规则**：牌型识别（含逢人配的所有解释）、比大小、进贡 / 抗贡 / 还贡、接风、名次升级、打 A，规则核心是纯函数、同一种子同一串操作结果完全相同（`src/variants/guandan/core/`，取舍见 `docs/rules.md`）。
- **电脑对手**：老张、小美、阿强各有性格（爱炸、捂炸弹、抢牌），每场状态有起伏，随级数差和输赢调整，说话和出手快慢跟着性格走；
  强弱按场地定，新手场偏弱、档位越高越强。只读自己能看到的信息（`src/variants/guandan/ai/`，设计和模拟见 `docs/ai.md`；怎么保证、怎么自己验证见下面"电脑不看牌"）。
- **单机**：标题页、新手引导、规则说明、设置、战绩，每副结算有复盘和称号；云存档同步战绩（需要平台账号）。
- **能单独部署**：不要平台也能部署成一个能玩的游戏（单机 + 游客好友房，见"单独部署这个游戏"）。
- **好友房**：开房后"叫朋友来"直接叫好友（有平台、登录时；对方页面顶上弹一条）或者发链接，点开就进房、自动坐下；已经开打的先旁观（看得到桌面、出牌、分数，看不到任何人的手牌），有电脑座位时点"坐下"接管；掉线重连、走开了自动托管、打完"再来一场"；
  互动：短语、表情包、扔道具（人人一样、免费，不影响牌局；点头像扔、点自己头像发表情，连击、回敬；长按连扔；单机和好友房里的电脑按爱闹、普通、高冷的性格回应、回敬，炸弹、头游、双下时也会起哄，单机里你想太久阿强会扔个炸弹催你；整套是共用包的 `arcade-kit/table-fun`，几个牌桌游戏一样）。
  聊天：入座的人在"互动"里的"聊天"页打字（一条最多 30 个字，链接和号码发不出去，脏话打码）；**聊天不保存，房间关了就没了**，设置里能选"不看"。
  单机也能打字：只在自己头像旁冒气泡、不发到任何地方，电脑不读、不回。房间是 Cloudflare Durable Object，服务端说了算，底座是共用包 arcade-kit（npm 上的 `@yyyu-star/arcade-kit`，源码在仓库的 `packages/arcade-kit`）。
- **分享和好友**（有平台、登录时）：整局、实盘一场打完，结算页右上角"分享"出一张战绩图（手机上直接调系统分享）；好友在平台上看得到你在掼蛋、在哪个好友房，好友叫你来打时页面顶上弹一条"去 / 不了"（共用包的 `arcade-kit/share`、`arcade-kit/social`）。
- **快速匹配**：不用约人，娱乐和实盘每一档都能点"快速匹配"和陌生真人凑一桌（最多等 15 秒，空位电脑补，只剩自己就转同一档的单机）；匹配桌上的打字聊天可以在设置里关掉（"聊天：不和陌生人"）（`arcade-kit/match`）。
- **实盘**：用平台钱包里的筹码带入、结回，单机和好友房都有（筹码不能买、不能换、不能转，设计见 `docs/stake.md`）。
- **手机友好**：横屏牌桌按可见区域排版，老 iPhone 省内存（渲染倍数封顶、被系统杀过自动降档），画面全部程序生成。

### 好友房里会碰到的限制

原则是联机体验要顺、不设没必要的限制。没必要的已经去掉，留下的都是为了不超账单、筹码算得对或者牌局能往下走，页面上都有一句大白话：

| 限制 | 为什么留着 | 用户看到的 / 怎么办 |
|---|---|---|
| 每人同时开 5 个房间、每天开 100 个 | 防一个号刷房间吃光全站额度 | "你同时开着的房间太多了，先离开几个再开"；"开房间"永远开新的，不再把人送回旧房间 |
| 全站每天 300 个房间、写入到 5 万停开新房、6 万收场 | Cloudflare 免费额度是全账户共用的 | "今天联机的人太多了，明天再来，单机照常玩" |
| 每手 30 秒、结算页 20 秒 | 一个人走神不能卡住另外三个人 | 头像上倒计时，最后 5 秒嘀嗒；到点按"能不出就不出"代出 |
| 连着两手到点被代出，就算走开了：轮到他只等 3 秒 | 人在但走开了，别的三个人不用每手干等 30 秒 | 头像下写"托管中"；他自己出一手、或者点"我回来了"马上恢复 30 秒；掉线重连、刷新页面回来的自动恢复 |
| 掉线 60 秒后电脑接着打 | 同上 | 回来自动回到自己的座位接着打 |
| 别人坐过的座位只能他本人回来坐 | 实盘的结回要记到那个人的钱包上 | "座位被占：这是别人的座位，电脑在替他打"；没人坐过的电脑座位谁都能接管（开打后点开链接先旁观，点"坐下"接管） |
| 实盘房间只能旁观、不能中途带入 | 实盘要开局时两个以上真人一起带入（防绕开单机的每日上限） | 旁观时没有"坐下"；坐过的人回自己的座位照旧 |
| 实盘房间至少两个真人 | 防一个人带三个电脑绕开单机的每日上限 | "实盘好友房至少要两个人；一个人想玩实盘，去单机" |
| 短语、表情、道具每人每秒 1 个（能攒 3 个；自己这边道具另有 1.5 秒冷却） | 不刷屏、房间账单 | 不提示，发得快的自动排队 |
| 打完一整场，"再来一场"等 3 分钟（娱乐房间） | 没人点的房间要关掉、还开房名额 | 结束页上点"再来一场"，这一桌自动换到新房间，队友、上下家和上一场一样；过了 3 分钟再点，自己先去新房间，再叫朋友 |
| 必须登录（本站） | 测试期邀请制 | 点开房间链接没登录的，先去登录，登录完直接回到这个房间；单独部署没有登录，用游客身份 |

## 电脑不看牌：怎么保证、怎么自己验证

有人怀疑电脑透牌。不透，做法和检查都在仓库里，谁都能自己跑：

- **电脑只拿到自己座位的视图**：`src/variants/guandan/core` 的 `viewFor(状态, 座位)` 只有自己的手牌、公开的出牌、每人还剩几张、公开的贡牌和自己参与的还贡牌，没有别人的手牌。
  电脑（`src/variants/guandan/ai`）的输入就是它，代码里连完整牌局状态的类型 `GameState` 都不引用。
- **电脑拿不到能重算发牌的东西**：发牌和首出用 `'deal'`、`'firstLead'` 两条随机流，只在 `src/variants/guandan/core` 里。
  电脑的随机数和"这一场的状态"按用途另外派生（单机 `src/view/session.ts` 的 `soloSeeds`，好友房 `src/variants/guandan/net/rules.ts` 的 `aiSeed`、`formSeed`），拿不到牌局种子、密钥本身。
- **好友房里服务端说了算**：每个人（包括浏览器里的你）收到的只有自己座位的视图，别人的牌不下发。

自己验证（在本目录 `npm ci` 以后）：

```bash
npx vitest run tests/ai.test.ts -t 反事实   # 反事实测试：几百个决策点上把另外三家没亮出来的牌重新分一遍，电脑的决定必须一次都不变
npx vitest run tests/architecture.test.ts   # src/variants/guandan/ai 不引用 GameState、不出现 'deal' / 'firstLead'
npx vitest run tests/game.test.ts -t 泄露    # 任何时刻的视图里只有自己的牌和公开信息
```

反事实测试走的是游戏里真正调用的函数：单机的 `Session.botAction`（娱乐和实盘），好友房的 `guandanRoom.ai`（房间里的电脑和替掉线真人代打）。
同一个测试里还有阳性对照：两个故意偷看的电脑（偷看搭档的牌、拿全桌的牌当随机种子），同样的方法能抓出来，说明这个检查不是摆设。想跑更多局，把测试里的 `DEALS` 调大。

## 本地开发

需要 Node 22（`.nvmrc`）。在本目录里：

```bash
npm ci
npm test              # vitest：牌型、比大小、流程、进贡、打 A、回放、防泄漏、电脑、架构约束
npm run typecheck     # 全量 tsc；npm run typecheck:core 只查规则核心和电脑（不带 DOM 库）
npm run sim           # 机器人对打 5000 副：电脑 vs 随机；更多模式见 tools/sim.ts 顶部
npm run ai-sim -- solo # 各场地电脑的强弱（还有 room / style / time，见 docs/ai.md）
npm run dev           # 0.0.0.0:5174（局域网里的手机也能打开）
npm run build         # 页面产物 dist/（预览 npm run preview → 4174）
npm run shot          # 无头冒烟 + 截图到 shots/（--playtest 真实速度鼠标试玩一副，--only desktop,mobile,viewport,… 只跑部分）
node tools/mem.ts     # 内存估算（模拟 iPhone 8 / 8 Plus 横屏，各渲染倍数的纹理和画布占用）
npm run test:room     # 联机房间测试（workerd 里的真 Durable Object）；npm run room-sim 规则层批量对打
npm run online-smoke  # 本地联机栈 + 四个无头浏览器打一整副、断线重连、同号顶替（--quick 跳过 70 秒那项）
npm run quota-smoke   # 额度调得极紧的本地联机栈：同时开着的房间太多、今天开房次数用完、今天人太多、不进新人、额度满了收场，五种提示
npm run stake-smoke   # 实盘：本地栈（真 Worker + 假钱包）上单机的选档、退回、接着打、结算、到顶、再来一场、现在结算、被拒，加好友房实盘打完一场（--no-room 跳过）
npm run art           # 美术预览图 → shots/art/；npm run cover 重新生成 public/cover.png
npm run standalone-smoke # 单独部署的样子：原样用 wrangler.jsonc 起 wrangler dev（没有平台），单机、两个游客的好友房、实盘接口拒绝
npm run build:cf      # 部署产物 dist-cf/games/guandan/（线上 Worker：worker/，登录闸门 GATE=off|login、好友房开关 ONLINE=on|off，见 AGENTS.md）；npm run deploy = build:cf + wrangler deploy（单独部署，见下面）
```

调试用 URL 参数：`?seed=abc`（直接开局）、`&jump=tribute`（第二副进贡）、`&jump=ace`（打 A）、`&debug=1`（挂 `window.__game`）、
`&autoplay=1`（电脑代打我）、`&online=1`（打开就弹出好友房面板）、`&room=123456`（直接进房）、`&anim=0`、`&speed=2`、`&difficulty=hard`（`easy`、`normal`、`good`、`hard`）。URL 开的局在已有存档时不写存档、不计战绩。

## 单独部署这个游戏（不要平台）

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/yyyu-star/arcade/tree/main/games/guandan)

`wrangler.jsonc` 是一份独立配置，只部署掼蛋这一个 Worker 就能玩，不需要平台：

- 点上面的按钮（会把这个目录复制成你账户下的新仓库，自动构建、部署，Durable Object 按配置建好）；
- 或者 fork / 拆出来以后，在本目录里 `npm ci && npx wrangler login && npm run deploy`（`build:cf` + `wrangler deploy`）。

部署完得到 `https://guandan.<你的子域>.workers.dev`，打开会转到 `/games/guandan/`。共用包从 npm 装（`@yyyu-star/arcade-kit`），不依赖仓库里别的目录。

| 有 | 没有 |
|---|---|
| 单机对电脑（三个电脑的性格、互动、名场面照旧） | 登录：谁打开都能玩，身份是浏览器里的游客 cookie |
| 好友房：开房、叫朋友、断线重连、托管、再来一场、互动（短语、表情、道具）；昵称在好友房面板里自己填（不填叫"游客"加 4 位数字，不许冒充三个电脑） | 云存档（战绩只存在这台设备上）、排行榜 |
| 本机存档、战绩、设置 | 平台钱包和实盘（单机、好友房都没有"实盘"，接口回 409 `no_wallet`） |

页面启动时问一次同域的 `/api/me`（arcade-kit 的 `detectPlatform`）：单独部署时 Worker 回 `{ standalone: true }`（没有 `user`，arcade-kit 的 `standaloneRoot`），就是没有平台，藏起实盘和云存档，左上角的"大厅"变成"首页"、回游戏自己的首页。
想要账号和钱包，就按仓库根 README 把平台也部署上，由部署工具补上平台绑定（下一节）。

## 本站部署（部署工具补什么）

正式环境只由仓库的 CI 部署（`.github/workflows/game-guandan.yml`，main 上经 PR 合并、维护者批准的提交），整体怎么部署见仓库根 README 的部署一节。
CI 用仓库的部署工具（`tools/deployer/deploy.mjs`，按 `tools/workers.json` 的声明）在这份独立配置上叠加本站的东西，模块里不写：

| 种类 | 名字 | 说明 |
|---|---|---|
| 静态资源 | `ASSETS` | `npm run build:cf` 生成的 `dist-cf/`；只有站点根、首页、房间接口、实盘接口先进 Worker（`run_worker_first`）；模块里写好的 |
| Durable Object | `ROOM`、`METER`、`MATCH` | 联机房间（`worker/room.ts`）、arcade-kit 的额度计量、快速匹配的排队（`worker/match.ts`）；模块里写好的 |
| 变量 | `ONLINE`、`KIT_QUOTA` | 好友房开关（`on` / `off`）、每天的联机额度门槛；模块里写好的 |
| 服务绑定（部署工具补） | `ARCADE` | 平台 Worker（名字 `arcade`）：登录闸门、进房、实盘认人都问它的 `/api/me`；所以要先部署平台 |
| 服务绑定（部署工具补） | `WALLET` | 平台钱包 RPC（`entrypoint: WalletService`，`props.game: guandan`） |
| 变量（部署工具补） | `GATE = login` | 没登录不让进；有它却没绑 `ARCADE` 时 kit 一律拒绝，不会退成游客 |
| `workers_dev`（部署工具关） | `false` | 本站只经站点域名访问 |
| 路由和变量（部署时注入） | `<站点>/games/guandan*`、`SITE_ORIGIN` | 只认这个站点发起的开房、实盘请求；不设就按请求自己的 origin |
| 部署环境的 secret | `SITE_HOST`、`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` | 站点主机名（不带协议）只在这里，仓库里不写 |

## 目录结构

```
src/core/    牌馆通用层：牌的编码、随机数、座位环、牌型识别框架（不引用任何玩法）
src/variants/guandan/
  core/      规则核心（纯函数、确定性）
  ai/        电脑对手
  net/       联机规则（房间和页面共用）、视角旋转、实盘的桌
  stake/     实盘的计分、档位、称号、战绩小结
src/net/     玩法无关的联机部分：页面版本、互动编号表
src/view/    画面层（Phaser 4）：场景、牌桌部件、界面、程序生成的美术、合成音效、存储
src/debug/   URL 参数、调试跳转、调试桥
worker/      线上 Worker：登录闸门、开房进房、联机房间、单机实盘接口
public/      封面、图标、称号表
tests/       vitest；tests/room/ 是在 workerd 里跑真房间的测试；golden.test.ts 是掼蛋金样（重构时证明行为不变）
tools/       模拟器、冒烟和截图、本地联机栈、部署构建、美术预览
docs/        设计、规则核实、核心接口、实盘设计
```

更细的约定（规则核心的约束、画面层、联机、实盘、存储 key）见 `AGENTS.md`。

## 素材

全部图片素材由 `src/view/art/` 的代码生成（SVG），没有外部图片或音频文件；音效和背景音由 `src/view/audio.ts` 用 WebAudio 实时合成。
牌桌互动的表情包和道具来自共用包 `arcade-kit/table-fun`（画法和音效在 `arcade-kit/fun`）：同样是手写 SVG 和 WebAudio 合成，来源见 `packages/arcade-kit/README.md`。

唯一的外部素材是标题字体 `src/view/fonts/`：思源宋体 Noto Serif SC Bold（[notofonts/noto-cjk](https://github.com/notofonts/noto-cjk)，
SIL Open Font License 1.1，可商用；版权声明和许可原文在 `src/view/fonts/OFL.txt`，版权行取自字体 name 表和上游 adobe-fonts/source-han-serif 的 LICENSE）的两个子集——`gd-title.woff2`（画布上的大字、横幅、弹窗标题，
字表 `title-chars.txt`）和 `gd-serif-svg.woff2`（SVG 美术里的 logo、牌背、印章，字表 `svg-chars.txt`，内嵌进 SVG）。
加了新的标题文字、`tests/view.test.ts` 报缺字时，把字补进字表后重新生成（fonttools，不是项目依赖）：

```sh
pip install fonttools brotli
pyftsubset NotoSerifSC-Bold.otf --text-file=src/view/fonts/title-chars.txt --flavor=woff2 --output-file=src/view/fonts/gd-title.woff2
pyftsubset NotoSerifSC-Bold.otf --text-file=src/view/fonts/svg-chars.txt --flavor=woff2 --output-file=src/view/fonts/gd-serif-svg.woff2
```
`public/cover.png`（平台首页封面）由 `tools/cover.ts` 从同一套 SVG 渲染。

## 文档

`docs/design.md` 设计、`docs/rules.md` 规则核实与取舍、`docs/core-api.md` 给画面层的接口说明、`docs/ai.md` 电脑的场地、性格和状态（数字由 `npm run ai-sim` 量出）、
`docs/stake.md` 实盘设计（数字由 `node tools/stake-sim.ts` 量出）、`docs/art-v3.md` 主页和牌桌的美术现状、`docs/doudizhu.md` 牌馆（加斗地主）的重构方案。

## 许可证

MIT，见本目录的 `LICENSE`（和仓库根目录的同一份，拆成独立仓库时跟着走）。
