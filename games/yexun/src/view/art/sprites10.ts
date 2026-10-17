/**
 * 第十批：夜探镇子的建筑（俯视 3/4 角度的中式建筑）。规则层挡路的矩形（院墙、正房）形状不动，只换画法。
 *
 * 投影：屏幕 = (x, y − z)。脚印（挡路的矩形）就是房子、墙在地上的范围，所以玩家撞到的地方就是画出来的墙根、屋檐下的台基；
 * 越高的东西越往上画（墙头、屋脊），从南边看过去只看得见朝南的立面和屋顶，东西两面是侧着的。
 * - 横的屋子：正脊东西走向，瓦垄南北走向（屏幕上竖着），北坡被压成窄窄一条，南坡大；檐下是朝南的立面（门窗透暖光、灯笼）；
 * - 竖的屋子：正脊南北走向，瓦垄朝东西两边斜着坡下去（屏幕上是一排排 "八" 字），南头是山墙（⌂ 形，有亮窗），北头是屋脊翘起的尖；
 * - 院墙：墙头是一道小两坡瓦顶，横墙露出朝南的墙面，竖墙从上往下看是一条带脊的窄瓦顶（两边瓦垄斜下，檐口一排瓦当），断口处露出墙头和墙面；
 * - 积雪只是瓦垄上、脊上一块块不规则的白，不压成直线。
 *
 * 这些图都按局里的实际尺寸画（院墙是可平铺的一段 + 两头的端头），由 town.ts 按画面清晰度画成单独的贴图；不进图集。
 * 图集里只留院里的小棚（shed_*）。
 * 三种样式：town（古镇：白墙青瓦）、temple（山寺和各处的庙、石兽院：红墙黄瓦）、hut（渡口：木板墙；屋子是茅草顶，院墙是青瓦墙头）。
 */
import type { SpriteDef } from './sprites.ts';
import { INK, artRng, blob, circle, dab, ellipse, poly, rrect, stroke, type Ctx } from './draw.ts';

export type Style = 'town' | 'temple' | 'hut';
export const STYLES: readonly Style[] = ['town', 'temple', 'hut'];

/** 院墙：墙身高（檐口）、墙头脊高、墙头外挑 */
export const WALL_Z = 50;
export const WALL_RIDGE = 62;
export const WALL_OV = 5;
/** 正房：檐口高、正脊高、屋檐外挑 */
export const HOUSE_Z = 78;
export const HOUSE_RIDGE = 114;
export const HOUSE_OV = 10;
/** 平铺的周期：横墙按 x，竖墙按屏幕 y（瓦垄 8 一道，周期是它的整数倍） */
export const WALL_H_PERIOD = 480;
export const WALL_V_PERIOD = 240;
/** 竖墙平铺贴图的左右边（相对墙脚印的 x） */
export const WALL_V_X0 = -9;
export const WALL_V_X1 = 9;

const SNOW = '#f6f9fd';
const SNOW_D = '#c9d5e6';
const SNOW_S = 'rgba(52,64,108,0.5)';
const GLOW = '#ffcf6a';
const GLOW_L = '#fff2c0';

interface Pal {
  tile: string;
  tileD: string;
  tileL: string;
  groove: string;
  ridge: string;
  ridgeL: string;
  wall: string;
  wallD: string;
  plinth: string;
  plinthL: string;
  col: string;
  colD: string;
  frame: string;
  door: string;
}

const PAL: Record<Style, Pal> = {
  town: {
    tile: '#4f586c', tileD: '#353b4a', tileL: '#8592a8', groove: '#1d212b', ridge: '#272b35', ridgeL: '#5e687d',
    wall: '#ebe7de', wallD: '#c3c1bb', plinth: '#5d6676', plinthL: '#8790a0', col: '#5e3828', colD: '#3e2419', frame: '#3f2519', door: '#7c2c22',
  },
  temple: {
    tile: '#dea52e', tileD: '#a5690f', tileL: '#fbdc7c', groove: '#7a4806', ridge: '#c07a18', ridgeL: '#f6cf62',
    wall: '#b03a2c', wallD: '#7c231a', plinth: '#7a736c', plinthL: '#a29a92', col: '#a52a1f', colD: '#6e1912', frame: '#5c1a12', door: '#b8352a',
  },
  hut: {
    tile: '#b39253', tileD: '#7d5f2c', tileL: '#dcc590', groove: '#5e451e', ridge: '#7a5a28', ridgeL: '#c9a968',
    wall: '#8f6b48', wallD: '#5f4630', plinth: '#5d564e', plinthL: '#837b71', col: '#4e3424', colD: '#33221a', frame: '#3e2a1e', door: '#6a4630',
  },
};

/** 墙头的瓦：渡口的院墙也是青瓦墙头（只有屋子是茅草顶） */
const capPal = (st: Style): Pal => (st === 'hut' ? PAL.town : PAL[st]);

/** 一张按实际尺寸画的图：w × h 世界单位，参考点（脚印左上角）在图里的 (ax, ay)；draw 以参考点为原点画 */
export interface Piece {
  w: number;
  h: number;
  ax: number;
  ay: number;
  draw: (c: Ctx) => void;
}

// ───────────────────────── 小零件 ─────────────────────────

/**
 * 一块不规则的积雪：上沿几个鼓包，下沿顺着瓦沟往坡下淌出几条舌头（(tx, ty) 是坡下的方向），
 * 底下一道蓝灰的影子，左上一点高光。不是一条直线、也不是一颗药丸。
 */
function snowPatch(c: Ctx, x: number, y: number, rx: number, ry: number, r: () => number, tx = 0, ty = 1, gap = 9): void {
  const px = -ty;
  const py = tx;
  const parts: [number, number, number, number][] = [];
  const n = 2 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : (i / (n - 1) - 0.5) * 1.2;
    const along = (r() - 0.5) * ry * 0.6;
    parts.push([x + px * t * rx + tx * along, y + py * t * rx + ty * along, rx * (0.42 + r() * 0.3), ry * (0.65 + r() * 0.5)]);
  }
  // 舌头：沿坡下方向的细长椭圆，隔一条瓦沟一条
  const tongues: [number, number, number, number, number][] = [];
  const m = Math.max(1, Math.floor((rx * 1.6) / gap));
  for (let i = 0; i < m; i++) {
    if (r() < 0.45) continue;
    const off = (i - (m - 1) / 2) * gap + (r() - 0.5) * 2;
    const len = ry * (0.35 + r() * 0.7);
    const cx = x + px * off + tx * (ry * 0.4 + len * 0.6);
    const cy = y + py * off + ty * (ry * 0.4 + len * 0.6);
    tongues.push([cx, cy, len, 2 + r() * 1.6, Math.atan2(ty, tx)]);
  }
  const fill = (dx: number, dy: number, col: string, grow = 0): void => {
    c.beginPath();
    for (const [qx, qy, qrx, qry] of parts) {
      c.moveTo(qx + dx + qrx + grow, qy + dy);
      c.ellipse(qx + dx, qy + dy, qrx + grow, qry + grow, 0, 0, Math.PI * 2);
    }
    for (const [qx, qy, len, w, rot] of tongues) {
      c.moveTo(qx + dx + Math.cos(rot) * (len + grow), qy + dy + Math.sin(rot) * (len + grow));
      c.ellipse(qx + dx, qy + dy, len + grow, w + grow, rot, 0, Math.PI * 2);
    }
    c.fillStyle = col;
    c.fill();
  };
  fill(0.5, 1.4, SNOW_S, 0.5);
  fill(0, 0.8, SNOW_D);
  fill(0, 0, SNOW);
  const [hx, hy, hrx, hry] = parts[0]!;
  dab(c, ellipse(hx - hrx * 0.15, hy - hry * 0.35, hrx * 0.45, Math.max(0.8, hry * 0.28)), '#ffffff', 0.9);
}

/** 红灯笼（挂点在 x, y）：一圈暖光、灯身、金色上下口 */
export function lantern(c: Ctx, x: number, y: number, s = 1): void {
  const g = c.createRadialGradient(x, y + 11 * s, 1, x, y + 11 * s, 26 * s);
  g.addColorStop(0, 'rgba(255,196,110,0.6)');
  g.addColorStop(1, 'rgba(255,196,110,0)');
  c.fillStyle = g;
  c.fillRect(x - 28 * s, y - 16 * s, 56 * s, 56 * s);
  stroke(c, (k) => { k.moveTo(x, y); k.lineTo(x, y + 4 * s); }, 1.4);
  blob(c, ellipse(x, y + 11.5 * s, 6.4 * s, 7.6 * s), '#e6462f', '#b52e1d', 1.8, 1.4);
  dab(c, ellipse(x - 0.6 * s, y + 11 * s, 2.6 * s, 4.8 * s), '#ffd67c', 0.85);
  blob(c, rrect(x - 3.4 * s, y + 3.4 * s, 6.8 * s, 2.2 * s, 0.8), '#e8b84a', null, 1);
  blob(c, rrect(x - 3.4 * s, y + 18.6 * s, 6.8 * s, 2.2 * s, 0.8), '#e8b84a', null, 1);
  stroke(c, (k) => { k.moveTo(x, y + 21 * s); k.lineTo(x, y + 26 * s); }, 1.6, '#f2c94c');
}

/** 透光的格子窗：外框、暖光、木棂（步步锦），外面一圈晕 */
function lattice(c: Ctx, x: number, y: number, w: number, h: number, frame: string, bright = 1): void {
  const g = c.createRadialGradient(x + w / 2, y + h / 2, 2, x + w / 2, y + h / 2, Math.max(w, h) * 0.95);
  g.addColorStop(0, `rgba(255,200,110,${0.45 * bright})`);
  g.addColorStop(1, 'rgba(255,200,110,0)');
  c.fillStyle = g;
  c.fillRect(x - w * 0.5, y - h * 0.5, w * 2, h * 2);
  blob(c, rrect(x, y, w, h, 1.2), frame, null, 1.8);
  const ig = c.createLinearGradient(x, y, x, y + h);
  ig.addColorStop(0, bright > 0.6 ? GLOW_L : '#f1d79a');
  ig.addColorStop(1, bright > 0.6 ? GLOW : '#c99a52');
  c.fillStyle = ig;
  c.fillRect(x + 2, y + 2, w - 4, h - 4);
  c.save();
  c.beginPath();
  c.rect(x + 2, y + 2, w - 4, h - 4);
  c.clip();
  c.strokeStyle = frame;
  c.lineWidth = 1.1;
  c.beginPath();
  const step = 5;
  for (let xx = x + 2 + step; xx < x + w - 2; xx += step) { c.moveTo(xx, y + 2); c.lineTo(xx, y + h - 2); }
  for (let yy = y + 2 + step; yy < y + h - 2; yy += step) { c.moveTo(x + 2, yy); c.lineTo(x + w - 2, yy); }
  c.stroke();
  c.restore();
}

/** 屋檐下的影子：从檐口往下一道渐暗 */
function eaveShade(c: Ctx, x0: number, x1: number, y: number, h: number, a = 0.5): void {
  const g = c.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, `rgba(14,16,34,${a})`);
  g.addColorStop(1, 'rgba(14,16,34,0)');
  c.fillStyle = g;
  c.fillRect(x0, y, x1 - x0, h);
}

function clipTo(c: Ctx, path: (k: Ctx) => void, body: () => void): void {
  c.save();
  c.beginPath();
  path(c);
  c.closePath();
  c.clip();
  body();
  c.restore();
}

function fillPath(c: Ctx, path: (k: Ctx) => void, col: string | CanvasGradient): void {
  c.beginPath();
  path(c);
  c.closePath();
  c.fillStyle = col;
  c.fill();
}

function inkPath(c: Ctx, path: (k: Ctx) => void, w = 2.2, closed = true): void {
  c.save();
  c.beginPath();
  path(c);
  if (closed) c.closePath();
  c.lineWidth = w;
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.strokeStyle = INK;
  c.stroke();
  c.restore();
}

/**
 * 一排排瓦垄：每条线是一垄筒瓦（亮的一条带高光）和旁边的板瓦沟（暗）。lines 给每垄的起止点（屏幕坐标），
 * side 是高光偏哪边（垂直于线的方向上的偏移）。茅草顶改成一缕缕草。
 */
function tileRows(c: Ctx, st: Style, p: Pal, lines: [number, number, number, number][], s: number, hx: number, hy: number): void {
  if (st === 'hut') {
    const r = artRng(lines.length * 7 + 3);
    for (const [ax, ay, bx, by] of lines) {
      for (let k = 0; k < 3; k++) {
        const o = (r() - 0.5) * s;
        const t0 = r() * 0.3;
        const t1 = 0.6 + r() * 0.4;
        stroke(c, (q) => { q.moveTo(ax + (bx - ax) * t0 + hx * o, ay + (by - ay) * t0 + hy * o); q.lineTo(ax + (bx - ax) * t1 + hx * o, ay + (by - ay) * t1 + hy * o); }, 1, r() < 0.5 ? p.tileL : p.groove);
      }
    }
    return;
  }
  const r = artRng(lines.length * 13 + 1);
  // 板瓦沟（暗）、筒瓦（本色带高光），每垄深浅略有出入
  c.save();
  c.lineCap = 'butt';
  for (const [ax, ay, bx, by] of lines) {
    const gx = hx * s * 0.5;
    const gy = hy * s * 0.5;
    c.strokeStyle = p.groove;
    c.lineWidth = s * 0.3;
    c.beginPath(); c.moveTo(ax + gx, ay + gy); c.lineTo(bx + gx, by + gy); c.stroke();
    const v = r();
    if (v < 0.3 || v > 0.8) {
      c.strokeStyle = v < 0.3 ? 'rgba(10,12,24,0.16)' : 'rgba(255,255,255,0.1)';
      c.lineWidth = s * 0.55;
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(bx, by); c.stroke();
    }
    c.strokeStyle = p.tileL;
    c.lineWidth = s * 0.2;
    c.globalAlpha = 0.85;
    c.beginPath(); c.moveTo(ax - hx * s * 0.16, ay - hy * s * 0.16); c.lineTo(bx - hx * s * 0.16, by - hy * s * 0.16); c.stroke();
    c.globalAlpha = 1;
  }
  // 筒瓦一节节：每节下沿一道朝坡下鼓的弧（一排排鱼鳞似的瓦），一笔画完
  c.strokeStyle = 'rgba(14,16,28,0.55)';
  c.lineWidth = Math.max(0.8, s * 0.1);
  c.beginPath();
  const step = s * 0.85;
  for (const [ax, ay, bx, by] of lines) {
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1) continue;
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    const half = s * 0.3;
    for (let d = step * (0.5 + r() * 0.5); d < len - 1; d += step) {
      const cx = ax + ux * d;
      const cy = ay + uy * d;
      c.moveTo(cx - hx * half, cy - hy * half);
      c.quadraticCurveTo(cx + ux * half * 1.1, cy + uy * half * 1.1, cx + hx * half, cy + hy * half);
    }
  }
  c.stroke();
  c.restore();
}

/** 瓦当和滴水：沿檐口一排（pts 是每垄的檐口点），茅草是一绺绺草须 */
function drips(c: Ctx, st: Style, p: Pal, pts: [number, number][], dx: number, dy: number, rr = 2.6): void {
  if (st === 'hut') {
    for (const [x, y] of pts) stroke(c, (k) => { k.moveTo(x - dx * 2, y - dy * 2); k.lineTo(x + dx * 4, y + dy * 4); }, 2.2, p.tileD);
    return;
  }
  for (const [x, y] of pts) {
    blob(c, circle(x + dx, y + dy, rr), p.tileL, p.tileD, 1.3, 0.8);
  }
}

/** 正脊两端起翘：town 燕尾（尖尖的一钩），temple 鸱吻（大而卷），hut 草脊扎一束 */
function ridgeEnd(c: Ctx, st: Style, p: Pal, x: number, y: number, dir: number, s = 1): void {
  if (st === 'hut') {
    blob(c, ellipse(x, y - 2 * s, 6 * s, 6 * s), p.ridge, p.tileD, 1.8, 1);
    stroke(c, (k) => { k.moveTo(x - 3 * s, y - 6 * s); k.lineTo(x + 3 * s, y + 2 * s); }, 1.4, p.groove);
    return;
  }
  if (st === 'temple') {
    blob(c, (k) => {
      k.moveTo(x - dir * 4 * s, y + 4 * s);
      k.lineTo(x - dir * 5 * s, y - 10 * s);
      k.quadraticCurveTo(x - dir * 6 * s, y - 24 * s, x + dir * 4 * s, y - 25 * s);
      k.quadraticCurveTo(x + dir * 13 * s, y - 24 * s, x + dir * 11 * s, y - 14 * s);
      k.quadraticCurveTo(x + dir * 6 * s, y - 18 * s, x + dir * 4 * s, y - 12 * s);
      k.quadraticCurveTo(x + dir * 9 * s, y - 6 * s, x + dir * 8 * s, y + 4 * s);
    }, p.ridge, p.tileD, 2, 1.4);
    dab(c, circle(x + dir * 1 * s, y - 15 * s, 1.6 * s), '#fff2b0', 0.9);
    stroke(c, (k) => { k.moveTo(x - dir * 2 * s, y - 5 * s); k.lineTo(x + dir * 5 * s, y - 5 * s); }, 1, p.groove);
    return;
  }
  // 燕尾：从脊端往外、往上甩出去一个尖
  blob(c, (k) => {
    k.moveTo(x - dir * 6 * s, y + 3 * s);
    k.lineTo(x - dir * 6 * s, y - 6 * s);
    k.quadraticCurveTo(x + dir * 4 * s, y - 7 * s, x + dir * 15 * s, y - 20 * s);
    k.quadraticCurveTo(x + dir * 11 * s, y - 6 * s, x + dir * 4 * s, y + 3 * s);
  }, p.ridge, p.groove, 1.8, 1);
  dab(c, poly(x - dir * 4 * s, y - 5 * s, x + dir * 4 * s, y - 6 * s, x + dir * 12 * s, y - 16 * s), p.ridgeL, 0.7);
}

/** 檐角起翘：檐口转角处朝外、朝上甩出的一钩 */
function horn(c: Ctx, p: Pal, x: number, y: number, dx: number, dy: number, s = 1): void {
  blob(c, (k) => {
    k.moveTo(x - dx * 3 * s, y + 2 * s);
    k.quadraticCurveTo(x + dx * 7 * s, y + 3 * s, x + dx * 11 * s, y + dy * 9 * s);
    k.quadraticCurveTo(x + dx * 5 * s, y - 2 * s, x - dx * 3 * s, y - 3.5 * s);
  }, p.tileL, p.tileD, 1.8, 1);
}

// ───────────────────────── 横的屋顶（正脊东西向） ─────────────────────────

interface RoofH {
  /** 屋顶覆盖的 x 范围（含外挑） */
  x0: number;
  x1: number;
  /** 脚印南北深 */
  d: number;
  ze: number;
  zr: number;
  ov: number;
  /** 檐角起翘多少 */
  lift: number;
  /** 歇山/庑殿：脊比屋子短多少（两头是斜下去的戗脊） */
  hip: number;
  seed: number;
  snow: number;
}

/** 南檐（屏幕 y）在 x 处：两头起翘 */
function eaveLift(r: RoofH, x: number): number {
  const e = Math.min(x - r.x0, r.x1 - x);
  const t = Math.max(0, 1 - e / 60);
  return r.lift * t * t;
}

/** 画一个正脊东西向的屋顶（先画北坡、两头的戗脊坡，再画南坡、脊、雪）；立面要在它之前画 */
function roofH(c: Ctx, st: Style, r: RoofH): void {
  const p = PAL[st];
  const { x0, x1, d, ze, zr, ov, hip } = r;
  const yR = d / 2 - zr;
  const yS = (x: number): number => d + ov - ze - eaveLift(r, x);
  const yN = (x: number): number => -ov - ze - eaveLift(r, x) * 0.5;
  const rx0 = x0 + hip;
  const rx1 = x1 - hip;
  const S = st === 'hut' ? 6 : 9;
  const edge = (k: Ctx, f: (x: number) => number, from: number, to: number): void => {
    const n = Math.max(2, Math.ceil(Math.abs(to - from) / 6));
    for (let i = 0; i <= n; i++) {
      const x = from + ((to - from) * i) / n;
      k.lineTo(x, f(x));
    }
  };
  // 北坡：看到的是窄窄一条，背光
  const north = (k: Ctx): void => {
    k.moveTo(x0, yN(x0));
    edge(k, yN, x0, x1);
    k.lineTo(rx1, yR);
    k.lineTo(rx0, yR);
  };
  fillPath(c, north, p.tileD);
  clipTo(c, north, () => {
    const lines: [number, number, number, number][] = [];
    for (let x = x0 + S / 2; x < x1; x += S) lines.push([x, yN(x) - 2, x, yR + 2]);
    tileRows(c, st, { ...p, tileL: p.tile }, lines, S, -1, 0);
  });
  inkPath(c, north, 2);
  // 两头的戗脊坡（歇山/庑殿）：瓦垄东西向
  if (hip > 0) {
    for (const side of [-1, 1]) {
      const ex = side < 0 ? x0 : x1;
      const rx = side < 0 ? rx0 : rx1;
      const end = (k: Ctx): void => {
        k.moveTo(rx, yR);
        k.lineTo(ex, yS(ex));
        k.lineTo(ex, yN(ex));
      };
      fillPath(c, end, side < 0 ? p.tile : p.tileD);
      clipTo(c, end, () => {
        const lines: [number, number, number, number][] = [];
        for (let y = yN(ex); y < yS(ex); y += S * 0.8) lines.push([ex, y, rx, y + (yR - y) * 0.15]);
        tileRows(c, st, p, lines, S * 0.8, 0, -1);
      });
      inkPath(c, end, 2);
    }
  }
  // 南坡：大的一面，瓦垄竖着，越往檐口越暗
  const south = (k: Ctx): void => {
    k.moveTo(rx0, yR);
    k.lineTo(rx1, yR);
    k.lineTo(x1, yS(x1));
    edge(k, yS, x1, x0);
  };
  const sg = c.createLinearGradient(0, yR, 0, yS((x0 + x1) / 2));
  sg.addColorStop(0, p.tileL);
  sg.addColorStop(0.25, p.tile);
  sg.addColorStop(1, p.tileD);
  fillPath(c, south, sg);
  clipTo(c, south, () => {
    const lines: [number, number, number, number][] = [];
    for (let x = x0 + S / 2; x < x1; x += S) lines.push([x, yR, x, yS(x) + 3]);
    tileRows(c, st, p, lines, S, -1, 0);
    if (st !== 'hut') {
      // 每垄筒瓦一节一节的接缝
      c.strokeStyle = 'rgba(16,18,30,0.28)';
      c.lineWidth = 1;
      c.beginPath();
      for (let x = x0 + S / 2; x < x1; x += S) for (let y = yR + 8 + ((x * 0.37) % 4); y < yS(x); y += 9) { c.moveTo(x - S * 0.28, y); c.lineTo(x + S * 0.12, y); }
      c.stroke();
    }
    const dg = c.createLinearGradient(0, yR, 0, d + ov - ze);
    dg.addColorStop(0, 'rgba(10,12,28,0)');
    dg.addColorStop(0.55, 'rgba(10,12,28,0.06)');
    dg.addColorStop(1, 'rgba(10,12,28,0.42)');
    c.fillStyle = dg;
    c.fillRect(x0, yR, x1 - x0, d + ov);
  });
  // 檐口：瓦当一排
  const pts: [number, number][] = [];
  for (let x = x0 + S / 2; x < x1; x += S) pts.push([x, yS(x)]);
  drips(c, st, p, pts, 0, 1.2, st === 'temple' ? 2.9 : 2.6);
  inkPath(c, (k) => { k.moveTo(rx0, yR); k.lineTo(rx1, yR); k.lineTo(x1, yS(x1)); edge(k, yS, x1, x0); }, 2.4);
  // 戗脊：脊端到四个檐角
  if (hip > 0) {
    for (const [ax, bx] of [[rx0, x0], [rx1, x1]] as const) {
      for (const by of [yS(bx), yN(bx)]) {
        stroke(c, (k) => { k.moveTo(ax, yR); k.lineTo(bx + (ax - bx) * 0.08, by); }, 6, INK);
        stroke(c, (k) => { k.moveTo(ax, yR); k.lineTo(bx + (ax - bx) * 0.08, by); }, 3.6, p.ridge);
        // 仙人走兽：戗脊下端几个小疙瘩
        for (let t = 0.12; t < 0.4; t += 0.09) {
          const xx = bx + (ax - bx) * t;
          const yy = by + (yR - by) * t;
          blob(c, circle(xx, yy - 1.6, 1.9), p.ridgeL, null, 1);
        }
      }
    }
  } else if (st !== 'hut') {
    // 硬山两头的博风：竖着一条厚边
    for (const ex of [x0, x1]) {
      const inner = ex === x0 ? 1 : -1;
      blob(c, (k) => { k.moveTo(ex, yN(ex)); k.lineTo(ex + inner * 5, yN(ex) + 2); k.lineTo(ex + inner * 5, yS(ex) - 1); k.lineTo(ex, yS(ex)); }, p.ridge, null, 1.8);
    }
  }
  // 檐角
  if (st !== 'hut') {
    horn(c, p, x0 + 2, yS(x0) - 1, -1, -1.2, st === 'temple' ? 1.25 : 1);
    horn(c, p, x1 - 2, yS(x1) - 1, 1, -1.2, st === 'temple' ? 1.25 : 1);
    horn(c, p, x0 + 2, yN(x0), -1, -1, 0.7);
    horn(c, p, x1 - 2, yN(x1), 1, -1, 0.7);
  }
  // 正脊：一道深色粗脊，脊上一排花砖（town）/ 亮釉（temple）/ 草束扎绳（hut）
  const ridgeH = st === 'temple' ? 13 : st === 'hut' ? 11 : 12;
  const ex0 = hip > 0 ? rx0 : x0 + 4;
  const ex1 = hip > 0 ? rx1 : x1 - 4;
  blob(c, rrect(ex0, yR - ridgeH + 2, ex1 - ex0, ridgeH, st === 'hut' ? 5 : 1.5), p.ridge, p.groove, 2.2, 1.6);
  dab(c, rrect(ex0 + 2, yR - ridgeH + 3, ex1 - ex0 - 4, 2.2, 1), p.ridgeL, 0.85);
  if (st === 'town') {
    for (let x = ex0 + 10; x < ex1 - 8; x += 13) dab(c, ellipse(x, yR - ridgeH / 2 + 2, 3.2, 2), '#5d6779', 0.9);
  } else if (st === 'hut') {
    for (let x = ex0 + 16; x < ex1 - 8; x += 34) stroke(c, (k) => { k.moveTo(x, yR - ridgeH + 2); k.lineTo(x - 2, yR + 2); }, 2, p.groove);
  } else {
    for (let x = ex0 + 30; x < ex1 - 20; x += 46) blob(c, ellipse(x, yR - ridgeH + 1, 3, 3.4), p.ridgeL, null, 1.2);
  }
  const es = r.x1 - r.x0 < 200 ? 1 : st === 'temple' ? 1.3 : 1.35;
  ridgeEnd(c, st, p, ex0, yR - 3, -1, es);
  ridgeEnd(c, st, p, ex1, yR - 3, 1, es);
  // 雪：脊上一溜断断续续，南坡上半截几块，北坡零星
  if (r.snow > 0) {
    const rnd = artRng(r.seed);
    for (let x = ex0 + 4 + rnd() * 10; x < ex1 - 6; x += 18 + rnd() * 34) {
      const w = 8 + rnd() * 16;
      if (rnd() < 0.65) snowPatch(c, Math.min(x + w / 2, ex1 - 6), yR - ridgeH + 1, w, 3.4, rnd, 0, 1, 99);
    }
    const n = Math.round(((x1 - x0) / 70) * r.snow);
    for (let i = 0; i < n; i++) {
      const x = x0 + 26 + rnd() * (x1 - x0 - 52);
      const t = rnd();
      const y = yR + 10 + t * t * (yS(x) - yR - 30);
      snowPatch(c, x, y, 10 + rnd() * 20, 4 + rnd() * 4, rnd);
    }
    for (let i = 0; i < n / 2; i++) snowPatch(c, x0 + 30 + rnd() * (x1 - x0 - 60), (yN(x0 + 40) + yR) / 2 + 2, 8 + rnd() * 10, 2.4, rnd, 0, -1, 99);
  }
}

// ───────────────────────── 立面（朝南的一面） ─────────────────────────

/** 横屋的立面：台基、柱子、开间（门、格子窗、槛墙）；back 是背面（只有高窗） */
function facadeH(c: Ctx, st: Style, w: number, d: number, top: number, front: boolean, door: boolean): { lights: number[]; lanterns: number[] } {
  const p = PAL[st];
  const lights: number[] = [];
  const lanterns: number[] = [];
  const base = d - 9;
  // 墙身
  blob(c, rrect(0, top, w, base - top, 0), st === 'hut' ? p.wall : front ? p.colD : p.wall, null, 2.2);
  if (st === 'hut' || !front) {
    // 木板墙 / 背面的粉墙
    if (st === 'hut') {
      for (let x = 7; x < w; x += 9) stroke(c, (k) => { k.moveTo(x, top); k.lineTo(x, base); }, 1.2, 'rgba(40,26,14,0.55)');
      for (let x = 3; x < w; x += 27) dab(c, rrect(x, top + 6, 2, base - top - 10, 1), p.colD, 0.5);
    } else if (st === 'town') {
      for (let i = 0; i < 4; i++) dab(c, rrect(w * (0.15 + i * 0.22), top + 4, 4, 18 + (i % 2) * 8, 2), p.wallD, 0.5);
    }
  }
  const n = Math.max(2, Math.round(w / 90));
  const bw = w / n;
  const doorBay = door ? Math.floor(n / 2) : -1;
  for (let k = 0; k < n; k++) {
    const bx = k * bw;
    const cx = bx + bw / 2;
    if (!front) {
      // 背面：两头开高窗，暗一些
      if (k === 0 || k === n - 1) {
        lattice(c, cx - 10, top + 10, 20, 12, p.frame, 0.55);
        lights.push(cx);
      }
      continue;
    }
    if (k === doorBay) {
      // 门：两扇对开，门缝漏光；上面一块匾（庙）或横楣格子
      const dw = Math.min(46, bw - 18);
      const dx = cx - dw / 2;
      const dt = top + (st === 'temple' ? 16 : 8);
      const g = c.createRadialGradient(cx, base - 10, 2, cx, base - 10, 40);
      g.addColorStop(0, 'rgba(255,196,100,0.6)');
      g.addColorStop(1, 'rgba(255,196,100,0)');
      c.fillStyle = g;
      c.fillRect(cx - 44, top, 88, base - top + 12);
      blob(c, rrect(dx - 3, dt - 3, dw + 6, base - dt + 3, 1), p.frame, null, 2);
      if (st === 'temple') {
        // 格扇门四扇，透光
        for (let i = 0; i < 4; i++) lattice(c, dx + (i * dw) / 4 + 0.5, dt, dw / 4 - 1, (base - dt) * 0.62, p.frame, 1);
        for (let i = 0; i < 4; i++) blob(c, rrect(dx + (i * dw) / 4 + 0.5, dt + (base - dt) * 0.62, dw / 4 - 1, (base - dt) * 0.38, 0.6), p.door, p.colD, 1.2, 0.8);
        blob(c, rrect(cx - 15, top + 3, 30, 11, 1), '#1e2a4a', null, 1.8);
        stroke(c, (k2) => { k2.rect(cx - 13, top + 5, 26, 7); }, 1, '#e8c050');
        dab(c, rrect(cx - 9, top + 7.4, 18, 2.2, 1), '#e8c050', 0.9);
      } else {
        lattice(c, dx, dt, dw, 8, p.frame, 1);
        const lt = dt + 10;
        const half = dw / 2 - 1.5;
        blob(c, rrect(dx, lt, half, base - lt, 0.8), p.door, p.colD, 1.4, 1);
        blob(c, rrect(cx + 1.5, lt, half, base - lt, 0.8), p.door, p.colD, 1.4, 1);
        dab(c, rrect(cx - 1.6, lt, 3.2, base - lt, 0.5), GLOW, 1);
        dab(c, rrect(cx - 0.7, lt, 1.4, base - lt, 0.5), GLOW_L, 1);
        for (const ox of [-4.5, 4.5]) blob(c, circle(cx + ox, lt + (base - lt) * 0.5, 1.6), '#e2b94a', null, 0.8);
      }
      // 门槛和门前一级石阶
      blob(c, rrect(dx - 6, base - 1, dw + 12, 5, 1), p.plinthL, p.plinth, 1.6, 1);
      lights.push(cx);
      lanterns.push(bx + 7, bx + bw - 7);
      continue;
    }
    // 窗：上面格子窗透光，下面槛墙
    const wx = bx + 9;
    const ww = bw - 18;
    const wt = top + (st === 'temple' ? 10 : 6);
    const wh = Math.max(12, (base - wt) * 0.58);
    lattice(c, wx, wt, ww, wh, p.frame, st === 'hut' ? 0.8 : 1);
    if (st !== 'hut') {
      blob(c, rrect(wx - 2, wt + wh + 1, ww + 4, base - wt - wh - 1, 0.5), st === 'temple' ? p.wall : '#d9d4c8', st === 'temple' ? p.wallD : '#aaa69c', 1.6, 1);
      if (st === 'town') stroke(c, (k2) => { k2.moveTo(wx + 2, wt + wh + 6); k2.lineTo(wx + ww - 2, wt + wh + 6); }, 1, 'rgba(60,60,70,0.35)');
    }
    lights.push(cx);
  }
  // 柱
  if (front && st !== 'hut') {
    for (let k = 0; k <= n; k++) {
      const x = Math.min(w - 4, Math.max(4, k * bw));
      blob(c, rrect(x - 4, top, 8, base - top, 1), p.col, p.colD, 1.8, 1.4);
      blob(c, rrect(x - 5.5, base - 4, 11, 4, 1), p.plinthL, null, 1.2);
    }
  } else {
    for (const x of [3, w - 3]) blob(c, rrect(x - 3, top, 6, base - top, 1), st === 'hut' ? p.colD : st === 'temple' ? p.colD : p.wallD, null, 1.6);
  }
  // 台基
  blob(c, rrect(-6, base, w + 12, d - base + 1, 1.5), p.plinth, null, 2.2);
  dab(c, rrect(-5, base + 0.5, w + 10, 2.4, 1), p.plinthL, 0.9);
  for (let x = 14; x < w; x += 26) stroke(c, (k2) => { k2.moveTo(x, base + 3); k2.lineTo(x, d); }, 1, 'rgba(20,22,32,0.4)');
  for (let x = 0; x < w; x += 70) dab(c, ellipse(x + 20, d - 1, 14, 2), SNOW, 0.85);
  return { lights, lanterns };
}

// ───────────────────────── 正房 ─────────────────────────

/** 横的正房：w 长、d 深；front 是朝南的正面（有门），否则朝南的是背面。参考点是脚印左上角 */
export function houseH(st: Style, w: number, d: number, front: boolean, seed: number): Piece {
  const ov = HOUSE_OV;
  const padX = ov + 26;
  const top = HOUSE_RIDGE - d / 2 + 34;
  return {
    w: w + padX * 2,
    h: top + d + 14,
    ax: padX,
    ay: top,
    draw: (c) => {
      const ze = HOUSE_Z;
      const roof: RoofH = { x0: -ov, x1: w + ov, d, ze, zr: HOUSE_RIDGE, ov, lift: st === 'temple' ? 15 : st === 'town' ? 10 : 2, hip: st === 'temple' ? 70 : 0, seed, snow: st === 'hut' ? 1.6 : 1 };
      const fa = facadeH(c, st, w, d, d - ze, front, front);
      eaveShade(c, 0, w, d + ov - ze - 2, 16, 0.55);
      roofH(c, st, roof);
      for (const x of fa.lanterns) lantern(c, x, d + ov - ze - eaveLift(roof, x) + 1, 1);
    },
  };
}

/** 横屋立面上亮着的地方（窗、门）的 x（相对脚印左边），给 town.ts 的暗幕挖光 */
export function houseHLights(w: number, front: boolean): { x: number; door: boolean }[] {
  const n = Math.max(2, Math.round(w / 90));
  const bw = w / n;
  const out: { x: number; door: boolean }[] = [];
  for (let k = 0; k < n; k++) {
    if (!front && k !== 0 && k !== n - 1) continue;
    out.push({ x: k * bw + bw / 2, door: front && k === Math.floor(n / 2) });
  }
  return out;
}

/**
 * 竖的正房：d 宽（东西）、l 长（南北）。正脊南北向，两坡朝东西；南头是山墙（town、hut）或歇山的山面加朝南的立面（temple）。
 * yard 是院子在哪边（1 东 / −1 西）：那边屋檐下挂灯笼。
 */
export function houseV(st: Style, d: number, l: number, yard: 1 | -1, seed: number): Piece {
  const ov = HOUSE_OV;
  const padX = ov + 24;
  const top = HOUSE_RIDGE + ov + 34;
  return {
    w: d + padX * 2,
    h: top + l + 14,
    ax: padX,
    ay: top,
    draw: (c) => paintHouseV(c, st, d, l, yard, seed),
  };
}

function paintHouseV(c: Ctx, st: Style, d: number, l: number, yard: 1 | -1, seed: number): void {
  const p = PAL[st];
  const ze = HOUSE_Z;
  const zr = HOUSE_RIDGE;
  const ov = HOUSE_OV;
  const xm = d / 2;
  const xW = -ov;
  const xE = d + ov;
  const hip = st === 'temple' ? 70 : 0;
  const lift = st === 'temple' ? 14 : st === 'town' ? 9 : 2;
  // 世界 y（脚印里，含外挑）→ 檐口的屏幕 y；两头起翘
  const liftAt = (t: number): number => {
    const e = Math.min(t + ov, l + ov - t);
    const k = Math.max(0, 1 - e / 60);
    return lift * k * k;
  };
  const eaveY = (t: number): number => t - ze - liftAt(t);
  const rTop = (hip > 0 ? hip : -ov) - zr;
  const rBot = (hip > 0 ? l - hip : l + ov) - zr;
  const yNs = eaveY(-ov);
  const ySs = eaveY(l + ov);
  const S = st === 'hut' ? 6 : 8;
  const edge = (k: Ctx, x: number, from: number, to: number): void => {
    const n = Math.max(2, Math.ceil(Math.abs(to - from) / 8));
    for (let i = 0; i <= n; i++) {
      const t = from + ((to - from) * i) / n;
      k.lineTo(x, eaveY(t));
    }
  };

  // 南头：山墙（⌂）或歇山下面朝南的立面
  if (hip === 0) {
    const gable = (k: Ctx): void => {
      k.moveTo(0, l);
      k.lineTo(d, l);
      k.lineTo(d, l - ze);
      k.lineTo(xm, l - zr);
      k.lineTo(0, l - ze);
    };
    fillPath(c, gable, p.wall);
    if (st === 'hut') {
      clipTo(c, gable, () => {
        for (let x = 6; x < d; x += 9) stroke(c, (k) => { k.moveTo(x, l - zr); k.lineTo(x, l); }, 1.2, 'rgba(40,26,14,0.55)');
      });
      lattice(c, xm - 12, l - ze + 4, 24, 16, p.frame, 0.9);
    } else {
      // 粉墙上的雨痕，正中一扇圆形格窗
      for (const x of [16, d - 22]) dab(c, rrect(x, l - ze + 10, 4, 22, 2), p.wallD, 0.45);
      const cy = l - ze * 0.62;
      const g = c.createRadialGradient(xm, cy, 2, xm, cy, 30);
      g.addColorStop(0, 'rgba(255,200,110,0.55)');
      g.addColorStop(1, 'rgba(255,200,110,0)');
      c.fillStyle = g;
      c.fillRect(xm - 32, cy - 32, 64, 64);
      blob(c, circle(xm, cy, 13), p.frame, null, 2);
      clipTo(c, circle(xm, cy, 11), () => {
        c.fillStyle = GLOW;
        c.fillRect(xm - 12, cy - 12, 24, 24);
        dab(c, circle(xm, cy, 6), GLOW_L, 0.9);
        stroke(c, (k) => { for (let i = -8; i <= 8; i += 4) { k.moveTo(xm + i, cy - 12); k.lineTo(xm + i, cy + 12); k.moveTo(xm - 12, cy + i); k.lineTo(xm + 12, cy + i); } }, 1, p.frame);
      });
    }
    inkPath(c, gable, 2.2);
    blob(c, rrect(-5, l - 9, d + 10, 10, 1.5), p.plinth, null, 2);
    dab(c, rrect(-4, l - 8.5, d + 8, 2.2, 1), p.plinthL, 0.9);
    eaveShade(c, 0, d, ySs - 4, 14, 0.4);
  } else {
    // 歇山：南头檐下是一面正经的立面（柱、格扇门、匾）
    facadeH(c, st, d, l, l - ze, true, true);
    eaveShade(c, 0, d, ySs - 2, 16, 0.55);
  }

  // 东西两坡：瓦垄从脊斜着坡到檐口（屏幕上一排排"八"字），西坡迎着月光亮、东坡暗
  for (const side of [-1, 1] as const) {
    const xe = side < 0 ? xW : xE;
    const slope = (k: Ctx): void => {
      k.moveTo(xm, rTop);
      k.lineTo(xm, rBot);
      k.lineTo(xe, ySs);
      edge(k, xe, l + ov, -ov);
    };
    const g = c.createLinearGradient(xm, 0, xe, 0);
    g.addColorStop(0, side < 0 ? p.tileL : p.tile);
    g.addColorStop(0.3, side < 0 ? p.tile : p.tileD);
    g.addColorStop(1, side < 0 ? p.tileD : p.groove);
    fillPath(c, slope, g);
    clipTo(c, slope, () => {
      const lines: [number, number, number, number][] = [];
      for (let t = -ov - 40; t < l + ov + 40; t += S) lines.push([xm, t - zr, xe, eaveY(t)]);
      tileRows(c, st, side < 0 ? p : { ...p, tileL: p.tile, groove: p.groove }, lines, S, 0, -1);
    });
    const pts: [number, number][] = [];
    for (let t = -ov + S / 2; t < l + ov; t += S) pts.push([xe, eaveY(t)]);
    drips(c, st, p, pts, side * 1.4, 0.4, 2.3);
    inkPath(c, slope, 2.3);
  }

  if (hip > 0) {
    // 北头：歇山的北坡被压成一条窄三角；南头：大的三角坡，瓦垄竖着，脊端下面一块山花
    const nEnd = (k: Ctx): void => { k.moveTo(xm, rTop); k.lineTo(xW, yNs); k.lineTo(xE, yNs); };
    fillPath(c, nEnd, p.tileD);
    inkPath(c, nEnd, 2);
    const sEnd = (k: Ctx): void => { k.moveTo(xm, rBot); k.lineTo(xE, ySs); k.lineTo(xW, ySs); };
    const g = c.createLinearGradient(0, rBot, 0, ySs);
    g.addColorStop(0, p.tileL);
    g.addColorStop(1, p.tileD);
    fillPath(c, sEnd, g);
    clipTo(c, sEnd, () => {
      const lines: [number, number, number, number][] = [];
      for (let x = xW + S / 2; x < xE; x += S) lines.push([x, rBot, x, ySs + 3]);
      tileRows(c, st, p, lines, S, -1, 0);
    });
    const pts: [number, number][] = [];
    for (let x = xW + S / 2; x < xE; x += S) pts.push([x, ySs]);
    drips(c, st, p, pts, 0, 1.2, 2.6);
    inkPath(c, sEnd, 2.3);
    // 山花：红底金边的小三角
    blob(c, poly(xm, rBot - 2, xm - 24, rBot + 30, xm + 24, rBot + 30), p.wall, p.wallD, 2, 1.4);
    stroke(c, (k) => { k.moveTo(xm - 16, rBot + 26); k.lineTo(xm, rBot + 5); k.lineTo(xm + 16, rBot + 26); }, 1.4, '#e8c050');
    dab(c, circle(xm, rBot + 18, 3), '#e8c050', 0.9);
    // 戗脊和仙人走兽
    for (const [ry, ey] of [[rTop, yNs], [rBot + 28, ySs]] as const) {
      for (const ex of [xW, xE]) {
        stroke(c, (k) => { k.moveTo(xm, ry); k.lineTo(ex + (xm - ex) * 0.06, ey); }, 6, INK);
        stroke(c, (k) => { k.moveTo(xm, ry); k.lineTo(ex + (xm - ex) * 0.06, ey); }, 3.6, p.ridge);
        for (let t = 0.1; t < 0.36; t += 0.09) blob(c, circle(ex + (xm - ex) * t, ey + (ry - ey) * t - 1.5, 1.9), p.ridgeL, null, 1);
      }
    }
  } else {
    // 山墙顶的博风板：沿 ⌂ 一道厚边，尖下挂悬鱼；北头一样有一道（屋脊翘起的尖）
    for (const [yy, peak] of [[ySs, l + ov - zr], [yNs, -ov - zr]] as const) {
      const band = (k: Ctx): void => {
        k.moveTo(xW - 1, yy + 1);
        k.lineTo(xm, peak);
        k.lineTo(xE + 1, yy + 1);
        k.lineTo(xE + 1, yy + 6);
        k.lineTo(xm, peak + 6);
        k.lineTo(xW - 1, yy + 6);
      };
      blob(c, band, st === 'hut' ? p.tileD : p.ridge, null, 2);
      dab(c, (k) => { k.moveTo(xW + 2, yy + 1.5); k.lineTo(xm, peak + 1); k.lineTo(xE - 2, yy + 1.5); k.lineTo(xm, peak + 3); }, p.ridgeL, 0.6);
      if (yy === ySs && st === 'town') blob(c, poly(xm - 4, peak + 6, xm + 4, peak + 6, xm + 2, peak + 16, xm, peak + 19, xm - 2, peak + 16), p.ridge, null, 1.4);
    }
  }

  // 檐角
  if (st !== 'hut') {
    for (const xe of [xW, xE]) {
      const dx = xe < xm ? -1 : 1;
      horn(c, p, xe - dx * 2, ySs, dx, -1.2, st === 'temple' ? 1.2 : 1);
      horn(c, p, xe - dx * 2, yNs, dx, -1.2, 0.8);
    }
  }

  // 正脊：南北一道，两头起翘
  const rw = st === 'temple' ? 12 : 10;
  blob(c, rrect(xm - rw / 2, rTop - 4, rw, rBot - rTop + 6, st === 'hut' ? 5 : 1.5), p.ridge, p.groove, 2.2, 1.4);
  dab(c, rrect(xm - rw / 2 + 1.5, rTop - 2, 2.4, rBot - rTop + 2, 1), p.ridgeL, 0.85);
  if (st === 'town') for (let y = rTop + 8; y < rBot - 6; y += 13) dab(c, ellipse(xm + 1, y, 2, 3.2), '#5d6779', 0.9);
  if (st === 'hut') for (let y = rTop + 14; y < rBot - 6; y += 34) stroke(c, (k) => { k.moveTo(xm - rw / 2, y); k.lineTo(xm + rw / 2, y + 2); }, 2, p.groove);
  if (st === 'temple') {
    ridgeEnd(c, st, p, xm, rTop + 2, -1, 1.1);
    ridgeEnd(c, st, p, xm, rBot + 2, 1, 1.1);
  } else if (st === 'town') {
    // 燕尾：脊两头往上甩
    for (const [y, dir] of [[rTop - 2, -1], [rBot + 2, 1]] as const) {
      blob(c, (k) => {
        k.moveTo(xm - 5, y + dir * -2);
        k.quadraticCurveTo(xm - 6, y - 10, xm - 3, y - 22);
        k.quadraticCurveTo(xm + 3, y - 12, xm + 6, y - 6);
        k.lineTo(xm + 5, y + dir * -2);
      }, p.ridge, p.groove, 1.8, 1);
    }
  } else {
    ridgeEnd(c, st, p, xm, rTop, -1);
    ridgeEnd(c, st, p, xm, rBot + 2, 1);
  }

  // 雪：脊上断断续续，两坡靠脊的地方一块块
  const rnd = artRng(seed);
  for (let y = rTop + 4 + rnd() * 10; y < rBot - 4; y += 16 + rnd() * 30) {
    if (rnd() < 0.5) snowPatch(c, xm + (rnd() - 0.5) * 2, y, 4 + rnd() * 8, 3.2, rnd, rnd() < 0.5 ? -1 : 1, 0, 8);
  }
  const n = Math.round((l / 60) * (st === 'hut' ? 1.6 : 1));
  for (let i = 0; i < n; i++) {
    const side = rnd() < 0.55 ? -1 : 1;
    const t = rnd() * l;
    const k = 0.15 + rnd() * 0.45;
    const x = xm + (side < 0 ? xW - xm : xE - xm) * k;
    const y = t - zr + (zr - ze) * k + 4;
    snowPatch(c, x, y, 7 + rnd() * 10, 4 + rnd() * 4, rnd, side * 0.87, 0.49, 7);
  }

  // 院子那边屋檐下的灯笼
  const lx = yard > 0 ? xE - 3 : xW + 3;
  for (const t of [l * 0.5 - 70, l * 0.5 + 40]) lantern(c, lx, eaveY(t) + 1, 1);
}

/** 竖屋发光的地方：院子那边屋檐下的灯笼（相对脚印），南山墙的圆窗 */
export function houseVLights(d: number, l: number, yard: 1 | -1): { x: number; y: number }[] {
  const lx = yard > 0 ? d + HOUSE_OV : -HOUSE_OV;
  return [
    { x: lx, y: l * 0.5 - 70 - HOUSE_Z + 12 },
    { x: lx, y: l * 0.5 + 40 - HOUSE_Z + 12 },
    { x: d / 2, y: l - HOUSE_Z * 0.62 },
  ];
}

// ───────────────────────── 院墙 ─────────────────────────

/** 横墙墙面：古镇白粉墙（雨痕、漏窗），庙红墙，渡口木板墙；都是青砖/石的墙根 */
function wallFace(c: Ctx, st: Style, x0: number, x1: number, top: number, foot: number, deco: boolean, rnd: () => number): void {
  const p = PAL[st];
  c.fillStyle = p.wall;
  c.fillRect(x0, top, x1 - x0, foot - top);
  if (st === 'hut') {
    for (let x = x0 + 4; x < x1; x += 10) {
      stroke(c, (k) => { k.moveTo(x, top); k.lineTo(x, foot - 8); }, 1.3, 'rgba(40,26,14,0.6)');
      if (rnd() < 0.4) dab(c, rrect(x + 2, top + 4 + rnd() * 10, 6, 8 + rnd() * 12, 1), rnd() < 0.5 ? p.wallD : '#a5805a', 0.45);
    }
    stroke(c, (k) => { k.moveTo(x0, top + 12); k.lineTo(x1, top + 12); }, 2.4, p.colD);
  } else {
    // 雨痕：从檐下往下淡下去
    for (let x = x0 + 10 + rnd() * 30; x < x1 - 10; x += 34 + rnd() * 50) {
      const h = 10 + rnd() * 16;
      const g = c.createLinearGradient(0, top, 0, top + h);
      g.addColorStop(0, st === 'temple' ? 'rgba(70,16,10,0.5)' : 'rgba(110,116,128,0.45)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g;
      c.fillRect(x, top, 3 + rnd() * 4, h);
    }
    if (deco && st === 'town') {
      // 漏窗：一扇透着院里灯光的花格窗
      const cx = (x0 + x1) / 2;
      const cy = top + (foot - top) * 0.42;
      const g = c.createRadialGradient(cx, cy, 2, cx, cy, 26);
      g.addColorStop(0, 'rgba(255,196,110,0.35)');
      g.addColorStop(1, 'rgba(255,196,110,0)');
      c.fillStyle = g;
      c.fillRect(cx - 28, cy - 28, 56, 56);
      blob(c, poly(cx - 14, cy - 5, cx - 8, cy - 10, cx + 8, cy - 10, cx + 14, cy - 5, cx + 14, cy + 5, cx + 8, cy + 10, cx - 8, cy + 10, cx - 14, cy + 5), '#4a5163', null, 2);
      clipTo(c, poly(cx - 12, cy - 4, cx - 7, cy - 8, cx + 7, cy - 8, cx + 12, cy - 4, cx + 12, cy + 4, cx + 7, cy + 8, cx - 7, cy + 8, cx - 12, cy + 4), () => {
        c.fillStyle = '#e8b866';
        c.fillRect(cx - 14, cy - 10, 28, 20);
        stroke(c, (k) => { for (let i = -16; i <= 16; i += 5) { k.moveTo(cx + i - 6, cy - 10); k.lineTo(cx + i + 6, cy + 10); k.moveTo(cx + i + 6, cy - 10); k.lineTo(cx + i - 6, cy + 10); } }, 1.4, '#59617a');
      });
    }
    if (deco && st === 'temple') {
      // 庙墙上一块"福"字似的金色圆饰
      const cx = (x0 + x1) / 2;
      const cy = top + (foot - top) * 0.42;
      blob(c, circle(cx, cy, 7), '#e0b048', '#a8781c', 1.6, 1);
      stroke(c, (k) => { k.moveTo(cx - 3.5, cy); k.lineTo(cx + 3.5, cy); k.moveTo(cx, cy - 3.5); k.lineTo(cx, cy + 3.5); }, 1.2, '#7c231a');
    }
  }
  // 墙根：两层错缝的青砖（庙是石条）
  const pb = foot - 11;
  c.fillStyle = p.plinth;
  c.fillRect(x0, pb, x1 - x0, foot - pb);
  c.fillStyle = p.plinthL;
  c.fillRect(x0, pb, x1 - x0, 2);
  c.strokeStyle = 'rgba(20,22,32,0.5)';
  c.lineWidth = 1;
  c.beginPath();
  c.moveTo(x0, pb + 5.5);
  c.lineTo(x1, pb + 5.5);
  for (let x = Math.ceil(x0 / 16) * 16; x < x1; x += 16) {
    c.moveTo(x, pb + 2);
    c.lineTo(x, pb + 5.5);
    c.moveTo(x + 8, pb + 5.5);
    c.lineTo(x + 8, foot);
  }
  c.stroke();
  stroke(c, (k) => { k.moveTo(x0, top); k.lineTo(x1, top); }, 1.2, 'rgba(20,22,40,0.5)');
  stroke(c, (k) => { k.moveTo(x0, foot); k.lineTo(x1, foot); }, 2.4, INK);
}

/**
 * 横墙的一段（可平铺，周期 WALL_H_PERIOD）：墙头小两坡瓦顶（北坡窄、脊、南坡瓦垄、瓦当）+ 朝南的墙面。
 * 参考点是脚印左上（y 0 = 墙北边线，墙厚 t）；图从墙头的雪画到墙根。
 */
export function wallHBody(st: Style, t: number): Piece {
  const P = WALL_H_PERIOD;
  const top = WALL_RIDGE - t / 2 + 16;
  return { w: P, h: top + t + 2, ax: 0, ay: top, draw: (c) => paintWallH(c, st, t, 0, P, true) };
}

function paintWallH(c: Ctx, st: Style, t: number, x0: number, x1: number, wrap: boolean): void {
  const p = capPal(st);
  const P = x1 - x0;
  const rnd = artRng(st === 'town' ? 11 : st === 'temple' ? 23 : 37);
  const zw = WALL_Z;
  const ov = WALL_OV;
  const yR = t / 2 - WALL_RIDGE;
  const yN = -ov - zw - 1;
  const yS = t + ov - zw;
  // 墙面（檐下那截被檐口压住）
  wallFace(c, st, x0 - 1, x1 + 1, t - zw, t, wrap, rnd);
  eaveShade(c, x0 - 1, x1 + 1, yS - 2, 10, 0.5);
  // 北坡
  c.fillStyle = p.tileD;
  c.fillRect(x0 - 1, yN, P + 2, yR - yN + 1);
  const S = 8;
  const lines: [number, number, number, number][] = [];
  for (let x = x0 + S / 2; x < x1 + S; x += S) lines.push([x, yN, x, yR]);
  tileRows(c, 'town', { ...p, tileL: p.tile }, lines, S, -1, 0);
  stroke(c, (k) => { k.moveTo(x0 - 1, yN); k.lineTo(x1 + 1, yN); }, 2, INK);
  // 南坡
  const g = c.createLinearGradient(0, yR, 0, yS);
  g.addColorStop(0, p.tileL);
  g.addColorStop(0.3, p.tile);
  g.addColorStop(1, p.tileD);
  c.fillStyle = g;
  c.fillRect(x0 - 1, yR, P + 2, yS - yR);
  const ls: [number, number, number, number][] = [];
  for (let x = x0 + S / 2; x < x1 + S; x += S) ls.push([x, yR, x, yS + 2]);
  tileRows(c, 'town', p, ls, S, -1, 0);
  const pts: [number, number][] = [];
  for (let x = x0 + S / 2; x < x1 + S / 2; x += S) pts.push([x, yS]);
  drips(c, 'town', p, pts, 0, 0.9, 2.3);
  // 脊
  const rh = 7;
  c.fillStyle = INK;
  c.fillRect(x0 - 1, yR - rh - 1, P + 2, rh + 3);
  c.fillStyle = p.ridge;
  c.fillRect(x0 - 1, yR - rh + 0.5, P + 2, rh);
  c.fillStyle = p.ridgeL;
  c.fillRect(x0 - 1, yR - rh + 1, P + 2, 1.6);
  if (st !== 'temple') for (let x = x0 + 6; x < x1; x += 12) dab(c, ellipse(x, yR - rh / 2 + 1, 2.4, 1.4), '#5d6779', 0.9);
  // 雪：脊上断续的一溜、南坡上一块块（平铺：两头各补一份）
  const patches: [number, number, number, number, number][] = [];
  for (let x = x0 + rnd() * 10; x < x1; x += 18 + rnd() * 34) if (rnd() < 0.6) patches.push([x, yR - rh + 1, 6 + rnd() * 14, 2.6 + rnd() * 1.2, 99]);
  for (let i = 0; i < P / 70; i++) patches.push([x0 + rnd() * P, yR + 4 + rnd() * (yS - yR - 16), 7 + rnd() * 12, 2.6 + rnd() * 2.4, 8]);
  for (const [x, y, rx, ry, gap] of patches) {
    for (const o of wrap ? [-P, 0, P] : [0]) {
      if (x + o + rx * 2 < x0 - 2 || x + o - rx * 2 > x1 + 2) continue;
      snowPatch(c, x + o, y, rx, ry, artRng((x * 7 + y) | 0), 0, 1, gap);
    }
  }
}

/** 横墙的端头（墙角或门洞两边）：墙头的外挑、端头瓦当、檐角起翘、脊头一钩、墙面的竖边。画左端，右端水平翻转 */
export function wallHEnd(st: Style, t: number): Piece {
  const top = WALL_RIDGE - t / 2 + 24;
  return {
    w: 34,
    h: top + t + 2,
    ax: 22,
    ay: top,
    draw: (c) => {
      const p = capPal(st);
      const zw = WALL_Z;
      const ov = WALL_OV;
      const yR = t / 2 - WALL_RIDGE;
      const yN = -ov - zw - 1;
      const yS = t + ov - zw;
      // 墙面的竖边
      stroke(c, (k) => { k.moveTo(0, yS); k.lineTo(0, t); }, 2.4, INK);
      // 墙头外挑的一截
      const g = c.createLinearGradient(0, yR, 0, yS);
      g.addColorStop(0, p.tileL);
      g.addColorStop(1, p.tileD);
      fillPath(c, (k) => { k.moveTo(1, yR); k.lineTo(-ov, yR); k.lineTo(-ov, yS); k.lineTo(1, yS); }, g);
      fillPath(c, (k) => { k.moveTo(1, yN); k.lineTo(-ov, yN + 1); k.lineTo(-ov, yR); k.lineTo(1, yR); }, p.tileD);
      inkPath(c, (k) => { k.moveTo(1, yN); k.lineTo(-ov, yN + 1); k.lineTo(-ov, yS); k.lineTo(1, yS); }, 2.2, false);
      blob(c, circle(-ov + 2, yS, 2.4), p.tileL, p.tileD, 1.3, 0.8);
      horn(c, p, -ov + 1, yS - 1, -1, -1.1, 0.9);
      horn(c, p, -ov + 1, yN + 1, -1, -1, 0.6);
      // 脊头
      blob(c, rrect(-ov, yR - 8, ov + 2, 10, 1), p.ridge, null, 2);
      if (st === 'temple') ridgeEnd(c, 'temple', p, -ov + 1, yR - 4, -1, 0.6);
      else ridgeEnd(c, 'town', p, -ov + 1, yR - 4, -1, 0.75);
    },
  };
}

/** 墙角的脊头：两道墙头的脊交在一起的地方，一个压脊的宝顶（参考点是两道脊的交点，屏幕坐标） */
export function wallKnot(st: Style): Piece {
  return {
    w: 30,
    h: 30,
    ax: 15,
    ay: 18,
    draw: (c) => {
      const p = capPal(st);
      blob(c, rrect(-9, -6, 18, 10, 2), p.ridge, p.groove, 2, 1);
      blob(c, ellipse(0, -7, 6, 6.5), p.ridgeL, p.ridge, 2, 1.2);
      dab(c, ellipse(-1.6, -9.6, 2, 1.5), '#ffffff', 0.7);
      snowPatch(c, 0, -11, 5, 2.4, artRng(5));
    },
  };
}

/**
 * 竖墙一段（可平铺，屏幕 y 周期 WALL_V_PERIOD）：从上往下看的墙头，中间一道深色的脊，两边的瓦垄斜着坡向檐口，
 * 檐口一排瓦当；脊上和瓦上一块块的雪。x 相对墙脚印左边（墙厚 t），从 WALL_V_X0 画到 t + WALL_V_X1。
 */
export function wallVBody(st: Style, t: number): Piece {
  const P = WALL_V_PERIOD;
  return {
    w: t - WALL_V_X0 + WALL_V_X1,
    h: P,
    ax: -WALL_V_X0,
    ay: 0,
    draw: (c) => paintWallV(c, st, t, 0, P, true),
  };
}

function paintWallV(c: Ctx, st: Style, t: number, y0: number, y1: number, wrap: boolean): void {
  const p = capPal(st);
  const ov = WALL_OV;
  const xm = t / 2;
  const rise = WALL_RIDGE - WALL_Z;
  const S = 9;
  const P = y1 - y0;
  // 两坡：西坡迎着月光亮、东坡背光暗，一眼看得出是个两坡的墙头，不是两条线
  for (const side of [-1, 1] as const) {
    const xe = side < 0 ? -ov : t + ov;
    const g = c.createLinearGradient(xm, 0, xe, 0);
    g.addColorStop(0, side < 0 ? p.tileL : p.tileD);
    g.addColorStop(1, side < 0 ? p.tile : p.groove);
    c.fillStyle = g;
    c.fillRect(Math.min(xm, xe), y0, Math.abs(xe - xm), P);
    const lines: [number, number, number, number][] = [];
    for (let u = y0 - 27; u < y1 + 27; u += S) lines.push([xm, u, xe, u + rise]);
    clipTo(c, (k) => k.rect(Math.min(xm, xe), y0, Math.abs(xe - xm), P), () => tileRows(c, 'town', side < 0 ? p : { ...p, tile: p.tileD, tileL: p.tile }, lines, S, 0, -1));
    // 檐口的瓦当：不描边，只是一排小圆头
    for (let u = y0 - 27 + rise; u < y1 + 9; u += S) {
      dab(c, circle(xe + side * 0.6, u + 1.2, 2.5), 'rgba(16,14,24,0.6)');
      dab(c, circle(xe, u, 2.1), side < 0 ? p.tileL : p.tile);
    }
    stroke(c, (k) => { k.moveTo(xe + side * 2.4, y0 - 2); k.lineTo(xe + side * 2.4, y1 + 2); }, 1.1, 'rgba(23,19,28,0.55)');
  }
  // 脊：一道深色粗脊，西边一线高光
  c.fillStyle = INK;
  c.fillRect(xm - 5.5, y0, 11, P);
  c.fillStyle = p.ridge;
  c.fillRect(xm - 4, y0, 8, P);
  c.fillStyle = p.ridgeL;
  c.fillRect(xm - 3.4, y0, 2, P);
  if (st !== 'temple') for (let y = y0 + 6; y < y1; y += 12) dab(c, ellipse(xm + 0.8, y, 1.5, 2.6), '#5d6779', 0.9);
  // 雪：少而大，几块压在脊上往两边淌
  const rnd = artRng(st === 'temple' ? 61 : 67);
  const patches: [number, number, number, number][] = [];
  for (let y = y0 + rnd() * 30; y < y1; y += 55 + rnd() * 60) patches.push([xm + (rnd() - 0.5) * 4, y, 6 + rnd() * 9, rnd() < 0.5 ? -1 : 1]);
  for (const [x, y, rx, side] of patches) {
    for (const o of wrap ? [-P, 0, P] : [0]) {
      if (y + o + rx * 2 < y0 - 4 || y + o - rx * 2 > y1 + 4) continue;
      snowPatch(c, x, y + o, rx, 4.2, artRng((x * 13 + y * 7) | 0), side * 0.83, 0.55, 7);
    }
  }
}

/** 竖墙南头的断口：墙头收成 ⌂ 的头，下面露出墙面和墙根（参考点是墙脚印的左下角） */
export function wallVSouth(st: Style, t: number): Piece {
  const ov = WALL_OV;
  return {
    w: t + 2 * ov + 16,
    h: WALL_RIDGE + 20,
    ax: ov + 8,
    ay: WALL_RIDGE + 18,
    draw: (c) => {
      const p = capPal(st);
      const zw = WALL_Z;
      const xm = t / 2;
      const yTip = ov - WALL_RIDGE;
      const ySide = ov - zw;
      // 墙面（⌂ 的山墙尖被墙头压住）
      const face = (k: Ctx): void => { k.moveTo(0, 0); k.lineTo(t, 0); k.lineTo(t, -zw); k.lineTo(xm, -WALL_RIDGE + 2); k.lineTo(0, -zw); };
      clipTo(c, face, () => wallFace(c, st, -2, t + 2, -zw - 14, 0, false, artRng(3)));
      inkPath(c, face, 2.2);
      eaveShade(c, 0, t, ySide - 2, 9, 0.5);
      // 墙头的头：两边的斜坡收到端头
      for (const side of [-1, 1] as const) {
        const xe = side < 0 ? -ov : t + ov;
        const tri = (k: Ctx): void => { k.moveTo(xm, yTip - 1); k.lineTo(xe, yTip - 1); k.lineTo(xe, ySide); };
        fillPath(c, tri, side < 0 ? p.tile : p.tileD);
        clipTo(c, tri, () => {
          const lines: [number, number, number, number][] = [];
          for (let u = yTip - 24; u < ySide + 4; u += 8) lines.push([xm, u, xe, u + (WALL_RIDGE - zw)]);
          tileRows(c, 'town', side < 0 ? p : { ...p, tileL: p.tile }, lines, 8, 0, -1);
        });
      }
      // 端头的博风和瓦当
      stroke(c, (k) => { k.moveTo(-ov - 1, ySide); k.lineTo(xm, yTip); k.lineTo(t + ov + 1, ySide); }, 5, INK);
      stroke(c, (k) => { k.moveTo(-ov, ySide - 0.5); k.lineTo(xm, yTip - 0.5); k.lineTo(t + ov, ySide - 0.5); }, 2.6, p.ridge);
      for (const xe of [-ov, t + ov]) blob(c, circle(xe, ySide + 1, 2.4), p.tileL, p.tileD, 1.3, 0.8);
      blob(c, rrect(xm - 5, yTip - 6, 10, 7, 1.5), p.ridge, null, 2);
      ridgeEnd(c, st === 'temple' ? 'temple' : 'town', p, xm, yTip - 3, 1, 0.55);
      snowPatch(c, xm, yTip - 6, 4, 2.4, artRng(9));
    },
  };
}

/** 竖墙北头的断口：墙头的尖（屋脊收头，两边檐口向下斜），参考点是墙脚印的左上角 */
export function wallVNorth(st: Style, t: number): Piece {
  const ov = WALL_OV;
  return {
    w: t + 2 * ov + 16,
    h: 30,
    ax: ov + 8,
    ay: WALL_RIDGE + ov + 14,
    draw: (c) => {
      const p = capPal(st);
      const xm = t / 2;
      const yTip = -ov - WALL_RIDGE;
      const ySide = -ov - WALL_Z;
      for (const side of [-1, 1] as const) {
        const xe = side < 0 ? -ov : t + ov;
        const tri = (k: Ctx): void => { k.moveTo(xm, yTip); k.lineTo(xm, ySide + 1); k.lineTo(xe, ySide + 1); };
        fillPath(c, tri, side < 0 ? p.tile : p.tileD);
      }
      stroke(c, (k) => { k.moveTo(-ov - 1, ySide + 1); k.lineTo(xm, yTip); k.lineTo(t + ov + 1, ySide + 1); }, 4.4, INK);
      stroke(c, (k) => { k.moveTo(-ov, ySide + 1); k.lineTo(xm, yTip + 0.5); k.lineTo(t + ov, ySide + 1); }, 2.2, p.ridge);
      blob(c, rrect(xm - 5, yTip - 2, 10, 12, 1.5), p.ridge, null, 2);
      ridgeEnd(c, st === 'temple' ? 'temple' : 'town', p, xm, yTip, -1, 0.55);
      snowPatch(c, xm, yTip - 1, 4, 2.4, artRng(13));
    },
  };
}

/** 院门的门楼：跨在横墙门洞上的一个小两坡顶，两根柱、一道额枋、一块匾、两盏灯笼。参考点是门洞左边、墙北边线；g 门洞宽 */
export function gatehouse(st: Style, g: number, t: number, seed: number): Piece {
  const pad = 40;
  const zr = 104;
  const top = zr + 20;
  return {
    w: g + pad * 2,
    h: top + t + 4,
    ax: pad,
    ay: top,
    draw: (c) => {
      const p = PAL[st === 'hut' ? 'town' : st];
      const ze = 84;
      // 两根柱（立在两边墙头上）
      for (const x of [-10, g]) {
        blob(c, rrect(x, t - ze, 10, ze, 1.5), st === 'temple' ? p.col : '#4a2e22', st === 'temple' ? p.colD : '#2e1c15', 2, 1.4);
        blob(c, rrect(x - 2, t - 9, 14, 9, 1), p.plinthL, p.plinth, 1.6, 1);
      }
      // 额枋和匾
      blob(c, rrect(-12, t - ze + 6, g + 24, 9, 1.2), st === 'temple' ? '#2f5d74' : '#5a3424', st === 'temple' ? '#1e3e50' : '#3a2018', 2, 1.2);
      if (st === 'temple') for (let x = 4; x < g; x += 16) dab(c, rrect(x, t - ze + 8.5, 8, 4, 1.5), '#e8c050', 0.85);
      blob(c, rrect(g / 2 - 18, t - ze + 13, 36, 13, 1.2), '#1e2a4a', null, 2);
      stroke(c, (k) => { k.rect(g / 2 - 16, t - ze + 15, 32, 9); }, 1, '#e8c050');
      for (const x of [g / 2 - 8, g / 2, g / 2 + 8]) dab(c, rrect(x - 2.4, t - ze + 17, 4.8, 5, 1), '#e8c050', 0.9);
      // 小屋顶
      roofH(c, st === 'hut' ? 'town' : st, { x0: -24, x1: g + 24, d: t, ze, zr, ov: 8, lift: st === 'temple' ? 12 : 9, hip: 0, seed, snow: 0.8 });
      for (const x of [6, g - 6]) lantern(c, x, t - ze + 15, 0.95);
    },
  };
}

// ───────────────────────── 院里的小棚（图集里） ─────────────────────────

/** 棚（100 × 92，脚在底）：贴墙的小棚，两根柱子撑一个小两坡顶，棚下堆着柴和筐；只是装饰 */
function shed(c: Ctx, st: Style): void {
  const p = PAL[st];
  c.save();
  c.translate(14, 74);
  blob(c, ellipse(36, 4, 44, 6), 'rgba(40,50,80,0.28)', null, 0);
  blob(c, (k) => k.rect(-2, -34, 76, 34), '#241c26', null, 2);
  for (const x of [-2, 70]) blob(c, rrect(x, -40, 6, 40, 1.4), p.col, p.colD, 1.8, 1);
  blob(c, ellipse(20, -6, 12, 6), '#9c7a3a', '#6e5424', 1.8, 1.2);
  for (let i = 0; i < 4; i++) stroke(c, (k) => { k.moveTo(10 + i * 6, -10); k.lineTo(14 + i * 6, -2); }, 1.2, '#5e4422');
  blob(c, rrect(40, -14, 22, 12, 2), '#6b4a2e', '#4a3220', 1.8, 1.2);
  roofH(c, st, { x0: -10, x1: 82, d: 26, ze: 42, zr: 58, ov: 6, lift: st === 'hut' ? 1 : 6, hip: 0, seed: 7, snow: 1.4 });
  c.restore();
}

const mk = (key: string, w: number, h: number, ox: number, oy: number, draw: (c: Ctx) => void): SpriteDef => ({ key, w, h, ox, oy, draw });

export const SPRITES10: SpriteDef[] = STYLES.map((st) => mk(`shed_${st}`, 100, 92, 0.5, 0.95, (c) => shed(c, st)));
