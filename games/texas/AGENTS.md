# texas 模块约定

> 总规范见仓库根的 `AGENTS.md`（拆成独立仓库后，以本文件和 `DESIGN.md` 为准）。设计正本是 [DESIGN.md](DESIGN.md)。

- 模块 id `texas`，Worker 名 `texas`，路径 `/games/texas/`，开发端口 5175、预览 4175；工具用系统分配的临时端口（端口写 0）。
- 只改 `games/texas/`；不读、不引用其他游戏的源码。共用的东西只走 `packages/arcade-kit` 和平台的公开 `/api`。
- 规则核心 `src/core/` 和电脑 `src/ai/` 是纯函数：不碰 DOM、网络；不用 `Math.random`、`Date.now`、`new Date`、结果依赖平台的数学函数；
  随机只用 `arcade-kit/rng`（ChaCha20）按"用途 + 序号"分流，不在本模块另写随机数；用途名放在 `table.ts` 的 `RNG`（DESIGN.md 1.5）。
  电脑只拿视图，不拿完整状态：`src/ai/` 只用 `import type` 引用规则，不出现 `Table`（4.1，`test/arch.test.ts` 检查）。
- 改了电脑的参数或决定方式，跑 `npm run sim 24000` 看各性格每百手的输赢，结果写进 DESIGN.md（现行参数在 4.10，按档配平的用 `npm run sim -- --balance`；改前改后照 4.6 的写法）；改了随机数的用法要重新生成翻牌前胜率表（`npm run gen:preflop`）。
- 规则的筹码只从 `seatPlayer`、`addChips`、`seatHouse` 进，从 `out`（离桌）和电脑换人出，每一步 Σ筹码 + Σ投入 = `bank`（测试核对）。
- 隐藏信息：`view` 只放这个座位能看到的，别人没亮的牌、牌堆、种子一律不下发（第 2 节）。
- 筹码：钱包是平台的（服务绑定 `WALLET`，`props.game = "texas"`），单机 client 模式经 `worker/main.ts` 转、好友房 server 模式由 `TexasRoom.perform` 调；
  一份一个 ref、只结回一次，操作 id 平台去重；不能买、不能兑换、不能转让，界面写明"无任何现金价值"（DESIGN.md 第 5 节）。
- 浏览器存储的键一律 `texas.` 前缀（8.5）。
- `wrangler.jsonc` 是能单独部署的独立配置（没有平台：游客、没有钱包，DESIGN.md 10.1）；本站部署只走 `.github/workflows/game-texas.yml`（经 PR 合并后），由部署工具补平台绑定。
  测试用 `test/wrangler.test.jsonc`（平台模式）和 `test/wrangler.standalone.jsonc`（单独部署），本地试平台模式用 gitignore 掉的 `wrangler.local.jsonc`。
  Worker 入口 `worker/main.ts` 只导出 default 和三个 DO 类（`TexasRoom`、`RoomMeter`、快速匹配的 `Queue`）：别的具名导出会让 workerd 把它当入口、起不来（单独部署的测试先报）。
- Worker、钱包和好友房的测试在 `test/worker/`（workerd，平台钱包换成 kit 的假钱包 `arcade-kit/testing`）：房间每步写几行用 kit 记的实测写入（`lastStepWrites` 等），调平台几次、平台写几行数假平台的计数，都断言；改了钱包或 Worker 就加测试并做反证。
- 提交信息以 `texas:` 开头，分支 `texas/<说明>`；只暂存明确路径。
