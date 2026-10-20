/**
 * 斗地主实盘的规则（docs/stake.md 第 10 节）：每分多少、每副和一场的封顶、一场几副、结回额、钱包 ref 的拼法、单机每档的电脑。
 * 档位表、钱包 id 格式、op 的拼法是通用的，在 src/core/stake.ts。和 src/core 一样是纯函数：不碰 DOM、网络、时间、随机数
 * （ref 里的随机数由调用方给）。
 * 一场的截断（每副 s 封顶 24、任何一家累计到 ±40 就结束、最后那副截 s 仍然零和）由规则核心做（DdzOptions.dealCap / cap），
 * 这里只给实盘用的选项，不再算一遍；单机里我的分就是核心状态里 scores[0]。
 */
import { TIERS, type Paid, type RoomBook, type TierId } from '../../../core/stake.ts';
import type { DdzLevel } from '../ai/index.ts';
import type { DdzOptions, DdzResult } from '../core/index.ts';

export { SOLO_HOURS, TIERS, TIER_IDS, WALLET_ID, isTier, seatOp, setPaid, soloOp, type Paid, type RoomBook, type TierId } from '../../../core/stake.ts';

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
 * 普通玩家每场（份）：小档 +0.28（小白 +0.11）、中档 +0.19，大档 −0.08、豪华 −0.12（期望 + 2 倍标准误 ≤ 0）。数字见 10.3，以最近一次模拟为准
 */
export const DDZ_SOLO_BOTS: Readonly<Record<TierId, readonly [DdzLevel, DdzLevel]>> = {
  small: ['novice', 'novice'],
  mid: ['novice', 'normal'],
  big: ['normal', 'pro'],
  lux: ['pro', 'pro'],
};

// ───────────── 好友房：每个座位一本账（docs/stake.md 3.2、10.4；3 个座位） ─────────────

const ROOM_REF = /^ddz-[0-9a-f]{16}$/;

/** 好友房 ref：`ddz-<16 位十六进制>`（从这一场的密钥流取 64 位）。和掼蛋的 `gd-…`、斗地主单机的 `solo-ddz-…` 互相区分得开 */
export function roomRef(hex: string): string {
  const ref = `ddz-${hex}`;
  if (!ROOM_REF.test(ref)) throw new Error(`斗地主好友房 ref 要 16 位小写十六进制：${hex}`);
  return ref;
}

export const DDZ_ROOM_SEATS = 3;

export function newRoomBook(tier: TierId): RoomBook {
  return { tier, seats: Array.from({ length: DDZ_ROOM_SEATS }, () => ({ paid: 'no' as Paid, points: 0 })), deals: 0, house: 0 };
}

/** 一家的分封顶：一场任何一家到 ±40 核心就结束；这里再夹一道，是因为走了又回来的新一份从 0 记，不等于核心里的累计 */
const clampPoints = (p: number): number => Math.max(-POINTS_PER_SHARE, Math.min(POINTS_PER_SHARE, p));

/**
 * 记一副（用核心给的每家的分 delta，零和）：只记到到账的座位上，各自封顶；其余座位（电脑、还没到账、被拒、离开了）的分归庄家，
 * 封顶多出来的也归庄家。同一副只记一次。
 */
export function roomAddDeal(b: RoomBook, r: DdzResult, dealNo: number): RoomBook {
  if (dealNo !== b.deals + 1) return b;
  let house = b.house;
  const seats = b.seats.map((s, seat) => {
    const d = r.delta[seat] ?? 0;
    if (s.paid !== 'yes') {
      house += d;
      return s;
    }
    const points = clampPoints(s.points + d);
    house += s.points + d - points;
    return { ...s, points };
  });
  return { ...b, seats, deals: b.deals + 1, house };
}

/** 一场结束了没有：打满 6 副，或者牌局本身结束（任何一家到 ±40，核心就把牌局收了） */
export function roomOver(b: RoomBook, phase?: string): boolean {
  return b.deals >= ROOM_DEALS || phase === 'gameOver';
}

/** 好友房：房间寿命 8 小时 + 关房收尾 1 小时 + 余量（和掼蛋同一个数） */
export const ROOM_HOURS = 10;
