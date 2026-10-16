/**
 * 0.5.10 每日挑战排行榜：交分、读榜（平台 15.5，简单版、不防作弊）。只管和平台说话、把回话理成几种结果，不碰画面；
 * fetch 和"当前账号"从外面传进来，方便测试。回来的东西一律先校验再用（别人的昵称、分数都是外来数据）。
 * 平台每人每天只收 50 次交分（所有游戏合计）：一局只在结束时交一次，什么情况都不自动重试。
 */
import { keepaliveSend } from './keepalive.ts';
import { ellipsize } from '../core/format.ts';

const GAME_ID = 'kaipan';

export interface BoardDeps {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  /** 页面认的账号（云同步确认过的，或者开局时提前问好的）；没有时交分前由这里自己问一次 */
  userId: () => string | null;
}

/** 交分的结果。ok：best 是这个榜上我的最好成绩，improved 表示这次刷新了纪录 */
export type SubmitResult =
  | { kind: 'ok'; best: number; improved: boolean }
  /** 429：交得太多了；retryAfter 是平台说的多少秒后能再交（没给为 null） */
  | { kind: 'limit'; retryAfter: number | null }
  /** 503 busy：平台在省额度 */
  | { kind: 'busy' }
  /** 409 wrong_user：页面上的账号和登录的不是同一个（别的标签页换过号） */
  | { kind: 'wrong_user' }
  /** 连不上、别的 5xx：没交上，可以重试 */
  | { kind: 'offline' }
  /** 200 但回的东西看不懂：多半已经记上了，不给重试（重试白占一次额度） */
  | { kind: 'odd' }
  /** 401 或没登录 */
  | { kind: 'out' }
  /** 400 / 404 / 422：游戏这边算错了（榜单 ID、日期、分数） */
  | { kind: 'bug'; status: number; error: string };

export interface BoardEntry {
  rank: number;
  displayName: string;
  score: number;
  isMe: boolean;
}

export type BoardResult =
  | { kind: 'ok'; entries: BoardEntry[]; me: { rank: number | null; score: number } | null }
  | { kind: 'busy' }
  | { kind: 'offline' }
  | { kind: 'out' }
  | { kind: 'bug'; status: number; error: string };

export type Scope = 'all' | 'friends';

interface Res {
  status: number;
  body: Record<string, unknown> | null;
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

async function call(d: BoardDeps, method: string, url: string, body?: unknown): Promise<Res> {
  try {
    const init: RequestInit = { method, credentials: 'same-origin', cache: 'no-store' };
    // 写请求必须带 X-Arcade（15.1）；交分用 keepalive：结束页马上点「大厅」走了也交得上（请求体只有几十字节）
    // keepalive 记账（keepalive.ts）：离开页面时云存档补传要扣掉这一份
    const text = body === undefined ? undefined : JSON.stringify(body);
    if (text !== undefined) Object.assign(init, { body: text, keepalive: true, headers: { 'Content-Type': 'application/json', 'X-Arcade': '1' } });
    const r = await (text === undefined ? d.fetch(url, init) : keepaliveSend(text, () => d.fetch(url, init)));
    let json: unknown = null;
    try {
      json = await r.json();
    } catch {
      json = null;
    }
    return { status: r.status, body: isObj(json) ? json : null };
  } catch {
    return { status: 0, body: null };
  }
}

/** 共同的错误码（15.1、15.5）；返回 null 表示不是错误 */
function failure(res: Res): { kind: 'busy' } | { kind: 'offline' } | { kind: 'out' } | { kind: 'bug'; status: number; error: string } | null {
  if (res.status === 200 && res.body) return null;
  const err = typeof res.body?.error === 'string' ? res.body.error : '';
  if (res.status === 401) return { kind: 'out' };
  if (res.status === 503 && err === 'busy') return { kind: 'busy' };
  if (res.status === 400 || res.status === 404 || res.status === 422) return { kind: 'bug', status: res.status, error: err };
  return { kind: 'offline' };
}

/** 问一次 /api/me。null = 没登录，'fail' = 没问到 */
export async function askUser(d: BoardDeps): Promise<string | null | 'fail'> {
  const res = await call(d, 'GET', '/api/me');
  if (res.status !== 200 || !res.body) return 'fail';
  const user = res.body.user;
  if (user === null) return null;
  return isObj(user) && typeof user.id === 'string' ? user.id : 'fail';
}

/** 账号已经问好了（askUser 的结果）再交：问完和发出交分之间没有别的等待 */
export async function submitScoreAs(d: BoardDeps, userId: string | null | 'fail', boardId: string, score: number): Promise<SubmitResult> {
  if (userId === 'fail') return { kind: 'offline' };
  if (userId === null) return { kind: 'out' };
  const res = await call(d, 'POST', '/api/scores', { gameId: GAME_ID, boardId, score, userId });
  if (res.status === 429) {
    const after = res.body?.retryAfter;
    return { kind: 'limit', retryAfter: typeof after === 'number' && Number.isFinite(after) && after > 0 ? after : null };
  }
  if (res.status === 409 && res.body?.error === 'wrong_user') return { kind: 'wrong_user' };
  if (res.status === 409) return { kind: 'bug', status: 409, error: String(res.body?.error ?? '') };
  if (res.status === 200) {
    const best = res.body?.best;
    const improved = res.body?.improved;
    // 200 却看不懂（不是 JSON、缺字段）：平台多半已经记上了，算"交上了但不知道结果"，不让重试
    if (typeof best !== 'number' || !Number.isSafeInteger(best) || typeof improved !== 'boolean') return { kind: 'odd' };
    return { kind: 'ok', best, improved };
  }
  return failure(res) ?? { kind: 'offline' };
}

/** 读榜：前 50 名和我的名次。读榜不带账号（读到的只拿来显示，不会合进本地）。 */
export async function readBoard(d: BoardDeps, boardId: string, scope: Scope): Promise<BoardResult> {
  const res = await call(d, 'GET', `/api/boards/${GAME_ID}/${encodeURIComponent(boardId)}?scope=${scope}`);
  const bad = failure(res);
  if (bad) return bad;
  const raw = res.body?.entries;
  if (!Array.isArray(raw)) return { kind: 'offline' };
  const entries: BoardEntry[] = [];
  for (const e of raw.slice(0, 50)) {
    // 名次只认 ≥ 1 的整数（0、负数是平台出错，不显示）
    if (!isObj(e) || !Number.isSafeInteger(e.rank) || (e.rank as number) < 1 || !Number.isSafeInteger(e.score)) continue;
    entries.push({ rank: e.rank as number, displayName: cleanName(e.displayName), score: e.score as number, isMe: e.isMe === true });
  }
  const m = res.body?.me;
  const me = isObj(m) && Number.isSafeInteger(m.score) ? { rank: Number.isSafeInteger(m.rank) && (m.rank as number) > 0 ? (m.rank as number) : null, score: m.score as number } : null;
  return { kind: 'ok', entries, me };
}

/** 别人的昵称：只留可见字符，最多 12 个字（平台限制了长度，这里再兜一次，免得撑破画面） */
export function cleanName(x: unknown): string {
  const s = typeof x === 'string' ? x.replace(/[\p{C}]/gu, '').trim() : '';
  return s === '' ? '无名氏' : ellipsize(s, 12);
}

/** YYYY-MM-DD 加减几天（按日历算，不看时区）。 */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
}

/** 平台只收北京时间昨天、今天、明天的每日榜：更早的局（比如隔天才打开结算）不交。 */
export function boardDateOpen(date: string, today: string): boolean {
  return date >= shiftDate(today, -1) && date <= shiftDate(today, 1);
}
