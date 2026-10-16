/**
 * 0.10.0 配平（仓库根 docs/balance.md）：小白、普通两个玩家模型在实盘各档、娱乐三档下的结果，和一局大概多久。
 * `npm run sim -- --balance --runs 2000` 打出第 6 节那张对照表；docs/design-live.md 第 3 节、design-balance 的数都从这里来。
 * 真实行情、段按局号均匀覆盖（和 tools/live.ts 一样），仓位 / 押跌 / 抵押都开，新手人设。
 */
import { BALANCE, LIVE_TIERS, shortSetup, type LiveTier } from '../src/core/index.ts';
import { botByName, playRun } from './bots.ts';
import { liveStats, timed, useLiveMarket, type LiveStats } from './live.ts';

export interface EntStats {
  level: number;
  bot: string;
  runs: number;
  /** 达成最终目标（撑过 12 个月）的局占比 */
  win: number;
  /** 2 倍标准误 */
  se2: number;
  minutes: number;
}

/** 娱乐局：某一难度、某个机器人打 runs 局，达成最终目标（撑到最后一个月）的比例；short 是 0.10.0 的短局 */
export function entStats(level: number, bot: string, runs: number, prefix = 'ent', short = false): EntStats {
  useLiveMarket(prefix);
  const t = timed(botByName(bot)());
  let won = 0;
  let sec = 0;
  for (let i = 0; i < runs; i++) {
    t.reset();
    const end = playRun(`${prefix}-${i}`, t.bot, short ? shortSetup('newbie', level) : { persona: 'newbie', difficulty: level });
    if (end.phase === 'won') won++;
    sec += t.seconds();
  }
  const win = won / runs;
  return { level, bot, runs, win, se2: 2 * Math.sqrt((win * (1 - win)) / runs), minutes: sec / runs / 60 };
}

/** 第 2、4 节的目标（实盘，单位：份，按结回倍数写：1 = 不赚不亏） */
export const LIVE_TARGET: Record<LiveTier, Record<'xiaobai' | 'putong', [number, number]>> = {
  small: { xiaobai: [1.05, 1.15], putong: [1.2, 1.4] },
  mid: { xiaobai: [0.95, 1.05], putong: [1.1, 1.2] },
  big: { xiaobai: [0.8, 0.9], putong: [1, 1.1] },
  lux: { xiaobai: [-Infinity, 0.8], putong: [0.95, 1.05] },
};

/** 第 3 节：娱乐三档（难度 1–3）达成最终目标的比例 */
export const ENT_TARGET: Record<number, { name: string } & Record<'xiaobai' | 'putong', [number, number]>> = {
  1: { name: '新手', xiaobai: [0.6, Infinity], putong: [0.75, Infinity] },
  2: { name: '普通', xiaobai: [0.4, 0.5], putong: [0.55, 0.65] },
  3: { name: '高手', xiaobai: [-Infinity, 0.3], putong: [0.4, 0.5] },
};

const MODELS = ['xiaobai', 'putong'] as const;
const NAME = { xiaobai: '小白', putong: '普通' } as const;

const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
const share = (x: number): string => (x - 1 >= 0 ? `+${(x - 1).toFixed(2)}` : (x - 1).toFixed(2));
function range([lo, hi]: [number, number], f: (x: number) => string): string {
  if (lo === -Infinity) return `≤ ${f(hi)}`;
  if (hi === Infinity) return `≥ ${f(lo)}`;
  return `${f(lo)} ～ ${f(hi)}`;
}
const ok = (x: number, [lo, hi]: [number, number]): string => (x >= lo && x <= hi ? '✓' : '✗');

/** 0.11.0 杠杆的目标（小档，每场期望（份））；中、大、豪华档按逐档变难同比往下，不另设区间 */
const GEAR_TARGET: Record<number, Record<(typeof MODELS)[number], [number, number]>> = {
  1: { xiaobai: [1.05, 1.15], putong: [1.25, 1.35] },
  2: { xiaobai: [0.95, 1.05], putong: [1.4, 1.5] },
  3: { xiaobai: [0.75, 0.9], putong: [1.55, 1.7] },
};

/** 0.11.0 杠杆表：每档 × 模型 × 杠杆，均值 ± 2SE、中位数、≥ 3 倍、≥ 5 倍、结回 0（其中跌到清零线的） */
export function gearTable(runs: number): void {
  console.log(`实盘杠杆（每格 ${runs} 局，种子 bal-*；目标只给小档）\n`);
  console.log('| 档位 | 模型 | 杠杆 | 每场期望（份）± 2SE | 目标 | 中位数 | ≥ 3 倍 | ≥ 5 倍 | 结回 0 | 其中清零线 |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const t of LIVE_TIERS) {
    for (const m of MODELS) {
      for (const x of [1, 2, 3]) {
        const r = liveStats(t.id, m, runs, 'bal', 'newbie', x);
        const tg = t.id === 'small' ? GEAR_TARGET[x]![m] : null;
        console.log(
          `| ${t.name} | ${NAME[m]} | ×${x} | ${share(r.mean)} ± ${(2 * r.se).toFixed(3)}${tg ? ` ${ok(r.mean, tg)}` : ''} | ${tg ? range(tg, share) : '—'} | ${r.p50.toFixed(2)} | ${pct(r.x3)} | ${pct(r.x5)} | ${pct(r.zero)} | ${pct(r.margin)} |`,
        );
      }
    }
  }
}

/** 打出第 6 节的对照表（Markdown，直接贴进 PR 和设计稿） */
export function balanceTable(runs: number): void {
  const live = new Map<string, LiveStats & { minutes: number }>();
  console.log(`实盘（每格 ${runs} 局，种子 bal-*；结回减 1 就是"每场期望（份）"）\n`);
  console.log('| 档位 | 模型 | 每场期望（份）± 2SE | 目标 | 中位数 | 赚的局 | 结回 0 | 约几分钟 |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const t of LIVE_TIERS) {
    for (const m of MODELS) {
      const r = liveStats(t.id, m, runs, 'bal');
      live.set(`${t.id}|${m}`, r);
      const tg = LIVE_TARGET[t.id][m];
      console.log(
        `| ${t.name} | ${NAME[m]} | ${share(r.mean)} ± ${(2 * r.se).toFixed(3)} ${ok(r.mean, tg)} | ${range(tg, share)} | ${r.p50.toFixed(2)} | ${pct(r.up)} | ${pct(r.zero)} | ${r.minutes.toFixed(1)} |`,
      );
    }
  }
  const sx = live.get('small|xiaobai') as LiveStats & { minutes: number };
  const sp = live.get('small|putong') as LiveStats & { minutes: number };
  console.log(
    `\n第 4 节（小档）：中位数 小白 ${sx.p50.toFixed(2)}（≥ 1.0）${sx.p50 >= 1 ? '✓' : '✗'}、普通 ${sp.p50.toFixed(2)}（≥ 1.25）${sp.p50 >= 1.25 ? '✓' : '✗'}；` +
      `结回 0 小白 ${pct(sx.zero)}（≤ 15%）、普通 ${pct(sp.zero)}（≤ 5%）；小白赚的局 ${pct(sx.up)}（≥ 50%）`,
  );
  console.log(`小档普通每小时：${((sp.mean - 1) * (60 / sp.minutes)).toFixed(2)} 份（一局约 ${sp.minutes.toFixed(1)} 分钟）`);

  console.log(`\n娱乐（达成最终目标 = 撑到最后一个月还完账单；每格 ${runs} 局，种子 bal-*）\n`);
  console.log('| 一局 | 难度 | 模型 | 胜率 ± 2SE | 目标 | 约几分钟 |');
  console.log('|---|---|---|---|---|---|');
  for (const short of [true, false]) {
    for (const lv of [1, 2, 3]) {
      const tg = ENT_TARGET[lv] as (typeof ENT_TARGET)[number];
      for (const m of MODELS) {
        const r = entStats(lv, m, runs, 'bal', short);
        const len = short ? `短局 ${BALANCE.short.months} 个月` : '完整一年';
        console.log(`| ${len} | ${tg.name} | ${NAME[m]} | ${pct(r.win)} ± ${pct(r.se2)} ${ok(r.win, tg[m])} | ${range(tg[m], pct)} | ${r.minutes.toFixed(1)} |`);
      }
    }
  }
}
