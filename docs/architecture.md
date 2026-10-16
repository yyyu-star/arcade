# 小游戏街机厅：整体架构

> 2026-10-11 初稿；2026-10-13 改为单一总仓库：平台和各个小游戏都在 `yyyu-star/arcade` 里，每个是可以单独部署、随时拆分的独立模块（规范见仓库根 `AGENTS.md`）。

## 1. 选型原则

技术栈统一，全部可以部署到 Cloudflare Workers，资源轻量，打包方便。

| 原则 | 落实 |
|---|---|
| 技术栈统一 | 平台和所有游戏都用 TypeScript + Vite，Node 22（`.nvmrc`）。平台界面用 React；游戏按类型选渲染层（开盘用 Phaser），但构建和部署方式一致。以后的后端接口也用 TypeScript 写在 Worker 里。 |
| 都部署到 Workers | 每个模块构建出纯静态的 `dist/`，用 Workers 静态资源托管，一律用 wrangler 部署。账号、好友、排行榜等接口用 Worker，数据放 D1 或 KV。 |
| 资源轻量 | 平台首页只有 React 加一个游戏列表（gzip 后约 60KB）；各游戏只在进入时才加载。游戏素材烘焙成图集，正式构建不带 sourcemap。 |
| 打包方便 | 每个模块都是 `npm run build` 加 `wrangler deploy` 两步；经 PR 合并进 `main` 后由 GitHub Actions 按路径只部署有改动的模块。 |

## 2. 仓库与目录

只有一个仓库 `yyyu-star/arcade`（2026-10-13 起；在这之前是每个游戏一个仓库）。

| 目录 | 内容 | Worker | 线上路径 |
|---|---|---|---|
| `platform/` | 平台主界面；账号、云存档、好友、排行榜（简单版）、管理员注册开关已上线（0.8.1），以后联机房间登记 | `arcade` | `/`、`/api/*` |
| `games/kaipan/` | 《开盘》 | `kaipan` | `/games/kaipan/` |
| `games/guandan/` | 掼蛋 | `guandan` | `/games/guandan/` |
| `games/texas/` | 德州扑克 | `texas` | `/games/texas/` |
| `games/mahjong/` | 《雀馆》麻将（先做川麻·血战到底） | `mahjong` | `/games/mahjong/` |
| `games/<id>/` | 以后的每个小游戏 | `<id>` | `/games/<id>/` |
| `packages/arcade-kit/` | 共用包：联机房间基类、开房进房入口、浏览器连接器、协议、表情道具（0.7.x）；只测不部署（`pkg-arcade-kit.yml`） | 无 | 无 |
| `packages/<name>/` | 以后的共用包 | 无 | 无 |

- 每个目录是独立模块：自带依赖、配置、测试和部署流程，不引用目录外的文件（`packages/` 除外），`tools/check-isolation.mjs` 在 CI 里强制检查。
- 拆成独立仓库用 `tools/split-module.sh`（基于 `git subtree split`，保留历史）。
- 游戏目录写在 `platform/src/games.ts`：名字、介绍、封面、线上路径、本地开发地址、状态。

## 3. 部署形态：同一个站点主机名，按路径分给不同的 Worker

站点主机名不写在仓库里：部署时由 GitHub `production` 环境的 secret `SITE_HOST` 注入（各 Worker 的路由和 `SITE_ORIGIN`），
下文写作 `<站点>`，例如 `games.example.com`。

```
https://<站点>/                 → arcade Worker（自定义域名；平台界面，静态资源）
https://<站点>/api/*            → arcade Worker（账号、好友、云存档、排行榜；数据在 D1）
https://<站点>/games/<id>/*     → 各游戏的 Worker（路径路由，优先于自定义域名；静态资源直接返回，首页有登录闸门，
                                   联机房间和实盘接口经服务绑定 ARCADE / WALLET 调平台）
```

2026-10-11 上线。游戏的 Worker 关闭了自己的 workers.dev 地址，只能通过站点主机名访问。
原先平台的 Worker 还通过服务绑定在 workers.dev 测试地址上兜底转发 `/games/*`；2026-10-14 决定取消：平台也关闭 workers.dev，
只留自定义域名这一个入口，不再有测试地址，也就不需要兜底转发。线上 Worker 只有平台 1 个加每个游戏 1 个，不另建测试环境（platform-backend.md 第 8 节）。

- 为什么放在同一个主机名下：登录状态（cookie）和接口（`/api/*`）可以被所有游戏直接共用，没有跨域问题。以后接入账号时，游戏不需要各自做登录。
- 为什么每个游戏单独一个 Worker：游戏可以单独更新，不用连带重新发布平台；一个游戏出问题也不影响其他游戏。
- 游戏要能在子路径下运行：
  - 素材一律用相对路径加载，开盘已经满足；
  - 正式构建设置 Vite 的 `base`，并把产物放到 `games/<id>/` 目录结构下，这样 Worker 能按 URL 路径直接找到文件。具体做法在第一次部署时定下来。
- 为什么用路径路由而不是让平台转发：路由直接打到游戏的 Worker，纯静态资源请求免费、不计入每天的请求额度；
  如果由平台的 Worker 转发，游戏的每个文件请求都会计一次平台的调用。

## 4. 账号、联机房间与费用熔断（账号、云存档、好友、排行榜、钱包、战绩已上线；掼蛋、德州、麻将的好友房都基于 `arcade-kit`）

完整方案见 [platform-backend.md](platform-backend.md)（2026-10-13，含实测与审阅）。要点：

- 账号、好友、排行榜、房间登记归平台的 `/api/*`，数据在平台独占的 D1；账号用用户名 + 密码 + 恢复码；测试期是邀请制，账号主要由管理员建，注册默认关着、管理员可以随时开关（0.8.0），不登录不能玩游戏（游戏 Worker 在首页上做登录闸门，见 platform-backend.md 5.8、15.8；接口约定见第 15 节）。
- 排行榜是简单版、不防作弊（2026-10-14 定，能作弊算玩家自己的本事）：游戏页直接调 `/api/scores` 交分，平台只防刷额度、查数据格式，不重放验分，所以不需要付费版（platform-backend.md 9.2）。
- 平台页和游戏同域，Cloudflare Web Analytics 由站点所在的 zone 自动注入统计脚本；平台的 CSP 只为它多放了一个脚本来源，上报走同源（platform-backend.md 5.2）。
- 每个游戏的联机房间放在它自己的 Worker 里（Durable Objects，休眠写法，免费版只能用 SQLite 后端），开房 `…/rooms`、进房 `…/rooms/<码>/ws`（德州、麻将挂在 `/games/<id>/` 下，掼蛋挂在 `/games/guandan/room/` 下）。
- 共用代码放进共用包 `packages/arcade-kit`，所有游戏必须遵守其中的房间规范。现有房间基类、开房进房入口（经平台 `/api/me` 认人）、浏览器连接器、协议、计量、表情道具（`arcade-kit/fun`）；
  入场票、房间登记以后再加，第一版的取舍见 platform-backend.md 4.6、5.3。
- 费用：自计量熔断 + GraphQL 对账 + 墓碑版本兜底，默认 8 美元停服。联机之前，平台接口先按免费版的日额度自计量，到线就只读或停服（platform-backend.md 6.6）。

## 5. 本地开发

| 项目 | 开发端口 | 预览端口 |
|---|---|---|
| arcade | 5180（接口 `npm run dev:api`：5181） | 4180 |
| kaipan | 5173 | 4173 |
| guandan | 5174 | 4174 |
| texas | 5175 | 4175 |
| mahjong | 5176 | 4176 |

开发时，平台的"进入游戏"会跳到游戏自己的开发服务器（`src/games.ts` 里的 `devUrl`）；正式构建用同域路径。
