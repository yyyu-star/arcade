import { describe, expect, it } from 'vitest';
import { makeCard } from '../src/core/cards.ts';
import {
  type DdzLevel, type DdzView, bidStrength, createDdz, decideDdz, dispatchDdz, handCount, hintDdz, interpretDdz, leadPlays, planHand, viewDdz,
} from '../src/variants/doudizhu/index.ts';
import { rngFor } from '../src/core/rng.ts';
import { beatsDdz } from '../src/variants/doudizhu/core/index.ts';

const J = 11, Q = 12, K = 13, A = 14, SJ = 16, BJ = 17;
function cs(...ranks: number[]): number[] {
  const seen = new Map<number, number>();
  return ranks.map((r) => {
    const k = seen.get(r) ?? 0;
    seen.set(r, k + 1);
    return makeCard(r, k);
  });
}
const hc = (...ranks: number[]): number => handCount(cs(...ranks));
const LEVELS: DdzLevel[] = ['novice', 'normal', 'pro'];

function mkView(p: Partial<DdzView> & { hand: number[] }): DdzView {
  return {
    seat: 0, phase: 'play', counts: [p.hand.length, 10, 10], bottom: [], landlord: 1, firstBidder: 0, redeal: 0, bids: [null, null, null], bid: 0,
    turn: 0, step: 5, trick: [], target: null, played: [], bombs: 0, scores: [0, 0, 0], dealNo: 1, deals: 6, cap: 0, dealCap: 0, results: [], ...p,
  };
}
const playOf = (...ranks: number[]) => interpretDdz(cs(...ranks))[0]!;

describe('拆牌：手数', () => {
  it('三张带走一个单张或对子，不重复计', () => {
    expect(hc(3, 3, 3, 4)).toBe(1);
    expect(hc(3, 3, 3, 4, 4)).toBe(1);
    expect(hc(3, 3, 3, 5)).toBe(1);
    expect(hc(3, 3, 3, 5, 7, 9)).toBe(3); // 333+5、7、9
    expect(hc(3, 3, 3, 5, 5, 9)).toBe(2); // 333+55、9（草稿的毛病：三张既拆出来又当三带算，会少算）
    expect(hc(3, 3, 3)).toBe(1);
    expect(hc(3, 3, 3, 4, 4, 4, 5, 6)).toBe(1);
  });
  it('顺子、连对、炸弹、王炸', () => {
    expect(hc(3, 4, 5, 6, 7, 8, 9)).toBe(1);
    expect(hc(3, 3, 4, 4, 5, 5)).toBe(1);
    expect(hc(3, 4, 5, 6, 7, 8, 8)).toBe(2);
    expect(hc(5, 5, 5, 5, 9)).toBe(2);
    expect(hc(SJ, BJ)).toBe(1);
    expect(hc(SJ, BJ, 3)).toBe(2);
    expect(hc(3, 5, 7, 9, J)).toBe(5);
    expect(handCount([])).toBe(0);
  });
  it('拆出来的各组正好是整手牌，一张不多一张不少（随机手牌）', () => {
    const rng = rngFor('ddz-ai-test', 'partition');
    for (let i = 0; i < 300; i++) {
      const hand = rng.shuffle(Array.from({ length: 54 }, (_, k) => k)).slice(0, 5 + rng.int(16));
      for (const cap of [1, 250, 2500]) {
        const plan = planHand(hand, cap);
        expect(plan.groups.flatMap((g) => g.cards).sort((a, b) => a - b), `cap ${cap}`).toEqual([...hand].sort((a, b) => a - b));
        for (const g of plan.groups) expect(interpretDdz(g.cards)[0]?.type, g.type).toBe(g.type);
        expect(plan.hands).toBeGreaterThanOrEqual(1);
        expect(plan.hands).toBeLessThanOrEqual(plan.groups.length);
      }
      // 搜得更细不会更差
      expect(planHand(hand, 2500).score).toBeLessThanOrEqual(planHand(hand, 1).score);
    }
  });
  it('领出的候选：三张带最小的单张，都是合规牌型', () => {
    const hand = cs(3, 3, 3, 5, 9, 9, K);
    const plays = leadPlays(planHand(hand, 250));
    const t = plays.find((p) => p.type === 'triple1');
    expect(t).toBeTruthy();
    expect(t!.cards).toContain(hand[3]); // 带的是 5，不是 K
    for (const p of plays) expect(p.cards.every((c) => hand.includes(c))).toBe(true);
  });
});

describe('叫分', () => {
  const strong = cs(BJ, SJ, 2, 2, A, A, K, K, K, Q, Q, J, 10, 9, 8, 7, 6);
  const weak = cs(3, 3, 4, 5, 6, 6, 6, 7, 7, 8, 8, 10, J, J, Q, Q, K);
  it('牌力：好牌高、差牌低', () => {
    expect(bidStrength(strong)).toBeGreaterThan(bidStrength(weak) + 10);
  });
  it('好牌叫 3 分，差牌不叫（三档）', () => {
    for (const lv of ['normal', 'pro'] as const) {
      expect(decideDdz(mkView({ hand: strong, phase: 'bid', turn: 0 }), lv, 'x')).toEqual({ type: 'bid', seat: 0, bid: 3 });
      expect(decideDdz(mkView({ hand: weak, phase: 'bid', turn: 0 }), lv, 'x')).toEqual({ type: 'bid', seat: 0, bid: 0 });
    }
  });
  it('只叫比当前高的：别人已经叫到 2，中等牌力就不叫', () => {
    const mid = cs(BJ, 2, 2, A, K, K, Q, Q, J, 10, 9, 8, 7, 6, 5, 4, 3);
    for (const lv of LEVELS) {
      const a = decideDdz(mkView({ hand: mid, phase: 'bid', turn: 0, bid: 2 }), lv, 's');
      expect(a?.type).toBe('bid');
      if (a?.type === 'bid') expect(a.bid === 0 || a.bid > 2).toBe(true);
    }
  });
  it('没轮到不动；非叫分非出牌阶段不动', () => {
    expect(decideDdz(mkView({ hand: strong, phase: 'bid', turn: 1 }), 'normal', 1)).toBeNull();
    expect(decideDdz(mkView({ hand: strong, phase: 'dealEnd', turn: 0 }), 'normal', 1)).toBeNull();
  });
});

describe('出牌', () => {
  it('农民不压队友（普通、高手）', () => {
    const hand = cs(9, 9, 10, 10, K, A);
    const v = mkView({ hand, seat: 0, landlord: 1, counts: [6, 10, 10], turn: 0, target: { seat: 2, play: playOf(5) }, trick: [{ seat: 2, play: playOf(5) }] });
    for (const lv of ['normal', 'pro'] as const) expect(decideDdz(v, lv, 'z')).toEqual({ type: 'pass', seat: 0 });
  });
  it('队友出的牌，我一手能出完就出', () => {
    const v = mkView({ hand: cs(7, 7), landlord: 1, counts: [2, 10, 10], target: { seat: 2, play: playOf(5, 5) }, trick: [{ seat: 2, play: playOf(5, 5) }] });
    for (const lv of LEVELS) expect(decideDdz(v, lv, 'z')).toEqual({ type: 'play', seat: 0, cards: cs(7, 7).sort((a, b) => a - b) });
  });
  it('地主压农民：用刚好够的牌，不浪费大牌', () => {
    const hand = cs(6, 9, 9, Q, Q, 2);
    const v = mkView({ hand, seat: 0, landlord: 0, counts: [6, 12, 12], target: { seat: 1, play: playOf(5) }, trick: [{ seat: 1, play: playOf(5) }] });
    for (const lv of ['normal', 'pro'] as const) {
      const a = decideDdz(v, lv, 'z');
      expect(a).toEqual({ type: 'play', seat: 0, cards: [hand[0]] });
    }
  });
  it('炸弹留着：能不用就不用，对手快走完才炸', () => {
    const hand = cs(5, 5, 5, 5, 3, 4, 6, 7, 8);
    const target = { seat: 1, play: playOf(A) };
    const calm = mkView({ hand, seat: 0, landlord: 1, counts: [9, 12, 10], target, trick: [{ seat: 1, play: target.play }] });
    for (const lv of ['normal', 'pro'] as const) expect(decideDdz(calm, lv, 'z'), lv).toEqual({ type: 'pass', seat: 0 });
    const urgent = mkView({ hand, seat: 0, landlord: 1, counts: [9, 1, 10], target, trick: [{ seat: 1, play: target.play }] });
    for (const lv of ['normal', 'pro'] as const) {
      const a = decideDdz(urgent, lv, 'z');
      expect(a).toEqual({ type: 'play', seat: 0, cards: expect.any(Array) });
      if (a?.type === 'play') expect(interpretDdz(a.cards)[0]?.type).toBe('bomb');
    }
  });
  it('对手只剩一张时，首出不放小单张', () => {
    const hand = cs(3, 5, 5, 8, 9, 9, K);
    const v = mkView({ hand, seat: 0, landlord: 1, counts: [7, 1, 12] });
    for (const lv of ['normal', 'pro'] as const) {
      const a = decideDdz(v, lv, 'z');
      expect(a?.type).toBe('play');
      if (a?.type === 'play') expect(a.cards.length).toBeGreaterThan(1);
    }
  });
  it('首出先出小牌、不先拆大牌', () => {
    const hand = cs(3, 3, 3, 4, 7, 7, 9, 10, J, Q, K, K, A, 2, SJ);
    const v = mkView({ hand, seat: 0, landlord: 0, counts: [15, 17, 17] });
    for (const lv of ['normal', 'pro'] as const) {
      const a = decideDdz(v, lv, 'z');
      expect(a?.type).toBe('play');
      if (a?.type === 'play') {
        const p = interpretDdz(a.cards)[0]!;
        expect(p.v).toBeLessThanOrEqual(7);
      }
    }
  });
  it('没轮到不动', () => {
    expect(decideDdz(mkView({ hand: cs(3, 4), turn: 2 }), 'pro', 1)).toBeNull();
  });
});

describe('提示', () => {
  it('提示的牌都压得住，电脑（普通）会出的排第一', () => {
    const hand = cs(6, 9, 9, Q, Q, 2, SJ);
    const target = { seat: 1, play: playOf(5) };
    const v = mkView({ hand, seat: 0, landlord: 0, counts: [7, 12, 12], target, trick: [{ seat: 1, play: target.play }] });
    const hints = hintDdz(v);
    expect(hints.length).toBeGreaterThan(0);
    for (const p of hints) expect(beatsDdz(p, target.play)).toBe(true);
    const a = decideDdz(v, 'normal', 0);
    expect(a?.type).toBe('play');
    if (a?.type === 'play') expect([...hints[0]!.cards].sort()).toEqual([...a.cards].sort());
  });
  it('首出时提示的是整手牌的合规出法', () => {
    const hand = cs(3, 3, 4, 5, 6, 7, 9);
    const hints = hintDdz(mkView({ hand }));
    expect(hints.length).toBeGreaterThan(0);
    for (const p of hints) expect(interpretDdz(p.cards).length).toBeGreaterThan(0);
  });
});

describe('确定性与不看牌', () => {
  it('同一视图同一种子，同一动作；换种子可以不同（只有新手带随机）', () => {
    const s = createDdz('det').state;
    for (const lv of LEVELS) {
      const v = viewDdz(s, s.turn);
      expect(decideDdz(v, lv, 'a')).toEqual(decideDdz(v, lv, 'a'));
    }
  });
  it('把另两家的手牌对调（视图不变），电脑的动作不变——一路打到底每一步都查', () => {
    for (let g = 0; g < 4; g++) {
      let s = createDdz(`cf-${g}`, { deals: 1 }).state;
      while (s.phase !== 'gameOver') {
        const seat = s.turn;
        const [o1, o2] = [0, 1, 2].filter((x) => x !== seat) as [number, number];
        // 只在两家剩牌一样多时能对调而不改视图里的张数
        let twin = s;
        if (s.hands[o1]!.length === s.hands[o2]!.length) {
          const hands = s.hands.map((h) => h.slice());
          hands[o1] = s.hands[o2]!.slice();
          hands[o2] = s.hands[o1]!.slice();
          twin = { ...s, hands };
        }
        const lv = LEVELS[(g + seat) % 3]!;
        const a = decideDdz(viewDdz(s, seat), lv, `cf${g}`)!;
        expect(decideDdz(viewDdz(twin, seat), lv, `cf${g}`)).toEqual(a);
        const r = dispatchDdz(s, a);
        expect(r.error).toBeNull();
        s = r.state;
      }
    }
  });
});
