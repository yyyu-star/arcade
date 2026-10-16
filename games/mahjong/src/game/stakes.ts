/**
 * 档位（docs/economy.md 第 2 节，各游戏同一张表）和麻将的底分（DESIGN.md 第 4 节）。
 * 娱乐不碰钱包，按小档的数显示"分"。底分 = 一份 ÷ BASE_DIV，用模拟器量出来（npm run sim，结果写 DESIGN.md 4.1）。
 */
export type TierId = 'small' | 'mid' | 'big' | 'lux';
export type StakesId = 'fun' | TierId;

export interface Stakes {
  id: StakesId;
  /** 一份 */
  share: number;
  /** 碰不碰钱包 */
  wallet: boolean;
}

export const BASE_DIV = 25;

export const STAKES: readonly Stakes[] = [
  { id: 'fun', share: 2_000, wallet: false },
  { id: 'small', share: 2_000, wallet: true },
  { id: 'mid', share: 10_000, wallet: true },
  { id: 'big', share: 50_000, wallet: true },
  { id: 'lux', share: 200_000, wallet: true },
];

export const stakesOf = (id: unknown): Stakes | null => STAKES.find((x) => x.id === id) ?? null;
export const baseOf = (share: number): number => Math.max(1, Math.floor(share / BASE_DIV));
