/**
 * 斗地主每日挑战（docs/doudizhu.md 第 5 节）：同一天全服同一个种子、同样两个普通难度的电脑，打满一场（6 副），
 * 分数是我这一场的累计分，交到平台的每日榜 daily-<日期>-ddz（子榜 ddz，平台按 public/daily.json 显示）。
 * 日期按北京时间（平台只收北京时间昨天、今天、明天的每日榜）；平台按每人取最好的一次，所以可以重打，每打完一场交一次、不自动重试。
 * 每日挑战不写存档、不记战绩（和自己练的局分开），排行榜不防作弊（所有者定）。
 */
import { currentUserId } from './net.ts';
import { standalone } from './platform.ts';

/** 每日挑战的规则版本：发牌、计分大改时加一，榜名带 -v<n>，改前改后不在一个榜上比；0 = 不带 */
export const DDZ_DAILY_RULES = 0;
/** 两家电脑的难度：大家打同样的对手 */
export const DDZ_DAILY_LEVEL = 'normal';

/** 北京时间的日期 YYYY-MM-DD */
export function beijingDate(nowMs: number): string {
  const t = new Date(nowMs + 8 * 3600_000);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}`;
}

/** 这一天的种子：只和日期有关，所有人一样 */
export function ddzDailySeed(date: string): string {
  return `ddz-daily-${date}`;
}

export function ddzDailyBoard(date: string): string {
  return DDZ_DAILY_RULES > 0 ? `daily-${date}-ddz-v${DDZ_DAILY_RULES}` : `daily-${date}-ddz`;
}

export type DailySubmit =
  | { kind: 'ok'; best: number; improved: boolean }
  /** 没登录、单独部署（没有平台） */
  | { kind: 'out' }
  /** 交得太多了（平台每人每天的交分次数所有游戏合计） */
  | { kind: 'limit' }
  /** 平台在省额度、连不上 */
  | { kind: 'offline' }
  /** 别的拒绝（榜名、分数不合格）：游戏这边的错，不重试 */
  | { kind: 'bug'; status: number };

/** 交一次分：POST /api/scores（平台 15.5）。账号现问 /api/me，带上 userId，页面上的账号换了平台回 409 */
export async function submitDdzDaily(date: string, score: number, fetcher: typeof fetch = fetch): Promise<DailySubmit> {
  if (standalone()) return { kind: 'out' };
  const userId = await currentUserId(fetcher);
  if (!userId) return { kind: 'out' };
  try {
    const r = await fetcher('/api/scores', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      // 结算页马上点"回首页"也交得上
      keepalive: true,
      headers: { 'Content-Type': 'application/json', 'X-Arcade': '1' },
      body: JSON.stringify({ gameId: 'guandan', boardId: ddzDailyBoard(date), score, userId }),
    });
    if (r.status === 401) return { kind: 'out' };
    if (r.status === 429) return { kind: 'limit' };
    if (r.status === 200) {
      const b = (await r.json().catch(() => null)) as { best?: unknown; improved?: unknown } | null;
      if (typeof b?.best === 'number' && typeof b.improved === 'boolean') return { kind: 'ok', best: b.best, improved: b.improved };
      return { kind: 'ok', best: score, improved: false };
    }
    if (r.status >= 500 || r.status === 0) return { kind: 'offline' };
    return { kind: 'bug', status: r.status };
  } catch {
    return { kind: 'offline' };
  }
}

/** 结束页上的一句话 */
export function dailySubmitText(r: DailySubmit, score: number): string {
  switch (r.kind) {
    case 'ok':
      return r.improved ? `今天的最好成绩：${r.best} 分，已上榜` : `这次 ${score} 分，今天最好还是 ${r.best} 分`;
    case 'out':
      return '登录后打的每日挑战才上榜';
    case 'limit':
      return '今天交分次数用完了，明天再来';
    case 'offline':
      return '没交上（平台连不上），这次的分没记';
    case 'bug':
      return '没交上，这次的分没记';
  }
}
