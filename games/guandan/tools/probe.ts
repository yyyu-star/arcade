/**
 * 跟牌积极度探针：座位 0 用困难电脑扮演"真人"，座位 1、3（对手）用被测电脑，2 用困难电脑。
 * 统计对手面对座位 0 当前最大的那手、手里有非炸弹的合法压法时，选"不要"的比例（按牌型）。
 * 口径和协调方 2026-10-13 的 probe 一致；另给一列"有不拆炸弹/同花顺的压法时"的不要比例。
 *
 *   node tools/probe.ts                         被测 = 当前 normal，40 局
 *   node tools/probe.ts --bot prev --games 200  被测 = 0.1.2 的 normal（tools/baseline-ai-0.1.2）
 *   --difficulty easy|normal|hard
 */
import { createGame, dispatch, isBomb, legalPlays, seatsToAct, viewFor, type Action, type PlayerView } from '../src/variants/guandan/core/index.ts';
import { decide, planHand } from '../src/variants/guandan/ai/index.ts';
import { decide as decidePrev } from './baseline-ai-0.1.2/bot.ts';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : def;
}
const games = Number(arg('games', '40'));
const which = arg('bot', 'new');
const difficulty = arg('difficulty', 'normal') as 'easy' | 'normal' | 'hard';
const tested = (v: PlayerView, seed: string): Action | null =>
  which === 'prev' ? decidePrev(v, { seed, difficulty }) : decide(v, { seed, difficulty });

/** 这手是否拆了理牌计划里的炸弹/同花顺（同点有别的牌可换时不算） */
function breaksBomb(v: PlayerView, cards: readonly number[]): boolean {
  const plan = planHand(v.hand, v.level);
  const prot = new Set<number>();
  for (const g of plan.groups) if (g.type === 'bomb' || g.type === 'straightFlush' || g.type === 'jokerBomb') for (const c of g.cards) prot.add(c);
  return cards.some((c) => prot.has(c));
}

const ORDER = ['single', 'pair', 'triple', 'fullHouse', 'straight', 'tube', 'plate'];
const stat: Record<string, { pass: number; n: number; cheapPass: number; cheapN: number }> = {};
for (const t of ORDER) stat[t] = { pass: 0, n: 0, cheapPass: 0, cheapN: 0 };
for (let g = 0; g < games; g++) {
  const seed = `probe${g}`;
  let { state } = createGame(seed);
  for (let step = 0; step < 6000 && state.phase !== 'gameOver'; step++) {
    if (state.phase === 'dealEnd') {
      state = dispatch(state, { type: 'nextDeal' }).state;
      continue;
    }
    const seat = seatsToAct(state)[0]!;
    const v = viewFor(state, seat);
    const act = seat === 1 || seat === 3 ? tested(v, 'p' + g) : decide(v, { seed: 'p' + g, difficulty: 'hard' });
    if (!act) break;
    const last = v.trick.last;
    if (state.phase === 'play' && last && last.seat === 0 && (seat === 1 || seat === 3) && !isBomb(last.play)) {
      const normals = legalPlays(v).filter((p) => !isBomb(p));
      const s = stat[last.play.type];
      if (normals.length && s) {
        s.n++;
        if (act.type === 'pass') s.pass++;
        if (normals.some((p) => !breaksBomb(v, p.cards))) {
          s.cheapN++;
          if (act.type === 'pass') s.cheapPass++;
        }
      }
    }
    const r = dispatch(state, act);
    if (r.error) throw new Error(r.error);
    state = r.state;
  }
}
const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(0)}%` : '-');
console.log(`被测：${which === 'prev' ? '0.1.2' : '当前'} ${difficulty}，${games} 局`);
console.log('牌型      样本  不要   | 有不拆炸弹的压法时：样本  不要');
let tp = 0;
let tn = 0;
for (const t of ORDER) {
  const s = stat[t]!;
  tp += s.pass;
  tn += s.n;
  console.log(`${t.padEnd(10)}${String(s.n).padStart(5)}  ${pct(s.pass, s.n).padStart(4)}   |                    ${String(s.cheapN).padStart(5)}  ${pct(s.cheapPass, s.cheapN).padStart(4)}`);
}
console.log(`合计      ${String(tn).padStart(5)}  ${pct(tp, tn).padStart(4)}`);
