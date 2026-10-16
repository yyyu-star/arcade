/** 游戏首页的登录闸门和接口小工具（0.8.0，worker.ts）：放行带 Set-Cookie、没登录 302 带 next、平台不可用 503 页、GATE=off 不问平台 */
import { describe, expect, it } from 'vitest';
import { SESSION_COOKIE } from '../src/internal.ts';
import { DOWN_PAGE, json, loginGate, readJson } from '../src/worker.ts';

const PAGE = '<!doctype html><title>游戏</title>';

/** 假的页面资源和平台：平台回指定的响应，记下被问了几次 */
function gateEnv(me: () => Response, gate?: string) {
  const asked = { arcade: 0, assets: 0 };
  return {
    asked,
    env: {
      ASSETS: { fetch: () => (asked.assets++, Promise.resolve(new Response(PAGE, { headers: { 'content-type': 'text/html' } }))) } as unknown as Fetcher,
      ARCADE: { fetch: () => (asked.arcade++, Promise.resolve(me())) } as unknown as Fetcher,
      ...(gate ? { GATE: gate } : {}),
    },
  };
}

const home = (cookie = true) => new Request('https://game.example.com/games/x/?room=123456&a=b', { headers: cookie ? { cookie: `${SESSION_COOKIE}=abc` } : {} });

describe('loginGate', () => {
  it('登录了：回页面，带上平台续期的 Set-Cookie，不缓存', async () => {
    const { env } = gateEnv(() => Response.json({ user: { id: 'u1', displayName: '小王' } }, { headers: { 'set-cookie': `${SESSION_COOKIE}=new; Path=/` } }));
    const res = await loginGate(home(), env);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(PAGE);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(res.headers.getSetCookie()).toEqual([`${SESSION_COOKIE}=new; Path=/`]);
  });

  it('没登录：302 到 /login?next=<原路径和查询参数>，平台清 cookie 的 Set-Cookie 也带回去；没带会话 cookie 的不问平台', async () => {
    const { env, asked } = gateEnv(() => Response.json({ user: null }, { headers: { 'set-cookie': `${SESSION_COOKIE}=; Max-Age=0` } }));
    const res = await loginGate(home(), env);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/login?next=${encodeURIComponent('/games/x/?room=123456&a=b')}`);
    expect(res.headers.getSetCookie()).toEqual([`${SESSION_COOKIE}=; Max-Age=0`]);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    const bare = await loginGate(home(false), env);
    expect(bare.status).toBe(302);
    expect(asked).toEqual({ arcade: 1, assets: 0 });
  });

  it('平台不可用：503 整页，Retry-After 30；默认页不带游戏名，游戏可以换成自己的', async () => {
    const { env, asked } = gateEnv(() => new Response('down', { status: 502 }));
    const res = await loginGate(home(), env);
    expect(res.status).toBe(503);
    expect(res.headers.get('retry-after')).toBe('30');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(await res.text()).toBe(DOWN_PAGE);
    expect(await (await loginGate(home(), env, { downPage: '<p>自己的页</p>' })).text()).toBe('<p>自己的页</p>');
    expect(asked.assets).toBe(0);
  });

  it('GATE=off：不问平台，直接回页面', async () => {
    const { env, asked } = gateEnv(() => new Response('down', { status: 502 }), 'off');
    expect(await (await loginGate(home(false), env)).text()).toBe(PAGE);
    expect(asked).toEqual({ arcade: 0, assets: 1 });
  });
});

describe('json、readJson', () => {
  const post = (body: string, headers: Record<string, string> = {}) => new Request('https://game.example.com/x', { method: 'POST', body, headers });

  it('readJson：要带 content-length 且 1 到 maxBytes 字节才读，不是 JSON 回 null', async () => {
    expect(await readJson(post('{"a":1}', { 'content-length': '7' }), 64)).toEqual({ a: 1 });
    expect(await readJson(post('{"a":1}', { 'content-length': '7' }), 6)).toBeNull();
    expect(await readJson(post('nope', { 'content-length': '4' }), 64)).toBeNull();
    expect(await readJson(new Request('https://game.example.com/x'), 64)).toBeNull();
  });

  it('json：带状态码、Set-Cookie，不缓存', async () => {
    const res = json({ ok: true }, 201, ['a=1', 'b=2']);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });
});
