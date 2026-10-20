/**
 * 实盘计分的模拟（docs/stake.md 的数字从这里来）：按 docs/economy.md 第 2 节的三条原则量一种计分办法。
 *
 *   node tools/stake-sim.ts                                   默认：每种对局 2000 场
 *   node tools/stake-sim.ts --matches 500 --deals 8 --me normal --mate normal --opp easy,normal,hard
 *
 * 一场：我坐 0、搭档坐 2、对手坐 1/3，从打 2 开局，打满 --deals 副（或有一队过 A）结束；
 * 每一副按名次给头游那一队计分（搭档第 2 名 = 双下 3 分，第 3 名 = 单下 2 分，末游 1 分），输的一队扣同样的分。
 * 输赢都封顶一份（--share 分 = 一份，默认 20，即每分 = 一份的 1/20）：累计到 ±一份就提前结束（再打也不会变）。
 * 输出：每场净分按份数算的分布、碰到封顶的比例、副数、动作数、估计时长。
 *
 * 时长按动作数估：我每次出手 --human 秒（默认 4），电脑每次出手 --bot 秒（默认 1，页面的出牌动画），每副另加 --deal-overhead 秒（默认 12：发牌、进贡还贡、结算页）。
 * 只是估计：真人想得久的话按比例放大，表里给出 3 秒和 6 秒两种。
 */
import { createGame, dispatch, seatsToAct, viewFor, type GameState } from '../src/variants/guandan/core/index.ts';
import { decide, type Difficulty } from '../src/variants/guandan/ai/index.ts';

function arg(name: string, def: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : def;
}

const MATCHES = Number(arg('matches', '2000'));
const DEALS = Number(arg('deals', '8'));
const SHARE = Number(arg('share', '20'));
const ME = arg('me', 'normal') as Difficulty;
const MATE = arg('mate', 'normal') as Difficulty;
const OPPS = arg('opp', 'easy,normal,hard').split(',') as Difficulty[];
const HUMAN_S = Number(arg('human', '4'));
const BOT_S = Number(arg('bot', '1'));
const DEAL_S = Number(arg('deal-overhead', '12'));
const PREFIX = arg('seed', 'stake');

interface Match {
  points: number;
  deals: number;
  myActs: number;
  botActs: number;
  capped: boolean;
}

/** 一副结束时我这一队的得分（正赢负输）。 */
function dealPoints(s: GameState): number {
  const r = s.lastDeal!;
  const head = r.order[0]!;
  const matePlace = r.order.indexOf(((head + 2) % 4) as 0 | 1 | 2 | 3);
  const pts = matePlace === 1 ? 3 : matePlace === 2 ? 2 : 1;
  return r.winnerTeam === 0 ? pts : -pts;
}

function playMatch(id: string, opp: Difficulty): Match {
  let { state } = createGame(id);
  const m: Match = { points: 0, deals: 0, myActs: 0, botActs: 0, capped: false };
  for (let guard = 0; guard < 100_000; guard++) {
    if (state.phase === 'gameOver') break;
    if (state.phase === 'dealEnd') {
      m.deals++;
      m.points += dealPoints(state);
      if (Math.abs(m.points) >= SHARE) {
        m.points = Math.sign(m.points) * SHARE;
        m.capped = true;
        break;
      }
      if (m.deals >= DEALS) break;
      state = dispatch(state, { type: 'nextDeal' }).state;
      continue;
    }
    const seat = seatsToAct(state)[0]!;
    const d = seat === 0 ? ME : seat === 2 ? MATE : opp;
    const a = decide(viewFor(state, seat), { seed: `${id}|${seat}`, difficulty: d })!;
    const r = dispatch(state, a);
    if (r.error) throw new Error(`${id}：${r.error}`);
    state = r.state;
    if (seat === 0) m.myActs++;
    else m.botActs++;
  }
  // 过 A 结束的那一副：gameOver 时 lastDeal 是最后一副
  if (state.phase === 'gameOver' && !m.capped && m.deals < DEALS) {
    m.deals++;
    m.points += dealPoints(state);
    if (Math.abs(m.points) >= SHARE) {
      m.points = Math.sign(m.points) * SHARE;
      m.capped = true;
    }
  }
  return m;
}

const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]!;
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

for (const opp of OPPS) {
  const ms: Match[] = [];
  for (let i = 0; i < MATCHES; i++) ms.push(playMatch(`${PREFIX}-${opp}-${i}`, opp));
  const shares = ms.map((m) => m.points / SHARE);
  const mins = (h: number) => ms.map((m) => (m.myActs * h + m.botActs * BOT_S + m.deals * DEAL_S) / 60);
  const within1 = shares.filter((x) => Math.abs(x) <= 1).length / ms.length;
  const out = {
    me: ME,
    mate: MATE,
    opp,
    matches: MATCHES,
    deals: DEALS,
    share: SHARE,
    evShare: +mean(shares).toFixed(3),
    winRate: +(shares.filter((x) => x > 0).length / ms.length).toFixed(3),
    within1Share: +within1.toFixed(3),
    p05: pct(shares, 0.05),
    p50: pct(shares, 0.5),
    p95: pct(shares, 0.95),
    maxWin: Math.max(...shares),
    cappedLoss: +(ms.filter((m) => m.capped && m.points < 0).length / ms.length).toFixed(4),
    cappedWin: +(ms.filter((m) => m.capped && m.points > 0).length / ms.length).toFixed(4),
    absPointsP95: pct(ms.map((m) => Math.abs(m.points)), 0.95),
    absPointsP99: pct(ms.map((m) => Math.abs(m.points)), 0.99),
    dealsMean: +mean(ms.map((m) => m.deals)).toFixed(2),
    myActsPerDeal: +(mean(ms.map((m) => m.myActs)) / mean(ms.map((m) => m.deals))).toFixed(1),
    botActsPerDeal: +(mean(ms.map((m) => m.botActs)) / mean(ms.map((m) => m.deals))).toFixed(1),
    minutesMedian: { h3: +pct(mins(3), 0.5).toFixed(1), h4: +pct(mins(HUMAN_S), 0.5).toFixed(1), h6: +pct(mins(6), 0.5).toFixed(1) },
    minutesP90h4: +pct(mins(HUMAN_S), 0.9).toFixed(1),
  };
  console.log(JSON.stringify(out));
}
