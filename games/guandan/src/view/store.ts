/**
 * 浏览器存储：全部 key 带 `guandan.` 前缀（所有游戏同域，前缀是唯一的隔离手段）。
 * 读坏了（JSON 损坏、版本不对）一律退回默认值，不让坏存档卡死游戏。
 */
import { soloLevelOf, type SoloLevel } from '../ai/venue.ts';
import type { GameState, Options } from '../core/index.ts';

export const KEYS = {
  save: 'guandan.save',
  settings: 'guandan.settings',
  stats: 'guandan.stats',
  tutorial: 'guandan.tutorial',
  errors: 'guandan.errors',
  /** 云同步元数据 {v, userId, rev, dirty}（cloud.ts） */
  cloud: 'guandan.cloud',
  /** iOS 防崩溃标记 {v, pending, low, ver}（device.ts） */
  boot: 'guandan.boot',
  /** "添加到主屏幕"提示关掉了（a2hs.ts） */
  a2hs: 'guandan.a2hs',
  /** 联机：最近进的房间 {code, host, at}，刷新后回得去（net.ts） */
  room: 'guandan.room',
  /** 单机实盘这一场（stake.ts）：只在本机，不进云同步 */
  stake: 'guandan.stake',
  /** 单独部署（没有平台）时好友房里的昵称（platform.ts、online.ts，0.8.0） */
  nick: 'guandan.nick',
} as const;

/** 云同步的槽（只同步战绩和教程标记；打到一半的牌局、设置不同步）→ 本地 key */
export const SYNC_SLOTS = { stats: KEYS.stats, tutorial: KEYS.tutorial } as const;
export type SyncSlot = keyof typeof SYNC_SLOTS;
/**
 * 云同步改本地数据前的备份：tag = pre-sync（合并前，只留最近一份）或 pre-switch.<旧 userId>（换账号前，每个旧账号一份，
 * 分开放是为了换完账号后的合并备份不把旧账号的数据盖掉）
 */
export const backupKey = (slot: SyncSlot, tag: string): string => `guandan.${slot}.${tag}`;
const syncListeners = new Set<(slot: SyncSlot) => void>();
/** 玩家自己改了要同步的数据（不含云同步写回本地）时通知 */
export function onSyncedChange(fn: (slot: SyncSlot) => void): () => void {
  syncListeners.add(fn);
  return () => syncListeners.delete(fn);
}
function changed(slot: SyncSlot): void {
  for (const fn of syncListeners) fn(slot);
}

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function read<T>(key: string): T | null {
  try {
    const raw = store()?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/** 云同步直接读写槽、元数据和合并前备份（不触发 onSyncedChange） */
export const rawStore = {
  read: <T>(key: string): T | null => read<T>(key),
  write: (key: string, value: unknown): void => write(key, value),
  remove: (key: string): void => {
    try {
      store()?.removeItem(key);
    } catch {
      // 忽略
    }
  },
};

function write(key: string, value: unknown): void {
  try {
    store()?.setItem(key, JSON.stringify(value));
  } catch {
    // 存储满了或被禁用：游戏照常进行，只是不能续玩
  }
}

/** 单独部署时好友房里的昵称：没填是空串（服务端按"游客"加数字叫） */
export function getNick(): string {
  const v = read<unknown>(KEYS.nick);
  return typeof v === 'string' ? v : '';
}

export function setNick(name: string): void {
  if (name) write(KEYS.nick, name);
  else rawStore.remove(KEYS.nick);
}

// ───────────── 设置 ─────────────

export type SpeedSetting = 'slow' | 'normal' | 'fast';
export interface Settings {
  v: 1;
  volume: number;
  music: boolean;
  muted: boolean;
  speed: SpeedSetting;
  difficulty: SoloLevel;
  /** 地方规则开关（新开一局时生效） */
  rules: Partial<Options>;
  back: 0 | 1;
  /** 牌桌顶上的记牌器（0.5.6）：点一下收起、再点展开 */
  counter: boolean;
  /** 牌桌互动开 / 不看（0.6.0，设置里叫"互动"）：关掉后好友房里别人的、单机电脑的短语、表情、道具都不播，电脑也不反应 */
  taunts: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  v: 1,
  volume: 0.8,
  music: true,
  muted: false,
  speed: 'normal',
  difficulty: 'novice',
  rules: {},
  back: 0,
  counter: true,
  taunts: true,
};

export const SPEED_FACTOR: Record<SpeedSetting, number> = { slow: 0.7, normal: 1, fast: 1.7 };

let settingsCache: Settings | null = null;

export function getSettings(): Settings {
  if (settingsCache) return settingsCache;
  const s = read<Partial<Settings>>(KEYS.settings);
  settingsCache = s && s.v === 1 ? { ...DEFAULT_SETTINGS, ...s, rules: { ...(s.rules ?? {}) } } : { ...DEFAULT_SETTINGS };
  // 难度 0.12.1 起是新手 / 普通 / 高手三档：旧版本存的四档换过来（简单→新手、较强→普通、困难→高手），认不得的按默认
  settingsCache.difficulty = soloLevelOf(settingsCache.difficulty) ?? DEFAULT_SETTINGS.difficulty;
  return settingsCache;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  settingsCache = { ...getSettings(), ...patch };
  write(KEYS.settings, settingsCache);
  return settingsCache;
}

// ───────────── 存档 ─────────────

export interface SaveData {
  v: 1;
  state: GameState;
  difficulty: SoloLevel;
  /** 这一局的胜负是否已记入战绩（防止刷新后重复计） */
  counted: boolean;
  /** 已记入战绩的副数（同上） */
  dealsCounted: number;
}

export function loadSave(): SaveData | null {
  const s = read<SaveData>(KEYS.save);
  if (!s || s.v !== 1 || !s.state || s.state.v !== 1 || !Array.isArray(s.state.hands)) return null;
  // 0.1.10 及以前的存档没记规则版本，都是第 1 版规则开的
  if (typeof s.state.rules !== 'number') s.state.rules = 1;
  // 存档里的难度认不得就按默认接着打（同 getSettings）
  s.difficulty = soloLevelOf(s.difficulty) ?? DEFAULT_SETTINGS.difficulty;
  return s;
}

export function writeSave(data: SaveData): void {
  write(KEYS.save, data);
}

export function clearSave(): void {
  try {
    store()?.removeItem(KEYS.save);
  } catch {
    // 忽略
  }
}

// ───────────── 战绩 ─────────────

export interface Stats {
  v: 1;
  games: number;
  wins: number;
  streak: number;
  bestStreak: number;
  deals: number;
  /** 我拿头游的副数 */
  firsts: number;
  /** 我方升级的副数 */
  dealWins: number;
}

export const EMPTY_STATS: Stats = { v: 1, games: 0, wins: 0, streak: 0, bestStreak: 0, deals: 0, firsts: 0, dealWins: 0 };

export function getStats(): Stats {
  const s = read<Stats>(KEYS.stats);
  return s && s.v === 1 ? { ...EMPTY_STATS, ...s } : { ...EMPTY_STATS };
}

export function recordDeal(first: boolean, won: boolean): Stats {
  const s = getStats();
  s.deals += 1;
  if (first) s.firsts += 1;
  if (won) s.dealWins += 1;
  write(KEYS.stats, s);
  changed('stats');
  return s;
}

export function recordGame(won: boolean): Stats {
  const s = getStats();
  s.games += 1;
  if (won) {
    s.wins += 1;
    s.streak += 1;
    s.bestStreak = Math.max(s.bestStreak, s.streak);
  } else {
    s.streak = 0;
  }
  write(KEYS.stats, s);
  changed('stats');
  return s;
}

// ───────────── 新手引导 ─────────────

export function tutorialDone(): boolean {
  return read<{ v: 1; done: boolean }>(KEYS.tutorial)?.done === true;
}

export function setTutorialDone(done: boolean): void {
  write(KEYS.tutorial, { v: 1, done });
  // "重看引导"清掉的标记不上传：合并规则是"或"，传了也会被云端的"看过"盖回来
  if (done) changed('tutorial');
}

// ───────────── 错误记录 ─────────────

export function rememberError(rec: unknown): void {
  const list = read<unknown[]>(KEYS.errors) ?? [];
  list.push(rec);
  write(KEYS.errors, list.slice(-20));
}
