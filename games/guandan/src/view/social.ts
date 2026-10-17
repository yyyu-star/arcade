/**
 * 报位置、收邀请（0.13.0，仓库根 docs/social.md 1.2、1.3）：用 kit 的 `arcade-kit/social`，只在有平台、已登录时挂（单独部署、没登录一个请求都不发）。
 * 掼蛋只告诉它"我在哪"：好友房里报 place: room、房间码和真人几个（"3/4"），别的时候报 place: game。
 * 进房、离开房间时马上补报一次（online.ts 调 presenceNow），不用等 2 分钟。
 */
import type { Presence, SocialHandle } from 'arcade-kit/social';
import { platformInfo } from './platform.ts';
import type { NetSession } from './net.ts';

/** 横条上"老王叫你来<…>"：只认自己；别的游戏 kit 说"一起玩" */
const GAME_NAME: Record<string, string> = { guandan: '打掼蛋' };

/** 现在在哪：连着的好友房（大厅里或牌桌上）报房间，不然报在掼蛋 */
export function presenceOf(s: Pick<NetSession, 'code' | 'room' | 'status'> | null): Presence {
  if (s?.room && s.status === 'open' && s.room.status !== 'over') {
    const humans = s.room.seats.filter((x) => x.kind === 'human').length;
    return { place: 'room', game: 'guandan', room: s.code, seats: `${humans}/${s.room.seats.length}` };
  }
  return { place: 'game', game: 'guandan' };
}

let handle: SocialHandle | null = null;

/** 启动时挂一次（main.ts 在 detectOnce 之后调）。session：现在连着的好友房会话 */
export async function mountSocialOnce(session: () => NetSession | null): Promise<void> {
  if (handle) return;
  const info = platformInfo();
  if (info.platform !== true || !info.user) return;
  const { mountSocial } = await import('arcade-kit/social');
  handle = await mountSocial({ platform: info, where: () => presenceOf(session()), gameName: (id) => GAME_NAME[id] });
}

/** 位置变了（进房、离开房间、开打）：马上报一次 */
export function presenceNow(): void {
  handle?.presenceNow(true);
}
