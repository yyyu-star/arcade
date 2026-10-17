/** 好友与屏蔽（5.6、15.4）：每个接口的写入行数、限额、屏蔽不让对方察觉、换好友码。 */
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { daysAgo } from '../worker/api/friends';
import { handleApi } from '../worker/api/router';
import { call, count, env, errorOf, FIXED_NOW, ORIGIN, registerUser, resetAll, rowsBy, rowsWritten } from './helpers';

beforeEach(() => resetAll());

let ipSeq = 0;
/** 每个用户换个 IP 注册：同一个 IP 每分钟只有 10 个匿名令牌。 */
const newUser = () => registerUser(undefined, undefined, `192.0.2.${++ipSeq % 250}`);
type U = Awaited<ReturnType<typeof newUser>>;

interface Profile {
  userId: string;
  displayName: string;
  avatar: unknown;
  lastSeenDaysAgo?: number;
}
interface Lists {
  friends: Profile[];
  incoming: Profile[];
  outgoing: Profile[];
}

const lists = async (u: U) => (await (await call('/api/friends', { cookie: u.cookie })).json()) as Lists;
const ids = (ps: Profile[]) => ps.map((p) => p.userId);
const request = (from: U, to: U | string) =>
  call('/api/friends/requests', { body: { friendCode: typeof to === 'string' ? to : to.user.friendCode }, cookie: from.cookie });
const lookup = (u: U, code: string) => call(`/api/friends/code/${code}`, { cookie: u.cookie });

async function befriend(a: U, b: U): Promise<void> {
  expect((await request(a, b)).status).toBe(200);
  expect((await call(`/api/friends/${a.user.id}/accept`, { body: {}, cookie: b.cookie })).status).toBe(200);
}

describe('查好友码', () => {
  it('找到：公开资料（没有用户名）+ 关系；每次计 fcode 1 行', async () => {
    const [a, b] = [await newUser(), await newUser()];
    const res = await lookup(a, b.user.friendCode);
    expect(res.status).toBe(200);
    expect(rowsWritten()).toBe(1);
    expect(rowsBy('social')).toBe(1);
    const body = (await res.json()) as { user: Profile; relation: string };
    expect(Object.keys(body.user).sort()).toEqual(['avatar', 'displayName', 'userId']);
    expect(body).toMatchObject({ user: { userId: b.user.id }, relation: 'none' });
    expect(await (await lookup(a, a.user.friendCode)).json()).toMatchObject({ relation: 'self' });
  });

  it('不分大小写，O 当 0、I 和 L 当 1，横线空格可有可无', async () => {
    const [a, b] = [await newUser(), await newUser()];
    const messy = b.user.friendCode.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l');
    expect((await lookup(a, `${messy.slice(0, 4)}-${messy.slice(4)}`)).status).toBe(200);
  });

  it('没找到 404 也计数（1 行，防枚举）；格式不对 404、0 行', async () => {
    const a = await newUser();
    const miss = await lookup(a, 'ZZZZZZZZ');
    expect(miss.status).toBe(404);
    expect(rowsWritten()).toBe(1);
    expect((await lookup(a, 'UUUUUUUU')).status).toBe(404); // U 不在 Crockford 字母表里
    expect(rowsWritten()).toBe(0);
  });

  it('每天上限：超了 429、0 行', async () => {
    await resetAll.limits({ friendCodeLookupsPerDay: 2 });
    const [a, b] = [await newUser(), await newUser()];
    await lookup(a, b.user.friendCode);
    await lookup(a, b.user.friendCode);
    const over = await lookup(a, b.user.friendCode);
    expect(over.status).toBe(429);
    expect(rowsWritten()).toBe(0);
  });

  it('只读档：计不了数就不给查（503、0 行）；好友列表照常能看', async () => {
    const [a, b] = [await newUser(), await newUser()];
    const direct = async (path: string) => {
      const ctx = createExecutionContext();
      const res = await handleApi(
        new Request(`${ORIGIN}${path}`, { headers: { cookie: `__Host-sid=${a.cookie}` } }),
        { ...env, API_MODE: 'readonly' },
        ctx,
      );
      await waitOnExecutionContext(ctx);
      return res;
    };
    expect((await direct(`/api/friends/code/${b.user.friendCode}`)).status).toBe(503);
    expect(rowsWritten()).toBe(0);
    expect((await direct('/api/friends')).status).toBe(200);
  });

  it('没登录 401', async () => {
    expect((await call('/api/friends/code/ABCDEFGH')).status).toBe(401);
    expect((await call('/api/friends')).status).toBe(401);
  });
});

describe('发请求、接受、拒绝、撤回、删好友', () => {
  it('新请求 3 行；重复发 0 行；接受 1 行；双方都在好友列表里，"今天来过"', async () => {
    const [a, b] = [await newUser(), await newUser()];
    const res = await request(a, b);
    expect(await res.json()).toEqual({ status: 'pending' });
    expect(rowsWritten()).toBe(3); // friendships 表 + user_b 索引 + freq 1
    expect(rowsBy('social')).toBe(3);
    expect(await (await request(a, b)).json()).toEqual({ status: 'pending' });
    expect(rowsWritten()).toBe(0);
    expect(ids((await lists(a)).outgoing)).toEqual([b.user.id]);
    const inc = (await lists(b)).incoming;
    // 请求不带时间（审阅 2026-10-14）
    expect(inc).toEqual([{ userId: a.user.id, displayName: expect.any(String), avatar: null }]);

    const acc = await call(`/api/friends/${a.user.id}/accept`, { body: {}, cookie: b.cookie });
    expect(await acc.json()).toEqual({ status: 'friends' });
    expect(rowsWritten()).toBe(1);
    for (const [me, other] of [[a, b], [b, a]] as const) {
      const l = await lists(me);
      expect(l.friends).toEqual([{ userId: other.user.id, displayName: expect.any(String), avatar: null, lastSeenDaysAgo: 0, online: false }]);
      expect(l.incoming).toEqual([]);
      expect(l.outgoing).toEqual([]);
    }
    expect(await (await request(a, b)).json()).toEqual({ status: 'friends' });
    expect(rowsWritten()).toBe(0);
    expect(await (await lookup(a, b.user.friendCode)).json()).toMatchObject({ relation: 'friends' });
  });

  it('对方已经向我发过：直接成为好友，2 行', async () => {
    const [a, b] = [await newUser(), await newUser()];
    await request(a, b);
    expect(await (await lookup(b, a.user.friendCode)).json()).toMatchObject({ relation: 'pending_in' });
    expect(await (await lookup(a, b.user.friendCode)).json()).toMatchObject({ relation: 'pending_out' });
    const res = await request(b, a);
    expect(await res.json()).toEqual({ status: 'friends' });
    expect(rowsWritten()).toBe(2); // 改状态 1 + freq 1
    expect(ids((await lists(a)).friends)).toEqual([b.user.id]);
  });

  it('两人同时互发：最后都成为好友，不会两边都停在"已发送"', async () => {
    const pairs: [U, U][] = [];
    for (let i = 0; i < 6; i++) pairs.push([await newUser(), await newUser()]);
    const results = await Promise.all(pairs.flatMap(([a, b]) => [request(a, b), request(b, a)]));
    expect(results.every((r) => r.status === 200)).toBe(true);
    for (const [a, b] of pairs) {
      expect(ids((await lists(a)).friends)).toEqual([b.user.id]);
      expect(ids((await lists(b)).friends)).toEqual([a.user.id]);
    }
    expect(await count("SELECT COUNT(*) AS n FROM friendships WHERE status = 'pending'")).toBe(0);
  });

  it('同时互发但好友数满了：422 limit_reached，请求留着', async () => {
    await resetAll.limits({ friendsMax: 1 });
    const [a, b, c] = [await newUser(), await newUser(), await newUser()];
    await befriend(a, c);
    const res = await Promise.all([request(a, b), request(b, a)]);
    expect(res.map((r) => r.status).sort()).toEqual([200, 422]);
    expect(await count("SELECT COUNT(*) AS n FROM friendships WHERE status = 'pending'")).toBe(1);
  });

  it('加自己 422 invalid_target；好友码不存在 404；都不写', async () => {
    const a = await newUser();
    expect(await errorOf(await request(a, a))).toBe('invalid_target');
    expect(rowsWritten()).toBe(0);
    expect((await request(a, 'ZZZZZZZZ')).status).toBe(404);
    expect((await request(a, 'bad')).status).toBe(404);
    expect(rowsWritten()).toBe(0);
  });

  it('拒绝 1 行；撤回 1 行；收到的请求不能用"撤回"删（404）', async () => {
    const [a, b, c] = [await newUser(), await newUser(), await newUser()];
    await request(a, b);
    expect((await call(`/api/friends/${a.user.id}`, { method: 'DELETE', cookie: b.cookie })).status).toBe(404);
    expect(rowsWritten()).toBe(0);
    expect((await call(`/api/friends/${a.user.id}/decline`, { body: {}, cookie: b.cookie })).status).toBe(204);
    expect(rowsWritten()).toBe(1);
    expect((await call(`/api/friends/${a.user.id}/decline`, { body: {}, cookie: b.cookie })).status).toBe(404);
    expect(rowsWritten()).toBe(0);
    await request(a, c);
    expect((await call(`/api/friends/${c.user.id}`, { method: 'DELETE', cookie: a.cookie })).status).toBe(204);
    expect(rowsWritten()).toBe(1);
    expect((await lists(c)).incoming).toEqual([]);
  });

  it('删好友 1 行，两边都没了；接受不存在的请求 404', async () => {
    const [a, b] = [await newUser(), await newUser()];
    await befriend(a, b);
    expect((await call(`/api/friends/${a.user.id}`, { method: 'DELETE', cookie: b.cookie })).status).toBe(204);
    expect(rowsWritten()).toBe(1);
    expect((await lists(a)).friends).toEqual([]);
    expect((await call(`/api/friends/${b.user.id}/accept`, { body: {}, cookie: a.cookie })).status).toBe(404);
    // 自己发出的请求不能自己接受
    await request(a, b);
    expect((await call(`/api/friends/${b.user.id}/accept`, { body: {}, cookie: a.cookie })).status).toBe(404);
    expect((await call('/api/friends/short/accept', { body: {}, cookie: a.cookie })).status).toBe(404);
  });

  it('第三方不能接受或拒绝别人之间的请求', async () => {
    const [a, b, c] = [await newUser(), await newUser(), await newUser()];
    await request(a, b);
    expect((await call(`/api/friends/${a.user.id}/accept`, { body: {}, cookie: c.cookie })).status).toBe(404);
    expect((await call(`/api/friends/${a.user.id}/decline`, { body: {}, cookie: c.cookie })).status).toBe(404);
    expect((await call(`/api/friends/${a.user.id}`, { method: 'DELETE', cookie: c.cookie })).status).toBe(404);
    expect(rowsWritten()).toBe(0);
    expect(ids((await lists(b)).incoming)).toEqual([a.user.id]);
  });

  it('坏的百分号编码：404，不是 500', async () => {
    const a = await newUser();
    const res = await call('/api/friends/code/%E0', { cookie: a.cookie });
    expect(res.status).toBe(404);
    expect(await errorOf(res)).toBe('not_found');
  });

  it('用发请求猜码：找不到也计一次查码，和查码共用每天的上限', async () => {
    await resetAll.limits({ friendCodeLookupsPerDay: 2 });
    const [a, b] = [await newUser(), await newUser()];
    const miss = await request(a, 'ZZZZZZZZ');
    expect(miss.status).toBe(404);
    expect(rowsWritten()).toBe(1);
    await lookup(a, b.user.friendCode);
    expect((await request(a, 'YYYYYYYY')).status).toBe(429);
    expect((await lookup(a, b.user.friendCode)).status).toBe(429);
    expect(rowsWritten()).toBe(0);
  });

  it('写请求要 X-Arcade 和 Origin', async () => {
    const [a, b] = [await newUser(), await newUser()];
    expect((await call('/api/friends/requests', { body: { friendCode: b.user.friendCode }, cookie: a.cookie, csrf: false })).status).toBe(403);
    expect((await call(`/api/friends/${b.user.id}`, { method: 'DELETE', cookie: a.cookie, csrf: false })).status).toBe(403);
  });

  it('"N 天前来过"按北京时间算天', async () => {
    const [a, b] = [await newUser(), await newUser()];
    await befriend(a, b);
    await env.DB.prepare('UPDATE users SET last_seen_at = ?1 WHERE id = ?2').bind(FIXED_NOW - 3 * 86_400_000, b.user.id).run();
    expect((await lists(a)).friends[0]!.lastSeenDaysAgo).toBe(3);
    // FIXED_NOW 是北京时间 14:30；前一天 UTC 16:30 是北京今天 00:30，UTC 15:59 是北京昨天 23:59
    expect(daysAgo(Date.UTC(2026, 9, 13, 16, 30), FIXED_NOW)).toBe(0);
    expect(daysAgo(Date.UTC(2026, 9, 13, 15, 59), FIXED_NOW)).toBe(1);
    expect(daysAgo(FIXED_NOW + 60_000, FIXED_NOW)).toBe(0);
  });
});

describe('限额', () => {
  it('每天 30 个请求（撤回不退还）：超了 429、0 行', async () => {
    await resetAll.limits({ friendRequestsPerDay: 2 });
    const [a, b, c, d] = [await newUser(), await newUser(), await newUser(), await newUser()];
    await request(a, b);
    await call(`/api/friends/${b.user.id}`, { method: 'DELETE', cookie: a.cookie });
    await request(a, c);
    const over = await request(a, d);
    expect(over.status).toBe(429);
    expect(rowsWritten()).toBe(0);
    // 重复发给已有请求的人不计数，也不被上限挡
    expect(await (await request(a, c)).json()).toEqual({ status: 'pending' });
  });

  it('待处理请求：我发出的、对方收到的各 ≤ 20，满了 422 limit_reached、0 行', async () => {
    await resetAll.limits({ friendPendingMax: 1 });
    const [a, b, c, d] = [await newUser(), await newUser(), await newUser(), await newUser()];
    await request(a, b);
    const mineFull = await request(a, c);
    expect(await errorOf(mineFull)).toBe('limit_reached');
    expect(rowsWritten()).toBe(0);
    const theirsFull = await request(d, b);
    expect(await errorOf(theirsFull)).toBe('limit_reached');
  });

  it('并发发请求冲不破每天的上限', async () => {
    await resetAll.limits({ friendRequestsPerDay: 3, friendPendingMax: 100 });
    const a = await newUser();
    const targets = [];
    for (let i = 0; i < 8; i++) targets.push(await newUser());
    const res = await Promise.all(targets.map((t) => request(a, t)));
    expect(res.filter((r) => r.status === 200).length).toBe(3);
    expect(await count('SELECT COUNT(*) AS n FROM friendships WHERE requested_by = ?1', a.user.id)).toBe(3);
  });

  it('并发发请求冲不破待处理的上限', async () => {
    await resetAll.limits({ friendRequestsPerDay: 100, friendPendingMax: 2 });
    const a = await newUser();
    const targets = [];
    for (let i = 0; i < 8; i++) targets.push(await newUser());
    const res = await Promise.all(targets.map((t) => request(a, t)));
    expect(res.every((r) => r.status === 200 || r.status === 422)).toBe(true);
    expect(await count('SELECT COUNT(*) AS n FROM friendships WHERE requested_by = ?1', a.user.id)).toBe(2);
  });

  it('并发接受冲不破好友上限', async () => {
    await resetAll.limits({ friendsMax: 2 });
    const a = await newUser();
    const others = [];
    for (let i = 0; i < 6; i++) {
      const o = await newUser();
      await request(o, a);
      others.push(o);
    }
    await Promise.all(others.map((o) => call(`/api/friends/${o.user.id}/accept`, { body: {}, cookie: a.cookie })));
    expect(await count("SELECT COUNT(*) AS n FROM friendships WHERE (user_a = ?1 OR user_b = ?1) AND status = 'accepted'", a.user.id)).toBe(2);
  });

  it('被屏蔽的人发来的（看不见的）请求不占对方"收到的请求"名额', async () => {
    await resetAll.limits({ friendPendingMax: 1 });
    const [a, b, c] = [await newUser(), await newUser(), await newUser()];
    await call('/api/blocks', { body: { userId: b.user.id }, cookie: a.cookie });
    expect(await (await request(b, a)).json()).toEqual({ status: 'pending' });
    expect(await (await request(c, a)).json()).toEqual({ status: 'pending' });
    expect(ids((await lists(a)).incoming)).toEqual([c.user.id]);
  });

  it('好友 ≤ 200：接受、互发成好友时任何一方满了都 422', async () => {
    await resetAll.limits({ friendsMax: 1 });
    const [a, b, c] = [await newUser(), await newUser(), await newUser()];
    await befriend(a, b);
    await request(c, a);
    const acc = await call(`/api/friends/${c.user.id}/accept`, { body: {}, cookie: a.cookie });
    expect(await errorOf(acc)).toBe('limit_reached');
    expect(rowsWritten()).toBe(0);
    expect(await errorOf(await request(a, c))).toBe('limit_reached');
  });
});

describe('屏蔽', () => {
  it('屏蔽好友：3 行（计数 1 + blocks 1 + 删关系 1）；再屏蔽 0 行、不计数；列表里能看到，没有用户名', async () => {
    const [a, b] = [await newUser(), await newUser()];
    await befriend(a, b);
    const res = await call('/api/blocks', { body: { userId: b.user.id }, cookie: a.cookie });
    expect(res.status).toBe(204);
    expect(rowsWritten()).toBe(3);
    expect(rowsBy('social')).toBe(3);
    expect((await lists(a)).friends).toEqual([]);
    expect((await lists(b)).friends).toEqual([]);
    expect((await call('/api/blocks', { body: { userId: b.user.id }, cookie: a.cookie })).status).toBe(204);
    expect(rowsWritten()).toBe(0);
    const { blocks } = (await (await call('/api/blocks', { cookie: a.cookie })).json()) as { blocks: Profile[] };
    expect(blocks).toEqual([{ userId: b.user.id, displayName: expect.any(String), avatar: null }]);
  });

  it('没有关系时屏蔽 2 行（计数 1 + blocks 1）', async () => {
    const [a, b] = [await newUser(), await newUser()];
    expect((await call('/api/blocks', { body: { userId: b.user.id }, cookie: a.cookie })).status).toBe(204);
    expect(rowsWritten()).toBe(2);
  });

  it('屏蔽时删掉对方发来的待处理请求', async () => {
    const [a, b] = [await newUser(), await newUser()];
    await request(b, a);
    expect(ids((await lists(a)).incoming)).toEqual([b.user.id]);
    expect((await call('/api/blocks', { body: { userId: b.user.id }, cookie: a.cookie })).status).toBe(204);
    expect(await count('SELECT COUNT(*) AS n FROM friendships WHERE requested_by = ?1', b.user.id)).toBe(0);
  });

  it('屏蔽、解除屏蔽每天合计有上限：超了 429、0 行；"屏蔽→解除"刷不动', async () => {
    await resetAll.limits({ friendBlocksPerDay: 3 });
    const [a, b] = [await newUser(), await newUser()];
    expect((await call('/api/blocks', { body: { userId: b.user.id }, cookie: a.cookie })).status).toBe(204);
    expect((await call(`/api/blocks/${b.user.id}`, { method: 'DELETE', cookie: a.cookie })).status).toBe(204);
    expect((await call('/api/blocks', { body: { userId: b.user.id }, cookie: a.cookie })).status).toBe(204);
    const over = await call(`/api/blocks/${b.user.id}`, { method: 'DELETE', cookie: a.cookie });
    expect(over.status).toBe(429);
    expect(rowsWritten()).toBe(0);
    // 已经屏蔽着：再屏蔽只读查，不计数也不被上限挡
    expect((await call('/api/blocks', { body: { userId: b.user.id }, cookie: a.cookie })).status).toBe(204);
    expect(rowsWritten()).toBe(0);
  });

  it('被屏蔽的人看不出来：照常发请求（pending、3 行），自己那边显示"已发送"；屏蔽方看不到、也接受不了', async () => {
    const [a, b] = [await newUser(), await newUser()];
    await call('/api/blocks', { body: { userId: b.user.id }, cookie: a.cookie });
    const res = await request(b, a);
    expect(await res.json()).toEqual({ status: 'pending' });
    expect(rowsWritten()).toBe(3);
    expect(ids((await lists(b)).outgoing)).toEqual([a.user.id]);
    expect(await (await lookup(b, a.user.friendCode)).json()).toMatchObject({ relation: 'pending_out' });
    expect((await lists(a)).incoming).toEqual([]);
    expect((await call(`/api/friends/${b.user.id}/accept`, { body: {}, cookie: a.cookie })).status).toBe(404);
    // 屏蔽方查对方的码：知道是自己屏蔽的
    const seen = (await (await lookup(a, b.user.friendCode)).json()) as { relation: string; blocked?: boolean };
    expect(seen).toMatchObject({ relation: 'none', blocked: true });
    // 屏蔽方要加对方：先解除屏蔽
    expect(await errorOf(await request(a, b))).toBe('unblock_first');
    // 解除屏蔽 2 行（计数 1 + 删 1），之后对方的请求重新出现
    expect((await call(`/api/blocks/${b.user.id}`, { method: 'DELETE', cookie: a.cookie })).status).toBe(204);
    expect(rowsWritten()).toBe(2);
    expect(ids((await lists(a)).incoming)).toEqual([b.user.id]);
    expect((await call(`/api/blocks/${b.user.id}`, { method: 'DELETE', cookie: a.cookie })).status).toBe(404);
    expect(rowsWritten()).toBe(0);
  });

  it('屏蔽自己 422；没有这个人、id 格式不对 404；都不写', async () => {
    const a = await newUser();
    expect(await errorOf(await call('/api/blocks', { body: { userId: a.user.id }, cookie: a.cookie }))).toBe('invalid_target');
    expect((await call('/api/blocks', { body: { userId: 'A'.repeat(22) }, cookie: a.cookie })).status).toBe(404);
    expect((await call('/api/blocks', { body: { userId: 'nope' }, cookie: a.cookie })).status).toBe(404);
    expect((await call('/api/blocks', { body: {}, cookie: a.cookie })).status).toBe(400);
    expect(rowsWritten()).toBe(0);
  });
});

describe('换好友码', () => {
  it('3 行；旧码立刻失效；/api/me 是新码；每天 3 次', async () => {
    const [a, b] = [await newUser(), await newUser()];
    const res = await call('/api/me/friend-code', { body: {}, cookie: a.cookie });
    expect(res.status).toBe(200);
    expect(rowsWritten()).toBe(3); // users 表 + friend_code 唯一索引 + fcnew 1
    const { friendCode } = (await res.json()) as { friendCode: string };
    expect(friendCode).toMatch(/^[0-9A-HJKMNP-TV-Z]{8}$/);
    expect(friendCode).not.toBe(a.user.friendCode);
    expect((await lookup(b, a.user.friendCode)).status).toBe(404);
    expect(await (await lookup(b, friendCode)).json()).toMatchObject({ user: { userId: a.user.id } });
    expect(await (await call('/api/me', { cookie: a.cookie })).json()).toMatchObject({ user: { friendCode } });
    await call('/api/me/friend-code', { body: {}, cookie: a.cookie });
    await call('/api/me/friend-code', { body: {}, cookie: a.cookie });
    const over = await call('/api/me/friend-code', { body: {}, cookie: a.cookie });
    expect(over.status).toBe(429);
    expect(rowsWritten()).toBe(0);
  });

  it('并发换码冲不破每天 3 次', async () => {
    const a = await newUser();
    const res = await Promise.all(Array.from({ length: 8 }, () => call('/api/me/friend-code', { body: {}, cookie: a.cookie })));
    expect(res.filter((r) => r.status === 200).length).toBe(3);
  });
});

describe('注销删干净', () => {
  it('好友、请求、屏蔽（两个方向）和好友相关计数都删掉', async () => {
    const [a, b, c] = [await newUser(), await newUser(), await newUser()];
    await befriend(a, b);
    await request(a, c);
    await call('/api/blocks', { body: { userId: a.user.id }, cookie: c.cookie });
    await lookup(a, b.user.friendCode);
    await call('/api/me/friend-code', { body: {}, cookie: a.cookie });
    expect((await call('/api/account/delete', { body: { currentPassword: a.password }, cookie: a.cookie })).status).toBe(204);
    const id = a.user.id;
    expect(await count('SELECT COUNT(*) AS n FROM friendships WHERE user_a = ?1 OR user_b = ?1', id)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM blocks WHERE blocker = ?1 OR blocked = ?1', id)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM rate_counters WHERE key LIKE ?1', `%${id}`)).toBe(0);
    expect((await lists(b)).friends).toEqual([]);
  });
});

describe('按用户 id 发请求（0.10.5，战绩页上的"加好友"）', () => {
  it('和按好友码一样：先待处理，对方也按 id 发就成了好友；id 不对 404、加自己 422；不计查码次数', async () => {
    const [a, b] = [await newUser(), await newUser()];
    const byId = (from: U, userId: string) => call('/api/friends/requests', { body: { userId }, cookie: from.cookie });
    expect(await (await byId(a, b.user.id)).json()).toEqual({ status: 'pending' });
    expect(ids((await lists(b)).incoming)).toEqual([a.user.id]);
    expect(await (await byId(b, a.user.id)).json()).toEqual({ status: 'friends' });
    expect((await byId(a, 'nobody')).status).toBe(404);
    expect((await byId(a, 'A'.repeat(22))).status).toBe(404);
    expect((await byId(a, a.user.id)).status).toBe(422);
    expect(await count("SELECT COUNT(*) AS n FROM rate_counters WHERE key LIKE 'fcode:%'")).toBe(0);
  });
});
