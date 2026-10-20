/**
 * 结束颁奖（0.14.0）：房间攒的公开记录（src/net/rules.ts 的 log）、视角旋转、评奖（src/net/awards.ts）、分享卡里的奖（src/view/share-card.ts）
 */
import { describe, expect, it } from 'vitest';
import { testKey, guandanRoom as R, type NetState } from '../src/variants/guandan/net/rules.ts';
import { rotateNetView } from '../src/variants/guandan/net/rotate.ts';
import { AWARD_NAME, matchAwards, winnerOf } from '../src/variants/guandan/net/awards.ts';
import { emptyMatchLog, logDeal, type MatchLog } from '../src/variants/guandan/stake/titles.ts';
import { shareCardOf } from '../src/view/share-card.ts';

/** 电脑把一整局打完，顺手按 dealEnd 事件自己再记一份，和房间的记录对照 */
function playOut(seed: number): { s: NetState; mine: MatchLog } {
  let s = R.begin(testKey(seed), R.rulesVersion);
  let mine = emptyMatchLog();
  for (let i = 0; !R.over(s); i++) {
    if (i > 20000) throw new Error('卡死');
    const seat = R.turn(s)!;
    const n = R.apply(s, seat, R.ai(s, seat));
    if ('error' in n) throw new Error(n.error);
    for (const e of n.ev) if (e.type === 'dealEnd') mine = logDeal(mine, e.result, n.g.history);
    s = n;
  }
  return { s, mine };
}

const log = (over: Partial<MatchLog>): MatchLog => ({ ...emptyMatchLog(), deals: 4, ...over });

describe('房间的这一场记录', () => {
  it('每副打完记一笔，和按事件算的一致，数加得起来', () => {
    const { s, mine } = playOut(21);
    const m = s.log!;
    expect(m).toEqual(mine);
    expect(m.deals).toBeGreaterThan(0);
    expect(m.firsts.reduce((a, b) => a + b)).toBe(m.deals);
    expect(m.lasts.reduce((a, b) => a + b)).toBe(m.deals);
    expect(m.wins[0]! + m.wins[1]!).toBe(m.deals);
    expect(m.places!.reduce((a, b) => a + b)).toBe(6 * m.deals);
  }, 30_000);

  it('谁都看得到（旁观也是），转视角时按座位和按队的都跟着转', () => {
    const { s } = playOut(22);
    const m = s.log!;
    expect(R.view(s, null).log).toEqual(m);
    for (const me of [0, 1, 2, 3]) {
      const v = rotateNetView(R.view(s, me), me);
      for (let real = 0; real < 4; real++) {
        const shown = (real - me + 4) % 4;
        expect(v.log!.firsts[shown]).toBe(m.firsts[real]);
        expect(v.log!.bombs[shown]).toBe(m.bombs[real]);
        expect(v.log!.places![shown]).toBe(m.places![real]);
      }
      // 坐奇数位时两队对调
      expect(v.log!.wins).toEqual(me % 2 ? [m.wins[1], m.wins[0]] : m.wins);
    }
  }, 30_000);

  it('以前开的房间（状态里没有 log）照旧能打，视图里没有', () => {
    const { log: _l, ...old } = R.begin(testKey(23), R.rulesVersion);
    const seat = R.turn(old)!;
    const n = R.apply(old, seat, R.ai(old, seat));
    expect('error' in n).toBe(false);
    expect((n as NetState).log).toBeUndefined();
    expect(R.view(old, 0).log).toBeUndefined();
  });
});

describe('评奖', () => {
  it('MVP、最惨的人、炸弹王各一个', () => {
    const a = matchAwards(log({ places: [10, 6, 5, 3], firsts: [3, 1, 0, 0], lasts: [0, 1, 1, 2], bombs: [1, 0, 3, 1] }), 0);
    expect(a.map((x) => [x.id, x.seat])).toEqual([
      ['mvp', 0],
      ['unlucky', 3],
      ['bomb_king', 2],
    ]);
    expect(a[0]!.line).toBe('头游 3 次、炸了 1 次，头号功臣');
    expect(a[1]!.line).toBe('末游 2 次，下场翻身');
    expect(a[2]!.line).toBe('一共炸了 3 次');
  });

  it('炸弹不到 2 个或者并列最多：没有炸弹王', () => {
    expect(matchAwards(log({ places: [10, 6, 5, 3], lasts: [0, 1, 1, 2], bombs: [1, 0, 1, 0] }), 0).map((x) => x.id)).toEqual(['mvp', 'unlucky']);
    expect(matchAwards(log({ places: [10, 6, 5, 3], lasts: [0, 1, 1, 2], bombs: [2, 0, 2, 0] }), 0).map((x) => x.id)).toEqual(['mvp', 'unlucky']);
  });

  it('MVP 并列先给赢的那队；最惨的人不会是 MVP', () => {
    const m = log({ places: [6, 6, 6, 6], firsts: [1, 1, 1, 1], lasts: [1, 1, 1, 1], bombs: [0, 0, 0, 0] });
    const a = matchAwards(m, 1);
    expect(a[0]).toMatchObject({ id: 'mvp', seat: 1 });
    expect(a[1]!.seat).not.toBe(1);
    // 没有赢家时按座位
    expect(matchAwards(m, -1)[0]!.seat).toBe(0);
  });

  it('炸弹王可以和 MVP 是同一个人；一副没打完不颁奖', () => {
    const a = matchAwards(log({ places: [10, 6, 5, 3], firsts: [3, 1, 0, 0], lasts: [0, 1, 1, 2], bombs: [4, 0, 1, 0] }), 0);
    expect(a.filter((x) => x.seat === 0).map((x) => x.id)).toEqual(['mvp', 'bomb_king']);
    expect(matchAwards(emptyMatchLog(), 0)).toEqual([]);
  });

  it('没人过 A 时按赢的副数定赢家，打平没有', () => {
    expect(winnerOf(log({ wins: [3, 1] }), -1)).toBe(0);
    expect(winnerOf(log({ wins: [1, 3] }), -1)).toBe(1);
    expect(winnerOf(log({ wins: [2, 2] }), -1)).toBe(-1);
    expect(winnerOf(log({ wins: [1, 3] }), 0)).toBe(0);
  });

  it('真打出来的一整局每次都有 MVP，奖都落在 0–3 号座位上', () => {
    for (const seed of [31, 32, 33]) {
      const { s } = playOut(seed);
      const a = matchAwards(s.log!, s.g.winner);
      expect(a[0]!.id).toBe('mvp');
      expect(a.length).toBeGreaterThanOrEqual(2);
      for (const x of a) expect([0, 1, 2, 3]).toContain(x.seat);
    }
    // 打三整局：机器忙的时候 5 秒的默认时限不够（主线报过负载 15 时超时）
  }, 60_000);
});

describe('分享卡里的奖', () => {
  const names = ['我', '老王', '小美', '阿强'];
  const m = log({ places: [10, 6, 5, 3], firsts: [3, 1, 0, 0], lasts: [0, 1, 1, 2], bombs: [1, 0, 3, 1] });
  const awards = matchAwards(m, 0);

  it('我拿了奖：那句话写我的奖，称号换成奖名', () => {
    const c = shareCardOf({ kind: 'game', win: true, room: '123456' }, m, [], '我', { awards, name: (i) => names[i]! });
    expect(c.line).toBe(`${AWARD_NAME.mvp}：头游 3 次、炸了 1 次，头号功臣`);
    expect(c.player).toEqual({ name: '我', badge: AWARD_NAME.mvp });
  });

  it('我没拿奖：写这一场颁给了谁', () => {
    const others = awards.filter((x) => x.seat !== 0);
    const c = shareCardOf({ kind: 'game', win: true, room: '123456' }, m, [], '我', { awards: others, name: (i) => names[i]! });
    expect(c.line).toBe('最惨的人 阿强 · 炸弹王 小美');
    expect(c.player).toEqual({ name: '我' });
  });
});
