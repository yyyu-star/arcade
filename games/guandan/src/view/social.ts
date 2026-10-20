/**
 * 报位置、收邀请（0.13.0，仓库根 docs/social.md 1.2、1.3）：用 kit 的 `arcade-kit/social`，只在有平台、已登录时挂（单独部署、没登录一个请求都不发）。
 * 掼蛋只告诉它"我在哪"：好友房里报 place: room、房间码和真人几个（"3/4"），别的时候报 place: game。
 * 进房、离开房间时马上补报一次（online.ts 调 presenceNow），不用等 2 分钟。
 */
import type { Presence, SocialHandle } from 'arcade-kit/social';
import { platformInfo } from './platform.ts';
import { seatCountOf, type RoomLink } from './net.ts';

/** 大厅、牌桌上的联机会话（两种玩法）里社交只看这几项 */
type LinkInfo = Pick<RoomLink<never, never, never>, 'code' | 'room' | 'status'>;

/**
 * 横条上"老王叫你来牌馆"、面板里好友"在牌馆的好友房"：只认自己；别的游戏 kit 说"一起玩""在玩游戏"。
 * 游戏 id 是 guandan，掼蛋和斗地主共用，报位置分不出玩法（显示名由平台按登记给），所以写"牌馆"
 */
const GAME_NAME: Record<string, string> = { guandan: '牌馆' };

/** 现在在哪：连着的好友房（大厅里或牌桌上）报房间，不然报在牌馆 */
export function presenceOf(s: LinkInfo | null): Presence {
  if (s?.room && s.status === 'open' && s.room.status !== 'over') {
    const n = seatCountOf(s.room);
    const humans = s.room.seats.slice(0, n).filter((x) => x.kind === 'human').length;
    return { place: 'room', game: 'guandan', room: s.code, seats: `${humans}/${n}` };
  }
  return { place: 'game', game: 'guandan' };
}

let handle: SocialHandle | null = null;

/** 启动时挂一次（main.ts 在 detectOnce 之后调）。session：现在连着的好友房会话 */
export async function mountSocialOnce(session: () => LinkInfo | null): Promise<void> {
  if (handle) return;
  const info = platformInfo();
  if (info.platform !== true || !info.user) return;
  const { mountSocial } = await import('arcade-kit/social');
  handle = await mountSocial({ platform: info, where: () => presenceOf(session()), gameName: (id) => GAME_NAME[id] });
}

/**
 * "叫朋友来"面板的层级（0.13.2）：要盖住房间弹窗 #online（8500，online.ts），不然面板在 DOM 里却看不见、点不到（0.13.1 线上补验）；
 * 又要在"请横过来"（9000，orientation.ts）和出错面板（9500，errors.ts）之下。tests/share-card.test.ts 从源码里核对这几个数
 */
export const INVITE_Z = 8800;

/**
 * 房间里的"叫朋友来"（0.13.1）：kit 的面板，列好友、"叫他来"、复制邀请链接。没挂上（单独部署、没登录）时只有复制链接。
 * 链接按现在的页面地址拼（单独部署时站点不一样），点开就进这个房间
 */
export async function openInvitePanel(code: string, name = '掼蛋'): Promise<void> {
  const inv = { game: 'guandan', room: code, url: `${location.origin}${location.pathname}?room=${code}`, text: `来打${name}！房间码 ${code}`, zIndex: INVITE_Z };
  if (handle) {
    handle.openInvite(inv);
    return;
  }
  const { openInvite } = await import('arcade-kit/social');
  openInvite({ ...inv, friends: false });
}

/**
 * 报一条名场面到好友动态（0.15.0，feed.ts 挑的）：只有挂上了 social（有平台、已登录）才报，不然一个请求都不发。
 * 平台超了每天 10 条也静默 204，结果不用管
 */
export function postFeed(m: { moment: string; n?: number }): void {
  if (!handle) return;
  void import('arcade-kit/social').then(({ postMoment }) => postMoment('guandan', m.moment, m.n));
}

/** 位置变了（进房、离开房间、开打）：马上报一次 */
export function presenceNow(): void {
  handle?.presenceNow(true);
}
