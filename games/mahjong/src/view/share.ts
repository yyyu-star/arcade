/**
 * 结算页的"分享"（docs/social.md 1.1，kit 的 arcade-kit/share）：一场打完给一张战绩图，系统分享或预览里存图、复制链接。
 * 图上只有公开的、自己的东西：自己这一场的净输赢、胡了几局、最大几番、杠了几个，自己的名场面和称号；别人的手牌、牌墙一律不进图。
 * 不上传、不写库。
 */
import { prepareShare, type PreparedShare, type ShareCard } from 'arcade-kit/share';
import type { XzView } from '../core/variants/sichuan-xuezhan/index.ts';
import type { Award } from '../game/awards.ts';
import type { Highlight } from '../game/banter.ts';
import { AWARD_NAME, awardLine, GAME_NAME, HIGHLIGHT_NAME, signed, TITLE_NAME } from './text.ts';
import { tileSvg } from './tiles.ts';

/** 卡的主题色：牌桌的墨绿呢子 */
const ACCENT = '#0f5a41';

export interface CardInput {
  /** 这一张是什么："娱乐·新手 · 8 局"、"实盘小档 · 8 局"、"好友房 · 娱乐 · 8 局" */
  title: string;
  /** 实盘写"筹码"，娱乐写"分" */
  unit: string;
  name: string;
  fame: readonly Highlight[];
}

/** 自己这一场的战绩图数据（没打完、旁观的没有） */
export function cardOf(v: XzView, o: CardInput): ShareCard | null {
  const me = v.me?.seat;
  const r = me === undefined ? undefined : v.result?.seats[me];
  if (me === undefined || !r) return null;
  const st = v.seats[me]!.stats;
  const titles = r.stats.titles ?? [];
  const badge = titles[0] === undefined ? undefined : TITLE_NAME[titles[0]];
  // 名场面挑自己胡的最后一个（一场里往往是最响的那下）。一炮多响记在点炮的人头上，不拿来晒；没有就说拿到的称号
  const h = o.fame.filter((x) => x.seat === me && !FEEDER.has(x.id)).at(-1);
  const line = h ? `第 ${h.round + 1} 局 ${HIGHLIGHT_NAME[h.id]}` : badge ? `这一场拿到「${badge}」` : undefined;
  return {
    game: GAME_NAME,
    title: o.title,
    accent: ACCENT,
    big: { value: signed(r.net), label: o.unit },
    stats: [
      { label: '胡牌', value: `${st.wins} 局` },
      { label: '最大', value: `${r.stats.max?.['xz_fan'] ?? 0} 番` },
      { label: '杠', value: `${st.gangs} 个` },
    ],
    ...(line ? { line } : {}),
    player: { name: o.name, ...(badge ? { badge } : {}) },
  };
}

/**
 * 好友房颁奖的分享卡：大字是头一个奖（多半是 MVP）和得奖的人，小数据是其余的奖，一句话是头一个奖的那句。
 * 只有名字和结算里公开的数；name 是分享的这个人（旁观的也能分享）
 */
export function awardsCard(list: readonly Award[], names: readonly string[], unit: string, title: string, name: string): ShareCard | null {
  const top = list[0];
  if (!top) return null;
  const who = (a: Award): string => names[a.seat] ?? '';
  return {
    game: GAME_NAME,
    title,
    accent: ACCENT,
    big: { value: who(top), label: AWARD_NAME[top.id] },
    stats: list.slice(1).map((a) => ({ label: AWARD_NAME[a.id], value: who(a) })),
    line: awardLine(top, who(top), unit),
    player: { name },
  };
}

/** 名场面里记在点炮的人头上的（一炮双响、三响） */
const FEEDER = new Set<Highlight['id']>(['multi2', 'multi3']);

/** 卡上的插画：一条（那只小鸟），程序画的牌面；画不上 kit 就不画，照常出卡。
 * 牌面的 SVG 只有 viewBox（60×84），当图片画进画布要写明宽高，不然按默认的 300×150 算、只画出一角 */
function art(): HTMLImageElement {
  const img = new Image();
  img.src = `data:image/svg+xml,${encodeURIComponent(tileSvg(18).replace('<svg ', "<svg width='240' height='336' "))}`;
  return img;
}

/**
 * 结算页一出来就先把卡画好（kit 0.12.3）：iOS 只许在点击的那一下里调系统分享，点了再画就过期了、只能出预览。
 * "分享"的点击里直接 `void p.share()`，前面别 await。url 是游戏地址（好友房带房间码）
 */
export function prepareCard(card: ShareCard, url: string): PreparedShare {
  const log = import.meta.env.DEV ? (l: string) => ((window as { __shareLog?: string[] }).__shareLog ??= []).push(l) : undefined;
  return prepareShare({ ...card, art: art() }, { url, ...(log ? { log } : {}) });
}
