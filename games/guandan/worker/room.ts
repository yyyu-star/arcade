/// <reference types="@cloudflare/workers-types" />
/**
 * 掼蛋的联机房间（Durable Object）：规则来自 src/net/rules.ts，房间本身的规矩（入座、轮流、超时代出、掉线托管、写入上限）全在 arcade-kit。
 * 这里只定三件事：用哪套规则、页面最低版本（改了房间和页面之间的约定就加 CLIENT_VERSION，旧页面会被 4005 请去刷新）、
 * 实盘房间去钱包办事（perform，docs/stake.md 第 3 节）。
 */
import { DEFAULT_LIMITS, GameRoom, type RoomLimits } from 'arcade-kit/room';
import { botEmoteIds, botReact, hitEvent, newBotState, type BotAction, type FunBot, type FunEvent } from 'arcade-kit/fun-logic';
import { PHRASES, dealMoment, momentOf, victimOf } from '../src/variants/guandan/net/fun-moments.ts';
import { funBots } from '../src/variants/guandan/net/rules.ts';
import type { StakeEffect } from '../src/variants/guandan/net/stake.ts';
import { ddzFunBots, ddzMoments } from '../src/variants/doudizhu/net/rules.ts';
import { hallRoom, isDdz, type HallAction, type HallOpts, type HallState, type HallView } from '../src/net/hall.ts';
import { CLIENT_VERSION } from '../src/net/version.ts';
import { matchEnd } from '../src/variants/guandan/net/together.ts';
import { ROOM_HOURS } from '../src/variants/guandan/stake/index.ts';
import type { Env } from './gate.ts';

/** 钱包暂时的毛病：抛出去，kit 按退避重试（15 秒起，最多 10 分钟一次），op 不变 */
const TRANSIENT = new Set(['busy', 'internal']);

export class Room extends GameRoom<HallState, HallAction, HallView, Env, HallOpts, StakeEffect> {
  // 掼蛋和斗地主共用一个房间类：开房选项 variant: 'ddz' 开斗地主，其余是掼蛋（src/net/hall.ts）
  protected readonly game = hallRoom;
  /**
   * 电脑的互动（0.12.0 起用 kit 的 botReact，和单机同一份规则）：冷却记录、电脑的性格只放在内存里，不写存储（房间重启了从头记，无所谓）。
   * bots 每一步按公开的牌局刷新一次，onEmote 拿它回嘴（kit 故意不给 onEmote 牌局状态）；这里绝不记任何真人短语。
   * 随机用 Math.random、时间用 Date.now：只决定画面上说什么，不碰牌局，不需要复现。房间只有一个闹钟，反应立刻发，页面晚一点播
   */
  private readonly fun = newBotState();
  private bots: FunBot[] = [];

  private react(ev: FunEvent, bots: readonly FunBot[]): void {
    const now = Date.now();
    for (const b of bots) {
      const a: BotAction | null = botReact(ev, b, this.fun, now, Math.random);
      if (a) for (const e of botEmoteIds(a, PHRASES.length)) this.botEmote(a.from, e.id, e.to);
    }
  }

  /** 每一步广播完：看这一步的公开事件（谁炸了谁、谁头游、双下），电脑按性格起哄 */
  protected override onStep(s: HallState): void {
    // 斗地主：基础反应（炸弹、王炸、春天），没有搭子战绩（没有固定队伍）
    if (isDdz(s)) {
      this.bots = ddzFunBots(s);
      if (this.bots.length) for (const m of ddzMoments(s)) this.react(m, this.bots);
      return;
    }
    // 搭子战绩（0.16.0）：一场打完的那一步报一次同桌真人（kit 按座位绑的人认，电脑座位不报；交给 waitUntil，不卡这一步）。
    // 一个房间只打一场（再来一场是换新房间），场次写 1
    const end = matchEnd(s);
    if (end) this.reportMatch(end, 1);
    this.bots = funBots(s);
    if (this.bots.length === 0) return;
    for (const e of s.ev) {
      const m = e.type === 'dealEnd' ? dealMoment(e.result) : momentOf(e, e.type === 'play' ? victimOf(s.g.history) : -1, s.g.dealNo);
      if (m) this.react(m, this.bots);
    }
  }

  /** 真人冲电脑扔东西、点名：被冲的电脑按性格回应（表情加一句，有时扔回去） */
  protected override onEmote(from: number, id: number, to?: number): void {
    const ev = hitEvent(id, PHRASES.length, from, to);
    const b = ev && this.bots.find((x) => x.seat === ev.to);
    if (ev && b) this.react(ev, [b]);
  }

  /**
   * 掼蛋一整局很长（打 A 不过会退回打 2）：tools/room-sim.ts 3000 局里 4 真人桌入站中位约 950 条，两次实测最多 3493、6052 条，
   * 步数最多 6655（按每手 3 秒约 5.5 小时）。底座默认的 3000 条、3 小时会把千分之几的长局中途关掉，这里放到 8000 条、8 小时；
   * 一个人最多用其中四成（maxInboundShare 默认 0.4 = 3200 条，实测单人最多约 1500）。代价是一个房间一生的写入上限跟着变大，
   * 理论最坏约 2.2～2.3 万行（复审核算）：入站 8000 × 2 = 1.6 万，超时代出最多 8 小时 / 30 秒 × 2 ≈ 1920，电脑靠闹钟接着出的续批约 4400。
   * 电脑一次最多连出 3 手（默认 64）：按免费版每次调用 CPU 10 毫秒设计（Durable Object 和 Worker 用同一个每次调用的上限），
   * 实测每手 p99 3.2 毫秒，3 手约 9.6 毫秒。真人出完后三个电脑一口气最多要出 112 手，剩下的靠闹钟接着出，客户端的播放节奏不变。
   */
  protected override readonly limits: RoomLimits = {
    ...DEFAULT_LIMITS,
    maxInbound: 8000,
    maxLifeMs: 8 * 3_600_000,
    maxAiBatch: 3,
    // 电脑每手的播放间隔：页面按出法给 0.5～2 秒思考时间（0.5.1，打牌看得清），房间按平均 1.3 秒排，真人的出牌时限才不被播放吃掉
    aiDelayMs: 1300,
    minClientVersion: CLIENT_VERSION,
  };

  /**
   * 实盘的带入、结回（平台钱包，服务绑定 WALLET，mode: server）。回 { ok: true } 或 { ok: false, error }（钱包的业务拒绝），交给规则的 settled；
   * 钱包忙（busy、internal）、RPC 抛异常就抛出去，kit 按退避重试，同一个 op 钱包只算一次。
   */
  protected override async perform(e: StakeEffect, userId: string | null): Promise<unknown> {
    const w = this.env.WALLET;
    // 没绑人的座位不会有带入；万一有，或者没有钱包（单独部署开房时已经挡住实盘，这里兜底）：当作被拒，这个座位不计输赢
    if (!userId || !w) return { ok: false, error: userId ? 'no_wallet' : 'no_user' };
    if (e.kind === 'in') {
      // 带入重发前先看钱包（旧仓库 PR 75 审阅）：钱包每人只记最近 32 个 op，隔得太久的重发拿不到 dup，同一 ref、同一档会被当成补码再扣一次。
      // 第一次办也看一眼（多 1 次 RPC、0 行写入），省得自己记"是不是重发"——房间被驱逐后内存里的记录就没了
      const v = await w.view(userId);
      if (v.ok && v.wallet.stakes.some((s) => s.game === 'guandan' && s.ref === e.ref)) return { ok: true };
      const r = await w.buyin({ userId, game: 'guandan', ref: e.ref, tier: e.tier, amount: e.amount, until: Date.now() + ROOM_HOURS * 3_600_000, mode: 'server', op: e.id });
      if (!r.ok && TRANSIENT.has(r.error)) throw new Error(`wallet buyin ${r.error}`);
      if (!r.ok) console.warn(`实盘带入被拒 ${e.id}：${r.error}`);
      return r.ok ? { ok: true } : { ok: false, error: r.error };
    }
    const r = await w.settle({ userId, game: 'guandan', ref: e.ref, amount: e.amount, mode: 'server', op: e.id, ...(e.stats ? { stats: e.stats } : {}) });
    if (!r.ok && TRANSIENT.has(r.error)) throw new Error(`wallet settle ${r.error}`);
    // 小结被平台忽略（太大、形状不对）是我们的代码写错了；钱照常结
    if (r.ok && r.statsIgnored) console.error(`实盘战绩小结被忽略 ${e.id}：${r.statsIgnored}`);
    // no_stake（结过了）、expired（拖过了到期时间，钱包已经原样退回）都算办完；别的拒绝重试也没用，记日志
    if (!r.ok && r.error !== 'no_stake' && r.error !== 'expired') console.error(`实盘结回被拒 ${e.id}：${r.error}`);
    return r.ok ? { ok: true, credited: r.credited ?? 0 } : { ok: false, error: r.error };
  }
}
