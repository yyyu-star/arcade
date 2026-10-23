/**
 * 0.4.0 新增 5 张图的画面数据（美术代理 2026-10-23 交付的程序画法，照原样改写成 TS）：新材质的颜色和纹理、远景主题、卡片文案、焦痕的底色分类。
 * 格式和 view/mapArt.ts、view/terrainPaint.ts、view/backdrops.ts、view/scorchPaint.ts 现有的一样，分别并进去：
 * - MATERIALS2 → mapArt.ts 的 MATERIALS；TexId2 并进 TexId；MAP_ART2 → MAP_ART；
 * - TEX2 → terrainPaint.ts 的 TEX；ThemeId2 并进 ThemeId，THEMES2 → backdrops.ts 的 THEMES；
 * - GROUND_TONE2 → scorchPaint.ts 的 GROUND_TONE。
 * 纹理、远景用的 hash、tiles、blobs、halo、cloud 和老图共用一份（view/paintKit.ts）。
 * 缩略图（thumb.ts）只用材质的 grad[1]、crust 和远景主题，不用另配颜色。
 * 规矩照旧：纹理全按世界坐标取随机数，块和块接得上；不用滤镜、阴影；远景整张烘焙一次。
 */
import type { Material } from './mapArt.ts';
import type { MapId2, MaterialId2 } from '../core/mapData2.ts';
import type { Area, Theme } from './backdrops.ts';
import type { Tone } from './scorchPaint.ts';

import { blobs, cloud, halo, hash, tiles } from './paintKit.ts';
import { INK } from './palette.ts';

type Ctx = CanvasRenderingContext2D;
const TAU = Math.PI * 2;

export type TexId2 = 'crumb' | 'piping' | 'spiral' | 'foil' | 'hammered' | 'speckle' | 'shrimp' | 'basil' | 'cheese' | 'grain' | 'fatlines' | 'floral' | 'sugar';
export type ThemeId2 = 'cake' | 'hotpot' | 'pizza' | 'sushi' | 'teatime';

// ---------------- 材质 ----------------
// grad 是按世界坐标 y = 120 → 700 的一条竖直渐变（和现有材质一样），所以浮得高的东西（火苗、蜡烛）取的是前两档。
// tex 里引用的老纹理：pores（豆腐、饼底）、strawseed（果酱）、none。
export const MATERIALS2: Readonly<Record<MaterialId2, Material>> = {
  sponge: { code: 26, name: '蛋糕坯', grad: ['#fff1c4', '#fbe2a0', '#f2cc7e', '#e0ae5c'], crust: '#f6d58c', rim: '#c8904a', crumb: ['#fbe2a0', '#fff6e0'], tex: 'crumb' },
  cream: { code: 27, name: '奶油', grad: ['#ffffff', '#fff6f8', '#fde6ec', '#f6d2dc'], crust: '#ffffff', rim: '#e8a8b8', crumb: ['#ffffff', '#fbd0dc'], tex: 'piping' },
  candle: { code: 28, name: '蜡烛', grad: ['#c9e6ff', '#b4d8fa', '#9cc6f2', '#86b2e6'], crust: null, rim: '#4f7fc0', crumb: ['#b4d8fa', '#ffffff'], tex: 'spiral' },
  flame: { code: 29, name: '火苗', grad: ['#ffd84a', '#ffbc2e', '#ff9a22', '#ff7a1a'], crust: null, rim: '#e8601a', crumb: ['#ffd84a', '#fff6c0'], tex: 'none' },
  cakeboard: { code: 30, name: '金色蛋糕托', grad: ['#fff0b0', '#f6d870', '#e8bc48', '#d09a30'], crust: '#fff4c8', rim: '#a87a20', crumb: ['#f6d870', '#fff4c8'], tex: 'foil' },
  copper: { code: 31, name: '铜锅', grad: ['#f2a878', '#de8a56', '#c26c40', '#9a4c2c'], crust: '#ffd2a2', rim: '#6a2e1a', crumb: ['#de8a56', '#ffd2a2'], tex: 'hammered' },
  tofu: { code: 32, name: '豆腐', grad: ['#fffdf2', '#fbf6e2', '#f1e8c8', '#e2d4a8'], crust: '#fffef8', rim: '#c8b07a', crumb: ['#fbf6e2', '#e2d4a8'], tex: 'pores' },
  meatball: { code: 33, name: '丸子', grad: ['#c98a62', '#b47450', '#9a5e3e', '#80492e'], crust: '#d9a07a', rim: '#5a3020', crumb: ['#b47450', '#6aa84f'], tex: 'speckle' },
  shrimp: { code: 34, name: '虾滑', grad: ['#ffd8c8', '#ffbea8', '#f8a288', '#e8846a'], crust: '#fff0e8', rim: '#c45a44', crumb: ['#ffbea8', '#fff0e8'], tex: 'shrimp' },
  crust: { code: 35, name: '饼底', grad: ['#f9d79a', '#efbf72', '#dc9e50', '#c07e36'], crust: '#c8803a', rim: '#8a5020', crumb: ['#efbf72', '#c8803a'], tex: 'pores' },
  sauce: { code: 36, name: '番茄酱', grad: ['#f0644a', '#e04a34', '#c83a28', '#a82e20'], crust: '#ff7a5a', rim: '#7a1e14', crumb: ['#e04a34', '#5a9a3a'], tex: 'basil' },
  cheese: { code: 37, name: '芝士', grad: ['#fff0a0', '#ffe070', '#f8c848', '#eeb030'], crust: '#fff6c0', rim: '#d88a10', crumb: ['#ffe070', '#fff6c0'], tex: 'cheese' },
  pepperoni: { code: 38, name: '腊肠片', grad: ['#e86050', '#d04838', '#b8382a', '#98281e'], crust: '#f07a6a', rim: '#6a1810', crumb: ['#d04838', '#ffe0d0'], tex: 'speckle' },
  hinoki: { code: 39, name: '柜台木', grad: ['#f6deb0', '#ecca92', '#dcb074', '#c4945a'], crust: '#fbe8c4', rim: '#9a6a34', crumb: ['#ecca92', '#c4945a'], tex: 'grain' },
  salmon: { code: 40, name: '三文鱼', grad: ['#ffb282', '#ff9c64', '#f6864c', '#e26c34'], crust: '#ffc8a0', rim: '#c0502a', crumb: ['#ff9c64', '#ffffff'], tex: 'fatlines' },
  tuna: { code: 41, name: '金枪鱼', grad: ['#f0606a', '#dc4652', '#c4343e', '#a8262e'], crust: '#f8808a', rim: '#7a1820', crumb: ['#dc4652', '#ffd0d4'], tex: 'fatlines' },
  wasabi: { code: 42, name: '芥末', grad: ['#c8e890', '#aedc6c', '#94c850', '#78b03a'], crust: '#d8f0a8', rim: '#4a7a20', crumb: ['#aedc6c', '#d8f0a8'], tex: 'speckle' },
  gari: { code: 43, name: '姜片', grad: ['#ffe8e8', '#fdd2d4', '#f6b8bc', '#ea9ca2'], crust: '#fff2f2', rim: '#c8707a', crumb: ['#fdd2d4', '#fff2f2'], tex: 'none' },
  porcelain: { code: 44, name: '白瓷', grad: ['#ffffff', '#f6f8fc', '#e8eef8', '#d4dff0'], crust: '#ffffff', rim: '#7a96c4', crumb: ['#ffffff', '#4f78c0'], tex: 'floral' },
  sugar: { code: 45, name: '方糖', grad: ['#ffffff', '#fbfbf8', '#f0efe8', '#dedcd0'], crust: '#ffffff', rim: '#bdb8a8', crumb: ['#ffffff', '#e8e6dc'], tex: 'sugar' },
  macaron: { code: 46, name: '马卡龙（粉）', grad: ['#ffd6e4', '#fbbcd2', '#f2a0bc', '#e084a4'], crust: '#ffe6ee', rim: '#c06084', crumb: ['#fbbcd2', '#ffffff'], tex: 'none' },
  pistachio: { code: 47, name: '马卡龙（开心果）', grad: ['#e0f2c4', '#cce8a8', '#b4d888', '#9cc46c'], crust: '#eef8dc', rim: '#6a9a3a', crumb: ['#cce8a8', '#ffffff'], tex: 'none' },
  spoon: { code: 48, name: '银勺', grad: ['#f4f6fa', '#dfe4ec', '#c4ccd8', '#a8b2c2'], crust: '#ffffff', rim: '#6a7486', crumb: ['#dfe4ec', '#ffffff'], tex: 'foil' },
  scone: { code: 49, name: '司康', grad: ['#f8dca8', '#ecc486', '#dca866', '#c48c4a'], crust: '#c8803a', rim: '#8a5a28', crumb: ['#ecc486', '#c48c4a'], tex: 'crumb' },
  jam: { code: 50, name: '果酱', grad: ['#f0506a', '#d83a54', '#c02c44', '#a02036'], crust: '#ff7a90', rim: '#7a1424', crumb: ['#d83a54', '#ffd0d8'], tex: 'strawseed' },
};

/** 焦痕的底色（scorchPaint.ts 的 GROUND_TONE）：中间色亮度 ≥ 0.82 算浅色（球拍网格加深）；红色系（西瓜汁会糊进去，加白籽） */
export const GROUND_TONE2: Readonly<Record<MaterialId2, Tone>> = {
  sponge: 'light', cream: 'light', candle: 'light', flame: 'light', cakeboard: 'light',
  copper: null, tofu: 'light', meatball: null, shrimp: 'light',
  crust: null, sauce: 'red', cheese: 'light', pepperoni: 'red',
  hinoki: 'light', salmon: null, tuna: 'red', wasabi: null, gari: 'light',
  porcelain: 'light', sugar: 'light', macaron: 'light', pistachio: 'light', spoon: 'light', scone: null, jam: 'red',
};

// ---------------- 纹理（和 terrainPaint.ts 的 TEX 同一个签名：ctx 已裁到这种材质的区域里） ----------------
export const TEX2: Record<TexId2, (ctx: Ctx, x0: number, y0: number, w: number, h: number) => void> = {
  // 蛋糕坯、司康：细密的小气孔，一点点深色
  crumb(ctx, x0, y0, w, h) {
    ctx.fillStyle = '#b8803c'; ctx.globalAlpha = 0.32; ctx.beginPath();
    tiles(x0, y0, w, h, 12, (tx, ty, x, y, v) => { if (v > 0.55) return; const r = 0.9 + v * 1.6; ctx.moveTo(x + r, y); ctx.ellipse(x, y, r, r * 0.7, 0, 0, TAU); });
    ctx.fill();
    ctx.fillStyle = '#fffaf0'; ctx.globalAlpha = 0.4; ctx.beginPath();
    tiles(x0, y0, w, h, 20, (tx, ty, x, y, v) => { if (v > 0.4) return; ctx.moveTo(x + 1.4, y); ctx.arc(x, y, 1.4, 0, TAU); });
    ctx.fill();
  },
  // 奶油：一排排挤花的小弯（像裱花袋挤出来的波纹）
  piping(ctx, x0, y0, w, h) {
    ctx.strokeStyle = '#f2b8c8'; ctx.lineWidth = 1.8; ctx.globalAlpha = 0.65; ctx.lineCap = 'round'; ctx.beginPath();
    for (let y = Math.floor(y0 / 14) * 14; y < y0 + h + 14; y += 14) {
      const o = (y / 14) % 2 ? 9 : 0;
      for (let x = Math.floor(x0 / 18) * 18 - 18; x < x0 + w + 18; x += 18) { ctx.moveTo(x + o, y + 4); ctx.quadraticCurveTo(x + o + 9, y - 5, x + o + 18, y + 4); }
    }
    ctx.stroke();
  },
  // 蜡烛：斜着的白色螺旋条
  spiral(ctx, x0, y0, w, h) {
    ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.85; ctx.beginPath();
    for (let k = Math.floor((y0 - w - 20) / 18) * 18; k < y0 + h + w + 20; k += 18) { ctx.moveTo(x0 - 2, k); ctx.lineTo(x0 + w + 2, k - (w + 4) * 0.7); ctx.lineTo(x0 + w + 2, k - (w + 4) * 0.7 + 7); ctx.lineTo(x0 - 2, k + 7); ctx.closePath(); }
    ctx.fill();
  },
  // 金箔、银勺：斜的亮光
  foil(ctx, x0, y0, w, h) {
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2.4; ctx.globalAlpha = 0.6; ctx.lineCap = 'round'; ctx.beginPath();
    tiles(x0, y0, w, h, 46, (tx, ty, x, y, v) => { if (v > 0.5) return; ctx.moveTo(x - 6, y + 3); ctx.lineTo(x + 6, y - 3); ctx.moveTo(x + 10, y + 1); ctx.lineTo(x + 13, y - 0.5); });
    ctx.stroke();
  },
  // 铜锅：锤出来的一个个浅窝（暗边 + 右下亮点）
  hammered(ctx, x0, y0, w, h) {
    ctx.strokeStyle = '#8a4428'; ctx.lineWidth = 1.3; ctx.globalAlpha = 0.35; ctx.beginPath();
    tiles(x0, y0, w, h, 22, (tx, ty, x, y, v) => { if (v > 0.8) return; const r = 4 + v * 3; ctx.moveTo(x + r, y); ctx.ellipse(x, y, r, r * 0.8, 0, 0, TAU); });
    ctx.stroke();
    ctx.fillStyle = '#ffe0b8'; ctx.globalAlpha = 0.55; ctx.beginPath();
    tiles(x0, y0, w, h, 22, (tx, ty, x, y, v) => { if (v > 0.8) return; ctx.moveTo(x + 2.4, y + 2); ctx.arc(x + 1.4, y + 2, 1.2, 0, TAU); });
    ctx.fill();
  },
  // 丸子、腊肠、芥末：深浅两色的碎点
  speckle(ctx, x0, y0, w, h) {
    ctx.fillStyle = INK; ctx.globalAlpha = 0.28; ctx.beginPath();
    tiles(x0, y0, w, h, 11, (tx, ty, x, y, v) => { if (v > 0.5) return; const r = 0.8 + v * 1.4; ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); });
    ctx.fill();
    ctx.fillStyle = '#fff4e0'; ctx.globalAlpha = 0.45; ctx.beginPath();
    tiles(x0, y0, w, h, 17, (tx, ty, x, y, v) => { if (v > 0.35) return; const r = 1.2 + v * 2; ctx.moveTo(x + r, y); ctx.ellipse(x, y, r, r * 0.6, v * 6, 0, TAU); });
    ctx.fill();
  },
  // 虾滑：一道道弯弯的白色纹（虾肉的纹理）
  shrimp(ctx, x0, y0, w, h) {
    ctx.strokeStyle = '#fff4ee'; ctx.lineWidth = 3; ctx.globalAlpha = 0.7; ctx.lineCap = 'round'; ctx.beginPath();
    for (let x = Math.floor(x0 / 22) * 22 - 22; x < x0 + w + 22; x += 22) { ctx.moveTo(x, y0 - 2); ctx.quadraticCurveTo(x + 14, y0 + h / 2, x, y0 + h + 2); }
    ctx.stroke();
  },
  // 番茄酱：罗勒碎（绿色小叶）
  basil(ctx, x0, y0, w, h) {
    ctx.fillStyle = '#4f9a36'; ctx.globalAlpha = 0.85; ctx.beginPath();
    tiles(x0, y0, w, h, 26, (tx, ty, x, y, v) => { if (v > 0.45) return; ctx.moveTo(x + 3.4, y); ctx.ellipse(x, y, 3.4, 1.6, v * 7, 0, TAU); });
    ctx.fill();
  },
  // 芝士：几个圆洞（深一点的圈 + 亮边）和拉丝
  cheese(ctx, x0, y0, w, h) {
    ctx.fillStyle = '#eeb030'; ctx.globalAlpha = 0.55; ctx.beginPath();
    tiles(x0, y0, w, h, 34, (tx, ty, x, y, v) => { if (v > 0.5) return; const r = 3 + v * 6; ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, TAU); });
    ctx.fill();
    ctx.strokeStyle = '#fff8d0'; ctx.lineWidth = 1.6; ctx.globalAlpha = 0.7; ctx.lineCap = 'round'; ctx.beginPath();
    tiles(x0, y0, w, h, 34, (tx, ty, x, y, v) => { if (v > 0.5) return; const r = 3 + v * 6; ctx.moveTo(x - r * 0.7, y + r * 0.7); ctx.arc(x, y, r, Math.PI * 0.75, Math.PI * 1.25); });
    ctx.stroke();
  },
  // 柜台木：横着的木纹（长弧线）+ 几个节疤
  grain(ctx, x0, y0, w, h) {
    ctx.strokeStyle = '#b88a52'; ctx.lineWidth = 1.4; ctx.globalAlpha = 0.5; ctx.beginPath();
    for (let y = Math.floor(y0 / 12) * 12; y < y0 + h + 12; y += 12) {
      ctx.moveTo(x0 - 2, y);
      for (let x = Math.floor(x0 / 140) * 140; x < x0 + w + 140; x += 140) ctx.quadraticCurveTo(x + 70, y + (hash(x, y) - 0.5) * 8, x + 140, y);
    }
    ctx.stroke();
    ctx.strokeStyle = '#9a6a34'; ctx.lineWidth = 1.6; ctx.globalAlpha = 0.55; ctx.beginPath();
    tiles(x0, y0, w, h, 120, (tx, ty, x, y, v) => { if (v > 0.35) return; ctx.moveTo(x + 9, y); ctx.ellipse(x, y, 9, 4, 0, 0, TAU); ctx.moveTo(x + 4, y); ctx.ellipse(x, y, 4, 1.8, 0, 0, TAU); });
    ctx.stroke();
  },
  // 三文鱼、金枪鱼：斜着的白色脂肪纹
  fatlines(ctx, x0, y0, w, h) {
    ctx.strokeStyle = '#fff4ea'; ctx.lineWidth = 2.6; ctx.globalAlpha = 0.75; ctx.lineCap = 'round'; ctx.beginPath();
    for (let x = Math.floor(x0 / 16) * 16 - 32; x < x0 + w + 32; x += 16) { ctx.moveTo(x, y0 - 2); ctx.quadraticCurveTo(x + 10, y0 + h * 0.5, x + 4, y0 + h + 2); }
    ctx.stroke();
  },
  // 白瓷：青花小花（五瓣）+ 一道道细边
  floral(ctx, x0, y0, w, h) {
    ctx.fillStyle = '#5a82c8'; ctx.globalAlpha = 0.6; ctx.beginPath();
    tiles(x0, y0, w, h, 54, (tx, ty, x, y, v) => {
      if (v > 0.45) return;
      for (let k = 0; k < 5; k++) { const a = (k * TAU) / 5 + v; const px = x + Math.cos(a) * 4.2, py = y + Math.sin(a) * 4.2; ctx.moveTo(px + 2.8, py); ctx.arc(px, py, 2.8, 0, TAU); }
    });
    ctx.fill();
    ctx.fillStyle = '#ffffff'; ctx.globalAlpha = 0.9; ctx.beginPath();
    tiles(x0, y0, w, h, 54, (tx, ty, x, y, v) => { if (v > 0.45) return; ctx.moveTo(x + 1.8, y); ctx.arc(x, y, 1.8, 0, TAU); });
    ctx.fill();
    ctx.strokeStyle = '#7a96c4'; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.45; ctx.beginPath();
    tiles(x0, y0, w, h, 54, (tx, ty, x, y, v) => { if (v < 0.75) return; ctx.moveTo(x - 7, y); ctx.quadraticCurveTo(x, y - 6, x + 7, y); ctx.quadraticCurveTo(x + 12, y + 4, x + 16, y); });
    ctx.stroke();
  },
  // 方糖：小方晶粒
  sugar(ctx, x0, y0, w, h) {
    ctx.fillStyle = '#c8c4b4'; ctx.globalAlpha = 0.5; ctx.beginPath();
    tiles(x0, y0, w, h, 9, (tx, ty, x, y, v) => { if (v > 0.55) return; ctx.rect(x, y, 1.6, 1.6); });
    ctx.fill();
    ctx.strokeStyle = '#a8c8e8'; ctx.lineWidth = 1; ctx.globalAlpha = 0.6; ctx.beginPath();
    tiles(x0, y0, w, h, 30, (tx, ty, x, y, v) => { if (v > 0.35) return; ctx.moveTo(x - 2.5, y); ctx.lineTo(x + 2.5, y); ctx.moveTo(x, y - 2.5); ctx.lineTo(x, y + 2.5); });
    ctx.stroke();
  },
};

// ---------------- 远景（和 backdrops.ts 的 THEMES 同一个格式） ----------------
/** 一串三角小旗：x0 → x1，下垂 sag */
function bunting(ctx: Ctx, x0: number, x1: number, y: number, sag: number, colors: readonly string[], alpha: number): void {
  ctx.globalAlpha = alpha; ctx.strokeStyle = INK; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(x0, y); ctx.quadraticCurveTo((x0 + x1) / 2, y + sag * 2, x1, y); ctx.stroke();
  const n = Math.max(2, Math.floor((x1 - x0) / 70));
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n, x = x0 + (x1 - x0) * t, yy = y + sag * 4 * t * (1 - t);
    ctx.fillStyle = colors[i % colors.length]!;
    ctx.beginPath(); ctx.moveTo(x - 22, yy); ctx.lineTo(x + 22, yy); ctx.lineTo(x, yy + 44); ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
/** 气球：椭圆 + 小结 + 弯弯的线 */
function balloon(ctx: Ctx, x: number, y: number, k: number, color: string, alpha: number): void {
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = INK; ctx.lineWidth = 2.4; ctx.beginPath(); ctx.moveTo(x, y + 60 * k); ctx.quadraticCurveTo(x + 18 * k, y + 120 * k, x - 6 * k, y + 190 * k); ctx.stroke();
  ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, y, 42 * k, 54 * k, 0, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x - 7 * k, y + 60 * k); ctx.lineTo(x + 7 * k, y + 60 * k); ctx.lineTo(x, y + 52 * k); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.globalAlpha = alpha * 0.6; ctx.beginPath(); ctx.ellipse(x - 14 * k, y - 20 * k, 9 * k, 15 * k, -0.4, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
}
function chochin(ctx: Ctx, x: number, y: number, k: number, alpha: number): void {
  ctx.globalAlpha = alpha;
  halo(ctx, x, y, 60 * k, '#ffe6a8', 0.05 * alpha, 4);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = '#3a2a22'; ctx.fillRect(x - 14 * k, y - 40 * k, 28 * k, 8 * k); ctx.fillRect(x - 14 * k, y + 32 * k, 28 * k, 8 * k);
  ctx.fillStyle = '#fff4dc'; ctx.beginPath(); ctx.ellipse(x, y, 26 * k, 34 * k, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#d8b88a'; ctx.lineWidth = 2; ctx.beginPath();
  for (let i = -2; i <= 2; i++) { ctx.moveTo(x - 26 * k, y + i * 11 * k); ctx.quadraticCurveTo(x, y + i * 11 * k + 4 * k, x + 26 * k, y + i * 11 * k); }
  ctx.stroke();
  ctx.fillStyle = '#c83a2a'; ctx.beginPath(); ctx.arc(x, y, 9 * k, 0, TAU); ctx.fill();
  ctx.globalAlpha = 1;
}

export const THEMES2: Readonly<Record<ThemeId2, Theme>> = {
  // 生日派对：粉白竖条的墙纸、三角彩旗、两边的气球、满墙的彩纸屑
  cake: {
    name: '生日派对', base: '#fdeef4', mist: '#ead2e4', mistDeep: '#c8a8c8', fog: '#fff6fa', desk: '#3a2630', deskLine: '#523a46',
    paint(ctx, W, H, A, r) {
      ctx.fillStyle = this.base; ctx.fillRect(A.x0, A.y0, A.w, A.h);
      ctx.fillStyle = '#fbdce8'; ctx.globalAlpha = 0.7;
      for (let x = A.x0 - (A.x0 % 120) - 120; x < A.x0 + A.w; x += 120) ctx.fillRect(x, A.y0, 60, 640 - A.y0);
      ctx.globalAlpha = 1;
      blobs(ctx, r, 30, '#f6c8dc', 0.2, 0, W, A.y0, 560, 160, 360, 60, 140);
      for (const [y, sag, x0, x1] of [[40, 30, -200, 1100], [60, 36, 1000, 2100], [40, 30, 2000, 3300]] as const)
        bunting(ctx, x0, x1, y, sag, ['#f7a8bf', '#ffd66a', '#9ad0f0', '#b8e0a0', '#d0b4f0'], 0.75);
      for (const [x, y, k, c] of [[160, 210, 1, '#f78ca8'], [280, 150, 0.85, '#ffd23a'], [380, 240, 0.9, '#7ec0f0'], [2620, 160, 0.9, '#b48ce8'], [2740, 230, 1, '#f78ca8'], [2860, 150, 0.8, '#8fd08a']] as const) balloon(ctx, x, y, k, c, 0.75);
      // 彩纸屑
      for (let i = 0; i < 140; i++) {
        ctx.fillStyle = ['#f78ca8', '#ffd23a', '#7ec0f0', '#8fd08a', '#b48ce8'][i % 5]!; ctx.globalAlpha = 0.55;
        const x = A.x0 + r() * A.w, y = A.y0 + r() * (560 - A.y0);
        ctx.save(); ctx.translate(x, y); ctx.rotate(r() * TAU); ctx.fillRect(-5, -2, 10, 4); ctx.restore();
      }
      ctx.globalAlpha = 1;
      // 蛋糕背后一圈暖光（蜡烛）
      halo(ctx, 1500, 220, 420, '#ffe6a8', 0.05, 6);
    },
  },
  // 火锅店：深红的木墙、格子窗、一排红灯笼；锅里是一半红汤一半白汤，咕嘟冒泡，热气往上飘
  hotpot: {
    name: '火锅店', base: '#4a2420', mist: '#7a3a30', mistDeep: '#3a1c18', fog: '#f0c8b0', desk: '#1e1210', deskLine: '#34201a', night: true, fogTop: 640,
    paint(ctx, W, H, A, r) {
      const g = ctx.createLinearGradient(0, A.y0, 0, 640); g.addColorStop(0, '#2e1614'); g.addColorStop(0.6, '#5a2a22'); g.addColorStop(1, '#7a3a2a');
      ctx.fillStyle = g; ctx.fillRect(A.x0, A.y0, A.w, A.h);
      // 格子窗（很暗，不抢玩法层）
      ctx.strokeStyle = '#8a4a34'; ctx.lineWidth = 6; ctx.globalAlpha = 0.35;
      for (const x0 of [700, 1700]) {
        ctx.strokeRect(x0, -60, 600, 300);
        ctx.beginPath(); for (let k = 1; k < 6; k++) { ctx.moveTo(x0 + k * 100, -60); ctx.lineTo(x0 + k * 100, 240); } for (let k = 1; k < 3; k++) { ctx.moveTo(x0, -60 + k * 100); ctx.lineTo(x0 + 600, -60 + k * 100); } ctx.stroke();
      }
      ctx.globalAlpha = 1;
      // 红灯笼（暖光）
      for (const x of [300, 600, 2400, 2700]) {
        halo(ctx, x, 120, 90, '#ffb060', 0.06, 5);
        ctx.globalAlpha = 0.8; ctx.fillStyle = '#d8382a'; ctx.beginPath(); ctx.ellipse(x, 120, 34, 42, 0, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffcf6a'; ctx.fillRect(x - 14, 72, 28, 8); ctx.fillRect(x - 14, 160, 28, 8); ctx.globalAlpha = 1;
      }
      // 热气：从锅里往上飘的白团
      for (let i = 0; i < 18; i++) { const x = 750 + r() * 1500, y = 120 + r() * 260; cloud(ctx, x, y, 0.8 + r() * 0.9, '#fff4ec', null, 0.07 + r() * 0.06); }
      // 汤：左红右白，锅沿内壁之间
      const soup = (x0: number, x1: number, top: string, deep: string): void => {
        const gg = ctx.createLinearGradient(0, 560, 0, 780); gg.addColorStop(0, top); gg.addColorStop(1, deep);
        ctx.fillStyle = gg; ctx.beginPath(); ctx.moveTo(x0, 566);
        for (let x = x0; x <= x1; x += 40) ctx.quadraticCurveTo(x + 20, 556 + (((x / 40) | 0) % 2 ? 6 : -4), x + 40, 566);
        ctx.lineTo(x1, 800); ctx.lineTo(x0, 800); ctx.closePath(); ctx.fill();
      };
      soup(640, 1500, '#e2432a', '#8a1e14');
      soup(1500, 2360, '#f6ead2', '#c8b490');
      // 汤里的辣椒、花椒（左）和葱花、枸杞（右）、泡泡
      for (let i = 0; i < 26; i++) {
        const left = i % 2 === 0, x = left ? 680 + r() * 780 : 1540 + r() * 780, y = 580 + r() * 120;
        ctx.globalAlpha = 0.85;
        if (left) { ctx.fillStyle = i % 4 ? '#a8140c' : '#5a2a1a'; ctx.beginPath(); ctx.ellipse(x, y, i % 4 ? 12 : 4, i % 4 ? 4 : 4, r() * 3, 0, TAU); ctx.fill(); }
        else { ctx.fillStyle = i % 3 ? '#6aa84f' : '#e2432a'; ctx.beginPath(); ctx.arc(x, y, i % 3 ? 4 : 3, 0, TAU); ctx.fill(); }
        ctx.strokeStyle = left ? '#ffb090' : '#ffffff'; ctx.lineWidth = 2; ctx.globalAlpha = 0.6;
        ctx.beginPath(); ctx.arc(x + 20, 568 + r() * 30, 3 + r() * 6, 0, TAU); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    },
  },
  // 披萨店：暖色砖墙，火山背后是砖炉的拱门（橙色火光），山顶冒烟，墙上挂着木铲和罗勒
  pizza: {
    name: '披萨店', base: '#f4dcc0', mist: '#e0b898', mistDeep: '#b08870', fog: '#fff0e0', desk: '#33201a', deskLine: '#4a3026',
    paint(ctx, W, H, A, r) {
      ctx.fillStyle = this.base; ctx.fillRect(A.x0, A.y0, A.w, A.h);
      ctx.strokeStyle = '#c89878'; ctx.lineWidth = 3; ctx.globalAlpha = 0.35; ctx.beginPath();
      for (let y = -900, row = 0; y < 640; y += 48, row++) {
        ctx.moveTo(A.x0, y); ctx.lineTo(A.x0 + A.w, y);
        for (let x = A.x0 - (A.x0 % 120) - 120 + (row % 2) * 60; x < A.x0 + A.w; x += 120) { ctx.moveTo(x, y); ctx.lineTo(x, y + 48); }
      }
      ctx.stroke(); ctx.globalAlpha = 1;
      // 砖炉拱门和火光
      ctx.fillStyle = '#3a2018'; ctx.globalAlpha = 0.55; ctx.beginPath(); ctx.moveTo(900, 640); ctx.lineTo(900, 300); ctx.arc(1500, 300, 600, Math.PI, 0); ctx.lineTo(2100, 640); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 1;
      halo(ctx, 1500, 520, 560, '#ff9a3a', 0.07, 7);
      ctx.strokeStyle = '#a85a3a'; ctx.lineWidth = 14; ctx.globalAlpha = 0.5; ctx.beginPath(); ctx.arc(1500, 300, 610, Math.PI, 0); ctx.stroke(); ctx.globalAlpha = 1;
      // 火星
      for (let i = 0; i < 60; i++) { ctx.fillStyle = i % 3 ? '#ffb030' : '#ff6a2a'; ctx.globalAlpha = 0.4 + r() * 0.4; ctx.beginPath(); ctx.arc(950 + r() * 1100, 120 + r() * 420, 1.5 + r() * 2.5, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
      // 山顶冒的烟
      for (let i = 0; i < 8; i++) cloud(ctx, 1500 + (i % 2 ? 50 : -40) + i * 16, 140 - i * 80, 1.1 + i * 0.35, '#f4ece6', null, 0.55 - i * 0.05);
      // 墙上：木铲、一串罗勒、一串大蒜
      ctx.globalAlpha = 0.4; ctx.fillStyle = '#b07a48';
      ctx.beginPath(); ctx.ellipse(380, 130, 80, 70, 0, 0, TAU); ctx.fill(); ctx.fillRect(370, 190, 20, 200);
      ctx.fillStyle = '#5a9a3a'; for (let k = 0; k < 7; k++) { ctx.beginPath(); ctx.ellipse(2620 + (k % 2 ? 16 : -16), 60 + k * 30, 22, 10, k % 2 ? 0.5 : -0.5, 0, TAU); ctx.fill(); }
      ctx.fillStyle = '#fff6e8'; for (let k = 0; k < 5; k++) { ctx.beginPath(); ctx.arc(2800, 60 + k * 36, 18, 0, TAU); ctx.fill(); }
      ctx.globalAlpha = 1;
    },
  },
  // 寿司店：纸拉门的格子、蓝底白浪的门帘、白纸灯笼、一排木牌（画的是鱼，不写字）
  sushi: {
    name: '寿司店', base: '#f4ead8', mist: '#d8c8b0', mistDeep: '#a8987e', fog: '#fbf4e8', desk: '#2e241c', deskLine: '#463628',
    paint(ctx, W, H, A, r) {
      ctx.fillStyle = this.base; ctx.fillRect(A.x0, A.y0, A.w, A.h);
      // 纸拉门的格子
      ctx.strokeStyle = '#a8865a'; ctx.lineWidth = 4; ctx.globalAlpha = 0.28; ctx.beginPath();
      for (let x = A.x0 - (A.x0 % 90) - 90; x < A.x0 + A.w; x += 90) { ctx.moveTo(x, A.y0); ctx.lineTo(x, 600); }
      for (let y = -900; y < 600; y += 120) { ctx.moveTo(A.x0, y); ctx.lineTo(A.x0 + A.w, y); }
      ctx.stroke(); ctx.globalAlpha = 1;
      // 门帘：蓝底，下沿开衩，白色浪纹
      for (let x0 = -200; x0 < W + 200; x0 += 800) {
        for (let k = 0; k < 4; k++) {
          const x = x0 + k * 130;
          ctx.fillStyle = '#2f4f86'; ctx.globalAlpha = 0.7; ctx.fillRect(x, -60, 120, 200);
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.globalAlpha = 0.6; ctx.beginPath();
          for (let i = 0; i < 3; i++) { ctx.moveTo(x + 10 + i * 36 + 14, 100); ctx.arc(x + 10 + i * 36, 100, 14, 0, Math.PI, true); }
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
      // 木牌：画一条小鱼
      for (let i = 0; i < 9; i++) {
        const x = 300 + i * ((W - 600) / 8), y = 200;
        ctx.globalAlpha = 0.5; ctx.fillStyle = '#c8a070'; ctx.fillRect(x - 26, y, 52, 120);
        ctx.fillStyle = ['#f6864c', '#dc4652', '#ffd95a', '#7ab0d8'][i % 4]!; ctx.beginPath(); ctx.ellipse(x, y + 60, 16, 8, 0, 0, TAU); ctx.moveTo(x + 14, y + 60); ctx.lineTo(x + 24, y + 52); ctx.lineTo(x + 24, y + 68); ctx.closePath(); ctx.fill();
      }
      ctx.globalAlpha = 1;
      for (const x of [500, 1300, 2300, 3100].filter((v) => v < W)) chochin(ctx, x, 380, 1, 0.8);
      // 远处的浪（青海波）一条
      ctx.strokeStyle = '#7a9cc8'; ctx.lineWidth = 2.4; ctx.globalAlpha = 0.25; ctx.beginPath();
      for (let x = A.x0 - (A.x0 % 60); x < A.x0 + A.w; x += 60) for (let k = 1; k <= 3; k++) { ctx.moveTo(x + 10 * k, 470); ctx.arc(x, 470, 10 * k, 0, Math.PI, true); }
      ctx.stroke(); ctx.globalAlpha = 1;
    },
  },
  // 下午茶花园：浅蓝天、白云、远处的绿篱和玫瑰、一座白色花架、几只蝴蝶
  teatime: {
    name: '花园', base: '#e6f3fb', mist: '#cfe2d8', mistDeep: '#9fbcae', fog: '#f4fbf6', desk: '#2a2e24', deskLine: '#40463a',
    paint(ctx, W, H, A, r) {
      const g = ctx.createLinearGradient(0, A.y0, 0, 600); g.addColorStop(0, '#cfe8f8'); g.addColorStop(1, '#f2f9f2');
      ctx.fillStyle = g; ctx.fillRect(A.x0, A.y0, A.w, A.h);
      halo(ctx, 300, 60, 260, '#fff6c8', 0.08, 6);
      for (const [x, y, k] of [[700, 80, 1.1], [1350, 150, 0.8], [2050, 70, 1.2], [2650, 170, 0.9], [-100, 200, 1]] as const) cloud(ctx, x, y, k, '#ffffff', INK, 0.85);
      // 白色花架（拱门）
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 16; ctx.globalAlpha = 0.85; ctx.beginPath();
      ctx.moveTo(1240, 600); ctx.lineTo(1240, 260); ctx.arc(1500, 260, 260, Math.PI, 0); ctx.lineTo(1760, 600); ctx.stroke();
      ctx.strokeStyle = '#6aa84f'; ctx.lineWidth = 5; ctx.globalAlpha = 0.6; ctx.beginPath();
      for (let a = Math.PI; a <= TAU + 0.01; a += 0.25) { const x = 1500 + Math.cos(a) * 260, y = 260 + Math.sin(a) * 260; ctx.moveTo(x - 12, y); ctx.quadraticCurveTo(x, y - 14, x + 12, y); }
      ctx.stroke(); ctx.globalAlpha = 1;
      // 绿篱和玫瑰
      ctx.fillStyle = '#9cc890'; ctx.globalAlpha = 0.75; ctx.beginPath(); ctx.moveTo(A.x0, 640);
      for (let x = A.x0 - (A.x0 % 80); x < A.x0 + A.w + 80; x += 80) ctx.quadraticCurveTo(x + 40, 470 - ((x / 80) % 3) * 12, x + 80, 500);
      ctx.lineTo(A.x0 + A.w, 640); ctx.closePath(); ctx.fill();
      for (let i = 0; i < 70; i++) { ctx.fillStyle = i % 3 ? '#f28cae' : '#e2432a'; ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.arc(A.x0 + r() * A.w, 500 + r() * 80, 6 + r() * 5, 0, TAU); ctx.fill(); }
      // 蝴蝶
      for (const [x, y, c] of [[560, 300, '#ffd23a'], [2300, 260, '#b48ce8'], [2860, 340, '#7ec0f0']] as const) {
        ctx.fillStyle = c; ctx.globalAlpha = 0.8;
        ctx.beginPath(); ctx.ellipse(x - 9, y - 4, 10, 7, -0.6, 0, TAU); ctx.ellipse(x + 9, y - 4, 10, 7, 0.6, 0, TAU); ctx.ellipse(x - 6, y + 7, 6, 5, 0.4, 0, TAU); ctx.ellipse(x + 6, y + 7, 6, 5, -0.4, 0, TAU); ctx.fill();
        ctx.fillStyle = INK; ctx.fillRect(x - 1.5, y - 8, 3, 18);
      }
      ctx.globalAlpha = 1;
    },
  },
};

// ---------------- 地图的远景主题和卡片（mapArt.ts 的 MAP_ART） ----------------
export const MAP_ART2: Readonly<Record<MapId2, { theme: ThemeId2; card: { short: string; feature: string; players: string; tag?: '快图' | '慢图' } }>> = {
  cake: { theme: 'cake', card: { short: '三层台阶，越往上越难站稳', feature: '每层台阶 110 高，走不上去，只能坐纸飞机或者挖出坡来；中层底下是空心夹层，打穿中层就掉进去，夹层的底很薄；顶层三根蜡烛一炮就断，挡平射；两头的草莓是掩体', players: '1v1–3v3' } },
  hotpot: { theme: 'hotpot', card: { short: '锅沿稳当，锅里豆腐丸子一两炮就沉', feature: '两边铜锅沿又高又厚，很难被打下去，但要高抛过整口锅；锅里的豆腐、丸子、虾滑薄，站上去离对手近、也最容易掉；中间鸳鸯锅的隔板挡平射', players: '1v1–3v3' } },
  pizza: { theme: 'pizza', card: { short: '芝士火山：山顶一炮就穿，掉进岩浆管道', feature: '火山挡住平射，只能高抛或者绕；山顶火山口只盖着薄薄一层，打穿了人顺着管道掉进岩浆室，要坐纸飞机出来，岩浆室的底再打穿就掉出画本；两边是缓坡和鼓起来的饼边', players: '1v1–3v3' } },
  sushi: { theme: 'sushi', card: { short: '慢图：台子又长又厚，比的是血量和走位', feature: '整条寿司台最宽也最厚，人多也站得开，最适合 3v3；寿司块高低不一当掩体；台面下藏着四段隧道，打穿台面掉进隧道而不是掉出画本，隧道底只有 40 厚；两头的砧板也薄', players: '1v1–3v3', tag: '慢图' } },
  teatime: { theme: 'teatime', card: { short: '五块岛靠窄桥连着，桥一断只能坐纸飞机', feature: '方糖堆、茶杯、茶壶、马卡龙塔、司康之间搭着勺子和饼干棒，桥一炮就断；茶杯里能躲人；茶壶肚子是空的，打穿壶顶会掉进壶里', players: '1v1–3v3' } },
};

