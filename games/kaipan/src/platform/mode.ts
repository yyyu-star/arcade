/**
 * 0.8.0 有没有平台：开盘可以不带平台单独部署（模块里的 wrangler.jsonc 原样部署到 workers.dev），这时同域没有 /api。
 *
 * 开盘不依赖共用包，判断方法照共用包的 detectPlatform 写（两边说法一致，见共用包 README 的"两种部署方式"）：
 * 启动时问一次同域 GET /api/me——
 * - 2xx、JSON、里面有 user：有平台（user 为 null 是没登录），一切照旧；
 * - 404 / 405 / 410，或回的不是 JSON（单独部署时静态资源回的 404 页、或别的网页）：单独部署，没有平台；
 * - 5xx、429、断网、超时：不知道（平台可能只是抖了一下），按有平台处理，和以前一样。
 *
 * 只有明确"没有平台"才改画面：藏起登录、云存档、排行榜、钱包和实盘，"大厅"改成回游戏首页。
 * 判断出来之前按有平台画（本站的玩家看不到任何变化），判断出来再通知重画。
 */

export type PlatformMode = 'platform' | 'standalone' | 'unknown';

const ME_URL = '/api/me';
const TIMEOUT_MS = 2500;

let mode: PlatformMode = 'unknown';
const listeners = new Set<(m: PlatformMode) => void>();

/** 现在知道的结论（还没问完是 unknown）。 */
export function platformMode(): PlatformMode {
  return mode;
}

/** 明确是单独部署（没有平台）。不知道的时候按有平台算，返回 false。 */
export function standalone(): boolean {
  return mode === 'standalone';
}

/** 结论变了时通知（只会从 unknown 变一次）。返回取消订阅的函数。 */
export function onPlatformMode(fn: (m: PlatformMode) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 按 /api/me 的回话下结论（纯函数，测试直接喂 Response）。 */
export async function classify(res: Response): Promise<PlatformMode> {
  if (res.status === 404 || res.status === 405 || res.status === 410) return 'standalone';
  if (res.status < 200 || res.status >= 300) return 'unknown';
  if (!/^application\/(?:[\w.+-]+\+)?json\b/i.test(res.headers.get('content-type') ?? '')) return 'standalone';
  try {
    const body: unknown = await res.json();
    return body !== null && typeof body === 'object' && !Array.isArray(body) && 'user' in body ? 'platform' : 'standalone';
  } catch {
    // 读到一半断了算不知道
    return 'unknown';
  }
}

/** 问一次平台，记下结论并通知。fetchImpl、timeoutMs 给测试用。 */
export async function detectPlatform(fetchImpl: typeof fetch = fetch, timeoutMs = TIMEOUT_MS): Promise<PlatformMode> {
  let next: PlatformMode;
  try {
    const res = await fetchImpl(ME_URL, { credentials: 'same-origin', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    next = await classify(res);
  } catch {
    next = 'unknown';
  }
  setPlatformMode(next);
  return next;
}

/** 记下结论（测试、调试也用它直接设）。 */
export function setPlatformMode(next: PlatformMode): void {
  if (next === mode) return;
  mode = next;
  for (const fn of [...listeners]) fn(next);
}
