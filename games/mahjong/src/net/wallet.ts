/**
 * 浏览器这头的钱包（DESIGN.md 第 4 节）：看钱包、领补给走平台的 /api/wallet；单机的带入、结回走本模块 Worker 的 api/stake/*（相对路径，
 * 页面在 /games/mahjong/ 下，就是 /games/mahjong/api/stake/*），Worker 经服务绑定转给平台钱包（client 模式）。
 * 出错一律带错误码，页面按 view/text.ts 的对照表说人话（docs/platform-backend.md 15.10）。
 */
import type { SettleStats } from '../core/match/index.ts';
import type { TierId } from '../game/stakes.ts';

export interface WalletView {
  balance: number;
  stakes: { game: string; ref: string; tier: string; amount: number; mode: string }[];
  canRelief: boolean;
  caps?: Record<string, { net: number; cap: number }>;
  fresh?: boolean;
}

export type WalletReply = { ok: true; wallet?: WalletView; credited?: number; capped?: number; dup?: boolean } | { ok: false; error: string; wallet?: WalletView; retryAfter?: number };

async function call(url: string, init?: RequestInit): Promise<WalletReply> {
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'same-origin', ...init });
  } catch {
    return { ok: false, error: 'network' };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // 不是 JSON：按状态码说
  }
  const b = (body ?? {}) as Record<string, unknown>;
  if (res.ok) return { ok: true, ...(b as object) } as WalletReply;
  if (res.status === 401) return { ok: false, error: 'login' };
  return { ok: false, error: typeof b.error === 'string' ? b.error : 'unavailable', ...(b.wallet ? { wallet: b.wallet as WalletView } : {}) };
}

export async function getWallet(): Promise<WalletReply> {
  return call('/api/wallet');
}

export async function relief(): Promise<WalletReply> {
  return call('/api/wallet/relief', { method: 'POST', headers: { 'content-type': 'application/json', 'x-arcade': '1' }, body: '{}' });
}

const post = (kind: string, body: unknown): Promise<WalletReply> =>
  call(`api/stake/${kind}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-arcade': '1' }, body: JSON.stringify(body) });

/** 单机带入：session 是这一场的号（钱包里"桌上那一份"的 ref），op 是这个动作的号（平台按它去重，重发不会多扣） */
export const soloBuyin = (b: { op: string; session: string; stakes: TierId; amount: number }): Promise<WalletReply> => post('buyin', b);

/** 单机结回：带这一场的小结（docs/platform-backend.md 5.10，Worker 原样转发） */
export const soloSettle = (b: { op: string; session: string; amount: number; stats?: SettleStats }): Promise<WalletReply> => post('settle', b);

/**
 * 带入、结回失败时，钱包那边是不是可能已经办了：平台明确拒的（钱不够、上限、参数不对、没登录……）一定没办；
 * 没回话、平台暂时不行、认不出来的都当"可能办了"，留着操作号以后重发（平台按号去重）
 */
const REFUSED = new Set(['no_funds', 'limit', 'at_table', 'no_stake', 'expired', 'bad_mode', 'bad_amount', 'bad_until', 'bad_request', 'login', 'forbidden', 'rate_limited']);
export const maybeApplied = (error: string): boolean => !REFUSED.has(error);

/** 8–64 位 [A-Za-z0-9_-] 的随机号（ref、op） */
export function randomId(len = 20): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((x) => abc[x % abc.length]).join('');
}
