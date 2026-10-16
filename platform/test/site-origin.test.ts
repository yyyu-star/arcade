/**
 * 站点地址（worker/api/router.ts 的 siteOrigin）：正式部署由工作流注入 SITE_ORIGIN，只认那个主机名；
 * 一键部署（Deploy to Cloudflare）没有这个变量时按请求自己的地址，写请求的同站检查照样挡得住跨站。
 */
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { handleApi, siteOrigin } from '../worker/api/router';
import type { Env } from '../worker/env';

async function fetchWith(e: Env, url: string, init: RequestInit = {}): Promise<number> {
  const ctx = createExecutionContext();
  const res = await handleApi(new Request(url, init), e, ctx);
  await waitOnExecutionContext(ctx);
  return res.status;
}

const logout = (origin: string) => ({ method: 'POST', headers: { 'x-arcade': '1', origin, 'content-type': 'application/json' }, body: '{}' });

describe('站点地址', () => {
  it('设了 SITE_ORIGIN 按它，没设按请求的 origin', () => {
    const url = new URL('https://other.example.com/api/me');
    expect(siteOrigin({ SITE_ORIGIN: 'https://game.example.com' }, url)).toBe('https://game.example.com');
    expect(siteOrigin({}, url)).toBe('https://other.example.com');
    expect(siteOrigin({ SITE_ORIGIN: '' }, url)).toBe('https://other.example.com');
  });

  it('设了 SITE_ORIGIN：别的主机名一律 404', async () => {
    expect(await fetchWith(env as Env, 'https://other.example.com/api/me')).toBe(404);
  });

  it('没设：哪个主机名都认，写请求的 Origin 要等于请求自己的 origin，跨站的照样 403', async () => {
    const e = { ...(env as Env), SITE_ORIGIN: undefined };
    expect(await fetchWith(e, 'https://other.example.com/api/me')).toBe(200);
    expect(await fetchWith(e, 'https://other.example.com/api/auth/logout', logout('https://evil.example.com'))).toBe(403);
    expect(await fetchWith(e, 'https://other.example.com/api/auth/logout', logout('https://other.example.com'))).toBe(204);
  });
});
