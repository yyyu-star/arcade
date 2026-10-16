/**
 * 独立模式（0.10.0）：游戏不带平台单独部署（Deploy to Cloudflare、fork）时，没有平台的 /api/me 可问，改认"游客"。
 *
 * 什么时候算独立模式（isStandalone）：env 里**没有** ARCADE 绑定，而且 GATE 不是 "login"。
 * - 有 ARCADE 绑定 = 本站正式环境，行为和 0.9 完全一样，游客 cookie 一律不认（防止有人带一个游客 cookie 绕过登录）；
 * - 没有 ARCADE 却写了 GATE=login：说明这次部署本该接平台、只是绑定丢了（部署工具出错），按"平台不可用"拒绝（fail-closed），
 *   不悄悄退成人人可进的游客模式。
 *
 * 游客身份：游戏 Worker 自己发一个长期 cookie（HttpOnly、SameSite=Lax、Path=/；https 下是 `__Host-` 前缀加 Secure），
 * 值是 32 字节 crypto 随机数（base64url）。userId 是值的 SHA-256 取前 128 位（`g:` 开头），不用原值：
 * userId 会进房间存储、日志，泄露了也拿不到 cookie 本身。昵称默认"游客"加 4 位数字，浏览器可以带一个昵称（cleanNickname 严格清洗）。
 *
 * 这个文件不依赖 cloudflare:workers，浏览器也能用（页面可以先用 cleanNickname 检查一遍再提交）。
 */
import type { Identity } from './internal.js';

/** 游客 cookie 名字的默认主体；https 下实际名字是 `__Host-kit-guest`。同域的几个游戏共用一个游客身份，想分开就各传 cookie */
export const GUEST_COOKIE = 'kit-guest';

/** 一年多一点（和平台会话一样长），过期前每次进首页都会被认出来，不续期也够用 */
const GUEST_MAX_AGE = 34_560_000;

/** 昵称最长几个字（按码点算） */
export const NICKNAME_MAX = 12;

/**
 * 默认不许用的昵称词：冒充电脑、系统、管理员，以及"游客"本身（免得冒充别人的默认名"游客1234"）。
 * 游戏另传自己电脑人物的名字（GuestOptions.reserved），两份合起来查
 */
export const RESERVED_NICKNAMES: readonly string[] = ['电脑', '机器人', '人机', '托管', '系统', '管理员', '官方', '客服', '游客', 'ai', 'bot', 'robot', 'cpu', 'admin', 'system'];

export interface GuestOptions {
  /** cookie 名字的主体（字母、数字、`_`、`-`，最长 32），默认 GUEST_COOKIE；https 下会加 `__Host-` 前缀 */
  cookie?: string;
  /** 游戏自己不许用的昵称（电脑人物的名字等），和 RESERVED_NICKNAMES 合起来查 */
  reserved?: readonly string[];
}

/** 判断用的 env 字段：ARCADE 绑定在不在、GATE 写的是什么 */
export interface ModeEnv {
  ARCADE?: unknown;
  GATE?: string;
}

/** 独立模式：没有 ARCADE 绑定、GATE 也不是 "login" */
export function isStandalone(env: ModeEnv): boolean {
  return !env.ARCADE && env.GATE !== 'login';
}

const COOKIE_BASE_RE = /^[A-Za-z0-9_-]{1,32}$/;
/** 值：我们发的是 32 字节 base64url（43 位）；读的时候只认 22–64 位 base64url，别的一律当没有 */
const COOKIE_VALUE_RE = /^[A-Za-z0-9_-]{22,64}$/;

/**
 * 这个请求用的游客 cookie 名字。https 用 `__Host-` 前缀（浏览器保证只能由本站、Path=/、Secure 设置，子域设不进来）；
 * http 只会是本地开发（wrangler dev 经局域网 IP 打开时浏览器不收 Secure cookie），用不带前缀的名字，两边互不相认
 */
export function guestCookieName(request: Request, opts: GuestOptions = {}): string {
  const base = opts.cookie ?? GUEST_COOKIE;
  if (!COOKIE_BASE_RE.test(base)) throw new Error(`arcade-kit: bad guest cookie name ${JSON.stringify(base)}`);
  return isHttps(request) ? `__Host-${base}` : base;
}

function isHttps(request: Request): boolean {
  return new URL(request.url).protocol === 'https:';
}

/** 请求里游客 cookie 的值；没有、格式不对都是 null */
export function readGuestCookie(request: Request, opts: GuestOptions = {}): string | null {
  const name = guestCookieName(request, opts);
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      const v = part.slice(i + 1).trim();
      return COOKIE_VALUE_RE.test(v) ? v : null;
    }
  }
  return null;
}

/** 新发一个游客 cookie：返回值和整条 Set-Cookie */
export function mintGuestCookie(request: Request, opts: GuestOptions = {}): { value: string; setCookie: string } {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const value = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const secure = isHttps(request) ? '; Secure' : '';
  return { value, setCookie: `${guestCookieName(request, opts)}=${value}; Max-Age=${GUEST_MAX_AGE}; Path=/; HttpOnly; SameSite=Lax${secure}` };
}

/** cookie 值 → 游客身份：userId = 'g:' + SHA-256 前 128 位（hex），默认昵称"游客"+ 4 位数字；nickname 是清洗过的昵称 */
export async function guestIdentity(value: string, nickname?: string | null): Promise<Identity> {
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const hex = Array.from(hash.subarray(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
  const short = String(((hash[16]! << 8) | hash[17]!) % 10_000).padStart(4, '0');
  return { userId: `g:${hex}`, name: nickname || `游客${short}` };
}

/** 允许的字：字母（含汉字）、数字，和空格、`_`、`-`、`.`、`·` */
const NICKNAME_RE = /^[\p{L}\p{N} _\-.·]+$/u;

/**
 * 清洗浏览器带来的昵称：不合格回 null（调用方用默认的"游客1234"），不报错。
 * - NFKC 归一（全角、兼容字先折成普通字，免得用全角字母绕过保留词），连续空白并成一个、去掉首尾空白；
 * - 只许字母（含汉字）、数字和少数几个符号，控制符、零宽字、方向控制符、emoji 一律不行；1 到 NICKNAME_MAX 个字；
 * - 不能含保留词（RESERVED_NICKNAMES 加游戏传的）：中文等非 ASCII 的词按"包含"查；ASCII 的词按"整个词"查（去掉数字后），
 *   免得 "Kai" 因为含 "ai" 被拒，但 "AI"、"bot 007" 都会被拒。
 */
export function cleanNickname(raw: unknown, reserved: readonly string[] = []): string | null {
  if (typeof raw !== 'string' || raw.length > 64) return null;
  const s = raw.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  const n = [...s].length;
  if (n < 1 || n > NICKNAME_MAX || !NICKNAME_RE.test(s)) return null;
  const lower = s.toLowerCase();
  const compact = lower.replace(/ /g, '');
  const tokens = lower.split(/[ _\-.·]+/).map((t) => t.replace(/\d+/g, ''));
  for (const w0 of [...RESERVED_NICKNAMES, ...reserved]) {
    const w = w0.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
    if (!w) continue;
    const ascii = /^[\x00-\x7f]+$/.test(w);
    if (ascii ? tokens.includes(w) || compact.replace(/\d+/g, '') === w : compact.includes(w)) return null;
  }
  return s;
}
