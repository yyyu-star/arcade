/** 云存档（5.5、15.3）：版本冲突、10 秒间隔、大小与空间上限、每天上限、并发，以及每个接口写几行（7.2）。 */
import { beforeEach, describe, expect, it } from 'vitest';
import { call, count, env, errorOf, registerUser, resetAll, rowsBy, rowsRead, rowsWritten } from './helpers';

beforeEach(() => resetAll());

type U = Awaited<ReturnType<typeof registerUser>>;

const put = (u: U, slot: string, baseRev: number, data: unknown, game = 'kaipan') =>
  call(`/api/saves/${game}/${slot}`, { method: 'PUT', body: { baseRev, data }, cookie: u.cookie });
const get = (u: U, game = 'kaipan') => call(`/api/saves/${game}`, { cookie: u.cookie });

/** 把这个人的存档都挪到 10 秒以前，下一次写入不算"太勤"。 */
const age = (u: U) => env.DB.prepare('UPDATE saves SET updated_at = updated_at - 60000 WHERE user_id = ?1').bind(u.user.id).run();

interface SaveOut {
  slot: string;
  rev: number;
  updatedAt: number;
  data: unknown;
}

describe('读写', () => {
  it('新建、读回、覆盖：rev 从 1 开始每次加 1；成功写 2 行（存档类），读 0 行', async () => {
    const u = await registerUser();
    const empty = await get(u);
    expect(empty.status).toBe(200);
    expect(empty.headers.get('cache-control')).toBe('no-store');
    expect(await empty.json()).toEqual({ saves: [] });
    expect(rowsWritten()).toBe(0);

    const data = { coins: 12, seen: ['tutorial', '群聊'], nested: { a: [1, 2, { b: null }] }, note: '韭菜 "引号"' };
    const first = await put(u, 'profile', 0, data);
    expect(first.status).toBe(200);
    const r1 = (await first.json()) as { rev: number; updatedAt: number };
    expect(r1.rev).toBe(1);
    expect(rowsWritten()).toBe(2);
    expect(rowsBy('save')).toBe(2);

    await age(u);
    const second = await put(u, 'profile', 1, { ...data, coins: 13 });
    expect(await second.json()).toMatchObject({ rev: 2 });
    expect(rowsWritten()).toBe(2);

    const back = (await (await get(u)).json()) as { saves: SaveOut[] };
    expect(back.saves).toHaveLength(1);
    expect(back.saves[0]).toMatchObject({ slot: 'profile', rev: 2, data: { ...data, coins: 13 } });
    expect(rowsWritten()).toBe(0);
  });

  it('只返回自己、这个游戏的槽，按槽名排序', async () => {
    const u = await registerUser();
    const v = await registerUser();
    await put(u, 'records', 0, [1]);
    await put(u, 'profile', 0, 'p');
    await put(u, 'stats', 0, { w: 1 }, 'guandan');
    await put(v, 'profile', 0, 'someone-else');
    const mine = (await (await get(u)).json()) as { saves: SaveOut[] };
    expect(mine.saves.map((s) => [s.slot, s.data])).toEqual([
      ['profile', 'p'],
      ['records', [1]],
    ]);
    const gd = (await (await get(u, 'guandan')).json()) as { saves: SaveOut[] };
    expect(gd.saves.map((s) => s.slot)).toEqual(['stats']);
  });

  it('data 可以是任意 JSON（含 null、数字）；缺 data 或 baseRev 不对：400、0 行', async () => {
    const u = await registerUser();
    expect((await put(u, 'a', 0, null)).status).toBe(200);
    expect((await put(u, 'b', 0, 7)).status).toBe(200);
    for (const body of [{ data: 1 }, { baseRev: 0 }, { baseRev: -1, data: 1 }, { baseRev: 1.5, data: 1 }, { baseRev: '0', data: 1 }]) {
      const res = await call('/api/saves/kaipan/c', { method: 'PUT', body, cookie: u.cookie });
      expect(res.status).toBe(400);
      expect(rowsWritten()).toBe(0);
    }
  });
});

describe('冲突与间隔', () => {
  it('baseRev 不是云端当前版本：409 带回云端版本，只写计数 1 行；合并后用 current.rev 重交成功', async () => {
    const u = await registerUser();
    await put(u, 'profile', 0, { v: 1 });
    await age(u);
    await put(u, 'profile', 1, { v: 2 });
    await age(u);
    const stale = await put(u, 'profile', 1, { v: 'old' });
    expect(stale.status).toBe(409);
    const body = (await stale.json()) as { error: string; current: { rev: number; data: unknown } };
    expect(body.error).toBe('conflict');
    expect(body.current).toMatchObject({ rev: 2, data: { v: 2 } });
    expect(rowsWritten()).toBe(1);
    expect(rowsBy('save')).toBe(1);
    expect((await put(u, 'profile', body.current.rev, { v: 'merged' })).status).toBe(200);
  });

  it('baseRev 0 但云端已有：409；云端没有却带了 baseRev：409、current 为 null', async () => {
    const u = await registerUser();
    await put(u, 'profile', 0, { v: 1 });
    await age(u);
    const dup = await put(u, 'profile', 0, { v: 'new' });
    expect(dup.status).toBe(409);
    expect(await dup.json()).toMatchObject({ current: { rev: 1, data: { v: 1 } } });
    expect(rowsWritten()).toBe(1);
    const ghost = await put(u, 'records', 3, []);
    expect(ghost.status).toBe(409);
    expect(await ghost.json()).toMatchObject({ error: 'conflict', current: null });
  });

  it('同一个槽 10 秒内再写：429 too_soon，带 retryAfter，只写计数 1 行；别的槽不受影响', async () => {
    const u = await registerUser();
    await put(u, 'profile', 0, 1);
    const again = await put(u, 'profile', 1, 2);
    expect(again.status).toBe(429);
    const body = (await again.json()) as { error: string; retryAfter: number };
    expect(body.error).toBe('too_soon');
    expect(body.retryAfter).toBe(10);
    expect(again.headers.get('retry-after')).toBe(String(body.retryAfter));
    expect(rowsWritten()).toBe(1);
    expect((await put(u, 'records', 0, 1)).status).toBe(200);
  });

  it('并发 10 个新建同一个槽：只有 1 个成功，其余 409', async () => {
    const u = await registerUser();
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => put(u, 'profile', 0, { i })));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(9);
    expect(await count('SELECT rev AS n FROM saves WHERE user_id = ?1', u.user.id)).toBe(1);
  });

  it('并发 10 个用同一个 baseRev 覆盖：只有 1 个成功', async () => {
    const u = await registerUser();
    await put(u, 'profile', 0, 0);
    await age(u);
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => put(u, 'profile', 1, { i })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await count('SELECT rev AS n FROM saves WHERE user_id = ?1', u.user.id)).toBe(2);
  });
});

describe('大小与空间', () => {
  it('data 按 UTF-8 字节算，≤ 48 KB 收；超了 413 too_large、0 行', async () => {
    const u = await registerUser();
    // JSON 字符串带两个引号：正好 48 KB
    expect((await put(u, 'a', 0, 'x'.repeat(48 * 1024 - 2))).status).toBe(200);
    const over = await put(u, 'b', 0, 'x'.repeat(48 * 1024 - 1));
    expect(over.status).toBe(413);
    expect(await errorOf(over)).toBe('too_large');
    expect(rowsWritten()).toBe(0);
    // 17,000 个汉字是 51,000 字节：请求体没超 52 KB，但 data 超了 48 KB
    const cjk = await put(u, 'c', 0, '中'.repeat(17_000));
    expect(await errorOf(cjk)).toBe('too_large');
    expect(rowsWritten()).toBe(0);
  });

  it('请求体超过 52 KB：413，不读完、0 行；别的接口还是 8 KB', async () => {
    const u = await registerUser();
    const res = await call('/api/saves/kaipan/a', { method: 'PUT', rawBody: JSON.stringify({ baseRev: 0, data: 'x'.repeat(53 * 1024) }), cookie: u.cookie });
    expect(res.status).toBe(413);
    expect(rowsWritten()).toBe(0);
    const me = await call('/api/me', { method: 'PATCH', rawBody: JSON.stringify({ displayName: 'x'.repeat(9 * 1024) }), cookie: u.cookie });
    expect(me.status).toBe(413);
  });

  it('每个游戏最多 8 个槽：第 9 个 413 quota_exceeded（写计数 1 行）；已有的槽照常覆盖，别的游戏不受影响', async () => {
    const u = await registerUser();
    for (let i = 0; i < 8; i++) expect((await put(u, `s${i}`, 0, i)).status).toBe(200);
    const ninth = await put(u, 's8', 0, 8);
    expect(ninth.status).toBe(413);
    expect(await errorOf(ninth)).toBe('quota_exceeded');
    expect(rowsWritten()).toBe(1);
    await age(u);
    expect((await put(u, 's0', 1, 'again')).status).toBe(200);
    expect((await put(u, 's0', 0, 1, 'guandan')).status).toBe(200);
  });

  it('每人合计上限：新建和覆盖都按"换掉这个槽以后的合计"算', async () => {
    await resetAll({ saveUserBytes: 1_000 });
    const u = await registerUser();
    expect((await put(u, 'a', 0, 'x'.repeat(598))).status).toBe(200); // 600 字节
    expect(await errorOf(await put(u, 'b', 0, 'x'.repeat(498)))).toBe('quota_exceeded'); // 600 + 500
    expect(rowsWritten()).toBe(1);
    await age(u);
    expect((await put(u, 'a', 1, 'x'.repeat(898))).status).toBe(200); // 换成 900，合计 900
    expect((await put(u, 'b', 0, 'x'.repeat(98))).status).toBe(200); // 900 + 100 = 1000
    await age(u);
    expect(await errorOf(await put(u, 'b', 1, 'x'.repeat(99)))).toBe('quota_exceeded'); // 900 + 101
    expect(rowsWritten()).toBe(1);
  });

  it('调低合计上限后，已经超额的人还能把存档改小（改大不行）', async () => {
    await resetAll({ saveUserBytes: 1_000 });
    const u = await registerUser();
    await put(u, 'a', 0, 'x'.repeat(598)); // 600
    await put(u, 'b', 0, 'x'.repeat(398)); // 400，合计 1000
    await resetAll.limits({ saveUserBytes: 500 });
    await age(u);
    expect(await errorOf(await put(u, 'a', 1, 'x'.repeat(698)))).toBe('quota_exceeded'); // 改大
    expect((await put(u, 'a', 1, 'x'.repeat(298))).status).toBe(200); // 改小到 300，合计 700 仍超，但允许
    await age(u);
    expect((await put(u, 'a', 2, 'y'.repeat(298))).status).toBe(200); // 一样大也行
  });

  it('并发新建不同的槽：每人合计字节不会一起冲破上限', async () => {
    await resetAll({ saveUserBytes: 1_000 });
    const u = await registerUser();
    const results = await Promise.all(Array.from({ length: 8 }, (_, i) => put(u, `s${i}`, 0, 'x'.repeat(398)))); // 每个 400
    expect(results.filter((r) => r.status === 200)).toHaveLength(2);
    expect(await count('SELECT SUM(size) AS n FROM saves WHERE user_id = ?1', u.user.id)).toBeLessThanOrEqual(1_000);
  });

  it('并发新建 12 个槽：最多 8 个成功，不会一起冲破上限', async () => {
    const u = await registerUser();
    const results = await Promise.all(Array.from({ length: 12 }, (_, i) => put(u, `s${i}`, 0, i)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(8);
    expect(await count('SELECT COUNT(*) AS n FROM saves WHERE user_id = ?1', u.user.id)).toBe(8);
  });
});

describe('路径、登录与限流', () => {
  it('没登记的游戏 404 unknown_game、槽名不对 422 invalid_slot，都在读会话之前、0 行', async () => {
    const u = await registerUser();
    for (const path of ['/api/saves/nope', '/api/saves/KAIPAN']) {
      const res = await call(path, { cookie: u.cookie });
      expect(res.status).toBe(404);
      expect(await errorOf(res)).toBe('unknown_game');
    }
    // 没登录也先报游戏不对：不读会话
    expect(await errorOf(await call('/api/saves/nope'))).toBe('unknown_game');
    expect(await errorOf(await put(u, 'x', 0, 1, 'nope'))).toBe('unknown_game');
    for (const slot of ['Profile', 'a_b', 'x'.repeat(33), '%E4%B8%AD']) {
      const res = await put(u, slot, 0, 1);
      expect(res.status).toBe(422);
      expect(await errorOf(res)).toBe('invalid_slot');
      expect(rowsWritten()).toBe(0);
    }
    expect((await put(u, 'x'.repeat(32), 0, 1)).status).toBe(200);
  });

  it('路径对、方法不对 405；多一段 404', async () => {
    const u = await registerUser();
    expect((await call('/api/saves/kaipan', { method: 'PUT', body: {}, cookie: u.cookie })).status).toBe(405);
    expect((await call('/api/saves/kaipan/a', { cookie: u.cookie })).status).toBe(405);
    expect((await call('/api/saves/kaipan/a/b', { cookie: u.cookie })).status).toBe(404);
  });

  it('没登录 401；写请求缺 X-Arcade 或 Origin 不对 403、0 行', async () => {
    const u = await registerUser();
    expect((await call('/api/saves/kaipan')).status).toBe(401);
    expect((await call('/api/saves/kaipan/a', { method: 'PUT', body: { baseRev: 0, data: 1 } })).status).toBe(401);
    const res = await call('/api/saves/kaipan/a', { method: 'PUT', body: { baseRev: 0, data: 1 }, cookie: u.cookie, csrf: false });
    expect(res.status).toBe(403);
    expect(rowsWritten()).toBe(0);
    const cross = await call('/api/saves/kaipan/a', { method: 'PUT', body: { baseRev: 0, data: 1 }, cookie: u.cookie, origin: 'https://evil.example.com' });
    expect(cross.status).toBe(403);
    expect(rowsWritten()).toBe(0);
  });

  it('嵌套层数：整个请求体 64 层以内收（含字符串里的括号不算），65 层 400', async () => {
    const u = await registerUser();
    const nest = (n: number) => '['.repeat(n) + ']'.repeat(n);
    // 外层对象 1 层 + data 63 层 = 64；字符串里的括号和转义引号不算层数
    // 字符串放在第 64 层里：转义的引号如果被当成字符串结束，后面的 [ 就会算成第 65 层
    const inner = `${'['.repeat(62)}"{[\\"["${']'.repeat(62)}`;
    const ok = await call('/api/saves/kaipan/a', { method: 'PUT', rawBody: `{"baseRev":0,"data":[${inner}]}`, cookie: u.cookie });
    expect(ok.status).toBe(200);
    const over = await call('/api/saves/kaipan/b', { method: 'PUT', rawBody: `{"baseRev":0,"data":${nest(64)}}`, cookie: u.cookie });
    expect(over.status).toBe(400);
    expect(rowsWritten()).toBe(0);
  });

  it('请求体不是 JSON、是数组，或 data 嵌套几万层：400、0 行', async () => {
    const u = await registerUser();
    const deep = 26_600; // 请求体约 53,200 字节，刚好在 52 KB 以内
    for (const rawBody of ['not json', '[1,2]', `{"baseRev":0,"data":${'['.repeat(deep)}${']'.repeat(deep)}}`]) {
      const res = await call('/api/saves/kaipan/a', { method: 'PUT', rawBody, cookie: u.cookie });
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toBe('bad_request');
      expect(rowsWritten()).toBe(0);
    }
  });

  it('每人每天 PUT 上限（冲突和 too_soon 也算）：超了 429 rate_limited、0 行', async () => {
    await resetAll({ savePerDay: 3 });
    const u = await registerUser();
    await put(u, 'a', 0, 1); // 成功
    await put(u, 'a', 1, 2); // too_soon
    await put(u, 'a', 5, 2); // 冲突
    const res = await put(u, 'b', 0, 1);
    expect(res.status).toBe(429);
    expect(await errorOf(res)).toBe('rate_limited');
    expect(rowsWritten()).toBe(0);
    // 读不受影响
    expect((await get(u)).status).toBe(200);
  });

  it('注销会删掉这个人的全部存档和存档计数', async () => {
    const u = await registerUser();
    await put(u, 'a', 0, 1);
    await put(u, 'b', 0, 1, 'guandan');
    expect((await call('/api/account/delete', { body: { currentPassword: u.password }, cookie: u.cookie })).status).toBe(204);
    expect(await count('SELECT COUNT(*) AS n FROM saves')).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM rate_counters WHERE key LIKE 'save:%'")).toBe(0);
  });
});

describe('预期账号（userId）', () => {
  const putAs = (u: U, userId: unknown, baseRev = 0, slot = 'profile') =>
    call(`/api/saves/kaipan/${slot}`, { method: 'PUT', body: { baseRev, data: { v: 1 }, userId }, cookie: u.cookie });

  it('和会话一致：照常写 2 行；不带：照旧', async () => {
    const a = await registerUser();
    expect((await putAs(a, a.user.id)).status).toBe(200);
    expect(rowsWritten()).toBe(2);
    expect((await put(a, 'other', 0, 1)).status).toBe(200);
  });

  it('别的标签页换了号、rev 恰好相同：409 wrong_user，0 行、不计数，新号的槽没被建', async () => {
    const [a, b] = [await registerUser(), await registerUser()];
    // b 的 cookie，页面里还是 a 的数据
    const res = await putAs(b, a.user.id);
    expect([res.status, await errorOf(res)]).toEqual([409, 'wrong_user']);
    expect(rowsWritten()).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM saves')).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM rate_counters WHERE key = ?1', `save:${b.user.id}`)).toBe(0);
  });

  it('在每天上限之前判断：额度用完了也是 409 wrong_user，不是 429', async () => {
    await resetAll.limits({ savePerDay: 1 });
    const [a, b] = [await registerUser(), await registerUser()];
    expect((await put(b, 'x', 0, 1)).status).toBe(200);
    const res = await putAs(b, a.user.id, 0, 'y');
    expect([res.status, await errorOf(res)]).toEqual([409, 'wrong_user']);
    expect(rowsWritten()).toBe(0);
  });

  it('格式不对：400、0 行', async () => {
    const a = await registerUser();
    for (const bad of [123, '', 'a b', 'x'.repeat(65), null, { id: a.user.id }]) {
      const res = await putAs(a, bad);
      expect([res.status, await errorOf(res)], JSON.stringify(bad)).toEqual([400, 'bad_request']);
      expect(rowsWritten()).toBe(0);
    }
  });
});

describe('预期账号（userId）：和登录、档位的先后（旧仓库 PR 32 审阅时补的回归）', () => {
  const putAs = (cookie: string | undefined, userId: unknown) =>
    call('/api/saves/kaipan/profile', { method: 'PUT', body: { baseRev: 0, data: { v: 1 }, userId }, cookie });
  const scoreAs = (cookie: string | undefined, userId: unknown) =>
    call('/api/scores', { body: { gameId: 'kaipan', boardId: 'daily-2026-10-14', score: 1, userId }, cookie });

  it('没登录、会话失效时带 userId（对的、别人的、格式错的）：都是 401，不是 409 或 400；0 行', async () => {
    const [a, b] = [await registerUser(), await registerUser()];
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(a.user.id).run();
    for (const cookie of [undefined, a.cookie]) {
      for (const userId of [a.user.id, b.user.id, 'bad id', 123]) {
        for (const send of [putAs, scoreAs]) {
          const res = await send(cookie, userId);
          expect([res.status, await errorOf(res)], JSON.stringify([!!cookie, userId, send === putAs])).toEqual([401, 'unauthorized']);
          expect(rowsWritten()).toBe(0);
        }
      }
    }
  });

  it('停增长档下新建槽（baseRev 0）带错 userId：409 wrong_user（不是 503），0 行', async () => {
    const [a, b] = [await registerUser(), await registerUser()];
    await resetAll.limits({ noGrowthDbBytes: 1 });
    const control = await putAs(b.cookie, b.user.id);
    expect([control.status, await errorOf(control)]).toEqual([503, 'busy']);
    const res = await putAs(b.cookie, a.user.id);
    expect([res.status, await errorOf(res)]).toEqual([409, 'wrong_user']);
    expect(rowsWritten()).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM saves')).toBe(0);
  });
});

describe('读存档列表带预期账号（?userId=）', () => {
  const list = (u: U | null, query: string, game = 'kaipan') => call(`/api/saves/${game}${query}`, { cookie: u?.cookie });

  /** b 有 3 个槽，内容里带个记号，好检查有没有漏出去。 */
  async function twoUsers() {
    const [a, b] = [await registerUser(), await registerUser()];
    for (const slot of ['s1', 's2', 's3']) expect((await put(b, slot, 0, { secret: `b-${slot}` })).status).toBe(200);
    return { a, b };
  }

  it('一致：照常返回；不带：照旧；都写 0 行', async () => {
    const { b } = await twoUsers();
    const same = await list(b, `?userId=${b.user.id}`);
    expect(same.status).toBe(200);
    const text = await same.text();
    // "不泄露"那条的正向对照：自己的记号确实在响应里
    expect(text).toContain('b-s1');
    expect((JSON.parse(text) as { saves: SaveOut[] }).saves.map((s) => s.slot)).toEqual(['s1', 's2', 's3']);
    expect(rowsWritten()).toBe(0);
    const plain = await list(b, '');
    expect(((await plain.json()) as { saves: SaveOut[] }).saves).toHaveLength(3);
  });

  it('不一致：409 wrong_user，没有对方的存档内容，不读存档表（读的行数和直接报格式错一样）', async () => {
    const { a, b } = await twoUsers();
    // 先量一个在读库之前就报错的请求读了几行（只有会话那几行）
    await list(b, '?userId=bad%20id');
    const baseline = rowsRead();
    const res = await list(b, `?userId=${a.user.id}`);
    const text = await res.text();
    expect(res.status).toBe(409);
    expect(JSON.parse(text)).toMatchObject({ error: 'wrong_user' });
    expect(text).not.toContain('secret');
    expect(text).not.toContain('b-s1');
    expect(rowsRead()).toBe(baseline);
    expect(rowsWritten()).toBe(0);
    // 对照：正常读会多读 3 行存档
    await list(b, `?userId=${b.user.id}`);
    expect(rowsRead()).toBeGreaterThan(baseline);
  });

  it('格式不对：空、没有等号、带空格、太长、带了两个、参数名大小写不对：400，0 行', async () => {
    const { b } = await twoUsers();
    const id = b.user.id;
    const bad = [
      '?userId=', '?userId', '?userId=a%20b', `?userId=${'x'.repeat(65)}`, `?userId=${id}&userId=${id}`,
      // 游戏端拼错参数名不能被当成"没带"
      `?userid=${id}`, `?UserId=${id}`, `?USERID=${id}`, `?userId=${id}&userid=${id}`, `?user%69d=${id}`,
    ];
    for (const q of bad) {
      const res = await list(b, q);
      expect([res.status, await errorOf(res)], q).toEqual([400, 'bad_request']);
      expect(rowsWritten()).toBe(0);
    }
  });

  it('参数名按解码后认：user%49d 就是 userId，照常校验', async () => {
    const { a, b } = await twoUsers();
    expect((await list(b, `?user%49d=${b.user.id}`)).status).toBe(200);
    const wrong = await list(b, `?user%49d=${a.user.id}`);
    expect([wrong.status, await errorOf(wrong)]).toEqual([409, 'wrong_user']);
  });

  it('只读档下照常可读：一致 200，不一致 409', async () => {
    const { a, b } = await twoUsers();
    await resetAll.limits({ readonly: { dbBytes: 1 } });
    expect((await put(b, 's4', 0, 1)).status).toBe(503);
    expect((await list(b, `?userId=${b.user.id}`)).status).toBe(200);
    const wrong = await list(b, `?userId=${a.user.id}`);
    expect([wrong.status, await errorOf(wrong)]).toEqual([409, 'wrong_user']);
  });

  it('各认各的来源：PUT 不看查询参数，只看请求体', async () => {
    const { a, b } = await twoUsers();
    const res = await call(`/api/saves/kaipan/s9?userId=${a.user.id}`, { method: 'PUT', body: { baseRev: 0, data: 1 }, cookie: b.cookie });
    expect(res.status).toBe(200);
    const res2 = await call(`/api/saves/kaipan/s8?userId=${b.user.id}`, { method: 'PUT', body: { baseRev: 0, data: 1, userId: a.user.id }, cookie: b.cookie });
    expect(await errorOf(res2)).toBe('wrong_user');
  });

  it('没登录、会话失效时带 userId（对的、错的、格式错的）：401', async () => {
    const { a, b } = await twoUsers();
    await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(b.user.id).run();
    for (const u of [null, b]) {
      for (const q of [`?userId=${b.user.id}`, `?userId=${a.user.id}`, '?userId=']) {
        const res = await list(u, q);
        expect([res.status, await errorOf(res)], `${!!u} ${q}`).toEqual([401, 'unauthorized']);
      }
    }
  });
});
