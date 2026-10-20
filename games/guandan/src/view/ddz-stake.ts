/**
 * 斗地主单机实盘（docs/stake.md 第 10 节）的页面会话，不画界面：存档 guandan.ddz.stake（读写在 store.ts）、
 * 经掼蛋 Worker 的三个接口（请求体带 variant: 'ddz'）带入 / 结回 / 放弃、实盘的牌局会话。
 * 流程和掼蛋的 stake.ts 一样：一场打完先把要结的数记进存档再结回，钱包忙（busy、internal、连不上）用同一个 op 重试，
 * no_stake / expired 算办完；结回、重试、响应的处理直接用 stake.ts 里玩法无关的那一半（settleWith、refundWith）。
 * 我坐 0 号，1、2 号电脑不碰钱包；我的累计分就是结回额，不另记一份（核心状态里的 scores[0]）。
 * 不计战绩、不写 guandan.ddz.save（会话把 persist 关掉，存档由这里写）。
 */
import { createDdz, decideDdz, type DdzAction, type DdzEvent, type DdzLevel } from '../variants/doudizhu/index.ts';
import {
  DDZ_SOLO_BOTS, DDZ_SOLO_OPTS, ROOM_DEALS, SOLO_DEALS, TIERS, isSoloRef, pointValue, soloPoints, type TierId,
} from '../variants/doudizhu/stake/index.ts';
import type { TierFlow } from './ui/stake.ts';
import { DDZ_ME, DdzSession, ddzSeeds } from './ddz-session.ts';
import { currentUserId } from './net.ts';
import { clearDdzStake, loadDdzStake, writeDdzStake, type DdzStakeSaveData } from './store.ts';
import {
  postStake, refundWith, settleWith, stakeSeed, withRetry, realSleep,
  type Deps, type SettleOutcome, type StakeReply, type WalletView,
} from './stake.ts';

export type DdzStakeSave = DdzStakeSaveData;

const VARIANT = { variant: 'ddz' } as const;

export function loadDdzStakeSave(): DdzStakeSave | null {
  return loadDdzStake();
}

export function clearDdzStakeSave(ref?: string): void {
  // 只删指定的那一场：别的标签页可能已经开了新的一场
  if (ref && loadDdzStake()?.ref !== ref) return;
  clearDdzStake();
}

export function ddzStakeExpired(s: DdzStakeSave, now = Date.now()): boolean {
  return now >= s.until;
}

/** 标题页"接着打实盘"那一行：中档 · 打了 3 副 · +12 分 */
export function ddzStakeLeft(s: DdzStakeSave): { dealsDone: number; points: number } {
  return { dealsDone: s.state.results.length, points: soloPoints(s.state.scores) };
}

// ───────────── 接口 ─────────────

/** 结回这一场（存档里必须已经记了 settle）。成功、结过、过期都删存档 */
export async function settleDdzStake(s: DdzStakeSave, deps: Deps = {}): Promise<SettleOutcome> {
  const st = s.settle;
  if (!st) return { kind: 'failed', error: 'not_over' };
  return settleWith({ ...VARIANT, ref: s.ref, tier: s.tier, points: st.points, deals: st.deals }, st.points, () => clearDdzStakeSave(s.ref), deps);
}

/** 一副没打完就不玩了：那一份原样退回 */
export async function refundDdzStake(s: DdzStakeSave, deps: Deps = {}): Promise<SettleOutcome> {
  return refundWith({ ...VARIANT, ref: s.ref }, () => clearDdzStakeSave(s.ref), deps);
}

/** 进场：认人、带入一份，成功就开一场。带入不重试：ref 由 Worker 生成，重发是另一份 */
export async function buyinDdzStake(tier: TierId, fetcher: typeof fetch = fetch): Promise<{ ok: true; ses: DdzStakeSession } | { ok: false; error: string; wallet?: WalletView }> {
  const userId = await currentUserId(fetcher);
  if (!userId) return { ok: false, error: 'login' };
  const r = await postStake('buyin', { ...VARIANT, tier }, fetcher);
  if (!r.ok) return r;
  if (typeof r.ref !== 'string' || !isSoloRef(r.ref) || typeof r.until !== 'number') return { ok: false, error: 'other' };
  return { ok: true, ses: DdzStakeSession.start({ userId, ref: r.ref, tier, until: r.until }) };
}

/**
 * 钱包里牌馆桌上那一份，但这台设备上没有斗地主存档（别的设备开的，或者带入的回话没收到）：斗地主单机的可以原样退回，
 * 不然要干等 24 小时到期。掼蛋的 ref 归 stake.ts 管，这里只认斗地主的（solo-ddz-）
 */
export function strayDdzStake(w: WalletView, local: DdzStakeSave | null): { ref: string; solo: boolean } | null {
  // 钱包按游戏 id 记，掼蛋和斗地主都是 guandan：只认斗地主单机的 ref，掼蛋那几份不归这里管
  const st = w.stakes.find((x) => x.game === 'guandan' && isSoloRef(x.ref) && x.ref !== local?.ref);
  return st ? { ref: st.ref, solo: true } : null;
}

/** 退回不在这台设备上的那一份斗地主单机实盘 */
export async function refundDdzStray(ref: string, deps: Deps = {}): Promise<StakeReply> {
  return withRetry(() => postStake('refund', { ...VARIANT, ref }, deps.fetcher), deps.sleep ?? realSleep);
}

// ───────────── 实盘的牌局会话 ─────────────

/**
 * 单机实盘的一局：规则是实盘选项（8 副、每副 s 封顶 24、一家累计到 ±40 就结束，核心自己截），1、2 号电脑按档位（DDZ_SOLO_BOTS），
 * 每次推进都存档。一场结束（8 副、封顶）就记下要结的数，画面去结回。
 */
export class DdzStakeSession extends DdzSession {
  stake: DdzStakeSave;

  constructor(save: DdzStakeSave, events: DdzEvent[] = []) {
    super(save.state, events, 'normal');
    this.stake = save;
    // 战绩不记：基类 persist 为假时不写战绩；存档由下面的 save 写
    this.persist = false;
  }

  /** 带入成功后开一场 */
  static start(info: { userId: string; ref: string; tier: TierId; until: number }, seed = stakeSeed()): DdzStakeSession {
    const { state, events } = createDdz(seed, DDZ_SOLO_OPTS);
    const save: DdzStakeSave = { v: 1, ...info, share: TIERS[info.tier], state, settle: null };
    const ses = new DdzStakeSession(save, events);
    ses.save();
    return ses;
  }

  /** 读存档接着打（存档不是这个账号的、过期的由调用方先判断） */
  static fromSave(save: DdzStakeSave): DdzStakeSession {
    return new DdzStakeSession(save);
  }

  get tier(): TierId {
    return this.stake.tier;
  }

  /** 我的累计分 */
  get points(): number {
    return soloPoints(this.state.scores);
  }

  /** 已经打完的副数 */
  get dealsDone(): number {
    return this.state.results.length;
  }

  /** 这一场结束了（打满、封顶），或者选了"现在结算" */
  get over(): boolean {
    return this.stake.settle !== null;
  }

  override apply(a: DdzAction): { events: DdzEvent[]; error: string | null } {
    if (this.over) return { events: [], error: '这一场已经结束了' };
    const r = super.apply(a);
    if (!r.error && this.state.phase === 'gameOver') this.finish();
    return r;
  }

  /** 记下要结的数（一场结束，或者打了几副后选"现在结算"；没打完的那一副不计） */
  finish(): void {
    this.stake = { ...this.stake, settle: { points: this.points, deals: this.dealsDone } };
    this.save();
  }

  /** 电脑按档位：1、2 号各一档；我自己（调试代打）走基类 */
  override botAction(seat: number): DdzAction | null {
    if (seat === DDZ_ME) return super.botAction(seat);
    const level: DdzLevel = DDZ_SOLO_BOTS[this.tier][seat - 1]!;
    return decideDdz(this.view(seat), level, `${ddzSeeds(this.state.seed).ai}|${seat}|${this.state.step}`);
  }

  override save(): void {
    // 构造时基类还没设 stake
    if (!this.stake) return;
    this.stake = { ...this.stake, state: this.state };
    writeDdzStake(this.stake);
  }
}

/** 选档页里斗地主的那几样（ui/stake.ts 的 openTierPicker，和掼蛋同一个页面） */
export const DDZ_FLOW: TierFlow<DdzStakeSession> = {
  soloDeals: SOLO_DEALS,
  roomDeals: ROOM_DEALS,
  pointValue,
  buyin: (tier) => buyinDdzStake(tier),
  stray: (w) => strayDdzStake(w, loadDdzStakeSave()),
  refundStray: (ref) => refundDdzStray(ref),
};
