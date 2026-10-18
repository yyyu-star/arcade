# 素材说明

本模块没有外部素材，全部由程序生成：

| 素材 | 来源 |
|---|---|
| 麻将牌面（万、筒、条）、牌背、牌墙 | `src/view/tiles.ts` 运行时画的 SVG：象牙白立体牌身，万字用系统字体写汉字，筒画多层饼，条画竹节，一条画竹枝上的小鸟；牌背、牌墙墨绿菱格金边 |
| 头像 | `src/view/avatar.ts` 手绘风 SVG：六个电脑性格各一张，真人按名字算底色、写首字 |
| 牌桌、中控盘、选桌页和弹窗的画 | `src/view/art.ts` 的 SVG 小纹理和插画（呢子、木纹、竹帘、灯笼、盖碗、档位图标）+ `src/view/art.css` |
| 游戏主页的主视觉（木格窗外的夜色、灯笼、一手牌、小麻雀、盖碗茶） | `src/view/art.ts` 的 `homeScene()` 程序画的内联 SVG（0.17.0） |
| 标题字 `src/view/fonts/noto-serif-sc-black-subset.woff2` | Noto Serif SC Black（思源宋体，Google / Adobe，SIL Open Font License 1.1，可商用、可改、可随软件分发；许可证原文 `src/view/fonts/OFL.txt`）。只留主页上用到的几十个字：`pyftsubset NotoSerifSC-Black.otf --text="雀馆川麻血战到底胡了不下桌一直打只剩家快速开始继续上局娱乐实盘好友房自摸杠碰过听，·" --flavor=woff2 --layout-features='' --no-hinting --desubroutinize --name-IDs='*'`，源文件取自 notofonts/noto-cjk 的 `Serif/SubsetOTF/SC/`；加字时照这条重做，不超过 25KB |
| 封面 `public/cover.svg` | 手写的 SVG |
| 音效 | WebAudio 现合成（`src/view/sound.ts`） |
| 表情包、扔的道具 | `arcade-kit/fun`（kit 自己程序画的，见 kit 的说明） |
