/**
 * 房间测试用的假钱包：FakeWallet 是服务绑定 WALLET 的入口（和平台的 WalletService 同样四个方法、同样的回话），
 * 账记在一个 Durable Object（WalletBank）里，测试直接读它看扣了多少、结回多少、每个 op 真办了几次。
 * 只做好友房要看的：按 op 去重（dup）、同一游戏只有一份（at_table）、要够一份（no_funds）、结回清掉那一份（再来 no_stake）。
 * userId 以 "poor" 开头的人余额是 0；down 不为 0 时接下来的几次调用回 busy（看房间按退避重试）。
 * 搭子战绩（0.16.0，平台 15.19 的 together）：原样记下每次报的 { op, players }，测试核对报了几次、报了谁。
 */
import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';

type Req = { userId: string; game: string; ref: string; tier?: string; amount?: number; until?: number; mode: string; op: string };
type Reply = { ok: boolean; error?: string; credited?: number; dup?: boolean; wallet?: unknown };

const TIERS: Record<string, number> = { small: 2_000, mid: 10_000, big: 50_000, lux: 200_000 };

interface Acct {
  balance: number;
  stakes: Record<string, { ref: string; tier: string; amount: number; mode: string; until: number }>;
}

export class WalletBank extends DurableObject {
  private accts = new Map<string, Acct>();
  private ops = new Map<string, Reply>();
  /** 每个 op 真办了几次（去重后） */
  readonly done = new Map<string, number>();
  /** 收到的调用（方法:op 或 view:userId），按顺序 */
  readonly log: string[] = [];
  down = 0;
  /** 搭子战绩：报上来的每一场 */
  readonly togethers: { op: string; players: unknown[] }[] = [];

  together(req: { op: string; players: unknown[] }): { ok: true; pairs: number } {
    this.log.push(`together:${req.op}`);
    this.togethers.push(req);
    const n = req.players.length;
    return { ok: true, pairs: (n * (n - 1)) / 2 };
  }

  private acct(userId: string): Acct {
    let a = this.accts.get(userId);
    if (!a) {
      a = { balance: userId.startsWith('poor') ? 0 : 10_000, stakes: {} };
      this.accts.set(userId, a);
    }
    return a;
  }

  private view(a: Acct): unknown {
    return { balance: a.balance, stakes: Object.entries(a.stakes).map(([game, s]) => ({ game, ...s })) };
  }

  call(method: 'view' | 'buyin' | 'settle' | 'refund', req: Req | string): Reply {
    this.log.push(typeof req === 'string' ? `${method}:${req}` : `${method}:${req.op}`);
    if (this.down > 0) {
      this.down--;
      return { ok: false, error: 'busy' };
    }
    if (typeof req === 'string') return { ok: true, wallet: this.view(this.acct(req)) };
    const a = this.acct(req.userId);
    const key = `${req.game}:${req.op}`;
    const seen = this.ops.get(key);
    if (seen) return { ...seen, dup: true };
    const st = a.stakes[req.game];
    let r: Reply;
    if (method === 'buyin') {
      const share = TIERS[req.tier ?? ''] ?? 0;
      if (st && (st.ref !== req.ref || st.tier !== req.tier)) r = { ok: false, error: 'at_table' };
      else if (!st && a.balance < share) r = { ok: false, error: 'no_funds' };
      else {
        a.balance -= req.amount!;
        a.stakes[req.game] = { ref: req.ref, tier: req.tier!, amount: (st?.amount ?? 0) + req.amount!, mode: req.mode, until: req.until! };
        r = { ok: true };
      }
    } else if (!st || st.ref !== req.ref) r = { ok: false, error: 'no_stake' };
    else {
      const credited = method === 'settle' ? req.amount! : st.amount;
      a.balance += credited;
      delete a.stakes[req.game];
      r = { ok: true, credited };
    }
    r.wallet = this.view(a);
    if (r.ok) {
      this.ops.set(key, r);
      this.done.set(req.op, (this.done.get(req.op) ?? 0) + 1);
    }
    return r;
  }

  setDown(n: number): void {
    this.down = n;
  }

  /** 测试读：余额、桌上那一份、每个 op 办了几次、调用记录 */
  snapshot(): { balances: Record<string, number>; stakes: Record<string, unknown>; done: Record<string, number>; log: string[]; togethers: { op: string; players: unknown[] }[] } {
    const balances: Record<string, number> = {};
    const stakes: Record<string, unknown> = {};
    for (const [u, a] of this.accts) {
      balances[u] = a.balance;
      if (Object.keys(a.stakes).length) stakes[u] = a.stakes;
    }
    return { balances, stakes, done: Object.fromEntries(this.done), log: [...this.log], togethers: [...this.togethers] };
  }
}

interface BankEnv {
  BANK: DurableObjectNamespace<WalletBank>;
}

export const bank = (env: BankEnv) => env.BANK.get(env.BANK.idFromName('bank'));

export class FakeWallet extends WorkerEntrypoint<BankEnv> {
  private check(game: string): Reply | null {
    const p = (this.ctx as unknown as { props?: { game?: string } }).props?.game;
    return p !== undefined && p !== game ? { ok: false, error: 'bad_game' } : null;
  }
  view(userId: string): Promise<Reply> {
    return bank(this.env).call('view', userId);
  }
  buyin(req: Req): Promise<Reply> {
    return Promise.resolve(this.check(req.game) ?? bank(this.env).call('buyin', req));
  }
  settle(req: Req): Promise<Reply> {
    return Promise.resolve(this.check(req.game) ?? bank(this.env).call('settle', req));
  }
  refund(req: Req): Promise<Reply> {
    return Promise.resolve(this.check(req.game) ?? bank(this.env).call('refund', req));
  }
  together(req: { op: string; players: unknown[] }): Promise<unknown> {
    return Promise.resolve(this.check('guandan') ?? bank(this.env).together(req));
  }
}
