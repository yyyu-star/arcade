/**
 * 结算页的分享卡（src/view/share.ts，docs/social.md 1.1）：数字和自己这一场的结果对得上；只放自己的、公开的东西，别人的手牌、牌墙进不去。
 */
import { describe, expect, test } from 'vitest';
import { sichuanXuezhan as XZ, view, type XzState } from '../src/core/variants/sichuan-xuezhan/index.ts';
import type { SeatKind } from '../src/core/variants/types.ts';
import { runAuto } from '../src/game/driver.ts';
import { cardOf } from '../src/view/share.ts';
import { signed, TITLE_NAME } from '../src/view/text.ts';

const ALL_AI: SeatKind[] = ['ai', 'ai', 'ai', 'ai'];
const SETUP = { share: 2_000, base: 40, personas: [0, 1, 2, 4] };

/** 四个电脑打完一整场 */
function playMatch(key: number[]): XzState {
  let s = XZ.begin(key, XZ.defaults, ALL_AI, SETUP) as XzState;
  for (let guard = 0; guard < 100 && !XZ.over(s); guard++) {
    for (const step of runAuto(XZ, s, ALL_AI, 2_000)) s = step.state as XzState;
    if (!XZ.over(s)) s = XZ.resume(s);
  }
  return s;
}

describe('分享卡', () => {
  const s = playMatch([2, 7, 1, 8, 2, 8, 1, 8]);
  expect(s.phase).toBe('over');

  test('大数字是自己的净输赢，三条小数据是胡几局、最大几番、杠几个；称号写在名字旁边', () => {
    for (const seat of [0, 1, 2, 3]) {
      const v = view(s, seat);
      const r = v.result!.seats[seat]!;
      const c = cardOf(v, { title: '娱乐·新手 · 8 局', unit: '分', name: '小明', fame: [] })!;
      expect(c.big).toEqual({ value: signed(r.net), label: '分' });
      expect(c.stats).toEqual([
        { label: '胡牌', value: `${v.seats[seat]!.stats.wins} 局` },
        { label: '最大', value: `${r.stats.max?.['xz_fan'] ?? 0} 番` },
        { label: '杠', value: `${v.seats[seat]!.stats.gangs} 个` },
      ]);
      const t = r.stats.titles?.[0];
      expect(c.player).toEqual({ name: '小明', ...(t ? { badge: TITLE_NAME[t] } : {}) });
    }
  });

  test('名场面只挑自己胡的（一炮多响是点炮的不算）；没有就说称号', () => {
    const v = view(s, 0);
    const c = cardOf(v, { title: 't', unit: '分', name: 'a', fame: [{ id: 'qing', seat: 0, round: 2 }, { id: 'tianhu', seat: 1, round: 3 }] })!;
    expect(c.line).toBe('第 3 局 清一色');
    const d = cardOf(v, { title: 't', unit: '分', name: 'a', fame: [{ id: 'tianhu', seat: 1, round: 3 }] })!;
    expect(d.line).not.toContain('天胡');
    // 一炮双响记在点炮的人头上：不拿来晒
    const e = cardOf(v, { title: 't', unit: '分', name: 'a', fame: [{ id: 'multi2', seat: 0, round: 4 }] })!;
    expect(e.line ?? '').not.toContain('双响');
  });

  test('只有自己的、公开的：卡上没有任何一张牌；旁观（座位 null）、没打完的没有卡', () => {
    const c = cardOf(view(s, 0), { title: 't', unit: '分', name: 'a', fame: [] });
    expect(JSON.stringify(c)).not.toMatch(/hand|wall|tile/);
    expect(cardOf(view(s, null), { title: 't', unit: '分', name: 'a', fame: [] })).toBeNull();
    const fresh = XZ.begin([3, 1, 4, 1, 5, 9, 2, 6], XZ.defaults, ALL_AI, SETUP) as XzState;
    expect(cardOf(view(fresh, 0), { title: 't', unit: '分', name: 'a', fame: [] })).toBeNull();
  });
});
