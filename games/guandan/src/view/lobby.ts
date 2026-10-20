/**
 * 回大厅：平台首页 `/`（平台的公开地址，所有游戏都挂在同一个域名下，所以写绝对路径）；单独部署（0.8.0）没有平台，回游戏自己的首页 `./`（platform.ts）。
 * 离开前补传一次云存档（keepalive；pagehide 时也会再触发，同一个槽在途时不重发）。
 */
import { app } from './app.ts';
import { lobbyName, lobbyUrl } from './platform.ts';
import { loadSave } from './store.ts';

/** 正在牌桌上打一局（还没打完）：回大厅前要确认一下 */
export function inGame(): boolean {
  const s = app.session;
  return !!s && s.state.phase !== 'gameOver' && !!app.game?.scene.isActive('table');
}

/** 有没有存着、还没打完的一局（竖屏时牌桌被盖住、转屏瞬间场景状态也不可靠，直接看存档） */
export function savedGameInProgress(): boolean {
  const s = loadSave();
  return !!s && s.state.phase !== 'gameOver';
}

/** 好友房正在打：回大厅不算离开房间，座位留着 */
export function inOnlineGame(): boolean {
  return (app.net ?? app.ddzNet)?.room?.status === 'playing';
}

/** 确认框里的话：这局会不会留着 */
export function leaveText(): string {
  // 房间的规矩（arcade-kit）：掉线头 60 秒座位留着，轮到你时等满 30 秒按"能不出就不出"代出；60 秒后才换电脑托管
  const to = `回${lobbyName()}？`;
  if (app.net || app.ddzNet) return `${to}头 60 秒轮到你时，等 30 秒按"能不出就不出"代出；之后电脑替你打。回来还能接着打`;
  // 单机实盘（StakeSession，不在这里 import 免得互相引用）：存档在 guandan.stake，24 小时内回来接着打
  if (app.session && 'stake' in app.session) return `${to}这场实盘会存着，24 小时内回来接着打`;
  return app.session?.persist === false ? `${to}这一局不会保存` : `${to}这一局会存着，下次进来点"继续"接着打`;
}

export function goLobby(): void {
  // 不受切后台那 3 分钟间隔限制，补传一次（pagehide 时还会再走一遍，同一个槽在途时不重发）
  app.cloud?.flushOnHide(true);
  window.location.assign(lobbyUrl());
}
