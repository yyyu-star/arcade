/**
 * 0.13.0 异步挑战的画面状态（docs/design-challenge.md）：打开链接接到的挑战、这台设备上接下的挑战局交成绩、结束页发起。
 * 和平台说话的细节在 platform/challenge.ts；这里管状态和通知，开始菜单、结束页订阅变化重画。
 */
import { challengeOf, challengeScore, challengeSetup, challengeStats, isChallengeRun, type GameState, type RunSetup, type RunSummary } from '../core/index.ts';
import {
  createChallenge,
  isChallengeId,
  loadChallengeRecord,
  openChallenge,
  saveChallengeRecord,
  submitChallenge,
  type ChallengeFail,
  type ChallengeRecord,
  type ChallengeView,
  type Fetch,
} from '../platform/challenge.ts';
import { APP_VERSION } from '../platform/version.ts';
import { gameLink } from './shareCard.ts';

let fetchImpl: Fetch = (url, init) => globalThis.fetch(url, init);
const listeners = new Set<() => void>();
const notify = (): void => listeners.forEach((fn) => fn());

export function onChallengeChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 测试用：换掉 fetch */
export function setChallengeFetch(f: Fetch): void {
  fetchImpl = f;
}

// ---------------------------------------------------------------- 打开链接

/** 打开链接接到的挑战：读的时候 loading，读到了 view，读不到 fail；shown 是开始菜单弹过了 */
export type Invite = { id: string; loading: true } | { id: string; loading: false; view: ChallengeView } | { id: string; loading: false; fail: ChallengeFail };

let invite: Invite | null = null;
let inviteShown = false;

/** 地址里的 ?challenge=<id>：不合格的 id 当没有 */
export function challengeParam(search: string): string | null {
  const id = new URLSearchParams(search).get('challenge');
  return isChallengeId(id) ? id : null;
}

/** 启动时读一次链接里的挑战（有平台时）；读完通知开始菜单弹卡片 */
export function loadInvite(id: string): void {
  invite = { id, loading: true };
  inviteShown = false;
  notify();
  void openChallenge(fetchImpl, id).then((r) => {
    invite = r.ok ? { id, loading: false, view: r.view } : { id, loading: false, fail: r.why };
    notify();
  });
}

/** 开始菜单要弹的挑战卡（读完了、还没弹过）；拿了就算弹过 */
export function takeInvite(): Exclude<Invite, { loading: true }> | null {
  if (!invite || invite.loading || inviteShown) return null;
  inviteShown = true;
  return invite;
}

/** 接受挑战：记下这台设备接了哪个挑战，回开局要的东西 */
export function acceptInvite(view: ChallengeView): { seed: string; setup: RunSetup; segment: string | null } {
  saveChallengeRecord({ id: view.id, seed: view.payload.seed, owner: view.owner, v: view.payload.v, sent: false });
  return { seed: view.payload.seed, setup: challengeSetup(view.payload), segment: view.payload.segment };
}

/** 发起时的版本和这台不一样：结果可能对不上（数值改过） */
export const versionDiffers = (v: string): boolean => v !== APP_VERSION;

// ---------------------------------------------------------------- 挑战局打完：交成绩

/** 这一局在挑战下的状态（结束页显示一行） */
export type RunChallenge =
  | { state: 'sending'; id: string; owner: string; v: string }
  /** 交上了（或之前交过，already）；view 是交完再读一次的成绩表，读不到为 null */
  | { state: 'done'; id: string; owner: string; v: string; already: boolean; view: ChallengeView | null }
  | { state: 'error'; id: string; owner: string; v: string; why: ChallengeFail };

const runs = new Map<string, RunChallenge>();

/** 这台设备接下的挑战是不是这一局（种子对得上）：档案按挑战局记、结束页交成绩 */
export function challengeRecordFor(seed: string): ChallengeRecord | null {
  const r = loadChallengeRecord();
  return r && r.seed === seed ? r : null;
}

/** 结束页读：这局挑战的状态；不是挑战局为 null */
export function runChallenge(seed: string): RunChallenge | null {
  return runs.get(seed) ?? null;
}

/** 一局结束、记进档案后调一次：是挑战局就交成绩（每局只交一次；中途关了页面回来打完的也认） */
export function submitChallengeEnd(state: Readonly<GameState>, sum: Readonly<RunSummary>): void {
  const rec = challengeRecordFor(state.seed);
  if (!rec || runs.has(state.seed) || !sum.ended) return;
  send(rec, challengeScore(sum), challengeStats(sum));
}

/** 结束页的「重试」 */
export function retryChallengeEnd(state: Readonly<GameState>, sum: Readonly<RunSummary>): void {
  const rec = challengeRecordFor(state.seed);
  const cur = runs.get(state.seed);
  if (!rec || cur?.state !== 'error') return;
  send(rec, challengeScore(sum), challengeStats(sum));
}

function send(rec: ChallengeRecord, score: number, stats: ReturnType<typeof challengeStats>): void {
  const base = { id: rec.id, owner: rec.owner, v: rec.v };
  runs.set(rec.seed, { state: 'sending', ...base });
  notify();
  void submitChallenge(fetchImpl, rec.id, score, stats).then(async (r) => {
    if (!r.ok) {
      runs.set(rec.seed, { state: 'error', ...base, why: r.why });
      return notify();
    }
    saveChallengeRecord({ ...rec, sent: true });
    const v = await openChallenge(fetchImpl, rec.id);
    runs.set(rec.seed, { state: 'done', ...base, already: r.already, view: v.ok ? v.view : null });
    notify();
  });
}

/** 结束页的「看成绩」：重读一次成绩表 */
export async function readChallenge(id: string): Promise<{ ok: true; view: ChallengeView } | { ok: false; why: ChallengeFail }> {
  return openChallenge(fetchImpl, id);
}

// ---------------------------------------------------------------- 结束页发起

/** 发起：这局做成挑战交给平台（我的成绩记第一条），回分享出去的链接 */
export async function startChallenge(state: Readonly<GameState>, sum: Readonly<RunSummary>): Promise<{ ok: true; url: string; until: number } | { ok: false; why: ChallengeFail }> {
  const payload = challengeOf(state, APP_VERSION);
  if (!payload || !isChallengeRun(state, payload)) return { ok: false, why: 'bug' };
  const r = await createChallenge(fetchImpl, payload, challengeScore(sum), challengeStats(sum));
  if (!r.ok) return r;
  return { ok: true, url: `${gameLink(location.href)}?challenge=${encodeURIComponent(r.id)}`, until: r.until };
}
