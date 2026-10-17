/**
 * 守夜的地图（DESIGN.md 3.6）。雪原开阔；义庄是一圈院墙围着正堂和棺材，四面各留一个门洞，怪从门洞挤进来，尸类怪多。
 * 挡路的东西是轴对齐的矩形（脚底占的地，不是整张图的大小），主角和怪都推不进去；子弹、掉落物不管它。
 */
import type { EnemyKind } from './enemies.ts';
import { ARENA } from './player.ts';

export type MapId = 'snow' | 'yizhuang';

/** 一块挡路的东西：x, y 是左上角；look 告诉画面层画什么 */
export interface Block {
  x: number;
  y: number;
  w: number;
  h: number;
  look: 'wall_h' | 'wall_v' | 'coffin' | 'hall';
}

export interface MapDef {
  id: MapId;
  name: string;
  blurb: string;
  blocks: readonly Block[];
  /** 刷怪比例的倍数（义庄：跳尸、枯骨多） */
  mix?: Partial<Record<EnemyKind, number>>;
}

const C = ARENA.w / 2;
/** 院墙：半边长、门洞半宽、墙厚 */
const YARD = 520;
const GATE = 110;
const T = 26;

function yard(): Block[] {
  const a = C - YARD;
  const b = C + YARD;
  const run = YARD - GATE;
  return [
    // 上下两道横墙，各在中间断开一个门洞
    { x: a, y: a, w: run, h: T, look: 'wall_h' },
    { x: C + GATE, y: a, w: run, h: T, look: 'wall_h' },
    { x: a, y: b, w: run, h: T, look: 'wall_h' },
    { x: C + GATE, y: b, w: run + T, h: T, look: 'wall_h' },
    // 左右两道竖墙
    { x: a, y: a + T, w: T, h: run - T, look: 'wall_v' },
    { x: a, y: C + GATE, w: T, h: run, look: 'wall_v' },
    { x: b, y: a, w: T, h: run, look: 'wall_v' },
    { x: b, y: C + GATE, w: T, h: run, look: 'wall_v' },
  ];
}

const coffin = (x: number, y: number): Block => ({ x: x - 34, y: y - 12, w: 68, h: 24, look: 'coffin' });

export const MAPS: Record<MapId, MapDef> = {
  snow: { id: 'snow', name: '雪原', blurb: '开阔的雪地，往哪儿跑都行', blocks: [] },
  yizhuang: {
    id: 'yizhuang',
    name: '义庄',
    blurb: '院墙围着，怪从门洞挤进来；尸类多',
    blocks: [
      ...yard(),
      // 正堂在院子北边，门前留出空地
      { x: C - 110, y: C - 330, w: 220, h: 60, look: 'hall' },
      // 院里两排棺材
      coffin(C - 240, C - 120),
      coffin(C + 240, C - 120),
      coffin(C - 240, C + 170),
      coffin(C + 240, C + 170),
      // 院外：散落的棺材和残墙
      coffin(C - 820, C - 640),
      coffin(C + 760, C - 700),
      coffin(C - 700, C + 760),
      coffin(C + 880, C + 620),
      coffin(C - 1100, C + 80),
      coffin(C + 1150, C - 40),
      { x: C - 1000, y: C - 1000, w: 320, h: T, look: 'wall_h' },
      { x: C + 700, y: C - 1080, w: T, h: 300, look: 'wall_v' },
      { x: C - 1060, y: C + 820, w: T, h: 300, look: 'wall_v' },
      { x: C + 640, y: C + 1000, w: 360, h: T, look: 'wall_h' },
    ],
    mix: { jiangshi: 1.5, bone: 1.3, general: 1 },
  },
};

/** 圆（x, y, r）压进了哪块就推出来；返回推过没有。轴对齐矩形：找矩形上离圆心最近的点，沿那个方向推开 */
export function pushOut(blocks: readonly Block[], p: { x: number; y: number }, r: number): boolean {
  let moved = false;
  for (const b of blocks) {
    if (p.x + r <= b.x || p.x - r >= b.x + b.w || p.y + r <= b.y || p.y - r >= b.y + b.h) continue;
    const nx = p.x < b.x ? b.x : p.x > b.x + b.w ? b.x + b.w : p.x;
    const ny = p.y < b.y ? b.y : p.y > b.y + b.h ? b.y + b.h : p.y;
    const dx = p.x - nx;
    const dy = p.y - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) continue;
    if (d2 > 0) {
      // 圆心在矩形外：沿最近点的方向推到刚好贴边（只用四则运算：按轴分量比例推）
      const ax = dx < 0 ? -dx : dx;
      const ay = dy < 0 ? -dy : dy;
      if (ax >= ay) p.x = nx + (dx < 0 ? -r : r);
      else p.y = ny + (dy < 0 ? -r : r);
    } else {
      // 圆心进了矩形：从最浅的那条边推出去
      const l = p.x - b.x;
      const rr = b.x + b.w - p.x;
      const t = p.y - b.y;
      const bb = b.y + b.h - p.y;
      const m = Math.min(l, rr, t, bb);
      if (m === l) p.x = b.x - r;
      else if (m === rr) p.x = b.x + b.w + r;
      else if (m === t) p.y = b.y - r;
      else p.y = b.y + b.h + r;
    }
    moved = true;
  }
  return moved;
}
