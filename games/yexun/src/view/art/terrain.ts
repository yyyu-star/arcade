/**
 * 守夜新地图的地面和地形画法（DESIGN.md 3.6）：竹林、河滩、冰湖，外加菜单里地图卡的缩略图。
 * 全是程序画的：整张场地的地形叠层一次画到一张 canvas（河、冰、桥、芦苇、落叶），竹丛单独画成小贴图。
 * 雪地很亮（AGENTS.md 第 4 节）：水和冰都用偏深、饱和的蓝，带深色边，才压得住白底。
 */
import type { Block, MapDef, Rect } from '../../content/maps.ts';
import { ARENA } from '../../content/player.ts';
import { artRng, type Ctx } from './draw.ts';

/** 雪地平铺贴图的染色：每张图一个色调 */
export const GROUND_TINT: Record<NonNullable<MapDef['tone']>, number> = {
  snow: 0xd6e0f6,
  yard: 0xd6e0f6,
  bamboo: 0xc8dcc6,
  river: 0xd8e4ea,
  ice: 0xd2e4f6,
  temple: 0xd8d4dc,
};

/** 这张图要不要画地形叠层 */
export function hasTerrainLayer(def: MapDef): boolean {
  return def.tone === 'bamboo' || def.tone === 'river' || def.tone === 'ice' || def.tone === 'temple';
}

function canvas(w: number, h: number): [HTMLCanvasElement, Ctx] {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w));
  cv.height = Math.max(1, Math.round(h));
  return [cv, cv.getContext('2d')!];
}

const crossesVertically = (b: Rect): boolean => b.h >= b.w;

// ───────────────────────── 整张场地的地形叠层 ─────────────────────────

/** 地形叠层：scale 是画布像素 / 世界单位（0.5 即 1600×1600）。没有地形的图返回 null */
export function paintTerrain(def: MapDef, seed: number, scale: number): HTMLCanvasElement | null {
  if (!hasTerrainLayer(def)) return null;
  const [cv, c] = canvas(ARENA.w * scale, ARENA.h * scale);
  c.scale(scale, scale);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  const r = artRng(seed ^ 0x7e44a1);
  if (def.tone === 'river') paintRiver(c, def, r);
  else if (def.tone === 'ice') paintIce(c, def, r);
  else if (def.tone === 'temple') paintTemple(c, def, r);
  else paintBambooFloor(c, r);
  return cv;
}

/** 荒庙：院里铺一片残破的青石板，香火区画一圈暖黄的香灰地和飘着的青烟，一眼看出"这里不一样" */
function paintTemple(c: Ctx, def: MapDef, r: () => number): void {
  const C = ARENA.w / 2;
  // 院里的石板地
  c.fillStyle = '#b9b4bd';
  c.fillRect(C - 540, C - 540, 1080, 1080);
  c.strokeStyle = '#8e8894';
  c.lineWidth = 3;
  for (let y = C - 540; y < C + 540; y += 72) {
    for (let x = C - 540 + ((y / 72) % 2) * 36; x < C + 540; x += 72) {
      if (r() < 0.18) continue; // 缺几块，露出雪
      c.globalAlpha = 0.5 + r() * 0.3;
      c.strokeRect(x + 2, y + 2, 68, 68);
    }
  }
  c.globalAlpha = 1;
  // 正中一条通往大殿的石阶路
  c.fillStyle = '#a49eaa';
  c.fillRect(C - 70, C - 470, 140, 1010);
  // 香火区：暖黄的香灰地 + 一圈深边 + 几缕青烟
  for (const z of def.incense ?? []) {
    const cx = z.x + z.w / 2;
    const cy = z.y + z.h / 2;
    const g = c.createRadialGradient(cx, cy, 10, cx, cy, Math.max(z.w, z.h) * 0.62);
    g.addColorStop(0, 'rgba(255,214,120,0.75)');
    g.addColorStop(1, 'rgba(240,180,80,0.18)');
    c.fillStyle = g;
    c.fillRect(z.x, z.y, z.w, z.h);
    c.strokeStyle = 'rgba(150,100,30,0.75)';
    c.lineWidth = 5;
    c.setLineDash([18, 12]);
    c.strokeRect(z.x, z.y, z.w, z.h);
    c.setLineDash([]);
    c.strokeStyle = 'rgba(120,130,150,0.45)';
    c.lineWidth = 4;
    for (let k = 0; k < 4; k++) {
      const x = cx - 60 + r() * 120;
      c.beginPath();
      c.moveTo(x, cy + 20);
      c.bezierCurveTo(x - 20, cy - 10, x + 20, cy - 40, x - 6, cy - 80);
      c.stroke();
    }
  }
}

function paintRiver(c: Ctx, def: MapDef, r: () => number): void {
  const water = def.water ?? [];
  // 沙岸：水区四周宽 26 的一圈，先画（桥和水盖在上面）
  c.fillStyle = '#d9cc9e';
  for (const w of water) c.fillRect(w.x - 26, w.y - 26, w.w + 52, w.h + 52);
  c.fillStyle = '#c4b684';
  for (const w of water) {
    for (let k = 0; k < (w.w + w.h) / 14; k++) {
      c.globalAlpha = 0.5;
      c.beginPath();
      c.ellipse(w.x - 20 + r() * (w.w + 40), w.y - 20 + r() * (w.h + 40), 3 + r() * 6, 2 + r() * 3, 0, 0, 7);
      c.fill();
    }
  }
  c.globalAlpha = 1;
  // 水
  for (const w of water) {
    const g = c.createLinearGradient(0, w.y, 0, w.y + w.h);
    g.addColorStop(0, '#3f7fa8');
    g.addColorStop(1, '#2f6a94');
    c.fillStyle = g;
    c.fillRect(w.x, w.y, w.w, w.h);
    // 波纹：浅色的短弧
    c.strokeStyle = '#a9d6ee';
    c.lineWidth = 2.2;
    const n = Math.round((w.w * w.h) / 900);
    for (let k = 0; k < n; k++) {
      const x = w.x + 10 + r() * (w.w - 20);
      const y = w.y + 8 + r() * (w.h - 16);
      const l = 14 + r() * 26;
      c.globalAlpha = 0.35 + r() * 0.4;
      c.beginPath();
      c.moveTo(x, y);
      c.quadraticCurveTo(x + l / 2, y - 5, x + l, y);
      c.stroke();
    }
    c.globalAlpha = 1;
    c.strokeStyle = '#1f4c6e';
    c.lineWidth = 4;
    c.strokeRect(w.x, w.y, w.w, w.h);
  }
  // 桥：木板垂直于过河方向，两侧扶栏
  for (const b of def.bridges ?? []) paintBridge(c, b);
  // 芦苇：沿水区的长边，桥的位置让开
  const bridges = def.bridges ?? [];
  for (const w of water) {
    const horizontal = w.w >= w.h;
    const len = horizontal ? w.w : w.h;
    for (let t = 20; t < len - 20; t += 26 + r() * 30) {
      for (const side of [-1, 1]) {
        if (r() < 0.45) continue;
        const px = horizontal ? w.x + t : side < 0 ? w.x - 14 - r() * 12 : w.x + w.w + 14 + r() * 12;
        const py = horizontal ? (side < 0 ? w.y - 14 - r() * 12 : w.y + w.h + 14 + r() * 12) : w.y + t;
        if (bridges.some((b) => px > b.x - 24 && px < b.x + b.w + 24 && py > b.y - 24 && py < b.y + b.h + 24)) continue;
        reed(c, px, py, r);
      }
    }
  }
}

function reed(c: Ctx, x: number, y: number, r: () => number): void {
  const n = 3 + Math.floor(r() * 3);
  for (let k = 0; k < n; k++) {
    const lean = (r() - 0.5) * 14;
    const h = 22 + r() * 22;
    const bx = x + (k - n / 2) * 4;
    c.strokeStyle = '#2f4a22';
    c.lineWidth = 3.4;
    c.beginPath();
    c.moveTo(bx, y);
    c.quadraticCurveTo(bx + lean * 0.4, y - h * 0.5, bx + lean, y - h);
    c.stroke();
    c.strokeStyle = k % 2 ? '#8aa648' : '#a2b858';
    c.lineWidth = 1.8;
    c.stroke();
    if (k === 1) {
      // 蒲棒
      c.fillStyle = '#7a4a28';
      c.strokeStyle = '#2a1a10';
      c.lineWidth = 1.4;
      c.beginPath();
      c.ellipse(bx + lean, y - h - 4, 2.6, 7, 0.1, 0, 7);
      c.fill();
      c.stroke();
    }
  }
}

function paintBridge(c: Ctx, b: Rect): void {
  const v = crossesVertically(b);
  c.fillStyle = '#8d6038';
  c.fillRect(b.x, b.y, b.w, b.h);
  // 木板缝
  c.strokeStyle = '#4a2d18';
  c.lineWidth = 2;
  c.globalAlpha = 0.8;
  const step = 20;
  if (v) for (let y = b.y + step; y < b.y + b.h; y += step) line(c, b.x, y, b.x + b.w, y);
  else for (let x = b.x + step; x < b.x + b.w; x += step) line(c, x, b.y, x, b.y + b.h);
  // 亮边
  c.strokeStyle = '#c99a62';
  c.lineWidth = 1.4;
  c.globalAlpha = 0.6;
  if (v) for (let y = b.y + step - 4; y < b.y + b.h; y += step) line(c, b.x + 3, y, b.x + b.w - 3, y);
  else for (let x = b.x + step - 4; x < b.x + b.w; x += step) line(c, x, b.y + 3, x, b.y + b.h - 3);
  c.globalAlpha = 1;
  // 扶栏：两侧各一道深色粗线
  c.strokeStyle = '#2d1b10';
  c.lineWidth = 6;
  if (v) {
    line(c, b.x + 1, b.y, b.x + 1, b.y + b.h);
    line(c, b.x + b.w - 1, b.y, b.x + b.w - 1, b.y + b.h);
  } else {
    line(c, b.x, b.y + 1, b.x + b.w, b.y + 1);
    line(c, b.x, b.y + b.h - 1, b.x + b.w, b.y + b.h - 1);
  }
  c.strokeStyle = '#a77a48';
  c.lineWidth = 2.4;
  if (v) {
    line(c, b.x + 1, b.y, b.x + 1, b.y + b.h);
    line(c, b.x + b.w - 1, b.y, b.x + b.w - 1, b.y + b.h);
  } else {
    line(c, b.x, b.y + 1, b.x + b.w, b.y + 1);
    line(c, b.x, b.y + b.h - 1, b.x + b.w, b.y + b.h - 1);
  }
}

function line(c: Ctx, x0: number, y0: number, x1: number, y1: number): void {
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(x1, y1);
  c.stroke();
}

function paintIce(c: Ctx, def: MapDef, r: () => number): void {
  for (const ice of def.ice ?? []) {
    // 冰面外沿一圈雪堆
    c.fillStyle = '#f4f8ff';
    c.strokeStyle = '#7fa6c4';
    c.lineWidth = 2;
    for (let t = 0; t < (ice.w + ice.h) / 16; t++) {
      const side = Math.floor(r() * 4);
      const x = side < 2 ? ice.x + r() * ice.w : side === 2 ? ice.x : ice.x + ice.w;
      const y = side >= 2 ? ice.y + r() * ice.h : side === 0 ? ice.y : ice.y + ice.h;
      c.beginPath();
      c.ellipse(x + (r() - 0.5) * 16, y + (r() - 0.5) * 16, 18 + r() * 22, 10 + r() * 10, 0, 0, 7);
      c.fill();
      c.stroke();
    }
    const g = c.createLinearGradient(ice.x, ice.y, ice.x + ice.w, ice.y + ice.h);
    g.addColorStop(0, '#a6dcee');
    g.addColorStop(0.5, '#86c3e0');
    g.addColorStop(1, '#9bd0e8');
    c.fillStyle = g;
    c.fillRect(ice.x, ice.y, ice.w, ice.h);
    c.save();
    c.beginPath();
    c.rect(ice.x, ice.y, ice.w, ice.h);
    c.clip();
    // 冰层深浅：几块更深的色斑
    for (let k = 0; k < 30; k++) {
      c.fillStyle = r() < 0.5 ? '#5aa6cc' : '#c9ecf7';
      c.globalAlpha = 0.25;
      c.beginPath();
      c.ellipse(ice.x + r() * ice.w, ice.y + r() * ice.h, 60 + r() * 140, 30 + r() * 80, r() * 3, 0, 7);
      c.fill();
    }
    c.globalAlpha = 1;
    // 裂纹：从一点出发折几下，中途分叉；深浅两道线叠着
    const cracks = Math.round((ice.w * ice.h) / 52000);
    for (let k = 0; k < cracks; k++) crack(c, ice.x + r() * ice.w, ice.y + r() * ice.h, r() * 6.28, 3 + Math.floor(r() * 3), 1, r);
    // 反光：斜的白色短条
    c.strokeStyle = '#ffffff';
    c.lineCap = 'round';
    for (let k = 0; k < cracks * 1.4; k++) {
      const x = ice.x + r() * ice.w;
      const y = ice.y + r() * ice.h;
      const l = 24 + r() * 50;
      c.globalAlpha = 0.5 + r() * 0.4;
      c.lineWidth = 3 + r() * 3;
      line(c, x, y, x + l * 0.6, y - l * 0.8);
      c.lineWidth = 2;
      line(c, x + 14, y + 6, x + 14 + l * 0.3, y + 6 - l * 0.4);
    }
    c.globalAlpha = 1;
    c.restore();
    c.strokeStyle = '#3f7ea6';
    c.lineWidth = 6;
    c.strokeRect(ice.x, ice.y, ice.w, ice.h);
    c.strokeStyle = '#e9f7ff';
    c.lineWidth = 2;
    c.strokeRect(ice.x + 6, ice.y + 6, ice.w - 12, ice.h - 12);
  }
}

function crack(c: Ctx, x: number, y: number, a: number, segs: number, depth: number, r: () => number): void {
  let px = x;
  let py = y;
  let ang = a;
  for (let s = 0; s < segs; s++) {
    ang += (r() - 0.5) * 1.1;
    const l = 30 + r() * 60;
    const nx = px + Math.cos(ang) * l;
    const ny = py + Math.sin(ang) * l;
    c.strokeStyle = '#2f6d96';
    c.globalAlpha = 0.75;
    c.lineWidth = 3.2 / depth;
    line(c, px, py, nx, ny);
    c.strokeStyle = '#f2fbff';
    c.globalAlpha = 0.9;
    c.lineWidth = 1.4 / depth;
    line(c, px + 1.5, py - 1.5, nx + 1.5, ny - 1.5);
    c.globalAlpha = 1;
    if (depth < 2 && r() < 0.5) crack(c, nx, ny, ang + (r() < 0.5 ? 1 : -1) * (0.6 + r() * 0.6), 2, depth + 1, r);
    px = nx;
    py = ny;
  }
}

function paintBambooFloor(c: Ctx, r: () => number): void {
  const W = ARENA.w;
  // 泥地和苔藓的大色斑
  for (let k = 0; k < 70; k++) {
    c.fillStyle = k % 3 === 0 ? '#8a7650' : '#7fae7c';
    c.globalAlpha = 0.22;
    c.beginPath();
    c.ellipse(r() * W, r() * W, 60 + r() * 150, 40 + r() * 90, r() * 3, 0, 7);
    c.fill();
  }
  // 落叶：细长的小叶子，三种颜色
  const colors = ['#5b8f3c', '#b7a33f', '#3f6e34', '#8bb24a'];
  for (let k = 0; k < 1500; k++) {
    c.fillStyle = colors[Math.floor(r() * colors.length)]!;
    c.globalAlpha = 0.5 + r() * 0.35;
    c.beginPath();
    c.ellipse(r() * W, r() * W, 2 + r() * 2.4, 7 + r() * 5, r() * 3.14, 0, 7);
    c.fill();
  }
  c.globalAlpha = 1;
}

// ───────────────────────── 竹丛贴图 ─────────────────────────

/** 竹丛贴图的宽度档（按竹丛脚底宽就近取，画面上横向拉伸到刚好） */
export const BAMBOO_WIDTHS = [100, 130, 160] as const;
export const BAMBOO_VARIANTS = 2;
const BAMBOO_H = 250;

export function bambooKey(b: Block, k: number): { key: string; wd: number } {
  let wd: number = BAMBOO_WIDTHS[0];
  for (const c of BAMBOO_WIDTHS) if (Math.abs(c - b.w) < Math.abs(wd - b.w)) wd = c;
  return { key: `bamboo_${wd}_${k % BAMBOO_VARIANTS}`, wd };
}

/** 一丛竹子：底边中心是脚底，贴图宽 = wd + 60，高 250；原点放 (0.5, 1 - 10/250) */
export function bambooCanvas(wd: number, variant: number, scale: number): HTMLCanvasElement {
  const W = wd + 60;
  const [cv, c] = canvas(W * scale, BAMBOO_H * scale);
  c.scale(scale, scale);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  const r = artRng(wd * 31 + variant * 977 + 5);
  const base = BAMBOO_H - 12;
  // 地上的影子和雪堆
  c.fillStyle = 'rgba(30,40,60,0.28)';
  c.beginPath();
  c.ellipse(W / 2, base + 2, wd / 2 + 16, 14, 0, 0, 7);
  c.fill();
  c.fillStyle = '#f4f8ff';
  c.strokeStyle = '#7fa0c0';
  c.lineWidth = 2;
  c.beginPath();
  c.ellipse(W / 2, base - 2, wd / 2 + 6, 10, 0, 0, 7);
  c.fill();
  c.stroke();
  const n = Math.max(4, Math.round(wd / 20));
  const stalks: { x: number; h: number; t: number; lean: number }[] = [];
  for (let k = 0; k < n; k++) {
    const fx = (k + 0.5) / n;
    stalks.push({ x: W / 2 - wd / 2 + 10 + fx * (wd - 20) + (r() - 0.5) * 8, h: 130 + r() * 90, t: 8 + r() * 4, lean: (r() - 0.5) * 18 });
  }
  // 后排（靠上的）先画：按 x 到中心的距离，边上的竹子矮一些
  stalks.sort((a, b) => Math.abs(b.x - W / 2) - Math.abs(a.x - W / 2));
  for (const s of stalks) {
    const topX = s.x + s.lean;
    const topY = base - s.h;
    // 竹竿：深色描边 + 绿色渐变 + 一道亮线
    const g = c.createLinearGradient(s.x - s.t / 2, 0, s.x + s.t / 2, 0);
    g.addColorStop(0, '#4f9a4a');
    g.addColorStop(0.45, '#8fd16a');
    g.addColorStop(1, '#2f7a3c');
    c.fillStyle = g;
    c.strokeStyle = '#173a20';
    c.lineWidth = 2.4;
    c.beginPath();
    c.moveTo(s.x - s.t / 2, base);
    c.quadraticCurveTo(s.x - s.t / 2 + s.lean * 0.2, base - s.h * 0.5, topX - s.t / 2 + 1, topY);
    c.lineTo(topX + s.t / 2 - 1, topY);
    c.quadraticCurveTo(s.x + s.t / 2 + s.lean * 0.2, base - s.h * 0.5, s.x + s.t / 2, base);
    c.closePath();
    c.fill();
    c.stroke();
    // 竹节
    c.strokeStyle = '#1d4a27';
    c.lineWidth = 2;
    const nodes = Math.floor(s.h / 34);
    for (let k = 1; k <= nodes; k++) {
      const f = k / (nodes + 0.4);
      const y = base - s.h * f;
      const x = s.x + s.lean * f * f;
      line(c, x - s.t / 2 - 1.5, y, x + s.t / 2 + 1.5, y);
    }
    // 叶子：竿顶三簇，细长的尖叶
    for (let k = 0; k < 3; k++) {
      const ly = topY + 8 + k * 18 + r() * 8;
      const lx = s.x + s.lean * ((base - ly) / s.h) ** 2;
      for (const side of [-1, 1]) {
        const len = 30 + r() * 22;
        const ang = side * (0.5 + r() * 0.5) - 0.2;
        c.save();
        c.translate(lx, ly);
        c.rotate(ang + (side > 0 ? 1.1 : -1.1) - (side > 0 ? 0 : 0));
        c.fillStyle = r() < 0.5 ? '#5aa84c' : '#7cc45a';
        c.strokeStyle = '#173a20';
        c.lineWidth = 1.8;
        c.beginPath();
        c.moveTo(0, 0);
        c.quadraticCurveTo(len * 0.5, -7, len, 0);
        c.quadraticCurveTo(len * 0.5, 5, 0, 0);
        c.fill();
        c.stroke();
        c.restore();
      }
    }
  }
  return cv;
}

/** 砍倒后留下的竹桩：几截断竹茬 */
export function stumpCanvas(scale: number): HTMLCanvasElement {
  const [cv, c] = canvas(64 * scale, 40 * scale);
  c.scale(scale, scale);
  c.fillStyle = 'rgba(30,40,60,0.25)';
  c.beginPath();
  c.ellipse(32, 30, 24, 7, 0, 0, 7);
  c.fill();
  for (const [x, h] of [[20, 12], [32, 17], [44, 10]] as const) {
    c.fillStyle = '#5aa84c';
    c.strokeStyle = '#173a20';
    c.lineWidth = 2.2;
    c.beginPath();
    c.rect(x - 5, 30 - h, 10, h);
    c.fill();
    c.stroke();
    c.fillStyle = '#e9e0a8';
    c.beginPath();
    c.ellipse(x, 30 - h, 5, 2.6, 0, 0, 7);
    c.fill();
    c.stroke();
  }
  return cv;
}

// ───────────────────────── 地图卡缩略图 ─────────────────────────

/** 缩略图的块颜色（按 look）：比对局里更深更饱和，60 像素的小图上也分得出 */
const BLOCK_FILL: Record<Block['look'], string> = {
  wall_h: '#6b4a30',
  wall_v: '#6b4a30',
  coffin: '#3e2418',
  hall: '#b0402a',
  bamboo: '#1f7a3a',
  rock: '#5d6678',
  censer: '#c08a28',
};

/** 每张图自己的底色（缩略图专用，要一眼看出是哪张图） */
const THUMB_BASE: Record<NonNullable<MapDef['tone']>, string> = { snow: '#c6d6f0', yard: '#b9b3c4', bamboo: '#9fd08a', river: '#e2d2a0', ice: '#cfe4f4', temple: '#c4bccb' };

/** 把地图的示意画在 cv 上（cv 的宽高自己定，画成正方形铺满）：底色、水、冰、桥、块，一眼看出这张图什么样 */
export function drawMapThumb(cv: HTMLCanvasElement, def: MapDef): void {
  const c = cv.getContext('2d')!;
  const S = cv.width;
  const k = S / ARENA.w;
  c.clearRect(0, 0, S, S);
  c.save();
  c.scale(k, k);
  const tone = def.tone ?? 'snow';
  c.fillStyle = THUMB_BASE[tone];
  c.fillRect(0, 0, ARENA.w, ARENA.h);
  if (tone === 'bamboo') {
    // 竹林：深浅两色的斜纹，像一片竹影
    c.fillStyle = 'rgba(40,120,60,0.22)';
    for (let x = -ARENA.h; x < ARENA.w; x += 260) {
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x + 130, 0);
      c.lineTo(x + 130 + ARENA.h, ARENA.h);
      c.lineTo(x + ARENA.h, ARENA.h);
      c.fill();
    }
  }
  if (tone === 'snow' || tone === 'yard') {
    // 雪原：几堆白雪，免得一片空白
    c.fillStyle = 'rgba(255,255,255,0.85)';
    for (const [x, y, r] of [[600, 700, 220], [2400, 600, 180], [900, 2400, 260], [2500, 2300, 200], [1700, 2800, 150], [400, 1700, 140]] as const) {
      c.beginPath();
      c.ellipse(x, y, r * 1.4, r * 0.7, 0, 0, 7);
      c.fill();
    }
  }
  // 荒庙：香火区画成暖黄的方块
  c.fillStyle = '#f2c460';
  for (const z of def.incense ?? []) c.fillRect(z.x, z.y, z.w, z.h);
  for (const w of def.water ?? []) {
    // 河滩：水带外面一圈沙岸
    c.fillStyle = '#c9b57a';
    c.fillRect(w.x - 90, w.y - 90, w.w + 180, w.h + 180);
  }
  c.fillStyle = '#1f6fd0';
  for (const w of def.water ?? []) c.fillRect(w.x, w.y, w.w, w.h);
  c.fillStyle = '#8d6038';
  for (const b of def.bridges ?? []) c.fillRect(b.x, b.y, b.w, b.h);
  c.fillStyle = '#9ee0ff';
  c.strokeStyle = '#2f8fd0';
  c.lineWidth = 80;
  for (const i of def.ice ?? []) {
    c.fillRect(i.x, i.y, i.w, i.h);
    c.strokeRect(i.x, i.y, i.w, i.h);
    // 冰面上两道白光
    c.fillStyle = 'rgba(255,255,255,0.75)';
    c.fillRect(i.x + i.w * 0.12, i.y + i.h * 0.18, i.w * 0.4, 70);
    c.fillRect(i.x + i.w * 0.3, i.y + i.h * 0.3, i.w * 0.25, 70);
    c.fillStyle = '#9ee0ff';
  }
  // 小块放大到至少 5 像素，免得缩略图上看不见；竹丛再加一圈深边
  const min = 5 / k;
  for (const b of def.blocks) {
    c.fillStyle = BLOCK_FILL[b.look];
    const w = Math.max(b.w, min);
    const h = Math.max(b.h, min);
    const x = b.x - (w - b.w) / 2;
    const y = b.y - (h - b.h) / 2;
    c.fillRect(x, y, w, h);
    if (b.look === 'bamboo') {
      c.strokeStyle = '#0e3b1c';
      c.lineWidth = 14;
      c.strokeRect(x, y, w, h);
    }
  }
  // 出生点：小红点
  c.fillStyle = '#d0362e';
  c.strokeStyle = '#fff';
  c.lineWidth = 2 / k;
  c.beginPath();
  c.arc(ARENA.w / 2, ARENA.h / 2, 5 / k, 0, 7);
  c.fill();
  c.stroke();
  c.restore();
  c.strokeStyle = 'rgba(23,19,28,0.55)';
  c.lineWidth = 2;
  c.strokeRect(1, 1, S - 2, S - 2);
}
