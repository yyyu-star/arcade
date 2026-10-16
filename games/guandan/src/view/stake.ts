/**
 * 单机实盘（docs/stake.md 第 2 节）的页面这一半：存档 guandan.stake、和掼蛋 Worker 的三个接口打交道、实盘的牌局会话。
 *
 * - 存档单独一个 key，不碰 guandan.save，也不进云同步（只在这台设备上）；记着 userId，换了账号不显示。
 * - 一场打完（或碰到封顶、或者"现在结算"）先把要结的数记进存档（settle），再去结回：刷新、关页面、钱包一时忙，下次打开接着结，
 *   同一个 op 重发钱包只算一次。
 * - 结回、放弃遇到钱包忙（busy、internal、连不上）在这里重试几次；还不行就留着存档，下次再结。
 */
import { decide } from '../ai/index.ts';
import { createGame, type Action, type GameEvent, type GameState } from '../core/index.ts';
import { STAKE_PATH } from '../net/version.ts';
import { TIERS, isSoloRef, isTier, soloAddDeal, soloBot, soloOver, soloPoints, type SoloMatch, type TierId } from '../stake/index.ts';
import { emptyTally, statsOf, tallyDeal, type Tally } from '../stake/stats.ts';
import { currentUserId } from './net.ts';
import { ME, Session } from './session.ts';
import { KEYS, rawStore } from './store.ts';

export const STAKE_KEY = KEYS.stake;

export interface StakeSave {
  v: 1;
  userId: string;
  ref: string;
  tier: TierId;
  share: number;
  /** 钱包里那一份的到期时间（Unix 毫秒）：过了钱包会原样退回 */
  until: number;
  match: SoloMatch;
  state: GameState;
  /** 要结回的数：一场结束或者选了"现在结算"时记下，结回成功后存档删掉 */
  settle: { points: number; deals: number } | null;
  /** 这一份攒的战绩，结回时报给平台（0.6.0，平台 0.10.0）；0.6.0 以前的存档没有，就不报 */
  tally?: Tally;
}

export function loadStake(): StakeSave | null {
  const s = rawStore.read<StakeSave>(STAKE_KEY);
  if (!s || s.v !== 1 || typeof s.userId !== 'string' || typeof s.ref !== 'string' || !isTier(s.tier) || !s.state || !s.match || !Array.isArray(s.match.deals)) return null;
  return s;
}

export function writeStake(s: StakeSave): void {
  rawStore.write(STAKE_KEY, s);
}

export function clearStake(ref?: string): void {
  // 只删指定的那一场：别的标签页可能已经开了新的一场
  if (ref && loadStake()?.ref !== ref) return;
  rawStore.remove(STAKE_KEY);
}

export function stakeExpired(s: StakeSave, now = Date.now()): boolean {
  return now >= s.until;
}

/** 标题页"接着打实盘"那一行：中档 · 第 3/8 副 · +3 分 */
export function stakeLeft(s: StakeSave): { dealsDone: number; points: number } {
  return { dealsDone: s.match.deals.length, points: soloPoints(s.match) };
}

// ───────────── 接口 ─────────────

export interface WalletView {
  balance: number;
  stakes: { game: string; ref: string; tier: string }[];
}

export type StakeReply =
  | { ok: true; wallet?: WalletView; credited?: number; capped?: number; dup?: boolean; ref?: string; tier?: TierId; share?: number; until?: number }
  | { ok: false; error: string; wallet?: WalletView };

/** 平台浏览器接口 GET /api/wallet（15.9）。连不上、没登录都回 null：选档页把实盘灰掉 */
export async function fetchWallet(fetcher: typeof fetch = fetch): Promise<WalletView | null> {
  try {
    const res = await fetcher('/api/wallet', { credentials: 'same-origin' });
    if (res.status !== 200) return null;
    const body = (await res.json()) as { wallet?: { balance?: unknown; stakes?: unknown } };
    const w = body.wallet;
    if (!w || typeof w.balance !== 'number' || !Array.isArray(w.stakes)) return null;
    return { balance: w.balance, stakes: w.stakes as WalletView['stakes'] };
  } catch {
    return null;
  }
}

/** 调掼蛋 Worker 的实盘接口。HTTP 出错、连不上都折成 { ok: false, error }：401 → login，其余 → unavailable */
export async function postStake(action: 'buyin' | 'settle' | 'refund', body: unknown, fetcher: typeof fetch = fetch): Promise<StakeReply> {
  try {
    const res = await fetcher(`${STAKE_PATH}/${action}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 401) return { ok: false, error: 'login' };
    if (res.status === 400) return { ok: false, error: 'bad_request' };
    if (res.status !== 200) return { ok: false, error: 'unavailable' };
    return (await res.json()) as StakeReply;
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}

/** 钱包暂时的毛病：busy（预算、并发）、internal（D1 一时出错）、没连上。结回、放弃遇到这些要重试（旧仓库 PR 75 审阅） */
export function transient(error: string): boolean {
  return error === 'busy' || error === 'internal' || error === 'unavailable';
}

/** 重试的间隔（毫秒）：第一次失败后等 1 秒、再失败等 3 秒，共试 3 次 */
const RETRY_MS = [1_000, 3_000];

async function withRetry(call: () => Promise<StakeReply>, sleep: (ms: number) => Promise<void>): Promise<StakeReply> {
  let r = await call();
  for (const ms of RETRY_MS) {
    if (r.ok || !transient(r.error)) return r;
    await sleep(ms);
    r = await call();
  }
  return r;
}

const realSleep = (ms: number): Promise<void> => new Promise((ok) => setTimeout(ok, ms));

export type SettleOutcome =
  | { kind: 'done'; points: number; credited: number; capped: number; balance: number | null }
  /** 已经结过（同一份只能结回一次，钱包回 no_stake）或者过期退回了（expired）：存档删掉 */
  | { kind: 'gone' }
  | { kind: 'expired' }
  /** 钱包一直忙：存档留着，下次接着结 */
  | { kind: 'later' }
  | { kind: 'failed'; error: string };

/** 结回这一场（存档里必须已经记了 settle）。成功、结过、过期都删存档 */
export async function settleStake(s: StakeSave, deps: { fetcher?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {}): Promise<SettleOutcome> {
  const st = s.settle;
  if (!st) return { kind: 'failed', error: 'not_over' };
  const body = { ref: s.ref, tier: s.tier, points: st.points, deals: st.deals, ...(s.tally ? { stats: statsOf(s.tally) } : {}) };
  const r = await withRetry(() => postStake('settle', body, deps.fetcher), deps.sleep ?? realSleep);
  if (r.ok) {
    clearStake(s.ref);
    return { kind: 'done', points: st.points, credited: r.credited ?? 0, capped: r.capped ?? 0, balance: r.wallet?.balance ?? null };
  }
  if (r.error === 'no_stake' || r.error === 'expired') {
    clearStake(s.ref);
    return r.error === 'expired' ? { kind: 'expired' } : { kind: 'gone' };
  }
  return transient(r.error) ? { kind: 'later' } : { kind: 'failed', error: r.error };
}

/** 一副没打完就不玩了：那一份原样退回。和结回一样，退过、过期都算办完 */
export async function refundStake(s: StakeSave, deps: { fetcher?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {}): Promise<SettleOutcome> {
  const r = await withRetry(() => postStake('refund', { ref: s.ref }, deps.fetcher), deps.sleep ?? realSleep);
  if (r.ok || r.error === 'no_stake' || r.error === 'expired') {
    clearStake(s.ref);
    return r.ok ? { kind: 'done', points: 0, credited: r.credited ?? 0, capped: 0, balance: r.wallet?.balance ?? null } : r.error === 'expired' ? { kind: 'expired' } : { kind: 'gone' };
  }
  return transient(r.error) ? { kind: 'later' } : { kind: 'failed', error: r.error };
}

/** 进场：认人、带入一份，成功就开一场。带入不重试：ref 由 Worker 生成，重发是另一份 */
export async function buyinStake(tier: TierId, fetcher: typeof fetch = fetch): Promise<{ ok: true; ses: StakeSession } | { ok: false; error: string; wallet?: WalletView }> {
  const userId = await currentUserId(fetcher);
  if (!userId) return { ok: false, error: 'login' };
  const r = await postStake('buyin', { tier }, fetcher);
  if (!r.ok) return r;
  if (typeof r.ref !== 'string' || typeof r.until !== 'number') return { ok: false, error: 'other' };
  return { ok: true, ses: StakeSession.start({ userId, ref: r.ref, tier, until: r.until }) };
}

/**
 * 钱包里掼蛋桌上那一份，但这台设备上没有它的存档（别的设备开的，或者带入的回话没收到）：单机的可以原样退回，
 * 不然要干等 24 小时到期。好友房的（gd-）不归这里管。
 */
export function strayStake(w: WalletView, local: StakeSave | null): { ref: string; solo: boolean } | null {
  const st = w.stakes.find((x) => x.game === 'guandan');
  if (!st || st.ref === local?.ref) return null;
  return { ref: st.ref, solo: isSoloRef(st.ref) };
}

/** 退回不在这台设备上的那一份单机实盘 */
export async function refundStray(ref: string, deps: { fetcher?: typeof fetch; sleep?: (ms: number) => Promise<void> } = {}): Promise<StakeReply> {
  return withRetry(() => postStake('refund', { ref }, deps.fetcher), deps.sleep ?? realSleep);
}

/** 实盘局的种子：浏览器里用 crypto 生成（2.1），不用 Math.random */
export function stakeSeed(): string {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return `s${[...b].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}

// ───────────── 实盘的牌局会话 ─────────────

/**
 * 单机实盘的一局：规则全用默认（实盘不让改规则），电脑按档位（1.3），每副记分，存进 guandan.stake；不计战绩、不写 guandan.save。
 * 一场结束（8 副、封顶、过 A）就记下要结的数，画面去结回。
 */
export class StakeSession extends Session {
  stake: StakeSave;

  constructor(save: StakeSave, events: GameEvent[] = []) {
    super(save.state, events, 'normal');
    this.stake = save;
    this.scored = false;
  }

  /** 带入成功后开一场 */
  static start(info: { userId: string; ref: string; tier: TierId; until: number }, seed = stakeSeed()): StakeSession {
    const { state, events } = createGame(seed);
    const save: StakeSave = { v: 1, ...info, share: TIERS[info.tier], match: { tier: info.tier, deals: [] }, state, settle: null, tally: emptyTally() };
    const ses = new StakeSession(save, events);
    ses.save();
    return ses;
  }

  get tier(): TierId {
    return this.stake.tier;
  }

  get points(): number {
    return soloPoints(this.stake.match);
  }

  /** 这一场结束了（打满、封顶、过 A），或者选了"现在结算" */
  get over(): boolean {
    return this.stake.settle !== null;
  }

  override apply(action: Action): { events: GameEvent[]; error: string | null } {
    if (this.over) return { events: [], error: '这一场已经结束了' };
    const r = super.apply(action);
    if (r.error) return r;
    let m = this.stake.match;
    let tally = this.stake.tally;
    for (const e of r.events) {
      if (e.type !== 'dealEnd') continue;
      const before = m;
      m = soloAddDeal(m, e.result);
      // 同一副只记一次（和 soloAddDeal 一样）；这一副的出牌记录一副结束时还在状态里
      if (m !== before && tally) tally = tallyDeal(tally, e.result, this.state.history, ME, this.tier);
    }
    this.stake = { ...this.stake, match: m, ...(tally ? { tally } : {}) };
    if (soloOver(m, this.state.phase)) this.finish();
    else this.save();
    return r;
  }

  /** 记下要结的数（一场结束，或者打了几副后选"现在结算"） */
  finish(): void {
    const m = this.stake.match;
    this.stake = { ...this.stake, settle: { points: soloPoints(m), deals: m.deals.length } };
    this.save();
  }

  override botAction(seat: number): Action | null {
    return decide(this.view(seat), { seed: `${this.state.seed}|bot`, difficulty: seat === ME ? 'hard' : soloBot(this.tier, seat) });
  }

  override save(): void {
    // 构造时父类还没设 stake
    if (!this.stake) return;
    this.stake = { ...this.stake, state: this.state };
    writeStake(this.stake);
  }
}
