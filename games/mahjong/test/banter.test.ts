/** 名场面（game/banter.ts，DESIGN.md 第 6 节）：认得对；映射成 kit 的名场面时赢家、输家对。电脑怎么反应是 kit 的 botReact（kit 自己的测试） */
import { describe, expect, test } from 'vitest';
import { funIdCount } from 'arcade-kit/fun-logic';
import { funMoments, highlightsOf, momentsOf } from '../src/game/banter.ts';
import { EMOTES, PHRASE_COUNT } from '../src/game/emotes.ts';
import type { XzEvent } from '../src/core/variants/sichuan-xuezhan/rules.ts';
import { PHRASES } from '../src/view/text.ts';

describe('名场面', () => {
  const hu = (seat: number, from: number | null, ids: string[], fan = 2): XzEvent =>
    ({ e: 'hu', seat, from, tile: 0, fan, items: ids.map((id) => ({ id, fan: 1 })), rob: false }) as unknown as XzEvent;

  test('一炮多响、杠上开花、封顶', () => {
    expect(highlightsOf([hu(1, 0, ['ping']), hu(2, 0, ['ping'])], 3, 4).map((h) => [h.id, h.seat, h.round])).toEqual([['multi2', 0, 3]]);
    expect(highlightsOf([hu(1, 0, ['ping']), hu(2, 0, ['ping']), hu(3, 0, ['qing'])], 0, 4).map((h) => h.id)).toEqual(['multi3', 'qing']);
    expect(highlightsOf([hu(2, null, ['gangkai', 'qing'])], 0, 4).map((h) => h.id)).toEqual(['gangkai']);
    expect(highlightsOf([hu(2, 1, ['pengpeng'], 4)], 0, 4).map((h) => h.id)).toEqual(['capped']);
    expect(highlightsOf([hu(2, 1, ['ping'], 0)], 0, 4)).toEqual([]);
  });
});

describe('映射成 kit 的名场面（docs/table-fun.md 第 4 节：杠、杠上花、自摸、清一色）', () => {
  const hu = (seat: number, from: number | null, ids: string[], fan = 1): XzEvent =>
    ({ e: 'hu', seat, from, tile: 0, fan, items: ids.map((id) => ({ id, fan: 1 })), rob: false }) as unknown as XzEvent;
  const all = [true, true, true, true];

  test('杠：杠的人赢、还在打的其他人输；自摸同理；点炮的清一色只算点炮的人输', () => {
    const kan = { e: 'kan', seat: 2 } as unknown as XzEvent;
    expect(funMoments(momentsOf([kan]), all, 3)).toEqual([{ kind: 'moment', moment: 'kong', winners: [2], losers: [0, 1, 3], hand: 3 }]);
    expect(funMoments(momentsOf([hu(1, null, ['ping'])]), [true, true, false, true], 0)).toEqual([{ kind: 'moment', moment: 'self-draw', winners: [1], losers: [0, 3], hand: 0 }]);
    expect(funMoments(momentsOf([hu(3, 0, ['qing'], 2)]), all, 1)[0]).toMatchObject({ moment: 'flush', winners: [3], losers: [0] });
    expect(funMoments(momentsOf([hu(3, null, ['gangkai', 'qing'], 3)]), all, 1)[0]!.moment).toBe('gang-flower');
  });

  test('别人点炮的普通小胡不是名场面（不然一局吵好几回）', () => {
    expect(funMoments(momentsOf([hu(1, 0, ['ping'])]), all, 0)).toEqual([]);
  });

  test('编号和 kit 对得上：14 句短语 + 12 表情 + 8 道具', () => {
    expect(PHRASES.length).toBe(PHRASE_COUNT);
    expect(EMOTES).toBe(funIdCount(PHRASES.length));
  });
});
