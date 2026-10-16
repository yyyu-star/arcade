/**
 * 0.6.5 实盘结回时带给平台的战绩小结（平台 0.10.0，docs/platform-backend.md 5.10）。
 * 平台的类型照抄在这里（模块不能 import 平台的代码）。称号的中文名放在 public/titles.json，平台的称号墙去读；
 * 那个文件由 titlesJson() 生成，测试锁住两边一致。
 */
import { liveReturn } from './liveTiers.ts';
import type { RunSummary } from './queries.ts';

/** settle 可选带的这一份小结。JSON 后 ≤ 256 字节；不合格平台整份忽略，结回照常 */
export interface SettleStats {
  rounds: number;
  wins: number;
  best: number;
  titles?: string[];
  max?: Record<string, number>;
  sum?: Record<string, number>;
}

/** 结束页的称号（titleFor）→ 称号 id。id 只能是小写字母开头的 [a-z0-9_]，最长 24 */
export const END_TITLES: Record<string, { id: string; desc: string }> = {
  新韭菜: { id: 'leek_new', desc: '前 3 个月就没还上钱' },
  老韭菜: { id: 'leek_old', desc: '撑过 3 个月，没撑到最后' },
  差一点上岸的韭菜: { id: 'leek_almost', desc: '撑到 9 个月以后才没还上' },
  惊险上岸: { id: 'ashore_close', desc: '通关，炒股赚得不多，惊险上岸' },
  上岸散户: { id: 'ashore', desc: '通关，炒股赚了本钱的三成以上' },
  大户新秀: { id: 'big_rookie', desc: '通关，炒股赚了本钱的 1.2 倍以上' },
  百万韭菜王: { id: 'leek_king', desc: '通关，炒股赚了本钱的 3 倍以上' },
};

/** 打法评语（playStyle）的称号：id 前面加 s_，名字就是标签 */
export const STYLE_TITLES: Record<string, { name: string; desc: string }> = {
  zen: { name: '观望大师', desc: '一只都没买，看完了整局' },
  allin_bank: { name: '押上全部家当', desc: '押给银行的东西被收走了' },
  bear: { name: '反着来的人', desc: '一局里押跌 5 次以上' },
  rider: { name: '连涨骑手', desc: '手里有一只连涨 5 天以上' },
  busy: { name: '手速选手', desc: '几乎天天动手，买了 30 次以上' },
  follower: { name: '群聊信徒', desc: '买的七成以上是群友推荐的' },
  one_theme: { name: '一根筋', desc: '同一个风口同时拿 3 只' },
  card: { name: '信用卡战士', desc: '靠信用卡垫过 2 次以上' },
  limitup: { name: '涨停收藏家', desc: '一局里 10 天以上手里有涨停' },
  spread: { name: '雨露均沾', desc: '同时拿着 4 个风口的股票' },
  patient: { name: '慢工细活', desc: '一局只买了 6 次以内' },
  plain: { name: '普通上班族', desc: '没什么特别的，稳稳当当打完一局' },
};

/** 平台称号墙读的 /games/kaipan/titles.json */
export function titlesJson(): Record<string, { name: string; desc: string }> {
  const out: Record<string, { name: string; desc: string }> = {};
  for (const [name, t] of Object.entries(END_TITLES)) out[t.id] = { name, desc: t.desc };
  for (const [id, t] of Object.entries(STYLE_TITLES)) out[`s_${id}`] = { name: t.name, desc: t.desc };
  return out;
}

/**
 * 一局实盘的小结：1 局；资产涨了算赢；最大一把 = 结回 − 带入（亏了为 0）；称号 = 结局称号 + 打法；
 * 自定义数：bp（资产倍数，万分之几，取历史最大）、limitup（涨停天数，累加）。
 * quit：提前收手（0.6.8）——不是结局，不给结局称号（第 1 个月收手不该叫"新韭菜"），只报打法称号。
 */
export function liveSettleStats(sum: Readonly<RunSummary>, stake: number, bp: number, quit = false): SettleStats {
  const titles = [quit ? undefined : END_TITLES[sum.title]?.id, STYLE_TITLES[sum.style.id] ? `s_${sum.style.id}` : undefined].filter((x): x is string => !!x);
  return {
    rounds: 1,
    wins: bp > 10_000 ? 1 : 0,
    best: Math.max(0, liveReturn(stake, bp) - stake),
    titles,
    max: { bp },
    sum: { limitup: Math.max(0, Math.trunc(sum.limitUpDays)) },
  };
}
