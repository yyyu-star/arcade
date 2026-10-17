/**
 * 角色、怪、法器、特效的画法。每个精灵给出尺寸（世界单位）、锚点（脚底或中心）和一个画法函数，
 * atlas.ts 把它们按渲染倍数画进一张图集。造型都是原创的：大头 Q 版、粗黑描边、平涂加一层阴影（DESIGN.md 第 7.1 节）。
 */
import { INK, artRng, blob, circle, dab, ellipse, poly, rrect, stroke, type Ctx } from './draw.ts';

export interface SpriteDef {
  key: string;
  /** 尺寸（世界单位） */
  w: number;
  h: number;
  /** 锚点（0–1）：站着的东西在脚底，特效在中心 */
  ox: number;
  oy: number;
  /** 这一张额外放大（大怪、精英画得更细） */
  scale?: number;
  draw: (c: Ctx) => void;
}

/** 怪的主色：一种怪一个颜色（DESIGN.md 3.4），死亡碎片也按它着色 */
export const MOB_COLOR = {
  paper: 0xf4f1ea,
  wisp: 0x5fd3f0,
  jiangshi: 0x4f7a76,
  lantern: 0xe8582f,
  fox: 0xe58a3a,
} as const;

const SKIN = '#f7dcc3';
const SKIN_SH = '#e6b999';

function hero(c: Ctx): void {
  // 脚
  blob(c, ellipse(23, 64, 5.5, 3.2), '#2a2530', null, 2);
  blob(c, ellipse(37, 64, 5.5, 3.2), '#2a2530', null, 2);
  // 道袍
  const robe = (k: Ctx): void => {
    k.moveTo(18, 37);
    k.quadraticCurveTo(15, 52, 12, 62);
    k.quadraticCurveTo(30, 67, 48, 62);
    k.quadraticCurveTo(45, 52, 42, 37);
  };
  blob(c, robe, '#3f62a0', '#2b4678');
  // 下摆的黄边
  blob(
    c,
    (k) => {
      k.moveTo(13.2, 58.5);
      k.quadraticCurveTo(30, 63, 46.8, 58.5);
      k.lineTo(48, 62);
      k.quadraticCurveTo(30, 67, 12, 62);
    },
    '#f2c94c',
    null,
    1.6,
  );
  // 腰带和太极
  blob(c, rrect(18.5, 46, 23, 4, 1.5), '#c8402f', null, 1.6);
  blob(c, circle(30, 55, 3.6), '#f6f2e8', null, 1.4);
  dab(c, (k) => {
    k.arc(30, 55, 3.6, -Math.PI / 2, Math.PI / 2);
    k.arc(30, 56.8, 1.8, Math.PI / 2, -Math.PI / 2, false);
    k.arc(30, 53.2, 1.8, Math.PI / 2, -Math.PI / 2, true);
  }, INK);
  // 白领子
  blob(c, poly(23.5, 37, 30, 46, 36.5, 37, 33.5, 37, 30, 42, 26.5, 37), '#f3efe6', null, 1.6);
  // 袖子和手
  blob(c, ellipse(15.5, 46, 5.5, 8, 0.35), '#3f62a0', '#2b4678');
  blob(c, ellipse(44.5, 46, 5.5, 8, -0.35), '#3f62a0', '#2b4678');
  blob(c, circle(13.5, 53, 3.4), SKIN, null, 1.8);
  // 桃木剑（握在右手）
  c.save();
  c.translate(48, 53);
  c.rotate(0.42);
  blob(c, poly(-2.2, 0, -2.2, -26, 0, -30, 2.2, -26, 2.2, 0), '#c98a4b', '#a86a33', 1.8, 1.2);
  stroke(c, (k) => { k.moveTo(0, -4); k.lineTo(0, -25); }, 0.8, '#7a4a20');
  blob(c, rrect(-5, -1, 10, 3, 1.2), '#7a4a20', null, 1.6);
  stroke(c, (k) => { k.moveTo(0, 2); k.quadraticCurveTo(-3, 7, -1, 11); }, 1.8, '#d0362e');
  c.restore();
  blob(c, circle(46.5, 53, 3.4), SKIN, null, 1.8);
  // 头
  blob(c, circle(30, 22, 17), SKIN, SKIN_SH, 2.6, 3);
  // 头发：齐刘海的发顶 + 发髻 + 木簪
  const hair = (k: Ctx): void => {
    k.moveTo(12.6, 24);
    k.quadraticCurveTo(11, 5, 30, 4.5);
    k.quadraticCurveTo(49, 5, 47.4, 24);
    k.quadraticCurveTo(45, 16, 40, 14.5);
    k.quadraticCurveTo(36, 18.5, 31, 15);
    k.quadraticCurveTo(26, 18.5, 21, 15);
    k.quadraticCurveTo(15, 16, 12.6, 24);
  };
  blob(c, hair, '#2a2632', '#17141d', 2.6, 2);
  blob(c, circle(30, 4.5, 6), '#2a2632', null, 2.4);
  stroke(c, (k) => { k.moveTo(21, 2); k.lineTo(39, 7); }, 2.2, '#8a5a2b');
  dab(c, ellipse(22, 9, 4.5, 1.6, -0.5), '#ffffff', 0.35);
  // 眼睛、腮红、嘴
  blob(c, ellipse(23.5, 25, 2.7, 3.6), INK, null, 0);
  blob(c, ellipse(36.5, 25, 2.7, 3.6), INK, null, 0);
  dab(c, circle(24.4, 23.6, 1.1), '#ffffff');
  dab(c, circle(37.4, 23.6, 1.1), '#ffffff');
  dab(c, ellipse(19.5, 30.5, 3.2, 1.7), '#f08c8c', 0.75);
  dab(c, ellipse(40.5, 30.5, 3.2, 1.7), '#f08c8c', 0.75);
  stroke(c, (k) => { k.moveTo(28, 31.5); k.quadraticCurveTo(30, 33.5, 32, 31.5); }, 1.4);
  // 眉毛：有点倔
  stroke(c, (k) => { k.moveTo(20.5, 19.6); k.lineTo(25.5, 20.6); }, 1.6);
  stroke(c, (k) => { k.moveTo(39.5, 19.6); k.lineTo(34.5, 20.6); }, 1.6);
}

function jiangshi(c: Ctx): void {
  const robe = '#4f7a76';
  const robeSh = '#385a57';
  blob(c, ellipse(19, 63, 5, 3), '#1d1b22', null, 2);
  blob(c, ellipse(33, 63, 5, 3), '#1d1b22', null, 2);
  // 官服
  blob(c, poly(14, 34, 38, 34, 42, 62, 10, 62), robe, robeSh);
  blob(c, poly(10.9, 58, 41.1, 58, 42, 62, 10, 62), '#2d3d40', null, 1.6);
  // 补子
  blob(c, rrect(19.5, 41, 13, 11, 1.5), '#d9b25a', '#b8903e', 1.6, 1.2);
  stroke(c, (k) => { k.arc(26, 46.5, 3, 0, Math.PI * 1.6); }, 1.2, '#8a3a2a');
  // 两只袖子直直往前伸
  blob(c, rrect(28, 35.5, 22, 6.5, 3), robe, robeSh, 2.2, 1.4);
  blob(c, rrect(28, 43, 22, 6.5, 3), robe, robeSh, 2.2, 1.4);
  blob(c, poly(49.5, 36, 54, 37, 54, 41, 49.5, 41.5), '#c9dcc4', null, 1.8);
  blob(c, poly(49.5, 43.5, 54, 44.5, 54, 48.5, 49.5, 49), '#c9dcc4', null, 1.8);
  // 脸
  blob(c, rrect(13.5, 13, 25, 23, 8), '#c9dcc4', '#a5bfa0', 2.4, 2.4);
  dab(c, ellipse(19.5, 24.5, 3.4, 2.6), '#7f9a7c');
  dab(c, ellipse(32.5, 24.5, 3.4, 2.6), '#7f9a7c');
  dab(c, circle(19.8, 24.8, 1.2), '#d0362e');
  dab(c, circle(32.8, 24.8, 1.2), '#d0362e');
  // 帽子
  blob(c, (k) => { k.arc(26, 14, 11, Math.PI, 0); }, '#25272e', '#15161b', 2.4, 1.6);
  blob(c, ellipse(26, 14.5, 16, 4.2), '#25272e', null, 2.4);
  blob(c, circle(26, 2.8, 3), '#d0362e', null, 1.8);
  // 黄符贴在脑门上
  c.save();
  c.translate(26, 14);
  c.rotate(0.08);
  blob(c, rrect(-3.6, 0, 7.2, 21, 0.8), '#f2d14a', '#d8b232', 1.6, 1);
  stroke(c, (k) => {
    k.moveTo(-1.5, 3);
    k.lineTo(1.5, 5);
    k.lineTo(-1.5, 8);
    k.lineTo(1.5, 11);
    k.moveTo(0, 12);
    k.lineTo(0, 18);
    k.moveTo(-2, 15);
    k.lineTo(2, 15);
  }, 1, '#c0392b');
  c.restore();
}

function paper(c: Ctx): void {
  // 纸人：身体是一张剪纸，下摆锯齿
  blob(c, poly(12, 26, 28, 26, 33, 46, 30, 49, 27, 46, 24, 49, 21, 46, 18, 49, 15, 46, 12, 49, 9, 46, 7, 46), '#f4f1ea', '#d9d2c3');
  blob(c, poly(10.4, 34, 29.6, 34, 30.3, 37, 9.7, 37), '#d4433e', null, 1.2);
  dab(c, poly(20, 39, 23, 42, 20, 45, 17, 42), '#d4433e');
  // 胳膊：两条纸片
  blob(c, poly(12, 28, 3, 36, 5, 38, 13, 32), '#f4f1ea', null, 1.8);
  blob(c, poly(28, 28, 37, 36, 35, 38, 27, 32), '#f4f1ea', null, 1.8);
  // 头
  blob(c, circle(20, 16, 11), '#fbf9f4', '#e2dccf', 2.2, 2);
  blob(c, (k) => {
    k.moveTo(9.2, 15);
    k.quadraticCurveTo(9.5, 4.8, 20, 4.8);
    k.quadraticCurveTo(30.5, 4.8, 30.8, 15);
    k.lineTo(26, 12);
    k.lineTo(14, 12);
  }, '#24212b', null, 2.2);
  dab(c, circle(14.5, 19.5, 2.6), '#e0464b');
  dab(c, circle(25.5, 19.5, 2.6), '#e0464b');
  dab(c, circle(16.5, 16, 1.3), INK);
  dab(c, circle(23.5, 16, 1.3), INK);
  dab(c, ellipse(20, 22.5, 1.6, 1), '#c0392b');
}

function wisp(c: Ctx): void {
  const flame = (k: Ctx): void => {
    k.moveTo(17, 2);
    k.quadraticCurveTo(22, 10, 29, 18);
    k.quadraticCurveTo(33, 30, 24, 36);
    k.quadraticCurveTo(17, 39, 10, 36);
    k.quadraticCurveTo(1, 30, 5, 18);
    k.quadraticCurveTo(9, 13, 11, 8);
    k.quadraticCurveTo(14, 12, 17, 2);
  };
  blob(c, flame, '#6fd8f2', '#2f95c6', 2, 2.4);
  dab(c, ellipse(17, 26, 7.5, 8), '#d4f7ff', 0.85);
  dab(c, ellipse(13.5, 25, 2, 3), INK);
  dab(c, ellipse(20.5, 25, 2, 3), INK);
  dab(c, circle(14.1, 24, 0.8), '#ffffff');
  dab(c, circle(21.1, 24, 0.8), '#ffffff');
}

function lantern(c: Ctx): void {
  stroke(c, (k) => { k.moveTo(22, 0); k.lineTo(22, 7); }, 1.6);
  blob(c, rrect(14, 5, 16, 6, 2), '#2a2530', null, 2);
  blob(c, ellipse(22, 28, 17, 16), '#ea5d33', '#b63f22', 2.4, 3);
  for (const dx of [-9, 0, 9]) stroke(c, (k) => { k.moveTo(22 + dx * 0.6, 13); k.quadraticCurveTo(22 + dx * 1.25, 28, 22 + dx * 0.6, 43); }, 1, '#9e3018');
  blob(c, rrect(15, 42, 14, 5, 2), '#2a2530', null, 2);
  for (const x of [18, 22, 26]) stroke(c, (k) => { k.moveTo(x, 47); k.lineTo(x, 54); }, 1.4, '#d0362e');
  // 脸：一大一小两只眼、吐长舌头
  blob(c, circle(16.5, 25, 4.4), '#fff4d6', null, 1.8);
  blob(c, circle(28, 24, 3.4), '#fff4d6', null, 1.8);
  dab(c, circle(17.5, 25.5, 2), INK);
  dab(c, circle(28.6, 24.6, 1.6), INK);
  blob(c, (k) => { k.moveTo(15, 32); k.quadraticCurveTo(22, 38, 29, 32); k.quadraticCurveTo(22, 35, 15, 32); }, '#3a1a1a', null, 1.6);
  blob(c, (k) => { k.moveTo(20, 34.4); k.quadraticCurveTo(19, 44, 23, 45); k.quadraticCurveTo(26, 44, 25, 34.4); }, '#f07a96', null, 1.6);
}

function shadow(c: Ctx): void {
  const g = c.createRadialGradient(30, 10, 2, 30, 10, 30);
  g.addColorStop(0, 'rgba(30,36,58,0.55)');
  g.addColorStop(0.65, 'rgba(30,36,58,0.32)');
  g.addColorStop(1, 'rgba(30,36,58,0)');
  c.save();
  c.translate(0, 10);
  c.scale(1, 1 / 3);
  c.translate(0, -10);
  c.fillStyle = g;
  c.fillRect(0, -20, 60, 60);
  c.restore();
}

function glow(c: Ctx): void {
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.14)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
}

/**
 * 桃木剑的斩痕：月牙，尾巴透明、锋口金白，外沿一道深橙描边。
 * 雪地很亮，ADD 叠加在上面几乎看不见，所以特效都用饱和色 + 深色边、普通混合（样图第一版的教训）。
 */
function slash(c: Ctx): void {
  c.save();
  const g = c.createLinearGradient(0, 100, 0, 0);
  g.addColorStop(0, 'rgba(255,140,40,0)');
  g.addColorStop(0.35, 'rgba(255,150,40,0.75)');
  g.addColorStop(0.7, 'rgba(255,205,70,1)');
  g.addColorStop(1, 'rgba(255,250,215,1)');
  const crescent = (k: Ctx): void => {
    k.beginPath();
    k.arc(0, 50, 72, -Math.PI * 0.42, Math.PI * 0.42);
    k.arc(-24, 50, 66, Math.PI * 0.34, -Math.PI * 0.34, true);
    k.closePath();
  };
  crescent(c);
  c.fillStyle = g;
  c.fill();
  // 外沿：深橙描边，从尾到头渐显
  const e = c.createLinearGradient(0, 100, 0, 0);
  e.addColorStop(0, 'rgba(160,50,10,0)');
  e.addColorStop(0.5, 'rgba(170,60,15,0.9)');
  e.addColorStop(1, 'rgba(120,40,10,1)');
  c.beginPath();
  c.arc(0, 50, 72, -Math.PI * 0.42, Math.PI * 0.42);
  c.strokeStyle = e;
  c.lineWidth = 2.4;
  c.stroke();
  // 锋口一条白芯
  c.beginPath();
  c.arc(0, 50, 68, -Math.PI * 0.32, Math.PI * 0.32);
  c.strokeStyle = 'rgba(255,255,255,0.95)';
  c.lineWidth = 2.6;
  c.stroke();
  c.restore();
}

/** 软边光团（不同颜色着色用）：雪地上用普通混合，暗处才用 ADD */
function haze(c: Ctx): void {
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
}

/** 拖尾的一粒：亮芯 + 深色边的小菱形，雪地上看得清 */
function mote(c: Ctx): void {
  blob(c, poly(8, 1, 15, 8, 8, 15, 1, 8), '#ffffff', null, 1.6);
}

function talisman(c: Ctx): void {
  blob(c, rrect(1.5, 1.5, 11, 21, 1), '#f5d54e', '#dbb534', 1.6, 1.2);
  stroke(c, (k) => {
    k.moveTo(7, 4);
    k.lineTo(7, 7);
    k.moveTo(4, 6.5);
    k.lineTo(10, 6.5);
    k.moveTo(4.5, 9.5);
    k.lineTo(9.5, 12);
    k.lineTo(4.5, 14.5);
    k.moveTo(7, 15);
    k.lineTo(7, 20);
  }, 1.2, '#c0392b');
}

function coin(c: Ctx): void {
  blob(c, circle(10, 10, 8.5), '#e7bd52', '#c29433', 1.8, 1.4);
  blob(c, rrect(7.4, 7.4, 5.2, 5.2, 0.6), '#5a4220', null, 1.2);
  dab(c, ellipse(6.5, 6, 2.6, 1.2, -0.7), '#fff6d2', 0.7);
}

function flySword(c: Ctx): void {
  blob(c, poly(5, 2, 8, 9, 8, 40, 2, 40, 2, 9), '#dfe9f5', '#a8bcd6', 1.6, 1);
  stroke(c, (k) => { k.moveTo(5, 8); k.lineTo(5, 38); }, 0.8, '#7f95b3');
  blob(c, rrect(-1, 40, 12, 3, 1), '#c9a24a', null, 1.4);
  blob(c, rrect(3.5, 43, 3, 9, 1), '#6b3d22', null, 1.2);
}

function spark(c: Ctx): void {
  const g = c.createRadialGradient(12, 12, 0, 12, 12, 12);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.beginPath();
  c.moveTo(12, 0);
  c.quadraticCurveTo(13.5, 10.5, 24, 12);
  c.quadraticCurveTo(13.5, 13.5, 12, 24);
  c.quadraticCurveTo(10.5, 13.5, 0, 12);
  c.quadraticCurveTo(10.5, 10.5, 12, 0);
  c.fill();
}

function ring(c: Ctx): void {
  c.save();
  for (const [w, a] of [[9, 0.12], [5, 0.3], [2.2, 0.95]] as const) {
    c.beginPath();
    c.arc(64, 64, 58, 0, Math.PI * 2);
    c.lineWidth = w;
    c.strokeStyle = `rgba(255,255,255,${a})`;
    c.stroke();
  }
  c.restore();
}

/** 墨点：几种不规则的泼墨，连斩横幅、死亡时溅在地上 */
function inkBlot(seed: number) {
  return (c: Ctx): void => {
    const rnd = artRng(seed);
    c.fillStyle = INK;
    c.beginPath();
    const n = 14;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const r = 9 + rnd() * 5;
      const x = 16 + Math.cos(a) * r;
      const y = 16 + Math.sin(a) * r;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.fill();
    for (let i = 0; i < 6; i++) {
      const a = rnd() * Math.PI * 2;
      const d = 14 + rnd() * 2;
      c.beginPath();
      c.arc(16 + Math.cos(a) * d, 16 + Math.sin(a) * d, 0.8 + rnd() * 1.6, 0, Math.PI * 2);
      c.fill();
    }
  };
}

function shard(c: Ctx): void {
  blob(c, poly(1.5, 8.5, 5, 1.5, 9, 6.5), '#ffffff', null, 1.2);
}

/** 魂火（经验）：小小的青绿火苗 */
function soul(c: Ctx): void {
  blob(c, (k) => {
    k.moveTo(7, 1);
    k.quadraticCurveTo(13, 8, 12, 12);
    k.quadraticCurveTo(11, 17, 7, 17);
    k.quadraticCurveTo(3, 17, 2, 12);
    k.quadraticCurveTo(1, 8, 7, 1);
  }, '#8ff0c8', '#3dbf8f', 1.4, 1);
  dab(c, ellipse(7, 12, 2.6, 3), '#effff8');
}

/** 雪地上的点缀：枯树 */
function deadTree(c: Ctx): void {
  const rnd = artRng(17);
  const branch = (x: number, y: number, a: number, len: number, w: number, depth: number): void => {
    const x2 = x + Math.cos(a) * len;
    const y2 = y + Math.sin(a) * len;
    stroke(c, (k) => { k.moveTo(x, y); k.quadraticCurveTo((x + x2) / 2 + (rnd() - 0.5) * 8, (y + y2) / 2, x2, y2); }, w + 2.2, INK);
    stroke(c, (k) => { k.moveTo(x, y); k.quadraticCurveTo((x + x2) / 2 + (rnd() - 0.5) * 8, (y + y2) / 2, x2, y2); }, w, '#4a3f52');
    if (depth > 0) {
      branch(x2, y2, a - 0.35 - rnd() * 0.3, len * 0.68, w * 0.62, depth - 1);
      branch(x2, y2, a + 0.3 + rnd() * 0.3, len * 0.62, w * 0.6, depth - 1);
    } else {
      dab(c, ellipse(x2, y2 - 1, 3, 1.4), '#ffffff');
    }
  };
  branch(70, 150, -Math.PI / 2, 52, 9, 4);
  dab(c, ellipse(70, 150, 18, 4), '#ffffff', 0.9);
}

function rock(c: Ctx): void {
  blob(c, poly(4, 34, 10, 14, 26, 6, 44, 10, 56, 24, 54, 36), '#7d8799', '#5c6577', 2.2, 3);
  blob(c, (k) => { k.moveTo(10.5, 15); k.quadraticCurveTo(26, 3, 44, 10.5); k.quadraticCurveTo(48, 15, 40, 16); k.quadraticCurveTo(26, 12, 14, 19); }, '#f6f8fb', null, 1.6);
}

function stele(c: Ctx): void {
  blob(c, poly(8, 70, 10, 14, 16, 6, 34, 6, 40, 14, 42, 70), '#8b8f9e', '#676b7a', 2.4, 3);
  blob(c, rrect(16, 22, 18, 30, 1), '#b8463a', null, 1.4);
  dab(c, rrect(16, 22, 18, 30, 1), '#ffffff', 0.25);
  blob(c, (k) => { k.moveTo(9.5, 15); k.quadraticCurveTo(25, 0, 40.5, 15); k.quadraticCurveTo(25, 10, 9.5, 15); }, '#f6f8fb', null, 1.6);
  dab(c, ellipse(25, 70, 22, 4), '#ffffff', 0.9);
}

function grass(c: Ctx): void {
  for (const [x, a, h] of [[6, -0.5, 14], [10, -0.15, 18], [14, 0.2, 15], [18, 0.55, 11]] as const) {
    stroke(c, (k) => { k.moveTo(x, 20); k.quadraticCurveTo(x + a * 6, 20 - h * 0.6, x + a * 12, 20 - h); }, 1.8, '#4c4458');
  }
}

/** 散落的青石板 */
function slabs(c: Ctx): void {
  const rnd = artRng(5);
  for (let i = 0; i < 5; i++) {
    const x = 6 + i * 22 + rnd() * 6;
    const y = 8 + rnd() * 26;
    const w = 18 + rnd() * 8;
    const h = 12 + rnd() * 6;
    blob(c, rrect(x, y, w, h, 2.5), '#a9b2c2', '#8e98aa', 1.4, 1.6);
    dab(c, rrect(x + 1, y + 1, w * 0.6, 2.4, 1), '#ffffff', 0.85);
  }
}

/** 头像框里的主角头像（HUD 用） */
function heroFace(c: Ctx): void {
  c.save();
  c.translate(-5, 3);
  hero(c);
  c.restore();
}

/** 技能格里的法器图标（32 × 32） */
function iconSword(c: Ctx): void {
  c.translate(16, 16);
  c.rotate(0.78);
  blob(c, poly(-3, 9, -3, -11, 0, -15, 3, -11, 3, 9), '#c98a4b', '#a86a33', 1.8, 1.2);
  blob(c, rrect(-7, 8, 14, 3.4, 1.4), '#7a4a20', null, 1.6);
  blob(c, rrect(-1.8, 11, 3.6, 5, 1), '#5a3416', null, 1.2);
}
function iconTalisman(c: Ctx): void {
  c.translate(9, 4);
  talisman(c);
}
function iconCoins(c: Ctx): void {
  c.translate(-2, 6);
  coin(c);
  c.translate(12, -6);
  coin(c);
  c.translate(-2, 10);
  coin(c);
}
function iconFly(c: Ctx): void {
  c.translate(16, 16);
  c.rotate(0.78);
  c.scale(0.62, 0.62);
  c.translate(-5, -26);
  flySword(c);
}
function iconThunder(c: Ctx): void {
  c.translate(9, 4);
  blob(c, rrect(1.5, 1.5, 11, 21, 1), '#bfe4ff', '#8fc0ea', 1.6, 1.2);
  blob(c, poly(9, 3, 3.5, 12.5, 7, 12.5, 4.5, 21, 11, 10, 7.5, 10), '#ffe14a', null, 1.2);
}
function iconBell(c: Ctx): void {
  blob(c, (k) => { k.moveTo(6, 24); k.quadraticCurveTo(8, 6, 16, 6); k.quadraticCurveTo(24, 6, 26, 24); }, '#e2b54a', '#b88a2a', 1.8, 1.4);
  blob(c, rrect(4, 23, 24, 3.5, 1.5), '#c99a35', null, 1.6);
  blob(c, circle(16, 28, 2.6), '#7a4a20', null, 1.2);
  stroke(c, (k) => { k.moveTo(16, 6); k.lineTo(16, 2); }, 1.8);
}

export const SPRITES: SpriteDef[] = [
  { key: 'hero', w: 60, h: 70, ox: 0.5, oy: 0.95, draw: hero },
  { key: 'jiangshi', w: 56, h: 68, ox: 0.47, oy: 0.95, draw: jiangshi },
  { key: 'jiangshi_big', w: 56, h: 68, ox: 0.47, oy: 0.95, scale: 1.7, draw: jiangshi },
  { key: 'paper', w: 40, h: 52, ox: 0.5, oy: 0.95, draw: paper },
  { key: 'wisp', w: 34, h: 40, ox: 0.5, oy: 0.9, draw: wisp },
  { key: 'lantern', w: 44, h: 56, ox: 0.5, oy: 0.95, draw: lantern },
  { key: 'shadow', w: 60, h: 20, ox: 0.5, oy: 0.5, draw: shadow },
  { key: 'glow', w: 64, h: 64, ox: 0.5, oy: 0.5, draw: glow },
  { key: 'haze', w: 64, h: 64, ox: 0.5, oy: 0.5, draw: haze },
  { key: 'mote', w: 16, h: 16, ox: 0.5, oy: 0.5, draw: mote },
  { key: 'slash', w: 76, h: 100, ox: 0.1, oy: 0.5, draw: (c) => { c.translate(-2, 0); slash(c); } },
  { key: 'talisman', w: 14, h: 24, ox: 0.5, oy: 0.5, draw: talisman },
  { key: 'coin', w: 20, h: 20, ox: 0.5, oy: 0.5, draw: coin },
  { key: 'flysword', w: 10, h: 54, ox: 0.5, oy: 0.4, draw: flySword },
  { key: 'spark', w: 24, h: 24, ox: 0.5, oy: 0.5, draw: spark },
  { key: 'ring', w: 128, h: 128, ox: 0.5, oy: 0.5, draw: ring },
  { key: 'ink0', w: 32, h: 32, ox: 0.5, oy: 0.5, draw: inkBlot(1) },
  { key: 'ink1', w: 32, h: 32, ox: 0.5, oy: 0.5, draw: inkBlot(2) },
  { key: 'ink2', w: 32, h: 32, ox: 0.5, oy: 0.5, draw: inkBlot(3) },
  { key: 'shard', w: 10, h: 10, ox: 0.5, oy: 0.5, draw: shard },
  { key: 'soul', w: 14, h: 18, ox: 0.5, oy: 0.6, draw: soul },
  { key: 'tree', w: 140, h: 158, ox: 0.5, oy: 0.95, draw: deadTree },
  { key: 'rock', w: 60, h: 40, ox: 0.5, oy: 0.85, draw: rock },
  { key: 'stele', w: 50, h: 76, ox: 0.5, oy: 0.93, draw: stele },
  { key: 'grass', w: 24, h: 22, ox: 0.5, oy: 0.9, draw: grass },
  { key: 'slabs', w: 130, h: 50, ox: 0.5, oy: 0.5, draw: slabs },
  { key: 'face', w: 50, h: 44, ox: 0.5, oy: 0.5, draw: heroFace },
  { key: 'i_sword', w: 32, h: 32, ox: 0.5, oy: 0.5, draw: iconSword },
  { key: 'i_talisman', w: 32, h: 32, ox: 0.5, oy: 0.5, draw: iconTalisman },
  { key: 'i_coins', w: 32, h: 32, ox: 0.5, oy: 0.5, draw: iconCoins },
  { key: 'i_fly', w: 32, h: 32, ox: 0.5, oy: 0.5, draw: iconFly },
  { key: 'i_thunder', w: 32, h: 32, ox: 0.5, oy: 0.5, draw: iconThunder },
  { key: 'i_bell', w: 32, h: 32, ox: 0.5, oy: 0.5, draw: iconBell },
];
