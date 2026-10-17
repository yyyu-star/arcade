/**
 * 游戏用的钱包 RPC（docs/platform-backend.md 5.9，docs/economy.md 第 3 节）。只能经服务绑定调，公网和浏览器都碰不到：
 *
 * ```jsonc
 * // 游戏的 wrangler.jsonc
 * "services": [{ "binding": "WALLET", "service": "arcade", "entrypoint": "WalletService", "props": { "game": "texas" } }]
 * ```
 *
 * - 谁能调：只有本账号里的 Worker 能声明到这个 Worker 的服务绑定（Cloudflare 文档：service "must be on your Cloudflare account"）。
 *   绑定上必须写 props.game，参数里的 game 必须和它一致；没写或不一致一律回 bad_game（看钱包也一样），不靠审阅时记得查。
 *   props 只能由部署那个游戏的人写进它自己的配置，游戏代码在运行时改不了，所以一个游戏的代码写错了也冒充不了别的游戏。
 *   账号里的 Worker 都经 PR 审阅后由 CI 部署，信任边界就是这个账号。
 * - 计量和熔断和 /api 一样：每次调用算平台 1 次调用；写入记在"钱包"类。停服档全停；只读档、钱包类预算用完时停带入（和领补给），
 *   结回、放弃照收：桌上的筹码总要能回来。停增长档不建新钱包。
 * - 业务上的拒绝都用返回值（{ ok: false, error }），不抛异常：RPC 抛出去的异常只保证 name 和 message。
 */
import { feedFromSettle } from './api/feed';
import { parseTogether, recordTogether } from './api/mates';
import { WorkerEntrypoint } from 'cloudflare:workers';
import { GAME_IDS } from '../src/games';
import { limitsOf } from './api/config';
import { d1Trouble, Db, newStats, type RequestStats } from './api/db';
import { effectiveTier, meter } from './api/meter';
import { isUserIdShape } from './api/context';
import { type Cmd, parseCmd } from './api/wallet';
import { runOp, viewWallet, type WalletReply } from './api/wallet-store';
import type { Env } from './env';

/** 绑定上写的 props（游戏自己的 wrangler.jsonc），game 必须写 */
interface Props {
  game?: string;
}

/** 最近一次 RPC 调用的读写统计。只给测试断言写入行数用（同一 isolate 里读得到）。 */
export let lastWalletStats: RequestStats = newStats();

/** together() 的回话：记上了几对 */
export type TogetherReply = { ok: true; pairs: number } | { ok: false; error: 'bad_request' | 'bad_game' | 'busy' | 'internal' };

/** 带入：会让筹码离开余额，按只读档、钱包预算停；回：结回、放弃，任何时候都收（停服档除外）；看：不停；
 *  搭子：搭子战绩，记在排行榜类，只在正常档、排行榜类预算没用完时写 */
type Kind = 'view' | 'stake' | 'return' | 'mates';

export class WalletService extends WorkerEntrypoint<Env, Props> {
  /** 看钱包：余额、各游戏桌上那一份、今天能不能领补给、还能写几次、client 模式的净赢和上限 */
  async view(userId: string): Promise<WalletReply> {
    if (!this.#bound()) return { ok: false, error: 'bad_game' };
    if (!isUserIdShape(userId)) return { ok: false, error: 'bad_request' };
    return this.#run('view', (db, now, tier) => viewWallet(db, userId, now, { write: tier === 'normal' || tier === 'noGrowth' }));
  }

  /** 带入 { userId, game, ref, tier, amount, until, mode, op } */
  async buyin(req: unknown): Promise<WalletReply> {
    return this.#op('buyin', req, 'stake');
  }

  /** 结回 { userId, game, ref, amount, mode, op, stats? }：回话里 credited 是进了钱包的，capped 是超出 client 模式每日上限、没进钱包的；
   *  stats 是这一份的战绩小结（docs/platform-backend.md 5.10），不合格时整份忽略、回 statsIgnored，钱照常结 */
  async settle(req: unknown): Promise<WalletReply> {
    return this.#op('settle', req, 'return');
  }

  /** 放弃 { userId, game, ref, mode, op }：没打就走，那一份原样退回 */
  async refund(req: unknown): Promise<WalletReply> {
    return this.#op('refund', req, 'return');
  }

  /**
   * 搭子战绩（0.19.0，docs/platform-backend.md 15.19）{ op, players: [{ userId, team?, win }] }：好友房打完一场，房间的服务端报一次整桌真人，
   * 平台给其中已经是好友的每一对累计。浏览器碰不到（只有这条服务绑定）。回话 pairs 是记上的对数；写不了回 busy，游戏不用重试
   */
  async together(req: unknown): Promise<TogetherReply> {
    const bound = this.#bound();
    if (!bound) return { ok: false, error: 'bad_game' };
    const parsed = parseTogether(req);
    if (!parsed) return { ok: false, error: 'bad_request' };
    return this.#run('mates', async (db, now) => ({ ok: true, pairs: await recordTogether(db.as('board'), bound, parsed, now) }));
  }

  // 内部方法用 JS 私有方法（#）：TS 的 private 在运行时仍在原型上，会经 RPC 暴露，游戏就能直接调 op(…, 'return') 绕过只读档对带入的拦截
  #op(t: 'buyin' | 'settle' | 'refund', req: unknown, kind: Kind): Promise<WalletReply> {
    const bound = this.#bound();
    if (!bound) return Promise.resolve({ ok: false, error: 'bad_game' });
    const userId = (req as { userId?: unknown } | null)?.userId;
    if (!isUserIdShape(userId)) return Promise.resolve({ ok: false, error: 'bad_request' });
    const cmd = parseCmd(t, req);
    if (typeof cmd === 'string') return Promise.resolve({ ok: false, error: cmd });
    if ((cmd as Exclude<Cmd, { t: 'relief' } | { t: 'admin' }>).game !== bound) return Promise.resolve({ ok: false, error: 'bad_game' });
    return this.#run(kind, (db, now, tier) =>
      runOp(db, userId, cmd, now, {
        create: tier === 'normal',
        // 好友动态（0.17.0）记在"在线"类：只读档、在线类预算用完就不发；写出错只记日志，结回照常
        onFeed: async (feed) => {
          const limits = limitsOf(this.env);
          if (tier !== 'normal' || meter.exhausted('live', limits, now)) return;
          try {
            await feedFromSettle(db.as('live'), userId, feed, now, limits);
          } catch (e) {
            console.error('feed from settle failed', e instanceof Error ? e.name : 'unknown');
          }
        },
      }),
    );
  }

  /** 绑定上写的游戏；没写、写的不是认识的游戏都算没绑 */
  #bound(): string | null {
    const game = this.ctx.props?.game;
    return typeof game === 'string' && GAME_IDS.has(game) ? game : null;
  }

  async #run<R extends { ok: boolean }>(kind: Kind, fn: (db: Db, now: number, tier: string) => Promise<R>): Promise<R | { ok: false; error: 'busy' | 'internal' }> {
    const env = this.env;
    const now = Date.now();
    const limits = limitsOf(env);
    const stats = newStats();
    lastWalletStats = stats;
    const db = new Db(env.DB, stats, 'wallet');
    meter.countCall();
    let tier: ReturnType<typeof effectiveTier> = 'off';
    try {
      await meter.ensureFresh(env.DB, limits, now);
      tier = effectiveTier(env, meter.tier(limits, now));
      if (tier === 'off') return { ok: false, error: 'busy' };
      if (kind === 'stake' && (tier === 'readonly' || meter.exhausted('wallet', limits, now))) return { ok: false, error: 'busy' };
      if (kind === 'mates' && (tier !== 'normal' || meter.exhausted('board', limits, now))) return { ok: false, error: 'busy' };
      return await fn(db, now, tier);
    } catch (e) {
      // 只记错误类型，不记参数（里面有 userId）。回话照旧是 internal：游戏拿同一个 op 重发是安全的（wallet.ts 的 apply 去重）
      console.error(d1Trouble(e) ? `wallet rpc d1 ${d1Trouble(e)}` : 'wallet rpc error', e instanceof Error ? e.name : 'unknown');
      return { ok: false, error: 'internal' };
    } finally {
      if (meter.shouldFlush(limits, now, tier)) this.ctx.waitUntil(meter.flush(env.DB, limits, now));
    }
  }
}
