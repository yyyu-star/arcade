/**
 * 第二批精灵：新怪、精英、首领、敌方弹、掉落、场景点缀和特效。
 * 画法和 sprites.ts 一致（大头 Q 版、粗描边、平涂 + 右下一层阴影、高光用 dab），单独放一个文件是为了不和第一批互相挤。
 * 雪地很亮，所以怪和掉落都用饱和色 + 墨色粗边；只有贴地的点缀（水洼、雪堆、脚印）刻意淡，免得抢戏。
 */
import { INK, artRng, blob, circle, dab, ellipse, poly, rrect, stroke, type Ctx } from './draw.ts';
import type { SpriteDef } from './sprites.ts';

/** 狐妖：四脚着地朝右，大尾巴白尖，眯成弯月的坏笑眼 */
function fox(c: Ctx): void {
  const o = '#e9792c';
  const os = '#bd5519';
  // 远侧两条腿先画，深一点，显得前后有层次
  blob(c, rrect(15, 33, 5, 9, 2), os, null, 2);
  blob(c, rrect(33, 33, 5, 9, 2), os, null, 2);
  // 大尾巴：从身后卷上去，尖是白的
  const tail = (k: Ctx): void => {
    k.moveTo(12, 33);
    k.quadraticCurveTo(0, 34, 2, 18);
    k.quadraticCurveTo(3, 8, 11, 6);
    k.quadraticCurveTo(10, 15, 15, 20);
    k.quadraticCurveTo(18, 27, 17, 31);
  };
  blob(c, tail, o, os, 2.2, 2.2);
  blob(c, (k) => { k.moveTo(11, 6); k.quadraticCurveTo(4, 8, 3, 15); k.quadraticCurveTo(7, 12, 10, 16); k.quadraticCurveTo(10, 11, 13, 9); }, '#fff6ea', null, 1.8);
  // 身体
  blob(c, ellipse(24, 30, 14, 8.5), o, os, 2.4, 2.6);
  dab(c, ellipse(26, 35, 8, 3), '#fff0dc');
  // 近侧两条腿，脚尖黑袜子
  blob(c, rrect(19, 33, 5.5, 9, 2), o, os, 2, 1);
  blob(c, rrect(37, 33, 5.5, 9, 2), o, os, 2, 1);
  dab(c, rrect(19.5, 38.5, 4.5, 3, 1.2), '#3a2a2a');
  dab(c, rrect(37.5, 38.5, 4.5, 3, 1.2), '#3a2a2a');
  // 头：尖耳朵 + 圆脸 + 长嘴
  blob(c, poly(33, 14, 35, 2, 41, 11), o, os, 2.2, 1.2);
  blob(c, poly(40, 12, 46, 3, 47, 15), o, os, 2.2, 1.2);
  dab(c, poly(35, 12, 36, 6, 39, 11), '#3a2a2a');
  blob(c, circle(38, 22, 9.5), o, os, 2.4, 2.4);
  blob(c, (k) => { k.moveTo(41, 24); k.quadraticCurveTo(48, 24, 47, 29); k.quadraticCurveTo(43, 32, 38, 30); }, '#fff6ea', null, 2);
  dab(c, circle(46.6, 25.8, 1.6), INK);
  // 腮帮白毛
  dab(c, poly(31, 26, 36, 29, 31, 31), '#fff6ea');
  // 眯成弯月的眼睛 + 两道红纹
  stroke(c, (k) => { k.moveTo(34, 21); k.quadraticCurveTo(37, 17.5, 40.5, 20.5); }, 2);
  stroke(c, (k) => { k.moveTo(32.5, 24); k.lineTo(36.5, 25.5); }, 1.8, '#d0362e');
  stroke(c, (k) => { k.moveTo(34, 27); k.lineTo(37.5, 27.8); }, 1.6, '#d0362e');
  // 坏笑
  stroke(c, (k) => { k.moveTo(41, 30); k.quadraticCurveTo(44, 32.5, 46.5, 29.5); }, 1.3);
}

/** 石狮怪：石台上的灰石狮，铜铃大眼，含红珠，身上裂纹 */
function shishi(c: Ctx): void {
  const s = '#a7aab0';
  const ss = '#7b7f88';
  // 石台
  blob(c, rrect(10, 68, 70, 14, 3), '#8d9099', '#656872', 2.4, 2);
  dab(c, rrect(13, 70, 64, 2.5, 1), '#c3c5cb');
  stroke(c, (k) => { k.moveTo(34, 69); k.lineTo(32, 74); k.lineTo(35, 80); }, 1.1, '#4d5058');
  // 后腿和身体
  blob(c, ellipse(34, 58, 22, 13), s, ss, 2.6, 3);
  blob(c, rrect(15, 60, 16, 10, 4), s, ss, 2.4, 1.5);
  blob(c, rrect(46, 60, 14, 10, 4), s, ss, 2.4, 1.5);
  blob(c, rrect(56, 56, 12, 14, 4), s, ss, 2.4, 1.5);
  // 前爪脚趾线
  for (const x of [59, 62.5, 66]) stroke(c, (k) => { k.moveTo(x, 66); k.lineTo(x, 69.5); }, 1, '#4d5058');
  // 尾巴上的卷毛
  blob(c, circle(11, 48, 6), s, ss, 2.2, 1.4);
  stroke(c, (k) => { k.arc(11, 48, 2.8, 0.5, 4.8); }, 1, '#4d5058');
  // 鬃毛：一圈卷
  const curls: Array<[number, number, number]> = [
    [50, 22, 8], [60, 26, 8], [66, 36, 8], [63, 47, 8], [52, 52, 8], [40, 50, 8], [38, 38, 8], [39, 27, 8], [44, 17, 7], [56, 18, 7],
  ];
  for (const [x, y, r] of curls) {
    blob(c, circle(x, y, r), '#8f939c', '#6c707a', 2.2, 1.6);
    stroke(c, (k) => { k.arc(x, y, r * 0.45, 0.4, 4.7); }, 1, '#4d5058');
  }
  // 脸
  blob(c, circle(52, 36, 19), s, ss, 2.6, 3);
  // 眉骨
  blob(c, (k) => { k.moveTo(38, 27); k.quadraticCurveTo(44, 21, 51, 27); k.quadraticCurveTo(45, 26, 38, 27); }, ss, null, 1.8);
  blob(c, (k) => { k.moveTo(54, 27); k.quadraticCurveTo(61, 21, 67, 27); k.quadraticCurveTo(61, 26, 54, 27); }, ss, null, 1.8);
  // 铜铃大眼
  blob(c, circle(45, 33, 6.2), '#fbf3da', null, 2.2);
  blob(c, circle(60, 33, 6.2), '#fbf3da', null, 2.2);
  dab(c, circle(46, 33.5, 3.2), '#d0362e');
  dab(c, circle(61, 33.5, 3.2), '#d0362e');
  dab(c, circle(46, 33.5, 1.6), INK);
  dab(c, circle(61, 33.5, 1.6), INK);
  dab(c, circle(47, 32, 0.9), '#ffffff');
  dab(c, circle(62, 32, 0.9), '#ffffff');
  // 鼻子、咧开的嘴含红珠
  blob(c, ellipse(52.5, 40, 4, 2.8), ss, null, 1.8);
  blob(c, (k) => { k.moveTo(40, 45); k.quadraticCurveTo(52, 59, 65, 45); k.quadraticCurveTo(52, 49, 40, 45); }, '#3a2a30', null, 2);
  for (const x of [43.5, 48, 57, 61.5]) dab(c, poly(x - 1.6, 46.5, x + 1.6, 46.5, x, 50.5), '#f7f2e6');
  blob(c, circle(52.5, 50, 4.2), '#e0322e', '#a81f22', 1.8, 1.2);
  dab(c, circle(51.2, 48.6, 1.2), '#ffffff', 0.9);
  // 裂纹
  stroke(c, (k) => { k.moveTo(28, 48); k.lineTo(31, 54); k.lineTo(28, 58); k.lineTo(31, 63); }, 1.3, '#4d5058');
  stroke(c, (k) => { k.moveTo(56, 12); k.lineTo(55, 17); k.lineTo(58, 20); }, 1.2, '#4d5058');
  stroke(c, (k) => { k.moveTo(45, 24); k.lineTo(44, 28); }, 1, '#4d5058');
  // 肩头残雪
  dab(c, ellipse(28, 47, 8, 2.4, -0.1), '#f4f8fd');
}

/** 跳尸将军：和普通跳尸同款，换墨绿铠甲、肩甲、大红缨和红眼 */
function general(c: Ctx): void {
  const arm = '#2f6b4f';
  const armSh = '#1f4a37';
  blob(c, ellipse(22, 75, 6, 3.4), '#1d1b22', null, 2);
  blob(c, ellipse(40, 75, 6, 3.4), '#1d1b22', null, 2);
  // 铠甲身子
  blob(c, poly(17, 40, 47, 40, 51, 74, 13, 74), arm, armSh);
  blob(c, poly(13.6, 68, 50.4, 68, 51, 74, 13, 74), '#1d3a2d', null, 1.6);
  // 甲片横纹
  for (const y of [49, 56, 63]) stroke(c, (k) => { k.moveTo(19, y); k.lineTo(45, y); }, 1.1, '#1a3326');
  // 金护心镜
  blob(c, circle(32, 52, 6), '#e2b94a', '#b8903e', 1.8, 1.4);
  dab(c, circle(30.2, 50.2, 1.6), '#fff1b8', 0.9);
  // 腰带
  blob(c, rrect(17, 60, 30, 4, 1.2), '#7a2a22', null, 1.6);
  // 两条前伸的手臂
  blob(c, rrect(36, 42, 24, 7, 3), arm, armSh, 2.2, 1.4);
  blob(c, rrect(36, 51, 24, 7, 3), arm, armSh, 2.2, 1.4);
  blob(c, poly(58.5, 42.5, 63, 43.5, 63, 48, 58.5, 48.5), '#c3d6bb', null, 1.8);
  blob(c, poly(58.5, 51.5, 63, 52.5, 63, 57, 58.5, 57.5), '#c3d6bb', null, 1.8);
  // 肩甲：翘起的金边圆肩
  blob(c, ellipse(17, 41, 8.5, 6, -0.3), arm, armSh, 2.4, 1.6);
  blob(c, ellipse(47, 41, 8.5, 6, 0.3), arm, armSh, 2.4, 1.6);
  stroke(c, (k) => { k.moveTo(10.5, 43); k.quadraticCurveTo(17, 46.5, 23, 43.5); }, 1.8, '#e2b94a');
  stroke(c, (k) => { k.moveTo(41, 43.5); k.quadraticCurveTo(47, 46.5, 53.5, 43); }, 1.8, '#e2b94a');
  // 脸：更凶
  blob(c, rrect(18, 19, 28, 24, 8), '#b9cfb3', '#93ad8d', 2.4, 2.4);
  // 凶眉
  stroke(c, (k) => { k.moveTo(21, 26); k.lineTo(29, 29); }, 2.4);
  stroke(c, (k) => { k.moveTo(43, 26); k.lineTo(35, 29); }, 2.4);
  dab(c, ellipse(25, 32, 3.6, 2.8), '#6e1f1f');
  dab(c, ellipse(39, 32, 3.6, 2.8), '#6e1f1f');
  dab(c, circle(25.3, 32.2, 1.9), '#ff3b2f');
  dab(c, circle(39.3, 32.2, 1.9), '#ff3b2f');
  // 獠牙
  dab(c, poly(27, 38.5, 29, 38.5, 28, 42), '#fbf7ea');
  dab(c, poly(35, 38.5, 37, 38.5, 36, 42), '#fbf7ea');
  stroke(c, (k) => { k.moveTo(26, 38.3); k.lineTo(38, 38.3); }, 1.3);
  // 将军盔帽 + 大红缨
  blob(c, (k) => { k.arc(32, 20, 13, Math.PI, 0); }, '#26332e', '#161e1a', 2.4, 1.6);
  blob(c, ellipse(32, 20.5, 18.5, 4.6), '#26332e', null, 2.4);
  blob(c, poly(29, 8, 32, 0, 35, 8), '#e2b94a', null, 1.6);
  blob(c, (k) => { k.moveTo(32, 6); k.quadraticCurveTo(20, -3, 12, 8); k.quadraticCurveTo(22, 5, 29, 11); k.moveTo(32, 6); k.quadraticCurveTo(44, -3, 52, 8); k.quadraticCurveTo(42, 5, 35, 11); }, '#d0362e', '#9e2420', 1.8, 1);
  blob(c, circle(32, 7, 4.2), '#e0322e', '#a81f22', 1.8, 1.2);
  // 黄符，贴脑门
  c.save();
  c.translate(32, 20);
  c.rotate(-0.06);
  blob(c, rrect(-4, 0, 8, 21, 0.8), '#f2d14a', '#d8b232', 1.6, 1);
  stroke(c, (k) => { k.moveTo(-1.6, 3); k.lineTo(1.6, 5.2); k.lineTo(-1.6, 8.2); k.lineTo(1.6, 11.2); k.moveTo(0, 12.5); k.lineTo(0, 18); k.moveTo(-2.2, 15); k.lineTo(2.2, 15); }, 1, '#c0392b');
  c.restore();
}

/** 尸王：特大跳尸，暗金龙纹袍，金冠，长指甲，符纸掀开露出发光的眼，身后一圈黑气 */
function boss(c: Ctx): void {
  // 黑气：半透明深紫椭圆，压在最底层
  const rng = artRng(77);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const x = 60 + Math.cos(a) * 36;
    const y = 82 + Math.sin(a) * 34;
    dab(c, ellipse(x, y, 13 + rng() * 6, 10 + rng() * 5, a), '#3b1a5a', 0.4);
  }
  dab(c, ellipse(60, 100, 46, 24), '#2a1244', 0.35);
  const gold = '#b8923a';
  const goldSh = '#8a6a22';
  const robe = '#3b3a2e';
  const robeSh = '#262519';
  blob(c, ellipse(42, 124, 10, 5), '#17131c', null, 2.4);
  blob(c, ellipse(76, 124, 10, 5), '#17131c', null, 2.4);
  // 袍子
  blob(c, poly(28, 62, 90, 62, 100, 122, 18, 122), robe, robeSh, 2.6, 3.4);
  blob(c, poly(18.6, 112, 99.4, 112, 100, 122, 18, 122), gold, goldSh, 2.2, 1.2);
  for (let i = 0; i < 7; i++) stroke(c, (k) => { k.moveTo(26 + i * 11.6, 114); k.lineTo(28 + i * 11.6, 120); }, 1.2, '#6a4e14');
  // 金色领口与腰带
  blob(c, poly(45, 62, 59, 80, 73, 62, 67, 62, 59, 72, 51, 62), gold, goldSh, 1.8, 1);
  blob(c, rrect(32, 92, 54, 6, 2), gold, goldSh, 1.8, 1);
  // 袍上的龙纹：S 形盘龙 + 金鳞点
  stroke(c, (k) => { k.moveTo(40, 78); k.bezierCurveTo(54, 66, 66, 90, 78, 80); k.bezierCurveTo(86, 74, 84, 96, 70, 104); }, 3.4, '#e8c25a');
  stroke(c, (k) => { k.moveTo(40, 78); k.bezierCurveTo(54, 66, 66, 90, 78, 80); k.bezierCurveTo(86, 74, 84, 96, 70, 104); }, 1, '#8a6a22');
  blob(c, circle(40, 78, 4.6), '#e8c25a', '#b8923a', 1.8, 1);
  dab(c, circle(39, 77.6, 1), INK);
  dab(c, poly(35, 74, 33, 68, 38, 72), '#e8c25a');
  for (const [x, y] of [[54, 76], [64, 90], [76, 88], [82, 96]] as const) dab(c, circle(x, y, 1.6), '#f6e19a');
  // 两条前伸的长袖和手，长指甲
  blob(c, rrect(70, 66, 40, 11, 5), robe, robeSh, 2.4, 2);
  blob(c, rrect(70, 80, 40, 11, 5), robe, robeSh, 2.4, 2);
  blob(c, rrect(70, 74.5, 10, 3, 1), gold, null, 1.2);
  blob(c, circle(110, 71.5, 5.2), '#b9cfb3', '#93ad8d', 2, 1.4);
  blob(c, circle(110, 85.5, 5.2), '#b9cfb3', '#93ad8d', 2, 1.4);
  for (const y of [68, 71.5, 75]) blob(c, poly(113, y - 1, 120, y + 0.5, 113, y + 1.6), '#e8e0b4', null, 1.2);
  for (const y of [82, 85.5, 89]) blob(c, poly(113, y - 1, 120, y + 0.5, 113, y + 1.6), '#e8e0b4', null, 1.2);
  // 脸
  blob(c, rrect(36, 22, 46, 42, 14), '#b9cfb3', '#93ad8d', 2.8, 3.2);
  // 脸上的青筋纹
  stroke(c, (k) => { k.moveTo(40, 50); k.lineTo(46, 54); k.lineTo(44, 60); }, 1.2, '#6e8a69');
  stroke(c, (k) => { k.moveTo(78, 50); k.lineTo(72, 54); k.lineTo(74, 60); }, 1.2, '#6e8a69');
  // 一只眼睛被符纸盖着，另一只露出发光的眼（符纸半掀）
  dab(c, ellipse(48, 44, 5.4, 4), '#3a1030');
  dab(c, circle(48, 44, 3.2), '#ffd84a');
  dab(c, circle(48, 44, 1.6), '#ff4a2a');
  dab(c, circle(47.2, 43, 0.8), '#ffffff');
  // 发光的另一只眼：光晕
  dab(c, circle(70, 44, 8), '#ffd84a', 0.28);
  dab(c, ellipse(70, 44, 5.4, 4), '#3a1030');
  dab(c, circle(70, 44, 3.2), '#ffd84a');
  dab(c, circle(70, 44, 1.6), '#ff4a2a');
  // 獠牙嘴
  blob(c, (k) => { k.moveTo(47, 56); k.quadraticCurveTo(59, 64, 71, 56); k.quadraticCurveTo(59, 59, 47, 56); }, '#3a1a1a', null, 1.8);
  dab(c, poly(51, 57, 54, 58, 52, 62), '#fbf7ea');
  dab(c, poly(68, 57, 65, 58, 67, 62), '#fbf7ea');
  // 金冠：三叉冠，中间嵌红宝
  blob(c, poly(36, 24, 38, 8, 46, 16, 52, 2, 59, 12, 66, 2, 72, 16, 80, 8, 82, 24), '#e2b94a', '#b8923a', 2.4, 2);
  blob(c, rrect(35, 20, 48, 7, 2), '#e8c25a', '#b8923a', 2.2, 1.2);
  blob(c, circle(59, 23.5, 3.8), '#e0322e', '#a81f22', 1.6, 1);
  dab(c, circle(58, 22.4, 1), '#ffffff');
  // 黄符：从额头垂下，下半截掀起卷边向一侧飘
  c.save();
  c.translate(59, 27);
  blob(c, poly(-6, 0, 6, 0, 6, 12, -6, 12), '#f2d14a', '#d8b232', 1.8, 1.2);
  c.save();
  c.translate(0, 12);
  c.rotate(-0.55);
  blob(c, poly(-6, 0, 6, 0, 7, 11, -6, 11), '#e8c43c', '#c7a02a', 1.8, 1);
  c.restore();
  stroke(c, (k) => { k.moveTo(-2.4, 3); k.lineTo(2.4, 5.6); k.lineTo(-2.4, 8.6); }, 1.2, '#c0392b');
  c.restore();
}

/** 鬼火弹：外圈深紫、里面青绿发光的小火 */
function fireball(c: Ctx): void {
  dab(c, circle(12, 13, 11.5), '#7a2bd8', 0.28);
  const flame = (k: Ctx): void => {
    k.moveTo(12, 1.5);
    k.quadraticCurveTo(14, 6, 19, 9.5);
    k.quadraticCurveTo(22.5, 15, 18, 19.5);
    k.quadraticCurveTo(12, 23, 6, 19.5);
    k.quadraticCurveTo(1.5, 15, 5, 9.5);
    k.quadraticCurveTo(8, 7, 8.5, 3.5);
    k.quadraticCurveTo(10.5, 5, 12, 1.5);
  };
  blob(c, flame, '#4a2290', null, 2.2);
  c.save();
  c.translate(12, 14);
  c.scale(0.72, 0.72);
  c.translate(-12, -14);
  dab(c, flame, '#27d9a0');
  c.restore();
  dab(c, ellipse(12, 15.5, 4, 4.6), '#d8fff0');
  dab(c, circle(10.6, 13.5, 1.3), '#ffffff');
}

/** 魂珠：没有脸，和带脸的鬼火怪一眼分开；一个高光点、细黑边。rim 不为空时外面加一圈金边（大珠） */
function bead(r: number, main: string, shade: string, rim: string | null): (c: Ctx) => void {
  return (c) => {
    const m = r + 1;
    if (rim) {
      blob(c, circle(m, m, r), rim, '#b8892a', 1.1, 0.8);
      blob(c, circle(m, m, r - 2.1), main, shade, 0.9, 1.2);
    } else {
      blob(c, circle(m, m, r - 0.4), main, shade, 1.1, 1.2);
    }
    dab(c, circle(m - r * 0.32, m - r * 0.34, Math.max(1, r * 0.2)), '#ffffff', 0.95);
  };
}

/** 肉包：白胖，顶上一圈褶子，一点红点 */
function bun(c: Ctx): void {
  blob(c, (k) => { k.moveTo(2, 14); k.quadraticCurveTo(0, 6, 8, 3.5); k.quadraticCurveTo(11, 2, 14, 3.5); k.quadraticCurveTo(22, 6, 20, 14); k.quadraticCurveTo(19, 17, 11, 17); k.quadraticCurveTo(3, 17, 2, 14); }, '#fbf6ea', '#e1d6bd', 1.6, 1.6);
  // 褶子：从顶上一点往下放射的几道
  for (const dx of [-6, -3, 0, 3, 6]) stroke(c, (k) => { k.moveTo(11, 4.6); k.quadraticCurveTo(11 + dx * 0.7, 7, 11 + dx, 9.5); }, 0.8, '#b8a888');
  dab(c, circle(11, 4.6, 1.3), '#e0322e');
  dab(c, ellipse(6, 8, 2, 1.2, -0.5), '#ffffff', 0.8);
}

/** 符纸卷：黄纸卷成筒，两头木轴 */
function scroll(c: Ctx): void {
  blob(c, rrect(4, 3.5, 18, 11, 1.5), '#f2d14a', '#d8b232', 1.5, 1.2);
  stroke(c, (k) => { k.moveTo(8, 7); k.lineTo(10.5, 8.6); k.lineTo(8, 10.4); k.moveTo(15, 7.5); k.lineTo(18, 7.5); k.moveTo(15, 10.5); k.lineTo(18, 10.5); }, 0.8, '#c0392b');
  dab(c, rrect(5.5, 4.5, 15, 1.4, 0.7), '#fff3b0', 0.8);
  blob(c, rrect(1, 1.5, 4.5, 15, 1.8), '#a5632f', '#7a4519', 1.5, 1);
  blob(c, rrect(20.5, 1.5, 4.5, 15, 1.8), '#a5632f', '#7a4519', 1.5, 1);
  blob(c, circle(3.2, 1.8, 1.7), '#e2b94a', null, 1);
  blob(c, circle(22.8, 16.2, 1.7), '#e2b94a', null, 1);
}

/** 宝箱：朱红木箱，金包边金锁扣，盖缝里透出金光 */
function chest(c: Ctx): void {
  // 缝里漏出的光，先画在箱子后面，露出箱盖上沿一圈
  dab(c, ellipse(20, 11, 17, 5), '#ffd84a', 0.4);
  // 箱身
  blob(c, rrect(3, 15, 34, 17, 3), '#c8392b', '#962720', 2.2, 2);
  blob(c, (k) => { k.moveTo(3, 15); k.lineTo(3, 12); k.quadraticCurveTo(3, 5, 20, 5); k.quadraticCurveTo(37, 5, 37, 12); k.lineTo(37, 15); }, '#d9453a', '#a62c22', 2.2, 2);
  // 盖缝：一道亮缝
  stroke(c, (k) => { k.moveTo(4, 15); k.lineTo(36, 15); }, 2.4, '#fff1a0');
  stroke(c, (k) => { k.moveTo(4, 15); k.lineTo(36, 15); }, 0.9, '#ffffff');
  // 金包边
  for (const x of [8, 32]) blob(c, rrect(x - 2, 6, 4, 26, 1), '#e2b94a', '#b8892a', 1.6, 0.8);
  blob(c, rrect(3, 29, 34, 3, 1), '#e2b94a', null, 1.6);
  // 锁扣
  blob(c, rrect(16, 13, 8, 9, 2), '#f0c850', '#c29a2c', 1.8, 1);
  dab(c, circle(20, 17, 1.4), INK);
  dab(c, rrect(19.4, 17, 1.2, 3, 0.4), INK);
  dab(c, ellipse(14, 9, 4, 1.2, -0.3), '#ffffff', 0.4);
}

/** 石灯：古镇石灯笼，顶上积雪，窗里一点暖黄光 */
function stonelamp(c: Ctx): void {
  const s = '#a8abb3';
  const ss = '#7c7f89';
  blob(c, rrect(10, 62, 20, 7, 2), s, ss, 2.2, 1.6);
  blob(c, rrect(16, 38, 8, 25, 1.5), s, ss, 2.2, 1.4);
  blob(c, rrect(12, 35, 16, 5, 1.5), s, ss, 2.2, 1.2);
  // 灯室 + 暖光窗
  blob(c, rrect(10, 19, 20, 17, 2), s, ss, 2.4, 1.8);
  dab(c, rrect(14, 22, 12, 11, 1.5), '#ffb53a');
  dab(c, rrect(16, 24, 8, 7, 1), '#ffe58a');
  stroke(c, (k) => { k.moveTo(20, 22); k.lineTo(20, 33); }, 1.4, INK);
  stroke(c, (k) => { k.rect(14, 22, 12, 11); }, 1.4, INK);
  // 灯帽
  blob(c, poly(3, 19, 8, 11, 32, 11, 37, 19), '#8d909a', '#666a74', 2.4, 1.6);
  blob(c, poly(12, 11, 20, 3, 28, 11), '#8d909a', '#666a74', 2.2, 1.2);
  blob(c, circle(20, 3, 2), s, null, 1.6);
  // 积雪
  blob(c, (k) => { k.moveTo(10, 11); k.quadraticCurveTo(20, 1, 30, 11); k.quadraticCurveTo(26, 13.5, 22, 11.5); k.quadraticCurveTo(18, 14, 14, 11.5); k.quadraticCurveTo(12, 12.5, 10, 11); }, '#f6f9fd', '#cdd8e6', 1.8, 1);
  dab(c, ellipse(5.5, 18.2, 3, 1.5), '#f6f9fd');
  dab(c, ellipse(20, 61.5, 8, 1.6), '#f6f9fd');
}

/** 结冰水洼：浅蓝扁椭圆，几道白反光和裂纹，不描边 */
function puddle(c: Ctx): void {
  const e = ellipse(45, 18, 42, 15);
  dab(c, e, '#b9d6ee');
  dab(c, ellipse(45, 18, 42, 15), '#8fb8da', 0.0);
  c.save();
  c.beginPath();
  e(c);
  c.clip();
  dab(c, ellipse(43, 15, 34, 10), '#d3e8f7');
  dab(c, ellipse(40, 13, 20, 5), '#eaf5fc', 0.8);
  c.restore();
  c.save();
  c.beginPath();
  e(c);
  c.lineWidth = 1.4;
  c.strokeStyle = 'rgba(110,150,190,0.7)';
  c.stroke();
  c.restore();
  stroke(c, (k) => { k.moveTo(56, 12); k.lineTo(50, 17); k.lineTo(53, 21); k.lineTo(48, 26); }, 0.8, '#7fa5c8');
  stroke(c, (k) => { k.moveTo(50, 17); k.lineTo(40, 19); }, 0.7, '#7fa5c8');
  stroke(c, (k) => { k.moveTo(22, 14); k.lineTo(34, 10); }, 1.6, '#ffffff');
  stroke(c, (k) => { k.moveTo(60, 24); k.lineTo(68, 21); }, 1.4, '#ffffff');
}

/** 雪堆：起伏的白堆，底部浅蓝阴影，只用很淡的描边 */
function drift(c: Ctx): void {
  const shape = (k: Ctx): void => {
    k.moveTo(2, 36);
    k.quadraticCurveTo(6, 30, 20, 27);
    k.quadraticCurveTo(30, 12, 48, 18);
    k.quadraticCurveTo(62, 4, 78, 16);
    k.quadraticCurveTo(92, 16, 100, 26);
    k.quadraticCurveTo(108, 30, 108, 36);
    k.quadraticCurveTo(55, 40, 2, 36);
  };
  c.save();
  c.beginPath();
  shape(c);
  c.fillStyle = '#c8d8ec';
  c.fill();
  c.clip();
  // 上半白、下半留蓝影
  dab(c, ellipse(52, 18, 58, 17), '#fbfdff');
  dab(c, ellipse(40, 14, 22, 6), '#ffffff');
  c.restore();
  c.save();
  c.beginPath();
  shape(c);
  c.lineWidth = 1.2;
  c.strokeStyle = 'rgba(130,160,200,0.75)';
  c.lineJoin = 'round';
  c.stroke();
  c.restore();
}

/** 脚印：浅灰蓝小凹痕，无描边，主角身后一串串放，所以很淡 */
function footprint(c: Ctx): void {
  dab(c, ellipse(7, 5, 5.2, 3.2), '#8fa4c0', 0.55);
  dab(c, ellipse(6.2, 4.2, 3.6, 2), '#f3f7fc', 0.6);
}

/** 主角脚下的月光光环：扁椭圆，中间透明，边缘发亮，几颗小星点 */
function aura(c: Ctx): void {
  c.save();
  c.translate(60, 24);
  c.scale(1, 0.4);
  const g = c.createRadialGradient(0, 0, 30, 0, 0, 58);
  g.addColorStop(0, 'rgba(255,240,180,0)');
  g.addColorStop(0.55, 'rgba(255,232,150,0.45)');
  g.addColorStop(0.8, 'rgba(255,214,110,0.9)');
  g.addColorStop(1, 'rgba(255,200,90,0)');
  c.fillStyle = g;
  c.beginPath();
  c.arc(0, 0, 58, 0, Math.PI * 2);
  c.fill();
  c.restore();
  // 亮边一道细线，雪地上才看得清
  c.save();
  c.beginPath();
  c.ellipse(60, 24, 47, 17.5, 0, 0, Math.PI * 2);
  c.lineWidth = 1.6;
  c.strokeStyle = 'rgba(255,248,215,0.95)';
  c.stroke();
  c.beginPath();
  c.ellipse(60, 24, 50, 19, 0, 0, Math.PI * 2);
  c.lineWidth = 1;
  c.strokeStyle = 'rgba(214,150,40,0.55)';
  c.stroke();
  c.restore();
  const rng = artRng(5);
  for (let i = 0; i < 7; i++) {
    const a = rng() * Math.PI * 2;
    const x = 60 + Math.cos(a) * 47;
    const y = 24 + Math.sin(a) * 17.5;
    dab(c, poly(x, y - 3, x + 0.9, y - 0.9, x + 3, y, x + 0.9, y + 0.9, x, y + 3, x - 0.9, y + 0.9, x - 3, y, x - 0.9, y - 0.9), '#fffbe6');
  }
}

/** 升级光柱：竖直，中心白、两边渐变成金色透明；顶部渐隐，底部亮 */
function pillar(c: Ctx): void {
  const g = c.createLinearGradient(0, 0, 60, 0);
  g.addColorStop(0, 'rgba(255,196,60,0)');
  g.addColorStop(0.2, 'rgba(255,200,70,0.7)');
  g.addColorStop(0.36, 'rgba(255,250,225,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,1)');
  g.addColorStop(0.64, 'rgba(255,250,225,1)');
  g.addColorStop(0.8, 'rgba(255,200,70,0.7)');
  g.addColorStop(1, 'rgba(255,196,60,0)');
  c.save();
  c.fillStyle = g;
  c.fillRect(0, 0, 60, 200);
  // 竖向遮罩：顶上淡出
  c.globalCompositeOperation = 'destination-in';
  const v = c.createLinearGradient(0, 0, 0, 200);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(0.5, 'rgba(0,0,0,0.7)');
  v.addColorStop(1, 'rgba(0,0,0,1)');
  c.fillStyle = v;
  c.fillRect(0, 0, 60, 200);
  c.restore();
  const rng = artRng(9);
  for (let i = 0; i < 9; i++) dab(c, circle(22 + rng() * 16, 20 + rng() * 170, 1 + rng() * 1.3), '#fff8d0', 0.9);
  dab(c, ellipse(30, 197, 22, 3.5), '#fff3b0', 0.9);
}

/** 花瓣（备用） */
function petal(c: Ctx): void {
  blob(c, (k) => { k.moveTo(1.5, 8); k.quadraticCurveTo(0, 2, 5, 1); k.quadraticCurveTo(10, 2, 8.5, 8); k.quadraticCurveTo(5, 10, 1.5, 8); }, '#f7a6c0', '#d9729a', 1, 1);
}

// ---- 图标（32×32，粗墨边，缩到 64px 内一眼能认） ----

/** 斩妖剑：金红的剑身带火焰 */
function iSwordEvo(c: Ctx): void {
  dab(c, circle(16, 16, 15), '#ff9a3a', 0.25);
  c.save();
  c.translate(16, 17);
  c.rotate(0.78);
  // 火焰：剑身两侧三簇
  for (const [x, y, h] of [[-5.5, -2, 8], [5.5, -8, 9], [-5, -11, 7]] as const) {
    blob(c, (k) => { k.moveTo(x - 2.4, y + 4); k.quadraticCurveTo(x - 3, y - h * 0.4, x, y - h); k.quadraticCurveTo(x + 0.5, y - h * 0.4, x + 2.4, y + 4); }, '#ff7a2a', '#d8381f', 1.2, 0.8);
  }
  blob(c, poly(-3.2, 9, -3.2, -11, 0, -16, 3.2, -11, 3.2, 9), '#f4c24a', '#d0381f', 1.8, 1.4);
  stroke(c, (k) => { k.moveTo(0, -12); k.lineTo(0, 7); }, 0.9, '#fff3b0');
  blob(c, rrect(-7.5, 8, 15, 3.6, 1.4), '#b8892a', null, 1.6);
  blob(c, rrect(-1.8, 11.4, 3.6, 5, 1), '#7a2a1a', null, 1.2);
  c.restore();
}

/** 天师符雨：三张金符叠成扇形 */
function iTalismanEvo(c: Ctx): void {
  for (const [a, dx] of [[-0.35, -5], [0.35, 5], [0, 0]] as const) {
    c.save();
    c.translate(16 + dx, 17);
    c.rotate(a);
    blob(c, rrect(-5, -12, 10, 24, 1), '#f6cf48', '#d09a22', 1.8, 1.2);
    stroke(c, (k) => { k.moveTo(-2, -8); k.lineTo(2, -5.5); k.lineTo(-2, -2.5); k.lineTo(2, 0); k.moveTo(0, 2); k.lineTo(0, 8); }, 1.1, '#c0392b');
    c.restore();
  }
  dab(c, circle(26, 5, 1.4), '#fff6c0');
  dab(c, circle(6, 8, 1.1), '#fff6c0');
}

/** 朱砂：浅碟里一堆红砂 */
function pZhusha(c: Ctx): void {
  blob(c, (k) => { k.moveTo(3, 18); k.quadraticCurveTo(16, 31, 29, 18); k.quadraticCurveTo(16, 22, 3, 18); }, '#e8e2d2', '#bdb49c', 1.8, 1.4);
  blob(c, ellipse(16, 18, 13, 3.6), '#f1ecdd', null, 1.8);
  blob(c, (k) => { k.moveTo(6, 17.5); k.quadraticCurveTo(10, 6, 16, 5); k.quadraticCurveTo(22, 6, 26, 17.5); k.quadraticCurveTo(16, 21, 6, 17.5); }, '#d8261e', '#9e1a16', 1.8, 1.4);
  dab(c, ellipse(13, 11, 2.4, 1.4, -0.6), '#ff8a7a', 0.9);
  blob(c, rrect(12, 27, 8, 2.5, 1), '#bdb49c', null, 1.4);
}

/** 香炉：铜三足炉，冒一缕青烟 */
function pXianglu(c: Ctx): void {
  stroke(c, (k) => { k.moveTo(16, 11); k.bezierCurveTo(10, 8, 22, 5, 15, 1); }, 3.4, INK);
  stroke(c, (k) => { k.moveTo(16, 11); k.bezierCurveTo(10, 8, 22, 5, 15, 1); }, 1.6, '#e6eef4');
  for (const x of [8, 22]) blob(c, poly(x, 24, x + 3, 24, x + 2, 30, x - 1, 30), '#a86a2a', null, 1.8);
  blob(c, poly(14.5, 24, 17.5, 24, 17, 30, 15, 30), '#a86a2a', null, 1.8);
  blob(c, (k) => { k.moveTo(4, 14); k.quadraticCurveTo(3, 26, 16, 26); k.quadraticCurveTo(29, 26, 28, 14); }, '#c98a3a', '#96601f', 2.2, 2);
  blob(c, ellipse(16, 14, 12.5, 3.2), '#e0a84a', null, 2);
  blob(c, circle(4, 16, 2.6), '#c98a3a', null, 1.6);
  blob(c, circle(28, 16, 2.6), '#c98a3a', null, 1.6);
  dab(c, ellipse(16, 14, 8, 1.4), '#4a2a14');
  dab(c, ellipse(9, 19, 1.6, 3, 0.2), '#ffe9a8', 0.8);
}

/** 草鞋：编草的鞋底加红带 */
function pCaoxie(c: Ctx): void {
  blob(c, (k) => { k.moveTo(3, 21); k.quadraticCurveTo(3, 12, 11, 12); k.lineTo(19, 12); k.quadraticCurveTo(28, 12, 29, 20); k.quadraticCurveTo(29, 27, 22, 27); k.lineTo(9, 27); k.quadraticCurveTo(3, 27, 3, 21); }, '#d8b25a', '#a88030', 2.2, 2);
  for (const x of [8, 13, 18, 23]) stroke(c, (k) => { k.moveTo(x, 20); k.lineTo(x + 2, 25); }, 1, '#8a6520');
  blob(c, (k) => { k.moveTo(10, 12); k.quadraticCurveTo(14, 3, 20, 12); k.lineTo(17, 12); k.quadraticCurveTo(14, 8, 13, 12); }, '#d0362e', null, 1.8);
  stroke(c, (k) => { k.moveTo(11, 17); k.lineTo(19, 14); }, 2, '#d0362e');
  dab(c, ellipse(8, 17, 2, 1, -0.5), '#f6e2a0', 0.9);
}

/** 仙桃：粉桃尖带叶 */
function pXiantao(c: Ctx): void {
  blob(c, (k) => { k.moveTo(16, 28); k.bezierCurveTo(3, 26, 2, 11, 12, 9); k.quadraticCurveTo(16, 7, 21, 10); k.bezierCurveTo(30, 12, 29, 27, 16, 28); }, '#f79ab0', '#d8607c', 2.4, 2.2);
  dab(c, ellipse(22, 20, 3, 5, 0.3), '#ffd2dc', 0);
  stroke(c, (k) => { k.moveTo(16, 10); k.quadraticCurveTo(14, 18, 17, 27); }, 1.2, '#d8607c');
  blob(c, (k) => { k.moveTo(17, 9); k.quadraticCurveTo(23, 1, 29, 5); k.quadraticCurveTo(26, 12, 17, 9); }, '#4fbf6a', '#2f8f4a', 1.8, 1);
  stroke(c, (k) => { k.moveTo(16, 9); k.lineTo(17, 5); }, 1.8, '#7a4a20');
  dab(c, ellipse(9, 16, 2, 3.4, 0.3), '#ffe3ea', 0.9);
}

/** 罗盘：木盘、金针、八卦刻度 */
function pLuopan(c: Ctx): void {
  blob(c, circle(16, 16, 14), '#b8782e', '#8a5420', 2.4, 2);
  blob(c, circle(16, 16, 10.5), '#f1e4bc', '#d8c690', 1.6, 1.4);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    stroke(c, (k) => { k.moveTo(16 + Math.cos(a) * 7.6, 16 + Math.sin(a) * 7.6); k.lineTo(16 + Math.cos(a) * 10, 16 + Math.sin(a) * 10); }, 1.4);
  }
  // 指南针：红头青尾
  c.save();
  c.translate(16, 16);
  c.rotate(-0.6);
  blob(c, poly(0, -8, 2.6, 0, -2.6, 0), '#d8261e', null, 1.4);
  blob(c, poly(0, 8, 2.6, 0, -2.6, 0), '#3f6aa0', null, 1.4);
  c.restore();
  dab(c, circle(16, 16, 1.4), '#f4c24a');
}

/** 道袍：蓝袍、黄边、红腰带，宽袖 */
function pDaopao(c: Ctx): void {
  blob(c, (k) => { k.moveTo(11, 4); k.lineTo(4, 10); k.lineTo(1, 22); k.lineTo(7, 24); k.lineTo(8, 15); k.lineTo(7, 29); k.lineTo(25, 29); k.lineTo(24, 15); k.lineTo(25, 24); k.lineTo(31, 22); k.lineTo(28, 10); k.lineTo(21, 4); k.quadraticCurveTo(16, 8, 11, 4); }, '#3f62a0', '#2b4678', 2.2, 2);
  blob(c, poly(11, 4, 16, 14, 21, 4, 18.5, 4, 16, 8.5, 13.5, 4), '#f3efe6', null, 1.6);
  blob(c, rrect(8, 18, 16, 3.4, 1.2), '#c8402f', null, 1.6);
  blob(c, rrect(7.4, 26, 17.2, 3, 1), '#f2c94c', null, 1.6);
  blob(c, circle(16, 23.5, 0.1), '#f6f2e8', null, 0);
}

/** 念珠串：一圈木珠，下面垂红穗 */
function pNianzhu(c: Ctx): void {
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = Math.PI * 0.12 + (i / (n - 1)) * Math.PI * 1.76 - Math.PI / 2 + Math.PI;
    const x = 16 + Math.cos(a) * 11;
    const y = 14 + Math.sin(a) * 11;
    blob(c, circle(x, y, 3.2), '#8a4a22', '#5e2e14', 1.6, 1);
    dab(c, circle(x - 1, y - 1, 0.8), '#e0b080', 0.9);
  }
  blob(c, circle(16, 27, 3.4), '#d8261e', '#9e1a16', 1.8, 1);
  stroke(c, (k) => { k.moveTo(16, 29); k.lineTo(14.5, 32); k.moveTo(16, 29); k.lineTo(17.5, 32); }, 1.6, '#d8261e');
}

/** 令牌：木牌上一个"令"字，顶端系红绳 */
function pLingpai(c: Ctx): void {
  stroke(c, (k) => { k.moveTo(16, 4); k.quadraticCurveTo(10, 1, 11, 6); }, 1.8, '#d0362e');
  blob(c, (k) => { k.moveTo(8, 7); k.quadraticCurveTo(16, 2, 24, 7); k.lineTo(24, 26); k.quadraticCurveTo(16, 31, 8, 26); }, '#b8782e', '#8a5420', 2.4, 2);
  blob(c, circle(16, 6, 0.1), '#d0362e', null, 0);
  stroke(c, (k) => { k.moveTo(10.5, 9); k.quadraticCurveTo(16, 6, 21.5, 9); }, 1, '#f4c24a');
  // 令字：用笔画拼，64px 下够认
  const w = '#f6e2a8';
  stroke(c, (k) => { k.moveTo(16, 9); k.lineTo(11.5, 13.5); k.moveTo(16, 9); k.lineTo(20.5, 13.5); }, 2, w);
  stroke(c, (k) => { k.moveTo(12.5, 15.5); k.lineTo(19.5, 15.5); }, 2, w);
  stroke(c, (k) => { k.moveTo(16, 15.5); k.lineTo(14, 18.5); k.lineTo(19, 18.5); }, 2, w);
  stroke(c, (k) => { k.moveTo(16, 19); k.lineTo(16, 25); }, 2, w);
  stroke(c, (k) => { k.moveTo(12.5, 21); k.lineTo(19.5, 21); }, 0.01, w);
}

export const SPRITES2: SpriteDef[] = [
  { key: 'fox', w: 48, h: 44, ox: 0.5, oy: 0.95, draw: fox },
  { key: 'shishi', w: 90, h: 84, ox: 0.5, oy: 0.95, draw: shishi },
  { key: 'general', w: 64, h: 80, ox: 0.5, oy: 0.95, draw: general },
  { key: 'boss', w: 124, h: 132, ox: 0.5, oy: 0.95, draw: boss },
  { key: 'fireball', w: 24, h: 24, ox: 0.5, oy: 0.5, draw: fireball },
  { key: 'bead1', w: 14, h: 14, ox: 0.5, oy: 0.5, draw: bead(6, '#3fcf8a', '#1f9a62', null) },
  { key: 'bead2', w: 16, h: 16, ox: 0.5, oy: 0.5, draw: bead(7, '#b07af0', '#7444c0', null) },
  { key: 'bead3', w: 20, h: 20, ox: 0.5, oy: 0.5, draw: bead(9, '#e0412f', '#a82a1f', '#f0c850') },
  { key: 'bun', w: 22, h: 18, ox: 0.5, oy: 0.9, draw: bun },
  { key: 'scroll', w: 26, h: 18, ox: 0.5, oy: 0.9, draw: scroll },
  { key: 'chest', w: 40, h: 34, ox: 0.5, oy: 0.95, draw: chest },
  { key: 'stonelamp', w: 40, h: 70, ox: 0.5, oy: 0.97, draw: stonelamp },
  { key: 'puddle', w: 90, h: 36, ox: 0.5, oy: 0.5, draw: puddle },
  { key: 'drift', w: 110, h: 40, ox: 0.5, oy: 0.9, draw: drift },
  { key: 'footprint', w: 14, h: 10, ox: 0.5, oy: 0.5, draw: footprint },
  { key: 'aura', w: 120, h: 48, ox: 0.5, oy: 0.5, draw: aura },
  { key: 'pillar', w: 60, h: 200, ox: 0.5, oy: 1, draw: pillar },
  { key: 'petal', w: 10, h: 10, ox: 0.5, oy: 0.5, draw: petal },
  { key: 'i_sword_evo', w: 32, h: 32, ox: 0.5, oy: 0.5, draw: iSwordEvo },
  { key: 'i_talisman_evo', w: 32, h: 32, ox: 0.5, oy: 0.5, draw: iTalismanEvo },
  { key: 'p_zhusha', w: 32, h: 32, ox: 0.5, oy: 0.5, draw: pZhusha },
  { key: 'p_xianglu', w: 32, h: 32, ox: 0.5, oy: 0.5, draw: pXianglu },
  { key: 'p_caoxie', w: 32, h: 32, ox: 0.5, oy: 0.5, draw: pCaoxie },
  { key: 'p_xiantao', w: 32, h: 32, ox: 0.5, oy: 0.5, draw: pXiantao },
  { key: 'p_luopan', w: 32, h: 32, ox: 0.5, oy: 0.5, draw: pLuopan },
  { key: 'p_daopao', w: 32, h: 32, ox: 0.5, oy: 0.5, draw: pDaopao },
  { key: 'p_nianzhu', w: 32, h: 32, ox: 0.5, oy: 0.5, draw: pNianzhu },
  { key: 'p_lingpai', w: 32, h: 32, ox: 0.5, oy: 0.5, draw: pLingpai },
];
