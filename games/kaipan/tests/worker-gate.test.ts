import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GATED_PATHS, LOGIN_URL, handle, type Env, type Fetcher } from '../src/worker/gate.ts';
import worker from '../src/worker/index.ts';

/** 0.5.6 登录闸门：平台的 /api/me 用假的服务绑定代替。 */

const HOME = 'https://game.example.com/games/kaipan/';

function assets(): Fetcher & { calls: Request[] } {
  const calls: Request[] = [];
  return {
    calls,
    fetch: async (req: Request) => {
      calls.push(req);
      return new Response('<!doctype html>game', { status: 200, headers: { 'Content-Type': 'text/html', 'Cache-Control': 'public, max-age=60' } });
    },
  };
}

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

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const LOGGED_IN = { user: { id: 'u1', username: 'zy', displayName: 'zy' }, service: 'ok', saves: 'ok' };
const LOGGED_OUT = { user: null, service: 'ok', saves: 'ok' };

function req(path = '/games/kaipan/', headers: Record<string, string> = {}): Request {
  return new Request(`https://game.example.com${path}`, { headers });
}

describe('登录闸门（GATE=login）', () => {
  it('登录了：放行到静态资源，并且不缓存', async () => {
    const a = assets();
    const res = await handle(req(), { ASSETS: a, ARCADE: arcade(() => json(LOGGED_IN)), GATE: 'login' });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('game');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(a.calls).toHaveLength(1);
  });

  it('没登录：302 到登录页，不碰静态资源', async () => {
    const a = assets();
    const res = await handle(req(), { ASSETS: a, ARCADE: arcade(() => json(LOGGED_OUT)), GATE: 'login' });
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe(LOGIN_URL);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(a.calls).toHaveLength(0);
  });

  it('平台续期下发的 Set-Cookie 原样带回给浏览器（放行和跳登录页都带），多条不合并', async () => {
    const withCookies = (body: unknown) => (): Response => {
      const r = json(body);
      r.headers.append('Set-Cookie', 'sid=abc; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax');
      r.headers.append('Set-Cookie', 'csrf=def; Max-Age=2592000; Path=/; Secure; SameSite=Lax');
      return r;
    };
    const pass = await handle(req(), { ASSETS: assets(), ARCADE: arcade(withCookies(LOGGED_IN)), GATE: 'login' });
    expect(pass.status).toBe(200);
    expect(pass.headers.getSetCookie()).toEqual(['sid=abc; Max-Age=2592000; Path=/; HttpOnly; Secure; SameSite=Lax', 'csrf=def; Max-Age=2592000; Path=/; Secure; SameSite=Lax']);
    const out = await handle(req(), { ASSETS: assets(), ARCADE: arcade(withCookies(LOGGED_OUT)), GATE: 'login' });
    expect(out.status).toBe(302);
    expect(out.headers.getSetCookie()).toHaveLength(2);
    // 平台没下发时不凭空加
    const plain = await handle(req(), { ASSETS: assets(), ARCADE: arcade(() => json(LOGGED_IN)), GATE: 'login' });
    expect(plain.headers.getSetCookie()).toEqual([]);
  });

  it('平台不可用时不带平台的 Set-Cookie（503 页面不该动登录状态）', async () => {
    const ar = arcade(() => {
      const r = json({ error: 'x' }, 500);
      r.headers.append('Set-Cookie', 'sid=; Max-Age=0; Path=/');
      return r;
    });
    const res = await handle(req(), { ASSETS: assets(), ARCADE: ar, GATE: 'login' });
    expect(res.status).toBe(503);
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it('只转发 Cookie 和 cf-connecting-ip，用 GET 问 /api/me', async () => {
    const ar = arcade(() => json(LOGGED_IN));
    await handle(req('/games/kaipan/', { Cookie: 'sid=abc', 'cf-connecting-ip': '1.2.3.4', 'User-Agent': 'x', Authorization: 'Bearer y', Referer: 'z' }), { ASSETS: assets(), ARCADE: ar, GATE: 'login' });
    expect(ar.calls).toHaveLength(1);
    const sent = ar.calls[0]!;
    expect(sent.method).toBe('GET');
    expect(new URL(sent.url).pathname).toBe('/api/me');
    // 地址按请求自己的 origin 拼，代码里不写站点地址
    expect(new URL(sent.url).origin).toBe('https://game.example.com');
    expect([...sent.headers.keys()].sort()).toEqual(['cf-connecting-ip', 'cookie']);
    expect(sent.headers.get('cookie')).toBe('sid=abc');
  });

  const down: [string, Partial<Env>][] = [
    ['平台回 500', { ARCADE: arcade(() => json({ error: 'x' }, 500)) }],
    ['平台回 503（熔断）', { ARCADE: arcade(() => json(LOGGED_IN, 503)) }],
    ['平台回的不是 JSON', { ARCADE: arcade(() => new Response('<html>oops</html>', { status: 200 })) }],
    ['JSON 里没有 user', { ARCADE: arcade(() => json({ service: 'ok' })) }],
    ['user 是奇怪的值', { ARCADE: arcade(() => json({ user: 'admin' })) }],
    ['绑定抛错（平台下线）', { ARCADE: arcade(() => Promise.reject(new Error('no such service'))) }],
    ['没配服务绑定', {}],
  ];
  for (const [name, env] of down) {
    it(`平台不可用：${name} → 503，不放行`, async () => {
      const a = assets();
      const res = await handle(req(), { ASSETS: a, GATE: 'login', ...env });
      expect(res.status).toBe(503);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      const html = await res.text();
      expect(html).toContain('服务器有点忙，过一会儿再来');
      expect(html).toContain('href="/"');
      expect(a.calls).toHaveLength(0);
    });
  }

  it('平台超时（不理会中止信号也一样）：按时放弃，503', async () => {
    const a = assets();
    const hang = arcade(() => new Promise<Response>(() => {}));
    const t0 = Date.now();
    const res = await handle(req(), { ASSETS: a, ARCADE: hang, GATE: 'login' }, 50);
    expect(res.status).toBe(503);
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(a.calls).toHaveLength(0);
  });

  it('响应头回来了、响应体迟迟不来：也按超时算', async () => {
    const a = assets();
    const slowBody = arcade(() => new Response(new ReadableStream({ start() {} }), { status: 200 }));
    const res = await handle(req(), { ASSETS: a, ARCADE: slowBody, GATE: 'login' }, 50);
    expect(res.status).toBe(503);
    expect(a.calls).toHaveLength(0);
  });

  it('三个首页路径都过闸门，其他路径（js、图片）直接给静态资源、不问平台', async () => {
    for (const p of GATED_PATHS) {
      const res = await handle(req(p), { ASSETS: assets(), ARCADE: arcade(() => json(LOGGED_OUT)), GATE: 'login' });
      expect(res.status, p).toBe(302);
    }
    const ar = arcade(() => json(LOGGED_OUT));
    const res = await handle(req('/games/kaipan/assets/index-abc.js'), { ASSETS: assets(), ARCADE: ar, GATE: 'login' });
    expect(res.status).toBe(200);
    expect(ar.calls).toHaveLength(0);
  });

  it('GATE 写错（不是 off）也按要登录处理', async () => {
    const res = await handle(req(), { ASSETS: assets(), ARCADE: arcade(() => json(LOGGED_OUT)), GATE: 'on' });
    expect(res.status).toBe(302);
  });
});

describe('GATE=off（或没配）', () => {
  it('不问平台，原样回静态资源（缓存头也不改）', async () => {
    for (const env of [{ GATE: 'off' }, {}] as Partial<Env>[]) {
      const a = assets();
      const ar = arcade(() => json(LOGGED_OUT));
      const res = await worker.fetch(req(), { ASSETS: a, ARCADE: ar, ...env });
      expect(res.status).toBe(200);
      expect(res.headers.get('Cache-Control')).toBe('public, max-age=60');
      expect(ar.calls).toHaveLength(0);
      expect(a.calls).toHaveLength(1);
    }
  });
});

describe('wrangler.jsonc 和代码一致', () => {
  it('入口模块只导出 default（具名导出会被运行时当成入口点，Worker 起不来）', async () => {
    const mod = await import('../src/worker/index.ts');
    expect(Object.keys(mod)).toEqual(['default']);
  });

  it('run_worker_first 只列首页路径，绑定 ARCADE → arcade，GATE 开着（login）', () => {
    // jsonc：去掉整行注释再解析
    const text = readFileSync('wrangler.jsonc', 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    const cfg = JSON.parse(text) as { main: string; assets: { binding: string; run_worker_first: string[] }; services: { binding: string; service: string }[]; vars: Record<string, string> };
    expect(cfg.main).toBe('src/worker/index.ts');
    expect(cfg.assets.binding).toBe('ASSETS');
    // 首页闸门路径之外，只多一条钱包接口 /api/*
    expect([...cfg.assets.run_worker_first].sort()).toEqual([...GATED_PATHS, '/games/kaipan/api/*'].sort());
    expect(cfg.services).toContainEqual({ binding: 'ARCADE', service: 'arcade' });
    expect(cfg.vars.GATE).toBe('login');
  });
});
