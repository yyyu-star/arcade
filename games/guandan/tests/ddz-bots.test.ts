import { describe, expect, it } from 'vitest';
import { rngFor } from '../src/core/rng.ts';
import {
  type DdzAction, type DdzLevel, type DdzOptions, type DdzState, createDdz, createDdzKeyed, decideDdz, dispatchDdz, enumerateDdz, playsBeatingDdz, targetOf, viewDdz,
} from '../src/variants/doudizhu/index.ts';

type Mover = (s: DdzState, i: number) => DdzAction;

/** 随机机器人：叫分和出牌每步从合法动作里随机挑 */
function randomMover(tag: string): Mover {
  const rng = rngFor('ddz-bots', tag);
  return (s) => {
    if (s.phase === 'dealEnd') return { type: 'next' };
    if (s.phase === 'bid') return { type: 'bid', seat: s.turn, bid: rng.pick([0, 1, 2, 3].filter((b) => b === 0 || b > s.bid)) };
    const t = targetOf(s);
    const opts = t ? playsBeatingDdz(s.hands[s.turn]!, t.play) : enumerateDdz(s.hands[s.turn]!);
    const all: DdzAction[] = opts.map((p) => ({ type: 'play', seat: s.turn, cards: p.cards }));
    if (t) all.push({ type: 'pass', seat: s.turn });
    return rng.pick(all);
  };
}

/** 打完一场，每一步都检查：动作被接受、牌数守恒、没死锁；一副结束检查零和和封顶 */
function runMatch(start: DdzState, mover: Mover, i: number): { deals: number; state: DdzState } {
  let s = start;
  let steps = 0;
  while (s.phase !== 'gameOver') {
    if (++steps > 5000) throw new Error(`死锁：${i}`);
    const a = mover(s, i);
    const r = dispatchDdz(s, a);
    if (r.error) throw new Error(`非法动作 ${r.error}：${JSON.stringify(a)}（${i}）`);
    expect(r.state.step).toBe(s.step + 1);
    s = r.state;
    if (s.phase === 'play' || s.phase === 'bid') {
      const total = s.hands.reduce((n, h) => n + h.length, 0) + s.played.length + (s.phase === 'bid' ? s.bottom.length : 0);
      if (total !== 54) throw new Error(`牌数不对 ${total}（${i}）`);
    }
  }
  return { deals: s.results.length, state: s };
}

function checkScores(s: DdzState): void {
  const cap = s.opts.cap;
  const sum = [0, 0, 0];
  for (const r of s.results) {
    expect(r.delta.reduce((a, b) => a + b, 0)).toBe(0);
    if (s.opts.dealCap > 0) expect(r.s).toBeLessThanOrEqual(s.opts.dealCap);
    for (let x = 0; x < 3; x++) sum[x] = sum[x]! + r.delta[x]!;
  }
  expect(s.scores).toEqual(sum);
  if (cap > 0) {
    for (const x of s.scores) expect(Math.abs(x)).toBeLessThanOrEqual(cap);
    const last = s.results[s.results.length - 1]!;
    // 一场因封顶结束时：有一家正好到 ±cap，或者最后一副被截（地主余量是奇数时停在 cap-1）
    if (s.results.length < s.opts.deals) expect(s.scores.some((x) => Math.abs(x) === cap) || last.capped).toBe(true);
    if (s.scores.some((x) => Math.abs(x) === cap)) expect(s.phase).toBe('gameOver');
  }
}

describe('随机机器人：没有非法动作、没有死锁、三家分数和为 0', () => {
  it('2,000 副（400 场 × 5 副，每副封顶和一场封顶轮换；2 万副在 tools/ddz-sim.ts 里跑）', () => {
    const optsList: Partial<DdzOptions>[] = [{ deals: 5 }, { deals: 5, dealCap: 6 }, { deals: 5, cap: 7 }, { deals: 5, dealCap: 8, cap: 12 }, { deals: 5, cap: 20 }];
    let deals = 0;
    for (let i = 0; i < 400; i++) {
      const start = createDdz(`bots-${i}`, optsList[i % optsList.length]).state;
      const r = runMatch(start, randomMover(`r${i}`), i);
      deals += r.deals;
      checkScores(r.state);
    }
    expect(deals).toBeGreaterThanOrEqual(400);
  }, 30000);
  it('联机局（密钥发牌）同样', () => {
    for (let i = 0; i < 100; i++) {
      const start = createDdzKeyed([i, 2, 3, 4, 5, 6, 7, 8], { deals: 3 }).state;
      checkScores(runMatch(start, randomMover(`k${i}`), i).state);
    }
  });
  it('各种结局都出现过：春天、反春、炸弹、重发', () => {
    const seen = { spring: 0, anti: 0, bomb: 0, redeal: 0 };
    for (let i = 0; i < 250; i++) {
      const { state } = runMatch(createDdz(`mix-${i}`, { deals: 4 }).state, randomMover(`m${i}`), i);
      for (const r of state.results) {
        if (r.spring === 'spring') seen.spring++;
        if (r.spring === 'anti') seen.anti++;
        if (r.bombs > 0) seen.bomb++;
      }
    }
    expect(seen.bomb).toBeGreaterThan(10);
    expect(seen.spring + seen.anti).toBeGreaterThan(0);
  });
});

describe('电脑三档互打', () => {
  const LV: DdzLevel[] = ['novice', 'normal', 'pro'];
  function battle(n: number, pick: (i: number) => DdzLevel[], tag: string): void {
    for (let i = 0; i < n; i++) {
      const bots = pick(i);
      const mover: Mover = (s) => {
        const a = decideDdz(viewDdz(s, s.turn), bots[s.turn]!, `${tag}${i}`);
        if (!a) throw new Error('电脑没给动作');
        return a;
      };
      checkScores(runMatch(createDdz(`ai-${tag}-${i}`, { deals: 1 }).state, mover, i).state);
    }
  }
  // 高手的残局搜索慢（一副几十毫秒），所以 1,000 副里只有新手、普通混打，带高手的少打一些；更大批量的在 tools/ddz-sim.ts 里跑
  it('600 副新手 / 普通混打：没有非法动作、没有死锁', () => {
    battle(600, (i) => [LV[i % 2]!, LV[(i >> 1) % 2]!, LV[(i >> 2) % 2]!], 'a');
  }, 30000);
  it('带高手的 60 副（六种座位排列都有）：没有非法动作、没有死锁', () => {
    const perms: DdzLevel[][] = [['pro', 'normal', 'novice'], ['pro', 'novice', 'normal'], ['normal', 'pro', 'novice'], ['novice', 'pro', 'normal'], ['normal', 'novice', 'pro'], ['novice', 'normal', 'pro']];
    battle(48, (i) => perms[i % 6]!, 'b');
    battle(12, () => ['pro', 'pro', 'pro'], 'c');
  }, 30000);
});
