/**
 * 焦痕的画法（DESIGN.md 2.3.1，0.3.0；美术代理 2026-10-22 交付，照原样改写进模块）：坑周围一圈还是地的格子，沾上这把武器的爆炸纹理。只是画面，不进规则。
 *
 * 怎么用（terrainArt.ts）：
 * - 每个地形块另有一张只增不减的焦痕层；新坑在挖完以后只往和它相交的层上画一次（按发生的先后，新的盖在旧的上面）。
 * - 烘焙地形块时，在"各材质填色和纹理 → 地表皮"之后、"材质间细线 → 外轮廓墨线"之前，裁到这一块"有地"的轮廓里把焦痕层贴上去：
 *   后来的坑把焦痕挖掉一块，那里没有地了，自然就裁掉了。
 *
 * 约定：
 * - 世界坐标，ctx 已经 setTransform 好；格子 4 单位，格子中心在 4k + 2（和 core/terrain.ts 一样）。
 * - 随机全用按位置算的整数散列（hash3），不用 Math.random；同样的输入每次画得一模一样，重放、重连、重新烘焙都一样。
 * - 不用 filter、shadowBlur、渐变；只有填色、描边、裁剪和 globalAlpha。每个坑的底色是 3 次 fill，图案按颜色合并成几次 fill / stroke。
 * - 焦痕宽度（从坑边往外）scorchWidth(r) = max(0.5 r, 10) 单位，越往外越淡，外沿是参差的；小坑也至少 10 单位（2.5 格），镜头 0.7 时还有 7 像素。
 *   有几样图案会多溅出去一点（西瓜汁滴、烟花的火星、奶茶往下淌），都算进 scorchReach。
 */
import { GROUND_TONE2 } from './mapArt2.ts';
import { craterReach, inCrater, type CraterKind } from '../core/craters.ts';

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
const CELL = 4;
const TAU = Math.PI * 2;
const INK = '#46291a';

/** 焦痕带的宽度（世界单位，从坑边往外） */
export function scorchWidth(r: number): number {
  return Math.max((r * 32) >> 6, 10);
}

/** 焦痕最远画到离爆心多远（世界单位，方框半边长）：地形块按它判断要不要画这个坑 */
export function scorchReach(r: number): number {
  return craterReach(r) + Math.ceil(scorchWidth(r) * 1.7) + 6;
}

/** 整数散列：同样的 (a, b, c) 永远回同一个 [0, 1) 的数 */
function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const SALT: Record<CraterKind, number> = { steamer: 11, melon: 23, paddle: 37, carrot: 41, rocket: 53, slipper: 67, frisbee: 79, milktea: 97 };

/** 焦痕带上的一格 */
interface Cell {
  /** 格子中心（世界坐标） */
  x: number;
  y: number;
  /** 离坑边多远（世界单位，约数）和归一化的 t = d / W（0 贴着坑边，1 是焦痕外沿） */
  d: number;
  t: number;
  /** 往外的方向（单位向量，按距离场的梯度） */
  nx: number;
  ny: number;
  /** 这一格的随机数种子（格子坐标 + 坑） */
  c: number;
  r: number;
  s: number;
  /** 正好贴着坑底：正上方一两格就是坑（奶茶往下淌、西瓜汁往下滴从这里起） */
  under: boolean;
}

/** 算这个坑的焦痕带：坑形 → 倒角距离场（3-4 权重）→ 带上的格子 */
function band(kind: CraterKind, cx: number, cy: number, r: number, W: number): Cell[] {
  const R = craterReach(r) + W + 2 * CELL;
  const c0 = Math.floor((cx - R) / CELL), c1 = Math.floor((cx + R) / CELL);
  const r0 = Math.floor((cy - R) / CELL), r1 = Math.floor((cy + R) / CELL);
  const nc = c1 - c0 + 1, nr = r1 - r0 + 1;
  const BIG = 1 << 20;
  const dist = new Int32Array(nc * nr);
  for (let j = 0; j < nr; j++)
    for (let i = 0; i < nc; i++) dist[j * nc + i] = inCrater(kind, (c0 + i) * CELL + 2 - cx, (r0 + j) * CELL + 2 - cy, r) ? 0 : BIG;
  const at = (i: number, j: number): number => (i < 0 || j < 0 || i >= nc || j >= nr ? BIG : dist[j * nc + i]!);
  for (let j = 0; j < nr; j++)
    for (let i = 0; i < nc; i++) {
      const k = j * nc + i;
      dist[k] = Math.min(dist[k]!, at(i - 1, j) + 3, at(i, j - 1) + 3, at(i - 1, j - 1) + 4, at(i + 1, j - 1) + 4);
    }
  for (let j = nr - 1; j >= 0; j--)
    for (let i = nc - 1; i >= 0; i--) {
      const k = j * nc + i;
      dist[k] = Math.min(dist[k]!, at(i + 1, j) + 3, at(i, j + 1) + 3, at(i + 1, j + 1) + 4, at(i - 1, j + 1) + 4);
    }
  const out: Cell[] = [];
  const salt = SALT[kind] + cx * 7 + cy * 131;
  for (let j = 0; j < nr; j++)
    for (let i = 0; i < nc; i++) {
      const v = dist[j * nc + i]!;
      if (v === 0) continue;
      // 距离场一步 3 = 一格 = 4 单位；格子中心离坑边还差半格
      const d = (v * CELL) / 3 - CELL / 2;
      if (d > W * 1.7) continue;
      let gx = Math.min(at(i + 1, j), BIG >> 1) - Math.min(at(i - 1, j), BIG >> 1);
      let gy = Math.min(at(i, j + 1), BIG >> 1) - Math.min(at(i, j - 1), BIG >> 1);
      const x = (c0 + i) * CELL + 2, y = (r0 + j) * CELL + 2;
      if (!gx && !gy) { gx = x - cx; gy = y - cy; }
      const len = Math.hypot(gx, gy) || 1;
      out.push({
        x, y, d, t: d / W, nx: gx / len, ny: gy / len, c: c0 + i, r: r0 + j, s: salt,
        under: at(i, j - 1) === 0 || at(i, j - 2) === 0,
      });
    }
  return out;
}

/** 这一格的第 k 个随机数 */
const rnd = (e: Cell, k: number): number => hash3(e.c * 31 + k, e.r * 17 - k, e.s);

/**
 * 底色的渍：越靠坑边叠得越多层（每层同一个 alpha，叠 3 层），外沿参差。只画在地上。
 * 每层是一条路径一次 fill：里面的格子用方块（并起来是一整片，便宜），只有外沿那三成用随机大小的圆点（毛边）。
 */
function wash(ctx: Ctx, cells: readonly Cell[], color: string, alpha: number, solid: (e: Cell) => boolean, reach = 1): void {
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  for (const lim of [reach, 0.62 * reach, 0.3 * reach]) {
    ctx.beginPath();
    for (const e of cells) {
      if (e.t >= lim || !solid(e)) continue;
      if (e.t < lim * 0.7) { ctx.rect(e.x - 2.6, e.y - 2.6, 5.2, 5.2); continue; }
      // 外沿：越靠外越可能缺一块，边是毛的
      if (rnd(e, 1) < (e.t - lim * 0.7) / (lim * 0.3)) continue;
      const rr = 2.7 + rnd(e, 2) * 1.6;
      const x = e.x + (rnd(e, 3) - 0.5) * 1.6, y = e.y + (rnd(e, 4) - 0.5) * 1.6;
      ctx.moveTo(x + rr, y);
      ctx.arc(x, y, rr, 0, TAU);
    }
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** 贴着坑边的一圈深色（武器的"签名色"，全图缩小时靠它认） */
function rim(ctx: Ctx, cells: readonly Cell[], color: string, alpha: number, solid: (e: Cell) => boolean, width = 0.22): void {
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  for (const e of cells) {
    if (e.t >= width || !solid(e)) continue;
    const rr = 2.6 + rnd(e, 5) * 1.2;
    ctx.moveTo(e.x + rr, e.y);
    ctx.arc(e.x, e.y, rr, 0, TAU);
  }
  ctx.fill();
  ctx.globalAlpha = 1;
}

/** 挑一部分格子放图案：密度 p(t)，靠坑边密、往外稀 */
function pick(cells: readonly Cell[], k: number, p: (t: number) => number, solid: (e: Cell) => boolean): Cell[] {
  return cells.filter((e) => solid(e) && rnd(e, k) < p(e.t));
}

/** 只在焦痕带（t < lim）的格子里画：把这些格子并成一条裁剪路径 */
function clipBand(ctx: Ctx, cells: readonly Cell[], lim: number, solid: (e: Cell) => boolean): void {
  const p = new Path2D();
  for (const e of cells) {
    if (e.t >= lim || !solid(e)) continue;
    if (e.t > lim * 0.75 && rnd(e, 6) < 0.5) continue;
    p.rect(e.x - 2.5, e.y - 2.5, 5, 5);
  }
  ctx.clip(p);
}

/** 四角小星（烟花的火星）：先一圈深色衬底再金色，浅色地上也看得见 */
function sparkle(ctx: Ctx, x: number, y: number, s: number): void {
  ctx.moveTo(x, y - s);
  ctx.quadraticCurveTo(x + s * 0.18, y - s * 0.18, x + s, y);
  ctx.quadraticCurveTo(x + s * 0.18, y + s * 0.18, x, y + s);
  ctx.quadraticCurveTo(x - s * 0.18, y + s * 0.18, x - s, y);
  ctx.quadraticCurveTo(x - s * 0.18, y - s * 0.18, x, y - s);
  ctx.closePath();
}

const PAINT: Record<CraterKind, (ctx: Ctx, cells: Cell[], W: number, cx: number, cy: number, solid: (e: Cell) => boolean, isSolid: (x: number, y: number) => boolean, R: number, tone: (x: number, y: number) => Tone) => void> = {
  // 包子：焦糖色烫痕（靠坑边深、往外淡）+ 蒸汽的白点（白点带焦糖色细边，白色的地上也看得见）
  steamer(ctx, cells, W, cx, cy, solid) {
    wash(ctx, cells, '#c27a34', 0.3, solid);
    rim(ctx, cells, '#94521e', 0.55, solid);
    const dots = pick(cells, 7, (t) => (t < 1 ? 0.2 * (1 - t * 0.6) : 0), solid);
    ctx.fillStyle = '#fffaf0';
    ctx.strokeStyle = '#b06a2a';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (const e of dots) {
      const rr = 1.3 + rnd(e, 8) * 1.7;
      const x = e.x + (rnd(e, 9) - 0.5) * 3, y = e.y + (rnd(e, 10) - 0.5) * 3;
      ctx.moveTo(x + rr, y);
      ctx.arc(x, y, rr, 0, TAU);
    }
    ctx.fill();
    ctx.globalAlpha = 0.8;
    ctx.stroke();
    // 几缕蒸汽：小 S 弯，白色
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = '#fffaf0';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const e of pick(cells, 11, (t) => (t > 0.25 && t < 0.9 ? 0.045 : 0), solid)) {
      const x = e.x, y = e.y;
      ctx.moveTo(x - 1, y + 4);
      ctx.quadraticCurveTo(x + 3, y + 2, x, y);
      ctx.quadraticCurveTo(x - 3, y - 2, x + 1, y - 4);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  },

  // 西瓜：红汁飞溅（底色 + 往外甩的长条汁滴）+ 黑籽（水滴形，随机朝向）+ 一两片绿皮
  melon(ctx, cells, W, cx, cy, solid, isSolid, R, tone) {
    wash(ctx, cells, '#e2432a', 0.3, solid, 0.85);
    rim(ctx, cells, '#b8281e', 0.6, solid, 0.25);
    // 汁滴：沿往外的方向拉长，一部分甩到焦痕外面（t 到 1.6）
    ctx.fillStyle = '#d93a2a';
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    for (const e of pick(cells, 12, (t) => (t < 0.5 ? 0.1 : t < 1.6 ? 0.07 : 0), solid)) {
      const len = 2.4 + rnd(e, 13) * 3.2, wd = 1.2 + rnd(e, 14) * 1.1;
      const a = Math.atan2(e.ny, e.nx);
      ctx.moveTo(e.x + Math.cos(a) * len, e.y + Math.sin(a) * len);
      ctx.ellipse(e.x, e.y, len, wd, a, 0, TAU);
      // 尾巴后面跟一颗小滴
      const tx = e.x + e.nx * (len + 2.6), ty = e.y + e.ny * (len + 2.6);
      if (isSolid(tx, ty)) { ctx.moveTo(tx + wd * 0.6, ty); ctx.arc(tx, ty, wd * 0.6, 0, TAU); }
    }
    ctx.fill();
    // 籽（水滴形：尖头 + 圆尾）
    const seeds = pick(cells, 15, (t) => (t < 0.95 ? 0.13 * (1.1 - t) : 0), solid);
    const seed = (e: Cell, k: number, grow: number): void => {
      const a = rnd(e, 16 + k) * TAU, x = e.x + (rnd(e, 17 + k) - 0.5) * 2, y = e.y + (rnd(e, 18 + k) - 0.5) * 2;
      const ux = Math.cos(a) * grow, uy = Math.sin(a) * grow;
      ctx.moveTo(x + ux * 2.6, y + uy * 2.6);
      ctx.quadraticCurveTo(x - uy * 1.6 + ux * 0.4, y + ux * 1.6 + uy * 0.4, x - ux * 1.4, y - uy * 1.4);
      ctx.quadraticCurveTo(x + uy * 1.6 + ux * 0.4, y - ux * 1.6 + uy * 0.4, x + ux * 2.6, y + uy * 2.6);
    };
    // 红色的地上（香肠、草莓、雨棚）红汁会糊进底色：黑籽先垫一圈奶白，再撒几颗白籽（没长熟的西瓜籽），靠黑白两色认出是西瓜
    const onRed = (e: Cell): boolean => tone(e.x, e.y) === 'red';
    const redSeeds = seeds.filter(onRed);
    if (redSeeds.length) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff6e8';
      ctx.beginPath();
      for (const e of redSeeds) seed(e, 0, 1.45);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#2b1d14';
    ctx.beginPath();
    for (const e of seeds) seed(e, 0, 1);
    ctx.fill();
    const white = pick(cells, 48, (t) => (t < 0.95 ? 0.11 * (1.1 - t) : 0), solid).filter(onRed);
    if (white.length) {
      ctx.fillStyle = '#fffaf0';
      ctx.strokeStyle = '#8a1e16';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      for (const e of white) seed(e, 40, 0.85);
      ctx.fill();
      ctx.stroke();
    }
    // 籽上一点白光（深色的地上也认得出是籽）
    ctx.fillStyle = '#fff3e0';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (const e of pick(cells, 15, (t) => (t < 0.95 ? 0.13 * (1.1 - t) : 0), solid)) {
      const x = e.x + (rnd(e, 17) - 0.5) * 2, y = e.y + (rnd(e, 18) - 0.5) * 2;
      ctx.moveTo(x - 0.2, y - 0.5);
      ctx.arc(x - 0.6, y - 0.5, 0.45, 0, TAU);
    }
    ctx.fill();
    // 瓜皮碎片：绿色小弧（少）
    ctx.globalAlpha = 1;
    ctx.lineCap = 'round';
    const rinds = pick(cells, 19, (t) => (t > 0.3 && t < 1.1 ? 0.03 : 0), solid);
    for (const [col, w] of [['#2f7a2a', 3.2], ['#9fd77e', 1.3]] as const) {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      for (const e of rinds) {
        const a = Math.atan2(e.ny, e.nx) + Math.PI / 2 + (rnd(e, 20) - 0.5);
        const ux = Math.cos(a) * 3.4, uy = Math.sin(a) * 3.4;
        ctx.moveTo(e.x - ux, e.y - uy);
        ctx.quadraticCurveTo(e.x + e.nx * 1.8, e.y + e.ny * 1.8, e.x + ux, e.y + uy);
      }
      ctx.stroke();
    }
  },

  // 烟花：黑灰（底色 + 往外的放射状黑道）+ 金色火星（四角小星，带深色衬边）+ 几颗红火点
  rocket(ctx, cells, W, cx, cy, solid, isSolid) {
    wash(ctx, cells, '#3a302c', 0.26, solid);
    rim(ctx, cells, '#241c18', 0.62, solid, 0.3);
    // 放射状的黑道：从坑边往外，细长三角
    ctx.fillStyle = '#2a221e';
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    for (const e of pick(cells, 21, (t) => (t < 0.2 ? 0.28 : 0), solid)) {
      const L = W * (0.7 + rnd(e, 22) * 0.6), w = 1.5 + rnd(e, 23);
      ctx.moveTo(e.x - e.ny * w, e.y + e.nx * w);
      ctx.lineTo(e.x + e.nx * L, e.y + e.ny * L);
      ctx.lineTo(e.x + e.ny * w, e.y - e.nx * w);
      ctx.closePath();
    }
    ctx.fill();
    // 火星：散到焦痕外一点
    const sp = pick(cells, 24, (t) => (t < 1.5 ? 0.075 * (1.6 - t) : 0), solid);
    const size = (e: Cell): number => 2.4 + rnd(e, 25) * 2.6;
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#46291a';
    ctx.beginPath();
    for (const e of sp) sparkle(ctx, e.x, e.y, size(e) + 1.1);
    ctx.fill();
    ctx.fillStyle = '#ffc928';
    ctx.beginPath();
    for (const e of sp) sparkle(ctx, e.x, e.y, size(e));
    ctx.fill();
    ctx.fillStyle = '#fffbe0';
    ctx.beginPath();
    for (const e of sp) { ctx.moveTo(e.x + 0.9, e.y); ctx.arc(e.x, e.y, 0.9, 0, TAU); }
    ctx.fill();
    // 红火点
    ctx.fillStyle = '#ff6a3a';
    ctx.beginPath();
    for (const e of pick(cells, 26, (t) => (t < 1.2 ? 0.05 : 0), solid)) {
      if (!isSolid(e.x, e.y)) continue;
      ctx.moveTo(e.x + 1.2, e.y);
      ctx.arc(e.x, e.y, 1.2, 0, TAU);
    }
    ctx.fill();
  },

  // 奶茶：褐色茶渍（外沿一道更深的干渍边，像杯底印）+ 往下淌的流痕 + 珍珠（深褐圆、白高光）+ 几抹奶白
  milktea(ctx, cells, W, cx, cy, solid, isSolid) {
    wash(ctx, cells, '#a8723f', 0.3, solid, 0.9);
    // 干渍边：t 在 0.72–0.9 的一圈，深一点
    ctx.fillStyle = '#7a4a28';
    ctx.globalAlpha = 0.4;
    ctx.beginPath();
    for (const e of cells) {
      if (e.t < 0.7 || e.t > 0.9 || !solid(e) || rnd(e, 27) < 0.25) continue;
      ctx.moveTo(e.x + 2.4, e.y);
      ctx.arc(e.x, e.y, 2.4, 0, TAU);
    }
    ctx.fill();
    rim(ctx, cells, '#6a3e20', 0.5, solid, 0.2);
    // 往下淌：从坑底下沿起，竖着的圆头条
    ctx.strokeStyle = '#9a6234';
    ctx.globalAlpha = 0.6;
    ctx.lineCap = 'round';
    for (const e of cells) {
      if (!e.under || !solid(e) || e.t > 0.3 || rnd(e, 28) > 0.35) continue;
      const L = W * (0.9 + rnd(e, 29) * 0.8), w = 2.2 + rnd(e, 30) * 1.6;
      let y1 = e.y;
      while (y1 < e.y + L && isSolid(e.x, y1 + 2)) y1 += 2;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(e.x, y1);
      ctx.stroke();
      ctx.beginPath();
      ctx.fillStyle = '#9a6234';
      ctx.arc(e.x, y1, w * 0.75, 0, TAU);
      ctx.fill();
    }
    // 奶白：几道弯弯的浅色
    ctx.strokeStyle = '#fff3dc';
    ctx.lineWidth = 1.8;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (const e of pick(cells, 31, (t) => (t > 0.15 && t < 0.75 ? 0.05 : 0), solid)) {
      const tx = -e.ny * 3.6, ty = e.nx * 3.6;
      ctx.moveTo(e.x - tx, e.y - ty);
      ctx.quadraticCurveTo(e.x + e.nx * 2, e.y + e.ny * 2, e.x + tx, e.y + ty);
    }
    ctx.stroke();
    // 珍珠
    const pearls = pick(cells, 32, (t) => (t < 1 ? 0.085 * (1.15 - t) : 0), solid);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#3a2418';
    ctx.beginPath();
    for (const e of pearls) { const rr = 2.3 + rnd(e, 33) * 0.9; ctx.moveTo(e.x + rr, e.y); ctx.arc(e.x, e.y, rr, 0, TAU); }
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    for (const e of pearls) { ctx.moveTo(e.x - 0.2, e.y - 0.9); ctx.arc(e.x - 0.8, e.y - 0.9, 0.7, 0, TAU); }
    ctx.fill();
    ctx.globalAlpha = 1;
  },

  // 萝卜：浅橙底 + 橙色刨花（弯弯的卷）+ 碎块（橙色、深橙细边）+ 一点绿叶碎
  carrot(ctx, cells, W, cx, cy, solid) {
    wash(ctx, cells, '#f59a3c', 0.24, solid, 0.85);
    rim(ctx, cells, '#d0601a', 0.5, solid, 0.2);
    ctx.lineCap = 'round';
    // 刨花：两层（深橙衬底、亮橙）
    const curls = pick(cells, 34, (t) => (t < 1 ? 0.075 * (1.2 - t) : 0), solid);
    for (const [col, w] of [['#b34f12', 3], ['#f68a2c', 1.7]] as const) {
      ctx.strokeStyle = col;
      ctx.lineWidth = w;
      ctx.beginPath();
      for (const e of curls) {
        const a = rnd(e, 35) * TAU, s = 2.6 + rnd(e, 36) * 1.6;
        ctx.moveTo(e.x + Math.cos(a) * s, e.y + Math.sin(a) * s);
        ctx.arc(e.x, e.y, s, a, a + 3.6);
      }
      ctx.stroke();
    }
    // 碎块
    ctx.fillStyle = '#f27f22';
    ctx.strokeStyle = '#a8440e';
    ctx.lineWidth = 0.9;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (const e of pick(cells, 37, (t) => (t < 0.9 ? 0.07 : 0), solid)) {
      const s = 1.8 + rnd(e, 38) * 1.4, a = rnd(e, 39) * TAU;
      for (let k = 0; k < 3; k++) {
        const b = a + (k * TAU) / 3, x = e.x + Math.cos(b) * s, y = e.y + Math.sin(b) * s;
        if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
    // 绿叶碎
    ctx.fillStyle = '#4f9a36';
    ctx.beginPath();
    for (const e of pick(cells, 40, (t) => (t > 0.2 && t < 1 ? 0.025 : 0), solid)) {
      const a = rnd(e, 41) * TAU;
      ctx.moveTo(e.x + Math.cos(a) * 3, e.y + Math.sin(a) * 3);
      ctx.ellipse(e.x, e.y, 3, 1.3, a, 0, TAU);
    }
    ctx.fill();
  },

  // 拖鞋：橡胶灰底 + 鞋纹（横着一排排的人字纹，深灰压痕下面跟一道浅色高光）
  slipper(ctx, cells, W, cx, cy, solid, isSolid, R) {
    wash(ctx, cells, '#6f6b68', 0.26, solid, 0.95);
    rim(ctx, cells, '#45403d', 0.55, solid, 0.22);
    ctx.save();
    clipBand(ctx, cells, 0.95, solid);
    // 人字纹以爆心为原点排：行距 6，人字宽 8；离爆心越远越淡（分两层画）
    const draw = (col: string, off: number, lw: number): void => {
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.beginPath();
      for (let y = -R; y <= R; y += 6)
        for (let x = -R + ((y / 6) & 1) * 4; x <= R; x += 8) {
          ctx.moveTo(cx + x - 3, cy + y + 1.6 + off);
          ctx.lineTo(cx + x, cy + y - 1.4 + off);
          ctx.lineTo(cx + x + 3, cy + y + 1.6 + off);
        }
      ctx.stroke();
    };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.5;
    draw('#e8e4de', 1, 1.2);
    ctx.globalAlpha = 0.75;
    draw('#3e3a37', 0, 1.6);
    ctx.restore();
    // 几颗蓝色的鞋带碎屑（拖鞋的颜色）
    ctx.fillStyle = '#3f86d8';
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    for (const e of pick(cells, 42, (t) => (t > 0.2 && t < 1 ? 0.03 : 0), solid)) { ctx.moveTo(e.x + 1.8, e.y); ctx.arc(e.x, e.y, 1.8, 0, TAU); }
    ctx.fill();
    ctx.globalAlpha = 1;
  },

  // 飞盘：彩色擦痕：粉、紫、金三色的弧线，顺着坑边的方向擦过去（不是往外放射）
  frisbee(ctx, cells, W, cx, cy, solid) {
    wash(ctx, cells, '#f27cb0', 0.14, solid, 0.8);
    rim(ctx, cells, '#c0447e', 0.45, solid, 0.2);
    ctx.lineCap = 'round';
    const marks = pick(cells, 43, (t) => (t < 1.05 ? 0.26 * (1.15 - t) : 0), solid);
    const cols = ['#e8569a', '#8c6be0', '#f5ad00'];
    for (let k = 0; k < 3; k++) {
      ctx.strokeStyle = cols[k]!;
      ctx.beginPath();
      for (const e of marks) {
        if (Math.floor(rnd(e, 44) * 3) !== k) continue;
        const L = 3.5 + rnd(e, 45) * 4.5, bow = 1.4 + rnd(e, 46) * 1.4;
        const tx = -e.ny * L, ty = e.nx * L;
        ctx.moveTo(e.x - tx, e.y - ty);
        ctx.quadraticCurveTo(e.x + e.nx * bow, e.y + e.ny * bow, e.x + tx, e.y + ty);
      }
      ctx.lineWidth = 2.4;
      ctx.globalAlpha = 0.9;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  },

  // 球拍：网格压痕：以爆心为原点、6 单位一格的拍线，深色压痕 + 右下一道浅色高光；外加两三个紫色球印
  paddle(ctx, cells, W, cx, cy, solid, isSolid, R, tone) {
    wash(ctx, cells, '#7f93a3', 0.2, solid, 0.95);
    rim(ctx, cells, '#4f6272', 0.5, solid, 0.22);
    const grid = (col: string, off: number, lw: number, alpha: number, lim: number): void => {
      ctx.save();
      clipBand(ctx, cells, lim, solid);
      ctx.strokeStyle = col;
      ctx.lineWidth = lw;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      for (let k = -R; k <= R; k += 6) {
        ctx.moveTo(cx + k + off, cy - R);
        ctx.lineTo(cx + k + off, cy + R);
        ctx.moveTo(cx - R, cy + k + off);
        ctx.lineTo(cx + R, cy + k + off);
      }
      ctx.stroke();
      ctx.restore();
    };
    // 浅色的地上（面团、香草、雪、米饭……）蓝灰网格太淡：焦痕带里一半以上是浅色地时，压痕加深一档（更深、更粗、更不透明）
    let light = 0, all = 0;
    for (const e of cells) if (e.t < 1 && solid(e)) { all++; if (tone(e.x, e.y) === 'light') light++; }
    const deep = light * 2 >= all;
    grid('#ffffff', 0.9, 1, 0.6, 1);
    grid(deep ? '#26364a' : '#3c4e60', 0, deep ? 1.5 : 1.3, deep ? 0.8 : 0.6, 1);
    grid(deep ? '#26364a' : '#3c4e60', 0, deep ? 1.5 : 1.3, deep ? 0.45 : 0.35, 0.5);
    // 球印：淡紫色小圆圈
    ctx.strokeStyle = '#a26be0';
    ctx.lineWidth = 1.4;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    for (const e of pick(cells, 47, (t) => (t > 0.3 && t < 0.9 ? 0.03 : 0), solid)) { ctx.moveTo(e.x + 3, e.y); ctx.arc(e.x, e.y, 3, 0, TAU); }
    ctx.stroke();
    ctx.globalAlpha = 1;
  },
};

/** 底色的深浅：只有两处图案要看底色（球拍网格在浅色地上加深，西瓜在红色地上加白籽） */
export type Tone = 'red' | 'light' | null;

/** 材质 id → 底色（材质的中间色亮度 ≥ 0.82 算浅色；香肠、草莓、红白雨棚算红色）。不在表里的是 null */
export const GROUND_TONE: Readonly<Record<string, Tone>> = {
  ...GROUND_TONE2,
  sausage: 'red', strawberry: 'red', awning: 'red',
  dough: 'light', mint: 'light', berry: 'light', vanilla: 'light', snow: 'light', dumpling: 'light', rice: 'light', tamago: 'light',
  tempura: 'light', toast: 'light', eggwhite: 'light', butter: 'light', mug: 'light',
};

/**
 * 画一个坑的焦痕。ctx 是世界坐标；(cx, cy, r) 和规则核心挖坑时一样（r 已按颗数缩小）；
 * isSolid(x, y) 回世界坐标那一点现在是不是地（画面那份地形），焦痕只画在地上。
 * ground(x, y)（可选）回那一点的材质 id（画面那份地形的材质码查 MATERIALS 得到），按 GROUND_TONE 分深浅；不给就当普通底色。
 * 调用方最好先把 ctx 裁到"有地"的轮廓里（图案的边缘才是干净的）；函数自己会 save / restore。
 */
export function paintScorch(ctx: Ctx, kind: CraterKind, cx: number, cy: number, r: number, isSolid: (x: number, y: number) => boolean, ground?: (x: number, y: number) => string | null): void {
  const W = scorchWidth(r);
  const cells = band(kind, cx, cy, r, W);
  const memo = new Map<Cell, boolean>();
  const solid = (e: Cell): boolean => {
    let v = memo.get(e);
    if (v === undefined) memo.set(e, (v = isSolid(e.x, e.y)));
    return v;
  };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const tone = (x: number, y: number): Tone => {
    const id = ground?.(x, y);
    return id ? (GROUND_TONE[id] ?? null) : null;
  };
  PAINT[kind](ctx, cells, W, cx, cy, solid, isSolid, scorchReach(r), tone);
  ctx.restore();
}

/** 画面用、规则不用的常量（给开发对照） */
export const SCORCH_VIEW = { CELL, INK };
