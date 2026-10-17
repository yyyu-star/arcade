/**
 * 第十批精灵：夜探镇子的建筑（俯视角的中式建筑）。规则层挡路的矩形（院墙、正房）形状不动，只换画法：
 * - 院墙：墙头是青瓦（瓦垄、檐口滴水），墙身露一截带砖缝的立面；四个墙角各有翘檐；
 * - 正房：成排的瓦顶，瓦垄、屋脊、两端翘起的鸱吻和檐角，朝街一面是门或窗（窗透暖光，门口挂灯笼）；
 * - 棚：贴着院墙内侧的小棚顶（只是装饰，不挡路）。
 * 三种样式：town（古镇：白墙青瓦）、temple（山寺和各处的庙：红墙黄瓦）、hut（渡口：木板墙茅草顶）。
 * 横向的段周期 80、竖向的段周期 80，画到画布外一点，拼起来接缝没有描边（同 sprites6、8）。
 */
import type { SpriteDef } from './sprites.ts';
import { INK, artRng, blob, circle, dab, ellipse, poly, rrect, stroke, type Ctx } from './draw.ts';

export type Style = 'town' | 'temple' | 'hut';
export const STYLES: readonly Style[] = ['town', 'temple', 'hut'];

const SNOW = '#f6f9fd';
const SNOW_D = '#cdd8e6';

interface Pal {
  roof: string;
  roofD: string;
  roofL: string;
  ridge: string;
  wall: string;
  wallD: string;
  plinth: string;
  wood: string;
  trim: string;
}

const PAL: Record<Style, Pal> = {
  town: { roof: '#4a5160', roofD: '#2f3440', roofL: '#626a7c', ridge: '#2c303a', wall: '#dcd9cf', wallD: '#b3b0a6', plinth: '#6b7380', wood: '#6a4a38', trim: '#3a3d48' },
  temple: { roof: '#d9ad3a', roofD: '#a07a20', roofL: '#f2d472', ridge: '#e8c050', wall: '#b03a2e', wallD: '#7e2519', plinth: '#7a6a58', wood: '#e2b94a', trim: '#8a5a18' },
  hut: { roof: '#b89a54', roofD: '#8a6e36', roofL: '#d4b86e', ridge: '#8a6e36', wall: '#8a6a48', wallD: '#5e4630', plinth: '#6b5a48', wood: '#4a3328', trim: '#5e4630' },
};

const MORTAR = 'rgba(30,34,44,0.5)';

/** 红灯笼（挂点在顶端 x, y） */
function lantern(c: Ctx, x: number, y: number, s = 1): void {
  const g = c.createRadialGradient(x, y + 12 * s, 1, x, y + 12 * s, 22 * s);
  g.addColorStop(0, 'rgba(255,190,110,0.55)');
  g.addColorStop(1, 'rgba(255,190,110,0)');
  c.fillStyle = g;
  c.fillRect(x - 24 * s, y - 10 * s, 48 * s, 48 * s);
  stroke(c, (k) => { k.moveTo(x, y); k.lineTo(x, y + 4 * s); }, 1.6);
  blob(c, ellipse(x, y + 12 * s, 7 * s, 8 * s), '#e2452f', '#b8301f', 2, 1.4);
  dab(c, ellipse(x, y + 12 * s, 2.8 * s, 5 * s), '#ffd57a', 0.8);
  blob(c, circle(x, y + 3.6 * s, 2 * s), '#3a2a22', null, 1.2);
}

/** 一片瓦面：矩形区域里竖向瓦垄（每 10 一对：亮脊暗沟），hut 画成横向稻草 */
function tiles(c: Ctx, st: Style, x0: number, y0: number, w: number, h: number, vertical = true): void {
  const p = PAL[st];
  blob(c, (k) => k.rect(x0, y0, w, h), p.roof, p.roofD, 2.4, 2.2);
  if (st === 'hut') {
    const r = artRng(5);
    for (let y = y0 + 4; y < y0 + h; y += 5) {
      stroke(c, (k) => { k.moveTo(x0, y + (r() - 0.5) * 2); k.lineTo(x0 + w, y + (r() - 0.5) * 2); }, 1, 'rgba(60,40,10,0.45)');
    }
    for (let i = 0; i < 14; i++) dab(c, ellipse(x0 + ((i * 37) % w), y0 + ((i * 53) % h), 6, 0.9), p.roofL, 0.7);
    return;
  }
  if (vertical) {
    for (let x = x0 + 5; x < x0 + w; x += 10) {
      stroke(c, (k) => { k.moveTo(x, y0 + 2); k.lineTo(x, y0 + h - 1); }, 1.3, 'rgba(10,10,16,0.55)');
      stroke(c, (k) => { k.moveTo(x - 3.2, y0 + 2); k.lineTo(x - 3.2, y0 + h - 1); }, 1.2, p.roofL);
    }
    for (let y = y0 + 12; y < y0 + h; y += 12) stroke(c, (k) => { k.moveTo(x0, y); k.lineTo(x0 + w, y); }, 0.9, 'rgba(10,10,16,0.22)');
  } else {
    for (let y = y0 + 5; y < y0 + h; y += 10) {
      stroke(c, (k) => { k.moveTo(x0, y); k.lineTo(x0 + w, y); }, 1.3, 'rgba(10,10,16,0.55)');
      stroke(c, (k) => { k.moveTo(x0, y - 3.2); k.lineTo(x0 + w, y - 3.2); }, 1.2, p.roofL);
    }
  }
}

/** 檐口的滴水：沿一条横边每 10 一个圆头瓦当（hut 是垂下的草须） */
function dripH(c: Ctx, st: Style, x0: number, x1: number, y: number): void {
  const p = PAL[st];
  for (let x = x0 + 5; x < x1; x += 10) {
    if (st === 'hut') stroke(c, (k) => { k.moveTo(x, y - 3); k.lineTo(x + 1, y + 4); }, 2.4, p.roofD);
    else blob(c, (k) => { k.moveTo(x - 3.8, y - 3); k.lineTo(x + 3.8, y - 3); k.quadraticCurveTo(x + 3.8, y + 4.5, x, y + 4.5); k.quadraticCurveTo(x - 3.8, y + 4.5, x - 3.8, y - 3); }, p.roofL, p.roofD, 1.6, 0.8);
  }
}

/** 竖边的滴水：每 10 一个，朝 dir 方向（−1 左 / 1 右）凸出 */
function dripV(c: Ctx, st: Style, x: number, y0: number, y1: number, dir: number): void {
  const p = PAL[st];
  for (let y = y0 + 5; y < y1; y += 10) {
    if (st === 'hut') stroke(c, (k) => { k.moveTo(x, y); k.lineTo(x + dir * 6, y + 1); }, 2.4, p.roofD);
    else blob(c, (k) => { k.moveTo(x, y - 3.6); k.lineTo(x, y + 3.6); k.quadraticCurveTo(x + dir * 7, y + 3.6, x + dir * 7, y); k.quadraticCurveTo(x + dir * 7, y - 3.6, x, y - 3.6); }, p.roofL, p.roofD, 1.6, 0.8);
  }
}

/** 鸱吻（屋脊端头的龙吻）：朝上弯的一个钩，ox, oy 是脚，dir 是朝向（−1 左 / 1 右，钩朝里） */
function chiwen(c: Ctx, st: Style, x: number, y: number, dir: number, s = 1): void {
  const p = PAL[st];
  if (st === 'hut') {
    // 茅草屋：脊端两根交叉的草束
    stroke(c, (k) => { k.moveTo(x, y); k.lineTo(x - dir * 5 * s, y - 18 * s); }, 4.6, INK);
    stroke(c, (k) => { k.moveTo(x, y); k.lineTo(x - dir * 5 * s, y - 18 * s); }, 2.6, p.roofL);
    stroke(c, (k) => { k.moveTo(x - dir * 4, y); k.lineTo(x + dir * 5 * s, y - 16 * s); }, 4.6, INK);
    stroke(c, (k) => { k.moveTo(x - dir * 4, y); k.lineTo(x + dir * 5 * s, y - 16 * s); }, 2.6, p.roofL);
    return;
  }
  blob(c, (k) => {
    k.moveTo(x - dir * 9 * s, y);
    k.lineTo(x - dir * 9 * s, y - 6 * s);
    k.quadraticCurveTo(x - dir * 10 * s, y - 20 * s, x - dir * 2 * s, y - 20 * s);
    k.quadraticCurveTo(x + dir * 7 * s, y - 20 * s, x + dir * 5 * s, y - 12 * s);
    k.quadraticCurveTo(x + dir * 2 * s, y - 14 * s, x + dir * 2 * s, y - 8 * s);
    k.lineTo(x + dir * 9 * s, y - 4 * s);
    k.lineTo(x + dir * 9 * s, y);
  }, st === 'temple' ? '#e8c050' : '#3a3d48', st === 'temple' ? '#a07a20' : '#262831', 2.2, 1.2);
  dab(c, circle(x - dir * 2 * s, y - 14 * s, 1.6 * s), '#ffe9a0', 0.9);
}

/** 檐角：屋檐转角翘起的一钩（x, y 在檐口，dir 朝外） */
function horn(c: Ctx, st: Style, x: number, y: number, dir: number, s = 1): void {
  const p = PAL[st];
  blob(c, (k) => {
    k.moveTo(x, y);
    k.quadraticCurveTo(x + dir * 9 * s, y + 1 * s, x + dir * 11 * s, y - 10 * s);
    k.quadraticCurveTo(x + dir * 5 * s, y - 4 * s, x, y - 6 * s);
  }, p.roofL, p.roofD, 2.2, 1);
}

/** 屋顶上的雪：盖住上缘一带，下沿起伏（周期 40），画到 y1 */
function roofSnow(c: Ctx, x0: number, x1: number, y0: number, y1: number): void {
  blob(c, (k) => {
    k.moveTo(x0, y0);
    for (let x = x0; x <= x1; x += 2) k.lineTo(x, y0 - 1 - Math.sin(((x + 4) / 40) * Math.PI * 2) * 1.2);
    k.lineTo(x1, y1 - 4);
    for (let x = x1; x >= x0; x -= 2) k.lineTo(x, y1 + Math.sin((x / 40) * Math.PI * 2) * 4 + Math.max(0, Math.sin((x / 20) * Math.PI * 2)) * 3);
  }, SNOW, SNOW_D, 1.8, 1.6);
}

// ───────────────────────── 院墙 ─────────────────────────

/** 横墙一段（80 宽，画 70 高，脚在底，墙厚 26）：瓦墙头 + 滴水 + 带砖缝的墙面；周期 80 */
function wallH(c: Ctx, st: Style): void {
  const p = PAL[st];
  // 墙面
  blob(c, (k) => k.rect(-4, 38, 88, 32), p.wall, p.wallD, 2.4, 2.4);
  if (st === 'hut') {
    for (let x = 6; x < 80; x += 12) stroke(c, (k) => { k.moveTo(x, 40); k.lineTo(x, 69); }, 1.1, MORTAR);
  } else {
    // 墙根的青砖：三行错缝
    blob(c, (k) => k.rect(-4, 56, 88, 14), p.plinth, null, 2);
    for (const [y0, off] of [[56, 0], [63, 8]] as const) {
      stroke(c, (k) => { k.moveTo(-2, y0 + 7); k.lineTo(82, y0 + 7); }, 1.1, MORTAR);
      for (let x = 8 + off; x < 80; x += 16) stroke(c, (k) => { k.moveTo(x, y0); k.lineTo(x, y0 + 7); }, 1.1, MORTAR);
    }
    // 墙面上一道道雨痕
    dab(c, rrect(14, 44, 3, 11, 1.2), p.wallD, 0.55);
    dab(c, rrect(58, 42, 3, 9, 1.2), p.wallD, 0.55);
  }
  dab(c, ellipse(40, 69, 50, 2.4), SNOW, 0.9);
  // 瓦墙头
  tiles(c, st, -4, 12, 88, 24);
  dripH(c, st, -4, 84, 38);
  blob(c, (k) => k.rect(-4, 8, 88, 6), p.ridge, p.roofD, 2.2, 1.2);
  roofSnow(c, -4, 84, 10, 22);
}

/** 竖墙一段（36 宽，高 80 一段，脚在段底）：俯视只看到瓦墙头，两侧滴水，右边露一条墙面的暗边；周期 80 */
function wallV(c: Ctx, st: Style): void {
  const p = PAL[st];
  blob(c, (k) => k.rect(26, -4, 8, 88), p.wallD, null, 2);
  tiles(c, st, 6, -4, 22, 88, false);
  dripV(c, st, 6, -4, 84, -1);
  dripV(c, st, 28, -4, 84, 1);
  blob(c, (k) => k.rect(14, -4, 6, 88), p.ridge, p.roofD, 2, 1);
  blob(c, (k) => {
    k.moveTo(13, -4);
    for (let y = -4; y <= 84; y += 2) k.lineTo(13 - Math.sin(((y + 4) / 40) * Math.PI * 2) * 1.2, y);
    k.lineTo(21, 84);
    for (let y = 84; y >= -4; y -= 2) k.lineTo(21 + Math.sin((y / 20) * Math.PI * 2) * 1.3, y);
  }, SNOW, SNOW_D, 1.6, 1.2);
}

/** 墙角（44 × 64，脚在底中）：方形的瓦墙头，两个上翘的檐角 */
function corner(c: Ctx, st: Style): void {
  const p = PAL[st];
  blob(c, (k) => k.rect(8, 40, 28, 22), p.wall, p.wallD, 2.4, 2);
  blob(c, (k) => k.rect(8, 54, 28, 8), p.plinth, null, 1.8);
  tiles(c, st, 5, 16, 34, 24);
  dripH(c, st, 5, 39, 42);
  blob(c, (k) => k.rect(5, 12, 34, 6), p.ridge, p.roofD, 2, 1);
  horn(c, st, 6, 40, -1);
  horn(c, st, 38, 40, 1);
  chiwen(c, st, 22, 14, 1, 0.7);
  roofSnow(c, 5, 39, 14, 26);
}

// ───────────────────────── 正房 ─────────────────────────

/** 正房一段（80 宽，画 128 高，脚在底）：瓦顶 + 檐口 + 墙面（窗或门）。kind: win 窗 / door 门；周期 80 */
function houseH(c: Ctx, st: Style, kind: 'win' | 'door'): void {
  const p = PAL[st];
  // 墙身
  blob(c, (k) => k.rect(-4, 80, 88, 48), p.wall, p.wallD, 2.4, 2.2);
  blob(c, (k) => k.rect(-4, 118, 88, 10), p.plinth, null, 2);
  for (const x of [-2, 78]) blob(c, rrect(x, 80, 6, 40, 1.4), p.wood === '#e2b94a' ? '#7e2519' : p.wood, null, 1.8);
  // 夜里镇上最显眼的暖光
  const wg = c.createRadialGradient(40, 100, 4, 40, 100, 36);
  wg.addColorStop(0, 'rgba(255,200,110,0.5)');
  wg.addColorStop(1, 'rgba(255,200,110,0)');
  c.fillStyle = wg;
  c.fillRect(0, 80, 80, 44);
  if (kind === 'win') {
    blob(c, rrect(24, 88, 32, 26, 2), st === 'temple' ? '#7e2519' : '#4a3328', null, 2.2);
    dab(c, rrect(28, 92, 24, 18, 1), '#ffd36e', 1);
    dab(c, rrect(32, 95, 16, 12, 1), '#fff1b8', 0.7);
    for (const x of [34, 40, 46]) stroke(c, (k) => { k.moveTo(x, 92); k.lineTo(x, 110); }, 1.2, p.wood);
    stroke(c, (k) => { k.moveTo(28, 101); k.lineTo(52, 101); }, 1.2, p.wood);
  } else {
    // 门：两扇红门，门钉，门前一级石阶，两侧灯笼
    blob(c, rrect(24, 86, 32, 36, 2), '#3a2418', null, 2.4);
    blob(c, rrect(26, 88, 14, 33, 1), '#b03a2e', '#7e2519', 2, 1.4);
    blob(c, rrect(40, 88, 14, 33, 1), '#b03a2e', '#7e2519', 2, 1.4);
    for (const x of [30, 36, 44, 50]) for (const y of [94, 102, 110]) dab(c, circle(x, y, 1.1), '#e2b94a');
    dab(c, circle(38, 104, 1.6), '#e2b94a');
    dab(c, circle(42, 104, 1.6), '#e2b94a');
    blob(c, rrect(20, 121, 40, 7, 1.6), '#8e939d', '#686d78', 2, 1.2);
    dab(c, rrect(24, 86, 32, 5, 1), '#ffd36e', 0.3);
  }
  // 瓦顶
  if (st === 'hut') tiles(c, st, -4, 10, 88, 62, false);
  else tiles(c, st, -4, 10, 88, 62);
  dripH(c, st, -4, 84, 74);
  blob(c, (k) => k.rect(-4, 70, 88, 6), p.ridge === '#e8c050' ? '#8a5a18' : p.trim, null, 2);
  // 屋脊：town 深色，temple 金色加走兽，hut 草脊
  blob(c, (k) => k.rect(-4, 3, 88, 9), p.ridge, p.roofD, 2.2, 1.2);
  if (st === 'temple') for (const x of [20, 60]) dab(c, poly(x - 4, 3, x, -2, x + 4, 3), '#ffe9a0', 0.9);
  roofSnow(c, -4, 84, 6, 44);
  dab(c, ellipse(20, 8, 8, 1.1), '#ffffff', 0.9);
  dab(c, ellipse(60, 8, 8, 1.1), '#ffffff', 0.9);
  // 门口的灯笼：挂在檐下
  if (kind === 'door') {
    lantern(c, 12, 77, 1);
    lantern(c, 68, 77, 1);
  }
}

/** 正房的一端（36 × 128，脚在底，中线是屋子的端面，画左端；右端镜像）：鸱吻、山面的垂脊、檐角 */
function houseEnd(c: Ctx, st: Style): void {
  const p = PAL[st];
  // 山面的垂脊：沿屋顶端头一道厚边
  blob(c, (k) => k.rect(10, 10, 12, 64), p.ridge, p.roofD, 2.2, 1.2);
  dripV(c, st, 10, 12, 70, -1);
  blob(c, rrect(8, 78, 14, 44, 2), p.wood === '#e2b94a' ? '#7e2519' : p.wood, null, 2);
  blob(c, rrect(6, 118, 18, 10, 1.6), p.plinth, null, 2);
  horn(c, st, 10, 76, -1, 1.2);
  chiwen(c, st, 16, 10, 1);
  dab(c, ellipse(15, 12, 6, 1.2), SNOW, 0.9);
}

/** 竖向正房一段（110 宽，高 80 一段，脚在段底）：俯视的瓦顶，中间一道脊，两侧滴水；周期 80 */
function houseV(c: Ctx, st: Style): void {
  const p = PAL[st];
  tiles(c, st, 3, -4, 104, 88, false);
  dripV(c, st, 3, -4, 84, -1);
  dripV(c, st, 107, -4, 84, 1);
  blob(c, (k) => k.rect(48, -4, 14, 88), p.ridge, p.roofD, 2, 1.2);
  if (st === 'temple') for (const y of [10, 50]) dab(c, poly(48, y - 4, 55, y - 9, 62, y - 4), '#ffe9a0', 0.9);
  blob(c, (k) => {
    k.moveTo(44, -4);
    for (let y = -4; y <= 84; y += 2) k.lineTo(44 - Math.sin(((y + 4) / 40) * Math.PI * 2) * 1.5, y);
    k.lineTo(66, 84);
    for (let y = 84; y >= -4; y -= 2) k.lineTo(66 + Math.sin((y / 20) * Math.PI * 2) * 1.6, y);
  }, SNOW, SNOW_D, 1.8, 1.4);
  const rng = artRng(st === 'town' ? 81 : st === 'temple' ? 91 : 71);
  for (let i = 0; i < 5; i++) {
    const x = rng() < 0.5 ? 14 + rng() * 22 : 74 + rng() * 22;
    const y = 4 + Math.floor(rng() * 7) * 11;
    dab(c, ellipse(x, y, 7 + rng() * 5, 2.4), SNOW, 0.9);
  }
}

/** 竖向正房的端头（110 × 40，中线在 y 20，画上端；下端镜像）：脊头的鸱吻和两边的檐角 */
function houseVEnd(c: Ctx, st: Style): void {
  chiwen(c, st, 55, 30, 1, 1);
  horn(c, st, 3, 36, -1, 1.1);
  horn(c, st, 107, 36, 1, 1.1);
}

/** 棚（100 × 72，脚在底）：贴墙的小棚顶，两根柱子撑着，瓦面压雪；只是装饰 */
function shed(c: Ctx, st: Style): void {
  const p = PAL[st];
  blob(c, ellipse(50, 66, 42, 5), 'rgba(40,50,80,0.28)', null, 0);
  // 棚下暗处和柱
  blob(c, (k) => k.rect(8, 40, 84, 22), '#241c26', null, 2);
  for (const x of [10, 86]) blob(c, rrect(x, 38, 5, 28, 1.4), p.wood === '#e2b94a' ? '#7e2519' : p.wood, null, 1.8);
  // 棚下堆着柴和筐
  blob(c, ellipse(34, 58, 11, 5), '#9c7a3a', '#6e5424', 1.8, 1.2);
  blob(c, rrect(52, 52, 22, 10, 2), '#6b4a2e', '#4a3220', 1.8, 1.2);
  // 斜顶
  blob(c, poly(0, 40, 14, 8, 86, 8, 100, 40), p.roof, p.roofD, 2.4, 2.2);
  for (let x = 14; x < 90; x += 10) stroke(c, (k) => { k.moveTo(x, 10); k.lineTo(x - (x - 50) * 0.12, 38); }, 1.3, 'rgba(10,10,16,0.5)');
  dripH(c, st, 0, 100, 40);
  blob(c, (k) => k.rect(14, 5, 72, 6), p.ridge, p.roofD, 2, 1);
  dab(c, poly(8, 30, 18, 12, 82, 12, 92, 30, 70, 24, 30, 24), SNOW, 0.96);
}

const mk = (key: string, w: number, h: number, ox: number, oy: number, draw: (c: Ctx) => void): SpriteDef => ({ key, w, h, ox, oy, draw });

export const SPRITES10: SpriteDef[] = STYLES.flatMap((st): SpriteDef[] => {
  const out: SpriteDef[] = [
    mk(`bh_${st}_win`, 80, 128, 0.5, 1, (c) => houseH(c, st, 'win')),
    mk(`bh_${st}_door`, 80, 128, 0.5, 1, (c) => houseH(c, st, 'door')),
    mk(`bhe_${st}`, 36, 128, 0.5, 1, (c) => houseEnd(c, st)),
    mk(`bv_${st}`, 110, 80, 0.5, 1, (c) => houseV(c, st)),
    mk(`bve_${st}`, 110, 40, 0.5, 0.5, (c) => houseVEnd(c, st)),
    mk(`shed_${st}`, 100, 72, 0.5, 0.95, (c) => shed(c, st)),
  ];
  if (st !== 'hut') {
    out.push(
      mk(`qh_${st}`, 80, 70, 0.5, 1, (c) => wallH(c, st)),
      mk(`qv_${st}`, 36, 80, 0.5, 1, (c) => wallV(c, st)),
      mk(`qc_${st}`, 44, 64, 0.5, 0.97, (c) => corner(c, st)),
    );
  }
  return out;
});
