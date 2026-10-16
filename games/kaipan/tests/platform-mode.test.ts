import { describe, expect, it } from 'vitest';
import { classify, detectPlatform, onPlatformMode, platformMode, setPlatformMode, standalone } from '../src/platform/mode.ts';

/** 0.8.0 有没有平台：问同域 /api/me 的回话怎么下结论（和共用包 detectPlatform 的说法一致）。 */

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('按 /api/me 的回话下结论', () => {
  it.each([
    ['有平台、登录着', json({ user: { id: 'u1' }, service: 'ok' }), 'platform'],
    ['有平台、没登录', json({ user: null, service: 'ok' }), 'platform'],
    ['404（单独部署时静态资源回的）', new Response('not found', { status: 404 }), 'standalone'],
    ['405', new Response('', { status: 405 }), 'standalone'],
    ['200 但回的是网页', new Response('<!doctype html>', { status: 200, headers: { 'Content-Type': 'text/html' } }), 'standalone'],
    ['JSON 但不是平台的样子', json({ hello: 1 }), 'standalone'],
    ['JSON 数组', json([{ user: 1 }]), 'standalone'],
    ['503（平台抖了一下）', json({ error: 'busy' }, 503), 'unknown'],
    ['429', new Response('', { status: 429 }), 'unknown'],
    ['说是 JSON 却读不出来', new Response('{oops', { status: 200, headers: { 'Content-Type': 'application/json' } }), 'unknown'],
  ] as const)('%s → %s', async (_, res, want) => {
    expect(await classify(res)).toBe(want);
  });
});

describe('启动时问一次，结论变了通知一次', () => {
  it('问的是同域 /api/me；断网、超时算不知道，按有平台处理', async () => {
    setPlatformMode('unknown');
    const seen: string[] = [];
    const off = onPlatformMode((m) => seen.push(m));
    let url = '';
    const fake = (async (u: string) => {
      url = u;
      throw new TypeError('offline');
    }) as unknown as typeof fetch;
    expect(await detectPlatform(fake)).toBe('unknown');
    expect(url).toBe('/api/me');
    expect(standalone()).toBe(false);
    expect(seen).toEqual([]);

    expect(await detectPlatform((async () => new Response('', { status: 404 })) as unknown as typeof fetch)).toBe('standalone');
    expect(platformMode()).toBe('standalone');
    expect(standalone()).toBe(true);
    expect(seen).toEqual(['standalone']);
    off();
    setPlatformMode('unknown');
  });
});
