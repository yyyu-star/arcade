# 素材说明

本模块没有外部素材，全部由程序生成：

| 素材 | 来源 |
|---|---|
| 麻将牌面（万、筒、条）、牌背、牌墙 | `src/view/tiles.ts` 运行时画的 SVG：象牙白立体牌身，万字用系统字体写汉字，筒画多层饼，条画竹节，一条画竹枝上的小鸟；牌背、牌墙墨绿菱格金边 |
| 头像 | `src/view/avatar.ts` 手绘风 SVG：六个电脑性格各一张，真人按名字算底色、写首字 |
| 牌桌、中控盘、选桌页和弹窗的画 | `src/view/art.ts` 的 SVG 小纹理和插画（呢子、木纹、竹帘、灯笼、盖碗、档位图标）+ `src/view/art.css` |
| 封面 `public/cover.svg` | 手写的 SVG |
| 音效 | WebAudio 现合成（`src/view/sound.ts`） |
| 表情包、扔的道具 | `arcade-kit/fun`（kit 自己程序画的，见 kit 的说明） |
