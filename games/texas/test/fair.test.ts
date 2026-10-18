/**
 * 电脑不看牌（DESIGN.md 4.8）：反事实实验。
 * 在电脑要做决定的那一刻，它能看到的（自己的底牌、公共牌、下注记录、公开统计、上一手亮出的牌）一样不动，
 * 只把它看不到的牌（别人的底牌和没发的牌堆）在这些牌之间随机换一遍，再让它用同一条随机流决定：两边必须一模一样。
 * 单机（aiAction）和好友房（texasRoom.ai，拿的是完整房间状态）两条路径都查；再拿三个故意作弊的电脑做阳性对照，证明这个实验抓得住。
 * 固定种子，谁跑都是同样的约 2,000 个决策点。主线审计时跑过 8 万个，结果同样是 0（2026-10-16）。
 */
import { stream, type RandomStream } from 'arcade-kit/rng';
import { describe, expect, it } from 'vitest';
import { decide } from '../src/ai/decide.ts';
import { strength } from '../src/ai/preflop.ts';
import { aiAction, aiIndex } from '../src/bot.ts';
import type { Card } from '../src/core/cards.ts';
import { evalCards } from '../src/core/eval.ts';
import { STAKES, stakesOf } from '../src/core/stakes.ts';
import { addChips, apply, deal, isFail, legal, newTable, RNG, seatHouse, seatPlayer, type Action, type Fail, type Table } from '../src/core/table.ts';
import { view } from '../src/core/view.ts';
import { texasRoom as G, type RoomState } from '../src/room/rules.ts';

const key = (x: unknown): string => JSON.stringify(x);
const ok = <X>(x: X | Fail): X => {
  if (isFail(x)) throw new Error(x.error);
  return x as X;
};

/** 平行世界：seat 看不到的牌（别人的底牌、牌堆里的）互相换位置；自己的底牌、公共牌和其余一切不动。种子也可以一起换 */
function parallel(t: Table, seat: number, r: RandomStream, seed?: number[]): { t: Table; changed: boolean } {
  const seen = new Set<Card>([...t.seats[seat]!.hole, ...t.board]);
  const hidden = Array.from({ length: 52 }, (_, c) => c).filter((c) => !seen.has(c));
  const perm = hidden.slice();
  for (let i = perm.length - 1; i > 0; i--) {
    const j = r.below(i + 1);
    [perm[i], perm[j]] = [perm[j]!, perm[i]!];
  }
  const to = new Map(hidden.map((c, i) => [c, perm[i]!]));
  const f = (c: Card): Card => to.get(c) ?? c;
  const u = structuredClone(t);
  let changed = false;
  u.seats.forEach((s, i) => {
    if (i === seat) return;
    s.hole = s.hole.map(f);
    if (key(s.hole) !== key(t.seats[i]!.hole)) changed = true;
  });
  u.deck = u.deck.map(f);
  if (seed) u.seed = seed;
  return { t: u, changed };
}

interface Tally {
  n: number;
  changed: number;
  diff: number;
  /** 视图逐字段不一样的次数（只查单机路径） */
  viewDiff: number;
  /** 连种子也换掉、电脑还用原来那条流时决定不一样的次数（证明视图不带种子） */
  seedDiff: number;
}
const tally = (): Tally => ({ n: 0, changed: 0, diff: 0, viewDiff: 0, seedDiff: 0 });

type Brain = (t: Table, seat: number) => Action;

/** 单机：0 号是真人（由电脑代打），其余是电脑；人数、档位、强弱档都随机，打到凑够 target 个电脑的决策点 */
function solo(target: number, brain: Brain, seed: number): Tally {
  const g = stream([seed, 0xfa1, 2, 3, 4, 5, 6, 7], 'fair');
  const entropy = (): number[] => Array.from({ length: 8 }, () => g.u32());
  const cf = stream(entropy(), 'cf');
  const res = tally();
  while (res.n < target) {
    const size = 2 + g.below(8);
    const stakes = STAKES[g.below(STAKES.length)]!.id;
    let t = newTable(stakes, size, entropy(), { level: g.below(6) });
    t = ok(seatPlayer(t, 0, stakesOf(stakes).max, false));
    for (let i = 1; i < size; i++) t = ok(seatHouse(t, i, false));
    t = deal(t);
    const hands = 5 + g.below(25);
    for (let k = 0; k < 4000 && t.handNo <= hands && res.n < target; k++) {
      if (t.toAct === null) {
        if (t.seats[0]!.owner === 'player' && t.seats[0]!.stack === 0) t = ok(addChips(t, 0, stakesOf(stakes).max));
        else t = deal(t);
        if (t.toAct === null) break;
        continue;
      }
      const seat = t.toAct;
      let a: Action;
      if (t.seats[seat]!.owner !== 'house') a = aiAction(t, seat);
      else {
        a = brain(t, seat);
        const p = parallel(t, seat, cf);
        res.n++;
        if (p.changed) res.changed++;
        if (key(brain(p.t, seat)) !== key(a)) res.diff++;
        if (brain === aiAction) {
          if (key(view(p.t, seat)) !== key(view(t, seat))) res.viewDiff++;
          const q = parallel(t, seat, cf, entropy());
          if (key(decide(view(q.t, seat), stream(t.seed, RNG.ai, aiIndex(t, seat)))) !== key(a)) res.seedDiff++;
        }
      }
      t = ok(apply(t, seat, a));
    }
  }
  return res;
}

/** 好友房：kit 调的是 texasRoom.ai(房间状态, 座位)，它手里有整个房间的状态，这里直接调同一个函数 */
function room(target: number, seed: number): Tally {
  const g = stream([seed, 0xfa2, 2, 3, 4, 5, 6, 7], 'fair');
  const entropy = (): number[] => Array.from({ length: 8 }, () => g.u32());
  const cf = stream(entropy(), 'cf');
  const res = tally();
  while (res.n < target) {
    const size = 3 + g.below(7);
    const humans = 2 + g.below(Math.min(2, size - 2));
    const stakes = STAKES[g.below(STAKES.length)]!.id;
    const kinds = Array.from({ length: 9 }, (_, i) => (i < humans ? 'human' : i < size ? 'ai' : 'empty') as 'human' | 'ai' | 'empty');
    let s: RoomState = G.begin!(entropy(), G.rulesVersion, { opts: { stakes, size }, seats: kinds });
    const settle = (): void => {
      for (const e of G.effects!(s)) s = G.settled!(s, e.id, { ok: true });
    };
    const hands = 5 + g.below(20);
    for (let k = 0; k < 4000 && s.t.handNo <= hands && res.n < target; k++) {
      settle();
      const seat = G.turn(s);
      if (seat === null) {
        if (G.pause!(s) === null) break;
        s = G.resume!(s);
        continue;
      }
      let a: Action | { t: 'timeout' };
      if (s.kinds[seat] === 'human') a = s.opening ? { t: 'timeout' } : aiAction(s.t, seat);
      else {
        a = G.ai(s, seat) as Action;
        if (s.t.seats[seat]!.owner === 'house' && !s.opening) {
          const p = parallel(s.t, seat, cf);
          res.n++;
          if (p.changed) res.changed++;
          if (key(G.ai({ ...s, t: p.t }, seat)) !== key(a)) res.diff++;
        }
      }
      s = ok(G.apply(s, seat, a));
    }
  }
  return res;
}

// ---------- 阳性对照：三种作弊的电脑，同样的实验必须抓得出来 ----------

const now = (t: Table, hole: Card[]): number => (t.board.length ? evalCards([...hole, ...t.board]) : strength(hole[0]!, hole[1]!));
/** 偷看别人的底牌：眼下输给还在的任何一个对手就过牌或弃牌 */
const peekHoles: Brain = (t, seat) => {
  const mine = now(t, t.seats[seat]!.hole);
  const behind = t.seats.some((o, i) => i !== seat && (o.status === 'active' || o.status === 'allin') && now(t, o.hole) > mine);
  if (behind) return legal(t, seat)!.check ? { t: 'check' } : { t: 'fold' };
  return aiAction(t, seat);
};
/** 偷看牌堆：下一张要发的是 J 以上就最小加注 */
const peekDeck: Brain = (t, seat) => {
  const lg = legal(t, seat)!;
  if (lg.raise && t.deck[t.deckPos]! >> 2 >= 9) return lg.minTo >= lg.maxTo ? { t: 'allin' } : { t: 'raise', to: lg.minTo };
  return aiAction(t, seat);
};
/** 隐蔽的泄漏：决定只看视图，但随机流的序号混进了牌堆 */
const leakyRng: Brain = (t, seat) => {
  let h = 0;
  for (const c of t.deck) h = (h * 31 + c) % 1_000_003;
  return decide(view(t, seat), stream(t.seed, RNG.ai, aiIndex(t, seat) + h * 2 ** 32));
};

describe('电脑不看牌：换掉它看不到的牌，决定不变', () => {
  it('单机（aiAction）1,500 个决策点：0 不一致，视图逐字段相同，连种子换掉也一样', () => {
    const r = solo(1_500, aiAction, 1);
    expect(r.n).toBe(1_500);
    // 确实换到了别人的牌（几乎每次都换到）
    expect(r.changed).toBeGreaterThan(1_450);
    expect(r.diff).toBe(0);
    expect(r.viewDiff).toBe(0);
    expect(r.seedDiff).toBe(0);
  });

  it('好友房（texasRoom.ai）600 个决策点：0 不一致', () => {
    const r = room(600, 2);
    expect(r.n).toBe(600);
    expect(r.changed).toBeGreaterThan(580);
    expect(r.diff).toBe(0);
  });

  it('阳性对照：偷看底牌、偷看牌堆、随机流混进牌堆的电脑都会被抓出来', () => {
    for (const [name, brain, least] of [
      ['偷看底牌', peekHoles, 10],
      ['偷看牌堆', peekDeck, 30],
      ['随机流混进牌堆', leakyRng, 30],
    ] as const) {
      const r = solo(400, brain, 3);
      expect(r.diff, name).toBeGreaterThanOrEqual(least);
    }
  });
});

describe('视图里只有该看到的牌', () => {
  /** 视图里所有叫 hole 的字段在哪：只许是自己的底牌和上一手亮出来的那几手 */
  function holePaths(x: unknown, path: string, out: string[]): string[] {
    if (Array.isArray(x)) x.forEach((v, i) => holePaths(v, `${path}[${i}]`, out));
    else if (x && typeof x === 'object')
      for (const [k, v] of Object.entries(x)) {
        if (k === 'hole') out.push(`${path}.hole`);
        holePaths(v, `${path}.${k}`, out);
      }
    return out;
  }

  it('上一手的 shown 只有摊牌时还在的人、亮的就是他的牌；弃牌赢的一张不亮；hole 只出现在该出现的地方', () => {
    const g = stream([4, 0xfa3, 2, 3, 4, 5, 6, 7], 'fair');
    let hands = 0;
    let shows = 0;
    for (let n = 0; n < 40; n++) {
      const size = 2 + g.below(8);
      let t = newTable('small', size, Array.from({ length: 8 }, () => g.u32()), { level: g.below(6) });
      t = ok(seatPlayer(t, 0, stakesOf('small').max, false));
      for (let i = 1; i < size; i++) t = ok(seatHouse(t, i, false));
      t = deal(t);
      for (let k = 0; k < 3000 && t.handNo <= 10; k++) {
        if (t.toAct === null) {
          if (t.seats[0]!.stack === 0) t = ok(addChips(t, 0, stakesOf('small').max));
          else t = deal(t);
          if (t.toAct === null) break;
          continue;
        }
        const seat = t.toAct;
        const a = aiAction(t, seat);
        const before = t;
        t = ok(apply(t, seat, a));
        if (t.lastHand?.handNo !== before.handNo || before.lastHand?.handNo === before.handNo) continue;
        // 这一手刚打完：摊牌时还在的人（最后这一步弃牌的不算）
        hands++;
        const live = new Set(before.seats.flatMap((s, i) => ((s.status === 'active' || s.status === 'allin') && !(i === seat && a.t === 'fold') ? [i] : [])));
        const h = t.lastHand!;
        if (h.byFold) expect(h.shown).toEqual([]);
        for (const x of h.shown) {
          expect(live.has(x.seat)).toBe(true);
          expect(x.hole).toEqual(before.seats[x.seat]!.hole);
        }
        shows += h.shown.length;
        for (let me = 0; me < t.seats.length; me++) {
          const v = view(t, me);
          const allowed = ['$.hole', ...v.lastHand!.shown.map((_, i) => `$.lastHand.shown[${i}].hole`)];
          expect(holePaths(v, '$', []).filter((p) => !allowed.includes(p))).toEqual([]);
          expect(Object.keys(v.lastHand!).sort()).toEqual(['board', 'byFold', 'handNo', 'pots', 'shown', 'uncalled']);
          for (const e of v.log) expect(Object.keys(e).every((k) => ['seat', 'act', 'amount', 'allin', 'auto'].includes(k))).toBe(true);
        }
      }
    }
    expect(hands).toBeGreaterThan(300);
    expect(shows).toBeGreaterThan(100);
  });

  it('一手打完停着（0.19.0 亮牌）：kept 只给自己、主动亮的只是那家自己的牌，别人没亮的牌哪里都没有', () => {
    const g = stream([5, 0xfa3, 2, 3, 4, 5, 6, 7], 'fair-show');
    let held = 0;
    let showed = 0;
    let swaps = 0;
    for (let n = 0; n < 30; n++) {
      const size = 2 + g.below(8);
      let t = newTable('small', size, Array.from({ length: 8 }, () => g.u32()), { holdHands: true, level: g.below(6) });
      for (let i = 0; i < size; i++) t = ok(seatPlayer(t, i, stakesOf('small').max, false));
      t = deal(t);
      for (let k = 0; k < 3000 && t.handNo <= 8; k++) {
        if (t.toAct !== null) {
          t = ok(apply(t, t.toAct, aiAction(t, t.toAct)));
          continue;
        }
        if (!t.hold) break;
        held++;
        // 停着时随机有人离桌、别人马上坐进同一个座位（0.19.1）：上一个人的牌对新来的人也是别人的
        const orig = t.kept!.map((c) => [...c]);
        const swapped = new Set<number>();
        for (let i = 0; i < size; i++) {
          if (g.below(5) !== 0) continue;
          t = ok(apply(t, i, { t: 'leave' }));
          if (t.seats[i]!.owner !== 'none') continue;
          t = ok(g.below(2) ? seatPlayer(t, i, stakesOf('small').max, false) : seatHouse(t, i, false));
          swapped.add(i);
          swaps++;
        }
        // 随机几家亮一张或两张（摊牌亮过的会被拒，跳过）
        for (let i = 0; i < size; i++) {
          if (g.below(3) !== 0) continue;
          const r = apply(t, i, { t: 'show', cards: g.below(2) ? [0, 1] : [g.below(2)] });
          if (!isFail(r)) t = r;
        }
        const h = t.lastHand!;
        for (const x of h.showed ?? []) {
          showed++;
          expect(x.cards.every((c) => t.kept![x.seat]!.includes(c))).toBe(true);
        }
        for (let me = 0; me < size; me++) {
          const v = view(t, me);
          expect(v.kept ?? []).toEqual(t.kept![me]!.length === 2 ? t.kept![me] : []);
          // 别人这一手的底牌：没亮的那几张不许出现在视图的任何牌字段里
          const open = new Set<number>([...v.board, ...(v.lastHand?.board ?? []), ...(v.kept ?? []), ...h.shown.flatMap((x) => x.hole), ...(h.showed ?? []).flatMap((x) => x.cards)]);
          if (swapped.has(me)) expect(v.kept).toBeUndefined();
          // 换过人的座位：上一个人的牌连新坐下的人自己也不许看到
          const secret = orig.flatMap((c, i) => (i === me && !swapped.has(me) ? [] : c)).filter((c) => !open.has(c));
          const cards: number[] = [];
          const walk = (x: unknown, key: string): void => {
            if (Array.isArray(x)) {
              if (['hole', 'kept', 'cards', 'board'].includes(key)) cards.push(...(x as number[]));
              else x.forEach((y) => walk(y, key));
            } else if (x && typeof x === 'object') for (const [k2, y] of Object.entries(x)) walk(y, k2);
          };
          walk(v, '');
          expect(cards.filter((c) => secret.includes(c))).toEqual([]);
          expect(Object.keys(v.lastHand!).every((k2) => ['board', 'byFold', 'handNo', 'pots', 'shown', 'uncalled', 'showed'].includes(k2))).toBe(true);
          expect(JSON.stringify(v)).not.toContain('"kept":[[');
        }
        t = deal(t);
        if (t.toAct === null) break;
      }
    }
    expect(held).toBeGreaterThan(100);
    expect(showed).toBeGreaterThan(50);
    expect(swaps).toBeGreaterThan(20);
  });
});
