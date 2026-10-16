/** 单机流程（src/solo.ts）：钱包先扣后上桌、离桌结回、断网重发同一个操作 id、刷新后接着打。钱包是内存里的假的，照平台钱包的规矩（5.9）。 */
import { describe, expect, it } from 'vitest';
import { aiAction } from '../src/bot.ts';
import { stakesOf, type StakesId } from '../src/core/stakes.ts';
import { newTable } from '../src/core/table.ts';
import type { WalletApi, WalletReply } from '../src/net/wallet.ts';
import { ME, SESSION_KEY, Solo, type SoloDeps, type Store } from '../src/solo.ts';

type Cmd = { t: 'buyin'; op: string; session: string; stakes: StakesId; amount: number } | { t: 'cashout'; op: string; session: string; amount: number };

/**
 * 假钱包：德州一份（ref + 金额），新开一份要余额 ≥ 一份，同一 ref 才能加；结回一次清掉，没有那一份 no_stake；操作 id 去重。
 * down 时一律"连不上"（请求没到钱包）；capAt：结回最多进这么多（今天的上限到了）
 */
class FakeWallet implements WalletApi {
  s: { balance: number; table: { ref: string; amount: number } | null } = { balance: 10_000, table: null };
  down = false;
  /** 不为 null 时钱包一律回这个错（登录过期 login、停了带入 busy 这类），什么都不办 */
  refuse: string | null = null;
  /** 请求到了、钱包办了，回话却丢了（浏览器看到的是连不上） */
  lose = false;
  capAt: number | null = null;
  calls: Cmd[] = [];
  private readonly done = new Map<string, WalletReply>();
  /** 每次请求到了钱包时调（测试用来看那一刻本机存了什么） */
  onCall: (cmd: Cmd) => void = () => {};
  private send(cmd: Cmd): WalletReply {
    if (this.down) return { ok: false, error: 'offline' };
    if (this.refuse) return { ok: false, error: this.refuse };
    this.onCall(cmd);
    this.calls.push(cmd);
    const r = this.done.get(cmd.op) ?? this.run(cmd);
    if (r.ok) this.done.set(cmd.op, r);
    return this.lose ? { ok: false, error: 'offline' } : r;
  }
  private run(cmd: Cmd): WalletReply {
    const w = () => ({ balance: this.s.balance, stakes: [], canRelief: false, writesLeft: 200, caps: {}, fresh: false });
    const t = this.s.table;
    if (cmd.t === 'buyin') {
      if (cmd.amount < 1 || cmd.amount > stakesOf(cmd.stakes).max) return { ok: false, error: 'bad_amount' };
      if (t && t.ref !== cmd.session) return { ok: false, error: 'at_table' };
      if (this.s.balance < cmd.amount) return { ok: false, error: 'no_funds' };
      this.s.balance -= cmd.amount;
      this.s.table = { ref: cmd.session, amount: (t?.amount ?? 0) + cmd.amount };
      return { ok: true, wallet: w() };
    }
    if (!t || t.ref !== cmd.session) return { ok: false, error: 'no_stake' };
    const credited = this.capAt === null ? cmd.amount : Math.min(cmd.amount, this.capAt);
    this.s.balance += credited;
    this.s.table = null;
    return { ok: true, wallet: w(), credited, ...(credited < cmd.amount ? { capped: cmd.amount - credited } : {}) };
  }
  async buyin(op: string, session: string, stakes: StakesId, amount: number) {
    return this.send({ t: 'buyin', op, session, stakes, amount });
  }
  async cashout(op: string, session: string, amount: number) {
    return this.send({ t: 'cashout', op, session, amount });
  }
}

class MemStore implements Store {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

let id = 0;
function deps(wallet: FakeWallet, store = new MemStore()): SoloDeps & { store: MemStore; steps: number } {
  const d = {
    wallet,
    store,
    steps: 0,
    entropy: () => [1, 2, 3, 4, 5, 6, 7, 8],
    newId: () => `id-${(id++).toString().padStart(6, '0')}`,
    think: () => 0,
    wait: async () => {},
    onStep: async () => {
      d.steps++;
    },
  };
  return d;
}

async function open(d: SoloDeps, amount = 2_000, size = 6): Promise<Solo> {
  const s = await Solo.open(d, { userId: 'u1', stakes: 'small', size, amount, practice: false });
  if ('error' in s) throw new Error(s.error);
  // 坐下不发第一手（等新手提示关了，页面调 next）
  expect(s.table.handNo).toBe(0);
  await s.next();
  return s;
}

/** 我也让电脑替我出手，直到打完 n 手 */
async function playHands(solo: Solo, n: number): Promise<void> {
  const end = solo.table.handNo + n;
  await solo.flush();
  let guard = 0;
  while (solo.table.handNo < end && solo.table.seats[ME]!.stack > 0) {
    if (++guard > n * 200) throw new Error('stuck');
    // 一手打完停着：不点"下一手"不会发（next 才发）
    if (solo.between) {
      expect(solo.table.toAct).toBeNull();
      await solo.next();
      continue;
    }
    expect(solo.table.toAct).toBe(ME);
    expect(await solo.act(aiAction(solo.table, ME))).toBeNull();
  }
}

describe('单机', () => {
  it('坐下先在钱包扣买入；打 30 手；离桌把桌上的筹码原数结回钱包', async () => {
    const w = new FakeWallet();
    const d = deps(w);
    const solo = await open(d);
    expect(w.s.balance).toBe(8_000);
    expect(w.s.table).toMatchObject({ ref: solo.session.id, amount: 2_000 });
    expect(solo.table.handNo).toBe(1);
    await playHands(solo, 30);
    const stack = solo.table.seats[ME]!.stack;
    // 离桌时可能正在一手里：弃牌后电脑打完这一手，筹码按这一刻的算
    const inHand = solo.table.seats[ME]!.status !== 'out';
    expect(await solo.leave()).toBeNull();
    if (!inHand) expect(w.s.balance).toBe(8_000 + stack);
    expect(w.s.table).toBeNull();
    expect(d.store.getItem(SESSION_KEY)).toBeNull();
    expect(w.calls.map((c) => c.t)).toEqual(['buyin', 'cashout']);
  });

  it('钱包拒了买入（余额不够）：不开桌、不留本机的牌局', async () => {
    const w = new FakeWallet();
    const d = deps(w);
    const r = await Solo.open(d, { userId: 'u1', stakes: 'mid', size: 6, amount: 10_000, practice: false });
    expect('error' in r).toBe(false);
    const r2 = await Solo.open(deps(w), { userId: 'u1', stakes: 'small', size: 6, amount: 2_000, practice: false });
    expect(r2).toEqual({ error: 'at_table' });
  });

  it('离桌时连不上：结算留在本机，刷新后用同一个操作 id 重发，钱包只结一次', async () => {
    const w = new FakeWallet();
    const d = deps(w);
    const solo = await open(d);
    await playHands(solo, 3);
    w.down = true;
    expect(await solo.leave()).toBe('offline');
    const saved = Solo.load(d.store, 'u1')!;
    expect(saved.pending).toMatchObject({ t: 'cashout' });
    expect(solo.closing).toBe(true);
    expect(await solo.act({ t: 'fold' })).toBe('busy');

    w.down = false;
    const { op, amount } = saved.pending!;
    const again = new Solo(saved, d);
    expect(await again.settle()).toBeNull();
    expect(w.s.table).toBeNull();
    expect(d.store.getItem(SESSION_KEY)).toBeNull();
    // 再重发一次（比如两个标签页）：钱包按 id 去重，余额不变
    const balance = w.s.balance;
    expect((await w.cashout(op, saved.id, amount)).ok).toBe(true);
    expect(w.s.balance).toBe(balance);
  });

  it('离桌时登录过期：钱包没收到，这一桌和那笔结回留在本机，登录后用同一个操作 id 再结（0.3.3：原来当明确拒了，整桌筹码丢了）', async () => {
    const w = new FakeWallet();
    const d = deps(w);
    const solo = await open(d);
    await playHands(solo, 3);
    w.refuse = 'login';
    expect(await solo.leave()).toBe('login');
    const saved = Solo.load(d.store, 'u1')!;
    expect(saved.pending).toMatchObject({ t: 'cashout' });
    expect(solo.closing).toBe(true);
    w.refuse = null;
    const left = saved.pending!.amount;
    const before = w.s.balance;
    expect(await new Solo(saved, d).settle()).toBeNull();
    expect(w.s.balance).toBe(before + left);
    expect(d.store.getItem(SESSION_KEY)).toBeNull();
  });

  it('坐下时平台停了带入（busy）：钱没扣，当明确拒了，不留本机的牌局、不一直重试（0.3.3）', async () => {
    const w = new FakeWallet();
    const d = deps(w);
    w.refuse = 'busy';
    expect(await Solo.open(d, { userId: 'u1', stakes: 'small', size: 6, amount: 2_000, practice: false })).toEqual({ error: 'busy' });
    expect(d.store.getItem(SESSION_KEY)).toBeNull();
    expect(w.s.balance).toBe(10_000);
  });

  it('钱包操作先存盘再发请求：请求半路页面被关，下次打开能用同一个操作 id 重发', async () => {
    const w = new FakeWallet();
    const d = deps(w);
    const seen: (string | undefined)[] = [];
    w.onCall = (cmd) => seen.push((JSON.parse(d.store.getItem(SESSION_KEY) ?? 'null') as { pending?: { op: string } } | null)?.pending?.op === cmd.op ? cmd.t : undefined);
    const solo = await open(d);
    await playHands(solo, 1);
    expect(await solo.leave()).toBeNull();
    expect(seen).toEqual(['buyin', 'cashout']);
  });

  it('坐下时连不上：这一桌和那一笔留在本机，连上后用同一个操作 id 再办；钱包没收到就只扣这一次', async () => {
    const w = new FakeWallet();
    w.down = true;
    const d = deps(w);
    const r = await Solo.open(d, { userId: 'u1', stakes: 'small', size: 6, amount: 2_000, practice: false });
    expect(r).toMatchObject({ error: 'offline', pending: expect.any(Solo) });
    expect(w.s.balance).toBe(10_000);
    const saved = Solo.load(d.store, 'u1')!;
    expect(saved.pending).toMatchObject({ t: 'buyin', amount: 2_000 });
    w.down = false;
    expect(await new Solo(saved, d).settle()).toBeNull();
    expect(w.s.balance).toBe(8_000);
    expect(Solo.load(d.store, 'u1')!.table.seats[ME]).toMatchObject({ owner: 'player' });
  });

  it('坐下时请求到了、回话丢了：不删本机这一桌（钱包已经扣了）；再办一次钱包按 id 去重，不多扣，牌局接着开', async () => {
    const w = new FakeWallet();
    w.lose = true;
    const d = deps(w);
    const r = await Solo.open(d, { userId: 'u1', stakes: 'small', size: 6, amount: 2_000, practice: false });
    expect('pending' in r && r.pending).toBeTruthy();
    // 钱包那边已经扣了、桌上记着这一场
    expect(w.s.balance).toBe(8_000);
    const saved = Solo.load(d.store, 'u1')!;
    expect(w.s.table).toMatchObject({ ref: saved.id, amount: 2_000 });
    // 下次打开：先用同一个 id 再办
    const op = saved.pending!.op;
    w.lose = false;
    const back = new Solo(saved, d);
    expect(await back.settle()).toBeNull();
    expect(w.s.balance).toBe(8_000);
    expect(w.calls.filter((c) => c.t === 'buyin').map((c) => c.op)).toEqual([op, op]);
    expect(back.table.seats[ME]).toMatchObject({ owner: 'player' });
    // 坐上了，第一手等页面 next 再发
    expect(back.between).toBe(true);
    await back.next();
    expect(back.table.phase).toBe('preflop');
  });

  it('钱包明确拒了买入：这一桌作废、不留本机的牌局', async () => {
    const w = new FakeWallet();
    const d = deps(w);
    expect(await Solo.open(d, { userId: 'u1', stakes: 'mid', size: 6, amount: 20_000, practice: false })).toEqual({ error: 'bad_amount' });
    expect(d.store.getItem(SESSION_KEY)).toBeNull();
    w.s = { ...w.s, balance: 100 };
    expect(await Solo.open(d, { userId: 'u1', stakes: 'small', size: 6, amount: 2_000, practice: false })).toEqual({ error: 'no_funds' });
    expect(d.store.getItem(SESSION_KEY)).toBeNull();
    // 平台 0.10.2：钱包不够一整份，少带一点照样能开
    w.s = { ...w.s, balance: 1_500 };
    expect('error' in (await Solo.open(d, { userId: 'u1', stakes: 'small', size: 6, amount: 1_200, practice: false }))).toBe(false);
  });

  it('今天的进账到顶了：钱包只收到上限，多出来的记在 capped，这一桌照常结束', async () => {
    const w = new FakeWallet();
    const d = deps(w);
    const solo = await open(d);
    w.capAt = 500;
    expect(await solo.leave()).toBeNull();
    expect(w.s).toEqual({ balance: 8_500, table: null });
    expect(solo.capped).toBeGreaterThan(1_000);
    expect(d.store.getItem(SESSION_KEY)).toBeNull();
  });

  it('刷新后接着打：同一个账号才认，换了账号不接别人的桌', async () => {
    const w = new FakeWallet();
    const d = deps(w);
    const solo = await open(d);
    await playHands(solo, 2);
    expect(Solo.load(d.store, 'u2')).toBeNull();
    const s = Solo.load(d.store, 'u1')!;
    expect(s.table).toEqual(solo.table);
    const back = new Solo(s, d);
    await playHands(back, 2);
  });

  it('输光了：桌子停下等我；补码后接着打，补码记在同一场上', async () => {
    const w = new FakeWallet();
    const d = deps(w);
    const solo = await open(d, 400, 2);
    // 一直全下，很快会输光
    let guard = 0;
    await solo.flush();
    while (!solo.busted) {
      if (++guard > 500) throw new Error('never busted');
      if (solo.between) await solo.next();
      else if (solo.table.toAct === ME) await solo.act({ t: 'allin' });
    }
    expect(solo.table.phase).toBe('idle');
    expect(await solo.topUp(2_001)).toBe('bad_amount');
    expect(await solo.topUp(1_000)).toBeNull();
    expect(w.s.table).toMatchObject({ ref: solo.session.id, amount: 1_400 });
    // 补完也停着，点"下一手"才发（电脑接着出，这一手可能已经打完又停下，所以只看发没发）
    expect(solo.between).toBe(true);
    expect(solo.table.seats[ME]!.stack).toBe(1_000);
    const before = solo.table.handNo;
    await solo.next();
    expect(solo.table.handNo).toBe(before + 1);
    expect(solo.stats.buyin).toBe(1_400);
  });

  it('想补码：先歇一手，这一手打完停下，补完回来', async () => {
    const w = new FakeWallet();
    const d = deps(w);
    const solo = await open(d, 1_000);
    await solo.flush();
    await solo.sitOut(true);
    expect(await solo.topUp(500)).toBe('in_hand');
    // 这一手弃掉，筹码只会少（最多交了盲注）
    while (solo.table.seats[ME]!.status !== 'out') {
      if (solo.table.toAct === ME) await solo.act({ t: 'fold' });
    }
    expect(solo.table.phase).toBe('idle');
    const stack = solo.table.seats[ME]!.stack;
    expect(await solo.topUp(2_001 - stack)).toBe('bad_amount');
    expect(await solo.topUp(2_000 - stack)).toBeNull();
    expect(solo.table.seats[ME]!).toMatchObject({ away: false, stack: 2_000 });
  });

  it('补码时钱包连不上：牌桌停住（不发下一手、不能离桌），连上后用同一个操作 id 再办、只扣一次，补上了接着打（0.3.4）', async () => {
    const w = new FakeWallet();
    const d = deps(w);
    const solo = await open(d, 1_000);
    await solo.flush();
    await solo.sitOut(true);
    while (solo.table.seats[ME]!.status !== 'out') {
      if (solo.table.toAct === ME) await solo.act({ t: 'fold' });
    }
    const stack = solo.table.seats[ME]!.stack;
    const balance = w.s.balance;
    // 请求到了、钱包扣了，回话丢了
    w.lose = true;
    expect(await solo.topUp(500)).toBe('offline');
    expect(solo.toppingUp).toBe(true);
    expect(solo.between).toBe(false);
    const hand = solo.table.handNo;
    await solo.next();
    expect(solo.table.handNo).toBe(hand);
    // 离桌也先不走：离桌的结回会把这一笔覆盖掉
    expect(await solo.leave()).toBe('offline');
    expect(solo.session.pending).toMatchObject({ t: 'buyin', amount: 500 });
    expect(solo.table.seats[ME]!.owner).toBe('player');
    // 连上了：同一个操作 id，钱包只扣那一次
    w.lose = false;
    expect(await solo.settle()).toBeNull();
    expect(solo.toppingUp).toBe(false);
    expect(w.s.balance).toBe(balance - 500);
    expect(solo.table.seats[ME]!.stack).toBe(stack + 500);
    expect(solo.between).toBe(true);
    expect(await solo.leave()).toBeNull();
    expect(w.s.balance).toBe(balance + stack);
  });

  it('0.3.3 及以前的存档：补码到账时人正在一手里加不上，不再抛错卡死；先记着，下一次两手之间加上，离桌时一起结回（0.3.4）', async () => {
    const w = new FakeWallet();
    const d = deps(w);
    const solo = await open(d, 1_000);
    await solo.flush();
    expect(solo.table.seats[ME]!.status).toBe('active');
    // 旧版本补码没回话时还能接着打：存档里一手打到一半，挂着一笔补码
    const saved = { ...solo.session, pending: { t: 'buyin' as const, op: 'old-topup-1', amount: 300 } };
    const again = new Solo(saved, d);
    const balance = w.s.balance;
    expect(await again.settle()).toBeNull();
    expect(w.s.balance).toBe(balance - 300);
    expect(again.session.held).toBe(300);
    expect(again.session.pending).toBeNull();
    // 这一手打完，下一手发之前加上
    while (!again.between) {
      if (again.table.toAct === ME) await again.act({ t: 'fold' });
      else await again.flush();
    }
    const stack = again.table.seats[ME]!.stack;
    await again.next();
    expect(again.session.held).toBeUndefined();
    expect(again.table.seats[ME]!.stack + again.table.seats[ME]!.total).toBe(stack + 300);
  });

  it('练习桌不碰钱包', async () => {
    const w = new FakeWallet();
    const d = deps(w);
    const solo = await Solo.open(d, { userId: null, stakes: 'small', size: 3, amount: 2_000, practice: true });
    if ('error' in solo) throw new Error(solo.error);
    await playHands(solo, 3);
    expect(await solo.leave()).toBeNull();
    expect(w.calls).toEqual([]);
  });
});

describe('一手打完停着（0.1.1）', () => {
  it('坐下不发第一手；一手打完不点"下一手"不发，点了才发；这一场的数记着手数、赢了几手、最大的一手', async () => {
    const w = new FakeWallet();
    const d = deps(w);
    const r = await Solo.open(d, { userId: 'u1', stakes: 'small', size: 3, amount: 2_000, practice: false });
    if ('error' in r) throw new Error(r.error);
    expect(r.table).toMatchObject({ handNo: 0, phase: 'idle' });
    expect(r.between).toBe(true);
    // 电脑不会自己开打
    await r.flush();
    expect(r.table.handNo).toBe(0);
    await r.next();
    expect(r.table.handNo).toBe(1);
    // 这一手我弃掉，电脑打完：停在这一手的结果上
    while (!r.between) if (r.table.toAct === ME) await r.act({ t: 'fold' });
    expect(r.table).toMatchObject({ handNo: 1, phase: 'idle', hold: true, toAct: null });
    expect(r.table.lastHand?.handNo).toBe(1);
    await r.flush();
    expect(r.table.handNo).toBe(1);
    await r.next();
    expect(r.table.handNo).toBe(2);
    await playHands(r, 20);
    const st = r.stats;
    expect(st.buyin).toBe(2_000);
    expect(st.hands).toBeGreaterThanOrEqual(2);
    expect(st.hands).toBeLessThanOrEqual(r.table.handNo);
    expect(st.won).toBeLessThanOrEqual(st.hands);
    if (st.won > 0) expect(st.best!.won).toBeGreaterThan(0);
  });

  it('0.1.0 的存档（没有 holdHands）读进来也停着', () => {
    const w = new FakeWallet();
    const d = deps(w);
    const t = newTable('small', 2, Array.from({ length: 8 }, (_, i) => i + 1));
    d.store.setItem(SESSION_KEY, JSON.stringify({ v: 1, id: 'old-session-1', userId: 'u1', practice: true, table: t, pending: null }));
    const s = Solo.load(d.store, 'u1')!;
    expect(s.table.holdHands).toBe(true);
    expect(s.stats).toEqual({ buyin: 0, hands: 0, won: 0, best: null });
  });
});
