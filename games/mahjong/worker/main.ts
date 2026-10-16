/**
 * mahjong Worker：路由 <站点>/games/mahjong*，部署时注入（README 的部署一节；DESIGN.md 第 4、6 节）。
 * - 首页三个路径过 kit 的登录闸门 loginGate（docs/platform-backend.md 15.8）：登录了放行；没登录 302 到 /login?next=<原路径和查询>（平台 0.10.1，5.7），
 *   房间链接 ?room=123456 登录完原样带回来；平台不可用回 503 页；GATE=off 时不拦；
 * - /games/mahjong/api/stake/* 是单机实盘的带入、结回（client 模式）：经服务绑定 WALLET 调平台钱包；结回带的小结 stats 原样转发，不改不补（5.10）；
 * - /games/mahjong/rooms（开房）、/games/mahjong/rooms/<码>/ws（进房）原样交给 kit 的 acceptCreate / acceptJoin（第 6 节）；
 *   开房的请求体 { opts } 是玩法、档位和规则设置，kit 开房时校验、定下，进房的人都看得到；
 * - 别的路径不经过这里（wrangler.jsonc 的 run_worker_first 只列了上面这些），由静态资源直接回。
 *
 * 带入、结回要过两道：CSRF（X-Arcade: 1 且 Origin 是本站：设了 SITE_ORIGIN 按它，没设按请求自己的 origin）、登录；额度、每日上限、写入次数都由平台钱包管（docs/economy.md 第 3、4 节）。
 */
import { whoIs, type WhoIs } from 'arcade-kit/auth';
import type { MeterEnv } from 'arcade-kit/meter';
import { acceptCreate, acceptJoin, json, loginGate, readJson } from 'arcade-kit/worker';
import type { SettleStats } from '../src/core/match/index.ts';
import { stakesOf, type TierId } from '../src/game/stakes.ts';
import type { MahjongRoom } from './room.ts';

export { RoomMeter } from 'arcade-kit/meter';
export { MahjongRoom } from './room.ts';

export const GAME = 'mahjong' as const;
/** ref、op 的格式（平台同样的检查，这里先挡掉，免得白调一次） */
export const WALLET_ID = /^[A-Za-z0-9_-]{8,64}$/;

type Mode = 'server' | 'client';
interface Base {
  userId: string;
  game: typeof GAME;
  ref: string;
  mode: Mode;
  op: string;
}
export type WalletRpcReply = { ok: true; wallet?: unknown; credited?: number; capped?: number; dup?: boolean; statsIgnored?: string } | { ok: false; error: string; wallet?: unknown };

/** 平台钱包的 RPC（5.9）：麻将用带入和结回（单机一开场就发牌、好友房按筹码结，用不上放弃） */
export interface PlatformWallet {
  buyin(req: Base & { tier: TierId; amount: number; until: number }): Promise<WalletRpcReply>;
  settle(req: Base & { amount: number; stats?: unknown }): Promise<WalletRpcReply>;
}

export interface Env extends MeterEnv {
  ASSETS: Fetcher;
  ARCADE?: Fetcher;
  WALLET: PlatformWallet;
  ROOM: DurableObjectNamespace<MahjongRoom>;
  /** off 以外（包括没配）都要登录 */
  GATE?: string;
  /** 写请求、开房进房的 Origin 必须是它；不设就按请求自己的 origin（正式部署由工作流注入） */
  SITE_ORIGIN?: string;
}

const BASE = '/games/mahjong';
const STAKE = `${BASE}/api/stake/`;
const ROOMS = `${BASE}/rooms`;
const JOIN = /^\/games\/mahjong\/rooms\/([^/]+)\/ws$/;
/** 带入、结回的请求体：结回带小结（≤ 256 字节），留足余量 */
const MAX_BODY = 1_024;
/** 单机那一份的到期退回：平台最长 24 小时（一直没结回来的原样退回） */
const SOLO_HOLD_MS = 24 * 3_600_000;

/** 平台钱包的错误码 → HTTP 状态；没列的（busy、internal……）按 503，页面当"可能没到"留着操作 id 重发 */
const STATUS: Record<string, number> = {
  limit: 429,
  no_funds: 409,
  at_table: 409,
  no_stake: 409,
  expired: 409,
  bad_mode: 409,
  bad_amount: 400,
  bad_until: 400,
  bad_request: 400,
};

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const site = env.SITE_ORIGIN ?? url.origin;
    // 页面里的资源和接口都用相对路径，没有结尾斜杠时相对路径会落到 /games/ 下
    if (path === BASE) return Response.redirect(`${url.origin}${BASE}/${url.search}`, 301);
    if (path === `${BASE}/` || path === `${BASE}/index.html`) return loginGate(request, env, { downPage: DOWN_PAGE });
    if (path.startsWith(STAKE)) return stake(request, env, site, path.slice(STAKE.length));
    if (path === ROOMS) {
      const opts = await roomOpts(request);
      if (opts === BAD) return json({ error: 'bad_options' }, 400);
      return acceptCreate(request, env, { siteOrigin: site, options: opts });
    }
    const join = JOIN.exec(path);
    if (join) return acceptJoin(request, env, join[1]!, { siteOrigin: site });
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

const BAD = Symbol('bad');

/**
 * 开房请求体里的 { opts }。没带请求体（或 { } 里没有 opts）是 undefined：按默认开（娱乐、默认规则）；
 * 带了却太长、不是 JSON、没带 content-length：回 BAD，这里直接 400 bad_options，不交给 kit 当默认开。
 * 这一步在 kit 认人之前，只读不超过 MAX_BODY 的；非 POST 的不读（kit 回 405）
 */
async function roomOpts(request: Request): Promise<unknown> {
  if (request.method !== 'POST' || request.body === null) return undefined;
  const len = request.headers.get('content-length');
  if (len === '0') return undefined;
  const b = await readJson(request, MAX_BODY);
  if (b === null || typeof b !== 'object' || Array.isArray(b)) return BAD;
  return (b as { opts?: unknown }).opts;
}

/** 单机的带入（开场）、结回（一场打完或中途离开）：浏览器算的结果，平台按 client 模式记、每天的净赢有上限 */
async function stake(request: Request, env: Env, site: string, sub: string): Promise<Response> {
  if (sub !== 'buyin' && sub !== 'settle') return json({ error: 'not_found' }, 404);
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  if (request.headers.get('x-arcade') !== '1' || request.headers.get('origin') !== site) return json({ error: 'forbidden' }, 403);
  const b = (await readJson(request, MAX_BODY)) as { op?: unknown; session?: unknown; stakes?: unknown; amount?: unknown; stats?: unknown } | null;
  const id = (x: unknown): x is string => typeof x === 'string' && WALLET_ID.test(x);
  const amount = b?.amount;
  if (!b || !id(b.op) || !id(b.session) || typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) return json({ error: 'bad_request' }, 400);
  const tier = stakesOf(b.stakes);
  if (sub === 'buyin' && (!tier || !tier.wallet)) return json({ error: 'bad_request' }, 400);
  const who = await whoIs(request, env.ARCADE);
  if (!('user' in who)) return denied(who);
  const base = { userId: who.user.userId, game: GAME, ref: b.session, mode: 'client' as const, op: b.op };
  let r: WalletRpcReply;
  try {
    r =
      sub === 'buyin'
        ? await env.WALLET.buyin({ ...base, tier: tier!.id as TierId, amount, until: Date.now() + SOLO_HOLD_MS })
        : await env.WALLET.settle({ ...base, amount, ...(b.stats === undefined ? {} : { stats: b.stats as SettleStats }) });
  } catch (e) {
    // 连不上平台：请求可能到了，页面留着操作 id 重发
    console.error('mahjong: wallet unreachable', e instanceof Error ? e.message : e);
    return json({ error: 'unavailable' }, 503, who.setCookie);
  }
  if (r.ok && r.statsIgnored) console.error('mahjong: stats ignored', r.statsIgnored);
  return r.ok ? json(r, 200, who.setCookie) : json(r, STATUS[r.error] ?? 503, who.setCookie);
}

function denied(who: Exclude<WhoIs, { user: unknown }>): Response {
  return who.error === 'anonymous' ? json({ error: 'login' }, 401, who.setCookie) : json({ error: 'unavailable' }, 503);
}

/** 平台不可用时的 503 页（kit 的 loginGate 回它）：麻将自己的标题和配色 */
const DOWN_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>雀馆</title>
<style>body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;background:#0f5a41;color:#f6f1e3;font:16px/1.6 system-ui,sans-serif;text-align:center}
a{color:#f3c86b}</style></head>
<body><main><h1>平台暂时连不上</h1><p>稍等一会儿再刷新试试。</p><p><a href="/">回大厅</a></p></main></body></html>`;
