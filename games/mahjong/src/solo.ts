/**
 * 单机（DESIGN.md 4、5 节）：在浏览器里对三个电脑打一场，不连房间、不占任何额度。
 * - 电脑一步一步出，每步停一下给画面播动画（声明窗口里电脑的回答不停）；
 * - 每一步存进 mahjong.solo，关了页面回来接着打；
 * - 实盘（client 模式）：开场经 Worker 从钱包带入，一场打完（或中途离开）带着小结结回；带入、结回的操作号都先存下来，
 *   断网、刷新后用同一个号重发，平台按号去重，不会多扣多给。
 * - 存档只有一份（mahjong.solo），每一场有自己的号（id）：已经停下的旧一场（晚到的结回）只改、只删自己那份，不碰新开的一场（自审 C1）。
 */
import { stream } from 'arcade-kit/rng';
import { AIS } from './ai/index.ts';
import { PERSONAS } from './ai/personas.ts';
import { seatPlan, venueOf } from './ai/venues.ts';
import type { SettleStats } from './core/match/index.ts';
import { sichuanXuezhan as XZ, view, type XzAction, type XzOpts, type XzState, type XzView } from './core/variants/sichuan-xuezhan/index.ts';
import type { SeatKind } from './core/variants/types.ts';
import { baseOf, stakesOf, type StakesId, type TierId } from './game/stakes.ts';
import { maybeApplied, randomId, soloBuyin, soloSettle, type WalletReply } from './net/wallet.ts';

export const SOLO_KEY = 'mahjong.solo';
const KINDS: SeatKind[] = ['human', 'ai', 'ai', 'ai'];
export const ME = 0;

export interface SoloSave {
  v: 1;
  /** 这一场的号（0.3.8 起；之前的存档没有，当作就是存着的那一场） */
  id?: string;
  state: XzState;
  stakes: StakesId;
  names: string[];
  /** 实盘：钱包里这一份的号；结回的操作号和小结（先存再发，重发用同一个） */
  ref: string | null;
  settle: { op: string; amount: number; stats: SettleStats } | null;
  /** 实盘带入还没确认：先存再发，没回话（断网、刷新）下次用同一个操作号重发 */
  buying?: { op: string; amount: number } | null;
  /** 已经结回（或者娱乐局打完） */
  done: boolean;
}

export interface SoloUi {
  /** 画一帧（每一步之后） */
  frame(v: XzView, names: string[]): void;
  /** 一局打完（停在结算）或一场打完 */
  roundEnd(v: XzView, names: string[]): void;
  /** 结回的结果（实盘） */
  settled(r: WalletReply): void;
}

export function loadSolo(): SoloSave | null {
  try {
    const raw = localStorage.getItem(SOLO_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as SoloSave;
    return s && s.v === 1 && s.state?.variant === XZ.id && s.state.v === XZ.rulesVersion ? s : null;
  } catch {
    return null;
  }
}

/** 实盘、还没结回钱包的存档：开新的一场前要先把它结了（自审 C1） */
export function unsettled(s: SoloSave | null): boolean {
  return !!s && !s.done && !!s.ref && !!stakesOf(s.stakes)?.wallet;
}

/**
 * 存档。own 是"这一场正在打"：正在打的那一场总能写；已经停下的（离开了、换成了新的一场）只在存着的还是自己时才改、才删，
 * 免得晚到的结回把新一场的存档删掉或者盖掉。
 */
function persist(s: SoloSave, own: boolean): void {
  try {
    const raw = localStorage.getItem(SOLO_KEY);
    const cur = raw ? (JSON.parse(raw) as SoloSave).id : undefined;
    const mine = cur === undefined || cur === s.id;
    if (!own && !mine) return;
    if (!s.done) localStorage.setItem(SOLO_KEY, JSON.stringify(s));
    else if (mine) localStorage.removeItem(SOLO_KEY);
  } catch {
    // 存不上（隐私模式、满了）：这一场照打，只是关了页面就接不上
  }
}

/** 开一场：密钥浏览器现生成；chips 是实盘带进来的（不够一份时可以少带） */
export function newSolo(stakes: StakesId, opts: XzOpts, myName: string, ref: string | null, chips: number): SoloSave {
  const st = stakesOf(stakes)!;
  const key = [...crypto.getRandomValues(new Uint32Array(8))];
  // 三个电脑按场地挑性格、各配这一场的状态；0 号座位是自己（性格、状态用不上）
  const plan = seatPlan(stream(key, 'persona'), venueOf('solo', stakes), 3);
  const personas = [0, ...plan.personas];
  const tunes = [{ mood: 0, soft: 0 }, ...plan.tunes];
  const state = XZ.begin(key, opts, KINDS, { share: st.share, base: baseOf(st.share), personas, tunes, chips: [chips, st.share, st.share, st.share] }) as XzState;
  return { v: 1, id: randomId(), state, stakes, names: [myName, ...personas.slice(1).map((p) => PERSONAS[p]!.name)], ref, settle: null, done: false };
}

/**
 * 电脑出手的快慢跟性格走（tempo：幺妹儿快、盖碗儿慢），每一手再有一点起伏，不拖、也不秒出。
 * 起伏由局面算（不用随机数，但这里只是画面节奏，不影响结果）
 */
function paceOf(s: XzState, seat: number): number {
  const tempo = PERSONAS[s.personas[seat]!]?.tempo ?? 1_000;
  const wobble = 850 + ((s.wall.head * 7 + seat * 13 + s.round * 31) % 300);
  return (tempo * wobble) / 1_000_000;
}

/** 电脑每一步之后停多久（毫秒，再乘性格的快慢和速度） */
function delayOf(prev: XzState, next: XzState): number {
  if (next.events.some((e) => e.e === 'hu')) return 1_300;
  if (next.events.some((e) => e.e === 'pon' || e.e === 'kan')) return 1_000;
  if (next.events.some((e) => e.e === 'discard')) return 700;
  if (prev.phase === 'claim' && next.phase === 'claim') return 0;
  return 250;
}

export class Solo {
  private s: SoloSave;
  private busy = false;
  private stopped = false;
  speed = 1;
  private readonly ui: SoloUi;

  constructor(save: SoloSave, ui: SoloUi) {
    this.s = save;
    this.ui = ui;
  }

  get save(): SoloSave {
    return this.s;
  }

  get view(): XzView {
    return view(this.s.state, ME);
  }

  get stakes(): StakesId {
    return this.s.stakes;
  }

  get names(): string[] {
    return this.s.names;
  }

  /** 存档（停下以后只碰自己那份） */
  private save$(): void {
    persist(this.s, !this.stopped);
  }

  /**
   * 实盘带入：先把"带入中"（ref、操作号）存下来再发（自审 C3）。成了就清掉；平台明确拒了（没扣）就丢掉这一场；
   * 没回话、平台暂时不行（可能扣了）就留着，下次用同一个操作号重发，平台按号去重，不会多扣
   */
  async buyin(): Promise<WalletReply> {
    const b = this.s.buying;
    if (!b || !this.s.ref) return { ok: true };
    this.save$();
    const r = await soloBuyin({ op: b.op, session: this.s.ref, stakes: this.s.stakes as TierId, amount: b.amount });
    if (r.ok) this.s.buying = null;
    else if (!maybeApplied(r.error)) this.s.done = true;
    this.save$();
    return r;
  }

  /** 画当前的局面，接着让电脑出（回来接着打时也从这里开始） */
  resume(): void {
    // 已经离开、结回没成的（存着结回的数）：不再接着打，只把结回再办一次（自审 C2）
    if (this.s.settle) {
      this.ui.frame(this.view, this.s.names);
      void this.finish();
      return;
    }
    this.save$();
    this.ui.frame(this.view, this.s.names);
    if (this.s.state.phase === 'end' || this.s.state.phase === 'over') this.ui.roundEnd(this.view, this.s.names);
    if (this.s.state.phase === 'over') void this.finish();
    else void this.runAi();
  }

  act(a: XzAction): string | null {
    if (this.busy || this.stopped) return 'busy';
    const next = XZ.apply(this.s.state, ME, a);
    if ('error' in next) return next.error;
    this.step(next);
    void this.runAi();
    return null;
  }

  /** 一局结算看完了：开下一局 */
  next(): void {
    if (this.s.state.phase !== 'end') return;
    this.step(XZ.resume(this.s.state));
    void this.runAi();
  }

  stop(): void {
    this.stopped = true;
  }

  private step(next: XzState): void {
    this.s.state = next;
    this.save$();
    this.ui.frame(this.view, this.s.names);
    if (next.phase === 'end' || next.phase === 'over') this.ui.roundEnd(this.view, this.s.names);
    if (next.phase === 'over') void this.finish();
  }

  private async runAi(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const ai = AIS[XZ.id]!;
      for (;;) {
        if (this.stopped) return;
        const s = this.s.state;
        const act = XZ.actors(s);
        if (!act) return;
        const seat = act.seats.find((i) => KINDS[i] === 'ai');
        if (seat === undefined) return;
        const next = XZ.apply(s, seat, XZ.auto(s, seat, ai));
        if ('error' in next) throw new Error(`ai move rejected: ${next.error}`);
        const wait = delayOf(s, next) * paceOf(s, seat) * this.speed;
        if (wait > 0) await sleep(wait);
        if (this.stopped) return;
        this.step(next);
      }
    } finally {
      this.busy = false;
    }
  }

  /**
   * 实盘结回（一场打完，或者中途离开）：先把操作号和小结存下来再发，失败了下次用同一个号重发。
   * 带入还没确认的也走这里：没扣成的平台回 no_stake，算结完。返回结回的回话（娱乐局是 null）
   */
  async finish(): Promise<WalletReply | null> {
    const st = stakesOf(this.s.stakes)!;
    if (!st.wallet || !this.s.ref) {
      if (this.s.state.phase === 'over') {
        this.s.done = true;
        this.save$();
      }
      return null;
    }
    if (!this.s.settle) {
      const r = XZ.result(this.s.state).seats[ME]!;
      this.s.settle = { op: randomId(), amount: Math.max(0, r.chips), stats: r.stats };
      this.save$();
    }
    const r = await soloSettle({ op: this.s.settle.op, session: this.s.ref, amount: this.s.settle.amount, stats: this.s.settle.stats });
    // 结过了、放太久已经退回：都算结完
    if (r.ok || r.error === 'no_stake' || r.error === 'expired') {
      this.s.done = true;
      this.save$();
    }
    this.ui.settled(r);
    return r;
  }

  /** 中途离开：马上结算（娱乐局直接丢掉） */
  async leave(): Promise<void> {
    this.stop();
    const st = stakesOf(this.s.stakes)!;
    if (!st.wallet) {
      this.s.done = true;
      this.save$();
      return;
    }
    await this.finish();
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));

export type { TierId };
