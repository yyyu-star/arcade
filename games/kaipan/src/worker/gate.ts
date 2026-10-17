/**
 * 开盘 Worker 的登录闸门（0.5.6）：测试期邀请制，打开首页前先问平台登录了没有。入口在 ./index.ts。
 *
 * 只有 wrangler.jsonc 里 assets.run_worker_first 列出的首页路径会先进到这里；js、图片、行情数据仍由静态资源直接回，
 * 不多一次跨 Worker 调用。GATE=off（或没配）时什么都不做，和以前一样直接回静态资源；wrangler.jsonc 里配的是 login。
 *
 * GATE=login 时：
 * - 经服务绑定 ARCADE 问平台 GET /api/me（只带 Cookie 和 cf-connecting-ip，3 秒超时）；
 * - 登录了放行，没登录 302 到 /login?from=kaipan；
 * - 平台下线、超时、非 200、不是 JSON、绑定不存在：一律不放行，回 503「过一会儿再来」。
 *   测试期的目标是"没受邀的人玩不到"，所以宁可暂时谁都进不去，也不放进来（fail-closed）。
 * GATE 写成 off / login 以外的值也按 login 处理：开关写错时往"关门"那边偏。
 *
 * 0.8.0 两种部署（和共用包 arcade-kit 的语义一样；开盘的 Worker 不引共用包，自己按同样的规则写）：
 * - 本站：部署工具（tools/deployer）补上 ARCADE、WALLET 绑定和 GATE=login，行为和以前一样；
 * - 单独部署（模块里的 wrangler.jsonc 原样部署）：没有 ARCADE、GATE 不是 login，谁打开都能玩，实盘接口一律拒绝（见 isStandalone）。
 *   GATE=login 却没有 ARCADE（漏了绑定）不算单独部署，照旧按平台不可用拦下（fail-closed）。
 *
 * 不依赖 @cloudflare/workers-types：下面只声明用到的那一点接口。
 */

import type { WalletRpc } from './live.ts';

export interface Fetcher {
  fetch(input: Request): Promise<Response>;
}

export interface Env {
  /** 静态资源（dist-cf） */
  ASSETS: Fetcher;
  /** 平台 Worker（arcade）的服务绑定；没配时按平台不可用处理 */
  ARCADE?: Fetcher;
  /** 登录闸门：'off' 或 'login'（本站部署时由部署工具设成 login；模块里的独立配置不写，按 off） */
  GATE?: string;
  /** 平台钱包 RPC（服务绑定 arcade 的 WalletService，props.game=kaipan）；单独部署没有，实盘接口回 501 no_wallet */
  WALLET?: WalletRpc;
}

/** 单独部署（没有平台）：没有 ARCADE 绑定，GATE 也不是 login。 */
export function isStandalone(env: Pick<Env, 'ARCADE' | 'GATE'>): boolean {
  return !env.ARCADE && env.GATE !== 'login';
}

/** 要过闸门的路径，和 wrangler.jsonc 的 run_worker_first 保持一致（别的路径即使进来也直接放行给静态资源）。 */
export const GATED_PATHS: readonly string[] = ['/games/kaipan', '/games/kaipan/', '/games/kaipan/index.html'];

export const ME_TIMEOUT_MS = 3000;
export const LOGIN_URL = '/login?from=kaipan';
/** 只转发这两个头：Cookie 用来认人，cf-connecting-ip 给平台限流 */
const FORWARD = ['cookie', 'cf-connecting-ip'];

type Verdict = 'in' | 'out' | 'down';

/**
 * 问平台这个请求的人登录了没有；任何异常都算平台不可用（down）。
 * cookies 是平台在 /api/me 里顺手下发的 Set-Cookie（会话续期、无效会话清 cookie），闸门要原样带回给浏览器：
 * 平台续期时只延长了服务端的过期时间，cookie 的有效期靠这条 Set-Cookie 更新，丢掉的话只玩开盘的人到点就被登出。
 */
export async function checkLogin(req: Request, env: Env, timeoutMs = ME_TIMEOUT_MS): Promise<{ verdict: Verdict; cookies: string[]; userId: string | null }> {
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
  // 超时同时管住"等响应"和"读响应体"两段；绑定不理会 signal 时也照样按时放弃
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => {
      ctrl.abort();
      resolve('timeout');
    }, timeoutMs);
  });
  try {
    // 经服务绑定调用时主机名不起作用；按请求自己的 origin 拼，日志里看得懂，也不用在代码里写站点地址
    const me = new URL('/api/me', req.url);
    const res = await Promise.race([arcade.fetch(new Request(me, { method: 'GET', headers, signal: ctrl.signal })), timeout]);
    if (res === 'timeout' || res.status !== 200) return down;
    const body: unknown = await Promise.race([res.json(), timeout]);
    if (body === 'timeout' || body === null || typeof body !== 'object' || !('user' in body)) return down;
    const user = (body as { user: unknown }).user;
    const cookies = res.headers.getSetCookie();
    if (user === null) return { verdict: 'out', cookies, userId: null };
    if (typeof user !== 'object') return down;
    // 钱包按 userId 记账，所以把 id 一起带出来；没有非空字符串 id 时 userId 为 null，由调用方决定怎么处理
    const id = (user as { id?: unknown }).id;
    return { verdict: 'in', cookies, userId: typeof id === 'string' && id !== '' ? id : null };
  } catch {
    return down;
  } finally {
    clearTimeout(timer);
  }
}

const NO_STORE_PRIVATE = 'private, no-store';

function busyPage(): Response {
  const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>开盘</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#fdf3e4;color:#3b2a33;font:18px/1.6 system-ui,sans-serif;text-align:center}a{color:#d9622b;font-weight:bold}</style></head>
<body><main><p>服务器有点忙，过一会儿再来</p><p><a href="/">回首页</a></p></main></body></html>`;
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Retry-After': '30' } });
}

/** 静态资源的响应换一份可改头的副本，加上不缓存（登录状态不同，看到的东西不同），再带上平台下发的 cookie。 */
function noStore(res: Response, cookies: string[]): Response {
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', NO_STORE_PRIVATE);
  for (const c of cookies) out.headers.append('Set-Cookie', c);
  return out;
}

export async function handle(req: Request, env: Env, timeoutMs = ME_TIMEOUT_MS): Promise<Response> {
  const gate = env.GATE ?? 'off';
  if (gate === 'off' || !GATED_PATHS.includes(new URL(req.url).pathname)) return env.ASSETS.fetch(req);
  const { verdict, cookies } = await checkLogin(req, env, timeoutMs);
  if (verdict === 'in') return noStore(await env.ASSETS.fetch(req), cookies);
  if (verdict === 'out') {
    const headers = new Headers({ Location: LOGIN_URL, 'Cache-Control': NO_STORE_PRIVATE });
    for (const c of cookies) headers.append('Set-Cookie', c);
    return new Response(null, { status: 302, headers });
  }
  return busyPage();
}
