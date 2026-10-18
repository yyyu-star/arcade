/**
 * 快速匹配的档位（src/room/match.ts，DESIGN.md 6.11）：排队给的一桌人数和开局选项，房间都得认，对不上的话线上每桌都会转单机。
 */
import { matchConfigErrors } from 'arcade-kit/game';
import { describe, expect, it } from 'vitest';
import { FUN_STAKES, STAKES } from '../src/core/stakes.ts';
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

  it('娱乐一档加实盘四档；档位和盲注档来回换得回来，不认得的没有', () => {
    expect(MATCH_TIERS).toEqual(['fun', ...STAKES.map((s) => `real-${s.id}`)]);
    expect(matchTierOf('big', true)).toBe('fun');
    expect(matchRoomOptions('fun')).toEqual({ stakes: FUN_STAKES, size: MATCH_TABLE, fun: true });
    // 房间认娱乐的开局选项，档位一律换成 FUN_STAKES；fun 只认 true
    expect(texasRoom.options!({ stakes: 'lux', size: 6, fun: true })).toEqual({ stakes: FUN_STAKES, size: 6, fun: true });
    expect(texasRoom.options!({ stakes: 'small', size: 6, fun: 1 })).toBeNull();
    for (const s of STAKES) {
      expect(stakeOfTier(matchTierOf(s.id))).toBe(s.id);
      expect(matchRoomOptions(matchTierOf(s.id))).toEqual({ stakes: s.id, size: MATCH_TABLE });
    }
    for (const bad of ['fun-', 'real-', 'real-gold', 'small']) {
      expect(stakeOfTier(bad)).toBeUndefined();
      expect(matchRoomOptions(bad)).toBeUndefined();
    }
  });
});
