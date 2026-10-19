/**
 * 德州在浏览器里存的东西，全从这里过：键名只在这儿定义，读写都带 try/catch（隐私模式、存满、被禁用时不抛错）。
 * 和平台、别的游戏同域，所以键一律 texas. 开头（test/arch.test.ts 守着）。
 * solo.ts、cloud.ts、fun.ts 是经注入的 Storage 读写的（便于测试），它们只从这里拿键名。
 */
export const KEYS = {
  /** 声音、快速、自动下一手，和大厅记住的盲注档/人数/玩法 */
  settings: 'texas.settings',
  /** 现在在的好友房：刷新、关页面后标题页给"回到房间"（不自动进）；点"离开房间"、房间关了就清掉 */
  room: 'texas.room',
  /** 上一次进的好友房：钱包里还有那一桌的一份时，标题页按它给"回到房间"；点"离开房间"、房间关了就清掉 */
  lastRoom: 'texas.lastRoom',
  session: 'texas.session',
  /** 单机锦标赛（Sit & Go）本机存档：刷新、断线后接着打或接着结（src/tour/solo.ts） */
  tour: 'texas.tour',
  /** 互动的总开关（"互动：不看"）。按人屏蔽、首次提示是 kit 的 TableFun 按 storageKey 存的：texas.fun.blocked（sessionStorage）、texas.hint.fun */
  fun: 'texas.fun',
  /** 0.12.0 及以前自己记的按人屏蔽（sessionStorage），0.13.0 起换成 kit 的 texas.fun.blocked，只用来清掉 */
  funMuted: 'texas.fun.muted',
  /** kit 0.19 的聊天设置（TableFun 的 prefsKey 默认值，kit 自己读写：弹幕开关 danmaku、电脑版聊天框收起 folded、记录展开 long） */
  chat: 'texas.chat',
  stats: 'texas.stats',
  meta: 'texas.cloud',
  preSync: 'texas.stats.pre-sync',
  preSwitch: (userId: string): string => `texas.stats.pre-switch.${userId}`,
  /** 0.2.2 及以前"我开的房间"的记录，现在只用来清掉 */
  hosted: 'texas.hosted',
} as const;

/** 读一个 JSON 值：没有、坏了、读不了都给 null */
export function readJson<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') as T | null;
  } catch {
    return null;
  }
}

/** 存一个 JSON 值；存不上就算了（这一次有效），返回是否存上了 */
export function writeJson(key: string, v: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // 清不掉：该过期的自己过期，该忽略的不再读
  }
}

/** 设置整块读出来（大厅和主页面各取自己要的字段；坏了当没有） */
export function readSettings(): Record<string, unknown> {
  const s = readJson<Record<string, unknown>>(KEYS.settings);
  return s && typeof s === 'object' ? s : {};
}

/** 读—合并—写：主页面和大厅各写各的字段，不覆盖对方的 */
export function patchSettings(patch: Record<string, unknown>): void {
  writeJson(KEYS.settings, { ...readSettings(), ...patch });
}
