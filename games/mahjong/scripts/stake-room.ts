/**
 * 好友房实盘桌的期望（DESIGN.md 4.1）：两个真人对两个最强的电脑（实盘桌的电脑一律 STRONGEST），按档位各打 N 场，
 * 看真人每场平均净输赢（份）和标准误。真人用"普通水平"的性格代替（默认 幺妹儿、熊猫哥、兔头哥 轮着坐），
 * 两个真人的座位在六种坐法（相邻、对家）里轮换。要的是"真人对电脑不该稳赚"：期望不为正。
 * 用法：node scripts/stake-room.ts [每档场数，默认 1000] [真人用的性格，逗号分隔，默认 0,1,3] [只跑这些档，逗号分隔，默认全部实盘档]
 * 想快就每个档开一个进程并行跑（第三个参数）
 */
import { PERSONAS, STRONGEST } from '../src/ai/personas.ts';
import { sichuanXuezhan as XZ, type XzState } from '../src/core/variants/sichuan-xuezhan/index.ts';
import { runAuto } from '../src/game/driver.ts';
import { baseOf, STAKES } from '../src/game/stakes.ts';

const N = Number(process.argv[2] ?? 1000);
const POOL = (process.argv[3] ?? '0,1,3').split(',').map(Number);
const ONLY = process.argv[4]?.split(',');
const KINDS = ['ai', 'ai', 'ai', 'ai'] as const;
const PAIRS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 0],
  [0, 2],
  [1, 3],
] as const;

console.log(`真人用 ${POOL.map((p) => PERSONAS[p]!.name).join('、')}，电脑一律 ${PERSONAS[STRONGEST]!.name}，每档 ${N} 场，默认规则`);
for (const tier of STAKES.filter((x) => x.wallet && (!ONLY || ONLY.includes(x.id)))) {
  let sum = 0;
  let sq = 0;
  let n = 0;
  let house = 0;
  for (let i = 0; i < N; i++) {
    const pair = PAIRS[i % PAIRS.length]!;
    const humans = [POOL[i % POOL.length]!, POOL[(i + 1) % POOL.length]!];
    const personas = [0, 1, 2, 3].map((seat) => (seat === pair[0] ? humans[0]! : seat === pair[1] ? humans[1]! : STRONGEST));
    const key = [i, tier.share, 11, 7, 7, 7, 7, 7];
    let s = XZ.begin(key, XZ.defaults, KINDS, { share: tier.share, base: baseOf(tier.share), personas }) as XzState;
    for (;;) {
      for (const st of runAuto(XZ, s, KINDS, 5_000)) s = st.state as XzState;
      if (XZ.over(s)) break;
      s = XZ.resume(s);
    }
    const r = XZ.result(s);
    for (const seat of pair) {
      const net = r.seats[seat]!.net / tier.share;
      sum += net;
      sq += net * net;
      n++;
    }
    for (let seat = 0; seat < 4; seat++) if (seat !== pair[0] && seat !== pair[1]) house += r.seats[seat]!.net / tier.share;
  }
  const mean = sum / n;
  const se = Math.sqrt(Math.max(0, sq / n - mean * mean) / n);
  const sign = (x: number): string => (x >= 0 ? '+' : '') + x.toFixed(3);
  console.log(`${tier.id.padEnd(5)} 一份 ${String(tier.share).padStart(7)}  真人每人每场 ${sign(mean)} ± ${se.toFixed(3)} 份（${Math.round(mean * tier.share)} 筹码）  两个电脑合计每场 ${sign(house / N)} 份`);
}
