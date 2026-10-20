# 飞驰（racing）

回合制卡牌赛车：换挡出牌、热量、过弯限速、打滑、冲刺、尾流。名字、术语、赛道、卡面、美术全部原创。单机对电脑（全在浏览器里跑）和好友房（基于 `arcade-kit`，2–6 辆车，空位电脑补）。娱乐模式，不碰钱包。

- 路径：`/games/racing/`（Worker 名 `racing`），开发端口 5177，预览 4177
- 设计见 [DESIGN.md](DESIGN.md)，模块约定见 [AGENTS.md](AGENTS.md)，当前版本见 `package.json` 的 `version`，各版改了什么见 [CHANGELOG.md](CHANGELOG.md)。选桌页右下角显示版本号。

## 功能

- **规则**：换挡出牌（跳两挡付热量）、速度牌 / 改装牌 / 热量 / 手抖、熄火、散热、冲刺、拼劲、尾流、过弯限速（超速付热量，付不起打滑）、冲线名次（DESIGN.md 第 2 节）。
- **三条固定赛道**：环湖（均衡）、山城（发夹弯多）、海港（急弯加长直道），1–3 圈。随机赛道是下一阶段（DESIGN.md 3.3）。
- **新手教程**：老车手阿驰带着在环湖跑一圈（写死的开局，两个新手电脑）：讲解、照着高亮点、自由驾驶时的情景提示、毕业；不碰单机续玩和预设（DESIGN.md 8.1）。
- **单机**：对 1–5 台电脑，7 种性格分三档，新手场、普通场、老手场只派本档的电脑，也可以混着来；每个电脑每场的状态有浮动；跑到一半关了页面，回来接着跑（`racing.solo`）。
- **出牌预览**：选好挡和牌，赛道上画一辆虚影车：停在哪、过哪几个弯、要付几张热量、会不会打滑（手抖按点数范围算）。
- **预设**：冲刺、尾流、拼劲、弃牌可以出牌时定好，轮到时不用再点。
- **好友房**：开房给六位房间码或邀请链接，空位电脑补；服务端说了算，不下发别人的手牌和牌堆；掉线托管、中途接管电脑、跑完"再来一场"。
- **互动**（单机和好友房都有）："聊"面板里说一句（可以点名）、表情包、扔道具；电脑按性格主动说话（打滑、吸尾流、超车、冲线），被点名、被扔东西会回，单机里你想太久它会催；设置里有总开关和按人屏蔽。电脑开车读不到任何互动。
- **登录闸门**：本站首页要先在平台登录，平台有问题时回本游戏自己的 503 页；单独部署时没有平台，游客直接玩（见"部署"）。
- **赛道镜头**：手机上默认跟着自己的车，出牌时自动缩放看清落点和要过的弯，画面外的车在屏幕边上标出来；拖动平移、双指或滚轮缩放，一键"跟车"或看全图。

### 地址参数
| 参数 | 做什么 |
|---|---|
| `?room=123456` | 邀请链接：直接进这个房间 |
| `?online=1` | 平台大厅卡片上的"好友房"按钮：开房、进房摆在最前面 |

### 手机和平板
按仓库 AGENTS.md 第 4 节：高度按 `visualViewport` 算（`--app-h`，CSS 先 `100vh` 再 `100dvh`），转屏后补算一次；双指放大时不重排；
四边用 `env(safe-area-inset-*, 0px)` 让出刘海；横屏、竖屏各有一套布局。赛道和牌是 DOM + SVG，没有画布和 WebGL，"画布倍数封顶 2""WebGL 上下文丢失"不适用。

### 素材
全部由本模块的代码生成，没有第三方素材：画面（桌游风格的地图板、棋子、卡牌）是程序画的 SVG，木桌、卡纸、纸纹几张平铺纹理由 `scripts/art.ts` 生成成 `public/art/*.webp`；没有音频和字体文件。见 [ASSETS.md](ASSETS.md)。

## 本地开发
```bash
npm ci
npm run dev           # 页面（vite，5177），单机直接能玩；平台接口转给 5181；设 RACING_WORKER=<本地 Worker 端口> 把开房、进房转给 Worker
npm test              # 类型检查 + vitest（规则、赛道、电脑、互动、架构约束、房间规则）+ workerd 里的 Worker、好友房和独立模式测试
npm run deploy        # 单独部署到自己的 Cloudflare 账户（独立模式，见"部署"）；本仓库的正式站不用它
npm run test:worker   # 只跑 workerd 里的那部分（test/worker/，配置 test/wrangler.test.jsonc，平台的 /api/me 用假的服务绑定）
npm run build:cf      # 页面打包到 dist-cf/games/racing/（Worker 的静态资源）
npm run smoke         # 冒烟：起 vite、无头 Chromium 横屏竖屏各跑完一场单机和一遍新手教程，控制台零报错
npm run sim 200       # 模拟器：电脑对跑，量回合数、打滑、各性格名次（DESIGN.md 5.3）
node scripts/track.ts --png   # 赛道自查：按形状找弯、和弯道线对一对，截图到 shots/
node scripts/shots.ts         # PR 用的截图（电脑 1280×720、手机横屏）到 shots/pr-*.png
node scripts/shots.ts tut     # 新手教程和结算的截图（电脑 1280×720、手机竖屏 390×844）到 shots/tut-*.png
node scripts/art.ts           # 重新生成 public/art/ 的纹理（ASSETS.md），总览截图在 shots/art.png
node scripts/tune.ts 40       # 调电脑参数（网格搜索，开发用）
```

依赖 npm 上的共用包 `@yyyu-star/arcade-kit`（别名 `arcade-kit`，只经它的包入口用；源码在仓库的 `packages/arcade-kit`）。脚本直接用 Node 跑 TypeScript（Node 22 的类型剥离）。
截图和冒烟用的无头浏览器：先看环境变量 `CHROME`，没有就在 playwright 的缓存目录里找装了的 chrome-headless-shell（`scripts/browser.ts`）。

## 部署

飞驰是一个 Cloudflare Worker（名字 `racing`），页面挂在 `/games/racing/` 下。`wrangler.jsonc` 是**独立配置**（docs/new-game.md 第 4、7 节）：不写平台绑定和 `GATE`，
同一份代码两种部署，由 env 决定（共用包 0.10 的平台模式和独立模式）。

**单独部署（不要平台）**：依赖的是 npm 上的共用包（`"arcade-kit": "npm:@yyyu-star/arcade-kit@^0.10.1"`），所以这个目录可以单独拿走：

- Deploy to Cloudflare 按钮：`https://deploy.workers.cloudflare.com/?url=https://github.com/yyyu-star/arcade/tree/main/games/racing`；
- 或者在本目录 `npm ci && npx wrangler login && npm run deploy`。

部署完得到 `https://racing.<你的子域>.workers.dev`，打开后转到 `/games/racing/`。独立模式下任何人打开就能玩（身份是游客 cookie），
单机和好友房都有；没有登录和平台大厅，"大厅"变成回游戏首页，选桌页多一个昵称输入框（开房、进房时带上，服务端会清洗，不许冒充电脑）。

**本站正式部署**：维护者的部署工具按 `tools/workers.json` 在这份配置上补平台绑定 `ARCADE`、`GATE=login`、路由 `<站点>/games/racing`、`<站点>/games/racing/*` 和 `SITE_ORIGIN`，
并关掉 `workers_dev`；部署流程 `.github/workflows/game-racing.yml` 由维护者按仓库的模板加。在本仓库里不对正式环境手动部署。

本模块要的绑定和变量：

| 名字 | 类型 | 说明 |
|---|---|---|
| `ASSETS` | 静态资源 | `dist-cf/`，由 `npm run build:cf` 生成 |
| `ROOM` | Durable Object `RacingRoom` | 好友房 |
| `METER` | Durable Object `RoomMeter` | kit 的每日额度计量 |
| `KIT_QUOTA` | 变量 | 每天的写入预算和每人开房数（DESIGN.md 6.1） |
| `ARCADE` | 服务绑定 → `arcade`（本站部署时补） | 登录闸门和认人，问平台 `/api/me`；没有就是独立模式 |
| `GATE` | 变量（本站部署时补成 `login`） | 没登录跳平台登录页 |
| `SITE_ORIGIN` | 变量（本站部署时注入） | 开房、进房只认这个 Origin；没设就认请求自己的 origin |

只认人，不用钱包（娱乐模式，DESIGN.md 第 7 节）。需要拆成单独仓库时，在仓库根运行 `tools/split-module.sh games/racing`。

## 目录结构
| 路径 | 内容 |
|---|---|
| `src/core/` | 规则（纯函数）：`rules.ts` 一回合的流程、`cards.ts` 牌、`view.ts` 每个座位看到的、`types.ts` |
| `src/track/` | 赛道：`fixed.ts` 规则用的数据、`index.ts` 按 id 找、`shape.ts` 画法（只给画面层） |
| `src/ai/` | 电脑（只拿视图）：`index.ts` 决定、`personas.ts` 7 种性格（分三档） |
| `src/room/` | 好友房的规则：把规则接到 kit 的 `RoomGame` 上（纯函数，房间和页面共用） |
| `src/game/` | 交流编号（`emotes.ts`）、电脑的互动（`banter.ts`，单机和好友房共用）、新手教程的文案和密钥（`tutorial.ts`） |
| `src/solo.ts`、`src/online.ts`、`src/tutor.ts`、`src/main.ts` | 单机控制器、好友房连接、新手教程的流程、页面入口 |
| `src/view/` | 画面（DOM + SVG）：`board.ts` 镜头和走车动画、`mapart.ts` 地图板和标注、`scenes.ts` 三条赛道的场景、`mapkit.ts` 色板和画法工具、`piece.ts` 棋子、`dash.ts` 驾驶台、`side.ts` 名次栏、`cards.ts` 卡面、`lobby.ts` 选桌页、`room.ts` 等人页、`comms.ts` 交流、`coach.ts` 新手教程的气泡和高亮，其余见目录 |
| `worker/` | racing Worker：`main.ts` 路由、登录闸门和独立模式、`room.ts` 好友房 DO（电脑的互动在这里发） |
| `test/` | vitest；`test/worker/` 跑在 workerd 里 |
| `scripts/` | `sim.ts` 模拟器、`smoke.ts` 冒烟、`drive.ts` 冒烟和截图共用的开车、`track.ts` 赛道自查、`shots.ts` 截图、`art.ts` 生成纹理、`tune.ts` 调电脑、`browser.ts` 无头浏览器 |

## 许可证

MIT，见仓库根的 [LICENSE](../../LICENSE)。
