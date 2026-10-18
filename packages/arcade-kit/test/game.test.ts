/** 快照体积预算：snapshotBytes 取所有座位和"没入座"里最大的那份快照。游戏在自己的测试里用它断言上限。 */
import { describe, expect, it } from 'vitest';
import { matchConfigErrors, snapshotBytes, type RoomGame } from '../src/game.ts';
import { toyGame } from './worker.ts';

describe('snapshotBytes', () => {
  it('取最大的那份：手牌多的座位比没入座的人大；玩具游戏开局的快照在 1 KB 以内', () => {
    const s = toyGame.start(42, 1);
    const big = { ...s, hands: s.hands.map((h, i) => (i === 2 ? [...h, ...Array.from({ length: 200 }, () => 99)] : h)) };
    expect(snapshotBytes(toyGame, big)).toBeGreaterThan(snapshotBytes(toyGame, s) + 200 * 3 - 1);
    expect(snapshotBytes(toyGame, s)).toBeLessThan(1024);
  });
});

describe('matchConfigErrors（0.20.0）', () => {
  it('档位的 tableSize、roomOptions 对得上房间就是空数组；多于座位、少于 2、选项过不了都报出来', () => {
    expect(matchConfigErrors(toyGame, ['four', 'duo'], (t) => (t === 'duo' ? 2 : 4))).toEqual([]);
    expect(matchConfigErrors(toyGame, ['big'], () => 5)).toEqual(['big: tableSize 5 is more than the 4 seats this table plays']);
    expect(matchConfigErrors(toyGame, ['one'], () => 1)).toHaveLength(1);
    expect(matchConfigErrors(toyGame, ['x'], () => 2, () => ({ any: 1 }))).toEqual(['x: roomOptions given but the game has no options()']);
    const withOpts = { ...toyGame, options: (raw: unknown) => (raw === 'two' ? 'two' : null), seatCount: (o: unknown) => (o === 'two' ? 2 : 4) } as RoomGame<unknown, unknown, unknown, unknown>;
    expect(matchConfigErrors(withOpts, ['two'], () => 2, () => 'two')).toEqual([]);
    expect(matchConfigErrors(withOpts, ['two'], () => 3, () => 'two')).toEqual(['two: tableSize 3 is more than the 2 seats this table plays']);
    expect(matchConfigErrors(withOpts, ['bad'], () => 2, () => 'nope')).toEqual(['bad: roomOptions rejected by game.options()']);
    expect(matchConfigErrors(withOpts, ['none'], () => 2)).toEqual(['none: game.options() needs roomOptions for this tier']);
  });
});
