import { describe, expect, it } from 'vitest';
import type { Env, Fetcher } from '../src/worker/gate.ts';
import { route } from '../src/worker/route.ts';
import pkg from '../package.json' with { type: 'json' };

/** /games/kaipan/health：监控用，走在登录闸门前面，不问平台、不碰静态资源，单独部署和本站都一样回。 */

const ORIGIN = 'https://kaipan.someone.workers.dev';

function never(): Fetcher & { calls: number } {
  const f = {
    calls: 0,
    fetch: async (): Promise<Response> => {
      f.calls++;
      return new Response('should not be called', { status: 500 });
    },
  };
  return f;
}

describe('健康检查', () => {
  it('单独部署：回 ok 和版本号，不缓存', async () => {
    const a = never();
    const res = await route(new Request(`${ORIGIN}/games/kaipan/health`), { ASSETS: a } as unknown as Env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, version: pkg.version });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(a.calls).toBe(0);
  });

  it('本站（GATE=login）没登录也能访问，不问平台', async () => {
    const a = never();
    const p = never();
    const env = { ASSETS: a, ARCADE: p, GATE: 'login' } as unknown as Env;
    const res = await route(new Request(`${ORIGIN}/games/kaipan/health`), env);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(a.calls + p.calls).toBe(0);
  });

  it('只认 GET / HEAD 和这一个路径', async () => {
    const env = { ASSETS: never(), ARCADE: never(), GATE: 'login' } as unknown as Env;
    const res = await route(new Request(`${ORIGIN}/games/kaipan/health`, { method: 'POST' }), env);
    expect(res.status).not.toBe(200);
  });
});
