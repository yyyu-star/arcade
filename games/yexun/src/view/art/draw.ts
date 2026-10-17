/**
 * 程序画图的小工具：粗黑描边 + 平涂 + 一层阴影（画风见 DESIGN.md 第 7.1 节）。
 * 坐标都是世界单位，画布按 res（每单位几个像素）放大；描边粗细也按单位给，放大后粗细一致。
 */
export type Ctx = CanvasRenderingContext2D;
export type PathFn = (c: Ctx) => void;

/** 墨色：所有描边、眼睛都用它，不用纯黑（纯黑在雪地上太硬） */
export const INK = '#17131c';

/**
 * 画一块"卡通色块"：底色 → 右下一道阴影（同一形状往左上挪一点再盖一层底色，剩下的月牙就是阴影）→ 描边。
 * shade 为空时不画阴影；line 为 0 时不描边。
 */
export function blob(c: Ctx, path: PathFn, fill: string, shade: string | null = null, line = 2.4, shadeOff = 2.6): void {
  c.save();
  c.beginPath();
  path(c);
  c.closePath();
  if (shade) {
    c.fillStyle = shade;
    c.fill();
    c.save();
    c.clip();
    c.translate(-shadeOff, -shadeOff * 0.8);
    c.beginPath();
    path(c);
    c.closePath();
    c.fillStyle = fill;
    c.fill();
    c.restore();
    c.beginPath();
    path(c);
    c.closePath();
  } else {
    c.fillStyle = fill;
    c.fill();
  }
  if (line > 0) {
    c.lineWidth = line;
    c.lineJoin = 'round';
    c.lineCap = 'round';
    c.strokeStyle = INK;
    c.stroke();
  }
  c.restore();
}

export const ellipse =
  (x: number, y: number, rx: number, ry: number, rot = 0): PathFn =>
  (c) =>
    c.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);

export const circle = (x: number, y: number, r: number): PathFn => ellipse(x, y, r, r);

export const rrect =
  (x: number, y: number, w: number, h: number, r: number): PathFn =>
  (c) =>
    c.roundRect(x, y, w, h, r);

/** 折线围成的多边形 */
export const poly =
  (...pts: number[]): PathFn =>
  (c) => {
    c.moveTo(pts[0]!, pts[1]!);
    for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i]!, pts[i + 1]!);
  };

/** 一笔线（不闭合），墨色 */
export function stroke(c: Ctx, path: PathFn, width: number, color = INK): void {
  c.save();
  c.beginPath();
  path(c);
  c.lineWidth = width;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.strokeStyle = color;
  c.stroke();
  c.restore();
}

/** 只填色、不描边的小块（高光、腮红、花纹） */
export function dab(c: Ctx, path: PathFn, color: string, alpha = 1): void {
  c.save();
  c.globalAlpha = alpha;
  c.beginPath();
  path(c);
  c.fillStyle = color;
  c.fill();
  c.restore();
}

/** 美术用的确定性随机（每次打开画出来的雪地、碎片都一样，截图好对比）；画面层不受规则核心的限制，这里只是为了稳定 */
export function artRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
