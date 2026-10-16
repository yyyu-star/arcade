import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

/** 单独部署（没有平台）的 Worker 测试：本地 workerd，配置是 test/wrangler.standalone.jsonc，不绑假平台 */
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './test/wrangler.standalone.jsonc' } })],
  test: { include: ['test/standalone/**/*.test.ts'], fsModuleCache: false },
});
