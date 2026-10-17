# 《夜巡》模块约定

> 总仓库规范见仓库根的 `AGENTS.md`，其中第 1、2 节的硬约束优先于本文件。本文件只写夜巡特有的约定。设计正本是 [DESIGN.md](DESIGN.md)。

## 1. 这是什么

幸存者类动作游戏：道士夜巡雪夜古镇，只管走位，法器自动出手，升级三选一、进化。两个模式：守夜（撑到天亮）、夜探（搜打撤）。
没有联机，没有电脑对手；排行榜走平台的简单版（不防作弊），录像只存在本机。

## 2. 目录

```
src/core/      模拟核心：固定节拍（每秒 30 拍）、确定性；state.ts（状态）、step.ts（一拍）、grid.ts（格子分区）、fmath.ts + dirs.ts（数学）、rng.ts、events.ts、fingerprint.ts
src/content/   内容表：法器、被动、进化、怪物、刷怪表、角色、地图、实盘倍数；改数值只改这里
src/view/      画面层：art/（程序画的图集和雪地）、game/（对局场景、输入、特效）、audio/（合成音效和音乐）、ui/（DOM 界面：HUD、菜单、卡片）、viewport.ts（iOS 适配）
src/platform/  本地存储（save.ts）、云存档、平台接口
worker/        Worker（登录闸门、单独部署的根路径；第 5 步加实盘带入结回），自己一份 tsconfig（workers-types）
tools/         shot.ts（冒烟截图）、subset-font.ts（毛笔字子集）、gen-dirs.ts（生成方向表）、bots.ts + sim.ts（机器人配平）、bench.ts（核心耗时）
tests/         vitest
```

## 3. 规则核心的约束

- `src/core`、`src/content` 不依赖 DOM、Phaser、网络；画面层只读核心的状态和事件，不自己算规则。
- **确定性**：禁止 `Math.random`、`Date`、`performance`，以及 `Math.sin/cos/tan/atan2/sqrt/hypot/exp/log/pow/cbrt`；
  浮点只用四则运算（IEEE 754 在所有引擎上逐位一致），方向用写死在源码里的单位向量表，开方用固定迭代的牛顿法；
  随机用自己的 sfc32，按用途分流。架构测试扫源码锁住。
- **主线批准的例外**：`step` 原地修改它拥有的状态（几百个单位每秒 30 拍，整体复制太慢），不是"输入旧状态、输出新状态"。
  存档和回放靠"种子 + 输入"重算；确定性由重放测试（状态指纹逐拍相同）锁住。
- 改数值必须跑模拟器（DESIGN.md 第 8 节），不凭感觉。
- 规则一改，`tests/core.test.ts` 的金标准指纹就会变：确认是有意的改动后用 `npx vitest run -u` 更新，同时把 `RULES_VERSION` 加一（旧录像会标"旧版本"）。

## 4. 画面

- 所有图都是程序画的（`src/view/art/`），开局画进一张 ≤ 2048 的图集；不放图片文件。
- 雪地很亮：特效用饱和色 + 深色边、普通混合，ADD 叠加只用在暗处（样图第一版 ADD 的斩痕在雪地上几乎看不见）。
- iOS：渲染倍数封顶 2（`viewport.ts`）、`--app-h` 按看得见的区域、双指放大时不改尺寸、safe-area；省内存设备（`?lowmem` 可模拟）关粒子。
- 可点的东西 ≥ 44×44 CSS 像素，`tools/shot.ts` 检查。

## 5. 常用命令（都在本目录运行）

| 命令 | 用途 |
|---|---|
| `npm ci` | 安装依赖 |
| `npm run dev` / `npm run preview` | 开发 0.0.0.0:5178 / 预览 0.0.0.0:4178 |
| `npm test` | 类型检查（页面 + Worker）+ vitest |
| `npm run build:cf` | 部署用构建到 `dist-cf/games/yexun/` |
| `npm run sim -- --n 200 --diff normal --skill novice,normal --build sword,talisman,ward,wood,fire` | 机器人模拟，出胜率和节奏表（`--map yizhuang` 跑义庄）；`tests/pace.test.ts` 是 13.3 的节奏验收 |
| `npm run bench -- <种子> <难度>` | 核心每拍耗时 |
| `npm run shot -- --out <目录>` | 冒烟截图（临时端口，不占 5178/4178）；`--frames N`、`--video`、`--lowmem`；`--query "auto&warp=9000"` 机器人代打并快进到第 9000 拍，`--query "warp=2700&choose"` 停在选卡上，`--query "auto&give=mirror:8,crane:8e&merge"` 开局换成这几件法器（带 e 直接进化，&merge 当场合成），`&map=yizhuang` 换义庄，`--tag` 加文件名前缀；`--pause` 停在暂停面板上；`--flow` 走一遍菜单 → 开打 → 暂停 → 认输 → 结算 → 菜单 → 设置，每屏截图并检查；每次打印帧率和场景脚本耗时 |
| `npm run smoke` | 仓库硬规范的冒烟（临时端口）：主流程零报错、`?lowmem`、双指放大布局不变、WebGL 上下文丢失 / 恢复提示、对局中点回大厅先确认；任一失败退出码 1 |

## 6. 浏览器存储 key（全部 `yexun.` 前缀）

在用：
- `yexun.settings`（音效、音乐、震屏、固定摇杆开关；0.0.3 起）；
- `yexun.save`（局数、最好成绩、引导进度，第 5 步起加铜钱流水、加成、解锁、危险档、角色、咒印；`src/platform/save.ts`）；
- `yexun.records`（成就和图鉴的累计统计，`src/meta/records.ts`）；
- `yexun.cloud`（云存档元数据）、`yexun.profile.pre-sync`（合并前的本机备份）、`yexun.profile.pre-switch.<userId>`（换账号时另存的旧账号存档，并回去以后改名 `.restored`）（`src/platform/cloud.ts`）；
- `yexun.live`（实盘这一份的进度：带入、撑到第几拍、结回，刷新、断网后接着结；`src/platform/live.ts`）；
- `yexun.replays`（本机录像：最近几局和每个榜最好的一局，总量有上限；`src/replay/store.ts`）。

新增 key 必须带前缀并补进这张表。

## 7. 发布

本目录 `npm test`、`npm run build:cf` 全过，跑 `npm run shot` 并逐张看截图；更新 `package.json` 版本和 `CHANGELOG.md`；
提交信息以 `yexun:` 开头，只暂存明确路径；推 `yexun/<说明>` 分支开 PR。合并和部署由维护者做。
