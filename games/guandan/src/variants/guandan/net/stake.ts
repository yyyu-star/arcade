/**
 * 好友房实盘的"桌"（docs/stake.md 第 3 节）：开房选项、开局带入、座位换人、每副记账、一场结束结回、关房收场。纯函数，房间和浏览器共用。
 * 计分规则在 src/stake/（单机也用同一份）；这里只管好友房特有的：谁带入了、带入在办还是被拒了、要去钱包办的事（arcade-kit 的 effects）。
 *
 * - 开局时每个真人座位记一笔带入（effect id = gd-<hex>-s<座位>-in），到账之前的分归庄家；被拒的座位这一场不计输赢，人照样打。
 * - 开局真人不到 2 个：整场不计输赢、不碰钱包（kit 没有"拒绝开局"的接口，页面把开局按钮灰掉，这里兜底；防的是一个人带三个电脑绕开单机的每日上限）。
 * - 接管开局时就是电脑的座位：给这个座位记一笔带入。
 * - 中途点"离开"（座位交给电脑，0.6.0 起离开就结算，不卡人）：一副打到一半走的，这一副电脑替他打完、输赢照算，
 *   这一副结束时按那时的分结回（0.12.4 审计：按开这副前的分结回、这副的输赢归庄家，要输时离座、结束再坐回就能躲输）；
 *   两副之间（结算页）走的当场结回。之后这个座位的分归庄家。这一副没打完又坐回来的，接着算原来那一份。
 *   带入还在路上的，到账时原样结回一份（到账前的分本来就归庄家，躲不了什么）。
 * - 走了又回来（和德州同一个做法）：用新的 ref 再带入一份（平台 0.9.5 起同一个游戏能同时有好几份，按 ref 分开），
 *   到账以后打完的副算这一份，离开时照常结回。带入被拒的可以点"重新带入"（free 操作 buyin）再试。
 *   第 1 份的 ref 是这一场的 ref（op 和 0.5.0 一样），第 n 份是 <ref>s<座位>n<n>。
 * - 一场结束（5 副、过 A、到账的都封顶）或关房：每个到账的座位记一笔结回（-out）。结束后才到账的座位，原样结回一份。
 */
import type { RoomEffect } from 'arcade-kit/game';
import type { SeatKind } from 'arcade-kit/protocol';
import { stream, type Entropy } from 'arcade-kit/rng';
import type { DealResult, Phase, PlayRecord } from '../core/index.ts';
import { emptyTally, statsOf, tallyDeal, type SettleStats, type Tally } from '../stake/stats.ts';
import { TIERS, isTier, newRoomBook, payout, roomAddDeal, roomOver, roomRef, seatOp, setPaid, type Paid, type RoomBook, type TierId } from '../stake/index.ts';

/** 开房选项：stake 为 null 是娱乐房间（和以前一样） */
export interface RoomOpts {
  stake: TierId | null;
}

/** 开房请求、start 带的选项：没带是娱乐；带了必须是认得的档位，不然 kit 回 bad_options */
export function parseRoomOpts(raw: unknown): RoomOpts | null {
  if (raw === undefined || raw === null) return { stake: null };
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const s = (raw as { stake?: unknown }).stake;
  if (s === undefined || s === null) return { stake: null };
  return isTier(s) ? { stake: s } : null;
}

/** 一笔要去钱包办的事 */
export interface StakeEffect extends RoomEffect {
  kind: 'in' | 'out';
  ref: string;
  tier: TierId;
  amount: number;
  /** 结回时带给平台的战绩小结（平台 0.10.0）；带入没有 */
  stats?: SettleStats;
}

export interface StakeTable {
  tier: TierId;
  ref: string;
  book: RoomBook;
  /** 还没办完的事 */
  pending: StakeEffect[];
  /** 这一场结束了（结回已经记下） */
  over: boolean;
  /** 每个座位：带入被拒的原因（钱包的错误码，或 need_two：开局真人不到 2 个） */
  why: (string | null)[];
  /** 每个座位：结回办完了 */
  out: boolean[];
  /** 每个座位这一份攒的战绩（只记到账以后的副）；0.6.0 以前开的局没有 */
  tally?: Tally[];
  /** 每个座位现在是第几份（0：没带入过）；0.6.0 以前开的局没有，按第 1 份算 */
  share?: number[];
  /** 这一副打到一半点了"离开"、等这副结束再结回的座位（0.12.4）；以前开的局没有 */
  leaving?: boolean[];
}

/** 每个座位看到的（公开的分和到账情况；被拒的原因只给自己） */
export interface StakeView {
  tier: TierId;
  /** 记过的副数 */
  deals: number;
  seats: { paid: Paid; points: number; out: boolean }[];
  over: boolean;
  why: string | null;
}

/** 这一场的 ref：从牌局密钥另分一条流取 64 位（和发牌的流互不相干，看到 ref 也推不出牌） */
export function stakeRef(key: Entropy): string {
  const r = stream(key, 'stake-ref');
  return roomRef([r.u32(), r.u32()].map((x) => x.toString(16).padStart(8, '0')).join(''));
}

/** 座位现在这一份的 ref（钱包按它分开好几份） */
export function shareRef(t: StakeTable, seat: number): string {
  const n = t.share?.[seat] ?? 1;
  return n <= 1 ? t.ref : `${t.ref}s${seat}n${n}`;
}

/** 新带入一份：份数加 1，分和战绩从 0 记；上一份结回过的分挪进 book.settled（庄家 + 结回过的 + 各座位 = 0 这本账才对得上） */
function addIn(t: StakeTable, seat: number): StakeTable {
  // 0.6.0 以前开的局没记份数：带入过的算第 1 份
  const cur = t.share ?? t.book.seats.map((x) => (x.paid === 'no' ? 0 : 1));
  let next: StakeTable = { ...t, share: cur.map((n, i) => (i === seat ? n + 1 : n)) };
  const old = t.book.seats[seat]!;
  const book = { ...setPaid(t.book, seat, 'pending'), settled: (t.book.settled ?? 0) + (old.paid === 'left' ? old.points : 0) };
  book.seats = book.seats.map((s, i) => (i === seat ? { ...s, points: 0 } : s));
  next = {
    ...next,
    book,
    why: next.why.map((w, i) => (i === seat ? null : w)),
    out: next.out.map((o, i) => (i === seat ? false : o)),
    ...(next.tally ? { tally: next.tally.map((x, i) => (i === seat ? emptyTally() : x)) } : {}),
  };
  const ref = shareRef(next, seat);
  const e: StakeEffect = { id: seatOp(ref, seat, 'in'), seat, kind: 'in', ref, tier: t.tier, amount: TIERS[t.tier] };
  return { ...next, pending: [...next.pending, e] };
}

function addOut(t: StakeTable, seat: number, points: number): StakeTable {
  const tally = t.tally?.[seat];
  const ref = shareRef(t, seat);
  const e: StakeEffect = { id: seatOp(ref, seat, 'out'), seat, kind: 'out', ref, tier: t.tier, amount: payout(t.tier, points), ...(tally ? { stats: statsOf(tally) } : {}) };
  return { ...t, pending: [...t.pending, e] };
}

export function stakeBegin(key: Entropy, tier: TierId, seats: readonly SeatKind[]): StakeTable {
  let t: StakeTable = {
    tier, ref: stakeRef(key), book: newRoomBook(tier), pending: [], over: false, why: [null, null, null, null], out: [false, false, false, false],
    tally: [0, 1, 2, 3].map(emptyTally),
    share: [0, 0, 0, 0],
  };
  const humans = [0, 1, 2, 3].filter((i) => seats[i] === 'human');
  if (humans.length < 2) {
    for (const i of humans) t = { ...t, book: setPaid(t.book, i, 'refused'), why: t.why.map((w, j) => (j === i ? 'need_two' : w)) };
    return t;
  }
  for (const i of humans) t = addIn(t, i);
  return t;
}

/** 一副打到一半（进贡、还贡、出牌）：这时离开要等这一副打完再结回 */
function midDeal(phase: Phase | undefined): boolean {
  return phase === 'tribute' || phase === 'return' || phase === 'play';
}

function setLeaving(t: StakeTable, seat: number, on: boolean): StakeTable {
  const cur = t.leaving ?? [false, false, false, false];
  return { ...t, leaving: cur.map((x, i) => (i === seat ? on : x)) };
}

/** 离开的座位按现在的分结回，之后的分归庄家 */
function leaveNow(t: StakeTable, seat: number): StakeTable {
  const paid = t.book.seats[seat]!.paid;
  const next: StakeTable = { ...setLeaving(t, seat, false), book: setPaid(t.book, seat, 'left'), why: t.why.map((w, i) => (i === seat ? 'left' : w)) };
  return paid === 'yes' ? addOut(next, seat, t.book.seats[seat]!.points) : next;
}

/**
 * 座位换人：接管开局时就是电脑、从没带入过的座位要带入；到账（或带入在办）的人离开要结回——一副打到一半的等这副结束（stakeDeal），
 * 两副之间的当场；走了又回来的再带入一份。phase 是牌局现在的阶段
 */
export function stakeSeated(t: StakeTable, seat: number, kind: 'human' | 'ai', phase?: Phase): StakeTable {
  const paid = t.book.seats[seat]!.paid;
  if (kind === 'ai') {
    if (t.over || (paid !== 'yes' && paid !== 'pending')) return t;
    if (paid === 'yes' && midDeal(phase)) return t.leaving?.[seat] ? t : setLeaving(t, seat, true);
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

/** 能不能（再）带入一份：这一场没完、这个座位离开过或带入被拒、没有在路上的带入；开局真人不到 2 个的桌整场不计输赢 */
export function canRebuy(t: StakeTable, seat: number): boolean {
  const paid = t.book.seats[seat]?.paid;
  if (t.over || (paid !== 'left' && paid !== 'refused') || t.why.includes('need_two')) return false;
  return !t.pending.some((e) => e.seat === seat && e.kind === 'in');
}

/** 点了"重新带入"（带入被拒以后）：能带就带一份，不能就原样 */
export function stakeRebuy(t: StakeTable, seat: number): StakeTable {
  return canRebuy(t, seat) ? addIn(t, seat) : t;
}

/** 一副结束：记账（战绩小结只记到账的座位）；一场结束就记下每个到账座位的结回。history 是这一副的出牌记录 */
export function stakeDeal(t: StakeTable, r: DealResult, phase: Phase, history: readonly PlayRecord[] = []): StakeTable {
  if (t.over || r.dealNo !== t.book.deals + 1) return t;
  const tally = t.tally?.map((x, seat) => (t.book.seats[seat]!.paid === 'yes' ? tallyDeal(x, r, history, seat, t.tier) : x));
  let next: StakeTable = { ...t, book: roomAddDeal(t.book, r), ...(tally ? { tally } : {}) };
  // 这一副打到一半离开的：这副算完了，按现在的分结回
  t.leaving?.forEach((on, seat) => {
    if (on) next = leaveNow(next, seat);
  });
  return roomOver(next.book, phase) ? stakeFinish(next) : next;
}

/** 这一场就地结束（打完，或者关房）：每个到账的座位按目前的分结回 */
export function stakeFinish(t: StakeTable): StakeTable {
  if (t.over) return t;
  // 等着这副结束的离开也在这里一起结回（paid 还是 yes）
  let out: StakeTable = { ...t, over: true, ...(t.leaving ? { leaving: [false, false, false, false] } : {}) };
  t.book.seats.forEach((s, seat) => {
    if (s.paid === 'yes') out = addOut(out, seat, s.points);
  });
  return out;
}

/**
 * 一笔办完了。result 是房间的 perform 回的：{ ok: true } 或 { ok: false, error }（钱包的业务拒绝；暂时的毛病 perform 自己抛，房间按退避重试）。
 */
export function stakeSettled(t: StakeTable, id: string, result: unknown): StakeTable {
  const e = t.pending.find((x) => x.id === id);
  if (!e) return t;
  const r = (result ?? {}) as { ok?: unknown; error?: unknown };
  const ok = r.ok === true;
  let next: StakeTable = { ...t, pending: t.pending.filter((x) => x.id !== id) };
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

export function stakeView(t: StakeTable, seat: number): StakeView {
  return {
    tier: t.tier,
    deals: t.book.deals,
    seats: t.book.seats.map((s, i) => ({ paid: s.paid, points: s.points, out: t.out[i]! })),
    over: t.over,
    why: seat >= 0 ? (t.why[seat] ?? null) : null,
  };
}
