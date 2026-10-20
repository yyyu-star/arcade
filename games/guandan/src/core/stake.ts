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
