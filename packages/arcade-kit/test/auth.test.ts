/** 认人（auth.ts）：只转发 cookie 和 IP；"没登录"和"平台暂时不可用"（超时、不是 JSON、缺昵称、平台出错、没有绑定）分开报，两种都拒绝。 */
import { describe, expect, it } from 'vitest';
import { sameOrigin, whoIs } from '../src/auth.ts';
import { SESSION_COOKIE } from '../src/internal.ts';

const req = (headers: Record<string, string> = {}) => new Request('https://game.example.com/rooms/123456/ws', { headers });
/** 带着平台会话 cookie 的请求（没有它 whoIs 根本不问平台） */
const signedIn = () => req({ cookie: `other=1; ${SESSION_COOKIE}=abc` });

/** 假的平台绑定：记下收到的请求，回指定的响应。 */
function fakeArcade(reply: (r: Request) => Response | Promise<Response>) {
  const got: Request[] = [];
  const fetcher = {
    fetch: (input: RequestInfo | URL, init?: RequestInit) => {
      const r = new Request(input, init);
      got.push(r);
      return Promise.resolve(reply(r));
    },
  } as unknown as Fetcher;
  return { fetcher, got };
}

describe('whoIs', () => {
  it('认出来：只转发 Cookie 和 cf-connecting-ip，别的头（含伪造的 x-kit-user）不转', async () => {
    const { fetcher, got } = fakeArcade(() => Response.json({ user: { id: 'u1', displayName: '小王' } }));
    const me = await whoIs(req({ cookie: `${SESSION_COOKIE}=abc`, 'cf-connecting-ip': '1.2.3.4', 'x-kit-user': 'forged', authorization: 'x' }), fetcher);
    expect(me).toEqual({ user: { userId: 'u1', name: '小王' }, setCookie: [] });
    // 地址按请求自己的 origin 拼（0.9.0：kit 不写死站点）
    expect(got[0]!.url).toBe('https://game.example.com/api/me');
    expect([...got[0]!.headers.keys()].sort()).toEqual(['cf-connecting-ip', 'cookie']);
  });

  it('meUrl 可以覆盖默认地址', async () => {
    const { fetcher, got } = fakeArcade(() => Response.json({ user: null }));
    await whoIs(signedIn(), fetcher, { meUrl: 'https://platform.example.com/api/me' });
    expect(got[0]!.url).toBe('https://platform.example.com/api/me');
  });

  it('没带平台会话 cookie：直接算没登录，不问平台（别的 cookie、空值、名字只是相近的都不算）', async () => {
    const { fetcher, got } = fakeArcade(() => Response.json({ user: { id: 'u1', displayName: 'x' } }));
    for (const cookie of [undefined, '', 'other=1', `${SESSION_COOKIE}=`, `${SESSION_COOKIE}= ; a=b`, `x${SESSION_COOKIE}=abc`, `${SESSION_COOKIE}x=abc`]) {
      expect(await whoIs(req(cookie === undefined ? {} : { cookie }), fetcher), String(cookie)).toEqual({ error: 'anonymous', setCookie: [] });
    }
    // 平台绑定不存在也一样（没登录优先）
    expect(await whoIs(req(), undefined)).toEqual({ error: 'anonymous', setCookie: [] });
    expect(got).toHaveLength(0);
    // 夹在别的 cookie 中间也认得出来
    expect(await whoIs(req({ cookie: `a=1; ${SESSION_COOKIE}=abc; b=2` }), fetcher)).toEqual({ user: { userId: 'u1', name: 'x' }, setCookie: [] });
    expect(got).toHaveLength(1);
  });

  it('平台续期、清失效会话时回的 Set-Cookie 带回来（认出来和没登录都带；不可用时没有）', async () => {
    const renew = '__Host-sid=abc; Max-Age=34560000; Path=/; Secure; HttpOnly';
    const clear = ['__Host-sid=; Max-Age=0; Path=/; Secure; HttpOnly', '__Host-arcade_li=; Max-Age=0; Path=/; Secure'];
    const ok = fakeArcade(() => Response.json({ user: { id: 'u1', displayName: 'x' } }, { headers: { 'set-cookie': renew } })).fetcher;
    expect(await whoIs(signedIn(), ok)).toEqual({ user: { userId: 'u1', name: 'x' }, setCookie: [renew] });
    const gone = fakeArcade(() => {
      const h = new Headers();
      for (const c of clear) h.append('set-cookie', c);
      return Response.json({ user: null }, { headers: h });
    }).fetcher;
    expect(await whoIs(signedIn(), gone)).toEqual({ error: 'anonymous', setCookie: clear });
    expect(await whoIs(signedIn(), fakeArcade(() => new Response('down', { status: 503, headers: { 'set-cookie': renew } })).fetcher)).toEqual({ error: 'unavailable' });
  });

  it('没登录：anonymous', async () => {
    expect(await whoIs(signedIn(), fakeArcade(() => Response.json({ user: null })).fetcher)).toEqual({ error: 'anonymous', setCookie: [] });
  });

  it('平台暂时不可用（unavailable）：503、429、不是 JSON、没有 user 字段、缺昵称、id 为空、没有绑定、抛错', async () => {
    const replies: (() => Response)[] = [
      () => new Response('down', { status: 503 }),
      () => new Response('slow down', { status: 429 }),
      () => Response.json({}),
      () => new Response('<html>oops</html>', { status: 200 }),
      () => Response.json({ user: { id: 'u1' } }),
      () => Response.json({ user: { id: '', displayName: 'x' } }),
      () => {
        throw new Error('network');
      },
    ];
    for (const r of replies) expect(await whoIs(signedIn(), fakeArcade(r).fetcher)).toEqual({ error: 'unavailable' });
    expect(await whoIs(signedIn(), undefined)).toEqual({ error: 'unavailable' });
  });

  it('平台不回话：到超时就放弃，算 unavailable', async () => {
    const hang = {
      fetch: (_: unknown, init?: RequestInit) =>
        new Promise<Response>((_ok, fail) => init?.signal?.addEventListener('abort', () => fail(init.signal!.reason))),
    } as unknown as Fetcher;
    const t = performance.now();
    expect(await whoIs(signedIn(), hang, { timeoutMs: 50 })).toEqual({ error: 'unavailable' });
    expect(performance.now() - t).toBeLessThan(1_000);
  });
});

describe('sameOrigin', () => {
  it('只认完全相同的 Origin；没带的也拒绝', () => {
    expect(sameOrigin(req({ origin: 'https://game.example.com' }), 'https://game.example.com')).toBe(true);
    expect(sameOrigin(req({ origin: 'https://game.example.com.evil.com' }), 'https://game.example.com')).toBe(false);
    expect(sameOrigin(req({ origin: 'null' }), 'https://game.example.com')).toBe(false);
    expect(sameOrigin(req(), 'https://game.example.com')).toBe(false);
  });

  it('不给站点就认请求自己的 origin（0.9.0）；给了就只认给的', () => {
    expect(sameOrigin(req({ origin: 'https://game.example.com' }))).toBe(true);
    expect(sameOrigin(req({ origin: 'https://evil.example.org' }))).toBe(false);
    expect(sameOrigin(req())).toBe(false);
    expect(sameOrigin(req({ origin: 'https://game.example.com' }), 'https://other.example.com')).toBe(false);
  });
});
