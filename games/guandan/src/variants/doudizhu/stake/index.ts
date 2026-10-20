/**
 * 斗地主实盘的规则（docs/stake.md 第 10 节）：每分多少、每副和一场的封顶、一场几副、结回额、钱包 ref 的拼法、单机每档的电脑。
 * 档位表、钱包 id 格式、op 的拼法是通用的，在 src/core/stake.ts。和 src/core 一样是纯函数：不碰 DOM、网络、时间、随机数
 * （ref 里的随机数由调用方给）。
 * 一场的截断（每副 s 封顶 24、任何一家累计到 ±40 就结束、最后那副截 s 仍然零和）由规则核心做（DdzOptions.dealCap / cap），
 * 这里只给实盘用的选项，不再算一遍；单机里我的分就是核心状态里 scores[0]。
 */
import { TIERS, type TierId } from '../../../core/stake.ts';
import type { DdzLevel } from '../ai/index.ts';
import type { DdzOptions } from '../core/index.ts';

export { SOLO_HOURS, TIERS, TIER_IDS, WALLET_ID, isTier, soloOp, type TierId } from '../../../core/stake.ts';

/** 每分 = 一份的 1/40（各档都整除：50 / 250 / 1,250 / 5,000） */
export const POINTS_PER_SHARE = 40;
/** 每副的分 s 封顶：叫 3 分 × 8 倍 */
export const DEAL_CAP = 24;
/** 一场打几副：单机 8 副，好友房 6 副（斗地主一副比掼蛋短，好友房几个真人轮流想） */
export const SOLO_DEALS = 8;
export const ROOM_DEALS = 6;

/** 每分多少筹码 */
export function pointValue(tier: TierId): number {
  return TIERS[tier] / POINTS_PER_SHARE;
}

/** 实盘用的规则核心选项：一场任何一家累计到 ±一份就结束 */
export function stakeOptions(deals: number): DdzOptions {
  return { deals, dealCap: DEAL_CAP, cap: POINTS_PER_SHARE };
}
export const DDZ_SOLO_OPTS: DdzOptions = stakeOptions(SOLO_DEALS);
export const DDZ_ROOM_OPTS: DdzOptions = stakeOptions(ROOM_DEALS);

/**
 * 结回额：带进去的一份加上输赢。不再截断：核心已经保证一家的累计在 ±40 分内，Worker 另用 validSoloResult 查一遍，
 * 所以在 0 到 2 份之间
 */
export function payout(tier: TierId, points: number): number {
  return TIERS[tier] + points * pointValue(tier);
}

// ───────────── 钱包的 ref（平台 5.9：8–64 位的 [A-Za-z0-9_-]；op 的拼法在通用层） ─────────────

/**
 * 单机 ref：`solo-ddz-<档位>-<32 位十六进制>`。带 ddz 标记，和掼蛋的 `solo-<档位>-<hex>` 区分得开（互不匹配），
 * 结回时按 ref 里的档位算结回额，不信页面带来的档位。最长 15 + 32 = 47 位，拼上 `-refund` 不过 64 位
 */
const SOLO_REF = /^solo-ddz-(small|mid|big|lux)-[0-9a-f]{32}$/;

export function isSoloRef(x: unknown): x is string {
  return typeof x === 'string' && SOLO_REF.test(x);
}

/** hex 是 128 位随机数（32 位十六进制） */
export function soloRef(tier: TierId, hex: string): string {
  const ref = `solo-ddz-${tier}-${hex}`;
  if (!SOLO_REF.test(ref)) throw new Error(`斗地主单机 ref 要档位加 32 位小写十六进制：${tier} ${hex}`);
  return ref;
}

/** ref 里的档位；不是斗地主单机 ref 回 null */
export function soloRefTier(ref: string): TierId | null {
  const m = /^solo-ddz-(small|mid|big|lux)-/.exec(ref);
  return m && SOLO_REF.test(ref) ? (m[1] as TierId) : null;
}

// ───────────── 单机一场（我是 0 号，1、2 号是电脑，电脑不碰钱包） ─────────────

/** 我的分：就是我的累计（零和，另两家的和是它的相反数） */
export function soloPoints(scores: readonly number[]): number {
  return scores[0] ?? 0;
}

/** Worker 收到的结算是不是规则允许的数（防的是自己的代码写错，不防作弊：economy.md 定了不防） */
export function validSoloResult(points: unknown, deals: unknown): boolean {
  return (
    Number.isSafeInteger(points) &&
    Number.isSafeInteger(deals) &&
    Math.abs(points as number) <= POINTS_PER_SHARE &&
    (deals as number) >= 0 &&
    (deals as number) <= SOLO_DEALS &&
    // 每副我最多动 2s = 48 分（地主）
    Math.abs(points as number) <= 2 * DEAL_CAP * (deals as number)
  );
}

/**
 * 单机实盘每档的电脑（座位 1、2；docs/stake.md 10.3，数字由 tools/ddz-stake-sim.ts 量）：越往上越难。
 * 我不是地主时，坐我这边的电脑农民是我的队友，所以两个座位强弱不一定要一样。
 * 普通玩家每场（份）：小档 +0.18、中档 +0.11（都照顾小白和新手，小档小白持平），大档 −0.03、豪华 −0.12（期望 + 2 倍标准误 ≤ 0）
 */
export const DDZ_SOLO_BOTS: Readonly<Record<TierId, readonly [DdzLevel, DdzLevel]>> = {
  small: ['novice', 'novice'],
  mid: ['novice', 'normal'],
  big: ['novice', 'pro'],
  lux: ['pro', 'pro'],
};
