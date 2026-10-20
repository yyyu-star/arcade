/**
 * 好友房实盘的桌（src/net/stake.ts）和它接进联机规则（src/net/rules.ts）的地方：纯函数，不起房间。
 * 真房间里的带入、结回、重试、收场在 tests/room/stake.spec.ts。
 */
import { describe, expect, it } from 'vitest';
import type { DealResult, Seat } from '../src/variants/guandan/core/index.ts';
import { rotateNetView } from '../src/variants/guandan/net/rotate.ts';
import { guandanRoom as R, testKey, type NetState } from '../src/variants/guandan/net/rules.ts';
import { canRebuy, parseRoomOpts, shareRef, stakeBegin, stakeDeal, stakeFinish, stakeRef, stakeSeated, stakeSettled, stakeView, type StakeTable } from '../src/variants/guandan/net/stake.ts';
import { ROOM_DEALS, WALLET_ID } from '../src/variants/guandan/stake/index.ts';

const KEY = testKey('net-stake');
const HHAA = ['human', 'human', 'ai', 'ai'] as const;

function deal(dealNo: number, order: Seat[]): DealResult {
  return { dealNo, order, winnerTeam: order[0]! % 2, up: 0, doubleDown: false, levelsBefore: [2, 2], levelsAfter: [2, 2], aFailedTeam: -1, aResetTeam: -1 };
}

/** 把所有在办的事按给的结果办完 */
function settleAll(t: StakeTable, result: (id: string) => unknown = () => ({ ok: true })): StakeTable {
  for (const e of t.pending) t = stakeSettled(t, e.id, result(e.id));
  return t;
}

describe('开房选项', () => {
  it('没带是娱乐；带了要是认得的档位', () => {
    expect(parseRoomOpts(undefined)).toEqual({ stake: null });
    expect(parseRoomOpts({})).toEqual({ stake: null });
    expect(parseRoomOpts({ stake: 'mid' })).toEqual({ stake: 'mid' });
    expect(parseRoomOpts({ stake: 'huge' })).toBeNull();
    expect(parseRoomOpts('mid')).toBeNull();
    expect(parseRoomOpts([1])).toBeNull();
    expect(R.options!({ stake: 'lux' })).toEqual({ stake: 'lux' });
  });
});

describe('开局', () => {
  it('每个真人座位记一笔带入（gd-<hex>-s<座位>-in），电脑座位不记；ref 从密钥另一条流来，同一把密钥同一个 ref', () => {
    const t = stakeBegin(KEY, 'mid', HHAA);
    expect(t.ref).toMatch(/^gd-[0-9a-f]{16}$/);
    expect(stakeRef(KEY)).toBe(t.ref);
    expect(stakeRef(testKey('other'))).not.toBe(t.ref);
    expect(t.pending).toEqual([
      { id: `${t.ref}-s0-in`, seat: 0, kind: 'in', ref: t.ref, tier: 'mid', amount: 10_000 },
      { id: `${t.ref}-s1-in`, seat: 1, kind: 'in', ref: t.ref, tier: 'mid', amount: 10_000 },
    ]);
    for (const e of t.pending) expect(e.id).toMatch(WALLET_ID);
    expect(t.book.seats.map((s) => s.paid)).toEqual(['pending', 'pending', 'no', 'no']);
  });

  it('真人不到 2 个：整场不计输赢，不碰钱包；后来接管的人也不带入', () => {
    const t = stakeBegin(KEY, 'small', ['human', 'ai', 'ai', 'ai']);
    expect(t.pending).toEqual([]);
    expect(t.book.seats[0]!.paid).toBe('refused');
    expect(stakeView(t, 0).why).toBe('need_two');
    expect(stakeSeated(t, 2, 'human')).toBe(t);
  });

  it('规则的 begin：带选项才有实盘的桌，娱乐房间和以前一样', () => {
    const fun = R.begin(KEY, 2, { opts: { stake: null }, seats: [...HHAA] });
    expect(fun.stake).toBeUndefined();
    expect(R.effects!(fun)).toEqual([]);
    const plain = R.begin(KEY, 2);
    expect(plain.stake).toBeUndefined();
    const st = R.begin(KEY, 2, { opts: { stake: 'big' }, seats: [...HHAA] });
    expect(R.effects!(st).map((e) => e.seat)).toEqual([0, 1]);
  });
});

describe('带入办完', () => {
  it('到账：这个座位的分算他的；被拒：不计输赢，原因只给他自己看', () => {
    let t = stakeBegin(KEY, 'mid', HHAA);
    t = stakeSettled(t, `${t.ref}-s0-in`, { ok: true });
    t = stakeSettled(t, `${t.ref}-s1-in`, { ok: false, error: 'no_funds' });
    expect(t.pending).toEqual([]);
    expect(t.book.seats.map((s) => s.paid)).toEqual(['yes', 'refused', 'no', 'no']);
    expect(stakeView(t, 1).why).toBe('no_funds');
    expect(stakeView(t, 0).why).toBeNull();
    expect(stakeView(t, -1).why).toBeNull();
    // 不认得的 id 什么都不改
    expect(stakeSettled(t, 'gd-x-s9-in', { ok: true })).toBe(t);
  });

  it('接管开局时就是电脑的座位：记一笔带入；主人回来、电脑座位换电脑都不再带入', () => {
    let t = settleAll(stakeBegin(KEY, 'mid', HHAA));
    t = stakeSeated(t, 2, 'human');
    expect(t.pending.map((e) => e.id)).toEqual([`${t.ref}-s2-in`]);
    expect(t.book.seats[2]!.paid).toBe('pending');
    expect(stakeSeated(t, 2, 'human')).toBe(t);
    expect(stakeSeated(t, 0, 'human')).toBe(t);
    expect(stakeSeated(t, 3, 'ai')).toBe(t);
  });
});

describe('中途离开（0.6.0）', () => {
  const US = [0, 2, 1, 3];

  it('到账的人点"离开"：按这一刻的分马上结回，之后的分归庄家；回来用新的 ref 再带入一份，离开时照常结回', () => {
    let t = settleAll(stakeBegin(KEY, 'mid', HHAA));
    t = stakeDeal(t, deal(1, US), 'dealEnd');
    t = stakeSeated(t, 0, 'ai');
    expect(t.pending.map((e) => [e.id.replace(t.ref, ''), e.amount])).toEqual([['-s0-out', 10_000 + 3 * 500]]);
    expect(t.book.seats[0]!.paid).toBe('left');
    expect(stakeView(t, 0).why).toBe('left');
    t = settleAll(t);
    expect(stakeView(t, 1).seats[0]!.out).toBe(true);
    const house = t.book.house;
    t = stakeDeal(t, deal(2, US), 'dealEnd');
    expect(t.book.seats[0]!.points).toBe(3);
    expect(t.book.house).toBe(house + 3);
    // 回来：第 2 份，ref 是 <ref>s0n2，分从 0 记；上一份的分挪进 settled
    t = stakeSeated(t, 0, 'human');
    const ref2 = `${t.ref}s0n2`;
    expect(shareRef(t, 0)).toBe(ref2);
    expect(ref2).toMatch(WALLET_ID);
    expect(t.pending).toEqual([{ id: `${ref2}-s0-in`, seat: 0, kind: 'in', ref: ref2, tier: 'mid', amount: 10_000 }]);
    expect(t.book.seats[0]).toEqual({ paid: 'pending', points: 0 });
    expect(t.book.settled).toBe(3);
    expect(stakeView(t, 0).seats[0]!.out).toBe(false);
    t = settleAll(t);
    t = stakeDeal(t, deal(3, [1, 3, 0, 2]), 'dealEnd');
    // 一场结束：0 号结回的是第 2 份
    t = stakeFinish(t);
    expect(t.pending.find((e) => e.seat === 0)).toMatchObject({ id: `${ref2}-s0-out`, ref: ref2, amount: 10_000 - 3 * 500 });
    expect(t.book.house + (t.book.settled ?? 0) + t.book.seats.reduce((a, x) => a + x.points, 0)).toBe(0);
  });

  it('带入被拒：点"重新带入"再带一份（free 操作 buyin）；在路上的、打完的、开局不到两人的都不行', () => {
    let s = R.begin(KEY, 2, { opts: { stake: 'small' }, seats: [...HHAA] });
    s = { ...s, stake: settleAll(s.stake!, (id) => (id.includes('-s1-') ? { ok: false, error: 'no_funds' } : { ok: true })) };
    expect(R.free!({ type: 'buyin' })).toBe(true);
    expect(R.parse({ type: 'buyin' })).toEqual({ type: 'buyin' });
    expect(R.apply(s, 0, { type: 'buyin' })).toEqual({ error: 'cannot_buyin' });
    const r = R.apply(s, 1, { type: 'buyin' }) as NetState;
    expect(R.effects!(r).map((e) => e.id)).toEqual([`${s.stake!.ref}s1n2-s1-in`]);
    expect(R.view(r, 1).stake!.why).toBeNull();
    // 在路上：不再带
    expect(R.apply(r, 1, { type: 'buyin' })).toEqual({ error: 'cannot_buyin' });
    expect(canRebuy(stakeFinish(s.stake!), 1)).toBe(false);
    expect(canRebuy(stakeBegin(KEY, 'small', ['human', 'ai', 'ai', 'ai']), 0)).toBe(false);
  });

  it('带入还在路上就走了：到账后原样结回一份；被拒就什么都不办', () => {
    let t = stakeSeated(stakeBegin(KEY, 'small', HHAA), 0, 'ai');
    expect(t.book.seats[0]!.paid).toBe('left');
    t = stakeSettled(t, `${t.ref}-s0-in`, { ok: true });
    expect(t.pending.find((e) => e.seat === 0)).toMatchObject({ kind: 'out', amount: 2_000 });
    let u = stakeSeated(stakeBegin(KEY, 'small', HHAA), 1, 'ai');
    u = stakeSettled(u, `${u.ref}-s1-in`, { ok: false, error: 'no_funds' });
    expect(u.pending.filter((e) => e.seat === 1)).toEqual([]);
  });
});

describe('一副打到一半离开（0.12.4 审计）', () => {
  const LOSE = [1, 3, 0, 2]; // 0、2 那一队被双下：-3

  it('这一副电脑替他打完、输赢照算，打完按那时的分结回；躲不掉这副的输', () => {
    let t = settleAll(stakeBegin(KEY, 'mid', HHAA));
    t = stakeSeated(t, 0, 'ai', 'play');
    expect(t.book.seats[0]!.paid).toBe('yes');
    expect(t.pending).toEqual([]);
    expect(t.leaving).toEqual([true, false, false, false]);
    // 离开的标记不重复记
    expect(stakeSeated(t, 0, 'ai', 'play')).toBe(t);
    t = stakeDeal(t, deal(1, LOSE), 'dealEnd');
    expect(t.pending.map((e) => [e.id.replace(t.ref, ''), e.amount])).toEqual([['-s0-out', 10_000 - 3 * 500]]);
    expect(t.book.seats[0]!.paid).toBe('left');
    expect(t.leaving).toEqual([false, false, false, false]);
    // 之后的副归庄家
    const pts = t.book.seats[0]!.points;
    t = stakeDeal(settleAll(t), deal(2, LOSE), 'dealEnd');
    expect(t.book.seats[0]!.points).toBe(pts);
  });

  it('进贡、还贡也算打到一半；两副之间（结算页）离开当场结回', () => {
    for (const ph of ['tribute', 'return'] as const) expect(stakeSeated(settleAll(stakeBegin(KEY, 'mid', HHAA)), 0, 'ai', ph).pending).toEqual([]);
    const t = stakeSeated(settleAll(stakeBegin(KEY, 'mid', HHAA)), 0, 'ai', 'dealEnd');
    expect(t.pending.map((e) => e.kind)).toEqual(['out']);
  });

  it('这一副没打完又坐回来：还是原来那一份，不结回也不再带入', () => {
    let t = settleAll(stakeBegin(KEY, 'mid', HHAA));
    t = stakeSeated(stakeSeated(t, 0, 'ai', 'play'), 0, 'human', 'play');
    expect(t.leaving).toEqual([false, false, false, false]);
    expect(t.pending).toEqual([]);
    t = stakeDeal(t, deal(1, LOSE), 'dealEnd');
    expect(t.book.seats[0]).toEqual({ paid: 'yes', points: -3 });
    expect(t.pending).toEqual([]);
  });

  it('这一副正好打完一场、或者关房：只结回一笔', () => {
    const a = stakeDeal(stakeSeated(settleAll(stakeBegin(KEY, 'mid', HHAA)), 0, 'ai', 'play'), deal(1, LOSE), 'gameOver');
    expect(a.over).toBe(true);
    expect(a.pending.filter((e) => e.seat === 0).map((e) => e.amount)).toEqual([10_000 - 3 * 500]);
    const b = stakeFinish(stakeSeated(settleAll(stakeBegin(KEY, 'mid', HHAA)), 0, 'ai', 'play'));
    expect(b.pending.filter((e) => e.seat === 0).map((e) => e.amount)).toEqual([10_000]);
    expect(b.leaving).toEqual([false, false, false, false]);
  });

  it('真人都在一副中间走了：等电脑打完这副再算完（不然关房时按开这副前的分结回）', () => {
    let s = R.begin(KEY, 2, { opts: { stake: 'mid' }, seats: [...HHAA] });
    s = { ...s, stake: settleAll(s.stake!) };
    expect(['tribute', 'return', 'play']).toContain(s.g.phase);
    s = R.seated!(R.seated!(s, 0, 'ai'), 1, 'ai');
    expect(s.stake!.leaving).toEqual([true, true, false, false]);
    expect(R.over(s)).toBe(false);
    // 这副打完：两人都结回，房间算完
    const done = { ...s, stake: stakeDeal(s.stake!, deal(1, LOSE), 'dealEnd') };
    expect(done.stake.pending.map((e) => e.seat).sort()).toEqual([0, 1]);
    expect(R.over(done)).toBe(true);
  });
});

describe('一场结束', () => {
  const US = [0, 2, 1, 3]; // 0、2 那一队双下：+3

  it('打满 5 副结束：每个到账的座位记一笔结回（一份 + 分 × 每分）；结回办完才算 out', () => {
    let t = settleAll(stakeBegin(KEY, 'small', ['human', 'human', 'human', 'human']));
    for (let i = 1; i <= ROOM_DEALS; i++) t = stakeDeal(t, deal(i, i === 3 ? [1, 3, 0, 2] : US), 'dealEnd');
    expect(t.over).toBe(true);
    expect(t.book.seats.map((s) => s.points)).toEqual([9, -9, 9, -9]);
    expect(t.pending.map((e) => [e.id.replace(t.ref, ''), e.amount])).toEqual([
      ['-s0-out', 2900],
      ['-s1-out', 1100],
      ['-s2-out', 2900],
      ['-s3-out', 1100],
    ]);
    // 四个真人：两队的输赢正好抵掉
    expect(t.pending.reduce((a, e) => a + e.amount, 0)).toBe(4 * 2000);
    t = settleAll(t, (id) => (id.endsWith('s1-out') ? { ok: false, error: 'no_stake' } : { ok: true }));
    expect(stakeView(t, 0).seats.map((s) => s.out)).toEqual([true, true, true, true]);
    // 结束以后再来的副不记
    expect(stakeDeal(t, deal(6, US), 'dealEnd')).toBe(t);
  });

  it('有一队过 A 时提前结束', () => {
    const t = stakeDeal(settleAll(stakeBegin(KEY, 'mid', HHAA)), deal(1, US), 'gameOver');
    expect(t.over).toBe(true);
    expect(t.pending.map((e) => e.seat)).toEqual([0, 1]);
  });

  it('关房时就地结束：只结到账的；还在办带入的，到账后原样结回一份', () => {
    let t = stakeBegin(KEY, 'big', HHAA);
    t = stakeSettled(t, `${t.ref}-s0-in`, { ok: true });
    t = stakeDeal(t, deal(1, US), 'dealEnd');
    t = stakeFinish(t);
    expect(t.over).toBe(true);
    expect(t.pending.map((e) => [e.id.replace(t.ref, ''), e.amount])).toEqual([
      ['-s1-in', 50_000],
      ['-s0-out', 50_000 + 3 * 2_500],
    ]);
    t = stakeSettled(t, `${t.ref}-s1-in`, { ok: true });
    expect(t.pending.find((e) => e.seat === 1)).toMatchObject({ kind: 'out', amount: 50_000 });
    expect(stakeFinish(t)).toBe(t);
  });
});

describe('接进联机规则', () => {
  function stakeState(): NetState {
    const s = R.begin(KEY, 2, { opts: { stake: 'mid' }, seats: [...HHAA] });
    return { ...s, stake: settleAll(s.stake!) };
  }

  it('over：一场结束就结束（结回交给 effects 接着办）', () => {
    const s = stakeState();
    expect(R.over(s)).toBe(false);
    expect(R.over({ ...s, stake: stakeFinish(s.stake!) })).toBe(true);
  });

  it('over：真人都点了"离开"就结束（娱乐房间也是）；带入还在路上时等它办完', () => {
    const fun = R.begin(KEY, 2, { opts: { stake: null }, seats: ['human', 'ai', 'human', 'ai'] });
    expect(R.over(R.seated!(fun, 0, 'ai'))).toBe(false);
    expect(R.over(R.seated!(R.seated!(fun, 0, 'ai'), 2, 'ai'))).toBe(true);
    // 新来的人接管电脑座位：又有真人了
    expect(R.over(R.seated!(R.seated!(R.seated!(fun, 0, 'ai'), 2, 'ai'), 1, 'human'))).toBe(false);
    const raw = R.begin(KEY, 2, { opts: { stake: 'mid' }, seats: [...HHAA] });
    const gone = R.seated!(R.seated!(raw, 0, 'ai'), 1, 'ai');
    expect(R.over(gone)).toBe(false);
    expect(R.over({ ...gone, stake: settleAll(gone.stake!) })).toBe(true);
    // 0.6.0 以前开的局（没记真人）照旧
    expect(R.over(R.seated!(R.begin(KEY, 2), 0, 'ai'))).toBe(false);
  });

  it('settled、seated、closing 只在实盘房间动；娱乐房间原样返回', () => {
    const fun = R.begin(KEY, 2);
    expect(R.seated!(fun, 2, 'human')).toBe(fun);
    expect(R.settled!(fun, 'x', {})).toBe(fun);
    expect(R.closing!(fun)).toBe(fun);
    const s = stakeState();
    // 一副打到一半离开：等这副打完再结回（0.12.4），这时还没有要办的
    const left = R.seated!(s, 0, 'ai');
    expect(R.effects!(left)).toEqual([]);
    expect(left.stake!.leaving).toEqual([true, false, false, false]);
    expect(R.effects!(R.seated!(s, 3, 'human')).map((e) => e.id)).toEqual([`${s.stake!.ref}-s3-in`]);
    const closed = R.closing!(s);
    expect(closed.stake!.over).toBe(true);
    expect(R.effects!(closed).map((e) => e.kind)).toEqual(['out', 'out']);
  });

  it('视图：每个座位的账公开，按我的座位转过来；没有 ref、密钥', () => {
    let s = stakeState();
    s = { ...s, stake: { ...s.stake!, book: { ...s.stake!.book, seats: s.stake!.book.seats.map((x, i) => ({ ...x, points: i })) } } };
    const v = R.view(s, 1);
    expect(v.stake!.seats.map((x) => x.points)).toEqual([0, 1, 2, 3]);
    expect(JSON.stringify(v)).not.toContain(s.stake!.ref);
    const rot = rotateNetView(v, 1);
    expect(rot.stake!.seats.map((x) => x.points)).toEqual([1, 2, 3, 0]);
    expect(R.view(R.begin(KEY, 2), 0).stake).toBeUndefined();
  });

  it('一步一步打：每副结束都记账，打满就停', () => {
    let s = stakeState();
    let guard = 0;
    while (!R.over(s) && guard++ < 50_000) {
      const seat = R.actors(s).seats[0]!;
      const r = R.apply(s, seat, R.ai(s, seat));
      if ('error' in r) throw new Error(r.error);
      s = r;
    }
    expect(R.over(s)).toBe(true);
    const t = s.stake!;
    expect(t.over).toBe(true);
    expect(t.book.deals).toBeLessThanOrEqual(ROOM_DEALS);
    // 两个真人坐 0、1，是对手：分正好相反；庄家 + 到账座位合计恒为 0
    expect(t.book.seats[0]!.points + t.book.seats[1]!.points).toBe(0);
    expect(t.book.house + (t.book.settled ?? 0) + t.book.seats.reduce((a, x) => a + x.points, 0)).toBe(0);
  }, 30_000);
});
