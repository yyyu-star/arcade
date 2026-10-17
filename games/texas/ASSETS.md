# 素材说明

德州的画面和声音全部由本模块的代码生成：没有图片、音频、字体文件，没有第三方素材，也没有照着别人的作品描的东西。
对标别的扑克游戏时只学结构和风格（docs/art-v3.md 第 2 节），不拿任何图、字体、图标。

| 素材 | 怎么来的 | 代码 |
|---|---|---|
| 四种花色 | 自己画的 SVG 路径 | `src/view/art.ts` |
| 人头牌半身像、数字牌的中心花色、A 的大花色 | 自己画的 SVG | `src/view/art.ts`、`src/view/pips.ts` |
| 10 个电脑和"我"的头像 | 按性格用 SVG 拼（脸、发型、眼镜、帽子，加渐变光影） | `src/view/art.ts` |
| 毡面、桌边、牌背、筹码、庄家钮、按钮、面板 | CSS 渐变和内联 SVG | `src/view/skin.css`、`src/view/style.css` |
| 分层背景：墙面、散景光斑、吊灯、吧台酒瓶剪影、光锥、浮尘（0.18.0） | CSS 渐变和内联 SVG | `src/view/scene.ts`、`src/view/scene.css` |
| 四间主题房的配色和材质（毡面、绒面光泽、金色菱格、黄铜边，0.18.1） | CSS 渐变和变量 | `src/view/rooms.css`、`src/view/rooms.ts` |
| 主页模式卡的图标（两张牌、一摞筹码、两个人，0.18.0） | 自己画的 24 格 SVG | `src/view/lobby.ts` |
| 音效 | WebAudio 现合成 | `src/view/sound.ts` |
| 表情包、道具 | 共用包 arcade-kit 自己画的（来源见它的说明） | `arcade-kit` |
| 文字 | 系统字体，不下载字体文件 | `src/view/style.css` 的 `--font` |
