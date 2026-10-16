import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const { version } = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * 页面挂在 /games/texas/ 下，资源一律相对路径（build 用 base './'）。
 * 开发时页面也放在 /games/texas/，相对路径的 api/ 正好是 /games/texas/api/：设了 TEXAS_WORKER（本地 Worker 的端口）就转过去，
 * 平台的 /api/wallet* 也一起转给它（Worker 本地的入口再转给假平台，看到的钱包和单机带入结回是同一个）；没设时实盘可能连不上，娱乐照常。
 * 平台的其他 /api（登录、云存档）转给平台的本地接口 5181（平台模块 npm run dev:api）。
 * 带钱包整套试用更省事的办法是 npm run build:cf 后 npm run dev:worker（Worker 直接带着页面）。
 */
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/games/texas/',
  define: { __TEXAS_VERSION__: JSON.stringify(version) },
  server: {
    host: '0.0.0.0',
    port: 5175,
    strictPort: true,
    proxy: {
      ...(process.env.TEXAS_WORKER
        ? { '/games/texas/api': `http://127.0.0.1:${process.env.TEXAS_WORKER}`, '/api/wallet': `http://127.0.0.1:${process.env.TEXAS_WORKER}` }
        : {}),
      '/api': 'http://127.0.0.1:5181',
    },
  },
  preview: { host: '0.0.0.0', port: 4175, strictPort: true },
  build: { target: 'es2022', assetsInlineLimit: 0 },
}));
