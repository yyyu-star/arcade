/**
 * 0.6.0 实盘在画面这一层的接线（docs/design-live.md 第 2.4 节）：一个全局的 LiveClient（platform/live.ts），
 * 加上什么时候结回、什么时候重发、打开时怎么接上这局。
 */
import { BALANCE, gearLevered, isLive, liveMultipleBp, liveSettleStats, runSummary, type GameState, type SettleStats } from '../core/index.ts';
import { LiveClient } from '../platform/live.ts';
import { defaultStore } from '../platform/settings.ts';
import { standalone } from '../platform/mode.ts';
import { HOME_CONFIRM, LOBBY_CONFIRM } from './lobby.ts';
import { LIVE_LOBBY_CONFIRM } from './liveText.ts';

const listeners = new Set<() => void>();

export const live = new LiveClient({
  store: defaultStore(),
  fetch: (url, init) => globalThis.fetch(url, init),
  now: () => Date.now(),
  onChange: () => {
    for (const fn of listeners) fn();
  },
});

/** 实盘记录变了（结回成了、改成不算筹码……）：结束页、开始菜单跟着重画 */
export function onLiveChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 0.11.0 开了杠杆、放大后的结回倍数离清零线不到 warnGap 份：返回现在的倍数（顶栏变红闪、提醒一句）；不用提醒为 null */
export function marginWarn(s: Readonly<GameState>): number | null {
  const v = gearLevered(s);
  const call = s.setup?.live?.gear?.call ?? 0;
  return v !== null && s.phase === 'premarket' && v > call && v <= call + BALANCE.live.warnGap ? v : null;
}

/** 这局是正在打的实盘（记录对得上、还没结） */
export function isLiveRun(s: Readonly<GameState>): boolean {
  return isLive(s) && live.pendingFor(s.seed);
}

/** 一局实盘没打完（开新局前要先问） */
export function livePlaying(s: Readonly<GameState>): boolean {
  return isLive(s) && live.playing && live.record?.seed === s.seed && s.phase !== 'won' && s.phase !== 'lost';
}

/** 这局的战绩小结（平台 5.10）：结回时按截好的 bp 和这一份算。打完、破产、提前收手都带（0.6.7：提前收手以前漏了） */
export function liveStatsOf(s: Readonly<GameState>, quit = false): (bp: number, stake: number) => SettleStats {
  return (bp, stake) => liveSettleStats(runSummary(s), stake, bp, quit);
}

/** 局面变了：实盘局一结束（打完、破产）就结回。Session 每一步都调。 */
export function liveOnState(s: Readonly<GameState>): void {
  // 0.6.5 顺带算好战绩小结（平台 5.10），跟着结回一起报
  if ((s.phase === 'won' || s.phase === 'lost') && isLive(s) && live.playing && live.record?.seed === s.seed) void live.finish(s.seed, 'settle', liveMultipleBp(s), liveStatsOf(s));
}

/**
 * 打开游戏时（读完存档以后）：
 * - 记录是 playing 但过了期限 → 改成不算筹码（开始菜单说一句）；
 * - 记录是 playing 但存档里不是这局（带入后还没开局就关了页面，或存档没了）→ 这局没打成，原样退回；
 * - 上次没发成的结回、没收尾的带入 → 重发。
 * 之后回到前台、联网时也重发。
 */
export function startLive(s: Readonly<GameState>): void {
  const r = live.record;
  if (r?.step === 'playing' && !live.expire() && !(isLive(s) && s.seed === r.seed)) void live.finish(r.seed, 'refund', 0);
  liveOnState(s);
  void live.retry();
  if (typeof document === 'undefined') return;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void live.retry();
  });
  window.addEventListener('online', () => void live.retry());
}

/** 回大厅的确认：实盘局说"回来接着打完再结算"；单独部署（没有实盘）说"回首页" */
export function lobbyConfirm(s: Readonly<GameState>): { title: string; body: string; ok: string } {
  if (standalone()) return HOME_CONFIRM;
  return livePlaying(s) ? LIVE_LOBBY_CONFIRM : LOBBY_CONFIRM;
}
