/**
 * 本地跑麻将 Worker 的入口（冒烟），不部署：线上 /api/* 由路由直接到平台，
 * 本地只有麻将这一个 Worker 对外，浏览器的 /api/me、/api/wallet*、好友的 /api/presence、/api/invites、/api/friends 和名场面的 /api/feed 这里转给假平台（test/arcade.dev.ts）。
 */
import worker, { type Env } from '../worker/main.ts';

export { RoomMeter, MahjongRoom, Queue } from '../worker/main.ts';

const PLATFORM = new Set(['/api/me', '/api/wallet', '/api/presence', '/api/invites', '/api/friends', '/api/feed']);

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (PLATFORM.has(path) || path.startsWith('/api/wallet/')) return env.ARCADE!.fetch(request);
    return worker.fetch(request as Parameters<typeof worker.fetch>[0], env);
  },
};
