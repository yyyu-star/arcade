/**
 * 第十二批精灵：各地区的特色怪（content/regions.ts）。画法同前：大头 Q 版、墨色粗描边、平涂 + 右下一层阴影。
 * 主色跟着地面走，在对应的地上一眼就能认出来：竹林偏绿、河滩偏灰褐、冰湖偏白蓝；古镇的更夫鬼偏靛蓝，山寺的石僧偏石灰。
 * 主图集在 res 3 时已经装不下，这批单独一张图集（atlas.ts 的 MOB_TEX）。
 */
import { INK, blob, circle, dab, ellipse, poly, rrect, stroke, type Ctx } from './draw.ts';
import type { SpriteDef } from './sprites.ts';

const BAM = '#7fc45a';
const BAM_SH = '#4a8f3a';
const BAM_D = '#2f6a2a';
const DIRT = '#85613c';
const DIRT_SH = '#5d4128';

/** 一节竹子：圆角竖条 + 节环 */
function stalk(c: Ctx, x: number, y: number, w: number, h: number, nodes: number): void {
  blob(c, rrect(x, y, w, h, w * 0.3), BAM, BAM_SH, 2.2, 2);
  for (let k = 1; k <= nodes; k++) {
    const ny = y + (h * k) / (nodes + 1);
    blob(c, rrect(x - 1.5, ny - 1.6, w + 3, 3.4, 1.6), BAM_D, null, 1.6);
  }
  dab(c, rrect(x + 2, y + 3, 2, h - 6, 1), '#ffffff', 0.35);
}

/** 竹叶：一片尖叶 */
function leaf(c: Ctx, x: number, y: number, dx: number, dy: number, color = '#5fae48'): void {
  blob(c, (k) => {
    k.moveTo(x, y);
    k.quadraticCurveTo(x + dx * 0.5 - dy * 0.3, y + dy * 0.5 + dx * 0.3, x + dx, y + dy);
    k.quadraticCurveTo(x + dx * 0.5 + dy * 0.3, y + dy * 0.5 - dx * 0.3, x, y);
  }, color, BAM_SH, 1.8, 1);
}

/** 竹精：一截会走的竹笋，顶上两片叶子当耳朵，脚下带着土堆 */
function bamsprout(c: Ctx): void {
  dab(c, ellipse(22, 54, 17, 4), INK, 0.22);
  // 土堆和碎土
  blob(c, (k) => { k.moveTo(3, 54); k.quadraticCurveTo(6, 42, 22, 42); k.quadraticCurveTo(38, 42, 41, 54); }, DIRT, DIRT_SH, 2.2, 2);
  dab(c, circle(8, 48, 1.8), DIRT_SH);
  dab(c, circle(36, 49, 1.6), DIRT_SH);
  // 竹身
  blob(c, (k) => { k.moveTo(12, 46); k.lineTo(14, 14); k.quadraticCurveTo(22, 6, 30, 14); k.lineTo(32, 46); k.closePath(); }, BAM, BAM_SH, 2.4, 3);
  blob(c, rrect(11, 28, 22, 4, 1.8), BAM_D, null, 1.6);
  dab(c, rrect(16, 16, 2.6, 24, 1.2), '#ffffff', 0.4);
  // 叶耳
  leaf(c, 16, 14, -13, -9);
  leaf(c, 28, 14, 13, -10);
  leaf(c, 22, 10, 1, -12, '#8ad060');
  // 凶脸：斜眉、黄眼、咧嘴
  stroke(c, (k) => { k.moveTo(15, 19); k.lineTo(20, 22); k.moveTo(29, 19); k.lineTo(24, 22); }, 2);
  dab(c, ellipse(18.5, 24, 2.3, 2.8), '#ffe46a');
  dab(c, ellipse(25.5, 24, 2.3, 2.8), '#ffe46a');
  dab(c, circle(18.8, 24.6, 1.1), INK);
  dab(c, circle(25.2, 24.6, 1.1), INK);
  blob(c, (k) => { k.moveTo(17, 33); k.quadraticCurveTo(22, 38, 27, 33); k.lineTo(25, 32); k.lineTo(22, 34.4); k.lineTo(19, 32); }, INK, null, 1);
  // 根须小手
  stroke(c, (k) => { k.moveTo(12, 44); k.quadraticCurveTo(6, 44, 4, 38); }, 3, INK);
  stroke(c, (k) => { k.moveTo(12, 44); k.quadraticCurveTo(6, 44, 4, 38); }, 1.6, '#c9a36a');
  stroke(c, (k) => { k.moveTo(32, 44); k.quadraticCurveTo(38, 44, 40, 38); }, 3, INK);
  stroke(c, (k) => { k.moveTo(32, 44); k.quadraticCurveTo(38, 44, 40, 38); }, 1.6, '#c9a36a');
}

/** 蛇精：竹青色的蛇盘成 S 形，头昂起，背上一排竹叶斑，红信子 */
function snakespirit(c: Ctx): void {
  dab(c, ellipse(28, 40, 24, 4), INK, 0.22);
  const body = (k: Ctx): void => {
    k.moveTo(6, 36);
    k.bezierCurveTo(12, 24, 22, 44, 30, 34);
    k.bezierCurveTo(38, 24, 36, 18, 40, 16);
  };
  stroke(c, body, 14, INK);
  stroke(c, body, 10, '#5faa3e');
  stroke(c, body, 3.4, '#a6dc72');
  // 背上的叶斑
  for (const [x, y] of [[12, 31], [22, 38], [31, 33], [37, 24]] as const) dab(c, poly(x - 2.5, y, x, y - 3, x + 2.5, y, x, y + 3), BAM_D, 0.8);
  // 尾尖
  blob(c, poly(4, 36, 9, 33, 8, 39), '#5faa3e', null, 1.8);
  // 头
  blob(c, ellipse(43, 14, 8.5, 6.4, -0.3), '#5faa3e', BAM_SH, 2.2, 1.6);
  dab(c, ellipse(41, 11.5, 4, 1.8, -0.3), '#ffffff', 0.4);
  // 眼睛：竖瞳黄眼
  dab(c, ellipse(45, 12, 2.1, 2.5), '#ffe46a');
  dab(c, ellipse(45.2, 12, 0.7, 2), INK);
  // 红信子
  stroke(c, (k) => { k.moveTo(50, 16); k.lineTo(55, 17); k.lineTo(57, 15); k.moveTo(55, 17); k.lineTo(57, 19.5); }, 1.6, '#d6342c');
}

/** 竹王（精英）：三根粗竹并成的巨人，头戴竹叶冠，胸口一圈金环，两手各握一杆竹枪 */
function bambooking(c: Ctx): void {
  dab(c, ellipse(42, 94, 30, 5), INK, 0.24);
  // 竹枪（身后两杆）
  for (const x of [8, 76]) {
    stroke(c, (k) => { k.moveTo(x, 90); k.lineTo(x, 22); }, 7, INK);
    stroke(c, (k) => { k.moveTo(x, 90); k.lineTo(x, 22); }, 4, BAM);
    blob(c, poly(x - 5, 24, x, 6, x + 5, 24), '#e8e0c0', '#b8ae88', 1.8, 1);
  }
  // 腿
  stalk(c, 26, 70, 13, 24, 1);
  stalk(c, 45, 70, 13, 24, 1);
  // 躯干：三根竹并排
  stalk(c, 19, 34, 15, 44, 2);
  stalk(c, 50, 34, 15, 44, 2);
  stalk(c, 32, 30, 20, 52, 2);
  // 金环腰带
  blob(c, rrect(18, 56, 48, 7, 3), '#f0c850', '#c29a2c', 2, 1.4);
  blob(c, circle(42, 59.5, 4.4), '#d6342c', '#a02a2c', 1.6, 1);
  // 手臂
  blob(c, rrect(8, 40, 14, 9, 4), BAM, BAM_SH, 2, 1.4);
  blob(c, rrect(62, 40, 14, 9, 4), BAM, BAM_SH, 2, 1.4);
  // 头：圆脸，竹叶冠
  blob(c, circle(42, 24, 14), '#9ad473', BAM_SH, 2.4, 2.4);
  leaf(c, 30, 14, -14, -12, '#4f9a3a');
  leaf(c, 36, 11, -6, -16, '#5fae48');
  leaf(c, 42, 10, 0, -17, '#8ad060');
  leaf(c, 48, 11, 6, -16, '#5fae48');
  leaf(c, 54, 14, 14, -12, '#4f9a3a');
  // 脸：浓眉、红眼、獠牙
  stroke(c, (k) => { k.moveTo(32, 19); k.lineTo(39, 23); k.moveTo(52, 19); k.lineTo(45, 23); }, 2.8);
  dab(c, ellipse(36, 26, 3, 3.3), '#ff5a3c');
  dab(c, ellipse(48, 26, 3, 3.3), '#ff5a3c');
  dab(c, circle(36, 26.4, 1.2), INK);
  dab(c, circle(48, 26.4, 1.2), INK);
  blob(c, (k) => { k.moveTo(35, 33); k.quadraticCurveTo(42, 39, 49, 33); k.lineTo(47, 32); k.lineTo(42, 35); k.lineTo(37, 32); }, INK, null, 1);
  dab(c, poly(37, 33, 38.6, 37, 40, 34), '#ffffff');
  dab(c, poly(47, 33, 45.4, 37, 44, 34), '#ffffff');
}

const MUD = '#8c8676';
const MUD_SH = '#5f5a4c';

/** 溺鬼：灰褐的泡胀人形从水洼里探出半身，湿发盖脸，两手前伸，头上缠着水草 */
function drown(c: Ctx): void {
  dab(c, ellipse(23, 48, 20, 6), '#56707a', 0.7);
  stroke(c, (k) => { k.ellipse(23, 48, 21, 6.4, 0, 0, Math.PI * 2); }, 1.6, '#c7d6d8');
  // 身子
  blob(c, (k) => { k.moveTo(8, 48); k.quadraticCurveTo(7, 26, 15, 20); k.lineTo(31, 20); k.quadraticCurveTo(39, 26, 38, 48); k.closePath(); }, MUD, MUD_SH, 2.4, 2.8);
  // 水渍
  dab(c, ellipse(23, 44, 14, 3), '#4f6a6e', 0.6);
  // 手
  blob(c, (k) => { k.moveTo(10, 30); k.quadraticCurveTo(0, 30, 1, 20); k.lineTo(5, 20); k.quadraticCurveTo(6, 25, 13, 26); }, MUD, MUD_SH, 2, 1);
  blob(c, (k) => { k.moveTo(36, 30); k.quadraticCurveTo(46, 30, 45, 20); k.lineTo(41, 20); k.quadraticCurveTo(40, 25, 33, 26); }, MUD, MUD_SH, 2, 1);
  // 头
  blob(c, circle(23, 15, 11), '#a7a493', MUD_SH, 2.4, 2.2);
  // 湿发：深色的发帘垂到胸口
  blob(c, (k) => { k.moveTo(11, 14); k.quadraticCurveTo(12, 3, 23, 3); k.quadraticCurveTo(34, 3, 35, 14); k.lineTo(36, 30); k.lineTo(31, 22); k.lineTo(28, 33); k.lineTo(24, 21); k.lineTo(20, 33); k.lineTo(17, 22); k.lineTo(10, 30); k.closePath(); }, '#34392f', null, 2.2);
  // 缝里露出一对惨白的眼
  dab(c, ellipse(18.6, 16, 2.4, 3.2), '#f4f1d8');
  dab(c, ellipse(27.4, 16, 2.4, 3.2), '#f4f1d8');
  dab(c, circle(18.8, 17, 0.9), INK);
  dab(c, circle(27.2, 17, 0.9), INK);
  // 水草
  stroke(c, (k) => { k.moveTo(14, 6); k.quadraticCurveTo(8, 2, 6, 9); }, 3, INK);
  stroke(c, (k) => { k.moveTo(14, 6); k.quadraticCurveTo(8, 2, 6, 9); }, 1.6, '#5f9a52');
  stroke(c, (k) => { k.moveTo(32, 6); k.quadraticCurveTo(38, 1, 40, 8); }, 3, INK);
  stroke(c, (k) => { k.moveTo(32, 6); k.quadraticCurveTo(38, 1, 40, 8); }, 1.6, '#5f9a52');
  // 水滴
  dab(c, poly(8, 36, 9.4, 39, 6.6, 39), '#9fd0e0');
  dab(c, poly(38, 37, 39.4, 40, 36.6, 40), '#9fd0e0');
}

/** 河蟹：灰褐的硬壳大蟹，两只大钳举着，眼睛长在小柄上，壳上一道道纹 */
function crab(c: Ctx): void {
  const sh = '#a48c6c';
  const ssh = '#6d5a42';
  dab(c, ellipse(26, 34, 22, 4), INK, 0.22);
  // 腿：每侧三条
  for (const s of [-1, 1]) {
    for (const [y, l] of [[22, 9], [26, 11], [30, 9]] as const) {
      const x0 = 26 + s * 12;
      stroke(c, (k) => { k.moveTo(x0, y); k.lineTo(x0 + s * l, y + 4); k.lineTo(x0 + s * (l + 2), y + 10); }, 4, INK);
      stroke(c, (k) => { k.moveTo(x0, y); k.lineTo(x0 + s * l, y + 4); k.lineTo(x0 + s * (l + 2), y + 10); }, 2, ssh);
    }
  }
  // 大钳：臂 + 钳子
  for (const s of [-1, 1]) {
    const bx = 26 + s * 16;
    stroke(c, (k) => { k.moveTo(26 + s * 12, 20); k.lineTo(bx + s * 4, 12); }, 5, INK);
    stroke(c, (k) => { k.moveTo(26 + s * 12, 20); k.lineTo(bx + s * 4, 12); }, 3, sh);
    blob(c, (k) => {
      k.moveTo(bx + s * 2, 12);
      k.quadraticCurveTo(bx + s * 2, 1, bx + s * 10, 3);
      k.quadraticCurveTo(bx + s * 8, 7, bx + s * 7, 9);
      k.quadraticCurveTo(bx + s * 12, 10, bx + s * 10, 15);
      k.quadraticCurveTo(bx + s * 4, 17, bx + s * 2, 12);
    }, '#c46a3a', '#8f4624', 2, 1.4);
  }
  // 壳
  blob(c, ellipse(26, 24, 16, 11), sh, ssh, 2.4, 2.6);
  stroke(c, (k) => { k.moveTo(16, 22); k.quadraticCurveTo(26, 16, 36, 22); }, 1.4, ssh);
  stroke(c, (k) => { k.moveTo(14, 27); k.quadraticCurveTo(26, 21, 38, 27); }, 1.4, ssh);
  dab(c, ellipse(20, 20, 5, 2, -0.4), '#ffffff', 0.4);
  // 眼柄
  for (const s of [-1, 1]) {
    stroke(c, (k) => { k.moveTo(26 + s * 4, 15); k.lineTo(26 + s * 5, 9); }, 2.4, INK);
    dab(c, circle(26 + s * 5, 8, 2.8), '#f4f1d8');
    blob(c, circle(26 + s * 5, 8, 2.8), '#f4f1d8', null, 1.6);
    dab(c, circle(26 + s * 5, 8.4, 1.2), INK);
  }
}

/** 河伯（精英）：灰褐长袍的河神，芦苇冠，长须垂到胸口，手持浪纹杖；脚下一圈水波 */
function hebo(c: Ctx): void {
  dab(c, ellipse(42, 92, 34, 6), '#56707a', 0.75);
  stroke(c, (k) => { k.ellipse(42, 92, 36, 7, 0, 0, Math.PI * 2); }, 1.8, '#c7d6d8');
  // 杖
  stroke(c, (k) => { k.moveTo(70, 88); k.lineTo(70, 20); }, 6, INK);
  stroke(c, (k) => { k.moveTo(70, 88); k.lineTo(70, 20); }, 3.4, '#7a6a4a');
  blob(c, (k) => { k.moveTo(64, 22); k.quadraticCurveTo(64, 6, 72, 8); k.quadraticCurveTo(78, 10, 74, 16); k.quadraticCurveTo(70, 12, 69, 18); k.lineTo(70, 24); }, '#5fa9c0', '#3b7f98', 2, 1.2);
  // 袍子
  blob(c, (k) => { k.moveTo(24, 40); k.quadraticCurveTo(10, 70, 8, 90); k.lineTo(76, 90); k.quadraticCurveTo(74, 70, 60, 40); k.closePath(); }, MUD, MUD_SH, 2.6, 3.4);
  // 袍上浪纹
  for (const y of [62, 74, 84]) stroke(c, (k) => { k.moveTo(14, y); k.quadraticCurveTo(22, y - 6, 30, y); k.quadraticCurveTo(38, y + 6, 46, y); k.quadraticCurveTo(54, y - 6, 62, y); k.quadraticCurveTo(66, y, 70, y - 2); }, 1.6, '#5f8f9a');
  // 袖和手
  blob(c, (k) => { k.moveTo(60, 42); k.quadraticCurveTo(72, 48, 72, 60); k.lineTo(64, 60); k.quadraticCurveTo(60, 52, 54, 50); }, '#a49d8a', MUD_SH, 2.2, 1.4);
  blob(c, circle(69, 58, 4), '#cfd4c4', MUD_SH, 1.8, 1);
  // 肩上蓑衣的草
  for (let k = 0; k < 6; k++) stroke(c, (p) => { p.moveTo(26 + k * 6, 40); p.lineTo(24 + k * 6.4, 52 + (k % 2) * 3); }, 2, '#6f8a4a');
  // 头
  blob(c, circle(42, 28, 15), '#bfc4b0', MUD_SH, 2.4, 2.4);
  // 长须
  blob(c, (k) => { k.moveTo(30, 34); k.quadraticCurveTo(32, 54, 42, 58); k.quadraticCurveTo(52, 54, 54, 34); k.quadraticCurveTo(42, 44, 30, 34); }, '#e4e8de', '#aab0a0', 2, 1.6);
  // 眉眼
  stroke(c, (k) => { k.moveTo(32, 22); k.lineTo(39, 25); k.moveTo(52, 22); k.lineTo(45, 25); }, 2.6, '#6d725f');
  dab(c, ellipse(36, 27.4, 2.4, 2.2), '#6fe0e0');
  dab(c, ellipse(48, 27.4, 2.4, 2.2), '#6fe0e0');
  dab(c, circle(36, 27.6, 1), INK);
  dab(c, circle(48, 27.6, 1), INK);
  // 芦苇冠：几根苇秆加毛绒绒的苇穗
  for (const [x, l] of [[30, 16], [36, 20], [42, 22], [48, 20], [54, 16]] as const) {
    stroke(c, (k) => { k.moveTo(x, 18); k.lineTo(x + (x - 42) * 0.3, 18 - l); }, 2.6, INK);
    stroke(c, (k) => { k.moveTo(x, 18); k.lineTo(x + (x - 42) * 0.3, 18 - l); }, 1.2, '#9a8a54');
    blob(c, ellipse(x + (x - 42) * 0.3, 18 - l - 2, 2.2, 4.4), '#c9a36a', '#8f6f3a', 1.6, 0.8);
  }
}

const ICE = '#bfe6fa';
const ICE_SH = '#6fb0dc';
const ICE_L = '#eaf8ff';

/** 冰傀：一堆冰块垒出的矮胖傀儡，胸口冻着一团幽蓝的光，肩上长着冰晶 */
function icegolem(c: Ctx): void {
  dab(c, ellipse(26, 58, 20, 4), INK, 0.22);
  // 腿
  blob(c, poly(12, 44, 22, 44, 22, 58, 10, 58), ICE, ICE_SH, 2.2, 2);
  blob(c, poly(30, 44, 40, 44, 42, 58, 30, 58), ICE, ICE_SH, 2.2, 2);
  // 肩上冰晶
  blob(c, poly(6, 26, 10, 8, 18, 24), ICE_L, ICE_SH, 2, 1.4);
  blob(c, poly(46, 26, 42, 10, 34, 24), ICE_L, ICE_SH, 2, 1.4);
  blob(c, poly(14, 24, 20, 12, 24, 24), ICE_L, ICE_SH, 1.8, 1);
  // 手臂
  blob(c, poly(4, 30, 14, 28, 14, 46, 2, 48), ICE, ICE_SH, 2.2, 1.6);
  blob(c, poly(48, 30, 38, 28, 38, 46, 50, 48), ICE, ICE_SH, 2.2, 1.6);
  // 躯干：不规则冰块
  blob(c, poly(12, 24, 40, 24, 44, 44, 40, 48, 12, 48, 8, 44), ICE, ICE_SH, 2.6, 3);
  stroke(c, (k) => { k.moveTo(14, 36); k.lineTo(24, 30); k.lineTo(30, 40); k.lineTo(40, 32); }, 1.2, '#ffffff');
  // 胸口光团
  dab(c, circle(26, 38, 6), '#2f7be0', 0.5);
  dab(c, circle(26, 38, 3.4), '#9fd8ff');
  // 头
  blob(c, poly(15, 24, 18, 8, 34, 8, 37, 24), ICE_L, ICE_SH, 2.4, 2);
  dab(c, poly(19, 11, 24, 11, 21, 20), '#ffffff', 0.7);
  // 眼睛：两条发光的细缝
  dab(c, poly(19, 15, 25, 17, 25, 19, 19, 18), '#1f6fd8');
  dab(c, poly(33, 15, 27, 17, 27, 19, 33, 18), '#1f6fd8');
  dab(c, poly(20, 15.4, 24, 16.8, 24, 17.6, 20, 17), '#c8f0ff');
  dab(c, poly(32, 15.4, 28, 16.8, 28, 17.6, 32, 17), '#c8f0ff');
}

/** 冰凌：一根倒悬的巨冰锥，锥尖朝下悬在半空，上面睁着眼，周围飘几片碎冰 */
function icicle(c: Ctx): void {
  dab(c, ellipse(18, 56, 10, 3), INK, 0.2);
  // 碎冰
  blob(c, poly(3, 22, 7, 16, 10, 24, 6, 28), ICE_L, ICE_SH, 1.6, 1);
  blob(c, poly(29, 30, 33, 24, 35, 32, 31, 35), ICE_L, ICE_SH, 1.6, 1);
  // 冰锥
  blob(c, poly(8, 4, 28, 4, 24, 28, 18, 54, 12, 28), ICE, ICE_SH, 2.6, 3);
  blob(c, rrect(6, 2, 24, 6, 2), ICE_L, ICE_SH, 2, 1);
  dab(c, poly(13, 9, 16, 9, 15, 30, 14, 32), '#ffffff', 0.75);
  // 眼睛
  dab(c, ellipse(14, 17, 2.6, 3.4), '#1f6fd8');
  dab(c, ellipse(23, 17, 2.6, 3.4), '#1f6fd8');
  dab(c, circle(14.4, 16.4, 1), '#ffffff');
  dab(c, circle(23.4, 16.4, 1), '#ffffff');
  stroke(c, (k) => { k.moveTo(11, 12); k.lineTo(16, 14); k.moveTo(26, 12); k.lineTo(21, 14); }, 1.8, '#2a5a9a');
}

/** 冰魄（精英）：幽蓝的女子魂魄，宽袖长发飘着，头戴雪花冠，下半身化作一缕寒雾 */
function frostsoul(c: Ctx): void {
  dab(c, ellipse(39, 88, 26, 4), INK, 0.18);
  // 寒雾尾
  blob(c, (k) => { k.moveTo(20, 56); k.quadraticCurveTo(10, 76, 20, 88); k.quadraticCurveTo(30, 82, 38, 90); k.quadraticCurveTo(48, 82, 58, 88); k.quadraticCurveTo(68, 76, 58, 56); k.closePath(); }, '#dff3ff', '#9ccbe8', 2.4, 3);
  for (const [x, y] of [[26, 78], [39, 82], [52, 78]] as const) dab(c, ellipse(x, y, 4, 2), '#ffffff', 0.8);
  // 袖
  blob(c, (k) => { k.moveTo(22, 40); k.quadraticCurveTo(2, 46, 4, 66); k.quadraticCurveTo(14, 62, 22, 56); }, '#cfe8f8', '#8fbfe0', 2.2, 1.6);
  blob(c, (k) => { k.moveTo(56, 40); k.quadraticCurveTo(76, 46, 74, 66); k.quadraticCurveTo(64, 62, 56, 56); }, '#cfe8f8', '#8fbfe0', 2.2, 1.6);
  // 身
  blob(c, (k) => { k.moveTo(24, 38); k.quadraticCurveTo(20, 56, 22, 66); k.lineTo(56, 66); k.quadraticCurveTo(58, 56, 54, 38); k.closePath(); }, '#eaf8ff', '#a9d2ee', 2.4, 2.6);
  stroke(c, (k) => { k.moveTo(39, 40); k.lineTo(39, 64); }, 1.4, '#8fbfe0');
  blob(c, circle(39, 46, 3.4), '#7fd0ff', '#2f7be0', 1.6, 1);
  // 长发（深蓝）
  blob(c, (k) => { k.moveTo(24, 22); k.quadraticCurveTo(14, 44, 20, 70); k.lineTo(26, 46); k.lineTo(52, 46); k.lineTo(58, 70); k.quadraticCurveTo(64, 44, 54, 22); k.closePath(); }, '#35508a', '#223660', 2.2, 2);
  // 脸
  blob(c, circle(39, 28, 12), '#f4fbff', '#bcd9ee', 2.2, 2);
  dab(c, ellipse(34, 29, 2, 3), '#6a3fb0');
  dab(c, ellipse(44, 29, 2, 3), '#6a3fb0');
  dab(c, circle(34.4, 28.4, 0.8), '#ffffff');
  dab(c, circle(44.4, 28.4, 0.8), '#ffffff');
  stroke(c, (k) => { k.moveTo(36, 36); k.quadraticCurveTo(39, 38, 42, 36); }, 1.4, '#6a3fb0');
  // 雪花冠
  blob(c, poly(39, 4, 41, 10, 47, 8, 43, 13, 49, 17, 41, 16, 39, 22, 37, 16, 29, 17, 35, 13, 31, 8, 37, 10), '#ffffff', '#8fbfe0', 1.8, 1);
  dab(c, circle(39, 13, 1.6), '#7fd0ff');
}

/** 更夫鬼：靛蓝棉袍、斗笠压脸的老更夫，一手提着昏黄的灯笼，一手举着梆子；脚不沾地 */
function nightwatch(c: Ctx): void {
  c.translate(6, 0); // 梆子举在身子左边，留出位置
  dab(c, ellipse(22, 56, 14, 3), INK, 0.2);
  // 灯笼光晕
  dab(c, circle(38, 36, 14), '#ffb33c', 0.28);
  // 袍子（下摆化成烟）
  blob(c, (k) => { k.moveTo(10, 24); k.quadraticCurveTo(4, 44, 6, 54); k.lineTo(12, 50); k.lineTo(16, 56); k.lineTo(22, 50); k.lineTo(28, 56); k.lineTo(32, 50); k.quadraticCurveTo(36, 40, 32, 24); k.closePath(); }, '#46598c', '#2c3a64', 2.4, 3);
  stroke(c, (k) => { k.moveTo(21, 26); k.lineTo(21, 48); }, 1.2, '#2c3a64');
  // 腰带
  blob(c, rrect(9, 36, 24, 4, 1.6), '#d6a23a', '#a07a22', 1.6, 1);
  // 提灯笼的手和灯笼
  stroke(c, (k) => { k.moveTo(30, 28); k.lineTo(38, 30); }, 4, INK);
  stroke(c, (k) => { k.moveTo(30, 28); k.lineTo(38, 30); }, 2, '#c9d4e8');
  stroke(c, (k) => { k.moveTo(38, 30); k.lineTo(38, 34); }, 1.6);
  blob(c, ellipse(38, 40, 6, 7), '#f08a2a', '#c3601a', 2, 1.4);
  dab(c, ellipse(38, 40, 3, 4.6), '#ffe38a');
  blob(c, rrect(34, 32, 8, 3, 1), '#3a2a1c', null, 1.4);
  // 举梆子的手：竹梆 + 槌
  stroke(c, (k) => { k.moveTo(10, 28); k.lineTo(3, 20); }, 4, INK);
  stroke(c, (k) => { k.moveTo(10, 28); k.lineTo(3, 20); }, 2, '#c9d4e8');
  blob(c, rrect(-2, 8, 8, 14, 3), '#c9a04a', '#8f6f2a', 1.8, 1);
  stroke(c, (k) => { k.moveTo(2, 12); k.lineTo(2, 18); }, 1, '#6b4f1a');
  // 头：苍白的脸，斗笠
  blob(c, circle(21, 20, 8), '#d9dee8', '#9aa3b8', 2, 1.6);
  dab(c, poly(16, 22, 18, 21, 18, 23), INK);
  dab(c, poly(26, 22, 24, 21, 24, 23), INK);
  dab(c, circle(17.4, 22.6, 1), '#ff6a3c');
  dab(c, circle(24.6, 22.6, 1), '#ff6a3c');
  blob(c, (k) => { k.moveTo(5, 18); k.quadraticCurveTo(21, 0, 37, 18); k.quadraticCurveTo(21, 13, 5, 18); }, '#b59a5a', '#7c6a38', 2.2, 1.6);
  stroke(c, (k) => { k.moveTo(12, 13); k.lineTo(10, 17); k.moveTo(21, 9.6); k.lineTo(21, 14.6); k.moveTo(30, 13); k.lineTo(32, 17); }, 1.2, '#7c6a38');
}

/** 石僧：灰石雕成的和尚，光头上点着戒疤，双手合十，袈裟上爬着青苔；坐在一块石座上 */
function stonemonk(c: Ctx): void {
  const st = '#b4b8bf';
  const sts = '#7c818c';
  dab(c, ellipse(26, 64, 20, 3.4), INK, 0.24);
  // 石座
  blob(c, rrect(6, 54, 40, 11, 3), '#9a9ea8', '#6a6e78', 2.2, 1.8);
  dab(c, ellipse(26, 55.4, 16, 1.6), '#e6e9ee');
  // 身体：宽肩的袈裟
  blob(c, (k) => { k.moveTo(12, 26); k.quadraticCurveTo(4, 44, 8, 56); k.lineTo(44, 56); k.quadraticCurveTo(48, 44, 40, 26); k.quadraticCurveTo(26, 22, 12, 26); }, st, sts, 2.6, 3.2);
  // 袈裟衣褶（斜披）
  stroke(c, (k) => { k.moveTo(14, 28); k.quadraticCurveTo(26, 44, 42, 36); }, 1.6, sts);
  stroke(c, (k) => { k.moveTo(10, 40); k.quadraticCurveTo(24, 52, 44, 46); }, 1.4, sts);
  // 青苔
  dab(c, ellipse(12, 50, 5, 2.4, 0.2), '#6f9a52', 0.85);
  dab(c, ellipse(40, 33, 4, 2, -0.3), '#6f9a52', 0.85);
  dab(c, ellipse(30, 54, 3, 1.4), '#6f9a52', 0.85);
  // 合十的手
  blob(c, (k) => { k.moveTo(20, 40); k.lineTo(26, 31); k.lineTo(32, 40); k.quadraticCurveTo(26, 46, 20, 40); }, '#cfd3da', sts, 2, 1.2);
  stroke(c, (k) => { k.moveTo(26, 33); k.lineTo(26, 42); }, 1, sts);
  // 念珠
  for (let k = 0; k < 7; k++) dab(c, circle(14 + k * 4.4, 29 + Math.abs(3 - k) * -0.2 + (k % 2) * 0.6 + 7 * (1 - Math.abs(3 - k) / 3.6) * 0.5, 1.7), '#5a3a22');
  // 头
  blob(c, circle(26, 16, 12), '#cfd3da', sts, 2.4, 2.2);
  // 戒疤
  for (const [x, y] of [[22, 7.4], [26, 6.4], [30, 7.4], [21, 11], [31, 11]] as const) dab(c, circle(x, y, 1), '#6a6e78');
  // 眼睛：闭目垂眉，眉心一点朱砂；裂开一道缝
  stroke(c, (k) => { k.moveTo(19, 17); k.quadraticCurveTo(22, 19.6, 25, 17); k.moveTo(27, 17); k.quadraticCurveTo(30, 19.6, 33, 17); }, 2);
  dab(c, circle(26, 12.6, 1.2), '#d6342c');
  stroke(c, (k) => { k.moveTo(34, 8); k.lineTo(31, 13); k.lineTo(33, 17); }, 1.2, sts);
  stroke(c, (k) => { k.moveTo(23, 24); k.quadraticCurveTo(26, 25.6, 29, 24); }, 1.5);
}

export const SPRITES12: SpriteDef[] = [
  { key: 'bamsprout', w: 44, h: 58, ox: 0.5, oy: 0.95, draw: bamsprout },
  { key: 'snakespirit', w: 62, h: 44, ox: 0.5, oy: 0.9, draw: snakespirit },
  { key: 'bambooking', w: 84, h: 100, ox: 0.5, oy: 0.95, draw: bambooking },
  { key: 'drown', w: 46, h: 54, ox: 0.5, oy: 0.92, draw: drown },
  { key: 'crab', w: 52, h: 40, ox: 0.5, oy: 0.92, draw: crab },
  { key: 'hebo', w: 84, h: 98, ox: 0.5, oy: 0.95, draw: hebo },
  { key: 'icegolem', w: 52, h: 62, ox: 0.5, oy: 0.95, draw: icegolem },
  { key: 'icicle', w: 36, h: 60, ox: 0.5, oy: 0.95, draw: icicle },
  { key: 'frostsoul', w: 78, h: 92, ox: 0.5, oy: 0.95, draw: frostsoul },
  { key: 'nightwatch', w: 54, h: 62, ox: 0.5, oy: 0.92, draw: nightwatch },
  { key: 'stonemonk', w: 52, h: 68, ox: 0.5, oy: 0.95, draw: stonemonk },
];
