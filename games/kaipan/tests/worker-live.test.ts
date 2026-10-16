import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Env, Fetcher } from '../src/worker/gate.ts';
import { route as handle } from '../src/worker/route.ts';
import { LIVE_MAX_BP } from '../src/core/liveTiers.ts';

/** 0.6.0 实盘钱包接口：平台 /api/me 和钱包 RPC 都用假的绑定代替，记录调用参数。 */

const ORIGIN = 'https://game.example.com';
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const LOGGED_IN = { user: { id: 'u1', username: 'zy', displayName: 'zy' }, service: 'ok', saves: 'ok' };
const REF = 'kaipan-abcdef12';

function arcade(reply: (req: Request) => Promise<Response> | Response): Fetcher & { calls: Request[] } {
  const calls: Request[] = [];
  return {
    calls,
    fetch: async (req: Request) => {
      calls.push(req);
      return reply(req);
    },
  };
}

type Call = { method: string; args: Record<string, unknown> };
function wallet(...rest: [unknown?]): { calls: Call[]; rpc: Env['WALLET'] } {
  const result = rest.length ? rest[0] : { ok: true, wallet: { balance: 100 } };
  const calls: Call[] = [];
  const mk = (method: string) => async (args: Record<string, unknown>) => {
    calls.push({ method, args });
    return result;
  };
  return { calls, rpc: { buyin: mk('buyin'), settle: mk('settle'), refund: mk('refund') } as unknown as Env['WALLET'] };
}

function env(over: Partial<Env> = {}): Env & { arcade: ReturnType<typeof arcade>; w: ReturnType<typeof wallet> } {
  const a = arcade(() => json(LOGGED_IN));
  const w = wallet();
  return { ASSETS: { fetch: async () => new Response('static') }, ARCADE: a, WALLET: w.rpc, GATE: 'login', ...over, arcade: a, w } as never;
}

function post(action: string, body: unknown, headers: Record<string, string> = { 'X-Arcade': '1', Origin: ORIGIN }, method = 'POST'): Request {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  // 浏览器发 fetch 时会带 Content-Length；测试里的 Request 不会自己加，照着补上
  const h = method === 'GET' || 'content-length' in headers ? headers : { ...headers, 'content-length': String(new TextEncoder().encode(text).length) };
  return new Request(`${ORIGIN}/games/kaipan/api/live/${action}`, { method, headers: h, body: method === 'GET' ? undefined : text });
}
const run = (e: Env, r: Request, t = 200) => handle(r, e, t);

describe('三个动作的正常路径', () => {
  it('buyin：参数完全由 Worker 定，原样回钱包结果，不缓存，带回 Set-Cookie', async () => {
    const e = env({
      ARCADE: arcade(() => {
        const r = json(LOGGED_IN);
        r.headers.append('Set-Cookie', 'sid=a; Path=/');
        r.headers.append('Set-Cookie', 'csrf=b; Path=/');
        return r;
      }),
    });
    const w = wallet({ ok: true, wallet: { balance: 8000 }, dup: false });
    e.WALLET = w.rpc;
    const before = Date.now();
    const res = await run(e, post('buyin', { ref: REF, tier: 'mid', amount: 1, until: 5, userId: 'evil' }));
    expect(res.status).toBe(200);
    // 钱包的回话原样，另带上是谁（浏览器记下，结回时对账号）
    expect(await res.json()).toEqual({ ok: true, wallet: { balance: 8000 }, dup: false, user: 'u1' });
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(res.headers.getSetCookie()).toEqual(['sid=a; Path=/', 'csrf=b; Path=/']);
    expect(w.calls).toHaveLength(1);
    const { method, args } = w.calls[0]!;
    expect(method).toBe('buyin');
    const until = args.until as number;
    expect(until).toBeGreaterThanOrEqual(before + 24 * 3600 * 1000);
    expect(until).toBeLessThanOrEqual(Date.now() + 24 * 3600 * 1000);
    expect(args).toEqual({ userId: 'u1', game: 'kaipan', ref: REF, tier: 'mid', amount: 10_000, until, mode: 'client', op: `${REF}-in` });
  });

  it('settle：金额由档位和 bp 算', async () => {
    const e = env();
    const res = await run(e, post('settle', { ref: REF, tier: 'small', bp: 10543 }));
    expect(res.status).toBe(200);
    expect(e.w.calls[0]).toEqual({ method: 'settle', args: { userId: 'u1', game: 'kaipan', ref: REF, amount: 2108, mode: 'client', op: `${REF}-out` } });
  });

  it('refund：只要 ref', async () => {
    const e = env();
    const res = await run(e, post('refund', { ref: REF }));
    expect(res.status).toBe(200);
    expect(e.w.calls[0]).toEqual({ method: 'refund', args: { userId: 'u1', game: 'kaipan', ref: REF, mode: 'client', op: `${REF}-refund` } });
  });
});

describe('settle 带的战绩小结（0.6.5，平台 5.10）', () => {
  it('浏览器报的 stats 原样转发给钱包；没带就不放这个字段', async () => {
    const stats = { rounds: 1, wins: 1, best: 108, titles: ['ashore', 's_plain'], max: { bp: 10_543 }, sum: { limitup: 3 }, extra: 'x' };
    const e = env();
    await run(e, post('settle', { ref: REF, tier: 'small', bp: 10_543, stats }));
    expect(e.w.calls[0]?.args).toEqual({ userId: 'u1', game: 'kaipan', ref: REF, amount: 2108, mode: 'client', op: `${REF}-out`, stats });
    const e2 = env();
    await run(e2, post('settle', { ref: REF, tier: 'small', bp: 10_543 }));
    expect('stats' in (e2.w.calls[0]?.args as object)).toBe(false);
  });
});

describe('settle 的金额与 bp 校验', () => {
  it.each([
    ['small', 0, 0],
    ['small', 10000, 2000],
    ['mid', 10543, 10543],
    ['big', 30000, 150000],
    ['lux', 30000, 600000],
    // 0.11.0 疯狂 3× 封顶 7 倍
    ['small', 70000, 14000],
  ])('%s bp=%i → %i', async (tier, bp, amount) => {
    const e = env();
    await run(e, post('settle', { ref: REF, tier, bp }));
    expect(e.w.calls[0]!.args.amount).toBe(amount);
  });
  it('上限是最高一档杠杆的封顶：7 倍（0.11.0 前是 3 倍）', () => expect(LIVE_MAX_BP).toBe(70000));
  it.each([[-1], [70001], [1.5], ['100'], [null], [NaN]])('bp=%s → 400 bad_bp，不碰平台和钱包', async (bp) => {
    const e = env();
    const res = await run(e, post('settle', { ref: REF, tier: 'small', bp }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, error: 'bad_bp' });
    expect(e.w.calls).toHaveLength(0);
    expect(e.arcade.calls).toHaveLength(0);
  });
});

describe('ref 和 tier', () => {
  it.each([
    ['a'.repeat(7), 400],
    ['a'.repeat(8), 200],
    ['a-_Z9'.repeat(11) + 'ab', 200], // 57
    ['a'.repeat(58), 400],
    ['abcdefgh!', 400],
    ['abcdefg h', 400],
    ['中文中文中文中文', 400],
  ])('ref %s → %i', async (ref, status) => {
    const e = env();
    const res = await run(e, post('refund', { ref }));
    expect(res.status).toBe(status);
    if (status === 400) {
      expect(await res.json()).toEqual({ ok: false, error: 'bad_ref' });
      expect(e.w.calls).toHaveLength(0);
    }
  });
  it('ref 不是字符串 → bad_ref', async () => {
    expect((await (await run(env(), post('refund', { ref: 12345678 }))).json()) as unknown).toEqual({ ok: false, error: 'bad_ref' });
  });
  it.each([['huge'], [undefined], [1]])('tier=%s → 400 bad_tier', async (tier) => {
    for (const a of ['buyin', 'settle']) {
      const e = env();
      const res = await run(e, post(a, { ref: REF, tier, bp: 100 }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: 'bad_tier' });
      expect(e.w.calls).toHaveLength(0);
    }
  });
});

describe('CSRF', () => {
  it.each([
    ['缺 X-Arcade', { Origin: ORIGIN }],
    ['X-Arcade 不是 1', { 'X-Arcade': '0', Origin: ORIGIN }],
    ['Origin 不同', { 'X-Arcade': '1', Origin: 'https://evil.example' }],
    ['缺 Origin', { 'X-Arcade': '1' }],
  ])('%s → 403，没问平台也没碰钱包', async (_n, headers) => {
    const e = env();
    const res = await run(e, post('buyin', { ref: REF, tier: 'small' }, headers));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ ok: false, error: 'csrf' });
    expect(e.arcade.calls).toHaveLength(0);
    expect(e.w.calls).toHaveLength(0);
  });
});

describe('认人', () => {
  const body = { ref: REF, tier: 'small' };
  it('没登录 → 401，带回 Set-Cookie', async () => {
    const e = env({
      ARCADE: arcade(() => {
        const r = json({ user: null });
        r.headers.append('Set-Cookie', 'sid=; Max-Age=0');
        return r;
      }),
    });
    const res = await run(e, post('buyin', body));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: 'login' });
    expect(res.headers.getSetCookie()).toEqual(['sid=; Max-Age=0']);
    expect(e.w.calls).toHaveLength(0);
  });
  it('平台 500 / 超时 / user 没有 id → 503', async () => {
    for (const ar of [arcade(() => json({}, 500)), arcade(() => new Promise<Response>(() => {})), arcade(() => json({ user: { username: 'x' } })), arcade(() => json({ user: { id: '' } })), arcade(() => json({ user: { id: 5 } }))]) {
      const e = env({ ARCADE: ar });
      const res = await run(e, post('buyin', body), 30);
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, error: 'unavailable' });
      expect(e.w.calls).toHaveLength(0);
    }
  });
  it('GATE=off 时也照样认人', async () => {
    const e = env({ GATE: 'off', ARCADE: arcade(() => json({ user: null })) });
    expect((await run(e, post('buyin', body))).status).toBe(401);
    const ok = env({ GATE: 'off' });
    expect((await run(ok, post('buyin', body))).status).toBe(200);
  });
});

describe('钱包异常', () => {
  const r = () => post('refund', { ref: REF });
  it('没有 WALLET 绑定或方法缺失 → 503', async () => {
    expect((await run(env({ WALLET: undefined }), r())).status).toBe(503);
    expect((await run(env({ WALLET: {} as never }), r())).status).toBe(503);
  });
  it('RPC 抛异常 → 503', async () => {
    const rpc = { refund: async () => { throw new Error('boom'); } } as never;
    expect((await run(env({ WALLET: rpc }), r())).status).toBe(503);
  });
  it('RPC 超时 → 503', async () => {
    const rpc = { refund: () => new Promise(() => {}) } as never;
    const res = await run(env({ WALLET: rpc }), r(), 30);
    expect(res.status).toBe(503);
  });
  it.each([[null], ['ok'], [{ error: 'x' }], [{ ok: 'yes' }], [undefined]])('回非法形状 %j → 503', async (shape) => {
    const w = wallet(shape);
    expect((await run(env({ WALLET: w.rpc }), r())).status).toBe(503);
  });
  it('业务拒绝 → 200 原样', async () => {
    const reject = { ok: false, error: 'no_funds', wallet: { balance: 10 } };
    const w = wallet(reject);
    const res = await run(env({ WALLET: w.rpc }), post('buyin', { ref: REF, tier: 'big' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ...reject, user: 'u1' });
  });
});

describe('换了账号', () => {
  it('结回、放弃带的 user 和现在登录的不一样：409 wrong_user，不碰钱包，带回 Set-Cookie', async () => {
    for (const [action, body] of [['settle', { ref: REF, tier: 'small', bp: 10_000, user: 'someone-else' }], ['refund', { ref: REF, user: 'someone-else' }]] as const) {
      const w = wallet({ ok: true, wallet: {} });
      const e = env({ WALLET: w.rpc, ARCADE: arcade(() => { const r = json(LOGGED_IN); r.headers.append('Set-Cookie', 'sid=a'); return r; }) });
      const res = await run(e, post(action, body));
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ ok: false, error: 'wrong_user' });
      expect(res.headers.getSetCookie()).toEqual(['sid=a']);
      expect(w.calls).toHaveLength(0);
    }
  });
  it('user 对得上照常结；不带 user（旧记录）也照常；user 不是非空字符串 → 400', async () => {
    const w = wallet({ ok: true, wallet: {} });
    expect((await run(env({ WALLET: w.rpc }), post('refund', { ref: REF, user: 'u1' }))).status).toBe(200);
    expect((await run(env({ WALLET: w.rpc }), post('refund', { ref: REF }))).status).toBe(200);
    expect(w.calls).toHaveLength(2);
    for (const user of ['', 5, 'x'.repeat(200)]) {
      const res = await run(env({ WALLET: w.rpc }), post('refund', { ref: REF, user }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: 'bad_user' });
    }
    expect(w.calls).toHaveLength(2);
  });
  it('认出人以后的 503（钱包没配、超时）也带回续期的 Set-Cookie', async () => {
    const e = env({ WALLET: undefined, ARCADE: arcade(() => { const r = json(LOGGED_IN); r.headers.append('Set-Cookie', 'sid=a'); return r; }) });
    const res = await run(e, post('refund', { ref: REF }));
    expect(res.status).toBe(503);
    expect(res.headers.getSetCookie()).toEqual(['sid=a']);
  });
});

describe('路由与请求体', () => {
  it('GET → 405，未知路径 → 404', async () => {
    const g = await run(env(), post('buyin', '', undefined, 'GET'));
    expect(g.status).toBe(405);
    expect(await g.json()).toEqual({ ok: false, error: 'method' });
    for (const p of ['/games/kaipan/api/live/nope', '/games/kaipan/api/other', '/games/kaipan/api/live/buyin/x', '/games/kaipan/api/']) {
      const res = await run(env(), new Request(ORIGIN + p, { method: 'POST', headers: { 'X-Arcade': '1', Origin: ORIGIN }, body: '{}' }));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ ok: false, error: 'not_found' });
    }
  });
  it('请求体过大 / 非 JSON / 不是对象 → 400 bad_request', async () => {
    for (const b of ['x'.repeat(3000), JSON.stringify({ ref: REF, pad: 'x'.repeat(3000) }), 'not json', '[1]', 'null', '"s"']) {
      const e = env();
      const res = await run(e, post('refund', b));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: 'bad_request' });
      expect(e.arcade.calls).toHaveLength(0);
    }
  });
  it('没有 Content-Length（分块传输）、为 0、超过 2 KB、不是数字：不读请求体，直接 400', async () => {
    const H = { 'X-Arcade': '1', Origin: ORIGIN };
    const ok = JSON.stringify({ ref: REF });
    const chunked = new Request(`${ORIGIN}/games/kaipan/api/live/refund`, {
      method: 'POST',
      headers: H,
      body: new ReadableStream({ start: (c) => (c.enqueue(new TextEncoder().encode(ok)), c.close()) }),
      duplex: 'half',
    } as RequestInit);
    for (const r of [chunked, post('refund', ok, { ...H, 'content-length': '0' }), post('refund', ok, { ...H, 'content-length': '3000' }), post('refund', ok, { ...H, 'content-length': 'abc' })]) {
      const e = env();
      const res = await run(e, r);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: 'bad_request' });
      expect(e.arcade.calls).toHaveLength(0);
    }
  });
  it('首页闸门不受影响', async () => {
    const e = env({ ARCADE: arcade(() => json({ user: null })) });
    const res = await handle(new Request(ORIGIN + '/games/kaipan/'), e);
    expect(res.status).toBe(302);
  });
});

describe('wrangler.jsonc', () => {
  it('run_worker_first 含钱包接口；WALLET、ARCADE 不写在模块里（本站部署时由部署工具补，形式在仓库的 tools/deployer 里定）', () => {
    const text = readFileSync('wrangler.jsonc', 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    const cfg = JSON.parse(text) as { assets: { run_worker_first: string[] }; services?: unknown };
    expect(cfg.services).toBeUndefined();
    expect(cfg.assets.run_worker_first).toContain('/games/kaipan/api/*');
  });
});
