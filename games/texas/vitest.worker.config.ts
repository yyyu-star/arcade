import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

/**
 * Worker 和钱包的测试跑在本地 workerd（miniflare）里：真的 Durable Object（SQLite）、真的闹钟、kit 的计量。
 * 平台的 /api/me 用假的服务绑定代替：cookie 里 __Host-sid=<id> 就认作这个人；
 * "anon" 是会话失效（user: null，带清 cookie），"renew" 认人并带续期的 Set-Cookie，"bad" 回 503，"junk" 回不是 JSON 的 200。
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './test/wrangler.test.jsonc' },
      miniflare: {
        serviceBindings: {
          ARCADE(request: Request): Response {
            const url = new URL(request.url);
            if (url.origin !== 'https://game.example.com' || url.pathname !== '/api/me') return new Response('not found', { status: 404 });
            const sid = /__Host-sid=([^;]+)/.exec(request.headers.get('cookie') ?? '')?.[1];
            if (sid === 'bad') return new Response('down', { status: 503 });
            if (sid === 'junk') return new Response('<html>', { status: 200 });
            if (sid === 'anon') return Response.json({ user: null }, { headers: { 'set-cookie': '__Host-sid=; Max-Age=0; Path=/; Secure; HttpOnly' } });
            const headers = sid === 'renew' ? { 'set-cookie': '__Host-sid=renew; Max-Age=34560000; Path=/; Secure; HttpOnly' } : undefined;
            return Response.json({ user: { id: sid, displayName: `玩家${sid}` } }, { headers });
          },
        },
      },
    }),
  ],
  test: { include: ['test/worker/**/*.test.ts'], fsModuleCache: false },
});
