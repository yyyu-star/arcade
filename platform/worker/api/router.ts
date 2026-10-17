/**
 * /api 的入口：便宜的检查在前，碰 D1 的在后（docs/platform-backend.md 15.1）。
 * Host → 路径和方法 → 熔断档位与类别预算 → X-Arcade 与 Origin → 路径参数 → 请求体 → 会话 → 各接口（内存限流、持久限流、业务）。
 */
import type { Env } from '../env';
import { changePassword, changeRecoveryCode, deleteAccount, logoutOthers } from './account';
import {
  bearerAuth,
  createUser,
  deleteUser,
  getNotice,
  getRegistration,
  getWalletRules,
  listUsers,
  resetPassword,
  sessionAdmin,
  setNotice,
  setRegistration,
  setWalletRules,
} from './admin';
import { getMe, login, logout, patchMe, recover, register } from './auth';
import { feedParams, listFeed, postMoment, react } from './feed';
import { dismissInvite, inviteParams, listInvites, sendInvite } from './invites';
import { friendsWeek, overtakes, weekParams } from './friends-week';
import { postPresence } from './presence';
import { boardParams, getBoard, submitScore } from './boards';
import { challengeParams, createChallenge, getChallenge, submitChallenge } from './challenges';
import {
  acceptRequest,
  block,
  changeFriendCode,
  codeParams,
  declineRequest,
  listBlocks,
  listFriends,
  lookupCode,
  removeFriend,
  sendRequest,
  unblock,
} from './friends';
import { getSaves, putSave, saveParams, SAVE_BODY_LIMIT } from './saves';
import { getLeaderboard } from './leaderboard';
import { getStats, statsParams } from './stats';
import { adminAdjust, adminLookup, adminOverview, adminRecentAdjustments, claimRelief, getWallet, listWalletStats } from './wallet-api';
import { limitsOf } from './config';
import { type Ctx, userParams } from './context';
import { hashIp, MissingSecretError } from './crypto';
import { d1Trouble, Db, newStats, type RequestStats } from './db';
import { ApiError, clearCookies, errorResponse, noContent, readCookie, SID_COOKIE, unavailable } from './http';
import { type Category, effectiveTier, meter } from './meter';
import { loadSession } from './session';

/**
 * 账号安全类预算用完后各接口怎么办（6.6）：
 * always：照做（退出、注销）；capped：只要超额封顶没用完就照做（改密码、退出其他设备，另有每人每天上限）；stop：停（换恢复码）。
 */
type AcctPolicy = 'always' | 'capped' | 'stop';

interface Route {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** 固定路径，或带捕获组的正则（捕获到的路径段交给 params）。 */
  path: string | RegExp;
  /** 校验路径段，不合格就抛错（在读请求体和会话之前，不碰 D1）。 */
  params?: (segments: string[]) => Record<string, string>;
  /** 请求体上限，默认 BODY_LIMIT。 */
  bodyLimit?: number;
  cat: Category;
  /** user：必须登录；optional：有会话就带上；admin：命令行工具的 Bearer 令牌，或者管理员的会话（admin.ts）。 */
  auth: 'none' | 'optional' | 'user' | 'admin';
  /** 停增长档要停的接口（注册、交分）；存档槽变多、变大在 saves.ts 里按档位自己判断。 */
  growth?: boolean;
  acct?: AcctPolicy;
  /** 退出：任何档位都能用。 */
  alwaysOpen?: boolean;
  /** 可丢的写（报位置，0.13.0）：只读档、这一类预算用完时不写、直接 204，不打扰玩家（docs/social.md 0："超了静默丢弃"） */
  quiet?: boolean;
  handler: (c: Ctx) => Promise<Response>;
}

const ROUTES: Route[] = [
  { method: 'GET', path: '/api/me', cat: 'social', auth: 'optional', handler: getMe },
  { method: 'PATCH', path: '/api/me', cat: 'social', auth: 'user', handler: patchMe },
  { method: 'POST', path: '/api/auth/register', cat: 'reg', auth: 'none', growth: true, handler: register },
  { method: 'POST', path: '/api/auth/login', cat: 'auth', auth: 'none', handler: login },
  { method: 'POST', path: '/api/auth/recover', cat: 'auth', auth: 'none', handler: recover },
  { method: 'POST', path: '/api/auth/logout', cat: 'acct', auth: 'none', acct: 'always', alwaysOpen: true, handler: logout },
  { method: 'POST', path: '/api/account/password', cat: 'acct', auth: 'user', acct: 'capped', handler: changePassword },
  { method: 'POST', path: '/api/account/recovery-code', cat: 'acct', auth: 'user', acct: 'stop', handler: changeRecoveryCode },
  { method: 'POST', path: '/api/account/logout-others', cat: 'acct', auth: 'user', acct: 'capped', handler: logoutOthers },
  { method: 'POST', path: '/api/account/delete', cat: 'acct', auth: 'user', acct: 'always', handler: deleteAccount },
  { method: 'POST', path: '/api/me/friend-code', cat: 'social', auth: 'user', handler: changeFriendCode },
  { method: 'GET', path: '/api/friends', cat: 'social', auth: 'user', handler: listFriends },
  { method: 'GET', path: '/api/friends/overtakes', cat: 'board', auth: 'user', handler: overtakes },
  { method: 'GET', path: /^\/api\/friends\/week\/([^/]+)$/, params: weekParams, cat: 'board', auth: 'user', handler: friendsWeek },
  // 好友在线（0.13.0，15.13）：每人每 2 分钟最多写 1 行；写不了就静默 204
  { method: 'POST', path: '/api/presence', cat: 'live', auth: 'user', quiet: true, handler: postPresence },
  { method: 'POST', path: '/api/invites', cat: 'live', auth: 'user', handler: sendInvite },
  { method: 'GET', path: '/api/feed', cat: 'live', auth: 'user', handler: listFeed },
  { method: 'POST', path: '/api/feed', cat: 'live', auth: 'user', quiet: true, handler: postMoment },
  { method: 'POST', path: /^\/api\/feed\/([^/]+)\/react$/, params: feedParams, cat: 'live', auth: 'user', handler: react },
  { method: 'GET', path: '/api/invites', cat: 'live', auth: 'user', handler: listInvites },
  { method: 'POST', path: /^\/api\/invites\/([^/]+)\/dismiss$/, params: inviteParams, cat: 'live', auth: 'user', handler: dismissInvite },
  // 战绩（0.10.3，5.10）：对登录的人公开，只读
  { method: 'GET', path: /^\/api\/stats\/([^/]+)$/, params: statsParams, cat: 'social', auth: 'user', handler: getStats },
  // 排行榜页（0.10.4，15.12）：本周净赢、称号收集，读走缓存
  { method: 'GET', path: '/api/leaderboard', cat: 'board', auth: 'user', handler: getLeaderboard },
  { method: 'GET', path: /^\/api\/friends\/code\/([^/]+)$/, params: codeParams, cat: 'social', auth: 'user', handler: lookupCode },
  { method: 'POST', path: '/api/friends/requests', cat: 'social', auth: 'user', handler: sendRequest },
  { method: 'POST', path: /^\/api\/friends\/([^/]+)\/accept$/, params: userParams, cat: 'social', auth: 'user', handler: acceptRequest },
  { method: 'POST', path: /^\/api\/friends\/([^/]+)\/decline$/, params: userParams, cat: 'social', auth: 'user', handler: declineRequest },
  { method: 'DELETE', path: /^\/api\/friends\/([^/]+)$/, params: userParams, cat: 'social', auth: 'user', handler: removeFriend },
  { method: 'GET', path: '/api/blocks', cat: 'social', auth: 'user', handler: listBlocks },
  { method: 'POST', path: '/api/blocks', cat: 'social', auth: 'user', handler: block },
  { method: 'DELETE', path: /^\/api\/blocks\/([^/]+)$/, params: userParams, cat: 'social', auth: 'user', handler: unblock },
  { method: 'GET', path: '/api/admin/users', cat: 'acct', auth: 'admin', handler: listUsers },
  { method: 'GET', path: '/api/admin/settings/registration', cat: 'acct', auth: 'admin', handler: getRegistration },
  { method: 'POST', path: '/api/admin/settings/registration', cat: 'acct', auth: 'admin', acct: 'capped', handler: setRegistration },
  { method: 'GET', path: '/api/admin/settings/notice', cat: 'acct', auth: 'admin', handler: getNotice },
  { method: 'POST', path: '/api/admin/settings/notice', cat: 'acct', auth: 'admin', acct: 'capped', handler: setNotice },
  // 钱包规则（0.10.6）：补给额、单机每日净赢份数、新号筹码、单次调整上限，改了即时生效
  { method: 'GET', path: '/api/admin/settings/wallet', cat: 'acct', auth: 'admin', handler: getWalletRules },
  { method: 'POST', path: '/api/admin/settings/wallet', cat: 'acct', auth: 'admin', acct: 'capped', handler: setWalletRules },
  { method: 'POST', path: '/api/admin/users', cat: 'acct', auth: 'admin', acct: 'capped', handler: createUser },
  {
    method: 'POST',
    path: /^\/api\/admin\/users\/([^/]+)\/password$/,
    params: userParams,
    cat: 'acct',
    auth: 'admin',
    acct: 'capped',
    handler: resetPassword,
  },
  { method: 'POST', path: /^\/api\/admin\/users\/([^/]+)\/delete$/, params: userParams, cat: 'acct', auth: 'admin', acct: 'capped', handler: deleteUser },
  // 新上榜会让库变大：停增长档停交分（和新建存档槽一样）
  { method: 'POST', path: '/api/scores', cat: 'board', auth: 'user', growth: true, handler: submitScore },
  { method: 'POST', path: '/api/challenges', cat: 'board', auth: 'user', growth: true, handler: createChallenge },
  { method: 'GET', path: /^\/api\/challenges\/([^/]+)$/, params: challengeParams, cat: 'board', auth: 'user', handler: getChallenge },
  { method: 'POST', path: /^\/api\/challenges\/([^/]+)\/results$/, params: challengeParams, cat: 'board', auth: 'user', growth: true, handler: submitChallenge },
  { method: 'GET', path: /^\/api\/boards\/([^/]+)\/([^/]+)$/, params: boardParams, cat: 'board', auth: 'user', handler: getBoard },
  { method: 'GET', path: /^\/api\/saves\/([^/]+)$/, params: saveParams, cat: 'save', auth: 'user', handler: getSaves },
  // 钱包（5.9）：浏览器只能看和领补给；带入、结回、放弃只有游戏的服务端经 RPC 能调（worker/wallet-service.ts），这里没有这几条路
  { method: 'GET', path: '/api/wallet', cat: 'wallet', auth: 'user', handler: getWallet },
  { method: 'POST', path: '/api/wallet/relief', cat: 'wallet', auth: 'user', handler: claimRelief },
  // 管理页的统计和别的管理接口一样记在账号安全类（令牌认证的那几行也在那里）
  { method: 'GET', path: '/api/admin/wallet-stats', cat: 'acct', auth: 'admin', handler: listWalletStats },
  // 今日概况（0.10.7）：今天现算，加前 6 天的统计
  { method: 'GET', path: '/api/admin/overview', cat: 'acct', auth: 'admin', handler: adminOverview },
  // 管理员调整筹码（0.9.4）：只认管理员会话（handler 里拒令牌），写 1 行；账号安全类预算用完就停
  { method: 'POST', path: '/api/admin/wallet/adjust', cat: 'acct', auth: 'admin', acct: 'stop', handler: adminAdjust },
  { method: 'GET', path: '/api/admin/wallet-adjustments', cat: 'acct', auth: 'admin', handler: adminRecentAdjustments },
  {
    method: 'GET',
    path: /^\/api\/admin\/wallet\/([^/]+)$/,
    params: (seg): Record<string, string> => (seg[0] && /^[A-Za-z0-9_]{1,32}$/.test(seg[0]) ? { username: seg[0] } : {}),
    cat: 'acct',
    auth: 'admin',
    handler: adminLookup,
  },
  {
    method: 'PUT',
    path: /^\/api\/saves\/([^/]+)\/([^/]+)$/,
    params: saveParams,
    bodyLimit: SAVE_BODY_LIMIT,
    cat: 'save',
    auth: 'user',
    handler: putSave,
  },
];

function matchPath(route: Route, pathname: string): string[] | null {
  if (typeof route.path === 'string') return route.path === pathname ? [] : null;
  const m = route.path.exec(pathname);
  return m ? m.slice(1) : null;
}

/** 默认请求体上限 8 KB（15.1）。 */
const BODY_LIMIT = 8 * 1024;

/**
 * 请求体的嵌套层数上限（最外层对象算 1 层）。JSON.parse 收得下几万层，但 JSON.stringify 是递归的，
 * 栈浅的时候会抛 RangeError 变成 500；游戏存档用不到这么深。在解析之前数一遍括号，结果和栈大小无关。
 */
export const JSON_MAX_DEPTH = 64;

function tooDeep(text: string, max: number): boolean {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    if (inString) {
      if (ch === 0x5c) i++; // 反斜杠：跳过被转义的下一个字符
      else if (ch === 0x22) inString = false;
    } else if (ch === 0x22) {
      inString = true;
    } else if (ch === 0x5b || ch === 0x7b) {
      if (++depth > max) return true;
    } else if (ch === 0x5d || ch === 0x7d) {
      depth--;
    }
  }
  return false;
}

/** 最近一个请求的写入统计。只给测试断言写入行数用（同一 isolate 里读得到）。 */
export let lastStats: RequestStats = newStats();

export async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const now = Date.now();
  const limits = limitsOf(env);
  const stats = newStats();
  lastStats = stats;
  try {
    return await dispatch(request, env, now, limits, stats);
  } catch (e) {
    if (e instanceof ApiError) return errorResponse(e);
    if (e instanceof MissingSecretError) {
      console.error('missing secret', e.message);
      return errorResponse(new ApiError(503, 'busy'));
    }
    // 只记错误类型和路径，不记请求体和 cookie（5.2）
    const trouble = d1Trouble(e);
    console.error(trouble ? `d1 ${trouble}` : 'api error', new URL(request.url).pathname, e instanceof Error ? e.name : 'unknown');
    // D1 一时不行：503 加 Retry-After，和 500（我们的 bug）分开，玩家看到的是"过几秒再试"
    if (trouble) return errorResponse(unavailable(trouble === 'overloaded' ? 5 : 2));
    return errorResponse(new ApiError(500, 'internal'));
  } finally {
    if (meter.shouldFlush(limits, now, effectiveTier(env, meter.tier(limits, now)))) ctx.waitUntil(meter.flush(env.DB, limits, now));
  }
}

/** 本站地址：SITE_ORIGIN 设了按它，没设按请求自己的 origin（跨站请求的 Origin 头照样对不上，写请求照样挡得住） */
export function siteOrigin(env: Pick<Env, 'SITE_ORIGIN'>, url: URL): string {
  return env.SITE_ORIGIN || url.origin;
}

async function dispatch(
  request: Request,
  env: Env,
  now: number,
  limits: ReturnType<typeof limitsOf>,
  stats: RequestStats,
): Promise<Response> {
  const url = new URL(request.url);
  const site = siteOrigin(env, url);
  // 设了 SITE_ORIGIN 就只认那个主机名：workers.dev 之类的别的地址不经过网关限速（5.4）
  if (url.host !== new URL(site).host) throw new ApiError(404, 'not_found');
  const candidates = ROUTES.map((r) => ({ r, segments: matchPath(r, url.pathname) })).filter((x) => x.segments);
  if (!candidates.length) throw new ApiError(404, 'not_found');
  const hit = candidates.find((x) => x.r.method === request.method);
  if (!hit) throw new ApiError(405, 'method_not_allowed');
  const route = hit.r;
  const write = route.method !== 'GET';

  // 熔断档位与类别预算（内存里；本 isolate 第一次、跨了 UTC 天或上报失败后到了重试时间，先同步上报一次）
  await meter.ensureFresh(env.DB, limits, now);
  const tier = effectiveTier(env, meter.tier(limits, now));
  if (!route.alwaysOpen) {
    if (tier === 'off') throw meter.unreachable() ? unavailable(Math.ceil(limits.meterRetryMs / 1000)) : new ApiError(503, 'busy');
    if (write && route.quiet && (tier === 'readonly' || meter.exhausted(route.cat, limits, now))) return noContent();
    if (write && tier === 'readonly') throw new ApiError(503, 'busy');
    if (route.growth && tier === 'noGrowth') throw new ApiError(503, 'busy');
    if (write && meter.exhausted(route.cat, limits, now)) {
      const policy = route.acct;
      const allowed = policy === 'always' || (policy === 'capped' && !meter.acctOverflowExhausted(limits, now));
      if (!allowed) throw new ApiError(503, 'busy');
    }
  }

  // 管理接口带了 Authorization 就按命令行工具的令牌认证，不看 X-Arcade 和 Origin：浏览器跨站请求带不了这个头（要预检，我们不答应）
  const bearer = route.auth === 'admin' && request.headers.has('authorization');
  // 写请求：X-Arcade 和 Origin（只挡浏览器里的跨站请求，脚本能伪造，5.2）
  if (write && !bearer && (request.headers.get('x-arcade') !== '1' || request.headers.get('origin') !== site)) {
    throw new ApiError(403, 'forbidden');
  }
  const params = route.params ? route.params(hit.segments!) : {};
  const body = write ? await readJsonBody(request, route.bodyLimit ?? BODY_LIMIT) : {};

  const db = new Db(env.DB, stats, route.cat);
  const sidCookie = readCookie(request, SID_COOKIE);
  let ipHash: Promise<string> | null = null;
  const c: Ctx = {
    request, env, limits, now, db, tier, body, params, sidCookie,
    session: null,
    admin: null,
    ipHash: () => (ipHash ??= hashIp(env, request.headers.get('cf-connecting-ip') ?? 'unknown')),
  };
  if (bearer) {
    await bearerAuth(c);
    return route.handler(c);
  }
  if (route.auth !== 'none' && sidCookie) {
    c.session = await loadSession(request, env, db, now);
  }
  if ((route.auth === 'user' || route.auth === 'admin') && !c.session) {
    // 带着失效的会话来的（改了密码、退出其他设备、过期）：顺手清掉两个 cookie，游戏和平台页就不会再拿它来调接口（15.1）
    throw new ApiError(401, 'unauthorized', {}, sidCookie ? clearCookies().map((v): [string, string] => ['set-cookie', v]) : {});
  }
  if (route.auth === 'admin') sessionAdmin(c);
  return route.handler(c);
}

/** 先看 content-length，没有就边读边数；超了立即 413，不读完。 */
async function readJsonBody(request: Request, limit: number): Promise<Record<string, unknown>> {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > limit) throw new ApiError(413, 'too_large');
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new ApiError(413, 'too_large');
    }
    chunks.push(value);
  }
  if (size === 0) return {};
  const bytes = new Uint8Array(size);
  let off = 0;
  for (const ch of chunks) {
    bytes.set(ch, off);
    off += ch.byteLength;
  }
  let parsed: unknown;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes);
    if (tooDeep(text, JSON_MAX_DEPTH)) throw new ApiError(400, 'bad_request');
    parsed = JSON.parse(text);
  } catch {
    throw new ApiError(400, 'bad_request');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new ApiError(400, 'bad_request');
  return parsed as Record<string, unknown>;
}

