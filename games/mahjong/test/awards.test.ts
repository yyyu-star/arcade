/**
 * 好友房一场结束的颁奖（src/game/awards.ts、view/share.ts 的 awardsCard）：只按公开的净输赢和胡、杠、自摸数评，同一场结果永远同一组奖。
 */
import { describe, expect, test } from 'vitest';
import { awardsOf, type PublicTally } from '../src/game/awards.ts';
import { awardsCard } from '../src/view/share.ts';
import { awardLine } from '../src/view/text.ts';

const t = (wins: number, zimo = 0, gangs = 0): PublicTally => ({ wins, zimo, gangs });

describe('颁奖', () => {
  test('MVP 是净赢最多的，手气最背是净输最多的，杠王杠得最多（至少 2 个）', () => {
    expect(awardsOf([800, -1_200, 300, 100], [t(3), t(0, 0, 1), t(2, 1, 3), t(1)])).toEqual([
      { id: 'mvp', seat: 0, n: 800 },
      { id: 'unlucky', seat: 1, n: 1_200 },
      { id: 'gang', seat: 2, n: 3 },
    ]);
  });

  test('一样多：先比胡的局数，再按座位号；同一场结果每次一样', () => {
    const nets = [500, 500, -500, -500];
    const tally = [t(1, 0, 2), t(2, 0, 2), t(0), t(1)];
    expect(awardsOf(nets, tally)).toEqual([
      { id: 'mvp', seat: 1, n: 500 },
      { id: 'unlucky', seat: 3, n: 500 },
      { id: 'gang', seat: 1, n: 2 },
    ]);
    expect(awardsOf(nets, tally)).toEqual(awardsOf(nets, tally));
  });

  test('没人赢就没有 MVP，没人输就没有最背；杠不够 2 个看自摸王，也不够就不颁特色奖', () => {
    expect(awardsOf([0, 0, 0, 0], [t(0), t(0), t(0), t(0)])).toEqual([]);
    expect(awardsOf([200, -100, -100, 0], [t(1, 2, 1), t(0), t(0), t(0, 1, 1)])).toEqual([
      { id: 'mvp', seat: 0, n: 200 },
      { id: 'unlucky', seat: 1, n: 100 },
      { id: 'zimo', seat: 0, n: 2 },
    ]);
    expect(awardsOf([200, -200, 0, 0], [t(1, 1, 1), t(0), t(0), t(0)]).map((a) => a.id)).toEqual(['mvp', 'unlucky']);
  });

  test('每个奖一句模板话，只填名字和数；最背的那句不挖苦人', () => {
    expect(awardLine({ id: 'mvp', seat: 0, n: 1_600 }, '老王', ' 分')).toBe('老王 净赢 1,600 分，全场最旺');
    expect(awardLine({ id: 'unlucky', seat: 1, n: 800 }, '小李', ' 筹码')).toBe('小李 这场手气背，输了 800 筹码，下一场雄起');
    expect(awardLine({ id: 'gang', seat: 2, n: 4 }, '兔头哥', ' 分')).toContain('杠了 4 个');
  });

  test('分享卡：大字是头一个奖和得奖的人，其余的奖做小数据；没有奖就没有卡；只有名字和公开的数', () => {
    const names = ['老王', '小李', '兔头哥', '熊猫哥'];
    const list = awardsOf([800, -1_200, 300, 100], [t(3), t(0), t(2, 1, 3), t(1)]);
    const c = awardsCard(list, names, ' 分', '好友房 · 娱乐 · 8 局 · 颁奖', '小李')!;
    expect(c.big).toEqual({ value: '老王', label: '本场 MVP' });
    expect(c.stats).toEqual([
      { label: '手气最背', value: '小李' },
      { label: '杠王', value: '兔头哥' },
    ]);
    expect(c.line).toBe('老王 净赢 800 分，全场最旺');
    expect(c.player).toEqual({ name: '小李' });
    expect(awardsCard([], names, ' 分', 't', 'a')).toBeNull();
  });
});
