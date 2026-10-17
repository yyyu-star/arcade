/**
 * 晒战绩卡挑什么（0.21.1，src/share-pick.ts）：主线看了真号的卡后定的三条——称号挑体面的、小格挑亮眼的、底下一句不在词中间断。
 * 用例照那张卡的数据：雀馆 25 局 4%、德州 22 局 23%、掼蛋 1 局 0%，最大一把德州 30，称号只有一个"点炮王"。
 */
import { describe, expect, it } from 'vitest';
import type { CareerView } from '../src/api';
import { isSelfMocking, LINE_MAX, pickBadge, pickStats } from '../src/share-pick';

const career = (o: Partial<CareerView>): CareerView => ({ n: 1, net: 0, wnet: 0, rounds: 0, wins: 0, best: 0, titles: [], max: {}, sum: {}, ...o });
const NAMES: Record<string, Record<string, string>> = {
  mahjong: { xz_pao_king: '点炮王', xz_zimo_king: '自摸王' },
  texas: { money_boy: '送财童子', bluff_king: '诈唬王' },
  kaipan: { leek_new: '新韭菜', ashore: '上岸散户' },
};
const nameOf = (g: string, id: string) => NAMES[g]?.[id];

describe('称号挑体面的', () => {
  it('那张卡：只有"点炮王"就不挂；有别的就挂最近拿到的体面的', () => {
    expect(pickBadge({ mahjong: career({ titles: [{ id: 'xz_pao_king', at: 3 }] }) }, nameOf)).toBeNull();
    const games = {
      mahjong: career({ titles: [{ id: 'xz_pao_king', at: 9 }, { id: 'xz_zimo_king', at: 2 }] }),
      texas: career({ titles: [{ id: 'money_boy', at: 8 }, { id: 'bluff_king', at: 5 }] }),
    };
    expect(pickBadge(games, nameOf)).toBe('诈唬王');
  });

  it('自嘲的按 id 认（各游戏核对过的名单），新游戏按字眼兜底；名字读不到的不挂', () => {
    for (const [g, id, name] of [['guandan', 'scapegoat', '背锅侠'], ['kaipan', 'leek_old', '老韭菜'], ['texas', 'call_station', '跟注站'], ['newgame', 'x', '垫底王']] as const) {
      expect(isSelfMocking(g, id, name), name).toBe(true);
    }
    expect(isSelfMocking('guandan', 'first_king', '头游王')).toBe(false);
    expect(pickBadge({ kaipan: career({ titles: [{ id: 'unknown', at: 1 }] }) }, nameOf)).toBeNull();
  });
});

describe('小格挑亮眼的', () => {
  const card = {
    mahjong: career({ n: 3, rounds: 25, wins: 1, best: 12, titles: [{ id: 'xz_pao_king', at: 1 }] }),
    texas: career({ n: 4, rounds: 22, wins: 5, best: 30 }),
    guandan: career({ n: 1, rounds: 1, wins: 0 }),
  };

  it('那张卡：至少 5 局、胜率至少 10% 的才进（雀馆 4%、掼蛋 1 局都不进），不够三项补最大一把和称号数；补进小格了底下就不再写', () => {
    const { stats, line } = pickStats(card);
    expect(stats).toEqual([
      { label: '德州扑克胜率', value: '23% · 22局' },
      { label: '最大一把', value: '30' },
      { label: '称号', value: '1 个' },
    ]);
    expect(line).toBeUndefined();
  });

  it('只有一个能上的胜率：补最大一把和称号数', () => {
    expect(pickStats({ texas: card.texas, mahjong: career({ n: 1, rounds: 3, wins: 1, titles: [{ id: 'a', at: 1 }, { id: 'b', at: 2 }] }) }).stats).toEqual([
      { label: '德州扑克胜率', value: '23% · 22局' },
      { label: '最大一把', value: '30' },
      { label: '称号', value: '2 个' },
    ]);
  });

  it('三项都是胜率：底下一句写最大一把，放不下 LINE_MAX 个字就去掉游戏名，不会在词中间断', () => {
    const three = {
      texas: career({ rounds: 40, wins: 20, best: 18_400 }),
      guandan: career({ rounds: 10, wins: 6 }),
      mahjong: career({ rounds: 8, wins: 1 }),
    };
    const { stats, line } = pickStats(three);
    expect(stats.map((s) => s.label)).toEqual(['掼蛋胜率', '德州扑克胜率', '雀馆胜率']);
    expect(line).toBe('最大一把 18,400');
    expect(Array.from(line!).length).toBeLessThanOrEqual(LINE_MAX);
    expect(pickStats({ ...three, texas: career({ rounds: 40, wins: 20, best: 30 }) }).line).toBe('德州扑克最大一把 30');
  });
});
