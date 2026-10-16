/**
 * 钱包（平台的，docs/economy.md 第 3、4 节，docs/platform-backend.md 5.9、15.9）。
 * - 看钱包、领补给：平台的 /api/wallet、/api/wallet/relief（同域，绝对路径）；
 * - 单机带入、结回：德州 Worker 的 api/solo/*（相对路径，页面在 /games/texas/ 下），Worker 再经服务绑定调平台（client 模式）。
 * 连不上、回来的不是 JSON（网关出错页、开发时 vite 的首页）都按 offline：钱包那边可能根本没收到，调用方留着操作 id 下次重发。
 */
import type { SettleStats } from '../core/fame.ts';
import type { StakesId } from '../core/stakes.ts';

export type Mode = 'server' | 'client';

/** 某个游戏"桌上那一份"：单机是 client，好友房是 server */
export interface Stake {
  game: string;
  ref: string;
  tier: StakesId;
  amount: number;
  mode: Mode;
  at: number;
  until: number;
}

export interface WalletView {
  balance: number;
  stakes: Stake[];
  /** 今天能不能领补给 */
  canRelief: boolean;
  writesLeft: number;
  /** client 模式今天的净赢和上限（只列今天带入过的游戏） */
  caps: Record<string, { net: number; cap: number }>;
  /** 还没有钱包（看到的是新号的 10,000） */
  fresh: boolean;
}

/** credited：进了钱包的；capped：今天这个游戏的进账到顶了、没进钱包的 */
export type WalletReply = { ok: true; wallet: WalletView; credited?: number; capped?: number } | { ok: false; error: string; wallet?: WalletView; retryAfter?: number };

/** 钱包里德州的那几份（平台 0.9.5 起同一个游戏可以同时有好几份：单机一份、每个好友房各一份）；mode 不给就是全部 */
export const texasStakes = (w: WalletView | null, mode?: Mode): Stake[] => w?.stakes.filter((s) => s.game === 'texas' && (!mode || s.mode === mode)) ?? [];

async function call(url: string, init: RequestInit): Promise<WalletReply> {
  try {
    const res = await fetch(url, init);
    if (res.status === 401) return { ok: false, error: 'login' };
    const data = (await res.json()) as { ok?: boolean; wallet?: WalletView; error?: unknown; credited?: number; capped?: number; retryAfter?: unknown };
    if (res.ok && data.wallet) return { ok: true, wallet: data.wallet, credited: data.credited, capped: data.capped };
    return {
      ok: false,
      error: typeof data.error === 'string' ? data.error : 'offline',
      ...(data.wallet ? { wallet: data.wallet } : {}),
      ...(typeof data.retryAfter === 'number' ? { retryAfter: data.retryAfter } : {}),
    };
  } catch {
    return { ok: false, error: 'offline' };
  }
}

// keepalive：关页面时离桌的结回也要发出去（浏览器的 RequestInit 有它，Worker 的类型里没有，这个文件两边都编译）
const post = (body: unknown, keepalive = false): RequestInit =>
  ({ method: 'POST', headers: { 'content-type': 'application/json', 'x-arcade': '1' }, body: JSON.stringify(body), keepalive }) as RequestInit;

export const getWallet = (): Promise<WalletReply> => call('/api/wallet', { headers: { accept: 'application/json' } });
export const relief = (): Promise<WalletReply> => call('/api/wallet/relief', post({}));

export interface WalletApi {
  buyin(op: string, session: string, stakes: StakesId, amount: number): Promise<WalletReply>;
  /** stats：这一份的小结（0.3.0，平台 settle.stats），worker 原样转给平台 */
  cashout(op: string, session: string, amount: number, keepalive?: boolean, stats?: SettleStats): Promise<WalletReply>;
}

export const walletApi: WalletApi = {
  buyin: (op, session, stakes, amount) => call('api/solo/buyin', post({ op, session, stakes, amount })),
  cashout: (op, session, amount, keepalive = false, stats) => call('api/solo/cashout', post({ op, session, amount, ...(stats ? { stats } : {}) }, keepalive)),
};

/**
 * 给玩家看的一句话：照 docs/platform-backend.md 15.10 的对照表（平台 0.10.2），出了什么事、怎么办，不只回一个错误码。
 * retryAfter：/api 限次（rate_limited）时平台给的秒数。
 * where：在哪收到的（0.3.5）。单机的钱包 RPC 照表说"娱乐局照常玩"；好友房里没有娱乐模式，不提它；
 * 看钱包、领补给走的是 /api，busy 按 /api 那张表说"先只能看、不能改"
 */
export function walletError(e: string, retryAfter?: number, where: 'solo' | 'room' | 'api' = 'solo'): string {
  switch (e) {
    case 'no_funds':
      return '钱包里的筹码不够，少带一点，或者去大厅领补给';
    case 'limit':
      return where === 'room' ? '今天开局太多了，明早 0 点恢复；桌上的照常结回' : '今天开局太多了，明早 0 点恢复；桌上的照常结回，娱乐模式照常玩';
    case 'busy':
      if (where === 'api') return '服务器今天有点忙，先只能看、不能改，明早恢复';
      return where === 'room' ? '服务器今天有点忙，先不能带筹码上桌，明早恢复' : '服务器今天有点忙，先不能带筹码开局；娱乐模式照常玩，明早恢复';
    case 'login':
      return '登录过期了，刷新一下页面';
    case 'at_table':
      return '这一桌带的是别的档，换一桌再开';
    case 'relief_used':
      return '今天的补给已经领过了，明早 0 点再来';
    case 'relief_not_needed':
      return '筹码还够用：钱包加桌上的不到补给额才能领';
    case 'no_stake':
      return '这一份已经结过了';
    case 'expired':
      return '这一份放太久了，已经原样退回钱包';
    case 'rate_limited':
      return `操作太频繁了，歇一会儿再试${retryAfter ? `（${Math.max(1, Math.ceil(retryAfter / 60))} 分钟后）` : ''}`;
    case 'internal':
      return '出了点问题，筹码没动，过一会儿再试';
    case 'offline':
    case 'unavailable':
      return '钱包连不上，筹码没动，连上了再试';
    default:
      // bad_request、bad_amount 这类是程序写错了：筹码没动
      return '出了点问题，这一份筹码没动，刷新一下再试';
  }
}
