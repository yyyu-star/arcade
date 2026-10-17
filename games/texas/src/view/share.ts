/**
 * 结算页的分享卡（0.14.0，总仓库 docs/social.md 1.1；画法是 kit 的 arcade-kit/share，这里只交数据）。
 * 只放公开的数：这一场的输赢、打了几手、赢了几手、最大一手的牌型（只在摊牌赢的时候有，那手牌大家都看到了）、称号。
 * 没摊的底牌一律不进卡（kit 也要求游戏自己别放隐藏信息）；不画牌面，图上不出现任何一张牌。
 */
import type { ShareCard } from 'arcade-kit/share';
import { CATEGORY_NAMES, categoryOf } from '../core/eval.ts';
import { chips } from './text.ts';
import type { RoomSummaryRow, SoloSummary, Title } from './summary.ts';
import type { Award } from './titles.ts';

const GAME = '德州扑克';
/** 毡面的绿 */
const ACCENT = '#0f6b4a';

const signed = (n: number): string => (n > 0 ? `+${chips(n)}` : n < 0 ? `−${chips(-n)}` : '0');

/** 我的称号：给称号时按名字认（单机就是我自己的昵称） */
const mine = (titles: readonly Title[], name: string): Title | undefined => titles.find((t) => t.name === name);

/** 单机离桌：where 是"娱乐 · 新手""小桌"这样的一句 */
export function soloCard(s: SoloSummary, where: string, name: string): ShareCard {
  const net = s.left - s.buyin;
  const t = mine(s.titles ?? [], name);
  return {
    game: GAME,
    title: `${s.practice ? '' : '实盘 · '}${where} · ${s.hands} 手`,
    accent: ACCENT,
    big: { value: signed(net), label: s.practice ? '筹码（娱乐，不算数）' : '筹码' },
    stats: [
      { label: '赢了', value: `${s.won} 手` },
      // 卡上的大字只放得下几个字：金额做大字，牌型放在下面的小字里；小字也只放得下六七个字（0.17.2 起右下角还有二维码），只写牌型大类
      ...(s.best ? [{ label: s.best.value === null ? '最大一池' : `最大一手 · ${CATEGORY_NAMES[categoryOf(s.best.value)]}`, value: chips(s.best.won) }] : []),
    ],
    ...(t ? { line: `${t.title}：${t.why}` } : {}),
    player: { name, ...(t ? { badge: t.title } : {}) },
  };
}

/**
 * 好友房：我这一场的输赢，下面三格是这一场的奖（谁拿了什么）；我拿了奖的话那一句做名场面、奖名做徽章。
 * 这一场没评出奖时退回同桌几个人、我排第几
 */
export function roomCard(rows: readonly RoomSummaryRow[], awards: readonly Award[], where: string, name: string): ShareCard | null {
  const me = rows.find((r) => r.me);
  if (!me) return null;
  const rank = [...rows].sort((a, b) => b.net - a.net).indexOf(me) + 1;
  const a = awards.find((x) => x.name === me.name);
  return {
    game: GAME,
    title: `好友房 · ${where}`,
    accent: ACCENT,
    big: { value: signed(me.net), label: '筹码' },
    stats: awards.length
      ? awards.slice(0, 3).map((x) => ({ label: x.title, value: x.name }))
      : [
          { label: '同桌', value: `${rows.length} 人` },
          { label: '名次', value: `第 ${rank}` },
        ],
    ...(a ? { line: a.line } : awards[0] ? { line: awards[0].line } : {}),
    player: { name, ...(a ? { badge: a.title } : {}) },
  };
}
