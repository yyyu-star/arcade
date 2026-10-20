import { describe, expect, it } from 'vitest';
import { makeCard } from '../src/core/cards.ts';
import { type DdzPlay, type DdzType, beatsDdz, chooseDdz, ddzPatterns, enumerateDdz, interpretDdz, playsBeatingDdz } from '../src/variants/doudizhu/core/index.ts';

/** 按点数造牌（2..14，16 小王，17 大王），同点数的牌用不同花色 */
function cs(...ranks: number[]): number[] {
  const seen = new Map<number, number>();
  return ranks.map((r) => {
    const k = seen.get(r) ?? 0;
    seen.set(r, k + 1);
    return makeCard(r, k);
  });
}
const types = (...ranks: number[]): DdzType[] => interpretDdz(cs(...ranks)).map((p) => p.type);
const one = (...ranks: number[]): DdzPlay => {
  const p = interpretDdz(cs(...ranks))[0];
  if (!p) throw new Error(`不成牌型：${ranks.join(',')}`);
  return p;
};
const J = 11, Q = 12, K = 13, A = 14, SJ = 16, BJ = 17;

describe('牌型识别：基本牌型', () => {
  it('单张、对子、三张、炸弹', () => {
    expect(types(5)).toEqual(['single']);
    expect(types(5, 5)).toEqual(['pair']);
    expect(types(5, 5, 5)).toEqual(['triple']);
    expect(types(5, 5, 5, 5)).toEqual(['bomb']);
    expect(types(2)).toEqual(['single']);
    expect(types(SJ)).toEqual(['single']);
  });
  it('不成牌型', () => {
    expect(types()).toEqual([]);
    expect(types(3, 4)).toEqual([]);
    expect(types(5, 5, 5, 5, 5)).toEqual([]);
    expect(types(3, 3, 4, 4)).toEqual([]); // 只有两对，不到 3 对
    expect(types(3, 3, 3, 4, 4, 5)).toEqual([]);
  });
  it('同一张牌重复不算', () => {
    const c = makeCard(5, 0);
    expect(interpretDdz([c, c])).toEqual([]);
  });
  it('三带一、三带一对：带的牌点数不同', () => {
    expect(types(7, 7, 7, 3)).toEqual(['triple1']);
    expect(types(7, 7, 7, 3, 3)).toEqual(['triple2']);
    expect(types(7, 7, 7, 7)).toEqual(['bomb']); // 带同点数就是炸弹，不是三带一
    expect(types(7, 7, 7, 3, 4)).toEqual([]);
    expect(types(7, 7, 7, SJ)).toEqual(['triple1']);
  });
});

describe('顺子', () => {
  it('5 张起，3 到 A', () => {
    expect(types(3, 4, 5, 6, 7)).toEqual(['straight']);
    expect(types(3, 4, 5, 6)).toEqual([]); // 4 张不成
    expect(types(10, J, Q, K, A)).toEqual(['straight']);
    expect(types(3, 4, 5, 6, 7, 8, 9, 10, J, Q, K, A)).toEqual(['straight']); // 12 张
  });
  it('2 和王不进顺子，A 封顶', () => {
    expect(types(J, Q, K, A, 2)).toEqual([]);
    expect(types(2, 3, 4, 5, 6)).toEqual([]);
    expect(types(A, 2, 3, 4, 5)).toEqual([]);
    expect(types(K, A, SJ, BJ, Q)).toEqual([]);
  });
  it('有断档或重复不成', () => {
    expect(types(3, 4, 5, 6, 8)).toEqual([]);
    expect(types(3, 4, 5, 6, 6)).toEqual([]);
  });
  it('主体点数取最小、长度记在 len', () => {
    const p = one(7, 8, 9, 10, J, Q);
    expect(p.v).toBe(7);
    expect(p.len).toBe(6);
  });
});

describe('连对', () => {
  it('至少 3 对，3 到 A', () => {
    expect(types(3, 3, 4, 4, 5, 5)).toEqual(['pairs']);
    expect(types(Q, Q, K, K, A, A)).toEqual(['pairs']);
    expect(types(3, 3, 4, 4)).toEqual([]);
    expect(types(K, K, A, A, 2, 2)).toEqual([]); // 2 不进连对
    expect(types(3, 3, 4, 4, 6, 6)).toEqual([]); // 断档
    expect(one(3, 3, 4, 4, 5, 5, 6, 6).len).toBe(4);
  });
});

describe('飞机', () => {
  it('不带 / 带单 / 带对', () => {
    expect(types(3, 3, 3, 4, 4, 4)).toEqual(['plane']);
    expect(types(3, 3, 3, 4, 4, 4, 5, 6)).toEqual(['plane1']);
    expect(types(3, 3, 3, 4, 4, 4, 5, 5, 6, 6)).toEqual(['plane2']);
    expect(types(3, 3, 3, 4, 4, 4, 5, 5, 7, 7)).toEqual(['plane2']);
    expect(types(3, 3, 3, 4, 4, 4, 5, 5, 5)).toEqual(['plane']); // 三个三张连起来
    expect(one(3, 3, 3, 4, 4, 4, 5, 5, 5).len).toBe(3);
  });
  it('机身断档、含 2 不成', () => {
    expect(types(3, 3, 3, 5, 5, 5)).toEqual([]);
    expect(types(A, A, A, 2, 2, 2)).toEqual([]);
  });
  it('翅膀不能和机身同点数', () => {
    expect(types(3, 3, 3, 4, 4, 4, 3, 5)).toEqual([]); // 4 个 3 当机身又当翅膀
    expect(types(3, 3, 3, 4, 4, 4, 4, 5)).toEqual([]);
    expect(types(3, 3, 3, 4, 4, 4, 3, 3, 5, 5)).toEqual([]);
  });
  it('两张王不能一起当翅膀，一张可以', () => {
    expect(types(3, 3, 3, 4, 4, 4, SJ, BJ)).toEqual([]);
    expect(types(3, 3, 3, 4, 4, 4, SJ, 5)).toEqual(['plane1']);
    expect(types(3, 3, 3, 4, 4, 4, BJ, 5)).toEqual(['plane1']);
  });
  it('翅膀张数不对不成', () => {
    expect(types(3, 3, 3, 4, 4, 4, 5)).toEqual([]);
    expect(types(3, 3, 3, 4, 4, 4, 5, 5, 6)).toEqual([]);
    expect(types(3, 3, 3, 4, 4, 4, 5, 6, 7, 8, 9)).toEqual([]);
  });
  it('翅膀自己是对子时可读成两张单', () => {
    expect(types(3, 3, 3, 4, 4, 4, 5, 5)).toEqual(['plane1']);
  });
});

describe('四带二与炸弹', () => {
  it('四带二不是炸弹，带两张单（可以同点数）或两对', () => {
    expect(types(5, 5, 5, 5, 3, 4)).toEqual(['four2']);
    expect(types(5, 5, 5, 5, 3, 3)).toEqual(['four2']);
    expect(types(5, 5, 5, 5, 3, 3, 4, 4)).toEqual(['four22']);
    expect(types(5, 5, 5, 5, 3, 3, 3, 3)).toEqual([]); // 两对必须点数不同
    expect(types(5, 5, 5, 5, SJ, BJ)).toEqual([]);
    expect(types(5, 5, 5, 5, SJ, 3)).toEqual(['four2']);
    expect(types(5, 5, 5, 5, 3)).toEqual([]);
    const p = one(5, 5, 5, 5, 3, 4);
    expect(ddzPatterns.isBomb(p)).toBe(false);
  });
  it('王炸', () => {
    expect(types(SJ, BJ)).toEqual(['rocket']);
    expect(ddzPatterns.isBomb(one(SJ, BJ))).toBe(true);
    expect(ddzPatterns.isBomb(one(5, 5, 5, 5))).toBe(true);
  });
});

describe('比大小', () => {
  const beats = (a: number[], b: number[]) => beatsDdz(one(...a), one(...b));
  it('同牌型同张数，主体更大才压得住', () => {
    expect(beats([5], [4])).toBe(true);
    expect(beats([4], [5])).toBe(false);
    expect(beats([5], [5])).toBe(false);
    expect(beats([2], [A])).toBe(true);
    expect(beats([SJ], [2])).toBe(true);
    expect(beats([BJ], [SJ])).toBe(true);
    expect(beats([6, 6], [5, 5])).toBe(true);
    expect(beats([6, 6], [5])).toBe(false);
    expect(beats([4, 4, 4, 9], [3, 3, 3, 5])).toBe(true);
    expect(beats([4, 5, 6, 7, 8], [3, 4, 5, 6, 7])).toBe(true);
    expect(beats([4, 5, 6, 7, 8, 9], [3, 4, 5, 6, 7])).toBe(false); // 张数不同
    expect(beats([3, 3, 3, 4, 4, 4, 5, 6], [3, 3, 3, 4, 4, 4])).toBe(false); // 带不带翅膀不同型
    expect(beats([4, 4, 4, 5, 5, 5, 3, 7], [3, 3, 3, 4, 4, 4, 8, 9])).toBe(true);
  });
  it('四带二按四张的点数比，不是炸弹', () => {
    expect(beats([6, 6, 6, 6, 3, 4], [5, 5, 5, 5, 9, 10])).toBe(true);
    expect(beats([5, 5, 5, 5, 3, 4], [6, 6, 6, 6, 9, 10])).toBe(false);
    expect(beats([6, 6, 6, 6, 3, 4], [5, 5, 5, 5])).toBe(false); // 四带二压不住炸弹
    expect(beats([5, 5, 5, 5], [6, 6, 6, 6, 3, 4])).toBe(true); // 炸弹压四带二
  });
  it('炸弹压一切非炸弹，大炸弹压小炸弹，王炸最大', () => {
    expect(beats([3, 3, 3, 3], [2])).toBe(true);
    expect(beats([3, 3, 3, 3], [4, 5, 6, 7, 8])).toBe(true);
    expect(beats([3, 3, 3, 3], [A, A, A, K, K, K, 5, 6])).toBe(true);
    expect(beats([4, 4, 4, 4], [3, 3, 3, 3])).toBe(true);
    expect(beats([3, 3, 3, 3], [4, 4, 4, 4])).toBe(false);
    expect(beats([3, 3, 3, 3], [3, 3, 3, 3])).toBe(false);
    expect(beats([2], [3, 3, 3, 3])).toBe(false);
    expect(beats([SJ, BJ], [2, 2, 2, 2])).toBe(true);
    expect(beats([2, 2, 2, 2], [SJ, BJ])).toBe(false);
    expect(beats([SJ, BJ], [SJ, BJ])).toBe(false);
    expect(beats([SJ, BJ], [3])).toBe(true);
  });
});

describe('PatternSet：choose 和 enumerate', () => {
  it('首出取第一种读法、跟牌取第一个压得上的', () => {
    const opts = interpretDdz(cs(3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6));
    expect(opts.length).toBeGreaterThan(1); // 飞机 4 个，或 3 个带一排三张当翅膀
    expect(ddzPatterns.choose(opts, null)).toBe(opts[0]);
    expect(ddzPatterns.choose([], null)).toBeNull();
    const t3 = one(3, 3, 3, 4, 4, 4, 5, 6);
    const small = interpretDdz(cs(5, 5, 5, 6, 6, 6, 3, 4));
    expect(chooseDdz(small, t3)?.type).toBe('plane1');
    expect(chooseDdz(interpretDdz(cs(3, 3, 3, 4, 4, 4, 7, 8)), one(5, 5, 5, 6, 6, 6, 7, 8))).toBeNull();
  });
  it('枚举的牌型都是合规的，且手里的炸弹、王炸、顺子、连对、飞机都在', () => {
    const hand = cs(3, 3, 3, 4, 4, 4, 5, 6, 7, 8, 9, 9, 9, 9, 10, 10, 10, SJ, BJ);
    const plays = enumerateDdz(hand);
    for (const p of plays) {
      expect(interpretDdz(p.cards)[0]?.type).toBe(p.type);
      expect(p.cards.every((c) => hand.includes(c))).toBe(true);
    }
    const ts = new Set(plays.map((p) => p.type));
    for (const t of ['single', 'pair', 'triple', 'triple1', 'triple2', 'straight', 'plane', 'plane1', 'plane2', 'bomb', 'rocket', 'four2'] as const) expect(ts.has(t), t).toBe(true);
  });
  it('playsBeating：只列压得上的', () => {
    const hand = cs(3, 5, 5, 9, 9, 9, 2);
    const target = one(8);
    const ps = playsBeatingDdz(hand, target);
    expect(ps.length).toBeGreaterThan(0);
    expect(ps.every((p) => beatsDdz(p, target))).toBe(true);
    expect(ps.some((p) => p.type === 'single' && p.v === 15)).toBe(true);
    expect(playsBeatingDdz(cs(3, 4), one(5, 5))).toEqual([]);
  });
});
