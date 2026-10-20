/**
 * 斗地主单机实盘的模拟（docs/stake.md 第 10 节的数字从这里来）：量每档、每种电脑搭配下，"普通玩家"和"小白"每场的期望（单位：份）。
 *
 *   node tools/ddz-stake-sim.ts                          默认：每格 2000 场，6 种电脑搭配 × 2 种玩家，并行跑
 *   node tools/ddz-stake-sim.ts --matches 500 --me normal --bots normal,pro
 *   node tools/ddz-stake-sim.ts --table                  只量 DDZ_SOLO_BOTS 里每档用的搭配（四档 × 两种玩家）
 *
 * 玩家模型（斗地主没有 docs/balance.md 的现成模型，假设）：我坐 0 号，用电脑的 normal 档代打当"普通玩家"，novice 档当"小白"
 * （普通会拆牌、记公开信息、农民不压队友；新手贪心拆牌、叫分带噪声、该压时偶尔不压）。电脑坐 1、2 号，按给定的两档。
 * 一场用 DDZ_SOLO_OPTS（8 副，每副 s 封顶 24，一家累计到 ±40 分就结束），每场用不同的种子；输出每场净分换成份数
 * （分 ÷ 40）的均值、标准误、2 倍标准误上界、赢的比例（净分 > 0）、平均副数、一场碰到 ±40 封顶的比例。
 * 并行：每格拆成几段，每段一个子进程（--worker，结果从标准输出回传），合起来。
 */
import { spawn } from 'node:child_process';
import { createDdz, decideDdz, dispatchDdz, viewDdz, type DdzLevel } from '../src/variants/doudizhu/index.ts';
import { DDZ_SOLO_BOTS, DDZ_SOLO_OPTS, POINTS_PER_SHARE, TIER_IDS, type TierId } from '../src/variants/doudizhu/stake/index.ts';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : def;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

const LEVELS: readonly DdzLevel[] = ['novice', 'normal', 'pro'];
const NAME: Record<DdzLevel, string> = { novice: '新手', normal: '普通', pro: '高手' };

interface One {
  points: number;
  deals: number;
  capped: boolean;
}

/** 打一场；seed 区分每场 */
function playMatch(seed: string, me: DdzLevel, bots: readonly [DdzLevel, DdzLevel]): One {
  const levels: DdzLevel[] = [me, bots[0], bots[1]];
  let { state } = createDdz(seed, DDZ_SOLO_OPTS);
  for (let guard = 0; guard < 20_000; guard++) {
    if (state.phase === 'gameOver') break;
    if (state.phase === 'dealEnd') {
      state = dispatchDdz(state, { type: 'next' }).state;
      continue;
    }
    const seat = state.turn;
    const a = decideDdz(viewDdz(state, seat), levels[seat]!, `${seed}-ai${seat}`);
    if (!a) throw new Error(`没有动作：${seed} phase=${state.phase} turn=${seat}`);
    const r = dispatchDdz(state, a);
    if (r.error) throw new Error(`非法动作 ${r.error}：${seed}`);
    state = r.state;
  }
  if (state.phase !== 'gameOver') throw new Error(`没打完：${seed}`);
  return { points: state.scores[0]!, deals: state.results.length, capped: state.scores.some((x) => Math.abs(x) >= POINTS_PER_SHARE) };
}

// ───────────── 子进程 ─────────────

if (flag('worker')) {
  const me = arg('me', 'normal') as DdzLevel;
  const bots = arg('bots', 'normal,normal').split(',') as [DdzLevel, DdzLevel];
  const from = Number(arg('from', '0'));
  const to = Number(arg('to', '0'));
  const tag = arg('tag', 'x');
  const out: One[] = [];
  for (let i = from; i < to; i++) out.push(playMatch(`sim-${tag}-${me}-${bots.join('')}-${i}`, me, bots));
  process.stdout.write(JSON.stringify(out));
  process.exit(0);
}

// ───────────── 主进程 ─────────────

const MATCHES = Number(arg('matches', '2000'));
const JOBS = Number(arg('jobs', '8'));

function runChunk(me: DdzLevel, bots: readonly [DdzLevel, DdzLevel], from: number, to: number): Promise<One[]> {
  return new Promise((ok, fail) => {
    const c = spawn('node', [process.argv[1]!, '--worker', '--me', me, '--bots', bots.join(','), '--from', String(from), '--to', String(to)], { stdio: ['ignore', 'pipe', 'inherit'] });
    let text = '';
    c.stdout?.on('data', (d) => void (text += d.toString()));
    c.once('error', fail);
    c.once('exit', (code) => (code ? fail(new Error(`子进程退出 ${code}`)) : ok(JSON.parse(text) as One[])));
  });
}

interface Cell {
  tier: TierId | '-';
  me: DdzLevel;
  bots: readonly [DdzLevel, DdzLevel];
}

async function measure(cell: Cell): Promise<string> {
  const step = Math.ceil(MATCHES / JOBS);
  const parts = await Promise.all(Array.from({ length: JOBS }, (_, j) => runChunk(cell.me, cell.bots, j * step, Math.min(MATCHES, (j + 1) * step))));
  const all = parts.flat();
  const n = all.length;
  const x = all.map((r) => r.points / POINTS_PER_SHARE);
  const mean = x.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(x.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const se = sd / Math.sqrt(n);
  const win = all.filter((r) => r.points > 0).length / n;
  const deals = all.reduce((a, r) => a + r.deals, 0) / n;
  const capped = all.filter((r) => r.capped).length / n;
  const f = (v: number): string => (v >= 0 ? '+' : '') + v.toFixed(3);
  const ok = mean + 2 * se <= 0 ? '达标' : '不达标';
  return `${cell.tier.padEnd(5)} ${NAME[cell.me]}玩家 vs ${NAME[cell.bots[0]]}+${NAME[cell.bots[1]]}  ${f(mean)} ± ${(2 * se).toFixed(3)} 份  赢 ${(win * 100).toFixed(0)}%  ${deals.toFixed(1)} 副  碰封顶 ${(capped * 100).toFixed(1)}%  n=${n}  ${ok}`;
}

const cells: Cell[] = [];
const meList = arg('me', 'normal,novice').split(',') as DdzLevel[];
if (flag('table')) {
  for (const tier of TIER_IDS) for (const me of meList) cells.push({ tier, me, bots: DDZ_SOLO_BOTS[tier] });
} else if (process.argv.includes('--bots')) {
  const bots = arg('bots', 'normal,normal').split(',') as [DdzLevel, DdzLevel];
  for (const me of meList) cells.push({ tier: '-', me, bots });
} else {
  for (let i = 0; i < LEVELS.length; i++) for (let j = i; j < LEVELS.length; j++) for (const me of meList) cells.push({ tier: '-', me, bots: [LEVELS[i]!, LEVELS[j]!] });
}
console.log(`每格 ${MATCHES} 场，规则 ${JSON.stringify(DDZ_SOLO_OPTS)}；± 是 2 倍标准误`);
for (const c of cells) console.log(await measure(c));
