/** 单机锦标赛的流程和钱包（src/tour/solo.ts）：报名扣一份、按名次结奖金、断线后用同一个操作 id 重办只办一次。钱包是内存里的假的。 */
import { describe, expect, it } from 'vitest';
import { stakesOf, type StakesId } from '../src/core/stakes.ts';
import type { WalletApi, WalletReply } from '../src/net/wallet.ts';
import type { Store } from '../src/solo.ts';
import { payouts } from '../src/tour/rules.ts';
import { TOUR_KEY, TourSolo, type TourDeps } from '../src/tour/solo.ts';

class FakeWallet implements WalletApi {
  balance = 10_000;
  held: { ref: string; amount: number } | null = null;
  /** 请求到了、钱包办了，回话却丢了 */
  lose = false;
  calls: { t: string; op: string; amount: number }[] = [];
  private readonly done = new Map<string, WalletReply>();
  private view() {
    return { balance: this.balance, stakes: [], canRelief: false, writesLeft: 200, caps: {}, fresh: false };
  }
  private send(t: string, op: string, amount: number, run: () => WalletReply): WalletReply {
    this.calls.push({ t, op, amount });
    const r = this.done.get(op) ?? run();
    if (r.ok) this.done.set(op, r);
    return this.lose ? { ok: false, error: 'offline' } : r;
  }
  async buyin(op: string, session: string, stakes: StakesId, amount: number) {
    return this.send('buyin', op, amount, () => {
      if (amount > stakesOf(stakes).max) return { ok: false, error: 'bad_amount' };
      if (this.balance < amount) return { ok: false, error: 'no_funds' };
      this.balance -= amount;
      this.held = { ref: session, amount };
      return { ok: true, wallet: this.view() };
    });
  }
  async cashout(op: string, session: string, amount: number) {
    return this.send('cashout', op, amount, () => {
      if (!this.held || this.held.ref !== session) return { ok: false, error: 'no_stake' };
      this.balance += amount;
      this.held = null;
      return { ok: true, wallet: this.view(), credited: amount };
    });
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
function deps(wallet: FakeWallet, seed = 1, store = new MemStore()): TourDeps & { store: MemStore } {
  return {
    wallet,
    store,
    entropy: () => [seed, 2, 3, 4, 5, 6, 7, 8],
    newId: () => `t-${(id++).toString().padStart(6, '0')}`,
    think: () => 0,
    gap: () => 0,
    wait: async () => {},
    onStep: async () => {},
  };
}

const FEE = stakesOf('small').max;
const opts = { userId: 'u1', stakes: 'small' as StakesId, practice: false, level: 1 };

async function open(d: TourDeps): Promise<TourSolo> {
  const t = await TourSolo.open(d, opts);
  if ('error' in t) throw new Error(t.error);
  return t;
}

describe('单机锦标赛', () => {
  it('报名在钱包扣一份（这一档的满买入），存档记着；比赛筹码和钱包无关', async () => {
    const w = new FakeWallet();
    const d = deps(w);
    const t = await open(d);
    expect(w.balance).toBe(10_000 - FEE);
    expect(w.held).toMatchObject({ ref: t.session.id, amount: FEE });
    expect(TourSolo.load(d.store, 'u1')?.id).toBe(t.session.id);
    expect(TourSolo.load(d.store, 'other')).toBeNull();
    // 6 个座位都是 1,500 比赛筹码（含已投的盲注）
    expect(t.table.seats.map((x) => x.stack + x.bet)).toEqual([1_500, 1_500, 1_500, 1_500, 1_500, 1_500]);
  });

  it('离开后确定地跑完，按名次结：第 1 名 3 份，前三名按表，没进前三 0；钱包只结一次、存档清掉', async () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 80 && !(seen.has(1) && seen.has(6)); seed++) {
      const w = new FakeWallet();
      const d = deps(w, seed);
      const t = await open(d);
      expect(await t.leave()).toBeNull();
      const { place, prize } = t.result();
      seen.add(place);
      expect(prize).toBe(payouts(FEE)[place - 1]);
      expect(w.balance).toBe(10_000 - FEE + prize);
      expect(w.held).toBeNull();
      expect(w.calls.map((c) => c.t)).toEqual(['buyin', 'cashout']);
      expect(w.calls[1]!.amount).toBe(prize);
      expect(d.store.getItem(TOUR_KEY)).toBeNull();
    }
    expect(seen.has(1) && seen.has(6)).toBe(true);
    expect(payouts(FEE)[0]).toBe(FEE * 3);
    expect(payouts(FEE)[5]).toBe(0);
  });

  it('娱乐不碰钱包', async () => {
    const w = new FakeWallet();
    const d = deps(w);
    const t = await TourSolo.open(d, { ...opts, practice: true });
    if ('error' in t) throw new Error(t.error);
    expect(await t.leave()).toBeNull();
    expect(t.result().prize).toBe(0);
    expect(w.calls).toEqual([]);
    expect(d.store.getItem(TOUR_KEY)).toBeNull();
  });

  it('报名回话丢了：这一场留在本机，用同一个操作 id 重办，只扣一次', async () => {
    const w = new FakeWallet();
    w.lose = true;
    const d = deps(w);
    const r = await TourSolo.open(d, opts);
    if (!('error' in r) || !r.pending) throw new Error('should keep pending');
    expect(r.error).toBe('offline');
    const saved = TourSolo.load(d.store, 'u1')!;
    expect(saved.pending).toMatchObject({ t: 'buyin', amount: FEE });
    w.lose = false;
    const again = new TourSolo(saved, d);
    expect(await again.settle()).toBeNull();
    expect(await again.settle()).toBeNull();
    expect(w.balance).toBe(10_000 - FEE);
    expect(new Set(w.calls.map((c) => c.op)).size).toBe(1);
  });

  it('结奖金时断线：结算留在本机，刷新后用同一个操作 id 再结，钱包只给一次', async () => {
    const w = new FakeWallet();
    const d = deps(w, 3);
    const t = await open(d);
    w.lose = true;
    expect(await t.leave()).toBe('offline');
    expect(t.closing).toBe(true);
    const saved = TourSolo.load(d.store, 'u1')!;
    expect(saved.pending).toMatchObject({ t: 'cashout' });
    w.lose = false;
    expect(await new TourSolo(saved, d).settle()).toBeNull();
    const prize = payouts(FEE)[t.result().place - 1]!;
    expect(w.balance).toBe(10_000 - FEE + prize);
    expect(new Set(w.calls.filter((c) => c.t === 'cashout').map((c) => c.op)).size).toBe(1);
    expect(d.store.getItem(TOUR_KEY)).toBeNull();
  });

  it('刷新后从存档接着打：电脑自己打，一手打完自动发下一手，直到轮到我或结束', async () => {
    const w = new FakeWallet();
    const d = deps(w, 5);
    const t = await open(d);
    await t.flush();
    const saved = TourSolo.load(d.store, 'u1')!;
    const again = new TourSolo(saved, d);
    expect(again.state.table.handNo).toBe(t.state.table.handNo);
    await again.flush();
    expect(again.over || again.undecided || again.table.toAct === 0).toBe(true);
  });
});
