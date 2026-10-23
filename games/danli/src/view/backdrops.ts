/**
 * 远景主题（美术代理 2026-10-21 交付的 danli-backdrops.mjs，照原样改写成 TS）：厨房、冰淇淋店、雪夜、野餐布、夜市、早餐桌。
 * backdrop.ts 烘焙时调 paintBackdrop 画"墙 / 天空 + 装饰 + 往下淡成的雾"，纸边外的书桌用主题的 desk 颜色。
 * 规矩：远景是透明水彩感，往后退——低饱和、低对比、墨线透明度 ≤ 0.3；不用滤镜和阴影模糊，光晕用一圈圈半透明的圆叠出来；
 * 游戏里按 0.4 倍烘焙一次，所以细节不小于 3 个世界单位，字不小于 40。随机数写死种子，每次画得一样。
 */
import { THEMES2, type ThemeId2 } from './mapArt2.ts';
import { blobs, cloud, halo, lcg, type Rnd } from './paintKit.ts';
import { INK } from './palette.ts';

export { lcg } from './paintKit.ts';

type Ctx = CanvasRenderingContext2D;
/** 烘焙范围（世界坐标） */
export interface Area {
  x0: number;
  y0: number;
  w: number;
  h: number;
}
const FONT = "-apple-system,'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC',sans-serif";

const TAU = Math.PI * 2;
function lantern(ctx: Ctx, x: number, y: number, k: number, lit: boolean): void {
  if (lit) halo(ctx, x, y + 6 * k, 46 * k, '#ffcf6a', 0.07, 5);
  ctx.lineWidth = 3 * k; ctx.strokeStyle = INK;
  ctx.beginPath(); ctx.moveTo(x, y - 30 * k); ctx.lineTo(x, y - 20 * k); ctx.stroke();
  ctx.fillStyle = '#3a2a22'; ctx.fillRect(x - 13 * k, y - 22 * k, 26 * k, 7 * k); ctx.fillRect(x - 9 * k, y + 28 * k, 18 * k, 6 * k);
  ctx.fillStyle = '#e2432a'; ctx.beginPath(); ctx.ellipse(x, y + 4 * k, 21 * k, 25 * k, 0, 0, TAU); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#ffcf6a'; ctx.lineWidth = 2.4 * k; ctx.globalAlpha = 0.8;
  ctx.beginPath(); ctx.moveTo(x - 12 * k, y + 4 * k); ctx.lineTo(x + 12 * k, y + 4 * k); ctx.moveTo(x, y - 18 * k); ctx.lineTo(x, y + 27 * k); ctx.stroke();
  ctx.globalAlpha = 1;
}
function stringOfLanterns(ctx: Ctx, x0: number, x1: number, y: number, sag: number, n: number, k: number, alpha: number): void {
  ctx.globalAlpha = alpha;
  const seg = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const xa = x0 + i * seg, xb = xa + seg, xm = (xa + xb) / 2;
    ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(xa, y); ctx.quadraticCurveTo(xm, y + sag * 2, xb, y); ctx.stroke();
  }
  for (let i = 0; i < n; i++) for (const t of [0.3, 0.7]) {
    const x = x0 + (i + t) * seg, yy = y + sag * 4 * t * (1 - t);
    lantern(ctx, x, yy + 30 * k, k, true);
  }
  ctx.globalAlpha = 1;
}
function fog(ctx: Ctx, th: Theme, W: number, H: number, area: Area, r: Rnd): void {
  const g = ctx.createLinearGradient(0, th.fogTop ?? 430, 0, H);
  g.addColorStop(0, th.mist + '00'); g.addColorStop(0.45, th.mist + '8c'); g.addColorStop(1, th.mistDeep + 'f2');
  ctx.fillStyle = g; ctx.fillRect(area.x0, th.fogTop ?? 430, area.w, area.y0 + area.h - (th.fogTop ?? 430));
  ctx.fillStyle = th.fog;
  for (let i = 0; i < 28; i++) {
    ctx.globalAlpha = 0.3 + r() * 0.3;
    ctx.beginPath(); ctx.ellipse(r() * W, 640 + r() * 120, 120 + r() * 220, 14 + r() * 14, 0, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
function text(ctx: Ctx, s: string, x: number, y: number, size: number, fill: string, alpha = 1, rot = 0): void {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.globalAlpha = alpha;
  ctx.font = `900 ${size}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = fill; ctx.fillText(s, 0, 0);
  ctx.restore();
}

export type ThemeId = 'kitchen' | 'icecream' | 'dumpling' | 'bento' | 'nightmarket' | 'breakfast' | ThemeId2;

export interface Theme {
  name: string;
  base: string;
  mist: string;
  mistDeep: string;
  fog: string;
  /** 纸边外的书桌和木纹 */
  desk: string;
  deskLine: string;
  /** 夜景（结算页、名牌的配色可以参考） */
  night?: boolean;
  fogTop?: number;
  paint(this: Theme, ctx: Ctx, W: number, H: number, A: Area, r: Rnd): void;
}

export const THEMES: Readonly<Record<ThemeId, Theme>> = {
  ...THEMES2,
  // 厨房：米色瓷砖墙、一扇大窗、挂着的锅勺、左边一排调料罐
  kitchen: {
    name: '厨房', base: '#efe8dc', mist: '#c9c6cf', mistDeep: '#9fa3b8', fog: '#f4f2f6', desk: '#33251f', deskLine: '#4a362c',
    paint(ctx, W, H, A, r) {
      ctx.fillStyle = this.base; ctx.fillRect(A.x0, A.y0, A.w, A.h);
      blobs(ctx, r, 40, '#d6cab6', 0.18, 0, W, A.y0, H, 200, 500, 80, 200);
      ctx.strokeStyle = INK; ctx.globalAlpha = 0.09; ctx.lineWidth = 3; ctx.beginPath();
      for (let x = A.x0 - (A.x0 % 160); x < A.x0 + A.w; x += 160) { ctx.moveTo(x, A.y0); ctx.lineTo(x, 560); }
      for (let y = -960; y < 560; y += 160) { ctx.moveTo(A.x0, y); ctx.lineTo(A.x0 + A.w, y); }
      ctx.stroke(); ctx.globalAlpha = 1;
      // 窗
      ctx.fillStyle = '#c9dde3'; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.roundRect(1700, 20, 620, 300, 14); ctx.fill();
      ctx.globalAlpha = 0.28; ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.stroke(); ctx.beginPath(); ctx.moveTo(2010, 20); ctx.lineTo(2010, 320); ctx.stroke();
      cloud(ctx, 1820, 110, 0.9, '#f4efe2', INK); cloud(ctx, 2190, 80, 0.7, '#f4efe2', INK);
      // 窗台上一盆小葱
      ctx.globalAlpha = 0.5; ctx.fillStyle = '#d98a5c'; ctx.beginPath(); ctx.roundRect(1960, 280, 100, 46, 8); ctx.fill();
      ctx.strokeStyle = '#6aa84f'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.beginPath();
      for (const [dx, h] of [[-30, 70], [-12, 96], [6, 84], [24, 60], [38, 74]] as const) { ctx.moveTo(2010 + dx, 282); ctx.quadraticCurveTo(2010 + dx - 6, 282 - h / 2, 2010 + dx + 4, 282 - h); }
      ctx.stroke(); ctx.globalAlpha = 1;
      // 调料架和罐子
      ctx.globalAlpha = 0.35; ctx.fillStyle = '#b48a62'; ctx.fillRect(140, 230, 760, 12);
      for (const [x, w, h, c] of [[170, 70, 96, '#e9a7a0'], [260, 60, 120, '#f0d48a'], [340, 76, 84, '#a9cfa4'], [440, 64, 110, '#a8c4e0'], [530, 70, 92, '#e9a7a0'], [620, 58, 124, '#f0d48a'], [700, 74, 88, '#a9cfa4'], [800, 66, 104, '#c8b4e0']] as const) {
        ctx.fillStyle = c; ctx.beginPath(); ctx.roundRect(x, 230 - h, w, h, 10); ctx.fill();
        ctx.fillStyle = '#b48a62'; ctx.fillRect(x + 6, 230 - h - 12, w - 12, 14);
      }
      ctx.globalAlpha = 1;
      // 挂着的汤勺、平底锅、打蛋器
      ctx.globalAlpha = 0.22; ctx.lineWidth = 4; ctx.strokeStyle = INK;
      ctx.beginPath(); ctx.moveTo(1000, 50); ctx.lineTo(1560, 50); ctx.moveTo(2500, 50); ctx.lineTo(2900, 50); ctx.stroke();
      for (const [x, k] of [[1080, 0], [1240, 1], [1420, 2], [2580, 1], [2800, 0]] as const) {
        ctx.beginPath(); ctx.moveTo(x, 50);
        if (k === 1) { ctx.lineTo(x, 120); ctx.moveTo(x + 34, 150); ctx.ellipse(x, 150, 34, 30, 0, 0, TAU); }
        else if (k === 0) { ctx.lineTo(x, 130); ctx.moveTo(x + 14, 160); ctx.ellipse(x, 160, 14, 30, 0, 0, TAU); }
        else { ctx.lineTo(x, 110); for (const dx of [-14, -5, 5, 14]) { ctx.moveTo(x, 110); ctx.quadraticCurveTo(x + dx * 1.6, 160, x, 190); } }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
  },
  // 冰淇淋店：粉白条纹的遮阳篷、奶油云、撒满彩针糖
  icecream: {
    name: '冰淇淋店', base: '#fdf1f4', mist: '#dccbe8', mistDeep: '#b9a8d0', fog: '#fff8ff', desk: '#3a2a3a', deskLine: '#52405a',
    paint(ctx, W, H, A, r) {
      const g = ctx.createLinearGradient(0, A.y0, 0, 600); g.addColorStop(0, '#fbe3ec'); g.addColorStop(1, '#f6eefb');
      ctx.fillStyle = g; ctx.fillRect(A.x0, A.y0, A.w, A.h);
      blobs(ctx, r, 30, '#f6d4e2', 0.3, 0, W, 0, 600, 200, 420, 60, 140);
      // 遮阳篷
      for (let x = A.x0 - (A.x0 % 120) - 120, i = 0; x < A.x0 + A.w; x += 120, i++) {
        ctx.fillStyle = i % 2 ? '#fffaf4' : '#f7a8bf'; ctx.globalAlpha = 0.6;
        ctx.fillRect(x, A.y0, 120, 40 - A.y0); ctx.beginPath(); ctx.ellipse(x + 60, 40, 60, 34, 0, 0, Math.PI); ctx.fill();
      }
      ctx.globalAlpha = 0.22; ctx.strokeStyle = INK; ctx.lineWidth = 3; ctx.beginPath();
      for (let x = A.x0 - (A.x0 % 120) - 120; x < A.x0 + A.w; x += 120) { ctx.moveTo(x + 120, 40); ctx.ellipse(x + 60, 40, 60, 34, 0, 0, Math.PI); }
      ctx.stroke(); ctx.globalAlpha = 1;
      for (const [x, y, k] of [[380, 230, 1.2], [960, 180, 0.9], [2120, 200, 1.1], [2700, 250, 1.3]] as const) cloud(ctx, x, y, k, '#fffaf4', INK, 0.85);
      // 彩针糖
      const cs = ['#f27cb0', '#7cc4ec', '#ffd23a', '#9ad66a', '#c8a4f0'];
      for (let i = 0; i < 160; i++) {
        const x = r() * W, y = 80 + r() * 520, a = r() * Math.PI;
        ctx.save(); ctx.translate(x, y); ctx.rotate(a); ctx.globalAlpha = 0.5; ctx.fillStyle = cs[i % 5]!; ctx.beginPath(); ctx.roundRect(-9, -3, 18, 6, 3); ctx.fill(); ctx.restore();
      }
      ctx.globalAlpha = 1;
      // 远处一根威化棒和一颗樱桃（离开塔顶，免得被当成地形）
      ctx.globalAlpha = 0.3; ctx.fillStyle = '#f6cd8a'; ctx.save(); ctx.translate(2420, 110); ctx.rotate(0.4); ctx.fillRect(-14, -90, 28, 180); ctx.restore();
      ctx.fillStyle = '#e2432a'; ctx.beginPath(); ctx.arc(640, 120, 30, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#57b043'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(640, 92); ctx.quadraticCurveTo(650, 50, 680, 30); ctx.stroke();
      ctx.globalAlpha = 1;
    },
  },
  // 雪夜：深蓝夜空、月亮、远山、一串红灯笼、雪花，左上角饺子铺的屋檐和招牌
  dumpling: {
    name: '雪夜', base: '#24305c', mist: '#4a5a8a', mistDeep: '#2a3560', fog: '#c8d4ec', desk: '#1c1830', deskLine: '#2c2848', night: true,
    paint(ctx, W, H, A, r) {
      const g = ctx.createLinearGradient(0, A.y0, 0, 700); g.addColorStop(0, '#1a2248'); g.addColorStop(0.6, '#2c3a6c'); g.addColorStop(1, '#46588c');
      ctx.fillStyle = g; ctx.fillRect(A.x0, A.y0, A.w, A.h);
      halo(ctx, 2250, 210, 150, '#fff4c8', 0.05, 6);
      ctx.fillStyle = '#fff4c8'; ctx.beginPath(); ctx.arc(2250, 210, 46, 0, TAU); ctx.fill();
      ctx.fillStyle = '#e8dcae'; ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.arc(2264, 200, 9, 0, TAU); ctx.arc(2238, 224, 6, 0, TAU); ctx.fill(); ctx.globalAlpha = 1;
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 120; i++) { ctx.globalAlpha = 0.3 + r() * 0.5; ctx.beginPath(); ctx.arc(r() * W, A.y0 + r() * (400 - A.y0), 1.5 + r() * 2, 0, TAU); ctx.fill(); }
      // 远山两层
      for (const [y, c, a, amp] of [[420, '#5a6c9c', 0.55, 120], [470, '#6f82b0', 0.6, 80]] as const) {
        ctx.globalAlpha = a; ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(A.x0, 800);
        for (let x = A.x0; x <= A.x0 + A.w; x += 200) ctx.lineTo(x, y - amp * (0.4 + 0.6 * r()));
        ctx.lineTo(A.x0 + A.w, 800); ctx.fill();
        // 山顶的雪
        ctx.globalAlpha = a * 0.6; ctx.fillStyle = '#dfe8f6';
        for (let x = A.x0; x <= A.x0 + A.w; x += 400) { ctx.beginPath(); ctx.ellipse(x + 100, y - amp * 0.8, 50, 14, 0, 0, TAU); ctx.fill(); }
      }
      ctx.globalAlpha = 1;
      stringOfLanterns(ctx, -200, W + 200, -30, 30, 9, 1.4, 0.85);
      // 饺子铺屋檐和招牌（左上），右边一家馄饨摊（化名）
      for (const [x, s] of [[120, '阿团饺子'], [2640, '小熊馄饨']] as const) {
        ctx.globalAlpha = 0.55; ctx.fillStyle = '#3a2a3a'; ctx.beginPath(); ctx.moveTo(x - 40, 300); ctx.lineTo(x + 140, 250); ctx.lineTo(x + 320, 300); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#eef4fb'; ctx.beginPath(); ctx.moveTo(x - 40, 300); ctx.lineTo(x + 140, 250); ctx.lineTo(x + 320, 300); ctx.lineTo(x + 300, 306); ctx.lineTo(x + 140, 262); ctx.lineTo(x - 20, 306); ctx.fill();
        ctx.globalAlpha = 0.75; ctx.fillStyle = '#b8322a'; ctx.beginPath(); ctx.roundRect(x + 40, 314, 200, 64, 8); ctx.fill();
        text(ctx, s, x + 140, 347, 40, '#ffe6a8', 0.95);
        // 门口的热气
        ctx.globalAlpha = 0.3; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.beginPath();
        for (const dx of [60, 140, 220]) { ctx.moveTo(x + dx, 240); ctx.bezierCurveTo(x + dx - 20, 210, x + dx + 20, 190, x + dx, 160); }
        ctx.stroke(); ctx.globalAlpha = 1;
      }
      // 雪花
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 220; i++) { ctx.globalAlpha = 0.35 + r() * 0.45; ctx.beginPath(); ctx.arc(r() * W, r() * 760, 2 + r() * 3.5, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
    },
  },
  // 便当：浅蓝格子餐布、餐盒的木框、一双筷子、绿色隔叶
  bento: {
    name: '野餐布', base: '#f3f7fb', mist: '#cfd8e4', mistDeep: '#a4b2c6', fog: '#f6f9fc', desk: '#2e2a26', deskLine: '#443c34',
    paint(ctx, W, H, A, r) {
      ctx.fillStyle = this.base; ctx.fillRect(A.x0, A.y0, A.w, A.h);
      ctx.fillStyle = '#9ec2e6';
      const S = 120;
      for (let x = A.x0 - (A.x0 % S) - S; x < A.x0 + A.w; x += S) { ctx.globalAlpha = 0.22; ctx.fillRect(x, A.y0, S / 2, A.h); }
      for (let y = A.y0 - (A.y0 % S) - S; y < A.y0 + A.h; y += S) { ctx.globalAlpha = 0.22; ctx.fillRect(A.x0, y, A.w, S / 2); }
      ctx.globalAlpha = 1;
      blobs(ctx, r, 24, '#ffffff', 0.25, 0, W, 0, 600, 200, 400, 60, 120);
      // 餐盒木框（远处一圈）
      ctx.globalAlpha = 0.28; ctx.strokeStyle = '#a8703c'; ctx.lineWidth = 40; ctx.beginPath(); ctx.roundRect(-120, -120, W + 240, 840, 80); ctx.stroke();
      ctx.lineWidth = 6; ctx.strokeStyle = INK; ctx.globalAlpha = 0.12; ctx.beginPath(); ctx.roundRect(-100, -100, W + 200, 800, 70); ctx.stroke();
      ctx.globalAlpha = 1;
      // 筷子
      ctx.save(); ctx.globalAlpha = 0.35; ctx.translate(2150, 60); ctx.rotate(-0.12);
      for (const dy of [0, 34]) { ctx.fillStyle = '#c8803a'; ctx.beginPath(); ctx.moveTo(0, dy); ctx.lineTo(760, dy + 6); ctx.lineTo(760, dy + 14); ctx.lineTo(0, dy + 22); ctx.fill(); ctx.fillStyle = '#e2432a'; ctx.fillRect(0, dy, 120, 22); }
      ctx.restore();
      // 芝麻
      ctx.fillStyle = INK;
      for (let i = 0; i < 70; i++) { ctx.globalAlpha = 0.18; ctx.beginPath(); ctx.ellipse(r() * W, 100 + r() * 500, 4, 2, r() * 3, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
    },
  },
  // 夜市：紫色黄昏、远处一排摊子屋顶、两串灯笼、招牌（化名）
  nightmarket: {
    name: '夜市', base: '#2b2350', mist: '#5a4a7a', mistDeep: '#2e2648', fog: '#d8c8e8', desk: '#1c1626', deskLine: '#2c2440', night: true,
    paint(ctx, W, H, A, r) {
      const g = ctx.createLinearGradient(0, A.y0, 0, 620); g.addColorStop(0, '#1e1a40'); g.addColorStop(0.55, '#3c2f66'); g.addColorStop(0.85, '#7a4f78'); g.addColorStop(1, '#b8705a');
      ctx.fillStyle = g; ctx.fillRect(A.x0, A.y0, A.w, A.h);
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < 90; i++) { ctx.globalAlpha = 0.25 + r() * 0.5; ctx.beginPath(); ctx.arc(r() * W, A.y0 + r() * (300 - A.y0), 1.5 + r() * 2, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
      // 远处的摊子屋顶剪影 + 亮着的小窗：压得很暗、窗子小，免得被当成能站的台子
      for (let x = -400; x < W + 400; x += 180 + Math.floor(r() * 80)) {
        const w = 150 + r() * 60, top = 300 + r() * 60;
        ctx.globalAlpha = 0.45; ctx.fillStyle = '#2a2148'; ctx.beginPath(); ctx.moveTo(x, 640); ctx.lineTo(x, top + 30); ctx.lineTo(x + w / 2, top); ctx.lineTo(x + w, top + 30); ctx.lineTo(x + w, 640); ctx.fill();
        halo(ctx, x + w / 2, top + 62, 26, '#ffcf6a', 0.06, 3);
        ctx.globalAlpha = 0.35; ctx.fillStyle = '#ffcf6a'; ctx.beginPath(); ctx.arc(x + w / 2, top + 62, 7, 0, TAU); ctx.fill();
      }
      ctx.globalAlpha = 1;
      stringOfLanterns(ctx, -200, W + 200, 20, 26, 10, 1.3, 1);
      // 招牌（化名的小吃）
      // 招牌挂得比雨棚高、颜色压暗，不和名牌、雨棚抢
      for (const [x, y, s, c] of [[300, 170, '糖葫芦', '#a8382a'], [900, 150, '烤肠', '#a8602a'], [1500, 170, '冰粉', '#2f5fa8'], [2100, 150, '炸串', '#a8382a'], [2650, 170, '鸡蛋仔', '#a8802a']] as const) {
        ctx.globalAlpha = 0.5; ctx.fillStyle = c; ctx.beginPath(); ctx.roundRect(x - 74, y - 28, 148, 56, 10); ctx.fill();
        ctx.strokeStyle = '#ffe6a8'; ctx.lineWidth = 3; ctx.stroke();
        text(ctx, s, x, y, 34, '#fff6dc', 0.7);
      }
      ctx.globalAlpha = 1;
    },
  },
  // 早餐：暖黄的墙、一扇朝东的窗（太阳刚出来）、红格子窗帘、斜照进来的光、远处一台面包机
  breakfast: {
    name: '早餐桌', base: '#fff3dc', mist: '#e8d8c4', mistDeep: '#c4ae98', fog: '#fff8ec', desk: '#3a2a1f', deskLine: '#523c2c',
    paint(ctx, W, H, A, r) {
      ctx.fillStyle = this.base; ctx.fillRect(A.x0, A.y0, A.w, A.h);
      blobs(ctx, r, 30, '#f6dcb0', 0.3, 0, W, 0, 600, 200, 420, 60, 140);
      // 竖条墙纸
      ctx.fillStyle = '#f2d6a8'; ctx.globalAlpha = 0.25;
      for (let x = A.x0 - (A.x0 % 90); x < A.x0 + A.w; x += 90) ctx.fillRect(x, A.y0, 30, 600 - A.y0);
      ctx.globalAlpha = 1;
      // 窗和太阳
      ctx.fillStyle = '#cfe6f2'; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.roundRect(1240, 0, 520, 300, 16); ctx.fill();
      halo(ctx, 1500, 210, 160, '#ffd86a', 0.08, 6);
      ctx.fillStyle = '#ffcf4a'; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.arc(1500, 230, 60, Math.PI, 0); ctx.fill();
      ctx.globalAlpha = 0.3; ctx.strokeStyle = INK; ctx.lineWidth = 4; ctx.beginPath(); ctx.roundRect(1240, 0, 520, 300, 16); ctx.moveTo(1500, 0); ctx.lineTo(1500, 300); ctx.moveTo(1240, 150); ctx.lineTo(1760, 150); ctx.stroke();
      // 窗帘：红白格子（叠两层半透明条纹）
      for (const [x, dir] of [[1180, 1], [1820, -1]] as const) {
        ctx.save(); ctx.beginPath(); ctx.moveTo(x - 90 * dir, -20); ctx.lineTo(x + 90 * dir, -20); ctx.quadraticCurveTo(x + 10 * dir, 160, x + 50 * dir, 340); ctx.lineTo(x - 90 * dir, 340); ctx.closePath(); ctx.clip();
        ctx.fillStyle = '#fffaf0'; ctx.globalAlpha = 0.8; ctx.fillRect(x - 100, -20, 200, 380);
        ctx.fillStyle = '#e2432a'; ctx.globalAlpha = 0.28;
        for (let k = -120; k < 120; k += 40) ctx.fillRect(x + k, -20, 20, 380);
        for (let k = -20; k < 360; k += 40) ctx.fillRect(x - 100, k, 200, 20);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      // 斜照的光
      ctx.fillStyle = '#fff6d0'; ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.moveTo(1240, 300); ctx.lineTo(1760, 300); ctx.lineTo(2300, 760); ctx.lineTo(1500, 760); ctx.fill();
      ctx.globalAlpha = 1;
      // 面包机（远处）
      ctx.globalAlpha = 0.3; ctx.fillStyle = '#b4c4d0'; ctx.beginPath(); ctx.roundRect(300, 160, 300, 180, 40); ctx.fill();
      ctx.fillStyle = '#7f93a3'; ctx.fillRect(360, 160, 70, 14); ctx.fillRect(470, 160, 70, 14);
      ctx.fillStyle = '#e6c08a'; ctx.beginPath(); ctx.roundRect(372, 110, 46, 60, 8); ctx.roundRect(482, 120, 46, 50, 8); ctx.fill();
      ctx.globalAlpha = 1;
    },
  },
};

/**
 * 画远景（墙/天空 + 装饰 + 往下淡成的雾），不含纸边外的书桌。
 * A：烘焙范围（世界坐标）{x0, y0, w, h}，游戏里是 {x0: -700, y0: -900, w: 地图宽 + 1400, h: 2100}（backdrop.ts）。
 */
export function paintBackdrop(ctx: Ctx, theme: ThemeId, W: number, H: number, A: Area): void {
  const th = THEMES[theme];
  const r = lcg(7);
  ctx.save();
  th.paint(ctx, W, H, A, r);
  fog(ctx, th, W, H, A, lcg(31));
  ctx.restore();
}
