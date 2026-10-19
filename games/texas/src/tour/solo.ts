/**
 * 单机锦标赛的一场（0.23.0，DESIGN.md 14.2）：规则在 rules.ts，这里只管流程和钱包，写法照 src/solo.ts。
 * 报名 → 开打（我 + 5 个电脑，比赛筹码和钱包无关）→ 一手打完停几秒自动发下一手（没有"下一手"、不补码）→
 * 淘汰后选"看到结束"或"现在离开"（离开 = 剩下的电脑托管用 playOut 确定地跑完）→ 结束按名次结奖金。
 *
 * 钱包的操作先记进本机存档（pending）再发请求：请求半路断了、页面被关，下次打开用同一个操作 id 重发，钱包按 id 去重，
 * 不会多扣多给。实盘报名 = 这一档的一份（stakesOf(id).max），奖金 = payouts(报名费)[名次 - 1]，没进前三结回 0（也要结，清掉钱包里那一份）。
 * 娱乐不碰钱包。
 */
import type { Entropy } from 'arcade-kit/rng';
import { stakesOf, type StakesId } from '../core/stakes.ts';
import { apply, isFail, type Action, type Table } from '../core/table.ts';
import type { WalletApi } from '../net/wallet.ts';
import type { Step, Store } from '../solo.ts';
import { KEYS } from '../store.ts';
import { finishOrder, handOver, newTour, payouts, playOut, tourAi, tourStep, tourView, type TourState, type TourView } from './rules.ts';

/** 我永远坐 0 号位 */
export const ME = 0;
export const TOUR_KEY = KEYS.tour;

export type TourPending = { t: 'buyin'; op: string; amount: number } | { t: 'cashout'; op: string; amount: number };

export interface TourSession {
  v: 1;
  /** 场次 id（钱包里"桌上那一份"的 ref） */
  id: string;
  userId: string | null;
  /** 娱乐：不碰钱包 */
  practice: boolean;
  /** 实盘的档位（报名费 = 这一档的一份）；娱乐也记着，只用来取名字 */
  stakes: StakesId;
  /** 报名费；娱乐是 0 */
  buyIn: number;
  state: TourState;
  pending: TourPending | null;
  /** 淘汰后选了"看到结束" */
  watch: boolean;
}

export interface TourDeps {
  wallet: WalletApi;
  store: Store;
  entropy: () => number[];
  newId: () => string;
  /** 电脑想多久（毫秒） */
  think: (t: Table, seat: number) => number;
  /** 一手打完停多久再发下一手（毫秒）；watching 是我已经淘汰、在旁观 */
  gap: (watching: boolean) => number;
  wait: (ms: number) => Promise<void>;
  onStep: (s: Step) => Promise<void>;
}

export interface TourResult {
  place: number;
  /** 奖金（娱乐是 0） */
  prize: number;
  /** 座位号，按名次（冠军在前） */
  order: number[];
}

export class TourSolo {
  private busy = false;
  private stopped = false;
  /** 结回时今天德州的进账到顶了、没进钱包的 */
  capped = 0;
  private s: TourSession;
  private readonly d: TourDeps;

  constructor(s: TourSession, d: TourDeps) {
    this.s = s;
    this.d = d;
  }

  get session(): TourSession {
    return this.s;
  }
  get state(): TourState {
    return this.s.state;
  }
  get table(): Table {
    return this.s.state.table;
  }
  get view(): TourView {
    return tourView(this.s.state, ME);
  }
  get over(): boolean {
    return this.s.state.over;
  }
  /** 我已经出局了 */
  get eliminated(): boolean {
    return this.s.state.places[ME] !== null;
  }
  /** 淘汰了、还没选看还是走：牌桌停着等主页面问 */
  get undecided(): boolean {
    return this.eliminated && !this.over && !this.s.watch;
  }
  get watching(): boolean {
    return this.eliminated && this.s.watch;
  }
  /** 钱包还在办报名（没回话）：不能打 */
  get opening(): boolean {
    return this.s.pending?.t === 'buyin';
  }
  /** 结算已经在路上了（这一场只等钱包回话） */
  get closing(): boolean {
    return this.s.pending?.t === 'cashout';
  }

  /** 名次、奖金和座位排名；还没结束时 place 是现在的名次（按筹码） */
  result(): TourResult {
    const order = finishOrder(this.s.state);
    const place = order.indexOf(ME) + 1;
    const prize = this.s.practice ? 0 : (payouts(this.s.buyIn)[place - 1] ?? 0);
    return { place, prize, order };
  }

  /**
   * 报名：实盘先在钱包扣一份再开赛，娱乐直接开。钱包明确拒了：这一场作废；连不上：请求可能已到、只是回话丢了，
   * 这一场和那一笔留在本机（pending 交回给调用方），之后用同一个操作 id 再办，钱包只扣一次
   */
  static async open(
    d: TourDeps,
    o: { userId: string | null; stakes: StakesId; practice: boolean; level: number },
  ): Promise<TourSolo | { error: string; pending?: TourSolo }> {
    const id = d.newId();
    const buyIn = o.practice ? 0 : stakesOf(o.stakes).max;
    const state = newTour({ humans: [true, false, false, false, false, false], level: o.level }, d.entropy() as unknown as Entropy);
    const s: TourSession = { v: 1, id, userId: o.userId, practice: o.practice, stakes: o.stakes, buyIn, state, pending: null, watch: false };
    const t = new TourSolo(s, d);
    if (o.practice) {
      t.save();
      return t;
    }
    s.pending = { t: 'buyin', op: d.newId(), amount: buyIn };
    t.save();
    const err = await t.settle();
    if (!err) return t;
    if (t.s.pending) return { error: err, pending: t };
    d.store.removeItem(TOUR_KEY);
    return { error: err };
  }

  /** 本机存着的那一场（同一个账号的才认） */
  static load(store: Store, userId: string | null): TourSession | null {
    try {
      const s = JSON.parse(store.getItem(TOUR_KEY) ?? 'null') as TourSession | null;
      if (!s || s.v !== 1 || !s.state?.table || s.userId !== userId) return null;
      return s;
    } catch {
      return null;
    }
  }

  /** 办完还没回话的那一笔。返回 null 是办完了，否则是错误码（连不上时 pending 留着，下次再办） */
  async settle(keepalive = false): Promise<string | null> {
    const p = this.s.pending;
    if (!p) return null;
    const r =
      p.t === 'buyin'
        ? await this.d.wallet.buyin(p.op, this.s.id, this.s.stakes, p.amount)
        : await this.d.wallet.cashout(p.op, this.s.id, p.amount, keepalive);
    if (!r.ok) {
      const retry =
        r.error === 'offline' ||
        r.error === 'unavailable' ||
        r.error === 'internal' ||
        (r.error === 'busy' && p.t === 'cashout') ||
        (p.t === 'cashout' && (r.error === 'login' || r.error === 'forbidden'));
      if (retry) return r.error;
      // 明确拒了：报名作罢；结算被拒（比如那一份放太久已经退回）也只能作罢
      this.s.pending = null;
      this.d.store.removeItem(TOUR_KEY);
      return r.error;
    }
    this.s.pending = null;
    if (p.t === 'cashout') {
      this.capped = r.capped ?? 0;
      this.d.store.removeItem(TOUR_KEY);
      return null;
    }
    this.save();
    return null;
  }

  /** 我出手。不该我说话、不合法时回错误码，不动 */
  async act(a: Action): Promise<string | null> {
    if (this.busy || this.closing || this.opening || this.eliminated) return 'busy';
    const st = this.step(ME, a);
    if (typeof st === 'string') return st;
    await this.show(st);
    await this.flush();
    return null;
  }

  /** 淘汰后选"看到结束" */
  watch(): void {
    this.s.watch = true;
    this.save();
  }

  /**
   * 离开：还在场的我交给电脑，剩下的用 playOut 确定地一次跑完（不播动画），然后结奖金。
   * 返回 null 是结完了；连不上时结算留在 pending，下次打开接着结
   */
  async leave(): Promise<string | null> {
    this.stopped = true;
    if (this.closing) return this.settle();
    if (this.s.pending) {
      // 报名那一笔还没回话：先办完它（钱包可能已经扣了），办不成就先不走
      const err = await this.settle();
      if (this.s.pending) {
        this.stopped = false;
        return err;
      }
      // 钱包明确拒了报名：这一场已经作废，没什么可结的
      if (err) return err;
    }
    // 一手刚打完、还停着没发下一手时，先做淘汰和发牌（playOut 只管有人要说话的局面）
    this.s.state = playOut(tourStep(this.s.state));
    return this.finish();
  }

  /** 打完了（或 playOut 之后）：按名次结奖金。娱乐只清存档 */
  async finish(): Promise<string | null> {
    this.stopped = true;
    if (this.s.practice) {
      this.d.store.removeItem(TOUR_KEY);
      return null;
    }
    if (!this.closing) {
      this.s.pending = { t: 'cashout', op: this.d.newId(), amount: this.result().prize };
      this.save();
    }
    return this.settle();
  }

  /**
   * 电脑接着出手，一手打完停几秒再发下一手，直到轮到我、我被淘汰要问、整场结束或停下。
   * 一手打完先停着（让人看结果）：存档停在"打完没发下一手"，刷新后这里接着发
   */
  async flush(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (;;) {
        if (this.stopped || this.opening || this.closing) return;
        const st = this.s.state;
        if (st.over || this.undecided) return;
        if (handOver(st)) {
          await this.d.wait(this.d.gap(this.watching));
          if (this.stopped) return;
          await this.advance();
          continue;
        }
        const m = tourAi(st);
        if (!m) return;
        await this.d.wait(this.d.think(st.table, m.seat));
        if (this.stopped) return;
        const r = this.step(m.seat, m.action);
        if (typeof r === 'string') throw new Error(`computer made an illegal move: ${r}`);
        await this.show(r);
      }
    } finally {
      this.busy = false;
    }
  }

  stop(): void {
    this.stopped = true;
  }

  /** 一手打完后的处理：淘汰、涨盲、发下一手（规则 tourStep） */
  private async advance(): Promise<void> {
    const prev = this.s.state.table;
    this.s.state = tourStep(this.s.state);
    this.save();
    await this.show({ prev, next: this.s.state.table, seat: null, action: null });
  }

  /** 做一步、存盘。打完整手也先停在"打完"，淘汰和发牌等 advance，这样摊牌的画面和结果能先看清 */
  private step(seat: number, a: Action): Step | string {
    const prev = this.s.state.table;
    const next = apply(prev, seat, a);
    if (isFail(next)) return next.error;
    this.s.state = { ...this.s.state, table: next };
    this.save();
    return { prev, next, seat, action: a };
  }

  private async show(st: Step): Promise<void> {
    try {
      await this.d.onStep(st);
    } catch (e) {
      console.error('texas: 画面播这一步出错', e);
    }
  }

  private save(): void {
    this.d.store.setItem(TOUR_KEY, JSON.stringify(this.s));
  }
}
