/**
 * 0.12.0 分享卡（docs/design-share.md，仓库根 docs/social.md 1.1）：开盘只交数据，画法和分享方式在共用包 `arcade-kit/share`。
 * 取代 0.6.5 起自己画的「晒战绩」海报，五个游戏的卡一个样子。
 *
 * - 大数字用比例不用钱数：三个人设开局本钱不一样，钱数没法比；实盘就是结回倍数（和结算页、顶栏同一个数，含杠杆）。
 * - 名场面按 design-share.md 第 2 节的顺序取第一条符合的；文字是固定模板，数字和名字由代码填，不收玩家的自由文字。
 *   模板压在一行放得下（约 16 个字）：卡上的引号跟着折行，长一点就剩一个引号掉到第二行。
 * - 小数据的值只放短的（共用包每格约 6 个字宽），名字放在说明那一行：人设名配难度、股票名配涨幅。
 * - 实盘的几句照结束页的规矩（design-live.md 第 5 节）：不催人再来，输了不推更高的档位。
 * - 不写年份、真实公司和行情段的故事（花名对得上真实年份，分享出去等于剧透）。
 */
import type { ShareArt, ShareCard } from 'arcade-kit/share';
import { BALANCE, formatPoints, liveTierById, type RunSummary } from '../core/index.ts';
import { artRef, stockKey } from './assets.ts';
import { chips } from './liveText.ts';
import { arrowOf, COLOR, css } from './theme.ts';

/** 交给共用包的数据（除了 art 和昵称，那两样要画面层和平台的东西）；artKey 是画哪只股票小人 */
export type ShareData = Omit<ShareCard, 'art' | 'player' | 'date' | 'stats'> & { stats: { label: string; value: string }[]; artKey: string | null; text: string };

/** 资产涨跌（娱乐、每日挑战的大数字）：最后剩下 ÷ 开局本钱 − 1 */
function growth(sum: Readonly<RunSummary>): number {
  return sum.startAccount > 0 ? sum.account / sum.startAccount - 1 : 0;
}

/** 这局打几个月：实盘、短局按设置，其余一年 */
function monthsOf(sum: Readonly<RunSummary>): number {
  return sum.live?.months ?? (sum.short ? BALANCE.short.months : 12);
}

const times = (bp: number): string => `×${(bp / 10_000).toFixed(2)}`;

/** 名场面（design-share.md 第 2 节，按顺序取第一条符合的） */
export function shareLine(sum: Readonly<RunSummary>): string {
  const lv = sum.live;
  const best = sum.bestTrade;
  if (lv && lv.bp >= 30_000) return lv.gear > 1 ? `杠杆 ×${lv.gear}，${lv.months} 个月结回 ${times(lv.bp)}` : `${lv.months} 个月结回 ${times(lv.bp)}`;
  if (lv?.margin) return `杠杆 ×${lv.gear}，第 ${sum.month} 个月清零`;
  if (sum.maxBoards >= 3) return `连涨 ${sum.maxBoards} 天，全程坐在车上`;
  if (best && best.ret >= 50) return `${best.name}一把赚了 ${formatPoints(best.ret, 1, false)}`;
  if (!lv && sum.won) return `${monthsOf(sum)} 个月的账全还上了`;
  return sum.style.line;
}

/** 分享卡上写什么（纯函数，测试看这里）。rank 是每日挑战交分后读到的今天全站名次 */
export function shareData(sum: Readonly<RunSummary>, rank?: number | null): ShareData {
  const lv = sum.live;
  const best = sum.bestTrade;
  const stats: { label: string; value: string }[] = [];
  let title: string;
  let big: ShareData['big'];
  if (lv) {
    const tier = lv.tier ? liveTierById(lv.tier).name : '实盘';
    title = `实盘${tier} · ${chips(lv.stake)}`;
    big = lv.margin ? { value: '×0', label: `杠杆 ×${lv.gear} · 跌到清零线` } : { value: times(lv.bp), label: lv.gear > 1 ? `杠杆 ×${lv.gear} · 结回几倍` : '结回几倍' };
    stats.push({ label: '还上', value: `${sum.billsPaid}/${lv.months} 个月` });
  } else {
    const g = growth(sum);
    big = { value: formatPoints(Math.abs(g) * 100, 1, false), label: g >= 0 ? '这局资产涨了' : '这局资产跌了' };
    if (sum.daily) {
      title = `每日挑战 ${sum.daily.slice(5).replace('-', '/')}`;
      stats.push(rank ? { label: '今天', value: `第 ${rank} 名` } : { label: '还上', value: `${sum.billsPaid}/12 个月` });
    } else {
      title = sum.short ? `短局 · ${monthsOf(sum)} 个月` : '完整一年';
      stats.push({ label: '结果', value: sum.won ? '通关' : `撑了 ${sum.month} 个月` });
    }
    stats.push({ label: sum.personaName, value: sum.difficultyName });
  }
  // 最赚的一笔只写真赚了的（全亏的局写"最赚"不对劲），没有就少一条
  if (best && best.ret > 0) stats.push({ label: best.name, value: `${arrowOf(best.ret)}${formatPoints(best.ret, 1, false)}` });
  return {
    game: '开盘',
    title,
    big,
    stats,
    line: shareLine(sum),
    accent: css(COLOR.accent),
    artKey: best ? stockKey(best.stockId, best.ret > 0 ? 'limitup' : 'worried') : null,
    // 系统分享里的一句：每日挑战是邀请（今天所有人同一局）
    text: sum.daily ? `开盘每日挑战${rank ? ` · 今天第 ${rank} 名` : ''}，同一局你来试试` : `开盘 · ${title} · ${big.label} ${big.value}`,
  };
}

/** 图集里那只股票小人：直接交图集和切片框，共用包自己切（去掉透明边以后的那块） */
export function shareArt(textures: Phaser.Textures.TextureManager, key: string | null): ShareArt | undefined {
  const ref = key ? artRef(textures, key) : null;
  const f = ref ? textures.getFrame(ref.tex, ref.frame) : null;
  if (!f) return undefined;
  return { image: f.source.image as CanvasImageSource, crop: { x: f.cutX, y: f.cutY, w: f.cutWidth, h: f.cutHeight }, fit: 'contain' };
}

/**
 * 分享出去的游戏地址：按当前页面推，挂在哪就是哪、不写死域名；
 * 去掉 ?debug=1、#… 这类参数，`/games/kaipan/index.html` 和没带斜杠的 `/games/kaipan` 都归到 `/games/kaipan/`。
 */
export function gameLink(href: string): string {
  const u = new URL(href);
  const p = u.pathname;
  const dir = /\/[^/]*\.[^/]*$/.test(p) ? p.replace(/[^/]*$/, '') : p.endsWith('/') ? p : `${p}/`;
  return `${u.origin}${dir}`;
}
