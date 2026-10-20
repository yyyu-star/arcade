/**
 * 好友动态的娱乐名场面（src/game/feed.ts、public/moments.json，docs/platform-backend.md 15.17 第 2 条）：
 * 只报自己胡的、一把取最响的一个，一场最多 2 条、同一个只报一次；模板的格式合平台的要求。
 */
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { FEED_PER_MATCH, feedMomentsOf, toReport, type FeedMomentId } from '../src/game/feed.ts';
import type { FanId, XzEvent } from '../src/core/variants/sichuan-xuezhan/index.ts';

const hu = (seat: number, fan: number, ...ids: FanId[]): XzEvent =>
  ({ e: 'hu', seat, from: null, tile: 0, fan, items: ids.map((id) => ({ id, fan: 1 })), rob: false }) as unknown as XzEvent;

describe('名场面判定', () => {
  test('只认自己胡的；一把只取最响的那个，数是这一把的番', () => {
    const ev = [hu(1, 4, 'qing'), hu(0, 5, 'qing', 'gangkai'), hu(0, 2, 'ping')];
    expect(feedMomentsOf(ev, 0)).toEqual([{ moment: 'qing', n: 5 }]);
    expect(feedMomentsOf(ev, 1)).toEqual([{ moment: 'qing', n: 4 }]);
    expect(feedMomentsOf(ev, 2)).toEqual([]);
  });

  test('先后：天胡地胡 > 龙七对 > 清一色 > 杠上开花 > 海底捞月 > 七对', () => {
    const top = (...ids: FanId[]) => feedMomentsOf([hu(0, 6, ...ids)], 0)[0]?.moment;
    expect(top('dihu', 'longqidui')).toBe('tiandi');
    expect(top('tianhu')).toBe('tiandi');
    expect(top('qing', 'longqidui')).toBe('longqidui');
    expect(top('gangkai', 'qing')).toBe('qing');
    expect(top('haidi', 'gangkai')).toBe('gangkai');
    expect(top('qidui', 'haidi')).toBe('haidi');
    expect(top('qidui')).toBe('qidui');
    expect(top('pengpeng', 'jingou')).toBeUndefined();
  });

  test('一场最多 2 条，同一个名场面只报第一次', () => {
    const f = (moment: FeedMomentId, n = 3) => ({ moment, n });
    expect(toReport([f('qing'), f('qing', 6), f('gangkai'), f('haidi')], [])).toEqual([f('qing'), f('gangkai')]);
    expect(toReport([f('qing'), f('haidi')], ['qing'])).toEqual([f('haidi')]);
    expect(toReport([f('haidi')], ['qing', 'qidui'])).toEqual([]);
    expect(FEED_PER_MATCH).toBe(2);
  });
});

test('moments.json：编号、长度、占位符合平台的要求，判定会报的每个编号都有模板', () => {
  const json = JSON.parse(readFileSync(new URL('../public/moments.json', import.meta.url), 'utf8')) as Record<string, { text: string }>;
  const ids: FeedMomentId[] = ['tiandi', 'longqidui', 'qing', 'gangkai', 'haidi', 'qidui', 'rc_yakuman', 'rc_sanbaiman', 'rc_rinshan', 'rc_chankan', 'rc_haitei', 'rc_houtei', 'rc_ippatsu'];
  expect(Object.keys(json).sort()).toEqual([...ids].sort());
  for (const [id, { text }] of Object.entries(json)) {
    expect(id, id).toMatch(/^[a-z][a-z0-9_]{0,23}$/);
    expect([...text].length, id).toBeLessThanOrEqual(40);
    expect(text.replace(/\{(name|n|n2|n3)\}/g, ''), id).not.toMatch(/[{}]/);
    // 判定只给一个数（番）
    expect(text, id).toContain('{n}');
    expect(text, id).not.toMatch(/\{n[23]\}/);
  }
});
