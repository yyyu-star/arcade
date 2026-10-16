import { MAX_DIFFICULTY, MIN_DIFFICULTY, isPersonaId, shortSetup, type GameState, type PersonaId, type RunSetup } from '../../core/index.ts';
import type { Profile, RecordResult } from '../../platform/profile.ts';
import { defaultStore, type KeyValueStore } from '../../platform/settings.ts';

/**
 * 画面自己的小记录（不进档案）：上次开局选的人设、难度和短局还是完整一年（「快速开始」用）、图鉴里已经看过的条目（「新」角标用）。
 * 读坏了就当没有，不报错。
 */

const LAST_KEY = 'kaipan.setup.last';
const VIEWED_KEY = 'kaipan.codex.viewed.v1';

export interface LastSetup {
  persona: PersonaId;
  difficulty: number;
  /** 0.10.0：短局（5 个月）还是完整一年；以前没记的、第一次玩都是短局 */
  short: boolean;
}

/** 娱乐开局设置：短局按 BALANCE.short 抄进这局（shortSetup），完整一年只有人设和难度 */
export function funSetup(s: Readonly<LastSetup>): RunSetup {
  return s.short ? shortSetup(s.persona, s.difficulty) : { persona: s.persona, difficulty: s.difficulty };
}

export function loadLastSetup(store: KeyValueStore | null = defaultStore()): LastSetup {
  try {
    const raw = JSON.parse(store?.getItem(LAST_KEY) ?? 'null') as Partial<LastSetup> | null;
    const persona = raw && typeof raw.persona === 'string' && isPersonaId(raw.persona) ? raw.persona : 'newbie';
    const d = Number(raw?.difficulty);
    const difficulty = Number.isInteger(d) && d >= MIN_DIFFICULTY && d <= MAX_DIFFICULTY ? d : MIN_DIFFICULTY;
    return { persona, difficulty, short: raw?.short !== false };
  } catch {
    return { persona: 'newbie', difficulty: MIN_DIFFICULTY, short: true };
  }
}

export function saveLastSetup(s: LastSetup, store: KeyValueStore | null = defaultStore()): void {
  try {
    store?.setItem(LAST_KEY, JSON.stringify(s));
  } catch {
    // 存不下就算了
  }
}

export type CodexGroup = 'stocks' | 'friends' | 'items' | 'events' | 'achievements';
export type Viewed = Record<CodexGroup, string[]>;

export function loadViewed(store: KeyValueStore | null = defaultStore()): Viewed {
  const empty: Viewed = { stocks: [], friends: [], items: [], events: [], achievements: [] };
  try {
    const raw = JSON.parse(store?.getItem(VIEWED_KEY) ?? 'null') as Partial<Viewed> | null;
    if (!raw) return empty;
    for (const k of Object.keys(empty) as CodexGroup[]) {
      const v = raw[k];
      if (Array.isArray(v)) empty[k] = v.filter((x): x is string => typeof x === 'string');
    }
    return empty;
  } catch {
    return empty;
  }
}

export function saveViewed(v: Viewed, store: KeyValueStore | null = defaultStore()): void {
  try {
    store?.setItem(VIEWED_KEY, JSON.stringify(v));
  } catch {
    // 存不下就算了
  }
}

// ---------------------------------------------------------------- 调试局标记

const UNSCORED_KEY = 'kaipan.run.unscored';

/** 一局的标识：种子 + 开局设置（runId 会随操作变化，不能用）。 */
function runKey(s: Pick<GameState, 'seed' | 'setup'>): string {
  return `${s.seed}|${JSON.stringify(s.setup ?? null)}`;
}

/**
 * 标记当前这局是调试局（URL 开局参数、?debug=1 会话里开的局），不计入档案；传 null 清除。
 * 存在 localStorage 里，刷新后继续这局也认得出来；从界面正常开新局时清掉。
 */
export function markUnscored(s: Pick<GameState, 'seed' | 'setup'> | null, store: KeyValueStore | null = defaultStore()): void {
  try {
    if (s) store?.setItem(UNSCORED_KEY, runKey(s));
    else store?.removeItem(UNSCORED_KEY);
  } catch {
    // 存不下就算了
  }
}

export function isUnscored(s: Pick<GameState, 'seed' | 'setup'>, store: KeyValueStore | null = defaultStore()): boolean {
  try {
    return store?.getItem(UNSCORED_KEY) === runKey(s);
  } catch {
    return false;
  }
}

/** 调试局的"记档结果"：档案原样，什么都不新增。 */
export function unscoredResult(profile: Profile): RecordResult {
  return {
    profile,
    ignored: 'debug',
    newAchievements: [],
    newPersonas: [],
    newDifficulty: null,
    newSeen: { stocks: [], friends: [], items: [], events: [] },
    newBest: false,
    newDaily: false,
    newSegment: false,
    newKnowledge: [],
  };
}

// ---------------------------------------------------------------- 画面偏好（0.3.1）

const VIEW_PREFS_KEY = 'kaipan.view.prefs';
/** 新手提示前几局默认打开 */
export const HINT_AUTO_RUNS = 3;

interface ViewPrefs {
  /** 新手提示：auto = 前 3 局打开、之后关闭；on / off = 玩家在设置里选过 */
  hints: 'auto' | 'on' | 'off';
  /** 收盘小结：full = 总账 + 每只一行；brief = 只显示总账一句 */
  recap: 'full' | 'brief';
  /** 0.5：没什么事的日子自动快进（默认开） */
  autoQuiet: boolean;
}

export function loadViewPrefs(store: KeyValueStore | null = defaultStore()): ViewPrefs {
  const out: ViewPrefs = { hints: 'auto', recap: 'full', autoQuiet: true };
  try {
    const raw = JSON.parse(store?.getItem(VIEW_PREFS_KEY) ?? 'null') as Partial<ViewPrefs> | null;
    if (raw?.hints === 'on' || raw?.hints === 'off' || raw?.hints === 'auto') out.hints = raw.hints;
    if (raw?.recap === 'full' || raw?.recap === 'brief') out.recap = raw.recap;
    if (typeof raw?.autoQuiet === 'boolean') out.autoQuiet = raw.autoQuiet;
  } catch {
    // 读坏了就用默认
  }
  return out;
}

export function saveViewPrefs(patch: Partial<ViewPrefs>, store: KeyValueStore | null = defaultStore()): ViewPrefs {
  const next = { ...loadViewPrefs(store), ...patch };
  try {
    store?.setItem(VIEW_PREFS_KEY, JSON.stringify(next));
  } catch {
    // 存不下就算了
  }
  return next;
}

/** 新手提示此刻是否打开：选过就按选的；没选过时，档案里玩过的局数少于 3 局就打开。 */
export function hintsOn(prefs: Pick<ViewPrefs, 'hints'>, runs: number): boolean {
  return prefs.hints === 'on' || (prefs.hints === 'auto' && runs < HINT_AUTO_RUNS);
}
