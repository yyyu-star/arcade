/**
 * 进房认人（游戏 Worker 里用）：WebSocket 升级请求带着平台的登录 cookie，游戏 Worker 经服务绑定 ARCADE 问一次平台 GET /api/me，
 * 和游戏登录闸门一个做法（docs/platform-backend.md 15.8）：
 * - 请求里没有平台的会话 cookie（SESSION_COOKIE）就直接算"没登录"，不问平台：没登录的脚本刷进房地址，不占平台的计量（0.1.1）；
 * - 只转发 Cookie 和 cf-connecting-ip 两个头，3 秒超时；
 * - 200 且 user 不为 null 才认，拿 user.id 和昵称交给房间；200 且 user 为 null 是"没登录"；
 * - 其他状态码、不是 JSON、缺字段、超时、绑定不存在都是"平台暂时不可用"：同样拒绝（fail-closed），但和"没登录"分开，
 *   进房时回 1013（稍后再试，客户端会重连），不回 4401（不重连），平台抖一下不至于把正在打牌的人踢走；
 * - 地址按请求自己的 origin 拼（`<请求的 origin>/api/me`，0.9.0）：游戏和平台挂在同一个站点下，平台按主机名认是不是本站；
 *   kit 里不写死站点地址，测试或特殊部署可以用 meUrl 覆盖；
 * - 平台续期或清掉失效会话时回的 Set-Cookie 原样带回来（setCookie），游戏的登录闸门、自己的接口在放行和"没登录"时转给浏览器，
 *   只玩游戏、不回平台页的人 cookie 也能续上（15.8）。进房用不上，不转。
 *
 * 0.10.0 起有独立模式（guest.ts）：游戏不带平台单独部署时认游客，按部署方式选哪种认法的是 identify；whoIs 本身不变，只问平台。
 *
 * 0.3.1 起作为 `arcade-kit/auth` 导出：游戏自己的接口用同一份，不再各抄一份；登录闸门 0.8.0 起直接用 `arcade-kit/worker` 的 `loginGate`。
 *
 * 第一版不做 Ed25519 入场票（5.3）：好友房都是熟人小范围开房，进房时多问一次 /api/me（算平台 1 次调用，带 cookie 时读 D1 一两行）
 * 换来不用管签名密钥、不用改平台；等开房要走平台登记和配额、或者进房量大到这一次调用显得贵了，再换成入场票，房间这边只是换一种认人的方式。
 */
import { cleanNickname, guestIdentity, type GuestOptions, isStandalone, mintGuestCookie, type ModeEnv, readGuestCookie } from './guest.js';
import { hasSessionCookie, type Identity } from './internal.js';

/** 平台"我是谁"接口的路径；完整地址按请求的 origin 拼（meUrlOf） */
export const ME_PATH = '/api/me';

/** 这个请求所在站点的 /api/me 地址 */
export function meUrlOf(request: Request): string {
  return new URL(ME_PATH, request.url).href;
}

export interface WhoIsOptions {
  /** 默认是请求所在站点的 /api/me（meUrlOf） */
  meUrl?: string;
  timeoutMs?: number;
}

export type WhoIs = { user: Identity; setCookie: string[] } | { error: 'anonymous'; setCookie: string[] } | { error: 'unavailable' };

const UNAVAILABLE: WhoIs = { error: 'unavailable' };

export type { Identity };

/** 认人。认不出来时分"没登录"（anonymous）和"平台暂时不可用"（unavailable），两种调用方都要拒绝。 */
export async function whoIs(request: Request, arcade: Fetcher | undefined, opts: WhoIsOptions = {}): Promise<WhoIs> {
  if (!hasSessionCookie(request.headers.get('cookie'))) return { error: 'anonymous', setCookie: [] };
  if (!arcade) return UNAVAILABLE;
  try {
    const res = await arcade.fetch(opts.meUrl ?? meUrlOf(request), {
      headers: {
        cookie: request.headers.get('cookie') ?? '',
        'cf-connecting-ip': request.headers.get('cf-connecting-ip') ?? '',
      },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 3_000),
    });
    if (res.status !== 200) return UNAVAILABLE;
    const body = (await res.json()) as { user?: { id?: unknown; displayName?: unknown } | null };
    if (!body || typeof body !== 'object' || !('user' in body)) return UNAVAILABLE;
    const setCookie = res.headers.getSetCookie();
    const u = body.user;
    if (u === null) return { error: 'anonymous', setCookie };
    if (!u || typeof u.id !== 'string' || !u.id || typeof u.displayName !== 'string') return UNAVAILABLE;
    return { user: { userId: u.id, name: u.displayName }, setCookie };
  } catch {
    return UNAVAILABLE;
  }
}

export interface IdentifyOptions extends WhoIsOptions {
  /** 独立模式的游客设置（cookie 名、游戏的保留昵称） */
  guest?: GuestOptions;
  /** 独立模式下没有游客 cookie 时现发一个（放进 setCookie，调用方要转给浏览器）；不给就算"没登录" */
  mint?: boolean;
  /** 独立模式下浏览器带来的昵称（没清洗过的原样），不合格就用默认的"游客1234"；平台模式不看 */
  nickname?: string | null;
}

/**
 * 按部署方式认人（0.10.0）：
 * - 平台模式（有 ARCADE 绑定，或者 GATE=login）：就是 whoIs，游客 cookie 一律不看；GATE=login 却没绑 ARCADE 时 whoIs 回 unavailable（fail-closed）；
 * - 独立模式（guest.ts 的 isStandalone）：认游客 cookie；没有时 mint 为 true 就现发一个，否则算 anonymous。
 */
export async function identify(request: Request, env: ModeEnv & { ARCADE?: Fetcher }, opts: IdentifyOptions = {}): Promise<WhoIs> {
  if (!isStandalone(env)) return whoIs(request, env.ARCADE, opts.meUrl ? { meUrl: opts.meUrl } : {});
  const nickname = opts.nickname == null ? null : cleanNickname(opts.nickname, opts.guest?.reserved);
  const have = readGuestCookie(request, opts.guest);
  if (have) return { user: await guestIdentity(have, nickname), setCookie: [] };
  if (!opts.mint) return { error: 'anonymous', setCookie: [] };
  const fresh = mintGuestCookie(request, opts.guest);
  return { user: await guestIdentity(fresh.value, nickname), setCookie: [fresh.setCookie] };
}

/**
 * WebSocket 不受同源策略管，别的网站的页面也能往这里连（浏览器会带上能带的 cookie）：升级请求的 Origin 必须是本站。
 * 没带 Origin 的（不是浏览器）也拒绝。
 * 本站默认就是请求自己的 origin（0.9.0：kit 不写死站点地址）；部署时想更严，可以传 siteOrigin（比如由 SITE_ORIGIN 变量注入）
 */
export function sameOrigin(request: Request, siteOrigin?: string): boolean {
  return request.headers.get('origin') === (siteOrigin ?? new URL(request.url).origin);
}
