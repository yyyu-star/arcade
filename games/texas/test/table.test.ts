import { describe, expect, it } from 'vitest';
import { parseCards } from '../src/core/cards.ts';
import { addChips, apply, buildPots, deal, isFail, legal, paid, seatHouse, seatPlayer, newTable, type Table } from '../src/core/table.ts';
import { conserve, must, play, rig, setup, stacks, SEED } from './helpers.ts';

const CHECK = { t: 'check' } as const;
const CALL = { t: 'call' } as const;
const FOLD = { t: 'fold' } as const;
const ALLIN = { t: 'allin' } as const;
const raise = (to: number) => ({ t: 'raise', to }) as const;
const ROYAL = 'As Ks Qs Js Ts';

describe('盲注和说话顺序', () => {
  it('两人桌：按钮位交小盲、翻牌前先说话，翻牌后最后说话', () => {
    let t = setup([1000, 1000], 1);
    expect(t.button).toBe(0);
    expect(t.seats[0]!.bet).toBe(10);
    expect(t.seats[1]!.bet).toBe(20);
    expect(t.toAct).toBe(0);
    t = play(t, [
      [0, CALL],
      [1, CHECK],
    ]);
    expect(t.phase).toBe('flop');
    expect(t.toAct).toBe(1);
  });

  it('三人桌：按钮后面是小盲、大盲，翻牌前按钮先说话；大盲有权再说一次', () => {
    let t = setup([1000, 1000, 1000], 2);
    expect([t.button, t.seats[1]!.bet, t.seats[2]!.bet, t.toAct]).toEqual([0, 10, 20, 0]);
    t = play(t, [
      [0, CALL],
      [1, CALL],
    ]);
    expect(t.toAct).toBe(2);
    expect(legal(t, 2)).toMatchObject({ check: true, raise: true, minTo: 40 });
    t = play(t, [[2, CHECK]]);
    expect(t.phase).toBe('flop');
    expect(t.toAct).toBe(1);
  });

  it('按钮跳过空座和输光的人', () => {
    let t = setup([1000, null, 0, 1000, 1000], 0);
    expect(t.button).toBe(3);
    t = play(t, [
      [3, FOLD],
      [4, FOLD],
    ]);
    expect(t.handNo).toBe(2);
    expect(t.button).toBe(4);
  });

  it('不轮到的人出手、不能过牌时过牌、没有要跟的时跟注，都被拒且不改状态', () => {
    const t = setup([1000, 1000, 1000], 2);
    expect(apply(t, 1, CALL)).toEqual({ error: 'not_your_turn' });
    expect(apply(t, 0, CHECK)).toEqual({ error: 'cannot_check' });
    const t2 = play(t, [
      [0, CALL],
      [1, CALL],
    ]);
    expect(apply(t2, 2, CALL)).toEqual({ error: 'nothing_to_call' });
    expect(apply(t2, 2, raise(30))).toEqual({ error: 'bad_amount' });
  });
});

describe('下注', () => {
  it('最小加注：加的部分不少于上一次完整加注', () => {
    let t = setup([1000, 1000, 1000], 2);
    t = play(t, [[0, raise(60)]]);
    expect(legal(t, 1)).toMatchObject({ minTo: 100, maxTo: 1000 });
    expect(apply(t, 1, raise(90))).toEqual({ error: 'bad_amount' });
    t = play(t, [[1, raise(100)]]);
    expect(t.minRaise).toBe(40);
    expect(legal(t, 2)!.minTo).toBe(140);
  });

  it('全下不够一次完整加注：已经说过话的人只能跟或弃，没说过的人能加', () => {
    // 0 按钮、1 小盲、2 大盲（只有 70）
    let t = setup([1000, 1000, 70], 2);
    t = play(t, [
      [0, CALL],
      [1, CALL],
      [2, CHECK],
    ]);
    expect(t.phase).toBe('flop');
    t = play(t, [
      [1, raise(40)],
      [2, ALLIN], // 加到 50，只多 10，不算完整加注
    ]);
    expect(t.minRaise).toBe(40);
    expect(legal(t, 0)).toMatchObject({ raise: true, call: 50, minTo: 90 });
    t = play(t, [[0, CALL]]);
    expect(legal(t, 1)).toMatchObject({ raise: false, call: 10 });
    expect(apply(t, 1, raise(200))).toEqual({ error: 'cannot_raise' });
    expect(apply(t, 1, ALLIN)).toEqual({ error: 'cannot_raise' });
    t = play(t, [[1, CALL]]);
    expect(t.phase).toBe('turn');
  });

  it('别人都全下了，不能再加注', () => {
    let t = setup([1000, 300], 1);
    t = play(t, [[0, raise(100)]]);
    t = play(t, [[1, ALLIN]]);
    expect(legal(t, 0)).toMatchObject({ raise: false, call: 200 });
  });

  it('没人跟的下注退回', () => {
    let t = setup([1000, 300], 1);
    t = rig(t, { 0: 'Ah Ad', 1: '2c 7d' }, '3h 8s 9c Jd Kh');
    t = play(t, [
      [0, ALLIN],
      [1, CALL],
    ]);
    expect(t.lastHand!.uncalled).toEqual({ seat: 0, amount: 700 });
    expect(t.lastHand!.pots).toEqual([{ amount: 600, winners: [{ seat: 0, won: 600 }] }]);
    expect(t.lastHand!.byFold).toBe(false);
  });

  it('别人都弃了直接赢，不亮牌', () => {
    let t = setup([1000, 1000, 1000], 2);
    t = play(t, [
      [0, raise(60)],
      [1, FOLD],
      [2, FOLD],
    ]);
    expect(t.lastHand).toMatchObject({ byFold: true, shown: [], uncalled: { seat: 0, amount: 40 } });
    expect(stacks(t).slice(0, 3)).not.toEqual([1000, 1000, 1000]);
    expect(t.lastHand!.pots[0]).toEqual({ amount: 50, winners: [{ seat: 0, won: 50 }] });
  });
});

describe('边池、平分、摊牌', () => {
  it('分层做池，弃了牌的人的钱留在池里但没资格分', () => {
    expect(buildPots([100, 300, 300, 50], [true, false, true, true])).toEqual([
      { amount: 200, eligible: [0, 2, 3] },
      { amount: 150, eligible: [0, 2] },
      { amount: 400, eligible: [2] },
    ]);
    // 弃牌的人投得比没弃的都多（大盲的情况），多出来的并进最后一个池
    expect(buildPots([10, 5], [false, true])).toEqual([{ amount: 15, eligible: [1] }]);
  });

  it('四人不同筹码全下：最短的赢主池，其次赢边池', () => {
    // 0 按钮，1 小盲，2 大盲，3 先说话
    let t = setup([100, 300, 500, 500], 3);
    t = rig(t, { 0: 'Ah Ad', 1: 'Kh Kd', 2: 'Qh Qd', 3: '2c 7d' }, '3h 8s 9c Js 4d');
    t = play(t, [
      [3, ALLIN],
      [0, ALLIN],
      [1, ALLIN],
      [2, ALLIN],
    ]);
    expect(t.lastHand!.pots.map((p) => [p.amount, p.winners.map((w) => w.seat)])).toEqual([
      [400, [0]],
      [600, [1]],
      [400, [2]],
    ]);
    // 全下后自动发完，所有人亮牌
    expect(t.lastHand!.shown.map((s) => s.seat).sort()).toEqual([0, 1, 2, 3]);
    expect(t.lastHand!.board).toEqual(parseCards('3h 8s 9c Js 4d'));
    expect(t.seats[3]!.stack).toBe(0);
  });

  it('平分，零头从按钮左手第一个赢家开始发', () => {
    let t = setup([1000, 1000, 1000, 1000], 3);
    t = rig(t, { 0: '2c 3d', 1: '4c 5d', 2: '6c 7d', 3: '8c 9d' }, ROYAL);
    t = play(t, [
      [3, CALL],
      [0, CALL],
      [1, FOLD],
      [2, CHECK],
      [2, CHECK],
      [3, CHECK],
      [0, CHECK],
      [2, CHECK],
      [3, CHECK],
      [0, CHECK],
      [2, CHECK],
      [3, CHECK],
      [0, CHECK],
    ]);
    // 池子 70 = 小盲弃掉的 10 + 三人各 20，三人都是皇家同花顺
    expect(t.lastHand!.pots).toEqual([
      {
        amount: 70,
        winners: [
          { seat: 2, won: 24 },
          { seat: 3, won: 23 },
          { seat: 0, won: 23 },
        ],
      },
    ]);
  });

  it('河牌有人下注时他先亮，输的人自动盖牌', () => {
    let t = setup([1000, 1000], 1);
    t = rig(t, { 0: 'Ah Ad', 1: '2c 7d' }, '3h 8s 9c Jd Kh');
    t = play(t, [
      [0, CALL],
      [1, CHECK],
      [1, CHECK],
      [0, CHECK],
      [1, CHECK],
      [0, CHECK],
      [1, raise(50)],
      [0, CALL],
    ]);
    expect(t.lastHand!.shown.map((s) => s.seat)).toEqual([1, 0]);
    // 反过来：赢家先亮，输家不亮
    let u = setup([1000, 1000], 1);
    u = rig(u, { 0: 'Ah Ad', 1: '2c 7d' }, '3h 8s 9c Jd Kh');
    u = play(u, [
      [0, CALL],
      [1, CHECK],
      [1, CHECK],
      [0, CHECK],
      [1, CHECK],
      [0, CHECK],
      [1, CHECK],
      [0, raise(50)],
      [1, CALL],
    ]);
    expect(u.lastHand!.shown.map((s) => s.seat)).toEqual([0]);
  });

  it('没人下注时从按钮左手开始亮；赢了边池的人一定亮', () => {
    // 0 短码全下、AA；1 和 2 继续，2 的 KK 输给 AA 但赢边池
    let t = setup([100, 1000, 1000], 2);
    t = rig(t, { 0: 'Ah Ad', 1: '2c 7d', 2: 'Kh Kd' }, '3h 8s 9c Jd 4h');
    t = play(t, [
      [0, ALLIN],
      [1, CALL],
      [2, CALL],
      [1, raise(50)],
      [2, CALL],
      [1, CHECK],
      [2, CHECK],
      [1, CHECK],
      [2, CHECK],
    ]);
    expect(t.lastHand!.shown.map((s) => s.seat)).toEqual([1, 2, 0]);
    expect(t.lastHand!.pots.map((p) => p.winners.map((w) => w.seat))).toEqual([[0], [2]]);
  });
});

describe('超时、暂离、离桌、补码', () => {
  it('超时能过就过，不能过就弃；连着两手超时转暂离，暂离的不发牌', () => {
    let t = setup([1000, 1000, 1000], 2);
    t = play(t, [[0, { t: 'timeout' }]]);
    expect(t.seats[0]!.status).toBe('folded');
    expect(t.log.at(-1)).toMatchObject({ act: 'fold', auto: true });
    t = play(t, [
      [1, CALL],
      [2, { t: 'timeout' }],
    ]);
    expect(t.log.at(-2)).toMatchObject({ act: 'check', auto: true });
    expect(t.phase).toBe('flop');
    t = play(t, [
      [1, raise(20)],
      [2, FOLD],
    ]);
    // 第二手：0 再超时一次
    expect(t.handNo).toBe(2);
    expect(t.toAct).toBe(1);
    t = play(t, [
      [1, CALL],
      [2, CALL],
      [0, { t: 'timeout' }],
    ]);
    while (t.handNo === 2) t = must(apply(t, t.toAct!, t.seats[t.toAct!]!.bet < t.currentBet ? FOLD : CHECK));
    expect(t.seats[0]!.away).toBe(true);
    expect(t.seats[0]!.status).toBe('out');
    t = must(apply(t, 0, { t: 'back' }));
    expect(t.seats[0]!.away).toBe(false);
  });

  it('手里有牌时离桌：先弃牌，这一手打完筹码进待结算；结算后拿掉', () => {
    let t = setup([1000, 1000, 1000], 2);
    t = must(apply(t, 1, { t: 'leave' }));
    expect(t.seats[1]!.status).toBe('folded');
    expect(t.toAct).toBe(0);
    conserve(t);
    t = play(t, [
      [0, FOLD],
    ]);
    // 2 赢了；1 离开，交过的小盲 10 留在池里
    expect(t.out).toEqual([{ id: expect.any(String), seat: 1, amount: 990 }]);
    expect(t.seats[1]!.owner).toBe('none');
    conserve(t);
    // 只剩两个人照样开下一手
    expect(t.phase).toBe('preflop');
    t = paid(t, t.out[0]!.id);
    expect(t.out).toEqual([]);
  });

  it('下了注又离桌（不轮到他也算弃牌），别人都弃了：那一注不退给他，是死钱，归赢家（0.3.3）', () => {
    let t = setup([1000, 1000, 1000], 2);
    t = play(t, [[0, raise(60)]]);
    t = must(apply(t, 0, { t: 'leave' }));
    expect(t.seats[0]!.status).toBe('folded');
    t = play(t, [[1, FOLD]]);
    // 原来退回 40 给已经离桌的 0：好友房里他那一份离座时已经结回钱包，这 40 只能搁在房间里丢掉
    expect(t.lastHand).toMatchObject({ byFold: true, uncalled: null });
    expect(t.lastHand!.pots).toEqual([{ amount: 90, winners: [{ seat: 2, won: 90 }] }]);
    expect(t.out).toEqual([{ id: expect.any(String), seat: 0, amount: 940 }]);
    conserve(t);
  });

  it('不在这一手里时离桌：马上结算', () => {
    let t = setup([1000, 1000, null], 0);
    t = must(seatPlayer(t, 2, 1000));
    expect(t.seats[2]!.status).toBe('out');
    t = must(apply(t, 2, { t: 'leave' }));
    expect(t.out).toEqual([{ id: expect.any(String), seat: 2, amount: 1000 }]);
    conserve(t);
  });

  it('补码：不在这一手里、补完不超过买入上限', () => {
    let t = setup([1000, 1000], 1);
    expect(addChips(t, 0, 100)).toEqual({ error: 'in_hand' });
    t = rig(t, { 0: 'Ah Ad', 1: '2c 7d' }, '3h 8s 9c Jd Kh');
    t = play(t, [
      [0, ALLIN],
      [1, ALLIN],
    ]);
    expect(t.seats[1]!.stack).toBe(0);
    expect(t.phase).toBe('idle');
    expect(addChips(t, 1, 2001)).toEqual({ error: 'bad_amount' });
    t = must(addChips(t, 1, 2000));
    expect(t.phase).toBe('preflop');
    conserve(t);
  });

  it('真人至少一个：只剩电脑时停着等人', () => {
    let t = newTable('small', 3, SEED);
    t = must(seatHouse(t, 1));
    t = must(seatHouse(t, 2));
    expect(t.phase).toBe('idle');
    expect(seatPlayer(t, 0, 100)).toEqual({ error: 'bad_amount' });
    t = must(seatPlayer(t, 0, 2000));
    expect(t.phase).toBe('preflop');
    expect(t.seats[1]!.persona).not.toBe(t.seats[2]!.persona);
    const bb = t.seats[1]!.stack + t.seats[1]!.total;
    expect(bb % 20).toBe(0);
    expect(bb).toBeGreaterThanOrEqual(1200);
    expect(bb).toBeLessThanOrEqual(2000);
    conserve(t);
  });

  it('电脑输光了换一个电脑坐进来，筹码收回庄家', () => {
    let t: Table = newTable('small', 2, SEED);
    t = must(seatHouse(t, 1));
    t = must(seatPlayer(t, 0, 2000));
    const house = t.seats[1]!.stack + t.seats[1]!.total;
    const persona = t.seats[1]!.persona;
    t = rig(t, { 0: 'Ah Ad', 1: '2c 7d' }, '3h 8s 9c Jd Kh');
    while (t.handNo === 1) {
      const s = t.toAct!;
      const r = apply(t, s, ALLIN);
      t = must(isFail(r) ? apply(t, s, CALL) : r);
    }
    expect(t.seats[1]!.owner).toBe('house');
    expect(t.seats[1]!.persona).not.toBe(persona);
    expect(t.seats[0]!.stack + t.seats[0]!.total).toBe(2000 + house);
    conserve(t);
  });
});

describe('一手打完先停着（holdHands，0.1.1）', () => {
  const held = (stacks: number[]): Table => {
    const t = newTable('small', stacks.length, SEED, { holdHands: true });
    stacks.forEach((x, i) => {
      Object.assign(t.seats[i]!, { owner: 'player', stack: x });
      t.bank += x;
    });
    t.button = 1;
    return deal(t);
  };
  /** 轮到谁谁弃，直到这一手打完 */
  const foldOut = (t0: Table): Table => {
    let t = t0;
    while (t.toAct !== null && t.handNo === t0.handNo) t = must(apply(t, t.toAct, FOLD));
    return t;
  };

  it('打完不发下一手：结果留在 lastHand，hold 为真；补码、暂离回来都不发，只有 deal 发', () => {
    let t = foldOut(held([1000, 1000, 1000]));
    expect(t).toMatchObject({ phase: 'idle', hold: true, handNo: 1, toAct: null });
    expect(t.lastHand?.handNo).toBe(1);
    conserve(t);
    const loser = t.seats.findIndex((s) => s.stack < 1000);
    t = must(addChips(t, loser, 10));
    t = must(apply(t, 0, { t: 'away' }));
    t = must(apply(t, 0, { t: 'back' }));
    expect(t).toMatchObject({ phase: 'idle', hold: true, handNo: 1 });
    t = deal(t);
    expect(t).toMatchObject({ phase: 'preflop', hold: false, handNo: 2 });
    conserve(t);
  });

  it('电脑输光了：停着时还坐着（结果还摆着），发下一手时才换人', () => {
    let t: Table = newTable('small', 2, SEED, { holdHands: true });
    t = must(seatHouse(t, 1, false));
    t = must(seatPlayer(t, 0, 2000, false));
    const persona = t.seats[1]!.persona;
    t = rig(deal(t), { 0: 'Ah Ad', 1: '2c 7d' }, '3h 8s 9c Jd Kh');
    while (t.toAct !== null) {
      const s = t.toAct;
      const r = apply(t, s, ALLIN);
      t = must(isFail(r) ? apply(t, s, CALL) : r);
    }
    expect(t).toMatchObject({ phase: 'idle', hold: true });
    expect(t.seats[1]).toMatchObject({ owner: 'house', persona, stack: 0 });
    conserve(t);
    t = deal(t);
    expect(t.seats[1]!.owner).toBe('house');
    expect(t.seats[1]!.persona).not.toBe(persona);
    expect(t.seats[1]!.stack + t.seats[1]!.total).toBeGreaterThan(0);
    expect(t.handNo).toBe(2);
    conserve(t);
  });

  it('没开 holdHands（模拟器、老存档）：和以前一样打完马上发下一手', () => {
    const t = foldOut(setup([1000, 1000, 1000], 1));
    expect(t.handNo).toBe(2);
    expect(t.hold).toBeUndefined();
  });

  it('停着时有人坐下也不发；deal 时人不够就清掉 hold 停在空闲，之后有人坐下照常开', () => {
    let t = foldOut(held([1000, 1000]));
    t = must(apply(t, 1, { t: 'leave' }));
    expect(t.seats[1]!.owner).toBe('none');
    t = deal(t);
    expect(t).toMatchObject({ phase: 'idle', hold: false, handNo: 1 });
    t = must(seatPlayer(t, 1, 1000));
    expect(t).toMatchObject({ phase: 'preflop', handNo: 2 });
    // 停着时坐下：不发
    t = foldOut(t);
    t = must(apply(t, 1, { t: 'leave' }));
    t = must(seatHouse(t, 1));
    expect(t).toMatchObject({ phase: 'idle', hold: true });
  });
});

describe('主动亮牌（0.19.0）', () => {
  /** 两个真人，0 号弃牌、1 号不用亮就赢：停着等下一手 */
  const ended = (): Table => {
    let t: Table = newTable('small', 2, SEED, { holdHands: true });
    t = must(seatPlayer(t, 0, 2000, false));
    t = must(seatPlayer(t, 1, 2000, false));
    t = rig(deal(t), { 0: 'Ah Ad', 1: '2c 7d' }, '3h 8s 9c Jd Kh');
    return must(apply(t, t.toAct!, FOLD));
  };

  it('停着时亮自己刚才的一张、再亮两张；亮的牌就是他的；发下一手就收掉留着的底牌', () => {
    let t = ended();
    const folder = t.lastHand!.pots[0]!.winners[0]!.seat === 0 ? 1 : 0;
    const hole = t.kept![folder]!;
    expect(hole).toHaveLength(2);
    t = must(apply(t, folder, { t: 'show', cards: [1] }));
    expect(t.lastHand!.showed).toEqual([{ seat: folder, cards: [hole[1]] }]);
    expect(apply(t, folder, { t: 'show', cards: [1] })).toEqual({ error: 'already_shown' });
    t = must(apply(t, folder, { t: 'show', cards: [0] }));
    expect(t.lastHand!.showed).toEqual([{ seat: folder, cards: hole }]);
    // 赢家也能亮（诈唬了给大家看）
    t = must(apply(t, 1 - folder, { t: 'show', cards: [0, 1] }));
    expect(t.lastHand!.showed).toHaveLength(2);
    conserve(t);
    t = deal(t);
    expect(t.kept).toBeUndefined();
    expect(apply(t, folder, { t: 'show', cards: [0] })).toEqual({ error: 'cannot_show' });
  });

  it('停着时亮了牌就离桌、别人坐进同一个座位：他亮的收起来，不摆在新来的人座位上（0.19.2）', () => {
    let t = ended();
    t = must(apply(t, 0, { t: 'show', cards: [0] }));
    t = must(apply(t, 1, { t: 'show', cards: [1] }));
    t = must(apply(t, 0, { t: 'leave' }));
    expect(t.seats[0]!.owner).toBe('none');
    t = must(seatPlayer(t, 0, 2000, false));
    expect(t.lastHand!.showed!.map((x) => x.seat)).toEqual([1]);
    expect(t.kept![0]).toEqual([]);
  });

  it('不在停着时、形状不对、摊牌已经亮过的都不收', () => {
    const t = ended();
    for (const cards of [[], [2], [0, 0], [0, 1, 1], 'x', [0.5]] as unknown as number[][]) expect(apply(t, 0, { t: 'show', cards })).toEqual({ error: 'bad_cards' });
    // 还在打：不能亮
    let live: Table = newTable('small', 2, SEED, { holdHands: true });
    live = must(seatPlayer(live, 0, 2000, false));
    live = must(seatPlayer(live, 1, 2000, false));
    live = deal(live);
    expect(apply(live, 0, { t: 'show', cards: [0] })).toEqual({ error: 'cannot_show' });
    // 摊牌了：亮过的不用再亮
    let sd = rig(live, { 0: 'Ah Ad', 1: '2c 7d' }, '3h 8s 9c Jd Kh');
    while (sd.toAct !== null) {
      const s = sd.toAct;
      const r = apply(sd, s, ALLIN);
      sd = must(isFail(r) ? apply(sd, s, CALL) : r);
    }
    const shown = sd.lastHand!.shown.map((x) => x.seat);
    expect(shown.length).toBeGreaterThan(0);
    expect(apply(sd, shown[0]!, { t: 'show', cards: [0] })).toEqual({ error: 'already_shown' });
  });

  it('没开 holdHands（模拟器）：不留底牌，也就亮不了', () => {
    const t = setup([1000, 1000, 1000], 1);
    const r = must(apply(t, t.toAct!, FOLD));
    expect(r.kept).toBeUndefined();
  });
});
