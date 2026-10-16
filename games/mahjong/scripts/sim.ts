/**
 * 模拟器（DESIGN.md 4.1）：单机各场地，座位 0 是代理玩家（普通玩家 PLAYER、新手 NOVICE），三个电脑照线上的场地表挑性格、配状态，打 N 场。
 * 量"一场多久、代理玩家每场和每小时的期望、输光和赢满 3 份的比例"，再按性格汇总打法指标（胡、自摸、点炮、番、杠、碰），看性格拉没拉开。
 * 时长：代理玩家每个决定按 3 秒，电脑按 1.2 秒，每局另加换牌定缺和结算 20 秒。
 * 用法：npm run sim [每个场地的场数，默认 1000] [只跑这些场地，逗号分隔，默认全部单机场地]；想快就每个场地开一个进程（第二个参数）
 */
import { stream } from 'arcade-kit/rng';
import { PERSONAS } from '../src/ai/personas.ts';
import { seatPlan, VENUES } from '../src/ai/venues.ts';
import { sichuanXuezhan as XZ } from '../src/core/variants/sichuan-xuezhan/index.ts';
import { stakesOf, type StakesId } from '../src/game/stakes.ts';
import { meanSe, NOVICE, pct, playMatch, PLAYER, signed } from './play.ts';

const N = Number(process.argv[2] ?? 1000);
const ONLY = process.argv[3]?.split(',');
const venues = Object.keys(VENUES).filter((v) => v.startsWith('solo:') && (!ONLY || ONLY.includes(v)));

interface Style {
  n: number;
  wins: number;
  zimo: number;
  pao: number;
  fan: number;
  big: number;
  gangs: number;
  pons: number;
}
const styles = new Map<number, Style>();

for (const venue of venues) {
  const st = stakesOf(venue.slice(5) as StakesId)!;
  for (const proxy of [PLAYER, NOVICE]) {
    const nets: number[] = [];
    const mins: number[] = [];
    let bust = 0;
    let cap = 0;
    for (let i = 0; i < N; i++) {
      const key = [i, st.share, proxy === PLAYER ? 1 : 2, 7, 7, 7, 7, 7];
      const plan = seatPlan(stream(key, 'persona'), venue, 3);
      const { s, pons, moves } = playMatch(key, st.share, [0, ...plan.personas], [{ mood: 0, soft: 0 }, ...plan.tunes], new Map([[0, proxy]]));
      const net = XZ.result(s).seats[0]!.net / st.share;
      nets.push(net);
      mins.push((moves[0]! * 3 + (moves[1]! + moves[2]! + moves[3]!) * 1.2 + s.history.length * 20) / 60);
      if (s.chips[0]! <= 0) bust++;
      if (s.chips[0]! >= st.share * 4) cap++;
      if (proxy !== PLAYER) continue;
      for (let seat = 1; seat < 4; seat++) {
        const p = s.personas[seat]!;
        const b = styles.get(p) ?? { n: 0, wins: 0, zimo: 0, pao: 0, fan: 0, big: 0, gangs: 0, pons: 0 };
        const x = s.stats[seat]!;
        b.n++;
        b.wins += x.wins;
        b.zimo += x.zimo;
        b.pao += x.pao;
        b.gangs += x.gangs;
        b.pons += pons[seat]!;
        for (const h of s.history)
          for (const w of h.wins)
            if (w.seat === seat) {
              b.fan += w.fan;
              if (w.fan >= 2) b.big++;
            }
        styles.set(p, b);
      }
    }
    const { mean, se } = meanSe(nets);
    const avgMin = mins.reduce((a, x) => a + x, 0) / N;
    console.log(
      `${venue.padEnd(10)} ${proxy.name.padEnd(4, '　')} 每场 ${signed(mean)} ± ${se.toFixed(3)} 份  每小时 ${signed((mean * 60) / avgMin, 2)} 份  ` +
        `时长 p50 ${pct(mins, 50).toFixed(1)} 分  输光 ${((bust / N) * 100).toFixed(1)}%  赢满 3 份 ${((cap / N) * 100).toFixed(1)}%`,
    );
  }
}

console.log('\n性格的打法（电脑座位，所有场地合起来；每场的平均，番是每次胡的平均）');
for (const [p, b] of [...styles.entries()].sort((a, b) => a[0] - b[0])) {
  const f = (x: number): string => (x / b.n).toFixed(2);
  console.log(
    `${PERSONAS[p]!.name.padEnd(4, '　')} ${String(b.n).padStart(5)} 场  胡 ${f(b.wins)}  自摸 ${((b.zimo / Math.max(1, b.wins)) * 100).toFixed(0)}%  点炮 ${f(b.pao)}  ` +
      `番 ${(b.fan / Math.max(1, b.wins)).toFixed(2)}  2 番以上 ${((b.big / Math.max(1, b.wins)) * 100).toFixed(0)}%  杠 ${f(b.gangs)}  碰 ${f(b.pons)}`,
  );
}
