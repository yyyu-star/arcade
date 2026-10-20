# 素材说明（平台）

平台自己用到的图片、字体、声音的来源。只用自己程序生成的，或许可明确可商用的素材（仓库根 AGENTS.md 第 4 节）。

## 大厅封面 `public/covers/<id>.webp`（16:9）

统一 800×450：卡片最宽约 350 像素，手机 2 倍屏也够。德州按这个尺寸从 SVG 直接渲染；开盘、掼蛋给的大图用 `npm run cover -- --shrink` 缩；麻将、牌馆、弹里个弹的 SVG 源文件在 `tools/covers/`，用 `npm run cover -- --from=<SVG> --id=<游戏>` 光栅化。

| 封面 | 来源 |
|---|---|
| `texas.webp` | 本仓库程序生成：`tools/cover.ts` 画 SVG（人物、牌、筹码、牌桌都是代码里的几何图形），用无头 Chromium 光栅化成 800×450 的 webp。标题是 Noto Sans CJK SC Bold（SIL Open Font License 1.1，允许用在图片里）光栅化进图里，不随网页分发字体文件；换机器重新生成时字体不同，字形会略有差别。人物是德州单机里的电脑（稳哥、阿飙、老好、慢慢），不画真实的人、真实的牌桌或品牌。改图后 `npm run cover` 重新生成 |
| `mahjong.webp` | 麻将模块原创：照抄麻将模块手写的 `games/mahjong/public/cover.svg`（麻将的素材说明里写着手写的 SVG，没有外部素材），平台只把副标题换成"血战到底 · 立直"，存成 `tools/covers/mahjong.svg`；在 platform 目录执行 `npm run cover -- --from=tools/covers/mahjong.svg --id=mahjong`，用无头 Chromium 光栅化成 800×450 的 webp。SVG 里的中文（"雀馆""一萬""血战到底 · 立直"）用系统字体，本机光栅化时是 Noto Sans CJK SC（SIL Open Font License 1.1，允许用在图片里），不随网页分发字体文件。麻将改了封面就重新抄一份、照这条命令生成 |
| `guandan.webp` | 牌馆：底图是掼蛋模块程序生成的封面（掼蛋 `tools/cover.ts` 从游戏里同一套原创 SVG 渲染，掼蛋 README 里有说明），平台在 `tools/covers/guandan.svg` 里把它当底图嵌进去，右边换成手写 SVG 画的招牌（"牌馆"，副标题"掼蛋 · 斗地主"）、一摞牌、两张牌和一顶写着"地主"的瓜皮帽，没有外部素材；在 platform 目录执行 `npm run cover -- --from=tools/covers/guandan.svg --id=guandan` 光栅化成 800×450 的 webp。中文用系统字体（同上，Noto Sans CJK SC），不随网页分发 |
| `danli.webp` | 平台手写的 SVG（`tools/covers/danli.svg`），照《弹里个弹》的画风画：绘本纸边、厨房瓷砖和窗户、面团地形、柴犬和橘猫"橘子"、包子、锅盖、纸飞机、风旗，没有外部素材；在 platform 目录执行 `npm run cover -- --from=tools/covers/danli.svg --id=danli` 光栅化成 800×450 的 webp。中文用系统字体（同上，Noto Sans CJK SC），不随网页分发 |
| `racing.webp` | 《飞驰》的贡献者自绘：游戏模块手写的 `games/racing/public/cover.svg`（MIT，随游戏模块一起提交），平台用 `npm run cover -- --from=<SVG> --id=racing` 光栅化成 800×450 webp |
| `yexun.webp` | 夜巡模块程序生成，来源见夜巡 `ASSETS.md`：`games/yexun/public/cover.webp`（夜巡 `tools/cover.ts` 生成，800×450；字体马善政楷书，SIL Open Font License 1.1），平台原样复制。夜巡改了封面就重新复制 |
| `kaipan.webp` | 开盘原创：就是开盘标题页的主视觉 `title_keyart.svg` 按 960×540 渲染、再缩到 800×450。来源和许可同开盘的其余素材：原创，无第三方素材或字体。详见开盘模块美术说明（`public/assets/art/README.md`）里的"大厅封面"一节 |

## 其他

- `public/favicon.svg`：手写的 SVG（和大厅标志同一台小街机），没有外部来源。
- `public/bg.svg`：页面底色上很淡的小图案（星星、圆圈、加号、三角），手写的 SVG，不到 1 KB。
- `src/icons.tsx`：界面里的图标和小插画都是手写的 SVG，写在代码里：金币、两个人、奖杯、盾牌、钥匙、一个人、锁、喇叭、大厅标志（小街机）、空列表的小插画（打哈欠的游戏票）。
  排行榜前三名的奖牌是 CSS 渐变。
- 界面不用外部字体、图标库和图片（CSP 也不放行外站资源，见 `docs/platform-backend.md` 5.2）。
