/**
 * 好友房（DESIGN.md 6）：kit 的房间 + 德州的规则（src/room/rules.ts）。这里只做一件事：把规则记下的钱包的事交给平台钱包办（server 模式）。
 * 带入、结回经服务绑定调平台（浏览器的接口里没有这两条路），平台按操作 id 去重，房间重办不会多扣多给；
 * 每个座位同一时间只有一笔（规则保证），一份只结回一次（平台的规矩，见 rules.ts 文件头）。
 */
import { DEFAULT_LIMITS, GameRoom, type RoomLimits } from 'arcade-kit/room';
import { stream, type Entropy } from 'arcade-kit/rng';
import { isStandalone } from 'arcade-kit/worker';
import { RNG } from '../src/core/table.ts';
import { botEmoteIds, botReact, hitEvent, newBotState, type BotAction, type FunEvent } from 'arcade-kit/fun-logic';
import { momentOf, temperOf } from '../src/fun/moments.ts';
import { TAUNTS } from '../src/fun/taunts.ts';
import { texasGame, type TexasState } from '../src/room/game.ts';
import { AI_DELAY_MS, roomOp, TURN_MS, type RoomAction, type RoomOpts, type RoomView, type WalletEffect } from '../src/room/rules.ts';
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

export class TexasRoom extends GameRoom<TexasState, RoomAction, RoomView, Env, RoomOpts, WalletEffect> {
  protected readonly game = texasGame;
  protected override readonly limits = ROOM_LIMITS;

  /**
   * 电脑的互动（0.6.1 起房间替电脑座位发，kit 的 botEmote，所有人看到的一样；0.13.0 起怎么反应交给 kit 的 botReact，docs/table-fun.md 第 4 节）。不写存储。
   * - 一手打完（onStep）：只看公开的结果（操作记录、摊牌亮出来的牌）认名场面，每个电脑问一次；
   * - 真人对电脑扔道具、点名（onEmote）：被点的电脑问一次。真人发的东西只在这一刻用来决定回不回，不记下来，
   *   电脑的出牌决定（规则、src/ai）拿不到。
   * 随机按种子分流（名场面按手数、回应按序号）；反应的账、座位上是谁只在这个房间实例的内存里（座位是上一步公开的），被驱逐后从头记
   */
  private readonly bots = newBotState();
  private hand = -1;
  private seed: Entropy | null = null;
  private seats: { owner: string; persona: number }[] = [];
  private replies = 0;
  /** 报到第几场了（搭子战绩）：只在内存里，被驱逐后醒来把最近切的那几场再报一次，平台按 op 去重、不多记 */
  private matches = -1;

  protected override onStep(s: TexasState): void {
    // 锦标赛（0.24.0）：电脑的名场面互动和搭子战绩都不做（没有现金桌的账）
    if ('tour' in s) return;
    // 搭子战绩（0.17.0，平台 15.19；DESIGN.md 6.10）：规则在有人离桌、散桌时切出的场，按座位报（电脑座位 kit 跳过），不 await、不重试
    // 娱乐房间不报（报给平台走的是钱包的绑定，娱乐房间一概不碰）
    if (!s.fun && s.mates && s.mates.n > this.matches) {
      for (const m of s.mates.last) this.reportMatch(m.players, m.match);
      this.matches = s.mates.n;
    }
    this.seed = s.t.seed;
    this.seats = s.t.seats.map((x) => ({ owner: x.owner, persona: x.persona }));
    const r = s.t.lastHand;
    // 刚建、刚从存储里醒来：记下现在打到第几手，不补发以前的
    if (this.hand < 0) return void (this.hand = r?.handNo ?? 0);
    if (!r || r.handNo <= this.hand) return;
    this.hand = r.handNo;
    // 一手打完牌桌停着（holdHands），操作记录还是这一手的
    const m = momentOf(r, s.t.log);
    if (!m) return;
    const rng = stream(s.t.seed, RNG.banter, r.handNo);
    const ev: FunEvent = { kind: 'moment', moment: m.moment, winners: [m.winner], losers: m.losers, hand: r.handNo };
    for (const [seat, x] of this.seats.entries()) if (x.owner === 'house') this.botDo(botReact(ev, { seat, temper: temperOf(x.persona) }, this.bots, Date.now(), () => rng.u32() / 4_294_967_296));
  }

  protected override onEmote(from: number, id: number, to?: number): void {
    const ev = hitEvent(id, TAUNTS.length, from, to);
    const who = ev ? this.seats[ev.to] : undefined;
    if (!ev || !this.seed || who?.owner !== 'house') return;
    const rng = stream(this.seed, RNG.reply, this.replies++);
    this.botDo(botReact(ev, { seat: ev.to, temper: temperOf(who.persona) }, this.bots, Date.now(), () => rng.u32() / 4_294_967_296));
  }

  /** 房间只有一个闹钟：反应的 delay 不等，立刻发；页面收到电脑座位发来的会晚一点再播（kit 的 TableFun） */
  private botDo(a: BotAction | null): void {
    if (a) for (const e of botEmoteIds(a, TAUNTS.length)) this.botEmote(a.from, e.id, e.to);
  }

  protected override async perform(e: WalletEffect, userId: string | null): Promise<unknown> {
    // 电脑座位没有钱包；规则只给真人座位记钱包的事，到这里是写错了
    if (!userId) return { ok: false, error: 'no_user' };
    // 娱乐房间（0.21.0）：筹码不算数，和单独部署一样直接当办成，一次都不调平台（test/worker/room.test.ts 数着）
    if (e.fun) return { ok: true };
    // 单独部署没有钱包：好友房的筹码白送、不记账（游客模式，DESIGN.md 10.1）。本站丢了绑定不能这样，一律拒绝
    if (!this.env.WALLET) return isStandalone(this.env) ? { ok: true } : { ok: false, error: 'unavailable' };
    const base = { userId, game: GAME, ref: e.ref, mode: 'server' as const, op: roomOp(e) };
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
