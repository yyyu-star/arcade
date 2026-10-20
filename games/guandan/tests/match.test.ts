/**
 * 快速匹配的档位（0.26.0）：用 kit 的 matchConfigErrors 核对排队的配置和好友房的规则对得上——
 * 一桌的人数不超过座位数、每个档位的开桌选项房间的 options 都认（配错了线上就是排到了开不了桌）。
 */
import { matchConfigErrors } from 'arcade-kit/game';
import { describe, expect, it } from 'vitest';
import { MATCH_FUN, MATCH_TABLE, MATCH_TIERS, matchRoomOptions, matchTierOf, stakeOfTier } from '../src/variants/guandan/net/match.ts';
import { guandanRoom } from '../src/variants/guandan/net/rules.ts';
import { TIER_IDS } from '../src/variants/guandan/stake/index.ts';

describe('快速匹配的档位', () => {
  it('每个档位开桌的人数和选项都合房间的规则', () => {
    expect(matchConfigErrors(guandanRoom, MATCH_TIERS, () => MATCH_TABLE, matchRoomOptions)).toEqual([]);
  });

  it('配错了查得出来（阳性对照）', () => {
    expect(matchConfigErrors(guandanRoom, MATCH_TIERS, () => 5, matchRoomOptions).length).toBeGreaterThan(0);
    expect(matchConfigErrors(guandanRoom, ['real-nope'], () => 4, () => ({ stake: 'nope' })).length).toBeGreaterThan(0);
  });

  it('娱乐一个档、实盘每档一个，来回换得回来', () => {
    expect(MATCH_TIERS).toEqual([MATCH_FUN, ...TIER_IDS.map((t) => `real-${t}`)]);
    expect(stakeOfTier(matchTierOf(null))).toBeNull();
    for (const t of TIER_IDS) expect(stakeOfTier(matchTierOf(t))).toBe(t);
    expect(stakeOfTier('real-')).toBeUndefined();
    expect(stakeOfTier('real-nope')).toBeUndefined();
    expect(matchRoomOptions(MATCH_FUN)).toBeUndefined();
  });
});
