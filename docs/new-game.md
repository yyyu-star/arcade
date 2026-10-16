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
├─ wrangler.jsonc          部署配置（只许用部署配置检查允许的字段，见第 4 节）
├─ index.html  src/  public/
├─ src/core/               规则核心：纯函数，不碰 DOM、网络、Math.random、Date.now
├─ test/ 或 tests/         vitest；规则核心全覆盖，架构约束也写成测试
├─ scripts/                模拟器、无头浏览器冒烟
├─ README.md  AGENTS.md  CLAUDE.md（一行 @AGENTS.md）  CHANGELOG.md  ASSETS.md（素材来源）
└─ .gitignore
```

隐藏文件只许有 `.gitignore`、`.nvmrc`、`.dev.vars.example`（和 `tools/check-deploy-config.mjs` 的名单一致）；不要提交 `.env*`、`.npmrc`、`.wrangler/`、`wrangler.json`、`wrangler.toml`、符号链接（部署配置检查会拦，见第 4 节）。

`package.json` 里写 `"license": "MIT"`；依赖共用包写 `"arcade-kit": "file:../../packages/arcade-kit"`（唯一允许指向模块外的路径）。

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

正式站只由维护者发布：PR 合并后，`main` 上的部署流程构建打包，维护者批准后才部署。贡献者不需要、也拿不到 Cloudflare 凭证。
部署时用的配置就是模块根目录这份 `wrangler.jsonc`（构建期间改它不起作用），它要能过部署配置检查（`node tools/check-deploy-config.mjs`，白名单在 `tools/deployer/lib.mjs`）：

- `"name": "<id>"`，`"workers_dev": false`，`"preview_urls": false`；不写 `routes`、域名、`account_id`、`env`、`limits`；路由由部署流程按 `SITE_HOST` 注入；
- `main` 和 `assets.directory` 必须在模块目录里；构建产物放在 `assets.directory`（现有游戏是 `dist-cf/`），Worker 由 `wrangler deploy --dry-run` 打成一个文件；
- 绑定只许：静态资源 `ASSETS`；本模块自己的 Durable Object（只写 `name`、`class_name`，房间 `ROOM`、计量 `METER`）；
  指向平台 `arcade` 的服务绑定 `ARCADE`、钱包 `WALLET`（`entrypoint` 只许 `WalletService`，`props` 只许 `{ "game": "<id>" }`）；
- Durable Object 的 `migrations` 只许 `tag`、`new_classes`、`new_sqlite_classes`（不许转移、删除、改名类）；`observability` 不许 `destinations`；
- 不许 KV、R2、队列、D1、别的 Worker 的 Durable Object、`tail_consumers`；确实需要时在 issue 里和维护者商量；
- `vars` 里不写 `SITE_ORIGIN`（正式部署注入，本地不设时按请求自己的 origin）；`vars` 名和 `compatibility_flags` 只许 `tools/deploy-allowlist.json` 里给这个游戏列的，新增由维护者加；
- 只用 `\n` 换行，配置里不写 `__proto__` 和 `\u` 转义。

## 5. 上线要经过的几步（维护者负责模块外的部分）

1. **游戏 PR**（你开）：只改 `games/<id>/`。CI 跑独立性检查、部署配置检查和你的测试。
   第一次的 PR 会因为 Worker 名还不在名单里，部署配置检查不通过——这是预期的，守门代理会把它升级给维护者。
2. **维护者登记**（不需要你做）：
   - 确认 Cloudflare 账户里没有同名的 Worker，把 `<id>` 加进 `tools/workers.json`，把它用到的 `vars` 名加进 `tools/deploy-allowlist.json`；
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
