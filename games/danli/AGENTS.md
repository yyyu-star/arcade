# danli 模块约定（《弹里个弹》）

> 总规范见仓库根的 `AGENTS.md`（拆成独立仓库后，以本文件和 `DESIGN.md` 为准）。设计正本是 [DESIGN.md](DESIGN.md)，由策划维护；实现里拿不准的地方提出来，不自己改设计。

- 模块 id `danli`，Worker 名 `danli`，路径 `/games/danli/`，开发端口 5179、预览 4179；冒烟、截图、性能脚本用系统分配的临时端口（端口写 0）。
- 只改 `games/danli/`；不读、不引用其他游戏的源码。共用的东西只走 `arcade-kit`（npm 上的 `@yyyu-star/arcade-kit`，按别名装）和平台的公开 `/api`。
- 规则核心 `src/core/`（含地图数据 `maps.ts`）、电脑 `src/ai/` 和好友房的规则 `src/net/` 是纯函数：不碰 DOM、网络、存储；
  不用 `Math.random`、`Date`、`performance.now`、三角函数、开方、`**` 这类结果依赖平台的东西（角度用 `core/fixed.ts` 的整数表，开方用 `isqrt`）；
  炮弹用定点整数（1/1024 单位）、固定步长；道具的倍率用万分比整数；随机只用 `arcade-kit/rng`（ChaCha20）按用途分流：`open` 开局（出生点洗牌、谁先手）、`wind` 每回合的风（序号是回合数）、`ai` 电脑出手的误差（序号是回合数）。
  准备房间里"随机"地图在页面里抽（不进规则核心），抽到的写进开局设置。好友房另有 `match`：从房间的种子按局号分出这一局的种子和"随机"地图（`src/net/rules.ts`）。
  `test/arch.test.ts` 检查这些。
- 画面（`src/view/`）只读状态和事件：事件按顺序放成动画，地形在画面里另存一份，放到"爆炸"那一刻才挖；不自己算规则。
- 浏览器存储的键一律 `danli.` 前缀（DESIGN.md 第 8 节）：`danli.solo`（单机存档第 3 版：种子 + 整局的开局设置 + 操作序列，读档时重放；版本对不上的直接丢掉；操作格式变了要升版本）、
  `danli.prefs`（静音和准备房间上次的选择，`src/room.ts` 逐项检查着读，坏了的那一项用默认）、`danli.room`（好友房最近的房间码和是不是我开的，`src/friend.ts`；离开、房间关了就删）。
- 好友房（DESIGN.md 5.6）只用 kit：房间类 `worker/room.ts` 继承 `GameRoom`（`maxAiBatch` 1，其余 kit 默认），规则在 `src/net/rules.ts`，Worker 路由只接 `acceptCreate` / `acceptJoin`，页面用 `RoomClient`。约定：
  - kit 一开房就开局（房主的页面进房就发 `start`），准备、对局、结算是游戏自己的阶段，`over` 永远是 false（"再来一局"在同一个房间）；准备阶段的操作都是 `free`；
  - 一回合一条 `act`（`turn` / `pass`；道具是每种几个 `p1 p2 fork b10 b20 b50` 加 `lid` `plane`，0 个不写，`parse` 不认识的字段一律拒）；`auto`（电脑代出）只由房间的 `ai` / `timeout` 给，`parse` 不收；错误码只用固定短码；
  - 视图里绝不能有种子（房间的、这一局的）和服务端的局面（`lite`、`carves`），`test/net.test.ts` 检查；改了视图看一眼快照上限（20 KB）；
  - 页面的动画时长不能超过 `src/net/anim.ts` 估的（房间按它停顿）；飞行、掉落、连发放快的时长画面和房间共用 `anim.ts` 的 `flightMs`、`fallMs`、`paced`，改了节奏两边一起变；最长一手 ≤ 20 秒（`test/net.test.ts`）；
  - 准备、结算阶段房主是 kit 眼里"该出手的人"（时限一天），掉线满 60 秒 kit 调 `ai` → `handoff` 交出房主；`handoff` 和 `auto` 一样 `parse` 不收；
  - 改了电脑（`ai/online.ts`）、规则核心的计算量，跑 `npm run cpu`（开发机每一步 p99 ≤ 3 ms，有环境变量 CI 时 8 ms；`npm test` 也会跑）；
  - Node 版本钉在 `.nvmrc`（22.18.0 起原生跑 TS，`scripts/*.ts` 和 `npm run cpu` 靠它）；
  - 房间测试在 Node 里跑真的 kit 房间（`test/fake-workers.ts` 顶替 Workers 运行时，`vitest.config.ts` 把 `cloudflare:workers` 指过去），只复刻 kit 用到的那几样；kit 换了存储或运行时的用法要跟着补；
  - 规则的结构版本 `RULES_VERSION`：状态格式、规则含义变了要加一（进行中的房间按开局时的版本打完）；
    规则含义变了，`RULES_VERSION` 和 `CLIENT_VERSION` / `minClientVersion` 一起升（`src/net/rules.ts` 的 `CLIENT_VERSION`，房间 `worker/room.ts` 只收不低于它的页面，旧页面收到 4005、提示刷新，免得按旧规则重放对不上）。
- 电脑人物在 `src/ai/personas.ts`（0.2.0 是橘子、团团、企企、柴柴、兔兔、鼠鼠）：加、改名字时在 PR 说明里写上，由平台另开 PR 登记进保留昵称。
- 改了数值（`core/weapons.ts`、`core/items.ts`、`core/rules.ts` 的常量、`core/physics.ts` 的重力风力、`core/maps.ts` 的地形和出生点）或电脑，跑模拟器（`scripts/sim.ts`）把结果写进 README 的"数值"一节：
  `npm run sim 100 ab`（1v1，加道具用和不用的对比）、`npm run sim 100 2v2`、`npm run sim 100 3v3`、`npm run sim 16 weapons`（8 把武器两两对打）、
  `npm run sim 50 1v1 map:all`、`npm run sim 30 3v3 map:all`（11 张图各打一遍）、`npm run sim 100 3v3 room`（房间的默认阵容）、`npm run sim 100 online`（好友房的联机档电脑对单机档）。
- `wrangler.jsonc` 是独立配置：不写平台绑定和 `GATE`（本站部署时由部署工具补），只用部署配置检查允许的字段（docs/new-game.md 第 4 节）；`observability` 开着。
- 监控（docs/platform-backend.md 第 16 节）：`worker/route.ts` 最前面接 `/games/danli/health`（不登录、不读存储，版本号从 `package.json` 导入），`test/worker-health.test.ts` 检查；页面入口调一次 `reportErrors`。
- 改了界面：跑 `npm run smoke`（手机横竖屏各走一遍"首页 → 准备房间 → 选图（横屏 0.4.0 的披萨火山、竖屏冰淇淋雪山）、3v3、换武器和小动物 → 开打 → 把自己炸出局 → 跳到结果 → 结算 → 回房间"，
  再走一遍好友房：本机起真的 Worker，A、B 两个上下文，开房、链接进房、选人选武器、加电脑 2 对 1、换成生日蛋糕城、开打、B 刷新、B 超时弃权、打完、再来一局），
  `npm run shots` 截验收图（`shots/v030-*.png`：首页、房间五张（武器、地图、地图往下滑的"快图""慢图"、滑到底、换人物）、11 张图各一张开局、出局、结算，
  好友房的 6 个位子坐满、2 对 1 的房间、"某某正在瞄准"、结算，角色贴着斜坡站、8 把武器的坑形和焦痕拼图，`v031-desk-flight.png` 一发高抛每 0.25 秒一张的连拍，已被 gitignore），自己看一遍。冒烟、截图的 Worker 用系统分配的端口，`npm run dev:worker` 用 4179。
- 坑形（`core/craters.ts`，美术交付）是规则：改了就是规则含义变了（`RULES_VERSION`），要过 `test/craters.test.ts`（不出包围盒、只扫方框和逐格判断一样、画面按事件挖和规则核心一样）；
  焦痕（`view/scorchPaint.ts`）只是画面，按位置散列，不用 `Math.random`。服务端存的坑是"x、y、大小、武器序号"四个数一个。
- 美术代理交付的画法（地图数据、地形、远景、角色、武器图标、标题字、页面设计稿）改写成 TS 放在模块里（`core/mapData.ts`、`core/mapData2.ts`、`view/mapArt.ts`、`view/mapArt2.ts`、`view/paintKit.ts`、`view/terrainPaint.ts`、
  `view/backdrops.ts`、`view/charArt.ts`、`view/weaponArt.ts`、`view/title.ts`、`view/pages.css`），不引用仓库外的文件；改画法前先问策划要不要交给美术。
- 音效在 `src/view/sound.ts`，全部 WebAudio 现场合成，不放音频文件；加声音时守住"同一时刻最多 6 个、每种有最短间隔"。
- 临时脚本放 `scripts/_*.ts`，用完删掉。
- 提交信息以 `danli:` 开头，分支 `danli/<说明>`；只暂存明确路径。
