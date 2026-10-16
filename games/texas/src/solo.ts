/**
 * 单机的一桌（DESIGN.md 5.2、8.4）：规则在浏览器里跑，筹码进出走钱包。
 * 这里只管流程：买入 → 发牌 → 电脑按"像人"的节奏出手 → 我出手 → 一手打完停着（看结果、补码、歇一手、离桌）→ 下一手 / 离桌结回钱包；
 * 画面、声音由调用方接 onStep。一手打完不马上发下一手（规则的 holdHands，0.1.1）：玩家点"下一手"（或者开着自动、停够几秒）才由 next 发。
 *
 * 钱包的操作先记进本机的这一桌（pending）再发请求：请求半路断了、页面被关，下次打开用同一个操作 id 重发，钱包按 id 去重，不会多扣多给。
 * 牌局只存在本机（texas.session），不同步；换设备时钱包那边显示"另一台设备上有一桌没打完"：回那台设备离桌，或者 24 小时后平台原样退回。
 * 这边不给放弃那一桌：看不到那边还剩多少，放开了"输了换台设备放弃"就随手能做（主线 2026-10-15 定）。
 */
import { aiAction } from './bot.ts';
import { NO_FAME, noteHand, settleStats, type Fame } from './core/fame.ts';
import { stakesOf, type StakesId } from './core/stakes.ts';
import { addChips, apply, deal, isFail, newTable, paid, seatHouse, seatPlayer, type Action, type Table } from './core/table.ts';
import type { WalletApi } from './net/wallet.ts';

/** 我永远坐 0 号位（画面上转到正下方） */
export const ME = 0;
export const SESSION_KEY = 'texas.session';

/** payout：桌上待结的那一笔的 id（输光了离桌没有，只是把钱包里"桌上那一份"清掉） */
export type Pending = { t: 'buyin'; op: string; amount: number } | { t: 'cashout'; op: string; amount: number; payout: string | null };

export interface Session {
  v: 1;
  /** 场次 id（钱包里"桌上那一份"的 ref） */
  id: string;
  /** 谁的钱包；换了账号不接着打别人的桌 */
  userId: string | null;
  /** 练习桌：钱包用不了时打的，筹码不进出钱包 */
  practice: boolean;
  table: Table;
  /** 还没得到钱包回话的那一笔 */
  pending: Pending | null;
  /** 这一场的数（离桌的结算页用；老存档没有，读的时候补上） */
  stats?: SessionStats;
  /** 这一份的战绩（0.3.0，离桌结回时报给平台；老存档没有，从现在起记） */
  fame?: Fame;
}

export interface SessionStats {
  /** 一共带上桌的（坐下 + 补码） */
  buyin: number;
  /** 发到牌的手数、赢到钱的手数 */
  hands: number;
  won: number;
  /** 赢得最多的一手：赢了多少、牌型（别人都弃了没摊牌时为 null） */
  best: { won: number; value: number | null } | null;
}

const NO_STATS: SessionStats = { buyin: 0, hands: 0, won: 0, best: null };

export interface Store {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
}

/** 一步：谁做了什么（发牌、补码这些系统的事没有 seat） */
export interface Step {
  prev: Table;
  next: Table;
  seat: number | null;
  action: Action | null;
}

export interface SoloDeps {
  wallet: WalletApi;
  store: Store;
  /** 256 位开局熵 */
  entropy: () => number[];
  newId: () => string;
  /** 电脑想多久（毫秒），按性格和局面由画面层定，测试里给 0 */
  think: (t: Table, seat: number) => number;
  wait: (ms: number) => Promise<void>;
  /** 每一步之后：画面播动画，播完再 resolve，电脑才接着出手 */
  onStep: (s: Step) => Promise<void>;
}

export class Solo {
  private busy = false;
  private stopped = false;
  /** 离桌结回时今天德州的进账到顶了、没进钱包的（平台 client 模式的每日上限） */
  capped = 0;
  /** 离桌时桌上剩下、要结回的（结算页用） */
  left = 0;

  private s: Session;
  private readonly d: SoloDeps;

  constructor(s: Session, d: SoloDeps) {
    this.s = s;
    this.d = d;
  }

  get session(): Session {
    return this.s;
  }
  get table(): Table {
    return this.s.table;
  }
  get stats(): SessionStats {
    return (this.s.stats ??= { ...NO_STATS });
  }

  /** 一手打完停着、等发下一手（还没发过第一手的也算：等 next 发第一手） */
  get between(): boolean {
    const t = this.s.table;
    return t.phase === 'idle' && !this.closing && (t.hold === true || t.handNo === 0);
  }

  /** 发下一手（一手打完停着、或者还没发第一手时），电脑接着出手 */
  async next(): Promise<void> {
    if (this.busy || !this.between) return;
    const prev = this.s.table;
    this.s.table = deal(prev);
    this.save();
    await this.d.onStep({ prev, next: this.s.table, seat: null, action: null });
    await this.flush();
  }

  /**
   * 坐下：先在钱包扣买入，再开桌。钱包用不了时 practice 开练习桌（不碰钱包）。
   * 钱包明确拒了（钱不够、到上限……）：这一桌作废。连不上（offline、unavailable、busy）：请求可能已经到了、只是回话丢了，
   * 这一桌和那一笔都留在本机（pending 交回给调用方），之后用同一个操作 id 再办，钱包按 id 只扣一次
   */
  static async open(
    d: SoloDeps,
    o: { userId: string | null; stakes: StakesId; size: number; amount: number; practice: boolean },
  ): Promise<Solo | { error: string; pending?: Solo }> {
    const id = d.newId();
    let t = newTable(o.stakes, o.size, d.entropy(), { holdHands: true });
    // 都坐好了也先不发：第一手等新手提示关了、调用方 next 再发（不然提示框后面电脑已经开打）
    for (let i = 1; i < o.size; i++) t = must(seatHouse(t, i, false));
    const s: Session = { v: 1, id, userId: o.userId, practice: o.practice, table: t, pending: null, stats: { ...NO_STATS } };
    const solo = new Solo(s, d);
    if (o.practice) {
      solo.s.table = must(seatPlayer(t, ME, o.amount, false));
      solo.stats.buyin += o.amount;
      solo.save();
      return solo;
    }
    s.pending = { t: 'buyin', op: d.newId(), amount: o.amount };
    solo.save();
    const err = await solo.settle();
    if (!err) return solo;
    if (solo.s.pending) return { error: err, pending: solo };
    d.store.removeItem(SESSION_KEY);
    return { error: err };
  }

  /** 本机存着的那一桌（同一个账号的才认） */
  static load(store: Store, userId: string | null): Session | null {
    try {
      const s = JSON.parse(store.getItem(SESSION_KEY) ?? 'null') as Session | null;
      if (!s || s.v !== 1 || !s.table || s.userId !== userId) return null;
      // 0.1.0 的存档：打完一手照样停着；这一场的数从现在记
      if (!s.table.holdHands) s.table = { ...s.table, holdHands: true, hold: false };
      s.stats ??= { ...NO_STATS };
      return s;
    } catch {
      return null;
    }
  }

  /** 办完还没回话的那一笔钱包操作。返回 null 是办完了，否则是错误码（offline 时 pending 留着，下次再办） */
  async settle(keepalive = false): Promise<string | null> {
    const p = this.s.pending;
    if (!p) return null;
    const r = p.t === 'buyin'
      ? await this.d.wallet.buyin(p.op, this.s.id, this.s.table.stakes, p.amount)
      : await this.d.wallet.cashout(p.op, this.s.id, p.amount, keepalive, this.s.practice ? undefined : settleStats(this.s.fame ?? NO_FAME, p.amount - this.stats.buyin, stakesOf(this.s.table.stakes).max));
    if (!r.ok) {
      const retry =
        r.error === 'offline' ||
        r.error === 'unavailable' ||
        r.error === 'internal' ||
        // 结回回 busy（平台停服档）留着再办；带入回 busy 是平台停了带入、钱没扣，当明确拒了
        // （0.3.3：原来也当连不上，一整天每 15 秒重试，这期间连娱乐局都开不了）
        (r.error === 'busy' && p.t === 'cashout') ||
        // 结回时登录过期、没过 CSRF：钱包没收到，这一桌留在本机，登录后再结（0.3.3：原来当明确拒了，整桌筹码就丢了）
        (p.t === 'cashout' && (r.error === 'login' || r.error === 'forbidden'));
      if (retry) return r.error;
      // 钱包明确拒了：买入作罢；结算被拒（比如那一桌已经在别的设备上放弃了）也只能作罢，这一桌就没了
      this.s.pending = null;
      if (p.t === 'cashout') this.d.store.removeItem(SESSION_KEY);
      else this.save();
      return r.error;
    }
    const prev = this.s.table;
    if (p.t === 'buyin') {
      const me = prev.seats[ME]!;
      // 坐下那一笔不开第一手（等 next）；补码在两手之间，也不自己发
      this.s.table = must(me.owner === 'none' ? seatPlayer(prev, ME, p.amount, false) : addChips(prev, ME, p.amount, false));
      if (this.s.table.seats[ME]!.away) this.s.table = must(apply(this.s.table, ME, { t: 'back' }));
      this.stats.buyin += p.amount;
    } else {
      // 结完了，这一桌就没了
      this.capped = r.capped ?? 0;
      this.s.pending = null;
      this.d.store.removeItem(SESSION_KEY);
      if (p.payout) this.s.table = paid(prev, p.payout);
      return null;
    }
    this.s.pending = null;
    this.save();
    await this.d.onStep({ prev, next: this.s.table, seat: null, action: null });
    return null;
  }

  /** 离桌结算已经在路上了（这一桌只等钱包回话，不能再打） */
  get closing(): boolean {
    return this.s.pending?.t === 'cashout';
  }

  /** 我出手。不该我说话、不合法时回错误码，不动 */
  async act(a: Action): Promise<string | null> {
    if (this.busy || this.closing) return 'busy';
    const st = this.step(ME, a);
    if (typeof st === 'string') return st;
    await this.d.onStep(st);
    await this.flush();
    return null;
  }

  /** 补码（我不在这一手里时）：先在钱包扣，再上桌 */
  async topUp(amount: number): Promise<string | null> {
    const me = this.s.table.seats[ME]!;
    if (me.status !== 'out') return 'in_hand';
    if (me.stack + amount > stakesOf(this.s.table.stakes).max || amount <= 0) return 'bad_amount';
    if (this.s.practice) {
      const prev = this.s.table;
      this.s.table = must(addChips(prev, ME, amount, false));
      if (this.s.table.seats[ME]!.away) this.s.table = must(apply(this.s.table, ME, { t: 'back' }));
      this.stats.buyin += amount;
      this.save();
      await this.d.onStep({ prev, next: this.s.table, seat: null, action: null });
      await this.flush();
      return null;
    }
    this.s.pending = { t: 'buyin', op: this.d.newId(), amount };
    this.save();
    const err = await this.settle();
    if (!err) await this.flush();
    return err;
  }

  /** 下一手起歇着（想补码时用：这一手打完就停下） */
  async sitOut(on: boolean): Promise<void> {
    const st = this.step(ME, { t: on ? 'away' : 'back' });
    if (typeof st !== 'string') await this.d.onStep(st);
    await this.flush();
  }

  /**
   * 离桌：手里有牌就弃，电脑把这一手打完（不播动画，快进），剩下的筹码结回钱包。
   * 返回 null 是结完了；offline 时结算留在 pending，下次打开接着结。
   */
  async leave(): Promise<string | null> {
    this.stopped = true;
    if (this.closing) {
      this.left = this.s.pending!.amount;
      return this.settle();
    }
    const prev = this.s.table;
    this.step(ME, { t: 'leave' });
    while (this.s.table.seats[ME]!.owner !== 'none') {
      const seat = this.s.table.toAct;
      if (seat === null) throw new Error('hand stuck while leaving');
      this.step(seat, aiAction(this.s.table, seat));
    }
    const payout = this.s.table.out.find((p) => p.seat === ME) ?? null;
    this.left = payout?.amount ?? 0;
    await this.d.onStep({ prev, next: this.s.table, seat: ME, action: { t: 'leave' } });
    if (this.s.practice) {
      this.d.store.removeItem(SESSION_KEY);
      return null;
    }
    this.s.pending = { t: 'cashout', op: this.d.newId(), amount: payout?.amount ?? 0, payout: payout?.id ?? null };
    this.save();
    return this.settle();
  }

  /** 输光了、筹码 0 时直接走（没什么可结的，但钱包里那一份要清掉） */
  get busted(): boolean {
    const me = this.s.table.seats[ME]!;
    return me.owner === 'player' && me.stack === 0 && me.status === 'out';
  }

  /** 电脑接着出手，直到轮到我、没人能动或停下 */
  async flush(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      for (;;) {
        const t = this.s.table;
        const seat = t.toAct;
        if (this.stopped || seat === null || seat === ME) return;
        await this.d.wait(this.d.think(t, seat));
        if (this.stopped) return;
        const st = this.step(seat, aiAction(t, seat));
        if (typeof st === 'string') throw new Error(`computer made an illegal move: ${st}`);
        await this.d.onStep(st);
      }
    } finally {
      this.busy = false;
    }
  }

  stop(): void {
    this.stopped = true;
  }

  /** 做一步、存盘（每一步都存：刷新、关页面后从这一步接着打） */
  private step(seat: number, a: Action): Step | string {
    const prev = this.s.table;
    const next = apply(prev, seat, a);
    if (isFail(next)) return next.error;
    this.s.table = next;
    this.count(prev, next);
    this.save();
    return { prev, next, seat, action: a };
  }

  /** 一手刚打完：记进这一场的数（我发到牌的才算） */
  private count(prev: Table, next: Table): void {
    const r = next.lastHand;
    if (!r || r.handNo === prev.lastHand?.handNo || prev.seats[ME]!.status === 'out') return;
    // 战绩（0.3.0）：只用公开的（操作记录、亮出来的牌、分池），和好友房一个算法；牌桌一手打完停着，log 是这一手完整的
    this.s.fame = noteHand(this.s.fame ?? NO_FAME, r, next.log, ME);
    const st = this.stats;
    st.hands++;
    const won = r.pots.reduce((a, p) => a + (p.winners.find((w) => w.seat === ME)?.won ?? 0), 0);
    if (won <= 0) return;
    st.won++;
    if (!st.best || won > st.best.won) st.best = { won, value: r.byFold ? null : (r.shown.find((x) => x.seat === ME)?.value ?? null) };
  }

  private save(): void {
    this.d.store.setItem(SESSION_KEY, JSON.stringify(this.s));
  }
}

function must(x: Table | { error: string }): Table {
  if (isFail(x)) throw new Error(x.error);
  return x;
}
