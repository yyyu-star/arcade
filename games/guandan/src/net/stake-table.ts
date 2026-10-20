/**
 * 好友房实盘的桌里玩法无关的部分（docs/stake.md 第 3 节）：带入一份、结回一份、座位换人、走了又回来再带入、被拒重新带入、
 * 一场结束收场、钱包办完一笔的回话。掼蛋（variants/guandan/net/stake.ts，4 座）和斗地主（variants/doudizhu/net/stake.ts，3 座）
 * 各自绑一份：座位数、结回额、"一副打到一半"的阶段、要不要攒战绩小结是各玩法自己的，开局和记账（stakeBegin / stakeDeal）也留在各玩法里。
 * 纯函数，房间和浏览器共用；不引用任何玩法（只认 src/core/stake.ts 的账本）。
 *
 * - 离开（座位交给电脑）：一副打到一半走的，这一副电脑替他打完、输赢照算，这一副结束时按那时的分结回（防"要输时离座躲输"）；
 *   两副之间走的当场结回；带入还在路上的，到账时原样结回一份。之后这个座位的分归庄家。
 * - 走了又回来：用新的 ref 再带入一份（平台按 ref 分开，同一个游戏能同时有好几份），第 1 份是这一场的 ref，第 n 份是 <ref>s<座位>n<n>。
 */
import type { RoomEffect } from 'arcade-kit/game';
import { seatOp, setPaid, type RoomBook, type TierId } from '../core/stake.ts';

/** 一笔要去钱包办的事；stats 是结回时带给平台的战绩小结（带入没有） */
export interface TableEffect<S = never> extends RoomEffect {
  kind: 'in' | 'out';
  ref: string;
  tier: TierId;
  amount: number;
  stats?: S;
}

/** 桌的公共部分；各玩法的桌多出的字段原样保留（泛型都是 T 的展开） */
export interface TableBase<S = never, Y = never> {
  tier: TierId;
  ref: string;
  book: RoomBook;
  /** 还没办完的事 */
  pending: TableEffect<S>[];
  /** 这一场结束了（结回已经记下） */
  over: boolean;
  /** 每个座位：带入被拒的原因（钱包的错误码，或 need_two：开局真人不到 2 个） */
  why: (string | null)[];
  /** 每个座位：结回办完了 */
  out: boolean[];
  /** 每个座位这一份攒的战绩（只有要攒的玩法有） */
  tally?: Y[];
  /** 每个座位现在是第几份（0：没带入过）；老的局没有，按第 1 份算 */
  share?: number[];
  /** 这一副打到一半点了"离开"、等这副结束再结回的座位 */
  leaving?: boolean[];
}

/** 每个座位看到的（公开的分和到账情况；被拒的原因只给自己） */
export interface TableView {
  tier: TierId;
  /** 记过的副数 */
  deals: number;
  seats: { paid: RoomBook['seats'][number]['paid']; points: number; out: boolean }[];
  over: boolean;
  why: string | null;
}

export interface TableCfg<S, Y> {
  /** 座位数 */
  seats: number;
  /** 这个档位、这么多分，结回多少筹码 */
  payout: (tier: TierId, points: number) => number;
  /** 牌局现在是不是一副打到一半（这时离开要等这副结束）；phase 的类型各玩法自己的，这里只当字符串用 */
  midDeal: (phase: string | undefined) => boolean;
  /** 要攒战绩小结的玩法给：新的一份从空的记起、结回时把它变成小结 */
  tally?: { empty: (seat: number) => Y; stats: (t: Y) => S };
}

export function stakeTableKit<S = never, Y = never>(cfg: TableCfg<S, Y>) {
  const fill = <V>(v: V): V[] => Array.from({ length: cfg.seats }, () => v);

  /** 座位现在这一份的 ref（钱包按它分开好几份） */
  function shareRef<T extends TableBase<S, Y>>(t: T, seat: number): string {
    const n = t.share?.[seat] ?? 1;
    return n <= 1 ? t.ref : `${t.ref}s${seat}n${n}`;
  }

  /** 新带入一份：份数加 1，分和战绩从 0 记；上一份结回过的分挪进 book.settled（庄家 + 结回过的 + 各座位 = 0 这本账才对得上） */
  function addIn<T extends TableBase<S, Y>>(t: T, seat: number): T {
    const cur = t.share ?? t.book.seats.map((x) => (x.paid === 'no' ? 0 : 1));
    const old = t.book.seats[seat]!;
    const book = { ...setPaid(t.book, seat, 'pending'), settled: (t.book.settled ?? 0) + (old.paid === 'left' ? old.points : 0) };
    book.seats = book.seats.map((s, i) => (i === seat ? { ...s, points: 0 } : s));
    const tally = cfg.tally && t.tally ? { tally: t.tally.map((x, i) => (i === seat ? cfg.tally!.empty(i) : x)) } : {};
    const next: T = {
      ...t,
      share: cur.map((n, i) => (i === seat ? n + 1 : n)),
      book,
      why: t.why.map((w, i) => (i === seat ? null : w)),
      out: t.out.map((o, i) => (i === seat ? false : o)),
      ...tally,
    };
    const ref = shareRef(next, seat);
    const e: TableEffect<S> = { id: seatOp(ref, seat, 'in'), seat, kind: 'in', ref, tier: t.tier, amount: cfg.payout(t.tier, 0) };
    return { ...next, pending: [...next.pending, e] };
  }

  function addOut<T extends TableBase<S, Y>>(t: T, seat: number, points: number): T {
    const tally = t.tally?.[seat];
    const ref = shareRef(t, seat);
    const e: TableEffect<S> = {
      id: seatOp(ref, seat, 'out'), seat, kind: 'out', ref, tier: t.tier, amount: cfg.payout(t.tier, points),
      ...(tally !== undefined && cfg.tally ? { stats: cfg.tally.stats(tally) } : {}),
    };
    return { ...t, pending: [...t.pending, e] };
  }

  function setLeaving<T extends TableBase<S, Y>>(t: T, seat: number, on: boolean): T {
    const cur = t.leaving ?? fill(false);
    return { ...t, leaving: cur.map((x, i) => (i === seat ? on : x)) };
  }

  /** 离开的座位按现在的分结回，之后的分归庄家 */
  function leaveNow<T extends TableBase<S, Y>>(t: T, seat: number): T {
    const paid = t.book.seats[seat]!.paid;
    const next: T = { ...setLeaving(t, seat, false), book: setPaid(t.book, seat, 'left'), why: t.why.map((w, i) => (i === seat ? 'left' : w)) };
    return paid === 'yes' ? addOut(next, seat, t.book.seats[seat]!.points) : next;
  }

  /** 能不能（再）带入一份：这一场没完、这个座位离开过或带入被拒、没有在路上的带入；开局真人不到 2 个的桌整场不计输赢 */
  function canRebuy<T extends TableBase<S, Y>>(t: T, seat: number): boolean {
    const paid = t.book.seats[seat]?.paid;
    if (t.over || (paid !== 'left' && paid !== 'refused') || t.why.includes('need_two')) return false;
    return !t.pending.some((e) => e.seat === seat && e.kind === 'in');
  }

  /**
   * 座位换人：接管开局时就是电脑、从没带入过的座位要带入；到账（或带入在办）的人离开要结回——一副打到一半的等这副结束，
   * 两副之间的当场；走了又回来的再带入一份。phase 是牌局现在的阶段
   */
  function seated<T extends TableBase<S, Y>>(t: T, seat: number, kind: 'human' | 'ai', phase?: string): T {
    const paid = t.book.seats[seat]!.paid;
    if (kind === 'ai') {
      if (t.over || (paid !== 'yes' && paid !== 'pending')) return t;
      if (paid === 'yes' && cfg.midDeal(phase)) return t.leaving?.[seat] ? t : setLeaving(t, seat, true);
      return leaveNow(t, seat);
    }
    // 这一副还没打完就回来了：还是原来那一份，不用结回再带入
    if (t.leaving?.[seat]) return setLeaving(t, seat, false);
    if (paid === 'left') return canRebuy(t, seat) ? addIn(t, seat) : t;
    if (t.over || paid !== 'no') return t;
    // 开局真人不到 2 个的桌整场不计输赢：后来的人也不带入
    if (t.why.includes('need_two')) return t;
    return addIn(t, seat);
  }

  /** 点了"重新带入"（带入被拒以后）：能带就带一份，不能就原样 */
  function rebuy<T extends TableBase<S, Y>>(t: T, seat: number): T {
    return canRebuy(t, seat) ? addIn(t, seat) : t;
  }

  /** 这一场就地结束（打完，或者关房）：每个到账的座位按目前的分结回 */
  function finish<T extends TableBase<S, Y>>(t: T): T {
    if (t.over) return t;
    // 等着这副结束的离开也在这里一起结回（paid 还是 yes）
    let out: T = { ...t, over: true, ...(t.leaving ? { leaving: fill(false) } : {}) };
    t.book.seats.forEach((s, seat) => {
      if (s.paid === 'yes') out = addOut(out, seat, s.points);
    });
    return out;
  }

  /** 一副结束后：打到一半离开的座位这副算完了，按现在的分结回 */
  function leaveDone<T extends TableBase<S, Y>>(t: T): T {
    let next = t;
    t.leaving?.forEach((on, seat) => {
      if (on) next = leaveNow(next, seat);
    });
    return next;
  }

  /** 开局真人不到 2 个：整场不计输赢、不碰钱包（被拒，原因 need_two） */
  function needTwo<T extends TableBase<S, Y>>(t: T, humans: readonly number[]): T {
    let next = t;
    for (const i of humans) next = { ...next, book: setPaid(next.book, i, 'refused'), why: next.why.map((w, j) => (j === i ? 'need_two' : w)) };
    return next;
  }

  /**
   * 一笔办完了。result 是房间的 perform 回的：{ ok: true } 或 { ok: false, error }（钱包的业务拒绝；暂时的毛病 perform 自己抛，房间按退避重试）。
   */
  function settled<T extends TableBase<S, Y>>(t: T, id: string, result: unknown): T {
    const e = t.pending.find((x) => x.id === id);
    if (!e) return t;
    const r = (result ?? {}) as { ok?: unknown; error?: unknown };
    const ok = r.ok === true;
    let next: T = { ...t, pending: t.pending.filter((x) => x.id !== id) };
    if (e.kind === 'in' && next.book.seats[e.seat]!.paid === 'left') {
      // 带入在路上时人已经走了：到账了就原样结回一份，被拒了什么都不用办
      return ok ? addOut(next, e.seat, 0) : next;
    }
    if (e.kind === 'in') {
      next = { ...next, book: setPaid(next.book, e.seat, ok ? 'yes' : 'refused'), why: next.why.map((w, i) => (i === e.seat ? (ok ? null : String(r.error ?? 'refused')) : w)) };
      // 一场已经结束了才到账：一分没算，原样结回一份
      if (ok && next.over) next = addOut(next, e.seat, 0);
      return next;
    }
    // 结回：办完就算（no_stake / expired 也是"那一份已经不在桌上了"）。只记现在这一份的（上一份的结回晚到了不算到新的一份上）
    if (e.ref !== shareRef(next, e.seat)) return next;
    return { ...next, out: next.out.map((o, i) => o || i === e.seat) };
  }

  function view<T extends TableBase<S, Y>>(t: T, seat: number): TableView {
    return {
      tier: t.tier,
      deals: t.book.deals,
      seats: t.book.seats.map((s, i) => ({ paid: s.paid, points: s.points, out: t.out[i]! })),
      over: t.over,
      why: seat >= 0 ? (t.why[seat] ?? null) : null,
    };
  }

  return { shareRef, addIn, addOut, leaveNow, leaveDone, canRebuy, seated, rebuy, finish, needTwo, settled, view };
}
