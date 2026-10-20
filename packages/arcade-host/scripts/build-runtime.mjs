// 把运行时（src/runtime/*.ts）各打成一个 ES 模块，放进 dist/runtime/，生成器从这里拷进发布目录。
// cloudflare:* 是 workerd 自带的模块，不打进去。
import { build } from 'esbuild';

await build({
  entryPoints: ['router', 'assets', 'd1', 'cron-entry', 'admin'].map((n) => `src/runtime/${n}.ts`),
  outdir: 'dist/runtime',
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2022',
  external: ['cloudflare:*', './main.js', './arcade-host-crons.js'],
  logLevel: 'warning',
});
