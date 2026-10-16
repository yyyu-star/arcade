# 新游戏开发指南

> 给想在 Arcade 里加一个新游戏的开发者。读完这一篇再动手，能少走很多弯路。
> 硬约束以根目录 [AGENTS.md](../AGENTS.md) 为准；PR 怎么审、怎么合见 [review-policy.md](review-policy.md)。

## 0. 先想清楚

- **一个游戏 = 一个模块**：`games/<id>/` 自带全部代码、依赖、配置、测试和文档，随时能拆成独立仓库（AGENTS.md 第 1 节）。
- **id**：小写字母、数字，短而好记（比如 `texas`、`mahjong`）。它同时是目录名、Worker 名、浏览器存储的前缀（`<id>.`）、平台登记的 id、钱包里的游戏名。
  定了就别改；开 PR 前在 issue 里说一声，维护者会确认 Worker 名能用。
- **路径**：游戏挂在站点的 `/games/<id>/` 下，资源一律用相对路径，不假设自己在域名根。
- **定位**：单机对电脑在浏览器里跑（不花服务器钱）；要好友房就用共用包 `packages/arcade-kit` 的房间；要排行榜、云存档、钱包就用平台的 `/api`。

## 1. 从一个现成的游戏起步

最省事的是照着结构最接近的游戏起步，删掉不要的部分：

| 想做的 | 参考 |
|---|---|
| 牌类、多人、好友房、实盘 | `games/mahjong`（结构最新、最规整）、`games/texas` |
| 单人、画布动画（Phaser） | `games/kaipan` |
| 竞赛规则复杂、电脑多档强度 | `games/guandan` |

模块里至少要有（`node tools/check-isolation.mjs` 会查）：

```
games/<id>/
├─ package.json  package-lock.json  .nvmrc  tsconfig.json  vite.config.ts
├─ wrangler.jsonc          独立的部署配置：不带平台也能单独部署（只许用部署配置检查允许的字段，见第 4 节）
├─ index.html  src/  public/
├─ src/core/               规则核心：纯函数，不碰 DOM、网络、Math.random、Date.now
├─ test/ 或 tests/         vitest；规则核心全覆盖，架构约束也写成测试
├─ scripts/                模拟器、无头浏览器冒烟
├─ README.md  AGENTS.md  CLAUDE.md（一行 @AGENTS.md）  CHANGELOG.md  ASSETS.md（素材来源）
└─ .gitignore
```

隐藏文件只许有 `.gitignore`、`.nvmrc`、`.dev.vars.example`（和 `tools/check-deploy-config.mjs` 的名单一致）；不要提交 `.env*`、`.npmrc`、`.wrangler/`、`wrangler.json`、`wrangler.toml`、符号链接（部署配置检查会拦，见第 4 节）。

`package.json` 里写 `"license": "MIT"`；依赖共用包写 npm 上发布的版本，按别名装（`"arcade-kit": "npm:@yyyu-star/arcade-kit@^0.10.1"`，包名是 `@yyyu-star/arcade-kit`，别名让代码里的 `arcade-kit/...` 不用改；命令行是 `npm i arcade-kit@npm:@yyyu-star/arcade-kit`。单独部署和 Deploy to Cloudflare 按钮只复制游戏目录，`file:` 路径带不过去），
或者仓库内的 `"arcade-kit": "file:../../packages/arcade-kit"`（唯一允许指向模块外的路径，跟着仓库里最新的 kit 走，但不能单独部署）。
脚本里要有 `deploy`：先构建出 `assets.directory` 指的目录再 `wrangler deploy`（比如 `"deploy": "npm run build:cf && wrangler deploy"`），单独部署和按钮都用它。

## 2. 写代码的规矩（摘要，细节见 AGENTS.md 第 4 节）

- **规则和画面分开**：规则核心输入状态和操作、输出新状态和事件；画面只读规则给的状态，不自己算规则。
- **确定性**：随机一律用带种子、按用途分流的 RNG；同一个种子加同一串操作，结果完全一样（存档、回放、联机校验都靠它）。
- **电脑**：绝不看别人的牌；按场地分强弱（新手场偏弱，档位越高越强），性格有差别，每场状态有浮动；CPU 预算写成测试。
- **联机**：房间继承 kit 的 `GameRoom`；Worker 只接 `acceptCreate` / `acceptJoin`；浏览器用 `RoomClient`；服务端说了算，绝不下发别人的隐藏信息；
  只用一个闹钟，每步最多写 2 行存储（docs/platform-backend.md 第 4 节、kit 的 README）。
- **手机**：iOS 的几条规矩（渲染倍数封顶 2、高度按可见区域、双指放大时不改尺寸、WebGL 丢了能恢复、safe-area）全部照做，冒烟里模拟一次。
- **回大厅**：左上角常驻"大厅"入口，指向 `/`；对局中离开先确认。
- **用户看到的文字**：中文大白话；能用图标、数字、颜色表达的不写长句；不嘲弄真实个人；真实公司名、商标用化名。
- **素材**：只用自己程序生成的，或许可明确可商用的；来源写进 `ASSETS.md`。
- **筹码**：不能买、不能兑换、不能转让，不设现金或实物奖品。要做实盘，先读 [economy.md](economy.md)，用模拟器证明不会刷筹码。
- **存储**：localStorage / IndexedDB 的 key 一律 `<id>.` 开头。
- **开源约定**：代码、配置、文档里不写正式站域名、本机路径、个人信息、密钥。

## 3. 本地开发

```bash
cd games/<id>
npm ci
npm run dev        # 端口：在 AGENTS.md 第 3 节的端口表里登记一个（下一个空的是 5177 / 4177）
npm test
npm run build
```

需要登录、钱包、好友房时，参考 mahjong / texas 的 `dev:worker` 脚本：本地 `wrangler dev` 起游戏的 Worker，用 `arcade-kit/testing` 的假钱包代替平台，不需要任何 Cloudflare 账号。

## 4. 部署配置（wrangler.jsonc）

模块根目录的 `wrangler.jsonc` 是一份**独立配置**：别人拿到这个游戏目录，不要平台也能直接部署成一个能玩的游戏（第 7 节）。
本站正式部署时，维护者管的部署工具（`tools/deployer/deploy.mjs`）在它上面叠加本站的东西，游戏自己不写：

| 本站部署时补上的 | 怎么来的 |
|---|---|
| 服务绑定 `ARCADE`（认人）、`WALLET`（钱包，`props.game` 是本游戏 id） | 维护者在 `tools/workers.json` 给这个游戏声明 `"platform": ["ARCADE", "WALLET"]`，规范形式写死在 `tools/deployer/lib.mjs` |
| `vars.GATE = "login"`（必须登录） | 声明了平台关系就强制，盖掉模块里的值 |
| `workers_dev: false`、`preview_urls: false` | 本站只经站点域名访问，一律关掉 |
| 路由 `<站点>/games/<id>`、`<站点>/games/<id>/*` 和 `SITE_ORIGIN` | 按 `production` 环境的 `SITE_HOST` 注入 |

共用包 0.10.0 起按 env 自己判断：有 `ARCADE` 是平台模式（登录、钱包），没有 `ARCADE` 且 `GATE` 不是 `"login"` 是独立模式（游客）；
`GATE: "login"` 却没有 `ARCADE` 时一律拒绝（fail-closed），所以部署工具在 `tools/workers.json` 没声明 `ARCADE` 的游戏上看到 `GATE: "login"` 会直接拒绝。

它要能过部署配置检查（`node tools/check-deploy-config.mjs`，白名单在 `tools/deployer/lib.mjs`）：

- `"name": "<id>"`，`"preview_urls": false`；`workers_dev` 写 `true`（单独部署要 `workers.dev` 地址；本站部署时会被关掉）；
  不写 `routes`、域名、`account_id`、`env`、`limits`；
- `main` 和 `assets.directory` 必须在模块目录里；构建产物放在 `assets.directory`（现有游戏是 `dist-cf/`），Worker 由 `wrangler deploy --dry-run` 打成一个文件；
- 绑定只许：静态资源 `ASSETS`；本模块自己的 Durable Object（只写 `name`、`class_name`，房间 `ROOM`、计量 `METER`）；
- **不写服务绑定和 `GATE`**。过渡期里已经写了 `ARCADE`、`WALLET` 的游戏，必须和规范形式一字不差
  （`{ "binding": "ARCADE", "service": "arcade" }`、`{ "binding": "WALLET", "service": "arcade", "entrypoint": "WalletService", "props": { "game": "<id>" } }`），
  别的服务绑定（包括 `tools/workers.json` 没给这个游戏声明的）一律拒绝；
- Durable Object 的 `migrations` 只许 `tag`、`new_classes`、`new_sqlite_classes`（不许转移、删除、改名类）；`observability` 不许 `destinations`；
- 不许 KV、R2、队列、D1、别的 Worker 的 Durable Object、`tail_consumers`；确实需要时在 issue 里和维护者商量；
- `vars` 里不写 `SITE_ORIGIN`（正式部署注入，本地不设时按请求自己的 origin）；`vars` 名和 `compatibility_flags` 只许 `tools/deploy-allowlist.json` 里给这个游戏列的，新增由维护者加；
- 只用 `\n` 换行，配置里不写 `__proto__` 和 `\u` 转义；
- 独立模式下站点根 `/` 也要先到 Worker（kit 的 `standaloneRoot` 把它转到 `/games/<id>/`）：`assets.run_worker_first` 里加上 `"/"`，或者静态资源根上不放 `index.html`。

一个例子（麻将的样子，注释省略）：

```jsonc
{
  "name": "mahjong",
  "main": "worker/main.ts",
  "compatibility_date": "2026-10-01",
  "workers_dev": true,
  "preview_urls": false,
  "assets": {
    "directory": "./dist-cf",
    "binding": "ASSETS",
    "not_found_handling": "none",
    "run_worker_first": ["/", "/games/mahjong", "/games/mahjong/", "/games/mahjong/index.html", "/games/mahjong/api/stake/*", "/games/mahjong/rooms", "/games/mahjong/rooms/*"]
  },
  "durable_objects": { "bindings": [{ "name": "ROOM", "class_name": "MahjongRoom" }, { "name": "METER", "class_name": "RoomMeter" }] },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["MahjongRoom", "RoomMeter"] }],
  "vars": { "KIT_QUOTA": { "busyWrites": 8000, "stopWrites": 10000, "roomsPerUser": 5, "dailyRoomsPerUser": 100 } }
}
```

## 5. 上线要经过的几步（维护者负责模块外的部分）

1. **游戏 PR**（你开）：只改 `games/<id>/`。CI 跑独立性检查、部署配置检查和你的测试。
   第一次的 PR 会因为 Worker 名还不在名单里，部署配置检查不通过——这是预期的，守门代理会把它升级给维护者。
   `wrangler.jsonc` 按第 4 节写成独立配置，不写平台绑定；PR 说明里写清这个游戏要不要接平台（只认人，还是认人加钱包）。
2. **维护者登记**（不需要你做）：
   - 确认 Cloudflare 账户里没有同名的 Worker，把 `<id>` 加进 `tools/workers.json`，要接平台的同时声明平台关系
     （`"<id>": { "platform": ["ARCADE", "WALLET"] }`，只认人就只写 `ARCADE`；不写就按游戏自己的独立配置部署成游客模式）；
     把它用到的 `vars` 名加进 `tools/deploy-allowlist.json`（`GATE` 由部署工具补，不用列）；
   - 从 `game-kaipan.yml`（不用共用包）或 `game-mahjong.yml`（用共用包）复制一份 `.github/workflows/game-<id>.yml`，只改名字和路径
     （test 作业打包、deploy 作业 sparse-checkout 本模块的 `wrangler.jsonc`、用 `tools/deployer/deploy.mjs` 部署，这些结构不动）；
   - 在平台的 `platform/src/games.ts` 登记（名字、介绍、封面、路径、状态），放封面；云存档、排行榜、钱包的游戏白名单都从这份登记派生；
   - 有电脑人物的话把名字加进平台的保留昵称（`platform/worker/api/validate.ts`），免得真人起同样的昵称冒充电脑；
   - 在 AGENTS.md 的端口表里登记端口。
3. **合并、部署、线上验证**：先合登记，再合游戏；合并后维护者在 Actions 里批准 production 环境的部署，再到线上实际打开验证（版本号、主流程、控制台零报错）。
4. 之后的改动就是普通的游戏 PR：一个 PR 只改这个游戏；守门代理按清单审完后，由维护者复核、合并、批准部署。
   改 `package.json`、lockfile、构建测试配置、模块里的脚本、隐藏文件或 wrangler 配置的 PR 要维护者亲自审，会慢一些（[review-policy.md](review-policy.md) 第 6 节）。

## 6. 提 PR 前自查

- [ ] `node tools/check-isolation.mjs`；`npm ci --ignore-scripts --prefix tools/deployer` 后 `node tools/check-deploy-config.mjs`（新游戏第一次会提示不在名单里，正常）
- [ ] `npm test`、`npm run build`（有 `build:cf` 也跑）
- [ ] 冒烟：主流程走一遍，控制台零报错；手机横屏、竖屏、低内存各看一次；截图附在 PR 里
- [ ] 版本号、`CHANGELOG.md`、README、`ASSETS.md` 跟上
- [ ] 改了数值或电脑：附模拟器结果
- [ ] 没有域名、本机路径、密钥；Markdown 里没有 `#数字`（会被自动链接到无关的 PR）
- [ ] 只调用了这个游戏需要的平台 `/api`：游戏代码以登录玩家的身份运行，审阅时按能接触玩家账号的代码看

PR 怎么被审、什么会被打回、什么要等维护者，见 [review-policy.md](review-policy.md)。

## 7. 单独部署这个游戏（不要平台）

每个游戏的 `wrangler.jsonc` 都是独立配置，任何人都能只部署一个游戏到自己的 Cloudflare 账户，不需要平台：

- **Deploy to Cloudflare 按钮**：`https://deploy.workers.cloudflare.com/?url=https://github.com/yyyu-star/arcade/tree/main/games/<id>`。
  按钮只把 `games/<id>/` 复制成你账户下的新仓库，所以游戏要依赖 npm 上的 `@yyyu-star/arcade-kit`（按别名 `"arcade-kit": "npm:@yyyu-star/arcade-kit@^0.10.1"`，不是 `file:`），并且有第 1 节说的 `deploy` 脚本
  （按钮会自动带上 `package.json` 里的 `build`、`deploy` 脚本；Durable Object 按配置自动建）。
- **fork 或拆出来的仓库**：在游戏目录里 `npm ci && npx wrangler login && npm run deploy`。

部署完得到一个 `https://<id>.<你的子域>.workers.dev` 地址，打开后会转到 `/games/<id>/`。独立模式下：

| 有 | 没有 |
|---|---|
| 单机对电脑 | 登录（任何人打开就能玩，身份是游客 cookie，昵称取地址上的 `?name=`，没带就是"游客"加 4 位数字） |
| 好友房（开房、进房、断线重连、托管，额度照 `KIT_QUOTA`） | 云存档、排行榜、好友 |
| 浏览器本地存档 | 平台钱包和实盘（筹码带入结回） |

页面用 kit 的 `detectPlatform()` 判断有没有平台：没有时藏起登录、云存档、排行榜和实盘，"回大厅"改成回游戏首页。
想要账号和钱包，就按仓库根 README 的"整站"方式把平台也部署上，再由部署工具补上平台绑定。

