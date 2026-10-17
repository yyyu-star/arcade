/**
 * 结算页的"分享"（0.13.0，仓库根 docs/social.md 1.1）：把这一局 / 这一场的结果整理成 kit 分享卡要的数据，画和分享由 kit 的 `arcade-kit/share` 做。
 * 卡上只有公开的东西（胜负、名次、炸了几次、称号、实盘的分），不画任何人的手牌；那句话从模板拼，不收玩家的自由文字。
 * 拼数据的部分是纯函数（tests/share-card.test.ts）；结算页出来时才去碰 kit 的画布和 DOM。
 */
import type { PreparedShare, ShareCard } from 'arcade-kit/share';
import { TITLE_INFO, type MatchLog, type Title } from '../stake/titles.ts';
import { TIER_NAME, signed } from './stake-text.ts';

/** 掼蛋的主题色（和封面、图标的红一样） */
export const SHARE_ACCENT = '#b3202a';

/** 这一张分享的是什么 */
export type ShareKind =
  /** 娱乐：整局打完（单机或好友房） */
  | { kind: 'game'; win: boolean; room: string | null }
  /** 实盘：一场结算（单机或好友房）；points 是这一场的分，chips 是折成的筹码 */
  | { kind: 'stake'; tier: keyof typeof TIER_NAME; points: number; chips: number; deals: number; room: string | null };

/** 我拿的称号（一队两个人的也算我），没有就 null */
export function myTitle(titles: readonly Title[]): Title | null {
  return titles.find((t) => t.seat === 0 || (t.pair && t.seat === 2)) ?? null;
}

/** 那一句话：有称号说称号，没有按结果说一句 */
function lineOf(k: ShareKind, log: MatchLog, title: Title | null): string {
  if (title) return `${TITLE_INFO[title.id].name}：${title.why}`;
  if (log.firsts[0]! > 0) return `拿了 ${log.firsts[0]} 次头游`;
  if (k.kind === 'game') return k.win ? '和对家一路打过 A' : '差一点就过 A 了，下局再来';
  return k.points > 0 ? '赢了一场实盘' : k.points < 0 ? '这场手气差了点' : '不输不赢，打了个平手';
}

/**
 * 卡上的数据。log 是这一局攒的数（座位按画面：0 是我）；name 是我的昵称（好友房、有平台时），单机不写名字
 */
export function shareCardOf(k: ShareKind, log: MatchLog, titles: readonly Title[], name: string | null): ShareCard {
  const title = myTitle(titles);
  const where = k.room ? `好友房 ${k.room}` : '单机';
  const stats = [
    { label: '打了', value: `${k.kind === 'stake' ? k.deals : log.deals} 副` },
    { label: '头游', value: `${log.firsts[0]} 次` },
    { label: '炸弹', value: `${log.bombs[0]} 个` },
  ];
  const big =
    k.kind === 'game'
      ? { value: k.win ? '胜利' : '惜败', label: k.win ? '我方先过 A' : '对方先过了 A' }
      : { value: signed(k.chips), label: `筹码（${signed(k.points)} 分）` };
  return {
    game: '掼蛋',
    title: k.kind === 'game' ? `${where} · 打到 A` : `${where} · 实盘${TIER_NAME[k.tier]}`,
    big,
    stats,
    line: lineOf(k, log, title),
    accent: SHARE_ACCENT,
    ...(name ? { player: { name, ...(title ? { badge: TITLE_INFO[title.id].name } : {}) } } : {}),
  };
}

/** 分享出去的链接：游戏地址；好友房带房间码（点开就进那个房间） */
export function shareUrl(origin: string, path: string, room: string | null): string {
  return `${origin}${path}${room ? `?room=${room}` : ''}`;
}

let icon: HTMLImageElement | null = null;

/**
 * 结算页一出来就先画卡（0.13.1，kit 0.12.3 的 prepareShare）：iOS 只许在点击的那一下里调系统分享，点了再画就过期了、只能出预览。
 * 返回"分享"按钮的点击处理：卡画好了就在点击里同步调系统分享，还没画好等画完再试（调不起来 kit 退回预览）。
 * 图标用 favicon（同源，画进画布不污染）；没加载好 kit 跳过图标照常出卡
 */
export function prepareResult(card: ShareCard, room: string | null): () => void {
  if (!icon) {
    icon = new Image();
    icon.src = './favicon.svg';
  }
  const art = icon;
  let ready: PreparedShare | null = null;
  const loading = import('arcade-kit/share').then(({ prepareShare }) => {
    ready = prepareShare({ ...card, art }, { url: shareUrl(location.origin, location.pathname, room), fileName: 'guandan.png' });
    return ready;
  });
  return () => {
    // 前面不能有 await：这一行就在点击的处理函数里
    if (ready) void ready.share();
    else void loading.then((p) => p.share());
  };
}
