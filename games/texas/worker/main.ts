/**
 * texas Worker：挂在站点的 /games/texas* 下（DESIGN.md 10；路由部署时注入，见 README 的部署一节）。
 * 两种部署（kit 0.10 的 isStandalone，DESIGN.md 10.1）：本站由部署工具补上 ARCADE、WALLET 和 GATE=login，下面说的都是这种；
 * 单独部署（wrangler.jsonc 原样，没有平台）认游客 cookie，没有钱包：单机实盘的接口回 404 no_wallet，好友房的筹码不记账，`/` 跳到 /games/texas/。
 * - 首页三个路径过登录闸门（15.8，kit 0.8.0 的 loginGate）：登录了放行，没登录 302 到 /login?next=<原路径和查询参数>（平台 0.10.1），平台不可用回德州自己的 503 页；GATE=off 时不拦；
 * - /games/texas/api/solo/* 是单机的带入、结回（5.4）：经服务绑定 WALLET 调平台钱包（client 模式）；看钱包、领补给页面直接走平台的 /api/wallet；
 * - /games/texas/rooms（开房）、/games/texas/rooms/<码>/ws（进房）原样交给 kit 的 acceptCreate / acceptJoin（6）；
 *   开房的请求体 { opts } 是档位和人数，交给 kit 开房时校验、定下（kit 0.4.0），进房的人都看得到；
 * - 别的路径不经过这里（wrangler.jsonc 的 run_worker_first 只列了上面这些），由静态资源直接回。
 *
 * 带入、结回要过两道：CSRF（X-Arcade: 1 且 Origin 是本站）、登录；额度、每日上限、写入次数都由平台钱包管（docs/economy.md 第 3、4 节）。
 */
import { sameOrigin, whoIs, type WhoIs } from 'arcade-kit/auth';
import type { MeterEnv } from 'arcade-kit/meter';
import { acceptCreate, acceptJoin, json, loginGate, readJson, standaloneRoot } from 'arcade-kit/worker';
import { PERSONAS } from '../src/ai/personas.ts';
import { STAKES, type StakesId } from '../src/core/stakes.ts';
import type { WalletReply } from '../src/net/wallet.ts';
import { GAME, soloOp, WALLET_ID, type PlatformWallet } from './platform.ts';
import type { TexasRoom } from './room.ts';

export { RoomMeter } from 'arcade-kit/meter';
export { TexasRoom } from './room.ts';

export interface Env extends MeterEnv {
  ASSETS: Fetcher;
  ARCADE?: Fetcher;
  /** 平台钱包（服务绑定，entrypoint WalletService，props.game = texas）；单独部署没有 */
  WALLET?: PlatformWallet;
  ROOM: DurableObjectNamespace<TexasRoom>;
  /** off 以外（包括没配）都要登录 */
  GATE?: string;
  /** 写请求的 Origin 只认它（正式站由部署流程注入）；没设就认请求自己的 origin（kit 0.9.0） */
  SITE_ORIGIN?: string;
}

const BASE = '/games/texas';
const SOLO = `${BASE}/api/solo/`;
const ROOMS = `${BASE}/rooms`;
const JOIN = /^\/games\/texas\/rooms\/([^/]+)\/ws$/;
/**
 * 单独部署时的游客（kit 0.10）：首页、开房、进房传同一份。电脑人物的名字不许当昵称（真人不能冒充电脑）；
 * cookie 用 kit 默认的，同一个站点下单独部署的几个游戏共用一个游客身份
 */
const GUEST = { reserved: PERSONAS.map((p) => p.name) };
/** 带入、结回的请求体都只有几十个字节 */
const MAX_BODY = 1024;
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
    // 单独部署时站点根 / 跳到游戏首页，/api/me 答"没有平台"（kit 0.10.2，页面的 detectPlatform 据此降级）
    const root = standaloneRoot(request, env, 'texas');
    if (root) return root;
    const url = new URL(request.url);
    const path = url.pathname;
    // 页面里的资源和接口都用相对路径，没有结尾斜杠时相对路径会落到 /games/ 下
    if (path === BASE) return Response.redirect(`${url.origin}${BASE}/${url.search}`, 301);
    if (path === `${BASE}/` || path === `${BASE}/index.html`) return secure(await loginGate(request, env, { downPage: DOWN_PAGE, guest: GUEST }), url);
    if (path.startsWith(SOLO)) return solo(request, env, path.slice(SOLO.length));
    if (path === ROOMS) return acceptCreate(request, env, { siteOrigin: env.SITE_ORIGIN, options: await roomOpts(request), guest: GUEST });
    const join = JOIN.exec(path);
    if (join) return acceptJoin(request, env, join[1]!, { siteOrigin: env.SITE_ORIGIN, guest: GUEST });
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;


/**
 * 游戏页的安全响应头（0.17.1，安全审计低危；DESIGN.md 10.3）。页面只经这里出去（首页三个路径都过登录闸门），别的静态资源不是文档，不用带。
 * 按页面实际用到的收紧：脚本只有打包出来的同源文件（没有内联脚本、没有 eval）；样式要 'unsafe-inline'，kit 的互动、叫人面板往页面里插 style 元素；
 * 图片要 data:（CSS 里的小图标）和 blob:（分享卡的预览图）；连接只许同源，WebSocket 写明这个站点的 wss
 * （Safari 的 'self' 不认 ws/wss，所以按请求的 host 拼，不写死域名，单独部署也对）。不许别的站点用 iframe 嵌（frame-ancestors 只许同源）。
 * Cloudflare Web Analytics 的统计脚本是线上边缘自动插进页面的（本地冒烟看不到）：它的脚本和上报地址单独放行，不然线上报违规、统计也丢了
 */
function secure(res: Response, url: URL): Response {
  const ws = `${url.protocol === 'https:' ? 'wss' : 'ws'}://${url.host}`;
  const csp = [
    "default-src 'self'",
    "script-src 'self' https://static.cloudflareinsights.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    `connect-src 'self' ${ws} https://cloudflareinsights.com`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; ');
  const out = new Response(res.body, res);
  out.headers.set('Content-Security-Policy', csp);
  return out;
}

/**
 * 开房请求体里的 { opts }。德州的房间一律开房就定档位和人数：没带、太长、不是 JSON 都当 null，kit 回 400 bad_options。
 * 这一步在 kit 认人之前：必须带 content-length 且 1–512 字节才读（分块传的大请求体不带长度，没登录的人也能让这里解析一大段）。
 * 浏览器 fetch 发字符串请求体总带 content-length。非 POST 的不读（kit 回 405）
 */
async function roomOpts(request: Request): Promise<unknown> {
  if (request.method !== 'POST') return null;
  return ((await readJson(request, 512)) as { opts?: unknown } | null)?.opts ?? null;
}

/** 单机的带入（坐下、补码）、结回（离桌）：浏览器算的结果，平台按 client 模式记、每天的净赢有上限 */
async function solo(request: Request, env: Env, sub: string): Promise<Response> {
  if (sub !== 'buyin' && sub !== 'cashout') return json({ error: 'not_found' }, 404);
  // 单独部署没有钱包，也就没有实盘：页面本来就不显示，直接来调的说清楚
  const wallet = env.WALLET;
  if (!wallet) return json({ error: 'no_wallet' }, 404);
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  if (request.headers.get('x-arcade') !== '1' || !sameOrigin(request, env.SITE_ORIGIN)) return json({ error: 'forbidden' }, 403);
  const b = (await readJson(request, MAX_BODY)) as { op?: unknown; session?: unknown; stakes?: unknown; amount?: unknown; stats?: unknown } | null;
  const id = (x: unknown): x is string => typeof x === 'string' && WALLET_ID.test(x);
  const amount = b?.amount;
  if (!b || !id(b.op) || !id(b.session) || typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) return json({ error: 'bad_request' }, 400);
  // op 由 Worker 加 solo- 前缀再交平台，和好友房的 op 撞不上（worker/platform.ts 的 soloOp）
  const op = soloOp(b.op);
  if (!op) return json({ error: 'bad_request' }, 400);
  if (sub === 'buyin' && !STAKES.some((x) => x.id === b.stakes)) return json({ error: 'bad_request' }, 400);
  const who = await whoIs(request, env.ARCADE);
  if (!('user' in who)) return denied(who);
  const base = { userId: who.user.userId, game: GAME, ref: b.session, mode: 'client' as const, op };
  let r: WalletReply;
  try {
    r =
      sub === 'buyin'
        ? await wallet.buyin({ ...base, tier: b.stakes as StakesId, amount, until: Date.now() + SOLO_HOLD_MS })
        : // 这一份的小结（0.3.0，平台 0.10.0 settle.stats）：原样转发，不改、不补；不合格平台整份忽略、钱照常结
          await wallet.settle({ ...base, amount, ...(b.stats !== undefined ? { stats: b.stats } : {}) });
  } catch (e) {
    // 连不上平台：请求可能到了，页面留着操作 id 重发
    console.error('texas: wallet unreachable', e instanceof Error ? e.message : e);
    return json({ error: 'unavailable' }, 503, who.setCookie);
  }
  return r.ok ? json(r, 200, who.setCookie) : json(r, STATUS[r.error] ?? 503, who.setCookie);
}

function denied(who: Exclude<WhoIs, { user: unknown }>): Response {
  return who.error === 'anonymous' ? json({ error: 'login' }, 401, who.setCookie) : json({ error: 'unavailable' }, 503);
}

const DOWN_PAGE = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>德州扑克</title>
<style>body{margin:0;min-height:100vh;min-height:100dvh;display:grid;place-items:center;background:#0f3d2e;color:#f3efe2;font:16px/1.6 system-ui,sans-serif;text-align:center}
a{color:#f3c86b}</style></head>
<body><main><h1>平台暂时连不上</h1><p>稍等一会儿再刷新试试。</p><p><a href="/">回大厅</a></p></main></body></html>`;
