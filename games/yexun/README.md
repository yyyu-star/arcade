# 夜巡 · Night Patrol (games/yexun)

A survivors-like action game: a young Taoist patrols a snowy old town at night. You only steer; talismans, peach-wood swords and thunder charms fire on their own.
Level up, pick one of three upgrades, evolve your gear, and survive the hopping-corpse hordes until dawn (**Vigil**), or sneak into the town, loot chests and
get out while a gate is open (**Night Raid**, extraction mode). Built with TypeScript, Phaser 4 and a deterministic fixed-tick simulation; every sprite and sound is generated in code.
It is one module of the Arcade monorepo, but deploys on its own too. Chips are play money only — they cannot be bought, cashed out or transferred. Docs below are in Chinese. MIT licensed.

《夜巡》：道士夜巡雪夜古镇。只管走位，法器自动出手，升级三选一、法器进化，成群的跳尸纸人扑上来。
**守夜**撑到天亮，**夜探**进镇搜宝、趁撤离门开着撤出去。

已上线可玩：6 张守夜地图、3 个夜探镇子加教学镇、13 件法器和 6 个流派、6 个角色、危险 0–5 六档、咒印、局外成长、成就图鉴、
每日挑战和排行榜、本机录像回放、游戏内的玩法说明；接了平台的钱包就能开实盘（守夜四档、夜探三档）。

## 文档

- [DESIGN.md](DESIGN.md)：设计正本（玩法、内容、实盘、架构、配平口径、验收标准）
- [AGENTS.md](AGENTS.md)：给开发者和代理的模块约定（目录、命令、存储 key、发布）
- [ASSETS.md](ASSETS.md)：素材来源和许可
- [docs/palette.md](docs/palette.md)：界面配色；[docs/art-v3.md](docs/art-v3.md)：界面流程和各尺寸布局规则
- [CHANGELOG.md](CHANGELOG.md)：版本记录

## 本地开发

需要 Node 22（见 `.nvmrc`）。共用包从 npm 装（见 `package.json` 里的 `arcade-kit` 别名），直接 `npm ci` 就行。

| 命令 | 用途 |
|---|---|
| `npm run dev` / `npm run preview` | 开发 0.0.0.0:5178 / 预览 0.0.0.0:4178 |
| `npm test` | 类型检查（页面和 Worker 两份）+ vitest |
| `npm run build` / `npm run build:cf` | 构建 / 部署用的构建（产物在 `dist-cf/games/yexun/`） |
| `npm run smoke` | 仓库硬规范的冒烟（主流程零报错、省内存设备、双指放大、WebGL 丢失恢复、回大厅） |
| `npm run shot -- --out <目录>` | 无头浏览器截图并检查按钮 ≥ 44 像素、控制台零报错；`--flow` 走一遍全部界面 |
| `npm run sim -- --n 200 --danger 2 --build sword` | 机器人模拟，出胜率和节奏表（配平用） |
| `npm run bench -- --worst` | 规则核心满载每拍耗时 |
| `node tools/subset-font.ts <字体 ttf>` | 重新生成毛笔字子集（见 ASSETS.md） |

截图和冒烟要 `playwright-core` 和 chromium-headless-shell（`npx playwright-core install chromium-headless-shell`），系统要有中文字体。更多选项见 AGENTS.md 第 5 节。

## 目录

```
src/core/      确定性模拟核心（每秒 30 拍，不碰 DOM、网络、时间、随机）
src/content/   内容表：法器、怪、地图、角色、实盘倍数；改数值只改这里
src/explore/   夜探的规则（地图生成、宝箱、守卫、撤离、结算）
src/view/      Phaser 画面层 + DOM 界面 + 程序合成的图和声音
src/platform/  本地存档、云存档、实盘的浏览器端
src/online/    排行榜、每日挑战、分享、社交部件
src/replay/    本机录像
worker/        Worker：登录闸门、实盘带入结回
tools/         冒烟、截图、模拟器、机器人、封面、字体子集
tests/         vitest
```

## 单独部署这个游戏

`wrangler.jsonc` 是独立配置：`npm ci && npx wrangler login && npm run deploy`，得到 `yexun.<你的子域>.workers.dev`，打开 `/` 会转到 `/games/yexun/`。
单独部署时没有登录、云存档、排行榜和实盘，单机娱乐照常（仓库根 `docs/new-game.md` 第 7 节）。
