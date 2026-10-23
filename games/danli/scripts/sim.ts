/**
 * 模拟器：电脑对电脑打 N 局（种子 0..N-1），看一局打几轮、出手几次、命中率、怎么结束的（血量掉光 / 掉出画本 / 打满轮数）、两队胜率、各道具的使用率、电脑想一手要多久。
 * 用法：npm run sim [局数，默认 100] [选项……]
 * - 1v1 / 2v2 / 3v3：对阵（默认 1v1）；
 * - mix：电脑拿各自性格偏好的武器（personas.ts），不写就人人包子蒸笼（和 0.1.0 的数能比）；
 * - room：用准备房间的默认阵容（room.ts 的 defaultRoom，我那个位子也换成电脑）；
 * - map:<id>：在这张图上打（默认厨房面团岛；map:all 11 张各打 N 局，一张一行）；
 * - cap:N：打满 N 轮按血量定（默认 MAX_ROUNDS）；cap:999 看不限轮数时一局自然打多久；
 * - ab：每种道具再打 N 局"全会的电脑"对"禁了这种道具的电脑"（单双局换边），看用和不用的胜率差（平局算半局），最后比"全会"对"常用道具都不用"（commons）、"什么道具都不用"（none）；
 *   ab:none 只比这一组，ab:commons,fork 只比这几种；
 * - weapons：8 把武器两两 1v1 对打（每一对 N 局、单双局换边，同一把也打；加 map:all 11 张图轮着打），打印胜率表和每把的平均胜率；
 * - online：好友房的"联机档"电脑（ai/online.ts）对单机档（ai/index.ts）打 N 局（单双局换边），看联机档弱多少，再打 N 局联机档对联机档看一局多长。
 * 改了数值或电脑跑一遍，结果写进 README 的"数值"一节。
 */
import { plan, planActions, type ItemKey, type PlanOpts } from '../src/ai/index.ts';
import { planLite } from '../src/ai/online.ts';
import { PERSONAS } from '../src/ai/personas.ts';
import { apply, MAX_ROUNDS, newGame } from '../src/core/rules.ts';
import { loadoutName } from '../src/core/items.ts';
import type { PlayerSetup, Setup, State, Team } from '../src/core/types.ts';
import { MAP_IDS, MAPS, type MapId } from '../src/core/maps.ts';
import { WEAPON_IDS, WEAPONS, type WeaponId } from '../src/core/weapons.ts';
import { defaultRoom, roomSetup } from '../src/room.ts';

const args = process.argv.slice(2);
const n = Number(args.find((a) => /^\d+$/.test(a)) ?? 100);
const size = Number(args.find((a) => /^[123]v[123]$/.test(a))?.[0] ?? 1);
const mix = args.includes('mix');
const useRoom = args.includes('room');
const mapArg = args.find((a) => a.startsWith('map:'))?.slice(4) ?? 'kitchen';
let map: MapId = mapArg === 'all' ? 'kitchen' : (mapArg as MapId);
const capArg = args.find((a) => a.startsWith('cap:'));
const cap = capArg ? Number(capArg.slice(4)) : MAX_ROUNDS;
const ALL: ItemKey[] = ['p1', 'p2', 'fork', 'boost', 'lid', 'plane'];
const abArg = args.find((a) => a.startsWith('ab')) ?? '';
const groups: { name: string; ban: ItemKey[] }[] = !abArg
  ? []
  : (abArg === 'ab' ? [...ALL, 'commons', 'none'] : abArg.slice(3).split(',')).map((k) =>
        k === 'none' ? { name: '所有道具', ban: ALL } : k === 'commons' ? { name: '常用道具（连发、三岔、加力）', ban: ['p1', 'p2', 'fork', 'boost'] as ItemKey[] } : { name: k, ban: [k as ItemKey] },
      );

/** 座位：蓝队 size 个、黄队 size 个；人物按 PERSONAS 的顺序发（蓝队拿前面的、黄队拿后面的） */
function makeSetup(weapons?: [WeaponId, WeaponId]): Setup {
  if (useRoom && !weapons) {
    const r = roomSetup({ ...defaultRoom(), size: size as 1 | 2 | 3, map }, '我', () => map);
    return { ...r, players: r.players.map((p) => ({ ...p, ai: true })), ...(cap !== MAX_ROUNDS ? { maxRounds: cap } : {}) };
  }
  const players: PlayerSetup[] = [];
  for (const team of [0, 1] as const) {
    for (let k = 0; k < size; k++) {
      const p = PERSONAS[(team * 3 + k) % PERSONAS.length]!;
      players.push({ name: p.name, team, look: p.look, weapon: weapons ? weapons[team] : mix ? p.weapons[0] : 'steamer', ai: true });
    }
  }
  return { map, players, ...(cap !== MAX_ROUNDS ? { maxRounds: cap } : {}) };
}

interface Tally {
  games: number;
  turns: number[];
  rounds: number[];
  shots: number;
  hits: number;
  mateHits: number;
  ends: { hp: number; fall: number; turns: number; draw: number };
  use: Record<string, number>;
  combo: Record<string, { n: number; dmg: number }>;
  ms: number[];
  wins: [number, number];
  draws: number;
}

/** lite：用好友房的联机档电脑 */
type Who = PlanOpts & { lite?: boolean };

function play(seed: number, setup: Setup, opts: [Who, Who], t: Tally): Team | null {
  let s: State = newGame([seed, 7, 7, 7, 7, 7, 7, 7], setup);
  let fell = false;
  while (s.phase === 'play') {
    const me = s.actor;
    const team = s.chars[me]!.team;
    const t0 = performance.now();
    const p = opts[team].lite ? planLite(s) : plan(s, opts[team]);
    t.ms.push(performance.now() - t0);
    const l = p.loadout;
    const tag = l.plane ? ['plane'] : [...(['p1', 'p2', 'fork'] as const).filter((k) => l[k]), ...(l.b10 + l.b20 + l.b50 ? ['boost'] : []), ...(l.lid ? ['lid'] : [])];
    for (const k of tag) t.use[k] = (t.use[k] ?? 0) + 1;
    t.use.turns = (t.use.turns ?? 0) + 1;
    // 叠法（不算锅盖）：用了几次、打到对方一共多少血（实战伤害，打偏的也算进次数）
    const name = loadoutName({ ...l, lid: false });
    const row = (t.combo[name] ??= { n: 0, dmg: 0 });
    row.n++;
    for (const a of planActions(p)) {
      const r = apply(s, a);
      if (!r.ok) throw new Error(`第 ${seed} 局电脑出了不合法的一步：${r.error} ${JSON.stringify(a)}`);
      if (a.t === 'fire') for (const e of r.events) if (e.t === 'hurt' && s.chars[e.id]!.team !== team) row.dmg += e.dmg;
      if (a.t === 'fire' && !a.plane) {
        t.shots++;
        if (r.events.some((e) => e.t === 'hurt' && s.chars[e.id]!.team !== team)) t.hits++;
        if (r.events.some((e) => e.t === 'hurt' && e.id !== me && s.chars[e.id]!.team === team)) t.mateHits++;
      }
      s = r.state;
      if (r.events.some((e) => e.t === 'out' && e.why === 'fall')) fell = true;
    }
  }
  t.games++;
  t.turns.push(s.turn);
  t.rounds.push(s.round);
  if (s.winner === null) t.ends.draw++;
  else if (s.endBy === 'turns') t.ends.turns++;
  else if (fell) t.ends.fall++;
  else t.ends.hp++;
  if (s.winner === null) t.draws++;
  else t.wins[s.winner]++;
  return s.winner;
}

const blank = (): Tally => ({ games: 0, turns: [], rounds: [], shots: 0, hits: 0, mateHits: 0, ends: { hp: 0, fall: 0, turns: 0, draw: 0 }, use: {}, combo: {}, ms: [], wins: [0, 0], draws: 0 });
const pct = (a: number, b: number): string => `${b ? ((100 * a) / b).toFixed(0) : 0}%`;
const q = (xs: number[], p: number): number => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] ?? 0;

if (args.includes('weapons')) {
  // 两两对打：rate[a][b] = a 对 b 的胜率（平局算半局）
  const rate: Record<string, Record<string, number>> = {};
  const all = blank();
  for (const a of WEAPON_IDS) rate[a] = {};
  for (let i = 0; i < WEAPON_IDS.length; i++) {
    for (let j = i; j < WEAPON_IDS.length; j++) {
      const a = WEAPON_IDS[i]!;
      const b = WEAPON_IDS[j]!;
      let score = 0;
      for (let g = 0; g < n; g++) {
        const aTeam: Team = g % 2 === 0 ? 0 : 1;
        // map:all：11 张图轮着打
        if (mapArg === 'all') map = MAP_IDS[g % MAP_IDS.length]!;
        const w = play(1000 * i + 37 * j + g, makeSetup(aTeam === 0 ? [a, b] : [b, a]), [{}, {}], all);
        score += w === null ? 0.5 : w === aTeam ? 1 : 0;
      }
      rate[a]![b] = score / n;
      rate[b]![a] = 1 - score / n;
    }
  }
  const short = (id: WeaponId): string => WEAPONS[id].name.slice(0, 2);
  console.log(`8 把武器两两对打（1v1，每对 ${n} 局，行对列的胜率）`);
  console.log(['      ', ...WEAPON_IDS.map(short)].join('\t'));
  for (const a of WEAPON_IDS) {
    const others = WEAPON_IDS.filter((b) => b !== a);
    const avg = others.reduce((x, b) => x + rate[a]![b]!, 0) / others.length;
    console.log([WEAPONS[a].name.padEnd(5, '　'), ...WEAPON_IDS.map((b) => (a === b ? '—' : `${Math.round(100 * rate[a]![b]!)}`)), `平均 ${Math.round(100 * avg)}%`].join('\t'));
  }
  console.log(`一共 ${all.games} 局：平均 ${(all.turns.reduce((x, y) => x + y, 0) / all.games).toFixed(1)} 次出手，掉出画本 ${pct(all.ends.fall, all.games)}，打满轮数 ${pct(all.ends.turns, all.games)}`);
  process.exit(0);
}

if (args.includes('online')) {
  // 联机档对单机档：单双局换边，平局算半局
  const t = blank();
  let lite = 0;
  for (let g = 0; g < n; g++) {
    const liteTeam: Team = g % 2 === 0 ? 0 : 1;
    const w = play(g, makeSetup(), liteTeam === 0 ? [{ lite: true }, {}] : [{}, { lite: true }], t);
    lite += w === null ? 0.5 : w === liteTeam ? 1 : 0;
  }
  const self = blank();
  for (let g = 0; g < n; g++) play(g, makeSetup(), [{ lite: true }, { lite: true }], self);
  const avg = (xs: number[]): string => (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1);
  console.log(`${MAPS[map].name} ${size}v${size}${mix ? '（性格武器）' : useRoom ? '（房间默认阵容）' : '（人人包子蒸笼）'}，${n} 局：`);
  console.log(`联机档对单机档：联机档胜率 ${pct(lite, n)}（平局算半局），平均 ${avg(t.rounds)} 轮`);
  console.log(`联机档对联机档：平均 ${avg(self.rounds)} 轮、${avg(self.turns)} 次出手，命中率 ${pct(self.hits, self.shots)}，掉出画本 ${pct(self.ends.fall, n)}，打满轮数 ${pct(self.ends.turns, n)}，蓝 ${self.wins[0]} : 黄 ${self.wins[1]}`);
  console.log(`联机档想一手：中位 ${q(self.ms, 0.5).toFixed(2)} ms，九成九 ${q(self.ms, 0.99).toFixed(2)} ms（Node，不降速，不含结算）`);
  process.exit(0);
}

if (mapArg === 'all') {
  console.log(`${size}v${size}${mix ? '（性格武器）' : useRoom ? '（房间默认阵容）' : '（人人包子蒸笼）'}，打满 ${cap} 轮按血量定，每张图 ${n} 局：`);
  console.log('地图\t平均轮数\t平均出手\t掉出画本\t血量掉光\t打满轮数\t蓝:黄');
  for (const id of MAP_IDS) {
    map = id;
    const t = blank();
    for (let g = 0; g < n; g++) play(g, makeSetup(), [{}, {}], t);
    const avg = (xs: number[]): string => (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(1);
    console.log(`${MAPS[id].name}\t${avg(t.rounds)}\t${avg(t.turns)}\t${pct(t.ends.fall, n)}\t${pct(t.ends.hp, n)}\t${pct(t.ends.turns, n)}\t${t.wins[0]}:${t.wins[1]}${t.draws ? `（平 ${t.draws}）` : ''}`);
  }
  process.exit(0);
}

const setup = makeSetup();
const base = blank();
for (let g = 0; g < n; g++) play(g, setup, [{}, {}], base);
const turns = base.use.turns ?? 1;
const avgTurns = base.turns.reduce((a, b) => a + b, 0) / n;
console.log(`${MAPS[map].name} ${size}v${size}${mix ? '（性格武器）' : useRoom ? '（房间默认阵容）' : '（人人包子蒸笼）'}，打满 ${cap} 轮按血量定，${n} 局：`);
console.log(`平均 ${avgTurns.toFixed(1)} 次出手（中位 ${q(base.turns, 0.5)}、九成以内 ${q(base.turns, 0.9)}，每人约 ${(avgTurns / (2 * size)).toFixed(1)} 发），${(base.rounds.reduce((a, b) => a + b, 0) / n).toFixed(1)} 轮（九成以内 ${q(base.rounds, 0.9)}）；命中率 ${pct(base.hits, base.shots)}；伤到队友 ${pct(base.mateHits, base.shots)} 的出手`);
console.log(`两队：蓝队赢 ${base.wins[0]}、黄队赢 ${base.wins[1]}、平 ${base.draws}`);
console.log(`怎么结束：掉出画本 ${base.ends.fall}（${pct(base.ends.fall, n)}），血量掉光 ${base.ends.hp}（${pct(base.ends.hp, n)}），打满轮数 ${base.ends.turns}（${pct(base.ends.turns, n)}），平局 ${base.ends.draw}`);
console.log(
  `道具使用率（每次出手）：${['p1', 'p2', 'fork', 'boost', 'lid', 'plane']
    .map((k) => `${({ p1: '连发+1', p2: '连发+2', fork: '三岔', boost: '加力', lid: '锅盖', plane: '纸飞机' } as Record<string, string>)[k]} ${pct(base.use[k] ?? 0, turns)}`)
    .join('，')}`,
);
console.log('叠法\t次数\t占出手\t平均打到对方的血（实战，含打偏）');
for (const [name, row] of Object.entries(base.combo).sort((a, b) => b[1].n - a[1].n)) {
  if (row.n < turns / 200) continue;
  console.log(`${name}\t${row.n}\t${pct(row.n, turns)}\t${(row.dmg / row.n).toFixed(1)}`);
}
console.log(`电脑想一手：中位 ${q(base.ms, 0.5).toFixed(0)} ms，最慢 ${Math.max(...base.ms).toFixed(0)} ms（Node，不降速）`);

for (const { name, ban } of groups) {
  const t = blank();
  let full = 0;
  for (let g = 0; g < n; g++) {
    const fullTeam: Team = g % 2 === 0 ? 0 : 1;
    const opts: [PlanOpts, PlanOpts] = fullTeam === 0 ? [{}, { ban: new Set(ban) }] : [{ ban: new Set(ban) }, {}];
    const w = play(g, setup, opts, t);
    full += w === null ? 0.5 : w === fullTeam ? 1 : 0;
  }
  console.log(`会用 ${name} 的电脑对不会用的：胜率 ${pct(full, n)}（${n} 局，平均 ${(t.turns.reduce((a, b) => a + b, 0) / n).toFixed(1)} 次出手）`);
}
