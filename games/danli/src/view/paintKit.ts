/**
 * 地形纹理、远景共用的小画法（美术交付的画法里抽出来的，老图和 0.4.0 的新图共用一份）：按位置的整数散列、平铺取点、写死种子的随机数、
 * 一片片半透明的椭圆、一圈圈的软光晕、云朵。都不用 Math.random，同样的输入每次画得一样。
 */
type Ctx = CanvasRenderingContext2D;
export type Rnd = () => number;
const TAU = Math.PI * 2;

export function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function tiles(x0: number, y0: number, w: number, h: number, T: number, fn: (tx: number, ty: number, x: number, y: number, v: number) => void): void {
  for (let ty = Math.floor(y0 / T) - 1; ty <= Math.floor((y0 + h) / T) + 1; ty++)
    for (let tx = Math.floor(x0 / T) - 1; tx <= Math.floor((x0 + w) / T) + 1; tx++) fn(tx, ty, tx * T + hash(tx + 7, ty) * T, ty * T + hash(tx, ty + 7) * T, hash(tx, ty));
}

export function lcg(seed: number): Rnd {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

export function blobs(ctx: Ctx, r: Rnd, n: number, color: string, alpha: number, x0: number, x1: number, y0: number, y1: number, rx0: number, rx1: number, ry0: number, ry1: number): void {
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    ctx.globalAlpha = alpha * (0.6 + r() * 0.4);
    ctx.beginPath(); ctx.ellipse(x0 + r() * (x1 - x0), y0 + r() * (y1 - y0), rx0 + r() * (rx1 - rx0), ry0 + r() * (ry1 - ry0), 0, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
/** 软光晕：一圈圈半透明的圆（代替模糊滤镜） */
export function halo(ctx: Ctx, x: number, y: number, r: number, color: string, alpha = 0.08, n = 6): void {
  ctx.fillStyle = color;
  for (let i = n; i >= 1; i--) { ctx.globalAlpha = alpha; ctx.beginPath(); ctx.arc(x, y, (r * i) / n, 0, TAU); ctx.fill(); }
  ctx.globalAlpha = 1;
}
export function cloud(ctx: Ctx, x: number, y: number, k: number, fill: string, line: string | null, alpha = 0.8): void {
  ctx.globalAlpha = alpha; ctx.fillStyle = fill; ctx.beginPath();
  ctx.ellipse(x, y, 60 * k, 22 * k, 0, 0, TAU); ctx.ellipse(x - 30 * k, y - 8 * k, 30 * k, 22 * k, 0, 0, TAU); ctx.ellipse(x + 22 * k, y - 18 * k, 34 * k, 26 * k, 0, 0, TAU);
  ctx.fill();
  if (line) { ctx.globalAlpha = 0.2; ctx.strokeStyle = line; ctx.lineWidth = 3; ctx.stroke(); }
  ctx.globalAlpha = 1;
}
