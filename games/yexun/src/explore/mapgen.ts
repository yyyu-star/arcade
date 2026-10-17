/**
 * 夜探的地图生成（DESIGN.md 2.3、3.6）：按格子出街、院、墙的骨架，种子定院子的样子、门开在哪、宝箱、守卫、出生点。
 * 古镇：横平竖直的街巷；渡口：一行院子换成河，只留几座桥；山寺：两道台阶墙横断，只留几个窄口；教学镇：2 × 2 块的小镇。
 *
 * 保证（tests/explore-map.test.ts 按模板 × 种子扫）：出生点沿路走得到每座门、每个宝箱；宝箱、门圈、出生点不压墙。
 * 做法上靠构造保证：街是连通的网格，每座院至少一个门朝街；河和台阶墙至少留一个口；最后用寻路格子再核一遍，放不下的宝箱就不放。
 *
 * 只用"地图"和"宝箱"两条随机流（种子和用途名哈希）：同一种子同一模板，生成的地图逐位相同。
 */
import { CHEST_SPACING, RAID_TEMPLATES, RAID_WALL, SPAWN_INSET, type ChestTier, type RaidEnemyKind, type RaidTemplate, type RaidTemplateId } from '../content/explore.ts';
import type { EnemyKind } from '../content/enemies.ts';
import { dist } from '../core/fmath.ts';
import { Rng } from '../core/rng.ts';
import { BlockIndex, type RaidBlock } from './blocks.ts';
import { rollChest } from './loot.ts';
import { NAV_INF, NavGrid } from './nav.ts';

export type YardKind = 'yard' | 'plaza' | 'ruin' | 'temple' | 'vault';

/** 一块院子（画面层按 kind 铺地面、点灯笼；小地图画轮廓） */
export interface Yard {
  bx: number;
  by: number;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: YardKind;
  /** 门开在哪几边：0 北 1 东 2 南 3 西 */
  doors: number[];
}

export interface ChestSpot {
  x: number;
  y: number;
  tier: ChestTier;
  /** 0 镇边 – 1 镇中心 */
  depth: number;
  /** 地图生成时就抽好的宝物编号 */
  items: number[];
  /** 守着它的守卫（guards 的下标），没有是 −1 */
  guard: number;
}

export type GuardRole = 'copper' | 'patrol' | 'beast';

export interface GuardSpot {
  role: GuardRole;
  kind: EnemyKind | RaidEnemyKind;
  /** 出生点就是家 */
  x: number;
  y: number;
  chest: number;
}

export interface GateSpot {
  name: string;
  x: number;
  y: number;
}

export interface RaidMap {
  template: RaidTemplateId;
  size: number;
  center: number;
  blocks: RaidBlock[];
  index: BlockIndex;
  nav: NavGrid;
  yards: Yard[];
  chests: ChestSpot[];
  guards: GuardSpot[];
  gates: GateSpot[];
  spawn: { x: number; y: number };
  /** 街口（巡夜将游荡的路点）和走得通的连线 */
  nodes: { x: number; y: number }[];
  links: number[][];
}

/** 宝箱、守卫离墙至少这么远 */
const CHEST_R = 22;
const GUARD_R = 30;

/** 门的朝向 → 从院子中心指向门的单位向量 */
const DOOR_DX = [0, 1, 0, -1];
const DOOR_DY = [-1, 0, 1, 0];

export function generateMap(template: RaidTemplateId, seed: number): RaidMap {
  const tpl = RAID_TEMPLATES[template];
  const rng = new Rng(seed, 'raid-map');
  const { size, cell, streets: S, streetPad: pad } = tpl;
  const center = size / 2;

  // 街和街之间的格子并成一块：每块的格子范围
  const ranges: [number, number][] = [];
  for (let k = 0; k + 1 < S.length; k++) if (S[k]! + 1 <= S[k + 1]! - 1) ranges.push([S[k]! + 1, S[k + 1]! - 1]);

  const blocks: RaidBlock[] = [];
  const yards: Yard[] = [];

  if (tpl.river) river(tpl, ranges, rng, blocks);
  if (tpl.terraces) terraces(tpl, rng, blocks);

  // 院子：先把每块的样子定下来（宝箱、守卫放在后面，等寻路格子出来再核）
  const pending: { yard: Yard; chest: ChestTier | null; guard: GuardRole | null; guardKind: EnemyKind | RaidEnemyKind | null; extra: number }[] = [];
  for (let by = 0; by < ranges.length; by++) {
    if (tpl.river && by === tpl.river.row) continue;
    for (let bx = 0; bx < ranges.length; bx++) {
      const x0 = ranges[bx]![0] * cell - pad;
      const x1 = (ranges[bx]![1] + 1) * cell + pad;
      const y0 = ranges[by]![0] * cell - pad;
      const y1 = (ranges[by]![1] + 1) * cell + pad;
      const isVault = tpl.vault !== null && tpl.vault[0] === bx && tpl.vault[1] === by;
      const isTemple = tpl.temples.some(([tx, ty]) => tx === bx && ty === by);
      let kind: YardKind;
      if (isVault) kind = 'vault';
      else if (isTemple) kind = 'temple';
      else {
        const r = rng.next();
        kind = r < tpl.plazaChance ? 'plaza' : r < tpl.plazaChance + tpl.ruinChance ? 'ruin' : 'yard';
      }
      const yard: Yard = { bx, by, x: x0, y: y0, w: x1 - x0, h: y1 - y0, kind, doors: [] };
      yards.push(yard);
      if (kind === 'plaza') plaza(yard, rng, blocks);
      else walledYard(yard, rng, blocks, tpl.terraces?.rows.includes(ranges[by]![0] - 1) ? [0] : []);

      if (kind === 'vault') pending.push({ yard, chest: 'gold', guard: 'beast', guardKind: 'beast', extra: 1 });
      else if (kind === 'temple') pending.push({ yard, chest: 'gold', guard: tpl.templeGuard ? 'patrol' : null, guardKind: tpl.templeGuard ? 'patrol' : null, extra: 0 });
      else if (rng.next() < tpl.copperChance) {
        const guarded = tpl.copperGuards.length > 0 && rng.next() < tpl.copperGuardChance;
        pending.push({ yard, chest: 'copper', guard: guarded ? 'copper' : null, guardKind: guarded ? tpl.copperGuards[rng.int(tpl.copperGuards.length)]! : null, extra: 0 });
      }
    }
  }

  const index = new BlockIndex(blocks, size);
  const nav = new NavGrid(blocks, size);
  const inRing = (v: number): number => Math.min(size - cell / 2, Math.max(cell / 2, v));
  const gates: GateSpot[] = tpl.gates.map((g) => ({ name: g.name, x: inRing(g.fx * size), y: inRing(g.fy * size) }));

  const corner = rng.int(4);
  const spawn = { x: corner & 1 ? size - SPAWN_INSET : SPAWN_INSET, y: corner & 2 ? size - SPAWN_INSET : SPAWN_INSET };
  const reach = nav.field([nav.index(spawn.x, spawn.y)]);
  const ok = (x: number, y: number, r: number): boolean => index.free(x, y, r) && reach[nav.index(x, y)]! < NAV_INF;
  const depthOf = (x: number, y: number): number => {
    const d = 1 - dist(x - center, y - center) / center;
    return d < 0 ? 0 : d > 1 ? 1 : d;
  };

  const chests: ChestSpot[] = [];
  const guards: GuardSpot[] = [];
  const addChest = (x: number, y: number, tier: ChestTier): number => {
    if (!ok(x, y, CHEST_R)) return -1;
    chests.push({ x, y, tier, depth: depthOf(x, y), items: [], guard: -1 });
    return chests.length - 1;
  };
  const addGuard = (role: GuardRole, kind: EnemyKind | RaidEnemyKind, x: number, y: number, chest: number): void => {
    if (chest < 0 || !ok(x, y, GUARD_R)) return;
    guards.push({ role, kind, x, y, chest });
    chests[chest]!.guard = guards.length - 1;
  };

  for (const p of pending) {
    const { yard } = p;
    const cx = yard.x + yard.w / 2;
    const cy = yard.y + yard.h / 2;
    const d0 = yard.doors[0] ?? 2;
    const fx = DOOR_DX[d0]!;
    const fy = DOOR_DY[d0]!;
    if (p.extra > 0) {
      // 石兽的院子：两个金箱靠着正房、左右分开，石兽蹲在门里
      const ch = [addChest(cx - fx * 60 + fy * 170, cy - fy * 60 + fx * 170, 'gold'), addChest(cx - fx * 60 - fy * 170, cy - fy * 60 - fx * 170, 'gold')];
      if (p.guardKind) addGuard('beast', p.guardKind, cx + fx * 170, cy + fy * 170, ch[0]!);
      // 第二个金箱也记在石兽名下（打开它同样要过石兽这一关）
      if (ch[1]! >= 0 && guards.length > 0 && ch[0]! >= 0) chests[ch[1]!]!.guard = chests[ch[0]!]!.guard;
      continue;
    }
    const c = addChest(cx, cy, p.chest!);
    if (p.guard && p.guardKind) addGuard(p.guard, p.guardKind, cx + fx * 130, cy + fy * 130, c);
  }

  // 街边木箱：所有不是路口的街格，两侧各一个候选，洗牌后按间距挑
  const cand: [number, number][] = [];
  const n = size / cell;
  const isStreet = new Uint8Array(n);
  for (const s of S) isStreet[s] = 1;
  const side = cell / 2 - pad - 34;
  for (const s of S) {
    for (let t = 0; t < n; t++) {
      if (isStreet[t]) continue;
      const a = (s + 0.5) * cell;
      const b = (t + 0.5) * cell;
      cand.push([a - side, b], [a + side, b], [b, a - side], [b, a + side]);
    }
  }
  for (let i = cand.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = cand[i]!;
    cand[i] = cand[j]!;
    cand[j] = t;
  }
  let wood = 0;
  for (const [x, y] of cand) {
    if (wood >= tpl.wood) break;
    if (dist(x - spawn.x, y - spawn.y) < CHEST_SPACING.spawn) continue;
    if (chests.some((c) => dist(c.x - x, c.y - y) < CHEST_SPACING.wood)) continue;
    if (addChest(x, y, 'wood') >= 0) wood++;
  }

  // 宝物一次抽好：开箱的先后不影响箱子里是什么
  const loot = new Rng(seed, 'raid-loot');
  for (const c of chests) c.items = rollChest(loot, c.tier, c.depth);

  // 街口和连线（游荡的巡夜将沿街走）
  const nodes: { x: number; y: number }[] = [];
  const nodeAt = new Int32Array(S.length * S.length).fill(-1);
  for (let j = 0; j < S.length; j++) {
    for (let i = 0; i < S.length; i++) {
      const x = (S[i]! + 0.5) * cell;
      const y = (S[j]! + 0.5) * cell;
      if (!index.free(x, y, GUARD_R) || reach[nav.index(x, y)]! >= NAV_INF) continue;
      nodeAt[j * S.length + i] = nodes.length;
      nodes.push({ x, y });
    }
  }
  const links: number[][] = nodes.map(() => []);
  const free = (x: number, y: number, r: number): boolean => index.free(x, y, r);
  for (let j = 0; j < S.length; j++) {
    for (let i = 0; i < S.length; i++) {
      const a = nodeAt[j * S.length + i]!;
      if (a < 0) continue;
      for (const [di, dj] of [[1, 0], [0, 1]] as const) {
        if (i + di >= S.length || j + dj >= S.length) continue;
        const b = nodeAt[(j + dj) * S.length + i + di]!;
        if (b < 0) continue;
        if (!nav.lineClear(nodes[a]!.x, nodes[a]!.y, nodes[b]!.x, nodes[b]!.y, 20, free)) continue;
        links[a]!.push(b);
        links[b]!.push(a);
      }
    }
  }

  return { template, size, center, blocks, index, nav, yards, chests, guards, gates, spawn, nodes, links };
}

/** 渡口的河：这一行块整行（含两边的环街）是水，只在挑中的竖街上留桥 */
function river(tpl: RaidTemplate, ranges: [number, number][], rng: Rng, blocks: RaidBlock[]): void {
  const { row, bridges } = tpl.river!;
  const { cell, streetPad: pad, size, streets: S } = tpl;
  const y0 = ranges[row]![0] * cell;
  const y1 = (ranges[row]![1] + 1) * cell;
  const inner = S.slice(1, -1);
  const pick = shuffle(inner.slice(), rng).slice(0, Math.max(1, bridges)).sort((a, b) => a - b);
  let x = 0;
  for (const s of pick) {
    const g0 = s * cell + pad;
    if (g0 > x) blocks.push({ x, y: y0, w: g0 - x, h: y1 - y0, look: 'river' });
    x = (s + 1) * cell - pad;
  }
  if (x < size) blocks.push({ x, y: y0, w: size - x, h: y1 - y0, look: 'river' });
}

/**
 * 山寺的台阶墙：贴着横街南边（下一排院子的北墙外）砌一整道，只在挑中的竖街上留窄口（至少一个）。
 * 横街本身完整（路口还在，巡夜将照样沿街走）；墙下那排院子不往北开门（generateMap 里封掉）。
 */
function terraces(tpl: RaidTemplate, rng: Rng, blocks: RaidBlock[]): void {
  const { rows, gaps, gapWidth } = tpl.terraces!;
  const { cell, size, streets: S, streetPad: pad } = tpl;
  const T = RAID_WALL.thick;
  for (const row of rows) {
    const y = (row + 1) * cell - pad - T;
    const pick = shuffle(S.slice(), rng).slice(0, Math.max(1, gaps)).sort((a, b) => a - b);
    let x = 0;
    for (const s of pick) {
      const gc = (s + 0.5) * cell;
      const g0 = gc - gapWidth / 2;
      if (g0 > x) blocks.push({ x, y, w: g0 - x, h: T, look: 'terrace' });
      x = gc + gapWidth / 2;
    }
    if (x < size) blocks.push({ x, y, w: size - x, h: T, look: 'terrace' });
  }
}

/** 有墙的院子：四面墙、门（院和庙 2 个、石兽院 1 个、破院最多 3 个且更宽；只开一个门的院子走出来绕得太远，天亮前赶不到门），正房靠着第一个门对面的墙；noDoor 那几面不开门 */
function walledYard(yard: Yard, rng: Rng, blocks: RaidBlock[], noDoor: readonly number[]): void {
  const T = RAID_WALL.thick;
  const ruin = yard.kind === 'ruin';
  const doorW = ruin ? RAID_WALL.door + 80 : RAID_WALL.door;
  const can = [0, 1, 2, 3].filter((s) => !noDoor.includes(s));
  const d0 = can[rng.int(can.length)]!;
  const back = (d0 + 2) % 4;
  const count = yard.kind === 'vault' ? 1 : ruin ? 3 : 2;
  // 其余的门不开在正房那面墙上（破院没有正房，四面都行），也不开在被台阶墙封住的那面
  const others = shuffle(can.filter((s) => s !== d0 && (ruin || s !== back)), rng);
  yard.doors = [d0, ...others.slice(0, count - 1)];

  const x0 = yard.x;
  const y0 = yard.y;
  const x1 = yard.x + yard.w;
  const y1 = yard.y + yard.h;
  const margin = doorW / 2 + T + 70;
  const doorAt = (lo: number, hi: number): number => lo + margin + rng.next() * (hi - lo - 2 * margin);
  for (let s = 0; s < 4; s++) {
    const has = yard.doors.includes(s);
    if (s === 0 || s === 2) {
      const y = s === 0 ? y0 : y1 - T;
      if (!has) blocks.push({ x: x0, y, w: x1 - x0, h: T, look: 'wall_h' });
      else {
        const dc = doorAt(x0, x1);
        blocks.push({ x: x0, y, w: dc - doorW / 2 - x0, h: T, look: 'wall_h' });
        blocks.push({ x: dc + doorW / 2, y, w: x1 - dc - doorW / 2, h: T, look: 'wall_h' });
      }
    } else {
      const x = s === 3 ? x0 : x1 - T;
      if (!has) blocks.push({ x, y: y0 + T, w: T, h: y1 - y0 - 2 * T, look: 'wall_v' });
      else {
        const dc = doorAt(y0, y1);
        blocks.push({ x, y: y0 + T, w: T, h: dc - doorW / 2 - y0 - T, look: 'wall_v' });
        blocks.push({ x, y: dc + doorW / 2, w: T, h: y1 - T - dc - doorW / 2, look: 'wall_v' });
      }
    }
  }
  if (ruin) return;
  // 正房：靠着后墙，占内宽的 55%
  const ix0 = x0 + T;
  const ix1 = x1 - T;
  const iy0 = y0 + T;
  const iy1 = y1 - T;
  const D = RAID_WALL.houseDepth;
  const look = yard.kind === 'temple' || yard.kind === 'vault' ? 'hall' : 'house';
  const hw = (ix1 - ix0) * 0.55;
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  if (back === 0) blocks.push({ x: cx - hw / 2, y: iy0, w: hw, h: D, look });
  else if (back === 2) blocks.push({ x: cx - hw / 2, y: iy1 - D, w: hw, h: D, look });
  else if (back === 3) blocks.push({ x: ix0, y: cy - hw / 2, w: D, h: hw, look });
  else blocks.push({ x: ix1 - D, y: cy - hw / 2, w: D, h: hw, look });
}

/** 空场：没有墙，两排摊子，中间留空 */
function plaza(yard: Yard, rng: Rng, blocks: RaidBlock[]): void {
  yard.doors = [0, 1, 2, 3];
  const inset = 140;
  const w = yard.w - 2 * inset;
  const h = yard.h - 2 * inset;
  for (let row = 0; row < 2; row++) {
    for (let k = 0; k < 3; k++) {
      const x = yard.x + inset + ((k + 0.5) * w) / 3 + (rng.next() - 0.5) * 80;
      const y = yard.y + inset + ((row * 2 + 1) * h) / 4 + (rng.next() - 0.5) * 40;
      blocks.push({ x: x - 42, y: y - 22, w: 84, h: 44, look: 'stall' });
    }
  }
}

function shuffle<T>(a: T[], rng: Rng): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  }
  return a;
}
