/**
 * 大厅封面（平台 public/covers/yexun.webp，800×450）：用标题页同一套程序画的主视觉（sprites7.ts），叠上毛笔字标题。
 * 只给 tools/cover.ts 在无头浏览器里打开，不进游戏的构建。先按 2 倍画再缩到 800×450，边缘更顺。
 */
import '../src/view/ui/hud.css';
import { buildAtlas } from '../src/view/art/atlas.ts';
import { drawFlakes, drawTitleLive, drawTitleStill, makeFlakes } from '../src/view/art/sprites7.ts';

/** 雪地右边摆几只守夜里的怪（图集里的帧，fx/fy 是脚底在画面上的位置，s 是放大倍数） */
const MOBS: readonly { key: string; fx: number; fy: number; s: number; flip?: boolean }[] = [
  { key: 'bat', fx: 0.9, fy: 0.5, s: 1.3, flip: true },
  { key: 'wisp', fx: 0.52, fy: 0.8, s: 1.4 },
  { key: 'paper', fx: 0.66, fy: 0.86, s: 1.7, flip: true },
  { key: 'jiangshi_big', fx: 0.8, fy: 0.95, s: 1.6, flip: true },
  { key: 'whitefox', fx: 0.94, fy: 0.84, s: 1.4, flip: true },
];

const W = 800;
const H = 450;
const K = 2;
/** 动画层取的时刻：头顶三张符按 t×0.0014 转，取转角 ≈ 2π 的一帧，三张都不在脸正前（挑过） */
const T = 4488;

async function draw(): Promise<string> {
  await document.fonts.load('120px YxBrush');
  const big = document.createElement('canvas');
  big.width = W * K;
  big.height = H * K;
  const c = big.getContext('2d')!;
  const info = drawTitleStill(c, W * K, H * K);
  // 时间固定：灯笼、符的摆动每次生成都一样
  drawTitleLive(c, W * K, H * K, info, T);
  // 怪：先画影子再画身子，往主角那边走（翻成朝左）
  const atlas = buildAtlas(K);
  for (const m of MOBS) {
    const f = atlas.frames.get(m.key);
    if (!f) throw new Error(`图集里没有 ${m.key}`);
    const w = f.w * m.s;
    const h = f.h * m.s;
    const x = W * K * m.fx;
    const y = H * K * m.fy;
    if (m.key !== 'bat' && m.key !== 'wisp') {
      c.fillStyle = 'rgba(40,50,90,0.22)';
      c.beginPath();
      c.ellipse(x, y, w * 0.38, w * 0.12, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.save();
    c.translate(x, y);
    if (m.flip) c.scale(-1, 1);
    c.drawImage(atlas.canvas, f.x, f.y, f.w, f.h, -w / 2, -h, w, h);
    c.restore();
  }
  // 雪花：固定的一帧（makeFlakes 里的随机只影响位置，封面不要求逐次相同，但这里推进固定的时长让它们散开）
  const fl = makeFlakes(90, W * K, H * K);
  drawFlakes(c, fl, W * K, H * K, 16, T);
  // 标题：右上，毛笔字带深色描边和投影，和标题页一致
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const tx = W * K * 0.68;
  const ty = H * K * 0.3;
  c.font = `${150 * K}px YxBrush`;
  c.lineJoin = 'round';
  c.shadowColor = 'rgba(0,0,0,0.45)';
  c.shadowOffsetY = 6 * K;
  c.shadowBlur = 8 * K;
  c.lineWidth = 14 * K;
  c.strokeStyle = '#17131c';
  c.strokeText('夜巡', tx, ty);
  c.shadowColor = 'transparent';
  c.fillStyle = '#f6efdc';
  c.fillText('夜巡', tx, ty);
  // 副标题：两个模式
  c.font = `${34 * K}px YxBrush`;
  c.lineWidth = 7 * K;
  c.strokeText('守夜 · 夜探', tx, ty + 120 * K);
  c.fillStyle = '#f2c94c';
  c.fillText('守夜 · 夜探', tx, ty + 120 * K);

  const out = document.getElementById('c') as HTMLCanvasElement;
  out.width = W;
  out.height = H;
  const o = out.getContext('2d')!;
  o.imageSmoothingQuality = 'high';
  o.drawImage(big, 0, 0, W, H);
  return out.toDataURL('image/webp', 0.9);
}

(window as unknown as { __cover: Promise<string> }).__cover = draw();
