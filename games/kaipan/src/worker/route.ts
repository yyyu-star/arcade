/**
 * 开盘 Worker 的分流：/games/kaipan/health（监控用）在一切之前直接回；/games/kaipan/api/*（实盘钱包接口，./live.ts）不看 GATE、总要认人；其余交给登录闸门（./gate.ts）。
 * 单独部署时站点根 / 转到游戏（standaloneRoot）。这几条路径都要列在 wrangler.jsonc 的 assets.run_worker_first 里才会进到 Worker。
 */
import { ME_TIMEOUT_MS, handle, isStandalone, type Env } from './gate.ts';
import { WALLET_TIMEOUT_MS, handleLive } from './live.ts';
import pkg from '../../package.json' with { type: 'json' };

const API_PREFIX = '/games/kaipan/api/';
const HOME = '/games/kaipan/';
const HEALTH = '/games/kaipan/health';

/**
 * 健康检查：给监控看 Worker 活着、跑的是哪一版。走在登录闸门前面，不读存储、不问平台，单独部署时一样能访问。
 */
function health(req: Request): Response | null {
  if (new URL(req.url).pathname !== HEALTH || (req.method !== 'GET' && req.method !== 'HEAD')) return null;
  return Response.json({ ok: true, version: pkg.version }, { headers: { 'Cache-Control': 'no-store' } });
}

/**
 * 0.8.0 单独部署到 workers.dev 时游戏仍挂在 /games/kaipan/（资源都按这个路径打包），站点根 / 302 过去，带上查询串。
 * 本站的 / 是平台首页，不归开盘管（本站部署时也没有这条路由），所以只在单独部署时转。
 */
function standaloneRoot(req: Request, env: Env): Response | null {
  const url = new URL(req.url);
  if (!isStandalone(env) || url.pathname !== '/') return null;
  return new Response(null, { status: 302, headers: { Location: HOME + url.search, 'Cache-Control': 'no-store' } });
}

/** timeoutMs 给测试用：不传时闸门按 3 秒、钱包按 5 秒 */
export function route(req: Request, env: Env, timeoutMs?: number): Promise<Response> {
  const ok = health(req);
  if (ok) return Promise.resolve(ok);
  const root = standaloneRoot(req, env);
  if (root) return Promise.resolve(root);
  if (new URL(req.url).pathname.startsWith(API_PREFIX)) return handleLive(req, env, timeoutMs ?? WALLET_TIMEOUT_MS);
  return handle(req, env, timeoutMs ?? ME_TIMEOUT_MS);
}
