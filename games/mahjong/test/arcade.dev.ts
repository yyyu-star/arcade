/**
 * 本地试 Worker 时代替平台的假 arcade（冒烟 scripts/smoke-room.ts），不部署：
 * cookie __Host-sid=<id> 就认作这个人，没有就是没登录；钱包用 kit 的假钱包 arcade-kit/testing（RPC 和浏览器的 /api/wallet*）；
 * 好友：报位置、问邀请收下就回（没有邀请）；好友列表只有一个在线的"老王"，叫他来就回一个邀请号（冒烟走一遍"叫朋友来"面板）。
 */
import { walletHttp, type FakeEnv } from 'arcade-kit/testing';

export { FakeBank, WalletService } from 'arcade-kit/testing';

export default {
  async fetch(request: Request, env: FakeEnv): Promise<Response> {
    const wallet = await walletHttp(request, env);
    if (wallet) return wallet;
    // 好友（docs/social.md 1.2、1.3，kit 的 social 部件每 2 分钟报位置、每 30 秒问邀请）：报了就收下，没有邀请
    const path = new URL(request.url).pathname;
    if (path === '/api/presence' || path === '/api/feed') return new Response(null, { status: 204 });
    if (path === '/api/invites') return request.method === 'POST' ? Response.json({ id: 'inv-smoke-1' }) : Response.json({ invites: [] });
    if (path === '/api/friends') return Response.json({ friends: [{ userId: 'friend-wang', displayName: '老王', online: true }] });
    const sid = /__Host-sid=([^;]+)/.exec(request.headers.get('cookie') ?? '')?.[1];
    return Response.json({ user: sid ? { id: sid, displayName: `本地${sid}` } : null });
  },
};
