/**
 * 录像存储（localStorage `yexun.replays`，只在本机，不同步、不上传）。
 * 留什么：最近 5 局 + 每个榜自己最好的一局；总量 ≤ 300 KB，超了先删最旧的普通局，还超再删最旧的"最好"。
 * 存储不可用（隐私模式、满了）时照常能玩，只是不记得；坏数据一律丢弃，不抛错。
 */
import { decodeDirs, decodePicks, type ReplayRecord } from './format.ts';

export const REPLAYS_KEY = 'yexun.replays';
export const RECENT_KEEP = 5;
export const BUDGET_CHARS = 300_000;

interface Disk {
  v: 1;
  items: readonly ReplayRecord[];
}

/** 够用的 localStorage 子集，测试里传内存版 */
export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

function sane(x: unknown): ReplayRecord | null {
  if (typeof x !== 'object' || x === null) return null;
  const r = x as ReplayRecord;
  if (r.v !== 1 || typeof r.id !== 'string' || !Number.isSafeInteger(r.rules) || !Number.isFinite(r.at)) return null;
  if (typeof r.dirs !== 'string' || typeof r.picks !== 'string' || !Number.isSafeInteger(r.ticks)) return null;
  if (typeof r.setup !== 'object' || r.setup === null || typeof r.setup.seed !== 'number') return null;
  if (typeof r.summary !== 'object' || r.summary === null || !Array.isArray(r.bestFor) || typeof r.scores !== 'object' || r.scores === null) return null;
  // 方向和选择必须解得开，不然放出来会歪（也防手改）
  if (!decodeDirs(r.dirs, r.ticks) || !decodePicks(r.picks)) return null;
  return r;
}

export function loadReplays(kv: KV | undefined = defaultKV()): ReplayRecord[] {
  try {
    const raw = kv?.getItem(REPLAYS_KEY);
    if (!raw) return [];
    const o = JSON.parse(raw) as Partial<Disk>;
    if (!o || o.v !== 1 || !Array.isArray(o.items)) return [];
    return o.items.map(sane).filter((r): r is ReplayRecord => r !== null);
  } catch {
    return [];
  }
}

export function sizeOf(items: readonly ReplayRecord[]): number {
  return JSON.stringify({ v: 1, items }).length;
}

/**
 * 加一局，返回整理后的列表（新的在前）。scores 是这一局在各榜上的成绩（榜名 → 分数），
 * 比这个榜原来最好的一局高（或这个榜还没有）就接过"最好"；原来那局不再是任何榜的最好就回到普通局里排队。
 */
export function addReplay(list: readonly ReplayRecord[], rec: ReplayRecord): ReplayRecord[] {
  const items = [rec, ...list.filter((r) => r.id !== rec.id)].map((r) => ({ ...r, bestFor: [...r.bestFor] }));
  const mine = items[0]!;
  mine.bestFor = [];
  for (const [board, score] of Object.entries(rec.scores)) {
    const holder = items.find((r, i) => i > 0 && r.bestFor.includes(board));
    if (!holder || score > (holder.scores[board] ?? -Infinity)) {
      if (holder) holder.bestFor = holder.bestFor.filter((b) => b !== board);
      mine.bestFor.push(board);
    }
  }
  return trim(items);
}

/** 按规矩留：最近 5 局 + 所有"最好"；再按总量删 */
export function trim(items: readonly ReplayRecord[]): ReplayRecord[] {
  const byNew = [...items].sort((a, b) => b.at - a.at);
  const recent = new Set(byNew.slice(0, RECENT_KEEP).map((r) => r.id));
  let keep = byNew.filter((r) => recent.has(r.id) || r.bestFor.length > 0);
  // 超了先删最旧的普通局（不是"最好"的），还超再删最旧的"最好"，最后一局不删
  while (sizeOf(keep) > BUDGET_CHARS && keep.length > 1) {
    let at = -1;
    for (let i = keep.length - 1; i >= 0; i--) if (keep[i]!.bestFor.length === 0) { at = i; break; }
    if (at < 0) at = keep.length - 1;
    keep = keep.filter((_, i) => i !== at);
  }
  return keep;
}

export function saveReplays(items: readonly ReplayRecord[], kv: KV | undefined = defaultKV()): boolean {
  try {
    kv?.setItem(REPLAYS_KEY, JSON.stringify({ v: 1, items } satisfies Disk));
    return kv !== undefined;
  } catch {
    return false;
  }
}

/** 录一局：读出旧的、加上、整理、写回，返回整理后的列表 */
export function storeReplay(rec: ReplayRecord, kv: KV | undefined = defaultKV()): ReplayRecord[] {
  const next = addReplay(loadReplays(kv), rec);
  saveReplays(next, kv);
  return next;
}

function defaultKV(): KV | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
