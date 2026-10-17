/**
 * 开局时把所有精灵用 Canvas 画进一张图集（≤ 2048 × 2048），再交给 Phaser。
 * 不带任何图片文件：首包小、换色改形只改代码（DESIGN.md 第 7.2 节）。
 * 雪地是单独的一张可平铺贴图，按 1 倍画（整屏大图按 1 倍光栅化，AGENTS.md 第 4 节）。
 */
import { SPRITES, type SpriteDef } from './sprites.ts';
import { SPRITES2 } from './sprites2.ts';
import { SPRITES3 } from './sprites3.ts';
import { SPRITES4 } from './sprites4.ts';
import { INK, artRng } from './draw.ts';

export interface Frame {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 锚点（0–1） */
  ox: number;
  oy: number;
  /** 显示时按 1 / res 缩放就是它在世界里的大小（画得更细的大怪，res 照基础倍数算，显示出来就是放大的） */
  res: number;
}

export interface Atlas {
  canvas: HTMLCanvasElement;
  frames: Map<string, Frame>;
}

const MAX = 2048;
const PAD = 2;

/** 伤害数字：0–9 各一帧，白字黑边，用时按颜色着色（暴击金色） */
const DIGIT_H = 30;
function digitDefs(): SpriteDef[] {
  return [...'0123456789'].map((d) => ({
    key: `d${d}`,
    w: 22,
    h: DIGIT_H,
    ox: 0.5,
    oy: 0.5,
    draw: (c: CanvasRenderingContext2D): void => {
      c.font = `900 26px "Arial Black", "Helvetica Neue", system-ui, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.lineJoin = 'round';
      c.lineWidth = 6;
      c.strokeStyle = INK;
      c.strokeText(d, 11, 16);
      c.fillStyle = '#ffffff';
      c.fillText(d, 11, 16);
    },
  }));
}

/** 把精灵画好、按高度排成一行行装进图集 */
export function buildAtlas(res: number): Atlas {
  const defs = [...SPRITES, ...SPRITES2, ...SPRITES3, ...SPRITES4, ...digitDefs()];
  const items = defs.map((d) => {
    const r = res * (d.scale ?? 1);
    return { d, r, pw: Math.ceil(d.w * r) + PAD * 2, ph: Math.ceil(d.h * r) + PAD * 2 };
  });
  items.sort((a, b) => b.ph - a.ph);
  let x = 0;
  let y = 0;
  let rowH = 0;
  const place: { x: number; y: number }[] = [];
  for (const it of items) {
    if (x + it.pw > MAX) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    place.push({ x, y });
    x += it.pw;
    rowH = Math.max(rowH, it.ph);
  }
  const height = y + rowH;
  if (height > MAX) throw new Error(`图集超过 ${MAX}：${height}`);
  const canvas = document.createElement('canvas');
  canvas.width = MAX;
  canvas.height = height;
  const c = canvas.getContext('2d')!;
  const frames = new Map<string, Frame>();
  items.forEach((it, i) => {
    const p = place[i]!;
    c.save();
    c.translate(p.x + PAD, p.y + PAD);
    c.scale(it.r, it.r);
    // 每张只画在自己的格子里（画出界的部分裁掉，不压到隔壁）
    c.beginPath();
    c.rect(0, 0, it.d.w, it.d.h);
    c.clip();
    it.d.draw(c);
    c.restore();
    frames.set(it.d.key, { key: it.d.key, x: p.x + PAD, y: p.y + PAD, w: it.pw - PAD * 2, h: it.ph - PAD * 2, ox: it.d.ox, oy: it.d.oy, res: it.r / (it.d.scale ?? 1) });
  });
  return { canvas, frames };
}

/**
 * 月光下的雪地（可平铺，512 × 512 世界单位、1 倍）：偏冷的浅灰白，几道风吹出的雪痕、零星的脚窝和碎冰。
 * 底色浅，怪和特效才跳得出来。所有东西都按 512 取模画两遍，接缝看不出来。
 */
export function buildGround(size = 512): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext('2d')!;
  c.fillStyle = '#e4e8f0';
  c.fillRect(0, 0, size, size);
  const rnd = artRng(42);
  const wrap = (fn: (ox: number, oy: number) => void): void => {
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) fn(ox, oy);
  };
  // 大块的明暗起伏
  for (let i = 0; i < 26; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = 40 + rnd() * 90;
    const light = rnd() < 0.5;
    wrap((ox, oy) => {
      const g = c.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
      g.addColorStop(0, light ? 'rgba(250,252,255,0.55)' : 'rgba(196,204,222,0.32)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
    });
  }
  // 风吹的雪痕：细长的浅蓝影子
  for (let i = 0; i < 18; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const len = 30 + rnd() * 60;
    wrap((ox, oy) => {
      c.save();
      c.translate(x + ox, y + oy);
      c.rotate(-0.25 + rnd() * 0.1);
      c.fillStyle = 'rgba(170,182,210,0.28)';
      c.beginPath();
      c.ellipse(0, 0, len, 2.2 + rnd() * 1.5, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.7)';
      c.beginPath();
      c.ellipse(-2, -2.5, len * 0.8, 1.4, 0, 0, Math.PI * 2);
      c.fill();
      c.restore();
    });
  }
  // 细碎的颗粒和亮点
  for (let i = 0; i < 900; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const dark = rnd() < 0.55;
    c.fillStyle = dark ? 'rgba(160,170,196,0.35)' : 'rgba(255,255,255,0.9)';
    c.fillRect(x, y, dark ? 1.4 : 1.2, dark ? 1.4 : 1.2);
  }
  // 零星的小坑（脚窝、落雪）
  for (let i = 0; i < 14; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    wrap((ox, oy) => {
      c.fillStyle = 'rgba(150,160,190,0.3)';
      c.beginPath();
      c.ellipse(x + ox, y + oy, 4 + rnd() * 3, 2, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,0.8)';
      c.beginPath();
      c.ellipse(x + ox - 1, y + oy - 1.6, 3.5, 1, 0, 0, Math.PI * 2);
      c.fill();
    });
  }
  return canvas;
}
