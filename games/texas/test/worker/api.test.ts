/** Worker 这一层：登录闸门（15.8）、单机带入结回的 CSRF / 登录 / 请求体检查和转给平台钱包、平台 Set-Cookie 的转发。 */
import { env, exports } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../../worker/main.ts';
import { BASE, get, op, post, SITE, statsOf, usage, walletOf } from './helpers.ts';

afterEach(() => vi.useRealTimers());

let uid = 0;
const user = () => `u${uid++}`;
const session = () => `session-${uid++}`;

async function body(res: Response): Promise<Record<string, unknown>> {
  return (await res.json()) as Record<string, unknown>;
}

/** 换掉 env 里的某几样直接调 Worker（GATE=off、没绑平台、计量坏了） */
async function call(path: string, patch: Partial<Env>, init: RequestInit = {}): Promise<Response> {
  return worker.fetch(new Request(`${BASE}${path}`, { redirect: 'manual', ...init }) as Parameters<typeof worker.fetch>[0], { ...env, ...patch });
}

describe('登录闸门', () => {
  it('没有结尾斜杠的首页 301 到带斜杠的（相对路径才对）', async () => {
    const res = await get('?x=1', 'a');
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`${BASE}/?x=1`);
  });

  it('登录了放行，按人回的不缓存，平台续期的 Set-Cookie 带回去', async () => {
    const res = await get('/', 'renew');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('texas test page');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.getSetCookie()).toEqual(['__Host-sid=renew; Max-Age=34560000; Path=/; Secure; HttpOnly']);
  });

  it('没登录 302 到登录页；会话失效时平台清 cookie 的 Set-Cookie 也带回去', async () => {
    for (const sid of [null, 'anon']) {
      const res = await get('/', sid);
      expect(res.status).toBe(302);
      expect(res.headers.get('location')).toBe(`/login?next=${encodeURIComponent('/games/texas/')}`);
      expect(res.headers.getSetCookie().length).toBe(sid ? 1 : 0);
    }
  });

  it('没登录的人点好友房链接（?room=）：302 到登录页带 next（原路径和查询参数），登录完平台跳回原链接', async () => {
    const res = await get('/?room=123456', null);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/login?next=${encodeURIComponent('/games/texas/?room=123456')}`);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it('平台不可用一律 503（fail-closed）：回 503、回的不是 JSON、没绑服务', async () => {
    for (const sid of ['bad', 'junk']) {
      const res = await get('/index.html', sid);
      expect(res.status).toBe(503);
      expect(await res.text()).toContain('回大厅');
      expect(res.headers.getSetCookie()).toEqual([]);
    }
    const res = await call('/', { ARCADE: undefined }, { headers: { cookie: '__Host-sid=a' } });
    expect(res.status).toBe(503);
  });

  it('GATE=off 不问平台；配成别的值照样要登录', async () => {
    expect((await call('/', { GATE: 'off' })).status).toBe(200);
    expect((await call('/', { GATE: 'typo' })).status).toBe(302);
  });

  it('请求里没有会话 cookie 就不问平台（问了的话 bad 会是 503）', async () => {
    for (const cookie of ['a=1; __Host-sid=; b=2', 'x__Host-sid=bad']) {
      expect((await call('/', {}, { headers: { cookie } })).status).toBe(302);
    }
    expect((await call('/', {}, { headers: { cookie: 'a=1; __Host-sid=bad' } })).status).toBe(503);
  });
});

describe('单机的带入、结回（经服务绑定调平台钱包，client 模式）', () => {
  it('结回带这一份的小结（0.3.0）：原样转给平台；不合格的平台整份忽略、钱照常结，回话带 statsIgnored', async () => {
    for (const [stats, ignored] of [
      [{ rounds: 12, wins: 5, best: 340, titles: ['river_god'], sum: { rivers: 1 } }, undefined],
      [{ rounds: -1, wins: 0, best: 0 }, 'bad_stats'],
    ] as const) {
      const u = user();
      const s = session();
      await post('solo/buyin', u, { op: op(), session: s, stakes: 'small', amount: 2_000 });
      const r = await body(await post('solo/cashout', u, { op: op(), session: s, amount: 2_300, stats }));
      expect(r).toMatchObject({ ok: true, wallet: { balance: 10_300, stakes: [] } });
      expect((r as { statsIgnored?: string }).statsIgnored).toBe(ignored);
      expect(await statsOf(u)).toEqual([{ game: 'texas', ref: s, stats, ...(ignored ? { ignored } : {}) }]);
    }
  });

  it('带入 → 结回，各调平台 1 次、写 1 行；重发同一个请求平台按操作 id 认出来，不多扣不多给、不再写', async () => {
    const u = user();
    const s = session();
    const buy = { op: op(), session: s, stakes: 'small', amount: 2_000 };
    const r1 = await post('solo/buyin', u, buy);
    expect(r1.status).toBe(200);
    expect(r1.headers.get('cache-control')).toBe('private, no-store');
    expect(await body(r1)).toMatchObject({ ok: true, wallet: { balance: 8_000, stakes: [{ game: 'texas', ref: s, tier: 'small', amount: 2_000, mode: 'client' }] } });
    expect(await usage(u)).toEqual({ calls: 1, writes: 1 });
    expect(await body(await post('solo/buyin', u, buy))).toMatchObject({ wallet: { balance: 8_000 } });
    expect(await usage(u)).toEqual({ calls: 2, writes: 1 });
    // 单机那一份 24 小时后到期退回（平台最长 24 小时）
    expect((await walletOf(u)).stakes[0]!.until - Date.now()).toBeGreaterThan(23 * 3_600_000);

    const out = { op: op(), session: s, amount: 3_200 };
    expect(await body(await post('solo/cashout', u, out))).toMatchObject({ ok: true, credited: 3_200, wallet: { balance: 11_200, stakes: [] } });
    expect(await body(await post('solo/cashout', u, out))).toMatchObject({ wallet: { balance: 11_200 } });
    expect(await usage(u)).toEqual({ calls: 4, writes: 2 });
  });

  it('今天德州的进账到顶了：多赢的不进钱包，回话里 capped 是没进的数', async () => {
    const u = user();
    const s = session();
    await post('solo/buyin', u, { op: op(), session: s, stakes: 'small', amount: 2_000 });
    // 单机每天最多净赢 10 份（平台 0.10.2）：带 2,000 赢回 25,000，进 22,000（本金 + 10 份），3,000 不进
    expect(await body(await post('solo/cashout', u, { op: op(), session: s, amount: 25_000 }))).toMatchObject({ ok: true, credited: 22_000, capped: 3_000, wallet: { balance: 30_000 } });
  });

  it('平台拒了回对应的状态码，带着当前的钱包', async () => {
    const u = user();
    const nostake = await post('solo/cashout', u, { op: op(), session: session(), amount: 1 });
    expect(nostake.status).toBe(409);
    expect(await body(nostake)).toMatchObject({ ok: false, error: 'no_stake', wallet: { balance: 10_000 } });
    const big = await post('solo/buyin', u, { op: op(), session: session(), stakes: 'small', amount: 3_000 });
    expect(big.status).toBe(400);
    expect(await body(big)).toMatchObject({ error: 'bad_amount' });
    // 同一份补码换了档（平台 0.9.5 起同一个游戏可以同时有好几份，按 ref 分开；补码要同档）
    const s = session();
    await post('solo/buyin', u, { op: op(), session: s, stakes: 'small', amount: 2_000 });
    const again = await post('solo/buyin', u, { op: op(), session: s, stakes: 'mid', amount: 2_000 });
    expect(again.status).toBe(409);
    expect(await body(again)).toMatchObject({ error: 'at_table' });
  });

  it('平台连不上（RPC 抛错）：503 unavailable，页面留着操作 id 重发', async () => {
    const down = { buyin: () => Promise.reject(new Error('down')), settle: () => Promise.reject(new Error('down')) };
    const text = JSON.stringify({ op: op(), session: session(), stakes: 'small', amount: 2_000 });
    // 直接调 fetch 时 workerd 不替字符串体补 content-length，这里自己标上
    const res = await call('/api/solo/buyin', { WALLET: down } as unknown as Partial<Env>, {
      method: 'POST',
      headers: { 'x-arcade': '1', origin: SITE, cookie: `__Host-sid=${user()}`, 'content-type': 'application/json', 'content-length': String(text.length) },
      body: text,
    });
    expect(res.status).toBe(503);
    expect(await body(res)).toEqual({ error: 'unavailable' });
  });

  it('CSRF：没带 X-Arcade、Origin 不是本站、没有 Origin 都 403，不问平台也不碰钱包', async () => {
    const u = user();
    const b = { op: op(), session: session(), stakes: 'small', amount: 2_000 };
    expect((await post('solo/buyin', u, b, { 'x-arcade': '0' })).status).toBe(403);
    expect((await post('solo/buyin', u, b, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post('solo/buyin', u, b, { origin: '' })).status).toBe(403);
    // 设了 SITE_ORIGIN 就只认它，请求自己的站点也不行
    const headers = { 'content-type': 'application/json', 'x-arcade': '1', origin: SITE, cookie: `__Host-sid=${u}` };
    const init = { method: 'POST', headers, body: JSON.stringify(b) };
    expect((await call('/api/solo/buyin', { SITE_ORIGIN: 'https://other.example.com' }, init)).status).toBe(403);
    expect(await usage(u)).toEqual({ calls: 0, writes: 0 });
  });

  it('请求本身不对：不认识的路径 404、方法不对 405、体不是 JSON / 太大 / 没标长度 / 形状不对 400，都不调平台；没登录 401、平台不可用 503', async () => {
    const u = user();
    const ok = { op: op(), session: session(), stakes: 'small', amount: 2_000 };
    expect((await post('solo/steal', u, ok)).status).toBe(404);
    expect((await post('wallet/relief', u, {})).status).toBe(404);
    expect((await get('/api/solo/buyin', u)).status).toBe(405);
    expect((await post('solo/buyin', u, '{')).status).toBe(400);
    expect((await post('solo/buyin', u, { ...ok, pad: 'x'.repeat(1100) })).status).toBe(400);
    for (const bad of [{ ...ok, amount: '400' }, { ...ok, op: 'short' }, { ...ok, session: 'bad session!' }, { ...ok, stakes: 'gold' }, { ...ok, amount: -1 }]) {
      expect((await post('solo/buyin', u, bad)).status).toBe(400);
    }
    // 分块传的请求体不带 content-length：不读（读请求体在认人之前）
    const chunked = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode(JSON.stringify(ok)));
        c.close();
      },
    });
    const req = new Request(`${BASE}/api/solo/buyin`, { method: 'POST', headers: { 'x-arcade': '1', origin: SITE, cookie: `__Host-sid=${u}` }, body: chunked });
    expect((await exports.default.fetch(req)).status).toBe(400);
    expect(await usage(u)).toEqual({ calls: 0, writes: 0 });
    expect((await post('solo/buyin', null, ok)).status).toBe(401);
    expect((await post('solo/buyin', 'bad', ok)).status).toBe(503);
  });
});
