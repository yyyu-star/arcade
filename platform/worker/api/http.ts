/** 响应、错误码和 cookie（docs/platform-backend.md 15.1、5.1）。 */

/** 错误码 → 给玩家看的中文：一句话说清楚出了什么事、怎么办（docs/platform-backend.md 15.10）。调用方按 error 判断，message 只拿来显示。 */
const MESSAGES: Record<string, string> = {
  bad_request: '请求格式不对',
  unauthorized: '请先登录',
  bad_credentials: '用户名或密码不对',
  forbidden: '请求来源不对',
  not_found: '没有找到',
  method_not_allowed: '不支持这个操作',
  username_taken: '这个用户名已经有人用了',
  too_large: '内容太大了',
  invalid_username: '用户名要 3–20 位，只能用小写字母、数字和下划线',
  weak_password: '密码太简单了，至少 8 位，别用常见密码',
  invalid_display_name: '昵称要 2–12 个字，换一个试试',
  reserved_display_name: '这个昵称不能用，换一个吧',
  unknown_game: '没有这个游戏',
  invalid_slot: '存档位置不对',
  conflict: '云端的存档更新过，合并后再传',
  wrong_user: '账号换过了，刷新一下页面',
  quota_exceeded: '云存档空间满了，删掉不用的存档再试',
  too_soon: '保存得太勤了，过几秒再试',
  rate_limited: '操作太频繁了，歇一会儿再试',
  internal: '服务器出错了，过一会儿再试',
  busy: '服务器今天有点忙，先只能看、不能改，明早恢复',
  unavailable: '服务器一时连不上数据库，过几秒再试',
  registration_closed: '现在是邀请制，找朋友要个邀请码就能注册',
  // 邀请码（0.20.0）：码不对、用过、过期、撤回都是这一句，不说是哪种
  invite_invalid: '邀请码不对或已经失效，找朋友要个新的',
  invite_used: '这个邀请码刚被别人用掉了，找朋友要个新的',
  quota_full: '邀请名额用完了：没用的码过期或撤回后会还回来',
  not_admin: '只有管理员能用',
  admin_protected: '管理员账号只能用管理命令行工具来建、改密码和删除',
  cannot_delete_self: '不能删自己的账号，要注销请去"我的账号"',
  last_admin: '这是最后一个管理员，不能删',
  invalid_target: '这是你自己',
  unblock_first: '你屏蔽了对方，先解除屏蔽再加好友',
  limit_reached: '好友或待处理的请求到上限了，先处理掉一些再加',
  invalid_board: '排行榜的名字不对',
  invalid_score: '分数不对',
  relief_used: '今天的补给已经领过了，明早 0 点再来',
  relief_not_needed: '筹码还够用：钱包加桌上的不到补给额才能领',
  no_change: '余额已经是 0（或到上限了），没有可调的',
  bad_amount: '数量要是不为 0 的整数，而且不能超过单次上限',
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly extra: Record<string, unknown> = {},
    readonly headers: HeadersInit = {},
  ) {
    super(code);
  }
}

export function rateLimited(retryAfterMs: number): ApiError {
  const s = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return new ApiError(429, 'rate_limited', { retryAfter: s }, { 'retry-after': String(s) });
}

export function unavailable(retryAfterS: number): ApiError {
  return new ApiError(503, 'unavailable', { retryAfter: retryAfterS }, { 'retry-after': String(retryAfterS) });
}

export function json(status: number, body: unknown, headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set('content-type', 'application/json; charset=utf-8');
  h.set('cache-control', 'no-store');
  return new Response(body === null ? null : JSON.stringify(body), { status, headers: h });
}

export function noContent(headers: HeadersInit = {}): Response {
  const h = new Headers(headers);
  h.set('cache-control', 'no-store');
  return new Response(null, { status: 204, headers: h });
}

export function errorResponse(e: ApiError): Response {
  return json(e.status, { error: e.code, message: MESSAGES[e.code] ?? MESSAGES.internal, ...e.extra }, e.headers);
}

// ---------- cookie ----------

export const SID_COOKIE = '__Host-sid';
/** 非 HttpOnly 的提示 cookie：游戏看到它才调接口，没登录的玩家一个请求都不发。 */
const LI_COOKIE = '__Host-arcade_li';

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

/** 登录后的两个 cookie；maxAgeMs 取会话剩余寿命。 */
export function sessionCookies(value: string, maxAgeMs: number): string[] {
  const age = Math.floor(maxAgeMs / 1000);
  return [
    `${SID_COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`,
    `${LI_COOKIE}=1; Path=/; Secure; SameSite=Lax; Max-Age=${age}`,
  ];
}

export function clearCookies(): string[] {
  return [
    `${SID_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`,
    `${LI_COOKIE}=; Path=/; Secure; SameSite=Lax; Max-Age=0`,
  ];
}

export function withCookies(res: Response, cookies: string[]): Response {
  for (const c of cookies) res.headers.append('set-cookie', c);
  return res;
}
