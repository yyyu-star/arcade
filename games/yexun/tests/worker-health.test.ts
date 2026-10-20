import { describe, expect, it } from 'vitest';
import { HEALTH_PATH, health } from '../worker/health.ts';
import pkg from '../package.json' with { type: 'json' };

const URL0 = `https://game.example.com${HEALTH_PATH}`;
const call = (method = 'GET', path = HEALTH_PATH) => health(new Request(URL0, { method }), path);

describe('GET /games/yexun/health（平台巡检）', () => {
  it('回 ok 和 package.json 的版本，不缓存', async () => {
    const r = call()!;
    expect(r.status).toBe(200);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(await r.json()).toEqual({ ok: true, version: pkg.version });
  });
  it('HEAD 也回；别的方法、别的路径交给后面的路由', () => {
    expect(call('HEAD')?.status).toBe(200);
    expect(call('POST')).toBeNull();
    expect(call('GET', '/games/yexun/healthz')).toBeNull();
  });
});
