# 素材说明（平台）

平台自己用到的图片、字体、声音的来源。只用自己程序生成的，或许可明确可商用的素材（仓库根 AGENTS.md 第 4 节）。

## 大厅封面 `public/covers/<id>.webp`（16:9）

0.9.8 起统一 800×450：卡片最宽约 350 像素，手机 2 倍屏也够，三张合计从约 218 KB 降到约 135 KB。德州按这个尺寸从 SVG 直接渲染；开盘、掼蛋给的大图用 `npm run cover -- --shrink` 缩；麻将给的是 SVG，用 `npm run cover -- --from=<SVG> --id=mahjong` 光栅化。

| 封面 | 来源 |
|---|---|
| `texas.webp` | 本仓库程序生成（0.9.1，2026-10-15）：`tools/cover.ts` 画 SVG（人物、牌、筹码、牌桌都是代码里的几何图形），用无头 Chromium 光栅化成 800×450 的 webp。标题是 Noto Sans CJK SC Bold（SIL Open Font License 1.1，允许用在图片里）光栅化进图里，不随网页分发字体文件；换机器重新生成时字体不同，字形会略有差别。人物是德州单机里的电脑（稳哥、阿飙、老好、慢慢），不画真实的人、真实的牌桌或品牌。改图后 `npm run cover` 重新生成 |
| `mahjong.webp` | 麻将模块原创：麻将模块手写的 `games/mahjong/public/cover.svg`（麻将 0.1.0；麻将的素材说明 `ASSETS.md` 里写着"封面 `public/cover.svg`：手写的 SVG"，模块没有外部素材）。平台 0.10.13 在仓库根执行 `cd platform && npm run cover -- --from=../games/mahjong/public/cover.svg --id=mahjong`，用无头 Chromium 光栅化成 800×450 的 webp（2026-10-16，SVG 的 sha256 开头 af531170d032）。SVG 里的中文（"雀馆""一萬""川麻·血战到底"）用系统字体，本机光栅化时是 Noto Sans CJK SC（SIL Open Font License 1.1，允许用在图片里），不随网页分发字体文件。麻将改了封面就照这条命令重新生成 |
| `guandan.webp` | 掼蛋模块程序生成：掼蛋模块的 `tools/cover.ts` 从游戏里同一套原创 SVG 渲染（掼蛋 README 里有说明），转成 webp 放到这里 |
| `racing.webp` | 《飞驰》的贡献者自绘：游戏模块手写的 `games/racing/public/cover.svg`（MIT，随游戏模块一起提交），平台用 `npm run cover -- --from=<SVG> --id=racing` 光栅化成 800×450 webp（0.10.22） |
| `kaipan.webp` | 开盘原创：就是开盘标题页的主视觉 `title_keyart.svg` 按 960×540 渲染的（0.9.8 起缩到 800×450；2026-10-11 加入，当时没留生成记录，2026-10-15 开盘核对过）。来源和许可同开盘的其余素材：原创，无第三方素材或字体。详见开盘模块美术说明（`public/assets/art/README.md`）里的"大厅封面"一节（开盘旧仓库 PR 73） |

## 其他

- `public/favicon.svg`：SVG 源码直接写在仓库里（渐变和几何图形），没有外部来源。
- 界面不用外部字体、图标库和图片，图标都是文字符号或 CSS（CSP 也不放行外站资源，见 `docs/platform-backend.md` 5.2）。
