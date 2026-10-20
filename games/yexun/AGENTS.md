# 《夜巡》模块约定

> 总仓库规范见仓库根的 `AGENTS.md`，其中第 1、2 节的硬约束优先于本文件。本文件只写夜巡特有的约定。设计正本是 [DESIGN.md](DESIGN.md)。

## 1. 这是什么

幸存者类动作游戏：道士夜巡雪夜古镇，只管走位，法器自动出手，升级三选一、进化。两个模式：守夜（撑到天亮）、夜探（搜打撤）。
没有联机，没有电脑对手；排行榜走平台的简单版（不防作弊），录像只存在本机。玩法、内容、数值骨架、实盘、配平口径都在 [DESIGN.md](DESIGN.md)，这里不重复。

## 2. 目录

```
src/core/      模拟核心：固定节拍（每秒 30 拍）、确定性；state.ts（状态）、step.ts（一拍）、grid.ts（格子分区）、fmath.ts + dirs.ts（数学）、rng.ts、events.ts、fingerprint.ts
src/content/   内容表：法器 / 被动 / 进化（weapons）、怪（enemies、regions）、刷怪表和危险档（waves）、地图（maps）、角色 / 咒印 / 加成（meta）、玩家和掉落（player）、
               夜探（explore）、宝物（treasures）、成就（achievements）、实盘倍数（live）、玩法说明的流派单（guide）；改数值只改这里
src/explore/   夜探的规则：地图生成、宝箱、守卫、撤离、结算、机器人
src/meta/      成就和图鉴的累计统计（records.ts）
src/view/      画面层：art/（程序画的图集、地形、雪地）、game/（对局场景、输入、特效、空气墙）、audio/（合成音效和音乐）、ui/（DOM 界面：HUD、菜单、卡片、玩法说明）、viewport.ts（iOS 和多尺寸适配）
src/platform/  本地存档（save.ts）、云存档（cloud.ts）、实盘浏览器端（live.ts）
src/online/    排行榜分数、每日挑战、分享卡、社交部件
src/replay/    本机录像：格式、录制、回放、存储
worker/        Worker（登录闸门、单独部署的根路径、实盘带入结回、巡检用的 health），自己一份 tsconfig（workers-types）
tools/         shot.ts / smoke.ts（截图和冒烟）、sim.ts / sim-merge.ts / bots.ts（机器人配平）、bench.ts（核心耗时）、feel.ts（手感）、
               cover.ts（大厅封面）、subset-font.ts（毛笔字子集）、gen-dirs.ts（方向表）
tests/         vitest
```

## 3. 规则核心的约束

- `src/core`、`src/content` 不依赖 DOM、Phaser、网络；画面层只读核心的状态和事件，不自己算规则。
- **确定性**：禁止 `Math.random`、`Date`、`performance`，以及 `Math.sin/cos/tan/atan2/sqrt/hypot/exp/log/pow/cbrt`；
  浮点只用四则运算（IEEE 754 在所有引擎上逐位一致），方向用写死在源码里的单位向量表，开方用固定迭代的牛顿法；
  随机用自己的 sfc32，按用途分流。架构测试扫源码锁住。
- **主线批准的例外**：`step` 原地修改它拥有的状态（几百个单位每秒 30 拍，整体复制太慢），不是"输入旧状态、输出新状态"。
  存档和回放靠"种子 + 输入"重算；确定性由重放测试（状态指纹逐拍相同）锁住。
- 改数值必须跑模拟器（DESIGN.md 第 8 节、8.1 配平口径），不凭感觉。
- 规则一改，`tests/core.test.ts` 的金标准指纹就会变：确认是有意的改动后用 `npx vitest run -u` 更新，同时把 `RULES_VERSION` 加一（旧录像会标"旧版本"）。

## 4. 画面

- 所有图都是程序画的（`src/view/art/`），开局画进图集，每张 ≤ 2048：主图集、夜探图集、特色怪图集（含纸兵）、角色图集共四张；加图前先算主图集在渲染倍数 3 时的高度（0.4.2 的纸兵就因此超 2048 打不开）；不放图片文件。
- 雪地很亮：特效用饱和色 + 深色边、普通混合，ADD 叠加只用在暗处（亮的雪地上叠加的斩痕几乎看不见）。
- iOS：渲染倍数封顶 2（`viewport.ts`）、`--app-h` 按看得见的区域、双指放大时不改尺寸、safe-area；省内存设备（`?lowmem` 可模拟）关粒子。
- 可点的东西 ≥ 44×44 CSS 像素，`tools/shot.ts` 检查；字不小于 12 像素。改界面按 [docs/art-v3.md](docs/art-v3.md) 的布局规则，改完要在手机竖横屏、平板、电脑各尺寸看过（0.4.3 做过 26 个尺寸的矩阵检查：手机竖横、平板、折叠屏、电脑）。
- DOM 界面的类名按屏加前缀（菜单 `yx-m*`，对局的限定在 `.yx-hud` 下），新增样式都限定在所属根节点下，自定义属性带兜底值（`var(--s, 1)`）。类名串到别的界面带着问题上线过（0.3.0 菜单地图卡的 `.yx-card` 串到对局头像血条上）。
- 截图验收至少有一张不开 `auto` 的真实对局（`--flow`，或 `--query "raid=guzhen"`）：`auto` 局没有新手提示等，看不出真人局的问题。

## 5. 常用命令（都在本目录运行）

| 命令 | 用途 |
|---|---|
| `npm ci` | 安装依赖 |
| `npm run dev` / `npm run preview` | 开发 0.0.0.0:5178 / 预览 0.0.0.0:4178 |
| `npm test` | 类型检查（页面 + Worker）+ vitest |
| `npm run build:cf` | 部署用构建到 `dist-cf/games/yexun/` |
| `npm run sim -- --n 200 --danger 2 --skill novice,normal --build sword,talisman,ward,wood,fire,paper` | 机器人模拟，出胜率和节奏表（`--map` 选地图或夜探镇子，`--mode raid` 跑夜探，`--char` 选角色，`--nodual` 双修对照臂）；`tests/pace.test.ts` 是 13.3 的节奏验收 |
| `node tools/sim.ts ... --from 500 --json 片.json`、`node tools/sim-merge.ts <目录> [--json 合并.json]` | 一格拆成几片（`--from` 错开种子）分到 GitHub runner 上跑，下载后按格拼表（全量确认用；片不连续会报错） |
| `npm run bench -- <种子> <难度>`、`npm run bench -- --worst` | 核心每拍耗时：整局 / 300 怪满额的最坏拍 |
| `npm run shot -- --out <目录>` | 冒烟截图（临时端口，不占 5178/4178）；`--frames N`、`--video`、`--lowmem`；`--query "auto&warp=9000"` 机器人代打并快进到第 9000 拍，`--query "warp=2700&choose"` 停在选卡上，`--query "auto&give=mirror:8,crane:8e&merge"` 开局换成这几件法器（带 e 直接进化，&merge 当场合成），`&map=yizhuang` 换义庄，`--tag` 加文件名前缀；`--pause` 停在暂停面板上；`--flow` 走一遍主页 → 选模式屏 → 开打 → 暂停 → 认输 → 结算 → 分享预览 → 菜单 → 设置，每屏截图并检查；每次打印帧率和场景脚本耗时；`--cpu 4` 按 4 倍 CPU 降速、`--view phone` 只跑一种视口（逗号分隔可点几个；默认 `desktop`、`phone`，手机竖屏 `phonep`、1920 大屏 `wide` 只在点名时跑） |
| 页面加 `?fps` | 左下角显示每秒帧数、最长一帧、场上怪数（真机验收用，不写存储） |
| `node tools/feel.ts` | 手感测量：固定帧间隔（60 / 120Hz，和机器负载无关）走一段"走—停—转向"，逐帧记主角屏幕坐标和镜头，报匀速段抖动、起停突变、回跳 |
| `npm run smoke` | 仓库硬规范的冒烟（临时端口）：主流程零报错、`?lowmem`、双指放大布局不变、WebGL 上下文丢失 / 恢复提示、对局中点回大厅先确认、手机竖屏菜单点回大厅、对局 HUD 各块在手机横竖屏互不相交（第 7 段）；任一失败退出码 1；`-- --only 5,6` 只跑其中几段 |

## 6. 浏览器存储 key（全部 `yexun.` 前缀）

在用：
- `yexun.settings`（音效、音乐、震屏、固定摇杆等开关；`src/platform/save.ts`、`src/view/audio/sfx.ts`）；
- `yexun.save`（局数、最好成绩、引导进度、铜钱流水、加成、解锁、危险档、角色、咒印、藏宝阁；`src/platform/save.ts`）；
- `yexun.records`（成就和图鉴的累计统计，`src/meta/records.ts`）；
- `yexun.cloud`（云存档元数据）、`yexun.profile.pre-sync`（合并前的本机备份）、`yexun.profile.pre-switch.<userId>`（换账号时另存的旧账号存档，换回去以后改名 `.restored`）（`src/platform/cloud.ts`，`profile` 是云存档的槽名）；
- `yexun.live`（实盘这一份的进度：带入、撑到第几拍、结回，刷新、断网后接着结；`src/platform/live.ts`）；
- `yexun.replays`（本机录像：最近几局和每个榜最好的一局，总量有上限；`src/replay/store.ts`）。

新增 key 必须带前缀并补进这张表。

## 7. 发布

本目录 `npm test`、`npm run build:cf` 全过，跑 `npm run smoke`，再跑 `npm run shot` 并逐张看截图；每个要部署的 PR 都升一次版本（`package.json` 和 lockfile），`CHANGELOG.md` 写成带日期的版本段，不攒"未发布"段（合并即部署，版本要能对上线上）；改了规则就把 `RULES_VERSION` 加一；
提交信息以 `yexun:` 开头，只暂存明确路径；推 `yexun/<说明>` 分支开 PR。合并和部署由维护者做。
