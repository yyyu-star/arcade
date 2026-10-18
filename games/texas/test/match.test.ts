/**
 * 快速匹配的档位（src/room/match.ts，DESIGN.md 6.11）：排队给的一桌人数和开局选项，房间都得认，对不上的话线上每桌都会转单机。
 */
import { matchConfigErrors } from 'arcade-kit/game';
import { describe, expect, it } from 'vitest';
import { STAKES } from '../src/core/stakes.ts';
import { MATCH_TABLE, MATCH_TIERS, matchRoomOptions, matchTierOf, stakeOfTier } from '../src/room/match.ts';
import { texasRoom } from '../src/room/rules.ts';

describe('快速匹配的档位', () => {
  it('排队给的一桌人数和开局选项，房间都认（kit 的 matchConfigErrors 为空）', () => {
    expect(matchConfigErrors(texasRoom, MATCH_TIERS, () => MATCH_TABLE, matchRoomOptions)).toEqual([]);
  });

  it('阳性对照：一桌人数比座位多、不认得的档位都查得出来', () => {
    expect(matchConfigErrors(texasRoom, MATCH_TIERS, () => 10, matchRoomOptions).length).toBeGreaterThan(0);
    expect(matchConfigErrors(texasRoom, ['real-gold'], () => MATCH_TABLE, () => ({ stakes: 'gold', size: MATCH_TABLE })).length).toBeGreaterThan(0);
  });

  it('只开实盘四档；档位和盲注档来回换得回来，不认得的没有', () => {
    expect(MATCH_TIERS).toEqual(STAKES.map((s) => `real-${s.id}`));
    for (const s of STAKES) {
      expect(stakeOfTier(matchTierOf(s.id))).toBe(s.id);
      expect(matchRoomOptions(matchTierOf(s.id))).toEqual({ stakes: s.id, size: MATCH_TABLE });
    }
    for (const bad of ['fun', 'real-', 'real-gold', 'small']) {
      expect(stakeOfTier(bad)).toBeUndefined();
      expect(matchRoomOptions(bad)).toBeUndefined();
    }
  });
});
