# 素材说明

| 素材 | 来源 | 许可 |
|---|---|---|
| 角色、怪、法器、特效、雪地、点缀、图标（`src/view/art/`） | 本项目用 Canvas 2D 程序画，开局时画进图集 | 同本仓库，MIT |
| 音效、音乐（`src/view/audio/`） | 本项目用 Web Audio 振荡器和噪声实时合成，不放音频文件 | 同本仓库，MIT |
| 页面图标 `public/favicon.svg` | 本项目手写 SVG | MIT |
| 毛笔字 `public/fonts/brush.woff2` | 马善政楷书 Ma Shan Zheng（Copyright 2018 The Ma Shan Zheng Project Authors，<https://github.com/googlefonts/mashanzheng>，从 Google Fonts 仓库 `ofl/mashanzheng` 取 `MaShanZheng-Regular.ttf`），用 `tools/subset-font.ts` 只留游戏里用到的字 | SIL Open Font License 1.1（允许商用、修改、随软件分发，子集化属于修改；不单独售卖字体。这份字体没有声明保留字体名，页面里用的字体名是 YxBrush）。许可证全文见 `public/fonts/OFL.txt` |
| 音效和音乐 | 第 2 步起用 WebAudio 程序合成 | MIT |
| 大厅封面 `public/cover.webp`（800×450，平台放到 `platform/public/covers/yexun.webp`） | 本项目程序生成：`node tools/cover.ts` 起临时端口的 vite，用无头 Chromium 打开 `tools/cover.html`，画标题页同一套主视觉（`sprites7.ts` 的夜空、古镇、道士、灯笼）和图集里的怪，叠上"夜巡""守夜 · 夜探"毛笔字，由浏览器导出 webp。字是上一行的马善政楷书光栅化进图里 | 画面 MIT；字体按 SIL OFL 1.1 可以用在图片里。改了标题页的画或字，重跑 `node tools/cover.ts` |

不使用任何别人的图片、音频。画风参考过别的游戏的截图（只看风格），没有拿它的任何图、角色或界面布局。
