/**
 * 机器人对打（测试和 scripts/sim.ts 共用）：一桌全是"真人座位"，每个座位按指定的性格由电脑出手，
 * 输光了补满买入，再穿插超时、暂离、离桌重坐，覆盖规则里的各条路径。每一步都核对筹码守恒和"总有人能说话"。
 */
import { stream, type Entropy } from 'arcade-kit/rng';
import { aiAction } from '../src/bot.ts';
import { stakesOf, type StakesId } from '../src/core/stakes.ts';
import { addChips, apply, deal, isFail, newTable, paid, PERSONA_COUNT, seatHouse, seatPlayer, type Action, type Table } from '../src/core/table.ts';
import { view } from '../src/core/view.ts';
import type { Strategy } from './strategies.ts';

export interface BotStats {
  hands: number;
  actions: number;
  /** 每种性格：打了几手、净赢多少筹码（按大盲算的输赢在 sim 里换算） */
  byPersona: { hands: number; net: number }[];
  /** 每次电脑决策的耗时（毫秒） */
  decideMs: number[];
  /** 两次"第 0 座"说话之间电脑连着出手的耗时（模拟房间里的一批） */
  batchMs: number[];
  /** 规则每做一步（apply，含复制状态）的耗时 */
  applyMs: number[];
}

export interface BotOptions {
  seed: Entropy;
  size: number;
  hands: number;
  stakes?: StakesId;
  /** 每个座位的性格；默认按座位号轮 */
  personas?: number[];
  /** 每一步之后调用（测试用来核对守恒、隐藏信息） */
  onStep?: (t: Table) => void;
  /** 穿插超时、暂离、离桌（默认开） */
  chaos?: boolean;
  /**
   * 赢多了下桌（sim 的混桌用，0.3.0）：每手开始时筹码超过 cashOut × 买入上限的，多出来的当作带走（从买入里扣），
   * 不然 2,000 手里赢家的筹码越滚越深，底池平均上百个大盲，每百手的误差大到比不出性格
   */
  cashOut?: number;
  timing?: boolean;
}

export function runBots(o: BotOptions): BotStats {
  const st = stakesOf(o.stakes ?? 'small');
  const personas = o.personas ?? Array.from({ length: o.size }, (_, i) => i % PERSONA_COUNT);
  const chaos = o.chaos ?? true;
  const r = stream(o.seed, 'bots');
  let t = newTable(st.id, o.size, o.seed);
  const bought = new Array<number>(o.size).fill(0);
  const handsBy = new Array<number>(o.size).fill(0);
  const sit = (seat: number): void => {
    t = ok(seatPlayer(t, seat, st.max));
    t.seats[seat]!.persona = personas[seat]!;
    bought[seat]! += st.max;
  };
  for (let i = 0; i < o.size; i++) {
    t.seats[i]!.owner = 'player';
    t.seats[i]!.persona = personas[i]!;
    t.seats[i]!.stack = st.max;
    t.bank += st.max;
    bought[i] = st.max;
  }
  t = deal(t);
  const stats: BotStats = { hands: 0, actions: 0, byPersona: Array.from({ length: PERSONA_COUNT }, () => ({ hands: 0, net: 0 })), decideMs: [], batchMs: [], applyMs: [] };
  let batch = 0;
  let guard = 0;
  let lastHand = t.handNo;
  while (t.handNo <= o.hands) {
    if (++guard > o.hands * 400) throw new Error(`stuck at hand ${t.handNo}`);
    if (t.handNo !== lastHand) {
      for (const [i, s] of t.seats.entries()) if (s.status !== 'out') handsBy[i]!++;
      // 盲注已经交了，这一手还没人说话：减掉台面后面的筹码等于上一手打完就带走了，守恒照样成立
      if (o.cashOut)
        for (const [i, s] of t.seats.entries()) {
          const extra = s.stack - o.cashOut * st.max;
          if (extra > 0) {
            s.stack -= extra;
            t.bank -= extra;
            bought[i]! -= extra;
          }
        }
      lastHand = t.handNo;
    }
    // 输光的人不等这一手打完就补码（他不在这一手里），下一手接着打
    for (let i = 0; i < o.size; i++) {
      const seat = t.seats[i]!;
      if (seat.owner === 'player' && seat.stack === 0 && seat.status === 'out' && !seat.leaving) {
        t = ok(addChips(t, i, st.max));
        bought[i]! += st.max;
      }
    }
    const s = t.toAct;
    if (s === null) {
      // 空闲：输光的补满、暂离的回来、空座有人坐下
      if (t.phase !== 'idle') throw new Error('nobody to act mid-hand');
      let changed = false;
      for (let i = 0; i < o.size; i++) {
        const seat = t.seats[i]!;
        if (seat.owner === 'none') {
          sit(i);
          changed = true;
        } else if (seat.stack === 0) {
          t = ok(addChips(t, i, st.max));
          bought[i]! += st.max;
          changed = true;
        } else if (seat.away) {
          t = ok(apply(t, i, { t: 'back' }));
          changed = true;
        }
      }
      if (!changed) throw new Error('idle with nothing to do');
      o.onStep?.(t);
      continue;
    }
    let a: Action;
    const roll = chaos ? r.below(1000) : 1000;
    if (roll < 15) a = { t: 'timeout' };
    else if (roll < 18) a = { t: 'leave' };
    else if (roll < 20) a = { t: 'away' };
    else {
      const t0 = o.timing ? performance.now() : 0;
      a = aiAction(t, s);
      if (o.timing) {
        const ms = performance.now() - t0;
        stats.decideMs.push(ms);
        batch += ms;
      }
    }
    if (o.timing && s === 0) {
      stats.batchMs.push(batch);
      batch = 0;
    }
    const t1 = o.timing ? performance.now() : 0;
    t = ok(apply(t, s, a));
    if (o.timing) stats.applyMs.push(performance.now() - t1);
    stats.actions++;
    // 离桌的筹码马上"结回钱包"：从这个座位的买入里扣掉，之后空座有人重新买入
    for (const p of t.out) {
      bought[p.seat]! -= p.amount;
      t = paid(t, p.id);
    }
    o.onStep?.(t);
  }
  stats.hands = t.handNo - 1;
  for (let i = 0; i < o.size; i++) {
    const p = stats.byPersona[personas[i]!]!;
    p.hands += handsBy[i]!;
    p.net += t.seats[i]!.stack + t.seats[i]!.total - bought[i]!;
  }
  return stats;
}

function ok(x: Table | { error: string }): Table {
  if (isFail(x)) throw new Error(`bot made an illegal move: ${x.error}`);
  return x;
}

/**
 * 一个"玩家"对一桌电脑（和单机一样：电脑先按 putHouse 坐满，玩家坐 0 号、买满 100 个大盲，输光了补满）。
 * 打 hands 手，返回玩家净赢多少大盲（千分之一个大盲为单位取整，免得小数）和电脑的性格出场次数。
 * humans（0.4.0，好友房）：前几个座位都是玩家、用同一种打法，返回他们合起来的净赢；strong：电脑一律最强（规则的 strong）
 */
export function runVs(o: {
  seed: Entropy;
  stakes: StakesId;
  size: number;
  hands: number;
  strategy: Strategy;
  /** 调参用：把电脑的性格钉死成这一种（每手开始时改，换人后也改回来） */
  persona?: number;
  /** 每一步之后调用（sim 用来数整桌的热闹程度） */
  onStep?: (t: Table) => void;
  humans?: number;
  strong?: boolean;
}): { mbb: number; personas: number[] } {
  const st = stakesOf(o.stakes);
  const humans = o.humans ?? 1;
  let t = newTable(st.id, o.size, o.seed, o.strong ? { strong: true } : {});
  for (let i = humans; i < o.size; i++) t = ok(seatHouse(t, i));
  for (let i = 0; i < humans; i++) t = ok(seatPlayer(t, i, st.max, i === humans - 1));
  let bought = st.max * humans;
  const personas = new Array<number>(PERSONA_COUNT).fill(0);
  let lastHand = -1;
  let guard = 0;
  while (t.handNo <= o.hands) {
    if (++guard > o.hands * 400) throw new Error(`stuck at hand ${t.handNo}`);
    if (t.handNo !== lastHand) {
      for (const s of t.seats)
        if (s.owner === 'house') {
          if (o.persona !== undefined) s.persona = o.persona;
          personas[s.persona]!++;
        }
      lastHand = t.handNo;
    }
    // 输光的玩家补满（一个人桌上只剩他时，补完马上开下一手；不然等下一手发牌）
    const broke = t.seats.findIndex((x, i) => i < humans && x.stack === 0 && x.status === 'out');
    if (broke >= 0) {
      t = ok(addChips(t, broke, st.max, t.toAct === null));
      bought += st.max;
      continue;
    }
    const s = t.toAct;
    if (s === null) throw new Error(`no one to act at hand ${t.handNo}`);
    // 第一个玩家的随机流沿用原来的名字，原来的数字不变
    const a = s < humans ? o.strategy(view(t, s), stream(o.seed, s === 0 ? 'player' : `player${s}`, t.handNo * 0x20000 + t.log.length)) : aiAction(t, s);
    t = ok(apply(t, s, a));
    o.onStep?.(t);
  }
  const mine = t.seats.slice(0, humans).reduce((a, x) => a + x.stack + x.total, 0);
  return { mbb: Math.round(((mine - bought) * 1000) / st.bb), personas };
}
