/**
 * 场地 → 电脑（0.7.0，docs/ai.md）：每种场地每个座位坐什么强弱、什么性格，都从这里取，页面、房间、模拟器不各写一份。
 *
 * - 单机娱乐：设置里的"电脑难度"选场地，默认"普通"是新手场（对手偏弱）；
 * - 单机实盘：档位越高越难（docs/stake.md 1.3 的表，数字按 tools/ai-sim.ts 量）；
 * - 好友房娱乐：电脑普通；
 * - 好友房实盘：至少两个真人，电脑一律最强（docs/stake.md 3.1）：真人之间可以互通配合，最强更稳；模拟（tools/ai-sim.ts 的 room）只作佐证。
 * 性格按座位：单机 1、2、3 号是老张、小美、阿强；房间按真实座位（SEAT_PERSONA），每个人屏幕上的名字和打法对得上。
 */
import type { TierId } from '../stake/index.ts';
import { SEAT_PERSONA, type Difficulty, type PersonaId } from './persona.ts';

/** 单机娱乐的难度设置（设置面板里的三档） */
export type SoloLevel = 'easy' | 'normal' | 'hard';
export const SOLO_LEVELS: readonly SoloLevel[] = ['easy', 'normal', 'hard'];

export type Venue =
  | { kind: 'solo'; level: SoloLevel }
  | { kind: 'soloStake'; tier: TierId }
  | { kind: 'room' }
  | { kind: 'roomStake'; tier: TierId };

/** 单机的电脑：我是 0 号，搭档 2 号，对手 1、3 号 */
export interface SoloBots {
  mate: Difficulty;
  opp: Difficulty;
}

/** 单机娱乐：简单是新手手软的对手，普通（默认）对手偏弱，困难全是最强 */
export const SOLO_FUN_BOTS: Readonly<Record<SoloLevel, SoloBots>> = {
  easy: { mate: 'normal', opp: 'novice' },
  normal: { mate: 'normal', opp: 'easy' },
  hard: { mate: 'hard', opp: 'hard' },
};

/** 单机实盘每档（docs/stake.md 1.3）：越往上越难；豪华档对手最强、搭档换成简单 */
export const SOLO_BOTS: Readonly<Record<TierId, SoloBots>> = {
  small: { mate: 'normal', opp: 'easy' },
  mid: { mate: 'normal', opp: 'good' },
  big: { mate: 'normal', opp: 'hard' },
  lux: { mate: 'easy', opp: 'hard' },
};

/** 好友房娱乐的电脑 */
export const ROOM_FUN_BOT: Difficulty = 'normal';

/** 好友房实盘的电脑（docs/stake.md 3.1）：一律最强，各档一样 */
export const ROOM_STAKE_BOT: Difficulty = 'hard';

export interface BotProfile {
  difficulty: Difficulty;
  persona: PersonaId;
}

/** 这个场地、这个真实座位上的电脑。单机的 0 号是我自己，不该来问 */
export function botFor(venue: Venue, seat: number): BotProfile {
  const persona = SEAT_PERSONA[seat]!;
  switch (venue.kind) {
    case 'solo':
      return { difficulty: seat === 2 ? SOLO_FUN_BOTS[venue.level].mate : SOLO_FUN_BOTS[venue.level].opp, persona };
    case 'soloStake':
      return { difficulty: seat === 2 ? SOLO_BOTS[venue.tier].mate : SOLO_BOTS[venue.tier].opp, persona };
    case 'room':
      return { difficulty: ROOM_FUN_BOT, persona };
    case 'roomStake':
      return { difficulty: ROOM_STAKE_BOT, persona };
  }
}
