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
import type { SeatKind } from 'arcade-kit/protocol';
import { stream, type Entropy } from 'arcade-kit/rng';
import { stakeTableKit, type TableEffect, type TableView } from '../../../net/stake-table.ts';
import type { DealResult, Phase, PlayRecord } from '../core/index.ts';
import { emptyTally, statsOf, tallyDeal, type SettleStats, type Tally } from '../stake/stats.ts';
import { isTier, newRoomBook, payout, roomAddDeal, roomOver, roomRef, type RoomBook, type TierId } from '../stake/index.ts';

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
export type StakeEffect = TableEffect<SettleStats>;

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
export type StakeView = TableView;

/** 一副打到一半（进贡、还贡、出牌）：这时离开要等这一副打完再结回 */
const midDeal = (phase: string | undefined): boolean => phase === 'tribute' || phase === 'return' || phase === 'play';

const kit = stakeTableKit<SettleStats, Tally>({ seats: 4, payout, midDeal, tally: { empty: emptyTally, stats: statsOf } });

/** 这一场的 ref：从牌局密钥另分一条流取 64 位（和发牌的流互不相干，看到 ref 也推不出牌） */
export function stakeRef(key: Entropy): string {
  const r = stream(key, 'stake-ref');
  return roomRef([r.u32(), r.u32()].map((x) => x.toString(16).padStart(8, '0')).join(''));
}

/** 座位现在这一份的 ref（钱包按它分开好几份） */
export const shareRef = (t: StakeTable, seat: number): string => kit.shareRef(t, seat);

export function stakeBegin(key: Entropy, tier: TierId, seats: readonly SeatKind[]): StakeTable {
  const t: StakeTable = {
    tier, ref: stakeRef(key), book: newRoomBook(tier), pending: [], over: false, why: [null, null, null, null], out: [false, false, false, false],
    tally: [0, 1, 2, 3].map(emptyTally),
    share: [0, 0, 0, 0],
  };
  const humans = [0, 1, 2, 3].filter((i) => seats[i] === 'human');
  if (humans.length < 2) return kit.needTwo(t, humans);
  return humans.reduce((a, i) => kit.addIn(a, i), t);
}

/**
 * 座位换人：接管开局时就是电脑、从没带入过的座位要带入；到账（或带入在办）的人离开要结回——一副打到一半的等这副结束（stakeDeal），
 * 两副之间的当场；走了又回来的再带入一份。phase 是牌局现在的阶段
 */
export const stakeSeated = (t: StakeTable, seat: number, kind: 'human' | 'ai', phase?: Phase): StakeTable => kit.seated(t, seat, kind, phase);

/** 能不能（再）带入一份：这一场没完、这个座位离开过或带入被拒、没有在路上的带入；开局真人不到 2 个的桌整场不计输赢 */
export const canRebuy = (t: StakeTable, seat: number): boolean => kit.canRebuy(t, seat);

/** 点了"重新带入"（带入被拒以后）：能带就带一份，不能就原样 */
export const stakeRebuy = (t: StakeTable, seat: number): StakeTable => kit.rebuy(t, seat);

/** 一副结束：记账（战绩小结只记到账的座位）；一场结束就记下每个到账座位的结回。history 是这一副的出牌记录 */
export function stakeDeal(t: StakeTable, r: DealResult, phase: Phase, history: readonly PlayRecord[] = []): StakeTable {
  if (t.over || r.dealNo !== t.book.deals + 1) return t;
  const tally = t.tally?.map((x, seat) => (t.book.seats[seat]!.paid === 'yes' ? tallyDeal(x, r, history, seat, t.tier) : x));
  // 这一副打到一半离开的：这副算完了，按现在的分结回
  const next = kit.leaveDone<StakeTable>({ ...t, book: roomAddDeal(t.book, r), ...(tally ? { tally } : {}) });
  return roomOver(next.book, phase) ? kit.finish(next) : next;
}

/** 这一场就地结束（打完，或者关房）：每个到账的座位按目前的分结回 */
export const stakeFinish = (t: StakeTable): StakeTable => kit.finish(t);

/** 一笔办完了。result 是房间的 perform 回的：{ ok: true } 或 { ok: false, error }（钱包的业务拒绝；暂时的毛病 perform 自己抛，房间按退避重试）。 */
export const stakeSettled = (t: StakeTable, id: string, result: unknown): StakeTable => kit.settled(t, id, result);

export const stakeView = (t: StakeTable, seat: number): StakeView => kit.view(t, seat);

