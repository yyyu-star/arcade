import { describe, expect, it } from 'vitest';
import { handleLive, type LiveEnv } from '../worker/live.ts';
import { LIVE_MAX_BP, LIVE_OPEN, LIVE_TIERS, liveReturn } from '../src/content/live.ts';

/** 实盘钱包接口：平台 /api/me 和钱包 RPC 都用假的绑定代替，记录调用参数。 */

const ORIGIN = 'https://game.example.com';
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const LOGGED_IN = { user: { id: 'u1', username: 'zy', displayName: 'zy' } };
const REF = 'yexun-abcdef12';

type Arcade = NonNullable<LiveEnv['ARCADE']>;
function arcade(reply: (req: Request) => Promise<Response> | Response): Arcade & { calls: Request[] } {
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
function wallet(result: unknown = { ok: true, wallet: { balance: 100 } }, stakes: unknown[] = []): { calls: Call[]; rpc: LiveEnv['WALLET'] } {
  const calls: Call[] = [];
  const mk = (method: string) => async (args: Record<string, unknown>) => {
    calls.push({ method, args });
    return result;
  };
  const view = async () => ({ ok: true, wallet: { balance: 100, stakes } });
  return { calls, rpc: { view, buyin: mk('buyin'), settle: mk('settle'), refund: mk('refund') } as unknown as LiveEnv['WALLET'] };
}

function env(over: Partial<LiveEnv> = {}): LiveEnv & { arcade: ReturnType<typeof arcade>; w: ReturnType<typeof wallet> } {
  const a = arcade(() => json(LOGGED_IN));
  const w = wallet();
  return { ARCADE: a, WALLET: w.rpc, GATE: 'login', ...over, arcade: a, w } as never;
}

function post(action: string, body: unknown, headers: Record<string, string> = { 'X-Arcade': '1', Origin: ORIGIN }, method = 'POST'): Request {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const h = method === 'GET' || 'content-length' in headers ? headers : { ...headers, 'content-length': String(new TextEncoder().encode(text).length) };
  return new Request(`${ORIGIN}/games/yexun/api/live/${action}`, { method, headers: h, body: method === 'GET' ? undefined : text });
}
const run = (e: LiveEnv, r: Request, t = 200) => handleLive(r, e, t, true);

describe('三个动作的正常路径', () => {
  it('buyin：金额和到期由 Worker 定，原样回钱包结果并带上账号，不缓存，带回 Set-Cookie', async () => {
    const e = env({
      ARCADE: arcade(() => {
        const r = json(LOGGED_IN);
        r.headers.append('Set-Cookie', 'sid=a; Path=/');
        return r;
      }),
    });
    const w = wallet({ ok: true, wallet: { balance: 8000 }, dup: false });
    e.WALLET = w.rpc;
    const before = Date.now();
    const res = await run(e, post('buyin', { ref: REF, tier: 'medium', amount: 1, until: 5, userId: 'evil' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, wallet: { balance: 8000 }, dup: false, user: 'u1' });
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.getSetCookie()).toEqual(['sid=a; Path=/']);
    expect(w.calls).toHaveLength(1);
    const { method, args } = w.calls[0]!;
    expect(method).toBe('buyin');
    const until = args.until as number;
    expect(until).toBeGreaterThanOrEqual(before + 24 * 3600 * 1000);
    expect(until).toBeLessThanOrEqual(Date.now() + 24 * 3600 * 1000);
    // 钱包的档位名是 mid（不是夜巡的 medium）：传 medium 钱包回 bad_request（0.3.8 线上修）
    expect(args).toEqual({ userId: 'u1', game: 'yexun', ref: REF, tier: 'mid', amount: 10_000, until, mode: 'client', op: `${REF}-in` });
  });

  it('带入金额固定是各档的一份，浏览器报的 amount 不算', async () => {
    for (const tier of ['small', 'medium', 'large', 'luxe'] as const) {
      const e = env();
      await run(e, post('buyin', { ref: REF, tier, amount: 999_999 }));
      expect(e.w.calls[0]!.args.amount).toBe(LIVE_TIERS[tier].stake);
      expect(e.w.calls[0]!.args.tier).toBe({ small: 'small', medium: 'mid', large: 'big', luxe: 'lux' }[tier]);
    }
  });

  it('settle：按桌上那一份的金额算，stats 原样转发', async () => {
    const e = env();
    const stats = { ticks: 9000, kills: 12, extra: { a: [1, 2] } };
    const res = await run(e, post('settle', { ref: REF, tier: 'small', bp: 10_000, stats }));
    expect(res.status).toBe(200);
    const c = e.w.calls[0]!;
    expect(c.method).toBe('settle');
    expect(c.args).toEqual({ userId: 'u1', game: 'yexun', ref: REF, amount: 2_000, mode: 'client', op: `${REF}-out`, stats });
  });

  it('settle 没带 stats 时不转发这个字段', async () => {
    const e = env();
    await run(e, post('settle', { ref: REF, tier: 'small', bp: 10_000 }));
    expect('stats' in e.w.calls[0]!.args).toBe(false);
  });

  it('结回按钱包 view 里桌上那一份的金额算，不信浏览器报的档位', async () => {
    // 桌上带的是小档（2,000），浏览器却报豪华档
    const w = wallet({ ok: true, wallet: {} }, [{ game: 'yexun', ref: REF, amount: 2_000 }, { game: 'yexun', ref: 'other-ref-1', amount: 200_000 }, { game: 'kaipan', ref: REF, amount: 77 }]);
    const e = env();
    e.WALLET = w.rpc;
    await run(e, post('settle', { ref: REF, tier: 'luxe', bp: 18_000 }));
    expect(w.calls[0]!.args.amount).toBe(liveReturn(2_000, 18_000));
    expect(w.calls[0]!.args.amount).toBe(3_600);
  });

  it('桌上没有这一份时（已结过）按报的档位填，钱包自己回重发结果', async () => {
    const e = env();
    await run(e, post('settle', { ref: REF, tier: 'large', bp: 10_000 }));
    expect(e.w.calls[0]!.args.amount).toBe(50_000);
  });

  it('看不了钱包（view 失败）回 503，不去结', async () => {
    const e = env();
    const w = wallet();
    (w.rpc as unknown as { view: unknown }).view = async () => ({ ok: false, error: 'internal' });
    e.WALLET = w.rpc;
    const res = await run(e, post('settle', { ref: REF, tier: 'small', bp: 10_000 }));
    expect(res.status).toBe(503);
    expect(w.calls).toHaveLength(0);
  });

  it('refund：op 按 ref 固定', async () => {
    const e = env();
    const res = await run(e, post('refund', { ref: REF }));
    expect(res.status).toBe(200);
    expect(e.w.calls[0]).toEqual({ method: 'refund', args: { userId: 'u1', game: 'yexun', ref: REF, mode: 'client', op: `${REF}-refund` } });
  });
});

describe('入口校验', () => {
  it('路径和方法', async () => {
    const e = env();
    expect((await run(e, post('nope', { ref: REF }))).status).toBe(404);
    expect((await run(e, new Request(`${ORIGIN}/games/yexun/api/other`, { method: 'POST' }))).status).toBe(404);
    expect((await run(e, post('buyin', '', { 'X-Arcade': '1', Origin: ORIGIN }, 'GET'))).status).toBe(405);
    expect(e.w.calls).toHaveLength(0);
  });

  it('单独部署（没有 ARCADE、GATE 不是 login）回 501，且不问平台', async () => {
    const e = env({ ARCADE: undefined, GATE: undefined, WALLET: undefined });
    const res = await run(e, post('buyin', { ref: REF, tier: 'small' }));
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ ok: false, error: 'no_wallet' });
  });

  it('实盘没开（LIVE_OPEN 关着）：带入回 501 closed、不问平台和钱包；结回照常走', async () => {
    const e = env({ ARCADE: arcade(() => json(LOGGED_IN)) });
    const w = wallet({ ok: true, wallet: { balance: 8000 } });
    e.WALLET = w.rpc;
    const res = await handleLive(post('buyin', { ref: REF, tier: 'small' }), e, 200, false);
    expect(res.status).toBe(501);
    expect(await res.json()).toEqual({ ok: false, error: 'closed' });
    expect(w.calls).toHaveLength(0);
    expect((await handleLive(post('refund', { ref: REF }), e, 200, false)).status).not.toBe(501);
  });

  it('上线后实盘开着：不传 open 时按 LIVE_OPEN 放行带入', async () => {
    expect(LIVE_OPEN).toBe(true);
    const e = env({ ARCADE: arcade(() => json(LOGGED_IN)) });
    const w = wallet({ ok: true, wallet: { balance: 8000 } });
    e.WALLET = w.rpc;
    const res = await handleLive(post('buyin', { ref: REF, tier: 'small' }), e, 200);
    expect(res.status).toBe(200);
    expect(w.calls).toHaveLength(1);
  });

  it('GATE=login 却没有 ARCADE：当平台不可用（503）', async () => {
    const e = env({ ARCADE: undefined });
    expect((await run(e, post('buyin', { ref: REF, tier: 'small' }))).status).toBe(503);
  });

  it('CSRF：缺 X-Arcade 或 Origin 不对都是 403，不问平台', async () => {
    const e = env();
    expect((await run(e, post('buyin', { ref: REF, tier: 'small' }, { Origin: ORIGIN }))).status).toBe(403);
    expect((await run(e, post('buyin', { ref: REF, tier: 'small' }, { 'X-Arcade': '1', Origin: 'https://evil.example' }))).status).toBe(403);
    expect((await run(e, post('buyin', { ref: REF, tier: 'small' }, { 'X-Arcade': '1' }))).status).toBe(403);
    expect(e.arcade.calls).toHaveLength(0);
  });

  it('请求体：太长、没有 Content-Length、坏 JSON、不是对象都是 400', async () => {
    const e = env();
    const big = { ref: REF, tier: 'small', pad: 'x'.repeat(3000) };
    expect((await run(e, post('buyin', big))).status).toBe(400);
    expect((await run(e, post('buyin', { ref: REF, tier: 'small' }, { 'X-Arcade': '1', Origin: ORIGIN, 'content-length': '99999' }))).status).toBe(400);
    expect((await run(e, post('buyin', '{bad'))).status).toBe(400);
    expect((await run(e, post('buyin', '[1]'))).status).toBe(400);
    expect((await run(e, post('buyin', 'null'))).status).toBe(400);
    expect((await run(e, new Request(`${ORIGIN}/games/yexun/api/live/buyin`, { method: 'POST', headers: { 'X-Arcade': '1', Origin: ORIGIN } }))).status).toBe(400);
    expect(e.arcade.calls).toHaveLength(0);
  });

  it('ref 格式：太短、太长（57 位以内）、非法字符', async () => {
    const e = env();
    for (const ref of ['short', 'a'.repeat(58), 'yexun abcdef12', 'yexun/abcdef1', 123, null]) {
      const res = await run(e, post('buyin', { ref, tier: 'small' }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ ok: false, error: 'bad_ref' });
    }
    expect((await run(e, post('buyin', { ref: 'a'.repeat(57), tier: 'small' }))).status).toBe(200);
    expect((await run(e, post('buyin', { ref: 'a'.repeat(8), tier: 'small' }))).status).toBe(200);
  });

  it('档位：不认识的（含开盘的 mid、原型链上的名字）400', async () => {
    const e = env();
    for (const tier of ['mid', 'huge', 'toString', '', 1, undefined]) {
      expect((await run(e, post('buyin', { ref: REF, tier }))).status).toBe(400);
      expect((await run(e, post('settle', { ref: REF, tier, bp: 1 }))).status).toBe(400);
    }
    expect(e.w.calls).toHaveLength(0);
  });

  it('bp：负数、小数、超过 3 倍、非数字都 400；0 和 30000 可以', async () => {
    const e = env();
    for (const bp of [-1, 1.5, LIVE_MAX_BP + 1, '100', null, NaN, undefined]) {
      const res = await run(e, post('settle', { ref: REF, tier: 'small', bp }));
      expect(res.status).toBe(400);
    }
    expect((await run(e, post('settle', { ref: REF, tier: 'small', bp: 0 }))).status).toBe(200);
    expect((await run(e, post('settle', { ref: REF, tier: 'small', bp: LIVE_MAX_BP }))).status).toBe(200);
    expect(e.w.calls.map((c) => c.args.amount)).toEqual([0, 6_000]);
  });

  it('user 字段格式不对 400', async () => {
    const e = env();
    for (const user of ['', 5, 'x'.repeat(129)]) expect((await run(e, post('refund', { ref: REF, user }))).status).toBe(400);
  });
});

describe('认人', () => {
  it('没登录 401，不动钱包，Set-Cookie 带回', async () => {
    const a = arcade(() => {
      const r = json({ user: null });
      r.headers.append('Set-Cookie', 'sid=x; Path=/');
      return r;
    });
    const e = env({ ARCADE: a });
    const res = await run(e, post('buyin', { ref: REF, tier: 'small' }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ ok: false, error: 'login' });
    expect(res.headers.getSetCookie()).toEqual(['sid=x; Path=/']);
    expect(e.w.calls).toHaveLength(0);
  });

  it('只给平台转发 Cookie 和 cf-connecting-ip', async () => {
    const e = env();
    await run(e, post('buyin', { ref: REF, tier: 'small' }, { 'X-Arcade': '1', Origin: ORIGIN, Cookie: 'sid=1', 'cf-connecting-ip': '1.2.3.4', Authorization: 'secret' }));
    const h = e.arcade.calls[0]!.headers;
    expect(h.get('cookie')).toBe('sid=1');
    expect(h.get('cf-connecting-ip')).toBe('1.2.3.4');
    expect(h.get('authorization')).toBeNull();
    expect(new URL(e.arcade.calls[0]!.url).pathname).toBe('/api/me');
  });

  it('平台超时（不理会中止信号）503', async () => {
    const e = env({ ARCADE: arcade(() => new Promise<Response>(() => {})) });
    const res = await run(e, post('buyin', { ref: REF, tier: 'small' }), 30);
    expect(res.status).toBe(503);
    expect(e.w.calls).toHaveLength(0);
  });

  it('平台回坏话（非 200、没有 user、user 没有 id）都 503', async () => {
    for (const a of [arcade(() => json({}, 500)), arcade(() => json({ nope: 1 })), arcade(() => json({ user: {} })), arcade(() => new Response('not json'))]) {
      const e = env({ ARCADE: a });
      expect((await run(e, post('buyin', { ref: REF, tier: 'small' }))).status).toBe(503);
      expect(e.w.calls).toHaveLength(0);
    }
  });

  it('换了账号 409：结回、放弃都不动钱包；同一账号放行', async () => {
    const e = env();
    const res = await run(e, post('settle', { ref: REF, tier: 'small', bp: 10_000, user: 'u2' }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: 'wrong_user' });
    expect((await run(e, post('refund', { ref: REF, user: 'u2' }))).status).toBe(409);
    expect(e.w.calls).toHaveLength(0);
    expect((await run(e, post('refund', { ref: REF, user: 'u1' }))).status).toBe(200);
    expect(e.w.calls).toHaveLength(1);
  });
});

describe('钱包', () => {
  it('业务拒绝原样 200 交给浏览器按 error 处理', async () => {
    const e = env();
    const w = wallet({ ok: false, error: 'no_funds', wallet: { balance: 5 } });
    e.WALLET = w.rpc;
    const res = await run(e, post('buyin', { ref: REF, tier: 'luxe' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, error: 'no_funds', wallet: { balance: 5 }, user: 'u1' });
  });

  it('钱包超时 503', async () => {
    const e = env();
    const w = wallet();
    (w.rpc as unknown as { buyin: unknown }).buyin = () => new Promise(() => {});
    e.WALLET = w.rpc;
    const res = await run(e, post('buyin', { ref: REF, tier: 'small' }), 30);
    expect(res.status).toBe(503);
  });

  it('钱包抛错、回怪东西、没有绑定都 503', async () => {
    for (const bad of [async () => { throw new Error('boom'); }, async () => null, async () => ({ nope: 1 })]) {
      const e = env();
      (e.WALLET as unknown as { refund: unknown }).refund = bad;
      expect((await run(e, post('refund', { ref: REF }))).status).toBe(503);
    }
    const e = env({ WALLET: undefined });
    expect((await run(e, post('refund', { ref: REF }))).status).toBe(503);
  });
});
