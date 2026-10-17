/**
 * 平台页面报"我在大厅"（0.13.0，docs/social.md 1.2）：登录了、页面在前台时每 2 分钟报一次，切回前台马上报一次（平台自己按 2 分钟节流）。
 * 游戏页由 kit 的 social 部件报自己在哪，这里只管平台页面。报失败不提示，下一次照报。
 */
import { useEffect } from 'react';
import { api } from './api.ts';

const EVERY_MS = 120_000;

export function useLobbyPresence(loggedIn: boolean): void {
  useEffect(() => {
    if (!loggedIn) return;
    const report = () => {
      if (!document.hidden) api.presence({ place: 'lobby' }).catch(() => {});
    };
    report();
    const timer = setInterval(report, EVERY_MS);
    document.addEventListener('visibilitychange', report);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', report);
    };
  }, [loggedIn]);
}
