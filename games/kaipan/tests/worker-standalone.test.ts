import { describe, expect, it } from 'vitest';
import { isStandalone, type Env, type Fetcher } from '../src/worker/gate.ts';
import { route } from '../src/worker/route.ts';
import worker from '../src/worker/index.ts';

/**
 * 0.8.0 单独部署：模块里的 wrangler.jsonc 原样部署时没有 ARCADE、WALLET，也没有 GATE。
 * 谁打开都能玩（不问平台），站点根转到游戏，实盘接口一律 501。本站的行为（GATE=login + ARCADE）见 worker-gate / worker-live 两个测试。
 */

const ORIGIN = 'https://kaipan.someone.workers.dev';

function assets(): Fetcher & { calls: Request[] } {
  const calls: Request[] = [];
  return {
    calls,
    fetch: async (req: Request) => {
      calls.push(req);
      return new Response('<!doctype html>game', { status: 200, headers: { 'Content-Type': 'text/html' } });
    },
  };
}

function arcade(): Fetcher & { calls: Request[] } {
  const calls: Request[] = [];
  return {
    calls,
    fetch: async (req: Request) => {
      calls.push(req);
      return new Response(JSON.stringify({ user: null }), { headers: { 'Content-Type': 'application/json' } });
    },
  };
}

const get = (path: string): Request => new Request(ORIGIN + path);
function post(action: string): Request {
  const body = JSON.stringify({ ref: 'kaipan-abcdef12', tier: 'small' });
  return new Request(`${ORIGIN}/games/kaipan/api/live/${action}`, {
    method: 'POST',
    headers: { 'X-Arcade': '1', Origin: ORIGIN, 'content-length': String(body.length) },
    body,
  });
}

describe('怎么算单独部署', () => {
  it('没有 ARCADE 且 GATE 不是 login 才算；GATE=login 漏了 ARCADE 不算（照旧拦下）', () => {
    const a = arcade();
    expect(isStandalone({})).toBe(true);
    expect(isStandalone({ GATE: 'off' })).toBe(true);
    expect(isStandalone({ GATE: 'login' })).toBe(false);
    expect(isStandalone({ ARCADE: a })).toBe(false);
    expect(isStandalone({ ARCADE: a, GATE: 'login' })).toBe(false);
  });
});

describe('单独部署（没有 ARCADE、WALLET、GATE）', () => {
  it('站点根 / 302 到 /games/kaipan/，带上查询串，不缓存', async () => {
    const e: Env = { ASSETS: assets() };
    for (const [path, want] of [['/', '/games/kaipan/'], ['/?seed=abc', '/games/kaipan/?seed=abc']] as const) {
      const res = await worker.fetch(get(path), e);
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe(want);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    }
  });

  it('首页直接放行给静态资源，不问平台、不跳登录', async () => {
    const a = assets();
    for (const p of ['/games/kaipan', '/games/kaipan/', '/games/kaipan/index.html']) {
      const res = await worker.fetch(get(p), { ASSETS: a });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('game');
    }
    expect(a.calls).toHaveLength(3);
  });

  it('实盘接口一律 501 no_wallet（这里没有钱包，不是暂时连不上），不读请求体、不碰任何绑定', async () => {
    for (const action of ['buyin', 'settle', 'refund']) {
      const a = assets();
      const res = await route(post(action), { ASSETS: a }, 50);
      expect(res.status).toBe(501);
      expect(await res.json()).toEqual({ ok: false, error: 'no_wallet' });
      expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      expect(a.calls).toHaveLength(0);
    }
    // 方法、路径不对的照旧先回 405 / 404
    expect((await route(new Request(`${ORIGIN}/games/kaipan/api/live/buyin`), { ASSETS: assets() })).status).toBe(405);
    expect((await route(post('nope'), { ASSETS: assets() })).status).toBe(404);
  });
});

describe('本站（有平台）不受影响', () => {
  it('有 ARCADE 时站点根不归开盘管（交给静态资源），首页照旧问平台', async () => {
    const a = assets();
    const ar = arcade();
    const root = await worker.fetch(get('/'), { ASSETS: a, ARCADE: ar, GATE: 'login' });
    expect(root.status).toBe(200);
    expect(ar.calls).toHaveLength(0);
    const home = await worker.fetch(get('/games/kaipan/'), { ASSETS: a, ARCADE: ar, GATE: 'login' });
    expect(home.status).toBe(302);
    expect(home.headers.get('Location')).toBe('/login?from=kaipan');
    expect(ar.calls).toHaveLength(1);
  });

  it('GATE=login 却漏了 ARCADE：不退成单独部署，首页 503、站点根不转、实盘接口 503', async () => {
    const e: Env = { ASSETS: assets(), GATE: 'login' };
    expect((await worker.fetch(get('/games/kaipan/'), e)).status).toBe(503);
    expect((await worker.fetch(get('/'), e)).status).not.toBe(302);
    const live = await route(post('buyin'), e, 50);
    expect(live.status).toBe(503);
    expect(await live.json()).toEqual({ ok: false, error: 'unavailable' });
  });
});
