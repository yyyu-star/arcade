/** 0.1.0 上线时的电脑对手原样副本，只给 tools/sim.ts 当"旧普通"基准，不进产品包。 */
/**
 * 电脑对手。只读 viewFor 给出的信息（自己的手牌、公开出牌记录、各家张数、级数），不看别人的牌。
 *
 * 思路（大白话）：
 * - 领出：按理牌结果先出最小的一手，炸弹、级牌、王留着；对手只剩一两张时避开单张/对子；队友快走完时喂小牌。
 * - 跟牌：对手出的，用"最小、且不拆牌"的压；对手快出完（≤ 6 张）时不惜拆牌、用炸弹。
 * - 队友出的一般不压，除非能一把出完。
 * - 进贡交最不影响牌型的那张最大牌；还贡还最没用的 ≤ 10 的牌。
 * 随机性来自种子 + 步数，同样的局面同样的种子做同样的决定。
 */
import {
  canPass,
  isBomb,
  legalPlays,
  nextSeat,
  partnerOf,
  rngFor,
  teamOf,
  type Action,
  type Card,
  type Play,
  type PlayerView,
} from '../../src/variants/guandan/core/index.ts';
import { groupToPlay, isBombType, planCost, planHand, type Group } from './plan.ts';
import { randomAction } from './random.ts';

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface BotConfig {
  seed: string | number;
  difficulty?: Difficulty;
}

interface Tuning {
  /** 随机失误概率 */
  noise: number;
  /** 对手剩几张以内算"快出完"，开始拼命压 */
  threat: number;
  /** 不紧急时，愿意为压牌多付出的拆牌代价 */
  breakTolerance: number;
}

const TUNING: Record<Difficulty, Tuning> = {
  easy: { noise: 0.15, threat: 3, breakTolerance: 0.2 },
  normal: { noise: 0.04, threat: 6, breakTolerance: 0.6 },
  hard: { noise: 0, threat: 8, breakTolerance: 0.6 },
};

const toAction = (seat: number, p: Play): Action => ({
  type: 'play',
  seat,
  cards: [...p.cards],
  as: { type: p.type, rank: p.rank, extra: p.extra },
});

const minus = (hand: readonly Card[], cards: readonly Card[]): Card[] => {
  const rm = new Set(cards);
  return hand.filter((c) => !rm.has(c));
};

/** 电脑的决定；不该它行动时返回 null。 */
export function decide(view: PlayerView, cfg: BotConfig): Action | null {
  const diff = cfg.difficulty ?? 'normal';
  const tune = TUNING[diff];
  const rng = rngFor(cfg.seed, 'bot', view.seat, view.step);

  if (view.myTribute) return tributeAction(view);
  if (view.phase !== 'play' || view.turn !== view.seat) return null;

  if (tune.noise > 0 && rng.next() < tune.noise) return randomAction(view, `${cfg.seed}|noise`);

  const plays = legalPlays(view);
  // 能一把出完就出完
  const finisher = plays.find((p) => p.cards.length === view.hand.length);
  if (finisher) return toAction(view.seat, finisher);

  const last = view.trick.last;
  if (!last) return toAction(view.seat, chooseLead(view, tune));
  if (teamOf(last.seat) === teamOf(view.seat)) return { type: 'pass', seat: view.seat };
  const p = chooseFollow(view, plays, tune);
  if (p) return toAction(view.seat, p);
  return canPass(view) ? { type: 'pass', seat: view.seat } : toAction(view.seat, plays[0]!);
}

/** 给玩家的"聪明提示"：电脑在这个位置会怎么出（不要时返回 null）。 */
export function suggest(view: PlayerView, seed: string | number = 'hint'): Play | null {
  const a = decide(view, { seed, difficulty: 'hard' });
  if (!a || a.type !== 'play') return null;
  return legalPlays(view).find((p) => p.cards.length === a.cards.length && p.cards.every((c) => a.cards.includes(c)) && p.type === a.as?.type && p.rank === a.as.rank) ?? null;
}

function tributeAction(view: PlayerView): Action {
  const t = view.myTribute!;
  // 在允许的牌里，挑拿走后理牌最省的；同样省就挑最小的（还贡时）
  let best = t.allowed[0]!;
  let bestCost = Infinity;
  for (const c of t.allowed) {
    const cost = planCost(minus(view.hand, [c]), view.level);
    if (cost < bestCost - 1e-9) {
      best = c;
      bestCost = cost;
    }
  }
  return t.kind === 'tribute' ? { type: 'tribute', seat: view.seat, card: best } : { type: 'return', seat: view.seat, card: best };
}

function activeOpponents(view: PlayerView): number[] {
  return [nextSeat(view.seat), (view.seat + 3) % 4].filter((s) => !view.finished.includes(s));
}

/** 一手的"最低张"大小，用来决定领出顺序（小的先走）。 */
function lowCard(g: Group): number {
  switch (g.type) {
    case 'straight':
      return g.rank - 4;
    case 'tube':
      return g.rank - 2;
    case 'plate':
      return g.rank - 1;
    default:
      return g.value;
  }
}

function chooseLead(view: PlayerView, tune: Tuning): Play {
  const plan = planHand(view.hand, view.level);
  const groups = plan.groups;
  const bombs = groups.filter((g) => isBombType(g.type));
  const normal = groups.filter((g) => !isBombType(g.type));
  const oppCounts = activeOpponents(view).map((s) => view.counts[s]!);
  const oppMin = oppCounts.length ? Math.min(...oppCounts) : 99;
  const partner = partnerOf(view.seat);
  const partnerLeft = view.finished.includes(partner) ? 0 : view.counts[partner]!;

  // 只剩炸弹 + 一手：先炸拿回出牌权再走
  if (normal.length <= 1 && bombs.length > 0 && normal.length + bombs.length >= 2) {
    return groupToPlay(bombs.sort((a, b) => a.cards.length - b.cards.length || a.value - b.value)[0]!);
  }
  if (normal.length === 0) return groupToPlay(groups.sort((a, b) => a.value - b.value)[0]!);

  // 队友只剩 1–2 张、对手还不急：喂小单张/小对子
  if (partnerLeft > 0 && partnerLeft <= 2 && oppMin > 2) {
    const feedType = partnerLeft === 1 ? 'single' : 'pair';
    const feed = normal.filter((g) => g.type === feedType).sort((a, b) => a.value - b.value)[0];
    if (feed && feed.value <= 12) return groupToPlay(feed);
  }

  let pool = normal;
  // 对手只剩 1 张：别出单张；只剩 2 张：也别出对子（除非没别的）
  if (oppMin <= tune.threat) {
    const avoid = new Set<string>();
    if (oppMin === 1) avoid.add('single');
    if (oppMin === 2) avoid.add('pair');
    const filtered = normal.filter((g) => !avoid.has(g.type));
    if (filtered.length) pool = filtered;
    else if (oppMin === 1) {
      // 只有单张：从最大的出，逼对手
      return groupToPlay([...normal].sort((a, b) => b.value - a.value)[0]!);
    }
  }
  // 控制牌（级牌、王的单张/对子）留到后面
  const cheap = pool.filter((g) => !(g.value >= 15 && (g.type === 'single' || g.type === 'pair')));
  if (cheap.length) pool = cheap;
  pool = [...pool].sort((a, b) => lowCard(a) - lowCard(b) || b.cards.length - a.cards.length);
  return groupToPlay(pool[0]!);
}

function chooseFollow(view: PlayerView, plays: Play[], tune: Tuning): Play | null {
  const last = view.trick.last!;
  const oppCounts = activeOpponents(view).map((s) => view.counts[s]!);
  const oppMin = oppCounts.length ? Math.min(...oppCounts) : 99;
  // 出这手的对手已经出完、或者剩得很少，都算紧急
  const urgent = oppMin <= tune.threat || view.counts[last.seat] === 0;
  const base = planCost(view.hand, view.level);
  const normal = plays.filter((p) => !isBomb(p)).sort((a, b) => a.value - b.value);
  const bombs = plays.filter((p) => isBomb(p)).sort((a, b) => bombRank(a) - bombRank(b));

  let bestNormal: { p: Play; delta: number } | null = null;
  for (const p of normal.slice(0, 10)) {
    const delta = planCost(minus(view.hand, p.cards), view.level) - (base - 1);
    if (!bestNormal || delta < bestNormal.delta - 0.25) bestNormal = { p, delta };
    if (delta <= 0.05) break;
  }
  if (bestNormal) {
    const { p, delta } = bestNormal;
    if (urgent) return normal[0]!;
    // 不急：别拿级牌、王去压小牌（手里牌还多时）
    const wastesControl = p.value >= 15 && last.play.value <= 10 && view.hand.length > 12;
    if (delta <= tune.breakTolerance && !wastesControl) return p;
  }
  if (bombs.length === 0) return null;
  const bomb = bombs[0]!;
  const after = planHand(minus(view.hand, bomb.cards), view.level);
  const handsLeft = after.groups.length;
  if (urgent) return bomb;
  // 炸完只剩两三手，炸了抢出牌权就能走
  if (handsLeft <= 2) return bomb;
  // 对方出的是大牌型（顺子类、三带二或 A 以上的牌）且我炸弹多：炸
  const big = ['straight', 'tube', 'plate', 'fullHouse'].includes(last.play.type) || last.play.value >= 14;
  const myBombs = planHand(view.hand, view.level).groups.filter((g) => isBombType(g.type)).length;
  if (!isBomb(last.play) && big && myBombs >= 2 && handsLeft <= 6) return bomb;
  return null;
}

function bombRank(p: Play): number {
  const tier = p.type === 'jokerBomb' ? 1000 : p.type === 'straightFlush' ? 55 : p.cards.length * 10;
  return tier * 100 + p.value;
}
