/**
 * 第五批精灵：第 4 步的新怪和精英（DESIGN.md 3.5）。
 * 画法同前几批：大头 Q 版、墨色粗描边、平涂 + 右下一层阴影、高光用 dab。
 * 白色的怪（纸马、枯骨、白狐）靠粗描边和偏冷/偏暖的灰阴影立住，别在雪地上糊成一片。
 */
import { INK, blob, circle, dab, ellipse, poly, rrect, stroke, type Ctx } from './draw.ts';
import type { SpriteDef } from './sprites.ts';

const RED = '#d4433e';
const RED_SH = '#a02a2c';
const GOLD = '#e8b83a';
const GOLD_SH = '#b98a26';

/** 纸马：白底红纹的纸扎马，朝右奔跑，腿前后伸开 */
function horse(c: Ctx): void {
  const p = '#f7f2e6';
  const ps = '#c4b9a3';
  // 远侧两条腿：深一点，前伸后蹬
  blob(c, poly(36, 30, 42, 33, 54, 41, 51, 45, 38, 38), ps, null, 2);
  blob(c, poly(14, 29, 20, 32, 9, 43, 5, 41), ps, null, 2);
  // 尾巴：几缕红纸条向后飘
  blob(c, (k) => { k.moveTo(13, 24); k.quadraticCurveTo(4, 20, 1, 12); k.quadraticCurveTo(8, 15, 13, 17); }, RED, RED_SH, 2, 1.4);
  blob(c, (k) => { k.moveTo(13, 28); k.quadraticCurveTo(3, 28, 0, 22); k.quadraticCurveTo(7, 23, 13, 23); }, RED, null, 2);
  // 身体
  blob(c, ellipse(27, 27, 17, 9.5), p, ps, 2.4, 2.6);
  // 近侧腿：折线膝盖，红蹄
  blob(c, poly(33, 31, 40, 33, 52, 39, 56, 37, 57, 41, 52, 46, 48, 44, 38, 40), p, ps, 2.2, 1.4);
  blob(c, poly(15, 30, 22, 33, 12, 45, 7, 46, 4, 43, 9, 41), p, ps, 2.2, 1.4);
  dab(c, poly(52, 46, 57, 41, 58, 44, 54, 48), RED);
  dab(c, poly(4, 43, 7, 46, 5, 49, 2, 46), RED);
  // 脖子和头
  blob(c, poly(36, 25, 42, 7, 54, 10, 51, 27), p, ps, 2.4, 2);
  blob(c, ellipse(53, 14, 9.5, 6.2, 0.55), p, ps, 2.4, 1.8);
  blob(c, poly(44, 9, 44, 1, 49, 7), p, ps, 2, 1);
  dab(c, poly(45, 7.5, 45, 3.5, 47.5, 7), RED);
  // 红鬃毛沿脖子
  blob(c, (k) => { k.moveTo(43, 8); k.lineTo(37, 12); k.lineTo(40, 14); k.lineTo(36, 19); k.lineTo(40, 21); k.lineTo(38, 26); k.lineTo(42, 22); k.lineTo(44, 14); }, RED, null, 1.8);
  // 鼻孔、眼睛
  dab(c, circle(60.5, 17.8, 1.1), INK);
  dab(c, circle(52, 11.5, 1.9), INK);
  dab(c, circle(52.5, 11, 0.6), '#ffffff');
  // 脸上红纹
  stroke(c, (k) => { k.moveTo(48, 15); k.lineTo(54, 18); }, 1.5, RED);
  // 红马鞍
  blob(c, rrect(21, 15.5, 14, 8, 3), RED, RED_SH, 2, 1.4);
  dab(c, circle(28, 19.5, 1.7), GOLD);
  // 缰绳：嘴到鞍
  stroke(c, (k) => { k.moveTo(55, 17); k.quadraticCurveTo(46, 24, 36, 19); }, 2.4);
  stroke(c, (k) => { k.moveTo(55, 17); k.quadraticCurveTo(46, 24, 36, 19); }, 1.2, RED);
  // 身上红纹和折痕
  stroke(c, (k) => { k.moveTo(20, 30); k.quadraticCurveTo(26, 35, 33, 31); }, 1.5, RED);
  stroke(c, (k) => { k.moveTo(24, 34); k.lineTo(26, 36); k.moveTo(29, 34.5); k.lineTo(31, 35.5); }, 1.2, RED);
  stroke(c, (k) => { k.moveTo(14, 25); k.lineTo(18, 31); }, 1, ps);
}

/** 水鬼：青绿色人形从水洼里探出半身，长发垂脸，两手前伸 */
function water(c: Ctx): void {
  const g = '#4fc3b0';
  const gs = '#2a8f87';
  // 水洼
  blob(c, ellipse(22, 46, 20, 5.5), '#1d6f78', '#124a55', 2.4, 1.8);
  dab(c, ellipse(22, 46.5, 12, 2.6), '#2a97a0');
  // 两只手：从身体两侧向上前伸，指头张开
  blob(c, poly(11, 34, 6, 26, 2, 22, 3, 19, 6, 21, 8, 17, 10, 19, 10.5, 24, 15, 32), g, gs, 2.2, 1.4);
  blob(c, poly(33, 34, 38, 26, 42, 22, 41, 19, 38, 21, 36, 17, 34, 19, 33.5, 24, 29, 32), g, gs, 2.2, 1.4);
  // 身体：湿漉漉，下沿融进水里
  blob(c, (k) => {
    k.moveTo(10, 46);
    k.quadraticCurveTo(9, 32, 14, 28);
    k.lineTo(30, 28);
    k.quadraticCurveTo(35, 32, 34, 46);
    k.quadraticCurveTo(28, 49, 22, 46.5);
    k.quadraticCurveTo(15, 49, 10, 46);
  }, g, gs, 2.4, 2.6);
  // 破烂湿衣的水滴
  dab(c, circle(17, 38, 1.4), '#c8fff2', 0.85);
  dab(c, circle(28, 41, 1.1), '#c8fff2', 0.85);
  stroke(c, (k) => { k.moveTo(19, 44); k.lineTo(19, 48); }, 1.2, '#124a55');
  // 头
  blob(c, circle(22, 20, 10.5), '#8fe3d2', '#4fb0a2', 2.4, 2.2);
  // 长发：盖住大半张脸，垂到肩下
  blob(c, (k) => {
    k.moveTo(10.5, 22);
    k.quadraticCurveTo(8, 6, 22, 7);
    k.quadraticCurveTo(36, 6, 33.5, 22);
    k.quadraticCurveTo(35, 34, 31, 40);
    k.quadraticCurveTo(30, 33, 28, 28);
    k.lineTo(28, 17);
    k.quadraticCurveTo(22, 14, 16, 17);
    k.lineTo(16, 28);
    k.quadraticCurveTo(14, 33, 13, 40);
    k.quadraticCurveTo(9, 34, 10.5, 22);
  }, '#16403f', '#0c2828', 2.4, 1.8);
  // 发缝间露出的惨白眼睛和嘴
  dab(c, ellipse(19, 21.5, 2, 2.6), '#f2fff9');
  dab(c, ellipse(25, 21.5, 2, 2.6), '#f2fff9');
  dab(c, circle(19.3, 22.4, 1), INK);
  dab(c, circle(25.3, 22.4, 1), INK);
  stroke(c, (k) => { k.moveTo(19.5, 27); k.quadraticCurveTo(22, 29, 24.5, 27); }, 1.4);
}

/** 枯骨：骨白色骷髅小人，大头空眼窝，肋骨几道，拿根骨棒 */
function bone(c: Ctx): void {
  const b = '#f1ead6';
  const bs = '#b3a78e';
  // 腿
  blob(c, rrect(15, 42, 5, 11, 2), b, bs, 2, 1);
  blob(c, rrect(25, 42, 5, 11, 2), b, bs, 2, 1);
  blob(c, ellipse(16.5, 54, 5, 2.5), b, bs, 2, 1);
  blob(c, ellipse(28.5, 54, 5, 2.5), b, bs, 2, 1);
  // 骨盆
  blob(c, (k) => { k.moveTo(13, 38); k.lineTo(32, 38); k.lineTo(30, 45); k.lineTo(22.5, 43); k.lineTo(15, 45); }, b, bs, 2, 1.4);
  // 脊柱和肋骨
  blob(c, rrect(20.5, 26, 4, 14, 1.5), b, bs, 1.8, 1);
  for (const y of [28, 32.5, 37]) {
    blob(c, (k) => { k.moveTo(22.5, y); k.quadraticCurveTo(14, y - 1.5, 13, y + 2); k.quadraticCurveTo(18, y + 1.5, 22.5, y + 2.4); }, b, null, 1.7);
    blob(c, (k) => { k.moveTo(22.5, y); k.quadraticCurveTo(31, y - 1.5, 32, y + 2); k.quadraticCurveTo(27, y + 1.5, 22.5, y + 2.4); }, b, null, 1.7);
  }
  // 左臂垂着；右臂举骨棒
  blob(c, poly(14, 28, 10, 32, 8, 40, 10.5, 40.5, 13, 34), b, bs, 1.9, 1);
  blob(c, poly(31, 28, 36, 28, 38, 24, 40.5, 25.5, 39, 31, 33, 32), b, bs, 1.9, 1);
  // 骨棒：两头鼓包
  c.save();
  c.translate(37, 26);
  c.rotate(0.04);
  blob(c, rrect(-2.4, -16, 4.8, 22, 2), '#e6dcc0', '#a89c80', 2, 1);
  blob(c, circle(-2, -16, 3.2), '#e6dcc0', '#a89c80', 2, 1);
  blob(c, circle(2, -16, 3.2), '#e6dcc0', '#a89c80', 2, 1);
  c.restore();
  // 大头骷髅
  blob(c, (k) => {
    k.moveTo(10, 16);
    k.quadraticCurveTo(8, 2, 22.5, 2);
    k.quadraticCurveTo(37, 2, 35, 16);
    k.quadraticCurveTo(35, 22, 31, 24);
    k.lineTo(31, 28);
    k.lineTo(14, 28);
    k.lineTo(14, 24);
    k.quadraticCurveTo(10, 22, 10, 16);
  }, b, bs, 2.4, 2.4);
  // 空眼窝（微微有点红光）、鼻洞、牙
  dab(c, ellipse(17, 14, 4.2, 4.8, 0.15), INK);
  dab(c, ellipse(28, 14, 4.2, 4.8, -0.15), INK);
  dab(c, circle(17.4, 14.6, 1.2), '#d0362e');
  dab(c, circle(28.4, 14.6, 1.2), '#d0362e');
  dab(c, poly(22.5, 19, 20.6, 23, 24.4, 23), INK);
  stroke(c, (k) => { k.moveTo(15, 26); k.lineTo(30, 26); }, 1.4);
  for (const x of [18.5, 22.5, 26.5]) stroke(c, (k) => { k.moveTo(x, 24.4); k.lineTo(x, 28); }, 1.1);
  stroke(c, (k) => { k.moveTo(12, 9); k.lineTo(15, 6); }, 1.1, bs);
}

/** 蝙蝠精：紫黑色，张开翅膀，红眼小尖牙 */
function bat(c: Ctx): void {
  const w = '#7a3fb0';
  const ws = '#4a2478';
  // 两侧翅膀：下沿三个弧形扇尖
  const wing = (k: Ctx): void => {
    k.moveTo(16, 13);
    k.quadraticCurveTo(8, 2, 1, 5);
    k.quadraticCurveTo(3, 10, 2, 13);
    k.quadraticCurveTo(5, 15, 6, 20);
    k.quadraticCurveTo(9, 17, 11, 21);
    k.quadraticCurveTo(13, 19, 16, 22);
  };
  blob(c, wing, w, ws, 2.2, 2);
  c.save();
  c.translate(40, 0);
  c.scale(-1, 1);
  blob(c, wing, w, ws, 2.2, -2);
  c.restore();
  // 翅骨
  stroke(c, (k) => { k.moveTo(15, 14); k.lineTo(3, 6); k.moveTo(15, 15); k.lineTo(6, 19); }, 1.1, '#2a1442');
  stroke(c, (k) => { k.moveTo(25, 14); k.lineTo(37, 6); k.moveTo(25, 15); k.lineTo(34, 19); }, 1.1, '#2a1442');
  // 耳朵
  blob(c, poly(13.5, 10, 14, 1.5, 19, 7), '#3a2a50', null, 2);
  blob(c, poly(26.5, 10, 26, 1.5, 21, 7), '#3a2a50', null, 2);
  // 圆滚滚身体 + 脸
  blob(c, circle(20, 16, 8.4), '#4a3068', '#2c1c40', 2.4, 2.4);
  dab(c, ellipse(20, 20.5, 4.6, 3.2), '#8a6aa8');
  // 红眼 + 尖牙
  dab(c, circle(16.7, 14, 2.5), '#ff3b3b');
  dab(c, circle(23.3, 14, 2.5), '#ff3b3b');
  dab(c, circle(16.9, 14.2, 1), INK);
  dab(c, circle(23.1, 14.2, 1), INK);
  dab(c, circle(16, 13.2, 0.6), '#ffffff');
  dab(c, circle(22.4, 13.2, 0.6), '#ffffff');
  stroke(c, (k) => { k.moveTo(16.5, 19.4); k.quadraticCurveTo(20, 21.6, 23.5, 19.4); }, 1.4);
  dab(c, poly(17.4, 19.8, 19, 19.9, 18.2, 23.2), '#ffffff');
  dab(c, poly(21, 19.9, 22.6, 19.8, 21.8, 23.2), '#ffffff');
  // 小脚
  stroke(c, (k) => { k.moveTo(18, 24); k.lineTo(17.5, 27.5); k.moveTo(22, 24); k.lineTo(22.5, 27.5); }, 1.8);
}

/** 稻草人：十字木架，土黄稻草身子，破草帽，补丁衣，纽扣眼睛缝线嘴 */
function scarecrow(c: Ctx): void {
  const st = '#e0b64e';
  // 木桩和横杆
  blob(c, rrect(22.5, 28, 5, 42, 1.5), '#8a5a33', '#5f3b20', 2.2, 1.2);
  // 脚下露出的稻草
  for (const [x, dx] of [[19, -3], [25, 0], [31, 3]] as const) {
    blob(c, poly(x - 2, 62, x + 2, 62, x + dx * 1.6, 70.5), st, null, 1.7);
  }
  // 身子：补丁衣
  blob(c, poly(14, 33, 36, 33, 38, 62, 12, 62), '#7d6a9a', '#574873', 2.4, 2.6);
  blob(c, rrect(24, 44, 9, 8, 1), '#d9a24a', null, 1.6);
  stroke(c, (k) => { k.moveTo(26, 44.8); k.lineTo(26, 51); k.moveTo(29, 44.8); k.lineTo(29, 51); k.moveTo(32, 44.8); k.lineTo(32, 51); }, 0.8, '#7a5420');
  blob(c, poly(15, 53, 21, 53, 21, 59, 15, 59), '#c9573f', null, 1.5);
  stroke(c, (k) => { k.moveTo(12.5, 62); k.lineTo(37.5, 62); }, 1.4, '#574873');
  // 手臂横杆 + 袖子
  blob(c, rrect(3, 34, 44, 4.6, 2), '#8a5a33', '#5f3b20', 2.2, 1);
  blob(c, poly(9, 32, 17, 32, 17, 41, 9, 41), '#7d6a9a', '#574873', 2, 1.2);
  blob(c, poly(33, 32, 41, 32, 41, 41, 33, 41), '#7d6a9a', '#574873', 2, 1.2);
  // 两手伸出的稻草
  for (const dy of [-3.5, 0, 3.5]) {
    blob(c, poly(9, 36.3 + dy * 0.5, 2.5, 36.3 + dy, 4, 38 + dy * 0.9, 9, 38.5 + dy * 0.5), st, null, 1.5);
    blob(c, poly(41, 36.3 + dy * 0.5, 47.5, 36.3 + dy, 46, 38 + dy * 0.9, 41, 38.5 + dy * 0.5), st, null, 1.5);
  }
  // 领口露出的稻草
  for (const dx of [-4, 0, 4]) blob(c, poly(21 + dx * 0.4, 33, 29 + dx * 0.4, 33, 25 + dx, 29), st, null, 1.6);
  // 麻布脸
  blob(c, circle(25, 20, 10.5), '#ecd596', '#c3a85e', 2.4, 2.4);
  // 纽扣眼睛：一个缝了叉
  blob(c, circle(20.5, 19.5, 3.3), '#2a2530', null, 1.6);
  blob(c, circle(30, 18.5, 2.6), '#2a2530', null, 1.6);
  dab(c, circle(19.6, 18.6, 0.9), '#ffffff');
  stroke(c, (k) => { k.moveTo(28.6, 17.2); k.lineTo(31.4, 19.8); k.moveTo(31.4, 17.2); k.lineTo(28.6, 19.8); }, 0.9, '#f0e8d0');
  // 缝线嘴
  stroke(c, (k) => { k.moveTo(18, 25.5); k.quadraticCurveTo(25, 28.5, 32, 25); }, 1.5);
  for (const x of [21, 25, 29]) stroke(c, (k) => { k.moveTo(x, 25.6); k.lineTo(x + 0.2, 27.6); }, 1);
  // 破草帽
  blob(c, ellipse(25, 11.5, 17, 4.6, -0.04), '#c99a3e', '#9a7228', 2.4, 1.6);
  blob(c, (k) => { k.moveTo(14, 11); k.quadraticCurveTo(14, 1.5, 25, 1.5); k.quadraticCurveTo(36, 1.5, 36, 11); k.quadraticCurveTo(25, 14, 14, 11); }, '#d9ad4a', '#a98028', 2.4, 2);
  stroke(c, (k) => { k.moveTo(14.4, 9); k.quadraticCurveTo(25, 12.5, 35.6, 9); }, 2, '#9c3b2f');
  // 帽子破洞和翘起的草
  dab(c, ellipse(30.5, 5.4, 2.4, 1.6, 0.4), INK);
  blob(c, poly(7, 12, 9, 8.5, 12, 11), '#d9ad4a', null, 1.4);
  blob(c, poly(41, 10, 43, 14, 38.5, 13), '#c99a3e', null, 1.4);
}

/** 黄鼠狼：棕黄色细长身子朝右，贼眼，嘴里叼着一枚铜钱 */
function weasel(c: Ctx): void {
  const b = '#cf8f2e';
  const bs = '#9b6120';
  // 远侧腿
  blob(c, rrect(12, 29, 4.6, 8.5, 2), bs, null, 1.9);
  blob(c, rrect(29, 29, 4.6, 8.5, 2), bs, null, 1.9);
  // 尾巴：蓬松、尖端深色
  blob(c, (k) => { k.moveTo(9, 27); k.quadraticCurveTo(0, 28, 1, 17); k.quadraticCurveTo(2, 10, 8, 10); k.quadraticCurveTo(5, 17, 12, 22); }, b, bs, 2.2, 1.8);
  dab(c, poly(1.4, 16, 2, 11, 8, 10, 4.6, 13.5), '#4a2e14');
  // 细长身子
  blob(c, (k) => { k.moveTo(9, 24); k.quadraticCurveTo(22, 17, 36, 22); k.lineTo(37, 32); k.quadraticCurveTo(22, 36, 9, 31); k.quadraticCurveTo(6, 28, 9, 24); }, b, bs, 2.4, 2.6);
  dab(c, ellipse(24, 32.4, 11, 2.4), '#f6e2b0');
  // 近侧腿
  blob(c, rrect(16, 30, 5, 9, 2), b, bs, 2, 1);
  blob(c, rrect(32, 30, 5, 9, 2), b, bs, 2, 1);
  dab(c, rrect(16.4, 36, 4.2, 2.6, 1), '#4a2e14');
  dab(c, rrect(32.4, 36, 4.2, 2.6, 1), '#4a2e14');
  // 头：小耳朵、尖脸
  blob(c, circle(34.5, 14.5, 3.2), b, bs, 2, 0.8);
  dab(c, circle(34.5, 14.8, 1.4), '#4a2e14');
  blob(c, (k) => { k.moveTo(32, 18); k.quadraticCurveTo(34, 12, 40, 14); k.quadraticCurveTo(44, 17, 45, 23); k.lineTo(40, 29); k.quadraticCurveTo(32, 30, 31, 24); }, b, bs, 2.4, 2);
  dab(c, poly(36, 28.5, 42, 26.5, 44, 24, 40, 29), '#f6e2b0');
  dab(c, circle(45, 23, 1.5), INK);
  // 贼眼：斜眯，带眼白
  dab(c, ellipse(39.5, 19, 2.6, 1.8, 0.3), '#fff6d0');
  dab(c, circle(40.4, 19.4, 1.1), INK);
  stroke(c, (k) => { k.moveTo(36.2, 16.6); k.lineTo(42, 18); }, 1.5);
  // 嘴里的铜钱：金圆 + 方孔
  blob(c, circle(43, 28.5, 5.6), '#f0c24a', GOLD_SH, 2, 1.4);
  dab(c, circle(41.2, 26.6, 1.3), '#fff4bd', 0.9);
  blob(c, rrect(41, 26.5, 4, 4, 0.5), '#5a3a1a', null, 1.3);
  // 嘴线压在钱下面一点点
  stroke(c, (k) => { k.moveTo(38, 27.5); k.lineTo(40.5, 28.5); }, 1.2);
}

/** 雪魅：冰蓝色飘忽的女鬼，长发白衣，下摆像雪雾散开，手里一根冰锥 */
function snow(c: Ctx): void {
  const wh = '#f2f8ff';
  const whs = '#9bbbe0';
  // 雪雾下摆：几团淡蓝
  dab(c, ellipse(22, 53, 20, 4.5), '#cfe6fb', 0.9);
  dab(c, circle(8, 52, 5), '#e8f3ff', 0.95);
  dab(c, circle(36, 52, 5), '#e8f3ff', 0.95);
  dab(c, circle(15, 56, 4), '#d6e9fb', 0.9);
  dab(c, circle(30, 56, 3.6), '#d6e9fb', 0.9);
  // 背后的长发
  blob(c, (k) => { k.moveTo(11, 18); k.quadraticCurveTo(3, 34, 7, 50); k.quadraticCurveTo(14, 44, 15, 32); k.lineTo(29, 32); k.quadraticCurveTo(30, 44, 37, 50); k.quadraticCurveTo(41, 34, 33, 18); }, '#4a86c8', '#2f5f9e', 2.4, 2);
  // 白衣：向下收成飘带尖
  blob(c, (k) => {
    k.moveTo(15, 28);
    k.lineTo(29, 28);
    k.quadraticCurveTo(35, 44, 38, 50);
    k.lineTo(32, 47);
    k.lineTo(29, 53);
    k.lineTo(24, 48);
    k.lineTo(20, 54);
    k.lineTo(16, 47);
    k.lineTo(8, 51);
    k.quadraticCurveTo(11, 42, 15, 28);
  }, wh, whs, 2.4, 2.6);
  stroke(c, (k) => { k.moveTo(19, 33); k.quadraticCurveTo(22, 40, 20, 47); }, 1.1, whs);
  // 腰带（冰蓝）
  blob(c, rrect(15.5, 34, 13, 3.2, 1.2), '#6fb4ee', null, 1.6);
  // 右手持冰锥（朝右上斜指）
  blob(c, poly(28, 30, 34, 31, 37, 35, 33, 37, 28, 34), wh, whs, 2, 1);
  blob(c, poly(34, 33, 36, 40, 44, 30, 36, 28), '#8fd4f7', '#3d93d4', 2, 1.4);
  dab(c, poly(36, 29.4, 38, 30.5, 36.5, 34), '#ffffff', 0.9);
  // 左手垂着
  blob(c, poly(15, 30, 10, 38, 12, 41, 17, 35), wh, whs, 2, 1);
  // 头
  blob(c, circle(22, 18, 10), '#e4f0ff', '#a9c7e6', 2.4, 2.2);
  // 刘海
  blob(c, (k) => { k.moveTo(11.5, 19); k.quadraticCurveTo(10, 6, 22, 6.5); k.quadraticCurveTo(34, 6, 32.5, 19); k.quadraticCurveTo(30, 12, 26, 13); k.lineTo(23, 17); k.lineTo(19, 12.5); k.quadraticCurveTo(14, 13, 11.5, 19); }, '#4a86c8', '#2f5f9e', 2.4, 1.6);
  // 眯眼、蓝唇、腮红
  stroke(c, (k) => { k.moveTo(15.5, 20.5); k.quadraticCurveTo(18, 22.5, 20.5, 20.5); }, 1.5);
  stroke(c, (k) => { k.moveTo(24, 20.5); k.quadraticCurveTo(26.5, 22.5, 29, 20.5); }, 1.5);
  dab(c, ellipse(22, 25, 1.8, 1.1), '#5a8fd0');
  dab(c, circle(16, 23.5, 1.8), '#f2a8c0', 0.7);
  dab(c, circle(28.5, 23.5, 1.8), '#f2a8c0', 0.7);
  // 发间冰晶
  dab(c, poly(31, 10, 33, 13, 31, 16, 29, 13), '#ffffff');
}

/** 白狐（精英）：雪白狐狸，三条蓬松尾巴，额头一点红纹，眼角红 */
function whitefox(c: Ctx): void {
  const w = '#f8f6f1';
  const ws = '#b9bdd0';
  // 远侧两条腿
  blob(c, rrect(21, 40, 6, 12, 2.4), ws, null, 2);
  blob(c, rrect(42, 40, 6, 12, 2.4), ws, null, 2);
  // 三条尾巴：从身后扇形展开，每条尖端一抹浅蓝
  const tail = (k: Ctx, tipX: number, tipY: number, midX: number, midY: number, w2: number): void => {
    k.moveTo(18, 40);
    k.quadraticCurveTo(midX - w2, midY + w2, tipX - 1, tipY + 4);
    k.quadraticCurveTo(tipX, tipY - 2, tipX + 4, tipY);
    k.quadraticCurveTo(midX + w2 + 3, midY - 3, 24, 36);
  };
  blob(c, (k) => tail(k, 2, 28, 4, 38, 2), w, ws, 2.2, 2);
  blob(c, (k) => tail(k, 4, 8, 4, 22, 3), w, ws, 2.2, 2);
  blob(c, (k) => tail(k, 18, 2, 12, 16, 3), w, ws, 2.2, 2);
  dab(c, poly(2, 30, 1.6, 27, 5.5, 26.6, 4.6, 30), '#a7d3f4');
  dab(c, poly(4, 10, 4.4, 8, 8.2, 8.2, 7, 11), '#a7d3f4');
  dab(c, poly(17, 4.5, 18, 2.5, 21.6, 3.4, 20.5, 6.2), '#a7d3f4');
  // 身体
  blob(c, ellipse(34, 40, 17, 10.5), w, ws, 2.4, 2.8);
  dab(c, ellipse(36, 46, 10, 3), '#ffffff');
  // 近侧腿，爪尖淡灰
  blob(c, rrect(27, 43, 6.4, 12, 2.4), w, ws, 2.2, 1);
  blob(c, rrect(47, 43, 6.4, 12, 2.4), w, ws, 2.2, 1);
  dab(c, rrect(27.5, 51.5, 5.4, 3, 1.2), '#8d92a8');
  dab(c, rrect(47.5, 51.5, 5.4, 3, 1.2), '#8d92a8');
  // 脖子上的红绳铃
  blob(c, (k) => { k.moveTo(46, 33); k.quadraticCurveTo(51, 41, 56, 38); k.lineTo(56, 36); k.quadraticCurveTo(51, 38, 47, 31); }, RED, null, 1.6);
  blob(c, circle(53, 41, 2.4), GOLD, GOLD_SH, 1.6, 1);
  // 头：尖耳 + 圆脸 + 长嘴
  blob(c, poly(46, 22, 47, 6, 55, 17), w, ws, 2.2, 1.4);
  blob(c, poly(55, 18, 62, 7, 63, 23), w, ws, 2.2, 1.4);
  dab(c, poly(48.4, 18, 48.6, 10.5, 53, 16.5), '#f19aa3');
  dab(c, poly(58, 17, 61, 12, 61.2, 21), '#f19aa3');
  blob(c, circle(54, 29, 11), w, ws, 2.4, 2.4);
  blob(c, (k) => { k.moveTo(58, 31); k.quadraticCurveTo(66, 31, 64, 37); k.quadraticCurveTo(60, 41, 54, 38); }, '#ffffff', ws, 2, 1);
  dab(c, circle(62.6, 33, 1.8), INK);
  // 腮边蓬毛
  blob(c, poly(44, 31, 49, 36, 44, 39, 46, 34.6), w, null, 1.8);
  // 眼睛：弯月眼 + 红眼角
  stroke(c, (k) => { k.moveTo(50, 28); k.quadraticCurveTo(53.5, 24, 57.5, 27.6); }, 2.1);
  dab(c, circle(54.5, 28, 1.3), '#d0362e');
  stroke(c, (k) => { k.moveTo(49.6, 28.2); k.lineTo(47.4, 30); }, 1.7, RED);
  stroke(c, (k) => { k.moveTo(57.6, 27.6); k.lineTo(60, 28.4); }, 1.7, RED);
  // 额头红纹：一点朱砂 + 两道收尾
  dab(c, poly(53.6, 18.6, 55.4, 21.6, 53.6, 24.4, 51.8, 21.6), RED);
  stroke(c, (k) => { k.moveTo(51.6, 21.6); k.lineTo(49.4, 22.6); k.moveTo(55.6, 21.6); k.lineTo(57.8, 22.6); }, 1.3, RED);
  // 微笑
  stroke(c, (k) => { k.moveTo(58, 35.4); k.quadraticCurveTo(60.6, 38, 63, 36); }, 1.3);
}

/** 纸轿（精英）：大红纸扎轿子，金顶流苏，四个小纸人抬着 */
function palanquin(c: Ctx): void {
  // 一个抬轿的小纸人：白脸红腮，红肩带，纸片下摆
  const bearer = (cx: number): void => {
    blob(c, rrect(cx - 3.8, 79, 3, 7, 1.2), '#2a2530', null, 1.8);
    blob(c, rrect(cx + 0.8, 79, 3, 7, 1.2), '#2a2530', null, 1.8);
    blob(c, poly(cx - 6.5, 69, cx + 6.5, 69, cx + 7.5, 81, cx - 7.5, 81), '#f4f1ea', '#d9d2c3', 2, 1.6);
    blob(c, poly(cx - 6.6, 70, cx + 6.6, 70, cx + 6.9, 73.5, cx - 6.9, 73.5), RED, null, 1.5);
    blob(c, circle(cx, 63, 6.4), '#fbf9f4', '#e2dccf', 2.2, 1.5);
    blob(c, (k) => { k.moveTo(cx - 6.2, 62); k.quadraticCurveTo(cx - 6.2, 56, cx, 56.2); k.quadraticCurveTo(cx + 6.2, 56, cx + 6.2, 62); k.lineTo(cx + 3, 59.8); k.lineTo(cx - 3, 59.8); }, '#24212b', null, 1.8);
    dab(c, circle(cx - 3.6, 66, 1.6), '#e0464b');
    dab(c, circle(cx + 3.6, 66, 1.6), '#e0464b');
    dab(c, circle(cx - 2.4, 63.2, 0.9), INK);
    dab(c, circle(cx + 2.4, 63.2, 0.9), INK);
  };
  // 后排两个先画，前排两个在后（轿杆夹在中间）
  bearer(34);
  bearer(62);
  // 轿杆
  c.save();
  c.translate(0, -3);
  blob(c, rrect(3, 57, 90, 4.4, 2), '#8a5a33', '#5f3b20', 2.2, 1);
  c.restore();
  bearer(12);
  bearer(84);
  c.save();
  c.translate(0, -3);
  // 轿厢
  blob(c, rrect(18, 22, 60, 36, 4), '#d8352f', RED_SH, 2.6, 3);
  blob(c, rrect(15, 52, 66, 6, 2), RED_SH, null, 2);
  // 金边窗框和门帘
  blob(c, rrect(28, 29, 40, 24, 3), GOLD, GOLD_SH, 2.2, 1.4);
  blob(c, rrect(31, 32, 34, 18, 2), '#2a1a24', null, 1.8);
  // 帘子：两片红帘，中间露一条缝，缝里有两只纸眼
  blob(c, poly(31, 32, 46.5, 32, 44, 50, 31, 50), '#b82a2c', '#8c1c22', 1.8, 1.4);
  blob(c, poly(65, 32, 49.5, 32, 52, 50, 65, 50), '#b82a2c', '#8c1c22', 1.8, 1.4);
  dab(c, ellipse(48, 41, 1.8, 3.4), '#fff4d6');
  dab(c, circle(48, 41.4, 1), '#d0362e');
  // 金扣花
  for (const x of [22.5, 73.5]) {
    blob(c, circle(x, 40, 3.2), GOLD, GOLD_SH, 1.8, 1);
    dab(c, circle(x - 0.8, 39, 0.9), '#fff1b8');
  }
  // 屋顶：金色大檐，两头翘
  blob(c, (k) => { k.moveTo(7, 24); k.quadraticCurveTo(10, 24, 17, 14); k.lineTo(79, 14); k.quadraticCurveTo(86, 24, 89, 24); k.quadraticCurveTo(80, 28, 48, 28); k.quadraticCurveTo(16, 28, 7, 24); }, GOLD, GOLD_SH, 2.6, 2.4);
  blob(c, (k) => { k.moveTo(24, 14); k.quadraticCurveTo(30, 5, 48, 4); k.quadraticCurveTo(66, 5, 72, 14); }, '#d8352f', RED_SH, 2.4, 1.8);
  blob(c, circle(48, 3.6, 3), GOLD, GOLD_SH, 2, 1);
  dab(c, circle(47, 2.8, 1), '#fff1b8');
  stroke(c, (k) => { k.moveTo(17, 20); k.quadraticCurveTo(48, 25, 79, 20); }, 1.1, GOLD_SH);
  dab(c, ellipse(34, 18.5, 8, 1.4, -0.1), '#fff1b8', 0.8);
  // 檐下的流苏：红线加金珠
  for (const x of [14, 26, 38, 50, 62, 74, 82]) {
    stroke(c, (k) => { k.moveTo(x, 27.4); k.lineTo(x, 33); }, 1.6, RED);
    blob(c, circle(x, 34.4, 1.9), GOLD, null, 1.4);
  }
  for (const x of [4, 92]) {
    stroke(c, (k) => { k.moveTo(x, 24.4); k.lineTo(x, 31); }, 1.6, RED);
    blob(c, circle(x, 32.4, 1.9), GOLD, null, 1.4);
  }
  c.restore();
}

/** 冰锥弹：冰蓝尖锥，尖朝右，白色高光 */
function ice(c: Ctx): void {
  blob(c, poly(1.5, 10, 4, 4.6, 19, 10, 4, 15.4), '#7fd0f5', '#2f86cc', 1.9, 2);
  dab(c, poly(4.5, 6.6, 15, 9.6, 5, 9), '#ffffff', 0.95);
  stroke(c, (k) => { k.moveTo(4, 10); k.lineTo(14, 10); }, 0.9, '#3b8fd0');
}

export const SPRITES5: SpriteDef[] = [
  { key: 'horse', w: 60, h: 52, ox: 0.5, oy: 0.95, draw: horse },
  { key: 'water', w: 44, h: 52, ox: 0.5, oy: 0.95, draw: water },
  { key: 'bone', w: 44, h: 56, ox: 0.5, oy: 0.95, draw: bone },
  { key: 'bat', w: 40, h: 30, ox: 0.5, oy: 0.95, draw: bat },
  { key: 'scarecrow', w: 50, h: 72, ox: 0.5, oy: 0.95, draw: scarecrow },
  { key: 'weasel', w: 46, h: 40, ox: 0.5, oy: 0.95, draw: weasel },
  { key: 'snow', w: 44, h: 60, ox: 0.5, oy: 0.95, draw: snow },
  { key: 'whitefox', w: 64, h: 56, ox: 0.5, oy: 0.95, draw: whitefox },
  { key: 'palanquin', w: 96, h: 88, ox: 0.5, oy: 0.95, draw: palanquin },
  { key: 'ice', w: 20, h: 20, ox: 0.5, oy: 0.5, draw: ice },
];
