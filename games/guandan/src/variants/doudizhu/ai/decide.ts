/**
 * 斗地主的电脑（牌馆 PR ③，设计和数字见 docs/ai.md「斗地主」）。
 * 只读 DdzView（自己的手牌、底牌、出过的牌、各家剩几张、谁是地主），碰不到牌局状态；随机只用调用方给的种子，按用途分流（rngFor）。
 * 三档：
 * - 新手：贪心拆牌，不记牌，叫分线低又带噪声，农民不一定让队友，该压时偶尔不压，炸弹乱放；
 * - 普通：深搜拆牌，农民不压队友，对手只剩一张时不放小单张，炸弹留到收尾或对手快走完；
 * - 高手：拆得更准，记牌（知道哪些大牌已经出完），残局在公开信息下搜索。
 */
import { BIG_JOKER, type Card, SMALL_JOKER } from '../../../core/cards.ts';
import { rngFor } from '../../../core/rng.ts';
import { type DdzAction, type DdzPlay, type DdzView, beatsDdz, ddzValue, enumerateDdz, isBombish, next3, playsBeatingDdz } from '../core/index.ts';
import { handCount, leadPlays, planHand } from './hand.ts';
import { endgamePick } from './search.ts';

export type DdzLevel = 'novice' | 'normal' | 'pro';

/** 拆牌的节点封顶 */
const PLAN_CAP: Record<DdzLevel, number> = { novice: 1, normal: 250, pro: 2500 };
/** 叫 1 / 2 / 3 分要的牌力。实测地主这一边占便宜（同档对打地主胜率六七成），所以高手敢叫、新手保守（docs/ai.md「斗地主」） */
const BID_LINE: Record<DdzLevel, [number, number, number]> = {
  novice: [7, 11, 15],
  normal: [8, 11, 15],
  pro: [5, 8, 12],
};
/** 对手剩这么多张以内就舍得炸 */
const BOMB_AT: Record<DdzLevel, number> = { novice: 1, normal: 2, pro: 4 };
/** 残局搜索：剩牌合计不超过这个数才搜，每个候选搜几个可能的分牌、每个搜多少节点 */
/** 跟牌：压了会让手数多出几手以内还肯压；对手剩几张以内不管多伤也压 */
const FOLLOW: Record<DdzLevel, { slack: number; contest: number }> = { novice: { slack: 99, contest: 99 }, normal: { slack: 1, contest: 3 }, pro: { slack: 1, contest: 3 } };
const COST = { vw: 1, cb: 2 };
const TOP = { penalty: 25 };
const ENDGAME = { total: 24, samples: 6, nodeCap: 1500 };

/** 叫分的牌力：王、2、炸弹、手数 */
export function bidStrength(hand: readonly Card[], cap = PLAN_CAP.normal): number {
  const byV = new Map<number, number>();
  for (const c of hand) byV.set(ddzValue(c), (byV.get(ddzValue(c)) ?? 0) + 1);
  let s = 0;
  if (byV.has(BIG_JOKER)) s += 4;
  if (byV.has(SMALL_JOKER)) s += 3;
  if (byV.has(BIG_JOKER) && byV.has(SMALL_JOKER)) s += 2;
  s += 2 * (byV.get(15) ?? 0);
  s += byV.get(14) ?? 0;
  for (const [v, k] of byV) if (k === 4 && v < 16) s += 5;
  s += Math.max(0, 10 - handCount(hand, cap));
  return s;
}

function without(hand: readonly Card[], p: DdzPlay): Card[] {
  return hand.filter((c) => !p.cards.includes(c));
}

/** 没出现过的牌（自己手里的和公开出过的以外） */
function unseenOf(v: DdzView): Card[] {
  const seen = new Set<Card>([...v.hand, ...v.played]);
  const out: Card[] = [];
  for (let c = 0; c < 54; c++) if (!seen.has(c)) out.push(c);
  return out;
}

/** 这手牌是不是"没人压得住"（单张、对子、三张：没出现的牌里没有更大的同型；不算炸弹） */
function isTop(p: DdzPlay, unseen: readonly Card[]): boolean {
  const need = p.type === 'single' ? 1 : p.type === 'pair' ? 2 : p.type === 'triple' ? 3 : 0;
  if (!need) return false;
  const k = new Map<number, number>();
  for (const c of unseen) k.set(ddzValue(c), (k.get(ddzValue(c)) ?? 0) + 1);
  for (const [val, n] of k) if (val > p.v && n >= need) return false;
  return true;
}

interface Ctx {
  v: DdzView;
  level: DdzLevel;
  cap: number;
  hand: Card[];
  baseHands: number;
  enemyMin: number;
  unseen: Card[] | null;
}

/** 出完这手以后的评分，越小越好：剩下的手数为主，再看出掉的大小（小牌先走、多张先走），炸弹要有理由才出 */
function cost(c: Ctx, p: DdzPlay): number {
  const r = without(c.hand, p);
  if (r.length === 0) return -1000;
  const plan = planHand(r, c.cap);
  let x = plan.score + p.v * COST.vw - p.cards.length * COST.cb;
  if (isBombish(p)) x += 400;
  else if (c.unseen && c.hand.length > 3 && isTop(p, c.unseen)) x += TOP.penalty;
  return x;
}

function makeCtx(v: DdzView, level: DdzLevel): Ctx {
  const me = v.seat;
  const enemies = me === v.landlord ? [next3(me), next3(next3(me))] : [v.landlord];
  const cap = PLAN_CAP[level];
  return {
    v,
    level,
    cap,
    hand: v.hand,
    baseHands: handCount(v.hand, cap),
    enemyMin: Math.min(...enemies.map((e) => v.counts[e]!)),
    unseen: level === 'pro' ? unseenOf(v) : null,
  };
}

/** 领出：从拆法给的候选里挑 */
function chooseLead(c: Ctx): DdzPlay {
  const plan = planHand(c.hand, c.cap);
  let opts = leadPlays(plan).filter((p) => !isBombish(p) || p.cards.length === c.hand.length);
  if (!opts.length) opts = enumerateDdz(c.hand);
  // 对手只剩一张：别放单张（实在只有单张就放最大的）
  if (c.level !== 'novice' && c.enemyMin === 1) {
    const multi = opts.filter((p) => p.cards.length > 1);
    if (multi.length) opts = multi;
    else return enumerateDdz(c.hand).filter((p) => p.type === 'single').reduce((a, b) => (b.v > a.v ? b : a));
  }
  return opts.map((p) => ({ p, k: cost(c, p) })).sort((a, b) => a.k - b.k || a.p.v - b.p.v)[0]!.p;
}

/** 跟牌：压或不要（null = 不要） */
function chooseFollow(c: Ctx, rng: ReturnType<typeof rngFor>): DdzPlay | null {
  const { v, level } = c;
  const me = v.seat;
  const target = v.target!;
  const options = playsBeatingDdz(c.hand, target.play);
  if (!options.length) return null;
  const fromMate = me !== v.landlord && target.seat !== v.landlord;
  // 队友出的：让他走（新手有一半时候看不出来）
  if (fromMate && (level !== 'novice' || rng.int(2) === 0)) return null;
  const normal = options.filter((p) => !isBombish(p));
  let pick: DdzPlay | null = null;
  if (normal.length) {
    const best = normal.map((p) => ({ p, k: cost(c, p) })).sort((a, b) => a.k - b.k || a.p.v - b.p.v)[0]!.p;
    // 压了会把牌拆散（手数比"出掉一手"多出 2 手以上）而对手还早：不压。新手不算这个
    const worse = level === 'novice' ? 0 : handCount(without(c.hand, best), c.cap) - (c.baseHands - 1);
    if (worse <= FOLLOW[level].slack || c.enemyMin <= FOLLOW[level].contest) pick = best;
  }
  if (!pick) {
    const bombs = options.filter(isBombish).sort((a, b) => a.v - b.v);
    if (bombs.length) {
      const b = bombs[0]!;
      const left = without(c.hand, b);
      const finishing = left.length === 0 || handCount(left, c.cap) <= 2;
      const urgent = c.enemyMin <= BOMB_AT[level] || finishing;
      if (level === 'novice' ? rng.int(3) === 0 : urgent) pick = b;
    }
  }
  if (pick && level === 'novice' && !isBombish(pick) && rng.int(5) === 0) pick = null;
  return pick;
}

/** 高手的残局：剩牌不多时在公开信息下搜一遍，搜不出高下就用启发式的结果 */
function endgame(c: Ctx, base: DdzPlay | null, lead: boolean, seed: string | number): DdzPlay | null {
  const v = c.v;
  const total = v.counts[0]! + v.counts[1]! + v.counts[2]!;
  if (total > ENDGAME.total) return base;
  const plays = (lead ? enumerateDdz(c.hand) : playsBeatingDdz(c.hand, v.target!.play))
    .map((p) => ({ p, k: cost(c, p) }))
    .sort((a, b) => a.k - b.k)
    .slice(0, 9)
    .map((x) => x.p);
  const cands: (DdzPlay | null)[] = [...plays];
  if (base && !cands.includes(base)) cands.unshift(base);
  if (!lead) cands.push(null);
  const rng = rngFor(seed, 'ddz-endgame', v.dealNo, v.seat, v.step);
  const r = endgamePick(v, cands, base, rng, ENDGAME);
  return r === undefined ? base : r;
}

/** 轮到 v.seat 时的动作；没轮到它或这一阶段不用动回 null。同一视图同一种子结果相同 */
export function decideDdz(v: DdzView, level: DdzLevel, seed: string | number): DdzAction | null {
  if (v.turn !== v.seat) return null;
  const me = v.seat;
  if (v.phase === 'bid') {
    const rng = rngFor(seed, 'ddz-bid', v.dealNo, me, v.step);
    const st = bidStrength(v.hand, PLAN_CAP[level]) + (level === 'novice' ? rng.int(5) - 2 : 0);
    const line = BID_LINE[level];
    let want = st >= line[2] ? 3 : st >= line[1] ? 2 : st >= line[0] ? 1 : 0;
    if (want <= v.bid) want = 0;
    return { type: 'bid', seat: me, bid: want };
  }
  if (v.phase !== 'play') return null;
  const rng = rngFor(seed, 'ddz-play', v.dealNo, me, v.step);
  const c = makeCtx(v, level);
  const lead = !v.target;
  // 一手能出完就出
  const whole = enumerateDdz(c.hand).find((p) => p.cards.length === c.hand.length && (lead || beatsDdz(p, v.target!.play!)));
  if (whole) return { type: 'play', seat: me, cards: whole.cards };
  let play = lead ? chooseLead(c) : chooseFollow(c, rng);
  if (level === 'pro') play = endgame(c, play, lead, seed);
  return play ? { type: 'play', seat: me, cards: play.cards } : { type: 'pass', seat: me };
}

/** "提示"：能出的牌按电脑（普通档）的评分排，电脑会出的在最前；电脑会不要时也照评分排（由画面决定要不要提醒"建议不要"） */
export function hintDdz(v: DdzView): DdzPlay[] {
  const c = makeCtx(v, 'normal');
  const lead = !v.target;
  const opts = (lead ? enumerateDdz(v.hand) : playsBeatingDdz(v.hand, v.target!.play)).map((p) => ({ p, k: cost(c, p) })).sort((a, b) => a.k - b.k);
  const list = opts.map((x) => x.p);
  const a = decideDdz(v, 'normal', 0);
  if (a && a.type === 'play') {
    const i = list.findIndex((p) => p.cards.length === a.cards.length && p.cards.every((x) => a.cards.includes(x)));
    if (i > 0) list.unshift(list.splice(i, 1)[0]!);
  }
  return list;
}
