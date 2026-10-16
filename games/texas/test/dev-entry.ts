/**
 * 本地跑德州 Worker 的入口（冒烟、npm run dev:worker），不部署：线上 /api/* 由路由直接到平台，
 * 本地只有德州这一个 Worker 对外，浏览器的 /api/wallet* 这里转给假平台（test/arcade.dev.ts）。
 */
import worker, { type Env } from '../worker/main.ts';

export { RoomMeter, TexasRoom } from '../worker/main.ts';

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === '/api/wallet' || path.startsWith('/api/wallet/')) return env.ARCADE!.fetch(request);
    return worker.fetch(request as Parameters<typeof worker.fetch>[0], env);
  },
};
