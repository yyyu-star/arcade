# Arcade 仓库约定（给开发者和 AI 编程代理）

> 本文件是总仓库的规范正本（Claude Code 通过 `CLAUDE.md` 导入；Codex 等直接读本文件）。
> 各模块目录下还有自己的 `AGENTS.md`，写该模块特有的约定；两者冲突时，以本文件第 1、2 节的硬约束为准。
> 平台和所有游戏都在这一个仓库（`yyyu-star/arcade`，MIT 许可）里，每个游戏是可以随时拆分、单独部署的独立模块。英文概览见根目录 [README.md](README.md)。
> 改动怎么进 main、怎么上线，见 [CONTRIBUTING.md](CONTRIBUTING.md)：main 只接受 PR 合并，只有经 PR 合并的提交才会部署。
> 项目做什么、给谁、守什么底线，先读 [docs/project.md](docs/project.md)（项目总体定义）。

## 0. 仓库结构

```
arcade/
├─ AGENTS.md / CLAUDE.md   本文件（总规范）
├─ README.md               总览：有哪些模块、怎么开发、怎么部署
├─ CONTRIBUTING.md         合作指南：分支、PR、审阅、合并、部署、回滚
├─ docs/                   跨模块的设计：project.md（项目总体定义）、architecture.md（整体架构）、platform-backend.md（账号/联机/熔断方案）、economy.md（筹码体系：一个钱包，娱乐和实盘）、table-fun.md（牌桌互动规范：三个牌桌游戏共用）、balance.md（难度和收益的配平目标）、social.md（社交：分享、在线、邀请、旁观、好友榜和分期）
├─ tools/                  仓库级工具：check-isolation.mjs（模块独立性检查）、check-deploy-config.mjs（部署配置检查）、deployer/（钉死的 wrangler 和部署程序）、split-module.sh（拆分模块）、git-hooks/（本地推送拦截）、verify-main.sh（部署前核对）
├─ .github/workflows/      每个模块一个流程（test 作业测试构建打包、main 上的 deploy 作业经维护者批准后部署，按路径触发）+ check.yml（独立性和部署配置检查）+ main-guard.yml（直接推 main 报警）
├─ platform/               模块：平台主界面 + /api（Worker 名 arcade，挂在站点主机名的根路径）
├─ games/
│  ├─ kaipan/              模块：《开盘》（Worker 名 kaipan，路径 /games/kaipan/）
│  ├─ guandan/             模块：掼蛋（Worker 名 guandan，路径 /games/guandan/）
│  ├─ texas/               模块：德州扑克（Worker 名 texas，路径 /games/texas/；设计见 games/texas/DESIGN.md）
│  └─ mahjong/             模块：《雀馆》麻将（Worker 名 mahjong，路径 /games/mahjong/；一套引擎多种玩法，先做川麻·血战到底，设计见 games/mahjong/DESIGN.md）
└─ packages/
   └─ arcade-kit/          共用包：联机房间基类、开房进房入口、浏览器连接器、协议、计量、表情道具（版本见它的 package.json；入场票以后加）。只测不部署（pkg-arcade-kit.yml）
```

"模块" = `platform/`、`games/<id>/`、`packages/<name>/` 中的任意一个目录。

## 1. 硬约束：每个模块都是独立的

每个模块必须**随时能拆成一个单独的仓库、随时能单独部署**，不需要改模块里的代码。具体要求：

1. **自带全部运行所需文件**：`package.json`、`package-lock.json`、`.nvmrc`、`tsconfig*.json`、构建配置、`wrangler.jsonc`、测试、
   `README.md`、`AGENTS.md`（和导入它的 `CLAUDE.md`）、`CHANGELOG.md`（游戏必有）、`.gitignore`。
2. **不引用自己目录以外的任何文件**：import、require、`new URL(..., import.meta.url)`、tsconfig 的 extends/paths、构建和部署配置里的路径
   都不能出现 `../` 指到模块外。唯一例外：通过 `package.json` 的 `"file:../../packages/<name>"` 依赖 `packages/` 下的共用包。
3. **不用 npm workspaces，不在仓库根装依赖**：每个模块各自 `npm ci`、各自有 lockfile 和 `node_modules`。仓库根没有 `package.json`。
4. **模块之间只通过公开接口交互**：
   - 游戏和平台之间：同域 HTTP（`/api/*`）、Cloudflare 服务绑定 RPC、入场票（以后，第一版用 `/api/me`）；
   - 游戏之间：完全不交互；
   - 禁止直接读别的模块的源码、数据文件、构建产物、D1 或 DO。
5. **线上资源各自独立**：
   - 每个模块一个 Worker（Worker 名 = 模块 id；平台例外，叫 `arcade`）。模块自己的 `wrangler.jsonc` 是**能单独部署的独立配置**：
     游戏自己的资源（静态资源、自己的 Durable Object、`vars`）写在里面，不带平台也能部署成一个能玩的游戏（共用包 0.10.0 的独立模式：游客身份）；
     接平台的服务绑定（`ARCADE`、`WALLET`）、`GATE: "login"`、路由、`SITE_ORIGIN` 由维护者的部署工具（`tools/deployer/deploy.mjs`）按 `tools/workers.json` 的声明在本站部署时补上，
     游戏不用写（过渡期写了的必须和规范形式一模一样）；平台的 Secret 用 `wrangler secret put` 设，不进仓库；
   - 浏览器存储（localStorage、IndexedDB、Cache）的 key 一律加 `<游戏id>.` 前缀，比如开盘用 `kaipan.save`。平台自己的 key 用 `arcade.` 前缀（目前是 sessionStorage 的 `arcade.reloaded`：平台 0.9.8 起，发版后分块加载失败时防重复重载；localStorage 的 `arcade.sound`：平台 0.10.26 起，记住声音关没关）。所有游戏和平台同域，前缀是唯一的隔离手段；
   - 游戏挂在 `/games/<id>/` 下，资源一律用相对路径，不假设自己在域名根；回大厅的入口例外，指向平台首页 `/`（平台的公开地址）；
   - 线上 Worker 数量 = 平台 1 个 + 每个游戏 1 个，**不另建测试或实验 Worker**（不设 staging）；需要临时实验时用完当天删除。
6. **不写死本机路径**：代码和配置里不能有 `/root/`、`/home/`、`/tmp/` 这类绝对路径。临时文件用 `os.tmpdir()` 或命令行参数传入。
7. **每个模块一个部署流程**：`.github/workflows/<platform|game-<id>|pkg-<name>>.yml`，用 `paths` 只在该模块（或它依赖的 `packages/`）改动时触发，
   `working-directory` 指向模块目录。
8. **版本号、更新日志各自独立**：模块自己的 `package.json` version 和 `CHANGELOG.md`；提交信息以模块名开头，例如 `kaipan: ...`、`platform: ...`。

`tools/check-isolation.mjs` 会自动检查第 1、2、3（依赖部分）、6 条；`tools/check-deploy-config.mjs` 检查第 5 条里部署相关的部分（Worker 名、不写路由域名、只用逐键白名单里的绑定、服务绑定只许 `tools/workers.json` 声明的规范形式，
模块里不许有 `.env*`、`.npmrc`、`wrangler.json`/`wrangler.toml`、`.wrangler/`、名单外的隐藏文件和符号链接；白名单在 `tools/deployer/lib.mjs`，要先 `npm ci --ignore-scripts --prefix tools/deployer`）。
CI 每个 PR 都跑，部署前 `tools/deployer/deploy.mjs` 再严格查一遍，失败就不能部署。新增约束时，同步加进这些脚本。

## 2. 拆分与单独部署

- **单独部署**：每个模块的流程只部署自己的 Worker，一个模块的部署不会动到其他模块。正式环境只由 main 上经 PR 合并的提交触发部署
  （或在 GitHub Actions 里对 main 手动运行该模块的流程；只部署 main 的最新提交，旧提交的运行重跑也会在核对这一步失败），deploy 作业还要维护者在 production 环境上批准才执行；模块里的 `npm run deploy` 是拆成独立仓库后用的，不在本仓库对正式环境手动执行。
- **部署流程的结构**（为什么这样见 [docs/review-policy.md](docs/review-policy.md) 第 7 节）：test 作业跑模块代码（不拿凭证），用 `wrangler deploy --dry-run --outdir` 打包后上传 artifact；
  deploy 作业不 checkout 模块代码，只取 `tools/` 和模块的 `wrangler.jsonc`，用 `tools/deployer/` 里钉死的 wrangler 由 `deploy.mjs` 检查后 `--no-bundle` 部署。
  所以部署用的配置就是模块根目录那份 `wrangler.jsonc` 加上 `deploy.mjs` 按 `tools/workers.json` 叠加的平台绑定、`GATE`、关掉的 `workers_dev`，构建脚本改它、改 `.wrangler/` 都不起作用；Worker 必须能被 wrangler 打成单个文件。
- **只部署一个游戏（不要平台）**：游戏的 `wrangler.jsonc` 本身就能部署（Deploy to Cloudflare 按钮或 fork 后 `npm run deploy`），得到一个 `workers.dev` 地址，
  以游客身份玩、好友房照常；没有登录、云存档、排行榜、钱包实盘。步骤见 [docs/new-game.md](docs/new-game.md) 第 7 节。
- **拆成独立仓库**：`tools/split-module.sh games/<id>`，会生成带完整历史的分支 `split/<id>`，推到新仓库的 `main`；再按脚本里的说明搬部署流程、
  把 `file:` 共用包换成 npm 上发布的版本（按别名装：`"arcade-kit": "npm:@yyyu-star/arcade-kit@^0.10.1"`，代码里的 `arcade-kit/...` 不用改）。线上 Worker、路由、存储前缀都不用改。
- **新增一个游戏**（完整步骤见 [docs/new-game.md](docs/new-game.md)；PR 怎么审见 [docs/review-policy.md](docs/review-policy.md)）：
  1. 建 `games/<id>/`，满足第 1 节；
  2. 维护者确认 Cloudflare 账户里没有同名 Worker 后，把 `<id>` 加进 `tools/workers.json`（部署配置检查只放行名单里的 Worker），
     要接平台（认人、钱包）的同时声明 `"platform": ["ARCADE", "WALLET"]`（只要认人就只写 `ARCADE`）；
     加 `.github/workflows/game-<id>.yml`，从 `game-kaipan.yml` 复制后改名字和路径（保留 test/deploy 两段、打包和上传产物、`environment: production`、sparse-checkout、"只部署经 PR 合并的提交"那一步和 `deploy.mjs`）；
  3. 在平台的 `platform/src/games.ts` 里登记，并放一张封面（钱包、云存档、分数榜、保留用户名都从这份登记派生；想先接钱包再上大厅就先登记成 `status: 'coming'`）；
     游戏里电脑人物的名字同时登记进平台 `worker/api/validate.ts` 的 `RESERVED_PERSONAS`（真人昵称不许冒充电脑）。以后加、改电脑人物，
     在游戏自己的 PR 说明里写上名字，再开一个平台的 PR 补上；有每日挑战榜的，登记 `daily: true` 并在游戏的 `public/daily.json` 里写分数怎么显示（平台 0.10.18）；
  4. 游戏的 `wrangler.jsonc` 写成独立配置：`preview_urls: false`，`workers_dev` 开着（单独部署要 `workers.dev` 地址），不写 routes、不写 `ARCADE`/`WALLET` 服务绑定和 `GATE`；
     本站部署时 `deploy.mjs` 关掉 `workers_dev`，按 `tools/workers.json` 补上平台绑定和 `GATE: "login"`，注入 `--route "$SITE_HOST/games/<id>" --route "$SITE_HOST/games/<id>/*"` 和 `SITE_ORIGIN`（`SITE_HOST` 是 `production` 环境的 secret，没设就失败）；
  5. 在下面的端口表里登记开发端口；
  6. 做一个常驻的"回大厅"入口（左上角，小房子加"大厅"，指向 `/`）：任何界面两步内能回到大厅，对局中离开先确认一次并补传云存档，冒烟里点一次。

## 3. 本地开发

每个模块在自己的目录里操作：`npm ci`、`npm run dev`、`npm test`、`npm run build`。端口登记（开发 / 预览）：

| 模块 | 开发 | 预览 |
|---|---|---|
| platform | 5180（接口 `npm run dev:api`：5181） | 4180 |
| games/kaipan | 5173 | 4173 |
| games/guandan | 5174 | 4174 |
| games/texas | 5175 | 4175 |
| games/mahjong | 5176 | 4176 |
| games/racing | 5177 | 4177 |
| 下一个游戏 | 5178 | 4178 |

模块里的截图、音频检查等工具也只用本模块登记的端口，或者由系统分配的临时端口（端口写 0），不占别的模块的。
允许临时端口是因为登记的两个端口常被开着的 dev 和 preview 占着，工具再去抢只会冲突，或者连到旧服务上。
dev 和 preview 监听 0.0.0.0，方便同一局域网里的手机、平板直接打开测试。

## 4. 代码规范（所有模块）

- **技术栈**：TypeScript（严格模式）+ Vite，Node 22（`.nvmrc`）；平台界面用 React，游戏按类型选渲染层（开盘用 Phaser）。
  后端代码是 Cloudflare Worker / Durable Object，同样用 TypeScript。
- **规则和画面分开**（游戏必须遵守）：
  - 规则核心（如 `src/core/`）是纯函数：输入状态和操作，输出新状态和事件；不依赖 DOM、渲染库、网络；
  - 规则核心里禁止 `Math.random`、`Date.now`、`new Date`，以及结果依赖平台的数学函数（如 `Math.exp`、`Math.log`、三角函数）；随机一律用带种子、按用途分流的 RNG；
  - 画面层只读规则核心给出的状态和事件，不自己算规则；
  - 同一个种子加同一串操作，必须得到完全相同的结果，这是存档、回放、复现 bug 和联机校验的基础。
- **手机和平板（尤其 iOS）**：开盘 0.5.9 在 iPhone、iPad 上踩过的坑，以开盘的代码为准，所有游戏照做：
  - **省内存设备渲染倍数封顶 2**：手机平板（iOS、触屏）上画布的渲染倍数最多 2，不按 `devicePixelRatio` 拉到 3；整屏的大背景按 1 倍光栅化。
    老 iPhone 只有 2GB 内存，开盘按 3 倍画时估算占 400–870 MB，网页反复崩溃；封顶后约 170 MB；
  - **高度按看得见的区域算，不用 `100vh`**：iOS Safari 的 `100vh` 是工具栏收起时的高度，横屏时画面顶上一截被地址栏压住。
    CSS 依次写 `100vh` → `100dvh` → 脚本按 `visualViewport`（没有就 `innerHeight`）写的变量；转屏、收放地址栏后重算，转屏后稍等再补算一次；
  - **双指放大时不改尺寸**：`visualViewport.scale` 明显不是 1 时，可见区的宽高是放大后的，这时不改画布、不滚动、不重排，缩回 1 倍再说；
  - **WebGL 上下文**：丢了（显存吃紧时 iOS 会收回）等几秒还没恢复才提示刷新；`webglcontextrestored` 时收起提示，同一时间只有一条；
  - **safe-area 带兜底值**：四边用 `env(safe-area-inset-*, 0px)` 让出刘海和圆角（配 `viewport-fit=cover`），不支持的浏览器按 0 算；
  - 冒烟里模拟一次省内存设备（开盘的 `--lowmem`）、双指放大和上下文丢失/恢复。
- **测试**：
  - 规则核心用 vitest 覆盖；
  - 每个游戏都要有一个无头浏览器冒烟脚本，跑一遍主流程并检查控制台零报错；
  - 架构约束（例如"核心不准用 Math.random"）写成测试；
  - 改数值的，用模拟器跑机器人验证，不凭感觉。
- **联机和后端**：必须遵守 `docs/platform-backend.md` 第 4 节的房间规范：
  - 只用 `ctx.acceptWebSocket`，不用 `ws.accept()`；
  - 只用一个闹钟，不用 `setTimeout`、`setInterval`；
  - 每步最多写 2 行存储；
  - AI 批量出牌；单机对 AI 在浏览器里跑；
  - 服务端说了算，绝不下发别人的隐藏信息。

  联机房间统一基于 `packages/arcade-kit`，不各写一套：房间类继承 `GameRoom`，游戏 Worker 的路由只接 `acceptCreate` / `acceptJoin`（不自己把浏览器的请求转给房间），
  浏览器用 `RoomClient`；用法和规矩见 `packages/arcade-kit/README.md`，第一版的取舍见 `docs/platform-backend.md` 4.6、5.3。
- **用户看到的文字**：
  - 中文，大白话，少术语；
  - 能用图标、数字、颜色、动画表达的，不写长句；
  - 不嘲弄真实个人，涉及伤亡的事件不拿来搞笑。
- **素材**：只用自己程序生成的，或者许可明确可商用的素材；来源写进模块的素材说明。真实公司名、真实商标不进游戏，用化名。
- **不碰真钱**：积分、筹码不能买、不能兑换、不能转让，不设现金或实物奖品。
- **凭证**：不进 Git、不打印、不写进代码。部署凭证只放在 GitHub 环境 `production`（只许 main 用），本地需要时用自己家目录下、不进 Git 的 env 文件。
- **注释和文档**：用中文，写"为什么"，不写显而易见的"做什么"；风格跟着所在文件走。

## 5. Git 与发布

- 只有一个远程仓库：`yyyu-star/arcade`，默认分支 `main`。**main 只接受 PR 合并**，流程、审阅要求和权限见 [CONTRIBUTING.md](CONTRIBUTING.md)。
- 每个克隆先执行 `git config core.hooksPath tools/git-hooks`：本地拦住直接推 main 和 force push。被拦了就改走 PR，不用 `--no-verify` 绕过。
- 分支名 `<模块>/<简短说明>`；一个 PR 只改一个模块，标题以模块名开头（合并用 Squash，标题就是 main 上的提交信息）。
- 提交：只暂存明确的路径，禁止 `git add -A` 或 `git add .`；提交信息以模块名开头；不 force push，不改写已推送的历史。
- 合并前：模块里 `npm test` 和构建通过、PR 上 CI 全绿、审阅意见全部处理完。合并后 CI 构建打包，维护者在 production 环境上批准后才部署，再到线上实际打开验证（版本号、主流程、控制台零报错）。
- 审阅：作者按 CONTRIBUTING.md 的审阅清单（完整、正确、独立、不耦合、高效、简洁）自查，审阅人读完整个 diff；守门代理审过的 PR 由维护者（主线）复核后在 CI 全绿时合并。没有自动合并。
  改 `.github/`、`tools/`、`CONTRIBUTING.md`、`AGENTS.md`，以及模块的 `package.json`、lockfile、构建测试配置、脚本、隐藏文件、wrangler 配置的 PR 由维护者本人审阅（[docs/review-policy.md](docs/review-policy.md) 第 6 节）。
- 游戏代码按安全敏感代码审：它和平台同一个站点，浏览器里能以登录玩家的身份调平台 `/api`。
- **Cloudflare 的发布只由维护者（主线）做**：守门代理永远不合并 PR、不批准部署，它的令牌不含 Deployments、Environments、Secrets、Administration 权限。
- 带 D1 迁移的改动，发布顺序是：迁移 → 平台 → 游戏（分成几个 PR 依次合并）。
- 线上出问题时默认往前修：开修复 PR，快速审阅后由维护者合并并当场批准部署（不等发布批次）；只有伤到数据、钱包的事故才对出问题的 PR 开 revert PR。不直接推 main 修线上。

## 6. 多人、多代理协作

- 一个模块同一时间只由一个人或一个代理写；跨模块的改动（比如改共用包，或改平台接口同时改游戏）拆成几个 PR，按依赖顺序合并。
- 开工前看一眼 `git status` 和最近的提交，不覆盖别人未提交的改动。
- 长任务的进度和交接写在模块的文档或提交里，不留在会话里。
