/**
 * 好友房的规则（src/room/rules.ts）：开局带入、少带、被拒由庄家打、离座马上结回、打完和关房结回、隐藏信息。
 * 房间（kit）、钱包 DO 在 workerd 里的部分在 test/worker/room.test.ts。
 */
import { snapshotBytes } from 'arcade-kit/game';
import type { SeatKind } from 'arcade-kit/protocol';
import { describe, expect, test } from 'vitest';
import type { XzState, XzView } from '../src/core/variants/sichuan-xuezhan/index.ts';
import { EMOTES } from '../src/game/emotes.ts';
import { mahjongRoom as G, OPENING_MS, REMATCH_MS, type RoomAction, type RoomState, type WalletEffect } from '../src/room/rules.ts';
import { KEY } from './helpers.ts';
import { RON, tileIn } from './xz-table.ts';

const SHARE = 2_000;
const OK = { ok: true };
const RULES = { rounds: 4, cap: 3, swap: true, zimo: 'di', transfer: true };

function begin(seats: SeatKind[], stakes = 'small', key = KEY): RoomState {
  const opts = G.options!({ variant: 'sichuan-xuezhan', stakes, rules: RULES })!;
  return G.begin!(key, 1, { opts, seats });
}

function must(x: RoomState | { error: string }): RoomState {
  if ('error' in x && typeof x.error === 'string') throw new Error(`unexpected error ${x.error}`);
  return x as RoomState;
}

const act = (s: RoomState, seat: number, a: RoomAction) => must(G.apply(s, seat, a));
const fx = (s: RoomState) => G.effects!(s);
const strip = ({ ref: _r, stakes: _s, stats: _t, ...e }: WalletEffect) => e;
const g = (s: RoomState, seat: number | null) => G.view(s, seat).g as XzView;
const seatsOf = (s: RoomState) => {
  const a = G.actors!(s);
  return Array.isArray(a) ? a : a.seats;
};

function settleAll(s0: RoomState, reply: (e: WalletEffect) => unknown = () => OK): RoomState {
  let s = s0;
  for (let k = 0; k < 20 && fx(s).length; k++) for (const e of fx(s)) s = G.settled!(s, e.id, reply(e));
  return s;
}

/** 像房间一样推：电脑座位用 ai，真人用 timeout（当他一直没点），停着的就 resume；直到打完或者 steps 用完 */
function drive(s0: RoomState, steps = 100_000, stop?: (s: RoomState) => boolean): RoomState {
  let s = s0;
  for (let k = 0; k < steps && !G.over(s); k++) {
    if (stop?.(s)) return s;
    const seats = seatsOf(s);
    if (!seats.length) {
      expect(G.pause!(s)).not.toBeNull();
      s = G.resume!(s);
      continue;
    }
    const seat = seats[0]!;
    s = act(s, seat, s.kinds[seat] === 'ai' ? G.ai(s, seat) : G.timeout!(s, seat));
  }
  return s;
}

describe('选项', () => {
  test('默认、合格、不合格', () => {
    expect(G.options!(undefined)).toMatchObject({ variant: 'sichuan-xuezhan', stakes: 'fun' });
    expect(G.options!({ variant: 'sichuan-xuezhan', stakes: 'mid', rules: { rounds: 8 } })).toMatchObject({ stakes: 'mid', rules: { rounds: 8, cap: 4 } });
    expect(G.options!({ stakes: 'x' })).toBeNull();
    expect(G.options!({ variant: 'riichi', stakes: 'fun' })).toBeNull();
    expect(G.options!({ stakes: 'fun', rules: { rounds: 5 } })).toBeNull();
    expect(G.options!([])).toBeNull();
  });

  test('交流的编号：14 句短语 + 12 张表情包 + 8 个道具', () => {
    expect(G.emotes).toBe(EMOTES);
    expect(EMOTES).toBe(34);
  });
});

describe('开局和带入', () => {
  test('娱乐：不碰钱包，真人一坐下就能打', () => {
    const s = begin(['human', 'human', 'ai', 'ai'], 'fun');
    expect(fx(s)).toEqual([]);
    expect(s.opening).toBe(false);
    expect(s.own).toEqual([true, true, false, false]);
    expect(G.actors!(s)).toMatchObject({ group: 'swap-0' });
  });

  test('实盘：真人的带入交给钱包，都有回话才开打；ref 是房间号 + 座位 + 第几份', () => {
    let s = begin(['human', 'human', 'ai', 'ai']);
    expect(s.ref).toMatch(/^r[0-9a-f]{16}$/);
    expect(fx(s).map(strip)).toEqual([
      { id: 'b0', seat: 0, kind: 'debit', amount: SHARE },
      { id: 'b1', seat: 1, kind: 'debit', amount: SHARE },
    ]);
    expect(fx(s)[0]!.ref).toBe(`${s.ref}s0n1`);
    expect(G.actors!(s)).toEqual({ seats: [0], group: 'opening' });
    expect(G.turnMs!(s)).toBe(OPENING_MS);
    expect(G.apply(s, 0, { t: 'play', v: 'sichuan-xuezhan', a: { t: 'swap', tiles: [] } })).toEqual({ error: 'opening' });
    // 客户端发不了 go（parse 不收）
    expect(G.parse({ t: 'go' })).toBeNull();
    // 也发不了收掉声明窗口的 expire、电脑的 bot 回答；合格的玩法动作带上玩法 id
    expect(G.parse({ t: 'play', a: { t: 'expire', w: 1 } })).toBeNull();
    expect(G.parse({ t: 'play', a: { t: 'claim', w: 1, c: 'pass', bot: true } })).toBeNull();
    expect(G.parse({ t: 'play', a: { t: 'claim', w: 1, c: 'pass' } })).toEqual({ t: 'play', v: 'sichuan-xuezhan', a: { t: 'claim', w: 1, c: 'pass' } });
    expect(G.free!(G.parse({ t: 'play', a: { t: 'claim', w: 1, c: 'pass' } })!)).toBe(true);
    s = G.settled!(s, 'b0', OK);
    expect(s.own).toEqual([true, false, false, false]);
    expect(G.actors!(s)).toEqual({ seats: [1], group: 'opening' });
    s = G.settled!(s, 'b1', OK);
    expect(s.opening).toBe(false);
    expect(s.own).toEqual([true, true, false, false]);
    expect(G.view(s, 0).inn).toBe(SHARE);
    expect(G.view(s, 2).inn).toBe(0);
    expect(G.view(s, null).inn).toBe(0);
  });

  test('钱包不够一份：有多少带多少（同一份、换个操作 id），筹码按带进来的算', () => {
    let s = begin(['human', 'ai', 'ai', 'ai']);
    s = G.settled!(s, 'b0', { ok: false, error: 'no_funds', balance: 500 });
    expect(fx(s).map(strip)).toEqual([{ id: 'b1', seat: 0, kind: 'debit', amount: 500 }]);
    expect(fx(s)[0]!.ref).toBe(`${s.ref}s0n1`);
    s = G.settled!(s, 'b1', OK);
    expect(s.own[0]).toBe(true);
    expect(g(s, 0).seats[0]!.chips).toBe(500);
    expect(G.view(s, 0).inn).toBe(500);
    // 少带的数就是他的钱包余额：只给本人看；桌上的筹码本来就公开
    expect(G.view(s, 1).inn).toBe(0);
  });

  test('被拒（一分钱没有）：座位由庄家出筹码、这里替电脑打，他不能出手；可以再带一次', () => {
    let s = begin(['human', 'human', 'ai', 'ai']);
    s = G.settled!(G.settled!(s, 'b0', OK), 'b1', { ok: false, error: 'no_funds', wallet: { balance: 0 } });
    expect(s.opening).toBe(false);
    expect(G.view(s, 1).refused).toBe('no_funds');
    expect(G.view(s, 0).refused).toBeNull();
    expect(G.view(s, 1).canRebuy).toBe(true);
    // 换三张的名单里没有 1 号（已经替他换了）
    expect(seatsOf(s)).not.toContain(1);
    expect(G.apply(s, 1, { t: 'play', v: 'sichuan-xuezhan', a: { t: 'que', suit: 0 } })).toEqual({ error: 'not_seated' });
    s = act(s, 1, { t: 'rebuy' });
    expect(fx(s).map(strip)).toEqual([{ id: 'b2', seat: 1, kind: 'debit', amount: SHARE }]);
    // 没开成的那一份不算，再带还是第 1 份
    expect(fx(s)[0]!.ref).toBe(`${s.ref}s1n1`);
    expect(G.view(s, 1).buying[1]).toBe(true);
    s = G.settled!(s, 'b2', OK);
    expect(s.own[1]).toBe(true);
    expect(g(s, 1).seats[1]!.chips).toBe(SHARE);
  });

  test('开局有人的带入一直没回话：到点（房间代出 go）先开打，他的座位先由庄家打，到账了再接手', () => {
    let s = G.settled!(begin(['human', 'human', 'ai', 'ai']), 'b0', OK);
    expect(G.timeout!(s, 1)).toEqual({ t: 'go' });
    expect(G.ai(s, 1)).toEqual({ t: 'go' });
    expect(G.apply(s, 0, { t: 'go' })).toEqual({ error: 'not_now' });
    s = act(s, 1, { t: 'go' });
    expect(s.opening).toBe(false);
    expect(seatsOf(s)).not.toContain(1);
    s = G.settled!(s, 'b1', OK);
    expect(s.own[1]).toBe(true);
  });
});

describe('离座和结回', () => {
  test('离座：马上带着筹码和小结结回，座位交给电脑接着打；回来再坐开新的一份', () => {
    let s = settleAll(begin(['human', 'human', 'ai', 'ai']));
    s = drive(s, 400, (x) => g(x, null).phase === 'turn' && x.n > 40);
    const chips = g(s, 0).seats[0]!.chips;
    s = G.seated!(s, 0, 'ai');
    const c = fx(s);
    expect(c.map(strip)).toEqual([{ id: 'c2', seat: 0, kind: 'credit', amount: Math.max(0, Math.min(chips, 4 * SHARE)) }]);
    expect(c[0]!.ref).toBe(`${s.ref}s0n1`);
    expect(c[0]!.stats).toMatchObject({ rounds: expect.any(Number), wins: expect.any(Number) });
    expect(s.own[0]).toBe(false);
    s = settleAll(s);
    expect(G.over(s)).toBe(false);
    // 他回来：开第 2 份
    s = G.seated!(s, 0, 'human');
    expect(fx(s)[0]).toMatchObject({ kind: 'debit', seat: 0, ref: `${s.ref}s0n2`, amount: SHARE });
    s = settleAll(s);
    expect(s.own[0]).toBe(true);
    expect(g(s, 0).seats[0]!.chips).toBe(SHARE);
  });

  test('真人都走了：房间就算打完（结回排上，kit 办完再关）', () => {
    let s = settleAll(begin(['human', 'ai', 'ai', 'ai']));
    s = G.seated!(s, 0, 'ai');
    expect(G.over(s)).toBe(true);
    expect(fx(s)).toHaveLength(1);
  });

  test('带入还在路上人就走了：到账后原样结回', () => {
    let s = begin(['human', 'ai', 'ai', 'ai']);
    s = G.seated!(s, 0, 'ai');
    expect(G.over(s)).toBe(false);
    s = G.settled!(s, 'b0', OK);
    expect(fx(s).map(strip)).toEqual([{ id: 'c1', seat: 0, kind: 'credit', amount: SHARE }]);
    expect(G.over(s)).toBe(true);
  });

  test('一场打完：桌上每个真人各结回一笔（按"最多赢 3 份"截过，带小结）；电脑的归庄家', () => {
    let s = settleAll(begin(['human', 'human', 'ai', 'ai']));
    s = drive(s);
    expect(G.over(s)).toBe(true);
    expect(s.done).toBe(true);
    const c = fx(s);
    expect(c.map((e) => e.seat).sort()).toEqual([0, 1]);
    for (const e of c) {
      expect(e.kind).toBe('credit');
      expect(e.amount).toBeGreaterThanOrEqual(0);
      expect(e.amount).toBeLessThanOrEqual(4 * SHARE);
      expect(JSON.stringify(e.stats).length).toBeLessThanOrEqual(256);
    }
    expect(G.apply(s, 0, { t: 'rebuy' })).toEqual({ error: 'closed' });
  });

  test('房间要关：所有人桌上的筹码结回，牌局不再动', () => {
    let s = drive(settleAll(begin(['human', 'human', 'ai', 'ai'])), 200, (x) => x.n > 40);
    s = G.closing!(s);
    expect(fx(s).map((e) => [e.seat, e.kind])).toEqual([
      [0, 'credit'],
      [1, 'credit'],
    ]);
    expect(G.apply(s, 0, { t: 'play', v: 'sichuan-xuezhan', a: { t: 'zimo' } })).toEqual({ error: 'closed' });
    expect(G.over(s)).toBe(true);
  });
});

describe('好友房的公平和边角', () => {
  test('声明窗口里真人答了、窗口没结束：别人的视图一点不变、步数不加（kit 0.7.1 据此不广播）；答完结束窗口的照常加', () => {
    // 四个真人的娱乐房，局面换成"0 号打 5p，1、2 号都能胡"（test/xz-table.ts）
    let s: RoomState = { ...begin(['human', 'human', 'human', 'human'], 'fun'), g: RON() };
    const play = (a: unknown) => G.parse({ t: 'play', a })!;
    s = act(s, 0, play({ t: 'discard', tile: tileIn(s.g as XzState, 0, '5p') }));
    const w = g(s, 1).prompt!.claim!.w;
    expect(g(s, 2).prompt!.claim!.w).toBe(w);
    const others = [null, 0, 2, 3];
    const before = others.map((x) => JSON.stringify(G.view(s, x)));
    const a = play({ t: 'claim', w, c: 'ron' });
    expect(G.free!(a)).toBe(true);
    const next = act(s, 1, a);
    expect(others.map((x) => JSON.stringify(G.view(next, x)))).toEqual(before);
    expect(next.n).toBe(s.n);
    // 他自己的按钮收起
    expect(g(next, 1).prompt).toBeNull();
    // 最后一个有选择的答完：窗口结束，照常是新的一步，事件是新的
    const end = act(next, 2, play({ t: 'claim', w, c: 'pass' }));
    expect(end.n).toBe(s.n + 1);
    expect(g(end, 0).events.some((e) => e.e === 'hu')).toBe(true);
  });

  test('四个真人带入都被拒：全由庄家代打，一直打到整场结束，不卡住', () => {
    let s = begin(['human', 'human', 'human', 'human']);
    for (const e of fx(s)) s = G.settled!(s, e.id, { ok: false, error: 'no_funds', balance: 0 });
    expect(s.own).toEqual([false, false, false, false]);
    for (let k = 0; k < 100 && !G.over(s); k++) {
      // 谁也不用出手：停在结算，到点 resume
      expect(seatsOf(s)).toEqual([]);
      s = G.resume!(s);
    }
    expect(G.over(s)).toBe(true);
    expect(fx(s)).toEqual([]);
  });

  test('房间到点替庄家代打的座位代出（kit 的 timeout、ai 带 srv）：照样往下推；客户端发的被拒', () => {
    let s = begin(['human', 'ai', 'ai', 'ai']);
    s = G.settled!(s, 'b0', { ok: false, error: 'no_funds', balance: 0 });
    // 构造一个 sync 没推完的局面：把一个"该庄家代打"的状态直接交给 apply
    const a = G.timeout!(s, 1);
    expect(a).toMatchObject({ t: 'play', srv: true });
    expect(G.parse({ ...(a as object) })).not.toHaveProperty('srv');
    expect(G.apply(s, 0, { t: 'play', v: 'sichuan-xuezhan', a: { t: 'que', suit: 0 } })).toEqual({ error: 'not_seated' });
  });
});

describe('隐藏信息和大小', () => {
  test('视图里没有密钥，看不到别人的手牌；快照不大', () => {
    let s = settleAll(begin(['human', 'human', 'ai', 'ai']));
    s = drive(s, 300, (x) => g(x, null).phase === 'turn' && x.n > 40);
    for (const seat of [null, 0, 1, 2, 3]) {
      const v = G.view(s, seat);
      expect(JSON.stringify(v)).not.toMatch(/"key"/);
      const gv = v.g as XzView;
      gv.seats.forEach((x, i) => {
        if (i !== seat && !x.won) expect(x.hand).toBeNull();
      });
    }
    expect(snapshotBytes(G, s)).toBeLessThan(12_000);
  });

  test('步数 n：出牌、发下一局才加，钱包到账不加（页面靠它不重放动画）', () => {
    let s = begin(['human', 'human', 'ai', 'ai']);
    s = G.settled!(s, 'b0', OK);
    const n = s.n;
    s = G.settled!(s, 'b1', OK);
    expect(s.n).toBe(n);
    s = drive(s, 1);
    expect(s.n).toBe(n + 1);
  });

  test('同样的熵、同样的操作，结果一样', () => {
    const run = () => drive(settleAll(begin(['human', 'human', 'ai', 'ai'], 'small', [9, 8, 7, 6, 5, 4, 3, 2])));
    expect(JSON.stringify(run())).toBe(JSON.stringify(run()));
  });
});

describe('再来一场', () => {
  const done = () => drive(settleAll(begin(['human', 'human', 'ai', 'ai'])), 100_000, (x) => x.done);

  test('打完先结回，房间停着等人点，不算打完', () => {
    const s = done();
    expect(s.done).toBe(true);
    expect(fx(s).every((e) => e.kind === 'credit')).toBe(true);
    expect(G.over(s)).toBe(false);
    expect(seatsOf(s)).toEqual([]);
    expect(G.pause!(s)).toBe(REMATCH_MS);
  });

  test('到点没人点：收场', () => {
    const s = G.resume!(done());
    expect(s.ended).toBe(true);
    expect(G.over(s)).toBe(true);
    expect(G.apply(s, 0, { t: 'next', code: '123456' })).toEqual({ error: 'not_now' });
  });

  test('真人点了：记下新房间号和谁开的，大家看得到，这一间打完；只认第一次', () => {
    const s = act(done(), 1, { t: 'next', code: '123456' });
    expect(s.next).toEqual({ code: '123456', by: 1 });
    expect(G.view(s, 0).next).toEqual({ code: '123456', by: 1 });
    expect(G.over(s)).toBe(true);
    expect(G.apply(s, 0, { t: 'next', code: '654321' })).toEqual({ error: 'not_now' });
    // 不额外扣谁的钱
    expect(fx(s).some((e) => e.kind === 'debit')).toBe(false);
  });

  test('没打完、电脑座位都不能点；房间号只收 6 位数字', () => {
    const s = settleAll(begin(['human', 'human', 'ai', 'ai']));
    expect(G.apply(s, 0, { t: 'next', code: '123456' })).toEqual({ error: 'not_now' });
    expect(G.apply(done(), 2, { t: 'next', code: '123456' })).toEqual({ error: 'not_now' });
    for (const code of ['12345', '1234567', 'abcdef', '12345a', 123456, null, '../123'])
      expect(G.parse({ t: 'next', code })).toBeNull();
    expect(G.parse({ t: 'next', code: '000123' })).toEqual({ t: 'next', code: '000123' });
    expect(G.free!({ t: 'next', code: '000123' })).toBe(true);
  });

  test('部署前存下的房间（没有 next、ended）照常打', () => {
    const { next: _n, ended: _e, ...old } = settleAll(begin(['human', 'human', 'ai', 'ai']));
    expect(G.over(old as RoomState)).toBe(false);
  });
});
