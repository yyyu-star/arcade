# 掼蛋（guandan）

两副牌、四人、对家一队，从打 2 升到过 A 的掼蛋。单机和三个电脑打，也能开好友房四人联机；arcade 小游戏平台的一个独立模块，挂在平台的 `/games/guandan/` 下。

![封面](public/cover.png)

## 功能

- **完整规则**：牌型识别（含逢人配的所有解释）、比大小、进贡 / 抗贡 / 还贡、接风、名次升级、打 A，规则核心是纯函数、同一种子同一串操作结果完全相同（`src/core/`，取舍见 `docs/rules.md`）。
- **电脑对手**：老张、小美、阿强各有性格（爱炸、捂炸弹、抢牌），每场状态有起伏，随级数差和输赢调整，说话和出手快慢跟着性格走；
  强弱按场地定，新手场偏弱、档位越高越强。只读自己能看到的信息（`src/ai/`，设计和模拟见 `docs/ai.md`）。
- **单机**：标题页、新手引导、规则说明、设置、战绩，每副结算有复盘和称号；云存档同步战绩（需要平台账号）。
- **好友房**：开房后"叫朋友来"发链接，点开就进房、自动坐下，开打后接管电脑的座位；掉线重连、走开了自动托管、打完"再来一场"；
  嘲讽、表情包、扔道具（人人一样、免费，不影响牌局）。房间是 Cloudflare Durable Object，服务端说了算，底座是共用包 `packages/arcade-kit`。
- **实盘**：用平台钱包里的筹码带入、结回，单机和好友房都有（筹码不能买、不能换、不能转，设计见 `docs/stake.md`）。
- **手机友好**：横屏牌桌按可见区域排版，老 iPhone 省内存（渲染倍数封顶、被系统杀过自动降档），画面全部程序生成。

### 好友房里会碰到的限制

原则是联机体验要顺、不设没必要的限制。没必要的已经去掉，留下的都是为了不超账单、筹码算得对或者牌局能往下走，页面上都有一句大白话：

| 限制 | 为什么留着 | 用户看到的 / 怎么办 |
|---|---|---|
| 每人同时开 5 个房间、每天开 100 个 | 防一个号刷房间吃光全站额度（0.6.0 从 1 / 6 放宽） | "你同时开着的房间太多了，先离开几个再开"；"开房间"永远开新的，不再把人送回旧房间 |
| 全站每天 300 个房间、写入到 5 万停开新房、6 万收场 | Cloudflare 免费额度是全账户共用的 | "今天联机的人太多了，明天再来，单机照常玩" |
| 每手 30 秒、结算页 20 秒 | 一个人走神不能卡住另外三个人 | 头像上倒计时，最后 5 秒嘀嗒；到点按"能不出就不出"代出 |
| 连着两手到点被代出，就算走开了：轮到他只等 3 秒（0.6.3） | 人在但走开了，别的三个人不用每手干等 30 秒 | 头像下写"托管中"；他自己出一手、或者点"我回来了"马上恢复 30 秒；掉线重连、刷新页面回来的自动恢复（0.6.4） |
| 掉线 60 秒后电脑接着打 | 同上 | 回来自动回到自己的座位接着打 |
| 别人坐过的座位只能他本人回来坐 | 实盘的结回要记到那个人的钱包上 | "座位被占：这是别人的座位，电脑在替他打"；没人坐过的电脑座位谁都能接管（点开链接会自动接管） |
| 实盘房间至少两个真人 | 防一个人带三个电脑绕开单机的每日上限 | "实盘好友房至少要两个人；一个人想玩实盘，去单机" |
| 嘲讽、表情、道具每人每秒 1 个（能攒 3 个） | 不刷屏、房间账单 | 不提示，发得快的自动排队 |
| 打完一整场，"再来一场"等 3 分钟（0.6.2，娱乐房间） | 没人点的房间要关掉、还开房名额 | 结束页上点"再来一场"，这一桌自动换到新房间，队友、上下家和上一场一样；过了 3 分钟再点，自己先去新房间，再叫朋友 |
| 必须登录 | 测试期邀请制 | 点开房间链接没登录的，先去登录，登录完直接回到这个房间 |

去掉的：同时只能开 1 个房间（"你已经有一个房间了，先回去"）、每天只能开 6 个；离开实盘房间要等整场打完才结回（现在点"离开"马上按当时的分结回）；
房间里没真人了电脑还一直打到房间超时（现在真人都走了房间马上结束、还名额）；点开邀请链接还要再点"坐这里"（现在自动坐第一个空位，开打了自动接管电脑座位；实盘房间坐下要带入，仍由自己点）；
打完一整场要回首页重新开房、重新发链接（0.6.2 起结束页点"再来一场"，大家一起过去；实盘房间打完照旧结回，再开要自己开）。

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
npm run build:cf      # 部署产物 dist-cf/games/guandan/（线上 Worker：worker/，登录闸门 GATE=off|login、好友房开关 ONLINE=on|off，见 AGENTS.md）；npm run deploy = build:cf + wrangler deploy，路由要另加 --route（见下面的部署一节）
```

调试用 URL 参数：`?seed=abc`（直接开局）、`&jump=tribute`（第二副进贡）、`&jump=ace`（打 A）、`&debug=1`（挂 `window.__game`）、
`&autoplay=1`（电脑代打我）、`&online=1`（打开就弹出好友房面板）、`&room=123456`（直接进房）、`&anim=0`、`&speed=2`、`&difficulty=hard`。URL 开的局在已有存档时不写存档、不计战绩。

## 部署

正式环境只由仓库的 CI 部署（`.github/workflows/game-guandan.yml`，main 上经 PR 合并的提交），整体怎么部署见仓库根 README 的部署一节。

本模块要的东西：

| 种类 | 名字 | 说明 |
|---|---|---|
| 静态资源 | `ASSETS` | `npm run build:cf` 生成的 `dist-cf/`；只有首页、房间接口、实盘接口先进 Worker（`run_worker_first`） |
| Durable Object | `ROOM`、`METER` | 联机房间（`worker/room.ts`）和 arcade-kit 的额度计量 |
| 服务绑定 | `ARCADE` | 平台 Worker（名字 `arcade`）：登录闸门、进房、实盘认人都问它的 `/api/me`；所以要先部署平台 |
| 服务绑定 | `WALLET` | 平台钱包 RPC（`entrypoint: WalletService`，`props.game: guandan`） |
| 变量 | `GATE`、`ONLINE`、`KIT_QUOTA` | 登录闸门（`login` / `off`）、好友房开关（`on` / `off`）、每天的联机额度门槛，写在 `wrangler.jsonc` |
| 变量（部署时注入） | `SITE_ORIGIN` | 只认这个站点发起的开房、实盘请求；不设就按请求自己的 origin |
| 部署环境的 secret | `SITE_HOST`、`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID` | 站点主机名（不带协议）只在这里，仓库里不写；工作流用它注入路由和 `SITE_ORIGIN` |

`wrangler.jsonc` 不写路由，部署时注入。本模块通过 `file:../../packages/arcade-kit` 依赖共用包，暂时不能用 Deploy to Cloudflare 按钮（按钮只复制这一个目录）；
手动部署要在整个仓库的检出里做，平台先部署好，然后：

```bash
export SITE_HOST=game.example.com   # 换成你的站点主机名
npm ci && npm run build:cf
npx wrangler deploy --route "$SITE_HOST/games/guandan" --route "$SITE_HOST/games/guandan/*" --var "SITE_ORIGIN:https://$SITE_HOST"
```

## 目录结构

```
src/core/    规则核心（纯函数、确定性）
src/ai/      电脑对手
src/net/     联机规则（房间和页面共用）、视角旋转、实盘的桌
src/stake/   实盘的计分、档位、称号、战绩小结
src/view/    画面层（Phaser 4）：场景、牌桌部件、界面、程序生成的美术、合成音效、存储
src/debug/   URL 参数、调试跳转、调试桥
worker/      线上 Worker：登录闸门、开房进房、联机房间、单机实盘接口
public/      封面、图标、称号表
tests/       vitest；tests/room/ 是在 workerd 里跑真房间的测试
tools/       模拟器、冒烟和截图、本地联机栈、部署构建、美术预览
docs/        设计、规则核实、核心接口、实盘设计
```

更细的约定（规则核心的约束、画面层、联机、实盘、存储 key）见 `AGENTS.md`。

## 素材

全部图片素材由 `src/view/art/` 的代码生成（SVG），没有外部图片或音频文件；音效和背景音由 `src/view/audio.ts` 用 WebAudio 实时合成。
好友房的表情包和互动道具（0.6.0）来自共用包 `arcade-kit/fun`：同样是手写 SVG 和 WebAudio 合成，来源见 `packages/arcade-kit/README.md`。

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

`docs/design.md` 设计、`docs/rules.md` 规则核实与取舍、`docs/core-api.md` 给画面层的接口说明、`docs/stake.md` 实盘设计（筹码体系第 3 步；0.4.0 单机实盘、0.5.0 好友房实盘；数字由 `node tools/stake-sim.ts` 量出）、`docs/ai.md` 电脑的场地、性格和状态（0.7.0；数字由 `npm run ai-sim` 量出）。

## 许可证

MIT，见仓库根目录的 `LICENSE`。
