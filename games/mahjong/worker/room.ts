/**
 * 好友房（DESIGN.md 第 6 节）：kit 的房间 + 麻将的房间规则（src/room/rules.ts）。这里做两件事：把规则记下的钱包的事交给平台钱包办（server 模式），
 * 每一步之后让电脑按公开的事发个表情、真人冲电脑发了东西让它回一句（src/room/talk.ts，不碰牌局、不写存储）。
 * 带入、结回经服务绑定调平台，平台按操作 id 去重，房间重办不会多扣多给；每个座位同一时间只有一笔、一份只结回一次（规则保证）。
 */
import { DEFAULT_LIMITS, GameRoom, type RoomLimits } from 'arcade-kit/room';
import { AI_DELAY_MS, mahjongRoom, type RoomAction, type RoomOpts, type RoomState, type RoomView, type WalletEffect } from '../src/room/rules.ts';
import { RoomTalk, talkSeed } from '../src/room/talk.ts';
import { GAME } from './game.ts';
import type { Env } from './main.ts';

/**
 * 限额：一场 8 局约 40 分钟，16 局加上等人能到两个小时，寿命给 4 小时；
 * 一局里每个人摸打、碰杠、声明窗口的回答都算入站，一场 16 局约 2,000 次，给到 4,000
 */
export const ROOM_LIMITS: RoomLimits = { ...DEFAULT_LIMITS, aiDelayMs: AI_DELAY_MS, maxAiBatch: 60, maxLifeMs: 4 * 3_600_000, maxInbound: 4_000 };
/** 钱包里"桌上那一份"的到期退回：晚于房间最长能活多久再多 1 小时，正常的房间一定先结算（平台最长 24 小时） */
const HOLD_MS = ROOM_LIMITS.maxLifeMs + ROOM_LIMITS.closingMs + 3_600_000;
/** 平台暂时办不了：结回要重办（抛错，房间按退避再来，同一个操作 id） */
const RETRY = new Set(['busy', 'internal']);

export class MahjongRoom extends GameRoom<RoomState, RoomAction, RoomView, Env, RoomOpts, WalletEffect> {
  protected readonly game = mahjongRoom;
  protected override readonly limits = ROOM_LIMITS;
  /** 电脑的互动只在内存里（被驱逐了重新记） */
  private talk: RoomTalk | null = null;

  protected override onStep(s: RoomState): void {
    this.talk ??= new RoomTalk(talkSeed(s.ref));
    for (const a of this.talk.step(s, Date.now())) this.botEmote(a.seat, a.id, a.to);
  }

  /** 真人冲电脑发了东西：被冲着的电脑按性格回一句（kit 只给座位和编号；不记下来，电脑出牌读不到） */
  protected override onEmote(from: number, id: number, to?: number): void {
    const a = this.talk?.reply(from, id, to, Date.now());
    if (a) this.botEmote(a.seat, a.id, a.to);
  }

  protected override async perform(e: WalletEffect, userId: string | null): Promise<unknown> {
    // 电脑座位没有钱包；规则只给真人座位记钱包的事，到这里是写错了
    if (!userId || e.stakes === 'fun') return { ok: false, error: 'no_user' };
    // 单独部署没有钱包（开房时已经挡住实盘，这里兜底：按带入被拒处理，不去重试）
    if (!this.env.WALLET) return { ok: false, error: 'no_wallet' };
    const wallet = this.env.WALLET;
    const base = { userId, game: GAME, ref: e.ref, mode: 'server' as const, op: `${e.ref}-${e.id}` };
    const r =
      e.kind === 'debit'
        ? await wallet.buyin({ ...base, tier: e.stakes, amount: e.amount, until: Date.now() + HOLD_MS })
        : await wallet.settle({ ...base, amount: e.amount, ...(e.stats ? { stats: e.stats } : {}) });
    if (r.ok) {
      if (r.statsIgnored) console.error('mahjong room: stats ignored', r.statsIgnored);
      return { ok: true };
    }
    // 平台暂时办不了（busy、internal）：带入、结回都重办（同一个操作 id，平台去重）；
    // 结回时那一份已经没了（到期退回过 expired，或者没有 no_stake）也算办完
    if (RETRY.has(r.error)) throw new Error(`wallet ${r.error}`);
    if (e.kind === 'credit' && r.error !== 'expired') console.error('mahjong room: settle refused', e.ref, r.error);
    // 带入被拒告诉他本人；钱不够时带上余额，规则按它少带一点再扣一次
    const balance = (r.wallet as { balance?: unknown } | undefined)?.balance;
    return { ok: false, error: r.error, ...(typeof balance === 'number' ? { balance } : {}) };
  }
}
