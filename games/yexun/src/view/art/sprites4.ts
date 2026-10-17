/**
 * 第四批精灵：十个进化图标（加 evo）、三个合成图标（m_）、四个新被动图标（p_）和蓝火（burn，三昧真火落在地上的火）。
 * 画法和前几批一致（大头 Q 版、墨色粗描边、平涂 + 右下一层阴影、高光用 dab）；图标 32×32，和 i_sword 同尺寸。
 * 进化图标 = 普通图标的升级版：同一件东西，更亮更华丽，加金边或光芒；合成图标再隆重一档，垫紫金色圆牌。
 */
import { INK, blob, circle, dab, ellipse, poly, rrect, stroke, type Ctx, type PathFn } from './draw.ts';
import type { SpriteDef } from './sprites.ts';

const GOLD = '#f2c23c';
const GOLD_SH = '#c28f1e';

/** 四角星闪光 */
function sparkle(c: Ctx, x: number, y: number, r: number, color = '#fff6c0'): void {
  const q = r * 0.28;
  dab(c, poly(x, y - r, x + q, y - q, x + r, y, x + q, y + q, x, y + r, x - q, y + q, x - r, y, x - q, y - q), color);
}

/** 放射光芒：n 根细三角，从 r1 到 r2 */
function rays(c: Ctx, cx: number, cy: number, r1: number, r2: number, n: number, color: string, alpha = 1, off = 0): void {
  for (let i = 0; i < n; i++) {
    const a = off + (i / n) * Math.PI * 2;
    const hw = (Math.PI / n) * 0.42;
    dab(c, poly(cx + Math.cos(a - hw) * r1, cy + Math.sin(a - hw) * r1, cx + Math.cos(a) * r2, cy + Math.sin(a) * r2, cx + Math.cos(a + hw) * r1, cy + Math.sin(a + hw) * r1), color, alpha);
  }
}

/** 火舌：底边中心 (cx, by)，宽 w 高 h，lean 为尖头歪向 */
const tongue =
  (cx: number, by: number, w: number, h: number, lean = 0): PathFn =>
  (k) => {
    k.moveTo(cx - w / 2, by);
    k.bezierCurveTo(cx - w * 0.78, by - h * 0.4, cx - w * 0.1 + lean * 0.3, by - h * 0.6, cx + lean, by - h);
    k.bezierCurveTo(cx + w * 0.1 + lean * 0.6, by - h * 0.55, cx + w * 0.9, by - h * 0.4, cx + w / 2, by);
    k.quadraticCurveTo(cx, by + h * 0.14, cx - w / 2, by);
  };

// ---------------------------------------------------------------- 进化图标

/** 金钱阵：外圈八枚、内圈四枚铜钱，围成一个金光闪闪的阵 */
function iCoinsEvo(c: Ctx): void {
  dab(c, circle(16, 16, 15.5), '#ffd54a', 0.35);
  rays(c, 16, 16, 12, 15.6, 12, '#fff0a0', 0.9);
  const coin = (x: number, y: number, r: number): void => {
    blob(c, circle(x, y, r), '#f4cf5a', '#c99a2e', 1.4, 1);
    blob(c, rrect(x - r * 0.3, y - r * 0.3, r * 0.6, r * 0.6, 0.3), '#5a4220', null, 0.9);
    dab(c, ellipse(x - r * 0.4, y - r * 0.45, r * 0.35, r * 0.2, -0.7), '#fff6d2', 0.85);
  };
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
    coin(16 + Math.cos(a) * 10.4, 16 + Math.sin(a) * 10.4, 4.7);
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 6;
    coin(16 + Math.cos(a) * 4, 16 + Math.sin(a) * 4, 4);
  }
  sparkle(c, 16, 16, 2.6, '#ffffff');
}

/** 万剑归宗：七把飞剑从剑柄一点向上展开成扇面 */
function iFlyEvo(c: Ctx): void {
  dab(c, circle(16, 16, 15.5), '#9fd8ff', 0.28);
  const n = 7;
  const order = [0, 6, 1, 5, 2, 4, 3];
  for (const i of order) {
    const a = ((i - 3) / 3) * 1.12;
    c.save();
    c.translate(16, 29);
    c.rotate(a);
    const mid = i === 3;
    const w = mid ? 2.4 : 1.9;
    blob(c, poly(-w, -5, -w, -23, 0, -29 - (mid ? 1 : 0), w, -23, w, -5), mid ? '#ffffff' : '#e4f0ff', '#9db8dc', 1.2, 0.8);
    stroke(c, (k) => { k.moveTo(0, -7); k.lineTo(0, -22); }, 0.6, '#8aa6cc');
    c.restore();
  }
  void n;
  // 剑柄并拢的一点：金护手 + 小圆
  blob(c, rrect(10.5, 25.4, 11, 3, 1.4), GOLD, GOLD_SH, 1.5, 0.8);
  blob(c, circle(16, 29.6, 2.4), '#c8402f', null, 1.4);
  sparkle(c, 16, 3, 3, '#ffffff');
  sparkle(c, 4, 8, 2, '#d8f0ff');
  sparkle(c, 28, 8, 2, '#d8f0ff');
}

/** 太极镜：金边八卦镜，镜面换成黑白太极，外圈放光 */
function iMirrorEvo(c: Ctx): void {
  dab(c, circle(16, 14, 15.5), '#fff0a0', 0.4);
  rays(c, 16, 14, 13, 15.8, 16, '#ffe27a', 0.95);
  blob(c, rrect(13.8, 25, 4.4, 6, 1.6), '#a86a33', null, 1.5);
  blob(c, circle(16, 14, 12.6), '#f6cf48', '#c8981e', 2, 2);
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4 + Math.PI / 8;
    stroke(c, (k) => { k.moveTo(16 + Math.cos(a) * 10.6, 14 + Math.sin(a) * 10.6); k.lineTo(16 + Math.cos(a) * 12, 14 + Math.sin(a) * 12); }, 2.2, '#7a4a20');
  }
  // 太极镜面
  blob(c, circle(16, 14, 8.6), '#ffffff', null, 1.6);
  dab(c, (k) => { k.arc(16, 14, 8.6, -Math.PI / 2, Math.PI / 2); k.arc(16, 18.3, 4.3, Math.PI / 2, -Math.PI / 2, true); k.arc(16, 9.7, 4.3, Math.PI / 2, -Math.PI / 2, false); }, INK);
  dab(c, circle(16, 9.7, 1.2), '#ffffff');
  dab(c, circle(16, 18.3, 1.2), INK);
  stroke(c, (k) => k.arc(16, 14, 8.6, 0, Math.PI * 2), 1.4);
  dab(c, ellipse(11.4, 9.4, 1.8, 0.9, -0.7), '#ffffff', 0.9);
  sparkle(c, 27, 4, 2.6);
  sparkle(c, 4, 22, 2);
}

/** 五雷正法：三道粗雷同时劈在一张金符上 */
function iThunderEvo(c: Ctx): void {
  dab(c, circle(16, 18, 15.5), '#8fd0ff', 0.3);
  blob(c, rrect(7.5, 18, 17, 13, 1.2), '#f6cf48', '#d09a22', 1.8, 1.4);
  stroke(c, (k) => { k.moveTo(12, 21); k.lineTo(20, 21); k.moveTo(12.5, 24); k.lineTo(19.5, 24); k.moveTo(16, 21); k.lineTo(16, 29); }, 1, '#c0392b');
  const bolts: [number, number][] = [[5.5, 10.5], [16, 16], [26.5, 21.5]];
  for (const [x0, tx] of bolts) {
    const mid = x0 === 16;
    const w = mid ? 4.6 : 3.8;
    const dx = (tx - x0) / 3;
    const p: PathFn = (k) => { k.moveTo(x0 + (mid ? 0 : x0 < 16 ? -1 : 1), 0.6); k.lineTo(x0 + dx + 3.4, 6); k.lineTo(x0 + dx * 2 - 3.2, 9.4); k.lineTo(tx + 1.6, 14.6); k.lineTo(tx, 19); };
    stroke(c, p, w + 3, INK);
    stroke(c, p, w, '#ffd633');
    stroke(c, p, w * 0.38, '#ffffff');
  }
  sparkle(c, 16, 19, 3.4, '#ffffff');
}

/** 往生铃：手铃缩小，外面一圈八瓣莲花光环 */
function iBellEvo(c: Ctx): void {
  dab(c, circle(16, 16, 15.5), '#ffd0e6', 0.4);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    c.save();
    c.translate(16 + Math.cos(a) * 10.6, 16 + Math.sin(a) * 10.6);
    c.rotate(a + Math.PI / 2);
    blob(c, (k) => { k.moveTo(0, 5.2); k.quadraticCurveTo(-4.4, 0.6, 0, -5.6); k.quadraticCurveTo(4.4, 0.6, 0, 5.2); }, i % 2 ? '#ffc2dc' : '#ff9ec4', '#e0609a', 1.3, 0.9);
    dab(c, ellipse(-0.9, -0.8, 0.8, 2.2, 0.2), '#fff2f8', 0.9);
    c.restore();
  }
  c.save();
  c.translate(16, 16.5);
  c.scale(0.72, 0.72);
  c.translate(-16, -16);
  iBellBody(c);
  c.restore();
  sparkle(c, 27, 4, 2.4);
  sparkle(c, 5, 27, 2);
}
function iBellBody(c: Ctx): void {
  blob(c, (k) => { k.moveTo(6, 24); k.quadraticCurveTo(8, 6, 16, 6); k.quadraticCurveTo(24, 6, 26, 24); }, '#f6cf48', '#c8981e', 2, 1.6);
  blob(c, rrect(4, 23, 24, 3.5, 1.5), '#e0a728', null, 1.8);
  blob(c, circle(16, 28.5, 2.8), '#7a4a20', null, 1.4);
  stroke(c, (k) => { k.moveTo(16, 6); k.lineTo(16, 1.5); }, 2);
  dab(c, ellipse(11.5, 13, 1.6, 4.4, 0.25), '#fff6c8');
  stroke(c, (k) => { k.moveTo(7.5, 17); k.lineTo(24.5, 17); }, 1.4, '#a87818');
}

/** 三昧真火：红葫芦口喷蓝白大火 */
function iGourdEvo(c: Ctx): void {
  dab(c, circle(16, 11, 15), '#7fc8ff', 0.3);
  // 火：外蓝、中浅蓝、芯白
  blob(c, tongue(8.8, 12.4, 6.4, 8.5, -2.4), '#5aa8ff', '#2d6fe0', 1.4, 0.8);
  blob(c, tongue(23.2, 12.4, 6.4, 9, 2.4), '#5aa8ff', '#2d6fe0', 1.4, 0.8);
  blob(c, tongue(16, 13, 12.4, 12, 1), '#3b8cff', '#2456c8', 1.7, 1.4);
  dab(c, tongue(16, 12.6, 7.6, 8, 1), '#a8e4ff');
  dab(c, tongue(16, 12.4, 4, 5, 0.8), '#ffffff');
  // 葫芦
  blob(c, ellipse(16, 25.2, 8.8, 6.6), '#f0503a', '#a82418', 1.9, 2);
  blob(c, ellipse(16, 16.4, 5.8, 4.6), '#f0503a', '#a82418', 1.9, 1.6);
  blob(c, rrect(12.6, 10.6, 6.8, 3, 1.3), '#7a4a20', null, 1.5);
  blob(c, rrect(10.4, 20.2, 11.2, 2.6, 1.2), GOLD, null, 1.4);
  dab(c, ellipse(11.8, 15.4, 1.3, 2, 0.4), '#ffb3a0', 0.95);
  dab(c, ellipse(10.8, 25, 1.7, 2.8, 0.4), '#ffb3a0', 0.95);
  sparkle(c, 4, 4, 2.2, '#d8f4ff');
  sparkle(c, 28, 7, 2.6, '#ffffff');
}

/** 捆仙绳：发光的金色绳结，下面垂两条红穗 */
function iRopeEvo(c: Ctx): void {
  dab(c, circle(16, 14, 15.5), '#ffe27a', 0.38);
  rays(c, 16, 14, 12.5, 15.6, 14, '#fff3a8', 0.9);
  // 两条垂下的绳头 + 红穗
  for (const [x0, x1] of [[14, 10.5], [18, 21.5]] as const) {
    const p: PathFn = (k) => { k.moveTo(16, 15); k.quadraticCurveTo(x0, 22, x1, 26); };
    stroke(c, p, 5.2, INK);
    stroke(c, p, 3.2, GOLD);
    blob(c, poly(x1 - 1.8, 25, x1 + 1.8, 25, x1 + 2.6, 31, x1 - 2.6, 31), '#d0362e', null, 1.3);
  }
  // 双环结：横着的 8 字，上面一段再盖一遍做出上下交叉
  const pt = (t: number): [number, number] => {
    const d = 1 + Math.sin(t) ** 2;
    return [16 + (12 * Math.cos(t)) / d, 14 + (2.2 * 8.6 * Math.sin(t) * Math.cos(t)) / d];
  };
  const seg = (t0: number, t1: number): PathFn => (k) => {
    for (let i = 0; i <= 48; i++) {
      const [x, y] = pt(t0 + ((t1 - t0) * i) / 48);
      if (i === 0) k.moveTo(x, y);
      else k.lineTo(x, y);
    }
  };
  stroke(c, seg(0, Math.PI * 2), 5.6, INK);
  stroke(c, seg(0, Math.PI * 2), 3.6, GOLD);
  stroke(c, seg(Math.PI / 2 - 0.55, Math.PI / 2 + 0.55), 5.6, INK);
  stroke(c, seg(Math.PI / 2 - 0.5, Math.PI / 2 + 0.5), 3.6, GOLD);
  stroke(c, seg(0.2, Math.PI / 2 - 0.5), 1, '#fff6c0');
  stroke(c, seg(Math.PI + 0.2, Math.PI * 1.5 - 0.5), 1, '#fff6c0');
  blob(c, circle(16, 14, 2.6), '#e0a728', GOLD_SH, 1.4, 0.8);
  sparkle(c, 27, 3.5, 2.6);
  sparkle(c, 4, 4, 2);
}

/** 十里桃林：一枝开满花的桃枝 */
function iPetalEvo(c: Ctx): void {
  dab(c, circle(16, 16, 15.5), '#ffc2dc', 0.35);
  const br: PathFn = (k) => { k.moveTo(2, 30); k.quadraticCurveTo(12, 24, 17, 15); k.quadraticCurveTo(22, 8, 28, 5); };
  stroke(c, br, 4.4, INK);
  stroke(c, br, 2.6, '#8a5428');
  const tw: PathFn = (k) => { k.moveTo(9, 26.5); k.quadraticCurveTo(10, 20, 6, 15); };
  stroke(c, tw, 3.4, INK);
  stroke(c, tw, 1.8, '#8a5428');
  const tw2: PathFn = (k) => { k.moveTo(17, 15); k.quadraticCurveTo(15, 9, 17, 4); };
  stroke(c, tw2, 3.4, INK);
  stroke(c, tw2, 1.8, '#8a5428');
  // 叶
  for (const [x, y, rot] of [[21, 17, 0.5], [12, 21, -2.4]] as const) {
    c.save();
    c.translate(x, y);
    c.rotate(rot);
    blob(c, (k) => { k.moveTo(0, 0); k.quadraticCurveTo(3, -4, 8, -1); k.quadraticCurveTo(4, 3, 0, 0); }, '#4fbf6a', '#2f8f4a', 1.2, 0.8);
    c.restore();
  }
  const flower = (x: number, y: number, r: number, rot: number): void => {
    for (let i = 0; i < 5; i++) {
      const a = rot + (i / 5) * Math.PI * 2;
      blob(c, circle(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.5), '#ff8fb8', '#e0558a', 1.2, 0.7);
    }
    dab(c, circle(x, y, r * 0.5), '#ffc2dc');
    dab(c, circle(x, y, r * 0.24), '#ffe14a');
    dab(c, circle(x - r * 0.4, y - r * 0.55, r * 0.16), '#ffffff');
  };
  flower(6, 14, 4.4, 0.2);
  flower(17, 3.6, 4, 0.9);
  flower(26.5, 6, 4.6, 0.5);
  flower(18, 15.5, 4.8, 0);
  flower(8.5, 26, 4, 0.6);
  flower(25, 18, 3.6, 0.3);
  flower(4, 5.5, 2.8, 0.7);
  dab(c, circle(28, 26, 1.4), '#ff8fb8');
  dab(c, circle(23, 28.6, 1.1), '#ff8fb8');
  sparkle(c, 29, 12, 2, '#ffffff');
}

/** 不坏金身：金钟罩，外面一圈放射的金光 */
function iShieldEvo(c: Ctx): void {
  // 十六瓣星芒
  const burst: PathFn = (k) => {
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * Math.PI * 2;
      const r = i % 2 ? 11.8 : 15.6;
      if (i === 0) k.moveTo(16 + Math.cos(a) * r, 16 + Math.sin(a) * r);
      else k.lineTo(16 + Math.cos(a) * r, 16 + Math.sin(a) * r);
    }
  };
  blob(c, burst, '#ffe27a', '#f2b81c', 1.3, 1.2);
  dab(c, circle(16, 16, 12), '#fff3b0', 0.8);
  stroke(c, (k) => k.arc(16, 16, 12, 0, Math.PI * 2), 1.2, '#f2b81c');
  blob(c, rrect(12.5, 5.6, 7, 3.4, 1.5), '#a86a33', null, 1.5);
  blob(c, (k) => { k.moveTo(6.4, 25); k.quadraticCurveTo(6, 9.5, 16, 9); k.quadraticCurveTo(26, 9.5, 25.6, 25); }, '#f6cf48', '#c8981e', 1.9, 2.4);
  blob(c, rrect(5, 23.4, 22, 3.6, 1.6), '#e0a728', '#b57d22', 1.7, 1);
  stroke(c, (k) => { k.moveTo(6.8, 14); k.lineTo(25.2, 14); }, 1.4, '#a87818');
  stroke(c, (k) => { k.moveTo(6.4, 19); k.lineTo(25.6, 19); }, 1.4, '#a87818');
  for (const x of [10.8, 16, 21.2]) dab(c, circle(x, 16.5, 1.1), '#fff1a6');
  dab(c, ellipse(10.2, 12, 1.2, 2, 0.3), '#fff6c8');
  sparkle(c, 27.5, 3.5, 2.4, '#ffffff');
  sparkle(c, 4, 28, 2, '#ffffff');
}

/** 纸鹤（侧面朝右），scale 由调用方给 */
function paperCrane(c: Ctx, x: number, y: number, s: number, flip = false): void {
  c.save();
  c.translate(x, y);
  c.scale(flip ? -s : s, s);
  const line = Math.max(0.9, 1.5 * s) / s;
  const W = '#ffffff';
  const G = '#cfd6e6';
  blob(c, poly(-2, -2, -9, -16, 6, -4), '#dde2ee', null, line);
  blob(c, poly(-6, 0, -17, -9, -14, 3, -4, 6), W, G, line, 1.4);
  blob(c, poly(5, -2, 9, -14, 12.5, -13, 12, -2), W, G, line, 1.2);
  blob(c, poly(9, -14, 19, -11, 12.4, -9.5), W, null, line);
  blob(c, poly(-9, 0, 2, -8, 13, 0, 1, 11), W, G, line * 1.6, 2.8);
  blob(c, poly(-8, -1, -3, -20, 11, -1), W, G, line * 1.4, 2.4);
  dab(c, circle(11.2, -11.4, 1.5), '#d0362e');
  c.restore();
}

/** 千鹤引魂：三只纸鹤（大中小）斜着错开排开，后面一盏小灯笼 */
function iCraneEvo(c: Ctx): void {
  dab(c, circle(12, 10, 10.5), '#ffd27a', 0.4);
  stroke(c, (k) => { k.moveTo(12, 0.8); k.lineTo(12, 3.2); }, 1.6);
  blob(c, rrect(9.4, 2.6, 5.2, 2, 0.9), '#7a4a20', null, 1.2);
  blob(c, ellipse(12, 9.6, 5.4, 5.6), '#ff6a3a', '#c8381f', 1.6, 1.3);
  dab(c, ellipse(12, 9.6, 2.8, 3.2), '#fff0a0', 0.85);
  blob(c, rrect(9.4, 14.4, 5.2, 2, 0.9), '#7a4a20', null, 1.2);
  stroke(c, (k) => { k.moveTo(12, 16.4); k.lineTo(12, 19); }, 1.3, '#f2c23c');
  paperCrane(c, 10, 27, 0.5);
  paperCrane(c, 24.5, 17.5, 0.38);
  paperCrane(c, 26, 6, 0.28);
  sparkle(c, 4, 22, 1.8);
}

// ---------------------------------------------------------------- 合成图标

interface PlateTone {
  glow: string;
  base: string;
  dark: string;
  mid: string;
}
const PURPLE: PlateTone = { glow: '#c89bff', base: '#6a3cb0', dark: '#46218a', mid: '#8a5ad0' };
/** 双修各有自己的底色（和 MERGES 里的 color 对应：朱红、橙金、桃粉） */
const CRIMSON: PlateTone = { glow: '#ffb0a0', base: '#b8281e', dark: '#7e1410', mid: '#e04a38' };
const AMBER: PlateTone = { glow: '#ffd890', base: '#c26a12', dark: '#85400a', mid: '#f0942a' };
const ROSE: PlateTone = { glow: '#ffc0dc', base: '#c2477e', dark: '#8a2456', mid: '#ee79ae' };

/** 圆牌：合成图标的底，比进化图标多一层框（三个老合成紫金，双修各一种颜色） */
function plate(c: Ctx, tone: PlateTone = PURPLE): void {
  dab(c, circle(16, 16, 15.8), tone.glow, 0.4);
  blob(c, circle(16, 16, 14.6), tone.base, tone.dark, 2.1, 2.6);
  dab(c, circle(16, 16, 11.8), tone.mid, 0.55);
  stroke(c, (k) => k.arc(16, 16, 13, 0, Math.PI * 2), 1.5, GOLD);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    dab(c, circle(16 + Math.cos(a) * 13, 16 + Math.sin(a) * 13, i % 2 ? 0.9 : 1.5), i % 2 ? '#fff6c0' : '#fff1a6');
  }
}

/** 诛邪剑阵：桃木剑与飞剑交叉，背后一圈剑阵 */
function mSword(c: Ctx): void {
  plate(c);
  // 阵光圈：八道短剑芒
  rays(c, 16, 16, 4, 11.5, 8, '#e8d4ff', 0.55, Math.PI / 8);
  stroke(c, (k) => k.arc(16, 16, 9.4, 0, Math.PI * 2), 0.9, '#f6e2ff');
  // 飞剑（左上 - 右下）
  c.save();
  c.translate(16, 16.5);
  c.rotate(-0.78);
  blob(c, poly(-2.4, 8, -2.4, -9, 0, -14, 2.4, -9, 2.4, 8), '#f0f6ff', '#9db8dc', 1.6, 1.1);
  stroke(c, (k) => { k.moveTo(0, -9); k.lineTo(0, 6); }, 0.7, '#8aa6cc');
  blob(c, rrect(-5.4, 7.6, 10.8, 2.8, 1.2), GOLD, GOLD_SH, 1.4, 0.7);
  blob(c, rrect(-1.4, 10.2, 2.8, 4, 0.8), '#c8402f', null, 1.1);
  c.restore();
  // 桃木剑（右上 - 左下），压在上面
  c.save();
  c.translate(16, 16.5);
  c.rotate(0.78);
  blob(c, poly(-2.8, 8, -2.8, -9.5, 0, -14.5, 2.8, -9.5, 2.8, 8), '#d99a55', '#a86a33', 1.7, 1.1);
  stroke(c, (k) => { k.moveTo(0, -9); k.lineTo(0, 6); }, 0.7, '#7a4a20');
  blob(c, rrect(-6, 7.4, 12, 3, 1.2), '#7a4a20', null, 1.4);
  blob(c, rrect(-1.5, 10.2, 3, 4.2, 0.8), '#5a3416', null, 1.1);
  stroke(c, (k) => { k.moveTo(0, 14.3); k.quadraticCurveTo(-1.8, 16.4, -0.8, 17.8); }, 1.2, '#d0362e');
  c.restore();
  sparkle(c, 16, 4.2, 2.3, '#ffffff');
  sparkle(c, 26.5, 22, 1.6);
}

/** 雷火符箓：燃火的金符，一道雷劈穿 */
function mTalisman(c: Ctx): void {
  plate(c);
  c.save();
  c.translate(15.5, 15.5);
  c.rotate(-0.12);
  c.translate(-15.5, -15.5);
  // 火：符纸两侧和下沿
  blob(c, tongue(10.2, 24, 5.2, 12, -1.4), '#ff7a21', '#e5481f', 1.2, 0.7);
  blob(c, tongue(21.6, 24, 5.2, 10, 1.4), '#ff7a21', '#e5481f', 1.2, 0.7);
  blob(c, rrect(10, 5, 11.6, 20, 1), '#f6cf48', '#d09a22', 1.6, 1.2);
  stroke(c, (k) => { k.moveTo(15.8, 7.5); k.lineTo(15.8, 9.5); k.moveTo(13, 9.5); k.lineTo(18.6, 9.5); k.moveTo(13.4, 12.5); k.lineTo(18.2, 14.5); k.lineTo(13.4, 16.5); }, 1, '#c0392b');
  blob(c, tongue(16, 27.4, 11, 11, 0.6), '#ff8a2a', '#e5481f', 1.4, 0.9);
  dab(c, tongue(16, 26.4, 6, 7, 0.4), '#ffe14a');
  blob(c, tongue(12.6, 26, 4, 6.5, -1), '#ff8a2a', null, 1);
  blob(c, tongue(20, 26, 4, 7, 1), '#ff8a2a', null, 1);
  c.restore();
  // 雷
  const bolt: PathFn = (k) => { k.moveTo(24, 2.5); k.lineTo(18.4, 10); k.lineTo(21.6, 11); k.lineTo(14.2, 20.6); };
  stroke(c, bolt, 4.8, INK);
  stroke(c, bolt, 2.8, '#ffe14a');
  stroke(c, bolt, 1, '#ffffff');
  sparkle(c, 14.2, 20.6, 2.8, '#ffffff');
}

/** 阴阳镇魂：太极镜和铃叠在一起，外面一圈黑白光环 */
function mMirror(c: Ctx): void {
  plate(c);
  // 黑白光环：左半白、右半黑
  c.save();
  c.lineCap = 'butt';
  c.lineWidth = 2.6;
  c.strokeStyle = '#ffffff';
  c.beginPath();
  c.arc(16, 16, 10.6, Math.PI / 2, Math.PI * 1.5);
  c.stroke();
  c.strokeStyle = INK;
  c.beginPath();
  c.arc(16, 16, 10.6, -Math.PI / 2, Math.PI / 2);
  c.stroke();
  c.restore();
  // 镜
  blob(c, circle(16, 12.4, 7.8), '#f6cf48', '#c8981e', 1.7, 1.4);
  blob(c, circle(16, 12.4, 5.6), '#ffffff', null, 1.3);
  dab(c, (k) => { k.arc(16, 12.4, 5.6, -Math.PI / 2, Math.PI / 2); k.arc(16, 15.2, 2.8, Math.PI / 2, -Math.PI / 2, true); k.arc(16, 9.6, 2.8, Math.PI / 2, -Math.PI / 2, false); }, INK);
  dab(c, circle(16, 9.6, 0.8), '#ffffff');
  dab(c, circle(16, 15.2, 0.8), INK);
  stroke(c, (k) => k.arc(16, 12.4, 5.6, 0, Math.PI * 2), 1.1);
  // 铃：压在镜下半
  c.save();
  c.translate(16, 20.6);
  c.scale(0.46, 0.46);
  c.translate(-16, -16);
  iBellBody(c);
  c.restore();
  sparkle(c, 26, 5, 2.2, '#ffffff');
  sparkle(c, 5, 26, 1.7);
}


/** 符剑合璧：飞剑斜插，剑身贴着一张黄符，周围火星 */
function mFujian(c: Ctx): void {
  plate(c, CRIMSON);
  rays(c, 16, 16, 5, 12, 10, '#ffd2c0', 0.5, Math.PI / 10);
  c.save();
  c.translate(16, 16.5);
  c.rotate(0.7);
  blob(c, poly(-2.4, 8, -2.4, -9, 0, -15, 2.4, -9, 2.4, 8), '#f0f6ff', '#9db8dc', 1.6, 1.1);
  stroke(c, (k) => { k.moveTo(0, -10); k.lineTo(0, 6); }, 0.7, '#8aa6cc');
  blob(c, rrect(-5.4, 7.6, 10.8, 2.8, 1.2), GOLD, GOLD_SH, 1.4, 0.7);
  blob(c, rrect(-1.4, 10.2, 2.8, 4, 0.8), '#c8402f', null, 1.1);
  // 剑身上贴的符
  blob(c, rrect(-4.2, -6, 8.4, 11, 0.8), '#f6cf48', '#d09a22', 1.4, 1);
  stroke(c, (k) => { k.moveTo(0, -4.4); k.lineTo(0, -2.6); k.moveTo(-2.2, -2.8); k.lineTo(2.2, -2.8); k.moveTo(-1.8, 0); k.lineTo(1.8, 1.6); k.lineTo(-1.8, 3.2); }, 0.9, '#c0392b');
  c.restore();
  blob(c, tongue(24.5, 12, 5, 7, 1), '#ff7a21', '#e5481f', 1, 0.6);
  sparkle(c, 6, 8, 2, '#ffffff');
  sparkle(c, 26.5, 25, 1.6);
}

/** 焚天金钟：金色大钟，裙边一圈火 */
function mFenzhong(c: Ctx): void {
  plate(c, AMBER);
  // 钟身
  blob(c, (k) => { k.moveTo(8, 21); k.bezierCurveTo(8, 8, 11, 5.5, 16, 5.5); k.bezierCurveTo(21, 5.5, 24, 8, 24, 21); k.closePath(); }, '#f6cf48', '#c8981e', 1.9, 1.6);
  blob(c, circle(16, 5.2, 1.8), '#c8981e', null, 1.2);
  dab(c, rrect(11, 9, 2.4, 9, 1), '#fff6c0', 0.7);
  stroke(c, (k) => { k.moveTo(9.4, 16); k.lineTo(22.6, 16); }, 1, '#c8981e');
  // 钟下一圈火
  blob(c, tongue(8, 28, 6, 11, -1), '#ff7a21', '#e5481f', 1.2, 0.7);
  blob(c, tongue(24, 28, 6, 11, 1), '#ff7a21', '#e5481f', 1.2, 0.7);
  blob(c, tongue(16, 28.5, 8, 9, 0), '#ff8a2a', '#e5481f', 1.2, 0.8);
  dab(c, tongue(16, 28, 4.4, 6, 0), '#ffe14a');
  sparkle(c, 26, 6, 2, '#fff6c0');
}

/** 铃落桃花：铃居中，桃花瓣围着飘落 */
function mLinghua(c: Ctx): void {
  plate(c, ROSE);
  c.save();
  c.translate(16, 15.5);
  c.scale(0.6, 0.6);
  c.translate(-16, -16);
  iBellBody(c);
  c.restore();
  const petal = (x: number, y: number, r: number, s: number): void => {
    c.save();
    c.translate(x, y);
    c.rotate(r);
    blob(c, ellipse(0, 0, 3.2 * s, 2 * s), '#ffd0e4', '#ee79ae', 1.1, 0.6);
    c.restore();
  };
  petal(6.5, 8, -0.6, 1);
  petal(26, 9, 0.8, 1);
  petal(8, 24, 0.5, 0.9);
  petal(25.5, 24.5, -0.4, 1.1);
  petal(16, 4.4, 0.2, 0.8);
  sparkle(c, 27, 16, 1.6, '#ffffff');
}

// ---------------------------------------------------------------- 被动图标

/** 黄历：黄封皮的旧历书，红线装订，贴一条白签 */
function pHuangli(c: Ctx): void {
  c.save();
  c.translate(16, 16);
  c.rotate(-0.1);
  c.translate(-16, -16);
  // 书页厚度
  blob(c, rrect(7.4, 4.6, 19.2, 25, 1.2), '#f4ecd2', '#d8cba0', 1.6, 1);
  // 封面
  blob(c, rrect(5, 3, 19.6, 25, 1.6), '#eec44e', '#c89a26', 2.1, 2);
  blob(c, rrect(5, 3, 3.6, 25, 1.4), '#c8942a', null, 1.6);
  for (const y of [7, 12.5, 18, 23.5]) dab(c, circle(6.8, y, 0.95), '#d0362e');
  // 白签 + 字（历）
  blob(c, rrect(12, 6.4, 8.6, 14, 0.8), '#fffaf0', null, 1.3);
  stroke(c, (k) => { k.moveTo(16.3, 8.4); k.lineTo(16.3, 18.6); k.moveTo(13.6, 10.8); k.lineTo(19, 10.8); k.moveTo(13.6, 14); k.lineTo(19, 14); k.moveTo(13.6, 17.2); k.lineTo(19, 17.2); }, 1, '#7a2a1a');
  blob(c, rrect(13.4, 22, 5.6, 4, 0.8), '#d0362e', null, 1.1);
  dab(c, ellipse(10.4, 5.6, 1, 0.5, 0), '#fff6c8', 0.9);
  c.restore();
}

/** 灵芝：扁圆红褐伞盖、边缘一圈浅色，下面一根短柄，后面再叠一个小伞盖 */
function pLingzhi(c: Ctx): void {
  const cap = (cx: number, cy: number, rx: number, ry: number, fill: string, shade: string): void => {
    blob(c, (k) => { k.moveTo(cx - rx, cy + ry * 0.35); k.bezierCurveTo(cx - rx, cy - ry * 1.5, cx + rx, cy - ry * 1.5, cx + rx, cy + ry * 0.35); k.quadraticCurveTo(cx, cy + ry * 1.2, cx - rx, cy + ry * 0.35); }, '#f2b88a', null, 2.1);
    blob(c, (k) => { k.moveTo(cx - rx + 1.6, cy + ry * 0.15); k.bezierCurveTo(cx - rx + 1.6, cy - ry * 1.15, cx + rx - 1.6, cy - ry * 1.15, cx + rx - 1.6, cy + ry * 0.15); k.quadraticCurveTo(cx, cy + ry * 0.7, cx - rx + 1.6, cy + ry * 0.15); }, fill, shade, 0, 1.6);
    stroke(c, (k) => { k.moveTo(cx - rx * 0.55, cy - ry * 0.1); k.quadraticCurveTo(cx, cy - ry * 0.75, cx + rx * 0.5, cy - ry * 0.1); }, 0.9, shade);
  };
  // 后面小伞盖
  cap(22.5, 12, 7.5, 5, '#a8402a', '#7a2a1a');
  // 短柄
  const st: PathFn = (k) => { k.moveTo(14, 20); k.quadraticCurveTo(13, 25, 14.5, 29.4); };
  stroke(c, st, 6, INK);
  stroke(c, st, 3.8, '#8a4a2a');
  // 前面大伞盖
  cap(14.5, 15.5, 12.5, 7.6, '#c0502e', '#8a2e1a');
  dab(c, ellipse(8.6, 11.6, 2.6, 1.2, -0.5), '#ffe0a8', 0.9);
  sparkle(c, 27.5, 4, 1.8, '#ffe9a8');
}

/** 墨斗：木匠的墨斗，木盒、线轮带红摇把，墨线从前孔拉出 */
function pModou(c: Ctx): void {
  // 墨线
  const ln: PathFn = (k) => { k.moveTo(27, 21); k.quadraticCurveTo(29, 25, 31, 25.4); };
  stroke(c, ln, 1.6, INK);
  blob(c, circle(31, 25.4, 0.9), '#c0c0c8', null, 0.8);
  // 木盒
  blob(c, rrect(6, 12.5, 21, 14, 3), '#b8782e', '#8a5420', 2.2, 2);
  dab(c, rrect(8, 14, 16, 2.6, 1.2), '#e0a860', 0.8);
  // 前孔
  blob(c, ellipse(25.2, 21, 1.8, 1.8), INK, null, 0.01);
  // 线轮：圆木轮压在盒的左后
  blob(c, circle(10.6, 12, 7.6), '#d99a55', '#a86a33', 2.1, 2);
  blob(c, circle(10.6, 12, 4.2), '#a86a33', '#7a4a20', 1.4, 1);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    stroke(c, (k) => { k.moveTo(10.6 + Math.cos(a) * 1.2, 12 + Math.sin(a) * 1.2); k.lineTo(10.6 + Math.cos(a) * 4, 12 + Math.sin(a) * 4); }, 0.9, '#5a3416');
  }
  // 摇把（红）
  stroke(c, (k) => { k.moveTo(10.6, 12); k.lineTo(10.6, 4.6); }, 3.4, INK);
  stroke(c, (k) => { k.moveTo(10.6, 12); k.lineTo(10.6, 4.6); }, 1.8, '#d0362e');
  blob(c, circle(10.6, 3.8, 2.2), '#e0412f', '#a82a1f', 1.4, 0.8);
  dab(c, circle(10.6, 12, 1.2), '#f4c24a');
  // 盒上的黑墨仓口
  blob(c, ellipse(19.5, 12.8, 4, 1.6), '#2a1e14', null, 1.4);
}

/** 引魂灯：青白色的纸灯笼，里头一团幽光，周围冒幽幽的光 */
function pYinhun(c: Ctx): void {
  dab(c, circle(16, 16, 15.5), '#7fffe6', 0.28);
  dab(c, circle(16, 16, 11), '#b8fff0', 0.3);
  // 吊环
  stroke(c, (k) => { k.arc(16, 3.2, 2.6, Math.PI, Math.PI * 2); k.lineTo(18.6, 5); }, 1.5);
  blob(c, rrect(11.2, 4.4, 9.6, 3.2, 1.2), '#2f7f86', null, 1.6);
  // 灯身
  blob(c, ellipse(16, 16.4, 9.4, 9.4), '#e6fbfa', '#9dd8d6', 2.2, 2.4);
  dab(c, ellipse(16, 16.4, 6.2, 7.2), '#ffffff', 0.9);
  // 灯笼骨
  stroke(c, (k) => { k.ellipse(16, 16.4, 4.4, 9.4, 0, 0, Math.PI * 2); }, 0.9, '#6fb8b4');
  stroke(c, (k) => { k.moveTo(6.8, 16.4); k.lineTo(25.2, 16.4); }, 0.9, '#6fb8b4');
  // 里面的幽火
  blob(c, tongue(16, 20.4, 4.6, 8, 0.6), '#7fffe0', null, 0.8);
  dab(c, tongue(16, 19.6, 2.4, 4.4, 0.4), '#ffffff');
  // 下盖和穗
  blob(c, rrect(11.2, 24.6, 9.6, 3.2, 1.2), '#2f7f86', null, 1.6);
  stroke(c, (k) => { k.moveTo(16, 27.6); k.lineTo(16, 30.4); }, 1.6, '#6fe0d0');
  stroke(c, (k) => { k.moveTo(14, 27.6); k.lineTo(13.4, 30); k.moveTo(18, 27.6); k.lineTo(18.6, 30); }, 1.2, '#6fe0d0');
  dab(c, ellipse(11.4, 12.6, 1.2, 2.4, 0.4), '#ffffff');
  // 飘出来的幽光
  dab(c, circle(4.5, 8, 1.2), '#b8fff0', 0.9);
  dab(c, circle(27.5, 24, 1.4), '#b8fff0', 0.9);
  sparkle(c, 27, 6, 2, '#e6fffa');
}

// ---------------------------------------------------------------- 场景

/** 地上的火（三昧真火落地）：焦黑地面上几簇往上卷的火，外橙红、内金黄、火心蓝白，墨色描边，约 52×30 */
function burn(c: Ctx): void {
  // 烧焦的地面
  blob(c, ellipse(26, 23, 24.5, 6.4), '#3a2a2c', '#241a1e', 2, 1.6);
  dab(c, ellipse(26, 23.4, 18, 4), '#1c1418', 0.7);
  const flame = (cx: number, by: number, w: number, h: number, lean: number): void => {
    blob(c, tongue(cx, by, w, h, lean), '#ff5a22', '#d8321c', 1.9, 1.5);
    dab(c, tongue(cx, by - 0.5, w * 0.68, h * 0.74, lean * 0.7), '#ffc83a');
    dab(c, tongue(cx, by - 0.8, w * 0.34, h * 0.4, lean * 0.4), '#d6f2ff');
  };
  // 高矮错开，尖头各往一边卷；后排先画
  flame(15, 22, 10, 15, -3);
  flame(38, 22, 10, 13, 3);
  flame(26, 24, 14, 22, 2);
  flame(19.5, 26, 9, 9, -2);
  flame(33, 26.5, 9, 10, 2);
  // 飘起的火星
  dab(c, circle(10, 9, 1.1), '#ffc83a', 0.95);
  dab(c, circle(43, 8, 1.2), '#ff8a2a', 0.95);
  dab(c, circle(34, 3.5, 0.9), '#ffe27a', 0.95);
}

const icon = (key: string, draw: (c: Ctx) => void): SpriteDef => ({ key, w: 32, h: 32, ox: 0.5, oy: 0.5, draw });

export const SPRITES4: SpriteDef[] = [
  icon('i_coins_evo', iCoinsEvo),
  icon('i_fly_evo', iFlyEvo),
  icon('i_mirror_evo', iMirrorEvo),
  icon('i_thunder_evo', iThunderEvo),
  icon('i_bell_evo', iBellEvo),
  icon('i_gourd_evo', iGourdEvo),
  icon('i_rope_evo', iRopeEvo),
  icon('i_petal_evo', iPetalEvo),
  icon('i_shield_evo', iShieldEvo),
  icon('i_crane_evo', iCraneEvo),
  icon('m_sword', mSword),
  icon('m_talisman', mTalisman),
  icon('m_mirror', mMirror),
  icon('m_fujian', mFujian),
  icon('m_fenzhong', mFenzhong),
  icon('m_linghua', mLinghua),
  icon('p_huangli', pHuangli),
  icon('p_lingzhi', pLingzhi),
  icon('p_modou', pModou),
  icon('p_yinhun', pYinhun),
  { key: 'burn', w: 52, h: 30, ox: 0.5, oy: 0.5, draw: burn },
];
