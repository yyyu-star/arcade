/**
 * 第九批精灵：符咒炸弹、铜钱袋两种新掉落，灯笼架、纸扎两种摆设。
 * 掉落把光晕和影子画进图里（同一个槽位只有一个 Image，浮动时光晕跟着走）：雪地很亮，光晕用饱和的橙红 / 金黄，
 * 本体用深色边，远看也认得出"这是个值得去捡的东西"。摆设不画光晕，晕在运行时另放（要跟着灯笼闪）。
 */
import type { SpriteDef } from './sprites.ts';
import { INK, blob, circle, dab, ellipse, poly, rrect, stroke, type Ctx } from './draw.ts';

function halo(c: Ctx, cx: number, cy: number, r: number, rgb: string, a: number): void {
  const g = c.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, `rgba(${rgb},${a})`);
  g.addColorStop(0.55, `rgba(${rgb},${a * 0.4})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = g;
  c.fillRect(cx - r, cy - r, r * 2, r * 2);
}

/** 符咒炸弹：铁黑的小炸雷，缠一圈黄符纸，朱砂符字，顶上的引信冒火星 */
function bomb(c: Ctx): void {
  halo(c, 26, 28, 26, '255,110,40', 0.85);
  dab(c, ellipse(26, 42, 13, 3.2), INK, 0.25);
  // 引信
  stroke(c, (k) => { k.moveTo(27, 13); k.quadraticCurveTo(31, 8, 35, 9); }, 3.6, INK);
  stroke(c, (k) => { k.moveTo(27, 13); k.quadraticCurveTo(31, 8, 35, 9); }, 1.8, '#d9b36a');
  // 火星：亮黄芯 + 橙边的小星
  blob(c, poly(35, 3, 37, 7, 41, 8, 37.5, 10.5, 38.5, 15, 35, 12, 31.5, 15, 32.5, 10.5, 29, 8, 33, 7), '#ffd84a', '#ff8a2a', 1.6, 1);
  dab(c, circle(35, 9, 1.6), '#ffffff');
  // 弹身
  blob(c, circle(26, 29, 13.5), '#3d3f52', '#262837', 2.6, 3.2);
  dab(c, ellipse(20.5, 22.5, 4.2, 2.2, -0.7), '#ffffff', 0.5);
  // 顶盖
  blob(c, rrect(21, 12.5, 10, 5, 2), '#8a8da0', '#5f6275', 2, 1);
  // 黄符纸斜缠一道
  c.save();
  c.translate(26, 29);
  c.rotate(-0.45);
  blob(c, rrect(-15, -5.5, 30, 11, 1.5), '#f6d65a', '#d4a82c', 2.2, 1.6);
  // 符上朱砂字（几笔就够，远看是红道道）
  const r = '#d1301f';
  stroke(c, (k) => { k.moveTo(-9, -2.5); k.lineTo(-4, -2.5); k.moveTo(-6.5, -2.5); k.lineTo(-6.5, 3); }, 1.5, r);
  stroke(c, (k) => { k.moveTo(-1, -3); k.lineTo(4, 3); k.moveTo(4, -3); k.lineTo(-1, 3); }, 1.5, r);
  stroke(c, (k) => { k.moveTo(7, -3); k.lineTo(7, 3); k.moveTo(5.2, 0); k.lineTo(9, 0); }, 1.5, r);
  c.restore();
}

/** 铜钱袋：鼓鼓的红布袋，金绳扎口，口上露出两枚铜钱 */
function purse(c: Ctx): void {
  halo(c, 26, 28, 26, '255,200,40', 0.9);
  dab(c, ellipse(26, 42, 13, 3.2), INK, 0.25);
  // 露出的铜钱
  for (const [x, y, rot] of [[21, 14, -0.3], [31, 13, 0.35]] as const) {
    c.save();
    c.translate(x, y);
    c.rotate(rot);
    blob(c, circle(0, 0, 6), '#f0c850', '#c29a2c', 2, 1.4);
    blob(c, (k) => k.rect(-1.8, -1.8, 3.6, 3.6), '#8a6a1c', null, 1.4);
    c.restore();
  }
  // 袋身
  blob(c, (k) => {
    k.moveTo(19, 19);
    k.quadraticCurveTo(7, 26, 8.5, 36);
    k.quadraticCurveTo(10, 44, 26, 44);
    k.quadraticCurveTo(42, 44, 43.5, 36);
    k.quadraticCurveTo(45, 26, 33, 19);
    k.quadraticCurveTo(26, 22, 19, 19);
  }, '#d63b2c', '#a32619', 2.6, 3);
  dab(c, ellipse(17, 31, 3.2, 6.5, 0.4), '#ffffff', 0.35);
  // 布褶
  stroke(c, (k) => { k.moveTo(26, 25); k.quadraticCurveTo(24, 33, 26, 41); }, 1.2, 'rgba(23,19,28,0.4)');
  // 金绳扎口 + 绳头
  blob(c, rrect(17.5, 17.5, 17, 5, 2.4), '#f0c850', '#c29a2c', 2, 1);
  stroke(c, (k) => { k.moveTo(30, 21); k.quadraticCurveTo(36, 24, 35, 29); }, 2, INK);
  stroke(c, (k) => { k.moveTo(30, 21); k.quadraticCurveTo(36, 24, 35, 29); }, 1, '#f0c850');
  // 袋面一枚金钱纹
  blob(c, circle(26, 34, 5.4), '#f0c850', '#c29a2c', 1.8, 1.2);
  blob(c, (k) => k.rect(24.4, 32.4, 3.2, 3.2), '#a8481f', null, 1.2);
}

const WOOD = '#9a6a3a';
const WOOD_D = '#6d4524';

/** 灯笼架：两根木柱、横梁，梁下挂一盏红灯笼；底下一块垫石 */
function propLantern(c: Ctx): void {
  dab(c, ellipse(28, 90, 22, 5), INK, 0.22);
  // 垫石
  blob(c, rrect(12, 80, 32, 11, 3), '#a8abb3', '#7c7f89', 2.2, 1.6);
  dab(c, ellipse(26, 81.5, 12, 1.6), '#f6f9fd');
  // 立柱
  blob(c, rrect(24, 22, 8, 60, 2), WOOD, WOOD_D, 2.2, 1.8);
  // 横梁（向右伸出一条，灯笼挂在梁头）
  blob(c, rrect(14, 16, 40, 8, 2), WOOD, WOOD_D, 2.2, 1.8);
  // 斜撑
  stroke(c, (k) => { k.moveTo(32, 36); k.lineTo(46, 24); }, 4.6, INK);
  stroke(c, (k) => { k.moveTo(32, 36); k.lineTo(46, 24); }, 2.4, WOOD);
  // 梁头小雪
  dab(c, ellipse(34, 16.4, 18, 2.3), '#f6f9fd');
  // 灯笼：吊绳、上盖、红身、下盖、穗
  stroke(c, (k) => { k.moveTo(46, 24); k.lineTo(46, 31); }, 2, INK);
  blob(c, rrect(40, 30, 12, 4.5, 1.8), '#3a2a1c', null, 1.8);
  blob(c, (k) => { k.moveTo(41, 34); k.quadraticCurveTo(32, 46, 41, 58); k.lineTo(51, 58); k.quadraticCurveTo(60, 46, 51, 34); }, '#e2452f', '#b8301f', 2.4, 2.6);
  dab(c, ellipse(46, 46, 5, 9.5), '#ffd57a', 0.6);
  stroke(c, (k) => { k.moveTo(36, 46); k.lineTo(56, 46); }, 1.1, 'rgba(23,19,28,0.5)');
  blob(c, rrect(41, 57.5, 10, 4.5, 1.8), '#3a2a1c', null, 1.8);
  stroke(c, (k) => { k.moveTo(46, 62); k.lineTo(46, 72); }, 2.2, '#f2c94c');
  stroke(c, (k) => { k.moveTo(43.5, 70); k.lineTo(43, 76); k.moveTo(46, 70); k.lineTo(46, 78); k.moveTo(48.5, 70); k.lineTo(49, 76); }, 1.5, '#f2c94c');
}

/** 纸扎：竹篾糊白纸的小纸马，脸颊点红、鬃毛彩纸条，立在木座上——不动，和会走的纸人怪一眼分得开 */
function propPaper(c: Ctx): void {
  dab(c, ellipse(28, 90, 22, 5), INK, 0.22);
  // 木座：一块带脚的板
  blob(c, rrect(8, 74, 40, 10, 2), WOOD, WOOD_D, 2.2, 1.6);
  blob(c, rrect(12, 83, 7, 7, 1.5), WOOD_D, null, 2);
  blob(c, rrect(37, 83, 7, 7, 1.5), WOOD_D, null, 2);
  dab(c, ellipse(28, 74.8, 17, 1.6), '#f6f9fd');
  // 四条细腿（竹篾）
  for (const x of [15, 21, 34, 40]) {
    stroke(c, (k) => { k.moveTo(x, 58); k.lineTo(x, 74); }, 4.4, INK);
    stroke(c, (k) => { k.moveTo(x, 58); k.lineTo(x, 74); }, 2.2, '#e8d7a8');
  }
  // 马身（白纸）+ 红边
  blob(c, (k) => { k.moveTo(10, 46); k.quadraticCurveTo(10, 36, 24, 36); k.lineTo(38, 36); k.quadraticCurveTo(46, 38, 46, 48); k.quadraticCurveTo(44, 60, 30, 60); k.lineTo(18, 60); k.quadraticCurveTo(10, 58, 10, 46); }, '#f7f1e4', '#d9cfb8', 2.4, 2.6);
  stroke(c, (k) => { k.moveTo(13, 55); k.quadraticCurveTo(28, 62, 43, 54); }, 2, '#d63b2c');
  // 脖子和头
  blob(c, poly(36, 38, 42, 16, 52, 8, 56, 16, 54, 24, 46, 44), '#f7f1e4', '#d9cfb8', 2.4, 2.2);
  blob(c, poly(52, 8, 60, 13, 59, 20, 54, 20), '#f7f1e4', '#d9cfb8', 2.2, 1.4);
  // 耳、眼、腮红
  blob(c, poly(46, 12, 46, 4, 51, 9), '#f7f1e4', null, 2);
  dab(c, circle(54, 13, 1.7), INK);
  dab(c, circle(50, 20, 3.2), '#e2452f', 0.9);
  // 鬃毛：一排彩纸条
  const cols = ['#e2452f', '#f2c94c', '#2f9e6e', '#e2452f', '#f2c94c'];
  cols.forEach((col, i) => {
    const t = i / (cols.length - 1);
    const x = 40 + (1 - t) * 3;
    const y = 18 + t * 18;
    blob(c, poly(x, y, x - 8, y + 2, x - 7, y + 6, x, y + 5), col, null, 1.6);
  });
  // 尾巴：几条彩纸
  for (const [dy, col] of [[0, '#e2452f'], [5, '#f2c94c'], [10, '#2f9e6e']] as const) {
    blob(c, poly(11, 42 + dy, 1, 44 + dy + 4, 3, 48 + dy + 4, 11, 46 + dy), col, null, 1.6);
  }
  // 背上一块红鞍
  blob(c, rrect(20, 33, 14, 6, 2), '#d63b2c', '#a32619', 2, 1);
}

export const SPRITES11: SpriteDef[] = [
  { key: 'drop_bomb', w: 52, h: 48, ox: 0.5, oy: 0.58, draw: bomb },
  { key: 'drop_purse', w: 52, h: 48, ox: 0.5, oy: 0.58, draw: purse },
  { key: 'prop_lantern', w: 62, h: 94, ox: 0.45, oy: 0.95, draw: propLantern },
  { key: 'prop_paper', w: 62, h: 94, ox: 0.45, oy: 0.95, draw: propPaper },
];
