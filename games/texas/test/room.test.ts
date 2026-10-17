/**
 * 好友房的规则（src/room/rules.ts）：座位换人、买入结算、托管、收场。房间（kit）的部分在 test/worker/room.test.ts。
 */
import { snapshotBytes } from 'arcade-kit/game';
import type { SeatKind } from 'arcade-kit/protocol';
import { describe, expect, it } from 'vitest';
import { ROOM_LEVEL, STAKES, stakesOf } from '../src/core/stakes.ts';
import { isFail } from '../src/core/table.ts';
import { HAND_PAUSE_MS, OPENING_MS, roomOp, SEATS, SETTLE_EXTRA, settleCap, TURN_MS, texasRoom as G, type RoomAction, type RoomState, type WalletEffect } from '../src/room/rules.ts';
import { SOLO_OP, soloOp } from '../worker/platform.ts';
import { conserve, SEED } from './helpers.ts';

const MAX = stakesOf('small').max;
const OK = { ok: true };

function begin(seats: SeatKind[], size = seats.filter((k) => k !== 'empty').length, stakes = 'small'): RoomState {
  const opts = G.options!({ stakes, size })!;
  return G.begin!(SEED, 1, { opts, seats: [...seats, ...new Array<SeatKind>(SEATS - seats.length).fill('empty')] });
}

function must(x: RoomState | { error: string }): RoomState {
  if (isFail(x)) throw new Error(`unexpected error ${x.error}`);
  conserve(x.t);
  return x;
}

const act = (s: RoomState, seat: number, a: RoomAction) => must(G.apply(s, seat, a));
const effects = (s: RoomState) => G.effects!(s);
/** 去掉每笔都带的房间号、档位 */
const strip = ({ ref: _r, stakes: _s, stats: _t, ...e }: WalletEffect) => e;
const debits = (s: RoomState) => effects(s).filter((e) => e.kind === 'debit');
const credits = (s: RoomState) => effects(s).filter((e) => e.kind === 'credit');

/** 把这一刻所有的事按 reply 办完 */
function settleAll(s0: RoomState, reply: (e: WalletEffect) => unknown = () => OK): RoomState {
  let s = s0;
  for (const e of effects(s0)) s = G.settled!(s, e.id, reply(e));
  conserve(s.t);
  return s;
}

/** 买入都到账，打到第 2 手（大家都在牌桌上），停在轮到真人 */
function seatedAll(seats: SeatKind[]): RoomState {
  let s = drive(settleAll(begin(seats)));
  while (s.t.handNo < 2) s = drive(act(s, G.turn(s)!, { t: 'fold' }));
  return s;
}

/** 像房间一样：轮到电脑（和托管的座位）就替它出；一手打完停着的，当时间到了替房间 resume（kit 0.5.0）；直到轮到真人或者没人要出 */
function drive(s0: RoomState, auto: number[] = []): RoomState {
  let s = s0;
  for (let k = 0; k < 500; k++) {
    const seat = G.turn(s);
    if (seat === null) {
      if (G.pause!(s) === null) return s;
      s = G.resume!(s);
      continue;
    }
    if (s.kinds[seat] === 'human' && !auto.includes(seat)) return s;
    s = act(s, seat, G.ai(s, seat));
  }
  throw new Error('drive did not stop');
}

describe('开局和买入', () => {
  it('真人的买入交给钱包办，到账前牌桌停着等（房间按"轮到第一个没回话的人"计时），电脑先坐好；房间号是 r + 16 位十六进制', () => {
    const s = begin(['human', 'human', 'ai', 'ai']);
    expect(s.ref).toMatch(/^r[0-9a-f]{16}$/);
    expect(debits(s).map(strip)).toEqual([
      { id: 'b0', seat: 0, kind: 'debit', amount: MAX },
      { id: 'b1', seat: 1, kind: 'debit', amount: MAX },
    ]);
    expect(s.t.seats.map((x) => x.owner)).toEqual(['none', 'none', 'house', 'house']);
    expect(s.t.phase).toBe('idle');
    expect(G.turn(s)).toBe(0);
    expect(G.view(s, 0).buying).toEqual([true, true, false, false]);
  });

  it('开打时坐下的人的买入都有了回话才发第一手（先到账的不和电脑先打）；被拒的原因只给那个座位看，不卡着', () => {
    // 三个真人：1 号被拒以后还剩两个能打的（0.4.0 好友房至少两个真人才发牌），这里看的是"被拒不卡着别人"
    let s = begin(['human', 'human', 'human', 'ai']);
    s = G.settled!(s, 'b0', OK);
    expect(s.t.seats[0]).toMatchObject({ owner: 'player', stack: MAX });
    expect(s.t.phase).toBe('idle');
    expect(G.waiting!(s)).toBe(true);
    s = G.settled!(s, 'b2', OK);
    expect(s.t.phase).toBe('idle');
    const both = G.settled!(s, 'b1', OK);
    expect(both.t.phase).toBe('preflop');
    expect(both.t.seats.map((x) => x.status === 'out')).toEqual([false, false, false, false]);
    expect(both.opening).toBe(false);
    s = G.settled!(s, 'b1', { ok: false, error: 'no_funds' });
    expect(s.t.phase).toBe('preflop');
    expect(s.t.seats[1]!.owner).toBe('none');
    expect(G.view(s, 1).refused).toBe('no_funds');
    expect(G.view(s, 0).refused).toBeNull();
    expect(G.view(s, 1).buying[1]).toBe(false);
    expect(effects(s)).toEqual([]);
    // 开打以后再坐下的，到账时这一手已经在打：下一手上
    s = G.seated!(s, 1, 'human');
    s = G.settled!(s, debits(s)[0]!.id, OK);
    expect(s.t.seats[1]).toMatchObject({ owner: 'player', status: 'out' });
    expect(G.view(s, 1).next![1]).toBe(true);
    // 认不出来的回话按 error 记，不夹带别的东西
    const t = G.settled!(begin(['human', 'ai']), 'b0', { ok: false, error: 'Bad <b>' });
    expect(G.view(t, 0).refused).toBe('error');
  });

  it('开打时有人的买入一直没回话：房间按"轮到他"计 30 秒，到点先开打（当他没坐上），到账了下一手上', () => {
    // 三个真人：不等 1 号先开打时桌上还有两个真人（0.4.0），不然到点也发不了牌
    let s = begin(['human', 'human', 'human', 'ai']);
    s = G.settled!(G.settled!(s, 'b0', OK), 'b2', OK);
    expect(G.turn(s)).toBe(1);
    expect(G.turnMs!(s)).toBe(OPENING_MS);
    // 他自己（或别人）发什么都不算，客户端也发不了 timeout（parse 不收）
    expect(G.apply(s, 1, { t: 'call' })).toEqual({ error: 'not_seated' });
    expect(G.apply(s, 0, { t: 'timeout' })).toEqual({ error: 'not_seated' });
    // 掉线托管时房间问 ai：也是 timeout
    expect(G.ai(s, 1)).toEqual({ t: 'timeout' });
    s = act(s, 1, G.timeout!(s, 1));
    expect(s.opening).toBe(false);
    expect(s.t.phase).toBe('preflop');
    expect(s.t.seats[1]!.owner).toBe('none');
    expect(G.turn(s)).toBe(s.t.toAct);
    expect(G.turnMs!(s)).toBe(TURN_MS);
    expect(G.view(s, 1).buying[1]).toBe(true);
    s = G.settled!(s, 'b1', OK);
    expect(s.t.seats[1]).toMatchObject({ owner: 'player', stack: MAX, status: 'out' });
    s = drive(s, [0, 2]);
    expect(s.t.handNo).toBe(2);
    expect(s.t.seats[1]!.status).not.toBe('out');
  });

  it('带入被拒（0.2.5）：座位上能重新带入，到账后下一手上桌；接管电脑座位被拒的一样', () => {
    // 三个真人：1 号被拒时另外两个照常开打（0.4.0 至少两个真人），他重新带入后下一手上
    let s = begin(['human', 'human', 'human', 'ai']);
    s = G.settled!(G.settled!(G.settled!(s, 'b0', OK), 'b2', OK), 'b1', { ok: false, error: 'no_funds' });
    expect(G.view(s, 1)).toMatchObject({ refused: 'no_funds', canRebuy: true });
    expect(G.view(s, 0).refused).toBeNull();
    s = act(s, 1, { t: 'rebuy' });
    expect(debits(s).map((e) => e.seat)).toEqual([1]);
    expect(G.view(s, 1)).toMatchObject({ refused: null, canRebuy: false });
    expect(G.apply(s, 1, { t: 'rebuy' })).toEqual({ error: 'cannot_rebuy' });
    s = G.settled!(s, debits(s)[0]!.id, OK);
    expect(s.t.seats[1]).toMatchObject({ owner: 'player', stack: MAX, status: 'out' });
    expect(G.view(s, 0).next![1]).toBe(true);

    // 接管电脑的座位被拒：电脑这一手照样弃了，空出来以后他能再带（两个真人在打，这一手才发得出来）
    let t = drive(settleAll(begin(['human', 'human', 'ai', 'ai'])));
    t = G.seated!(t, 3, 'human');
    t = G.settled!(t, debits(t)[0]!.id, { ok: false, error: 'no_funds' });
    expect(G.view(t, 3)).toMatchObject({ refused: 'no_funds', canRebuy: true });
    t = G.settled!(act(t, 3, { t: 'rebuy' }), debits(act(t, 3, { t: 'rebuy' }))[0]!.id, OK);
    expect(G.view(t, 0).next![3]).toBe(true);
  });

  it('钱包不够一整份（平台 0.10.2）：重新带入可以少带一点，最少这一档的最少买入、最多一份；到账按带的数上桌', () => {
    const st = stakesOf('small');
    // 三个真人：1 号被拒时另外两个已经开打（0.4.0 至少两个真人），他少带一点、下一手上
    const refused = G.settled!(G.settled!(G.settled!(begin(['human', 'human', 'human', 'ai']), 'b0', OK), 'b2', OK), 'b1', { ok: false, error: 'no_funds' });
    const want = (amount: number) => debits(act(refused, 1, { t: 'rebuy', amount })).map((e) => e.amount);
    expect(want(1_200)).toEqual([1_200]);
    expect(want(100)).toEqual([st.min]);
    expect(want(99_999)).toEqual([MAX]);
    let s = act(refused, 1, { t: 'rebuy', amount: 1_200 });
    s = G.settled!(s, debits(s)[0]!.id, OK);
    expect(s.t.seats[1]).toMatchObject({ owner: 'player', stack: 1_200 });
    conserve(s.t);
  });

  it('选项：档位、2–9 人；不合格返回 null', () => {
    expect(G.options!(undefined)).toEqual({ stakes: 'small', size: 6 });
    expect(G.options!({ stakes: 'lux', size: 2 })).toEqual({ stakes: 'lux', size: 2 });
    for (const bad of [null, 3, { stakes: 'gold', size: 4 }, { stakes: 'mid', size: 1 }, { stakes: 'mid', size: 10 }, { stakes: 'mid', size: 2.5 }]) {
      expect(G.options!(bad)).toBeNull();
    }
    expect(G.options!({ stakes: 'mid', size: 9 })).toEqual({ stakes: 'mid', size: 9 });
    expect(G.seatCount!({ stakes: 'mid', size: 3 })).toBe(3);
  });
});

describe('操作', () => {
  it('客户端发来的 timeout、leave 不收（超时只由房间代出，离座走 kit）；加注要整数', () => {
    for (const raw of [{ t: 'timeout' }, { t: 'leave' }, { t: 'raise' }, { t: 'raise', to: 1.5 }, { t: 'raise', to: '40' }, { t: 'rebuy', amount: 0 }, { t: 'rebuy', amount: 1.5 }, { t: 'rebuy', amount: '900' }, { t: 'x' }, null, 'fold', []]) {
      expect(G.parse(raw)).toBeNull();
    }
    expect(G.parse({ t: 'raise', to: 60, extra: 1 })).toEqual({ t: 'raise', to: 60 });
    expect(G.parse({ t: 'rebuy', amount: 900, extra: 1 })).toEqual({ t: 'rebuy', amount: 900 });
    for (const t of ['fold', 'check', 'call', 'allin', 'away', 'back', 'rebuy']) expect(G.parse({ t })).toEqual({ t });
    expect(['away', 'back', 'rebuy'].map((t) => G.free!({ t } as RoomAction))).toEqual([true, true, true]);
    expect(G.free!({ t: 'call' })).toBe(false);
  });

  it('托管的真人座位只过牌或弃牌（和超时一样记一次超时），电脑座位按性格打', () => {
    // 两个真人（0.4.0 至少两个才发牌）：1 号自己打（能过就过、不然弃），0 号托管
    const manual = (x: RoomState) => act(x, 1, G.view(x, 1).legal!.check ? { t: 'check' } : { t: 'fold' });
    /** 像 drive，但轮到 1 号时替他自己出；直到轮到托管以外的 0 号（auto 不含 0 时）或者没人要出 */
    const run = (x0: RoomState, auto: boolean): RoomState => {
      let x = x0;
      for (let k = 0; k < 500; k++) {
        x = drive(x, auto ? [0] : []);
        if (G.turn(x) !== 1) return x;
        x = manual(x);
      }
      throw new Error('run did not stop');
    };
    let s = run(settleAll(begin(['human', 'human', 'ai', 'ai'])), false);
    expect(G.turn(s)).toBe(0);
    expect(G.ai(s, 0)).toEqual({ t: 'timeout' });
    expect(G.timeout!(s, 0)).toEqual({ t: 'timeout' });
    const lg = G.view(s, 0).legal!;
    const hand = s.t.handNo;
    s = act(s, 0, G.ai(s, 0));
    if (s.t.handNo === hand) expect(s.t.log.at(-1)).toMatchObject({ seat: 0, act: lg.check ? 'check' : 'fold', auto: true });
    else expect(s.t.seats[0]!.timeouts).toBe(1);
    // 托管连着两手超时：暂离，不再发牌；能打的真人只剩 1 号一个（0.4.0），停着等
    s = run(s, true);
    expect(s.t.seats[0]!.away).toBe(true);
    expect(G.turn(s)).toBeNull();
    expect(G.waiting!(s)).toBe(true);
    expect(G.view(s, 1).needTwo).toBe(true);
    s = act(s, 0, { t: 'back' });
    expect(s.t.phase).toBe('preflop');
  });

  it('最近一次出手记在视图的 last 里（页面按它播动画）：谁、做了什么，n 每次加一；没做成的不记', () => {
    let s = seatedAll(['human', 'human', 'ai']);
    const n0 = G.view(s, 0).last?.n ?? 0;
    const seat = G.turn(s)!;
    expect(G.apply(s, seat === 0 ? 1 : 0, { t: 'call' })).toMatchObject({ error: expect.any(String) });
    s = act(s, seat, { t: 'call' });
    expect(G.view(s, 0).last).toEqual({ n: n0 + 1, seat, action: { t: 'call' } });
    expect(G.view(s, 1).last).toEqual(G.view(s, 0).last);
    // 一步里电脑接着出的也各记一次
    const next = G.turn(s)!;
    s = act(s, next, G.ai(s, next));
    expect(G.view(s, 2).last?.n).toBe(n0 + 2);
  });

  it('桌上还不是他（买入没到账）不能出手；房间关了什么都不收', () => {
    const s = begin(['human', 'ai']);
    expect(G.apply(s, 0, { t: 'away' })).toEqual({ error: 'not_seated' });
    expect(G.apply(G.closing!(settleAll(s)), 0, { t: 'fold' })).toEqual({ error: 'closed' });
  });
});

describe('座位换人', () => {
  it('接管电脑的座位：电脑这一手弃牌、打完收回庄家，新人扣满买入，下一手坐上；这一手电脑的底牌不给他看', () => {
    // 两个真人在打（0.4.0 至少两个才发牌），第三个人来接管 3 号电脑
    let s = drive(settleAll(begin(['human', 'human', 'ai', 'ai'])));
    const house = s.t.seats[3]!;
    expect(house.owner).toBe('house');
    s = G.seated!(s, 3, 'human');
    conserve(s.t);
    expect(s.t.seats[3]).toMatchObject({ owner: 'house', leaving: true, status: 'folded' });
    expect(G.view(s, 3).hole).toEqual([]);
    expect(debits(s).map(strip)).toEqual([{ id: 'b2', seat: 3, kind: 'debit', amount: MAX }]);
    s = settleAll(s);
    expect(G.view(s, 3).buying[3]).toBe(true);
    // 这一手打完：电脑离桌（筹码收回庄家，不结给任何人），他坐上去
    while (s.t.handNo === 1) s = drive(act(s, G.turn(s)!, { t: 'fold' }));
    // 停着那几秒里就坐上了，下一手直接发到他（盲注可能已经交了一点）
    expect(s.t.seats[3]!.owner).toBe('player');
    expect(s.t.seats[3]!.stack + s.t.seats[3]!.total).toBe(MAX);
    expect(credits(s)).toEqual([]);
    expect(G.view(s, 3).buying[3]).toBe(false);
  });

  it('加注后马上离座，别人都弃了：没人跟的那一注留在池里归赢家，不退给已经结回封上的他，房间里不搁结不回去的钱（0.3.3）', () => {
    let s = seatedAll(['human', 'human', 'human']);
    const seat = G.turn(s)!;
    const to = G.view(s, seat).legal!.minTo;
    s = act(s, seat, { t: 'raise', to });
    const stack = s.t.seats[seat]!.stack;
    s = G.seated!(s, seat, 'ai');
    expect(credits(s).map(strip)).toEqual([{ id: expect.stringMatching(/^c/), seat, kind: 'credit', amount: stack }]);
    s = settleAll(s);
    const pot = s.t.seats.reduce((a, x) => a + x.total, 0);
    // 剩下两个人：轮到的弃牌，最后一个人拿走整个池子（含他那一注）
    const folder = G.turn(s)!;
    s = act(s, folder, { t: 'fold' });
    const winner = [0, 1, 2].find((i) => i !== seat && i !== folder)!;
    expect(s.t.lastHand).toMatchObject({ byFold: true, uncalled: null, pots: [{ amount: pot, winners: [{ seat: winner, won: pot }] }] });
    conserve(s.t);
    expect(s.owed[seat]).toBe(0);
    expect(credits(s)).toEqual([]);
  });

  it('离座（0.2.4 立即结算）：这一手当场弃牌，桌上剩下的马上结回，投进池子的留着；别人打完这一手电脑再坐进来；马上又回来的买新的一份', () => {
    // 三个真人：他走了还剩两个，下一手照常发（0.4.0 至少两个真人）
    let s = seatedAll(['human', 'human', 'human', 'ai']);
    const seat = G.turn(s)!;
    const others = [0, 1, 2].filter((i) => i !== seat);
    const stack = s.t.seats[seat]!.stack;
    const put = s.t.seats[seat]!.total;
    s = G.seated!(s, seat, 'ai');
    conserve(s.t);
    expect(s.t.seats[seat]).toMatchObject({ owner: 'player', leaving: true, status: 'folded', stack: 0, total: put });
    expect(credits(s).map(strip)).toEqual([{ id: expect.stringMatching(/^c/), seat, kind: 'credit', amount: stack }]);
    expect(G.over(s)).toBe(false);
    // 这一份已经结回：马上回来不能接着坐，买新的一份（排在结回后面），这一手打完才坐上
    const back = G.seated!(s, seat, 'human');
    expect(back.t.seats[seat]!.leaving).toBe(true);
    expect(back.fx.filter((e) => e.seat === seat).map((e) => [e.kind, e.ref])).toEqual([
      ['credit', `${s.ref}s${seat}n1`],
      ['debit', `${s.ref}s${seat}n2`],
    ]);

    // 真走了：另外两个真人还在，这一手照常打完，电脑坐进来，不再结第二次
    s = G.settled!(s, credits(s)[0]!.id, OK);
    while (s.t.handNo === 2) s = drive(act(s, G.turn(s)!, G.view(s, G.turn(s)!).legal!.check ? { t: 'check' } : { t: 'call' }));
    expect(s.t.seats[seat]!.owner).toBe('house');
    expect(effects(s)).toEqual([]);
    for (const o of others) expect(s.t.seats[o]!.owner).toBe('player');
  });

  it('最后一个真人离座：电脑替他把这一手打完，筹码马上结回去，房间算打完（over）', () => {
    // 两个真人才发得出牌（0.4.0）：1 号先在这一手弃牌、离座，0 号就是最后一个真人，再走就没真人了
    let s = drive(settleAll(begin(['human', 'human', 'ai', 'ai', 'ai'])));
    // 等到 1 号已经弃了、轮到 0 号、他弃牌以后还有两个电脑在这一手里（不然他一弃这一手就完了）。
    // 1 号一轮到就弃；0 号在 1 号弃之前跟着（这一手留到 1 号弃完再轮到他），之后不够条件就弃
    const ready = (x: RoomState) => G.turn(x) === 0 && x.t.seats[1]!.status === 'folded' && x.t.seats.filter((c) => c.owner === 'house' && c.status === 'active').length >= 2;
    for (let k = 0; k < 500 && !ready(s); k++) {
      const seat = G.turn(s)!;
      const lg = G.view(s, seat).legal!;
      s = drive(act(s, seat, seat === 0 && s.t.seats[1]!.status !== 'folded' ? (lg.check ? { t: 'check' } : { t: 'call' }) : { t: 'fold' }));
    }
    expect(ready(s)).toBe(true);
    s = settleAll(G.seated!(s, 1, 'ai'));
    // 1 号走了这一手还在打，0 号还在：房间没打完
    expect(s.t.phase).not.toBe('idle');
    expect(G.over(s)).toBe(false);
    s = G.seated!(s, 0, 'ai');
    conserve(s.t);
    expect(s.t.phase).toBe('idle');
    expect(s.t.seats[0]!.owner).toBe('house');
    expect(s.t.seats[1]!.owner).toBe('house');
    expect(credits(s).map(strip)).toEqual([{ id: expect.stringMatching(/^c/), seat: 0, kind: 'credit', amount: expect.any(Number) }]);
    // 没有真人了：这一场打完（0.2.4），kit 还开房名额、办完结回关房
    expect(G.over(s)).toBe(true);
    // 这一手打完先停着；停够了发不了下一手（没有真人），停着等人
    expect(G.pause!(s)).toBe(HAND_PAUSE_MS);
    s = G.resume!(s);
    expect(G.pause!(s)).toBeNull();
    expect(G.waiting!(s)).toBe(true);
  });

  it('扣到了但人已经走了：结回去（不上桌）；一笔都没扣到的不用结', () => {
    let s = begin(['human', 'human', 'ai']);
    s = G.seated!(s, 1, 'ai');
    s = G.settled!(s, 'b1', OK);
    expect(s.t.seats[1]!.owner).toBe('house');
    expect(credits(s)).toEqual([{ id: expect.stringMatching(/^c/), seat: 1, kind: 'credit', amount: MAX, ref: `${s.ref}s1n1`, stakes: 'small', stats: { rounds: 0, wins: 0, best: 0 } }]);
    const refused = G.settled!(G.seated!(begin(['human', 'human', 'ai']), 1, 'ai'), 'b1', { ok: false, error: 'no_funds' });
    expect(effects(refused).filter((e) => e.seat === 1)).toEqual([]);
    expect(refused.sealed[1]).toBe(true);
  });

  it('平台钱包每一份只结一次：每份一个 ref（房间号 s 座位 n 第几份），结回在路上时又坐下，新的带入排在后面、开新的一份', () => {
    let s = seatedAll(['human', 'human', 'ai']);
    expect(s.ref).toMatch(/^r[0-9a-f]{16}$/);
    const seat = G.turn(s)!;
    s = G.seated!(s, seat, 'ai');
    while (s.t.seats[seat]!.owner === 'player') s = drive(act(s, G.turn(s)!, G.view(s, G.turn(s)!).legal!.check ? { t: 'check' } : { t: 'call' }));
    const [c] = credits(s);
    expect(c).toMatchObject({ seat, ref: `${s.ref}s${seat}n1` });
    // 结回还没办完就回来了：电脑这一手弃牌，新的一份等结回办完才扣
    s = G.seated!(s, seat, 'human');
    expect(s.fx.filter((e) => e.seat === seat).map((e) => [e.kind, e.ref])).toEqual([
      ['credit', `${s.ref}s${seat}n1`],
      ['debit', `${s.ref}s${seat}n2`],
    ]);
    expect(effects(s).filter((e) => e.seat === seat).map((e) => e.kind)).toEqual(['credit']);
    s = G.settled!(s, c!.id, OK);
    expect(effects(s).filter((e) => e.seat === seat)).toMatchObject([{ kind: 'debit', ref: `${s.ref}s${seat}n2` }]);
    // 到账、下一手坐上：还是第 2 份，开着（之后补码加在这一份上）
    s = settleAll(s);
    const seated = (x: RoomState) => x.t.seats[seat]!.owner === 'player' && x.t.seats[seat]!.status !== 'out';
    while (!seated(s)) s = drive(act(s, G.turn(s)!, { t: 'fold' }), [seat]);
    expect(s.share[seat]).toBe(2);
    expect(s.sealed[seat]).toBe(false);
  });
});

describe('补码', () => {
  it('补码（0.3.0）：不满一份就能补到满，满了不能补；补码在路上时不能再补；这一手打完才上桌；路上又赢满了，放不下的攒着、离桌时一起结回', () => {
    // 打到第 2 手轮到真人（drive 停在真人出手前）
    const base = drive(settleAll(begin(['human', 'human', 'ai'])));
    const full = structuredClone(base);
    full.t.bank += MAX - full.t.seats[0]!.stack;
    full.t.seats[0]!.stack = MAX;
    expect(G.apply(full, 0, { t: 'rebuy' })).toEqual({ error: 'cannot_rebuy' });
    // 钱包不够补满（平台 0.10.2）：补钱包够的，最少一个大盲、最多补到满
    const short = structuredClone(base);
    short.t.bank += MAX - 300 - short.t.seats[0]!.stack;
    short.t.seats[0]!.stack = MAX - 300;
    expect([100, 5, 900].map((amount) => debits(act(short, 0, { t: 'rebuy', amount }))[0]!.amount)).toEqual([100, stakesOf('small').bb, 300]);

    const run = (wonMeanwhile: boolean): RoomState => {
      let s = structuredClone(base);
      // 0 号桌上（不算这一手已经投的）差 300 到满
      s.t.bank += MAX - 300 - s.t.seats[0]!.stack;
      s.t.seats[0]!.stack = MAX - 300;
      expect(G.view(s, 0).canRebuy).toBe(true);
      s = act(s, 0, { t: 'rebuy' });
      expect(debits(s).map(strip)).toEqual([{ id: expect.stringMatching(/^b/), seat: 0, kind: 'debit', amount: 300 }]);
      expect(G.apply(s, 0, { t: 'rebuy' })).toEqual({ error: 'cannot_rebuy' });
      s = settleAll(s);
      expect(s.held[0]).toBe(300);
      if (wonMeanwhile) {
        s.t.bank += 300;
        s.t.seats[0]!.stack = MAX;
      }
      const hand = s.t.handNo;
      while (s.t.handNo === hand) s = drive(act(s, G.turn(s)!, { t: 'fold' }));
      conserve(s.t);
      expect(s.held[0]).toBe(0);
      expect(s.t.seats[0]!.stack + s.t.seats[0]!.total).toBeLessThanOrEqual(MAX);
      return s;
    };
    expect(run(false).owed[0]).toBe(0);
    expect(run(true).owed[0]).toBe(300);
  });
});

describe('收场', () => {
  it('房间要关：这一手作废、各人投的退回，所有人桌上的筹码结回去，没上桌的买入退回；之后到账的买入原样退', () => {
    let s = settleAll(begin(['human', 'human', 'human', 'ai']));
    s = drive(s);
    s = act(s, G.turn(s)!, { t: 'raise', to: 100 });
    // 3 号还在路上的补码（假装接管后发起的）
    s = G.seated!(s, 3, 'human');
    const before = s.t.seats.map((x) => (x.owner === 'player' ? x.stack + x.total : 0));
    const closed = G.closing!(s);
    expect(closed.closed).toBe(true);
    expect(closed.t.seats.every((x) => x.owner === 'none')).toBe(true);
    expect(closed.t.bank).toBe(0);
    const cs = credits(closed);
    expect(cs.map((c) => [c.seat, c.amount])).toEqual(before.flatMap((x, i) => (x > 0 ? [[i, x]] : [])));
    expect(G.turn(closed)).toBeNull();
    // 3 号的买入关的时候还在路上：到账后结回去
    const late = G.settled!(closed, debits(closed)[0]!.id, OK);
    expect(credits(late).at(-1)).toMatchObject({ seat: 3, kind: 'credit', amount: MAX, id: expect.stringMatching(/^c/) });
    expect(effects(settleAll(late))).toEqual([]);
  });

  it('收场点：一手和一手之间，或者新的一手只交了盲注', () => {
    // 两个真人才发牌（0.4.0）
    let s = begin(['human', 'human', 'ai']);
    expect(G.breakPoint!(s)).toBe(true);
    s = settleAll(s);
    expect(s.t.phase).toBe('preflop');
    expect(G.breakPoint!(s)).toBe(true);
    const seat = G.turn(s)!;
    s = act(s, seat, { t: 'raise', to: 60 });
    expect(G.breakPoint!(s)).toBe(false);
  });
});

describe('隐藏信息和体积', () => {
  it('视图里没有种子、房间号、别人的底牌；没入座的人看不到任何底牌', () => {
    const s = drive(settleAll(begin(['human', 'human', 'ai', 'ai', 'ai', 'ai'])));
    for (const seat of [null, 0, 1, 2, 3, 4, 5]) {
      const v = G.view(s, seat);
      const json = JSON.stringify(v);
      expect(json).not.toContain(s.ref);
      expect(Object.keys(v)).not.toContain('seed');
      expect(v.hole).toEqual(seat !== null && s.t.seats[seat]!.owner === 'player' ? s.t.seats[seat]!.hole : []);
    }
  });

  // 0.2.0 起最坏是 9 个真人座位：房间信息（每个座位的昵称）和牌桌都多了三个座位，上限从 6 KB 放到 8 KB
  it('快照（最坏：9 个真人座位、河牌、长操作记录）不超过 8 KB', () => {
    let s = settleAll(begin(new Array<SeatKind>(9).fill('human')));
    // 一路小注加注到河牌，操作记录最长
    for (let k = 0; k < 400 && s.t.handNo === 1 && s.t.phase !== 'river'; k++) {
      const seat = G.turn(s)!;
      const lg = G.view(s, seat).legal!;
      s = act(s, seat, lg.raise && lg.minTo < 600 ? { t: 'raise', to: lg.minTo } : lg.check ? { t: 'check' } : { t: 'call' });
    }
    expect(s.t.phase).toBe('river');
    expect(snapshotBytes(G, s)).toBeLessThanOrEqual(8 * 1024);
  });
});

describe('随机走很多步（座位换人、买入被拒、补码、收场）', () => {
  it('筹码守恒、事都能办完、每笔 id 只出现一次；收场后桌上的全结回去；照平台钱包的规矩（每份只结一次、结完不再带入、每座位一次一笔）', () => {
    let rng = 12345;
    const rand = (n: number) => {
      rng = (rng * 1103515245 + 12345) % 2 ** 31;
      return rng % n;
    };
    for (let round = 0; round < 20; round++) {
      let s = begin(['human', 'human', 'ai', 'ai', 'ai'], 5, ['small', 'mid', 'big', 'lux'][round % 4]);
      const seen = new Set<string>();
      let debited = 0;
      let credited = 0;
      // 平台钱包的样子：每个 ref 一份，带入加上去，结回一次清掉；结过的 ref 再带入、再结回都是规则写错了
      const open = new Map<string, number>();
      const done = new Set<string>();
      const reply = (e: WalletEffect) => {
        expect(seen.has(e.id)).toBe(false);
        seen.add(e.id);
        expect(done.has(e.ref)).toBe(false);
        if (e.kind === 'credit') {
          credited += e.amount;
          open.delete(e.ref);
          done.add(e.ref);
          return OK;
        }
        if (rand(5) === 0) return { ok: false, error: 'no_funds' };
        debited += e.amount;
        open.set(e.ref, (open.get(e.ref) ?? 0) + e.amount);
        return OK;
      };
      const oneEach = (x: RoomState) => {
        const seats = effects(x).map((e) => e.seat);
        expect(new Set(seats).size).toBe(seats.length);
      };
      for (let step = 0; step < 300; step++) {
        const r = rand(20);
        const seat = rand(5);
        if (r === 0) s = G.seated!(s, seat, s.kinds[seat] === 'human' ? 'ai' : 'human');
        else if (r < 4) s = settleAll(s, reply);
        else if (r === 4 && G.view(s, seat).canRebuy) s = act(s, seat, { t: 'rebuy' });
        else {
          const t = G.turn(s);
          if (t !== null) s = act(s, t, G.ai(s, t));
        }
        conserve(s.t);
        oneEach(s);
      }
      s = G.closing!(s);
      for (let k = 0; k < 10 && effects(s).length; k++) s = settleAll(s, reply);
      expect(effects(s)).toEqual([]);
      expect(s.t.bank).toBe(0);
      // 每一份都结回了，钱包里不留"桌上那一份"
      expect([...open.keys()]).toEqual([]);
      // 没有搁着结不回去的（0.3.3：封上以后又攒到的会随房间删掉，等于丢了）
      expect(s.owed).toEqual(new Array<number>(s.owed.length).fill(0));
      expect(s.held).toEqual(new Array<number>(s.held.length).fill(0));
      // 扣的 = 结回的 + 输给电脑的：牌桌清空时庄家净投入 house 是负的，就是电脑从真人那里赢走的（0.3.3）
      expect(debited).toBeGreaterThan(0);
      expect(debited - credited + s.t.house!).toBe(0);
    }
  });
});

describe('一手打完停一会儿（0.1.1，kit 0.5.0 的 pause）', () => {
  it('一手打完：没人要出手、pause 给 HAND_PAUSE_MS、不算在等人；这时坐下、补码到账都不发牌；resume 才发下一手', () => {
    let s = drive(settleAll(begin(['human', 'human', 'ai', 'ai'])));
    expect(s.t.handNo).toBe(1);
    // 两个真人都弃，电脑打完这一手
    for (let k = 0; k < 50 && s.t.handNo === 1 && !s.t.hold; k++) {
      const seat = G.turn(s);
      if (seat === null) break;
      s = act(s, seat, s.kinds[seat] === 'human' ? { t: 'fold' } : G.ai(s, seat));
    }
    expect(s.t).toMatchObject({ handNo: 1, phase: 'idle', hold: true });
    expect(G.turn(s)).toBeNull();
    expect(G.pause!(s)).toBe(HAND_PAUSE_MS);
    expect(G.waiting!(s)).toBe(false);
    expect(G.breakPoint!(s)).toBe(true);
    // 停着时暂离、回来这些不轮流的操作都不发牌
    s = act(s, 0, { t: 'away' });
    s = act(s, 0, { t: 'back' });
    expect(s.t).toMatchObject({ handNo: 1, hold: true });
    // 视图带着 hold，页面据此摆结果、画倒计时
    expect(G.view(s, 0).hold).toBe(true);
    s = G.resume!(s);
    expect(s.t).toMatchObject({ handNo: 2, hold: false });
    expect(G.pause!(s)).toBeNull();
    conserve(s.t);
  });

  it('房间要关时不再停：pause 为 null', () => {
    // 两个真人才发牌（0.4.0）：真人都弃，电脑打完这一手
    let s = drive(settleAll(begin(['human', 'human', 'ai'])));
    while (!s.t.hold) s = act(s, G.turn(s)!, s.kinds[G.turn(s)!] === 'human' ? { t: 'fold' } : G.ai(s, G.turn(s)!));
    expect(G.pause!(s)).toBe(HAND_PAUSE_MS);
    s = G.closing!(s);
    expect(G.pause!(s)).toBeNull();
  });

  it('这一场每个人的输赢：带入的、结回的、桌上的对得上；没带入过的座位是 null', () => {
    /** 真人也让电脑替着打（托管只过牌弃牌），停着的到点 resume */
    const run = (s0: RoomState, n: number, stop: (s: RoomState) => boolean = () => false): RoomState => {
      let s = s0;
      for (let k = 0; k < n && !stop(s); k++) {
        const seat = G.turn(s);
        if (seat === null) {
          if (G.pause!(s) === null) break;
          s = G.resume!(s);
        } else s = act(s, seat, G.ai(s, seat));
      }
      return s;
    };
    let s = run(settleAll(begin(['human', 'human', 'ai', 'ai'])), 200);
    let v = G.view(s, 0);
    expect(v.net.slice(2)).toEqual([null, null]);
    for (const i of [0, 1]) expect(v.net[i]).toBe(s.t.seats[i]!.stack + s.t.seats[i]!.total - MAX);
    // 0 号离座：这一手打完结回排上（outs），输赢 = 结回的 − 带入的
    s = G.seated!(s, 0, 'ai');
    s = run(s, 200, (x) => credits(x).some((e) => e.seat === 0));
    const c = credits(s).find((e) => e.seat === 0)!;
    expect(s.outs![0]).toBe(c.amount);
    v = G.view(s, 1);
    expect(v.net[0]).toBe(c.amount - MAX);
    // 输赢加起来 + 电脑那边的变化 = 0：真人输的进了庄家，赢的是庄家出的（这里只核对真人自己的账对得上）
    expect(v.net[1]).toBe(s.t.seats[1]!.stack + s.t.seats[1]!.total - MAX);
  });
});

describe('实盘至少两个真人（0.4.0）、电脑按好友房的强弱档（0.5.0）', () => {
  /** 轮到的真人能过就过、不然跟（不弃，这一手打到摊牌），电脑按性格；直到这一手打完、停着的也 resume 过 */
  const finishHand = (s0: RoomState): RoomState => {
    let s = s0;
    const hand = s.t.handNo;
    for (let k = 0; k < 500 && s.t.handNo === hand && G.turn(s) !== null; k++) {
      const seat = G.turn(s)!;
      s = drive(act(s, seat, G.view(s, seat).legal!.check ? { t: 'check' } : { t: 'call' }));
    }
    return drive(s);
  };

  it('一个真人带电脑：买入照扣、牌不发，页面说要两个人；他走了原样结回，不计输赢', () => {
    let s = settleAll(begin(['human', 'ai', 'ai']));
    expect(s.t.seats[0]).toMatchObject({ owner: 'player', stack: MAX });
    expect(s.t).toMatchObject({ phase: 'idle', handNo: 0 });
    expect(G.turn(s)).toBeNull();
    expect(G.waiting!(s)).toBe(true);
    expect(G.view(s, 0).needTwo).toBe(true);
    // 没坐下的人看到的也一样
    expect(G.view(s, null).needTwo).toBe(true);
    s = G.seated!(s, 0, 'ai');
    expect(credits(s).map(strip)).toEqual([{ id: expect.stringMatching(/^c/), seat: 0, kind: 'credit', amount: MAX }]);
    expect(credits(s)[0]!.stats).toEqual({ rounds: 0, wins: 0, best: 0 });
    s = settleAll(s);
    expect(effects(s)).toEqual([]);
    expect(s.t.handNo).toBe(0);
    expect(G.over(s)).toBe(true);
  });

  it('第二个真人后来坐下、买入到账：马上发第一手，不再提示要两个人', () => {
    let s = settleAll(begin(['human', 'ai', 'ai']));
    s = G.seated!(s, 1, 'human');
    expect(debits(s).map((e) => e.seat)).toEqual([1]);
    // 买入在路上也算一个：页面不说"要两个人"（马上就够了）
    expect(G.view(s, 0).needTwo).toBe(false);
    expect(s.t.phase).toBe('idle');
    s = settleAll(s);
    // 一到账就发了牌，可能已经交了盲注
    expect(s.t.seats[1]!.owner).toBe('player');
    expect(s.t.seats[1]!.stack + s.t.seats[1]!.total).toBe(MAX);
    expect(s.t.handNo).toBe(1);
    expect(s.t.phase).toBe('preflop');
    expect(G.view(s, 0).needTwo).toBe(false);
  });

  it('两个真人打着、一个中途走了：这一手照常打完，下一手不发，剩下那个的筹码一分不少', () => {
    let s = seatedAll(['human', 'human', 'ai']);
    const hand = s.t.handNo;
    const seat = G.turn(s)!;
    const other = 1 - seat;
    s = settleAll(G.seated!(s, seat, 'ai'));
    expect(s.t.phase).not.toBe('idle');
    s = finishHand(s);
    expect(s.t.handNo).toBe(hand);
    expect(s.t).toMatchObject({ phase: 'idle', hold: false });
    expect(G.pause!(s)).toBeNull();
    expect(G.waiting!(s)).toBe(true);
    expect(G.view(s, other).needTwo).toBe(true);
    // 走的那个座位换成电脑；留下的还在桌上，这一场的输赢 = 桌上的 − 带入的
    expect(s.t.seats[seat]!.owner).toBe('house');
    expect(s.t.seats[other]).toMatchObject({ owner: 'player', total: 0 });
    expect(G.view(s, other).net[other]).toBe(s.t.seats[other]!.stack - MAX);
    conserve(s.t);
    expect(effects(s)).toEqual([]);
  });

  it('暂离的真人不算：两个真人、一个暂离，这一手打完下一手不发；他回来接着发', () => {
    let s = seatedAll(['human', 'human', 'ai']);
    const hand = s.t.handNo;
    const seat = G.turn(s)!;
    const other = 1 - seat;
    s = act(s, other, { t: 'away' });
    // 暂离的这一手轮到他就当超时（托管），另一个照常打
    for (let k = 0; k < 500 && s.t.handNo === hand && G.turn(s) !== null; k++) {
      const t = G.turn(s)!;
      s = drive(act(s, t, t === other ? G.ai(s, t) : G.view(s, t).legal!.check ? { t: 'check' } : { t: 'call' }));
    }
    s = drive(s);
    expect(s.t.handNo).toBe(hand);
    expect(s.t.phase).toBe('idle');
    expect(G.waiting!(s)).toBe(true);
    expect(G.view(s, seat).needTwo).toBe(true);
    s = act(s, other, { t: 'back' });
    expect(s.t).toMatchObject({ handNo: hand + 1, phase: 'preflop' });
    expect(G.view(s, seat).needTwo).toBe(false);
  });

  it('电脑按档位用好友房的强弱档（0.5.0，ROOM_LEVEL）；0.4.0 开的房间（strong）照旧最强；更早开的下一步补上', () => {
    for (const st of STAKES) {
      const s = settleAll(begin(['human', 'human', 'ai', 'ai'], 4, st.id));
      expect(s.t, st.id).toMatchObject({ minHumans: 2, level: ROOM_LEVEL[st.id] });
      expect(G.view(s, 0).level, st.id).toBe(ROOM_LEVEL[st.id]);
    }
    // 0.4.0 开的房间：没有 level、有 strong，按最强档（5）
    const v040 = begin(['human', 'human', 'ai']);
    delete v040.t.level;
    v040.t.strong = true;
    expect(G.view(settleAll(v040), 0).level).toBe(5);

    // 老房间：牌桌上没有 minHumans、level（0.4.0 以前开的），一个人带电脑；下一步按新规矩，不发牌
    const old = begin(['human', 'ai', 'ai']);
    delete old.t.minHumans;
    delete old.t.level;
    const s = settleAll(old);
    expect(s.t).toMatchObject({ minHumans: 2, level: ROOM_LEVEL.small, phase: 'idle', handNo: 0 });
    expect(G.view(s, 0).needTwo).toBe(true);
  });
});

describe('钱包 op 和结回上限（0.13.2 审计）', () => {
  it('好友房每一笔的 op 都以房间号 r 开头，永远不是 solo- 开头（单机的由 Worker 加 solo- 前缀，两边撞不上）', () => {
    let s = seatedAll(['human', 'human', 'ai', 'ai']);
    const ops: string[] = [];
    for (let k = 0; k < 60; k++) {
      ops.push(...effects(s).map((e) => roomOp(e)));
      s = settleAll(s);
      const seat = G.turn(s);
      if (seat === null) break;
      s = drive(act(s, seat, { t: 'fold' }));
    }
    ops.push(...effects(G.closing!(s)).map((e) => roomOp(e)));
    expect(ops.length).toBeGreaterThan(0);
    for (const o of ops) {
      expect(o.startsWith(SOLO_OP)).toBe(false);
      expect(o).toMatch(/^r[0-9a-f]{16}s\dn\d+-[bc]\d+$/);
    }
    // 单机：加前缀、不重复加、加了超过 64 位不收
    expect(soloOp('abcdefgh')).toBe('solo-abcdefgh');
    expect(soloOp('solo-abcdefgh')).toBe('solo-abcdefgh');
    expect(soloOp('x'.repeat(60))).toBeNull();
    expect(soloOp(ops[0]!)).toBe(`solo-${ops[0]}`);
  });

  it('一份结回最多"带上桌的 + 20 份"（平台的上限，多了整笔被拒）：赢超了的封到上限再结，不会整份结不回去', () => {
    const s = seatedAll(['human', 'human', 'ai', 'ai']);
    const max = stakesOf(s.t.stakes).max;
    // 别人前后补码二十多次都输给 0 号：直接把要结回的攒到很大（不经牌桌，筹码守恒不查这一项）
    const big = { ...s, owed: s.owed.map((x, i) => (i === 0 ? x + 30 * max : x)) };
    const out = credits(G.closing!(big)).find((e) => e.seat === 0)!;
    expect(out.amount).toBe(settleCap(max, max));
    expect(settleCap(max, max)).toBe(max + SETTLE_EXTRA * max);
    // 没超的照原样结
    const fine = credits(G.closing!(s)).find((e) => e.seat === 0)!;
    expect(fine.amount).toBeLessThan(settleCap(max, max));
  });
});
