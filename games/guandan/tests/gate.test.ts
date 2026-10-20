import { describe, expect, it } from 'vitest';
import worker from '../worker/index.ts';
import * as entry from '../worker/index.ts';
import { GATED_PATHS, GUEST, handle, type Env, type Fetcher } from '../worker/gate.ts';
import { PERSONAS } from '../src/view/art/avatars.ts';
import wranglerText from '../wrangler.jsonc?raw';

const PAGE = 'https://game.example.com/games/guandan/';

/** 静态资源绑定：记下被请求的路径，返回一个带缓存头的首页 */
function assets(): Fetcher & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async fetch(input: Request | string) {
      calls.push(new URL(typeof input === 'string' ? input : input.url).pathname);
      return new Response('<!doctype html>掼蛋', { status: 200, headers: { 'Content-Type': 'text/html', 'Cache-Control': 'no-cache' } });
    },
  };
}

/** 平台绑定：按给定的处理函数返回，并记下收到的请求 */
function arcade(reply: (req: Request) => Promise<Response>): Fetcher & { seen: Request[] } {
  const seen: Request[] = [];
  return {
    seen,
    async fetch(input: Request | string, init?: RequestInit) {
      const req = new Request(input, init);
      seen.push(req);
      return reply(req);
    },
  };
}

/** 平台 /api/me 里的已登录用户：kit 要 id 和昵称都在才认 */
const U = { id: 'u1', displayName: '小王' };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const visit = (path = '/games/guandan/', headers: Record<string, string> = {}) =>
  new Request(`https://game.example.com${path}`, { headers: { Cookie: '__Host-sid=abc', 'cf-connecting-ip': '203.0.113.7', 'User-Agent': 't', Authorization: 'x', ...headers } });

function env(arc: Fetcher | undefined, gate = 'login'): Env & { ASSETS: ReturnType<typeof assets> } {
  return { ASSETS: assets(), ARCADE: arc, GATE: gate };
}

describe('登录闸门（GATE=login）', () => {
  it('已登录：放行到静态资源，并且不让任何地方缓存', async () => {
    const e = env(arcade(async () => json({ user: { id: 'u1', displayName: '小王' }, service: 'ok', saves: 'ok' })));
    const res = await handle(visit(), e);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('掼蛋');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(e.ASSETS.calls).toEqual(['/games/guandan/']);
  });

  it('问平台时只转发 Cookie 和 cf-connecting-ip，用 GET 问 /api/me', async () => {
    const arc = arcade(async () => json({ user: U }));
    await handle(visit(), env(arc));
    expect(arc.seen).toHaveLength(1);
    const req = arc.seen[0]!;
    expect(req.method).toBe('GET');
    expect(req.url).toBe('https://game.example.com/api/me');
    expect([...req.headers.keys()].sort()).toEqual(['cf-connecting-ip', 'cookie']);
    expect(req.headers.get('cookie')).toBe('__Host-sid=abc');
    expect(req.headers.get('cf-connecting-ip')).toBe('203.0.113.7');
  });

  it('未登录点开房间链接：登录页带 next（路径 + 查询原样），登录完回到这个房间（0.6.0 叫朋友来，平台 0.10.1）', async () => {
    const e = env(arcade(async () => json({ user: null, service: 'ok', saves: 'ok' })));
    const res = await handle(visit('/games/guandan/?room=123456'), e);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login?next=%2Fgames%2Fguandan%2F%3Froom%3D123456');
  });

  it('没带平台的会话 cookie：直接 302 到登录页，不问平台', async () => {
    const arc = arcade(async () => json({ user: U }));
    const res = await handle(visit('/games/guandan/', { Cookie: 'other=1' }), env(arc));
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login?next=%2Fgames%2Fguandan%2F');
    expect(arc.seen).toHaveLength(0);
  });

  it('未登录：302 到登录页（next 带回原路径），不碰静态资源', async () => {
    const e = env(arcade(async () => json({ user: null, service: 'ok', saves: 'ok' })));
    const res = await handle(visit(), e);
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login?next=%2Fgames%2Fguandan%2F');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(e.ASSETS.calls).toEqual([]);
  });

  // 以下都要 fail-closed：503 页，绝不放行
  const closed = async (e: ReturnType<typeof env>) => {
    const res = await handle(visit(), e);
    expect(res.status).toBe(503);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const html = await res.text();
    expect(html).toContain('暂时确认不了你登录没有');
    expect(html).toContain('href="/"');
    expect(e.ASSETS.calls).toEqual([]);
  };

  it('平台返回 503：不放行', async () => {
    await closed(env(arcade(async () => json({ error: 'busy' }, 503))));
  });

  it('平台返回别的非 200（比如 302、500）：不放行', async () => {
    await closed(env(arcade(async () => new Response(null, { status: 302, headers: { Location: '/' } }))));
    await closed(env(arcade(async () => json({ user: U }, 500))));
  });

  it('平台返回的不是 JSON：不放行', async () => {
    await closed(env(arcade(async () => new Response('<html>出错了</html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))));
  });

  it('JSON 里没有 user 字段、user 不是对象或缺昵称：不放行', async () => {
    await closed(env(arcade(async () => json({ service: 'ok' }))));
    await closed(env(arcade(async () => json({ user: 'admin' }))));
    await closed(env(arcade(async () => json([]))));
    await closed(env(arcade(async () => json({ user: { id: 'u1' } }))));
  });

  // 超时（包括响应体一直不来）由 arcade-kit 的 whoIs 管，测试在 kit 的 auth.test.ts

  it('平台调用直接抛错：不放行', async () => {
    await closed(env(arcade(async () => { throw new Error('network'); })));
  });

  it('没有 ARCADE 绑定：不放行', async () => {
    await closed(env(undefined));
  });

  it('GATE 配错（不是 off 也不是 login）：绑着平台就按 login 处理', async () => {
    const e1 = env(arcade(async () => json({ user: null })), 'Off');
    expect((await handle(visit(), e1)).status).toBe(302);
  });

  it('三个首页路径都检查；别的路径（理论上不会进 Worker）原样交给静态资源', async () => {
    for (const p of GATED_PATHS) {
      const e = env(arcade(async () => json({ user: null })));
      expect((await handle(visit(p), e)).status).toBe(302);
    }
    const arc = arcade(async () => json({ user: null }));
    const e = env(arc);
    const res = await handle(visit('/games/guandan/assets/index-abc.js'), e);
    expect(res.status).toBe(200);
    expect(arc.seen).toHaveLength(0);
  });
});

describe('单独部署（没有 ARCADE，GATE 也不是 login）', () => {
  it('首页放行并发游客 cookie，不碰平台；站点根转到 /games/guandan/', async () => {
    const e: Env & { ASSETS: ReturnType<typeof assets> } = { ASSETS: assets() };
    const res = await handle(visit(), e);
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie().some((c) => c.startsWith('__Host-kit-guest='))).toBe(true);
    const root = await handle(visit('/'), e);
    expect(root.status).toBe(302);
    expect(new URL(root.headers.get('location')!, PAGE).pathname).toBe('/games/guandan/');
  });

  it('绑着平台时站点根不归掼蛋管（交给静态资源，本站的根是平台）', async () => {
    const e = env(arcade(async () => json({ user: U })));
    await handle(visit('/'), e);
    expect(e.ASSETS.calls).toEqual(['/']);
  });

  it('游客昵称挡住的名字就是画面上所有电脑的名字（掼蛋三个、斗地主两个）', () => {
    expect([...(GUEST.reserved ?? [])].sort()).toEqual(Object.values(PERSONAS).map((p) => p.name).sort());
  });
});

describe('GATE=off', () => {
  it('原样交给静态资源，不问平台，不改缓存头', async () => {
    const arc = arcade(async () => json({ user: null }));
    const e = env(arc, 'off');
    const res = await worker.fetch(visit(), e);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(arc.seen).toHaveLength(0);
    expect(e.ASSETS.calls).toEqual(['/games/guandan/']);
  });
});

describe('Worker 入口', () => {
  it('入口模块只有默认导出（具名导出会被 Workers 运行时当成入口，启动失败）', () => {
    expect(Object.keys(entry)).toEqual(['default']);
  });
});

describe('wrangler.jsonc', () => {
  // JSONC：去掉整行注释再解析
  const cfg = JSON.parse(wranglerText.replace(/^\s*\/\/.*$/gm, '')) as {
    main: string;
    vars: { GATE?: string };
    services?: unknown;
    assets: { binding: string; run_worker_first: string[] };
  };
  it('只有站点根和 /api/me（单独部署时由 kit 接）、三个首页路径、房间接口和实盘接口先进 Worker，js、图片等直接走静态资源', () => {
    expect(cfg.assets.run_worker_first).toEqual(['/', '/api/me', ...GATED_PATHS, '/games/guandan/room/*', '/games/guandan/api/stake/*']);
    expect(cfg.assets.binding).toBe('ASSETS');
    // 部署入口是 main.ts（默认导出 + 房间类 Room）；index.ts 只有默认导出，上面的"入口模块"测试查的是它
    expect(cfg.main).toBe('worker/main.ts');
  });
  it('独立配置（0.8.0）：不写 ARCADE、WALLET 和 GATE，本站部署时由部署工具补（GATE=login），见 config.test.ts', () => {
    expect(cfg.services).toBeUndefined();
    expect(cfg.vars.GATE).toBeUndefined();
  });
  it('首页路径以 / 开头，没有通配', () => {
    for (const p of GATED_PATHS) expect(p).toMatch(/^\/games\/guandan(\/|\/index\.html)?$/);
    expect(PAGE.endsWith(GATED_PATHS[1]!)).toBe(true);
  });
});

describe('平台下发的 Set-Cookie（会话续期、清掉失效 cookie）', () => {
  // 两条，其中一条的 Expires 里带逗号：用 headers.get 合并后浏览器拆不回来
  const RENEW = '__Host-sid=new; Path=/; Secure; HttpOnly; SameSite=Lax; Expires=Wed, 18 Nov 2027 08:00:00 GMT';
  const HINT = 'arcade_li=1; Path=/; Secure; SameSite=Lax; Max-Age=34560000';
  const CLEAR = '__Host-sid=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0';
  const withCookies = (body: unknown, cookies: string[], status = 200) => {
    const h = new Headers({ 'Content-Type': 'application/json' });
    for (const c of cookies) h.append('Set-Cookie', c);
    return new Response(JSON.stringify(body), { status, headers: h });
  };

  it('放行时把平台的每一条 Set-Cookie 原样带回浏览器', async () => {
    const res = await handle(visit(), env(arcade(async () => withCookies({ user: U }, [RENEW, HINT]))));
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()).toEqual([RENEW, HINT]);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('跳登录时也带回（失效会话的 cookie 要清掉）', async () => {
    const res = await handle(visit(), env(arcade(async () => withCookies({ user: null }, [CLEAR, HINT]))));
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/login?next=%2Fgames%2Fguandan%2F');
    expect(res.headers.getSetCookie()).toEqual([CLEAR, HINT]);
  });

  it('平台没下发就不带', async () => {
    const res = await handle(visit(), env(arcade(async () => json({ user: U }))));
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it('平台不可用（503，或 200 但内容不对）时不带平台的 cookie', async () => {
    const r1 = await handle(visit(), env(arcade(async () => withCookies({ error: 'busy' }, [CLEAR], 503))));
    expect(r1.status).toBe(503);
    expect(r1.headers.getSetCookie()).toEqual([]);
    const r2 = await handle(visit(), env(arcade(async () => withCookies({ user: 'x' }, [RENEW]))));
    expect(r2.status).toBe(503);
    expect(r2.headers.getSetCookie()).toEqual([]);
  });
});

describe('房间路由交给 kit 的 env（0.12.4 审计）', () => {
  /** 假的房间命名空间：只记有没有被碰到（真开房走 RPC，这里不该走到） */
  function rooms(): DurableObjectNamespace & { touched: number } {
    const ns = {
      touched: 0,
      idFromName() {
        ns.touched++;
        throw new Error('不该开房');
      },
    };
    return ns as unknown as DurableObjectNamespace & { touched: number };
  }
  const create = (body?: string, headers: Record<string, string> = {}) =>
    new Request('https://game.example.com/games/guandan/room/rooms', {
      method: 'POST',
      headers: { Origin: 'https://game.example.com', Cookie: '__Host-sid=abc', ...(body ? { 'content-type': 'application/json', 'content-length': String(new TextEncoder().encode(body).length) } : {}), ...headers },
      ...(body ? { body } : {}),
    });

  it('GATE=login 却没绑 ARCADE：开房按平台不可用拒绝，不退成游客', async () => {
    const ROOM = rooms();
    const res = await handle(create(), { ASSETS: assets(), GATE: 'login', ONLINE: 'on', ROOM });
    expect(res.status).toBe(503);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(ROOM.touched).toBe(0);
  });

  it('开房的请求体超过 512 字节不解析（按娱乐房交给 kit，认人照样先做）', async () => {
    const ROOM = rooms();
    const big = JSON.stringify({ stake: 'small', pad: 'x'.repeat(600) });
    const res = await handle(create(big), { ASSETS: assets(), GATE: 'login', ONLINE: 'on', ROOM, ARCADE: arcade(async () => json({ user: null })) });
    expect(res.status).toBe(401);
    expect(ROOM.touched).toBe(0);
  });

  it('小的 { stake } 照样认：没有钱包回 409 no_wallet', async () => {
    const res = await handle(create(JSON.stringify({ stake: 'small' })), { ASSETS: assets(), GATE: 'login', ONLINE: 'on', ROOM: rooms(), ARCADE: arcade(async () => json({ user: U })) });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'no_wallet' });
  });
});
