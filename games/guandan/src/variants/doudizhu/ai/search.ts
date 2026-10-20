/**
 * 高手的残局（docs/doudizhu.md 第 3 节）：三家剩牌合计不多时，在公开信息下做有限的搜索。
 * 不读别人的手牌：只按"没出现过的牌"随机分几种可能（底牌在地主手里是公开的），每种可能里把每个候选走法搜到底，
 * 看哪个走法赢得多。节点数封顶，超了的分支按"不知道"（0.5）算；整个过程只用调用方给的随机流。
 */
import type { Card } from '../../../core/cards.ts';
import type { Rng } from '../../../core/rng.ts';
import { type DdzPlay, type DdzView, enumerateDdz, isBombish, next3, playsBeatingDdz } from '../core/index.ts';

interface Node {
  hands: Card[][];
  turn: number;
  /** 要压的那手（首出时 null） */
  target: { seat: number; play: DdzPlay } | null;
  passes: number;
}

interface Ctx {
  landlord: number;
  /** 搜索方是不是地主那边 */
  mineIsLandlord: boolean;
  nodes: number;
  cap: number;
}

const sideIsMine = (c: Ctx, seat: number): boolean => (seat === c.landlord) === c.mineIsLandlord;

/** 走一步（play 为 null = 不要）。出完了回 1 / 0（我方赢 / 输），否则回新局面 */
function applyMove(n: Node, play: DdzPlay | null, c: Ctx): Node | number {
  const m = n.turn;
  if (!play) {
    const passes = n.passes + 1;
    if (passes >= 2) return { hands: n.hands, turn: n.target!.seat, target: null, passes: 0 };
    return { hands: n.hands, turn: next3(m), target: n.target, passes };
  }
  const left = n.hands[m]!.filter((x) => !play.cards.includes(x));
  if (left.length === 0) return sideIsMine(c, m) ? 1 : 0;
  const hands = n.hands.slice();
  hands[m] = left;
  return { hands, turn: next3(m), target: { seat: m, play }, passes: 0 };
}

function movesOf(n: Node): (DdzPlay | null)[] {
  const hand = n.hands[n.turn]!;
  const plays = n.target ? playsBeatingDdz(hand, n.target.play) : enumerateDdz(hand);
  // 先试出牌多的、点数小的（更容易早剪枝），炸弹放后面
  plays.sort((a, b) => Number(isBombish(a)) - Number(isBombish(b)) || b.cards.length - a.cards.length || a.v - b.v);
  const out: (DdzPlay | null)[] = plays.slice(0, 14);
  if (n.target) out.push(null);
  return out;
}

function solve(n: Node, c: Ctx): number {
  if (++c.nodes > c.cap) return 0.5;
  const mine = sideIsMine(c, n.turn);
  let best = mine ? 0 : 1;
  for (const mv of movesOf(n)) {
    const r = applyMove(n, mv, c);
    const val = typeof r === 'number' ? r : solve(r, c);
    if (mine) {
      if (val > best) best = val;
      if (best === 1) return 1;
    } else {
      if (val < best) best = val;
      if (best === 0) return 0;
    }
  }
  return best;
}

export interface EndgameOptions {
  samples: number;
  nodeCap: number;
}

/**
 * 在候选走法里挑赢面最大的。candidates 里 null 是"不要"，baseline 是启发式本来要走的（平手时选它）。
 * 回 undefined 表示没有分出高下（该用启发式）。
 */
export function endgamePick(v: DdzView, candidates: readonly (DdzPlay | null)[], baseline: DdzPlay | null, rng: Rng, o: EndgameOptions): DdzPlay | null | undefined {
  const me = v.seat;
  const others = [0, 1, 2].filter((s) => s !== me);
  const mineSet = new Set<Card>([...v.hand, ...v.played]);
  const unseen: Card[] = [];
  for (let c = 0; c < 54; c++) if (!mineSet.has(c)) unseen.push(c);
  // 地主手里公开的底牌（还没打出去的）
  const fixed = new Map<number, Card[]>();
  if (v.landlord >= 0 && v.landlord !== me) fixed.set(v.landlord, v.bottom.filter((c) => !v.played.includes(c)));
  const fixedAll = new Set<Card>([...fixed.values()].flat());
  const pool = unseen.filter((c) => !fixedAll.has(c));
  const need = others.map((s) => v.counts[s]! - (fixed.get(s)?.length ?? 0));
  if (need[0]! < 0 || need[1]! < 0 || need[0]! + need[1]! !== pool.length) return undefined;

  const wins = candidates.map(() => 0);
  const c: Ctx = { landlord: v.landlord, mineIsLandlord: me === v.landlord, nodes: 0, cap: 0 };
  for (let k = 0; k < o.samples; k++) {
    const deal = rng.shuffle(pool.slice());
    const hands: Card[][] = [[], [], []];
    hands[me] = v.hand.slice();
    hands[others[0]!] = [...(fixed.get(others[0]!) ?? []), ...deal.slice(0, need[0]!)];
    hands[others[1]!] = [...(fixed.get(others[1]!) ?? []), ...deal.slice(need[0]!)];
    const target = v.target && v.target.play ? { seat: v.target.seat, play: v.target.play } : null;
    // 这一轮里已经有几家"不要"，从公开的出牌记录里数
    const root: Node = { hands, turn: me, target, passes: v.trick.filter((t) => t.play === null).length };
    candidates.forEach((mv, i) => {
      const r = applyMove(root, mv, c);
      c.nodes = 0;
      c.cap = o.nodeCap;
      wins[i] = wins[i]! + (typeof r === 'number' ? r : solve(r, c));
    });
  }
  let top = 0;
  for (let i = 1; i < wins.length; i++) if (wins[i]! > wins[top]!) top = i;
  if (wins.every((w) => w === wins[0])) return undefined;
  const baseIdx = candidates.findIndex((p) => p === baseline);
  if (baseIdx >= 0 && wins[baseIdx]! >= wins[top]!) return baseline;
  return candidates[top];
}
