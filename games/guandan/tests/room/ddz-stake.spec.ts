/**
 * 斗地主好友房实盘（牌馆 ⑥，docs/stake.md 第 3、10 节）在真房间里：开房带档位、开局带入、零和、6 副或任何一家到 ±40 封顶结束、
 * 真人不到 2 个不计输赢、带入被拒后重新带入、离开结回、关房结回。钱包是 tests/room/wallet.ts 的假钱包。
 * 掼蛋的同类用例在 stake.spec.ts；带入、结回的通用规矩两边共用 src/net/stake-table.ts，这里只验斗地主自己的座位数、记账和结束条件。
 */
import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { decideDdz } from '../../src/variants/doudizhu/ai/index.ts';
import type { DdzNet, DdzNetAction, DdzNetView } from '../../src/variants/doudizhu/net/rules.ts';
import { ROOMS, SITE, advance, cookie, fireDueAlarms, freezeClock, join, truth, type Conn } from './helpers.ts';
import { bank } from './wallet.ts';

beforeEach(() => freezeClock());

const START = 10_000;
const SMALL = 2_000;
/** 小档每分 = 2,000 / 40 */
const PT = 50;

type Stake = NonNullable<DdzNet['stake']>;
interface Row {
  seq: number;
  status: string;
  seats: { kind: string; auto: boolean }[];
  game: DdzNet | null;
}
interface Snapshot {
  balances: Record<string, number>;
  stakes: Record<string, unknown>;
  done: Record<string, number>;
  log: string[];
}
const snapshot = async (): Promise<Snapshot> => (await bank(env).snapshot()) as unknown as Snapshot;
const rowOf = async (code: string): Promise<Row> => (await truth(code)).row as unknown as Row;
const stakeOf = async (code: string): Promise<Stake> => (await rowOf(code)).game!.stake!;
const paid = (s: Stake): string => s.book.seats.map((x) => x.paid).join();
const viewOf = (c: Conn): DdzNetView => c.latestView() as unknown as DdzNetView;

async function waitStake(code: string, pred: (s: Stake) => boolean, what: string): Promise<Stake> {
  for (let i = 0; i < 200; i++) {
    const st = (await rowOf(code)).game?.stake;
    if (st && pred(st)) return st;
    await new Promise((ok) => setTimeout(ok, 15));
  }
  throw new Error(`等不到：${what}（现在 ${JSON.stringify((await rowOf(code)).game?.stake ?? null)}）`);
}
async function waitBank(pred: (s: Snapshot) => boolean, what: string): Promise<Snapshot> {
  for (let i = 0; i < 200; i++) {
    const s = await snapshot();
    if (pred(s)) return s;
    await new Promise((ok) => setTimeout(ok, 15));
  }
  throw new Error(`钱包等不到：${what}（${JSON.stringify(await snapshot())}）`);
}

/** 一张斗地主实盘桌：n 个真人入座并开局，其余座位开局时由电脑补 */
class DdzTable {
  code = '';
  readonly seats = new Map<number, Conn>();
  readonly tag: string;
  readonly humans: 1 | 2 | 3;
  readonly tier: string;
  constructor(tag: string, humans: 1 | 2 | 3, tier = 'small') {
    this.tag = tag;
    this.humans = humans;
    this.tier = tier;
  }
  user = (seat: number): string => `${this.tag}-s${seat}`;

  async open(): Promise<void> {
    const res = await exports.default.fetch(ROOMS, {
      method: 'POST',
      headers: { origin: SITE, cookie: cookie(this.user(0)), 'content-type': 'application/json' },
      body: JSON.stringify({ variant: 'ddz', stake: this.tier }),
    });
    expect(res.status).toBe(201);
    this.code = ((await res.json()) as { code: string }).code;
    const host = await join(this.code, this.user(0));
    this.seats.set(0, host.conn);
    for (let k = 1; k < this.humans; k++) {
      const { conn } = await join(this.code, this.user(k));
      const before = conn.latestSeq();
      conn.send({ t: 'sit', seat: k });
      await conn.waitFor(() => conn.latestSeq() > before, 'sit');
      this.seats.set(k, conn);
    }
    const before = (await rowOf(this.code)).seq;
    host.conn.send({ t: 'start' });
    await host.conn.waitFor(() => host.conn.latestSeq() > before, 'start');
  }

  /** 往前走一步：真人该出就出（用电脑的逻辑），否则拨到下一个闹钟。打完、房间关了返回 false */
  async step(): Promise<boolean> {
    const row = await rowOf(this.code);
    if (!row || row.status !== 'playing') return false;
    const g = row.game!;
    const who = g.g.phase === 'dealEnd' ? [0, 1, 2].filter((s) => !g.ready![s]) : [g.g.turn];
    const seat = who.find((s) => this.seats.has(s) && row.seats[s]!.kind === 'human' && !row.seats[s]!.auto);
    if (seat !== undefined) {
      advance(2000);
      if (await fireDueAlarms(this.code)) return true;
      const conn = this.seats.get(seat)!;
      const v = viewOf(conn).view;
      let action: DdzNetAction = { type: 'ready' };
      if (v.phase !== 'dealEnd') {
        const a = decideDdz(v as never, 'normal', `${this.tag}|${seat}|${row.seq}`);
        action = !a ? { type: 'pass' } : a.type === 'bid' ? { type: 'bid', bid: a.bid } : a.type === 'play' ? { type: 'play', cards: a.cards } : { type: 'pass' };
      }
      const res = await conn.result(conn.act(action as never));
      expect(res.t === 'error' ? res.code : null).toBeNull();
      return true;
    }
    const t = await truth(this.code);
    if (t.alarm === null) return false;
    if (t.alarm > Date.now()) advance(t.alarm - Date.now());
    await fireDueAlarms(this.code, t);
    return true;
  }

  async playToEnd(): Promise<void> {
    for (let i = 0; i < 6000 && (await this.step()); i++);
  }

  async playDeals(n: number): Promise<void> {
    for (let i = 0; i < 3000 && (await stakeOf(this.code)).book.deals < n; i++) expect(await this.step()).toBe(true);
  }

  close(): void {
    for (const c of this.seats.values()) c.ws.close(1000, 'bye');
  }
}

describe('斗地主好友房实盘', () => {
  it('两个真人 + 一个电脑：开局各带入一份；打完零和结回，每个 op 只办一次；视图公开每家的分', { timeout: 120_000 }, async () => {
    const t = new DdzTable('dstk-a', 2);
    await t.open();
    const st = await waitStake(t.code, (s) => paid(s) === 'yes,yes,no', '两个真人到账');
    expect(st.ref).toMatch(/^ddz-[0-9a-f]{16}$/);
    const users = [t.user(0), t.user(1)];
    let b = await snapshot();
    expect(users.map((u) => b.balances[u])).toEqual([START - SMALL, START - SMALL]);
    expect(b.log.indexOf(`view:${users[0]}`)).toBeLessThan(b.log.indexOf(`buyin:${st.ref}-s0-in`));
    // 进房的人看得到这是实盘房间；打满 6 副（或有人到 ±40）
    expect((await rowOf(t.code)).game!.g.opts).toEqual({ deals: 6, dealCap: 24, cap: 40 });

    await t.playToEnd();
    const end = await waitStake(t.code, (s) => s.over && s.out[0]! && s.out[1]!, '结回办完');
    const g = (await rowOf(t.code)).game!;
    expect(g.g.phase).toBe('gameOver');
    expect(end.book.deals === 6 || g.g.scores.some((x) => Math.abs(x) >= 40)).toBe(true);
    // 零和：庄家（电脑那一家）+ 到账座位的分合计为 0；到账座位的分就是核心里的分
    expect(end.book.house + end.book.seats.reduce((a, s) => a + s.points, 0)).toBe(0);
    expect(g.g.scores.reduce((a, x) => a + x, 0)).toBe(0);
    expect(end.book.seats.slice(0, 2).map((s) => s.points)).toEqual(g.g.scores.slice(0, 2));
    b = await waitBank((s) => s.done[`${st.ref}-s1-out`] === 1, '结回');
    expect(users.map((u) => b.balances[u])).toEqual([0, 1].map((seat) => START + end.book.seats[seat]!.points * PT));
    expect(Object.values(b.done).every((n) => n === 1)).toBe(true);
    expect(b.stakes).toEqual({});
    // 每个人看到每个座位的分，被拒的原因只给自己
    expect(viewOf(t.seats.get(1)!).stake!.seats[1]!.points).toBe(end.book.seats[1]!.points);
    t.close();
  });

  it('开局真人不到 2 个：整场不计输赢，一次钱包也不碰', async () => {
    const t = new DdzTable('dstk-solo', 1, 'mid');
    await t.open();
    const st = await stakeOf(t.code);
    expect(paid(st)).toBe('refused,no,no');
    expect(st.why[0]).toBe('need_two');
    expect(viewOf(t.seats.get(0)!).stake!.why).toBe('need_two');
    expect((await snapshot()).log.filter((l) => l.includes('dstk-solo'))).toEqual([]);
    t.close();
  });

  it('带入被拒（余额不够）：这个座位不计输赢，照样打；重新带入再办一次（新的 ref），原因只给他自己', async () => {
    const t = new DdzTable('poor-dstk', 2, 'big');
    await t.open();
    const st = await waitStake(t.code, (s) => paid(s) === 'refused,refused,no', '两个都被拒');
    expect(st.why.slice(0, 2)).toEqual(['no_funds', 'no_funds']);
    expect(viewOf(t.seats.get(0)!).stake!.why).toBe('no_funds');
    for (let i = 0; i < 6; i++) expect(await t.step()).toBe(true);
    const c0 = t.seats.get(0)!;
    const res = await c0.result(c0.act({ type: 'buyin' }));
    expect(res.t === 'error' ? res.code : null).toBeNull();
    const again = await waitStake(t.code, (s) => s.share?.[0] === 2 && s.pending.length === 0, '重新带入办完');
    expect(paid(again)).toBe('refused,refused,no');
    expect((await snapshot()).log).toContain(`buyin:${again.ref}s0n2-s0-in`);
    // 已经在办或不能带的时候点是被拒的（没人离开过也没被拒的座位）
    const c1 = t.seats.get(1)!;
    expect((await c1.result(c1.act({ type: 'buyin' }))).t).toBe('state');
    t.close();
  });

  it('一副打到一半离座：这副打完按那时的分结回，之后的分归庄家；回来用新的 ref 再带入一份', { timeout: 120_000 }, async () => {
    const t = new DdzTable('dstk-leave', 2);
    await t.open();
    const st = await waitStake(t.code, (s) => paid(s) === 'yes,yes,no', '开局到账');
    const c0 = t.seats.get(0)!;
    c0.send({ t: 'leave' });
    await waitStake(t.code, (s) => s.leaving?.[0] === true && s.pending.length === 0, '离座先记下');
    t.seats.delete(0);
    await t.playDeals(1);
    const left = await waitStake(t.code, (s) => s.book.seats[0]!.paid === 'left' && s.pending.length === 0, '这副打完，离座结回办完');
    expect((await snapshot()).done[`${st.ref}-s0-out`]).toBe(1);
    expect(left.book.seats[0]!.points).not.toBe(0);
    expect((await snapshot()).balances[t.user(0)]).toBe(START + left.book.seats[0]!.points * PT);
    c0.send({ t: 'sit', seat: 0 });
    await waitStake(t.code, (s) => s.book.seats[0]!.paid === 'yes' && s.pending.length === 0, '回来新带入的一份到账');
    expect((await snapshot()).done[`${st.ref}s0n2-s0-in`]).toBe(1);
    t.close();
  });

  it('关房（到了寿命）：按目前的分给到账的座位结回，办完才删房间', { timeout: 120_000 }, async () => {
    const t = new DdzTable('dstk-close', 2, 'mid');
    await t.open();
    await waitStake(t.code, (s) => paid(s) === 'yes,yes,no', '开局到账');
    await t.playDeals(1);
    const st = await stakeOf(t.code);
    expect(st.book.deals).toBe(1);
    advance(9 * 3_600_000);
    await fireDueAlarms(t.code).catch(() => 0);
    const b = await waitBank((s) => s.done[`${st.ref}-s0-out`] === 1 && s.done[`${st.ref}-s1-out`] === 1, '收场结回');
    expect([0, 1].map((seat) => b.balances[t.user(seat)])).toEqual([0, 1].map((seat) => START + st.book.seats[seat]!.points * 250));
    t.close();
  });

  it('娱乐的斗地主房间没有实盘的桌；档位不认得的开房 400', async () => {
    const mk = (body: unknown) =>
      exports.default.fetch(ROOMS, { method: 'POST', headers: { origin: SITE, cookie: cookie('dstk-fun'), 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const res = await mk({ variant: 'ddz' });
    expect(res.status).toBe(201);
    expect((await mk({ variant: 'ddz', stake: 'huge' })).status).toBe(400);
    expect((await mk({ variant: 'ddz', stake: 'small' })).status).toBe(201);
  });
});
