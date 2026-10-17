/**
 * 好友动态（0.17.0，docs/platform-backend.md 15.17）：游戏报的名场面、实盘结回自动生成（门槛：净赢 ≥ 半份或第一次拿到称号，输的不发）、
 * 每人每天 10 条（第 11 条静默丢）、只给好友看、开关、赞和扔道具每条每人一次、7 天过期、注销和 Cron 清理。
 * 测试时间是北京时间 2026-10-14 14:30。
 */
import { exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { runCleanup } from '../worker/api/cron';
import type { WalletReply } from '../worker/api/wallet-store';
import { lastWalletStats } from '../worker/wallet-service';
import { advance, call, count, env, flushMeter, registerUser, resetAll, rowsBy, rowsWritten } from './helpers';

beforeEach(() => resetAll());

let ipSeq = 0;
const newUser = () => registerUser(undefined, undefined, `198.51.100.${++ipSeq % 250}`);
type U = Awaited<ReturnType<typeof newUser>>;
interface Item {
  id: string;
  user: { userId: string };
  game: string;
  kind: string;
  data: Record<string, unknown>;
  reactions: Record<string, number>;
  mine?: string;
}

const moment = (u: U, body: unknown) => call('/api/feed', { body, cookie: u.cookie });
const feedOf = async (u: U) => ((await (await call('/api/feed', { cookie: u.cookie })).json()) as { items: Item[] }).items;
const reactTo = (u: U, id: string, kind = 'like') => call(`/api/feed/${id}/react`, { body: { kind }, cookie: u.cookie });
async function befriend(a: U, b: U): Promise<void> {
  expect((await call('/api/friends/requests', { body: { friendCode: b.user.friendCode }, cookie: a.cookie })).status).toBe(200);
  expect((await call(`/api/friends/${a.user.id}/accept`, { body: {}, cookie: b.cookie })).status).toBe(200);
}
async function pair(): Promise<[U, U]> {
  const a = await newUser();
  const b = await newUser();
  await befriend(a, b);
  return [a, b];
}

type Stub = { buyin(req: unknown): Promise<WalletReply>; settle(req: unknown): Promise<WalletReply> };
const kaipan = (exports as unknown as { WalletService: (o: { props: { game: string } }) => Stub }).WalletService({ props: { game: 'kaipan' } });
let opSeq = 0;
/** 小档带一份 2,000，结回 amount，带上小结 */
async function playOnce(u: U, amount: number, stats: unknown = { rounds: 1, wins: 1, best: 0 }): Promise<WalletReply> {
  const ref = `ref-${String(++opSeq).padStart(6, '0')}`;
  expect(await kaipan.buyin({ userId: u.user.id, game: 'kaipan', ref, tier: 'small', amount: 2_000, until: Date.now() + 3_600_000, mode: 'server', op: `b-${ref}` })).toMatchObject({ ok: true });
  return kaipan.settle({ userId: u.user.id, game: 'kaipan', ref, amount, mode: 'server', op: `s-${ref}`, stats });
}

describe('游戏报的名场面', () => {
  it('204、写 2 行（在线类）；好友和本人看得到编号和数字，陌生人看不到', async () => {
    const [a, b] = await pair();
    const stranger = await newUser();
    expect((await moment(a, { game: 'guandan', moment: 'four_bombs', n: [4] })).status).toBe(204);
    expect(rowsWritten()).toBe(2);
    expect(rowsBy('live')).toBe(2);
    expect(await feedOf(b)).toEqual([
      expect.objectContaining({ user: expect.objectContaining({ userId: a.user.id }), game: 'guandan', kind: 'moment', data: { m: 'four_bombs', n: [4] }, reactions: {} }),
    ]);
    expect(await feedOf(a)).toHaveLength(1);
    expect(await feedOf(stranger)).toEqual([]);
  });

  it('格式不对 400、0 行：没登记的游戏、编号不合格、n 超过 3 个或不是整数', async () => {
    const a = await newUser();
    for (const body of [
      { game: 'nope', moment: 'x' },
      { game: 'guandan', moment: 'Bad' },
      { game: 'guandan', moment: '1x' },
      { game: 'guandan', moment: 'a'.repeat(25) },
      { game: 'guandan', moment: 'ok', n: [1, 2, 3, 4] },
      { game: 'guandan', moment: 'ok', n: [1.5] },
      { game: 'guandan', moment: 'ok', n: 3 },
    ]) {
      expect((await moment(a, body)).status, JSON.stringify(body)).toBe(400);
      expect(rowsWritten()).toBe(0);
    }
  });

  it('每人每天 10 条：第 11 条静默 204、0 行；北京时间第二天又能发', async () => {
    const a = await newUser();
    for (let i = 0; i < 10; i++) expect((await moment(a, { game: 'kaipan', moment: 'm' })).status).toBe(204);
    expect((await moment(a, { game: 'kaipan', moment: 'm' })).status).toBe(204);
    expect(rowsWritten()).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM feed')).toBe(10);
    advance(10 * 3_600_000); // 北京时间第二天 0:30
    expect((await moment(a, { game: 'kaipan', moment: 'm' })).status).toBe(204);
    expect(rowsWritten()).toBe(2);
  });

  it('"在线"类预算用完：静默 204、不写', async () => {
    await resetAll({ budget: { live: 1 } });
    const a = await newUser();
    await moment(a, { game: 'kaipan', moment: 'm' });
    await flushMeter();
    expect((await moment(a, { game: 'kaipan', moment: 'm' })).status).toBe(204);
    expect(rowsWritten()).toBe(0);
  });
});

describe('实盘结回自动生成', () => {
  it('净赢 ≥ 半份：生成一条，记档位、份数（乘 10）、第一次拿到的称号；钱包照常 1 行', async () => {
    const [a, b] = await pair();
    expect(await playOnce(a, 5_200, { rounds: 1, wins: 1, best: 3_200, titles: ['first_win'] })).toMatchObject({ ok: true, credited: 5_200 });
    expect(lastWalletStats.byCategory.wallet).toBe(1);
    expect(lastWalletStats.byCategory.live).toBe(2);
    expect(await feedOf(b)).toEqual([expect.objectContaining({ kind: 'settle', game: 'kaipan', data: { tier: 'small', units: 16, titles: ['first_win'] } })]);
  });

  it('门槛：小赢没新称号不发；小赢但第一次拿到称号发；输了拿到新称号也不发；同一个称号第二次不算', async () => {
    const [a, b] = await pair();
    await playOnce(a, 2_500); // 赢 0.25 份
    expect(await feedOf(b)).toEqual([]);
    await playOnce(a, 1_000, { rounds: 1, wins: 0, best: 0, titles: ['broke'] }); // 输了
    expect(await feedOf(b)).toEqual([]);
    await playOnce(a, 2_100, { rounds: 1, wins: 1, best: 100, titles: ['lucky'] });
    expect((await feedOf(b)).map((i) => i.data)).toEqual([{ tier: 'small', units: 0, titles: ['lucky'] }]);
    await playOnce(a, 2_100, { rounds: 1, wins: 1, best: 100, titles: ['lucky'] });
    expect(await feedOf(b)).toHaveLength(1);
  });

  it('不带小结、小结不合格、重复的 op 都不生成；结回照常', async () => {
    const [a, b] = await pair();
    const ref = 'ref-dup001';
    await kaipan.buyin({ userId: a.user.id, game: 'kaipan', ref, tier: 'small', amount: 2_000, until: Date.now() + 3_600_000, mode: 'server', op: 'b-dup001' });
    const req = { userId: a.user.id, game: 'kaipan', ref, amount: 6_000, mode: 'server', op: 's-dup001', stats: { rounds: 1, wins: 1, best: 0 } };
    await kaipan.settle(req);
    expect(await kaipan.settle(req)).toMatchObject({ ok: true, dup: true });
    expect(await feedOf(b)).toHaveLength(1);
    await playOnce(a, 6_000, null);
    await playOnce(a, 6_000, { rounds: -1 });
    expect(await feedOf(b)).toHaveLength(1);
  });

  it('关了"好友动态"：不生成，结回照常；打开以后新的照常', async () => {
    const [a, b] = await pair();
    expect((await call('/api/me', { method: 'PATCH', body: { showFeed: false }, cookie: a.cookie })).status).toBe(200);
    expect(await playOnce(a, 6_000)).toMatchObject({ ok: true, credited: 6_000 });
    expect(lastWalletStats.byCategory.live).toBe(0);
    expect(await feedOf(b)).toEqual([]);
  });

  it('"在线"类预算用完：不生成，结回照常', async () => {
    await resetAll({ budget: { live: 1 } });
    const [a, b] = await pair();
    await moment(a, { game: 'kaipan', moment: 'm' });
    await flushMeter();
    expect(await playOnce(a, 6_000)).toMatchObject({ ok: true, credited: 6_000 });
    expect(lastWalletStats.byCategory.live).toBe(0);
    expect(await feedOf(b)).toHaveLength(1);
  });
});

describe('开关', () => {
  it('关了以后已有的好友也看不到、名场面也不收；打开后恢复；本人的 user 里有 showFeed', async () => {
    const [a, b] = await pair();
    await moment(a, { game: 'kaipan', moment: 'm' });
    const off = await call('/api/me', { method: 'PATCH', body: { showFeed: false }, cookie: a.cookie });
    expect(((await off.json()) as { user: { showFeed: boolean } }).user.showFeed).toBe(false);
    expect(await feedOf(b)).toEqual([]);
    await moment(a, { game: 'kaipan', moment: 'm2' });
    expect(rowsWritten()).toBe(0);
    await call('/api/me', { method: 'PATCH', body: { showFeed: true }, cookie: a.cookie });
    expect(await feedOf(b)).toHaveLength(1);
    expect((await call('/api/me', { method: 'PATCH', body: { showFeed: 'no' }, cookie: a.cookie })).status).toBe(400);
  });
});

describe('赞和扔道具', () => {
  it('好友赞：204、2 行（计数 + 1）；再点不改、0 行；数和我的那个都给', async () => {
    const [a, b] = await pair();
    const c = await newUser();
    await befriend(a, c);
    await moment(a, { game: 'kaipan', moment: 'm' });
    const [item] = await feedOf(b);
    expect((await reactTo(b, item!.id, 'like')).status).toBe(204);
    expect(rowsWritten()).toBe(2);
    expect((await reactTo(b, item!.id, 'tomato')).status).toBe(204);
    expect(rowsWritten()).toBe(0);
    expect((await reactTo(c, item!.id, 'tomato')).status).toBe(204);
    expect((await feedOf(b))[0]).toMatchObject({ reactions: { like: 1, tomato: 1 }, mine: 'like' });
    expect((await feedOf(a))[0]).toMatchObject({ reactions: { like: 1, tomato: 1 } });
    expect((await feedOf(a))[0]!.mine).toBeUndefined();
  });

  it('自己的、陌生人、过期的、不存在的 404，kind 不对 400，都 0 行', async () => {
    const [a, b] = await pair();
    const stranger = await newUser();
    await moment(a, { game: 'kaipan', moment: 'm' });
    const [item] = await feedOf(b);
    expect((await reactTo(a, item!.id)).status).toBe(404);
    expect((await reactTo(stranger, item!.id)).status).toBe(404);
    expect((await reactTo(b, item!.id, 'kiss')).status).toBe(400);
    expect((await reactTo(b, '000000000AAAAAAAAAAA')).status).toBe(404);
    expect((await reactTo(b, 'bad')).status).toBe(404);
    expect(rowsWritten()).toBe(0);
    advance(7 * 86_400_000 + 1);
    expect((await reactTo(b, item!.id)).status).toBe(404);
    expect(await feedOf(b)).toEqual([]);
  });
});

describe('清理', () => {
  it('Cron 删 7 天前的动态和它们的赞，近的留着', async () => {
    const [a, b] = await pair();
    await moment(a, { game: 'kaipan', moment: 'old' });
    await reactTo(b, (await feedOf(b))[0]!.id);
    advance(7 * 86_400_000 + 1);
    await moment(a, { game: 'kaipan', moment: 'new' });
    await reactTo(b, (await feedOf(b))[0]!.id);
    await runCleanup(env, Date.now());
    expect(await count('SELECT COUNT(*) AS n FROM feed')).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM feed_reactions')).toBe(1);
  });

  it('注销：本人发的和本人赞的都删', async () => {
    const [a, b] = await pair();
    await moment(a, { game: 'kaipan', moment: 'm' });
    await moment(b, { game: 'kaipan', moment: 'm' });
    const items = await feedOf(a);
    await reactTo(a, items.find((i) => i.user.userId === b.user.id)!.id);
    expect((await call('/api/account/delete', { body: { currentPassword: a.password }, cookie: a.cookie })).status).toBe(204);
    expect(await count('SELECT COUNT(*) AS n FROM feed WHERE user_id = ?1', a.user.id)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM feed_reactions')).toBe(0);
  });
});
