/**
 * 数值模拟：让机器人各玩 N 局，输出通关率、出局月份、爽点频率等，并按设计稿第 11 节一键验收。
 *
 *   node tools/sim.ts                                   默认机器人各 500 局
 *   node tools/sim.ts --runs 2000 --bots normal,smart   指定机器人与局数
 *   node tools/sim.ts --detail                          附带买入阶段收益、持仓集中度、道具组合
 *   node tools/sim.ts --accept --runs 2000              第 11 节 8 项验收（含道具价值，较慢）
 *   node tools/sim.ts --accept --skip-value             8 项验收但跳过道具价值
 *   node tools/sim.ts --accept --part a|b               验收拆成两半分给两个进程（a：1/2/3/5/6/7/8，b：4 道具价值）
 *   --value-runs N                                        验收里道具价值那一项单独的局数（缺省同 --runs）
 *   node tools/sim.ts --value --runs 2000 [--value-bot smart] [--only a,b]   道具价值：开局即持有 vs 基线
 *   node tools/sim.ts --market                          行情诊断：各阶段天数、各角色涨停率
 *   node tools/sim.ts --mention                         消息诊断：拐点日被聊到的概率、说中率、拐点说法占比
 *   node tools/sim.ts --list                            列出机器人
 *   node tools/sim.ts --set bills.growth=1.4 --set heat.coef=0.35   临时覆盖数值（可多次）
 *   --seed 前缀                                          种子前缀（默认 sim）
 *   --difficulty N / --persona id                         所有模拟都用这个难度（1..8）/ 人设（缺省 1 / newbie）
 *   node tools/sim.ts --diff-table --runs 2000 [--levels 1,3]   难度表：1..8 级（或只跑 --levels 列的几级）normal / smart / oracle 的通关率与验收（第 5 节）
 *   node tools/sim.ts --personas --runs 2000             人设表：第 1 级 5 个人设的 normal / smart 通关率与验收（第 4 节）
 *   node tools/sim.ts --daily --runs 300                 每日挑战：按日期跑 normal / smart（成就"每日打卡"等）
 *   --ach                                                 结束时附带本进程所有模拟局的成就达成率（按机器人 × 难度汇总）
 *   --real                                                真实行情（按种子抽行情段）；--segment <id> 所有局用这一段
 *   --ext                                                 打开仓位、押跌、抵押（正式游戏都开）
 *   node tools/sim.ts --real-table --runs 520 [--per-segment]   真实行情难度表 + 各市况通关率（各段均匀覆盖）
 *   node tools/sim.ts --live --runs 540 [--bots normal,random] [--tiers small,mid] [--persona id]
 *                                                         0.6.0 实盘：各档、各机器人的结回倍数分布（设计稿 docs/design-live.md 第 3.3 节）
 *   node tools/sim.ts --balance --runs 2000              0.10.0 配平：小白 / 普通在实盘四档、娱乐三档的结果和一局约几分钟（仓库根 docs/balance.md 第 6 节的表）
 */
import {
  ACHIEVEMENTS,
  BALANCE,
  FRIENDS,
  ITEMS,
  MONTHS,
  PERSONAS,
  STAGES,
  achievementsOf,
  baseBill,
  createRun,
  dailySetup,
  dirOf,
  dispatch,
  effectiveDH,
  isBusy,
  rngFor,
  stockById,
  turnOf,
  type GameState,
  type LiveTier,
  type PersonaId,
  type RunSetup,
  type Segment,
  type Stage,
} from '../src/core/index.ts';
import { balanceTable } from './balance.ts';
import { liveStats } from './live.ts';
import { ARCHETYPES, BOT_DESC, BOTS, botByName, playRun, setRealMsg, useExt, useMarket, type Bot, type BotFactory } from './bots.ts';
import { loadSegment, segmentForSeed, segmentIndex } from './segments-disk.ts';

/** --real：真实行情（按种子抽行情段，和画面层一样）；--segment id：所有局都用这一段。缺省是 0.3 的合成行情。 */
const REAL = process.argv.includes('--real') || process.argv.includes('--segment');
/** 0.4 C：打开仓位、押跌、抵押（正式游戏都开） */
const EXT = process.argv.includes('--ext');
const FORCED = (() => {
  const i = process.argv.indexOf('--segment');
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
})();
function segOf(seed: string): Segment | null {
  if (!REAL) return null;
  return FORCED ? loadSegment(FORCED) : segmentForSeed(seed);
}
useMarket(REAL ? segOf : null);

const DEFAULT_BOTS = ['random', 'follower', 'chaser', 'normal', 'smart', 'oracle'];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

export interface RunRec {
  seed: string;
  won: boolean;
  /** 出局的月份（通关为 null） */
  deathMonth: number | null;
  account: number;
  peak: number;
  days: number;
  activeDays: number;
  /** 单日最多操作数（买 + 卖） */
  maxOps: number;
  /** 操作超过 2 次的交易日数 */
  busyDays: number;
  limitUpDays: number;
  maxBoards: number;
  chains: number;
  items: string[];
  /** 每笔交易：[买入时阶段, 持有收益] */
  trades: [Stage, number][];
  /** 持仓全在同一个题材的交易日占比 */
  focusDays: number;
  /** 持仓分布在 3 个及以上题材的交易日占比 */
  spreadDays: number;
  /** 本局达成的成就 */
  ach: string[];
}

/** 命令行给的人设 / 难度，所有模拟都套上。 */
function baseSetup(): RunSetup | null {
  const out: RunSetup = {};
  const d = arg('difficulty');
  const p = arg('persona');
  if (d !== undefined) out.difficulty = Number(d);
  if (p !== undefined) out.persona = p as PersonaId;
  return Object.keys(out).length > 0 ? out : null;
}

/** 成就统计：键为"机器人 · 难度"，值为 [局数, 各成就达成局数]。 */
const ACH = new Map<string, { runs: number; hits: Map<string, number> }>();

function noteAch(key: string, rs: readonly RunRec[]): void {
  const a = ACH.get(key) ?? { runs: 0, hits: new Map<string, number>() };
  a.runs += rs.length;
  for (const r of rs) for (const id of r.ach) a.hits.set(id, (a.hits.get(id) ?? 0) + 1);
  ACH.set(key, a);
}

function simulate(bot: Bot | BotFactory, runs: number, prefix: string, setup0: RunSetup | null = null, seedOf?: (i: number) => { seed: string; setup: RunSetup }): RunRec[] {
  const out: RunRec[] = [];
  const base = baseSetup();
  const setupMerged: RunSetup | null = base || setup0 ? { ...(base ?? {}), ...(setup0 ?? {}) } : null;
  for (let i = 0; i < runs; i++) {
    const daily = seedOf?.(i);
    const seed = daily?.seed ?? `${prefix}-${i}`;
    const setup = daily?.setup ?? setupMerged;
    let ops = 0;
    let maxOps = 0;
    let busyDays = 0;
    let focusDays = 0;
    let spreadDays = 0;
    const final: GameState = playRun(seed, bot, setup, (state, _events, action) => {
      if (action.type === 'buy' || action.type === 'sell') ops += 1;
      if (action.type === 'open') {
        maxOps = Math.max(maxOps, ops);
        if (ops > 2) busyDays += 1;
        ops = 0;
        const themes = new Set<string>();
        let n = 0;
        for (const h of state.lastDay?.holdings ?? []) {
          themes.add(stockById(h.stockId).theme);
          n += 1;
        }
        if (n >= 2 && themes.size === 1) focusDays += 1;
        if (themes.size >= 3) spreadDays += 1;
      }
    });
    const trades: [Stage, number][] = final.stats.trades.map((t) => [t.stage, t.ret]);
    for (const h of final.slots) if (h) trades.push([h.buyStage, (h.value - 1) * 100]);
    out.push({
      seed,
      won: final.phase === 'won',
      deathMonth: final.phase === 'won' ? null : final.month,
      account: final.account,
      peak: final.stats.peakAccount,
      days: final.stats.days,
      activeDays: final.stats.activeDays,
      maxOps,
      busyDays,
      limitUpDays: final.stats.limitUpDays,
      maxBoards: final.stats.maxBoards,
      chains: final.stats.chains,
      items: [...final.items].sort(),
      trades,
      focusDays: focusDays / Math.max(1, final.stats.days),
      spreadDays: spreadDays / Math.max(1, final.stats.days),
      ach: achievementsOf(final),
    });
  }
  return out;
}

// ---------------------------------------------------------------- 统计

function pct(n: number, total: number, digits = 1): string {
  return `${((n / Math.max(1, total)) * 100).toFixed(digits)}%`;
}

function mean(xs: readonly number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)] as number;
}

function pad(s: string | number, n: number): string {
  const str = String(s);
  const width = [...str].reduce((w, ch) => w + (ch.charCodeAt(0) > 0x2e80 ? 2 : 1), 0);
  return str + ' '.repeat(Math.max(0, n - width));
}

function winRate(rs: readonly RunRec[]): number {
  return rs.filter((r) => r.won).length / Math.max(1, rs.length);
}

function deathsByMonth(rs: readonly RunRec[]): number[] {
  const d = new Array<number>(MONTHS + 1).fill(0);
  for (const r of rs) if (r.deathMonth !== null) d[r.deathMonth] = (d[r.deathMonth] ?? 0) + 1;
  return d;
}

function thrills(rs: readonly RunRec[]): { limitUp: number; boards3: number; chain: number } {
  let lu = 0;
  let days = 0;
  for (const r of rs) {
    lu += r.limitUpDays;
    days += r.days;
  }
  return {
    limitUp: lu / Math.max(1, days),
    boards3: rs.filter((r) => r.maxBoards >= 3).length / Math.max(1, rs.length),
    chain: rs.filter((r) => r.chains > 0).length / Math.max(1, rs.length),
  };
}

function stageReturns(rs: readonly RunRec[]): Map<Stage, number[]> {
  const m = new Map<Stage, number[]>();
  for (const s of STAGES) m.set(s, []);
  for (const r of rs) for (const [stage, ret] of r.trades) m.get(stage)?.push(ret);
  return m;
}

function report(name: string, rs: readonly RunRec[], ms: number): void {
  const deaths = deathsByMonth(rs);
  const dead = rs.length - rs.filter((r) => r.won).length;
  const th = thrills(rs);
  const days = rs.reduce((a, r) => a + r.days, 0);
  const active = rs.reduce((a, r) => a + r.activeDays, 0);
  const wins = rs.filter((r) => r.won);
  console.log(
    `${pad(name, 13)} 通关 ${pad(pct(wins.length, rs.length), 6)} 局数 ${rs.length}  ` +
      `通关账户中位 ¥${Math.round(median(wins.map((r) => r.account)) / 1000)}k  峰值中位 ¥${Math.round(median(rs.map((r) => r.peak)) / 1000)}k  ` +
      `交易日活跃 ${pct(active, days, 0)}  最多操作/日 ${Math.max(0, ...rs.map((r) => r.maxOps))}  （${(ms / 1000).toFixed(1)}s）`,
  );
  console.log(`  出局月份（占出局）：${deaths.slice(1).map((d, i) => `${i + 1}月 ${pct(d, dead, 0)}`).join(' ')}`);
  console.log(`  爽点：涨停日 ${pct(th.limitUp, 1)}  3 连板以上的局 ${pct(th.boards3, 1)}  龙头带动的局 ${pct(th.chain, 1)}`);
}

function detail(name: string, rs: readonly RunRec[]): void {
  const sr = stageReturns(rs);
  console.log(`  ${name} 买入阶段 → 平均持有收益：${STAGES.map((s) => `${s} ${mean(sr.get(s) ?? []).toFixed(1)}%（${(sr.get(s) ?? []).length}）`).join('  ')}`);
  console.log(`  持仓集中（单题材）日 ${pct(mean(rs.map((r) => r.focusDays)), 1)}，分散（≥3 题材）日 ${pct(mean(rs.map((r) => r.spreadDays)), 1)}`);
  const combos = topCombos(rs.filter((r) => r.won));
  console.log(`  通关局最常见的道具组合：${combos.slice(0, 3).map(([k, n]) => `[${k || '无'}] ${pct(n, rs.filter((r) => r.won).length)}`).join('  ')}`);
}

function topCombos(rs: readonly RunRec[]): [string, number][] {
  const count = new Map<string, number>();
  for (const r of rs) {
    const key = r.items.join('+');
    count.set(key, (count.get(key) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]);
}

// ---------------------------------------------------------------- 覆盖与诊断

/** 应用 --set a.b.c=值（可多次），直接修改 BALANCE；只影响本次模拟。 */
export function applyOverrides(): string[] {
  const applied: string[] = [];
  process.argv.forEach((a, i) => {
    if (a !== '--set') return;
    const spec = process.argv[i + 1] ?? '';
    const eq = spec.indexOf('=');
    const keys = spec.slice(0, eq).split('.');
    const value: unknown = JSON.parse(spec.slice(eq + 1));
    let obj = BALANCE as unknown as Record<string, unknown>;
    for (const k of keys.slice(0, -1)) obj = obj[k] as Record<string, unknown>;
    const last = keys[keys.length - 1] as string;
    if (eq < 0 || !obj || !(last in obj)) throw new Error(`无效的 --set：${spec}`);
    obj[last] = value;
    applied.push(spec);
  });
  if (applied.length) console.log(`覆盖：${applied.join('  ')}`);
  return applied;
}

/** 消息诊断：每天盘前统计各题材在拐点（start/top/ebb/fizzle）和非拐点日被聊到的概率、消息说中率、拐点说法的占比。 */
function mentionReport(runs: number, prefix: string): void {
  const c = new Map<string, [number, number]>();
  const add = (k: string, hit: boolean): void => {
    const x = c.get(k) ?? [0, 0];
    x[0] += hit ? 1 : 0;
    x[1] += 1;
    c.set(k, x);
  };
  for (let i = 0; i < runs; i++) {
    const seed = `${prefix}-${i}`;
    const bot = botByName('normal')();
    const rng = rngFor(seed, 'bot', bot.name);
    let s = createRun(seed, null, { segment: segOf(seed) }).state;
    let last = -1;
    for (let k = 0; k < 2000 && s.phase !== 'won' && s.phase !== 'lost'; k++) {
      if (s.phase === 'premarket' && s.today.day !== last) {
        last = s.today.day;
        for (const id of s.themeIds) {
          const t = s.themes[id];
          if (t) add(`被聊到 ${turnOf(t) ?? 'none'}`, s.today.messages.some((m) => m.theme === id));
        }
        for (const m of s.today.messages) {
          const t = s.themes[m.theme];
          if (!t) continue;
          const kind = turnOf(t) ?? 'none';
          add(`说中 ${kind}`, dirOf(effectiveDH(t.heat, s.today.plan.dH[m.theme] ?? 0)) === m.claim);
          add(`拐点说法 ${kind}`, m.turn !== undefined);
        }
      }
      let a = bot.act(s, rng);
      if (isBusy(s) && (a.type === 'buy' || a.type === 'sell')) a = { type: 'open' };
      s = dispatch(s, a, { inPlace: true }).state;
    }
  }
  console.log(`消息诊断（normal 各 ${runs} 局，统计盘前）`);
  for (const [k, [h, n]] of [...c.entries()].sort()) console.log(`  ${pad(k, 18)}${pct(h, n)}（${n}）`);
  const p = (k: string): number => {
    const x = c.get(k) ?? [0, 1];
    return x[0] / Math.max(1, x[1]);
  };
  const base = p('被聊到 none');
  for (const kind of ['start', 'top', 'ebb']) console.log(`  拐点 ${kind} 被聊到的概率是平时的 ${(p(`被聊到 ${kind}`) / base).toFixed(2)} 倍`);
}

/** 行情诊断：用一个不操作的机器人跑行情，统计各阶段天数、各角色在各阶段的涨跌和涨停率。 */
function marketReport(runs: number, prefix: string): void {
  const stageDays = new Map<Stage, number>();
  const roleStage = new Map<string, { n: number; sum: number; up: number; down: number }>();
  let heatSum = 0;
  let heatN = 0;
  const idle: Bot = { name: 'idle', act: (s) => (s.phase === 'premarket' ? { type: 'open' } : s.phase === 'reward' ? { type: 'skipReward' } : { type: 'choose', option: 1 }) };
  for (let i = 0; i < runs; i++) {
    let s = createRun(`${prefix}-mkt-${i}`, { account: 1e12 }, { segment: segOf(`${prefix}-mkt-${i}`) }).state;
    while (s.phase !== 'won' && s.phase !== 'lost') {
      s = dispatch(s, idle.act(s, null as never), { events: false, inPlace: true }).state;
      const r = s.lastDay;
      if (!r || s.phase !== 'premarket' || s.today.ops !== 0 || r.day !== s.dayIndex - 1) continue;
      for (const t of r.themes) {
        stageDays.set(t.stage, (stageDays.get(t.stage) ?? 0) + 1);
        heatSum += t.heat;
        heatN += 1;
      }
      const stageOf = new Map(r.themes.map((t) => [t.id, t.stage]));
      for (const m of r.stocks) {
        const def = stockById(m.id);
        const key = `${def.role}|${stageOf.get(def.theme)}`;
        const a = roleStage.get(key) ?? { n: 0, sum: 0, up: 0, down: 0 };
        a.n += 1;
        a.sum += m.move;
        if (m.limitUp) a.up += 1;
        if (m.limitDown) a.down += 1;
        roleStage.set(key, a);
      }
    }
  }
  const total = [...stageDays.values()].reduce((a, b) => a + b, 0);
  console.log(`各阶段占比：${STAGES.map((s) => `${s} ${pct(stageDays.get(s) ?? 0, total)}`).join(' ')}  平均热度 ${(heatSum / Math.max(1, heatN)).toFixed(1)}`);
  for (const role of ['leader', 'follower', 'bluechip', 'meme', 'st']) {
    console.log(
      `  ${pad(role, 9)}` +
        STAGES.map((s) => {
          const a = roleStage.get(`${role}|${s}`);
          if (!a) return `${s} -`;
          return `${s} ${(a.sum / a.n).toFixed(1)} 涨停${pct(a.up, a.n, 0)}`;
        }).join(' | '),
    );
  }
  console.log(`  月供：${Array.from({ length: MONTHS }, (_, m) => `${m + 1}月 ¥${(baseBill(m + 1) / 1000).toFixed(1)}k`).join(' ')}`);
}

// ---------------------------------------------------------------- 道具价值

function itemValue(runs: number, prefix: string, botName: string): { base: number; rows: { id: string; win: number }[] } {
  const bot = botByName(botName);
  const only = arg('only')?.split(',').filter(Boolean);
  const base = winRate(simulate(bot, runs, `${prefix}-value`));
  console.log(`\n道具价值（${botName} 开局持有该道具，各 ${runs} 局；基线通关 ${pct(base, 1)}）`);
  const rows: { id: string; win: number }[] = [];
  for (const d of ITEMS) {
    if (only && !only.includes(d.id)) continue;
    const win = winRate(simulate(bot, runs, `${prefix}-value`, { items: [d.id] }));
    rows.push({ id: d.id, win });
    const delta = (win - base) * 100;
    console.log(
      `  ${pad(d.name, 14)}${pad(d.id, 12)}${pad(d.rarity, 9)}通关 ${pad(pct(win, 1), 7)}（${delta >= 0 ? '+' : ''}${delta.toFixed(1)}pp）${Math.abs(delta) <= 10 ? '' : '  ← 超出 ±10pp'}`,
    );
  }
  return { base, rows };
}

// ---------------------------------------------------------------- 验收

/** 无脑跟某个群友：买他推荐的，他说哪个题材跌就卖哪个。 */
function followFriend(friendId: string): BotFactory {
  return () => ({
    name: `follow-${friendId}`,
    act(s) {
      if (s.phase === 'reward') {
        const i = (s.reward?.cards ?? []).findIndex((c) => c.kind !== 'stock');
        return i >= 0 ? { type: 'pickReward', index: i } : { type: 'skipReward' };
      }
      if (s.phase === 'event') return { type: 'choose', option: 0 };
      const down = new Set(s.today.messages.filter((m) => m.friendId === friendId && m.claim === 'down').map((m) => m.theme));
      for (let i = 0; i < s.slots.length; i++) {
        const h = s.slots[i];
        if (h && h.boughtDay < s.today.day && down.has(stockById(h.stockId).theme)) return { type: 'sell', slot: i };
      }
      const rec = s.today.recs.findIndex((r) => r.friendId === friendId && !r.taken && !s.slots.some((h) => h?.stockId === r.stockId));
      if (rec >= 0 && s.today.buysLeft > 0) {
        const e = s.slots.findIndex((h) => h === null);
        if (e >= 0) return { type: 'buy', rec, slot: e };
        const sellable = s.slots.findIndex((h) => h !== null && h.boughtDay < s.today.day);
        if (sellable >= 0) return { type: 'buy', rec, slot: sellable };
      }
      return { type: 'open' };
    },
  });
}

function accept(runs: number, prefix: string): void {
  const part = arg('part');
  const t0 = performance.now();
  const rows: [string, string, boolean | null][] = [];
  const doValue = part !== 'a' && !flag('skip-value');
  const doMain = part !== 'b';
  const sims: Record<string, RunRec[]> = {};
  const run = (name: string, factory: BotFactory, setup: RunSetup | null = null): RunRec[] => {
    const t = performance.now();
    const rs = simulate(factory, runs, prefix, setup);
    sims[name] = rs;
    if (!setup) noteAch(`${name} · L${baseSetup()?.difficulty ?? 1}`, rs);
    report(name, rs, performance.now() - t);
    return rs;
  };
  const w = (n: string): number => winRate(sims[n] ?? []) * 100;

  if (doMain) {
    for (const name of ['random', 'follower', 'chaser', 'normal', 'smart', 'oracle', 'smart-focus2', 'smart-spread', 'smart-focus1', 'smart-spread1']) {
      run(name, botByName(name));
    }
    run('smart-nochat', botByName('smart'), { noChat: true });
    run('smart-nomsg', botByName('smart-nomsg'));
    run('normal-nomsg', botByName('normal-nomsg'));
    for (const f of FRIENDS.filter((d) => d.founding)) run(`follow-${f.id}`, followFriend(f.id));

    // 1 技能曲线
    const wn = w('normal');
    const ok1 =
      wn >= 35 && wn <= 50 && w('smart') >= wn + 15 && w('chaser') <= wn - 10 && w('follower') <= 10 && w('random') <= 3 && w('oracle') >= 95;
    rows.push([
      '1 技能曲线',
      `random ${w('random').toFixed(1)}% / follower ${w('follower').toFixed(1)}% / chaser ${w('chaser').toFixed(1)}% / normal ${wn.toFixed(1)}% / smart ${w('smart').toFixed(1)}% / oracle ${w('oracle').toFixed(1)}%`,
      ok1,
    ]);

    // 2 择时有意义
    const sr = stageReturns(sims.smart ?? []);
    const early = [...(sr.get('sprout') ?? []), ...(sr.get('ferment') ?? [])];
    const climax = sr.get('climax') ?? [];
    const gap = mean(early) - mean(climax);
    rows.push([
      '2 择时有意义',
      `smart 萌芽/发酵买入平均持有收益 ${mean(early).toFixed(1)}%（${early.length} 笔），高潮买入 ${mean(climax).toFixed(1)}%（${climax.length} 笔），差 ${gap.toFixed(1)}pp`,
      gap >= 5 && early.length >= 100 && climax.length >= 30,
    ]);

    // 3 集中与分散：集中 = 同一时间最多 1–2 个题材的最佳策略（focus1、focus2 取高）
    const focusName = w('smart-focus1') > w('smart-focus2') ? 'smart-focus1' : 'smart-focus2';
    const wf = w(focusName);
    const ws = w('smart-spread');
    const f = sims[focusName] ?? [];
    const sp = sims['smart-spread'] ?? [];
    rows.push([
      '3 集中与分散',
      `集中最佳 ${focusName} ${wf.toFixed(1)}%（单题材持仓日 ${pct(mean(f.map((r) => r.focusDays)), 1)}）/ 分散 ${ws.toFixed(1)}%（≥3 题材日 ${pct(mean(sp.map((r) => r.spreadDays)), 1)}），差 ${Math.abs(wf - ws).toFixed(1)}pp；参考：最多 2 个题材 ${w('smart-focus2').toFixed(1)}%、只拿 1 个题材 ${w('smart-focus1').toFixed(1)}%、每题材最多 1 只 ${w('smart-spread1').toFixed(1)}%`,
      Math.abs(wf - ws) <= 10,
    ]);

    // 4b 道具组合与流派（用 smart 系列与 normal 的通关局）
    const winners = ['smart', 'smart-focus2', 'smart-spread', 'normal'].flatMap((n) => (sims[n] ?? []).filter((r) => r.won));
    const combos = topCombos(winners);
    const top3 = combos.slice(0, 3).reduce((a, [, n]) => a + n, 0) / Math.max(1, winners.length);
    const arche = Object.entries(ARCHETYPES).map(([name, ids]) => [name, winners.filter((r) => ids.every((id) => r.items.includes(id))).length] as const);
    rows.push([
      '4 道具组合与流派',
      `通关局（${winners.length}）最常见 3 种组合合计 ${pct(top3, 1)}；流派通关局数 ${arche.map(([n, c]) => `${n} ${c}`).join('、')}`,
      top3 < 0.3 && arche.every(([, c]) => c > 0),
    ]);

    // 5 消息有用：关群聊 smart 降 ≥ 15pp；只关消息（保留推荐）normal 降 ≥ 8pp、smart 降 ≥ 4pp；无脑跟群主最低
    const drop = w('smart') - w('smart-nochat');
    const dropMsg = w('smart') - w('smart-nomsg');
    const dropMsgN = w('normal') - w('normal-nomsg');
    // 通关率相同（往往都接近 0）时按平均撑到的月份比
    const survive = (n: string): number => mean((sims[n] ?? []).map((r) => r.deathMonth ?? MONTHS + 1));
    const follows = FRIENDS.filter((d) => d.founding).map((d) => [d.id, w(`follow-${d.id}`), survive(`follow-${d.id}`)] as const);
    const lowest = follows.reduce((a, b) => (b[1] < a[1] || (b[1] === a[1] && b[2] < a[2]) ? b : a));
    rows.push([
      '5 消息有用',
      `关闭群聊 smart ${w('smart').toFixed(1)}% → ${w('smart-nochat').toFixed(1)}%（降 ${drop.toFixed(1)}pp）；只关消息 normal ${w('normal').toFixed(1)}% → ${w('normal-nomsg').toFixed(1)}%（降 ${dropMsgN.toFixed(1)}pp）、smart → ${w('smart-nomsg').toFixed(1)}%（降 ${dropMsg.toFixed(1)}pp）；无脑跟单（通关率/平均撑到月份）：${follows.map(([id, v, m]) => `${id} ${v.toFixed(1)}%/${m.toFixed(1)}`).join(' ')}`,
      drop >= 15 && dropMsgN >= 8 && dropMsg >= 4 && lowest[0] === 'qunzhu',
    ]);

    // 6 月供压力分布（比例按出局局数算）：单月 ≤ 35%，1–2 月 ≤ 8%
    const nr = sims.normal ?? [];
    const deaths = deathsByMonth(nr);
    const dead = nr.filter((r) => !r.won).length;
    const worst = Math.max(...deaths.slice(1));
    const early2 = (deaths[1] ?? 0) + (deaths[2] ?? 0);
    const early4 = early2 + (deaths[3] ?? 0) + (deaths[4] ?? 0);
    rows.push([
      '6 月供压力分布',
      `normal 出局 ${dead} 局；单月最多 ${pct(worst, dead)}（${deaths.indexOf(worst)} 月）；1–2 月出局 ${pct(early2, dead)}；参考：1–4 月累计 ${pct(early4, dead)}`,
      worst / Math.max(1, dead) <= 0.35 && early2 / Math.max(1, dead) <= 0.08,
    ]);

    // 7 决策密度
    const sm = sims.smart ?? [];
    const act = sm.reduce((a, r) => a + r.activeDays, 0) / Math.max(1, sm.reduce((a, r) => a + r.days, 0));
    const maxOps = Math.max(0, ...sm.map((r) => r.maxOps));
    rows.push(['7 决策密度', `smart 有买卖的交易日 ${pct(act, 1)}；单日最多操作 ${maxOps} 次`, act >= 0.5 && maxOps <= 2]);

    // 8 爽点频率
    const th = thrills(nr);
    rows.push([
      '8 爽点频率',
      `normal：持仓有涨停的交易日 ${pct(th.limitUp, 1)}；3 连板以上的局 ${pct(th.boards3, 1)}；触发龙头带动的局 ${pct(th.chain, 1)}`,
      th.limitUp >= 0.15 && th.limitUp <= 0.3 && th.boards3 >= 0.3 && th.chain >= 0.4,
    ]);
    if (flag('detail')) for (const n of ['normal', 'smart', 'smart-focus2', 'smart-spread', 'oracle']) detail(n, sims[n] ?? []);
  }

  if (doValue) {
    const v = itemValue(Number(arg('value-runs') ?? runs), prefix, arg('value-bot') ?? 'smart');
    const out = v.rows.filter((r) => Math.abs(r.win - v.base) > 0.1);
    const lo = v.rows.reduce((m, r) => Math.min(m, r.win - v.base), 0) * 100;
    const hi = v.rows.reduce((m, r) => Math.max(m, r.win - v.base), 0) * 100;
    rows.push([
      '4 道具价值',
      `基线 ${pct(v.base, 1)}；价值范围 ${lo.toFixed(1)}pp ~ +${hi.toFixed(1)}pp；超出 ±10pp：${out.map((r) => r.id).join('、') || '无'}`,
      out.length === 0,
    ]);
  }

  console.log(`\n验收（每组 ${runs} 局，种子前缀 ${prefix}，用时 ${((performance.now() - t0) / 1000).toFixed(0)}s）`);
  for (const [name, text, ok] of rows) console.log(`  ${ok === null ? '—' : ok ? '✓' : '✗'} ${pad(name, 16)}${text}`);
}

// ---------------------------------------------------------------- 难度表、人设表、每日挑战、成就

/** 难度表：1..8 级各跑 normal / smart / oracle（第 1 级新人），验收设计稿 release 第 5 节。 */
function diffTable(runs: number, prefix: string): void {
  const levels = (arg('levels') ?? '1,2,3,4,5,6,7,8').split(',').map(Number);
  const bots = (arg('bots') ?? 'normal,smart,oracle').split(',');
  const table = new Map<string, number[]>();
  const t0 = performance.now();
  for (const lv of levels) {
    for (const b of bots) {
      const t = performance.now();
      const rs = simulate(botByName(b), runs, prefix, { difficulty: lv });
      noteAch(`${b} · L${lv}`, rs);
      const w = winRate(rs) * 100;
      const row = table.get(b) ?? [];
      row.push(w);
      table.set(b, row);
      const dead = rs.filter((r) => !r.won).length;
      const deaths = deathsByMonth(rs);
      console.log(
        `  L${lv} ${pad(b, 8)}通关 ${w.toFixed(1)}%  出局最多的月 ${deaths.indexOf(Math.max(...deaths.slice(1)))} 月（${pct(Math.max(...deaths.slice(1)), dead, 0)}）（${((performance.now() - t) / 1000).toFixed(0)}s）`,
      );
    }
  }
  console.log(`\n难度表（各 ${runs} 局，各级用同一批种子 ${prefix}-*，用时 ${((performance.now() - t0) / 1000).toFixed(0)}s）`);
  console.log(`  ${pad('机器人', 9)}${levels.map((l) => pad(`L${l}`, 8)).join('')}`);
  for (const [b, row] of table) console.log(`  ${pad(b, 9)}${row.map((w) => pad(`${w.toFixed(1)}%`, 8)).join('')}`);
  const mono = (b: string): boolean => {
    const row = table.get(b) ?? [];
    return row.every((w, i) => i === 0 || w < (row[i - 1] as number));
  };
  const last = (b: string): number => (table.get(b) ?? []).at(-1) ?? NaN;
  if (levels.length === 8) {
    console.log(`  ${mono('normal') ? '✓' : '✗'} normal 随难度严格单调下降`);
    console.log(`  ${mono('smart') ? '✓' : '✗'} smart 随难度严格单调下降`);
    console.log(`  ${last('smart') < 15 ? '✓' : '✗'} 第 8 级 smart ${last('smart').toFixed(1)}% < 15%`);
    console.log(`  ${last('oracle') >= 50 ? '✓' : '✗'} 第 8 级 oracle ${last('oracle').toFixed(1)}% ≥ 50%`);
  }
}

/**
 * 真实行情难度表（0.4 重做）：每个难度 × 机器人各跑 runs 局，第 i 局用第 i % 段数 个行情段（所有段均匀覆盖），
 * 输出各难度通关率、各市况通关率。follower（买推荐第一只、从不卖）当"躺平"的参照：牛市段不能躺赢。
 */
function realTable(runs: number, prefix: string): void {
  const levels = (arg('levels') ?? '1,2,3,4,5,6,7,8').split(',').map(Number);
  const bots = (arg('bots') ?? 'normal,smart,oracle,follower').split(',');
  const segs = segmentIndex().segments;
  const bySeed = new Map<string, string>();
  for (let i = 0; i < runs; i++) bySeed.set(`${prefix}-${i}`, (segs[i % segs.length] as { id: string }).id);
  useMarket((seed) => loadSegment(bySeed.get(seed) ?? (segs[0] as { id: string }).id));
  const regimeOf = new Map(segs.map((x) => [x.id, loadSegment(x.id).regime]));
  const lv = new Map<string, number[]>();
  const rg = new Map<string, Map<string, [number, number]>>();
  const seg = new Map<string, Map<string, [number, number]>>();
  const t0 = performance.now();
  for (const level of levels) {
    for (const b of bots) {
      const rs = simulate(botByName(b), runs, prefix, { difficulty: level });
      noteAch(`${b} · real L${level}`, rs);
      const row = lv.get(b) ?? [];
      row.push(winRate(rs) * 100);
      lv.set(b, row);
      rs.forEach((r) => {
        const id = bySeed.get(r.seed) ?? '';
        const key = `${b}|${level === 1 ? 'L1' : 'all'}`;
        for (const k of level === 1 ? [key, `${b}|all`] : [key]) {
          const m = rg.get(k) ?? new Map<string, [number, number]>();
          const x = m.get(regimeOf.get(id) ?? '?') ?? [0, 0];
          x[0] += r.won ? 1 : 0;
          x[1] += 1;
          m.set(regimeOf.get(id) ?? '?', x);
          rg.set(k, m);
        }
        if (level === 1) {
          const m = seg.get(b) ?? new Map<string, [number, number]>();
          const x = m.get(id) ?? [0, 0];
          x[0] += r.won ? 1 : 0;
          x[1] += 1;
          m.set(id, x);
          seg.set(b, m);
        }
      });
    }
    console.log(`  L${level} 完成（${((performance.now() - t0) / 1000).toFixed(0)}s）`);
  }
  console.log(`\n真实行情难度表（每格 ${runs} 局，${segs.length} 段均匀覆盖，种子 ${prefix}-*）`);
  console.log(`  ${pad('机器人', 9)}${levels.map((l) => pad(`L${l}`, 8)).join('')}`);
  for (const [b, row] of lv) console.log(`  ${pad(b, 9)}${row.map((w) => pad(`${w.toFixed(1)}%`, 8)).join('')}`);
  const regimes = ['bull', 'bubble', 'flat', 'bear', 'crash'];
  for (const scope of ['L1', 'all']) {
    console.log(`\n各市况通关率（${scope === 'L1' ? '第 1 级' : '各难度合计'}）`);
    console.log(`  ${pad('市况', 9)}${bots.map((b) => pad(b, 10)).join('')}`);
    for (const r of regimes) {
      const cells = bots.map((b) => {
        const x = rg.get(`${b}|${scope}`)?.get(r) ?? [0, 0];
        return pad(x[1] > 0 ? `${((x[0] / x[1]) * 100).toFixed(1)}%` : '-', 10);
      });
      console.log(`  ${pad(r, 9)}${cells.join('')}`);
    }
  }
  if (flag('per-segment')) {
    console.log('\n各段第 1 级通关率');
    for (const x of segs) console.log(`  ${pad(x.id, 22)}${bots.map((b) => { const v = seg.get(b)?.get(x.id) ?? [0, 0]; return pad(`${((v[0] / Math.max(1, v[1])) * 100).toFixed(0)}%`, 8); }).join('')}`);
  }
}

/** 0.6.0 实盘表：各档 × 机器人的结回倍数（份）。段按局号均匀覆盖，各档、各机器人用同一批种子。 */
function liveTable(runs: number, prefix: string): void {
  const tiers = (arg('tiers') ?? 'small,mid,big,lux').split(',') as LiveTier[];
  const bots = (arg('bots') ?? 'normal,truster,smart,random,follower,heavy,gambler').split(',');
  const persona = (arg('persona') ?? 'newbie') as PersonaId;
  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
  console.log(`实盘（${BALANCE.live.months} 个月，各档账单和涨跌倍数见 BALANCE.live.tiers）结回倍数，每格 ${runs} 局，种子 ${prefix}-*，人设 ${persona}`);
  console.log(`  ${pad('档位', 8)}${pad('机器人', 10)}${pad('平均', 16)}${pad('赚的局', 9)}${pad('10%/50%/90%', 21)}${pad('结回0', 8)}${pad('0–2份内', 9)}封顶`);
  for (const tier of tiers) {
    for (const b of bots) {
      const r = liveStats(tier, b, runs, prefix, persona);
      console.log(
        `  ${pad(tier, 8)}${pad(b, 10)}${pad(`${r.mean.toFixed(3)} ± ${r.se.toFixed(3)}`, 16)}${pad(pct(r.up), 9)}` +
          `${pad(`${r.p10.toFixed(2)} / ${r.p50.toFixed(2)} / ${r.p90.toFixed(2)}`, 21)}${pad(pct(r.zero), 8)}${pad(pct(r.within), 9)}${pct(r.capped)}`,
      );
    }
  }
}

/** 人设表：第 1 级（或 --difficulty）5 个人设各跑 normal、smart，验收 release 第 4 节。 */
function personaTable(runs: number, prefix: string): void {
  const bots = (arg('bots') ?? 'normal,smart').split(',');
  const lv = Number(arg('difficulty') ?? 1);
  const res = new Map<string, Map<string, number>>();
  for (const p of PERSONAS) {
    const row = new Map<string, number>();
    for (const b of bots) {
      const t = performance.now();
      const rs = simulate(botByName(b), runs, `${prefix}-P`, { persona: p.id, difficulty: lv });
      noteAch(`${b} · L${lv} · ${p.id}`, rs);
      row.set(b, winRate(rs) * 100);
      report(`${b}/${p.id}`, rs, performance.now() - t);
    }
    res.set(p.id, row);
  }
  console.log(`\n人设表（第 ${lv} 级，各 ${runs} 局，种子前缀 ${prefix}-P）`);
  console.log(`  ${pad('人设', 10)}${bots.map((b) => pad(b, 10)).join('')}`);
  for (const [id, row] of res) console.log(`  ${pad(id, 10)}${bots.map((b) => pad(`${(row.get(b) ?? 0).toFixed(1)}%`, 10)).join('')}`);
  const n = (id: string): number => res.get(id)?.get('normal') ?? NaN;
  const starters = ['newbie', 'retiree', 'mom'].map(n);
  const spread = Math.max(...starters) - Math.min(...starters);
  console.log(`  ${spread <= 8 ? '✓' : '✗'} 开局三人设 normal 相差 ${spread.toFixed(1)}pp（≤ 8pp）`);
  const youziGap = Math.min(...starters) - n('youzi');
  console.log(`  ${youziGap >= 8 ? '✓' : '✗'} youzi normal ${n('youzi').toFixed(1)}%，比开局三人设最低的还低 ${youziGap.toFixed(1)}pp（明显更难）`);
  console.log(`  — coder normal ${n('coder').toFixed(1)}%`);
}

/** 每日挑战：从某天起连续 runs 天，按 dailySetup 跑。 */
function dailyRuns(runs: number): void {
  const start = Date.UTC(2026, 9, 10);
  const seedOf = (i: number): { seed: string; setup: RunSetup } => {
    const d = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
    const x = dailySetup(d);
    return { seed: x.seed, setup: x.setup };
  };
  for (const b of (arg('bots') ?? 'normal,smart').split(',')) {
    const t = performance.now();
    const rs = simulate(botByName(b), runs, 'daily', null, seedOf);
    noteAch(`${b} · daily`, rs);
    report(`${b}/daily`, rs, performance.now() - t);
  }
}

/** 本进程所有模拟局的成就达成率。 */
function achReport(): void {
  if (ACH.size === 0) return;
  const keys = [...ACH.keys()];
  console.log(`\n成就达成率（每列一组模拟，局数见表头）`);
  console.log(`  ${pad('成就', 22)}${keys.map((k) => pad(k, 22)).join('')}`);
  console.log(`  ${pad('（局数）', 22)}${keys.map((k) => pad(String(ACH.get(k)?.runs ?? 0), 22)).join('')}`);
  for (const d of ACHIEVEMENTS) {
    const cells = keys.map((k) => {
      const a = ACH.get(k);
      const h = a?.hits.get(d.id) ?? 0;
      return pad(`${pct(h, a?.runs ?? 1, 2)}（${h}）`, 22);
    });
    console.log(`  ${pad(`${d.tier[0]} ${d.id}`, 22)}${cells.join('')}`);
  }
}

// ---------------------------------------------------------------- 入口

function main(): void {
  applyOverrides();
  useExt(EXT);
  if (arg('real-msg') !== undefined) setRealMsg(Number(arg('real-msg')));
  const runs = Number(arg('runs') ?? 500);
  const prefix = arg('seed') ?? 'sim';
  if (flag('list')) {
    for (const [name, desc] of Object.entries(BOT_DESC)) console.log(`${pad(name, 14)}${desc}`);
    return;
  }
  if (flag('market')) {
    marketReport(Math.min(runs, 300), prefix);
    return;
  }
  if (flag('mention')) {
    mentionReport(Math.min(runs, 500), prefix);
    return;
  }
  if (flag('accept')) {
    accept(runs, prefix);
    if (flag('ach')) achReport();
    return;
  }
  if (flag('balance')) {
    balanceTable(runs);
    return;
  }
  if (flag('live')) {
    liveTable(runs, arg('seed') ?? 'live6');
    return;
  }
  if (flag('real-table')) {
    realTable(runs, prefix);
    if (flag('ach')) achReport();
    return;
  }
  if (flag('diff-table')) {
    diffTable(runs, prefix);
    if (flag('ach')) achReport();
    return;
  }
  if (flag('personas')) {
    personaTable(runs, prefix);
    if (flag('ach')) achReport();
    return;
  }
  if (flag('daily')) {
    dailyRuns(runs);
    if (flag('ach')) achReport();
    return;
  }
  if (flag('value')) {
    itemValue(runs, prefix, arg('value-bot') ?? 'smart');
    return;
  }
  const bots = (arg('bots') ?? DEFAULT_BOTS.join(',')).split(',').filter(Boolean);
  const setup: RunSetup | null = flag('nochat') ? { noChat: true } : null;
  for (const name of bots) {
    if (!BOTS[name]) throw new Error(`未知机器人：${name}`);
    const t = performance.now();
    const rs = simulate(botByName(name), runs, prefix, setup);
    noteAch(`${name} · L${baseSetup()?.difficulty ?? 1}`, rs);
    report(name, rs, performance.now() - t);
    if (flag('detail')) detail(name, rs);
  }
  if (flag('ach')) achReport();
}

main();
