/**
 * 开盘 Worker 的实盘钱包接口（0.6.0）：POST /games/kaipan/api/live/{buyin,settle,refund}。
 *
 * 由 ./route.ts 按路径转进来。浏览器只给 ref / tier / bp（结回倍数，万分之几）；金额和到期时间都由 Worker 定：
 * 带入的 amount 固定是这一档的一份（不能少带），until 是 Worker 时钟的现在 + 24 小时；结回的 amount 由桌上那一份的金额和 bp 算出：
 * 结回前先看一眼钱包（view），按带入时记下的金额算，不信浏览器报的档位（带小档、报豪华档就能多拿，0.11.2 审计堵上）。
 * 浏览器从不直接碰钱包，平台的 /api 里也没有这几条路（设计稿第 6 节）。
 *
 * 认人沿用 gate.ts 的 checkLogin，而不用 arcade-kit 的 whoIs：whoIs 只在 fetch 上挂 AbortSignal.timeout，
 * 平台不理会中止信号、或响应头回来了响应体迟迟不来时会一直挂住；checkLogin 对"等响应"和"读响应体"两段都用 Promise.race 限时，
 * 有测试锁住（tests/worker-gate.test.ts）。这样 Worker 也不必为此引共用包（0.12.0 起只有页面用它的分享卡和社交部件）。
 *
 * 不管 GATE 开关都认人：钱包动的是真账户。校验顺序是 方法/路径 → 单独部署 → CSRF → 请求体 → 认人 → 钱包，前面不过就不去问平台和钱包。
 * 钱包的业务拒绝（no_funds、at_table……）是正常回话，原样 200 交给浏览器按 error 处理；钱包连不上才回 503。
 *
 * 只从 core/liveTiers.ts 取档位表：整个 core/index.ts 会把规则引擎打进 Worker。
 */
import { LIVE_MAX_BP, isLiveTier, liveReturn, liveTierById, type LiveTier } from '../core/liveTiers.ts';
import { ME_TIMEOUT_MS, checkLogin, isStandalone, type Env } from './gate.ts';

type WalletReply = { ok: true; wallet: unknown; credited?: number; capped?: number; dup?: boolean } | { ok: false; error: string; wallet?: unknown };

export interface WalletRpc {
  view(userId: string): Promise<WalletReply>;
  buyin(req: { userId: string; game: 'kaipan'; ref: string; tier: LiveTier; amount: number; until: number; mode: 'client'; op: string }): Promise<WalletReply>;
  /** stats：0.6.5 战绩小结（平台 5.10），浏览器报什么原样转发，形状由平台校验（不合格整份忽略、钱照常结） */
  settle(req: { userId: string; game: 'kaipan'; ref: string; amount: number; mode: 'client'; op: string; stats?: unknown }): Promise<WalletReply>;
  refund(req: { userId: string; game: 'kaipan'; ref: string; mode: 'client'; op: string }): Promise<WalletReply>;
}

export const WALLET_TIMEOUT_MS = 5000;
const BODY_MAX = 2048;
const BUYIN_TTL_MS = 24 * 3600 * 1000;
/** 钱包只收 8–64 位；最长的后缀 -refund 占 7 位，所以 ref 最长 57 */
const REF_RE = /^[A-Za-z0-9_-]{8,57}$/;
const PREFIX = '/games/kaipan/api/live/';
const ACTIONS = ['buyin', 'settle', 'refund'] as const;

function reply(status: number, body: unknown, cookies: string[] = []): Response {
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, no-store' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(JSON.stringify(body), { status, headers });
}
const fail = (status: number, error: string, cookies: string[] = []): Response => reply(status, { ok: false, error }, cookies);

/**
 * 读 JSON 对象体：必须带 Content-Length 且 0 < n ≤ 2 KB，否则不读（分块传输没有长度，读了就可能读进一大坨）。
 * 读出来的再按字节判一次（Content-Length 可能撒谎）。
 */
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

/** 钱包里开盘桌上 ref 这一份带入了多少（平台 WalletView.stakes）；没有或形状不对为 null */
function stakeAmount(wallet: unknown, ref: string): number | null {
  const stakes = (wallet as { stakes?: unknown } | null)?.stakes;
  if (!Array.isArray(stakes)) return null;
  const st = stakes.find((x): x is { game: string; ref: string; amount: number } => !!x && typeof x === 'object' && x.game === 'kaipan' && x.ref === ref);
  return st && Number.isSafeInteger(st.amount) && st.amount > 0 ? st.amount : null;
}

export async function handleLive(req: Request, env: Env, timeoutMs = WALLET_TIMEOUT_MS): Promise<Response> {
  const url = new URL(req.url);
  const action = url.pathname.startsWith(PREFIX) ? ACTIONS.find((a) => a === url.pathname.slice(PREFIX.length)) : undefined;
  if (!action) return fail(404, 'not_found');
  if (req.method !== 'POST') return fail(405, 'method');
  // 0.8.0 单独部署没有平台钱包，实盘根本开不了：说清楚是"这里没有"（501），不是"暂时连不上"（503），页面不会去重试
  if (isStandalone(env)) return fail(501, 'no_wallet');
  // CSRF：自定义头让跨站表单发不出来，Origin 对得上才认
  if (req.headers.get('X-Arcade') !== '1' || req.headers.get('Origin') !== url.origin) return fail(403, 'csrf');

  const body = await readBody(req);
  if (!body) return fail(400, 'bad_request');
  const ref = body.ref;
  if (typeof ref !== 'string' || !REF_RE.test(ref)) return fail(400, 'bad_ref');
  // 浏览器记着带入的账号：结回、放弃时带上，现在登录的不是他就不动钱包（换了账号不能拿新账号去结旧账号的那一份）
  const expect = body.user;
  if (expect !== undefined && (typeof expect !== 'string' || expect === '' || expect.length > 128)) return fail(400, 'bad_user');

  // 校验通过后得到要调的钱包方法（闭包里已带好 userId 以外的全部参数）
  let call: (w: WalletRpc, userId: string) => Promise<WalletReply>;
  if (action === 'refund') {
    call = (w, userId) => w.refund({ userId, game: 'kaipan', ref, mode: 'client', op: `${ref}-refund` });
  } else {
    const tier = body.tier;
    if (!isLiveTier(tier)) return fail(400, 'bad_tier');
    const stake = liveTierById(tier).stake;
    if (action === 'buyin') {
      call = (w, userId) => w.buyin({ userId, game: 'kaipan', ref, tier, amount: stake, until: Date.now() + BUYIN_TTL_MS, mode: 'client', op: `${ref}-in` });
    } else {
      const bp = body.bp;
      if (typeof bp !== 'number' || !Number.isInteger(bp) || bp < 0 || bp > LIVE_MAX_BP) return fail(400, 'bad_bp');
      // 战绩小结只转发不改（平台 5.10：游戏 Worker 的路由不改、不补）；没带就不放这个字段
      const stats = body.stats;
      call = async (w, userId) => {
        const v = await w.view(userId);
        // 看不了钱包就当连不上（503，浏览器过会儿重发），不退回去按浏览器报的档位算
        if (!v.ok) throw new Error('view');
        // 桌上没有这一份（已经结过、到期退回了）时钱包只会回重发的原结果或 no_stake，金额用不上，按报的档位填
        const base = stakeAmount(v.wallet, ref) ?? stake;
        return w.settle({ userId, game: 'kaipan', ref, amount: liveReturn(base, bp), mode: 'client', op: `${ref}-out`, ...(stats === undefined ? {} : { stats }) });
      };
    }
  }

  // 问 /api/me 仍按闸门的 3 秒（测试传更小的值时两段都跟着缩）
  const { verdict, cookies, userId } = await checkLogin(req, env, Math.min(timeoutMs, ME_TIMEOUT_MS));
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
    // 带上是谁：浏览器记进 kaipan.live，之后结回、放弃时带回来对账号
    return reply(200, { ...res, user: userId }, cookies);
  } catch {
    return fail(503, 'unavailable', cookies);
  } finally {
    clearTimeout(timer);
  }
}

