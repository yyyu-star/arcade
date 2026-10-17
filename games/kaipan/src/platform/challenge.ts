/**
 * 0.13.0 异步挑战：和平台的三个接口说话（docs/platform-backend.md 15.18），把回话理成几种结果；这台设备上接了哪个挑战记在 kaipan.challenge。
 * 不碰画面。fetch 从外面传进来，方便测试；回来的东西一律先校验再用（payload、别人的昵称和成绩都是外来数据）。
 *
 * - 发起每人每天 20 个、每个挑战最多 100 人、30 天过期都由平台管；过期和不存在一样回 404，开盘说同一句"打不开了"。
 * - 每人每挑战只算第一次（平台按 (挑战, 人) 只收一条）：交过了平台回 already 和原来那条，开盘照样显示。
 * - 什么都不自动重试：连不上给「重试」，由人点。
 */
import { parseChallenge, parseChallengeStats, type ChallengePayload, type ChallengeStats } from '../core/index.ts';
import { ellipsize } from '../core/format.ts';

const GAME_ID = 'kaipan';
const API = '/api/challenges';
export const CHALLENGE_KEY = 'kaipan.challenge';
const ID_RE = /^[A-Za-z0-9_-]{4,64}$/;

export type Fetch = (url: string, init: RequestInit) => Promise<Response>;

/** 出错的几种：没登录、打不开（不存在、过期、payload 不对）、人满了、今天发得太多、平台在省额度、连不上、开盘自己的 bug */
export type ChallengeFail = 'out' | 'gone' | 'full' | 'limit' | 'busy' | 'offline' | 'bug';

export interface ChallengeEntry {
  rank: number;
  displayName: string;
  score: number;
  stats: ChallengeStats | null;
  isMe: boolean;
}

export interface ChallengeView {
  id: string;
  payload: ChallengePayload;
  owner: string;
  /** 发起人这局的成绩（发起时记的第一条；在前 50 名之外读不到为 null） */
  ownerScore: number | null;
  /** 过期时间（毫秒时间戳） */
  until: number;
  results: ChallengeEntry[];
  /** 一共几个人交了 */
  count: number;
  me: { rank: number | null; score: number } | null;
}

export const isChallengeId = (id: unknown): id is string => typeof id === 'string' && ID_RE.test(id);
const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isScore = (x: unknown): x is number => typeof x === 'number' && Number.isSafeInteger(x);
const name = (x: unknown): string => (typeof x === 'string' && x.trim() ? ellipsize(x.trim(), 16) : '某位玩家');

async function call(f: Fetch, method: 'GET' | 'POST', url: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> | null }> {
  try {
    const init: RequestInit = { method, credentials: 'same-origin', cache: 'no-store' };
    // 写请求带 X-Arcade（平台 15.1 的 CSRF 规矩）
    if (body !== undefined) Object.assign(init, { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', 'X-Arcade': '1' } });
    const r = await f(url, init);
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

function failOf(status: number): ChallengeFail {
  if (status === 401) return 'out';
  if (status === 404) return 'gone';
  if (status === 409) return 'full';
  if (status === 429) return 'limit';
  if (status === 503) return 'busy';
  // 400 / 403 / 413：开盘这边交错了东西
  if (status >= 400 && status < 500) return 'bug';
  return 'offline';
}

/** 发起：这局的 payload 和我的成绩（平台同时记成第一条结果） */
export async function createChallenge(f: Fetch, payload: ChallengePayload, score: number, stats: ChallengeStats): Promise<{ ok: true; id: string; until: number } | { ok: false; why: ChallengeFail }> {
  const r = await call(f, 'POST', API, { game: GAME_ID, payload, score, stats });
  if (r.status !== 200) return { ok: false, why: failOf(r.status) };
  const id = r.body?.id;
  const until = Number(r.body?.until);
  // 200 却没给能用的 id：当连不上（再点一次会多发一个，但每天 20 个够用）
  return isChallengeId(id) ? { ok: true, id, until: Number.isFinite(until) ? until : 0 } : { ok: false, why: 'offline' };
}

/** 打开：挑战的开局和成绩。payload 不是开盘的或格式不对、不是开盘的挑战，一律当打不开 */
export async function openChallenge(f: Fetch, id: string): Promise<{ ok: true; view: ChallengeView } | { ok: false; why: ChallengeFail }> {
  if (!isChallengeId(id)) return { ok: false, why: 'gone' };
  const r = await call(f, 'GET', `${API}/${encodeURIComponent(id)}`);
  if (r.status !== 200 || !r.body) return { ok: false, why: r.status === 200 ? 'offline' : failOf(r.status) };
  const b = r.body;
  const payload = b.game === GAME_ID ? parseChallenge(b.payload) : null;
  if (!payload) return { ok: false, why: 'gone' };
  const results: ChallengeEntry[] = [];
  const ownerId = isObj(b.owner) && typeof b.owner.userId === 'string' ? b.owner.userId : null;
  let ownerScore: number | null = null;
  for (const x of Array.isArray(b.results) ? b.results : []) {
    if (!isObj(x) || !isScore(x.score) || !Number.isInteger(x.rank)) continue;
    if (ownerId !== null && x.userId === ownerId) ownerScore = x.score;
    results.push({ rank: x.rank as number, displayName: name(x.displayName), score: x.score, stats: parseChallengeStats(x.stats), isMe: x.isMe === true });
  }
  const me = isObj(b.me) && isScore(b.me.score) ? { rank: Number.isInteger(b.me.rank) ? (b.me.rank as number) : null, score: b.me.score } : null;
  const until = Number(b.until);
  const count = Number.isInteger(b.count) ? (b.count as number) : results.length;
  return { ok: true, view: { id, payload, owner: name(isObj(b.owner) ? b.owner.displayName : null), ownerScore, until: Number.isFinite(until) ? until : 0, results, count, me } };
}

/** 交成绩：交上了 / 交过了（平台只记第一次，回原来那条） */
export async function submitChallenge(f: Fetch, id: string, score: number, stats: ChallengeStats): Promise<{ ok: true; already: boolean } | { ok: false; why: ChallengeFail }> {
  const r = await call(f, 'POST', `${API}/${encodeURIComponent(id)}/results`, { score, stats });
  if (r.status !== 200) return { ok: false, why: failOf(r.status) };
  if (r.body?.result === 'ok') return { ok: true, already: false };
  if (r.body?.result === 'already') return { ok: true, already: true };
  return { ok: false, why: 'offline' };
}

/**
 * 这台设备上接下的挑战（只记最近一个）：开局时写，交上成绩后标 sent。
 * 中途关了页面，回来点「继续」打完照样按种子认出来交。不进云存档：挑战局本身就在本机存档里。
 */
export interface ChallengeRecord {
  id: string;
  seed: string;
  owner: string;
  /** 发起时的开盘版本（和这台的版本不同时结果页提一句） */
  v: string;
  sent: boolean;
}

export function loadChallengeRecord(store: Pick<Storage, 'getItem'> | null = storage()): ChallengeRecord | null {
  try {
    const raw: unknown = JSON.parse(store?.getItem(CHALLENGE_KEY) ?? 'null');
    if (!isObj(raw) || !isChallengeId(raw.id) || typeof raw.seed !== 'string' || typeof raw.owner !== 'string' || typeof raw.v !== 'string') return null;
    return { id: raw.id, seed: raw.seed, owner: raw.owner, v: raw.v, sent: raw.sent === true };
  } catch {
    return null;
  }
}

export function saveChallengeRecord(r: ChallengeRecord, store: Pick<Storage, 'setItem'> | null = storage()): void {
  try {
    store?.setItem(CHALLENGE_KEY, JSON.stringify(r));
  } catch {
    // 存不下就算了：这局照样能打，只是关了页面回来认不出是挑战局
  }
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
