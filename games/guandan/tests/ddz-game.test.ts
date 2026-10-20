import { describe, expect, it } from 'vitest';
import { makeCard } from '../src/core/cards.ts';
import { rngFor } from '../src/core/rng.ts';
import {
  type DdzAction, type DdzState, actorsDdz, createDdz, createDdzKeyed, dispatchDdz, enumerateDdz, playsBeatingDdz,
  replayDdz, replayDdzFrom, timeoutDdz, turnMsDdz, viewDdz,
} from '../src/variants/doudizhu/core/index.ts';

const KEY = [1, 2, 3, 4, 5, 6, 7, 8];
const OTHER_KEY = [8, 7, 6, 5, 4, 3, 2, 1];
const c = (rank: number, suit = 0) => makeCard(rank, suit);

function must(s: DdzState, a: DdzAction): DdzState {
  const r = dispatchDdz(s, a);
  expect(r.error, JSON.stringify(a)).toBeNull();
  return r.state;
}

/** 造一个出牌阶段的局面：地主 landlord，手牌自己给 */
function playing(hands: number[][], landlord: number, extra: Partial<DdzState> = {}): DdzState {
  const base = createDdz('fix', { deals: 6 }).state;
  return { ...base, phase: 'play', landlord, bid: 1, turn: landlord, hands, trick: [], handsPlayed: [0, 0, 0], played: [], bombs: 0, bids: [null, null, null], ...extra };
}

describe('发牌', () => {
  it('3 人各 17 张、底牌 3 张、一副牌不重不漏', () => {
    const s = createDdz('a').state;
    expect(s.hands.map((h) => h.length)).toEqual([17, 17, 17]);
    expect(s.bottom).toHaveLength(3);
    expect([...s.hands.flat(), ...s.bottom].sort((a, b) => a - b)).toEqual(Array.from({ length: 54 }, (_, i) => i));
    expect(s.phase).toBe('bid');
    expect(s.turn).toBe(s.firstBidder);
  });
  it('联机局状态里没有种子，按密钥发牌，换密钥换牌', () => {
    const a = createDdzKeyed(KEY).state;
    expect(a.seed).toBe('');
    expect(a.key).toEqual(KEY);
    expect(createDdzKeyed(KEY).state.hands).toEqual(a.hands);
    expect(createDdzKeyed(OTHER_KEY).state.hands).not.toEqual(a.hands);
    expect(() => createDdzKeyed([1, 2, 3])).toThrow();
  });
});

describe('叫分', () => {
  it('叫 3 分立刻结束，地主拿到底牌先出', () => {
    const s0 = createDdz('b').state;
    const f = s0.firstBidder;
    const bottom = s0.bottom;
    const s = must(s0, { type: 'bid', seat: f, bid: 3 });
    expect(s.phase).toBe('play');
    expect(s.landlord).toBe(f);
    expect(s.bid).toBe(3);
    expect(s.turn).toBe(f);
    expect(s.hands[f]).toHaveLength(20);
    for (const b of bottom) expect(s.hands[f]).toContain(b);
    expect(s.hands.map((h) => h.length)).toEqual([0, 1, 2].map((i) => (i === f ? 20 : 17)));
  });
  it('只能叫更高的分，别人没轮到不能叫', () => {
    const s0 = createDdz('c').state;
    const f = s0.firstBidder;
    expect(dispatchDdz(s0, { type: 'bid', seat: (f + 1) % 3, bid: 1 }).error).toBe('not_your_turn');
    expect(dispatchDdz(s0, { type: 'bid', seat: f, bid: 4 }).error).toBe('bad_bid');
    expect(dispatchDdz(s0, { type: 'bid', seat: f, bid: -1 }).error).toBe('bad_bid');
    expect(dispatchDdz(s0, { type: 'bid', seat: f, bid: 1.5 }).error).toBe('bad_bid');
    const s1 = must(s0, { type: 'bid', seat: f, bid: 2 });
    const n = (f + 1) % 3;
    expect(dispatchDdz(s1, { type: 'bid', seat: n, bid: 2 }).error).toBe('bad_bid');
    expect(dispatchDdz(s1, { type: 'bid', seat: n, bid: 1 }).error).toBe('bad_bid');
    expect(dispatchDdz(s1, { type: 'play', seat: n, cards: [s1.hands[n]![0]!] }).error).toBe('not_playing');
    must(s1, { type: 'bid', seat: n, bid: 0 });
    must(s1, { type: 'bid', seat: n, bid: 3 });
  });
  it('叫完一圈，叫得最高的当地主（叫分各不同）', () => {
    for (const [bids, who] of [[[1, 0, 2], 2], [[2, 0, 0], 0], [[1, 2, 0], 1], [[0, 1, 0], 1], [[0, 0, 1], 2], [[1, 3, 0], 1]] as const) {
      let s = createDdz('d').state;
      const f = s.firstBidder;
      for (let i = 0; i < 3 && s.phase === 'bid'; i++) s = must(s, { type: 'bid', seat: (f + i) % 3, bid: bids[i]! });
      expect(s.phase).toBe('play');
      expect(s.landlord).toBe((f + who) % 3);
      expect(s.bid).toBe(Math.max(...bids));
    }
  });
  it('三家都不叫：重发，先叫的人轮换，牌换一手', () => {
    let s = createDdz('e').state;
    const f = s.firstBidder;
    const before = s.hands;
    for (let i = 0; i < 3; i++) s = must(s, { type: 'bid', seat: (f + i) % 3, bid: 0 });
    expect(s.phase).toBe('bid');
    expect(s.dealNo).toBe(1);
    expect(s.redeal).toBe(1);
    expect(s.firstBidder).toBe((f + 1) % 3);
    expect(s.turn).toBe(s.firstBidder);
    expect(s.hands).not.toEqual(before);
    expect(s.bids).toEqual([null, null, null]);
  });
  it('连续 3 次没人叫，第 4 副先叫的人直接 1 分当地主', () => {
    let s = createDdz('f').state;
    for (let r = 0; r < 3; r++) {
      expect(s.phase).toBe('bid');
      const f = s.firstBidder;
      for (let i = 0; i < 3; i++) s = must(s, { type: 'bid', seat: (f + i) % 3, bid: 0 });
    }
    expect(s.redeal).toBe(3);
    expect(s.phase).toBe('play');
    expect(s.landlord).toBe(s.firstBidder);
    expect(s.bid).toBe(1);
    expect(s.hands[s.landlord]).toHaveLength(20);
    expect(s.turn).toBe(s.landlord);
  });
});

describe('出牌与轮转', () => {
  it('不要、压牌、两家都不要后最后出牌的人重新首出', () => {
    const hands = [[c(3), c(9), c(9, 1)], [c(4), c(5), c(6)], [c(7), c(8), c(10)]];
    let s = playing(hands, 0);
    expect(dispatchDdz(s, { type: 'pass', seat: 0 }).error).toBe('must_lead');
    s = must(s, { type: 'play', seat: 0, cards: [c(3)] });
    expect(dispatchDdz(s, { type: 'play', seat: 1, cards: [c(4), c(5)] }).error).toBe('bad_pattern');
    expect(dispatchDdz(s, { type: 'play', seat: 1, cards: [c(9)] }).error).toBe('not_in_hand');
    expect(dispatchDdz(s, { type: 'play', seat: 2, cards: [c(7)] }).error).toBe('not_your_turn');
    s = must(s, { type: 'play', seat: 1, cards: [c(4)] });
    s = must(s, { type: 'pass', seat: 2 });
    s = must(s, { type: 'pass', seat: 0 });
    expect(s.turn).toBe(1);
    expect(s.trick).toEqual([]);
    expect(dispatchDdz(s, { type: 'pass', seat: 1 }).error).toBe('must_lead');
  });
  it('太小压不住', () => {
    let s = playing([[c(5), c(6)], [c(3), c(8)], [c(4), c(9)]], 0);
    s = must(s, { type: 'play', seat: 0, cards: [c(6)] });
    expect(dispatchDdz(s, { type: 'play', seat: 1, cards: [c(3)] }).error).toBe('too_small');
  });
  it('不改传进来的状态', () => {
    const s0 = createDdz('g').state;
    const snap = JSON.stringify(s0);
    dispatchDdz(s0, { type: 'bid', seat: s0.firstBidder, bid: 3 });
    expect(JSON.stringify(s0)).toBe(snap);
  });
  it('step 每次成功加 1，失败不变；actors 的 group 跟着 step 变', () => {
    const s0 = createDdz('h').state;
    expect(s0.step).toBe(0);
    expect(actorsDdz(s0)).toEqual({ seats: [s0.firstBidder], group: `bid-1-0` });
    expect(dispatchDdz(s0, { type: 'bid', seat: s0.firstBidder, bid: 9 }).state.step).toBe(0);
    const s1 = must(s0, { type: 'bid', seat: s0.firstBidder, bid: 3 });
    expect(s1.step).toBe(1);
    const a = actorsDdz(s1);
    expect(a.seats).toEqual([s1.landlord]);
    expect(a.group).toBe('play-1-1');
    expect(turnMsDdz(s0)).toBe(15000);
    expect(turnMsDdz(s1)).toBe(30000);
  });
  it('一副打完 actors 没人；等下一副', () => {
    const s = must(playing([[c(3)], [c(4)], [c(5)]], 0), { type: 'play', seat: 0, cards: [c(3)] });
    expect(s.phase).toBe('dealEnd');
    expect(actorsDdz(s).seats).toEqual([]);
    expect(turnMsDdz(s)).toBe(0);
    expect(dispatchDdz(s, { type: 'play', seat: 0, cards: [c(3)] }).error).toBeTruthy();
    const n = must(s, { type: 'next' });
    expect(n.dealNo).toBe(2);
    expect(n.firstBidder).toBe((s.firstBidder + 1) % 3);
    expect(dispatchDdz(n, { type: 'next' }).error).toBe('not_deal_end');
  });
});

describe('结算', () => {
  it('春天：地主赢，两个农民一手没出，翻一倍', () => {
    const s = must(playing([[c(3)], [c(4)], [c(5)]], 0, { bid: 2 }), { type: 'play', seat: 0, cards: [c(3)] });
    const r = s.results[0]!;
    expect(r).toMatchObject({ landlordWon: true, spring: 'spring', mult: 2, s: 4, bombs: 0 });
    expect(r.delta).toEqual([8, -4, -4]);
  });
  it('农民出过牌就不是春天', () => {
    const s = must(playing([[c(3)], [c(4)], [c(5)]], 0, { bid: 2, handsPlayed: [1, 1, 0] }), { type: 'play', seat: 0, cards: [c(3)] });
    expect(s.results[0]).toMatchObject({ spring: null, mult: 1, s: 2 });
    expect(s.results[0]!.delta).toEqual([4, -2, -2]);
  });
  it('反春：农民赢，地主只出过第一手', () => {
    const s = must(playing([[c(9), c(10)], [c(4)], [c(5)]], 0, { bid: 3, handsPlayed: [1, 0, 0], turn: 1, trick: [{ seat: 0, play: null }] }), { type: 'play', seat: 1, cards: [c(4)] });
    const r = s.results[0]!;
    expect(r).toMatchObject({ landlordWon: false, spring: 'anti', mult: 2, s: 6 });
    expect(r.delta).toEqual([-12, 6, 6]);
  });
  it('地主出过两手，农民赢不算反春', () => {
    const s = must(playing([[c(9)], [c(4)], [c(5)]], 0, { bid: 3, handsPlayed: [2, 0, 0], turn: 2 }), { type: 'play', seat: 2, cards: [c(5)] });
    expect(s.results[0]).toMatchObject({ spring: null, mult: 1, s: 3 });
  });
  it('炸弹、王炸各翻一倍，和春天叠加', () => {
    let s = playing([[c(5, 0), c(5, 1), c(5, 2), c(5, 3), c(3), c(16), c(17)], [c(4)], [c(6)]], 0, { bid: 1 });
    s = must(s, { type: 'play', seat: 0, cards: [c(5, 0), c(5, 1), c(5, 2), c(5, 3)] });
    expect(s.bombs).toBe(1);
    s = must(s, { type: 'pass', seat: 1 });
    s = must(s, { type: 'pass', seat: 2 });
    s = must(s, { type: 'play', seat: 0, cards: [c(16), c(17)] });
    expect(s.bombs).toBe(2);
    s = must(s, { type: 'pass', seat: 1 });
    s = must(s, { type: 'pass', seat: 2 });
    s = must(s, { type: 'play', seat: 0, cards: [c(3)] });
    expect(s.results[0]).toMatchObject({ bombs: 2, spring: 'spring', mult: 8, s: 8 });
    expect(s.results[0]!.delta).toEqual([16, -8, -8]);
  });
  it('四带二不翻倍', () => {
    let s = playing([[c(5, 0), c(5, 1), c(5, 2), c(5, 3), c(3), c(4), c(7)], [c(9)], [c(6)]], 0);
    s = must(s, { type: 'play', seat: 0, cards: [c(5, 0), c(5, 1), c(5, 2), c(5, 3), c(3), c(4)] });
    expect(s.bombs).toBe(0);
  });
  it('每副封顶 dealCap', () => {
    const s = must(playing([[c(3)], [c(4)], [c(5)]], 0, { bid: 3, bombs: 3, opts: { deals: 6, dealCap: 24, cap: 0 } }), { type: 'play', seat: 0, cards: [c(3)] });
    expect(s.results[0]).toMatchObject({ s: 24, mult: 16 });
    expect(s.results[0]!.delta).toEqual([48, -24, -24]);
  });
  it('一场封顶 cap：截的是 s，三家仍然零和，正好到 ±cap', () => {
    const s = must(playing([[c(3)], [c(4)], [c(5)]], 0, { bid: 3, scores: [8, -4, -4], opts: { deals: 6, dealCap: 0, cap: 10 } }), { type: 'play', seat: 0, cards: [c(3)] });
    const r = s.results[0]!;
    expect(r.capped).toBe(true);
    expect(r.s).toBe(1);
    expect(r.delta).toEqual([2, -1, -1]);
    expect(s.scores).toEqual([10, -5, -5]);
    expect(s.phase).toBe('gameOver');
  });
  it('一场封顶：农民先到顶，截到正好 ±cap', () => {
    // 农民 1 在 -8，输给地主时每个农民 -s：余量 2，地主 +2s 余量大
    const s = must(playing([[c(3)], [c(4)], [c(5)]], 0, { bid: 3, scores: [4, -8, 4], opts: { deals: 6, dealCap: 0, cap: 10 } }), { type: 'play', seat: 0, cards: [c(3)] });
    expect(s.results[0]!.s).toBe(2);
    expect(s.results[0]!.delta).toEqual([4, -2, -2]);
    expect(s.scores).toEqual([8, -10, 2]);
    expect(s.scores.reduce((x, y) => x + y, 0)).toBe(0);
    expect(s.phase).toBe('gameOver');
  });
  it('一场封顶：没碰到顶就不截、不结束', () => {
    const s = must(playing([[c(3)], [c(4)], [c(5)]], 0, { bid: 1, opts: { deals: 6, dealCap: 0, cap: 40 } }), { type: 'play', seat: 0, cards: [c(3)] });
    expect(s.results[0]!.capped).toBe(false);
    expect(s.phase).toBe('dealEnd');
  });
  it('打满 deals 副，一场结束', () => {
    const s = must(playing([[c(3)], [c(4)], [c(5)]], 0, { opts: { deals: 1, dealCap: 0, cap: 0 } }), { type: 'play', seat: 0, cards: [c(3)] });
    expect(s.phase).toBe('gameOver');
  });
});

describe('视图不泄漏', () => {
  it('只有自己的手牌；叫分时没有底牌，地主定了才有', () => {
    const s0 = createDdz('v').state;
    for (let seat = 0; seat < 3; seat++) {
      const v = viewDdz(s0, seat);
      expect(v.hand).toEqual(s0.hands[seat]);
      expect(v.bottom).toEqual([]);
      expect(v.counts).toEqual([17, 17, 17]);
      const json = JSON.stringify(v);
      for (const other of [0, 1, 2].filter((x) => x !== seat)) for (const card of s0.hands[other]!) expect(v.hand.includes(card)).toBe(false);
      expect(json).not.toContain('"seed"');
      expect(json).not.toContain('"key"');
    }
    const s1 = must(s0, { type: 'bid', seat: s0.firstBidder, bid: 3 });
    for (let seat = 0; seat < 3; seat++) {
      const v = viewDdz(s1, seat);
      expect(v.bottom).toEqual(s1.bottom);
      expect(v.hand).toEqual(s1.hands[seat]);
    }
    expect(viewDdz(s1, -1).hand).toEqual([]); // 旁观
    expect(viewDdz(s1, -1).counts).toEqual([0, 1, 2].map((i) => s1.hands[i]!.length));
  });
  it('联机局的视图里没有密钥', () => {
    const v = JSON.stringify(viewDdz(createDdzKeyed(KEY).state, 0));
    expect(v).not.toContain('key');
    expect(v).not.toContain('seed');
  });
});

describe('超时', () => {
  it('叫分：不叫；首出：最小的单张；跟牌：不要；没轮到：null', () => {
    const s0 = createDdz('t').state;
    const f = s0.firstBidder;
    expect(timeoutDdz(viewDdz(s0, f))).toEqual({ type: 'bid', seat: f, bid: 0 });
    expect(timeoutDdz(viewDdz(s0, (f + 1) % 3))).toBeNull();
    const s1 = must(s0, { type: 'bid', seat: f, bid: 3 });
    const a = timeoutDdz(viewDdz(s1, f))!;
    expect(a.type).toBe('play');
    must(s1, a);
    const s2 = must(s1, a);
    const n = (f + 1) % 3;
    expect(timeoutDdz(viewDdz(s2, n))).toEqual({ type: 'pass', seat: n });
  });
});

describe('确定性与回放', () => {
  /** 用 enumerate 的第一个合法动作打完一场（叫分：随机挑），记下动作 */
  function playOut(start: DdzState, tag: string): { actions: DdzAction[]; final: DdzState } {
    let s = start;
    const actions: DdzAction[] = [];
    const rng = rngFor(tag, 'moves');
    for (let guard = 0; guard < 3000 && s.phase !== 'gameOver'; guard++) {
      let a: DdzAction;
      if (s.phase === 'dealEnd') a = { type: 'next' };
      else if (s.phase === 'bid') a = { type: 'bid', seat: s.turn, bid: rng.pick([0, 1, 2, 3].filter((b) => b === 0 || b > s.bid)) };
      else {
        const hand = s.hands[s.turn]!;
        const t = s.trick.length ? [...s.trick].reverse().find((x) => x.play) : undefined;
        const opts = t ? playsBeatingDdz(hand, t.play) : enumerateDdz(hand);
        const all: DdzAction[] = opts.map((p) => ({ type: 'play', seat: s.turn, cards: p.cards }));
        if (t) all.push({ type: 'pass', seat: s.turn });
        a = rng.pick(all);
      }
      s = must(s, a);
      actions.push(a);
    }
    expect(s.phase).toBe('gameOver');
    return { actions, final: s };
  }

  it('同种子同动作：状态逐字节相同；不同种子不同', () => {
    const { actions, final } = playOut(createDdz('r1').state, 'r1');
    expect(JSON.stringify(replayDdz('r1', {}, actions))).toBe(JSON.stringify(final));
    expect(JSON.stringify(replayDdz('r1', {}, actions))).toBe(JSON.stringify(final));
    expect(JSON.stringify(createDdz('r2').state)).not.toBe(JSON.stringify(createDdz('r1').state));
    expect(final.results).toHaveLength(6);
  });
  it('联机局同样确定', () => {
    const { actions, final } = playOut(createDdzKeyed(KEY).state, 'k1');
    expect(JSON.stringify(replayDdzFrom(createDdzKeyed(KEY).state, actions))).toBe(JSON.stringify(final));
    expect(JSON.stringify(createDdzKeyed(KEY).state)).toBe(JSON.stringify(createDdzKeyed(KEY).state));
    expect(final.scores.reduce((x, y) => x + y, 0)).toBe(0);
  });
  it('回放遇到非法动作会抛错', () => {
    expect(() => replayDdz('x', {}, [{ type: 'pass', seat: 0 }])).toThrow();
  });
});
