/**
 * 异步挑战（0.18.0，docs/platform-backend.md 15.18）：发起（发起人的成绩记成第一条）、打开（原样回 payload、排名、我的名次）、
 * 交成绩只记第一次、每个挑战最多 100 人、每人每天发起 20 个、1 KB 上限、30 天过期、停增长档、注销和 Cron 清理。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { runCleanup } from '../worker/api/cron';
import { advance, call, count, env, errorOf, registerUser, resetAll, rowsBy, rowsWritten } from './helpers';

beforeEach(() => resetAll());

let ipSeq = 0;
const newUser = () => registerUser(undefined, undefined, `198.51.100.${++ipSeq % 250}`);
type U = Awaited<ReturnType<typeof newUser>>;
interface Opened {
  game: string;
  payload: unknown;
  owner: { userId: string; displayName: string };
  until: number;
  results: { rank: number; userId: string; score: number; stats: unknown; isMe: boolean }[];
  count: number;
  me: { rank: number; score: number; stats: unknown } | null;
}

const PAYLOAD = { seed: 'abc123', setup: { persona: 'rookie', months: 12 } };
const create = (u: U, body: Record<string, unknown> = {}) =>
  call('/api/challenges', { body: { game: 'kaipan', payload: PAYLOAD, score: 100, stats: { months: 12 }, ...body }, cookie: u.cookie });
async function createId(u: U, body: Record<string, unknown> = {}): Promise<string> {
  const res = await create(u, body);
  expect(res.status).toBe(200);
  return ((await res.json()) as { id: string }).id;
}
const open = async (u: U, id: string) => (await call(`/api/challenges/${id}`, { cookie: u.cookie })).json() as Promise<Opened>;
const submit = (u: U, id: string, score: number, stats?: unknown) => call(`/api/challenges/${id}/results`, { body: { score, stats }, cookie: u.cookie });

describe('发起和打开', () => {
  it('发起：回 id 和 30 天后的 until，写 4 行（排行榜类）；打开原样回 payload，发起人是第一条', async () => {
    const a = await newUser();
    const b = await newUser();
    const res = await create(a);
    expect(rowsWritten()).toBe(4);
    expect(rowsBy('board')).toBe(4);
    const { id, until } = (await res.json()) as { id: string; until: number };
    expect(until).toBe(Date.now() + 30 * 86_400_000);
    const o = await open(b, id);
    expect(rowsWritten()).toBe(0);
    expect(o).toMatchObject({ game: 'kaipan', payload: PAYLOAD, owner: { userId: a.user.id }, until, count: 1, me: null });
    expect(o.results).toEqual([{ rank: 1, userId: a.user.id, displayName: o.owner.displayName, score: 100, stats: { months: 12 }, isMe: false }]);
  });

  it('不是好友也能打开、交成绩（链接能转）；要登录、要 CSRF', async () => {
    const a = await newUser();
    const stranger = await newUser();
    const id = await createId(a);
    expect((await submit(stranger, id, 50)).status).toBe(200);
    expect((await call(`/api/challenges/${id}`)).status).toBe(401);
    expect((await call('/api/challenges', { body: { game: 'kaipan', payload: {}, score: 1 }, cookie: a.cookie, csrf: false })).status).toBe(403);
  });

  it('格式不对 400、太大 413，都 0 行', async () => {
    const a = await newUser();
    for (const body of [{ game: 'nope' }, { score: 1.5 }, { score: '1' }, { payload: undefined }]) {
      expect((await create(a, body)).status, JSON.stringify(body)).toBe(400);
      expect(rowsWritten()).toBe(0);
    }
    const big = 'x'.repeat(1100);
    const r1 = await create(a, { payload: { big } });
    expect(r1.status).toBe(413);
    expect(await errorOf(r1)).toBe('too_big');
    expect((await create(a, { stats: { big } })).status).toBe(413);
    // 中文按 UTF-8 字节算：350 个汉字 > 1 KB
    expect((await create(a, { payload: '汉'.repeat(350) })).status).toBe(413);
    expect(rowsWritten()).toBe(0);
  });

  it('不存在、id 格式不对、过期都 404', async () => {
    const a = await newUser();
    const id = await createId(a);
    expect((await call('/api/challenges/000000000AAAAAAAAAAA', { cookie: a.cookie })).status).toBe(404);
    expect((await call('/api/challenges/bad', { cookie: a.cookie })).status).toBe(404);
    advance(30 * 86_400_000);
    expect((await call(`/api/challenges/${id}`, { cookie: a.cookie })).status).toBe(404);
    expect((await submit(a, id, 1)).status).toBe(404);
  });

  it('每人每天发起 20 个：第 21 个 429、0 行', async () => {
    const a = await newUser();
    for (let i = 0; i < 20; i++) expect((await create(a)).status).toBe(200);
    const res = await create(a);
    expect(res.status).toBe(429);
    expect(rowsWritten()).toBe(0);
  });

  it('停增长档：发起、交成绩 503 busy、0 行，打开照常', async () => {
    const a = await newUser();
    const b = await newUser();
    const id = await createId(a);
    await resetAll.limits({ noGrowthDbBytes: 1 });
    const blocked = await create(a);
    expect([blocked.status, await errorOf(blocked)]).toEqual([503, 'busy']);
    expect((await submit(b, id, 1)).status).toBe(503);
    expect(rowsWritten()).toBe(0);
    expect((await call(`/api/challenges/${id}`, { cookie: b.cookie })).status).toBe(200);
  });
});

describe('交成绩', () => {
  it('交上了 ok（1 行）；再交回 already 和原来那条，不改（0 行）；排名分高的在前、同分先交的在前、同分同名次', async () => {
    const [a, b, c, d] = [await newUser(), await newUser(), await newUser(), await newUser()];
    const id = await createId(a, { score: 100 });
    expect(await (await submit(b, id, 300, { months: 12 })).json()).toEqual({ result: 'ok' });
    expect(rowsWritten()).toBe(1);
    expect(await (await submit(b, id, 999)).json()).toEqual({ result: 'already', mine: { score: 300, stats: { months: 12 } } });
    expect(rowsWritten()).toBe(0);
    expect(await (await submit(a, id, 999)).json()).toMatchObject({ result: 'already', mine: { score: 100 } });
    advance(1_000);
    await submit(c, id, 100);
    advance(1_000);
    await submit(d, id, 50);
    const o = await open(c, id);
    expect(o.results.map((r) => [r.rank, r.userId, r.score])).toEqual([
      [1, b.user.id, 300],
      [2, a.user.id, 100],
      [2, c.user.id, 100],
      [4, d.user.id, 50],
    ]);
    expect(o.count).toBe(4);
    expect(o.me).toEqual({ rank: 2, score: 100, stats: null });
  });

  it('每个挑战最多 100 人：满了 409 full、0 行；已经交过的照样回 already', async () => {
    await resetAll({ challengeMaxResults: 3 });
    const a = await newUser();
    const id = await createId(a);
    const [b, c, d] = [await newUser(), await newUser(), await newUser()];
    expect((await submit(b, id, 1)).status).toBe(200);
    expect((await submit(c, id, 1)).status).toBe(200);
    const full = await submit(d, id, 1);
    expect(full.status).toBe(409);
    expect(await errorOf(full)).toBe('full');
    expect(rowsWritten()).toBe(0);
    expect(await (await submit(b, id, 5)).json()).toMatchObject({ result: 'already' });
  });

  it('同时交也冲不破上限：数和插入在同一条语句里', async () => {
    await resetAll({ challengeMaxResults: 2 });
    const a = await newUser();
    const id = await createId(a);
    const others = [await newUser(), await newUser(), await newUser()];
    const rs = await Promise.all(others.map((u) => submit(u, id, 1)));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect(await count('SELECT COUNT(*) AS n FROM challenge_results WHERE challenge_id = ?1', id)).toBe(2);
  });

  it('前 50 名之外：results 只给 50 条，count 和 me 照给', async () => {
    const a = await newUser();
    const id = await createId(a, { score: 0 });
    const users = [];
    for (let i = 0; i < 52; i++) users.push(await newUser());
    for (const [i, u] of users.entries()) await submit(u, id, 100 + i);
    const o = await open(a, id);
    expect(o.results).toHaveLength(50);
    expect(o.count).toBe(53);
    expect(o.me).toMatchObject({ rank: 53, score: 0 });
  });
});

describe('清理', () => {
  it('Cron 删 30 天前的挑战和它们的结果，近的留着', async () => {
    const a = await newUser();
    const b = await newUser();
    const old = await createId(a);
    await submit(b, old, 1);
    advance(30 * 86_400_000 + 1);
    const fresh = await createId(a);
    await submit(b, fresh, 1);
    await runCleanup(env, Date.now());
    expect(await count('SELECT COUNT(*) AS n FROM challenges')).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM challenge_results')).toBe(2);
    expect(await count('SELECT COUNT(*) AS n FROM challenge_results WHERE challenge_id = ?1', fresh)).toBe(2);
  });

  it('注销：本人发起的连同结果、本人交的结果都删；别人的挑战留着', async () => {
    const a = await newUser();
    const b = await newUser();
    const mine = await createId(a);
    await submit(b, mine, 1);
    const theirs = await createId(b);
    await submit(a, theirs, 1);
    expect((await call('/api/account/delete', { body: { currentPassword: a.password }, cookie: a.cookie })).status).toBe(204);
    expect(await count('SELECT COUNT(*) AS n FROM challenges')).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM challenge_results')).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM challenge_results WHERE user_id = ?1', a.user.id)).toBe(0);
  });
});
