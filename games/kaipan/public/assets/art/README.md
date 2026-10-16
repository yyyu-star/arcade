# 《开盘》美术素材

全部素材为程序生成的原创 SVG（几何图形手写路径，没有使用任何第三方素材或字体），生成脚本在 `tools/art/`。
素材放在 `v3/` 下；小件另外烘焙成图集（`v3/atlas/`），游戏启动时由加载场景按屏幕的渲染倍数（1–3 倍）光栅化 SVG、
按需加载图集，高分屏下同样清晰。素材清单与世界坐标尺寸登记在 `src/view/assets.ts`（`queueBoot` 开局加载），
画面层用 `src/view/ui/art.ts` 的 `addImage`（单图）/ `addSlice`（九宫格）使用。
`public/favicon.svg` 是页面图标，不在本目录。

## 如何替换为外包素材

1. 保持文件名、画布尺寸与宽高比不变，直接覆盖同名 SVG 即可，无需改代码；之后跑 `node tools/art/bake.ts` 重烘焙图集。
2. 如果要换成位图（PNG/WebP），把 `src/view/assets.ts` 中对应条目的路径改掉；位图请按 3 倍尺寸导出以兼顾高分屏。
3. 新增素材：在 `assets.ts` 的 `ASSETS` 里登记 key、路径和世界坐标尺寸，再用 `ui/art.ts` 使用。
4. 素材缺失或加载失败时，界面会退回到纯色或隐藏图标，不会阻断游戏。

## v3 美术

方向：Q 版"股票小人" + 温暖的炒股小屋。素材都在 `v3/` 下。预览页：`public/art-preview.html`（开发服务器上是
`http://localhost:5173/art-preview.html`，纯静态 + CSS 动画，由 `node tools/art/build.ts preview` 生成，不进线上构建）。

### 风格规范

- 扁平卡通、粗描边。描边色统一 `#3a2634`（深梅子棕，不用纯黑），小人主体描边 4px（128 画布）。
- 明暗：每个色块右下角一道同色加深的"月牙"暗部 + 左上白色高光弧线；不用复杂渐变。
- 纸张质感：身体、墙面、账单等用 `feTurbulence` 细颗粒（`lib/svg.ts` 的 `grained()`）。
  **九宫格素材不带颗粒**（拉伸后会变成条纹），需要纸感时叠 `ui/paper_tile.svg` 平铺。
- 滤镜区域一律 `filterUnits="userSpaceOnUse"`：默认的 objectBoundingBox 不含描边，会把外描边裁掉。
  渐变同样用 `userSpaceOnUse`。
- 不用 `<text>`，也不用任何外部素材、字体或真实品牌 / 人物形象。账单和印章上的字由画面层叠加。
- 涨跌色只用在数字和装饰上（红涨绿跌是默认值），小人本身不以红绿区分涨跌，靠表情区分。

### 目录

| 目录 | 内容 | 尺寸 |
|---|---|---|
| `v3/stocks/<id>/<expr>.svg` | 每只股票 × 6 种表情的合成图（画面层先用这个） | 128×128 |
| `v3/stocks/<id>/parts/*.svg` | 分层部件（tools/art 的中间产物，运行时不读，构建产物里不带；全部同尺寸同原点，叠放即对齐） | 128×128 |
| `v3/stocks/manifest.json` | 每只股票的名字、题材、角色、配色、层序、锚点、文件路径（生成物，勿手改） | — |
| `v3/scene/*.svg` | 炒股小屋分层背景 | 1280×720 |
| `v3/chat/*.svg` | 手机外框、刘海、标题栏、聊天背景、气泡、推荐卡、系统提示条 | 见下 |
| `v3/avatars/<id>_<normal\|smug\|awkward>.svg` | 群友 × 正常 / 得意 / 尴尬 | 96×96 |
| `v3/themes/<题材 id>.svg` | 题材徽记，底色 = 题材主色 | 64×64 |
| `v3/fx/*.svg` | 火苗、冰晶、烟花、雨云、雨滴、连线光效、金币、闪光、潮水 | 见下 |
| `v3/ui/*.svg` | 账单卡、两枚印章、持仓卡框、纸面板、按钮、标签、纸纹平铺、角色小徽章；还有图鉴小件（见下） | 见下 |
| `v3/stocks/<id>/blink.svg` | 每只股票的眨眼帧，与 `calm.svg` 同画布、完全对齐，只把眼睛换成闭眼 | 128×128 |
| `v3/items/<itemId>.svg` | 道具图标，底板按类别着色（战法暖桃 / 工具天蓝 / 人脉淡紫） | 64×64 |
| `v3/personas/<id>.svg`、`<id>_locked.svg` | 人设半身立绘（透明底）与锁定剪影（+ 问号） | 240×300 |
| `v3/difficulty/<1..8>.svg` | 难度（市场环境）徽记，带数字，由温和到凶险 | 96×96 |
| `v3/achievements/frame_<bronze\|silver\|gold\|locked>.svg` | 成就章框，中间是直径 62 的图标窗口 | 96×96 |
| `v3/achievements/icon_<name>.svg` | 成就图标（透明底），居中叠在框上（偏移 16,16） | 64×64 |
| `v3/scene/title_keyart.svg` | 标题页主视觉；中上部 x 380–1220、y 40–440 留给 Logo 和按钮 | 1600×900 |
| `v3/guide/<rotation\|buy\|sell>.svg` | 说明书插图（风口轮流火 / 开始火时买 / 太火了卖、月底还钱）；上方 0–226 是画，下方 y 232–296 留给文字 | 520×300 |
| `v3/ui/stage_<cold\|warm\|hot\|overheat\|cooling>.svg` | 风口五种状态（没人理 / 开始火 / 正火 / 太火了 / 在降温），颜色从冷到热、降温回到冷色 | 32×32 |
| `v3/ui/news.svg`、`v3/ui/recap_paper.svg` | 收盘新闻小报纸；收盘小结卡纸张（九宫格 [24, 24, 24, 24]，不带颗粒） | 40×40、96×96 |
| `v3/avatars/cat_hint.svg` | 新手提示用的猫头像（小屋里那只橘猫醒着的样子） | 96×96 |
| `v3/atlas/` | 离线烘焙的多图集（Phaser multiatlas，2×，WebP 近无损页图），用法见 `v3/atlas/README.md` | ≤2048² / 页 |

题材主色：ai `#1fbfe8`（青）、newenergy `#9ad13c`（黄绿）、consumer `#ff7a33`（橙）、pharma `#2fc49a`（薄荷）、
finance `#f6c02f`（金黄）、lowalt `#4f7cff`（蓝）、gaming `#cc4fe0`（品红紫）、pig `#ff9cc8`（粉）。
定义在 `tools/art/lib/svg.ts` 的 `THEME_COLORS`；徽记、热度条、卡片标签和生成款小人的身体都取这里的颜色。

### 股票小人：部件与锚点

画布 128×128，**地面 y=116**（脚底 / 影子中心），上方留出皇冠、头发和弹跳的空间。
表情 id：`calm` 平静、`happy` 开心、`limitup` 涨停（金墨镜）、`worried` 发愁（流汗）、
`limitdown` 跌停（哭）、`delisted` 退市（X 眼 + 小魂 + 整体变灰）。

层序（下 → 上，`manifest.json` 的 `layers[].z`）：

| 层 | 文件 | 说明 |
|---|---|---|
| shadow | `parts/shadow.svg` | 地面影子，弹跳时单独压扁 / 缩小 |
| back | `parts/back.svg` | 身后的东西（钉耙、翅膀、风扇支架、电竞椅光晕、VR 头带、硬币光芒、果冻残影与轨道后半圈、跑轮支架） |
| spin | `parts/spin.svg` | 可旋转的层，绕 `anchors.spin` 转：永动机能源的跑轮、算力搬砖的散热风扇、螺旋桨精工的桨叶、风口上的猪的电风扇 |
| body | `parts/body.svg` | 身体（含手脚、鼻子等固定五官以外的部分） |
| mark | `parts/mark.svg` | 脸上的图案，目前是妖股的闪电标记，画在额头正中（两眉之间上方），任何表情都不挡眼睛 |
| cheeks | `parts/cheeks.svg` | 腮红；`delisted` 时不显示 |
| eyes | `parts/eyes_<expr>.svg`、`parts/eyes_blink.svg` | 每种表情一张，同一时间只显示一张；眨眼时换成 `eyes_blink`（墨镜款是一道反光） |
| mouth | `parts/mouth_<expr>.svg` | 每种表情一张 |
| acc | `parts/acc.svg` | 角色配饰：龙头皇冠、白马领带、跟风小旗（连手）、ST 创可贴，以及帽子 / 手持道具 |
| fx | `parts/fx_<expr>.svg` | 表情特效：涨停闪光、发愁汗滴、跌停泪流、退市小魂（只有这 4 种表情有） |

退市：`back / spin / body / mark / acc` 各有一张 `*_gray.svg`，五官层直接用 `*_delisted.svg`；
合成图 `delisted.svg` 已整体去色。也可以在 Phaser 里对原色部件做灰度滤镜，效果接近。

锚点（`manifest.json` 的 `anchors`，128 画布像素坐标，不随显示尺寸变）：

| 锚点 | 用途 |
|---|---|
| `ground` | 恒为 (64, 116)。呼吸、弹跳、压扁拉伸、发抖的变换原点；影子中心 |
| `face` / `eyes` | 两眼连线中点。眨眼如果不换图、改用缩放，就以它为原点做 scaleY |
| `eyeL` / `eyeR` | 左右眼中心（加特效、做单眼眨眼用） |
| `mouth` | 嘴的中心 |
| `headTop` | 头顶（含皇冠 / 帽子），弹出涨跌百分比、连板数的位置 |
| `hand` | 只有举旗或手持道具的才有。小旗摇摆时 `acc` 层绕它小幅旋转（±8°） |
| `spin` | 只有 `spin` 层的才有，旋转中心 |

建议的待机动画（预览页就是这样做的）：整体（除影子）以 `ground` 为原点做 scale(1.018, 1.04) 的
3 秒呼吸；每 4 秒左右把眼睛换成 `eyes_blink` 约 150ms；弹跳时先压扁 (1.08, 0.92) 再起跳约 12% 高度，
影子同步缩小；跌停时沿 x 小幅发抖。

### 生成脚本

```bash
node tools/art/build.ts                 # 全部重新生成（约 1 秒）
node tools/art/build.ts stocks preview  # 只生成某几组：stocks scene chat avatars badges fx misc items personas progress keyart friendly preview
node tools/art/bake.ts                  # 生成完再烘焙图集（WebP；像素没变的页不重写）；--check 只比较不写盘，--png 改出 PNG
```

每个分组开始前把 id 计数器归零（`lib/svg.ts` 的 `resetIds()`），所以单独跑某几组和全量跑的输出一样。

- 源清单 `tools/art/stocks.json`：每只股票的 `id / name / theme / role`，以及
  - 精做款：`hero: true` + `body`（`tools/art/stocks.ts` 的 `HERO_BODIES` 里手写的配方）；
  - 生成款：`shape` = 名字梗剪影（`RECIPES`）：brickfan 带风扇的砖、sunflower 光伏向日葵、battery 电池、
    cup 奶茶杯、bento 微波饭盒、pillbottle 戴眼罩的药瓶、packet 冲剂袋、potion 冒泡药水、sickle 小镰刀、
    coin 发光硬币、propbox 螺旋桨外卖箱、propeller 螺旋桨、car 长翅膀的车、gamepad 手柄 + 金币、
    gamingchair 发光电竞椅、vrhead VR 头盔、sack 饲料袋、fanpig 被风扇吹起的猪、melt 瘫成一滩、backpedal 倒退的小人；
    另有：cloudrack 坐在机柜上的云、promptbubble 带输入框的对话气泡、cellbattery 圆柱电池、pinwheel 顶着纸风车的豆子、
    noodlebowl 带烟囱的螺蛳粉碗、cloudcat 猫形云、baldsprout 冒新发的光头、classroom 学士帽团子 + 黑板、helipad 楼顶停机坪、
    pixelfactory 像素老厂、livemic 补光灯麦克风、fridgepig 猪鼻子冷柜、pie 画大饼、deadphone 没信号的旧手机；
    配方可写 `scale`（以地面中心缩放，新增跟风股都是 0.86，"小一号"）和 `tie: [x, y, 缩放]`；
  - `colors` 可选，不写就用题材主色。
- 角色配饰由 `role` 自动加，位置由配方给出：leader 皇冠、bluechip 领带、meme 额头闪电、follower 小旗
  （有手就举着，没手就插在身上）、st 创可贴。
- 新增一只股票：在 `stocks.json` 加一行；能复用已有剪影就直接填 `shape`，否则在 `RECIPES` 里加一个配方
  （返回身体、脸的位置、配饰位置），再跑 `node tools/art/build.ts stocks preview`。
- 输出是确定性的；脚本只改写内容有变化的文件，并删除清单里已经没有的旧文件。
  **不要整目录删除 `v3/stocks` 再立即重建**：运行中的 Vite 开发服务器靠文件监听维护 public 文件清单，
  快速的"删除 + 新建"会让它把新文件当成不存在（返回 index.html）。真遇到了，把该目录移走、确认
  开发服务器已经返回 404/HTML 之后再重新生成即可，不用重启服务。
- 代码：`tools/art/lib/svg.ts`（调色板、形状与颗粒工具）、`lib/face.ts`（五官）、`stocks.ts`、`scene.ts`、
  `chat.ts`、`avatars.ts`、`badges.ts`、`fx.ts`、`misc.ts`、`preview.ts`；还有 `items.ts`（道具图标）、
  `personas.ts`（人设立绘）、`progress.ts`（难度徽记、成就、图鉴小件）、`keyart.ts`（标题主视觉）、`bake.ts`（图集）。

### 图鉴与长线界面小件（`v3/ui/`）

| 文件 | 尺寸 | 用途 |
|---|---|---|
| `codex_tab.svg` / `codex_tab_active.svg` | 120×48 | 图鉴页签（股票 / 群友 / 道具 / 事件 / 成就），未选与选中；九宫格 [24, 24, 18, 10] |
| `codex_card.svg` | 120×160 | 图鉴卡：纸面卡框，上方 30px 彩色题头写名字；九宫格 [24, 24, 24, 24] |
| `codex_new.svg` | 32×32 | 新点亮条目的红色角标（叠在卡片右上角） |
| `codex_lock.svg` | 32×32 | 小锁：未解锁的人设、难度、每日挑战入口 |
| `progress_track.svg` / `progress_fill.svg` | 64×20 | 收集进度条底槽与填充；九宫格 [12, 12, 0, 0] |
| `rotate_phone.svg` | 96×96 | 新风格的横屏提示图（竖手机转成横手机） |

- 成就：框 96×96，图标 64×64 居中叠放（偏移 16,16）。未达成用 `frame_locked`，图标由画面层压暗（预览页用
  brightness 0.35 + 透明度 0.6）或干脆不画。
- 人设：`<id>_locked.svg` 是同一张立绘压成剪影再叠问号，尺寸与立绘相同，可以直接替换。
- 群友头像：人物缩放从 1.18 收回到 1.05，帽檐、头发、手持道具都落在半径 42 的安全圆内，只有
  肩膀允许被圆框切掉，32px 显示也不切边。

### 小屋场景（1280×720）

层序（下 → 上）：`sky_<bull|flat|bear>` → `city` → `haze_bear`（熊，压暗城市灯光）→ `rain`（熊）→
`lightning` / `lightning_2` / `lightning_3`（熊，3 个位置变体，每次随机闪一个）→ `wall` →
`desk` → `steam` → `cat` → `cat_tail` → `cat_zzz` → `ambient_<bull|flat|bear>` → `lamp_light` → `monitor_glow`。

- 牛 / 平 / 熊 = 晴 / 阴 / 雷雨；切换时 `sky_*` 与 `ambient_*` 交叉淡入淡出。
- 窗洞：x 420–860，y 56–336（`wall` 在这里镂空）。天色、城市、雨都画满全画布，方便做视差平移。
- `rain` 竖直方向无缝平铺（周期 720px），向下平移循环即可。
- 小火箭摆在显示器顶上、多肉摆在书桌上（都在 `desk` 层），窗台上不放东西（会被窗帘和显示器挡住）。
- 猫尾巴旋转原点 (1066, 556)，摆动 ±3°；猫身体以 (985, 584) 为原点做轻微呼吸；`cat_zzz` 上飘淡出。
- 显示器屏幕区域 x 472–808，y 362–542（以后可以把实时 K 线画在这里）；`monitor_glow`、`lamp_light`
  建议用 ADD / SCREEN 混合。

### 群聊（九宫格切片：左 / 右 / 上 / 下，单位 px）

| 文件 | 尺寸 | 切片 | 说明 |
|---|---|---|---|
| `chat/phone_frame.svg` | 360×720 | 48 / 48 / 48 / 48 | 屏幕区域内缩 14px，底色米白 |
| `chat/phone_notch.svg` | 120×28 | — | 放在外框顶部居中 |
| `chat/chat_header.svg` | 128×64 | 36 / 36 / 34 / 12 | 顶部圆角与屏幕一致 |
| `chat/chat_bg_tile.svg` | 96×96 | 平铺 | 淡涂鸦，透明底 |
| `chat/bubble_left.svg` | 64×48 | 20 / 16 / 22 / 16 | 群友，白色，尾巴在左上 |
| `chat/bubble_right.svg` | 64×48 | 16 / 20 / 22 / 16 | 自己 / 系统，暖黄，尾巴在右上 |
| `chat/bubble_card.svg` | 96×96 | 24 / 24 / 24 / 24 | 推荐卡；顶条 y 3–20 放"今日推荐 · 题材"，左侧放 64px 小人 |
| `chat/system_pill.svg` | 96×28 | 14 / 14 / 0 / 0 | 系统提示条 |

头像 `avatars/<id>_<expr>.svg`：id 为 xiaoli、laowang、zhangjie、qunzhu、laozhao、dav、neimu、zhuchang；
表情 normal / smug（得意）/ awkward（尴尬）。圆形 96×96，聊天里显示 40px。

### 特效与界面

| 文件 | 尺寸 | 说明 |
|---|---|---|
| `fx/flame.svg`、`fx/flame_small.svg` | 32×48、20×28 | 热度条火苗，底部中点为根，做 scaleY 抖动 |
| `fx/ice.svg`、`fx/ice_shard.svg` | 32×32、16×16 | 退潮冰晶 |
| `fx/tide.svg` | 256×48 | 退潮潮水，横向无缝平铺（波长 32px，任意 32 的倍数宽度都无缝） |
| `fx/firework_burst.svg` | 128×128 | 涨停整朵烟花（从 0.2 倍放大 + 淡出） |
| `fx/firework_star.svg`、`firework_dot.svg`、`firework_trail.svg` | 24、12、8×40 | 烟花粒子；dot 和 trail 是白色，运行时着色 |
| `fx/raincloud.svg`、`fx/raindrop.svg` | 128×80、10×16 | 跌停雨云（带愁眉）与雨滴粒子 |
| `fx/link_beam.svg` | 128×24 | 龙头带动的连线光，横向三段拉伸（两端各 16px 不拉伸） |
| `fx/link_spark.svg` | 32×32 | 连线两端 / 沿线移动的光点 |
| `fx/coin.svg`、`fx/sparkle.svg` | 32、16 | 金币、白色闪光 |
| `ui/bill_card.svg` | 320×400 | 账单卡。文字区：标题 x 80–300 / y 20–64；明细三行文字顶约 y 106、150、194（下方虚线 y 126、170、214）；合计框 x 24–296 / y 276–340 |
| `ui/stamp_paid.svg` | 160×160 | "已还清"圆章（红），字放在中心 y 46–104 之间 |
| `ui/stamp_overdue.svg` | 220×110 | "逾期"长方章（深紫），字放在 x 46–174 / y 20–90 |
| `ui/card_holding.svg` | 64×64 | 持仓卡框，九宫格四边 18px（底边带厚边） |
| `ui/panel_paper.svg` | 64×64 | 纸面板，九宫格四边 20px |
| `ui/button_big.svg`、`ui/button_buy.svg` | 96×48 | 开盘 / 买入按钮，九宫格 左右 24、上下 16 |
| `ui/tag_pill.svg` | 40×20 | 白色标签胶囊，九宫格左右 10，运行时着色 |
| `ui/paper_tile.svg` | 128×128 | 纸纹颗粒平铺（透明底），叠在九宫格面板上 |
| `ui/role_<leader\|follower\|bluechip\|meme\|st>.svg` | 24×24 | 角色小徽章（皇冠、小旗、领带、闪电、创可贴） |

接入 Phaser 时用：`load.svg(key, path, { width: w * RENDER_SCALE, height: h * RENDER_SCALE })`。
九宫格用 Phaser 的 NineSlice，切片值按上表。

## 大厅封面（平台的 `covers/kaipan.webp`）

平台大厅里开盘那张封面（960×540 webp，平台 0.1.0 起就在，2026-10-11 加入），就是开盘的标题页主视觉 `v3/scene/title_keyart.svg`
（1600×900，`tools/art/keyart.ts` 程序生成，见文件开头"全部素材为程序生成的原创 SVG"）去掉 Logo 和按钮、缩到 960×540 转成的 webp。
当时没有留下生成记录；2026-10-15 核对：现在的主视觉按 960×540 渲染出来和封面构图、角色、配色一致，只有个别小人的表情、几颗星星是后来改过的（主视觉 0.3.0 起就有，早于封面）。
所以封面的来源和许可同开盘的其余素材：原创，无第三方素材或字体。

要重新出一张：在无头 Chromium 里把 `title_keyart.svg` 按 960×540 画出来截图，再转成 webp（质量 80 左右），交给平台替换 `platform/public/covers/kaipan.webp`（平台模块的 PR）。
