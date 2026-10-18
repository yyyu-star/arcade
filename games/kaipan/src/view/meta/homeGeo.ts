// 主页的手机几何（不依赖 Phaser，单元测试直接用）。

type Box = { x: number; y: number; w: number; h: number };

/**
 * 0.19.1 手机主页按世界宽度排（718–960×404，见 theme.ts 的 phoneWorld）。
 * 要点的东西都放在下半屏一排：右下是大卡（继续 / 快速开始，右手拇指的位置），左边是 n 张模式卡；
 * 上半屏是 Logo、一句玩法和主视觉，小人站在卡片上沿。顶上一行只有「大厅」、云存档和右上角的小入口。
 */
export function phoneHome(W: number, H: number, n: number) {
  const pad = 12;
  const bandH = 112;
  const bandY = H - pad - bandH;
  const heroW = Math.max(300, Math.min(404, Math.round(W * 0.42)));
  const hero: Box = { x: W - pad - heroW, y: bandY, w: heroW, h: bandH };
  const gap = 8;
  const cardsW = hero.x - 10 - pad;
  const cw = Math.floor((cardsW - gap * (n - 1)) / n);
  const cards: Box[] = Array.from({ length: n }, (_, i) => ({ x: pad + i * (cw + gap), y: bandY, w: cw, h: bandH }));
  // 主视觉：电脑 1280×720 的坐标缩到 0.62，中线对齐，小人的脚（电脑 y≈700）踩在卡片上沿
  const k = 0.62;
  return {
    hero,
    cards,
    /** 有没打完的局时大卡是「继续」，快速开始挪到大卡正上方 */
    quick: { x: hero.x + hero.w - 132, y: bandY - 54, w: 132, h: 44 },
    logo: { x: pad + cardsW / 2, y: 104, size: 52 },
    tagY: 156,
    tools: { right: W - pad, y: 8, h: 42, gap: 6, font: 14 },
    lobby: { x: pad, y: 8 },
    cloud: { x: 160, y: 30 },
    version: { x: W - pad, y: 56 },
    art: { k, ox: Math.round(W / 2 - 640 * k), oy: Math.round(bandY + 4 - 700 * k) },
    /** 山坡的中心：底边压到屏幕下沿以外（卡片之间的缝里看到的是草地，不是天空） */
    hillsY: Math.round(H + 8 - (336 * k) / 2),
  };
}
