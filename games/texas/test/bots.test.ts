import { describe, expect, it } from 'vitest';
import type { Table } from '../src/core/table.ts';
import { view, type View } from '../src/core/view.ts';
import { runBots } from './bots.ts';
import { conserve, SEED } from './helpers.ts';

const seedOf = (k: number): number[] => SEED.map((w, i) => (w ^ Math.imul(k + 1, 0x9e3779b9 + i)) >>> 0);

describe('机器人对打', () => {
  it('2–6 人桌连打 1 万手：不卡死、电脑从不出不合法的操作、每一步筹码守恒', () => {
    let hands = 0;
    for (let k = 0; k < 20; k++) {
      const size = 2 + (k % 5);
      const st = runBots({ seed: seedOf(k), size, hands: 500, onStep: (t) => {
        conserve(t);
        expect(t.toAct === null ? t.phase === 'idle' : t.seats[t.toAct]!.status === 'active').toBe(true);
      } });
      hands += st.hands;
    }
    expect(hands).toBeGreaterThanOrEqual(10_000);
  });

  it('视图里没有别人没亮的底牌、牌堆和种子', () => {
    let checked = 0;
    runBots({
      seed: seedOf(99),
      size: 6,
      // 小桌的电脑偏弱、多跟少加，一手里的步数少一点：300 手不到 1 万次
      hands: 400,
      onStep: (t) => {
        for (let s = 0; s < t.seats.length; s++) {
          hidden(t, view(t, s), s);
          checked++;
        }
        hidden(t, view(t, null), null);
      },
    });
    expect(checked).toBeGreaterThan(10_000);
  });
});

/** 视图里出现 hole 的地方只有"我的底牌"和上一手亮出来的牌；没有 deck、seed */
function hidden(t: Table, v: View, me: number | null): void {
  const paths: string[] = [];
  const walk = (x: unknown, path: string): void => {
    if (Array.isArray(x)) x.forEach((y, i) => walk(y, `${path}[${i}]`));
    else if (x && typeof x === 'object')
      for (const [k, y] of Object.entries(x)) {
        if (k === 'hole' || k === 'deck' || k === 'seed' || k === 'deckPos') paths.push(`${path}.${k}`);
        walk(y, `${path}.${k}`);
      }
  };
  walk(v, '');
  for (const p of paths) expect(p).toMatch(/^\.hole$|^\.lastHand\.shown\[\d+\]\.hole$/);
  expect(v.hole).toEqual(me === null ? [] : t.seats[me]!.hole);
  for (const s of v.lastHand?.shown ?? []) expect(s.value).toBeGreaterThan(0);
}
