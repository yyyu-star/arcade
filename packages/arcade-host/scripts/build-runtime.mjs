// 把运行时（src/runtime/*.ts）各打成一个 ES 模块，放进 dist/runtime/，生成器从这里拷进发布目录。
// cloudflare:* 是 workerd 自带的模块，不打进去。
import { rmSync } from 'node:fs';
import { build } from 'esbuild';

rmSync('dist/runtime', { recursive: true, force: true });

await build({
  entryPoints: ['router', 'assets', 'd1', 'd1pg', 'kitstore', 'cron-entry', 'admin'].map((n) => `src/runtime/${n}.ts`),
  outdir: 'dist/runtime',
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  // postgres.js 有 workerd 专用的入口（cf/src，走 cloudflare:sockets）
  conditions: ['workerd', 'worker'],
  mainFields: ['module', 'main'],
  target: 'es2022',
  external: ['cloudflare:*', 'node:*', './main.js', './arcade-host-crons.js'],
  logLevel: 'warning',
});
