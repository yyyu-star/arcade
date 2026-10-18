/**
 * 本地试 Worker 时代替平台的假 arcade（冒烟、`npm run dev:worker`），不部署：
 * cookie __Host-sid=<id> 就认作这个人，没有就是没登录；钱包用 arcade-kit/testing（RPC 和浏览器的 /api/wallet*）。
 */
import { WorkerEntrypoint } from 'cloudflare:workers';
import { walletHttp, type FakeEnv } from 'arcade-kit/testing';

export { FakeBank, WalletService } from 'arcade-kit/testing';

/** 写成 WorkerEntrypoint：快速匹配的排队凑桌前经 RPC 问平台的屏蔽名单（kit 0.20.0，平台 0.25.0 的 blockedAmong），本地没人屏蔽谁 */
export default class FakeArcade extends WorkerEntrypoint<FakeEnv> {
  blockedAmong(_userIds: string[]): [string, string][] {
    return [];
  }

  override async fetch(request: Request): Promise<Response> {
    const wallet = await walletHttp(request, this.env);
    if (wallet) return wallet;
    const sid = /__Host-sid=([^;]+)/.exec(request.headers.get('cookie') ?? '')?.[1];
    return Response.json({ user: sid ? { id: sid, displayName: `本机${sid}` } : null });
  }
}
