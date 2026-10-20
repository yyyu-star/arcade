/**
 * 实盘里玩法无关的部分（docs/stake.md 第 1、10 节）：档位表、钱包 id 的格式、单机带入的有效期、op 的拼法。
 * 钱包只认这四个档位，掼蛋和斗地主共用；每分多少、封顶几分、一场几副是各玩法自己的（variants/*\/stake）。
 * 和 src/core 其余文件一样是纯函数：不碰 DOM、网络、时间、随机数。
 */

/** 档位表（docs/economy.md 第 2 节，各游戏共用）：一份多少 */
export const TIERS = { small: 2_000, mid: 10_000, big: 50_000, lux: 200_000 } as const;
export type TierId = keyof typeof TIERS;
export const TIER_IDS: readonly TierId[] = ['small', 'mid', 'big', 'lux'];

export function isTier(x: unknown): x is TierId {
  return typeof x === 'string' && (TIER_IDS as readonly string[]).includes(x);
}

/** 单机放着不打的最长时间：钱包里那一份的到期时间（钱包最长也只给 24 小时） */
export const SOLO_HOURS = 24;

/** 钱包的 ref 和 op 的格式（平台 5.9：8–64 位的 [A-Za-z0-9_-]） */
export const WALLET_ID = /^[A-Za-z0-9_-]{8,64}$/;

/** 单机的 op：ref 定死，页面和 Worker 重发都是同一个 op，钱包只算一次 */
export function soloOp(ref: string, kind: 'in' | 'out' | 'refund'): string {
  return `${ref}-${kind}`;
}

// ───────────── 好友房：每个座位一本账（docs/stake.md 3.2；座位数各玩法自己定，掼蛋 4、斗地主 3） ─────────────

/**
 * no：电脑座位或还没带入；pending：带入在办；yes：到账了，分算他的；refused：带入被拒，这一场不计输赢；
 * left：中途点了"离开"，按当时的分结回了，之后的分归庄家
 */
export type Paid = 'no' | 'pending' | 'yes' | 'refused' | 'left';

export interface SeatBook {
  paid: Paid;
  /** 到账以后的净分（封顶） */
  points: number;
}

export interface RoomBook {
  tier: TierId;
  seats: SeatBook[];
  /** 记过的副数 */
  deals: number;
  /** 庄家：不归任何到账座位的分，只用来日志和统计 */
  house: number;
  /** 离开时已经结回、后来又带入了新的一份的那些份的分；庄家 + 这个 + 各座位的分恒为 0 */
  settled?: number;
}

export function setPaid(b: RoomBook, seat: number, paid: Paid): RoomBook {
  return { ...b, seats: b.seats.map((s, i) => (i === seat ? { ...s, paid } : s)) };
}

/** 好友房某个座位的带入 / 结回 op：`<ref>-s<座位>-in|out`，同一个 op 钱包只算一次 */
export function seatOp(ref: string, seat: number, kind: 'in' | 'out'): string {
  return `${ref}-s${seat}-${kind}`;
}
