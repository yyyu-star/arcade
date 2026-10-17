/**
 * 第七批：标题页主视觉和结算图标（DESIGN.md 11 节 8d）。
 * 主视觉不进图集：标题页自己开一张 canvas，静的部分（夜空、月、古镇屋檐、地面、立绘）画一次，
 * 动的部分（月晕、灯笼晃动、飘雪）每帧叠上去。小道士直接放大画 sprites.ts 里的 `hero`（矢量，放大不糊），保证和对局里是同一个人。
 * 图集里只登记两个小图标：灯笼（夜探卡）、奖牌（结算的本局最强）。
 */
import { SPRITES, type SpriteDef } from './sprites.ts';
import { INK, blob, circle, dab, ellipse, poly, rrect, stroke, type Ctx } from './draw.ts';

const ROOF = '#1d2038';
const ROOF_L = '#2c3150';
const SNOW = '#f2f6fc';

/** 灯笼（挂绳在 (0,0)，往下 50）：朱红灯身、金边、穗子 */
export function drawLanternHang(c: Ctx, glow = 1): void {
  stroke(c, (k) => { k.moveTo(0, 0); k.lineTo(0, 9); }, 2, INK);
  const g = c.createRadialGradient(0, 28, 2, 0, 28, 46);
  g.addColorStop(0, `rgba(255,200,110,${0.55 * glow})`);
  g.addColorStop(1, 'rgba(255,200,110,0)');
  c.fillStyle = g;
  c.fillRect(-50, -20, 100, 100);
  blob(c, rrect(-8, 8, 16, 5, 2), '#3a2a1c', null, 2);
  blob(c, (k) => { k.moveTo(-9, 13); k.quadraticCurveTo(-19, 28, -9, 43); k.lineTo(9, 43); k.quadraticCurveTo(19, 28, 9, 13); }, '#e2452f', '#b8301f', 2.4, 3);
  dab(c, ellipse(0, 28, 6, 12), '#ffd57a', 0.55);
  stroke(c, (k) => { k.moveTo(-14, 28); k.lineTo(14, 28); }, 1.2, 'rgba(23,19,28,0.55)');
  blob(c, rrect(-9, 42, 18, 5, 2), '#3a2a1c', null, 2);
  stroke(c, (k) => { k.moveTo(0, 47); k.lineTo(0, 58); }, 2.4, '#f2c94c');
  stroke(c, (k) => { k.moveTo(-3, 56); k.lineTo(-4, 64); k.moveTo(0, 56); k.lineTo(0, 66); k.moveTo(3, 56); k.lineTo(4, 64); }, 1.6, '#f2c94c');
}

/** 一段飞檐屋顶的剪影：x0..x1 宽，屋脊在 y，檐角上翘 */
function eave(c: Ctx, x0: number, x1: number, y: number, hgt: number, color: string): void {
  const cx = (x0 + x1) / 2;
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(x0 - 18, y + hgt * 0.55 - 14);
  c.quadraticCurveTo(x0 + 10, y + hgt * 0.7, x0 + 40, y + hgt * 0.45);
  c.quadraticCurveTo(cx - 40, y + 6, cx, y);
  c.quadraticCurveTo(cx + 40, y + 6, x1 - 40, y + hgt * 0.45);
  c.quadraticCurveTo(x1 - 10, y + hgt * 0.7, x1 + 18, y + hgt * 0.55 - 14);
  c.quadraticCurveTo(x1 + 6, y + hgt * 0.85, x1 - 24, y + hgt * 0.95);
  c.lineTo(x0 + 24, y + hgt * 0.95);
  c.quadraticCurveTo(x0 - 6, y + hgt * 0.85, x0 - 18, y + hgt * 0.55 - 14);
  c.fill();
  // 屋脊上的雪
  c.fillStyle = SNOW;
  c.beginPath();
  c.moveTo(cx - (x1 - x0) * 0.3, y + 9);
  c.quadraticCurveTo(cx, y - 7, cx + (x1 - x0) * 0.3, y + 9);
  c.quadraticCurveTo(cx, y + 2, cx - (x1 - x0) * 0.3, y + 9);
  c.fill();
}

/** 远处的古镇：几座屋顶、一座塔，只有剪影（越远越浅，和夜空融在一起） */
function town(c: Ctx, w: number, horizon: number): void {
  const s = Math.max(0.6, Math.min(1.4, w / 1280));
  // 最远一层：浅灰蓝的屋脊
  c.fillStyle = '#4a5580';
  for (let x = -40; x < w + 80; x += 150 * s) {
    const hh = 38 * s + ((x * 7) % 5) * 5;
    c.beginPath();
    c.moveTo(x, horizon);
    c.lineTo(x + 20 * s, horizon - hh);
    c.lineTo(x + 100 * s, horizon - hh);
    c.lineTo(x + 124 * s, horizon);
    c.fill();
  }
  // 塔
  const tx = w * 0.62;
  c.fillStyle = '#3a4470';
  for (let i = 0; i < 4; i++) {
    const ww = (54 - i * 9) * s;
    const yy = horizon - (46 + i * 34) * s;
    c.beginPath();
    c.moveTo(tx - ww - 14 * s, yy);
    c.quadraticCurveTo(tx - ww, yy - 8 * s, tx, yy - 22 * s);
    c.quadraticCurveTo(tx + ww, yy - 8 * s, tx + ww + 14 * s, yy);
    c.lineTo(tx + ww * 0.6, yy + 6 * s);
    c.lineTo(tx - ww * 0.6, yy + 6 * s);
    c.fill();
    c.fillRect(tx - ww * 0.5, yy + 4 * s, ww, 26 * s);
  }
  c.fillRect(tx - 1.5 * s, horizon - 220 * s, 3 * s, 30 * s);
}

/** 静的底图：夜空渐变、星、月（不含月晕）、远处古镇、雪地、近处的屋檐剪影、道士。返回雪线 y 供动画层用 */
export function drawTitleStill(c: Ctx, w: number, h: number): { horizon: number; moon: { x: number; y: number; r: number }; hero: { x: number; y: number; s: number } } {
  const horizon = h * 0.66;
  const sky = c.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#141a38');
  sky.addColorStop(0.7, '#2f3a6c');
  sky.addColorStop(1, '#55649a');
  c.fillStyle = sky;
  c.fillRect(0, 0, w, horizon + 2);
  // 星
  let s = 7;
  const rnd = (): number => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 70; i++) {
    c.fillStyle = `rgba(255,248,224,${0.3 + rnd() * 0.6})`;
    const r = 0.6 + rnd() * 1.3;
    c.fillRect(rnd() * w, rnd() * horizon * 0.8, r, r);
  }
  const moon = { x: w * 0.8, y: h * 0.2, r: Math.max(26, h * 0.075) };
  c.fillStyle = '#fff4cf';
  c.beginPath();
  c.arc(moon.x, moon.y, moon.r, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = 'rgba(214,190,130,0.55)';
  for (const [dx, dy, rr] of [[-0.3, -0.2, 0.22], [0.25, 0.25, 0.3], [0.1, -0.4, 0.14]] as const) {
    c.beginPath();
    c.arc(moon.x + dx * moon.r, moon.y + dy * moon.r, rr * moon.r, 0, Math.PI * 2);
    c.fill();
  }
  town(c, w, horizon);
  // 雪地：浅灰蓝渐变，起伏的雪线
  const gr = c.createLinearGradient(0, horizon, 0, h);
  gr.addColorStop(0, '#cdd6ea');
  gr.addColorStop(1, '#eef2f9');
  c.fillStyle = gr;
  c.beginPath();
  c.moveTo(0, horizon);
  for (let x = 0; x <= w; x += 20) c.lineTo(x, horizon + Math.sin(x * 0.012) * 4);
  c.lineTo(w, h);
  c.lineTo(0, h);
  c.fill();
  // 近景左上、右上的屋檐（压在画面边上，像从屋檐下看出去）
  eave(c, -w * 0.12, w * 0.3, -h * 0.02, h * 0.17, ROOF);
  eave(c, w * 0.7, w * 1.12, -h * 0.04, h * 0.2, ROOF_L);
  // 道士：放大画，站在雪地上，脚下一个大影子
  const small = w < 900;
  const hs = (h * (small ? 0.4 : 0.62)) / 70;
  const hero = { x: small ? w * 0.075 : Math.min(w * 0.17, 240), y: h * (small ? 0.93 : 0.9), s: hs };
  c.fillStyle = 'rgba(70,84,130,0.28)';
  c.beginPath();
  c.ellipse(hero.x, hero.y, 38 * hs, 8 * hs, 0, 0, Math.PI * 2);
  c.fill();
  c.save();
  c.translate(hero.x, hero.y);
  c.scale(hs, hs);
  c.translate(-30, -66.5);
  SPRITES.find((d) => d.key === 'hero')!.draw(c);
  c.restore();
  return { horizon, moon, hero };
}

/** 动的层：月晕呼吸、两串灯笼晃动、道士头顶盘旋的符。t 为毫秒 */
export function drawTitleLive(c: Ctx, w: number, h: number, info: ReturnType<typeof drawTitleStill>, t: number): void {
  const { moon, hero } = info;
  const pulse = 1 + Math.sin(t * 0.0013) * 0.06;
  const g = c.createRadialGradient(moon.x, moon.y, moon.r * 0.9, moon.x, moon.y, moon.r * 5.2 * pulse);
  g.addColorStop(0, 'rgba(255,240,190,0.55)');
  g.addColorStop(0.35, 'rgba(255,240,190,0.2)');
  g.addColorStop(1, 'rgba(255,240,190,0)');
  c.fillStyle = g;
  c.fillRect(moon.x - moon.r * 6, moon.y - moon.r * 6, moon.r * 12, moon.r * 12);
  // 灯笼：从屋檐下垂，绕挂点晃
  const ls = Math.max(0.8, Math.min(1.5, h / 600));
  for (const [fx, fy, ph] of [[0.06, 0.1, 0], [0.19, 0.075, 1.7], [0.95, 0.09, 2.4]] as const) {
    c.save();
    c.translate(w * fx, h * fy);
    c.rotate(Math.sin(t * 0.0016 + ph) * 0.09);
    c.scale(ls, ls);
    drawLanternHang(c, 0.85 + Math.sin(t * 0.004 + ph) * 0.15);
    c.restore();
  }
  // 头顶两张符绕着转
  const tal = SPRITES.find((d) => d.key === 'talisman')!;
  for (let i = 0; i < 3; i++) {
    const a = t * 0.0014 + (i * Math.PI * 2) / 3;
    c.save();
    c.translate(hero.x + Math.cos(a) * 62 * hero.s * 0.5, hero.y - 80 * hero.s * 0.5 - 20 + Math.sin(a) * 14);
    c.rotate(Math.cos(a) * 0.5);
    c.scale(hero.s * 0.45, hero.s * 0.45);
    c.translate(-7, -12);
    tal.draw(c);
    c.restore();
  }
}

/** 飘雪：粒子由调用方持有，这里只推进并画 */
export interface Flake { x: number; y: number; r: number; v: number; ph: number }
export function makeFlakes(n: number, w: number, h: number): Flake[] {
  let s = 99;
  const rnd = (): number => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  return Array.from({ length: n }, () => ({ x: rnd() * w, y: rnd() * h, r: 1.2 + rnd() * 2.6, v: 18 + rnd() * 40, ph: rnd() * 6 }));
}
export function drawFlakes(c: Ctx, fl: Flake[], w: number, h: number, dt: number, t: number): void {
  c.fillStyle = 'rgba(255,255,255,0.9)';
  for (const f of fl) {
    f.y += f.v * dt;
    f.x += Math.sin(t * 0.001 + f.ph) * 8 * dt + 6 * dt;
    if (f.y > h + 4) { f.y = -4; f.x = (f.x * 7.3) % w; }
    if (f.x > w + 4) f.x = -4;
    c.beginPath();
    c.arc(f.x, f.y, f.r, 0, Math.PI * 2);
    c.fill();
  }
}

/** 模式卡上的小场景（宽 × 高自定）：守夜 = 月 + 屋檐 + 雪；夜探 = 灯笼 + 山门 + 夜色 */
export function drawModeScene(c: Ctx, w: number, h: number, kind: 'watch' | 'raid'): void {
  const sky = c.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, kind === 'watch' ? '#1c2548' : '#2a1d36');
  sky.addColorStop(1, kind === 'watch' ? '#5a6aa0' : '#6a4048');
  c.fillStyle = sky;
  c.fillRect(0, 0, w, h);
  if (kind === 'watch') {
    const g = c.createRadialGradient(w * 0.75, h * 0.3, 2, w * 0.75, h * 0.3, h * 0.7);
    g.addColorStop(0, 'rgba(255,240,190,0.6)');
    g.addColorStop(1, 'rgba(255,240,190,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#fff4cf';
    c.beginPath();
    c.arc(w * 0.75, h * 0.3, h * 0.13, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#3a4470';
    c.beginPath();
    c.moveTo(w * 0.1, h * 0.74);
    c.quadraticCurveTo(w * 0.2, h * 0.58, w * 0.3, h * 0.56);
    c.quadraticCurveTo(w * 0.4, h * 0.58, w * 0.52, h * 0.74);
    c.fill();
    c.fillRect(w * 0.14, h * 0.72, w * 0.34, h * 0.1);
  } else {
    // 山门两根柱子 + 横梁，中间一盏灯笼
    c.fillStyle = '#2a1a20';
    c.fillRect(w * 0.18, h * 0.22, w * 0.07, h * 0.6);
    c.fillRect(w * 0.75, h * 0.22, w * 0.07, h * 0.6);
    c.fillRect(w * 0.12, h * 0.18, w * 0.76, h * 0.07);
    c.save();
    c.translate(w * 0.5, h * 0.25);
    c.scale(h / 120, h / 120);
    drawLanternHang(c, 1);
    c.restore();
  }
  const gr = c.createLinearGradient(0, h * 0.78, 0, h);
  gr.addColorStop(0, '#cdd6ea');
  gr.addColorStop(1, '#eef2f9');
  c.fillStyle = gr;
  c.beginPath();
  c.moveTo(0, h * 0.8);
  c.quadraticCurveTo(w * 0.5, h * 0.72, w, h * 0.82);
  c.lineTo(w, h);
  c.lineTo(0, h);
  c.fill();
}

/** 本局最强的奖牌：金圈 + 朱红绶带 */
function medal(c: Ctx): void {
  blob(c, poly(9, 2, 15, 2, 17, 14, 12, 18), '#c8402f', '#9a2a1d', 1.8, 1.4);
  blob(c, poly(23, 2, 17, 2, 15, 14, 20, 18), '#e2582f', '#b8301f', 1.8, 1.4);
  blob(c, circle(16, 21, 8.5), '#f2c94c', '#c28f1e', 2.2, 1.6);
  stroke(c, (k) => { k.arc(16, 21, 5.4, 0, Math.PI * 2); }, 1.2, '#a8741a');
  blob(c, poly(16, 16.5, 17.5, 20, 21, 20.3, 18.4, 22.6, 19.2, 26, 16, 24, 12.8, 26, 13.6, 22.6, 11, 20.3, 14.5, 20), '#fff1a8', null, 1);
}

export const SPRITES7: SpriteDef[] = [
  { key: 'ui_lantern', w: 32, h: 44, ox: 0.5, oy: 0.5, draw: (c) => { c.translate(16, 2); c.scale(0.62, 0.62); drawLanternHang(c, 0); } },
  { key: 'ui_medal', w: 32, h: 32, ox: 0.5, oy: 0.5, draw: medal },
];
