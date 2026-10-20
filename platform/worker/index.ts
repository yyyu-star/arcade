/**
 * 平台的 Worker：静态界面由 ASSETS 提供；/api/* 是账号等接口（api/router.ts，接口约定见仓库根 docs/platform-backend.md 第 15 节）。
 * 各游戏在同一域名下用路径路由挂自己的 Worker，不经过这里。架构见 docs/architecture.md 第 3 节。
 */
import { WorkerEntrypoint } from 'cloudflare:workers';
import { type BlockPair, blockedAmong, blockedAmongStats, parseBlockedAmong } from './api/blocked-among';
import { runCleanup } from './api/cron';
import { d1Trouble, Db, newStats } from './api/db';
import { effectiveTier, meter } from './api/meter';
import { runMonitor } from './api/monitor';
import { handleApi } from './api/router';
import type { Env } from './env';

/** 游戏用的钱包 RPC，只能经服务绑定调（docs/platform-backend.md 5.9） */
export { WalletService } from './wallet-service';

/**
 * 默认入口是一个 WorkerEntrypoint（0.25.0 起；原来是普通对象）：游戏的 `ARCADE` 服务绑定不写 entrypoint，指的就是它，
 * 所以除了 fetch（登录闸门问 /api/me，15.8），这里的公开方法游戏的服务端也能经 RPC 调。只放给服务端用的只读方法
 */
export default class Arcade extends WorkerEntrypoint<Env> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      meter.countCall();
      return handleApi(request, this.env, this.ctx);
    }
    if (url.pathname.startsWith('/games/')) {
      // 有这个游戏时请求由游戏自己的路由接走，到不了这里
      meter.countCall();
      return new Response('没有这个游戏', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    return this.env.ASSETS.fetch(request);
  }

  /**
   * 定时清理。写成实例字段、不写成方法是故意的：RPC 只认原型上的方法（实测：调实例字段报
   * "The RPC receiver's prototype does not implement"），写成方法的话，任何绑了 ARCADE 的游戏都能 env.ARCADE.scheduled(…) 自己触发清理。
   * cron 照常找得到它（wrangler dev --test-scheduled 实测）。时间再兜一层：不信调用方给的，最晚按现在算，
   * 免得有人传一个很远的将来，让会话、邀请这些按时间过期的数据被提前清掉
   */
  scheduled = async (controller: ScheduledController): Promise<void> => {
    const now = cleanupTime(controller?.scheduledTime);
    // 两个 Cron（wrangler.jsonc）：每天那次清理后再巡检一遍、顺带查钱包；每 5 分钟那次只巡检（第 16 节）
    if (controller?.cron === DAILY_CRON) {
      this.ctx.waitUntil(runCleanup(this.env, now).then(() => runMonitor(this.env, now, { wallet: true })));
    } else {
      this.ctx.waitUntil(runMonitor(this.env, now, { wallet: false }));
    }
  };

  /**
   * 这几个人之间谁屏蔽了谁（好友房聊天用，0.25.0，15.8）：回 [屏蔽的人, 被屏蔽的人] 的列表。最多 9 个人、去重、不像用户编号的忽略；
   * 超过 9 个、停服（API_MODE=off）、查询出错都回空列表（不抛异常），房间退回只用本地屏蔽。只读、一行不写，一条查询，算平台 1 次调用
   */
  async blockedAmong(userIds: unknown): Promise<BlockPair[]> {
    const ids = parseBlockedAmong(userIds);
    if (!ids || ids.length < 2) return [];
    const env = this.env;
    const stats = newStats();
    blockedAmongStats.last = stats;
    meter.countCall();
    // 只认手动的停服总闸（API_MODE=off）。不像 /api 那样先同步计量：冷启动时那一步会写一行计量表，而这里答应了一行不写；
    // 调用次数和读的行数照样记进本 isolate 的计量，由别的请求顺带报上去
    if (effectiveTier(env, 'normal') === 'off') return [];
    try {
      return await blockedAmong(new Db(env.DB, stats, 'social'), ids);
    } catch (e) {
      // 只记错误类型，不记参数（里面有 userId）
      console.error(d1Trouble(e) ? `blockedAmong d1 ${d1Trouble(e)}` : 'blockedAmong error', e instanceof Error ? e.name : 'unknown');
      return [];
    }
  }
}

/** 每天清理的那个 Cron，和 wrangler.jsonc 的 triggers 对上 */
const DAILY_CRON = '17 19 * * *';

/** 清理按哪个时间算：调用方给的时间和现在取早的那个；给的不是数（或日期）就按现在 */
function cleanupTime(given: unknown): number {
  const now = Date.now();
  const t = Number(given);
  return Number.isFinite(t) ? Math.min(t, now) : now;
}
