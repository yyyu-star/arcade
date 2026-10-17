/**
 * 视角旋转：房间按真实座位号发视图，浏览器统一转成"我 = 0"再画，画面层的 ME = 0 假设不用动（docs/platform-backend.md 9.1）。
 *
 * 座位 s → (s - 我 + 4) % 4。转了奇数格时两队的位置互换（队伍 = 座位 % 2），所以按队记的东西（级数、打 A 失败次数、
 * 本副打哪队的级、赢家队伍……）要跟着对调。这一步最容易错，tests/net.test.ts 覆盖转 0–3 格。
 * 发给房间的操作不带座位，不用转回去；只有选座（sit）用真实座位号，见 toReal。
 */
import type { DealResult, GameEvent, NextPreview, PlayerView } from '../core/index.ts';
import type { NetView } from './rules.ts';

export interface Rot {
  /** 真实座位 → 画面座位 */
  seat(s: number): number;
  /** 真实队伍 → 画面队伍 */
  team(t: number): number;
  /** 按真实座位排的数组 → 按画面座位排 */
  bySeat<T>(arr: readonly T[]): T[];
  /** 按真实队伍排的两元组 → 按画面队伍排 */
  byTeam<T>(pair: readonly [T, T]): [T, T];
}

export function rotation(me: number): Rot {
  const off = ((me % 4) + 4) % 4;
  const swap = off % 2 === 1;
  const seat = (s: number): number => (s < 0 ? s : (s - off + 4) % 4);
  const team = (t: number): number => (t < 0 || !swap ? t : 1 - t);
  return {
    seat,
    team,
    bySeat: <T>(arr: readonly T[]) => {
      const out = new Array<T>(arr.length);
      arr.forEach((x, s) => (out[seat(s)] = x));
      return out;
    },
    byTeam: <T>(pair: readonly [T, T]) => (swap ? [pair[1], pair[0]] : [pair[0], pair[1]]),
  };
}

/** 画面座位 → 真实座位（选座时用） */
export function toReal(me: number, shown: number): number {
  return (shown + me) % 4;
}

function rotDeal(d: DealResult, r: Rot): DealResult {
  return {
    ...d,
    order: d.order.map(r.seat),
    winnerTeam: r.team(d.winnerTeam),
    levelsBefore: r.byTeam(d.levelsBefore),
    levelsAfter: r.byTeam(d.levelsAfter),
    aFailedTeam: r.team(d.aFailedTeam),
    aResetTeam: r.team(d.aResetTeam),
  };
}

export function rotateView(v: PlayerView, r: Rot): PlayerView {
  return {
    ...v,
    seat: r.seat(v.seat),
    declarer: r.team(v.declarer),
    levels: r.byTeam(v.levels),
    aFails: r.byTeam(v.aFails),
    counts: r.bySeat(v.counts),
    turn: r.seat(v.turn),
    toAct: v.toAct.map(r.seat),
    trick: {
      leader: r.seat(v.trick.leader),
      last: v.trick.last ? { seat: r.seat(v.trick.last.seat), play: v.trick.last.play } : null,
      passed: r.bySeat(v.trick.passed),
    },
    finished: v.finished.map(r.seat),
    history: v.history.map((h) => ({ ...h, seat: r.seat(h.seat) })),
    tribute: v.tribute
      ? {
          kind: v.tribute.kind,
          leader: r.seat(v.tribute.leader),
          entries: v.tribute.entries.map((e) => ({ ...e, from: r.seat(e.from), to: r.seat(e.to) })),
        }
      : null,
    myTribute: v.myTribute ? { ...v.myTribute, to: r.seat(v.myTribute.to) } : null,
    lastDeal: v.lastDeal ? rotDeal(v.lastDeal, r) : null,
    winner: r.team(v.winner),
  };
}

function rotateEvent(e: GameEvent, r: Rot): GameEvent {
  switch (e.type) {
    case 'dealStart':
      return { ...e, declarer: r.team(e.declarer), levels: r.byTeam(e.levels) };
    case 'antiTribute':
      return { ...e, seats: e.seats.map(r.seat) };
    case 'tributeAsked':
      return { ...e, payers: e.payers.map(r.seat) };
    case 'tribute':
    case 'returnCard':
      return { ...e, from: r.seat(e.from), to: r.seat(e.to) };
    case 'lead':
    case 'pass':
    case 'turn':
    case 'finish':
      return { ...e, seat: r.seat(e.seat) };
    case 'play':
      return { ...e, seat: r.seat(e.seat) };
    case 'trickWon':
      return { ...e, seat: r.seat(e.seat), leader: r.seat(e.leader) };
    case 'dealEnd':
      return { ...e, result: rotDeal(e.result, r) };
    case 'gameOver':
      return { ...e, winner: r.team(e.winner), levels: r.byTeam(e.levels) };
  }
}

function rotatePreview(p: NextPreview | null, r: Rot): NextPreview | null {
  return p ? { anti: p.anti, payers: p.payers.map(r.seat), to: r.seat(p.to) } : null;
}

/** 整个网络视图转成"我 = 0" */
export function rotateNetView(nv: NetView, me: number): NetView {
  const r = rotation(me);
  const out: NetView = { view: rotateView(nv.view, r), events: nv.events.map((e) => rotateEvent(e, r)), next: rotatePreview(nv.next, r), ready: nv.ready ? r.bySeat(nv.ready) : null };
  // 实盘的每个座位的账（0.5.0）：和 ready 一样按座位排
  if (nv.stake) out.stake = { ...nv.stake, seats: r.bySeat(nv.stake.seats) };
  // 再来一场（0.6.2）：谁点的换成画面座位，房间码不动
  if (nv.again !== undefined) out.again = nv.again && { code: nv.again.code, by: r.seat(nv.again.by) };
  if (nv.afk) out.afk = r.bySeat(nv.afk);
  // 这一场的记录（0.14.0）：按座位的转座位，赢的副数按队转
  if (nv.log) {
    const m = nv.log;
    out.log = { deals: m.deals, firsts: r.bySeat(m.firsts), lasts: r.bySeat(m.lasts), bombs: r.bySeat(m.bombs), wins: r.byTeam(m.wins as [number, number]) };
    if (m.places) out.log.places = r.bySeat(m.places);
  }
  return out;
}
