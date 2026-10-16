import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const { version } = JSON.parse(readFileSync(new URL('package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * 页面挂在 /games/mahjong/ 下，资源一律相对路径（build 用 base './'）。
 * 开发时页面也放在 /games/mahjong/，相对路径的 api/ 正好是 /games/mahjong/api/：设了 MAHJONG_WORKER（本地 Worker 的端口）就转过去，
 * 平台的 /api/wallet* 也一起转给它；没设时实盘连不上，娱乐照常。平台的其他 /api 转给平台的本地接口 5181。
 */
export default defineConfig(({ command }) => ({
  base: command === 'build' ? './' : '/games/mahjong/',
  define: { __MAHJONG_VERSION__: JSON.stringify(version) },
  server: {
    host: '0.0.0.0',
    port: 5176,
    strictPort: true,
    proxy: {
      ...(process.env.MAHJONG_WORKER
        ? {
            '/games/mahjong/api': `http://127.0.0.1:${process.env.MAHJONG_WORKER}`,
            '/games/mahjong/rooms': { target: `http://127.0.0.1:${process.env.MAHJONG_WORKER}`, ws: true },
            '/api/wallet': `http://127.0.0.1:${process.env.MAHJONG_WORKER}`,
          }
        : {}),
      '/api': 'http://127.0.0.1:5181',
    },
  },
  preview: { host: '0.0.0.0', port: 4176, strictPort: true },
  build: { target: 'es2022', assetsInlineLimit: 0 },
}));
