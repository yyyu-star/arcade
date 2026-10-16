/// <reference types="@cloudflare/workers-types" />
/**
 * 单机实盘的三个接口（docs/stake.md 第 2 节）：POST /games/guandan/api/stake/{buyin,settle,refund}。
 * 结果由浏览器算（mode: client），Worker 只认人、拼 ref 和 op、查数在规则范围里、转给平台钱包（服务绑定 WALLET，平台 5.9）。
 * 不碰 Durable Object、不写存储：每场 2 次 Worker 请求，写入都在钱包那一行。
 *
 * 回话：钱包的回话原样带回（成功 { ok: true, wallet, credited?, capped?, dup? }，被拒 { ok: false, error, wallet? }，都是 200），
 * 页面按 error 说人话（2.4）。HTTP 状态码只用来说"没到钱包"的情况：400 参数不对、401 没登录、403 不是本站发起的、
 * 503 平台或钱包连不上（这时页面当作"钱包暂时忙"）。
 */
import { sameOrigin, whoIs } from 'arcade-kit/auth';
import { SOLO_HOURS, TIERS, isSoloRef, isTier, payout, soloOp, soloRef, validSoloResult, type TierId } from '../src/stake/index.ts';
import { STAKE_PATH } from '../src/net/version.ts';
import type { Fetcher } from './gate.ts';

/** 请求体最多几个字节：最大的结回请求约 90 字节，带上战绩小结（平台只收 ≤ 256 字节的）不到 400，留足余量 */
const MAX_BODY = 1024;
const GAME = 'guandan';

/** 钱包的回话（平台 5.9）。只列掼蛋用到的字段 */
export type WalletReply =
  | { ok: true; wallet: unknown; credited?: number; capped?: number; dup?: boolean; statsIgnored?: string }
  | { ok: false; error: string; wallet?: unknown };

/** 平台的 WalletService（服务绑定的 RPC）：参数都是一个对象，业务上的拒绝走返回值 */
export interface WalletRpc {
  view(userId: string): Promise<{ ok: true; wallet: { stakes: { game: string; ref: string }[] } } | { ok: false; error: string }>;
  buyin(req: { userId: string; game: string; ref: string; tier: TierId; amount: number; until: number; mode: 'client' | 'server'; op: string }): Promise<WalletReply>;
  /** stats：战绩小结（平台 0.10.0，5.10），可选；平台校验，不合格整份忽略、钱照常结 */
  settle(req: { userId: string; game: string; ref: string; amount: number; mode: 'client' | 'server'; op: string; stats?: unknown }): Promise<WalletReply>;
  refund(req: { userId: string; game: string; ref: string; mode: 'client' | 'server'; op: string }): Promise<WalletReply>;
}

export interface StakeEnv {
  ARCADE?: Fetcher;
  WALLET?: WalletRpc;
  SITE_ORIGIN?: string;
}

function reply(body: unknown, status: number, setCookie: readonly string[] = []): Response {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  for (const c of setCookie) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify(body), { status, headers });
}

/** 128 位随机数 → 32 位十六进制 */
function randomHex(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** 返回 null 表示不是实盘的路径 */
export function routeStake(request: Request, env: StakeEnv): Promise<Response> | null {
  const path = new URL(request.url).pathname;
  if (path !== STAKE_PATH && !path.startsWith(`${STAKE_PATH}/`)) return null;
  return handleStake(request, env, path.slice(STAKE_PATH.length + 1));
}

async function handleStake(request: Request, env: StakeEnv, action: string): Promise<Response> {
  if (action !== 'buyin' && action !== 'settle' && action !== 'refund') return reply({ ok: false, error: 'not_found' }, 404);
  if (request.method !== 'POST') return reply({ ok: false, error: 'method' }, 405);
  // 动钱包的请求只认本站页面发起的：别的网站的页面也能往这里 POST（浏览器会带上 cookie）
  // 只认本站页面发起的：设了 SITE_ORIGIN（正式部署由工作流注入）就按它，没设按请求自己的 origin
  if (!sameOrigin(request, env.SITE_ORIGIN ?? new URL(request.url).origin)) return reply({ ok: false, error: 'origin' }, 403);
  // 读请求体之前先限大小（德州的实盘接口遇到过同样的问题）：分块传输的大请求体不带 content-length，没登录的人也能让 Worker 白白解析一大段。
  // 浏览器的 fetch 带着字符串请求体时总会给 content-length
  const len = Number(request.headers.get('content-length') ?? NaN);
  if (!Number.isInteger(len) || len <= 0 || len > MAX_BODY) return reply({ ok: false, error: 'bad_request' }, 400);
  let body: Record<string, unknown>;
  try {
    const raw: unknown = await request.json();
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('not object');
    body = raw as Record<string, unknown>;
  } catch {
    return reply({ ok: false, error: 'bad_request' }, 400);
  }
  // 参数先查，免得为一个写错的请求去问平台
  let call: (userId: string, wallet: WalletRpc) => Promise<WalletReply>;
  let extra: Record<string, unknown> = {};
  if (action === 'buyin') {
    const tier = body['tier'];
    if (!isTier(tier)) return reply({ ok: false, error: 'bad_request' }, 400);
    const ref = soloRef(randomHex());
    // 钱包最长给 24 小时（超过按 24 小时算）；页面按回来的 until 判断过没过期
    const until = Date.now() + SOLO_HOURS * 3_600_000;
    extra = { ref, tier, share: TIERS[tier], until };
    call = (userId, w) => w.buyin({ userId, game: GAME, ref, tier, amount: TIERS[tier], until, mode: 'client', op: soloOp(ref, 'in') });
  } else {
    const ref = body['ref'];
    if (!isSoloRef(ref)) return reply({ ok: false, error: 'bad_request' }, 400);
    if (action === 'settle') {
      // 档位由页面带来（页面存着这一场的档位）：带错了只会被钱包按"超过带入 + 20 份"拒掉，或者落在每日上限里，economy.md 定了不防作弊
      const { tier, points, deals, stats } = body;
      if (!isTier(tier) || !validSoloResult(points, deals)) return reply({ ok: false, error: 'bad_request' }, 400);
      const amount = payout(tier, points as number);
      // 页面报的战绩小结原样转给平台（5.10：游戏的接口不改、不补，平台校验）；没带就不带
      call = (userId, w) => w.settle({ userId, game: GAME, ref, amount, mode: 'client', op: soloOp(ref, 'out'), ...(stats !== undefined ? { stats } : {}) });
    } else {
      call = (userId, w) => w.refund({ userId, game: GAME, ref, mode: 'client', op: soloOp(ref, 'refund') });
    }
  }
  // 闸门的 Fetcher 只声明了 fetch；运行时的服务绑定就是 kit 要的 Fetcher
  const who = await whoIs(request, env.ARCADE as Parameters<typeof whoIs>[1]);
  if ('error' in who) {
    return who.error === 'anonymous' ? reply({ ok: false, error: 'login' }, 401, who.setCookie) : reply({ ok: false, error: 'unavailable' }, 503);
  }
  if (!env.WALLET) return reply({ ok: false, error: 'unavailable' }, 503, who.setCookie);
  let r: WalletReply;
  try {
    r = await call(who.user.userId, env.WALLET);
  } catch (e) {
    // RPC 抛异常 = 没到钱包或钱包那边出了意外（业务拒绝不抛）：页面按"钱包暂时忙"处理，同一个 op 重发也只算一次
    console.warn(`钱包 ${action} 调用失败：${e instanceof Error ? e.message : String(e)}`);
    return reply({ ok: false, error: 'unavailable' }, 503, who.setCookie);
  }
  if (!r.ok && !['no_funds', 'at_table', 'limit', 'expired', 'no_stake', 'busy', 'internal'].includes(r.error)) {
    // bad_game、bad_amount 之类是代码或配置写错了
    console.error(`钱包拒绝了 ${action}：${r.error}`);
  }
  return reply(r.ok ? { ...r, ...extra } : r, 200, who.setCookie);
}
