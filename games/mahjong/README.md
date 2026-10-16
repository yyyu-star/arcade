# 雀馆（games/mahjong）

一套麻将引擎 + 多个玩法的网页麻将，第一个玩法是**川麻·血战到底**；单机对三个电脑，也能开好友房一起打。

<img src="public/cover.svg" alt="雀馆封面" width="360">

## 功能

- **川麻·血战到底**：换三张、定缺、刮风下雨、一炮多响、查花猪查大叫；局数、封顶番数、换三张、自摸加底可以选。
- **电脑**：六个性格（快、贪、稳、爱杠、老练、新手），每一场的状态不一样，落后会追、领先会稳、点了炮会上头；出手快慢和台词跟性格走。
  按场地分强弱：新手场（娱乐、小档）偏弱偏宽容，档位越高越强，豪华档接近最强；好友房实盘一律最强。
- **单机**：娱乐局直接玩；实盘局从平台钱包带筹码上桌，打完结回。筹码无任何现金价值，不能买、不能兑换、不能转让。
- **好友房**：分享链接或房间号叫朋友，掉线托管、中途接管电脑、离座马上结回、打完"再来一场"。实盘好友房至少两个真人（一个人想玩实盘去单机）。
- **手感和画面**：听牌提示（剩几张只按看得见的牌算）、点两下或往上拖出牌、飞牌、胡牌亮牌和番型。
- **交流**：四川话短语、表情、扔道具、催促炸弹、屏蔽。
- **手机**：横屏竖屏都能玩，小到 iPhone SE。

设计和规则细节见 [DESIGN.md](DESIGN.md)，模块约定见 [AGENTS.md](AGENTS.md)，素材来源见 [ASSETS.md](ASSETS.md)，版本记录见 [CHANGELOG.md](CHANGELOG.md)。

## 本地开发

需要 Node 22（见 `.nvmrc`）。依赖共用包 `packages/arcade-kit`（`file:` 引用），在本仓库里直接 `npm ci` 就行。

```bash
npm ci
npm run dev          # http://localhost:5176/games/mahjong/（娱乐局直接能玩；平台接口转给 5181）
npm test             # 类型检查 + vitest（规则、电脑、架构约束、房间规则）+ workerd 里的 Worker 和房间测试
npm run build        # 页面
npm run sim 1500     # 模拟器：单机各场地普通玩家、新手的期望，各性格的打法指标（DESIGN.md 4.1）
node scripts/strength.ts 1200 0,2,3 5   # 一个性格对固定三家的强弱（轮换座位）
node scripts/stake-room.ts 1500 venues   # 好友房实盘桌：两个普通真人对电脑的期望（DESIGN.md 4.1）
npm run smoke        # 无头浏览器冒烟：单机横竖屏各一场
npm run build:cf && npm run smoke:room  # 好友房两个浏览器（本地 wrangler dev + 假平台）
npm run build:cf && npm run dev:worker  # 本地整套（Worker + 页面 + 假平台），端口由系统分配，打开它打印的地址；登录用 __Host-sid cookie（见 test/arcade.dev.ts）
node scripts/capture.ts se-port 40      # 截图到 shots/，并报互相压住的元素（land|port|se-land|se-port）
```

## 部署

正式部署由仓库的 `.github/workflows/game-mahjong.yml` 在 main 上经 PR 合并后自动完成，整体做法见仓库根 README 的部署一节。
本模块依赖共用包（`file:../../packages/arcade-kit`），共用包发布到 npm 之前不提供一键部署按钮。

本模块要的东西：

| 类型 | 名字 | 说明 |
|---|---|---|
| 路由 | `<站点>/games/mahjong`、`<站点>/games/mahjong/*` | 不写在 `wrangler.jsonc` 里，部署时用 `--route` 注入 |
| 服务绑定 | `ARCADE` → Worker `arcade` | 平台，认人（`/api/me`）；要先部署平台 |
| 服务绑定 | `WALLET` → `arcade` 的 `WalletService`，`props.game = "mahjong"` | 平台钱包（实盘带入、结回） |
| Durable Object | `ROOM`（`MahjongRoom`）、`METER`（`RoomMeter`） | 好友房、kit 的计量 |
| 变量 | `GATE` | `login`：首页要登录；`off`：不拦（只在本地试页面用） |
| 变量 | `KIT_QUOTA` | 每天的写入预算和开房名额（DESIGN.md 第 9 节） |
| 变量（可选） | `SITE_ORIGIN` | 同站校验认的 origin，比如 `https://<站点>`；不设就按请求自己的 origin |
| CI 的 secret | `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`SITE_HOST` | 放在 GitHub 环境 `production`；`SITE_HOST` 是站点主机名（不带协议），没设部署直接失败 |

手动部署（在本仓库里，先部署好平台；`SITE_HOST` 换成自己的站点主机名，Cloudflare 凭证用环境变量）：

```bash
cd games/mahjong
npm ci && npm run build:cf
npx wrangler deploy --route "$SITE_HOST/games/mahjong" --route "$SITE_HOST/games/mahjong/*" --var "SITE_ORIGIN:https://$SITE_HOST"
```

## 目录结构

| 目录 | 是什么 |
|---|---|
| `src/core/tiles`、`hand`、`table`、`match` | 通用层：牌、向听和听牌、牌桌小件、筹码账 |
| `src/core/variants/<id>/` | 玩法（`sichuan-xuezhan`）；`variants/index.ts` 登记 |
| `src/ai/` | 电脑（只拿视图）：`personas.ts` 性格，`style.ts` 这一场的状态和局面，`venues.ts` 场地 → 电脑 |
| `src/game/` | 档位和底分、单机推进、交流编号 |
| `src/room/` | 好友房的规则（kit 的 RoomGame：带入结回、座位换人、再来一场），房间和页面共用 |
| `src/net/` | 单机实盘的带入结回（经本模块 Worker 转平台钱包） |
| `src/main.ts`、`solo.ts`、`online.ts` | 页面入口、单机控制器、好友房连接 |
| `src/view/` | 牌桌（DOM + SVG），`view/variants/<id>/` 是玩法专属的界面（听牌提示、胡牌亮牌、结算） |
| `worker/` | 登录闸门、单机带入结回、开房进房、房间 DO（`room.ts`） |

## 许可证

MIT，见仓库根的 [LICENSE](../../LICENSE)。
