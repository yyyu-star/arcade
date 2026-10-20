/**
 * 斗地主的联机房间规则（牌馆 ⑤⑥，设计 docs/doudizhu.md 第 1、5 节）：娱乐，或带档位的实盘（stake.ts）。纯函数，房间和浏览器共用。
 * 它不是独立的 RoomGame：一个房间类同时开掼蛋和斗地主，由 src/net/hall.ts 按状态里的 variant 把调用转进来。
 *
 * - 状态 DdzNet：完整牌局 g + 这一步的事件 ev + 结算页谁点了"继续"。联机只用 256 位密钥发牌（createDdzKeyed），状态里没有种子。
 * - 操作 DdzNetAction：叫分 / 出牌 / 不要 / 继续 / 我回来了；座位由房间按连接认，不带在操作里。
 * - 一副结束等真人点"继续"（READY_MS），电脑和托管座位由房间立刻代点，没点的真人到点代点；最后一个人点完的那一步里开下一副。
 *   整场（deals 副）打完房间就结束，没有"再来一场"。
 * - 视图 DdzNetView：viewDdz(座位) + 这一步的事件 + 谁准备好了。没入座是座位 -1 的公开视图，不带任何手牌。
 *   斗地主的事件（叫分、出牌、地主、底牌）全是公开信息，不用按座位裁剪。
 * - 错误码：核心给的就是固定短码（not_your_turn、bad_bid、too_small……）。
 */
import type { Entropy } from 'arcade-kit/rng';
import { DDZ_ROOM_OPTS, type TierId } from '../stake/index.ts';
import { stream } from 'arcade-kit/rng';
import type { FunBot, FunEvent, FunTemper } from 'arcade-kit/fun-logic';
import {
  DDZ_FUN,
  DDZ_SEATS,
  actorsDdz,
  createDdzKeyed,
  decideDdz,
  isBombish,
  dispatchDdz,
  timeoutDdz,
  turnMsDdz,
  viewDdz,
  type DdzAction,
  type DdzEvent,
  type DdzState,
  type DdzView,
} from './../index.ts';
import type { Card } from '../../../core/cards.ts';

import { canRebuy, stakeBegin, stakeDeal, stakeFinish, stakeRebuy, stakeSeated, stakeSettled, stakeView, type DdzStakeTable, type DdzStakeView } from './stake.ts';

export interface DdzNet {
  /** 玩法的标记：房间按它把调用转给斗地主（掼蛋的状态没有这一项） */
  variant: 'ddz';
  g: DdzState;
  /** 最近一步的事件（全是公开的） */
  ev: DdzEvent[];
  /** 一副结束时各座位点没点"继续"；其他时候 null */
  ready: boolean[] | null;
  /** 每个座位现在是不是真人 */
  humans?: boolean[];
  /** 每个座位连着被房间代出了几手（走开了的判断，同掼蛋 0.6.3） */
  idle?: number[];
  /** 实盘房间的桌（stake.ts）；娱乐房间没有 */
  stake?: DdzStakeTable;
}

/** idle：这一手是房间到点代出的（只有 timeout 会带；浏览器发来的经过 parse 不会有） */
export type DdzNetAction = (
  | { type: 'bid'; bid: number }
  | { type: 'play'; cards: Card[] }
  | { type: 'pass' }
  | { type: 'ready' }
  | { type: 'back' }
  | { type: 'buyin' }
) & { idle?: true };

export interface DdzNetView {
  variant: 'ddz';
  view: DdzView;
  events: DdzEvent[];
  ready: boolean[] | null;
  /** 每个座位是不是走开了、房间在替他快速代出 */
  afk?: boolean[];
  /** 实盘房间：每个座位的分和到账（被拒的原因只给自己） */
  stake?: DdzStakeView;
}

/** 结算页等大家点"继续"最多多久 */
export const DDZ_READY_MS = 20_000;
/** 连着 IDLE_AFTER 手到点被代出就算走开，之后每手只等 IDLE_MS */
export const DDZ_IDLE_AFTER = 2;
export const DDZ_IDLE_MS = 3_000;

/** 电脑的名字（登记在平台的保留名里）和互动性格：老周高冷、王姐爱闹 */
export const DDZ_BOTS: readonly { name: string; temper: FunTemper }[] = [
  { name: '老周', temper: 'cool' },
  { name: '王姐', temper: 'rowdy' },
];

const isInt = (x: unknown, lo: number, hi: number): x is number => typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi;

/** 斗地主自己认的操作；别的（掼蛋的进贡、还贡……）不认，回 null */
export function parseDdzAction(raw: unknown): DdzNetAction | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  switch (r.type) {
    case 'bid':
      return isInt(r.bid, 0, 3) ? { type: 'bid', bid: r.bid } : null;
    case 'pass':
      return { type: 'pass' };
    case 'ready':
      return { type: 'ready' };
    case 'back':
      return { type: 'back' };
    case 'buyin':
      return { type: 'buyin' };
    case 'play': {
      const cards = r.cards;
      if (!Array.isArray(cards) || cards.length < 1 || cards.length > 20 || !cards.every((c) => isInt(c, 0, 53))) return null;
      if (new Set(cards).size !== cards.length) return null;
      return { type: 'play', cards: [...cards] as Card[] };
    }
    default:
      return null;
  }
}

/** 联机开局：用房间给的熵发牌（不用种子，32 位种子能被反推全桌的牌） */
export function ddzBegin(entropy: Entropy, setup?: { seats: ('empty' | 'human' | 'ai')[]; opts?: { stake?: TierId | null } }): DdzNet {
  const tier = setup?.opts?.stake ?? null;
  const { state, events } = createDdzKeyed(entropy, tier ? DDZ_ROOM_OPTS : DDZ_FUN);
  const out: DdzNet = { variant: 'ddz', g: state, ev: events, ready: null };
  if (setup) {
    out.humans = setup.seats.slice(0, DDZ_SEATS).map((k) => k === 'human');
    out.idle = [0, 0, 0];
    if (tier) out.stake = stakeBegin(entropy, tier, setup.seats.slice(0, DDZ_SEATS));
  }
  return out;
}

/** 房间里电脑的随机流：从牌局密钥另分一条（用途 room-ai，序号是步数），和发牌的流互不相干；不能把密钥本身给电脑 */
function aiSeed(g: DdzState): number | string {
  return g.key ? stream(g.key, 'room-ai', g.step).u32() : `${g.seed}|room`;
}

const isAfk = (s: DdzNet, seat: number): boolean => (s.idle?.[seat] ?? 0) >= DDZ_IDLE_AFTER;

function countIdle(s: DdzNet, seat: number, idle: boolean): DdzNet {
  if (!s.idle) return s;
  const n = idle ? s.idle[seat]! + 1 : 0;
  return n === s.idle[seat] ? s : { ...s, idle: s.idle.map((x, i) => (i === seat ? n : x)) };
}

function step(s: DdzNet, a: DdzAction): DdzNet | { error: string } {
  const r = dispatchDdz(s.g, a);
  if (r.error) return { error: r.error };
  const out: DdzNet = { variant: 'ddz', g: r.state, ev: r.events, ready: r.state.phase === 'dealEnd' ? [false, false, false] : null };
  if (s.humans) out.humans = s.humans;
  if (s.idle) out.idle = s.idle;
  if (s.stake) {
    let t = s.stake;
    for (const e of r.events) if (e.type === 'dealEnd') t = stakeDeal(t, e.result, r.state.dealNo, r.state.phase);
    out.stake = t;
  }
  return out;
}

function applyAction(s: DdzNet, seat: number, a: DdzNetAction): DdzNet | { error: string } {
  switch (a.type) {
    case 'back':
      return isAfk(s, seat) ? { ...s, ev: [] } : { error: 'not_away' };
    case 'ready': {
      if (s.g.phase !== 'dealEnd' || !s.ready) return { error: 'wrong_phase' };
      if (s.ready[seat]) return { error: 'already_ready' };
      const ready = s.ready.map((r, i) => r || i === seat);
      // 最后一个人点完：这一步里直接开下一副
      if (ready.every(Boolean)) return step(s, { type: 'next' });
      return { ...s, ev: [], ready };
    }
    case 'buyin':
      if (!s.stake || !canRebuy(s.stake, seat)) return { error: 'cannot_buyin' };
      return { ...s, ev: [], stake: stakeRebuy(s.stake, seat) };
    case 'bid':
      return step(s, { type: 'bid', seat, bid: a.bid });
    case 'play':
      return step(s, { type: 'play', seat, cards: a.cards });
    case 'pass':
      return step(s, { type: 'pass', seat });
  }
}

export function ddzApply(s: DdzNet, seat: number, a: DdzNetAction): DdzNet | { error: string } {
  if (seat < 0 || seat >= DDZ_SEATS) return { error: 'not_seated' };
  const out = applyAction(s, seat, a);
  return 'error' in out ? out : countIdle(out, seat, a.idle === true);
}

const notReady = (s: DdzNet): number[] => (s.ready ? [0, 1, 2].filter((i) => !s.ready![i]) : []);

export function ddzActors(s: DdzNet): { seats: number[]; group: string } {
  if (s.g.phase === 'dealEnd') return { seats: notReady(s), group: `settle-${s.g.dealNo}` };
  return actorsDdz(s.g);
}

export function ddzTurnMs(s: DdzNet): number {
  const seats = ddzActors(s).seats;
  if (seats.length && seats.every((x) => isAfk(s, x))) return DDZ_IDLE_MS;
  return s.g.phase === 'dealEnd' ? DDZ_READY_MS : turnMsDdz(s.g);
}

export function ddzView(s: DdzNet, seat: number | null): DdzNetView {
  const me = seat ?? -1;
  const v: DdzNetView = { variant: 'ddz', view: viewDdz(s.g, me), events: s.ev, ready: s.ready };
  if (s.idle) v.afk = s.idle.map((_, i) => isAfk(s, i));
  if (s.stake) v.stake = stakeView(s.stake, me);
  return v;
}

function withoutSeat(a: DdzAction): DdzNetAction {
  switch (a.type) {
    case 'bid':
      return { type: 'bid', bid: a.bid };
    case 'play':
      return { type: 'play', cards: a.cards };
    default:
      return { type: 'pass' };
  }
}

/** 电脑出手：普通档；只看自己座位的视图，种子按用途派生 */
export function ddzAi(s: DdzNet, seat: number): DdzNetAction {
  if (s.g.phase === 'dealEnd') return { type: 'ready' };
  const v = viewDdz(s.g, seat);
  const a = decideDdz(v, s.stake ? 'pro' : 'normal', aiSeed(s.g));
  if (a) return withoutSeat(a);
  const t = timeoutDdz(v);
  return t ? withoutSeat(t) : { type: 'pass' };
}

/** 到点代出都带 idle 记号，apply 拿它数"连着几手没自己出" */
export function ddzTimeout(s: DdzNet, seat: number): DdzNetAction {
  if (s.g.phase === 'dealEnd') return { type: 'ready', idle: true };
  const t = timeoutDdz(viewDdz(s.g, seat));
  return { ...(t ? withoutSeat(t) : ddzAi(s, seat)), idle: true };
}

export function ddzSeated(s: DdzNet, seat: number, kind: 'human' | 'ai'): DdzNet {
  if (!s.humans || seat >= DDZ_SEATS) return s;
  // ev 清空：这一步不是出牌，别让 onStep 再看一遍上一步的事件
  const stake = s.stake ? stakeSeated(s.stake, seat, kind, s.g.phase) : undefined;
  return { ...s, ev: [], humans: s.humans.map((h, i) => (i === seat ? kind === 'human' : h)), ...(stake ? { stake } : {}) };
}

/** 实盘房间的收尾：关房时还没结束的一场就地结回；钱包办完一笔记下结果 */
export const ddzClosing = (s: DdzNet): DdzNet => (s.stake && !s.stake.over ? { ...s, ev: [], stake: stakeFinish(s.stake) } : s);
export const ddzSettled = (s: DdzNet, id: string, result: unknown): DdzNet => (s.stake ? { ...s, ev: [], stake: stakeSettled(s.stake, id, result) } : s);
export const ddzEffects = (s: DdzNet): DdzStakeTable['pending'] => s.stake?.pending ?? [];

/** 整场打完，或者一个真人都没了（实盘房间要等在办的带入和等着结回的离开办完） */
export const ddzOver = (s: DdzNet): boolean =>
  s.g.phase === 'gameOver' ||
  s.stake?.over === true ||
  (s.humans !== undefined && !s.humans.some(Boolean) && !s.stake?.pending.some((e) => e.kind === 'in') && !s.stake?.leaving?.some(Boolean));

/** 房间里的电脑和它们的互动性格：按电脑座位的先后依次给老周、王姐（替掉线真人代打的座位不算） */
export function ddzFunBots(s: DdzNet): FunBot[] {
  if (!s.humans) return [];
  const out: FunBot[] = [];
  let k = 0;
  for (let seat = 0; seat < DDZ_SEATS; seat++) {
    if (s.humans[seat]) continue;
    out.push({ seat, temper: DDZ_BOTS[k % DDZ_BOTS.length]!.temper });
    k++;
  }
  return out;
}

/**
 * 这一步里的名场面（只做基础的两种，给 kit 的 botReact 起哄用）：炸弹 / 王炸；一副打出春天（地主一手没让农民出，或农民逼地主只出一手）。
 * 地主这边和农民那边互为对手
 */
export function ddzMoments(s: DdzNet): Extract<FunEvent, { kind: 'moment' }>[] {
  const out: Extract<FunEvent, { kind: 'moment' }>[] = [];
  const land = s.g.landlord;
  const side = (seat: number): { winners: number[]; losers: number[] } => {
    const farmers = [0, 1, 2].filter((x) => x !== land);
    return seat === land ? { winners: [land], losers: farmers } : { winners: farmers, losers: [land] };
  };
  for (const e of s.ev) {
    if (e.type === 'play' && isBombish(e.play)) {
      const { losers } = side(e.seat);
      out.push({ kind: 'moment', moment: 'bomb', winners: [e.seat], losers, hand: s.g.dealNo });
    } else if (e.type === 'dealEnd' && e.result.spring) {
      const w = e.result.landlordWon ? e.result.landlord : -1;
      const { winners, losers } = side(w >= 0 ? w : (e.result.landlord + 1) % DDZ_SEATS);
      out.push({ kind: 'moment', moment: 'big-win', winners, losers, hand: s.g.dealNo });
    }
  }
  return out;
}
