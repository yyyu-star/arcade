/**
 * 钱包（docs/platform-backend.md 5.9、docs/economy.md 第 3、4、6 节）：游戏经 RPC 带入、结回、放弃；浏览器只能看和领补给。
 * 每个用例断言写入行数：成功 1 行，被拒、重复 0 行。
 */
import { exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { runCleanup } from '../worker/api/cron';
import { resetMeterForTests } from '../worker/api/meter';
import { beijingWeek } from '../worker/api/time';
import { DAILY_WRITES, type WalletState } from '../worker/api/wallet';
import type { WalletReply } from '../worker/api/wallet-store';
import { lastWalletStats, WalletService } from '../worker/wallet-service';
import { advance, call, count, env, errorOf, flushMeter, registerUser, resetAll, rowsWritten } from './helpers';

beforeEach(() => resetAll());

type Stub = {
  view(userId: string): Promise<WalletReply>;
  buyin(req: unknown): Promise<WalletReply>;
  settle(req: unknown): Promise<WalletReply>;
  refund(req: unknown): Promise<WalletReply>;
};
/** 没写 props 的绑定 */
const unbound = (exports as unknown as { WalletService: Stub }).WalletService;
/** 绑定上写了 props.game 的游戏（游戏自己的 wrangler.jsonc），和线上一样 */
const boundTo = (game: string) =>
  (exports as unknown as { WalletService: (o: { props: { game: string } }) => Stub }).WalletService({ props: { game } });
/** 按参数里的 game 选绑定；不认识的游戏走开盘的绑定（测 unknown_game） */
const stubFor = (game: string) => boundTo(['kaipan', 'guandan', 'texas', 'mahjong'].includes(game) ? game : 'kaipan');
const wallet = { view: (userId: string) => boundTo('kaipan').view(userId) };

const HOUR = 3_600_000;
let n = 0;
const id = (p: string) => `${p}-${String(++n).padStart(6, '0')}`;
/** 上一次 RPC 写了几行 */
const wrote = () => lastWalletStats.rowsWritten;

function buyin(userId: string, o: Partial<{ game: string; ref: string; tier: string; amount: number; until: number; mode: string; op: string }> = {}) {
  const req = { userId, game: 'kaipan', ref: 'ref-000001', tier: 'small', amount: 2_000, until: Date.now() + HOUR, mode: 'client', op: id('op'), ...o };
  return stubFor(req.game).buyin(req);
}
function settle(userId: string, o: Partial<{ game: string; ref: string; amount: number; mode: string; op: string; stats: unknown }> = {}) {
  const req = { userId, game: 'kaipan', ref: 'ref-000001', amount: 2_000, mode: 'client', op: id('op'), ...o };
  return stubFor(req.game).settle(req);
}
function refund(userId: string, o: Partial<{ game: string; ref: string; mode: string; op: string }> = {}) {
  const req = { userId, game: 'kaipan', ref: 'ref-000001', mode: 'client', op: id('op'), ...o };
  return stubFor(req.game).refund(req);
}
const state = async (userId: string) =>
  JSON.parse((await env.DB.prepare('SELECT state FROM wallets WHERE user_id = ?1').bind(userId).first<{ state: string }>())!.state) as WalletState;
/** 直接改库里的状态（模拟写满 200 次、余额很低这些不好走到的情况） */
async function patchState(userId: string, f: (s: WalletState) => void) {
  const s = await state(userId);
  f(s);
  await env.DB.prepare('UPDATE wallets SET state = ?1 WHERE user_id = ?2').bind(JSON.stringify(s), userId).run();
}
/** 让全站计量到某个档位或某类预算用完（同 meter.test.ts） */
async function seed(cols: Record<string, number>) {
  const names = Object.keys(cols);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO meter_hourly (hour, ${names.join(', ')}, updated_at) VALUES (?1, ${names.map((_, i) => `?${i + 2}`).join(', ')}, 0)`,
  )
    .bind(new Date().toISOString().slice(0, 13), ...Object.values(cols))
    .run();
  resetMeterForTests();
}

describe('看钱包、新号', () => {
  it('第一次看：余额 10,000、fresh，不建行（0 行）；第一次带入才建行（1 行）', async () => {
    const u = await registerUser();
    const v = await wallet.view(u.user.id);
    expect(v).toMatchObject({ ok: true, wallet: { balance: 10_000, fresh: true, stakes: [], canRelief: false, writesLeft: DAILY_WRITES } });
    expect(wrote()).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM wallets')).toBe(0);
    const b = await buyin(u.user.id);
    expect(b).toMatchObject({ ok: true, wallet: { balance: 8_000, fresh: false } });
    expect(wrote()).toBe(1);
    expect((await state(u.user.id)).today.grant).toBe(10_000);
  });

  it('不存在的人、userId 格式不对：拒绝，不建行', async () => {
    expect(await wallet.view('nobody')).toEqual({ ok: false, error: 'no_user' });
    expect(await buyin('nobody')).toEqual({ ok: false, error: 'no_user' });
    expect(await wallet.view('../x')).toEqual({ ok: false, error: 'bad_request' });
    expect(await count('SELECT COUNT(*) AS n FROM wallets')).toBe(0);
  });

  it('浏览器 GET /api/wallet：看自己的，带档位表；没登录 401；/api 里没有带入、结回、放弃的路', async () => {
    const u = await registerUser();
    const res = await call('/api/wallet', { cookie: u.cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ wallet: { balance: 10_000, fresh: true }, tiers: { small: 2_000, mid: 10_000, big: 50_000, lux: 200_000 }, reliefTo: 2_000 });
    expect(rowsWritten()).toBe(0);
    expect((await call('/api/wallet')).status).toBe(401);
    for (const p of ['buyin', 'settle', 'refund', 'cashout']) {
      expect((await call(`/api/wallet/${p}`, { body: { amount: 1 }, cookie: u.cookie })).status).toBe(404);
    }
  });

  it('GET /api/wallet 带上今天各游戏上过桌的人数（只读，每个 isolate 记 10 分钟）', async () => {
    advance(11 * 60_000); // 前面的用例可能已经记过一份
    const [a, b, c] = [await registerUser(), await registerUser(), await registerUser()];
    await buyin(a.user.id, { game: 'texas', ref: 'solo-0001' });
    await buyin(a.user.id, { game: 'texas', ref: 'room-0001', mode: 'server', amount: 1_000 });
    await buyin(b.user.id, { game: 'texas', ref: 'solo-0001' });
    await buyin(b.user.id, { game: 'kaipan', ref: 'solo-0001' });
    const read = async () => ((await (await call('/api/wallet', { cookie: c.cookie })).json()) as { playing: Record<string, number> }).playing;
    expect(await read()).toEqual({ texas: 2, kaipan: 1 });
    expect(rowsWritten()).toBe(0);
    await buyin(c.user.id, { game: 'guandan', ref: 'solo-0001' });
    expect(await read()).toEqual({ texas: 2, kaipan: 1 });
    advance(11 * 60_000);
    expect(await read()).toEqual({ texas: 2, kaipan: 1, guandan: 1 });
  });
});

describe('带入、结回、放弃', () => {
  it('带入：每次 1 到一份；余额够这次带入就行（0.10.2 起不要求整份）；被拒 0 行', async () => {
    const u = await registerUser();
    const uid = u.user.id;
    for (const amount of [0, 2_001, -5, 1.5]) {
      expect((await buyin(uid, { amount })).ok, String(amount)).toBe(false);
      expect(wrote()).toBe(0);
    }
    expect(await buyin(uid, { tier: 'big', amount: 10_001 })).toMatchObject({ ok: false, error: 'no_funds' });
    expect(wrote()).toBe(0);
    // 余额 10,000 不到大档一份 50,000，也能带 1 上桌
    expect(await buyin(uid, { tier: 'big', ref: 'ref-big-0001', amount: 1 })).toMatchObject({ ok: true, wallet: { balance: 9_999 } });
    expect(await buyin(uid, { tier: 'huge' })).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await buyin(uid, { game: 'chess' })).toMatchObject({ ok: false, error: 'unknown_game' });
    // 《雀馆》麻将（0.10.9）上线前钱包先认它
    expect(await buyin(uid, { game: 'mahjong', ref: 'ref-mj-0001', amount: 1 })).toMatchObject({ ok: true, wallet: { balance: 9_998 } });
    expect(await buyin(uid, { mode: 'browser' })).toMatchObject({ ok: false, error: 'bad_request' });
    expect(await buyin(uid, { until: Date.now() })).toMatchObject({ ok: false, error: 'bad_until' });
    expect(await buyin(uid, { tier: 'mid', amount: 400 })).toMatchObject({ ok: true, wallet: { balance: 9_598 } });
  });

  it('补码：同一游戏、同一 ref、同一档加到那一份上，到期时间取晚的；同一 ref 换档是 at_table；不同游戏各一份', async () => {
    const u = await registerUser();
    const uid = u.user.id;
    const t0 = Date.now();
    await buyin(uid, { amount: 1_000, until: t0 + 2 * HOUR });
    expect(await buyin(uid, { amount: 500, until: t0 + HOUR })).toMatchObject({ ok: true, wallet: { balance: 8_500 } });
    const st = (await state(uid)).stakes['kaipan:ref-000001']!;
    expect([st.amount, st.until]).toEqual([1_500, t0 + 2 * HOUR]);
    expect(await buyin(uid, { tier: 'mid' })).toMatchObject({ ok: false, error: 'at_table' });
    expect(await buyin(uid, { mode: 'server' })).toMatchObject({ ok: false, error: 'bad_mode' });
    expect(wrote()).toBe(0);
    const r = await buyin(uid, { game: 'texas', ref: 'room-0001', mode: 'server' });
    expect(r).toMatchObject({ ok: true, wallet: { balance: 6_500 } });
    expect(r.wallet!.stakes.map((s) => s.game).sort()).toEqual(['kaipan', 'texas']);
  });

  it('同一个游戏可以同时有好几份（0.9.5）：单机一桌没离桌，照样能进好友房带入；各按 ref 结回、放弃，互不影响', async () => {
    const u = await registerUser();
    const uid = u.user.id;
    await buyin(uid, { game: 'texas', ref: 'solo-0001', amount: 2_000 });
    const room = await buyin(uid, { game: 'texas', ref: 'room-0001', mode: 'server', amount: 2_000 });
    expect(room).toMatchObject({ ok: true, wallet: { balance: 6_000 } });
    expect(wrote()).toBe(1);
    expect(await buyin(uid, { game: 'texas', ref: 'room-0002', mode: 'server', amount: 1_000 })).toMatchObject({ ok: true, wallet: { balance: 5_000 } });
    expect(await settle(uid, { game: 'texas', ref: 'room-0001', mode: 'server', amount: 3_500 })).toMatchObject({ ok: true, credited: 3_500 });
    expect(await refund(uid, { game: 'texas', ref: 'solo-0001' })).toMatchObject({ ok: true, credited: 2_000 });
    const s = await state(uid);
    expect(Object.keys(s.stakes)).toEqual(['texas:room-0002']);
    expect(s.balance).toBe(10_500);
    // 补给照旧：只要还有一份在桌上就不能领
    expect((await wallet.view(uid)).wallet?.canRelief).toBe(false);
  });

  it('until 超过 24 小时按 24 小时算', async () => {
    const u = await registerUser();
    await buyin(u.user.id, { until: Date.now() + 100 * HOUR });
    expect((await state(u.user.id)).stakes['kaipan:ref-000001']!.until).toBe(Date.now() + 24 * HOUR);
  });

  it('结回：清掉那一份、钱进余额，1 行；同一个操作 id 重发只算一次（0 行，回当时的结果）', async () => {
    const u = await registerUser();
    const uid = u.user.id;
    await buyin(uid, { mode: 'server' });
    const op = id('op');
    const r = await settle(uid, { amount: 5_000, mode: 'server', op });
    expect(r).toMatchObject({ ok: true, credited: 5_000, wallet: { balance: 13_000, stakes: [] } });
    expect(wrote()).toBe(1);
    const again = await settle(uid, { amount: 5_000, mode: 'server', op });
    expect(again).toMatchObject({ ok: true, dup: true, credited: 5_000, wallet: { balance: 13_000 } });
    expect(wrote()).toBe(0);
    // 带入也一样
    const bop = id('op');
    await buyin(uid, { op: bop });
    expect(await buyin(uid, { op: bop })).toMatchObject({ ok: true, dup: true, wallet: { balance: 11_000 } });
    expect(wrote()).toBe(0);
  });

  it('同一份补码补了很多次、早挤出了最近 32 个操作：重发的那次带入照样认得出（0.12.0），操作 id 不给游戏看', async () => {
    const u = await registerUser();
    const uid = u.user.id;
    const bop = id('op');
    await buyin(uid, { amount: 500, op: bop });
    // 别的桌来回 34 次，把全钱包记的最近操作挤满
    for (let i = 0; i < 17; i++) {
      const ref = `ref-x${String(i).padStart(5, '0')}`;
      expect(await buyin(uid, { ref, amount: 100 })).toMatchObject({ ok: true });
      expect(await refund(uid, { ref })).toMatchObject({ ok: true });
    }
    expect((await state(uid)).ops.some((o) => o.id === `kaipan:${bop}`)).toBe(false);
    const again = await buyin(uid, { amount: 500, op: bop });
    expect(again).toMatchObject({ ok: true, dup: true, wallet: { balance: 9_500 } });
    expect(wrote()).toBe(0);
    if (!again.ok) throw new Error('应该成功');
    expect(again.wallet.stakes).toEqual([expect.not.objectContaining({ ops: expect.anything() })]);
  });

  it('结回被拒（0 行）：没有那一份、ref 不对、模式不对、金额离谱', async () => {
    const u = await registerUser();
    const uid = u.user.id;
    expect(await settle(uid)).toMatchObject({ ok: false, error: 'no_stake' });
    await buyin(uid);
    expect(await settle(uid, { ref: 'ref-wrong-1' })).toMatchObject({ ok: false, error: 'no_stake' });
    expect(await settle(uid, { mode: 'server' })).toMatchObject({ ok: false, error: 'bad_mode' });
    expect(await settle(uid, { amount: 2_000 + 20 * 2_000 + 1 })).toMatchObject({ ok: false, error: 'bad_amount' });
    expect(wrote()).toBe(0);
    expect(await settle(uid, { amount: 0 })).toMatchObject({ ok: true, credited: 0, wallet: { balance: 8_000 } });
  });

  it('放弃：那一份原样退回（1 行）；之后同一个 ref 再结回是 no_stake', async () => {
    const u = await registerUser();
    const uid = u.user.id;
    await buyin(uid, { amount: 1_500 });
    expect(await refund(uid)).toMatchObject({ ok: true, credited: 1_500, wallet: { balance: 10_000, stakes: [] } });
    expect(wrote()).toBe(1);
    expect(await settle(uid)).toMatchObject({ ok: false, error: 'no_stake' });
    expect(await refund(uid)).toMatchObject({ ok: false, error: 'no_stake' });
  });

  it('两个游戏同时调同一个钱包：都算上，不会互相盖掉（rev 冲突后重读再算）', async () => {
    const u = await registerUser();
    const uid = u.user.id;
    await buyin(uid, { amount: 1 }); // 先建行
    const rs = await Promise.all([
      buyin(uid, { game: 'texas', ref: 'room-0001', mode: 'server', amount: 1_000 }),
      buyin(uid, { game: 'guandan', ref: 'solo-0001', amount: 2_000 }),
      settle(uid, { amount: 3 }),
    ]);
    expect(rs.every((r) => r.ok)).toBe(true);
    const s = await state(uid);
    expect(s.balance).toBe(10_000 - 1 - 1_000 - 2_000 + 3);
    expect(Object.keys(s.stakes).sort()).toEqual(['guandan:solo-0001', 'texas:room-0001']);
    expect(s.today.writes).toBe(4);
  });

  it('绑定上写了 props.game：传别的游戏是 bad_game（冒充不了别的游戏）；一致照常', async () => {
    const u = await registerUser();
    const texas = boundTo('texas');
    expect(await texas.buyin({ userId: u.user.id, game: 'kaipan', ref: 'ref-000001', tier: 'small', amount: 2_000, until: Date.now() + HOUR, mode: 'client', op: id('op') })).toEqual({
      ok: false,
      error: 'bad_game',
    });
    expect(await texas.settle({ userId: u.user.id, game: 'kaipan', ref: 'ref-000001', amount: 1, mode: 'client', op: id('op') })).toMatchObject({ error: 'bad_game' });
    const ok = await texas.buyin({ userId: u.user.id, game: 'texas', ref: 'ref-000001', tier: 'small', amount: 2_000, until: Date.now() + HOUR, mode: 'client', op: id('op') });
    expect(ok).toMatchObject({ ok: true, wallet: { balance: 8_000 } });
  });

  it('绑定上没写 props.game、写的不是认识的游戏：四个方法一律 bad_game（参数不对也一样），不碰库', async () => {
    const u = await registerUser();
    const uid = u.user.id;
    const req = { userId: uid, game: 'texas', ref: 'ref-000001', tier: 'small', amount: 2_000, until: Date.now() + HOUR, mode: 'server', op: id('op') };
    for (const stub of [unbound, boundTo('chess'), boundTo('')]) {
      expect(await stub.view(uid)).toEqual({ ok: false, error: 'bad_game' });
      expect(await stub.buyin(req)).toEqual({ ok: false, error: 'bad_game' });
      expect(await stub.settle({ ...req, amount: 1 })).toEqual({ ok: false, error: 'bad_game' });
      expect(await stub.refund(req)).toEqual({ ok: false, error: 'bad_game' });
      expect(await stub.buyin({ nonsense: true })).toEqual({ ok: false, error: 'bad_game' });
    }
    expect(await count('SELECT COUNT(*) AS n FROM wallets')).toBe(0);
  });

  it('操作 id 按游戏分开：两个游戏碰巧用了同一个 op，各算各的（都写 1 行）', async () => {
    const u = await registerUser();
    const uid = u.user.id;
    await buyin(uid, { mode: 'server' });
    await buyin(uid, { game: 'texas', ref: 'room-0001', mode: 'server' });
    expect(await settle(uid, { mode: 'server', amount: 3_000, op: 'same-op-01' })).toMatchObject({ ok: true, credited: 3_000 });
    expect(wrote()).toBe(1);
    const t = await settle(uid, { game: 'texas', ref: 'room-0001', mode: 'server', amount: 5_000, op: 'same-op-01' });
    expect(t).toMatchObject({ ok: true, credited: 5_000, wallet: { balance: 6_000 + 3_000 + 5_000, stakes: [] } });
    expect('dup' in t).toBe(false);
    expect(wrote()).toBe(1);
    // 同一个游戏里重发仍是重复
    expect(await settle(uid, { game: 'texas', ref: 'room-0001', mode: 'server', amount: 5_000, op: 'same-op-01' })).toMatchObject({ dup: true, credited: 5_000 });
    expect(wrote()).toBe(0);
  });

  it('抢先占住好友房的 op 白拿不了（0.12.2）：单机拿 1 筹码用掉房间接下来的 op，房间补码回 op_conflict，什么都不改、0 行', async () => {
    const u = await registerUser();
    const uid = u.user.id;
    const room = 'room-0002';
    expect(await buyin(uid, { game: 'texas', ref: room, mode: 'server', amount: 2_000, op: `${room}-b1` })).toMatchObject({ ok: true });
    // 单机接口的 op 由浏览器给：填房间下一次补码的 op
    expect(await buyin(uid, { game: 'texas', ref: 'solo-0001', mode: 'client', amount: 1, op: `${room}-b2` })).toMatchObject({ ok: true });
    const before = await state(uid);
    const r = await buyin(uid, { game: 'texas', ref: room, mode: 'server', amount: 2_000, op: `${room}-b2` });
    expect(r).toMatchObject({ ok: false, error: 'op_conflict', wallet: { balance: 10_000 - 2_000 - 1 } });
    expect(wrote()).toBe(0);
    expect(await state(uid)).toEqual(before);
  });

  it('同一个 op 做的不是同一件事：类型、ref、mode、档位不一样都回 op_conflict（0 行）；一样的照旧是重复', async () => {
    const u = await registerUser();
    const uid = u.user.id;
    const op = id('op');
    expect(await buyin(uid, { op })).toMatchObject({ ok: true });
    const cases = [
      () => refund(uid, { op }), // 类型不同
      () => settle(uid, { op, amount: 0 }), // 类型不同
      () => buyin(uid, { op, ref: 'ref-000002' }), // ref 不同
      () => buyin(uid, { op, mode: 'server' }), // mode 不同
      () => buyin(uid, { op, tier: 'mid' }), // 档位不同
    ];
    for (const f of cases) {
      expect(await f()).toMatchObject({ ok: false, error: 'op_conflict' });
      expect(wrote()).toBe(0);
    }
    expect(await buyin(uid, { op })).toMatchObject({ ok: true, dup: true, wallet: { balance: 8_000 } });
    // 结回、放弃也核指纹：同一个 op 换个 ref 重发不是重复
    await buyin(uid, { ref: 'ref-000003', mode: 'server' });
    const sop = id('op');
    expect(await settle(uid, { ref: 'ref-000003', mode: 'server', amount: 1_000, op: sop })).toMatchObject({ ok: true });
    expect(await settle(uid, { ref: 'ref-000001', amount: 1_000, op: sop })).toMatchObject({ ok: false, error: 'op_conflict' });
    expect(await refund(uid, { ref: 'ref-000001', op: sop })).toMatchObject({ ok: false, error: 'op_conflict' });
  });

  it('补码记在那一份上的 op（挤出最近 32 个之后）：档位、mode 对不上回 op_conflict', async () => {
    const u = await registerUser();
    const uid = u.user.id;
    const bop = id('op');
    await buyin(uid, { amount: 500, op: bop });
    for (let i = 0; i < 17; i++) {
      const ref = `ref-y${String(i).padStart(5, '0')}`;
      await buyin(uid, { ref, amount: 100 });
      await refund(uid, { ref });
    }
    expect(await buyin(uid, { amount: 500, op: bop, mode: 'server' })).toMatchObject({ ok: false, error: 'op_conflict' });
    expect(await buyin(uid, { amount: 500, op: bop, tier: 'mid' })).toMatchObject({ ok: false, error: 'op_conflict' });
    expect(await buyin(uid, { amount: 500, op: bop })).toMatchObject({ ok: true, dup: true });
  });

  it('0.12.2 之前记的操作没有指纹：按旧办法认成重复', async () => {
    const u = await registerUser();
    const uid = u.user.id;
    const op = id('op');
    await buyin(uid, { op });
    await patchState(uid, (s) => {
      for (const o of s.ops) delete o.f;
    });
    expect(await refund(uid, { op })).toMatchObject({ ok: true, dup: true });
    expect(wrote()).toBe(0);
  });
});

describe('RPC 只露出四个方法', () => {
  it('原型上只有 view、buyin、settle、refund：RPC 能调的就是原型上的方法，内部的 #op、#run 调不到（否则能把带入当成"回"，绕过只读档的拦截）', () => {
    expect(Object.getOwnPropertyNames(WalletService.prototype).sort()).toEqual(['buyin', 'constructor', 'refund', 'settle', 'view']);
  });
});

describe('到期退回', () => {
  it('过了到期时间：下次碰钱包时原样退回、记下 ref（看钱包也写这 1 行）；之后这个 ref 再结回、再带入都拒绝', async () => {
    const u = await registerUser();
    const uid = u.user.id;
    await buyin(uid, { game: 'texas', ref: 'room-0009', mode: 'server', amount: 2_000, until: Date.now() + HOUR });
    advance(HOUR);
    const v = await wallet.view(uid);
    expect(v).toMatchObject({ ok: true, wallet: { balance: 10_000, stakes: [] } });
    expect(wrote()).toBe(1);
    const s = await state(uid);
    expect(s.expired).toEqual(['texas:room-0009']);
    expect(s.today.games.texas!.back).toBe(2_000);
    expect(await wallet.view(uid)).toMatchObject({ ok: true });
    expect(wrote()).toBe(0);
    expect(await settle(uid, { game: 'texas', ref: 'room-0009', mode: 'server', amount: 9_000 })).toMatchObject({ ok: false, error: 'expired' });
    expect(await refund(uid, { game: 'texas', ref: 'room-0009', mode: 'server' })).toMatchObject({ ok: false, error: 'expired' });
    expect(await buyin(uid, { game: 'texas', ref: 'room-0009', mode: 'server' })).toMatchObject({ ok: false, error: 'expired' });
    expect(wrote()).toBe(0);
  });

  it('只读档：看钱包时回话里照样退回，但不写；能写时再写', async () => {
    const u = await registerUser();
    const uid = u.user.id;
    await buyin(uid, { until: Date.now() + HOUR });
    advance(2 * HOUR);
    await seed({ rows_save: 50_000 });
    expect(await wallet.view(uid)).toMatchObject({ ok: true, wallet: { balance: 10_000, stakes: [] } });
    expect(wrote()).toBe(0);
    expect((await state(uid)).stakes['kaipan:ref-000001']).toBeDefined();
  });
});

describe('client 模式的每日上限（economy.md 第 4 节）', () => {
  it('净赢 = 当天 client 结回 − 带入，最多 10 份（0.10.2 起）；超出的不进钱包，回话带 capped；带上桌的那一份总能拿回来', async () => {
    const u = await registerUser();
    const uid = u.user.id;
    await buyin(uid);
    // 一份 2,000：带入 2,000、结回 30,000，净赢 28,000 > 20,000，只进 22,000（净赢正好 20,000）
    expect(await settle(uid, { amount: 30_000 })).toMatchObject({ ok: true, credited: 22_000, capped: 8_000, wallet: { balance: 30_000, caps: { kaipan: { net: 20_000, cap: 20_000 } } } });
    // 到顶以后再赢：只拿回带上桌的那一份
    await buyin(uid, { ref: 'ref-000002' });
    expect(await settle(uid, { ref: 'ref-000002', amount: 4_000 })).toMatchObject({ credited: 2_000, capped: 2_000 });
    // 输一场，上限空出来一些
    await buyin(uid, { ref: 'ref-000003' });
    await settle(uid, { ref: 'ref-000003', amount: 500 });
    await buyin(uid, { ref: 'ref-000004' });
    expect(await settle(uid, { ref: 'ref-000004', amount: 9_000 })).toMatchObject({ credited: 3_500, capped: 5_500 });
    const g = (await state(uid)).today.games.kaipan!;
    expect(g.cout - g.cin).toBe(20_000);
  });

  it('份按当天最大的一份算（这里带满了一份中档）；server 模式（好友房）不受限；别的游戏单算', async () => {
    const u = await registerUser();
    const uid = u.user.id;
    await buyin(uid, { tier: 'mid', amount: 1 });
    await settle(uid, { amount: 1 });
    await buyin(uid, { tier: 'mid', ref: 'ref-000002', amount: 10_000 });
    // 最大的一份是带满的中档 10,000：上限 100,000；带入 10,001、结回 1，最多再进 110,000
    expect(await settle(uid, { ref: 'ref-000002', amount: 150_000 })).toMatchObject({ credited: 110_000, capped: 40_000 });
    await buyin(uid, { game: 'texas', ref: 'room-0001', mode: 'server' });
    expect(await settle(uid, { game: 'texas', ref: 'room-0001', mode: 'server', amount: 40_000 })).toMatchObject({ credited: 40_000 });
    await buyin(uid, { game: 'guandan', ref: 'solo-0001' });
    expect(await settle(uid, { game: 'guandan', ref: 'solo-0001', amount: 8_000 })).toMatchObject({ credited: 8_000 });
  });

  it('一份按实际带上桌的算、不超过档位的一份（0.12.1）：带 1 筹码进豪华档，当天上限是 10 筹码，不是 200 万', async () => {
    const u = await registerUser();
    const uid = u.user.id;
    await buyin(uid, { tier: 'lux', amount: 1 });
    // 净赢最多 10 × 1：带上桌的 1 加 10，只进 11
    expect(await settle(uid, { amount: 1_000_000 })).toMatchObject({ ok: true, credited: 11, capped: 999_989, wallet: { caps: { kaipan: { net: 10, cap: 10 } } } });
    // 补码累计后按累计的算：1 + 49,999 = 50,000，上限 500,000（这一份带了多少就冒多大的险）
    await patchState(uid, (s) => {
      s.balance = 300_000;
    });
    await buyin(uid, { tier: 'lux', ref: 'ref-000002', amount: 1 });
    expect(await buyin(uid, { tier: 'lux', ref: 'ref-000002', amount: 49_999 })).toMatchObject({ ok: true });
    expect((await state(uid)).today.games.kaipan!.top).toBe(50_000);
    // 整份带入不变：豪华档带满 200,000，一份就是 200,000
    await buyin(uid, { game: 'texas', tier: 'lux', ref: 'ref-000003', amount: 200_000 });
    expect((await state(uid)).today.games.texas!.top).toBe(200_000);
    // 带得比一份多不可能（buyin 每次最多一份），补码超过一份时也只按档位的一份算
    await buyin(uid, { game: 'guandan', tier: 'small', ref: 'ref-000004', amount: 2_000 });
    await buyin(uid, { game: 'guandan', tier: 'small', ref: 'ref-000004', amount: 2_000 });
    expect((await state(uid)).today.games.guandan!.top).toBe(2_000);
  });

  it('放弃、到期退回把带入减回去：不能靠"带入再放弃"把上限撑大', async () => {
    const u = await registerUser();
    const uid = u.user.id;
    for (let i = 0; i < 5; i++) {
      await buyin(uid, { ref: `ref-loop-${i}` });
      await refund(uid, { ref: `ref-loop-${i}` });
    }
    await buyin(uid, { ref: 'ref-real-1' });
    expect(await settle(uid, { ref: 'ref-real-1', amount: 40_000 })).toMatchObject({ credited: 22_000, capped: 18_000 });
  });

  it('计数已经超过上限（比如以后把份数调小）：带上桌的那一份照样全额拿回来', async () => {
    const u = await registerUser();
    const uid = u.user.id;
    await buyin(uid);
    await patchState(uid, (s) => {
      s.today.games.kaipan!.cout = 50_000;
    });
    expect(await settle(uid, { amount: 9_000 })).toMatchObject({ credited: 2_000, capped: 7_000 });
  });

  it('跨零点结回：昨天带上桌的 client 那一份算进今天的带入，本金不会被当成赢的（正好到上限也全进）', async () => {
    const u = await registerUser();
    const uid = u.user.id;
    advance(9 * HOUR + 20 * 60_000); // 北京时间 23:50
    await buyin(uid, { until: Date.now() + 2 * HOUR });
    advance(20 * 60_000); // 00:10，换日
    expect(await wallet.view(uid)).toMatchObject({ wallet: { caps: { kaipan: { net: -2_000, cap: 20_000 } } } });
    // 带入 2,000、结回 22,000：净赢 20,000，正好到上限
    expect(await settle(uid, { amount: 22_000 })).toMatchObject({ ok: true, credited: 22_000, wallet: { balance: 30_000, caps: { kaipan: { net: 20_000, cap: 20_000 } } } });
    const g = (await state(uid)).today.games.kaipan!;
    expect([g.cin, g.cout, g.capped]).toEqual([2_000, 22_000, 0]);
  });

  it('跨零点后放弃、到期退回：今天的带入减回去，不会变成负的，也不会白送上限', async () => {
    const u = await registerUser();
    const uid = u.user.id;
    advance(9 * HOUR + 20 * 60_000);
    await buyin(uid, { tier: 'mid', amount: 5_000, until: Date.now() + 2 * HOUR });
    expect(await buyin(uid, { game: 'guandan', ref: 'solo-0001', until: Date.now() + 30 * 60_000 })).toMatchObject({ ok: true });
    advance(20 * 60_000);
    expect(await refund(uid)).toMatchObject({ ok: true, credited: 5_000 });
    advance(20 * 60_000); // 掼蛋那一份到期
    await wallet.view(uid);
    const t = (await state(uid)).today.games;
    // 跨零点那一份只带了 5,000：今天的一份按 5,000 算，不按中档的整份（0.12.1）
    expect([t.kaipan!.cin, t.kaipan!.back, t.kaipan!.top]).toEqual([0, 5_000, 5_000]);
    expect([t.guandan!.cin, t.guandan!.back]).toEqual([0, 2_000]);
    // 今天开盘按中档算上限：最多净赢 100,000（带入的 5,000 已经减回去了）
    await buyin(uid, { tier: 'mid', ref: 'ref-000002', amount: 10_000 });
    expect(await settle(uid, { ref: 'ref-000002', amount: 150_000 })).toMatchObject({ credited: 110_000, capped: 40_000 });
  });

  it('跨零点的 server 那一份不算进 client 的带入', async () => {
    const u = await registerUser();
    const uid = u.user.id;
    advance(9 * HOUR + 20 * 60_000);
    await buyin(uid, { game: 'texas', ref: 'room-0001', mode: 'server' });
    advance(20 * 60_000);
    await settle(uid, { game: 'texas', ref: 'room-0001', mode: 'server', amount: 100 });
    expect((await state(uid)).today.games.texas!.cin).toBe(0);
  });

  it('过了北京时间 0 点，上限重新算', async () => {
    const u = await registerUser();
    const uid = u.user.id;
    await buyin(uid);
    await settle(uid, { amount: 8_000 });
    advance(24 * HOUR);
    await buyin(uid, { ref: 'ref-000002' });
    expect(await settle(uid, { ref: 'ref-000002', amount: 8_000 })).toMatchObject({ credited: 8_000 });
  });
});

describe('写入上限、补给', () => {
  it('每人每天 1,000 次（0.10.2 起）：到了不能带入、不能领补给；结回、放弃照收', async () => {
    const u = await registerUser();
    const uid = u.user.id;
    await buyin(uid, { amount: 100 });
    await buyin(uid, { game: 'texas', ref: 'room-0001', mode: 'server', amount: 100 });
    await patchState(uid, (s) => {
      s.today.writes = DAILY_WRITES;
    });
    expect(await buyin(uid, { game: 'guandan', ref: 'solo-0001' })).toMatchObject({ ok: false, error: 'limit' });
    expect(wrote()).toBe(0);
    expect(await settle(uid, { amount: 50 })).toMatchObject({ ok: true });
    expect(await refund(uid, { game: 'texas', ref: 'room-0001', mode: 'server' })).toMatchObject({ ok: true });
    await patchState(uid, (s) => {
      s.balance = 0;
    });
    const res = await call('/api/wallet/relief', { body: {}, cookie: u.cookie });
    expect(res.status).toBe(429);
    expect(rowsWritten()).toBe(0);
  });

  it('补给：余额加桌上的不到 2,000，北京时间每天一次补到 2,000（1 行）；别的情况 409、0 行；要过 CSRF', async () => {
    const u = await registerUser();
    const uid = u.user.id;
    const relief = (o = {}) => call('/api/wallet/relief', { body: {}, cookie: u.cookie, ...o });
    // 新号 10,000：不需要
    let res = await relief();
    expect([res.status, await errorOf(res)]).toEqual([409, 'relief_not_needed']);
    expect(await count('SELECT COUNT(*) AS n FROM wallets')).toBe(0);
    // 全带上桌：余额 0，但加上桌上的还有 10,000，不需要
    await buyin(uid, { tier: 'mid', amount: 10_000 });
    res = await relief();
    expect([res.status, await errorOf(res)]).toEqual([409, 'relief_not_needed']);
    expect(rowsWritten()).toBe(0);
    await settle(uid, { amount: 300 });
    expect((await relief({ csrf: false })).status).toBe(403);
    res = await relief();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ wallet: { balance: 2_000, canRelief: false } });
    expect(rowsWritten()).toBe(1);
    res = await relief();
    expect([res.status, await errorOf(res)]).toEqual([409, 'relief_not_needed']);
    // 当天又输光了：今天领过，不再给
    await buyin(uid, { ref: 'ref-000002', amount: 2_000 });
    await settle(uid, { ref: 'ref-000002', amount: 0 });
    res = await relief();
    expect([res.status, await errorOf(res)]).toEqual([409, 'relief_used']);
    expect(rowsWritten()).toBe(0);
    // 第二天又能领
    advance(24 * HOUR);
    expect((await (await call('/api/wallet', { cookie: u.cookie })).json()) as unknown).toMatchObject({ wallet: { canRelief: true } });
    expect((await relief()).status).toBe(200);
    expect((await state(uid)).today.relief).toBe(2_000);
    // 0.10.2：桌上有一小份也能领，补到"余额加桌上的"正好 2,000，补进来的进余额
    advance(24 * HOUR);
    await buyin(uid, { ref: 'ref-000003', amount: 500 });
    await patchState(uid, (s) => {
      s.balance = 300;
    });
    res = await relief();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ wallet: { balance: 1_500, stakes: [{ ref: 'ref-000003', amount: 500 }], canRelief: false } });
    expect((await state(uid)).today.relief).toBe(1_200);
  });
});

describe('熔断档位与预算（6.6 的"钱包"类）', () => {
  it('钱包类预算用完：停带入和领补给；结回、放弃、看钱包照常', async () => {
    const u = await registerUser();
    const uid = u.user.id;
    await buyin(uid);
    await buyin(uid, { game: 'texas', ref: 'room-0001', mode: 'server' });
    await seed({ rows_wallet: 6_000 });
    expect(await buyin(uid, { game: 'guandan', ref: 'solo-0001' })).toEqual({ ok: false, error: 'busy' });
    await patchState(uid, (s) => {
      s.balance = 0;
    });
    expect((await call('/api/wallet/relief', { body: {}, cookie: u.cookie })).status).toBe(503);
    expect(await settle(uid, { amount: 100 })).toMatchObject({ ok: true });
    expect(await refund(uid, { game: 'texas', ref: 'room-0001', mode: 'server' })).toMatchObject({ ok: true });
    expect(await wallet.view(uid)).toMatchObject({ ok: true });
  });

  it('只读档：停带入；结回、放弃照收（桌上的筹码总要能回来）；停服档全停', async () => {
    const u = await registerUser();
    const uid = u.user.id;
    await buyin(uid);
    await buyin(uid, { game: 'texas', ref: 'room-0001', mode: 'server' });
    await seed({ rows_save: 50_000 });
    expect(await buyin(uid, { game: 'guandan', ref: 'solo-0001' })).toEqual({ ok: false, error: 'busy' });
    expect(await settle(uid, { amount: 100 })).toMatchObject({ ok: true });
    expect(wrote()).toBe(1);
    await seed({ rows_save: 90_000 });
    expect(await refund(uid, { game: 'texas', ref: 'room-0001', mode: 'server' })).toEqual({ ok: false, error: 'busy' });
    expect(await wallet.view(uid)).toEqual({ ok: false, error: 'busy' });
    expect(wrote()).toBe(0);
  });

  it('停增长档：不建新钱包；已有的照常', async () => {
    const old = await registerUser();
    await buyin(old.user.id);
    const fresh = await registerUser();
    await resetAll.limits({ noGrowthDbBytes: 1 });
    expect(await buyin(fresh.user.id)).toEqual({ ok: false, error: 'busy' });
    expect(await count('SELECT COUNT(*) AS n FROM wallets WHERE user_id = ?1', fresh.user.id)).toBe(0);
    expect(await buyin(old.user.id, { game: 'guandan', ref: 'solo-0001' })).toMatchObject({ ok: true });
  });

  it('每次 RPC 算平台 1 次调用；写入记在钱包类', async () => {
    const u = await registerUser();
    await flushMeter();
    const before = await count('SELECT COALESCE(SUM(requests), 0) AS n FROM meter_hourly');
    const wBefore = await count('SELECT COALESCE(SUM(rows_wallet), 0) AS n FROM meter_hourly');
    await buyin(u.user.id);
    await wallet.view(u.user.id);
    await flushMeter();
    expect((await count('SELECT COALESCE(SUM(requests), 0) AS n FROM meter_hourly')) - before).toBe(2);
    expect((await count('SELECT COALESCE(SUM(rows_wallet), 0) AS n FROM meter_hourly')) - wBefore).toBe(1);
  });
});

describe('删号、统计', () => {
  it('注销：钱包一起删掉', async () => {
    const u = await registerUser();
    await buyin(u.user.id);
    const res = await call('/api/account/delete', { body: { currentPassword: u.password }, cookie: u.cookie });
    expect(res.status).toBe(204);
    expect(await count('SELECT COUNT(*) AS n FROM wallets WHERE user_id = ?1', u.user.id)).toBe(0);
  });

  it('Cron 每天记一次前一天（北京时间）的全站统计（1 行）；同一天再跑不再写；管理页能看，普通人看不了', async () => {
    const a = await registerUser();
    const b = await registerUser();
    // 北京时间 10 月 14 日：a 赢了开盘、b 输了德州，b 还有一份在桌上
    await buyin(a.user.id);
    await settle(a.user.id, { amount: 5_000 });
    await buyin(b.user.id, { game: 'texas', ref: 'room-0001', mode: 'server', amount: 2_000 });
    await settle(b.user.id, { game: 'texas', ref: 'room-0001', mode: 'server', amount: 0 });
    await buyin(b.user.id, { ref: 'solo-0001', amount: 1_000 });
    // 第二天 a 又碰了钱包（计数挪进 prev），b 没碰
    advance(24 * HOUR);
    await boundTo('guandan').buyin({ userId: a.user.id, game: 'guandan', ref: 'solo-0002', tier: 'small', amount: 2_000, until: Date.now() + HOUR, mode: 'client', op: id('op') });
    // 北京时间 10 月 16 日凌晨 3 点多跑 Cron，记 15 日；先把时间拨到那天
    advance(13 * HOUR);
    await runCleanup(env, Date.now());
    const row = await env.DB.prepare('SELECT day, data FROM wallet_stats').all<{ day: string; data: string }>();
    expect(row.results.map((r) => r.day)).toEqual(['2026-10-15']);
    // 再往回记 14 日：直接调一次（Cron 漏跑的日子没有记录，这里只为核对汇总的口径）
    const { summarizeDay } = await import('../worker/api/wallet-store');
    const { Db, newStats } = await import('../worker/api/db');
    const d14 = await summarizeDay(new Db(env.DB, newStats(), 'sys'), '2026-10-14');
    expect(d14).toEqual({
      day: '2026-10-14',
      total: 10_000 + 3_000 + (10_000 - 2_000 - 1_000) + 1_000 + 2_000 - 2_000,
      wallets: 2,
      grant: 20_000,
      relief: 0,
      admin: 0,
      // 0.10.7：碰过钱包的人数、领补给的人数、各游戏上过桌的人数
      active: 2,
      reliefCount: 0,
      games: {
        kaipan: { in: 3_000, out: 5_000, back: 0, capped: 0, players: 2 },
        texas: { in: 2_000, out: 0, back: 0, capped: 0, players: 1 },
      },
    });
    // 同一天再跑：0 行
    await runCleanup(env, Date.now());
    expect(await count('SELECT COUNT(*) AS n FROM wallet_stats')).toBe(1);
    const admin = await call('/api/admin/wallet-stats', { authorization: 'Bearer t1:test-admin-token-0123456789abcdef' });
    expect(admin.status).toBe(200);
    expect(((await admin.json()) as { days: { day: string }[] }).days.map((d) => d.day)).toEqual(['2026-10-15']);
    expect((await call('/api/admin/wallet-stats', { cookie: a.cookie })).status).toBe(403);
  });
});

describe('管理员调整筹码（0.9.4）', () => {
  async function admin() {
    const a = await registerUser();
    await env.DB.prepare("UPDATE users SET role = 'admin' WHERE id = ?1").bind(a.user.id).run();
    return a;
  }
  const adjust = (cookie: string, body: unknown, o = {}) => call('/api/admin/wallet/adjust', { body, cookie, ...o });

  it('加：没有钱包的先按新号建（送的 10,000 照送），写 1 行；不占每天 200 次，记进当天的 admin', async () => {
    const a = await admin();
    const u = await registerUser();
    const res = await adjust(a.cookie, { username: u.username, amount: 5_000, note: '同学测试' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ credited: 5_000, wallet: { balance: 15_000 } });
    expect(rowsWritten()).toBe(1);
    const s = await state(u.user.id);
    expect([s.today.grant, s.today.admin, s.today.writes]).toEqual([10_000, 5_000, 0]);
    expect(s.adminLog).toEqual([{ at: Date.now(), amount: 5_000, note: '同学测试', by: a.username }]);
  });

  it('扣：最多扣到 0，不碰桌上那一份；已经是 0 再扣是 409、0 行', async () => {
    const a = await admin();
    const u = await registerUser();
    await buyin(u.user.id, { amount: 2_000 });
    const res = await adjust(a.cookie, { username: u.username, amount: -100_000 });
    expect(await res.json()).toMatchObject({ credited: -8_000, wallet: { balance: 0, stakes: [{ game: 'kaipan', amount: 2_000 }] } });
    const again = await adjust(a.cookie, { username: u.username, amount: -1 });
    expect([again.status, await errorOf(again)]).toEqual([409, 'no_change']);
    expect(rowsWritten()).toBe(0);
    // 不算进实盘净赢：结回照常按自己的带入算
    expect(await settle(u.user.id, { amount: 8_000 })).toMatchObject({ credited: 8_000 });
  });

  it('数量不对 400；普通用户 403；令牌 403；没 CSRF 头 403；查不到人 404', async () => {
    const a = await admin();
    const u = await registerUser();
    for (const amount of [0, 1.5, 1_000_001, -1_000_001, '5000']) {
      expect((await adjust(a.cookie, { username: u.username, amount })).status, String(amount)).toBe(400);
    }
    expect((await adjust(u.cookie, { username: u.username, amount: 1 })).status).toBe(403);
    expect((await call('/api/admin/wallet/adjust', { body: { username: u.username, amount: 1 }, authorization: 'Bearer t1:test-admin-token-0123456789abcdef' })).status).toBe(403);
    expect((await adjust(a.cookie, { username: u.username, amount: 1 }, { csrf: false })).status).toBe(403);
    expect((await adjust(a.cookie, { username: 'nobody_here', amount: 1 })).status).toBe(404);
    expect(await count('SELECT COUNT(*) AS n FROM wallets')).toBe(0);
  });

  it('查人：昵称、钱包、这个人最近的调整；全站最近 10 次；统计里有管理员调整', async () => {
    const a = await admin();
    const u = await registerUser();
    const v = await registerUser();
    await adjust(a.cookie, { username: u.username, amount: 3_000 });
    advance(60_000);
    await adjust(a.cookie, { username: v.username, amount: -500, note: '多给了' });
    const look = await call(`/api/admin/wallet/${u.username}`, { cookie: a.cookie });
    expect(await look.json()).toMatchObject({ user: { username: u.username }, wallet: { balance: 13_000 }, log: [{ amount: 3_000 }] });
    const fresh = await call(`/api/admin/wallet/${a.username}`, { cookie: a.cookie });
    expect(await fresh.json()).toMatchObject({ wallet: { balance: 10_000, fresh: true }, log: [] });
    const recent = (await (await call('/api/admin/wallet-adjustments', { cookie: a.cookie })).json()) as { recent: { username: string; amount: number; note: string }[] };
    expect(recent.recent.map((r) => [r.username, r.amount, r.note])).toEqual([
      [v.username, -500, '多给了'],
      [u.username, 3_000, ''],
    ]);
    const { summarizeDay } = await import('../worker/api/wallet-store');
    const { Db, newStats } = await import('../worker/api/db');
    expect((await summarizeDay(new Db(env.DB, newStats(), 'sys'), '2026-10-14')).admin).toBe(2_500);
  });
});

describe('战绩（0.10.0，5.10）：结回带小结，累加进 career，不多写行', () => {
  const career = async (uid: string, game = 'kaipan') => (await state(uid)).career?.[game];

  it('带小结：局数、赢的局数、最大一把、称号、自定义数累加；净赢、本周净赢按钱算；钱包还是写 1 行', async () => {
    const uid = (await registerUser()).user.id;
    await buyin(uid, { ref: 'ref-000001' });
    const r = await settle(uid, { ref: 'ref-000001', amount: 3_000, stats: { rounds: 1, wins: 1, best: 1_000, titles: ['first_win'], max: { score: 120 }, sum: { bombs: 2 } } });
    expect(r).toMatchObject({ ok: true, credited: 3_000 });
    expect(r).not.toHaveProperty('statsIgnored');
    // 钱包 1 行；赢了半份、第一次拿到称号，另生成一条好友动态（0.17.0，在线类 2 行，feed.test.ts 细测）
    expect(lastWalletStats.byCategory.wallet).toBe(1);
    expect(lastWalletStats.byCategory.live).toBe(2);
    await buyin(uid, { ref: 'ref-000002' });
    await settle(uid, { ref: 'ref-000002', amount: 500, stats: { rounds: 2, wins: 0, best: 0, titles: ['first_win', 'broke'], max: { score: 80 }, sum: { bombs: 1 } } });
    expect(await career(uid)).toEqual({
      n: 2,
      net: 1_000 - 1_500,
      wk: '2026-10-12',
      wnet: -500,
      rounds: 3,
      wins: 1,
      best: 1_000,
      titles: { first_win: Date.now(), broke: Date.now() },
      max: { score: 120 },
      sum: { bombs: 3 },
    });
  });

  it('不带小结也记份数和净赢；放弃不算一份；好友房（server）一样记', async () => {
    const uid = (await registerUser()).user.id;
    await buyin(uid, { game: 'texas', ref: 'room-0001', mode: 'server' });
    await settle(uid, { game: 'texas', ref: 'room-0001', mode: 'server', amount: 5_000 });
    await buyin(uid, { game: 'texas', ref: 'room-0002', mode: 'server' });
    await refund(uid, { game: 'texas', ref: 'room-0002', mode: 'server' });
    expect(await career(uid, 'texas')).toMatchObject({ n: 1, net: 3_000, wnet: 3_000, rounds: 0, titles: {} });
  });

  it('局数超过 1,000 截断、赢的局数截到局数、最大一把截到这一份结回的钱', async () => {
    const uid = (await registerUser()).user.id;
    await buyin(uid, { game: 'texas', ref: 'room-0001', mode: 'server' });
    const r = await settle(uid, { game: 'texas', ref: 'room-0001', mode: 'server', amount: 4_000, stats: { rounds: 1_500, wins: 1_200, best: 999_999 } });
    expect(r).not.toHaveProperty('statsIgnored');
    expect(await career(uid, 'texas')).toMatchObject({ rounds: 1_000, wins: 1_000, best: 4_000 });
  });

  it('形状不对、超过 256 字节：整份小结忽略，钱照常结；重发回同样的结果，不记两次', async () => {
    const uid = (await registerUser()).user.id;
    const bad: unknown[] = [
      { rounds: 1, wins: 1 },
      { rounds: -1, wins: 0, best: 0 },
      { rounds: 1, wins: 0, best: 0, titles: ['A'] },
      { rounds: 1, wins: 0, best: 0, titles: ['__proto__'] },
      { rounds: 1, wins: 0, best: 0, titles: ['a', 'b', 'c', 'd', 'e', 'f'] },
      { rounds: 1, wins: 0, best: 0, max: { a: 1, b: 2 }, sum: { c: 1, d: 1 } },
      { rounds: 1, wins: 0, best: 0, sum: { a: 1.5 } },
      [1, 2, 3],
      'x',
    ];
    for (const [i, stats] of bad.entries()) {
      const ref = `ref-bad-${i}0`;
      await buyin(uid, { ref, amount: 1 });
      expect(await settle(uid, { ref, amount: 1, stats }), JSON.stringify(stats)).toMatchObject({ ok: true, credited: 1, statsIgnored: 'bad_stats' });
    }
    await buyin(uid, { ref: 'ref-big-001', amount: 1 });
    const op = id('op');
    const big = { rounds: 1, wins: 0, best: 0, max: { long_key_aaaaaaa: 1 }, pad: 'x'.repeat(256) };
    expect(await settle(uid, { ref: 'ref-big-001', amount: 1, op, stats: big })).toMatchObject({ ok: true, statsIgnored: 'too_big' });
    expect(await settle(uid, { ref: 'ref-big-001', amount: 1, op, stats: big })).toMatchObject({ ok: true, dup: true, statsIgnored: 'too_big' });
    expect(await career(uid)).toMatchObject({ n: bad.length + 1, rounds: 0, titles: {} });
  });

  it('本周净赢：北京时间周一 0 点换周，从 0 算；累计净赢不清', async () => {
    expect(beijingWeek(Date.UTC(2026, 9, 18, 15, 59))).toBe('2026-10-12');
    expect(beijingWeek(Date.UTC(2026, 9, 18, 16, 0))).toBe('2026-10-19');
    const uid = (await registerUser()).user.id;
    await buyin(uid, { ref: 'ref-000001' });
    await settle(uid, { ref: 'ref-000001', amount: 3_000 });
    advance(5 * 24 * HOUR);
    await buyin(uid, { ref: 'ref-000002' });
    await settle(uid, { ref: 'ref-000002', amount: 2_500 });
    expect(await career(uid)).toMatchObject({ n: 2, net: 1_500, wk: '2026-10-19', wnet: 500 });
  });
});
