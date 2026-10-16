/**
 * 游戏 Worker 里开房、进房的两个入口：校验房间码、查 Origin、经平台 /api/me 认人、再找房间，打包在一起。
 * 游戏只要把路由接到这两个函数上，不用自己碰浏览器的原始请求，也就没有机会把它（连同浏览器自己带的头）原样转给房间。
 *
 * 进房被拒时不回 4xx：浏览器的 WebSocket 拿不到 HTTP 状态码，只会看到"连不上"，然后一直重连。
 * 这里先接受升级、马上用关闭码关掉，客户端认得这些码：4401 没登录、4403 别的网站、4004 没有这个房间都不再重连
 * （房间自己还会回 4503：今天联机额度快满了，不进新人）；
 * 平台暂时不可用是 1013（稍后再试），客户端按退避重连。
 * 独立模式（0.10.0，guest.ts）：没有 ARCADE 绑定、GATE 也不是 login 时认游客 cookie（开房时没有就现发一个），
 * 浏览器可以在开房、进房的地址上带 ?name=<昵称>；有 ARCADE 绑定时和以前完全一样。
 * 这是普通 Worker，不是房间，没有 ctx.acceptWebSocket，只能用 server.accept()；连接接受了马上关，不留着。
 */
import { identify, sameOrigin } from './auth.js';
import { type GuestOptions, isStandalone, type ModeEnv } from './guest.js';
import { CLOSE, type CreateError, ROOM_CODE_RE } from './protocol.js';
import { identityHeader, type Identity, KIT_HOST, newRoomCode, roomStub } from './internal.js';
import type { MeterEnv } from './meter.js';
import type { CreateOutcome } from './room.js';

/**
 * 游戏 Worker 的绑定名固定：房间 ROOM，平台 ARCADE（登录闸门已经用这个名字），计量 METER、门槛 KIT_QUOTA（0.2.0，meter.ts）。
 * METER 是房间自己用的（开房占名额、报写入），这里列出来是为了游戏的 Env 一眼看全
 */
export interface KitEnv extends MeterEnv {
  ROOM: DurableObjectNamespace;
  ARCADE?: Fetcher;
  /** "login" 表示这次部署必须接平台（0.10.0）：没绑 ARCADE 时按平台不可用拒绝，不退成游客模式 */
  GATE?: string;
}

export interface GateOptions {
  /**
   * Origin 只认这个站点（比如 https://<你的站点>）。不给就认请求自己的 origin（0.9.0）：浏览器从哪个站点打开页面、连的就是哪个站点，
   * 别的网站的页面带来的 Origin 对不上。游戏可以把部署时注入的 SITE_ORIGIN 变量传进来，设了就按它
   */
  siteOrigin?: string;
  /** 默认是请求所在站点的 /api/me */
  meUrl?: string;
  /** 独立模式的游客设置（cookie 名、游戏电脑人物的名字当保留昵称，0.10.0）；平台模式不看 */
  guest?: GuestOptions;
}

/** 认人：按部署方式（identify），昵称取地址里的 ?name= */
function who(request: Request, env: KitEnv, opts: GateOptions, mint: boolean) {
  return identify(request, env, {
    ...(opts.meUrl ? { meUrl: opts.meUrl } : {}),
    ...(opts.guest ? { guest: opts.guest } : {}),
    mint,
    nickname: new URL(request.url).searchParams.get('name'),
  });
}

export interface CreateOptions extends GateOptions {
  /**
   * 开房时就定下的开局选项（0.4.0，可选）：游戏 Worker 从开房请求里取出来原样传进来，房间用 RoomGame.options 校验，
   * 不合格回 400 bad_options、不占名额也不建房间。定下以后不能再改：进房的人都看得到（RoomInfo.opts），开打时 start 带的 opts 不看。
   * 不带就和以前一样，由房主开打时的 start 定
   */
  options?: unknown;
}

/**
 * 开房：POST。成功 201 { code }；失败回 JSON { error, code? }（protocol.ts 的 CreateError）：
 * 别的网站 403 forbidden；没登录 401 login；这个人已经有开着的房间 409 has_room（带那个房间的码）；今天开房次数用完 429 daily_limit；
 * 今天联机的人太多 503 busy；开房选项不合格 400 bad_options（0.4.0）；平台或计量连不上、房间码连撞 5 次、房间出错 503 unavailable。
 * 额度由房间开房时向计量（env.METER，meter.ts）去占；没绑计量就不限额。
 * 独立模式下没有游客 cookie 就现发一个（任何结果的回话都带上这条 Set-Cookie）。
 */
export async function acceptCreate(request: Request, env: KitEnv, opts: CreateOptions = {}): Promise<Response> {
  if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if (!sameOrigin(request, opts.siteOrigin)) return fail(403, 'forbidden');
  const w = await who(request, env, opts, true);
  if ('error' in w) return w.error === 'anonymous' ? fail(401, 'login') : fail(503, 'unavailable');
  const me = w.user;
  // 平台模式不转 Set-Cookie（和以前一样）；独立模式现发的游客 cookie 要带回去，不然下次进房认不出这个人
  const cookies = isStandalone(env) ? w.setCookie : [];
  const res = await create(env, me, opts);
  return cookies.length ? withCookies(res, cookies) : res;
}

async function create(env: KitEnv, me: Identity, opts: CreateOptions): Promise<Response> {
  for (let i = 0; i < 5; i++) {
    const code = newRoomCode();
    // 走 RPC，不走 fetch：身份是参数，不在任何请求头里
    const stub = roomStub(env.ROOM, code) as unknown as { kitCreate(code: string, host: Identity, opts?: unknown): Promise<CreateOutcome> };
    const out = await stub.kitCreate(code, me, opts.options);
    switch (out.r) {
      case 'created':
        return Response.json({ code }, { status: 201 });
      case 'exists':
        continue;
      case 'has_room':
        return fail(409, 'has_room', out.code);
      case 'daily_limit':
        return fail(429, 'daily_limit');
      case 'bad_options':
        return fail(400, 'bad_options');
      case 'busy':
        return fail(503, 'busy');
      default:
        return fail(503, 'unavailable');
    }
  }
  return fail(503, 'unavailable');
}

function fail(status: number, error: CreateError, code?: string): Response {
  return Response.json(code ? { error, code } : { error }, { status });
}

/**
 * 进房：WebSocket 升级。认不出人、别的网站、码不对、平台不可用，都是"接受后马上用关闭码关掉"。
 * 独立模式下进房不发游客 cookie（101 回话上的 Set-Cookie 浏览器不一定收）：没有就 4401，页面刷新一下首页（loginGate 会发）再来
 */
export async function acceptJoin(request: Request, env: KitEnv, code: string, opts: GateOptions = {}): Promise<Response> {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('websocket only', { status: 426 });
  if (!ROOM_CODE_RE.test(code)) return refuse(CLOSE.noRoom, 'no room');
  if (!sameOrigin(request, opts.siteOrigin)) return refuse(CLOSE.forbidden, 'bad origin');
  const w = await who(request, env, opts, false);
  if ('error' in w) return w.error === 'anonymous' ? refuse(CLOSE.unauthorized, 'login first') : refuse(CLOSE.tryLater, 'try later');
  const me = w.user;
  // 新建请求，只带认好的身份和客户端版本；浏览器带来的 x-kit-user 之类的头一律不转
  const cv = new URL(request.url).searchParams.get('cv') ?? '0';
  return roomStub(env.ROOM, code).fetch(`https://${KIT_HOST}/ws?cv=${encodeURIComponent(cv)}`, {
    headers: { upgrade: 'websocket', 'x-kit-user': identityHeader(me) },
  });
}

function refuse(code: number, reason: string): Response {
  const pair = new WebSocketPair();
  pair[1].accept();
  pair[1].close(code, reason);
  return new Response(null, { status: 101, webSocket: pair[0] });
}

/**
 * 登录闸门要的绑定：页面的静态资源 ASSETS、平台 ARCADE；GATE 写 "off" 时不拦（本地开发试页面用）。
 * 没有 ARCADE、GATE 也不是 "login" 是独立模式（0.10.0）：不拦，补发游客 cookie
 */
export interface GateEnv {
  ASSETS: Fetcher;
  ARCADE?: Fetcher;
  GATE?: string;
}

export interface LoginGateOptions {
  /** 默认是请求所在站点的 /api/me */
  meUrl?: string;
  /** 平台连不上时回的整页 HTML（503）；默认一个不带游戏名的通用页，游戏可以换成自己的标题和配色 */
  downPage?: string;
  /** 独立模式的游客设置（0.10.0）：cookie 名要和开房、进房传的一样 */
  guest?: GuestOptions;
}

/** 平台连不上时的默认页：不写游戏名，回大厅的链接指向平台首页 */
export const DOWN_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>平台暂时连不上</title>
<style>body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;background:#1b1f2a;color:#eef0f4;font:16px/1.6 system-ui,sans-serif;text-align:center}
a{color:#f3c86b}</style></head>
<body><main><h1>平台暂时连不上</h1><p>稍等一会儿再刷新试试。</p><p><a href="/">回大厅</a></p></main></body></html>`;

/**
 * 游戏首页的登录闸门（0.8.0，docs/platform-backend.md 5.8、15.8）：游戏 Worker 把首页（`/games/<id>/`、`index.html`）交给它。
 * - 登录了：放行，回 ASSETS 的页面，带上平台续期的 Set-Cookie，不缓存；
 * - 没登录：302 到 `/login?next=<原路径和查询参数>`（平台 0.10.1 的 next，登录完整页跳回来，好友房链接的 ?room= 原样带回），同样带上 Set-Cookie；
 * - 平台不可用：503 整页（`downPage`），`Retry-After: 30`；
 * - `GATE` 是 "off"：不问平台，直接回页面；
 * - 独立模式（0.10.0，没有 ARCADE、GATE 不是 "login"）：不跳登录，回页面；没有游客 cookie 就补发一个（开房、进房靠它认人）。
 */
export async function loginGate(request: Request, env: GateEnv, opts: LoginGateOptions = {}): Promise<Response> {
  if (isStandalone(env)) {
    const g = await identify(request, env, { ...(opts.guest ? { guest: opts.guest } : {}), mint: true });
    return withCookies(await env.ASSETS.fetch(request), 'user' in g ? g.setCookie : []);
  }
  if (env.GATE === 'off') return env.ASSETS.fetch(request);
  const who = await identify(request, env, opts.meUrl ? { meUrl: opts.meUrl } : {});
  if ('user' in who) return withCookies(await env.ASSETS.fetch(request), who.setCookie);
  if (who.error === 'anonymous') {
    const url = new URL(request.url);
    const next = encodeURIComponent(url.pathname + url.search);
    return withCookies(new Response(null, { status: 302, headers: { location: `/login?next=${next}` } }), who.setCookie);
  }
  return new Response(opts.downPage ?? DOWN_PAGE, {
    status: 503,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '30' },
  });
}

/**
 * 独立部署时站点根路径的跳转（0.10.0）：游戏挂在 `/games/<id>/`，单独部署到 workers.dev 时有人直接打开 `/`，302 到游戏首页（查询参数原样带上）。
 * 只在独立模式、路径正好是 `/` 时回跳转，其余回 null，游戏接着走自己的路由。要让 `/` 先过 Worker：`dist` 根上不能有 index.html，
 * 或者把 "/" 加进 wrangler.jsonc 的 `assets.run_worker_first`
 */
export function standaloneRoot(request: Request, env: ModeEnv, gameId: string): Response | null {
  const url = new URL(request.url);
  if (!isStandalone(env) || url.pathname !== '/' || !/^[a-z0-9-]+$/.test(gameId)) return null;
  return new Response(null, { status: 302, headers: { location: `/games/${gameId}/${url.search}`, 'cache-control': 'no-store' } });
}

export { isStandalone };

/** 带上平台的 Set-Cookie（whoIs 给的 setCookie）；按人回的内容一律不缓存 */
export function withCookies(res: Response, setCookie: readonly string[]): Response {
  const out = new Response(res.body, res);
  out.headers.set('cache-control', 'private, no-store');
  for (const c of setCookie) out.headers.append('set-cookie', c);
  return out;
}

/** JSON 回话，带上 Set-Cookie、不缓存 */
export function json(body: unknown, status: number, setCookie: readonly string[] = []): Response {
  return withCookies(Response.json(body, { status }), setCookie);
}

/**
 * 读 JSON 请求体，读不了回 null。游戏自己的接口读请求体往往在认人之前：必须带 content-length 且 1 到 maxBytes 字节才读
 * （分块传的大请求体不带长度，没登录的人也能让这里解析一大段）。浏览器 fetch 发字符串请求体总带 content-length
 */
export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  const len = request.headers.get('content-length');
  const n = len === null ? NaN : Number(len);
  if (!(n > 0 && n <= maxBytes)) return null;
  try {
    return await request.json();
  } catch {
    return null;
  }
}
