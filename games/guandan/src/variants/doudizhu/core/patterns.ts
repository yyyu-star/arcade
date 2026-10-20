/**
 * 斗地主的牌型（牌馆 PR ②，设计 docs/doudizhu.md 2.2，规则细节 docs/rules.md「斗地主」一节）。
 * 实现牌馆通用层的 PatternSet（ctx 不需要，传 undefined）。牌的编码沿用 core/cards.ts，只用第一副 0..53。
 */
import { BIG_JOKER, type Card, SMALL_JOKER, rankOf, suitOf } from '../../../core/cards.ts';
import type { PatternSet, PlayBase } from '../../../core/play.ts';

/** 比大小用的点数：3..13，A 14，2 记 15，小王 16，大王 17 */
export function ddzValue(c: Card): number {
  const r = rankOf(c);
  return r === 2 ? 15 : r;
}

export function sortDdz(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => ddzValue(a) - ddzValue(b) || suitOf(a) - suitOf(b));
}

export type DdzType =
  | 'single' | 'pair' | 'triple' | 'triple1' | 'triple2' | 'straight' | 'pairs'
  | 'plane' | 'plane1' | 'plane2' | 'four2' | 'four22' | 'bomb' | 'rocket';

export const DDZ_TYPE_NAMES: Record<DdzType, string> = {
  single: '单张', pair: '对子', triple: '三张', triple1: '三带一', triple2: '三带一对', straight: '顺子', pairs: '连对',
  plane: '飞机', plane1: '飞机带单', plane2: '飞机带对', four2: '四带二', four22: '四带两对', bomb: '炸弹', rocket: '王炸',
};

/** 一手牌：主体点数 v（顺子、连对、飞机取最小的那个），len 是主体的长度（顺子几张、连对几对、飞机几个三张，其余为 1） */
export interface DdzPlay extends PlayBase {
  type: DdzType;
  v: number;
  len: number;
  cards: Card[];
}

function counts(cards: readonly Card[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const c of cards) m.set(ddzValue(c), (m.get(ddzValue(c)) ?? 0) + 1);
  return m;
}

/** 点数从小到大排好、连续、最大不超过 A（2 和王不进顺子类） */
function consecutive(vs: readonly number[]): boolean {
  if (vs.length === 0 || vs[vs.length - 1]! > 14) return false;
  for (let i = 1; i < vs.length; i++) if (vs[i] !== vs[i - 1]! + 1) return false;
  return true;
}

/** 这几张牌能当哪些牌型（多数只有一种；飞机带翅膀可能有几种读法）。不成牌型回空数组，优先的放前面 */
export function interpretDdz(cards: readonly Card[]): DdzPlay[] {
  const n = cards.length;
  if (n === 0 || new Set(cards).size !== n) return [];
  const cs = sortDdz(cards);
  const m = counts(cs);
  const vs = [...m.keys()].sort((a, b) => a - b);
  const mk = (type: DdzType, v: number, len = 1): DdzPlay => ({ type, v, len, cards: cs });
  const out: DdzPlay[] = [];
  if (n === 2 && m.has(SMALL_JOKER) && m.has(BIG_JOKER)) return [mk('rocket', BIG_JOKER)];
  if (vs.length === 1) {
    const v = vs[0]!;
    if (n === 1) return [mk('single', v)];
    if (n === 2) return [mk('pair', v)];
    if (n === 3) return [mk('triple', v)];
    if (n === 4) return [mk('bomb', v)];
    return [];
  }
  const of = (k: number) => vs.filter((v) => m.get(v) === k);
  if (n === 4 && of(3).length === 1) out.push(mk('triple1', of(3)[0]!));
  if (n === 5 && of(3).length === 1 && of(2).length === 1) out.push(mk('triple2', of(3)[0]!));
  if (n >= 5 && vs.length === n && consecutive(vs)) out.push(mk('straight', vs[0]!, n));
  if (n >= 6 && n % 2 === 0 && vs.length === n / 2 && of(2).length === vs.length && consecutive(vs)) out.push(mk('pairs', vs[0]!, n / 2));
  // 四带二：四张 + 两张单（可以是同点数的两张，但不能是大小王）；四带两对：四张 + 两个不同点数的对子。都不算炸弹
  for (const q of of(4)) {
    const rest = cs.filter((c) => ddzValue(c) !== q);
    if (n === 6 && !(rest.length === 2 && ddzValue(rest[0]!) === SMALL_JOKER && ddzValue(rest[1]!) === BIG_JOKER)) out.push(mk('four2', q));
    if (n === 8) {
      const rm = counts(rest);
      if (rm.size === 2 && [...rm.values()].every((k) => k === 2)) out.push(mk('four22', q));
    }
  }
  // 飞机：k ≥ 2 个连续三张（机身每个点数正好 3 张，3 到 A），不带 / 带 k 张单 / 带 k 个对子；翅膀不能和机身同点数，两张王不能一起当翅膀
  for (let k = Math.floor(n / 3); k >= 2; k--) {
    if (n !== 3 * k && n !== 4 * k && n !== 5 * k) continue;
    const cand = vs.filter((v) => (m.get(v) ?? 0) >= 3 && v <= 14);
    for (let i = 0; i + k <= cand.length; i++) {
      const body = cand.slice(i, i + k);
      if (!consecutive(body)) continue;
      const wings = new Map(m);
      let ok = true;
      for (const v of body) {
        if (wings.get(v) !== 3) ok = false;
        wings.delete(v);
      }
      if (!ok) continue;
      const wn = [...wings.values()].reduce((a, b) => a + b, 0);
      if (n === 3 * k && wn === 0) out.push(mk('plane', body[0]!, k));
      else if (n === 4 * k && wn === k && !(wings.has(SMALL_JOKER) && wings.has(BIG_JOKER))) out.push(mk('plane1', body[0]!, k));
      else if (n === 5 * k && wings.size === k && [...wings.values()].every((x) => x === 2)) out.push(mk('plane2', body[0]!, k));
    }
  }
  return out;
}

export const isBombish = (p: Pick<DdzPlay, 'type'>): boolean => p.type === 'bomb' || p.type === 'rocket';

/** a 能不能压 b：同牌型、同张数、主体更大；炸弹压一切非炸弹，大炸弹压小炸弹；王炸最大 */
export function beatsDdz(a: DdzPlay, b: DdzPlay): boolean {
  if (b.type === 'rocket') return false;
  if (a.type === 'rocket') return true;
  if (a.type === 'bomb') return b.type !== 'bomb' || a.v > b.v;
  if (b.type === 'bomb') return false;
  return a.type === b.type && a.len === b.len && a.cards.length === b.cards.length && a.v > b.v;
}

/** 选中的牌按上一手解读：首出取第一种读法，跟牌取第一个压得上的；不合规回 null */
export function chooseDdz(options: readonly DdzPlay[], target: DdzPlay | null): DdzPlay | null {
  if (!target) return options[0] ?? null;
  return options.find((p) => beatsDdz(p, target)) ?? null;
}

// ---------- 枚举（电脑和"提示"用：带牌只带最小的，不求全） ----------

function byValue(hand: readonly Card[]): Map<number, Card[]> {
  const m = new Map<number, Card[]>();
  for (const c of sortDdz(hand)) {
    const v = ddzValue(c);
    if (!m.has(v)) m.set(v, []);
    m.get(v)!.push(c);
  }
  return m;
}

/**
 * 手里能出的主要牌型：单张、对子、三张（含四张里取的）、炸弹、王炸、各种长度的顺子 / 连对 / 飞机；
 * 带牌（三带、飞机翅膀、四带二）只列最小的一种带法（先用点数只有一两张的，不拆炸弹）。能压上的牌型都至少有一个代表。
 */
export function enumerateDdz(hand: readonly Card[]): DdzPlay[] {
  const g = byValue(hand);
  const vs = [...g.keys()].sort((a, b) => a - b);
  const out: DdzPlay[] = [];
  const push = (cards: Card[]) => {
    const p = interpretDdz(cards)[0];
    if (p) out.push(p);
  };
  const wingsOf = (exclude: ReadonlySet<number>, k: number, pairs: boolean): Card[] | null => {
    const pool = vs.filter((v) => !exclude.has(v) && (pairs ? g.get(v)!.length >= 2 : true) && g.get(v)!.length < 4);
    pool.sort((a, b) => g.get(a)!.length - g.get(b)!.length || a - b);
    const picked: Card[] = [];
    for (const v of pool) {
      if (picked.length === k * (pairs ? 2 : 1)) break;
      if (!pairs && v >= SMALL_JOKER && picked.some((c) => ddzValue(c) >= SMALL_JOKER)) continue;
      picked.push(...g.get(v)!.slice(0, pairs ? 2 : 1));
    }
    return picked.length === k * (pairs ? 2 : 1) ? picked : null;
  };
  for (const v of vs) {
    const cs = g.get(v)!;
    push(cs.slice(0, 1));
    if (cs.length >= 2) push(cs.slice(0, 2));
    if (cs.length >= 3) {
      push(cs.slice(0, 3));
      const w1 = wingsOf(new Set([v]), 1, false);
      if (w1) push([...cs.slice(0, 3), ...w1]);
      const w2 = wingsOf(new Set([v]), 1, true);
      if (w2) push([...cs.slice(0, 3), ...w2]);
    }
    if (cs.length === 4) {
      push(cs);
      const w = wingsOf(new Set([v]), 2, false);
      if (w) push([...cs, ...w]);
      const w22 = wingsOf(new Set([v]), 2, true);
      if (w22) push([...cs, ...w22]);
    }
  }
  if (g.has(SMALL_JOKER) && g.has(BIG_JOKER)) push([g.get(SMALL_JOKER)![0]!, g.get(BIG_JOKER)![0]!]);
  const seq = (need: number, min: number) => {
    for (const start of vs) {
      const run: number[] = [];
      for (let v = start; v <= 14 && (g.get(v)?.length ?? 0) >= need; v++) {
        run.push(v);
        if (run.length < min) continue;
        const body = run.flatMap((x) => g.get(x)!.slice(0, need));
        push(body);
        if (need === 3) {
          const ex = new Set(run);
          const w1 = wingsOf(ex, run.length, false);
          if (w1) push([...body, ...w1]);
          const w2 = wingsOf(ex, run.length, true);
          if (w2) push([...body, ...w2]);
        }
      }
    }
  };
  seq(1, 5);
  seq(2, 3);
  seq(3, 2);
  return out;
}

export const ddzPatterns: PatternSet<DdzPlay, undefined> = {
  interpret: (cards) => interpretDdz(cards),
  beats: beatsDdz,
  isBomb: isBombish,
  choose: chooseDdz,
  enumerate: (hand) => enumerateDdz(hand),
};

/** 手里能压住 target 的（首出时 target 为 null，就是全部） */
export function playsBeatingDdz(hand: readonly Card[], target: DdzPlay | null): DdzPlay[] {
  const all = enumerateDdz(hand);
  return target ? all.filter((p) => beatsDdz(p, target)) : all;
}
