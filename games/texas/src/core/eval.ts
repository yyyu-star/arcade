/**
 * 牌力评估（DESIGN.md 第 3 节）：每门花色一个 13 位掩码，靠位运算判牌型，只用几张 8192 项的小表。
 * 结果是一个整数：牌型 << 20 | 最多 5 个点数各 4 位。数字大的牌大，比牌就是比整数。
 *
 * 不用几十 MB 的七张大表（浏览器下不了、DO 内存放不下），也不用 21 个五张组合逐个比（慢百倍）。
 * 本地实测全量 1.34 亿手约 2.1 秒；牌型计数和 4,824 个等价类有测试锁住（test/eval.test.ts）。
 */
import type { Card } from './cards.ts';

export const HIGH_CARD = 0;
export const PAIR = 1;
export const TWO_PAIR = 2;
export const TRIPS = 3;
export const STRAIGHT = 4;
export const FLUSH = 5;
export const FULL_HOUSE = 6;
export const QUADS = 7;
export const STRAIGHT_FLUSH = 8;

export const CATEGORY_NAMES = ['高牌', '一对', '两对', '三条', '顺子', '同花', '葫芦', '四条', '同花顺'] as const;

export const categoryOf = (value: number): number => value >> 20;

const TOP = new Uint8Array(8192); // 最高的那一位是第几位
const POP = new Uint8Array(8192); // 有几位
const STRAIGHT_HI = new Uint8Array(8192); // 最大的顺子的最高张 + 1，0 表示没有顺子；A-2-3-4-5 记为 4（最高张是 5）
const TOP5 = new Uint32Array(8192); // 最大的 5 个点数，每个 4 位打包好

for (let m = 1; m < 8192; m++) {
  TOP[m] = 31 - Math.clz32(m);
  POP[m] = POP[m >> 1]! + (m & 1);
  let hi = 0;
  for (let h = 12; h >= 4 && !hi; h--) {
    const w = 0x1f << (h - 4);
    if ((m & w) === w) hi = h + 1;
  }
  if (!hi && (m & 0x100f) === 0x100f) hi = 4;
  STRAIGHT_HI[m] = hi;
  let v = 0;
  for (let x = m, k = 0; k < 5 && x; k++) {
    const b = TOP[x]!;
    v = (v << 4) | b;
    x &= ~(1 << b);
  }
  TOP5[m] = v;
}

/** 掩码里最高的那一位是第几点（0 是 2，12 是 A）。要第二高的，调用方先把这一位清掉再取 */
const top = (m: number): number => TOP[m]!;

/**
 * 评估 5–7 张牌（四门花色的掩码）。调用方保证没有重复的牌。
 * 7 张里有同花时不可能同时有四条或葫芦（同花占 5 张，剩 2 张凑不出来），所以先判同花。
 */
export function evalMasks(c: number, d: number, h: number, s: number): number {
  const f = POP[c]! >= 5 ? c : POP[d]! >= 5 ? d : POP[h]! >= 5 ? h : POP[s]! >= 5 ? s : 0;
  if (f) {
    const sf = STRAIGHT_HI[f]!;
    return sf ? (STRAIGHT_FLUSH << 20) | sf : (FLUSH << 20) | TOP5[f]!;
  }
  const all = c | d | h | s;
  const quads = c & d & h & s;
  if (quads) {
    const q = top(quads);
    return (QUADS << 20) | (q << 4) | top(all & ~(1 << q));
  }
  const two = (c & d) | (c & h) | (c & s) | (d & h) | (d & s) | (h & s);
  const three = (c & d & h) | (c & d & s) | (c & h & s) | (d & h & s);
  if (three) {
    const t = top(three);
    const rest = two & ~(1 << t);
    if (rest) return (FULL_HOUSE << 20) | (t << 4) | top(rest);
  }
  const st = STRAIGHT_HI[all]!;
  if (st) return (STRAIGHT << 20) | st;
  if (three) {
    const t = top(three);
    let k = all & ~(1 << t);
    const k1 = top(k);
    k &= ~(1 << k1);
    return (TRIPS << 20) | (t << 8) | (k1 << 4) | top(k);
  }
  if (two) {
    const p1 = top(two);
    const rest = two & ~(1 << p1);
    if (rest) {
      const p2 = top(rest);
      return (TWO_PAIR << 20) | (p1 << 8) | (p2 << 4) | top(all & ~(1 << p1) & ~(1 << p2));
    }
    let k = all & ~(1 << p1);
    const a = top(k);
    k &= ~(1 << a);
    const b = top(k);
    k &= ~(1 << b);
    return (PAIR << 20) | (p1 << 12) | (a << 8) | (b << 4) | top(k);
  }
  return TOP5[all]!;
}

/** 把牌加进四门花色的掩码（就地改 m）。蒙特卡洛里公共牌只加一次，每个对手只再加两张 */
export function addCard(m: Int32Array | number[], c: Card): void {
  m[c & 3]! |= 1 << (c >> 2);
}

/** 评估一组牌（5–7 张），给规则和测试用；热点路径直接用 evalMasks */
export function evalCards(cards: readonly Card[]): number {
  const m = [0, 0, 0, 0];
  for (const c of cards) addCard(m, c);
  return evalMasks(m[0]!, m[1]!, m[2]!, m[3]!);
}
