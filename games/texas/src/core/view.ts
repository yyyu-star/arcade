/**
 * 某个座位能看到的牌桌（DESIGN.md 第 2 节）。房间只发它，电脑也只拿它做决定（src/ai）。
 * 不放：别人没亮的底牌、牌堆、种子；上一手里只有真的亮出来的牌（lastHand.shown）。
 * 下注记录和上一手的结果按字段一个个抄（0.7.1，公平审计）：规则以后往里加了字段，不会顺手带出去（DESIGN.md 4.8）。
 */
import type { Card } from './cards.ts';
import { buildPots, legal, levelOf, type HandResult, type Legal, type LogEntry, type Owner, type Phase, type Status, type Table } from './table.ts';
import type { StakesId } from './stakes.ts';

export interface SeatView {
  owner: Owner;
  persona: number;
  stack: number;
  bet: number;
  total: number;
  status: Status;
  away: boolean;
  leaving: boolean;
  /** 这个座位这一场公开的打法统计（0.5.0，SeatState.seen：发到牌、入池、翻牌前加注、翻牌后下注加注、翻牌后跟注）；还没有就不带 */
  seen?: number[];
}

export interface View {
  rv: number;
  stakes: StakesId;
  sb: number;
  bb: number;
  handNo: number;
  phase: Phase;
  button: number;
  board: Card[];
  toAct: number | null;
  /** 我是哪个座位；没入座的人是 null */
  me: number | null;
  /** 我的底牌；没发牌或没入座是空的 */
  hole: Card[];
  seats: SeatView[];
  /** 这一手池子里一共多少（含这一轮的下注） */
  pot: number;
  /**
   * 已经收进池子的（不含这一轮面前的下注）按主池、边池分开（0.1.1）：有人全下、各人投得不一样时才多于一个。
   * 画面照着摆，不用自己算边池
   */
  pots: number[];
  /** 一手打完停着、等发下一手（0.1.1，规则的 holdHands）：结果还摆在桌上 */
  hold: boolean;
  currentBet: number;
  /** 轮到我时能做什么 */
  legal: Legal | null;
  log: LogEntry[];
  lastHand: HandResult | null;
  /**
   * 我这个座位"上头"还剩几手（0.3.0，DESIGN.md 4.6）：刚一手净输了 TILT_LOSS_BB（40）个大盲以上，接下来 TILT_HANDS（3）手是 3、2、1，平时 0。
   * 只下发自己的，别人的不给；电脑据此松一点、凶一点，画面可以拿来配表情
   */
  tilt: number;
  /** 这一桌电脑的强弱档（0.5.0，规则的 levelOf）：电脑按它定功力，不按档位 */
  level: number;
  /** 我这个座位这一场的状态和坐下时的筹码（0.5.0，SeatState.form / start）：只下发自己的，电脑据此浮动、看领先落后 */
  form?: number[];
  start?: number;
}

export function view(t: Table, me: number | null): View {
  return {
    rv: t.rv,
    stakes: t.stakes,
    sb: t.sb,
    bb: t.bb,
    handNo: t.handNo,
    phase: t.phase,
    button: t.button,
    board: [...t.board],
    toAct: t.toAct,
    me,
    hole: me === null ? [] : [...(t.seats[me]?.hole ?? [])],
    seats: t.seats.map((s) => ({
      owner: s.owner,
      persona: s.persona,
      stack: s.stack,
      bet: s.bet,
      total: s.total,
      status: s.status,
      away: s.away,
      leaving: s.leaving,
      ...(s.seen ? { seen: [...s.seen] } : {}),
    })),
    pot: t.seats.reduce((a, s) => a + s.total, 0),
    pots: buildPots(
      t.seats.map((s) => s.total - s.bet),
      t.seats.map((s) => s.status === 'active' || s.status === 'allin'),
    ).map((p) => p.amount),
    hold: t.hold === true,
    currentBet: t.currentBet,
    legal: me === null ? null : legal(t, me),
    log: t.log.map(logEntry),
    lastHand: t.lastHand && handResult(t.lastHand),
    tilt: me === null ? 0 : (t.seats[me]?.tilt ?? 0),
    level: levelOf(t),
    ...(me !== null && t.seats[me]?.form ? { form: [...t.seats[me]!.form!] } : {}),
    ...(me !== null && t.seats[me]?.start ? { start: t.seats[me]!.start! } : {}),
  };
}

function logEntry(e: LogEntry): LogEntry {
  return { seat: e.seat, act: e.act, amount: e.amount, ...(e.allin ? { allin: true } : {}), ...(e.auto ? { auto: true } : {}) };
}

function handResult(h: HandResult): HandResult {
  return {
    handNo: h.handNo,
    board: [...h.board],
    shown: h.shown.map((x) => ({ seat: x.seat, hole: [...x.hole], value: x.value })),
    pots: h.pots.map((p) => ({ amount: p.amount, winners: p.winners.map((w) => ({ seat: w.seat, won: w.won })) })),
    uncalled: h.uncalled && { seat: h.uncalled.seat, amount: h.uncalled.amount },
    byFold: h.byFold,
  };
}
