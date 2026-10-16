/**
 * 场地 → 电脑（0.7.0，docs/ai.md）：每种场地每个座位坐什么强弱、什么性格，都从这里取，页面、房间、模拟器不各写一份。
 *
 * - 单机娱乐：设置里的"电脑难度"选场地（新手 / 普通 / 高手，第一次玩默认新手）；
 * - 单机实盘：档位越高越难（docs/stake.md 1.3 的表，数字按 tools/ai-sim.ts 量）；
 * - 好友房娱乐：电脑普通；
 * - 好友房实盘：至少两个真人，电脑一律最强（docs/stake.md 3.1）：真人之间可以互通配合，最强更稳；模拟（tools/ai-sim.ts 的 room）只作佐证。
 * 性格按座位：单机 1、2、3 号是老张、小美、阿强；房间按真实座位（SEAT_PERSONA），每个人屏幕上的名字和打法对得上。
 */
import type { TierId } from '../stake/index.ts';
import { SEAT_PERSONA, type Difficulty, type PersonaId } from './persona.ts';

/** 单机娱乐的难度（0.12.1 起统一成三档，仓库 docs/balance.md 第 3 节）：新手、普通、高手 */
export type SoloLevel = 'novice' | 'normal' | 'pro';
export const SOLO_LEVELS: readonly SoloLevel[] = ['novice', 'normal', 'pro'];

/** 0.12.0 以前存下的四档 → 现在的三档（设置、存档里的旧值） */
export function soloLevelOf(v: unknown): SoloLevel | null {
  if (v === 'novice' || v === 'normal' || v === 'pro') return v;
  if (v === 'easy') return 'novice';
  if (v === 'good') return 'normal';
  if (v === 'hard') return 'pro';
  return null;
}

export type Venue =
  | { kind: 'solo'; level: SoloLevel }
  | { kind: 'soloStake'; tier: TierId }
  | { kind: 'room' }
  | { kind: 'roomStake'; tier: TierId };

/** 单机的电脑：我是 0 号，搭档 2 号，对手 1、3 号（opp3 给了就是 3 号另一个强弱，两个对手不一样强） */
export interface SoloBots {
  mate: Difficulty;
  opp: Difficulty;
  opp3?: Difficulty;
}

/**
 * 单机娱乐三档（docs/ai.md 第 2 节，按 docs/balance.md 第 3 节量）：新手档照顾"小白"（对手手软、搭档较强，小白也赢六成以上），
 * 普通档四个座位一样强，高手档全是最强
 */
export const SOLO_FUN_BOTS: Readonly<Record<SoloLevel, SoloBots>> = {
  novice: { mate: 'good', opp: 'novice' },
  normal: { mate: 'normal', opp: 'normal' },
  pro: { mate: 'hard', opp: 'hard' },
};

/**
 * 单机实盘每档（docs/stake.md 1.3）：越往上越难。小档按"小白"小赚调，中档往上按"普通"调（docs/balance.md 第 2 节和掼蛋的例外）；
 * 大档两个对手一普通一较强，补中档和豪华档之间的断档
 */
export const SOLO_BOTS: Readonly<Record<TierId, SoloBots>> = {
  small: { mate: 'easy', opp: 'novice' },
  mid: { mate: 'good', opp: 'normal' },
  big: { mate: 'good', opp: 'normal', opp3: 'good' },
  lux: { mate: 'hard', opp: 'hard' },
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
      return { difficulty: soloSeat(SOLO_FUN_BOTS[venue.level], seat), persona };
    case 'soloStake':
      return { difficulty: soloSeat(SOLO_BOTS[venue.tier], seat), persona };
    case 'room':
      return { difficulty: ROOM_FUN_BOT, persona };
    case 'roomStake':
      return { difficulty: ROOM_STAKE_BOT, persona };
  }
}

function soloSeat(b: SoloBots, seat: number): Difficulty {
  return seat === 2 ? b.mate : seat === 3 ? (b.opp3 ?? b.opp) : b.opp;
}
