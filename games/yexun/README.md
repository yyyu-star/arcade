# 夜巡 · Night Patrol (games/yexun)

A survivors-like action game: a young Taoist patrols a snowy old town at night. You only steer; talismans, peach-wood swords and thunder charms fire on their own.
Level up, pick one of three upgrades, evolve your gear, and survive the hopping-corpse hordes until dawn (**Vigil**), or sneak into the town, loot chests and
get out while a gate is open (**Night Raid**, extraction mode). Built with TypeScript, Phaser 4 and a deterministic fixed-tick simulation; every sprite and sound is generated in code.
It is one module of the Arcade monorepo, but deploys on its own too. Chips are play money only — they cannot be bought, cashed out or transferred. Docs below are in Chinese. MIT licensed.

《夜巡》：道士夜巡雪夜古镇。只管走位，法器自动出手，升级三选一、法器进化，成群的跳尸纸人扑上来；
**守夜**撑到天亮，**夜探**进镇搜宝、趁撤离门开着撤出去。

> 现在是第 1 步（设计稿 + 画风样图），还不能玩。玩法、内容、实盘、架构和验收见 [DESIGN.md](DESIGN.md)，模块约定见 [AGENTS.md](AGENTS.md)，素材来源见 [ASSETS.md](ASSETS.md)，版本记录见 [CHANGELOG.md](CHANGELOG.md)。

## 本地开发

需要 Node 22（见 `.nvmrc`）。共用包从 npm 装（`"arcade-kit": "npm:@yyyu-star/arcade-kit@^0.11.2"`），直接 `npm ci` 就行。

| 命令 | 用途 |
|---|---|
| `npm run dev` / `npm run preview` | 开发 0.0.0.0:5178 / 预览 0.0.0.0:4178 |
| `npm test` | 类型检查（页面和 Worker 两份）+ vitest |
| `npm run build` / `npm run build:cf` | 构建 / 部署用的构建（产物在 `dist-cf/games/yexun/`） |
| `npm run shot -- --out <目录> [--frames N] [--video] [--lowmem]` | 无头浏览器冒烟：电脑横屏、手机横屏截图，检查按钮 ≥ 44 像素、控制台零报错 |
| `node tools/subset-font.ts <字体 ttf>` | 重新生成毛笔字子集（见 ASSETS.md） |

截图要 `playwright-core` 和 chromium-headless-shell（`npx playwright-core install chromium-headless-shell`），系统要有中文字体。

## 单独部署这个游戏

`wrangler.jsonc` 是独立配置：`npm ci && npx wrangler login && npm run deploy`，得到 `yexun.<你的子域>.workers.dev`，打开 `/` 会转到 `/games/yexun/`。
单独部署时没有登录、云存档、排行榜和实盘，单机娱乐照常（仓库根 `docs/new-game.md` 第 7 节）。
