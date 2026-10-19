import { stream } from 'arcade-kit/rng';
import { describe, expect, it } from 'vitest';
import { isFail } from '../src/core/table.ts';
import {
  BLINDS,
  HANDS_PER_LEVEL,
  START_STACK,
  finishOrder,
  newTour,
  payouts,
  playOut,
  roomPayouts,
  roomPrizes,
  tourAi,
  tourApply,
  tourLeave,
  tourRun,
  tourStep,
  tourView,
  type TourState,
} from '../src/tour/rules.ts';

const seedOf = (g: number): number[] => {
  const e = stream([0x7406, g, 9, 8, 7, 6, 5, 4], 'seed');
  return Array.from({ length: 8 }, () => e.below(0x100000000));
};
const ONE = [true, false, false, false, false, false];
const ALL_BOTS = [false, false, false, false, false, false];

const ok = (x: TourState | { error: string }): TourState => {
  if (isFail(x)) throw new Error(x.error);
  return x;
};
const conserved = (s: TourState): number => s.table.seats.reduce((a, x) => a + x.stack + x.total, 0);

/** 把真人也交给电脑的算法，一步步打（用来代打真人座位），每步回调 */
function drive(s0: TourState, each?: (s: TourState) => void): TourState {
  let s = s0;
  let guard = 0;
  while (!s.over) {
    if (++guard > 100_000) throw new Error('stuck');
    const m = tourAi({ ...s, auto: s.auto.map(() => true) });
    if (!m) throw new Error('no actor');
    s = ok(tourApply(s, m.seat, m.action));
    each?.(s);
  }
  return s;
}

describe('单桌锦标赛：规则核心', () => {
  it('开局：6 人同样的筹码，第一手已发，第一级盲注', () => {
    const s = newTour({ humans: ONE }, seedOf(1));
    expect(s.table.seats.map((x) => x.stack + x.total)).toEqual(new Array(6).fill(START_STACK));
    expect(s.level).toBe(0);
    expect(s.handsInLevel).toBe(1);
    expect([s.table.sb, s.table.bb]).toEqual(BLINDS[0]);
    expect(s.table.handNo).toBe(1);
    expect(s.places).toEqual(new Array(6).fill(null));
  });

  it('同种子同操作结果一致，不同种子不同', () => {
    const a = drive(newTour({ humans: ONE }, seedOf(2)));
    const b = drive(newTour({ humans: ONE }, seedOf(2)));
    const c = drive(newTour({ humans: ONE }, seedOf(3)));
    expect(b).toEqual(a);
    expect(c.places).not.toEqual(a.places);
  });

  it('跑几十场全部能结束；筹码守恒；名次是 1..6 的排列；盲注按表上涨', () => {
    for (let g = 0; g < 40; g++) {
      const s0 = newTour({ humans: g % 2 ? ONE : ALL_BOTS }, seedOf(100 + g));
      let lastHand = 0;
      let lastLevel = 0;
      const s = drive(s0, (x) => {
        expect(conserved(x)).toBe(6 * START_STACK);
        expect(x.table.bank).toBe(6 * START_STACK);
        // 盲注：当前手数对应的级别，只升不降，按表
        expect(x.level).toBeGreaterThanOrEqual(lastLevel);
        lastLevel = x.level;
        if (!x.over) {
          const want = Math.min(BLINDS.length - 1, Math.floor((x.table.handNo - 1) / HANDS_PER_LEVEL));
          expect(x.level).toBe(want);
          expect([x.table.sb, x.table.bb]).toEqual(BLINDS[want]);
        }
        expect(x.table.handNo).toBeGreaterThanOrEqual(lastHand);
        lastHand = x.table.handNo;
      });
      expect(s.over).toBe(true);
      expect([...s.places].sort((a, b) => (a as number) - (b as number))).toEqual([1, 2, 3, 4, 5, 6]);
      expect(s.table.seats[s.places.indexOf(1)]!.stack).toBe(6 * START_STACK);
      expect(finishOrder(s).map((i) => s.places[i])).toEqual([1, 2, 3, 4, 5, 6]);
      expect(tourApply(s, 0, { t: 'check' })).toEqual({ error: 'tour_over' });
    }
  });

  it('一手里多人出局：开始时筹码多的名次靠前，一样多的座位号小的靠前', () => {
    const s0 = newTour({ humans: ONE }, seedOf(5));
    const mk = (stacks: number[], start: number[]): TourState => {
      const s = structuredClone(s0);
      s.table.phase = 'idle';
      s.table.hold = true;
      s.table.toAct = null;
      s.table.seats.forEach((x, i) => {
        x.stack = stacks[i]!;
        x.total = 0;
        x.status = 'out';
        x.hole = [];
      });
      s.startStacks = start;
      return s;
    };
    // 座位 0、1、4 同时出局：开局筹码 900 / 300 / 900；座位 4 和 0 一样多，座位号小的 0 靠前
    const a = tourStep(mk([0, 0, 3000, 3000, 0, 3000], [900, 300, 1500, 1500, 900, 1500]));
    expect(a.places).toEqual([4, 6, null, null, 5, null]);
    expect(a.lastOut).toEqual([0, 4, 1]);
    expect(a.over).toBe(false);
    expect(a.table.handNo).toBe(2);
    // 剩一个人：结束，冠军 1
    const b = tourStep(mk([0, 0, 0, 9000, 0, 0], [100, 200, 300, 8000, 400, 500]));
    expect(b.places).toEqual([6, 5, 4, 1, 3, 2]);
    expect(b.over).toBe(true);
    // 还没停着的状态不处理
    expect(tourStep(s0)).toBe(s0);
  });

  it('电脑和真人走同一条路：多个真人座位，轮到真人时 tourRun 停下', () => {
    const humans = [true, false, true, false, false, true];
    let s = tourRun(newTour({ humans }, seedOf(7)));
    let guard = 0;
    while (!s.over) {
      if (++guard > 100_000) throw new Error('stuck');
      const seat = s.table.toAct!;
      expect(humans[seat]).toBe(true);
      expect(tourAi(s)).toBeNull();
      const m = tourAi({ ...s, auto: s.auto.map(() => true) })!;
      s = tourRun(ok(tourApply(s, seat, m.action)));
    }
    expect(s.places.every((p) => p !== null)).toBe(true);
    expect(tourApply(newTour({ humans }, seedOf(7)), 1, { t: 'check' })).toHaveProperty('error');
  });

  it('锦标赛里不能暂离/回来', () => {
    const s = newTour({ humans: ONE }, seedOf(8));
    expect(tourApply(s, 0, { t: 'away' })).toEqual({ error: 'not_in_tour' });
    expect(tourApply(s, 0, { t: 'back' })).toEqual({ error: 'not_in_tour' });
  });

  it('真人提前离开后剩余对局确定地跑完；离开不改变筹码和名次的合法性', () => {
    for (let g = 0; g < 8; g++) {
      const humans = [true, false, true, false, false, false];
      let s = tourRun(newTour({ humans }, seedOf(200 + g)));
      // 打几步再离开
      for (let k = 0; k < 6 && !s.over; k++) {
        const seat = s.table.toAct!;
        s = tourRun(ok(tourApply(s, seat, tourAi({ ...s, auto: s.auto.map(() => true) })!.action)));
      }
      const left = ok(tourLeave(s, 0));
      expect(left.auto[0]).toBe(true);
      expect(tourLeave(left, 0)).toEqual({ error: 'not_human' });
      expect(tourLeave(left, 1)).toEqual({ error: 'not_human' });
      // 也可以直接用 'leave' 操作
      expect(ok(tourApply(s, 0, { t: 'leave' }))).toEqual(left);
      const a = playOut(s);
      const b = playOut(structuredClone(s));
      expect(a).toEqual(b);
      expect(a.over).toBe(true);
      expect([...a.places].sort((x, y) => (x as number) - (y as number))).toEqual([1, 2, 3, 4, 5, 6]);
      expect(conserved(a)).toBe(6 * START_STACK);
    }
  });

  it('真人出局后可以旁观到结束；tourView 带盲注和名次，不泄露别人的底牌', () => {
    let s = tourRun(newTour({ humans: ONE }, seedOf(9)));
    const v = tourView(s, 0);
    expect(v.blinds).toEqual(BLINDS[0]);
    expect(v.next).toEqual(BLINDS[1]);
    expect(v.handsLeft).toBe(HANDS_PER_LEVEL);
    expect(JSON.stringify(v)).not.toMatch(/"deck"|"seed"/);
    s = playOut(s);
    expect(tourView(s, 0).over).toBe(true);
    expect(tourView(s, null).places).toEqual(s.places);
  });
});

describe('奖金', () => {
  it('payouts：6 人桌前三名 3 / 1.8 / 1.2 份，平均期望 1 份', () => {
    for (const b of [100, 500, 2_000, 10_000]) {
      const p = payouts(b);
      expect(p).toEqual([3 * b, 1.8 * b, 1.2 * b, 0, 0, 0]);
      expect(p.reduce((a, x) => a + x, 0) / 6).toBeCloseTo(b, 6);
    }
    expect(payouts(33).every(Number.isInteger)).toBe(true);
  });

  it('roomPayouts：1 人退报名费；2 人第 1 拿全部；3 人 70/30；4 人以上 50/30/20，零头给第 1', () => {
    expect(roomPayouts([4], 500)).toEqual([500]);
    expect(roomPayouts([4, 2], 500)).toEqual([1_000, 0]);
    expect(roomPayouts([0, 1, 2], 1_000)).toEqual([2_100, 900, 0]);
    expect(roomPayouts([0, 1, 2, 3], 1_000)).toEqual([2_000, 1_200, 800, 0]);
    expect(roomPayouts([0, 1, 2, 3, 4, 5], 1_000)).toEqual([3_000, 1_800, 1_200, 0, 0, 0]);
    expect(roomPayouts([], 500)).toEqual([]);
  });

  it('roomPayouts：奖池正好分完（含有零头的报名费）', () => {
    for (let n = 1; n <= 6; n++)
      for (const b of [1, 7, 33, 100, 999, 12_345]) {
        const p = roomPayouts(Array.from({ length: n }, (_, i) => i), b);
        expect(p.reduce((a, x) => a + x, 0)).toBe(n * b);
        expect(p.every((x) => Number.isInteger(x) && x >= 0)).toBe(true);
        expect(p[0]).toBeGreaterThanOrEqual(Math.max(...p));
      }
  });

  it('roomPrizes：电脑名次插在中间不影响真人分钱', () => {
    const humans = [true, true, true, false, false, false];
    // 同一个真人先后顺序（座位 2 > 0 > 1），电脑夹在里面
    const mk = (places: number[]): TourState => {
      const s = newTour({ humans }, seedOf(11));
      s.places = places;
      s.over = true;
      return s;
    };
    const a = roomPrizes(mk([2, 3, 1, 4, 5, 6]), 1_000);
    const b = roomPrizes(mk([4, 6, 1, 2, 3, 5]), 1_000);
    const c = roomPrizes(mk([3, 5, 1, 2, 6, 4]), 1_000);
    for (const r of [a, b, c]) {
      expect(r.map((x) => x.seat)).toEqual([2, 0, 1]);
      expect(r.map((x) => x.prize)).toEqual([2_100, 900, 0]);
      expect(r.reduce((x, y) => x + y.prize, 0)).toBe(3 * 1_000);
    }
  });

  it('整场打完后 roomPrizes 只发给真人，总数 = 真人数 × 报名费', () => {
    const humans = [true, false, true, true, false, true];
    const s = playOut(newTour({ humans }, seedOf(12)));
    const r = roomPrizes(s, 500);
    expect(r.map((x) => x.seat).sort()).toEqual([0, 2, 3, 5]);
    expect(r.reduce((x, y) => x + y.prize, 0)).toBe(4 * 500);
    expect(r[0]!.prize).toBe(1_000);
  });
});
