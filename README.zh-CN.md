<div align="center">

# Arcade 小游戏街机厅

**可以自己托管的小游戏平台（Cloudflare Workers 或你自己的服务器）：一个大厅、一个账号，玩所有游戏。**

大厅带账号、云存档、好友、排行榜和娱乐筹码钱包；游戏有股市肉鸽《开盘》、掼蛋、德州扑克、川麻《雀馆》、幸存者类动作游戏《夜巡》、回合制卡牌赛车《飞驰》，
可以单机对电脑，也可以开好友房一起玩。可以部署在 Cloudflare Workers 上，也可以用自托管套件跑在自己的机器上。

[![Check isolation](https://github.com/yyyu-star/arcade/actions/workflows/check.yml/badge.svg)](https://github.com/yyyu-star/arcade/actions/workflows/check.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-f38020?logo=cloudflare&logoColor=white)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/yyyu-star/arcade/tree/main/platform)

[English](README.md) · **简体中文**

[快速开始](#快速开始) · [部署](#部署) · [架构](#架构) · [文档](#文档) · [参与贡献](CONTRIBUTING.md)

</div>

| 开盘 | 掼蛋 | 德州扑克 | 雀馆 | 夜巡 | 飞驰 |
|:---:|:---:|:---:|:---:|:---:|:---:|
| ![开盘](platform/public/covers/kaipan.webp) | ![掼蛋](platform/public/covers/guandan.webp) | ![德州扑克](platform/public/covers/texas.webp) | ![雀馆](platform/public/covers/mahjong.webp) | ![夜巡](platform/public/covers/yexun.webp) | ![飞驰](platform/public/covers/racing.webp) |
| 真实历史行情驱动的散户肉鸽 | 规则完整的竞赛掼蛋 | 无限注德州，2–9 人 | 川麻·血战到底 | 幸存者类动作，守夜 / 夜探 | 回合制卡牌赛车，2–6 辆 |

> 本仓库不托管公开的演示站：在本机跑起来（见[快速开始](#快速开始)），或者按[部署](#部署)一节部署你自己的一份。
> 筹码只是游戏里的分数：不能买、不能卖、不能兑换、不能转让，没有任何现金价值。

## 特点

- **一个账号玩所有游戏**：用户名 + 密码 + 恢复码；默认邀请制，管理员可以随时开关注册。
- **云存档、好友、排行榜、战绩**：平台的 `/api` 统一提供，所有游戏共用。
- **娱乐筹码钱包**：所有游戏一个钱包，分娱乐和实盘；每天有补给；好友房由服务端结算。
- **好友房**：基于 Durable Objects（WebSocket 休眠、每个房间只用一个闹钟），服务端说了算，绝不下发别人的底牌。
- **单机对电脑**：整局在浏览器里跑，不花服务器钱。
- **手机优先**：在低内存的 iPhone、iPad 上实测过：渲染倍数封顶、按可见区域算高度、让出刘海、WebGL 上下文丢了能恢复。
- **规则可复现**：每个游戏的规则核心都是纯函数加带种子的随机数，存档、回放、复现 bug 都靠它。
- **模块随时能拆**：平台、每个游戏、共用包都是独立模块，各有依赖、测试、Worker 和部署流程。
- **两种跑法**：部署在 Cloudflare Workers 上，或者在自己的机器上用裸 `workerd` 二进制或 Docker 跑（SQLite 或 PostgreSQL），模块代码不变。

## 游戏

| 模块 | 游戏 | 亮点 |
|---|---|---|
| [`games/kaipan`](games/kaipan/) | **开盘** | 散户炒股题材的肉鸽；135 段真实历史走势（公有领域数据）驱动大盘；每日挑战、结局海报。 |
| [`games/guandan`](games/guandan/) | **掼蛋** | 竞赛规则完整；单机对三个电脑；好友房；每副复盘。正在重构成多玩法的「牌馆」（先掼蛋，下一个是斗地主，方案见该模块 `docs/doudizhu.md`）。 |
| [`games/texas`](games/texas/) | **德州扑克** | 无限注，2–9 人；电脑性格各异；好友房；表情和道具。 |
| [`games/mahjong`](games/mahjong/) | **雀馆** | 一套引擎多种玩法；川麻·血战到底已上线，立直麻将的规则核心已写好、还没上线（`docs/riichi.md`）；听牌提示；好友房。 |
| [`games/yexun`](games/yexun/) | **夜巡** | 幸存者类动作：道士夜巡雪夜古镇，只管走位；守夜（撑到天亮）和夜探（搜宝撤离）两个模式；固定步长的确定性模拟，每日挑战。 |
| [`games/racing`](games/racing/) | **飞驰** | 回合制卡牌赛车：换挡出牌、控热量、过弯限速、吃尾流；三条赛道，电脑车手性格各异，好友房。社区贡献者的作品；只有娱乐模式，不碰钱包。 |

各模块当前版本和进展见各自的 `package.json` 和 `CHANGELOG.md`。

## 快速开始

需要 **Node.js 22**（见 `.nvmrc`）和 npm。每个模块各自安装、各自运行，仓库根没有 `package.json`。

```bash
git clone https://github.com/yyyu-star/arcade.git
cd arcade/platform          # 或 games/kaipan、games/guandan、games/texas、games/mahjong、games/racing、games/yexun
npm ci
npm run dev                 # 本地开发
npm test                    # 单元测试（vitest）和 Worker 测试
npm run build               # 正式构建
```

| 模块 | 开发端口 | 预览端口 |
|---|---|---|
| platform | 5180（接口 `npm run dev:api`：5181） | 4180 |
| games/kaipan | 5173 | 4173 |
| games/guandan | 5174 | 4174 |
| games/texas | 5175 | 4175 |
| games/mahjong | 5176 | 4176 |
| games/racing | 5177 | 4177 |
| games/yexun | 5178 | 4178 |

共用包（`packages/arcade-kit`、`packages/arcade-host`）没有开发服务器，只有测试。各模块的脚本、测试工具和冒烟测试见模块自己的 README。提 PR 前还要在仓库根跑一次 `node tools/check-isolation.mjs`（不用安装依赖）。

## 部署

两种部署方式：**整站**（平台 + 游戏，有账号、钱包、排行榜），或者**只部署一个游戏**。每个游戏的 `wrangler.jsonc` 都是独立配置，
不带平台也能部署；部署整站时，由维护者管的部署工具在上面补上接平台的绑定。

### 整站（平台 + 游戏）

所有东西挂在**同一个主机名**下：平台 Worker 负责 `/` 和 `/api/*`，每个游戏的 Worker 用路径路由挂在 `/games/<id>/*`。
同一个主机名，游戏就能直接共用平台的登录 cookie 和 `/api`，没有跨域问题。你需要一个 Cloudflare 账号，以及这个主机名所在的域名（zone）。
本仓库自己就是这样部署的：每个模块在 `.github/workflows/` 里有一个流程，PR 上只测试，合并进 `main` 后部署。

1. fork 本仓库，新建名为 **`production`** 的环境（Settings → Environments），只允许 `main` 使用。
   在你的 fork 里把 [`tools/verify-main.sh`](tools/verify-main.sh) 的 `TRUSTED_BASE` 改成你 fork 时的那个提交：
   部署前核对只认这之后由仓库所有者合并的 PR。
2. 在这个环境里加 secret：

   | Secret | 谁用 | 值 |
   |---|---|---|
   | `CLOUDFLARE_API_TOKEN` | 全部 | 有 Workers 脚本、Workers 路由、D1、Durable Objects 编辑权限的 API 令牌 |
   | `CLOUDFLARE_ACCOUNT_ID` | 全部 | 你的账号 ID |
   | `SITE_HOST` | 全部 | 要提供服务的主机名，不带协议，比如 `games.example.com` |
   | `D1_DATABASE_ID` | 平台 | 用 `npx wrangler d1 create arcade` 建出来的 D1 数据库 ID |

3. 平台 Worker 自己的 secret 用 `npx wrangler secret put <名字>` 设一次（清单在 `platform/.dev.vars.example`）。
4. 运行部署流程：**先平台**（游戏要绑定它的 `arcade` Worker），再各个游戏。
   哪些游戏接平台写在 [`tools/workers.json`](tools/workers.json)；对这些游戏，`tools/deployer/deploy.mjs` 补上 `ARCADE`（认人）、`WALLET`（钱包）两个服务绑定，
   把 `GATE` 定成 `"login"`，关掉 `workers.dev`。路由和站点地址在部署时由 `SITE_HOST` 注入，仓库里不写任何域名。

只有经 PR 合并进 `main` 的提交才会部署（`tools/verify-main.sh` 把关）。
页首的按钮只部署平台（会建好 D1 数据库，按提示填 [`platform/.dev.vars.example`](platform/.dev.vars.example) 里的 secret）；用游戏自己的按钮部署的游戏不会接到它上面。

### 只部署一个游戏

不要平台，也不要域名：游戏会得到一个 `https://<id>.<你的子域>.workers.dev` 地址。

- **Deploy to Cloudflare 按钮**：`https://deploy.workers.cloudflare.com/?url=https://github.com/yyyu-star/arcade/tree/main/games/<id>`
  （`<id>` 换成 `kaipan`、`guandan`、`texas`、`mahjong`、`racing` 或 `yexun`）。按钮只复制这个游戏的目录，所以要等游戏改成按别名依赖 npm 上发布的 `@yyyu-star/arcade-kit`（`"arcade-kit": "npm:@yyyu-star/arcade-kit@^0.21.3"`）
  （而不是仓库里的那份）才能用；能不能用看各游戏的 README。
- **fork 后自己部署**：`cd games/<id> && npm ci && npx wrangler login && npm run deploy`。

单独部署的游戏有：单机对电脑、好友房（身份是游客 cookie，昵称用地址上的 `?name=`）、浏览器本地存档；没有：登录、云存档、排行榜、钱包实盘。
细节见 [docs/new-game.md](docs/new-game.md) 第 7 节。

### 自托管（不用 Cloudflare）

整站（平台 + 全部游戏）也能在自己的机器上跑，**一个进程**：[`packages/arcade-host`](packages/arcade-host/README.md) 在
[workerd](https://github.com/cloudflare/workerd) 里原样跑各模块，补上 Cloudflare 平时提供的东西（D1 用 SQLite 或 PostgreSQL、静态资源、路由、定时任务）。
Cloudflare 上的部署不受影响。`main` 上自动发布多架构（amd64、arm64）镜像 **`ghcr.io/yyyu-star/arcade`**
（标签：`latest`、发布包版本、提交短号）。镜像里没有任何 Secret、主机名、数据库 id，全部从环境变量来。

**设置**（环境变量，写在 `secrets.env` 里）：

| 变量 | 必填 | 是什么 |
|---|---|---|
| `PEPPER_PW`、`PEPPER_RC`、`PEPPER_SID`、`PEPPER_IP` | 是 | 哈希用的 pepper，格式 `k1:<随机串>`；用上之后不能改、不能丢 |
| `ADMIN_TOKEN` | 建第一个管理员时要 | 格式同上 |
| `SITE_ORIGIN` | 前面有 HTTPS（compose、Caddy）时要 | 站点地址，比如 `https://game.example.com`；不设的话经 HTTPS 反代登录会被拒（"请求来源不对"） |
| `ARCADE_DB` | 否 | `sqlite`（默认）或 `pg` |
| `ARCADE_PG_URL` | `ARCADE_DB=pg` 时 | PostgreSQL 连接串 |

先生成一次 Secret（这个文件另存一份，和备份分开放）：

```sh
mkdir arcade && cd arcade
for k in PEPPER_PW PEPPER_RC PEPPER_SID PEPPER_IP ADMIN_TOKEN; do echo "$k=k1:$(openssl rand -hex 24)"; done > secrets.env
chmod 600 secrets.env
```

**先试试：一个容器、SQLite、数据在卷里：**

```sh
docker run -d --name arcade --restart unless-stopped -p 127.0.0.1:8787:8787 -v arcade-data:/data --env-file secrets.env ghcr.io/yyyu-star/arcade:latest
docker exec arcade /app/ops/create-admin.sh zhanzhang 站长   # 打印第一个管理员的密码和恢复码，只打印这一次
```

打开 <http://localhost:8787> 登录；注册默认关着，在 `/admin` 里建号或打开注册。对外开站要在前面加 HTTPS，用下面的 compose。

**正式站：docker compose，自动 HTTPS（Caddy）。** [`compose.yaml`](tools/selfhost/docker/compose.yaml) 起 `arcade`（不发布到宿主）、
`caddy`（80/443 端口，给 `SITE_HOST` 自动申请、续期证书，传真实 IP），加 `pg` profile 时再起 `postgres`。先把域名解析到这台服务器，然后在 `secrets.env` 所在的目录：

```sh
curl -fsSLO https://raw.githubusercontent.com/yyyu-star/arcade/main/tools/selfhost/docker/compose.yaml
curl -fsSLO https://raw.githubusercontent.com/yyyu-star/arcade/main/tools/selfhost/docker/Caddyfile
echo "SITE_ORIGIN=https://game.example.com" >> secrets.env
echo "SITE_HOST=game.example.com" > .env
docker compose up -d
docker compose exec arcade /app/ops/create-admin.sh zhanzhang 站长
```

用 PostgreSQL 代替 SQLite（平台库放进同一套 compose 里的 `postgres`，游戏房间仍在 `arcade-data` 卷里），第一次启动前做：

```sh
openssl rand -hex 24 > pg_password.txt
echo "ARCADE_PG_URL=postgres://arcade:$(cat pg_password.txt)@postgres:5432/arcade" >> secrets.env
printf 'ARCADE_DB=pg\nCOMPOSE_PROFILES=pg\n' >> .env
docker compose up -d
```

**备份和恢复**（SQLite：经内部管理入口逻辑导出，管理入口只在容器里）：

```sh
docker compose exec arcade /app/ops/backup.sh /data/backups
docker compose cp arcade:/data/backups ./backups                      # 从这里拷到别的机器
docker compose exec arcade sh -c '/app/ops/restore.sh d1-arcade-DB "$(ls -d /data/backups/*/ | tail -1)d1-arcade-DB.sql"'   # 恢复最近一份
```

PostgreSQL：`docker compose exec postgres pg_dump -U arcade --clean --if-exists arcade > arcade.sql` 备份，
`docker compose exec -T postgres psql -U arcade -d arcade < arcade.sql` 恢复。

**升级和回滚**（迁移只加不删，旧镜像也认新的库）：

```sh
docker tag ghcr.io/yyyu-star/arcade:latest arcade:previous     # 先留住正在跑的版本
docker compose pull && docker compose up -d                     # 升级
echo "ARCADE_IMAGE=arcade:previous" >> .env && docker compose up -d   # 回滚（删掉这一行就回到跟 latest）
```

**不用 Docker：二进制 + systemd**（Debian/Ubuntu；Node 22 只在打包时用）：从源码打发布包、安装，前面放 Caddy。

```sh
git clone https://github.com/yyyu-star/arcade.git && cd arcade
npm ci --ignore-scripts --prefix tools/deployer
(cd packages/arcade-host && npm ci && npm run build)
v=$(git rev-parse --short HEAD)
tools/selfhost/pack-all.sh build/art && ARCADE_VERSION=$v tools/selfhost/release.sh build/art build/out --with-pg
sudo build/out/arcade-$v/ops/install.sh build/out/arcade-$v.tar.gz game.example.com   # 建用户和目录、生成 /etc/arcade/secrets.env、装 systemd 单元
sudo /opt/arcade/current/ops/create-admin.sh zhanzhang 站长
sudo apt install caddy && sudo cp /opt/arcade/current/ops/Caddyfile /etc/caddy/Caddyfile
echo "SITE_HOST=game.example.com" | sudo tee /etc/default/caddy && sudo systemctl restart caddy
```

备份：`sudo /opt/arcade/current/ops/backup.sh /var/lib/arcade/backups`（每晚用 cron 或 systemd timer 跑）。升级：拉代码、按上面重新打包，再
`sudo /opt/arcade/current/ops/upgrade.sh build/out/arcade-$v.tar.gz`（先备份，新版起不来自动切回）；回滚：`sudo /opt/arcade/current/ops/rollback.sh`。
用 PostgreSQL：在 `/etc/arcade/secrets.env` 里加 `ARCADE_DB=pg` 和 `ARCADE_PG_URL` 两行。

还没在真机上验证过的：Caddy 给公网域名申请真证书，systemd 单元和安装、升级脚本。CI 测的是发布的镜像（SQLite 和 PostgreSQL）、
经 Caddy 的整套 compose（`localhost`，用 Caddy 的内部证书）和二进制。游戏房间也放进 PostgreSQL（什么都不落盘）要有房间的游戏都用 arcade-kit ≥ 0.21.0，现在还不是。
细节、全部选项和 CI 覆盖范围见 [tools/selfhost/README.md](tools/selfhost/README.md)。

## 架构

```mermaid
flowchart LR
  B[浏览器] -->|"/ 和 /api/*"| P["arcade Worker<br/>（平台：大厅 + 接口）"]
  B -->|"/games/&lt;id&gt;/*"| G["游戏 Worker<br/>（静态资源 + 登录闸门）"]
  B <-->|WebSocket| R["房间 Durable Object<br/>（好友房）"]
  G -->|服务绑定 ARCADE、WALLET| P
  G --- R
  P --> D[(D1：账号、存档、<br/>好友、钱包)]
```

| 目录 | 内容 |
|---|---|
| [`platform/`](platform/) | 大厅（React）和 `/api` Worker：账号、云存档、好友、排行榜、钱包、管理页 |
| [`games/<id>/`](games/) | 一个目录一个游戏，各自有 Worker、测试、`CHANGELOG.md` 和部署流程 |
| [`packages/arcade-kit/`](packages/arcade-kit/) | 共用包，发布在 npm（`@yyyu-star/arcade-kit`）：房间基类、开房进房入口、浏览器连接器、协议、计量、牌桌互动、聊天、分享卡、社交部件 |
| [`packages/arcade-host/`](packages/arcade-host/) | 自托管运行时（见上），只测试、不部署到 Cloudflare |
| [`docs/`](docs/) | 跨模块的设计文档 |
| [`tools/`](tools/) | 仓库工具：独立性和部署配置检查、钉死的部署工具、拆分模块、git hooks、部署前核对、[自托管脚本](tools/selfhost/README.md) |

几条硬约束，CI 里由 `node tools/check-isolation.mjs` 检查：

- 每个模块自带全部文件和依赖，不引用自己目录以外的文件（唯一例外：用 `file:../../packages/<name>` 依赖共用包）；
- 模块之间只走公开接口（同域 HTTP、服务绑定）；
- 浏览器存储的 key 一律加模块前缀（`kaipan.`、`texas.` ……），因为大家同域；
- 任何模块都能用 `tools/split-module.sh` 拆成独立仓库。

## 文档

- [AGENTS.md](AGENTS.md)：仓库规范，给开发者和 AI 编程代理（模块独立、代码规范、手机适配、测试）
- [docs/project.md](docs/project.md)：项目做什么、给谁、守什么底线、路线图
- [docs/architecture.md](docs/architecture.md)：整体架构
- [docs/platform-backend.md](docs/platform-backend.md)：账号、联机房间、额度和熔断
- [docs/economy.md](docs/economy.md)：筹码体系
- [docs/social.md](docs/social.md)：社交（分享、在线、邀请、旁观、好友榜）
- [docs/balance.md](docs/balance.md)：难度和收益的配平目标（所有游戏共用）
- [docs/table-fun.md](docs/table-fun.md)：牌桌互动规范（表情、道具、电脑反应）
- [docs/new-game.md](docs/new-game.md)：新游戏开发指南
- [docs/review-policy.md](docs/review-policy.md)：PR 怎么审、怎么合（自动预审，只由维护者合并和批准部署）
- 各模块 README：[平台](platform/README.md) · [开盘](games/kaipan/README.md) · [掼蛋](games/guandan/README.md) · [德州](games/texas/README.md) · [麻将](games/mahjong/README.md) · [夜巡](games/yexun/README.md) · [飞驰](games/racing/README.md) · [arcade-kit](packages/arcade-kit/README.md) · [arcade-host](packages/arcade-host/README.md) · [自托管](tools/selfhost/README.md)

## 参与贡献

欢迎贡献，请先读 [CONTRIBUTING.md](CONTRIBUTING.md) 和[行为准则](CODE_OF_CONDUCT.md)。安全问题见 [SECURITY.md](SECURITY.md)。

## 许可证

[MIT](LICENSE)。游戏素材由项目自己的代码生成，或来自许可明确可商用的来源，见各模块的素材说明；开盘的行情数据来自公有领域的 WIKI Prices 数据集。
