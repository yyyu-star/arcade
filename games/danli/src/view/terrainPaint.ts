/**
 * 多材质的地形画法（美术代理 2026-10-21 交付的 danli-terrain-art.mjs，照原样改写成 TS）：terrainArt.ts 每块烘焙时调 paintTerrainRect。
 * ctx 已经 setTransform 成世界坐标；x0、y0、w、h 是这一块的世界范围。
 * 材质按格子低 7 位的材质码查 mapArt.ts 的 MATERIALS；同一块里有几种材质就各描一条轮廓、各自填色和纹理，
 * 材质之间画一道细墨线（冰淇淋球一层一层、饺子摆在雪上都靠它分开），最外面的轮廓 2.6 粗墨线。
 * 纹理全按世界坐标取随机数，块和块接得上；不用滤镜，烘焙一次。
 */
import { CELL, MAT_MASK, SCORCH, cellAt, type Terrain } from '../core/terrain.ts';
import type { Material, TexId } from './mapArt.ts';
import { TEX2 } from './mapArt2.ts';
import { hash, tiles } from './paintKit.ts';
import { INK } from './palette.ts';

type Ctx = CanvasRenderingContext2D;
type P = [number, number];

/** marching squares：solid(c,r) 回 0/1；回填色路径和边线段 */
function march(solid: (c: number, r: number) => number, c0: number, c1: number, r0: number, r1: number): { fill: Path2D; segs: [P, P][] } {
  const fill = new Path2D();
  const segs: [P, P][] = [];
  const H = CELL / 2;
  for (let r = r0; r < r1; r++) {
    let run = -1;
    for (let c = c0; c <= c1; c++) {
      const k = c < c1 ? solid(c, r) * 8 + solid(c + 1, r) * 4 + solid(c + 1, r + 1) * 2 + solid(c, r + 1) : 0;
      if (k === 15) { if (run < 0) run = c; continue; }
      if (run >= 0) { fill.rect(run * CELL + H, r * CELL + H, (c - run) * CELL, CELL); run = -1; }
      if (k === 0 || c >= c1) continue;
      const x = c * CELL + H, y = r * CELL + H;
      const T: P = [x + H, y], R: P = [x + CELL, y + H], B: P = [x + H, y + CELL], L: P = [x, y + H];
      const TL: P = [x, y], TR: P = [x + CELL, y], BR: P = [x + CELL, y + CELL], BL: P = [x, y + CELL];
      const shapes: Record<number, [P[][], [P, P][]]> = {
        1: [[[L, B, BL]], [[L, B]]], 2: [[[B, R, BR]], [[B, R]]], 3: [[[L, R, BR, BL]], [[L, R]]], 4: [[[T, TR, R]], [[T, R]]],
        5: [[[L, B, BL], [T, TR, R]], [[L, B], [T, R]]], 6: [[[T, TR, BR, B]], [[T, B]]], 7: [[[L, T, TR, BR, BL]], [[L, T]]], 8: [[[TL, T, L]], [[T, L]]],
        9: [[[TL, T, B, BL]], [[T, B]]], 10: [[[TL, T, L], [B, R, BR]], [[T, L], [B, R]]], 11: [[[TL, T, R, BR, BL]], [[T, R]]], 12: [[[TL, TR, R, L]], [[L, R]]],
        13: [[[TL, TR, R, B, BL]], [[R, B]]], 14: [[[TL, TR, BR, B, L]], [[B, L]]],
      };
      const sh = shapes[k]!;
      for (const p of sh[0]) { fill.moveTo(p[0]![0], p[0]![1]); for (let i = 1; i < p.length; i++) fill.lineTo(p[i]![0], p[i]![1]); fill.closePath(); }
      for (const s of sh[1]) segs.push(s);
    }
  }
  return { fill, segs };
}

// ---------------- 纹理：每种一个小函数，(ctx, 世界范围, 材质)；0.4.0 新图的 13 种在 mapArt2.ts ----------------
const TEX: Record<TexId, (ctx: Ctx, x0: number, y0: number, w: number, h: number) => void> = {
  ...TEX2,
  none() {},
  pores(ctx, x0, y0, w, h) {
    ctx.strokeStyle = INK; ctx.lineWidth = 1; ctx.globalAlpha = 0.24; ctx.beginPath();
    tiles(x0, y0, w, h, 40, (tx, ty, x, y, v) => { if (v > 0.62) return; const rx = 2 + hash(tx + 3, ty + 5) * 4; ctx.moveTo(x + rx, y); ctx.ellipse(x, y, rx, rx * 0.6, 0, 0, Math.PI * 2); });
    ctx.stroke();
  },
  chips(ctx, x0, y0, w, h) {
    ctx.fillStyle = '#5a3a2a'; ctx.globalAlpha = 0.75; ctx.beginPath();
    tiles(x0, y0, w, h, 34, (tx, ty, x, y, v) => { if (v > 0.55) return; const s = 2.4 + v * 3; ctx.moveTo(x - s, y); ctx.lineTo(x, y - s * 0.8); ctx.lineTo(x + s, y + s * 0.2); ctx.lineTo(x - s * 0.2, y + s); ctx.closePath(); });
    ctx.fill();
  },
  seeds(ctx, x0, y0, w, h) {
    ctx.fillStyle = '#e2432a'; ctx.globalAlpha = 0.55; ctx.beginPath();
    tiles(x0, y0, w, h, 26, (tx, ty, x, y, v) => { if (v > 0.6) return; ctx.moveTo(x + 1.6, y); ctx.ellipse(x, y, 1.6, 2.4, 0.4, 0, Math.PI * 2); });
    ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.35; ctx.beginPath();
    tiles(x0, y0, w, h, 52, (tx, ty, x, y, v) => { if (v > 0.5) return; ctx.moveTo(x + 7, y); ctx.ellipse(x, y, 7, 3, -0.3, 0, Math.PI * 2); });
    ctx.fill();
  },
  bean(ctx, x0, y0, w, h) {
    ctx.fillStyle = '#6a4a2a'; ctx.globalAlpha = 0.45; ctx.beginPath();
    tiles(x0, y0, w, h, 18, (tx, ty, x, y, v) => { if (v > 0.5) return; ctx.rect(x, y, 1.6, 1.6); });
    ctx.fill();
  },
  swirl(ctx, x0, y0, w, h) {
    ctx.strokeStyle = '#d4a58a'; ctx.lineWidth = 2; ctx.globalAlpha = 0.5; ctx.lineCap = 'round'; ctx.beginPath();
    tiles(x0, y0, w, h, 44, (tx, ty, x, y, v) => { if (v > 0.6) return; ctx.moveTo(x - 8, y); ctx.quadraticCurveTo(x, y - 8, x + 8, y); });
    ctx.stroke();
  },
  waffle(ctx, x0, y0, w, h) {
    ctx.strokeStyle = '#a8682c'; ctx.lineWidth = 2; ctx.globalAlpha = 0.55; ctx.beginPath();
    const S = 22;
    for (let k = Math.floor((x0 - h) / S) - 1; k <= Math.ceil((x0 + w + h) / S) + 1; k++) {
      ctx.moveTo(k * S, y0 - 2); ctx.lineTo(k * S + h + 4, y0 + h + 2);
      ctx.moveTo(k * S, y0 - 2); ctx.lineTo(k * S - h - 4, y0 + h + 2);
    }
    ctx.stroke();
  },
  sparkle(ctx, x0, y0, w, h) {
    ctx.strokeStyle = '#9cc0e0'; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.6; ctx.beginPath();
    tiles(x0, y0, w, h, 38, (tx, ty, x, y, v) => { if (v > 0.45) return; ctx.moveTo(x - 3, y); ctx.lineTo(x + 3, y); ctx.moveTo(x, y - 3); ctx.lineTo(x, y + 3); });
    ctx.stroke();
    ctx.globalAlpha = 0.25; ctx.strokeStyle = '#8fb0d0'; ctx.beginPath();
    tiles(x0, y0, w, h, 70, (tx, ty, x, y, v) => { if (v > 0.5) return; ctx.moveTo(x - 14, y); ctx.quadraticCurveTo(x, y + 5, x + 14, y); });
    ctx.stroke();
  },
  pleats(ctx, x0, y0, w, h) {
    // 饺子的褶：一道道弯弯的短弧，像捏出来的
    ctx.strokeStyle = '#c9b082'; ctx.lineWidth = 2.2; ctx.globalAlpha = 0.6; ctx.lineCap = 'round'; ctx.beginPath();
    for (let x = Math.floor(x0 / 26) * 26; x < x0 + w + 26; x += 26) for (let y = Math.floor(y0 / 40) * 40; y < y0 + h + 40; y += 40) { ctx.moveTo(x - 3, y); ctx.quadraticCurveTo(x + 6, y + 10, x - 1, y + 22); }
    ctx.stroke();
  },
  bamboo(ctx, x0, y0, w, h) {
    // 竹蒸笼：横的竹篾一圈圈，竖的细缝
    ctx.strokeStyle = '#a8902c'; ctx.lineWidth = 2.4; ctx.globalAlpha = 0.7; ctx.beginPath();
    for (let y = Math.floor(y0 / 20) * 20; y < y0 + h + 20; y += 20) { ctx.moveTo(x0 - 2, y); ctx.lineTo(x0 + w + 2, y); }
    ctx.stroke();
    ctx.lineWidth = 1.2; ctx.globalAlpha = 0.45; ctx.beginPath();
    for (let x = Math.floor(x0 / 14) * 14; x < x0 + w + 14; x += 14) for (let y = Math.floor(y0 / 20) * 20; y < y0 + h + 20; y += 20) { const o = (y / 20) % 2 ? 7 : 0; ctx.moveTo(x + o, y + 3); ctx.lineTo(x + o, y + 17); }
    ctx.stroke();
  },
  strawseed(ctx, x0, y0, w, h) {
    ctx.fillStyle = '#ffe680'; ctx.globalAlpha = 0.95; ctx.beginPath();
    tiles(x0, y0, w, h, 16, (tx, ty, x, y, v) => { if (v > 0.75) return; ctx.moveTo(x + 1.6, y); ctx.ellipse(x, y, 1.6, 2.6, 0.3, 0, Math.PI * 2); });
    ctx.fill();
  },
  nori(ctx, x0, y0, w, h) {
    ctx.strokeStyle = '#567a5e'; ctx.lineWidth = 1.4; ctx.globalAlpha = 0.6; ctx.beginPath();
    for (let x = Math.floor(x0 / 10) * 10; x < x0 + w + 10; x += 10) { ctx.moveTo(x, y0 - 2); ctx.lineTo(x + 3, y0 + h + 2); }
    ctx.stroke();
  },
  grains(ctx, x0, y0, w, h) {
    ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#c9c2a8'; ctx.lineWidth = 0.9; ctx.globalAlpha = 0.7; ctx.beginPath();
    tiles(x0, y0, w, h, 16, (tx, ty, x, y, v) => { if (v > 0.6) return; ctx.moveTo(x + 4, y); ctx.ellipse(x, y, 4, 2.3, v * 6, 0, Math.PI * 2); });
    ctx.fill(); ctx.stroke();
  },
  rolls(ctx, x0, y0, w, h) {
    ctx.strokeStyle = '#d99a2a'; ctx.lineWidth = 1.6; ctx.globalAlpha = 0.6; ctx.beginPath();
    for (let y = Math.floor(y0 / 16) * 16; y < y0 + h + 16; y += 16) { ctx.moveTo(x0 - 2, y); for (let x = Math.floor(x0 / 80) * 80; x < x0 + w + 80; x += 80) ctx.quadraticCurveTo(x + 40, y + 4, x + 80, y); }
    ctx.stroke();
  },
  cuts(ctx, x0, y0, w, h) {
    ctx.strokeStyle = '#a8382a'; ctx.lineWidth = 2; ctx.globalAlpha = 0.55; ctx.lineCap = 'round'; ctx.beginPath();
    tiles(x0, y0, w, h, 30, (tx, ty, x, y, v) => { if (v > 0.5) return; ctx.moveTo(x - 5, y - 4); ctx.lineTo(x + 5, y + 4); });
    ctx.stroke();
    ctx.fillStyle = '#ffd8cc'; ctx.globalAlpha = 0.45; ctx.beginPath();
    tiles(x0, y0, w, h, 60, (tx, ty, x, y, v) => { if (v > 0.4) return; ctx.moveTo(x + 8, y); ctx.ellipse(x, y, 8, 3, -0.4, 0, Math.PI * 2); });
    ctx.fill();
  },
  batter(ctx, x0, y0, w, h) {
    ctx.strokeStyle = '#c8862c'; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.5; ctx.beginPath();
    tiles(x0, y0, w, h, 14, (tx, ty, x, y, v) => { if (v > 0.6) return; const r = 2.5 + v * 3; ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); });
    ctx.stroke();
  },
  florets(ctx, x0, y0, w, h) {
    ctx.fillStyle = '#4a8c30'; ctx.globalAlpha = 0.5; ctx.beginPath();
    tiles(x0, y0, w, h, 16, (tx, ty, x, y, v) => { if (v > 0.65) return; const r = 2 + v * 3; ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2); });
    ctx.fill();
  },
  docked(ctx, x0, y0, w, h) {
    ctx.fillStyle = '#b8783a'; ctx.globalAlpha = 0.55; ctx.beginPath();
    const S = 28;
    for (let y = Math.floor(y0 / S) * S; y < y0 + h + S; y += S) for (let x = Math.floor(x0 / S) * S; x < x0 + w + S; x += S) { const xx = x + ((y / S) % 2 ? S / 2 : 0); ctx.moveTo(xx + 2.2, y + 14); ctx.arc(xx, y + 14, 2.2, 0, Math.PI * 2); }
    ctx.fill();
  },
  stripes(ctx, x0, y0, w, h) {
    ctx.fillStyle = '#e2432a'; ctx.globalAlpha = 1; ctx.beginPath();
    for (let x = Math.floor(x0 / 32) * 32; x < x0 + w + 32; x += 32) ctx.rect(x, y0 - 2, 16, h + 4);
    ctx.fill();
  },
  scores(ctx, x0, y0, w, h) {
    ctx.strokeStyle = '#fbe0a8'; ctx.lineWidth = 3; ctx.globalAlpha = 0.7; ctx.lineCap = 'round'; ctx.beginPath();
    for (let x = Math.floor(x0 / 70) * 70; x < x0 + w + 70; x += 70) for (let y = Math.floor(y0 / 30) * 30; y < y0 + h + 30; y += 30) if (hash(x, y) < 0.5) { ctx.moveTo(x, y); ctx.lineTo(x + 24, y - 10); }
    ctx.stroke();
  },
  layers(ctx, x0, y0, w, h) {
    ctx.strokeStyle = '#a85a24'; ctx.lineWidth = 2.4; ctx.globalAlpha = 0.5; ctx.beginPath();
    for (let y = Math.floor(y0 / 30) * 30; y < y0 + h + 30; y += 30) { ctx.moveTo(x0 - 2, y); for (let x = Math.floor(x0 / 120) * 120; x < x0 + w + 120; x += 120) ctx.quadraticCurveTo(x + 60, y + (Math.round(x / 120) % 2 ? 4 : -4), x + 120, y); }
    ctx.stroke();
  },
  band(ctx, x0, y0, w, h) {
    ctx.fillStyle = '#4f86c8'; ctx.globalAlpha = 0.85; ctx.fillRect(x0 - 2, 352, w + 4, 16);
    ctx.fillStyle = '#e2432a'; ctx.fillRect(x0 - 2, 374, w + 4, 6);
  },
};

/** 材质码 → 材质 */
function byCodeOf(mats: Readonly<Record<string, Material>>): Map<number, Material> {
  const m = new Map<number, Material>();
  for (const v of Object.values(mats)) m.set(v.code, v);
  return m;
}

/**
 * 把 terrain 在世界范围 [x0, x0+w) × [y0, y0+h) 里的部分画到 ctx（ctx 已是世界坐标）。回 false 是这一块没有地。
 * overlay：地表皮画完、材质间细线和外轮廓墨线之前，裁在"有地"的轮廓里再画一层（武器的焦痕，DESIGN.md 2.3.1）。
 */
export function paintTerrainRect(ctx: Ctx, t: Terrain, x0: number, y0: number, w: number, h: number, mats: Readonly<Record<string, Material>>, overlay?: (ctx: Ctx) => void): boolean {
  const codes = byCodeOf(mats);
  // 材质码查不到（不该发生）就当面团画
  const byCode = (code: number): Material => codes.get(code) ?? codes.get(1)!;
  const c0 = Math.floor(x0 / CELL) - 4, c1 = Math.ceil((x0 + w) / CELL) + 3, r0 = Math.floor(y0 / CELL) - 4, r1 = Math.ceil((y0 + h) / CELL) + 3;
  const present = new Set<number>();
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const v = cellAt(t, c, r) & MAT_MASK; if (v) present.add(v); }
  if (!present.size) return false;
  const any = (c: number, r: number): number => (cellAt(t, c, r) & MAT_MASK ? 1 : 0);
  const outer = march(any, c0, c1, r0, r1);
  const multi = present.size > 1;
  const inner: [P, P][][] = [];
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const code of present) {
    const m = byCode(code);
    const part = multi ? march((c, r) => ((cellAt(t, c, r) & MAT_MASK) === code ? 1 : 0), c0, c1, r0, r1) : outer;
    if (multi) inner.push(part.segs);
    ctx.save();
    ctx.clip(part.fill);
    const g = ctx.createLinearGradient(0, 120, 0, 700);
    g.addColorStop(0, m.grad[0]); g.addColorStop(0.55, m.grad[1]); g.addColorStop(0.84, m.grad[2]); g.addColorStop(1, m.grad[3]);
    ctx.fillStyle = g; ctx.fillRect(x0, y0, w, h);
    TEX[m.tex](ctx, x0, y0, w, h);
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  // 炸焦的坑边（每格一个小圆，颜色按材质）
  ctx.save();
  ctx.clip(outer.fill);
  ctx.globalAlpha = 0.85;
  for (const code of present) {
    ctx.fillStyle = byCode(code).rim; ctx.beginPath();
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) { const v = cellAt(t, c, r); if (v & SCORCH && (v & MAT_MASK) === code) { ctx.moveTo(c * CELL + 2 + 3.4, r * CELL + 2); ctx.arc(c * CELL + 2, r * CELL + 2, 3.4, 0, Math.PI * 2); } }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // 地表皮：上面空、下面是地的边，颜色按下面那格的材质
  const crusts = new Map<number, Path2D>();
  for (const [a, b] of outer.segs) {
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const up = any(Math.floor(mx / CELL), Math.floor((my - 3) / CELL)), dn = cellAt(t, Math.floor(mx / CELL), Math.floor((my + 3) / CELL)) & MAT_MASK;
    if (up || !dn || !byCode(dn).crust) continue;
    let p = crusts.get(dn);
    if (!p) crusts.set(dn, (p = new Path2D()));
    p.moveTo(a[0], a[1]);
    p.lineTo(b[0], b[1]);
  }
  ctx.lineWidth = 12;
  for (const [code, p] of crusts) { ctx.strokeStyle = byCode(code).crust!; ctx.stroke(p); }
  overlay?.(ctx);
  ctx.restore();
  // 材质之间的细线
  if (multi) {
    const p = new Path2D();
    for (const segs of inner) for (const [a, b] of segs) { p.moveTo(a[0], a[1]); p.lineTo(b[0], b[1]); }
    ctx.strokeStyle = INK; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.6; ctx.stroke(p); ctx.globalAlpha = 1;
  }
  const e = new Path2D();
  for (const [a, b] of outer.segs) { e.moveTo(a[0], a[1]); e.lineTo(b[0], b[1]); }
  ctx.strokeStyle = INK; ctx.lineWidth = 2.6; ctx.stroke(e);
  ctx.restore();
  return true;
}

/** 碎屑：炸开时飞出去的小块，颜色按炸到的材质两色交替 */
export function crumbColor(m: Material, i: number): string {
  return m.crumb[i & 1]!;
}

/** 世界坐标 (x, y) 那一格的材质（没地回 null；画碎屑用） */
export function materialAt(t: Terrain, x: number, y: number, mats: Readonly<Record<string, Material>>): Material | null {
  const v = cellAt(t, Math.floor(x / CELL), Math.floor(y / CELL)) & MAT_MASK;
  return v ? (byCodeOf(mats).get(v) ?? null) : null;
}
