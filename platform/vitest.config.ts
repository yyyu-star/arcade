import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// 测试跑在本地 workerd（miniflare）里，D1 是本地库，不碰线上。每个测试文件开头应用 migrations/。
export default defineConfig(async () => {
  const migrations = await readD1Migrations('./migrations');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            SITE_ORIGIN: 'https://game.test',
            PEPPER_PW: 't1:test-pepper-pw-0123456789',
            PEPPER_RC: 't1:test-pepper-rc-0123456789',
            PEPPER_SID: 't1:test-pepper-sid-0123456789',
            PEPPER_IP: 't1:test-pepper-ip-0123456789',
            // 总闸听开关；大多数用例要注册普通用户，resetAll 会把 D1 的开关设成打开，关闭注册的用例自己改（test/admin.test.ts）
            REGISTRATION: 'switch',
            ADMIN_TOKEN: 't1:test-admin-token-0123456789abcdef',
          },
          // 巡检会去查各游戏的 /games/<id>/health（worker/api/monitor.ts）：测试里不出网，按固定的几种回答（test/monitor.test.ts）
          outboundService: (request: Request) => {
            const path = new URL(request.url).pathname;
            if (path === '/games/texas/health') return Response.json({ ok: true, version: '9.9.9' });
            if (path === '/games/yexun/health') return new Response('boom', { status: 500 });
            return new Response('not found', { status: 404 });
          },
        },
      }),
    ],
    // vitest 5 默认把转换缓存放在 node_modules/.vitest-cache，workerd 不读点开头的目录，所以关掉。
    test: { include: ['test/**/*.test.ts'], setupFiles: ['./test/setup.ts'], fsModuleCache: false },
  };
});
