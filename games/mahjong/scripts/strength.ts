/**
 * 性格强弱（DESIGN.md 4.1、第 5 节）：每个性格轮流坐进同一桌固定的对手里（对手按座位轮换），打 N 场，看它每场平均净输赢（份）和标准误。
 * 比 sim.ts 按场地挑性格的统计干净：对手一样、都不手软，差别只来自这个性格自己（状态照常每场浮动）。
 * 用法：node scripts/strength.ts [每个性格的场数，默认 400] [对手，逗号分隔的性格编号，默认 0,2,3] [只量这些性格，逗号分隔，默认全部]
 * 想快就每个性格开一个进程并行跑（第三个参数）
 */
import { stream } from 'arcade-kit/rng';
import { PERSONAS } from '../src/ai/personas.ts';
import { sichuanXuezhan as XZ } from '../src/core/variants/sichuan-xuezhan/index.ts';
import { meanSe, playMatch, signed } from './play.ts';

const N = Number(process.argv[2] ?? 400);
const OPP = (process.argv[3] ?? '0,2,3').split(',').map(Number);
const ONLY = process.argv[4] ? process.argv[4].split(',').map(Number) : PERSONAS.map((_, i) => i);
const SHARE = 2_000;

for (const p of ONLY) {
  const nets: number[] = [];
  let wins = 0;
  let pao = 0;
  for (let i = 0; i < N; i++) {
    const seat = i % 4;
    const others = [...OPP];
    const personas = [0, 1, 2, 3].map((s) => (s === seat ? p : others.shift()!));
    const key = [i, 9_001, p, 7, 7, 7, 7, 7];
    const r = stream(key, 'mood');
    const tunes = personas.map(() => ({ mood: r.u32() | 1, soft: 0 }));
    const { s } = playMatch(key, SHARE, personas, tunes);
    nets.push(XZ.result(s).seats[seat]!.net / SHARE);
    wins += s.stats[seat]!.wins;
    pao += s.stats[seat]!.pao;
  }
  const { mean, se } = meanSe(nets);
  console.log(`${PERSONAS[p]!.name.padEnd(4, '　')} 档 ${PERSONAS[p]!.level}  每场 ${signed(mean)} ± ${se.toFixed(3)} 份  胡 ${(wins / N).toFixed(2)}  点炮 ${(pao / N).toFixed(2)}`);
}
