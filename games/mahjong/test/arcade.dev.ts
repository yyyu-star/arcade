/**
 * 本地试 Worker 时代替平台的假 arcade（冒烟 scripts/smoke-room.ts），不部署：
 * cookie __Host-sid=<id> 就认作这个人，没有就是没登录；钱包用 kit 的假钱包 arcade-kit/testing（RPC 和浏览器的 /api/wallet*）；
 * 好友的报位置、问邀请收下就回（没有邀请）。
 */
import { walletHttp, type FakeEnv } from 'arcade-kit/testing';

export { FakeBank, WalletService } from 'arcade-kit/testing';

export default {
  async fetch(request: Request, env: FakeEnv): Promise<Response> {
    const wallet = await walletHttp(request, env);
    if (wallet) return wallet;
    // 好友（docs/social.md 1.2、1.3，kit 的 social 部件每 2 分钟报位置、每 30 秒问邀请）：报了就收下，没有邀请
    const path = new URL(request.url).pathname;
    if (path === '/api/presence') return new Response(null, { status: 204 });
    if (path === '/api/invites') return Response.json({ invites: [] });
    const sid = /__Host-sid=([^;]+)/.exec(request.headers.get('cookie') ?? '')?.[1];
    return Response.json({ user: sid ? { id: sid, displayName: `本地${sid}` } : null });
  },
};
