/**
 * 0.13.0 异步挑战（docs/design-challenge.md）：把一局的开局做成平台存的一小段 JSON（payload），好友打开就是同一个开局。
 *
 * - 同一个开局 = 同一个种子 + 同一份开局设置 + 同一段行情。段平时按种子哈希在段库里挑，段库加了新段就会换，所以段 id 要写明；
 *   短局的规则开局时已经抄进设置，跟着设置走。账单、情报这些数值不在设置里，记下发起时的版本号，对不上时结果页提一句。
 * - 只开娱乐局：每日挑战本来就是同一局，实盘的成绩连着钱包、规则也不一样，调试设置的局不算数。
 * - payload 是别人的设备交上来的，平台原样回，所以读回来按白名单逐项校验，不合格就打不开，不拿去开局。
 * - 成绩沿用每日挑战的分数：先比通没通关，通关的比剩多少钱，没通关的比撑了几个月。同一个挑战人设相同、开局资产相同，直接比钱数公平。
 */
import { isPersonaId, MAX_DIFFICULTY } from './content/index.ts';
import { dailyScore } from './daily.ts';
import { isRankedSetup } from './engine.ts';
import type { GameState, PersonaId, RunSetup, ShortRules } from './types.ts';
import type { RunSummary } from './queries.ts';

/** payload 的格式号：以后加字段要改读法时 +1，旧格式的挑战照样认 */
export const CHALLENGE_FORMAT = 1;

export interface ChallengePayload {
  f: typeof CHALLENGE_FORMAT;
  seed: string;
  setup: { persona: PersonaId; difficulty: number; short?: ShortRules };
  /** 行情段 id；模拟行情的局为 null */
  segment: string | null;
  /** 发起时的开盘版本号 */
  v: string;
}

/** 结果页显示用的几样（平台原样存、原样回，读别人的要过 parseChallengeStats） */
export interface ChallengeStats {
  /** 这局的称号（结束页那个） */
  title: string;
  /** 资产涨跌（千分之几，整数；+286 = 涨了 28.6%） */
  growth: number;
}

const SEED_RE = /^[A-Za-z0-9_-]{1,64}$/;
const SEGMENT_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** 这一局能不能发成挑战：打完了的娱乐局（短局、完整一年），不是每日挑战、实盘、调试设置的局 */
export function canChallenge(s: Readonly<GameState>): boolean {
  if (s.phase !== 'won' && s.phase !== 'lost') return false;
  const setup = s.setup;
  return isRankedSetup(setup) && !setup?.daily && !setup?.live;
}

/** 这一局做成挑战；不能发的局为 null */
export function challengeOf(s: Readonly<GameState>, version: string): ChallengePayload | null {
  if (!canChallenge(s)) return null;
  const short = s.setup?.short;
  return {
    f: CHALLENGE_FORMAT,
    seed: s.seed,
    setup: { persona: s.persona, difficulty: s.difficulty, ...(short ? { short: { ...short } } : {}) },
    segment: s.real?.segId ?? null,
    v: version,
  };
}

const isObj = (x: unknown): x is Record<string, unknown> => x !== null && typeof x === 'object' && !Array.isArray(x);
const only = (o: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(o).every((k) => keys.includes(k));
const num = (x: unknown, lo: number, hi: number): x is number => typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi;

/** 读别人交上来的 payload：格式对就回 payload，不对回 null（不开局） */
export function parseChallenge(raw: unknown): ChallengePayload | null {
  if (!isObj(raw) || !only(raw, ['f', 'seed', 'setup', 'segment', 'v'])) return null;
  if (raw.f !== CHALLENGE_FORMAT) return null;
  if (typeof raw.seed !== 'string' || !SEED_RE.test(raw.seed)) return null;
  if (raw.segment !== null && (typeof raw.segment !== 'string' || !SEGMENT_RE.test(raw.segment))) return null;
  if (typeof raw.v !== 'string' || raw.v.length === 0 || raw.v.length > 32) return null;
  const st = raw.setup;
  if (!isObj(st) || !only(st, ['persona', 'difficulty', 'short'])) return null;
  if (typeof st.persona !== 'string' || !isPersonaId(st.persona)) return null;
  if (!Number.isInteger(st.difficulty) || !num(st.difficulty, 1, MAX_DIFFICULTY)) return null;
  let short: ShortRules | undefined;
  if (st.short !== undefined) {
    const sh = st.short;
    if (!isObj(sh) || !only(sh, ['months', 'billMult', 'goal'])) return null;
    // 和 engine 的开局校验（checkSetup）同一个口径：几个月 1–12、账单倍数在 (0, 2]、首付比例 0–3
    if (!Number.isInteger(sh.months) || !num(sh.months, 1, 12) || !num(sh.billMult, Number.MIN_VALUE, 2) || !num(sh.goal, 0, 3)) return null;
    short = { months: sh.months, billMult: sh.billMult, goal: sh.goal };
  }
  return {
    f: CHALLENGE_FORMAT,
    seed: raw.seed,
    setup: { persona: st.persona, difficulty: st.difficulty, ...(short ? { short } : {}) },
    segment: raw.segment,
    v: raw.v,
  };
}

/** 按挑战开局用的设置 */
export function challengeSetup(p: Readonly<ChallengePayload>): RunSetup {
  return { persona: p.setup.persona, difficulty: p.setup.difficulty, ...(p.setup.short ? { short: { ...p.setup.short } } : {}) };
}

/** 这一局是不是这个挑战的开局（种子和设置都对得上） */
export function isChallengeRun(s: Readonly<GameState>, p: Readonly<ChallengePayload>): boolean {
  const sh = s.setup?.short;
  const ps = p.setup.short;
  return (
    s.seed === p.seed &&
    s.persona === p.setup.persona &&
    s.difficulty === p.setup.difficulty &&
    !!sh === !!ps &&
    (!sh || !ps || (sh.months === ps.months && sh.billMult === ps.billMult && sh.goal === ps.goal)) &&
    (s.real?.segId ?? null) === p.segment
  );
}

/** 成绩：沿用每日挑战的分数（通关 = 1e11 + 最后账户元；没通关 = 还上了几个月） */
export function challengeScore(sum: Readonly<RunSummary>): number {
  return dailyScore(sum.won, sum.account, sum.billsPaid);
}

export function challengeStats(sum: Readonly<RunSummary>): ChallengeStats {
  const g = sum.startAccount > 0 ? sum.account / sum.startAccount - 1 : 0;
  return { title: sum.title, growth: Math.round(g * 1000) };
}

/** 读别人的 stats：只认这两样，不合格的整份不用（结果页只显示分数） */
export function parseChallengeStats(raw: unknown): ChallengeStats | null {
  if (!isObj(raw)) return null;
  if (typeof raw.title !== 'string' || raw.title.length === 0 || raw.title.length > 16) return null;
  if (!Number.isInteger(raw.growth) || !num(raw.growth, -1000, 1_000_000)) return null;
  return { title: raw.title, growth: raw.growth };
}
