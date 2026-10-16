/**
 * 好友房（DESIGN.md 6）：kit 的房间 + 德州的规则（src/room/rules.ts）。这里只做一件事：把规则记下的钱包的事交给平台钱包办（server 模式）。
 * 带入、结回经服务绑定调平台（浏览器的接口里没有这两条路），平台按操作 id 去重，房间重办不会多扣多给；
 * 每个座位同一时间只有一笔（规则保证），一份只结回一次（平台的规矩，见 rules.ts 文件头）。
 */
import { DEFAULT_LIMITS, GameRoom, type RoomLimits } from 'arcade-kit/room';
import { AI_DELAY_MS, texasRoom, TURN_MS, type RoomAction, type RoomOpts, type RoomState, type RoomView, type WalletEffect } from '../src/room/rules.ts';
import type { Env } from './main.ts';
import { GAME } from './platform.ts';

/**
 * 6.1 的限额：德州一手里说话的次数比掼蛋多，入站给到 4,000；寿命 6 小时。
 * 电脑每出一手页面停 1.6 秒（0.1.1：试玩时嫌快，"看都看不清"）：这是房间给每一帧的播放时间，页面播完动画再补足剩下的
 */
export const ROOM_LIMITS: RoomLimits = { ...DEFAULT_LIMITS, turnMs: TURN_MS, aiDelayMs: AI_DELAY_MS, maxAiBatch: 30, maxLifeMs: 6 * 3_600_000, maxInbound: 4_000 };
/** 钱包里"桌上那一份"的到期退回：晚于房间最长能活多久（寿命 + 关房时办事的时间）再多 1 小时，正常的房间一定先结算（平台最长 24 小时） */
const HOLD_MS = ROOM_LIMITS.maxLifeMs + ROOM_LIMITS.closingMs + 3_600_000;
/** 平台暂时办不了：结回要重办（抛错，房间按退避再来，同一个操作 id） */
const RETRY = new Set(['busy', 'internal']);

export class TexasRoom extends GameRoom<RoomState, RoomAction, RoomView, Env, RoomOpts, WalletEffect> {
  protected readonly game = texasRoom;
  protected override readonly limits = ROOM_LIMITS;

  protected override async perform(e: WalletEffect, userId: string | null): Promise<unknown> {
    // 电脑座位没有钱包；规则只给真人座位记钱包的事，到这里是写错了
    if (!userId) return { ok: false, error: 'no_user' };
    const base = { userId, game: GAME, ref: e.ref, mode: 'server' as const, op: `${e.ref}-${e.id}` };
    const r =
      e.kind === 'debit'
        ? await this.env.WALLET.buyin({ ...base, tier: e.stakes, amount: e.amount, until: Date.now() + HOLD_MS })
        : await this.env.WALLET.settle({ ...base, amount: e.amount, ...(e.stats ? { stats: e.stats } : {}) });
    if (r.ok) return { ok: true };
    // 带入被拒（钱不够、忙……）告诉他本人，不重办；结回一定要办成，平台忙就重办。
    // 结回时那一份已经没了（到期退回过 expired，或者没有 no_stake）也算办完：钱已经回到他的钱包了，或者本来就没扣到
    if (e.kind === 'credit' && RETRY.has(r.error)) throw new Error(`wallet ${r.error}`);
    if (e.kind === 'credit' && r.error !== 'expired') console.error('texas room: settle refused', e.ref, r.error);
    return { ok: false, error: r.error };
  }
}
