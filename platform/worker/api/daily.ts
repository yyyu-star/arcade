/**
 * 每日挑战榜的登记（games.ts 的 daily），交分、排行榜页、好友周榜三处共用：哪些标签、哪些游戏写了子榜（0.16.0）。
 * 现在还没有游戏写子榜，测试用 setDailyGamesForTests 换一份登记来测子榜（vi.mock 在 workerd 里换不到 worker 引用的模块）。
 */
import { type DailyTab, dailyTabs, GAMES, type GameEntry } from '../../src/games';

interface Daily {
  tabs: DailyTab[];
  /** 有每日榜的游戏 id */
  games: string[];
  /** 写了子榜的游戏 → 登记的子榜 id；没写子榜的游戏不在里面 */
  subs: ReadonlyMap<string, ReadonlySet<string>>;
}

function build(games: readonly GameEntry[]): Daily {
  return {
    tabs: dailyTabs(games),
    games: games.filter((g) => g.daily).map((g) => g.id),
    subs: new Map(games.flatMap((g) => (Array.isArray(g.daily) ? [[g.id, new Set(g.daily.map((x) => x.id))] as const] : []))),
  };
}

const real = build(GAMES);
let override: Daily | null = null;

export function daily(): Daily {
  return override ?? real;
}

export function setDailyGamesForTests(games: readonly GameEntry[] | null): void {
  override = games ? build(games) : null;
}
