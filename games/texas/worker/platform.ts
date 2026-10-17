/**
 * 平台钱包的 RPC（docs/platform-backend.md 5.9）：服务绑定 WALLET → arcade 的 WalletService，绑定上写 props.game = "texas"。
 * 德州只在两处调它：单机的带入、结回（main.ts 的 api/solo/*，client 模式）和好友房的 TexasRoom.perform（server 模式）。
 * 业务上的拒绝走返回值 { ok: false, error }；抛错的是连不上（调用方当"可能到了"处理，用同一个操作 id 重办）。
 */
import type { SettleStats } from '../src/core/fame.ts';
import type { StakesId } from '../src/core/stakes.ts';
import type { Mode, WalletReply } from '../src/net/wallet.ts';

interface Base {
  userId: string;
  game: 'texas';
  /** 钱包里"桌上那一份"的号，8–64 位 [A-Za-z0-9_-] */
  ref: string;
  mode: Mode;
  /** 操作 id，8–64 位 [A-Za-z0-9_-]，平台按游戏去重 */
  op: string;
}

/** 德州用到的两个方法（看钱包页面直接走平台的 /api/wallet；refund 只给没打就走用，单机一坐下就发牌、好友房按筹码结，用不上） */
export interface PlatformWallet {
  /** 带入：新开一份只要余额够这次带入（平台 0.10.2）；同一 ref、同一档、同一 mode 才能加（补码）；until 最多 24 小时 */
  buyin(req: Base & { tier: StakesId; amount: number; until: number }): Promise<WalletReply>;
  /** 结回：清掉那一份，没有回 no_stake、到期退回过的回 expired；client 模式超过每日上限的在 capped 里 */
  settle(req: Base & { amount: number; stats?: SettleStats | unknown }): Promise<WalletReply & { statsIgnored?: string }>;
}

export const GAME = 'texas' as const;

/** ref、op 的格式（平台同样的检查，这里先挡掉，免得白调一次） */
export const WALLET_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * 单机带入、结回的 op（0.13.2，审计高危）：浏览器给的 id 原样交平台的话，能故意给成好友房的 op（`<ref>-b<n>`），借平台按 op 去重白拿那一笔。
 * 一律由 Worker 加 solo- 前缀，好友房的 op 以房间号 r 开头（src/room/rules.ts 的 roomOp），永远撞不上。
 * 旧页面存着的 op 不会带前缀；浏览器给的已经带前缀的不重复加（照样合格）。加上前缀超过 64 位的不收（回 null，按 bad_request）
 */
export function soloOp(op: string): string | null {
  const out = op.startsWith(SOLO_OP) ? op : `${SOLO_OP}${op}`;
  return WALLET_ID.test(out) ? out : null;
}
export const SOLO_OP = 'solo-';
