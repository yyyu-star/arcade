/**
 * 快速匹配的档位（0.21.0，kit 0.20.0）：用 kit 的 matchConfigErrors 核对排队的配置和好友房的规则对得上——
 * 一桌的真人不超过座位数、每个档位的开桌选项房间的 options 都认（配错了线上就是排到了开不了桌，人人转单机）。
 */
import { matchConfigErrors } from 'arcade-kit/game';
import { describe, expect, it } from 'vitest';
import { MATCH_FUN, MATCH_TABLE, MATCH_TIERS, matchRoomOptions, matchTierOf, stakesOfTier } from '../src/game/match.ts';
import { STAKES } from '../src/game/stakes.ts';
import { mahjongRoom } from '../src/room/rules.ts';

describe('快速匹配的档位', () => {
  it('每个档位开桌的人数和选项都合房间的规则', () => {
    expect(matchConfigErrors(mahjongRoom, MATCH_TIERS, () => MATCH_TABLE, matchRoomOptions)).toEqual([]);
  });

  it('配错了查得出来（阳性对照）', () => {
    expect(matchConfigErrors(mahjongRoom, MATCH_TIERS, () => MATCH_TABLE + 1, matchRoomOptions).length).toBeGreaterThan(0);
    expect(matchConfigErrors(mahjongRoom, ['real-nope'], () => MATCH_TABLE, () => ({ variant: 'sichuan-xuezhan', stakes: 'nope' })).length).toBeGreaterThan(0);
  });

  it('娱乐一个档、实盘每档一个，来回换得回来；认不得的不开桌', () => {
    const real = STAKES.filter((s) => s.wallet).map((s) => s.id);
    expect(MATCH_TIERS).toEqual([MATCH_FUN, ...real.map((t) => `real-${t}`)]);
    for (const s of ['fun', ...real] as const) expect(stakesOfTier(matchTierOf(s))).toBe(s);
    for (const bad of ['real-', 'real-nope', 'real-fun', 'Fun', '']) {
      expect(stakesOfTier(bad)).toBeNull();
      expect(matchRoomOptions(bad)).toBeUndefined();
    }
    expect(matchRoomOptions('real-small')?.stakes).toBe('small');
  });
});
