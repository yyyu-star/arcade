/**
 * 搭子战绩（0.16.0，src/net/together.ts）：哪一步算"一场刚打完"、哪一队赢；比赛记录里每队的分（score）按 dealPoints 攒、转视角时按队对调
 */
import { describe, expect, it } from 'vitest';
import { testKey, guandanRoom as R, type NetState } from '../src/variants/guandan/net/rules.ts';
import { matchEnd } from '../src/variants/guandan/net/together.ts';
import { rotateNetView } from '../src/variants/guandan/net/rotate.ts';
import { dealPoints } from '../src/variants/guandan/stake/index.ts';

/** 电脑把房间打到 over，记下每一步 */
function play(seed: number, seats?: ('human' | 'ai')[], stake?: 'small'): NetState[] {
  let s = R.begin(testKey(seed), R.rulesVersion, seats ? { opts: stake ? { stake } : undefined, seats } : undefined);
  const out = [s];
  // 娱乐房间打完一整局先停着等"再来一场"（没人要出手），到这儿就够了
  for (let i = 0; !R.over(s) && R.actors(s).seats.length; i++) {
    if (i > 20000) throw new Error('卡死');
    const seat = R.turn(s)!;
    const n = R.apply(s, seat, R.ai(s, seat));
    if ('error' in n) throw new Error(n.error);
    s = n;
    out.push(s);
  }
  return out;
}

describe('一场刚打完的那一步', () => {
  it('娱乐：只有出现 gameOver 的那一步，先过 A 的那队赢', () => {
    const all = play(41, ['human', 'human', 'ai', 'ai']);
    const ends = all.map(matchEnd).filter((x) => x !== null);
    expect(ends).toHaveLength(1);
    const last = all.at(-1)!;
    expect(ends[0]).toEqual([0, 1, 2, 3].map((seat) => ({ seat, team: seat % 2, win: seat % 2 === last.g.winner })));
  }, 60_000);

  it('实盘：结回记下的那一步，这一场分多的那队赢', () => {
    const all = play(42, ['human', 'human', 'ai', 'ai'], 'small');
    const idx = all.findIndex((s) => matchEnd(s) !== null);
    expect(idx).toBeGreaterThan(0);
    expect(all.filter((s) => matchEnd(s) !== null)).toHaveLength(1);
    const s = all[idx]!;
    expect(s.stake!.over).toBe(true);
    const [a, b] = s.log!.score!;
    const winner = a === b ? -1 : a! > b! ? 0 : 1;
    expect(matchEnd(s)!.map((x) => x.win)).toEqual([0, 1, 2, 3].map((seat) => seat % 2 === winner));
  }, 60_000);

  it('打平：两队都不算赢；以前开的房间（没有 score）也按打平', () => {
    const all = play(42, ['human', 'human', 'ai', 'ai'], 'small');
    const s = all.find((x) => matchEnd(x) !== null)!;
    expect(matchEnd({ ...s, log: { ...s.log!, score: [3, 3] } })!.every((x) => !x.win)).toBe(true);
    const { score: _s, ...old } = s.log!;
    expect(matchEnd({ ...s, log: old })!.every((x) => !x.win)).toBe(true);
  }, 60_000);
});

describe('每队的分', () => {
  it('每副按 dealPoints 加，两队相反；转视角奇数位时对调', () => {
    let s = R.begin(testKey(43), R.rulesVersion);
    let want = [0, 0];
    for (let i = 0; i < 5000 && s.log!.deals < 2; i++) {
      const seat = R.turn(s)!;
      const n = R.apply(s, seat, R.ai(s, seat)) as NetState;
      for (const e of n.ev) if (e.type === 'dealEnd') want = want.map((v, t) => v + dealPoints(e.result, t));
      s = n;
    }
    expect(s.log!.score).toEqual(want);
    expect(want[0]! + want[1]!).toBe(0);
    expect(rotateNetView(R.view(s, 1), 1).log!.score).toEqual([want[1], want[0]]);
    expect(rotateNetView(R.view(s, 2), 2).log!.score).toEqual(want);
  });
});
