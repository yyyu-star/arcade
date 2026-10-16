/**
 * 假平台钱包（0.8.0，`arcade-kit/testing`）：游戏测试靠它代替平台，所以它守的那几条关键规则要和平台一致
 * （docs/platform-backend.md 5.9、5.10、15.9）：绑定和 game 一致、带入要余额够这次、只结一次、操作 id 去重、按 ref 分份、到期退回、
 * client 每天净赢上限、小结的上限、补给看余额加桌上的。
 */
import { runInDurableObject } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE } from '../src/internal.ts';
import { type FakeBank, NEW_BALANCE, RELIEF_TO, TIERS, walletHttp, WIN_UNITS } from '../src/testing.ts';
import { advance, freezeClock } from './helpers.ts';

let n = 0;
const id = (p: string) => `${p}-${(n++).toString().padStart(6, '0')}`;
const user = () => id('user');
const DAY = 86_400_000;

const buyin = (userId: string, ref: string, amount: number, extra: Record<string, unknown> = {}) =>
  env.WALLET.buyin({ userId, game: 'toy', ref, tier: 'small', amount, until: Date.now() + DAY, mode: 'client', op: id('op'), ...extra });
const settle = (userId: string, ref: string, amount: number, extra: Record<string, unknown> = {}) =>
  env.WALLET.settle({ userId, game: 'toy', ref, amount, mode: 'client', op: id('op'), ...extra });

const bankOf = (userId: string) => env.FAKE_BANK.get(env.FAKE_BANK.idFromName(userId));
const counts = (userId: string) => runInDurableObject(bankOf(userId), (b: FakeBank) => ({ calls: b.calls, writes: b.writes, stats: b.stats }));

beforeEach(freezeClock);
afterEach(() => vi.useRealTimers());

describe('假钱包的 RPC（5.9）', () => {
  it('绑定没写 props.game、参数里的 game 和绑定不一致：四个方法都回 bad_game，不碰钱包', async () => {
    const u = user();
    expect(await env.WALLET_BARE.view(u)).toEqual({ ok: false, error: 'bad_game' });
    expect(await env.WALLET_BARE.buyin({ userId: u, game: 'toy', ref: id('ref'), tier: 'small', amount: 1, until: Date.now() + DAY, mode: 'client', op: id('op') })).toEqual({
      ok: false,
      error: 'bad_game',
    });
    expect(await buyin(u, id('ref'), 100, { game: 'other' })).toEqual({ ok: false, error: 'bad_game' });
    // 参数形状不对也先回 bad_game（平台先查 game）
    expect(await env.WALLET.settle({ game: 'other' })).toEqual({ ok: false, error: 'bad_game' });
    expect(await counts(u)).toMatchObject({ calls: 0, writes: 0 });
    // game 对上了才看形状
    expect(await env.WALLET.settle({ game: 'toy', userId: u, ref: 'short', amount: 1, mode: 'client', op: id('op') })).toEqual({ ok: false, error: 'bad_request' });
    expect(await buyin(u, id('ref'), 100, { tier: 'toString' })).toEqual({ ok: false, error: 'bad_request' });
  });

  it('带入扣余额、结回进余额，只结一次；同一个 op 再来回第一次的结果、不写', async () => {
    const u = user();
    const ref = id('ref');
    const b = await buyin(u, ref, 1_500);
    expect(b).toMatchObject({ ok: true, wallet: { balance: NEW_BALANCE - 1_500, stakes: [{ game: 'toy', ref, tier: 'small', amount: 1_500, mode: 'client' }] } });
    const op = id('op');
    expect(await settle(u, ref, 2_000, { op })).toMatchObject({ ok: true, credited: 2_000, wallet: { balance: NEW_BALANCE + 500, stakes: [] } });
    expect(await settle(u, ref, 2_000, { op })).toMatchObject({ ok: true, credited: 2_000, dup: true, wallet: { balance: NEW_BALANCE + 500 } });
    expect(await settle(u, ref, 2_000)).toMatchObject({ ok: false, error: 'no_stake', wallet: { balance: NEW_BALANCE + 500 } });
    expect(await counts(u)).toMatchObject({ calls: 4, writes: 2 });
  });

  it('余额够这次带入就能开（不用够一整份），不够回 no_funds；补码要同档同 mode；同一个游戏不同 ref 是另一份', async () => {
    const u = user();
    await runInDurableObject(bankOf(u), (b: FakeBank) => b.setBalance(500, Date.now()));
    const ref = id('ref');
    expect(await buyin(u, ref, 600)).toMatchObject({ ok: false, error: 'no_funds', wallet: { balance: 500 } });
    expect(await buyin(u, ref, 400)).toMatchObject({ ok: true, wallet: { balance: 100 } });
    expect(await buyin(u, ref, 50, { tier: 'mid' })).toMatchObject({ ok: false, error: 'at_table' });
    expect(await buyin(u, ref, 50, { mode: 'server' })).toMatchObject({ ok: false, error: 'bad_mode' });
    expect(await buyin(u, ref, 50)).toMatchObject({ ok: true, wallet: { balance: 50, stakes: [{ ref, amount: 450 }] } });
    const other = id('ref');
    const r = await buyin(u, other, 50, { mode: 'server' });
    expect(r).toMatchObject({ ok: true, wallet: { balance: 0 } });
    expect(r.ok && r.wallet.stakes.map((k) => [k.ref, k.amount])).toEqual([
      [ref, 450],
      [other, 50],
    ]);
    // 一份超过一整份、0 都是 bad_amount
    expect(await buyin(u, id('ref'), TIERS.small + 1)).toMatchObject({ ok: false, error: 'bad_amount' });
    expect(await buyin(u, id('ref'), 0)).toMatchObject({ ok: false, error: 'bad_amount' });
  });

  it('到期原样退回，之后这个 ref 来结回、补码都回 expired；放弃是原样退回', async () => {
    const u = user();
    const ref = id('ref');
    await buyin(u, ref, 1_000, { until: Date.now() + 60_000 });
    advance(60_000);
    expect(await settle(u, ref, 5_000)).toMatchObject({ ok: false, error: 'expired', wallet: { balance: NEW_BALANCE, stakes: [] } });
    expect(await buyin(u, ref, 100)).toMatchObject({ ok: false, error: 'expired' });
    const again = id('ref');
    await buyin(u, again, 700);
    expect(await env.WALLET.refund({ userId: u, game: 'toy', ref: again, mode: 'client', op: id('op') })).toMatchObject({ ok: true, credited: 700, wallet: { balance: NEW_BALANCE } });
  });

  it(`client 模式每个游戏每天净赢最多 ${WIN_UNITS} 份，多的在 capped 里；server 模式不限；结回超过带入加 20 份是 bad_amount`, async () => {
    const u = user();
    const cap = WIN_UNITS * TIERS.small;
    const ref = id('ref');
    await buyin(u, ref, 2_000);
    expect(await settle(u, ref, 2_000 + cap + 3_000)).toMatchObject({ ok: true, credited: 2_000 + cap, capped: 3_000, wallet: { caps: { toy: { net: cap, cap } } } });
    // 到顶以后带上桌的那一份总能拿回来
    const next = id('ref');
    await buyin(u, next, 1_000);
    expect(await settle(u, next, 5_000)).toMatchObject({ ok: true, credited: 1_000, capped: 4_000 });
    const room = id('ref');
    await buyin(u, room, 2_000, { mode: 'server' });
    expect(await settle(u, room, 2_000 + 21 * TIERS.small, { mode: 'server' })).toMatchObject({ ok: false, error: 'bad_amount' });
    expect(await settle(u, room, 2_000 + 20 * TIERS.small, { mode: 'server' })).toMatchObject({ ok: true, credited: 2_000 + 20 * TIERS.small });
  });

  it('结回带的小结（5.10）：合格的记下；超过 256 字节、形状不对整份忽略（statsIgnored），钱照常结；重复的 op 不记两次', async () => {
    const u = user();
    const ok = { rounds: 3, wins: 1, best: 200, titles: ['lucky'], max: { score: 9 }, sum: { bombs: -1 } };
    const r1 = id('ref');
    await buyin(u, r1, 1_000);
    const op = id('op');
    expect(await settle(u, r1, 1_200, { op, stats: ok })).not.toHaveProperty('statsIgnored');
    await settle(u, r1, 1_200, { op, stats: ok });
    const r2 = id('ref');
    await buyin(u, r2, 1_000);
    expect(await settle(u, r2, 900, { stats: { rounds: 1, wins: 0, best: 0, max: { a: 1, b: 2 }, sum: { c: 3, d: 4 } } })).toMatchObject({ ok: true, credited: 900, statsIgnored: 'bad_stats' });
    const r3 = id('ref');
    await buyin(u, r3, 1_000);
    expect(await settle(u, r3, 900, { stats: { rounds: 1, wins: 0, best: 0, titles: ['a'.repeat(300)] } })).toMatchObject({
      ok: true,
      statsIgnored: 'too_big',
    });
    const { stats } = await counts(u);
    expect(stats.map((s) => [s.ref, s.ignored])).toEqual([
      [r1, undefined],
      [r2, 'bad_stats'],
      [r3, 'too_big'],
    ]);
    expect(stats[0]).toEqual({ game: 'toy', ref: r1, stats: ok });
  });
});

describe('假钱包的浏览器接口（15.9）', () => {
  const get = (path: string, sid: string | null, init: RequestInit = {}) =>
    walletHttp(new Request(`https://game.example.com${path}`, { ...init, headers: { ...(sid ? { cookie: `${SESSION_COOKIE}=${sid}` } : {}), ...(init.headers ?? {}) } }), env);

  it('别的路径回 null；没登录 401；看钱包带档位表和规则', async () => {
    expect(await get('/api/me', 'x')).toBeNull();
    expect((await get('/api/wallet', null))!.status).toBe(401);
    const u = user();
    const res = (await get('/api/wallet', u))!;
    expect(await res.json()).toMatchObject({ wallet: { balance: NEW_BALANCE, fresh: true }, tiers: TIERS, reliefTo: RELIEF_TO, winUnits: WIN_UNITS });
  });

  it('补给看余额加桌上的（0.10.2：桌上有筹码也能领），补到补给额；一天一次；要 X-Arcade', async () => {
    const u = user();
    const relief = (headers: Record<string, string> = { 'x-arcade': '1' }) => get('/api/wallet/relief', u, { method: 'POST', headers });
    expect(await (await relief())!.json()).toMatchObject({ error: 'relief_not_needed' });
    await runInDurableObject(bankOf(u), (b: FakeBank) => b.setBalance(800, Date.now()));
    await buyin(u, id('ref'), 500);
    expect((await relief({}))!.status).toBe(403);
    const ok = (await relief())!;
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ wallet: { balance: RELIEF_TO - 500, canRelief: false } });
    await runInDurableObject(bankOf(u), (b: FakeBank) => b.setBalance(0, Date.now()));
    expect(await (await relief())!.json()).toMatchObject({ error: 'relief_used' });
  });
});
