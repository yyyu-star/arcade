/**
 * 0.5.10 每日挑战排行榜：一局每日挑战结束、记进档案时交一次分，结束页读这里的状态显示一行；
 * 开始菜单的每日挑战面板、结束页的「排行榜」按钮读榜。交分和读榜的细节在 platform/board.ts。
 */
import { dailyBoardId, dailyScore, dailySegmentId, isDailyRun, type GameState, type RunSummary } from '../core/index.ts';
import { askUser, boardDateOpen, readBoard, submitScoreAs, type BoardDeps, type BoardResult, type Scope, type SubmitResult } from '../platform/board.ts';
import type { RecordResult } from '../platform/profile.ts';
import { standalone } from '../platform/mode.ts';
import { cloudUserId } from './cloudSync.ts';
import { sound } from './sound.ts';

/** 这一局在排行榜上的状态（结束页显示一行） */
export type RunBoard =
  /** 不是每日挑战、调试局、没计入档案：结束页不提排行榜 */
  | { state: 'none' }
  /** 每日挑战，但这局不计入排行：synthetic = 行情没拿到、用的模拟行情（和别人不是同一局）；stale = 日期太早，平台不收了 */
  | { state: 'skip'; why: 'synthetic' | 'stale' }
  | { state: 'sending'; boardId: string; score: number }
  /** 交完了；ok 时 rank 是交完再读一次榜得到的我的名次（读不到为 undefined，1 万名以后为 null） */
  | { state: 'done'; boardId: string; score: number; result: SubmitResult; rank?: number | null };

/**
 * 这局能不能上榜：每日挑战（种子、人设、难度都对）、计入了档案、用的是当天该用的那段真实行情、日期平台还收。
 * 回落到合成行情的一局和别人不是同一局，不交（9.2 给开盘的提醒）。
 */
export function boardCheck(state: Readonly<GameState>, sum: Readonly<RunSummary>, result: Readonly<RecordResult> | null, today: string): RunBoard {
  if (!result || result.ignored || !sum.ended) return { state: 'none' };
  const date = sum.daily;
  if (!date || !isDailyRun(date, sum.seed, sum.persona, sum.difficulty)) return { state: 'none' };
  const seg = dailySegmentId(date);
  if (!seg || state.real?.segId !== seg) return { state: 'skip', why: 'synthetic' };
  if (!boardDateOpen(date, today)) return { state: 'skip', why: 'stale' };
  return { state: 'sending', boardId: dailyBoardId(date), score: dailyScore(sum.won, sum.account, sum.billsPaid) };
}

const runs = new Map<string, RunBoard>();
const listeners = new Set<() => void>();
let deps: BoardDeps = {
  fetch: (url, init) => globalThis.fetch(url, init),
  userId: () => cloudUserId(),
};

type Who = string | null | 'fail';
/** 提前问好的账号（云同步还没确认账号时用，见 warmBoardUser） */
let warmUser: string | null = null;
let warming: Promise<Who> | null = null;
/** 交分前还在问账号的那几下（问完马上发交分）：回大厅前等它们一小会儿 */
const asking = new Set<Promise<Who>>();

/** 读榜缓存：同一个榜 45 秒内不重读（来回翻面板、切全站/好友不打平台）；交分后那次读也放进来 */
export const BOARD_CACHE_MS = 45_000;
const cache = new Map<string, { at: number; result: BoardResult }>();
const cacheKey = (boardId: string, scope: Scope): string => `${boardId}|${scope}`;
/** 缓存版本：作废时 +1；读榜回来时版本变了就不写进缓存（作废前发出去的旧请求晚回来，不能把旧榜又放回去） */
let cacheGen = 0;

/** 交了分（可能改了榜）：这个榜读过的都作废 */
function dropBoardCache(boardId: string): void {
  cacheGen += 1;
  cache.delete(cacheKey(boardId, 'all'));
  cache.delete(cacheKey(boardId, 'friends'));
}

/** 测试用：换掉 fetch、账号（顺带清掉提前问的账号和读榜缓存） */
export function setBoardDeps(d: BoardDeps): void {
  deps = d;
  warmUser = null;
  cache.clear();
}

/** 页面认的账号：云同步确认过的优先，没有再用提前问好的 */
function currentUser(): string | null {
  return deps.userId() ?? warmUser;
}

/**
 * 每日挑战开局、恢复一局每日挑战时调用：云同步还没确认账号的话，过几秒（等云同步自己问完）先问一次 /api/me 记下来。
 * 不然要等结束时才问，这一下是普通请求，玩家看到结束页马上点「大厅」会被浏览器取消，成绩就丢了。
 */
export function warmBoardUser(delayMs = 3000): void {
  setTimeout(() => {
    if (!currentUser() && !standalone()) void askOnce();
  }, delayMs);
}

/** 问一次账号（同时来的合成一次） */
function askOnce(): Promise<Who> {
  warming ??= askUser(deps)
    .then((who) => {
      if (typeof who === 'string') warmUser = who;
      return who;
    })
    .finally(() => {
      warming = null;
    });
  return warming;
}

/** 回大厅前：还有交分在问账号的话，等它问完、把交分发出去（keepalive，页面走了也能到），最多等 ms 毫秒 */
export function boardBeforeLeave(ms = 1500): Promise<void> {
  if (asking.size === 0) return Promise.resolve();
  return new Promise((done) => {
    const t = setTimeout(done, ms);
    void Promise.allSettled([...asking]).then(() =>
      setTimeout(() => {
        clearTimeout(t);
        done();
      }, 0),
    );
  });
}

export function onBoardChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function set(runId: string, b: RunBoard): void {
  runs.set(runId, b);
  for (const fn of listeners) fn();
}

export function runBoard(runId: string): RunBoard {
  return runs.get(runId) ?? { state: 'none' };
}

/** 一局记进档案后调用（Session.recordEnd，每局只调一次）：能上榜就交分。 */
export function submitRun(runId: string, state: Readonly<GameState>, sum: Readonly<RunSummary>, result: Readonly<RecordResult> | null, today: string): void {
  // 0.8.0 单独部署没有排行榜：不交分，结束页也就没有这一行
  if (runs.has(runId) || standalone()) return;
  const b = boardCheck(state, sum, result, today);
  set(runId, b);
  if (b.state === 'sending') void send(runId, b.boardId, b.score);
}

/** 连不上时玩家点「重试」：只有连不上（或交分途中出了岔子）才能重试，429、busy、wrong_user 重试也没用 */
export function retryRun(runId: string): void {
  const b = runs.get(runId);
  if (!b || b.state !== 'done' || b.result.kind !== 'offline') return;
  set(runId, { state: 'sending', boardId: b.boardId, score: b.score });
  void send(runId, b.boardId, b.score);
}

async function send(runId: string, boardId: string, score: number): Promise<void> {
  let who: Who = currentUser();
  if (!who) {
    const p = askOnce();
    asking.add(p);
    who = await p;
    asking.delete(p);
  }
  // 问完账号紧接着（同一段同步代码里）发出交分，boardBeforeLeave 才等得到
  const result = await submitScoreAs(deps, who, boardId, score);
  set(runId, { state: 'done', boardId, score, result });
  if (result.kind === 'bug') console.warn(`排行榜交分被拒（${result.status} ${result.error}）：${boardId} ${score}`);
  // 交上了（odd 多半也交上了）：这个榜之前读的都过时了，这时打开面板要重读
  if (result.kind === 'ok' || result.kind === 'odd') dropBoardCache(boardId);
  if (result.kind !== 'ok') return;
  sound.cue({ type: 'rewardShow' });
  // 再读一次全站榜告诉玩家排第几（读榜不写库），读到的放进缓存
  const r = await loadBoard(boardId, 'all', true);
  if (r.kind === 'ok') set(runId, { state: 'done', boardId, score, result, rank: r.me ? r.me.rank : undefined });
}

/** 读榜（面板用）：45 秒内读过就用上次的；fresh 时一定重读。只缓存读到了的。 */
export async function loadBoard(boardId: string, scope: Scope, fresh = false): Promise<BoardResult> {
  const key = cacheKey(boardId, scope);
  const hit = cache.get(key);
  if (!fresh && hit && Date.now() - hit.at < BOARD_CACHE_MS) return hit.result;
  const gen = cacheGen;
  const r = await readBoard(deps, boardId, scope);
  if (r.kind === 'ok' && gen === cacheGen) cache.set(key, { at: Date.now(), result: r });
  return r;
}
