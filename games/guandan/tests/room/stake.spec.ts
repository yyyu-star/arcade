/**
 * 好友房实盘（docs/stake.md 第 3 节）在真房间里：开房带档位、开局带入、带入被拒、钱包忙时退避重试、接管电脑座位、打完结回、关房收场。
 * 钱包是 tests/room/wallet.ts 的假钱包（服务绑定 WALLET → 本 Worker 的 FakeWallet，账在 BANK），按 op 去重，测试直接读它的账。
 */
import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NetState } from '../../src/variants/guandan/net/rules.ts';
import { ROOMS, SITE, advance, cookie, fireDueAlarms, freezeClock, join, truth } from './helpers.ts';
import { Table } from './table.ts';
import { bank } from './wallet.ts';

beforeEach(() => freezeClock());

const START = 10_000;

/** 等房间里的实盘桌满足条件（带入、结回是在一步之外异步办的） */
async function waitStake(code: string, pred: (s: NonNullable<NetState['stake']>) => boolean, what: string): Promise<NonNullable<NetState['stake']>> {
  for (let i = 0; i < 200; i++) {
    const st = (await truth(code)).row?.game?.stake;
    if (st && pred(st)) return st;
    await new Promise((ok) => setTimeout(ok, 15));
  }
  throw new Error(`等不到：${what}（现在 ${JSON.stringify((await truth(code)).row?.game?.stake ?? null)}）`);
}

interface Snapshot {
  balances: Record<string, number>;
  stakes: Record<string, unknown>;
  done: Record<string, number>;
  log: string[];
  togethers: { op: string; players: unknown[] }[];
}

/** 假钱包的账（DO 的 RPC 返回类型推不出来，这里写明） */
const snapshot = async (): Promise<Snapshot> => (await bank(env).snapshot()) as unknown as Snapshot;

async function waitBank(pred: (s: Snapshot) => boolean, what: string): Promise<Snapshot> {
  for (let i = 0; i < 200; i++) {
    const s = await snapshot();
    if (pred(s)) return s;
    await new Promise((ok) => setTimeout(ok, 15));
  }
  throw new Error(`钱包等不到：${what}（${JSON.stringify(await snapshot())}）`);
}

const paid = (s: NonNullable<NetState['stake']>) => s.book.seats.map((x) => x.paid);

describe('好友房实盘', () => {
  it('两个真人 + 两个电脑：开局各带入一份（先看钱包再带入）；打完按分结回，每个 op 只办一次；视图不漏', async () => {
    const t = new Table({ humans: 2, tag: 'stk-a', stake: 'small' });
    await t.open();
    const st = await waitStake(t.code, (s) => paid(s).join() === 'yes,yes,no,no', '两个真人到账');
    const users = [t.user(0), t.user(1)];
    let b = await snapshot();
    expect(users.map((u) => b.balances[u])).toEqual([START - 2_000, START - 2_000]);
    for (const seat of [0, 1]) {
      const op = `${st.ref}-s${seat}-in`;
      // 带入前先 view（旧仓库 PR 75 审阅：钱包只记最近 32 个 op，重发前要先看桌上是不是已经有这一份）
      expect(b.log.indexOf(`view:${users[seat]}`)).toBeLessThan(b.log.indexOf(`buyin:${op}`));
      expect(b.done[op]).toBe(1);
    }
    // 进房的人看得到这是实盘房间
    expect(t.seats.get(0)!.latestRoom()!.opts).toEqual({ stake: 'small' });

    const stats = await t.playToEnd();
    expect(stats.problems).toEqual([]);
    const end = await waitStake(t.code, (s) => s.over && s.out[0]! && s.out[1]!, '结回办完');
    const score = (await truth(t.code)).row!.game!.log!.score!;
    expect(end.book.deals).toBeLessThanOrEqual(5);
    b = await waitBank((s) => s.done[`${st.ref}-s1-out`] === 1, '结回');
    expect(users.map((u) => b.balances[u])).toEqual([0, 1].map((seat) => START + end.book.seats[seat]!.points * 100));
    expect(Object.values(b.done).every((n) => n === 1)).toBe(true);
    expect(b.stakes).toEqual({});
    // 0、1 号是对手：一个赢多少另一个输多少；庄家（电脑那边）+ 到账座位合计为 0
    expect(end.book.seats[0]!.points + end.book.seats[1]!.points).toBe(0);
    expect(end.book.house + end.book.seats.reduce((a, s) => a + s.points, 0)).toBe(0);
    // 搭子战绩（0.16.0）：这一场报一次，只有两个真人（电脑座位不报），按这一场分多的那队算赢
    const mine = b.togethers.filter((x) => x.op.startsWith(`${t.code}-`));
    expect(mine).toHaveLength(1);
    const win0 = score[0]! > score[1]!;
    expect(mine[0]!.players).toEqual([
      { userId: users[0], team: 0, win: win0 },
      { userId: users[1], team: 1, win: score[1]! > score[0]! },
    ]);
    // 每个人看到自己的分（视图按自己的座位转过：自己总在 0 号）
    expect(t.seats.get(1)!.latestView()!.stake!.seats[1]!.points).toBe(end.book.seats[1]!.points);
  }, 120_000);

  it('开局真人不到 2 个：整场不计输赢，一次钱包也不碰', async () => {
    const t = new Table({ humans: 1, tag: 'stk-solo', stake: 'mid' });
    await t.open();
    const st = (await truth(t.code)).row!.game!.stake!;
    expect(paid(st)).toEqual(['refused', 'no', 'no', 'no']);
    expect(st.why[0]).toBe('need_two');
    expect(t.seats.get(0)!.latestView()!.stake!.why).toBe('need_two');
    const b = await snapshot();
    expect(b.log.filter((l) => l.includes('stk-solo'))).toEqual([]);
  });

  it('带入被拒（余额不够）：这个座位不计输赢，照样打；原因只给他自己', async () => {
    const t = new Table({ humans: 2, tag: 'poor-stk', stake: 'big' });
    await t.open();
    const st = await waitStake(t.code, (s) => paid(s).join() === 'refused,refused,no,no', '两个都被拒');
    expect(st.why.slice(0, 2)).toEqual(['no_funds', 'no_funds']);
    expect(st.pending).toEqual([]);
    await t.settle();
    expect(t.seats.get(0)!.latestView()!.stake!.why).toBe('no_funds');
    // 照样能打
    for (let i = 0; i < 10; i++) expect(await t.step()).toBe(true);
  });

  it('钱包忙：带入抛出去，房间按退避重试（15 秒后），同一个 op 只扣一次', async () => {
    await bank(env).setDown(4);
    const t = new Table({ humans: 2, tag: 'stk-busy', stake: 'small' });
    await t.open();
    await new Promise((ok) => setTimeout(ok, 100));
    let st = (await truth(t.code)).row!.game!.stake!;
    expect(paid(st)).toEqual(['pending', 'pending', 'no', 'no']);
    advance(16_000);
    await fireDueAlarms(t.code);
    st = await waitStake(t.code, (s) => paid(s).join() === 'yes,yes,no,no', '重试后到账');
    const b = await snapshot();
    expect(b.done[`${st.ref}-s0-in`]).toBe(1);
    expect(b.balances[t.user(0)]).toBe(START - 2_000);
  });

  it('接管开局时就是电脑的座位：给他带入一份；主人一副打到一半离座，这副打完结回，再回来用新的 ref 带入一份（0.6.0、0.12.4）', async () => {
    const t = new Table({ humans: 2, tag: 'stk-take', stake: 'small' });
    await t.open();
    await waitStake(t.code, (s) => paid(s).join() === 'yes,yes,no,no', '开局到账');
    const { conn } = await join(t.code, 'stk-take-new');
    conn.send({ t: 'sit', seat: 3 });
    const st = await waitStake(t.code, (s) => s.book.seats[3]!.paid === 'yes', '接管的人到账');
    expect((await snapshot()).balances['stk-take-new']).toBe(START - 2_000);
    // 等每一步的钱包往来办完再走下一步（原来各等 50 毫秒，CI 机器慢时结回、再带入还没办完就去查，偶发失败）
    const c0 = t.seats.get(0)!;
    c0.send({ t: 'leave' });
    // 一副打到一半走的：等这副打完再按那时的分结回（0.12.4 审计）
    await waitStake(t.code, (s) => s.leaving?.[0] === true && s.pending.length === 0, '离座先记下');
    for (let i = 0; i < 2000; i++) {
      if ((await truth(t.code)).row!.game!.stake!.book.deals >= 1) break;
      expect(await t.step()).toBe(true);
    }
    const left = await waitStake(t.code, (s) => s.book.seats[0]!.paid === 'left' && s.pending.length === 0, '这副打完，离座结回办完');
    expect((await snapshot()).done[`${st.ref}-s0-out`]).toBe(1);
    expect(left.book.seats[0]!.points).not.toBe(0);
    c0.send({ t: 'sit', seat: 0 });
    await waitStake(t.code, (s) => s.book.seats[0]!.paid === 'yes' && s.pending.length === 0, '回来新带入的一份到账');
    const done = (await snapshot()).done;
    expect(done[`${st.ref}-s0-in`]).toBe(1);
    expect(done[`${st.ref}s0n2-s0-in`]).toBe(1);
  });

  it('关房（到了寿命）：按目前的分给到账的座位结回，办完才删房间', async () => {
    const t = new Table({ humans: 2, tag: 'stk-close', stake: 'mid' });
    await t.open();
    await waitStake(t.code, (s) => paid(s).join() === 'yes,yes,no,no', '开局到账');
    // 打到第一副结束（结算页）
    for (let i = 0; i < 2000; i++) {
      const g = (await truth(t.code)).row!.game!;
      if (g.stake!.book.deals >= 1) break;
      expect(await t.step()).toBe(true);
    }
    const st = (await truth(t.code)).row!.game!.stake!;
    expect(st.book.deals).toBe(1);
    advance(9 * 3_600_000);
    await fireDueAlarms(t.code).catch(() => 0);
    const b = await waitBank((s) => s.done[`${st.ref}-s0-out`] === 1 && s.done[`${st.ref}-s1-out`] === 1, '收场结回');
    expect([0, 1].map((seat) => b.balances[t.user(seat)])).toEqual([0, 1].map((seat) => START + st.book.seats[seat]!.points * 500));
  });

  it('娱乐房间和以前一样：没有实盘的桌；档位不认得的开房 400 bad_options', async () => {
    const t = new Table({ humans: 2, tag: 'stk-fun' });
    await t.open();
    expect((await truth(t.code)).row!.game!.stake).toBeUndefined();
    expect(t.seats.get(0)!.latestView()!.stake).toBeUndefined();
    const res = await exports.default.fetch(ROOMS, {
      method: 'POST',
      headers: { origin: SITE, cookie: cookie('stk-bad'), 'content-type': 'application/json' },
      body: JSON.stringify({ stake: 'huge' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'bad_options' });
  });
});
