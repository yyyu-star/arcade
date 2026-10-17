/**
 * 夜巡实盘的钱包接口（DESIGN.md 5.6，照开盘 0.11.2）：POST /games/yexun/api/live/{buyin,settle,refund}。
 *
 * 浏览器只给 ref / tier / bp（结回倍数，万分之几）和可选的战绩小结；金额和到期时间都由 Worker 定：
 * 带入固定是这一档的一份，until 是 Worker 时钟的现在 + 24 小时；结回前先看一眼钱包（view），按桌上那一份的金额算，
 * 不信浏览器报的档位（带小档、报豪华档就能多拿）。浏览器从不直接碰钱包，平台的 /api 里也没有这几条路。
 *
 * 认人自己问 /api/me，"等响应"和"读响应体"两段都用 Promise.race 限时（平台不理会中止信号时也照样按时放弃）。
 * 不管 GATE 开关都认人：钱包动的是真账户。校验顺序是 方法/路径 → 单独部署 → CSRF → 请求体 → 认人 → 钱包，前面不过就不去问平台和钱包。
 * 钱包的业务拒绝（no_funds、at_table……）是正常回话，原样 200 交给浏览器按 error 处理；钱包连不上才回 503。
 *
 * 只从 src/content/live.ts 取档位表（不引规则核心）。
 */
import { LIVE_MAX_BP, LIVE_OPEN, LIVE_TIERS, isLiveTier, liveReturn, type LiveTier } from '../src/content/live.ts';

type WalletReply = { ok: true; wallet: unknown; credited?: number; capped?: number; dup?: boolean } | { ok: false; error: string; wallet?: unknown };

export interface WalletRpc {
  view(userId: string): Promise<WalletReply>;
  buyin(req: { userId: string; game: 'yexun'; ref: string; tier: LiveTier; amount: number; until: number; mode: 'client'; op: string }): Promise<WalletReply>;
  /** stats：战绩小结（平台 5.10），浏览器报什么原样转发，形状由平台校验 */
  settle(req: { userId: string; game: 'yexun'; ref: string; amount: number; mode: 'client'; op: string; stats?: unknown }): Promise<WalletReply>;
  refund(req: { userId: string; game: 'yexun'; ref: string; mode: 'client'; op: string }): Promise<WalletReply>;
}

export interface LiveEnv {
  ARCADE?: { fetch(input: Request): Promise<Response> };
  GATE?: string;
  /** 平台钱包 RPC（服务绑定，props.game=yexun）；单独部署没有，接口回 501 no_wallet */
  WALLET?: WalletRpc;
}

export const WALLET_TIMEOUT_MS = 5000;
export const ME_TIMEOUT_MS = 3000;
const BODY_MAX = 2048;
const BUYIN_TTL_MS = 24 * 3600 * 1000;
/** 钱包只收 8–64 位；最长的后缀 -refund 占 7 位，所以 ref 最长 57 */
const REF_RE = /^[A-Za-z0-9_-]{8,57}$/;
export const LIVE_PREFIX = '/games/yexun/api/live/';
const ACTIONS = ['buyin', 'settle', 'refund'] as const;
/** 只转发这两个头：Cookie 用来认人，cf-connecting-ip 给平台限流 */
const FORWARD = ['cookie', 'cf-connecting-ip'];

function reply(status: number, body: unknown, cookies: string[] = []): Response {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify(body), { status, headers });
}
const fail = (status: number, error: string, cookies: string[] = []): Response => reply(status, { ok: false, error }, cookies);

/** 单独部署（没有平台）：没有 ARCADE 绑定，GATE 也不是 login（GATE=login 却没有 ARCADE 算漏了绑定，按平台不可用处理） */
const standalone = (env: LiveEnv): boolean => !env.ARCADE && env.GATE !== 'login';

/** 读 JSON 对象体：必须带 Content-Length 且 0 < n ≤ 2 KB，否则不读；读出来的再按字节判一次（Content-Length 可能撒谎） */
async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  const raw = req.headers.get('content-length');
  const len = raw !== null && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!(len > 0 && len <= BODY_MAX)) return null;
  try {
    const text = await req.text();
    if (new TextEncoder().encode(text).length > BODY_MAX) return null;
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * 问平台这个请求的人是谁；任何异常都算平台不可用（down）。cookies 是平台在 /api/me 里顺手下发的 Set-Cookie（会话续期），原样带回给浏览器。
 */
export async function whoIs(req: Request, env: LiveEnv, timeoutMs = ME_TIMEOUT_MS): Promise<{ verdict: 'in' | 'out' | 'down'; cookies: string[]; userId: string | null }> {
  const down = { verdict: 'down' as const, cookies: [], userId: null };
  const arcade = env.ARCADE;
  if (!arcade || typeof arcade.fetch !== 'function') return down;
  const headers = new Headers();
  for (const k of FORWARD) {
    const v = req.headers.get(k);
    if (v) headers.set(k, v);
  }
  const ctrl = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      ctrl.abort();
      resolve('timeout');
    }, timeoutMs);
  });
  try {
    const res = await Promise.race([arcade.fetch(new Request(new URL('/api/me', req.url), { method: 'GET', headers, signal: ctrl.signal })), timeout]);
    if (res === 'timeout' || res.status !== 200) return down;
    const body: unknown = await Promise.race([res.json(), timeout]);
    if (body === 'timeout' || body === null || typeof body !== 'object' || !('user' in body)) return down;
    const user = (body as { user: unknown }).user;
    const cookies = res.headers.getSetCookie();
    if (user === null) return { verdict: 'out', cookies, userId: null };
    if (typeof user !== 'object') return down;
    const id = (user as { id?: unknown }).id;
    return { verdict: 'in', cookies, userId: typeof id === 'string' && id !== '' ? id : null };
  } catch {
    return down;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** 钱包里夜巡桌上 ref 这一份带入了多少（平台 WalletView.stakes）；没有或形状不对为 null */
function stakeAmount(wallet: unknown, ref: string): number | null {
  const stakes = (wallet as { stakes?: unknown } | null)?.stakes;
  if (!Array.isArray(stakes)) return null;
  const st = stakes.find((x): x is { game: string; ref: string; amount: number } => !!x && typeof x === 'object' && x.game === 'yexun' && x.ref === ref);
  return st && Number.isSafeInteger(st.amount) && st.amount > 0 ? st.amount : null;
}

/** open：实盘开没开（LIVE_OPEN）；测试传 true 测带入 */
export async function handleLive(req: Request, env: LiveEnv, timeoutMs = WALLET_TIMEOUT_MS, open = LIVE_OPEN): Promise<Response> {
  const url = new URL(req.url);
  const action = url.pathname.startsWith(LIVE_PREFIX) ? ACTIONS.find((a) => a === url.pathname.slice(LIVE_PREFIX.length)) : undefined;
  if (!action) return fail(404, 'not_found');
  if (req.method !== 'POST') return fail(405, 'method');
  // 单独部署没有平台钱包：说清楚是"这里没有"（501），不是"暂时连不上"（503），页面不会去重试
  if (standalone(env)) return fail(501, 'no_wallet');
  // 没开实盘：只挡带入（页面按 501 把入口藏起来），结回、退回照常
  if (!open && action === 'buyin') return fail(501, 'closed');
  // CSRF：自定义头让跨站表单发不出来，Origin 对得上才认
  if (req.headers.get('X-Arcade') !== '1' || req.headers.get('Origin') !== url.origin) return fail(403, 'csrf');

  const body = await readBody(req);
  if (!body) return fail(400, 'bad_request');
  const ref = body.ref;
  if (typeof ref !== 'string' || !REF_RE.test(ref)) return fail(400, 'bad_ref');
  // 浏览器记着带入的账号：结回、放弃时带上，现在登录的不是他就不动钱包
  const expect = body.user;
  if (expect !== undefined && (typeof expect !== 'string' || expect === '' || expect.length > 128)) return fail(400, 'bad_user');

  let call: (w: WalletRpc, userId: string) => Promise<WalletReply>;
  if (action === 'refund') {
    call = (w, userId) => w.refund({ userId, game: 'yexun', ref, mode: 'client', op: `${ref}-refund` });
  } else {
    const tier = body.tier;
    if (!isLiveTier(tier)) return fail(400, 'bad_tier');
    const stake = LIVE_TIERS[tier].stake;
    if (action === 'buyin') {
      call = (w, userId) => w.buyin({ userId, game: 'yexun', ref, tier, amount: stake, until: Date.now() + BUYIN_TTL_MS, mode: 'client', op: `${ref}-in` });
    } else {
      const bp = body.bp;
      if (typeof bp !== 'number' || !Number.isInteger(bp) || bp < 0 || bp > LIVE_MAX_BP) return fail(400, 'bad_bp');
      const stats = body.stats;
      call = async (w, userId) => {
        const v = await w.view(userId);
        // 看不了钱包就当连不上（503，浏览器过会儿重发），不退回去按浏览器报的档位算
        if (!v.ok) throw new Error('view');
        // 桌上没有这一份（已经结过、到期退回了）时钱包只会回重发的原结果或 no_stake，金额用不上，按报的档位填
        const base = stakeAmount(v.wallet, ref) ?? stake;
        return w.settle({ userId, game: 'yexun', ref, amount: liveReturn(base, bp), mode: 'client', op: `${ref}-out`, ...(stats === undefined ? {} : { stats }) });
      };
    }
  }

  const { verdict, cookies, userId } = await whoIs(req, env, Math.min(timeoutMs, ME_TIMEOUT_MS));
  if (verdict === 'out') return fail(401, 'login', cookies);
  if (verdict === 'down' || userId === null) return fail(503, 'unavailable', cookies);
  if (expect !== undefined && expect !== userId) return fail(409, 'wrong_user', cookies);

  const wallet = env.WALLET;
  if (!wallet || typeof wallet[action] !== 'function') return fail(503, 'unavailable', cookies);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  try {
    const res: unknown = await Promise.race([call(wallet, userId), timeout]);
    if (res === 'timeout' || res === null || typeof res !== 'object' || typeof (res as { ok?: unknown }).ok !== 'boolean') return fail(503, 'unavailable', cookies);
    // 带上是谁：浏览器记进 yexun.live，之后结回、放弃时带回来对账号
    return reply(200, { ...res, user: userId }, cookies);
  } catch {
    return fail(503, 'unavailable', cookies);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
