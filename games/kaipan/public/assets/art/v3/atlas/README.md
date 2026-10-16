# v3 小件图集（atlas）

本目录由 `tools/art/bake.ts` 生成，**不要手改** `game.json`、`meta.json` 与 `game-N.webp`、`meta-N.webp`（本 README 除外）。
它把 `public/assets/art/v3/` 下的小件 SVG 按 2× 栅格化、裁透明边、装箱成 Phaser 可直接
`load.multiatlas` 的多页图集，用少量 JSON + WebP 页图代替几百个 SVG 请求。

分两套图集，按需加载：

| 图集 | 文件 | 内容 | 何时加载 |
|---|---|---|---|
| game | `game.json` + `game-0.webp`、`game-1.webp`… | 股票表情与眨眼（`stocks/`）、道具（`items/`）、群友头像（`avatars/`，含新手提示猫 `cat_hint`）、`fx/`、`themes/`、`chat/`、对局用 `ui/`（账单、印章、持仓卡、按钮、纸面板、角色徽章、风口状态 `stage_*`、收盘新闻 `news`、收盘小结纸 `recap_paper` 等） | 首屏 / 进对局 |
| meta | `meta.json` + `meta-0.webp`… | 人设立绘（`personas/`）、难度徽记（`difficulty/`）、成就框与图标（`achievements/`）、说明书插图（`guide/`）、`ui/codex_*`、`ui/progress_*`、`ui/rotate_phone` | 进人设 / 难度选择、图鉴、成就、说明书、横屏提示等界面时 |

分组规则（`bake.ts` 的 `META` 正则）：frame 名以 `personas/`、`difficulty/`、`achievements/`、`guide/` 开头，或是
`ui/codex_*`、`ui/progress_*`、`ui/rotate_phone` 的归 meta，**其余全部归 game**。以后新增素材默认进 game；
要放进 meta 就在 `META` 里加一条规则。

- `game.json` / `meta.json`：Phaser JSON Array 多图集格式（TexturePacker multipack 同构），各自的 `meta.group`
  标明组名，页数与帧数见 `meta.pages` / `meta.frames`。
- 页图（WebP 近无损；`--png` 时为 `.png`）：每页不超过 2048×2048，最后一页收缩到实际用到的尺寸。
- frame 名在两套之间不重复，和分组前完全相同（只是分到了两个 json 里）。

## 纳入与排除

| 纳入 | 说明 |
|---|---|
| `stocks/<id>/*.svg` | 每只股票目录下的顶层合成图（calm、happy、limitup、worried、limitdown、delisted、blink…），**不含** `stocks/<id>/parts/**` |
| `items/`、`avatars/`、`achievements/`、`difficulty/`、`personas/`、`guide/`、`ui/`、`fx/`、`themes/`、`chat/` | 目录下（含子目录）全部 `*.svg`；目录不存在就跳过 |

不纳入：`scene/**`（大背景保持单独文件，含标题主视觉 `scene/title_keyart.svg`）、`chat/phone_frame.svg`（2× 后单张 720×1440，放进来会多出一页，保持单独文件）、`atlas/**`，以及上表之外的任何目录。输入按目录扫描，新增 SVG 后重新烘焙即可，
不需要改脚本。`node tools/art/bake.ts --list` 可列出当前会纳入的文件。

## frame 命名

frame 名 = 相对 `v3/` 的路径去掉 `.svg`，画面层依赖这个规则，**不再改动**：

| SVG | frame |
|---|---|
| `stocks/ai_leader/calm.svg` | `stocks/ai_leader/calm` |
| `stocks/ai_leader/blink.svg` | `stocks/ai_leader/blink` |
| `items/longtou.svg` | `items/longtou` |
| `avatars/xiaoli_normal.svg` | `avatars/xiaoli_normal` |
| `achievements/frame_gold.svg` | `achievements/frame_gold` |
| `difficulty/3.svg` | `difficulty/3` |
| `personas/newbie_locked.svg` | `personas/newbie_locked` |
| `ui/codex_card.svg` | `ui/codex_card` |
| `fx/flame.svg` | `fx/flame` |
| `themes/ai.svg` | `themes/ai` |
| `chat/bubble_left.svg` | `chat/bubble_left` |

## 每帧字段

```json
{"filename":"stocks/ai_leader/calm","frame":{"x":211,"y":1,"w":198,"h":240},"rotated":false,"trimmed":true,
 "spriteSourceSize":{"x":29,"y":3,"w":198,"h":240},"sourceSize":{"w":256,"h":256},"display":{"w":128,"h":128}}
```

（坐标仅为示例，每次烘焙可能不同。）

- `frame`：帧在页内的像素区域（2× 像素，裁边后）。
- `sourceSize`：原画布的 2× 像素尺寸；`spriteSourceSize`：裁边后内容在原画布里的位置。Phaser 据此还原，
  `image.width/height` 等于 `sourceSize`，原点（默认 0.5）按整幅原画布计算，所以同一只股票的各表情
  （含 blink）叠放时严格对齐，和直接加载 SVG 一样。
- `display`：SVG 原生尺寸（根元素 width/height，即设计时的显示尺寸）。自定义字段，Phaser 会把整条帧数据
  拷到 `frame.customData`，运行时用 `frame.customData.display` 读取。
- `ui/`、`chat/` 两个目录**不裁边**（`trimmed: false`），因为它们是九宫格 / 平铺素材，Phaser 的 NineSlice
  不支持 trimmed 帧。
- 每页条目的 `scale: 2` 会进 `texture.customData.scale`；json 顶层 `meta`（生成脚本、倍率、帧数、
  页数等）只在 JSON 文件里，Phaser 不保留。

## 在 Phaser 里加载

```ts
// 第三个参数 path 是页图（game-N.webp）URL 的前缀目录：页图 URL = baseURL + path + textures[i].image。
// 不传时用 loader 当前的 path（不会相对 json 所在目录解析），所以要显式传。
this.load.multiatlas('game', 'assets/art/v3/atlas/game.json', 'assets/art/v3/atlas/');
// 进图鉴 / 成就 / 人设与难度选择时再载：
this.load.multiatlas('meta', 'assets/art/v3/atlas/meta.json', 'assets/art/v3/atlas/');
```

同一套图集的所有帧在同一个纹理 key 下，跨页无感：`this.add.image(x, y, 'game', 'stocks/ai_leader/calm')`、
`this.add.image(x, y, 'meta', 'personas/newbie')`。`this.textures.exists('meta')` 只说明图集已加载，某帧是否存在用
`this.textures.get('meta').has(name)`。下文示例里的 `'game'` 换成该帧所在图集的 key 即可。

## 显示尺寸

图集按 2× 烘焙，帧的纹理尺寸是设计尺寸的 2 倍。显示时按设计尺寸缩回：

```ts
const img = this.add.image(x, y, 'game', 'stocks/ai_leader/calm');
const d = img.frame.customData.display as { w: number; h: number };
img.setDisplaySize(d.w, d.h);           // 设计尺寸（128×128）
img.setDisplaySize(64, 64);             // 或直接给世界尺寸（卡片里的小人）
img.setScale(0.5);                      // 等价于按 display 显示：1 / 烘焙倍率
```

烘焙倍率固定 2，与运行时 `RENDER_SCALE`（1–3）无关：用 `setDisplaySize` 按世界尺寸显示即可；
`RENDER_SCALE = 3` 时会有轻微放大。

### 九宫格（NineSlice）

Phaser 4 的 NineSlice 可以直接用图集帧。和单独加载 2× 纹理时一样，在纹理像素空间切片后整体缩回：

```ts
const s = 2; // 烘焙倍率
this.add.nineslice(x, y, 'game', 'ui/panel_paper', w * s, h * s, l * s, r * s, t * s, b * s)
  .setOrigin(0, 0)
  .setScale(1 / s);
```

注意切片边距要乘**烘焙倍率 2**，不是 `RENDER_SCALE`。

### 平铺（TileSprite）

```ts
this.add.tileSprite(x, y, w * 2, h * 2, 'game', 'chat/chat_bg_tile').setOrigin(0, 0).setScale(0.5);
```

## 重新烘焙

```bash
node tools/art/bake.ts            # 全量烘焙，只重写内容有变化的文件
node tools/art/bake.ts --check    # 只比较不写盘（按像素哈希），有变化时退出码 1
node tools/art/bake.ts --list     # 只列出会纳入的 SVG 与 frame 名
node tools/art/bake.ts --jobs 4   # 并行渲染页数（默认 min(4, CPU 数)）
node tools/art/bake.ts --png      # 改输出 PNG（RGB 量化到 6 bit）
node tools/art/bake.ts --png --lossless # 无损 PNG
```

新增或修改 SVG（例如重新跑 `tools/art/build.ts`）之后执行一次。脚本用开发依赖 playwright-core 的 Chromium
离线渲染（不连网、不起服务）。

## 实现要点

- **2× 重新栅格化**：把根 `<svg>` 的 width/height 改写成原生 × 2（保留 viewBox）后，以 data URL 画进
  canvas，矢量和 feTurbulence 颗粒滤镜都按 2× 重新计算，不是位图放大。烘焙后运行时不再跑 SVG 滤镜。
- **裁边**：按 alpha > 0 求包围盒。
- **间隔**：每帧四周留 1px（贴着原画布边缘的一侧外扩边缘像素，被裁掉的一侧保持透明），相邻帧之间再空 2px
  透明，线性过滤不会串色。
- **装箱**：MaxRects（Best Short Side Fit），按尺寸降序、名字升序的固定顺序放入，不旋转。
- **WebP（默认）**：整页用 Chromium canvas `toDataURL('image/webp', 1)` 编码，近无损（canvas 预乘带来的预乘
  RGB 误差 ≤ 1.3/255，alpha 无误差），比 6 bit 量化 PNG 再小约四分之一。参数记在 `meta.encoding`。
- **PNG（`--png`）**：脚本自带编码器（逐行自适应滤波 + zlib level 9），默认把 alpha > 0 像素的 RGB 量化到 6 bit
  （最大误差 2/255，记在 `meta.quantize`）；`--png --lossless` 输出无损 PNG。
- **是否重写按像素判断**：每页未编码像素的 sha256 记在 `meta.pageHashes`。像素没变、文件还在就不重新编码、
  不重写（打印 `unchanged …像素未变`），`--check` 也按这个判断。WebP 编码器跨 Chromium 版本字节可能不同，
  但不会因此误报变化。json 本身逐字节比较，不含时间戳。
- **原子写盘**：页图和 json 都先写同目录的 `*.tmp` 再改名；每组先写页图、再写 json、最后删多出来的旧页，
  任何时刻 json 引用的页图都存在（开发服务器热更新或中途中断都不会读到半个文件）。
- **只写变化文件**：页数变少时只删除该组多出来的 `game-N.*` / `meta-N.*`，
  从不整目录删除重建（整目录删除会让 Vite 开发服务器把这些路径返回成 index.html）。
