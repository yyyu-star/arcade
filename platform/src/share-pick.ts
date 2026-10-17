/**
 * 晒战绩卡挑什么（0.21.1）：纯函数，不碰 DOM，测试在 test/share-pick.test.ts。主线看了真号的卡定的三条：
 * - 昵称旁的称号挑体面的：titles.json 没有分级、没有正负（2026-10-17 核对过四个游戏），只能把自嘲类的排除掉，剩下的挑最近拿到的；
 * - 三个小格挑亮眼的：至少 5 局、胜率至少 10% 的游戏才按胜率进候选，不够三项用"最大一把""称号 N 个"补；
 * - 底下那句短一点、不在词中间断：kit 按字折行，一行大约 14 个字，所以只写一句"最大一把"，放不下就去掉游戏名。
 */
import type { CareerView } from './api.ts';
import { gameName, num } from './format.ts';
import { GAMES } from './games.ts';

/**
 * 自嘲类的称号：按各游戏 titles.json 的实际名字核对（2026-10-17）。按 id 认，游戏改了名字也不会挂错；
 * 以后加的游戏、加的称号先按下面的字眼兜一层，看到新的自嘲称号再补进这里。
 */
const SELF_MOCKING: Readonly<Record<string, readonly string[]>> = {
  guandan: ['scapegoat'], // 背锅侠
  mahjong: ['xz_pao_king'], // 点炮王
  texas: ['call_station', 'money_boy'], // 跟注站、送财童子
  kaipan: ['leek_new', 'leek_old', 'leek_almost', 's_card', 's_plain'], // 新韭菜、老韭菜、差一点上岸的韭菜、信用卡战士、普通上班族
};
const MOCKING_WORDS = ['点炮', '背锅', '垫底', '韭菜', '送财', '跟注站', '倒数', '最惨'];

export function isSelfMocking(game: string, id: string, name: string): boolean {
  return (SELF_MOCKING[game] ?? []).includes(id) || MOCKING_WORDS.some((w) => name.includes(w));
}

/** 挂在昵称旁边的称号：排除自嘲的，挑最近拿到的；名字读不到的（"神秘称号"）不挂 */
export function pickBadge(games: Record<string, CareerView>, nameOf: (game: string, id: string) => string | undefined): string | null {
  let best: { name: string; at: number } | null = null;
  for (const [game, c] of Object.entries(games)) {
    for (const t of c.titles) {
      const name = nameOf(game, t.id);
      if (!name || isSelfMocking(game, t.id, name)) continue;
      if (!best || t.at > best.at) best = { name, at: t.at };
    }
  }
  return best?.name ?? null;
}

/** 胜率进候选至少要几局：一两局的 100% 不算本事 */
export const MIN_ROUNDS = 5;
/** 胜率至少多少才上卡：主线给的规则（5 局起、按胜率排）照样会让"雀馆 4%"上卡，晒出去不好看，再加一道门槛 */
export const MIN_RATE = 10;

const rate = (c: CareerView) => Math.round((c.wins / c.rounds) * 100);
const order = (id: string) => GAMES.findIndex((g) => g.id === id);

/** 卡上一行放得下的字数（kit 1080 宽、右边让出二维码，实测约 14 个字；带上引号留 2 个） */
export const LINE_MAX = 12;

export interface CardPicks {
  stats: { label: string; value: string }[];
  line?: string;
}

/**
 * 三个小格和底下一句。kit 的限制：标签最多 8 个字、值最多 10 个字，超了截掉；一句话按字折行。
 */
export function pickStats(games: Record<string, CareerView>): CardPicks {
  const list = Object.entries(games).filter(([, c]) => c.n > 0);
  const rated = list
    .filter(([, c]) => c.rounds >= MIN_ROUNDS && rate(c) >= MIN_RATE)
    .sort(([a, x], [b, y]) => rate(y) - rate(x) || y.rounds - x.rounds || order(a) - order(b))
    .slice(0, 3)
    .map(([g, c]) => {
      const both = `${rate(c)}% · ${num(c.rounds)}局`;
      return { label: `${gameName(g)}胜率`, value: Array.from(both).length <= 10 ? both : `${rate(c)}%` };
    });
  const best = list.reduce<[string, number] | null>((b, [g, c]) => (c.best > (b?.[1] ?? 0) ? [g, c.best] : b), null);
  const titles = list.reduce((t, [, c]) => t + c.titles.length, 0);
  const stats = [...rated];
  // 不够三项：先补最大一把（补进小格了，底下那句就不再重复），再补称号数
  let bestInStats = false;
  if (stats.length < 3 && best) {
    stats.push({ label: '最大一把', value: num(best[1]) });
    bestInStats = true;
  }
  if (stats.length < 3 && titles > 0) stats.push({ label: '称号', value: `${titles} 个` });
  let line: string | undefined;
  if (best && !bestInStats) {
    const full = `${gameName(best[0])}最大一把 ${num(best[1])}`;
    line = Array.from(full).length <= LINE_MAX ? full : `最大一把 ${num(best[1])}`;
  }
  return { stats, ...(line ? { line } : {}) };
}
