/**
 * 好友房实盘桌（DESIGN.md 4.1）：两个"普通玩家"（代理玩家 PLAYER，当真人）对两个电脑，看真人每人每场的平均净输赢（份）和标准误。
 * 两个真人的座位在六种坐法（相邻、对家）里轮换，默认规则。要的是"两个普通真人对电脑不该稳赚"：期望 + 一个标准误 ≤ 0。
 * 用法：
 *   node scripts/stake-room.ts [场数，默认 1000] search [档]   由弱到强试候选组合，报每个的期望，挑最弱的过线的
 *   node scripts/stake-room.ts [场数] venues [档,档…]        按场地表（venues.ts 的 room:<档>）逐档验证
 */
import { stream } from 'arcade-kit/rng';
import { PERSONAS } from '../src/ai/personas.ts';
import { seatPlan, VENUES, type Venue } from '../src/ai/venues.ts';
import { sichuanXuezhan as XZ } from '../src/core/variants/sichuan-xuezhan/index.ts';
import { STAKES, stakesOf, type StakesId } from '../src/game/stakes.ts';
import { meanSe, playMatch, PLAYER, signed } from './play.ts';

const N = Number(process.argv[2] ?? 1000);
const MODE = process.argv[3] ?? 'venues';
const PAIRS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [0, 2],
  [1, 3],
] as const;

/** 候选组合，由弱到强（权重顺序同 PERSONAS：幺妹儿、熊猫哥、盖碗儿、兔头哥、火锅婆婆、板凳儿） */
const CANDIDATES: Venue[] = [
  { weights: [1, 1, 0, 1, 0, 1], soft: 100 },
  { weights: [1, 1, 0, 1, 0, 1], soft: 0 },
  { weights: [1, 1, 0, 1, 0, 0], soft: 0 },
  { weights: [1, 1, 1, 1, 0, 0], soft: 0 },
  { weights: [0, 1, 2, 1, 1, 0], soft: 0 },
  { weights: [0, 0, 2, 1, 2, 0], soft: 0 },
  { weights: [0, 0, 1, 0, 1, 0], soft: 0 },
];

function run(tier: StakesId, venue: Venue): { mean: number; se: number; house: number } {
  const st = stakesOf(tier)!;
  const nets: number[] = [];
  let house = 0;
  const id = '__candidate';
  (VENUES as Record<string, Venue>)[id] = venue;
  for (let i = 0; i < N; i++) {
    const pair = PAIRS[i % PAIRS.length]!;
    const key = [i, st.share, 11, 7, 7, 7, 7, 7];
    const plan = seatPlan(stream(key, 'persona'), id, 4);
    const proxies = new Map(pair.map((seat) => [seat, PLAYER] as const));
    const { s } = playMatch(key, st.share, plan.personas, plan.tunes, proxies);
    const r = XZ.result(s);
    for (const seat of pair) nets.push(r.seats[seat]!.net / st.share);
    for (let seat = 0; seat < 4; seat++) if (!(pair as readonly number[]).includes(seat)) house += r.seats[seat]!.net / st.share;
  }
  delete (VENUES as Record<string, Venue>)[id];
  return { ...meanSe(nets), house: house / N };
}

const names = (v: Venue): string =>
  v.weights
    .map((w, i) => (w ? `${PERSONAS[i]!.name}${w > 1 ? `×${w}` : ''}` : ''))
    .filter(Boolean)
    .join('、') + (v.soft ? `，手软 ${v.soft}` : '');

if (MODE === 'search') {
  const tier = (process.argv[4] ?? 'small') as StakesId;
  console.log(`搜索：${tier} 档，两个普通玩家，每个组合 ${N} 场`);
  for (const [i, c] of CANDIDATES.entries()) {
    const r = run(tier, c);
    const ok = r.mean + r.se <= 0;
    console.log(`#${i} ${names(c).padEnd(30, '　')} 真人每人每场 ${signed(r.mean)} ± ${r.se.toFixed(3)} 份  电脑合计 ${signed(r.house)}  ${ok ? '过线' : ''}`);
  }
} else {
  const tiers = process.argv[4]?.split(',') ?? STAKES.filter((x) => x.wallet).map((x) => x.id);
  for (const tier of tiers) {
    const v = VENUES[`room:${tier}`]!;
    const r = run(tier as StakesId, v);
    const share = stakesOf(tier as StakesId)!.share;
    console.log(`room:${tier.padEnd(5)} ${names(v)}  真人每人每场 ${signed(r.mean)} ± ${r.se.toFixed(3)} 份（${Math.round(r.mean * share)} 筹码）  电脑合计 ${signed(r.house)} 份`);
  }
}
