/// <reference types="@cloudflare/workers-types" />
/**
 * 本地联调用的假平台 Worker（名字 arcade，和线上平台一样，掼蛋的服务绑定 ARCADE 直接连到它）。只给 tools/online-dev.ts 用，不部署。
 * - GET /api/me：cookie 里 __Host-sid=<userId> 就认作这个人（昵称"玩家<userId>"），没带回 { user: null }；
 *   __Host-sid=down 回 503，用来试"平台暂时不可用"。
 * - WalletService：钱包 RPC 的假实现（掼蛋的服务绑定 WALLET），账在 Durable Object FakeWalletBank 里，只做掼蛋冒烟要看的几样：
 *   新号 10,000、带入要够一份、同一游戏只有一份（at_table）、按 op 只算一次（dup）、结回清掉那一份（再结回 no_stake）、
 *   client 模式每天净赢最多 3 份（超出的进 capped）。userId 以 "nofunds" 开头的人余额是 0，"busy" 开头的人一律回 busy，
 *   "capped" 开头的人今天已经赢满了（再赢的全进 capped）。
 *   线上的规则以平台为准（docs/platform-backend.md 5.9），这里不追求一样全。
 * 别的路径 404。
 */
import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';

const TIERS: Record<string, number> = { small: 2_000, mid: 10_000, big: 50_000, lux: 200_000 };

interface Stake {
  ref: string;
  tier: string;
  amount: number;
  mode: string;
  until: number;
}
interface Wallet {
  balance: number;
  stakes: Record<string, Stake>;
  ops: Record<string, unknown>;
  /** client 模式今天的净赢、最高档 */
  net: number;
  top: number;
}

type Req = { userId: string; game: string; ref: string; tier?: string; amount?: number; until?: number; mode: string; op: string };

/**
 * 账放在一个 Durable Object 里（全局一个，存进它的存储）：wrangler dev 可能换掉 Worker 的 isolate，模块里的变量会丢，
 * 冒烟里带入以后结回就会对不上（碰到过一次）。
 */
export class FakeWalletBank extends DurableObject<FakeEnv> {
  private wallets: Record<string, Wallet> = {};

  constructor(ctx: DurableObjectState, env: FakeEnv) {
    super(ctx, env);
    void this.ctx.blockConcurrencyWhile(async () => {
      this.wallets = (await this.ctx.storage.get<Record<string, Wallet>>('wallets')) ?? {};
    });
  }

  private walletOf(userId: string): Wallet {
    let w = this.wallets[userId];
    if (!w) {
      w = { balance: userId.startsWith('nofunds') ? 0 : 10_000, stakes: {}, ops: {}, net: userId.startsWith('capped') ? 1e9 : 0, top: 0 };
      this.wallets[userId] = w;
    }
    return w;
  }

  private viewOf(w: Wallet): unknown {
    return { balance: w.balance, stakes: Object.entries(w.stakes).map(([game, s]) => ({ game, ...s })), canRelief: false, writesLeft: 200, caps: {}, fresh: false };
  }

  view(userId: string): unknown {
    return { ok: true, wallet: this.viewOf(this.walletOf(userId)) };
  }

  async run(method: 'buyin' | 'settle' | 'refund', req: Req): Promise<unknown> {
    if (req.userId.startsWith('busy')) return { ok: false, error: 'busy' };
    const w = this.walletOf(req.userId);
    const key = `${req.game}:${req.op}`;
    const seen = w.ops[key];
    if (seen) return { ...(seen as object), dup: true };
    const r = method === 'buyin' ? this.buyin(w, req) : this.close(w, req, method === 'settle');
    const out = { ...r, wallet: this.viewOf(w) };
    if (r['ok']) {
      w.ops[key] = out;
      await this.ctx.storage.put('wallets', this.wallets);
    }
    return out;
  }

  private buyin(w: Wallet, req: Req): Record<string, unknown> {
    const share = TIERS[req.tier ?? ''];
    if (!share || !req.amount || req.amount > share) return { ok: false, error: 'bad_amount' };
    const st = w.stakes[req.game];
    if (st && (st.ref !== req.ref || st.tier !== req.tier)) return { ok: false, error: 'at_table' };
    if (!st && w.balance < share) return { ok: false, error: 'no_funds' };
    w.balance -= req.amount;
    w.stakes[req.game] = { ref: req.ref, tier: req.tier!, amount: (st?.amount ?? 0) + req.amount, mode: req.mode, until: req.until ?? 0 };
    if (req.mode === 'client') {
      w.net -= req.amount;
      w.top = Math.max(w.top, share);
    }
    return { ok: true };
  }

  /** 结回（settle）或放弃（refund） */
  private close(w: Wallet, req: Req, settle: boolean): Record<string, unknown> {
    const st = w.stakes[req.game];
    if (!st || st.ref !== req.ref) return { ok: false, error: 'no_stake' };
    let credited = settle ? (req.amount ?? 0) : st.amount;
    let capped = 0;
    if (req.mode === 'client') {
      // 到顶以后也至少退回带入的数
      const room = Math.max(st.amount, 3 * w.top - w.net);
      if (credited > room) {
        capped = credited - room;
        credited = room;
      }
      w.net += credited;
    }
    w.balance += credited;
    delete w.stakes[req.game];
    return { ok: true, credited, capped };
  }
}

interface FakeEnv {
  BANK: DurableObjectNamespace<FakeWalletBank>;
}

export class WalletService extends WorkerEntrypoint<FakeEnv> {
  private bank() {
    return this.env.BANK.get(this.env.BANK.idFromName('bank'));
  }

  private badGame(game: string): unknown {
    const p = (this.ctx as unknown as { props?: { game?: string } }).props?.game;
    return p !== undefined && p !== game ? { ok: false, error: 'bad_game' } : null;
  }

  view(userId: string): Promise<unknown> {
    return this.bank().view(userId) as Promise<unknown>;
  }

  buyin(req: Req): Promise<unknown> {
    return Promise.resolve(this.badGame(req.game) ?? (this.bank().run('buyin', req) as Promise<unknown>));
  }

  settle(req: Req): Promise<unknown> {
    return Promise.resolve(this.badGame(req.game) ?? (this.bank().run('settle', req) as Promise<unknown>));
  }

  refund(req: Req): Promise<unknown> {
    return Promise.resolve(this.badGame(req.game) ?? (this.bank().run('refund', req) as Promise<unknown>));
  }
}

export default {
  fetch(request: Request): Response {
    const url = new URL(request.url);
    // 社交（0.13.0 起页面挂 kit 的 social）：报位置收下、没有邀请、没有好友，不然每个冒烟页面都有 404
    if (url.pathname === '/api/presence') return new Response(null, { status: 204 });
    if (url.pathname === '/api/invites' && request.method === 'GET') return Response.json({ invites: [] });
    if (url.pathname === '/api/friends') return Response.json({ friends: [] });
    if (url.pathname !== '/api/me') return new Response('not found', { status: 404 });
    const id = /(?:^|;\s*)__Host-sid=([^;]+)/.exec(request.headers.get('cookie') ?? '')?.[1];
    if (id === 'down') return new Response('down', { status: 503 });
    return Response.json({ user: id ? { id, displayName: `玩家${decodeURIComponent(id)}` } : null });
  },
};
