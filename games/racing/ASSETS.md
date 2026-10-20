# 素材说明

本模块没有外部素材、第三方图片和字体，全部由本模块的代码生成：

| 素材 | 来源 |
|---|---|
| 纹理 `public/art/*.webp`（木桌面 wood、卡纸 paper，地图板的纸纹 grain 和斑驳 mottle） | `scripts/art.ts` 写的 SVG（分形噪声 `feTurbulence`），用无头浏览器光栅化成能无缝平铺的 webp；噪声种子写死，重新跑生成的一样。`node scripts/art.ts` 重新生成 |
| 地图板（边框、地面、赛道、缓冲区、维修区、林子、看台、湖和亭、山和塔、街坊、海港和船）、标注（限速盾牌、弯名、格号、制动牌） | `src/view/mapart.ts`、`src/view/scenes.ts` 运行时画的 SVG；开局在浏览器里烘焙成一张位图（`src/view/board.ts`） |
| 棋子 | `src/view/piece.ts` 画的塑料小车，按座位配色，车顶写座位号 |
| 卡面（速度牌、改装牌、热量、手抖、牌背）和火焰图标 | `src/view/cards.ts` 运行时画的 SVG：速度表、线描的引擎、火焰、轮胎拖痕都是手写的路径，卡纸用上面的纹理；数字用系统字体 |
| 玩家板（挡位盘、引擎热量、牌堆） | `src/view/dash.ts` 画的 SVG 和 CSS |
| 新手教程的教练阿驰的头像（平常、大笑、哎哟三个表情） | `src/view/coachart.ts` 运行时画的 SVG：红色半盔、铜框风镜、八字胡都是手写的路径，色板和线宽取自 `mapkit.ts`；设定图 `shots/coach-sheet.png` |
| 封面 `public/cover.svg` | 手写的 SVG |
| 音效 | WebAudio 现合成（`src/view/sound.ts`） |
| 表情包、扔的道具 | `arcade-kit/fun`（kit 自己程序画的，见 kit 的说明） |

赛道、弯名、名字、术语、卡面、规则文字都是原创的，地名是虚构的。
