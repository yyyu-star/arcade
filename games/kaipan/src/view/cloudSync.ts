import { Cloud, META_KEY, browserDeps, type CloudView, type SlotDef } from '../platform/cloud.ts';
import { onTouched } from '../platform/localChange.ts';
import { PROFILE_KEY, cloudProfile, mergeProfile, emptyProfile, reviveProfile, type Profile } from '../platform/profile.ts';
import type { KeyValueStore } from '../platform/settings.ts';
import { EXT_TIPS_KEY, EXT_TIP_ORDER, loadSeenTips, reviveTips, type ExtTipId } from './extTips.ts';
import { TUTORIAL_KEY, TUTORIAL_ORDER, freshTutorial, loadTutorial, reviveTutorial, saveTutorial, type TutorialProgress } from './tutorial.ts';

/**
 * 开盘要同步的两个槽（档案、战绩、教程标记；打到一半的局和设置不同步）：
 * - profile：档案（图鉴、成就、人设和难度解锁、各组合最好成绩、每日挑战、行情段、小知识；战绩就在档案里）；
 * - tutorial：分步教程进度 + 新玩法的第一次提示。
 * 切到后台补传时 profile 排前面（丢了最心疼）。
 */

function raw(store: KeyValueStore | null, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

const profileSlot: SlotDef<Profile> = {
  name: 'profile',
  read: (store) => {
    const s = raw(store, PROFILE_KEY);
    if (!s) return null;
    try {
      return reviveProfile(JSON.parse(s));
    } catch {
      return null;
    }
  },
  write: (store, v) => {
    try {
      store?.setItem(PROFILE_KEY, JSON.stringify(v));
    } catch {
      // 存储不可用：这次打开里照常
    }
  },
  revive: (data) => reviveProfile(data),
  merge: mergeProfile,
  payload: (v) => cloudProfile(v),
  empty: emptyProfile,
};

interface TutorialSlot {
  tutorial: TutorialProgress;
  tips: ExtTipId[];
}

export const tutorialSlot: SlotDef<TutorialSlot> = {
  name: 'tutorial',
  read: (store) => (raw(store, TUTORIAL_KEY) === null && raw(store, EXT_TIPS_KEY) === null ? null : { tutorial: loadTutorial(store), tips: loadSeenTips(store) }),
  write: (store, v) => {
    // 走 saveTutorial：打开着的交易画面会跟着刷新教程
    saveTutorial(v.tutorial, store);
    try {
      store?.setItem(EXT_TIPS_KEY, JSON.stringify(v.tips));
    } catch {
      // 同上
    }
  },
  revive: (data) => {
    if (typeof data !== 'object' || data === null) return null;
    const d = data as Record<string, unknown>;
    return { tutorial: reviveTutorial(d.tutorial), tips: reviveTips(d.tips) };
  },
  // 教程：重新开启过的次数多的一边整个说了算；次数一样时看过的步骤取并集，任何一边关掉了就算关掉。提示总是取并集
  merge: (a, b) => ({
    tutorial: mergeTutorial(a.tutorial, b.tutorial),
    tips: EXT_TIP_ORDER.filter((id) => a.tips.includes(id) || b.tips.includes(id)),
  }),
  payload: (v) => v,
  empty: () => ({ tutorial: freshTutorial(), tips: [] }),
};

function mergeTutorial(a: TutorialProgress, b: TutorialProgress): TutorialProgress {
  const ra = a.reset ?? 0;
  const rb = b.reset ?? 0;
  if (ra !== rb) return ra > rb ? a : b;
  const done = TUTORIAL_ORDER.filter((s) => a.done.includes(s) || b.done.includes(s));
  return { v: 1, off: a.off || b.off, done, ...(ra > 0 ? { reset: ra } : {}) };
}

export const SLOTS: readonly SlotDef[] = [profileSlot as SlotDef, tutorialSlot as SlotDef];

let cloud: Cloud | null = null;
const listeners = new Set<(v: CloudView) => void>();

/** 云同步确认过的账号（没启动、没登录时为 null） */
export function cloudUserId(): string | null {
  return cloud?.userId ?? null;
}

/** 马上要离开这一页（回大厅）：补传一次待上传的进度（keepalive，页面走了也能发出去）。 */
export function flushBeforeLeave(): void {
  cloud?.hidden(true);
}

/** 云朵现在的样子（没启动时按未登录）。 */
export function cloudView(): CloudView {
  return cloud?.view ?? { state: 'out', note: null };
}

export function onCloudChange(fn: (v: CloudView) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 打开游戏时启动一次。onApplied：云端的进度写进了本地，画面按新档案重画。 */
export function startCloudSync(onApplied: () => void): void {
  if (cloud) return;
  const c = new Cloud(browserDeps(SLOTS, { onChange: (v) => listeners.forEach((fn) => fn(v)), onApplied }));
  cloud = c;
  onTouched((slot) => c.touch(slot));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') c.hidden();
    else c.visible();
  });
  // 别的标签页存了云存档的元数据：并进来（换了账号就从头来）
  window.addEventListener('storage', (e) => {
    if (e.key === META_KEY) c.absorb();
  });
  void c.start();
}
