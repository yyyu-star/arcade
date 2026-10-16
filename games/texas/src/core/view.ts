/**
 * 某个座位能看到的牌桌（DESIGN.md 第 2 节）。房间只发它，电脑也只拿它做决定（src/ai）。
 * 不放：别人没亮的底牌、牌堆、种子；上一手里只有真的亮出来的牌（lastHand.shown）。
 */
import type { Card } from './cards.ts';
import { buildPots, legal, type HandResult, type Legal, type LogEntry, type Owner, type Phase, type Status, type Table } from './table.ts';
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
  /** 电脑一律最强（0.4.0，好友房，规则的 strong）：电脑的功力按豪华桌算，不按这一桌的档位 */
  strong?: boolean;
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
    })),
    pot: t.seats.reduce((a, s) => a + s.total, 0),
    pots: buildPots(
      t.seats.map((s) => s.total - s.bet),
      t.seats.map((s) => s.status === 'active' || s.status === 'allin'),
    ).map((p) => p.amount),
    hold: t.hold === true,
    currentBet: t.currentBet,
    legal: me === null ? null : legal(t, me),
    log: t.log.map((e) => ({ ...e })),
    lastHand: t.lastHand && structuredClone(t.lastHand),
    tilt: me === null ? 0 : (t.seats[me]?.tilt ?? 0),
    ...(t.strong ? { strong: true } : {}),
  };
}
