/**
 * 10-20 新流派「纸兵」的图（全部程序画）：法器图标、进化图标、被动「剪刀」、两个双修图标（火兵、鸣兵），
 * 以及场上走的纸兵本体。纸兵是黄纸剪的小人：方脑袋、朱砂点的脸、手里一杆小纸枪——和怪里的「纸人」（白纸扎、红脸蛋）一眼分得开。
 */
import { INK, blob, circle, dab, ellipse, poly, rrect, stroke, type Ctx } from './draw.ts';
import type { SpriteDef } from './sprites.ts';

const PAPER = '#f4d675';
const PAPER_SH = '#c99a32';
const CINNABAR = '#d6342c';

/** 一个纸兵，(x, y) 是脚底，s 是缩放 */
function soldier(c: Ctx, x: number, y: number, s: number, fire = false): void {
  c.save();
  c.translate(x, y);
  c.scale(s, s);
  if (fire) dab(c, ellipse(0, -14, 13, 16), '#ff8a3a', 0.35);
  // 身子：一张梯形纸，下摆剪出两条腿
  blob(c, (k) => { k.moveTo(-7, -18); k.lineTo(7, -18); k.lineTo(9, -2); k.lineTo(3, -2); k.lineTo(2, 4); k.lineTo(-2, 4); k.lineTo(-3, -2); k.lineTo(-9, -2); k.closePath(); }, PAPER, PAPER_SH, 1.8, 1.6);
  // 腰带一道朱砂
  stroke(c, (k) => { k.moveTo(-8, -9); k.lineTo(8, -9); }, 1.6, CINNABAR);
  // 方脑袋 + 朱砂点的眼和嘴
  blob(c, rrect(-6, -30, 12, 12, 2), PAPER, PAPER_SH, 1.8, 1.2);
  dab(c, circle(-2.4, -25, 1.1), INK);
  dab(c, circle(2.4, -25, 1.1), INK);
  stroke(c, (k) => { k.moveTo(-2, -21.4); k.lineTo(2, -21.4); }, 1.2, CINNABAR);
  // 纸枪
  stroke(c, (k) => { k.moveTo(9, -4); k.lineTo(13, -32); }, 1.6, '#8a5a22');
  blob(c, poly(13, -36, 15.4, -30, 10.8, -31), '#e8e2d4', '#9a948a', 1.2, 0.6);
  c.restore();
}

function scissors(c: Ctx, x: number, y: number, s: number): void {
  c.save();
  c.translate(x, y);
  c.scale(s, s);
  stroke(c, (k) => { k.moveTo(-2, -2); k.lineTo(10, -12); }, 2.6, '#9aa4b4');
  stroke(c, (k) => { k.moveTo(2, -2); k.lineTo(-10, -12); }, 2.6, '#bcc4d2');
  blob(c, ellipse(-5, 4, 4.2, 3.4), '#d6342c', '#8a1f1a', 1.6, 1);
  blob(c, ellipse(5, 4, 4.2, 3.4), '#d6342c', '#8a1f1a', 1.6, 1);
  dab(c, circle(0, -2, 1.3), INK);
  c.restore();
}

function plate(c: Ctx, base: string, dark: string): void {
  dab(c, circle(16, 16, 15.8), base, 0.35);
  blob(c, circle(16, 16, 14.6), base, dark, 2.1, 2.6);
  stroke(c, (k) => k.arc(16, 16, 13, 0, Math.PI * 2), 1.5, '#f2c94c');
}

function iZhibing(c: Ctx): void {
  dab(c, circle(16, 16, 14), '#fff3c4', 0.6);
  soldier(c, 11, 28, 0.62);
  soldier(c, 21, 29, 0.72);
}

function iZhibingEvo(c: Ctx): void {
  dab(c, circle(16, 16, 15), '#ffd27a', 0.45);
  soldier(c, 7, 26, 0.5);
  soldier(c, 25, 26, 0.5);
  soldier(c, 16, 30, 0.7);
  for (const [x, y] of [[5, 8], [27, 7], [16, 4]] as const) dab(c, ellipse(x, y, 2, 1.5), '#c8902a');
}

function pJiandao(c: Ctx): void {
  dab(c, circle(16, 16, 14), '#e6ecf4', 0.5);
  scissors(c, 16, 19, 1.05);
  // 剪下来的一条纸
  blob(c, poly(4, 26, 12, 22, 13, 25, 5, 29), PAPER, PAPER_SH, 1.2, 0.8);
}

function mHuobing(c: Ctx): void {
  plate(c, '#ff9a5a', '#b8441e');
  soldier(c, 16, 27, 0.66, true);
  for (const [x, y, r] of [[8, 22, 2.4], [24, 21, 2], [10, 13, 1.6]] as const) dab(c, circle(x, y, r), '#ffd04a', 0.95);
}

function mMingbing(c: Ctx): void {
  plate(c, '#9fd0ff', '#3a7ab8');
  soldier(c, 15, 28, 0.66);
  // 腰上的小铃
  blob(c, ellipse(22, 20, 3.4, 3.6), '#f2c94c', '#a07a1a', 1.4, 1);
  stroke(c, (k) => { k.arc(16, 16, 11, -0.6, 0.6); }, 1.4, '#ffffff');
  stroke(c, (k) => { k.arc(16, 16, 11, Math.PI - 0.6, Math.PI + 0.6); }, 1.4, '#ffffff');
}

/** 场上的纸兵（30×40，脚底对齐） */
function zhibingSprite(c: Ctx): void {
  dab(c, ellipse(15, 38, 9, 2.4), INK, 0.2);
  soldier(c, 15, 37, 1);
}

const icon = (key: string, draw: (c: Ctx) => void): SpriteDef => ({ key, w: 32, h: 32, ox: 0.5, oy: 0.5, draw });

export const SPRITES13: SpriteDef[] = [
  icon('i_zhibing', iZhibing),
  icon('i_zhibing_evo', iZhibingEvo),
  icon('p_jiandao', pJiandao),
  icon('m_huobing', mHuobing),
  icon('m_mingbing', mMingbing),
  { key: 'zhibing_s', w: 32, h: 42, ox: 0.5, oy: 0.9, draw: zhibingSprite },
];
