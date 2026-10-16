import { describe, expect, it } from 'vitest';
import { decide } from '../src/ai/index.ts';
import { createGame, dispatch, seatsToAct, viewFor, type DealResult, type GameState, type Seat } from '../src/core/index.ts';
import {
  POINTS_PER_SHARE,
  ROOM_DEALS,
  SOLO_DEALS,
  TIERS,
  TIER_IDS,
  WALLET_ID,
  capPoints,
  dealPoints,
  isSoloRef,
  isTier,
  newRoomBook,
  payout,
  pointValue,
  roomAddDeal,
  roomOver,
  roomRef,
  seatOp,
  setPaid,
  soloAddDeal,
  soloOp,
  soloOver,
  soloPoints,
  soloRef,
  validSoloResult,
  type RoomBook,
  type SoloMatch,
} from '../src/stake/index.ts';

/** 一副的结果：只有名次和赢家队要紧 */
function deal(dealNo: number, order: Seat[]): DealResult {
  return { dealNo, order, winnerTeam: order[0]! % 2, up: 0, doubleDown: false, levelsBefore: [2, 2], levelsAfter: [2, 2], aFailedTeam: -1, aResetTeam: -1 };
}
const DOUBLE_US = [0, 2, 1, 3]; // 我方双下：+3
const SINGLE_US = [0, 1, 2, 3]; // 我方单下：+2
const LAST_US = [0, 1, 3, 2]; // 搭档末游：+1
const DOUBLE_THEM = [1, 3, 0, 2]; // 对方双下：−3

describe('档位和每分', () => {
  it('四档一份和 economy.md 一致，每分 = 一份的 1/20，都是整数', () => {
    expect(TIERS).toEqual({ small: 2000, mid: 10000, big: 50000, lux: 200000 });
    expect(TIER_IDS.map(pointValue)).toEqual([100, 500, 2500, 10000]);
    expect(isTier('mid')).toBe(true);
    expect(isTier('huge')).toBe(false);
    expect(isTier(1)).toBe(false);
  });

});

describe('每副的分', () => {
  it('双下 3、单下 2、末游 1，另一队扣同样的分', () => {
    expect(dealPoints(deal(1, DOUBLE_US), 0)).toBe(3);
    expect(dealPoints(deal(1, SINGLE_US), 0)).toBe(2);
    expect(dealPoints(deal(1, LAST_US), 0)).toBe(1);
    expect(dealPoints(deal(1, DOUBLE_US), 1)).toBe(-3);
    expect(dealPoints(deal(1, DOUBLE_THEM), 0)).toBe(-3);
    expect(dealPoints(deal(1, [3, 0, 2, 1]), 1)).toBe(1);
  });

  it('封顶 ±20 分，结回额在 0 到 2 份之间', () => {
    expect(capPoints(25)).toBe(20);
    expect(capPoints(-21)).toBe(-20);
    expect(payout('mid', 0)).toBe(10_000);
    expect(payout('mid', 3)).toBe(11_500);
    expect(payout('mid', -20)).toBe(0);
    expect(payout('mid', 40)).toBe(20_000);
    expect(payout('lux', -7)).toBe(130_000);
  });
});

describe('钱包的 ref 和 op', () => {
  const hex32 = '0123456789abcdef0123456789abcdef';
  const hex16 = '0123456789abcdef';

  it('单机和好友房的 ref、op 都是 8–64 位的 [A-Za-z0-9_-]，不带冒号', () => {
    const solo = soloRef(hex32);
    const room = roomRef(hex16);
    const ids = [solo, soloOp(solo, 'in'), soloOp(solo, 'out'), soloOp(solo, 'refund'), room, seatOp(room, 0, 'in'), seatOp(room, 3, 'out')];
    for (const id of ids) expect(id, id).toMatch(WALLET_ID);
    expect(soloOp(solo, 'refund')).toBe(`solo-${hex32}-refund`);
    expect(seatOp(room, 2, 'in')).toBe(`gd-${hex16}-s2-in`);
    expect(Math.max(...ids.map((i) => i.length))).toBeLessThanOrEqual(64);
  });

  it('长度、字符不对就不给拼', () => {
    expect(() => soloRef('abc')).toThrow();
    expect(() => soloRef(hex32.toUpperCase())).toThrow();
    expect(() => roomRef(hex32)).toThrow();
    expect(isSoloRef(soloRef(hex32))).toBe(true);
    expect(isSoloRef(`solo-${hex32}:in`)).toBe(false);
    expect(isSoloRef(42)).toBe(false);
  });
});

describe('单机一场', () => {
  const start: SoloMatch = { tier: 'mid', deals: [] };

  it('按副累计；同一副只记一次，跳着来的也不记', () => {
    let m = soloAddDeal(start, deal(1, DOUBLE_US));
    m = soloAddDeal(m, deal(1, DOUBLE_US));
    m = soloAddDeal(m, deal(3, DOUBLE_US));
    expect(m.deals).toEqual([3]);
    m = soloAddDeal(m, deal(2, DOUBLE_THEM));
    expect(m.deals).toEqual([3, -3]);
    expect(soloPoints(m)).toBe(0);
    expect(soloOver(m)).toBe(false);
  });

  it('打满 8 副结束', () => {
    let m = start;
    for (let i = 1; i <= SOLO_DEALS; i++) m = soloAddDeal(m, deal(i, i % 2 ? LAST_US : DOUBLE_THEM));
    expect(m.deals).toHaveLength(SOLO_DEALS);
    expect(soloOver(m)).toBe(true);
    expect(soloPoints(m)).toBe(-8);
    // 结束后不再记
    expect(soloAddDeal(m, deal(9, DOUBLE_US))).toBe(m);
  });

  it('碰到封顶当场结束，按封顶结', () => {
    let m = start;
    for (let i = 1; i <= 7; i++) m = soloAddDeal(m, deal(i, DOUBLE_US));
    expect(m.deals).toHaveLength(7);
    expect(soloPoints(m)).toBe(20);
    expect(soloOver(m)).toBe(true);
    expect(payout(m.tier, soloPoints(m))).toBe(20_000);
  });

  it('有一队过 A，牌局结束，这一场也结束', () => {
    const m = soloAddDeal(start, deal(1, SINGLE_US));
    expect(soloOver(m, 'gameOver')).toBe(true);
    expect(soloOver(m, 'dealEnd')).toBe(false);
  });

  it('Worker 只收规则允许的数', () => {
    expect(validSoloResult(0, 0)).toBe(true);
    expect(validSoloResult(-20, 8)).toBe(true);
    expect(validSoloResult(20, 7)).toBe(true);
    expect(validSoloResult(21, 8)).toBe(false);
    expect(validSoloResult(4, 1)).toBe(false);
    expect(validSoloResult(1, 9)).toBe(false);
    expect(validSoloResult(1.5, 2)).toBe(false);
    expect(validSoloResult('3', 2)).toBe(false);
    expect(validSoloResult(1, -1)).toBe(false);
  });
});

describe('好友房：每个座位一本账', () => {
  const paidAll = (b: RoomBook): RoomBook => [0, 1, 2, 3].reduce((x, s) => setPaid(x, s, 'yes'), b);
  const sum = (b: RoomBook): number => b.seats.reduce((a, s) => a + s.points, 0);

  it('四个真人：两队的输赢互相抵掉，庄家是 0', () => {
    let b = paidAll(newRoomBook('mid'));
    b = roomAddDeal(b, deal(1, DOUBLE_US));
    b = roomAddDeal(b, deal(2, SINGLE_US));
    expect(b.seats.map((s) => s.points)).toEqual([5, -5, 5, -5]);
    expect(sum(b)).toBe(0);
    expect(b.house).toBe(0);
    expect(b.seats.reduce((a, s) => a + payout(b.tier, s.points), 0)).toBe(4 * TIERS.mid);
  });

  it('只记到账的座位；电脑、还没到账、被拒的归庄家，账对得上', () => {
    let b = setPaid(setPaid(newRoomBook('small'), 0, 'yes'), 1, 'refused');
    b = setPaid(b, 2, 'pending');
    b = roomAddDeal(b, deal(1, DOUBLE_US));
    expect(b.seats.map((s) => s.points)).toEqual([3, 0, 0, 0]);
    expect(b.house).toBe(-3);
    // 中途接管：到账以后的分才算他的
    b = setPaid(b, 2, 'yes');
    b = roomAddDeal(b, deal(2, DOUBLE_THEM));
    expect(b.seats.map((s) => s.points)).toEqual([0, 0, -3, 0]);
    expect(b.house + sum(b)).toBe(0);
    // 同一副不记两次
    expect(roomAddDeal(b, deal(2, DOUBLE_THEM))).toBe(b);
  });

  it('各自封顶 ±20，多出来的归庄家；到账的都封顶了就结束', () => {
    let b = setPaid(setPaid(newRoomBook('big'), 0, 'yes'), 2, 'yes');
    for (let i = 1; i <= 4; i++) b = roomAddDeal(b, deal(i, DOUBLE_US));
    expect(roomOver(b)).toBe(false);
    b = { ...b, deals: 0, seats: b.seats.map((s) => (s.paid === 'yes' ? { ...s, points: 19 } : s)) };
    b = roomAddDeal(b, deal(1, DOUBLE_US));
    expect(b.seats[0]!.points).toBe(POINTS_PER_SHARE);
    expect(roomOver(b)).toBe(true);
  });

  it('打满 5 副、有一队过 A 时结束；没人到账时不因封顶结束', () => {
    let b = setPaid(newRoomBook('mid'), 0, 'yes');
    for (let i = 1; i < ROOM_DEALS; i++) b = roomAddDeal(b, deal(i, LAST_US));
    expect(roomOver(b)).toBe(false);
    expect(roomOver(b, 'gameOver')).toBe(true);
    expect(roomOver(roomAddDeal(b, deal(ROOM_DEALS, LAST_US)))).toBe(true);
    expect(roomOver(newRoomBook('mid'))).toBe(false);
  });
});

describe('拿真牌局跑：和模拟器（tools/stake-sim.ts）同一个算法', () => {
  /** 用电脑把一局打到第 n 副结束，收集每副的结果 */
  function play(seed: string, deals: number): DealResult[] {
    let s: GameState = createGame(seed).state;
    const out: DealResult[] = [];
    for (let guard = 0; guard < 50_000 && out.length < deals; guard++) {
      if (s.phase === 'dealEnd' || s.phase === 'gameOver') {
        if (out[out.length - 1]?.dealNo !== s.lastDeal!.dealNo) out.push(s.lastDeal!);
        if (s.phase === 'gameOver') break;
        s = dispatch(s, { type: 'nextDeal' }).state;
        continue;
      }
      const seat = seatsToAct(s)[0]!;
      s = dispatch(s, decide(viewFor(s, seat), { seed: `${seed}|${seat}`, difficulty: 'easy' })!).state;
    }
    return out;
  }

  it('单机一场的分 = 每副我方分的合计；好友房四个真人时庄家始终是 0', () => {
    for (const seed of ['stake-a', 'stake-b']) {
      const results = play(seed, SOLO_DEALS);
      let m: SoloMatch = { tier: 'small', deals: [] };
      let b: RoomBook = [0, 1, 2, 3].reduce((x, s) => setPaid(x, s, 'yes'), newRoomBook('small'));
      for (const r of results) {
        m = soloAddDeal(m, r);
        b = roomAddDeal(b, r);
      }
      expect(m.deals).toHaveLength(results.length);
      expect(soloPoints(m)).toBe(capPoints(results.reduce((a, r) => a + dealPoints(r, 0), 0)));
      expect(b.house).toBe(0);
      expect(b.seats[0]!.points).toBe(b.seats[2]!.points);
      expect(b.seats[0]!.points).toBe(-b.seats[1]!.points);
    }
  }, 30_000);
});
