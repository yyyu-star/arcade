/**
 * 第三批精灵：法器图标（八卦镜、火葫芦、缚妖索、桃花雨、金钟罩、纸鹤）和对应的场景图（飞鹤、八卦盘、金钟罩、火苗）。
 * 画法和前两批一致（大头 Q 版、墨色粗描边、平涂 + 右下一层阴影、高光用 dab）；图标 32×32，和 i_sword 同尺寸。
 */
import { INK, blob, circle, dab, ellipse, poly, rrect, stroke, type Ctx } from './draw.ts';
import type { SpriteDef } from './sprites.ts';

/** 八卦镜：圆铜镜，外圈八段卦纹，中间亮蓝镜面 */
function iconMirror(c: Ctx): void {
  blob(c, rrect(13.8, 24, 4.4, 6.5, 1.6), '#a86a33', null, 1.5);
  blob(c, circle(16, 15, 13), '#e2a63c', '#b57d22', 2, 2);
  // 外圈八个卦位：八段短粗线
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + Math.PI / 8;
    stroke(c, (k) => { k.moveTo(16 + Math.cos(a) * 10.2, 15 + Math.sin(a) * 10.2); k.lineTo(16 + Math.cos(a) * 12, 15 + Math.sin(a) * 12); }, 2.6, '#7a4a20');
  }
  blob(c, circle(16, 15, 8.2), '#7fd0ff', '#3f98e0', 1.6, 1.8);
  dab(c, ellipse(12.6, 11.6, 2.6, 1.4, -0.7), '#ffffff', 0.95);
  dab(c, circle(19.5, 18.5, 0.9), '#ffffff', 0.8);
}

/** 火葫芦：红葫芦两节，口上冒火 */
function iconGourd(c: Ctx): void {
  // 火
  blob(c, (k) => { k.moveTo(11, 8); k.quadraticCurveTo(8, 3, 14, 0.5); k.quadraticCurveTo(14, 4, 17, 4); k.quadraticCurveTo(18, 1.5, 21, 1); k.quadraticCurveTo(24, 6, 21, 8); }, '#ff8a2a', '#e5481f', 1.6, 1.2);
  dab(c, (k) => { k.moveTo(14, 8); k.quadraticCurveTo(13, 5.5, 16, 4.5); k.quadraticCurveTo(19, 6, 18, 8); }, '#ffe14a');
  // 葫芦身
  blob(c, ellipse(16, 24, 9.4, 7.6), '#e0402e', '#a82418', 1.9, 2);
  blob(c, ellipse(16, 13, 6.2, 5.2), '#e0402e', '#a82418', 1.9, 1.6);
  // 口
  blob(c, rrect(12.6, 6.6, 6.8, 3, 1.3), '#7a4a20', null, 1.5);
  // 腰上的金绳
  blob(c, rrect(10.2, 17.2, 11.6, 2.6, 1.2), '#f2c94c', null, 1.4);
  dab(c, ellipse(11.5, 11.6, 1.4, 2.2, 0.4), '#ffb3a0', 0.95);
  dab(c, ellipse(10.8, 22.5, 1.8, 3, 0.4), '#ffb3a0', 0.95);
}

/** 缚妖索：一卷金绳，挂着小铃和红符 */
function iconRope(c: Ctx): void {
  // 绳圈：同心椭圆几圈
  blob(c, ellipse(15, 14, 11.5, 9.5), '#f0c23c', '#c28f1e', 2, 2.2);
  stroke(c, (k) => k.ellipse(15, 14, 8, 6, 0, 0, Math.PI * 2), 1.5, '#a87818');
  blob(c, ellipse(15, 14, 4.4, 3.2, 0), '#eaf4ff', null, 1.5);
  dab(c, ellipse(9, 9, 2.4, 1.2, -0.6), '#fff1a6');
  // 垂下的绳头
  stroke(c, (k) => { k.moveTo(22, 21); k.quadraticCurveTo(25, 25, 22, 27); }, 3.6);
  stroke(c, (k) => { k.moveTo(22, 21); k.quadraticCurveTo(25, 25, 22, 27); }, 1.8, '#f0c23c');
  // 红符
  blob(c, rrect(6, 20, 7, 10, 1), '#d0362e', '#a02420', 1.5, 1.2);
  dab(c, rrect(8.4, 22, 2.2, 5.5, 0.6), '#ffe14a');
  // 小铃
  blob(c, circle(23.5, 28, 3), '#f2c94c', '#c28f1e', 1.5, 1);
  dab(c, circle(23.5, 29.6, 0.9), INK);
}

function petal(c: Ctx, x: number, y: number, rot: number, s: number): void {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.scale(s, s);
  blob(c, (k) => { k.moveTo(0, 6); k.quadraticCurveTo(-7.5, 1, -4.5, -5); k.quadraticCurveTo(-1.5, -7.5, 0, -4.2); k.quadraticCurveTo(1.5, -7.5, 4.5, -5); k.quadraticCurveTo(7.5, 1, 0, 6); }, '#ff8fb8', '#e0558a', 1.7 / s, 1.4);
  dab(c, ellipse(-1.8, -0.6, 1.1, 2.1, 0.3), '#ffd2e3');
  c.restore();
}
/** 桃花雨：几片粉瓣散落 */
function iconPetal(c: Ctx): void {
  petal(c, 10, 21, -0.6, 1.15);
  petal(c, 22, 20, 0.7, 1.05);
  petal(c, 15, 9, 0.1, 1.2);
  dab(c, circle(26, 8, 1.4), '#ff8fb8');
  dab(c, circle(5, 10, 1.2), '#ff8fb8');
  dab(c, circle(26, 29, 1.1), '#ff8fb8');
}

/** 金钟罩：矮胖的寺庙梵钟（横箍 + 乳钉），外面罩一圈半透明金光，和手铃区分 */
function iconShield(c: Ctx): void {
  // 护罩光圈：半透明浅金填充 + 金色圈
  dab(c, circle(16, 16, 15), '#ffe27a', 0.3);
  c.save();
  c.beginPath();
  c.arc(16, 16, 14.2, 0, Math.PI * 2);
  c.lineWidth = 1.8;
  c.strokeStyle = '#f2b81c';
  c.stroke();
  c.lineWidth = 0.7;
  c.strokeStyle = INK;
  c.beginPath();
  c.arc(16, 16, 15.1, 0, Math.PI * 2);
  c.stroke();
  c.restore();
  // 钮和钟身：宽而矮，肩平
  blob(c, rrect(12.5, 5.6, 7, 3.4, 1.5), '#a86a33', null, 1.5);
  blob(c, (k) => { k.moveTo(6, 25); k.quadraticCurveTo(5.5, 9.5, 16, 9); k.quadraticCurveTo(26.5, 9.5, 26, 25); }, '#f2c23c', '#c28f1e', 1.9, 2.4);
  blob(c, rrect(4.5, 23.4, 23, 3.6, 1.6), '#e0a728', '#b57d22', 1.7, 1);
  // 横箍
  stroke(c, (k) => { k.moveTo(6.4, 14); k.lineTo(25.6, 14); }, 1.4, '#a87818');
  stroke(c, (k) => { k.moveTo(6, 19); k.lineTo(26, 19); }, 1.4, '#a87818');
  // 乳钉
  for (const x of [10.5, 16, 21.5]) dab(c, circle(x, 16.5, 1.1), '#fff1a6');
  dab(c, ellipse(9.8, 12, 1.2, 2, 0.3), '#fff6c8');
}

/** 纸鹤图标：白纸折的鹤，侧面朝右，红点眼 */
function drawCrane(c: Ctx, line: number): void {
  const W = '#ffffff';
  const G = '#cfd6e6';
  // 远侧翅膀（灰一点）
  blob(c, poly(-2, -2, -9, -16, 6, -4), '#dde2ee', null, line);
  // 尾巴上翘
  blob(c, poly(-6, 0, -17, -9, -14, 3, -4, 6), W, G, line, 1.4);
  // 长脖子 + 尖头（红点眼）
  blob(c, poly(5, -2, 9, -14, 12.5, -13, 12, -2), W, G, line, 1.2);
  blob(c, poly(9, -14, 19, -11, 12.4, -9.5), W, null, line);
  // 三角身体，又大又厚
  blob(c, poly(-9, 0, 2, -8, 13, 0, 1, 11), W, G, line, 2.8);
  // 近侧翅膀，饱满的大三角
  blob(c, poly(-8, -1, -3, -20, 11, -1), W, G, line, 2.4);
  stroke(c, (k) => { k.moveTo(-2, -2); k.lineTo(-2, -15); }, 1, '#aab6d0');
  dab(c, circle(11.2, -11.4, 1.2), '#d0362e');
}
function iconCrane(c: Ctx): void {
  c.translate(14, 22);
  c.scale(0.95, 0.95);
  drawCrane(c, 1.5);
}

/** 场景里的飞鹤：比图标线细一点，约 30×24 */
function crane(c: Ctx): void {
  c.translate(13, 17);
  c.scale(0.72, 0.72);
  drawCrane(c, 1.8);
}

/** 八卦盘：俯视的圆盘，外圈八组卦线，中间太极，蓝白色调 */
function bagua(c: Ctx): void {
  const cx = 22;
  const cy = 22;
  blob(c, circle(cx, cy, 20), '#eaf4ff', '#b9d6f2', 2.2, 2.4);
  blob(c, circle(cx, cy, 9.4), '#ffffff', null, 1.5);
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    c.save();
    c.translate(cx, cy);
    c.rotate(a + Math.PI / 2);
    // 每个卦位三道横线，i 的二进制决定实线还是断线
    for (let j = 0; j < 3; j++) {
      const y = -17.2 + j * 2.6;
      const yang = ((i >> j) & 1) === 1;
      if (yang) stroke(c, (k) => { k.moveTo(-4, y); k.lineTo(4, y); }, 1.6, '#2b5fa8');
      else {
        stroke(c, (k) => { k.moveTo(-4, y); k.lineTo(-0.9, y); }, 1.6, '#2b5fa8');
        stroke(c, (k) => { k.moveTo(0.9, y); k.lineTo(4, y); }, 1.6, '#2b5fa8');
      }
    }
    c.restore();
  }
  // 太极
  dab(c, (k) => { k.arc(cx, cy, 6.2, -Math.PI / 2, Math.PI / 2); k.arc(cx, cy + 3.1, 3.1, Math.PI / 2, -Math.PI / 2, true); k.arc(cx, cy - 3.1, 3.1, Math.PI / 2, -Math.PI / 2, false); }, '#2b5fa8');
  stroke(c, (k) => k.arc(cx, cy, 6.2, 0, Math.PI * 2), 1.4);
  dab(c, circle(cx, cy - 3.1, 1), '#2b5fa8');
  dab(c, circle(cx, cy + 3.1, 1), '#ffffff');
}

/** 金钟罩（场景用）：浅金半透明大钟，金色边加深色细边；透明度由画面层再调 */
function goldbell(c: Ctx): void {
  const body = (k: Ctx): void => {
    k.moveTo(6, 74);
    k.quadraticCurveTo(8, 12, 40, 10);
    k.quadraticCurveTo(72, 12, 74, 74);
    k.quadraticCurveTo(40, 80, 6, 74);
  };
  c.save();
  c.globalAlpha = 0.35;
  c.beginPath();
  body(c);
  c.fillStyle = '#ffe9a0';
  c.fill();
  c.restore();
  // 右下一层浅阴影
  c.save();
  c.beginPath();
  body(c);
  c.clip();
  c.globalAlpha = 0.25;
  c.fillStyle = '#e0a728';
  c.beginPath();
  c.ellipse(52, 58, 30, 30, 0, 0, Math.PI * 2);
  c.fill();
  c.restore();
  // 深色细边在外，金色粗边在里
  stroke(c, body, 4, INK);
  stroke(c, body, 2.4, '#f2c23c');
  // 钮
  blob(c, rrect(34, 2, 12, 8, 3), '#f2c23c', null, 1.8);
  // 箍线和高光
  stroke(c, (k) => { k.moveTo(11, 40); k.quadraticCurveTo(40, 46, 69, 40); }, 1.8, '#f2c23c');
  dab(c, ellipse(22, 34, 3.2, 12, 0.3), '#ffffff', 0.55);
  stroke(c, (k) => { k.moveTo(6, 74); k.quadraticCurveTo(40, 80, 74, 74); }, 3, '#f2c23c');
}

/** 火苗粒子：橙黄，深红描边 */
function flame(c: Ctx): void {
  const line = '#8f1d14';
  const out = (k: Ctx): void => {
    k.moveTo(9, 21);
    k.quadraticCurveTo(1.5, 20, 2.5, 12.5);
    k.quadraticCurveTo(3.5, 8, 7, 5);
    k.quadraticCurveTo(7, 9, 9.5, 10);
    k.quadraticCurveTo(9, 4, 12, 1);
    k.quadraticCurveTo(17.5, 7, 16, 14);
    k.quadraticCurveTo(15.5, 20, 9, 21);
  };
  c.save();
  c.beginPath();
  out(c);
  c.fillStyle = '#ff7a21';
  c.fill();
  c.lineWidth = 1.7;
  c.lineJoin = 'round';
  c.strokeStyle = line;
  c.stroke();
  c.restore();
  dab(c, (k) => { k.moveTo(9, 20); k.quadraticCurveTo(4.5, 19, 5.5, 14); k.quadraticCurveTo(7.5, 11, 9, 11.5); k.quadraticCurveTo(13.5, 13, 13, 17); k.quadraticCurveTo(12, 20, 9, 20); }, '#ffd84a');
  dab(c, ellipse(9.2, 16.5, 2, 2.6), '#fff6b0');
}

export const SPRITES3: SpriteDef[] = [
  { key: 'i_mirror', w: 32, h: 32, ox: 0.5, oy: 0.5, draw: iconMirror },
  { key: 'i_gourd', w: 32, h: 32, ox: 0.5, oy: 0.5, draw: iconGourd },
  { key: 'i_rope', w: 32, h: 32, ox: 0.5, oy: 0.5, draw: iconRope },
  { key: 'i_petal', w: 32, h: 32, ox: 0.5, oy: 0.5, draw: iconPetal },
  { key: 'i_shield', w: 32, h: 32, ox: 0.5, oy: 0.5, draw: iconShield },
  { key: 'i_crane', w: 32, h: 32, ox: 0.5, oy: 0.5, draw: iconCrane },
  { key: 'crane', w: 30, h: 24, ox: 0.5, oy: 0.5, draw: crane },
  { key: 'bagua', w: 44, h: 44, ox: 0.5, oy: 0.5, draw: bagua },
  { key: 'goldbell', w: 80, h: 84, ox: 0.5, oy: 0.55, draw: goldbell },
  { key: 'flame', w: 18, h: 22, ox: 0.5, oy: 0.6, draw: flame },
];
