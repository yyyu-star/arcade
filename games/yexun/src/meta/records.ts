/**
 * 局外的"战绩簿"（DESIGN.md 3.8、5.5）：一局结束时的摘要 RunSummary、累计统计 Records、解锁成就的纯函数 applyRun，
 * 以及本机存储（`yexun.records`）。云存档合并（集合并集、计数取大）以后由 cloud.ts 做，形状在这里定。
 * 不碰规则核心：只读 World 和它这一拍的事件；这里的代码不用随机数和时间。
 */
import { ENEMIES, type EnemyKind } from '../content/enemies.ts';
import { MAP_IDS, type MapId } from '../content/maps.ts';
import type { Danger } from '../content/waves.ts';

/** 危险档当键（JSON 里是字符串） */
export type DangerKey = `${Danger}`;
import { MAX_WEAPON_LEVEL, MERGES, PASSIVES, WEAPONS, type MergeDef, type PassiveId, type WeaponId } from '../content/weapons.ts';
import { ACHIEVEMENTS } from '../content/achievements.ts';
import { Ev } from '../core/events.ts';
import { TICKS_PER_SECOND, type World } from '../core/state.ts';

export const RECORDS_KEY = 'yexun.records';

/** 一局结束时的摘要。字段都来自 World（见 summarize）；需要累计的几项由 RunTally 逐拍从事件里数 */
export interface RunSummary {
  danger: Danger;
  map: MapId;
  /** 赢了（天亮或打倒尸王） */
  won: boolean;
  /** 中途认输（也记战绩，但不算赢） */
  quit: boolean;
  /** 撑了多少秒 */
  seconds: number;
  /** 击杀总数 */
  kills: number;
  /** 各种怪各打倒几只 */
  killsByKind: Partial<Record<EnemyKind, number>>;
  /** 这一局里见到过的怪（场上出现过或被打倒过） */
  seen: EnemyKind[];
  /** 打倒了尸王 */
  bossKilled: boolean;
  /** 结束时的等级 */
  level: number;
  /** 这一局拿到的铜钱 */
  coins: number;
  /** 结束时手上的法器 */
  weapons: { id: WeaponId; level: number; evolved: boolean }[];
  /** 合成过的 */
  merges: MergeDef['id'][];
  /** 被动和等级 */
  passives: Partial<Record<PassiveId, number>>;
  /** 凑成的套装，比如 剑3、金2 */
  sets: string[];
  /** 挨了几次打 */
  hurts: number;
  /** 结束时的血和血上限 */
  hpLeft: number;
  hpMax: number;
  /** 开了几个宝箱 */
  chests: number;
  /** 铜钱挡下几颗敌方的弹 */
  blocks: number;
}

/** 累计统计。集合用数组存（JSON），计数只增不减 */
export interface Records {
  v: 1;
  runs: number;
  wins: number;
  kills: number;
  seconds: number;
  /** 每个危险档撑到天亮几次 */
  winsByDanger: Partial<Record<DangerKey, number>>;
  winsByMap: Partial<Record<MapId, number>>;
  /** 见过的怪；各怪累计打倒几只 */
  seen: EnemyKind[];
  killed: Partial<Record<EnemyKind, number>>;
  /** 用过 / 满级 / 进化过的法器 */
  weaponsUsed: WeaponId[];
  weaponsMaxed: WeaponId[];
  weaponsEvolved: WeaponId[];
  /** 合成过的 */
  merges: MergeDef['id'][];
  /** 升满过的被动 */
  passivesMaxed: PassiveId[];
  /** 已解锁的成就 id */
  achievements: string[];
}

const DANGER_KEYS: DangerKey[] = ['0', '1', '2', '3', '4', '5'];
const MAPS_: MapId[] = [...MAP_IDS];
const KINDS = ENEMIES.map((e) => e.kind);
const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];
const PASSIVE_IDS = Object.keys(PASSIVES) as PassiveId[];
const MERGE_IDS = MERGES.map((m) => m.id);

export function emptyRecords(): Records {
  return { v: 1, runs: 0, wins: 0, kills: 0, seconds: 0, winsByDanger: {}, winsByMap: {}, seen: [], killed: {}, weaponsUsed: [], weaponsMaxed: [], weaponsEvolved: [], merges: [], passivesMaxed: [], achievements: [] };
}

// ───────────────────────── 从对局里摘要 ─────────────────────────

/**
 * 逐拍数事件：每次 `step` 之后调一次 `tally.feed(w)`（W.ev 每拍开头清零，漏调就漏数）。
 * 快进（warp）时每一拍都要喂。
 */
export class RunTally {
  killsByKind: Partial<Record<EnemyKind, number>> = {};
  private readonly seenSet = new Set<EnemyKind>();
  hurts = 0;
  chests = 0;
  blocks = 0;

  feed(w: World): void {
    const e = w.ev;
    for (let i = 0; i < e.n; i++) {
      const t = e.type[i];
      if (t === Ev.Kill) {
        const kind = ENEMIES[e.a[i]!]?.kind;
        if (kind) {
          this.killsByKind[kind] = (this.killsByKind[kind] ?? 0) + 1;
          this.seenSet.add(kind);
        }
      } else if (t === Ev.Hurt) this.hurts++;
      else if (t === Ev.Chest) this.chests++;
      else if (t === Ev.Block) this.blocks++;
    }
    // 场上出现过就算见过；半秒扫一遍够了（怪最少活好几秒）
    if (w.tick % 15 === 0) {
      for (let i = 0; i < w.eAlive.length; i++) if (w.eAlive[i]) this.seenSet.add(ENEMIES[w.eKind[i]!]!.kind);
    }
  }

  get seen(): EnemyKind[] {
    return [...this.seenSet];
  }
}

/** 一局结束（phase 为 over 或玩家认输）时调：把 World 和 tally 合成摘要 */
export function summarize(w: World, tally: RunTally, quit = false): RunSummary {
  const passives: Partial<Record<PassiveId, number>> = {};
  for (const id of PASSIVE_IDS) if (w.passives[id] !== undefined) passives[id] = w.passives[id];
  return {
    danger: w.setup.danger,
    map: w.setup.map ?? 'snow',
    won: w.won,
    quit,
    seconds: Math.floor(w.tick / TICKS_PER_SECOND),
    kills: w.kills,
    killsByKind: { ...tally.killsByKind },
    seen: tally.seen,
    bossKilled: w.bossKilled,
    level: w.level,
    coins: Math.floor(w.coins),
    weapons: w.weapons.map((o) => ({ id: o.id, level: o.level, evolved: o.evolved })),
    merges: [...w.merges],
    passives,
    sets: [...w.sets],
    hurts: tally.hurts,
    hpLeft: w.hp,
    hpMax: w.stats.hpMax,
    chests: tally.chests,
    blocks: tally.blocks,
  };
}

// ───────────────────────── 累计与成就 ─────────────────────────

const addAll = <T>(list: T[], more: readonly T[]): T[] => [...new Set([...list, ...more])];

/** 把一局并进累计统计，返回新的统计和这一局新解锁的成就 id。纯函数；同一局再并一次不会重复解锁 */
export function applyRun(records: Records, run: RunSummary): { records: Records; unlocked: string[] } {
  const r: Records = {
    ...records,
    winsByDanger: { ...records.winsByDanger },
    winsByMap: { ...records.winsByMap },
    killed: { ...records.killed },
  };
  r.runs += 1;
  r.kills += run.kills;
  r.seconds += run.seconds;
  if (run.won) {
    r.wins += 1;
    const dk = String(run.danger) as DangerKey;
    r.winsByDanger[dk] = (r.winsByDanger[dk] ?? 0) + 1;
    r.winsByMap[run.map] = (r.winsByMap[run.map] ?? 0) + 1;
  }
  for (const k of KINDS) {
    const n = run.killsByKind[k] ?? 0;
    if (n > 0) r.killed[k] = (r.killed[k] ?? 0) + n;
  }
  r.seen = addAll(r.seen, [...run.seen, ...KINDS.filter((k) => (run.killsByKind[k] ?? 0) > 0)]);
  r.weaponsUsed = addAll(r.weaponsUsed, run.weapons.map((o) => o.id));
  r.weaponsMaxed = addAll(r.weaponsMaxed, run.weapons.filter((o) => o.level >= MAX_WEAPON_LEVEL || o.evolved).map((o) => o.id));
  r.weaponsEvolved = addAll(r.weaponsEvolved, run.weapons.filter((o) => o.evolved).map((o) => o.id));
  r.merges = addAll(r.merges, run.merges);
  r.passivesMaxed = addAll(r.passivesMaxed, PASSIVE_IDS.filter((id) => (run.passives[id] ?? 0) >= PASSIVES[id].max));
  const have = new Set(r.achievements);
  const unlocked: string[] = [];
  for (const a of ACHIEVEMENTS) {
    if (!have.has(a.id) && a.test(run, r)) unlocked.push(a.id);
  }
  r.achievements = [...r.achievements, ...unlocked];
  return { records: r, unlocked };
}

/** 总收集度：怪见过 1 + 打倒过 1；法器用过、满级、进化各 1；合成 1；成就 1。返回已得 / 总数 / 百分比（整数） */
export function collection(r: Records): { done: number; total: number; percent: number } {
  const total = KINDS.length * 2 + WEAPON_IDS.length * 3 + MERGE_IDS.length + ACHIEVEMENTS.length;
  const done =
    KINDS.filter((k) => r.seen.includes(k)).length +
    KINDS.filter((k) => (r.killed[k] ?? 0) > 0).length +
    WEAPON_IDS.filter((k) => r.weaponsUsed.includes(k)).length +
    WEAPON_IDS.filter((k) => r.weaponsMaxed.includes(k)).length +
    WEAPON_IDS.filter((k) => r.weaponsEvolved.includes(k)).length +
    MERGE_IDS.filter((k) => r.merges.includes(k)).length +
    ACHIEVEMENTS.filter((a) => r.achievements.includes(a.id)).length;
  return { done, total, percent: Math.floor((100 * done) / total) };
}

// ───────────────────────── 本机存储 ─────────────────────────

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
const pick = <T extends string>(v: unknown, allowed: readonly T[]): T[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is T => allowed.includes(x as T)))] : []);
function counts<T extends string>(v: unknown, keys: readonly T[]): Partial<Record<T, number>> {
  const out: Partial<Record<T, number>> = {};
  if (v && typeof v === 'object') for (const k of keys) if (num((v as Record<string, unknown>)[k]) > 0) out[k] = num((v as Record<string, unknown>)[k]);
  return out;
}

/** 把读出来的任何东西洗成合法的 Records：认不得的字段丢掉，坏数据整体退回空 */
export function sanitize(raw: unknown): Records {
  if (!raw || typeof raw !== 'object') return emptyRecords();
  const o = raw as Record<string, unknown>;
  return {
    v: 1,
    runs: num(o.runs),
    wins: num(o.wins),
    kills: num(o.kills),
    seconds: num(o.seconds),
    winsByDanger: counts(o.winsByDanger, DANGER_KEYS),
    winsByMap: counts(o.winsByMap, MAPS_),
    seen: pick(o.seen, KINDS),
    killed: counts(o.killed, KINDS),
    weaponsUsed: pick(o.weaponsUsed, WEAPON_IDS),
    weaponsMaxed: pick(o.weaponsMaxed, WEAPON_IDS),
    weaponsEvolved: pick(o.weaponsEvolved, WEAPON_IDS),
    merges: pick(o.merges, MERGE_IDS),
    passivesMaxed: pick(o.passivesMaxed, PASSIVE_IDS),
    achievements: pick(
      o.achievements,
      ACHIEVEMENTS.map((a) => a.id),
    ),
  };
}

export function loadRecords(): Records {
  try {
    const raw = localStorage.getItem(RECORDS_KEY);
    return raw ? sanitize(JSON.parse(raw)) : emptyRecords();
  } catch {
    return emptyRecords();
  }
}

export function saveRecords(r: Records): void {
  try {
    localStorage.setItem(RECORDS_KEY, JSON.stringify(r));
  } catch {
    // 存储不可用（隐私模式、满了）照常能玩，只是不记得
  }
}
