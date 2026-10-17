/**
 * 收邀请（0.14.0，docs/social.md 1.3）：登录了、页面在前台时每 30 秒问一次（只读），切回前台马上问一次。
 * 有就在顶上弹一条"老王叫你来掼蛋 [去] [不了]"，顶栏的"好友"带红点。游戏页由 kit 的 social 部件弹同样的条，这里只管平台页面。
 * 点"去"先记"不了"再跳（到了游戏页 kit 不会再弹同一条），点"不了"马上收起。问失败不提示，下一次照问。
 */
import { useEffect, useSyncExternalStore } from 'react';
import { api, type Invite } from './api.ts';
import { gameName } from './format.ts';

const EVERY_MS = 30_000;

let list: Invite[] = [];
const listeners = new Set<() => void>();
const set = (next: Invite[]) => {
  list = next;
  for (const f of listeners) f();
};
const subscribe = (f: () => void) => (listeners.add(f), () => void listeners.delete(f));
const live = () => list.filter((v) => v.until > Date.now());

export function useInvitePolling(loggedIn: boolean): void {
  useEffect(() => {
    if (!loggedIn) {
      set([]);
      return;
    }
    const poll = () => {
      if (!document.hidden) api.invites().then((r) => set(r.invites), () => {});
    };
    poll();
    const timer = setInterval(poll, EVERY_MS);
    document.addEventListener('visibilitychange', poll);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
    };
  }, [loggedIn]);
}

/** 还有没过期的邀请：顶栏"好友"的红点 */
export function useHasInvites(): boolean {
  return useSyncExternalStore(subscribe, () => live().length > 0);
}

function drop(id: string): Promise<void> {
  set(list.filter((v) => v.id !== id));
  return api.dismissInvite(id).catch(() => {});
}

/** 顶上那一条：先到期的先弹 */
export function InviteBar() {
  useSyncExternalStore(subscribe, () => list);
  const v = live()[0];
  if (!v) return null;
  const go = async () => {
    await drop(v.id);
    location.assign(`/games/${encodeURIComponent(v.game)}/?room=${encodeURIComponent(v.room)}`);
  };
  return (
    <div className="banner invite" data-testid="invite-bar">
      <span>
        <strong>{[...v.from.name].slice(0, 12).join('')}</strong>
        叫你来{gameName(v.game)}
      </span>
      <span className="row">
        <button className="btn btn--small btn--primary" type="button" onClick={() => void go()}>
          去
        </button>
        <button className="btn btn--small" type="button" onClick={() => void drop(v.id)}>
          不了
        </button>
      </span>
    </div>
  );
}
