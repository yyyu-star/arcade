import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { SESSION_COOKIE } from './src/internal.ts';

/**
 * 自托管 PG 模式再跑一遍（0.21.0）：同一套测试，只是测试 Worker 多绑了 KIT_STORE（test/fake-pg.ts 的假 PG），kit 走内存镜像 + 异步提交。
 * 下面的说明和 vitest.config.ts 一样：
 * 测试跑在本地 workerd（miniflare）里：真的 Durable Object（SQLite 后端）、真的 WebSocket 休眠接口和闹钟。
 * 平台的 /api/me 用一个假的服务绑定代替：cookie 里 <SESSION_COOKIE>=<userId> 就认作这个人，"bad" 回 503，没带回 user: null。
 */
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './test/wrangler.pg.jsonc' },
      miniflare: {
        serviceBindings: {
          ARCADE(request: Request): Response {
            const sid = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(request.headers.get('cookie') ?? '')?.[1];
            if (sid === 'bad') return new Response('down', { status: 503 });
            if (new URL(request.url).pathname !== '/api/me') return new Response('not found', { status: 404 });
            return Response.json({ user: sid ? { id: sid, displayName: `玩家${sid}` } : null });
          },
        },
      },
    }),
  ],
  test: { include: ['test/**/*.test.ts'], fsModuleCache: false },
});
