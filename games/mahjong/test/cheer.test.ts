/**
 * 单机连输时结算页的一句和降档（src/view/text.ts，DESIGN.md 第 7 节）：同一场只记一次，赢了清零；话不嘲讽；新手没有更低的档。
 */
import { expect, test } from 'vitest';
import { CHEER_FROM, cheerLine, easierLevel, nextStreak } from '../src/view/text.ts';

test('连输按场记：同一场再弹一遍结算（刷新）不重复加，赢了、打平清零', () => {
  let s = nextStreak(null, 'a', -300);
  expect(s).toEqual({ n: 1, last: 'a' });
  expect(nextStreak(s, 'a', -300)).toBe(s);
  s = nextStreak(s, 'b', -10);
  expect(s.n).toBe(2);
  expect(nextStreak(s, 'c', 0).n).toBe(0);
  expect(nextStreak(s, 'c', 500).n).toBe(0);
});

test('输到第二场起说一句，不嘲讽；降档：高手→普通→新手，新手到底', () => {
  expect(cheerLine(CHEER_FROM - 1)).toBeNull();
  for (const n of [2, 3, 4, 9]) {
    const l = cheerLine(n)!;
    expect(l).toContain(String(n));
    expect(l).not.toMatch(/菜|蠢|笨|不会|太差/);
  }
  expect([easierLevel('hard'), easierLevel('normal'), easierLevel('easy')]).toEqual(['normal', 'easy', null]);
});
