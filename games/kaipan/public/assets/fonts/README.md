# 字体

| 文件 | 来源 | 许可 |
|---|---|---|
| `kaipan-num.woff2`（字体名 Kaipan Num，约 2.6 KB） | 由 [Fredoka](https://github.com/hafontia/Fredoka-One) 2.001 改出（Copyright 2016 The Fredoka Project Authors），取自 google/fonts 仓库 `ofl/fredoka/Fredoka[wdth,wght].ttf`，2026-10-17 下载 | SIL OFL 1.1，全文见 `OFL.txt` |

怎么改的（fonttools）：

1. 可变字体固定在 wght 600、wdth 100；
2. 只留 `0123456789¥%+-−.,:/×~` 和空格（游戏里的数字、金额、涨跌幅），去掉提示信息；
3. 原字体的数字是比例宽度，滚动的金额会左右抖：把 0–9 的步进统一成最宽的 577（字形居中），等于自带等宽数字；
4. 改过的版本不再叫 Fredoka，字体名改成 Kaipan Num。

游戏里只给数字文字用（`theme.ts` 的 `FONT_NUM` 排第一），没有的字（万、亿、↑↓、中文）按 `FONT_NUM` 后面的字体逐字回退。
启动时用 FontFace 先加载（`src/view/numFont.ts`），两秒还没到就先用回退字体，不挡启动。
