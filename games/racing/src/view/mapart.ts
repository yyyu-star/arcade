/**
 * 桌游地图板（DESIGN.md 第 8 节）：一条赛道印在一块带边框的板子上，板子摆在木桌上。只给画面层用，画成 SVG 字符串。
 * - 板子：深色边框（每条赛道一个颜色），上边框印着赛道名和指北针，里面一圈棋盘格边，地图四周留白；
 * - 地图：地面 → 场景（scenes.ts）→ 弯外缓冲区（慢弯红斜纹、快弯砂石点加轮胎墙）→ 维修区 → 林子 → 看台 → 赛道；
 *   赛道是一块干净的深色路面，格线淡，每 5 格一道白线，红白路肩只在弯里，红色弯道线，黑白格起终点和发车框；
 * - 标注（labels，单独一层，跟着缩放重画）：限速是路边的一块限速牌，牌杆从赛道边沿着弯道线方向垂直伸出（全图时放大到屏幕上约 24 像素）；
 *   放大以后才出现格号、"3·2·1"制动牌，和弯外写着"T 几 + 弯名"的小名牌（不写数字）。你前面的下一个弯，限速牌描一圈金边。
 * 地图（draw）开局在浏览器里烘焙成一张位图（board.ts），标注、车、飘字是矢量。
 */
import { geometry, type Geometry, type Pt } from '../track/shape.ts';
import type { Track } from '../track/types.ts';
import { C, distanceField, f1, FONT, LW, poly, type Rect, seeded } from './mapkit.ts';
import { along, bendRange } from './paint.ts';
import { sceneOf, type Scene } from './scenes.ts';
import { CAR_COLORS } from './text.ts';

/** 每种场景的板子：边框颜色、地面颜色；海港上沿多留一片海 */
const LOOK: Record<Geometry['scene'], { frame: string; ground: string; seaTop: number; trees: number; autumn: number }> = {
  lake: { frame: '#2f4a3c', ground: '#cdd7a3', seaTop: 0, trees: 0.95, autumn: 0.08 },
  city: { frame: '#5a3428', ground: '#d4d39e', seaTop: 0, trees: 0.45, autumn: 0.22 },
  harbor: { frame: '#24394f', ground: '#dcd8cc', seaTop: 110, trees: 1, autumn: 0.08 },
};

/** 弯的名字（印在飘带上）；没登记的赛道（以后的随机赛道）只写 T 几 */
const CORNER_NAMES: Record<string, string[]> = {
  lakeside: ['柳岸弯', '长堤弯', '亭前发夹', '回头弯', '看台弯'],
  hillcity: ['坡顶弯', '梯坎发夹', '黄桷弯', '索道弯', '江景弯', '回旋弯'],
  harbor: ['码头弯', '灯塔发夹', '岸桥弯', '堆场弯', '海堤弯'],
};

/** 低于这个缩放（屏幕上 1 个单位不到 0.7 像素）算"全图"：只显示大件 */
export const LOD = 0.7;

export interface Shield {
  at: number;
  limit: number;
  /** 第几个弯（0 起） */
  i: number;
  name: string;
  /** 弯名牌的位置：横着放、竖屏转 90° 时各一套（占的地方不一样） */
  x: number;
  y: number;
  rx: number;
  ry: number;
  /** 名牌半宽 */
  hw: number;
  /** 限速牌立在哪一侧（往左偏为正）；牌杆从赛道边沿着弯道线方向垂直伸出去 */
  side: number;
}

/** 限速牌的半径、牌杆离开路边多远（不缩放时） */
const SIGN_R = 12;
const POLE = 10;

export interface MapArt {
  geo: Geometry;
  /** 整块板子（含边框） */
  board: Rect;
  shields: Shield[];
  /** 地图（rot：竖屏整张转了 90°，边框上不印标题；detail：画细节；grain：铺纸纹和地面的斑驳——两张平铺纹理，只在烘焙位图时画） */
  draw(o: { detail: boolean; rot: boolean; grain?: boolean }): string;
  /** 标注层。k 是屏幕上 1 个单位多少像素，next 是要描金边的弯 */
  labels(o: { k: number; rot: boolean; next: number }): string;
  /** 这个弯的限速牌在哪（不缩放时） */
  sign(at: number): Pt;
  /** 这个弯的制动牌 k（3、2、1）在哪（新手教程讲制动牌时镜头要框住它们） */
  brake(at: number, k: number): Pt;
}


const cache = new Map<string, MapArt>();

export function mapArt(track: Track): MapArt {
  const hit = cache.get(track.id);
  if (hit) return hit;
  const art = build(track);
  cache.set(track.id, art);
  return art;
}

function build(track: Track): MapArt {
  const geo = geometry(track);
  const N = track.spaces;
  const W = geo.width;
  const look = LOOK[geo.scene];
  const names = CORNER_NAMES[track.id] ?? [];
  const cx = geo.cells.reduce((a, c) => a + c.c.x, 0) / N;
  const cy = geo.cells.reduce((a, c) => a + c.c.y, 0) / N;
  const c0 = geo.cells[2]!;
  // 内场在主直道的哪一侧（维修区放内侧，大看台放外侧）
  const inside = (cx - c0.c.x) * Math.sin(c0.angle) - (cy - c0.c.y) * Math.cos(c0.angle) > 0 ? 1 : -1;

  // ---------- 板子 ----------
  const xs = geo.cells.map((c) => c.c.x);
  const ys = geo.cells.map((c) => c.c.y);
  const pad = W / 2 + 100;
  const map: Rect = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad - look.seaTop, w: 0, h: 0 };
  map.w = Math.max(...xs) + pad - map.x;
  map.h = Math.max(...ys) + pad - map.y;
  const board: Rect = { x: map.x - 20, y: map.y - 54, w: map.w + 40, h: map.h + 74 };
  const inMap = (x: number, y: number, m = 0): boolean => x > map.x + m && x < map.x + map.w - m && y > map.y + m && y < map.y + map.h - m;

  // ---------- 维修区（最后一个弯出来到第一个弯前）和距离场 ----------
  const bends = track.corners.map((c) => bendRange(track, geo, c.at));
  const pitFrom = bends[bends.length - 1]!.to + 0.5;
  const pitSpan = (track.corners[0]!.at - 1.2 - pitFrom + N) % N;
  const pitCells = new Set<number>();
  for (let k = 0; k <= pitSpan; k++) pitCells.add(Math.floor(pitFrom + k) % N);
  const field = distanceField(geo, N, map, pitCells);

  // ---------- 弯名牌：立在弯道线外端旁边；压着赛道、或者和别的名牌挤在一起时，在附近挑个位置，离弯道线越近越好 ----------
  const shields: Shield[] = track.corners.map((c, i) => {
    const name = names[i] ?? '';
    const hw = ((name ? `T${i + 1} ${name}` : `T${i + 1}`).length * 10 + 24) / 2;
    return { at: c.at, limit: c.limit, i, name, x: 0, y: 0, rx: 0, ry: 0, hw, side: bends[i]!.side };
  });
  /** 限速牌中心：立在 side 那侧，sc 是缩放倍数（全图时牌子放大，杆子跟着加长），extra 是再往外伸多少 */
  const signAt = (sh: Shield, sc: number, side = sh.side, extra = 0): Pt => {
    const e = geo.edges[sh.at]!;
    const d = W / 2 + 2 + (POLE + SIGN_R) * sc + extra;
    return { x: e.c.x + Math.sin(e.angle) * side * d, y: e.c.y - Math.cos(e.angle) * side * d };
  };
  /**
   * 某个缩放下每块限速牌放哪：默认立在 sh.side 那侧；和前面的牌子叠上了（挨得近的两个弯），先换到路的另一侧，再不行把杆子加长。
   * 牌子不压路（另一侧挨着别的赛道就不换过去）
   */
  const layoutCache = new Map<number, { side: number; p: Pt }[]>();
  const signLayout = (sc: number): { side: number; p: Pt }[] => {
    const hit = layoutCache.get(sc);
    if (hit) return hit;
    const r = SIGN_R * sc;
    const out: { side: number; p: Pt }[] = [];
    for (const sh of shields) {
      const tries: [number, number][] = [
        [sh.side, 0],
        [-sh.side, 0],
        [sh.side, 2.2 * r],
        [-sh.side, 2.2 * r],
        [sh.side, 4.4 * r],
      ];
      let pick = { side: sh.side, p: signAt(sh, sc) };
      for (const [side, extra] of tries) {
        const p = signAt(sh, sc, side, extra);
        if (field.near(p.x, p.y) <= r + 1) continue;
        if (out.some((q) => Math.hypot(q.p.x - p.x, q.p.y - p.y) < 2 * r + 3)) continue;
        pick = { side, p };
        break;
      }
      out.push(pick);
    }
    layoutCache.set(sc, out);
    return out;
  };
  // 牌子默认立在弯外；弯外那边挨着别的赛道、或者出了板子，就立到弯里
  for (const sh of shields) {
    const fits = (): boolean => {
      const p = signAt(sh, 1);
      return field.near(p.x, p.y) > SIGN_R + 2 && inMap(p.x, p.y, SIGN_R);
    };
    if (!fits()) {
      sh.side = -sh.side;
      if (!fits()) sh.side = -sh.side;
    }
  }
  const signs = signLayout(1).map((x) => x.p);
  const place = (rot: boolean): Pt[] => {
    const out: Pt[] = [];
    shields.forEach((sh, j) => {
      // 名牌占的一块：横着是宽 2hw、高 24；竖屏转了 90° 是宽 24、高 2hw
      const [hx, hy] = rot ? [13, sh.hw] : [sh.hw, 13];
      const body = (p: Pt): number => Math.min(...[[0, 0], [-hx, -hy], [hx, -hy], [-hx, hy], [hx, hy], [-hx, 0], [hx, 0], [0, -hy], [0, hy]].map(([dx, dy]) => field.near(p.x + dx!, p.y + dy!)));
      const e = geo.edges[sh.at]!;
      const side = bends[j]!.side;
      const nx = Math.sin(e.angle) * side;
      const ny = -Math.cos(e.angle) * side;
      const tx = Math.cos(e.angle);
      const ty = Math.sin(e.angle);
      const ax = e.c.x + nx * (W / 2 + 4);
      const ay = e.c.y + ny * (W / 2 + 4);
      let best = { x: ax + nx * 30, y: ay + ny * 30 };
      let bp = Infinity;
      for (let o = 8; o <= 130; o += 6)
        for (let t = -90; t <= 90; t += 10) {
          const p = { x: ax + nx * o + tx * t, y: ay + ny * o + ty * t };
          const crowd = out.some((q, k) => Math.abs(q.x - p.x) < hx + (rot ? 13 : shields[k]!.hw) + 6 && Math.abs(q.y - p.y) < hy + (rot ? shields[k]!.hw : 13) + 6);
          const onSign = signs.some((q) => Math.abs(q.x - p.x) < hx + SIGN_R + 4 && Math.abs(q.y - p.y) < hy + SIGN_R + 4);
          const pen = (crowd || onSign ? 1000 : 0) + (body(p) < 4 ? 5000 : 0) + (inMap(p.x, p.y, 20) ? 0 : 5000) + Math.hypot(p.x - ax, p.y - ay);
          if (pen < bp) {
            bp = pen;
            best = p;
          }
        }
      out.push(best);
    });
    return out;
  };
  place(false).forEach((p, i) => Object.assign(shields[i]!, { x: p.x, y: p.y }));
  place(true).forEach((p, i) => Object.assign(shields[i]!, { rx: p.x, ry: p.y }));
  // 场景（湖、山、树）避开两套名牌的位置
  const blocked = (x: number, y: number, m: number): boolean =>
    shields.some((s) => (Math.abs(s.x - x) < s.hw + m && Math.abs(s.y - y) < 13 + m) || (Math.abs(s.rx - x) < 13 + m && Math.abs(s.ry - y) < s.hw + m)) ||
    signs.some((q) => Math.hypot(q.x - x, q.y - y) < SIGN_R + 6 + m);

  // ---------- 场景、林子 ----------
  const scene: Scene = sceneOf({ id: track.id, map, cx, cy, near: field.near, clear: field.clear, blocked, inMap });
  const trees: { x: number; y: number; r: number; k: number }[] = [];
  {
    const r = seeded(track.spaces * 131 + track.corners.length);
    for (let y = map.y + 8; y < map.y + map.h - 8; y += 15)
      for (let x = map.x + 8; x < map.x + map.w - 8; x += 15) {
        const px = x + (r() - 0.5) * 12;
        const py = y + (r() - 0.5) * 12;
        const k = r();
        const d = field.near(px, py);
        if (d < 52 || field.clear(px, py) < 52 || blocked(px, py, 16) || scene.occupied(px, py, 8)) continue;
        // 赛道外一圈成片的林子，越远越稀，再按低频起伏分出林间空地；远处零星几棵单独的树
        const grove = 0.5 + 0.5 * Math.sin(px * 0.01 + 1.3 + N) * Math.sin(py * 0.013 - 0.7) + 0.2 * Math.sin((px - py) * 0.02);
        const dens = (d < 160 ? 1 : d > 420 ? 0.35 : 1 - ((d - 160) / 260) * 0.65) * look.trees * scene.density(px, py);
        if (grove > 0.42 && k < dens) trees.push({ x: px, y: py, r: 11 + r() * 5, k: r() });
        else if (k < 0.012) trees.push({ x: px, y: py, r: 9 + r() * 3, k: 2 });
      }
  }

  const draw = (o: { detail: boolean; rot: boolean; grain?: boolean }): string => {
    const { detail } = o;
    let s = '';
    // 板子：投影、厚度、边框、棋盘格边
    s += `<rect x="${f1(board.x + 8)}" y="${f1(board.y + 12)}" width="${f1(board.w)}" height="${f1(board.h)}" rx="20" fill="#000" opacity=".4" filter="url(#rb-soft)"/>`;
    s += `<rect x="${f1(board.x)}" y="${f1(board.y + 6)}" width="${f1(board.w)}" height="${f1(board.h)}" rx="20" fill="#000" opacity=".35"/>`;
    s += `<rect x="${f1(board.x)}" y="${f1(board.y)}" width="${f1(board.w)}" height="${f1(board.h)}" rx="20" fill="${look.frame}"/>`;
    s += `<rect x="${f1(map.x - 6)}" y="${f1(map.y - 6)}" width="${f1(map.w + 12)}" height="${f1(map.h + 12)}" rx="9" fill="url(#rb-check)"/>`;
    // 上边框：赛道名、一圈几格几个弯、指北针。竖屏整张转了 90°，标题会转到画面外，顶栏已经写着赛道名，就不印了
    if (!o.rot) {
      const tx = map.x + 14;
      const ty = board.y + 38;
      s += `<text x="${f1(tx)}" y="${f1(ty)}" font-family="${FONT}" font-size="30" font-weight="900" fill="${C.paper}" letter-spacing="8">${track.name}</text>`;
      s += `<text x="${f1(tx + 104)}" y="${f1(ty - 2)}" font-family="${FONT}" font-size="15" fill="${C.paper}" opacity=".8">一圈 ${N} 格 · ${track.corners.length} 个弯 · 热量 ${track.heat}</text>`;
    }
    s += `<g transform="translate(${f1(map.x + map.w - 24)} ${f1(board.y + 27)})"><circle r="15" fill="none" stroke="${C.paper}" stroke-width="${LW.minor}"/><path d="M0 -13L4 0L0 13L-4 0Z" fill="${C.paper}"/><path d="M0 -13L4 0H-4Z" fill="${C.red}"/></g>`;
    s += `<clipPath id="rb-map-${track.id}"><rect x="${f1(map.x)}" y="${f1(map.y)}" width="${f1(map.w)}" height="${f1(map.h)}" rx="6"/></clipPath>`;
    s += `<g clip-path="url(#rb-map-${track.id})"><rect x="${f1(map.x)}" y="${f1(map.y)}" width="${f1(map.w)}" height="${f1(map.h)}" fill="${look.ground}"/>`;
    if (o.grain) s += `<rect x="${f1(map.x)}" y="${f1(map.y)}" width="${f1(map.w)}" height="${f1(map.h)}" fill="url(#rb-mottle)"/>`;
    s += scene.draw(detail);
    // 弯外缓冲区
    track.corners.forEach((c, i) => {
      const b = bends[i]!;
      const wide = c.limit <= 4 ? 16 : 26;
      const ins = geo.strip(b.from, b.to + 1, b.side * (W / 2 + 3));
      const out = geo.strip(b.from, b.to + 1, b.side * (W / 2 + wide)).reverse();
      s += `<path d="${poly(ins)}L${poly(out).slice(1)}Z" fill="url(#${c.limit <= 4 ? 'rb-hatch' : 'rb-stip'})" stroke="${C.ink}" stroke-width="${LW.minor}"/>`;
      if (c.limit > 4) {
        const wall = poly(geo.strip(b.from, b.to + 1, b.side * (W / 2 + wide + 4)));
        s += `<path d="${wall}" fill="none" stroke="${C.ink}" stroke-width="5"/><path d="${wall}" fill="none" stroke="${C.paper}" stroke-width="2.4"/>`;
      }
    });
    // 维修区：通道（进出口顺着并回去）、维修墙、每队一个车位、一排车库
    if (pitSpan >= 4) {
      const ramp = Math.min(0.2, 1.4 / pitSpan);
      const ease = (u: number): number => {
        const q = Math.max(0, Math.min(1, Math.min(u, 1 - u) / ramp));
        return q * q * (3 - 2 * q);
      };
      const lane = along(geo, N, pitFrom, pitFrom + pitSpan, (u) => inside * (W / 2 + 4 + 20 * ease(u)));
      s += `<path d="${poly(lane)}" fill="none" stroke="${C.ink}" stroke-width="${18 + LW.minor * 2}" stroke-linejoin="round"/><path d="${poly(lane)}" fill="none" stroke="#6a6e76" stroke-width="18" stroke-linejoin="round"/>`;
      const a = pitFrom + pitSpan * ramp * 1.1;
      const b = pitFrom + pitSpan * (1 - ramp * 1.1);
      const wall = poly(along(geo, N, a, b, () => inside * (W / 2 + 11)));
      s += `<path d="${wall}" fill="none" stroke="${C.ink}" stroke-width="5"/><path d="${wall}" fill="none" stroke="${C.paper}" stroke-width="2.4"/>`;
      const gar = along(geo, N, a + 0.2, b - 0.2, () => inside * (W / 2 + 50), 4);
      s += `<path d="${poly(gar)}" fill="none" stroke="${C.ink}" stroke-width="${26 + LW.minor * 2}"/><path d="${poly(gar)}" fill="none" stroke="#ddd5c0" stroke-width="26"/><path d="${poly(gar)}" fill="none" stroke="${C.ink}" stroke-width="26" stroke-dasharray="${LW.minor} 30"/>`;
      const boxes = along(geo, N, a + 0.6, b - 0.6, () => inside * (W / 2 + 24), 4);
      CAR_COLORS.forEach((col, i) => {
        const p = boxes[Math.round((i / (CAR_COLORS.length - 1)) * (boxes.length - 1))]!;
        s += `<rect x="${f1(p.x - 5)}" y="${f1(p.y - 5)}" width="10" height="10" fill="${col.body}" stroke="${C.ink}" stroke-width="${LW.decor}"/>`;
      });
      if (detail) {
        const m = gar[Math.floor(gar.length / 2)]!;
        s += `<text x="${f1(m.x)}" y="${f1(m.y + 4)}" font-family="${FONT}" font-size="11" font-weight="700" text-anchor="middle" fill="${C.ink}" letter-spacing="8"${o.rot ? ` transform="rotate(-90 ${f1(m.x)} ${f1(m.y)})"` : ''}>维修区</text>`;
      }
    }
    // 林子：先画所有树冠的墨线外圈，再盖填充，再加右下的暗面——只剩外缘一条起伏的线
    s += trees.map((t) => `<circle cx="${f1(t.x)}" cy="${f1(t.y)}" r="${f1(t.r + LW.major)}" fill="${C.ink}"/>`).join('');
    s += trees.map((t) => `<circle cx="${f1(t.x)}" cy="${f1(t.y)}" r="${f1(t.r)}" fill="${t.k < look.autumn ? C.autumn : C.forest}"/>`).join('');
    s += trees
      .map((t) => {
        const r = t.r * 0.82;
        return `<path d="M${f1(t.x + r)} ${f1(t.y)}A${f1(r)} ${f1(r)} 0 0 1 ${f1(t.x)} ${f1(t.y + r)}A${f1(r * 0.9)} ${f1(r * 0.9)} 0 0 0 ${f1(t.x + r)} ${f1(t.y)}Z" fill="${t.k < look.autumn ? C.autumnDark : C.forestDark}"/>`;
      })
      .join('');
    if (detail) s += trees.filter((_, i) => i % 3 === 0).map((t) => `<circle cx="${f1(t.x - t.r * 0.3)}" cy="${f1(t.y - t.r * 0.3)}" r="${f1(t.r * 0.28)}" fill="${C.forestLight}"/>`).join('');
    // 主直道外侧的大看台：一排排彩色座位，后面一道顶棚
    {
      const base = poly(geo.strip(N - 5, 6, -inside * (W / 2 + 40), 6));
      const roof = poly(geo.strip(N - 5, 6, -inside * (W / 2 + 56), 6));
      s += `<path d="${base}" fill="none" stroke="${C.ink}" stroke-width="${26 + LW.minor * 2}"/><path d="${base}" fill="none" stroke="#d8cfb8" stroke-width="26"/>`;
      for (const [col, dash, off] of [
        ['#c96a5a', '2 5', 0],
        ['#5a86c9', '2 6', 3],
        ['#e0b84a', '2 9', 1],
      ] as const)
        s += `<path d="${base}" fill="none" stroke="${col}" stroke-width="16" stroke-dasharray="${dash}" stroke-dashoffset="${off}"/>`;
      s += `<path d="${roof}" fill="none" stroke="${C.ink}" stroke-width="${10 + LW.minor * 2}"/><path d="${roof}" fill="none" stroke="${C.paper}" stroke-width="10"/>`;
    }
    // 赛道：墨线外框、白边、一块干净的深色路面
    s += `<path d="${geo.path}" fill="none" stroke="${C.ink}" stroke-width="${W + 4 + LW.major * 2}" stroke-linejoin="round"/><path d="${geo.path}" fill="none" stroke="${C.paper}" stroke-width="${W + 4}" stroke-linejoin="round"/><path d="${geo.path}" fill="none" stroke="${C.track}" stroke-width="${W - 2}" stroke-linejoin="round"/>`;
    // 格线：淡，每 5 格一道白线（数格子用）
    geo.edges.forEach((e, i) => {
      if (i === 0) return;
      const nx = Math.sin(e.angle) * (W / 2 - 1);
      const ny = -Math.cos(e.angle) * (W / 2 - 1);
      const five = i % 5 === 0;
      s += `<path d="M${f1(e.c.x + nx)},${f1(e.c.y + ny)}L${f1(e.c.x - nx)},${f1(e.c.y - ny)}" stroke="${five ? C.paper : C.trackLine}" stroke-width="${five ? 2.4 : 1.4}"/>`;
    });
    // 红白路肩：只在弯里，内外两侧
    for (const b of bends)
      for (const side of [1, -1]) {
        const d = poly(geo.strip(b.from, b.to, side * (W / 2 + 1), 3));
        s += `<path d="${d}" fill="none" stroke="${C.paper}" stroke-width="5"/><path d="${d}" fill="none" stroke="${C.red}" stroke-width="5" stroke-dasharray="7 7"/>`;
      }
    // 起终点黑白格、发车框
    {
      const e0 = geo.edges[0]!;
      const sq = (W - 2) / 6;
      s += `<g transform="translate(${f1(e0.c.x)} ${f1(e0.c.y)}) rotate(${f1((e0.angle * 180) / Math.PI)})">`;
      for (let row = 0; row < 2; row++) for (let k = 0; k < 6; k++) s += `<rect x="${f1((row - 1) * sq)}" y="${f1(-W / 2 + 1 + k * sq)}" width="${f1(sq)}" height="${f1(sq)}" fill="${(k + row) % 2 ? C.ink : C.paper}"/>`;
      s += `</g>`;
      for (let k = 1; k <= 3; k++) {
        const cell = geo.cells[N - k]!;
        for (const p of cell.spots) s += `<g transform="translate(${f1(p.x)} ${f1(p.y)}) rotate(${f1((cell.angle * 180) / Math.PI)})"><path d="M5 -8H11V8H5" fill="none" stroke="${C.paper}" stroke-width="${LW.minor}"/></g>`;
      }
    }
    // 弯道线：红线白边
    for (const c of track.corners) {
      const e = geo.edges[c.at]!;
      const nx = Math.sin(e.angle) * (W / 2);
      const ny = -Math.cos(e.angle) * (W / 2);
      const d = `M${f1(e.c.x + nx)} ${f1(e.c.y + ny)}L${f1(e.c.x - nx)} ${f1(e.c.y - ny)}`;
      s += `<path d="${d}" stroke="${C.paper}" stroke-width="6"/><path d="${d}" stroke="${C.red}" stroke-width="3.6"/>`;
    }
    if (o.grain) s += `<rect x="${f1(map.x)}" y="${f1(map.y)}" width="${f1(map.w)}" height="${f1(map.h)}" fill="url(#rb-grain)"/>`;
    return `${s}</g>`;
  };

  /** 第 i 个弯的制动牌 k（弯道线前第 k 格，立在弯外那一侧） */
  const brakeAt = (i: number, k: number): Pt => {
    const c = track.corners[i]!;
    const side = bends[i]!.side;
    const cell = geo.cells[(c.at - k + N) % N]!;
    return { x: cell.c.x + Math.sin(cell.angle) * side * (W / 2 + 12), y: cell.c.y - Math.cos(cell.angle) * side * (W / 2 + 12) };
  };

  const labels = (o: { k: number; rot: boolean; next: number }): string => {
    const detail = o.k >= LOD;
    const turn = o.rot ? ' rotate(-90)' : '';
    let s = '';
    if (detail) {
      // 格号：路边每 5 格一个小圆牌
      geo.cells.forEach((c, i) => {
        if (i % 5) return;
        const x = c.c.x + Math.sin(c.angle) * -inside * (W / 2 + 13);
        const y = c.c.y - Math.cos(c.angle) * -inside * (W / 2 + 13);
        s += `<g transform="translate(${f1(x)} ${f1(y)})${turn}"><circle r="9" fill="${C.paper}" stroke="${C.ink}" stroke-width="${LW.minor}"/><text y="3.6" font-family="${FONT}" font-size="10" font-weight="800" text-anchor="middle" fill="${C.ink}">${i}</text></g>`;
      });
      // 制动牌：弯道线前三格，写着停在这格再跑几格就过弯道线
      track.corners.forEach((c, i) => {
        for (let k = 1; k <= 3; k++) {
          const { x, y } = brakeAt(i, k);
          s += `<g class="brake" transform="translate(${f1(x)} ${f1(y)})${turn}" data-at="${c.at}" data-k="${k}"><rect x="-6.5" y="-6" width="13" height="12" rx="2" fill="${C.paper}" stroke="${C.ink}" stroke-width="${LW.minor}"/><text y="3.8" font-family="${FONT}" font-size="10" font-weight="900" text-anchor="middle" fill="${C.ink}">${k}</text></g>`;
        }
      });
    }
    // 限速牌：路边竖一根牌杆，从赛道边沿着弯道线的方向垂直伸出去，杆头一块白底红圈黑字的圆牌——弯道线顺着杆子指到牌子，对不错弯，路面上不压东西。
    // 缩小了牌子保持屏幕上约 24 像素宽（杆子跟着加长，牌子不压路）；下一个弯描一圈金边
    const ds = Math.max(1, 1 / o.k);
    const lay = signLayout(Math.round(ds * 10) / 10);
    shields.forEach((sh, i) => {
      const e = geo.edges[sh.at]!;
      const hot = o.next === sh.at;
      const { side, p } = lay[i]!;
      const nx = Math.sin(e.angle) * side;
      const ny = -Math.cos(e.angle) * side;
      const p0 = { x: e.c.x + nx * (W / 2 + 1), y: e.c.y + ny * (W / 2 + 1) };
      s += `<path d="M${f1(p0.x)} ${f1(p0.y)}L${f1(p.x)} ${f1(p.y)}" stroke="${C.ink}" stroke-width="${f1(4 * Math.min(ds, 2))}" stroke-linecap="round"/><path d="M${f1(p0.x)} ${f1(p0.y)}L${f1(p.x)} ${f1(p.y)}" stroke="#9aa0a6" stroke-width="${f1(1.8 * Math.min(ds, 2))}" stroke-linecap="round"/>`;
      s += `<g class="limit" transform="translate(${f1(p.x)} ${f1(p.y)})${turn} scale(${f1(ds)})" data-at="${sh.at}">`;
      if (hot) s += `<circle r="${SIGN_R + 3.5}" fill="${C.gold}" stroke="${C.ink}" stroke-width="${LW.minor}"/>`;
      s += `<circle r="${SIGN_R}" fill="#fff" stroke="${C.ink}" stroke-width="${LW.minor}"/><circle r="${SIGN_R - 2.6}" fill="none" stroke="${C.red}" stroke-width="3.4"/><text y="5" font-family="${FONT}" font-size="14" font-weight="900" text-anchor="middle" fill="${C.ink}">${sh.limit}</text></g>`;
    });
    // 放大以后：弯外一块小名牌写"T 几 + 弯名"（不再写数字，限速只在弯道线上那一处），名牌被挤到别处时一条短虚线连回弯道线外端
    if (detail)
      for (const sh of shields) {
        const e = geo.edges[sh.at]!;
        const side = bends[sh.i]!.side;
        const ax = e.c.x + Math.sin(e.angle) * side * (W / 2 + 3);
        const ay = e.c.y - Math.cos(e.angle) * side * (W / 2 + 3);
        const x = o.rot ? sh.rx : sh.x;
        const y = o.rot ? sh.ry : sh.y;
        if (Math.hypot(x - ax, y - ay) > 40) s += `<path d="M${f1(ax)} ${f1(ay)}L${f1(x)} ${f1(y)}" stroke="${C.ink}" stroke-width="${LW.decor}" stroke-dasharray="3 3" opacity=".7"/>`;
        const label = sh.name ? `T${sh.i + 1} ${sh.name}` : `T${sh.i + 1}`;
        const w = label.length * 10 + 12;
        s += `<g class="tag" transform="translate(${f1(x)} ${f1(y)})${turn}"><path d="M${f1(-w / 2 - 6)} -9h6v-2h${f1(w)}v2h6l-4 7l4 7h-6v2h${f1(-w)}v-2h-6l4 -7z" fill="${C.paper}" stroke="${C.ink}" stroke-width="${LW.minor}"/><text y="2" font-family="${FONT}" font-size="11" font-weight="700" text-anchor="middle" fill="${C.ink}">${label}</text></g>`;
      }
    return s;
  };

  return {
    geo,
    board,
    shields,
    draw,
    labels,
    sign: (at: number) => signs[shields.findIndex((sh) => sh.at === at)]!,
    brake: (at: number, k: number) => brakeAt(shields.findIndex((sh) => sh.at === at), k),
  };
}

/**
 * 地图板和棋子要用的图案、滤镜（一个页面里的每张 SVG 各带一份，id 一样，内容一样）。
 * 纸纹和斑驳是 public/art/ 的平铺纹理（scripts/art.ts 生成）：实时算噪声滤镜，手机上烘焙要多卡半秒多
 */
export const MAP_DEFS = `<pattern id="rb-grain" patternUnits="userSpaceOnUse" width="128" height="128"><image href="art/grain.webp" width="128" height="128"/></pattern>
<pattern id="rb-mottle" patternUnits="userSpaceOnUse" width="512" height="512"><image href="art/mottle.webp" width="512" height="512" preserveAspectRatio="none"/></pattern>
<filter id="rb-soft" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="5"/></filter>
<filter id="rb-soft2" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="1.4"/></filter>
<pattern id="rb-hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" fill="${C.runoff}"/><path d="M0 0V7" stroke="${C.red}" stroke-width="1.6" opacity=".55"/></pattern>
<pattern id="rb-stip" width="9" height="9" patternUnits="userSpaceOnUse"><rect width="9" height="9" fill="${C.runoff}"/><circle cx="2" cy="2.5" r=".8" fill="${C.ink}" opacity=".5"/><circle cx="6.5" cy="6.5" r=".7" fill="${C.ink}" opacity=".4"/></pattern>
<pattern id="rb-check" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="${C.paper}"/><rect width="6" height="6" fill="${C.ink}"/><rect x="6" y="6" width="6" height="6" fill="${C.ink}"/></pattern>
<radialGradient id="rb-plast" cx=".35" cy=".3" r=".85"><stop offset="0" stop-color="#fff" stop-opacity=".65"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></radialGradient>`;
