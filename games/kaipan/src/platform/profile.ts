import {
  ACHIEVEMENTS,
  EVENTS,
  FRIENDS,
  ITEMS,
  KNOWLEDGE,
  MAX_DIFFICULTY,
  MIN_DIFFICULTY,
  PERSONAS,
  STOCKS,
  achievementById,
  isAchievementId,
  isDailyRun,
  isPersonaId,
  type PersonaId,
  REGIMES,
  type Regime,
  type RunSummary,
  type SeenSegment,
  type SeenSets,
} from '../core/index.ts';
import { touched } from './localChange.ts';
import { defaultStore, type KeyValueStore } from './settings.ts';

/**
 * 档案（0.3.0）：跨局的长线进度，和单局存档（storage.ts 的 kaipan.save）互不影响。
 * - 图鉴：见过的股票、群友、道具、事件；
 * - 已得成就（成就判定在 core 的 achievementsOf，这里只记）；
 * - 已解锁的人设（开局 3 个 + 成就解锁）和难度（通关一级解锁下一级）；
 * - 各人设 × 各难度的最好成绩；每日挑战纪录。
 * 有版本号；读到坏的或不认识的档案时原样备份到 kaipan.profile.corrupt，再重建一个空档案。
 *
 * 画面在一局结束时调用 recordRun(profile, runSummary(state))（纯函数），拿到新档案和"新达成 / 新解锁"列表，
 * 再 saveProfile 写回。调试开局（带 items / account 等字段）的局不计入。
 */
export const PROFILE_VERSION = 1;
export const PROFILE_KEY = 'kaipan.profile';
export const PROFILE_CORRUPT_KEY = 'kaipan.profile.corrupt';

/** 某个人设 × 难度的纪录。 */
export interface BestRecord {
  runs: number;
  wins: number;
  /** 通关时的最高账户（元）；没通关过为 0 */
  bestAccount: number;
  /** 最多还清几个月 */
  bestMonths: number;
}

/** 某一天的每日挑战纪录。 */
export interface DailyRecord {
  persona: PersonaId;
  difficulty: number;
  attempts: number;
  won: boolean;
  /** 通关时的最高账户（元）；没通关过为 0 */
  bestAccount: number;
  bestMonths: number;
}

export interface Profile {
  version: typeof PROFILE_VERSION;
  runs: number;
  wins: number;
  /** 图鉴：见过的条目 id（按内容表顺序） */
  seen: SeenSets;
  /** 已得成就 id → 第几局得到的（1 起） */
  achievements: Record<string, number>;
  /** 已解锁的人设（含开局可选的） */
  personas: PersonaId[];
  /** 已解锁的最高难度（1..8） */
  maxDifficulty: number;
  /** 键为 bestKey(persona, difficulty) */
  best: Record<string, BestRecord>;
  /** 键为日期 YYYY-MM-DD */
  daily: Record<string, DailyRecord>;
  /** 最近记过的一局（runId），防止同一局重复记 */
  last: string;
  /** 0.4 重做：见过的行情段（图鉴"行情段"页），键为段 id */
  segments: Record<string, SegmentRecord>;
  /** 0.4 C：点亮过的小知识 id（按小知识表顺序） */
  knowledge: string[];
}

/** 图鉴里的一段行情：什么市况、玩过几次、通关几次（不记年份和日期）。 */
export interface SegmentRecord extends SeenSegment {
  runs: number;
  wins: number;
}

/**
 * 没计入的原因：没结束、调试开局、同一局重复记、人设或难度还没解锁（真正的每日挑战除外）、
 * 每日挑战的日期晚于今天。
 */
export type RecordIgnored = 'unfinished' | 'debug' | 'duplicate' | 'locked' | 'future';

export interface RecordResult {
  profile: Profile;
  /** 这局没计入的原因；计入时为 null */
  ignored: RecordIgnored | null;
  /** 本局新达成的成就 id（按成就表顺序） */
  newAchievements: string[];
  /** 本局新解锁的人设 */
  newPersonas: PersonaId[];
  /** 本局新解锁的难度等级（没有为 null） */
  newDifficulty: number | null;
  /** 图鉴里新点亮的条目 */
  newSeen: SeenSets;
  /** 刷新了这个人设 × 难度的最好成绩（通关账户或还清月数） */
  newBest: boolean;
  /** 刷新了当天的每日挑战纪录 */
  newDaily: boolean;
  /** 0.4 重做：第一次见到这段行情（图鉴"行情段"新点亮） */
  newSegment: boolean;
  /** 0.4 C：新点亮的小知识 */
  newKnowledge: string[];
}

const STARTERS: readonly PersonaId[] = PERSONAS.filter((d) => d.unlock === 'start').map((d) => d.id);

/** 0.10.0 短局和完整一年分开记（一局几个月不一样，账户和还清几个月没法比）；老的键就是完整一年 */
export function bestKey(persona: PersonaId, difficulty: number, short = false): string {
  return `${persona}:${difficulty}${short ? ':short' : ''}`;
}

export function emptyProfile(): Profile {
  return {
    version: PROFILE_VERSION,
    runs: 0,
    wins: 0,
    seen: { stocks: [], friends: [], items: [], events: [] },
    achievements: {},
    personas: [...STARTERS],
    maxDifficulty: MIN_DIFFICULTY,
    best: {},
    daily: {},
    last: '',
    segments: {},
    knowledge: [],
  };
}

export function isPersonaUnlocked(p: Readonly<Profile>, id: PersonaId): boolean {
  return p.personas.includes(id);
}

export function isDifficultyUnlocked(p: Readonly<Profile>, level: number): boolean {
  return Number.isInteger(level) && level >= MIN_DIFFICULTY && level <= p.maxDifficulty;
}

// ---------------------------------------------------------------- 校验

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function nat(v: unknown, d = 0): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d;
}

/** 只留下当前版本认识的 id，并按内容表顺序排好。 */
function known(list: unknown, all: readonly { id: string }[]): string[] {
  const set = new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []);
  return all.filter((d) => set.has(d.id)).map((d) => d.id);
}

/**
 * 校验并修整档案：结构不对返回 null；不认识的条目（新版本删掉的内容）剔除，缺的字段补默认值，
 * 开局可选的人设总是解锁，成就带来的人设按已得成就补齐。
 */
export function reviveProfile(raw: unknown): Profile | null {
  if (!isObject(raw) || raw.version !== PROFILE_VERSION) return null;
  const p = emptyProfile();
  p.runs = nat(raw.runs);
  p.wins = nat(raw.wins);
  const seen = isObject(raw.seen) ? raw.seen : {};
  p.seen = {
    stocks: known(seen.stocks, STOCKS),
    friends: known(seen.friends, FRIENDS),
    items: known(seen.items, ITEMS),
    events: known(seen.events, EVENTS),
  };
  if (isObject(raw.achievements)) {
    for (const d of ACHIEVEMENTS) {
      const v = raw.achievements[d.id];
      if (typeof v === 'number' && Number.isFinite(v)) p.achievements[d.id] = v;
    }
  }
  const personas = new Set<PersonaId>(STARTERS);
  if (Array.isArray(raw.personas)) for (const id of raw.personas) if (typeof id === 'string' && isPersonaId(id)) personas.add(id);
  for (const id of Object.keys(p.achievements)) {
    const u = achievementById(id).unlocks;
    if (u) personas.add(u);
  }
  p.personas = PERSONAS.filter((d) => personas.has(d.id)).map((d) => d.id);
  p.maxDifficulty = Math.max(MIN_DIFFICULTY, Math.min(MAX_DIFFICULTY, Math.floor(nat(raw.maxDifficulty, MIN_DIFFICULTY))));
  if (isObject(raw.best)) {
    for (const [k, v] of Object.entries(raw.best)) {
      const [persona, lv] = k.split(':');
      if (!persona || !isPersonaId(persona) || !isObject(v)) continue;
      const level = Number(lv);
      if (!Number.isInteger(level) || level < MIN_DIFFICULTY || level > MAX_DIFFICULTY) continue;
      p.best[k] = { runs: nat(v.runs), wins: nat(v.wins), bestAccount: nat(v.bestAccount), bestMonths: nat(v.bestMonths) };
    }
  }
  if (isObject(raw.daily)) {
    for (const [date, v] of Object.entries(raw.daily)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !isObject(v) || typeof v.persona !== 'string' || !isPersonaId(v.persona)) continue;
      p.daily[date] = {
        persona: v.persona,
        difficulty: Math.max(MIN_DIFFICULTY, Math.min(MAX_DIFFICULTY, Math.floor(nat(v.difficulty, MIN_DIFFICULTY)))),
        attempts: nat(v.attempts),
        won: v.won === true,
        bestAccount: nat(v.bestAccount),
        bestMonths: nat(v.bestMonths),
      };
    }
  }
  p.last = typeof raw.last === 'string' ? raw.last : '';
  if (isObject(raw.segments)) {
    for (const [id, v] of Object.entries(raw.segments)) {
      // 0.4 开发期旧档案还带 year / from / to，读进来时丢掉（新档案不存年份和日期）
      if (!isObject(v) || typeof v.title !== 'string') continue;
      if (typeof v.regime !== 'string' || !REGIMES.includes(v.regime as Regime)) continue;
      const story = Array.isArray(v.story) && v.story.every((x) => typeof x === 'string') ? (v.story as string[]).slice(0, 12) : undefined;
      const rec: SegmentRecord = { id, regime: v.regime as Regime, title: v.title, runs: nat(v.runs), wins: nat(v.wins) };
      if (story) rec.story = story;
      if (typeof v.verdict === 'string') rec.verdict = v.verdict;
      p.segments[id] = rec;
    }
  }
  if (Array.isArray(raw.knowledge)) p.knowledge = mergeKnowledge([], raw.knowledge.filter((x): x is string => typeof x === 'string')).list;
  return p;
}

/** 0.4 C：把新点亮的小知识并进列表（按小知识表顺序，不认识的丢掉）。 */
function mergeKnowledge(old: readonly string[], ids: readonly string[]): { list: string[]; added: string[] } {
  const all = new Set([...old, ...ids]);
  const list = KNOWLEDGE.filter((d) => all.has(d.id)).map((d) => d.id);
  const added = list.filter((id) => !old.includes(id));
  return { list, added };
}

/** 0.4 C：局中第一次触发某个机制就点亮（不用等一局结束；调试局也算，只是图鉴）。 */
export function learnKnowledge(profile: Readonly<Profile>, ids: readonly string[]): { profile: Profile; added: string[] } {
  const m = mergeKnowledge(profile.knowledge ?? [], ids);
  if (m.added.length === 0) return { profile: profile as Profile, added: [] };
  return { profile: { ...structuredClone(profile as Profile), knowledge: m.list }, added: m.added };
}

// ---------------------------------------------------------------- 读写

function get(store: KeyValueStore | null, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function set(store: KeyValueStore | null, key: string, value: string): boolean {
  try {
    store?.setItem(key, value);
    return store !== null;
  } catch (err) {
    console.warn('档案写入失败：', err);
    return false;
  }
}

/**
 * 读档案。没有档案时给空档案；档案坏了（解析失败、结构不对、版本不认识）时原样备份到
 * kaipan.profile.corrupt，重建空档案并写回，notice 为 'corrupt'。不碰单局存档。
 */
export function loadProfile(store: KeyValueStore | null = defaultStore()): { profile: Profile; notice: 'corrupt' | null } {
  const raw = get(store, PROFILE_KEY);
  if (!raw) return { profile: emptyProfile(), notice: null };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const p = reviveProfile(parsed);
  if (p) return { profile: p, notice: null };
  console.warn(`档案无法读取，已备份到 ${PROFILE_CORRUPT_KEY} 并重建`);
  set(store, PROFILE_CORRUPT_KEY, raw);
  const fresh = emptyProfile();
  set(store, PROFILE_KEY, JSON.stringify(fresh));
  return { profile: fresh, notice: 'corrupt' };
}

/** 写档案；写入失败（配额、隐私模式）返回 false，不抛错。 */
export function saveProfile(p: Readonly<Profile>, store: KeyValueStore | null = defaultStore()): boolean {
  const ok = set(store, PROFILE_KEY, JSON.stringify(p));
  touched('profile');
  return ok;
}

// ---------------------------------------------------------------- 云存档（0.5.7）

/**
 * 两份档案合成一份（云同步冲突时用，纯函数）：集合取并集，计数取较大。
 * - 成就记的是"第几局得到的"，取较早的那局；每日挑战的人设和难度按日期固定，两边一样，取 a 的；
 * - last（防同一局重复记）只在本机有意义，取 a（本地）的；
 * - 行情段的小故事两边都有时取 a 的（同一段打过几次，故事是最后一次的）。
 */
export function mergeProfile(a: Readonly<Profile>, b: Readonly<Profile>): Profile {
  const p = emptyProfile();
  p.runs = Math.max(a.runs, b.runs);
  p.wins = Math.max(a.wins, b.wins);
  p.seen = {
    stocks: merge(a.seen.stocks, b.seen.stocks, STOCKS).list,
    friends: merge(a.seen.friends, b.seen.friends, FRIENDS).list,
    items: merge(a.seen.items, b.seen.items, ITEMS).list,
    events: merge(a.seen.events, b.seen.events, EVENTS).list,
  };
  for (const d of ACHIEVEMENTS) {
    const va = a.achievements[d.id];
    const vb = b.achievements[d.id];
    if (va !== undefined || vb !== undefined) p.achievements[d.id] = Math.min(va ?? Infinity, vb ?? Infinity);
  }
  p.personas = merge(a.personas, b.personas, PERSONAS).list as PersonaId[];
  p.maxDifficulty = Math.max(a.maxDifficulty, b.maxDifficulty);
  for (const k of new Set([...Object.keys(a.best), ...Object.keys(b.best)])) {
    const x = a.best[k];
    const y = b.best[k];
    p.best[k] = x && y ? { runs: Math.max(x.runs, y.runs), wins: Math.max(x.wins, y.wins), bestAccount: Math.max(x.bestAccount, y.bestAccount), bestMonths: Math.max(x.bestMonths, y.bestMonths) } : { ...(x ?? y)! };
  }
  for (const k of new Set([...Object.keys(a.daily), ...Object.keys(b.daily)])) {
    const x = a.daily[k];
    const y = b.daily[k];
    p.daily[k] = x && y
      ? { persona: x.persona, difficulty: x.difficulty, attempts: Math.max(x.attempts, y.attempts), won: x.won || y.won, bestAccount: Math.max(x.bestAccount, y.bestAccount), bestMonths: Math.max(x.bestMonths, y.bestMonths) }
      : { ...(x ?? y)! };
  }
  p.last = a.last;
  for (const k of new Set([...Object.keys(a.segments), ...Object.keys(b.segments)])) {
    const x = a.segments[k];
    const y = b.segments[k];
    const base = { ...(x ?? y)! };
    if (x && y) {
      base.runs = Math.max(x.runs, y.runs);
      base.wins = Math.max(x.wins, y.wins);
      const story = x.story ?? y.story;
      const verdict = x.verdict ?? y.verdict;
      if (story) base.story = [...story];
      if (verdict !== undefined) base.verdict = verdict;
    } else if (base.story) base.story = [...base.story];
    p.segments[k] = base;
  }
  p.knowledge = mergeKnowledge(a.knowledge, b.knowledge).list;
  return p;
}

/** 云端每槽 data ≤ 48 KB；档案留 2 KB 余量给外层。 */
export const CLOUD_PROFILE_BYTES = 46 * 1024;

/**
 * 传上云的档案：去掉只在本机有意义的 last；太大时先去掉行情段的小故事（本机照样留着，云端只记见过哪段、玩了几次），
 * 还大就从最早的日子删每日挑战纪录。
 */
export function cloudProfile(p: Readonly<Profile>, limit = CLOUD_PROFILE_BYTES): Profile {
  const out = JSON.parse(JSON.stringify(p)) as Profile;
  out.last = '';
  const size = (): number => new TextEncoder().encode(JSON.stringify(out)).length;
  if (size() <= limit) return out;
  for (const seg of Object.values(out.segments)) {
    delete seg.story;
    delete seg.verdict;
  }
  const dates = Object.keys(out.daily).sort();
  let over = size() - limit;
  while (over > 0 && dates.length > 0) {
    const d = dates.shift()!;
    over -= new TextEncoder().encode(`${JSON.stringify(d)}:${JSON.stringify(out.daily[d])},`).length;
    delete out.daily[d];
  }
  return out;
}

// ---------------------------------------------------------------- 记一局

function merge(old: readonly string[], add: readonly string[], all: readonly { id: string }[]): { list: string[]; added: string[] } {
  const set = new Set(old);
  const added = add.filter((id) => !set.has(id));
  for (const id of added) set.add(id);
  return { list: all.filter((d) => set.has(d.id)).map((d) => d.id), added: all.filter((d) => added.includes(d.id)).map((d) => d.id) };
}

/**
 * 0.6.0 实盘局：规则和娱乐局不一样（半年、账单轻），只记图鉴（见过的股票、群友、道具、事件、小知识），
 * 不算局数、通关、最好成绩、成就和解锁（docs/design-live.md 第 7 节）。带调试字段的实盘局什么都不记。
 */
function recordLive(profile: Readonly<Profile>, summary: Readonly<RunSummary>, base: RecordResult): RecordResult {
  if (!summary.live?.clean) return { ...base, ignored: 'debug' };
  if (!isPersonaUnlocked(profile, summary.persona)) return { ...base, ignored: 'locked' };
  if (profile.last === summary.runId) return { ...base, ignored: 'duplicate' };
  const p = base.profile;
  p.last = summary.runId;
  const stocks = merge(p.seen.stocks, summary.seen.stocks, STOCKS);
  const friends = merge(p.seen.friends, summary.seen.friends, FRIENDS);
  const items = merge(p.seen.items, summary.seen.items, ITEMS);
  const events = merge(p.seen.events, summary.seen.events, EVENTS);
  p.seen = { stocks: stocks.list, friends: friends.list, items: items.list, events: events.list };
  const kn = mergeKnowledge(p.knowledge ?? [], summary.knowledge ?? []);
  p.knowledge = kn.list;
  return { ...base, profile: p, newSeen: { stocks: stocks.added, friends: friends.added, items: items.added, events: events.added }, newKnowledge: kn.added };
}

/**
 * 一局结束时记进档案（纯函数：不改传入的 profile，不读写存储）。summary 用 core 的 runSummary(state)；
 * today 是玩家本地的今天（YYYY-MM-DD，由调用方给出，core 和这里都不读时钟）。
 * - 没结束的局、调试开局（summary.ranked 为 false）、同一局重复记：原样返回，ignored 说明原因。
 * - 人设或难度在档案里还没解锁的局（真正的每日挑战除外）：ignored 'locked'，不计分、不解锁。
 * - 每日挑战的日期晚于 today：ignored 'future'。
 * - 成就：本局达成的里面档案还没有的就是新成就；成就带来的人设随之解锁。
 * - 难度：非每日挑战的局通关第 N 级，解锁第 N+1 级（最高 8）。
 * - 纪录：非每日挑战记在 best[persona:difficulty]（短局另记 best[persona:difficulty:short]）；每日挑战记在 daily[date]。
 *   每日挑战要校验种子、人设、难度和 dailySetup(日期) 完全一致，不一致的按普通局记（"每日打卡"成就同样校验）。
 * - 0.13.0 好友挑战的局（opts.challenge，调用方按这台设备接下的挑战认）照每日挑战的规矩：人设、难度由发起人定，可以是还没解锁的；
 *   不解锁难度、不记最好成绩（成绩挂在挑战下），图鉴和成就照常。
 */
export function recordRun(profile: Readonly<Profile>, summary: Readonly<RunSummary>, today: string, opts: { challenge?: boolean } = {}): RecordResult {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error('recordRun 的 today 要是本地日期 YYYY-MM-DD');
  const none: SeenSets = { stocks: [], friends: [], items: [], events: [] };
  const base: RecordResult = {
    profile: structuredClone(profile) as Profile,
    ignored: null,
    newAchievements: [],
    newPersonas: [],
    newDifficulty: null,
    newSeen: none,
    newBest: false,
    newDaily: false,
    newSegment: false,
    newKnowledge: [],
  };
  if (!summary.ended) return { ...base, ignored: 'unfinished' };
  if (summary.live) return recordLive(profile, summary, base);
  if (!summary.ranked) return { ...base, ignored: 'debug' };
  if (summary.daily && summary.daily > today) return { ...base, ignored: 'future' };
  // 每日挑战要货真价实：种子、人设、难度都和 dailySetup(日期) 一致，否则按普通局记
  const daily = summary.daily && isDailyRun(summary.daily, summary.seed, summary.persona, summary.difficulty) ? summary.daily : null;
  const challenge = !daily && opts.challenge === true;
  // 普通局只能用已经解锁的人设和难度（每日挑战的人设、难度由日期决定，好友挑战由发起人定，可以是还没解锁的）
  if (!daily && !challenge && (!isPersonaUnlocked(profile, summary.persona) || !isDifficultyUnlocked(profile, summary.difficulty))) {
    return { ...base, ignored: 'locked' };
  }
  if (profile.last === summary.runId) return { ...base, ignored: 'duplicate' };
  const p = base.profile;
  p.runs += 1;
  if (summary.won) p.wins += 1;
  p.last = summary.runId;

  // 图鉴
  const stocks = merge(p.seen.stocks, summary.seen.stocks, STOCKS);
  const friends = merge(p.seen.friends, summary.seen.friends, FRIENDS);
  const items = merge(p.seen.items, summary.seen.items, ITEMS);
  const events = merge(p.seen.events, summary.seen.events, EVENTS);
  p.seen = { stocks: stocks.list, friends: friends.list, items: items.list, events: events.list };
  const newSeen: SeenSets = { stocks: stocks.added, friends: friends.added, items: items.added, events: events.added };
  const kn = mergeKnowledge(p.knowledge ?? [], summary.knowledge ?? []);
  p.knowledge = kn.list;
  const seg: SeenSegment | null = summary.segment ?? null;
  const newSegment = seg !== null && !p.segments[seg.id];
  if (seg) {
    const old = p.segments[seg.id];
    p.segments[seg.id] = { ...seg, runs: (old?.runs ?? 0) + 1, wins: (old?.wins ?? 0) + (summary.won ? 1 : 0) };
  }

  // 成就与人设
  const newAchievements = ACHIEVEMENTS.filter((d) => summary.achievements.includes(d.id) && p.achievements[d.id] === undefined).map(
    (d) => d.id,
  );
  for (const id of newAchievements) p.achievements[id] = p.runs;
  const newPersonas: PersonaId[] = [];
  for (const id of newAchievements) {
    const u = isAchievementId(id) ? achievementById(id).unlocks : undefined;
    if (u && !p.personas.includes(u)) newPersonas.push(u);
  }
  if (newPersonas.length > 0) {
    const all = new Set([...p.personas, ...newPersonas]);
    p.personas = PERSONAS.filter((d) => all.has(d.id)).map((d) => d.id);
  }

  // 难度与纪录
  let newDifficulty: number | null = null;
  let newBest = false;
  let newDaily = false;
  if (daily) {
    const old = p.daily[daily];
    const rec: DailyRecord = old
      ? { ...old }
      : { persona: summary.persona, difficulty: summary.difficulty, attempts: 0, won: false, bestAccount: 0, bestMonths: 0 };
    rec.attempts += 1;
    if (summary.won && summary.account > rec.bestAccount) {
      rec.bestAccount = summary.account;
      newDaily = true;
    }
    if (summary.billsPaid > rec.bestMonths) {
      rec.bestMonths = summary.billsPaid;
      newDaily = true;
    }
    if (summary.won) rec.won = true;
    p.daily[daily] = rec;
  } else if (!challenge) {
    const key = bestKey(summary.persona, summary.difficulty, summary.short);
    const rec: BestRecord = p.best[key] ? { ...p.best[key] } : { runs: 0, wins: 0, bestAccount: 0, bestMonths: 0 };
    rec.runs += 1;
    if (summary.won) rec.wins += 1;
    if (summary.won && summary.account > rec.bestAccount) {
      rec.bestAccount = summary.account;
      newBest = true;
    }
    if (summary.billsPaid > rec.bestMonths) {
      rec.bestMonths = summary.billsPaid;
      newBest = true;
    }
    p.best[key] = rec;
    if (summary.won && summary.difficulty < MAX_DIFFICULTY && summary.difficulty + 1 > p.maxDifficulty) {
      p.maxDifficulty = summary.difficulty + 1;
      newDifficulty = p.maxDifficulty;
    }
  }
  return { profile: p, ignored: null, newAchievements, newPersonas, newDifficulty, newSeen, newBest, newDaily, newSegment, newKnowledge: kn.added };
}
