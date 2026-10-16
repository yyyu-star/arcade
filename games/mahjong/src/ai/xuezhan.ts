/**
 * 川麻·血战到底的电脑（DESIGN.md 第 5 节）。只拿视图，不碰状态：看到的只有自己的牌、所有人的弃牌和明的副露、谁定了什么缺。
 * 规则只 import type 和纯函数（hand、tiles、番），不碰 rules.ts 的状态（test/arch.test.ts 检查）。
 *
 * 打牌：向听数优先，同向听比有效牌（减去看得见的张数），再加牌型倾向（清一色、对对胡、七对）；
 * 别人像听牌、自己离胡还远时，按"危险度"挑：对那家是缺门的 > 场上见了三四张的 > 他打过的 > 生张。
 * 怎么打由 style.ts 叠出来：性格、这一场的状态、场地的手软、局面（领先落后、快输光、上头）。
 * 没有随机数：要"偶尔打错"的性格用局面和这一场的状态算出来的数决定（同一局面同一选择）。
 */
import { shanten, ukeire } from '../core/hand/index.ts';
import { countsOf, kindOf, rankOf, suitKinds, suitOf, type Suit, type Tile } from '../core/tiles/index.ts';
import type { VariantAi } from '../core/variants/types.ts';
import { scoreHand, NO_CONTEXT, type XzAction, type XzView } from '../core/variants/sichuan-xuezhan/index.ts';
import { HIDDEN, SHAPE, SUITED_KINDS } from '../core/variants/sichuan-xuezhan/index.ts';
import { PERSONAS } from './personas.ts';
import { styleOf, type Style } from './style.ts';

const queKinds = (q: number): number[] => (q < 0 ? [] : suitKinds(q as Suit));

/** 这个座位能看见的每种牌的张数（自己手里的不算）：所有人的弃牌、明的副露、胡了的人亮出来的牌 */
export function visibleCounts(v: XzView): number[] {
  const c = new Array<number>(34).fill(0);
  v.seats.forEach((s, i) => {
    for (const r of s.river) if (!r.taken) c[kindOf(r.tile)]!++;
    for (const m of s.melds) for (const t of m.tiles) if (t !== HIDDEN) c[kindOf(t)]!++;
    if (s.won && i !== v.me?.seat) for (const t of s.won.hand) c[kindOf(t)]!++;
  });
  // 被碰杠胡拿走的弃牌已经算在副露、胡牌里了
  return c;
}

/** 由局面和这一场的状态算出的 0–999 的数（代替随机数，同一局面同一结果；不同场次的同一局面不一样） */
function noise(v: XzView, salt = 0): number {
  let h = 2166136261;
  const feed = (x: number): void => {
    h = Math.imul(h ^ (x & 0xff), 16777619) >>> 0;
  };
  for (const t of v.me!.hand) feed(t);
  feed(v.wall);
  feed(v.round);
  feed(salt);
  const m = v.me!.tune.mood;
  for (let i = 0; i < 4; i++) feed(m >>> (i * 8));
  return h % 1000;
}

interface Eval {
  tile: Tile;
  shanten: number;
  ukeire: number;
  score: number;
}

/** 一门的张数 */
function suitCounts(hand: readonly Tile[]): [number, number, number] {
  const n: [number, number, number] = [0, 0, 0];
  for (const t of hand) n[suitOf(kindOf(t)) as Suit]++;
  return n;
}

/** 一张牌和同门别的牌连得多紧（对子、挨着、隔一张），换三张、定缺时挑没用的 */
function connect(hand: readonly Tile[], t: Tile): number {
  const k = kindOf(t);
  let score = 0;
  for (const o of hand) {
    if (o === t) continue;
    const ko = kindOf(o);
    if (suitOf(ko) !== suitOf(k)) continue;
    const d = Math.abs(ko - k);
    score += d === 0 ? 3 : d === 1 ? 2 : d === 2 ? 1 : 0;
  }
  // 中张比边张好用
  const r = rankOf(k);
  return score * 10 + (r >= 3 && r <= 7 ? 2 : r === 2 || r === 8 ? 1 : 0);
}

/** 换三张：张数最少、但至少 3 张的那门里最没用的三张 */
export function chooseSwap(hand: readonly Tile[]): Tile[] {
  const n = suitCounts(hand);
  const suits = ([0, 1, 2] as Suit[]).filter((s) => n[s] >= 3).sort((a, b) => n[a] - n[b] || suitValue(hand, a) - suitValue(hand, b));
  const s = suits[0]!;
  return hand
    .filter((t) => suitOf(kindOf(t)) === s)
    .sort((a, b) => connect(hand, a) - connect(hand, b) || a - b)
    .slice(0, 3);
}

function suitValue(hand: readonly Tile[], s: Suit): number {
  return hand.filter((t) => suitOf(kindOf(t)) === s).reduce((a, t) => a + connect(hand, t), 0);
}

/** 定缺：张数最少的一门；一样多选更散的 */
export function chooseQue(hand: readonly Tile[]): Suit {
  const n = suitCounts(hand);
  return ([0, 1, 2] as Suit[]).sort((a, b) => n[a] - n[b] || suitValue(hand, a) - suitValue(hand, b))[0]!;
}

/**
 * 每家离胡多近（0–1000）：看碰杠数、打了多少张、牌墙还剩多少。胡了的人是 0。
 * 只用公开信息；粗，但足够让防守型的电脑在中后盘收着打
 */
function threats(v: XzView, reads: number): number[] {
  return v.seats.map((s, i) => {
    if (i === v.me!.seat || s.won) return 0;
    let t = s.melds.length * 220 + s.river.length * 45 + (108 - 53 - v.wall) * 6;
    // 会读牌的：看得出谁在做清一色（一胡就是大牌），提早当他听牌
    if (reads > 0 && flushSuit(s) >= 0) t += (350 * reads) / 1000;
    return Math.min(1000, t);
  });
}

/**
 * 这一家像不像在做清一色：明的副露全是一门（至少两组），弃牌里这一门很少。是就返回那一门，不是 -1。
 * 只看公开的副露和弃牌
 */
function flushSuit(s: XzView['seats'][number]): number {
  if (s.melds.length < 2) return -1;
  const suit = suitOf(kindOf(s.melds[0]!.tiles.find((t) => t !== HIDDEN) ?? 0));
  if (s.melds.some((m) => m.tiles.some((t) => t !== HIDDEN && suitOf(kindOf(t)) !== suit))) return -1;
  const same = s.river.filter((r) => suitOf(kindOf(r.tile)) === suit).length;
  return same * 4 <= s.river.length ? suit : -1;
}

/** 打这张牌对 opp 有多危险（0–1000）；reads 是读牌的准头（性格） */
function danger(v: XzView, k: number, opp: number, visible: readonly number[], mine: readonly number[], reads: number): number {
  const s = v.seats[opp]!;
  if (suitOf(k) === s.que) return 0;
  const seen = visible[k]! + mine[k]!;
  if (seen >= 4) return 0;
  let d = 1000 - seen * 220;
  // 看出他在做清一色：那一门危险得多，别的门几乎安全（读得越准越敢这么判断）
  const fs = reads > 0 ? flushSuit(s) : -1;
  if (fs >= 0) d = suitOf(k) === fs ? (d * (1000 + reads)) / 1000 : (d * (1000 - (reads * 7) / 10)) / 1000;
  if (s.river.some((r) => kindOf(r.tile) === k)) d = (d * 45) / 100;
  const r = rankOf(k);
  if (r === 1 || r === 9) d = (d * 70) / 100;
  else if (r === 2 || r === 8) d = (d * 85) / 100;
  return d;
}

/** 牌型倾向：清一色（某门占得多）、对对胡和七对（对子多）给想留的牌加分 */
function shapeBonus(hand: readonly Tile[], discard: Tile, p: Style, melds: number): number {
  const rest = hand.filter((t) => t !== discard);
  const n = suitCounts(rest);
  const main = Math.max(...n);
  const k = kindOf(discard);
  let bonus = 0;
  // 主门占到 10 张以上（老练的 9 张、贪的 8 张就开始）：打别的门加分（越贪越重）
  const from = p.greed >= 800 ? 8 : p.level >= 2 ? 9 : 10;
  if (main >= from && n[suitOf(k) as Suit] < main) bonus += (60 + p.greed / 10) * (main - from + 1);
  // 对子多：拆对子减分
  const c = countsOf(rest);
  const pairs = c.filter((x) => x >= 2).length;
  if (pairs >= 4 && melds === 0) bonus += countsOf(hand)[k]! >= 2 ? -(30 + p.greed / 20) : 10;
  // 贪的冲对对胡：对子、刻子三组以上就不拆
  else if (p.greed >= 700 && pairs >= 3 && countsOf(hand)[k]! >= 2) bonus -= p.greed / 8;
  return bonus;
}

function evalDiscards(v: XzView, p: Style): Eval[] {
  const me = v.me!;
  const seat = v.seats[me.seat]!;
  const hand = me.hand;
  const melds = seat.melds.length;
  const que = seat.que;
  const dead = queKinds(que);
  const allowed = SUITED_KINDS.filter((k) => suitOf(k) !== que);
  const visible = visibleCounts(v);
  const opts = v.prompt!.discard!;
  const seen = new Set<number>();
  const out: Eval[] = [];
  const threat = threats(v, p.reads);
  const maxThreat = Math.max(...threat);
  const mine = countsOf(hand);
  for (const t of opts) {
    const k = kindOf(t);
    if (seen.has(k)) continue;
    seen.add(k);
    const c = countsOf(hand);
    c[k]!--;
    const sh = shanten(c, melds, SHAPE, dead);
    const u = ukeire(c, melds, SHAPE, allowed, visible, dead).total;
    let score = -sh * 10_000 + u * 10 + shapeBonus(hand, t, p, melds);
    // 防守：有人像听牌、自己还没听时把危险度算进来。越稳的越早开始收（看起来"像听"的门槛低），
    // 一向听也肯为不点炮绕路；不防守的只在离胡还远时才管
    if (maxThreat > 700 - p.defense / 3 && sh >= 1) {
      let d = 0;
      threat.forEach((th, i) => {
        if (th > 0) d += (danger(v, k, i, visible, mine, p.reads) * th) / 1000;
      });
      const weight = (p.defense * (sh >= 2 ? 30 : p.defense >= 600 ? 16 : 6)) / 1000;
      score -= d * weight;
    }
    out.push({ tile: t, shanten: sh, ukeire: u, score });
  }
  return out.sort((a, b) => b.score - a.score || a.tile - b.tile);
}

/** 碰杠以后（再打一张最好的）向听数会不会变好 */
function afterCall(v: XzView, k: number, take: number): { shanten: number; ukeire: number } {
  const me = v.me!;
  const seat = v.seats[me.seat]!;
  const c = countsOf(me.hand);
  c[k]! -= take;
  const melds = seat.melds.length + 1;
  const dead = queKinds(seat.que);
  const allowed = SUITED_KINDS.filter((x) => suitOf(x) !== seat.que);
  const visible = visibleCounts(v);
  if (take === 3) return { shanten: shanten(c, melds, SHAPE, dead), ukeire: ukeire(c, melds, SHAPE, allowed, visible, dead).total };
  // 碰：还要打一张
  let best = { shanten: 99, ukeire: 0 };
  for (let d = 0; d < 34; d++) {
    if (!c[d]) continue;
    c[d]!--;
    const s = shanten(c, melds, SHAPE, dead);
    const u = s <= best.shanten ? ukeire(c, melds, SHAPE, allowed, visible, dead).total : 0;
    if (s < best.shanten || (s === best.shanten && u > best.ukeire)) best = { shanten: s, ukeire: u };
    c[d]!++;
  }
  return best;
}

function decideClaim(v: XzView, p: Style): XzAction {
  const c = v.prompt!.claim!;
  const me = v.me!;
  const seat = v.seats[me.seat]!;
  const k = kindOf(v.claim!.tile);
  if (c.opts.includes('ron')) {
    // 贪的性格：牌墙还多、这一把 0 番、手里离清一色不远时放过点炮，等自摸或更大的
    const hand = countsOf([...me.hand, v.claim!.tile]);
    const fan = scoreHand(hand, seat.melds, NO_CONTEXT, v.opts.cap).fan;
    const n = suitCounts(me.hand);
    const pairs = countsOf(me.hand).filter((x) => x >= 2).length;
    const skip = p.greed >= 800 && fan === 0 && v.wall > 30 && (Math.max(...n) >= 10 || pairs >= 4) && !v.claim!.rob;
    // 新手场的手软：真人打出来的 0 番小胡，偶尔放过去（牌墙还多时），让人有赢的感觉
    const soft = p.soft > 0 && fan === 0 && v.wall > 20 && !v.claim!.rob && v.seats[v.claim!.from]!.kind === 'human' && noise(v, 1) * 4 < p.soft;
    if (!skip && !soft) return { t: 'claim', w: c.w, c: 'ron' };
  }
  const dead = queKinds(seat.que);
  const now = shanten(countsOf(me.hand), seat.melds.length, SHAPE, dead);
  if (c.opts.includes('kan')) {
    const after = afterCall(v, k, 3);
    if (after.shanten <= now || (p.kanLove >= 900 && after.shanten <= now + 1)) return { t: 'claim', w: c.w, c: 'kan' };
  }
  if (c.opts.includes('pon')) {
    const after = afterCall(v, k, 2);
    const n = suitCounts(me.hand);
    const flush = Math.max(...n) >= 9 && suitOf(k) === n.indexOf(Math.max(...n));
    const pairs = countsOf(me.hand).filter((x) => x >= 2).length;
    // 七对的牌型（对子多、没副露）不碰；守门清的（爱碰低）离听还远时不为快一步碰
    const seven = seat.melds.length === 0 && pairs >= 5;
    const closed = p.pon < 300 && seat.melds.length === 0 && now >= 2 && !flush;
    const faster = after.shanten < now && !closed;
    const same = after.shanten === now && (((flush || pairs >= 3) && p.greed >= 300) || (p.pon >= 800 && after.ukeire >= 8));
    if (!seven && (faster || same)) return { t: 'claim', w: c.w, c: 'pon' };
  }
  return { t: 'claim', w: c.w, c: 'pass' };
}

function decideTurn(v: XzView, p: Style): XzAction {
  const pr = v.prompt!;
  if (pr.zimo) return { t: 'zimo' };
  const me = v.me!;
  const seat = v.seats[me.seat]!;
  const evals = evalDiscards(v, p);
  if (pr.kan?.length) {
    const best = evals[0]!.shanten;
    for (const t of pr.kan) {
      const k = kindOf(t);
      const c = countsOf(me.hand);
      const n = c[k]!;
      c[k] = 0;
      const melds = seat.melds.length + (n === 4 ? 1 : 0);
      const sh = shanten(c, melds, SHAPE, queKinds(seat.que));
      // 杠完再补一张：13 张的向听不比"打一张最好的"差就杠（爱杠的差一点也杠）
      if (sh <= best || (p.kanLove >= 900 && sh <= best + 1)) return { t: 'kan', tile: t };
    }
  }
  let pick = evals[0]!;
  // 打错：在第 2 到第 4 好里挑一张（由局面算出来，不用随机数）
  const r = noise(v);
  if (p.slip > 0 && evals.length > 1 && r < p.slip) pick = evals[1 + (r % Math.min(3, evals.length - 1))]!;
  return { t: 'discard', tile: pick.tile };
}

export function decide(v: XzView): XzAction {
  if (!v.me) throw new Error('ai: nothing to do');
  return decideAs(v, styleOf(v, PERSONAS[v.seats[v.me.seat]!.persona] ?? PERSONAS[0]!));
}

/** 按给定的参数打（模拟器的代理玩家直接给固定参数） */
export function decideAs(v: XzView, p: Style): XzAction {
  const me = v.me;
  const pr = v.prompt;
  if (!me || !pr) throw new Error('ai: nothing to do');
  if (pr.swap) return { t: 'swap', tiles: chooseSwap(me.hand) };
  if (pr.que) return { t: 'que', suit: chooseQue(me.hand) };
  if (pr.claim) return decideClaim(v, p);
  return decideTurn(v, p);
}

export const xuezhanAi: VariantAi<XzView, XzAction> = { decide };
