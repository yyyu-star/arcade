/** 0.1.2 的电脑对手原样副本，只给 tools/sim.ts 当"上一版普通"基准（--mode normal-vs-prev），不进产品包。 */
/**
 * 电脑对手。只读 viewFor 给出的信息（自己的手牌、公开出牌记录、各家张数、级数），不看别人的牌。
 *
 * 思路（大白话）：
 * - 理牌：按"最少几手出完"拆牌（plan.ts），逢人配留着凑炸弹/同花顺。
 * - 记牌：按公开出牌记录算每个点数还剩几张（memory.ts），知道自己哪手牌已经"最大"、别人还可能有什么炸弹。
 * - 领出：快出完时先出"最大"的牌拿住出牌权，最后一手留给最后；平时先出最难处理的小牌型，控制牌（王、级牌、最大的牌）留后；
 *   队友快走完（≤ 6 张）时送他接得住的小单张、小对子；对手快走完时避开他一把能走的牌型。
 * - 跟牌：对手出的，用"最小、拆牌最少"的压，不随手用逢人配、不拆炸弹；对手快走完时出大牌顶住、该炸就炸。
 * - 队友出的一般不压：除非能借此一把出完，或者队友明显出不完而对手快走了。
 * - 进贡交最不影响牌型的那张最大牌；还贡还最没用的 ≤ 10 的牌。
 * 难度只调"记性、配合、失误"：简单不记牌、不配合、偶尔犯新手错；普通只记大牌；困难全记。
 * 随机性来自种子 + 步数，同样的局面同样的种子做同样的决定。
 */
import {
  canPass,
  isBomb,
  isWild,
  legalPlays,
  nextSeat,
  partnerOf,
  rankOf,
  rngFor,
  teamOf,
  type Action,
  type Card,
  type Play,
  type PlayerView,
  type Rng,
} from '../../src/variants/guandan/core/index.ts';
import { buildMemory, bombPossible, isTop, type Memory, type Recall } from './memory.ts';
import { groupToPlay, isBombType, planHand, type Group, type HandPlan } from './plan.ts';

export type Difficulty = 'easy' | 'normal' | 'hard';

export interface BotConfig {
  seed: string | number;
  difficulty?: Difficulty;
  /** 只给模拟调参用：在难度预设上覆盖部分参数 */
  tuning?: Partial<Tuning>;
}

export interface Tuning {
  /** 记牌程度 */
  recall: Recall;
  /** 是否和队友配合（不压队友、送牌、帮队友顶） */
  teamwork: boolean;
  /** 对手剩几张以内算"快出完"，开始拼命压 */
  threat: number;
  /** 不紧急时，愿意为压牌多付出的拆牌代价 */
  breakTolerance: number;
  /** 犯"新手错"的概率：跟牌时只看能不能压、领出时随手出最小的 */
  slip: number;
  /** 队友剩几张以内开始送牌 */
  feedAt: number;
  /** 跟对手的单张、对子时额外愿意付的拆牌代价（其他牌型按 6 成算）：越大越爱抢出牌权 */
  chase: number;
  /** 队友已经不要、我是这一轮最后能顶的人时，再多愿意付的代价 */
  lastChance: number;
}

const TUNING: Record<Difficulty, Tuning> = {
  // 失误率按 npm run sim 校准（2026-10-13）：简单对普通整局胜率约 3 成，困难对普通 6 成以上
  easy: { recall: 'none', teamwork: false, threat: 2, breakTolerance: 1.2, slip: 0.1, feedAt: 0, chase: 0.6, lastChance: 0.2 },
  normal: { recall: 'high', teamwork: true, threat: 6, breakTolerance: 0.6, slip: 0.05, feedAt: 6, chase: 1.6, lastChance: 0.5 },
  hard: { recall: 'full', teamwork: true, threat: 8, breakTolerance: 0.6, slip: 0, feedAt: 6, chase: 1.6, lastChance: 0.5 },
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

/** 一次决策里的上下文；理牌结果按手牌缓存，同一次决策里不重复算。 */
interface Ctx {
  view: PlayerView;
  tune: Tuning;
  rng: Rng;
  mem: Memory;
  partner: number;
  /** 队友剩几张；已出完为 0 */
  partnerLeft: number;
  opps: number[];
  oppMin: number;
  cache: Map<string, HandPlan>;
}

function planOf(ctx: Ctx, hand: readonly Card[]): HandPlan {
  const key = hand.join(',');
  let p = ctx.cache.get(key);
  if (!p) {
    p = planHand(hand, ctx.view.level);
    ctx.cache.set(key, p);
  }
  return p;
}

function makeCtx(view: PlayerView, tune: Tuning, rng: Rng): Ctx {
  const partner = partnerOf(view.seat);
  const opps = [nextSeat(view.seat), (view.seat + 3) % 4].filter((s) => !view.finished.includes(s));
  const oppCounts = opps.map((s) => view.counts[s]!);
  return {
    view,
    tune,
    rng,
    mem: buildMemory(view, tune.recall),
    partner,
    partnerLeft: view.finished.includes(partner) ? 0 : view.counts[partner]!,
    opps,
    oppMin: oppCounts.length ? Math.min(...oppCounts) : 99,
    cache: new Map(),
  };
}

/** 电脑的决定；不该它行动时返回 null。 */
export function decide(view: PlayerView, cfg: BotConfig): Action | null {
  const diff = cfg.difficulty ?? 'normal';
  const tune = cfg.tuning ? { ...TUNING[diff], ...cfg.tuning } : TUNING[diff];
  if (view.myTribute) return tributeAction(view);
  if (view.phase !== 'play' || view.turn !== view.seat) return null;
  const p = choosePlay(view, tune, rngFor(cfg.seed, 'bot', view.seat, view.step));
  return p ? toAction(view.seat, p) : { type: 'pass', seat: view.seat };
}

/** 给玩家的"聪明提示"：困难电脑在这个位置会怎么出（不要时返回 null）。返回的一定是 legalPlays 里的一手（牌可能换成同点的另一张）。 */
export function suggest(view: PlayerView, seed: string | number = 'hint'): Play | null {
  if (view.phase !== 'play' || view.turn !== view.seat) return null;
  return choosePlay(view, TUNING.hard, rngFor(seed, 'bot', view.seat, view.step));
}

function choosePlay(view: PlayerView, tune: Tuning, rng: Rng): Play | null {
  const plays = legalPlays(view);
  if (plays.length === 0) return null;
  // 能一把出完就出完
  const finisher = plays.find((p) => p.cards.length === view.hand.length);
  if (finisher) return finisher;
  const ctx = makeCtx(view, tune, rng);
  const last = view.trick.last;
  if (tune.slip > 0 && rng.next() < tune.slip) {
    const s = slipPlay(ctx, plays);
    if (s !== undefined) return s;
  }
  if (!last) return chooseLead(ctx);
  const p = teamOf(last.seat) === teamOf(view.seat) ? followPartner(ctx, plays) : followOpponent(ctx, plays);
  if (p) return p;
  return canPass(view) ? null : plays[0]!;
}

/**
 * 新手错：领出时出手里最小的单张/对子（不管牌型规划）；跟牌时只要有不用炸弹的就压最小的，队友的也压。
 * 返回 undefined 表示这次不犯错。
 */
function slipPlay(ctx: Ctx, plays: Play[]): Play | null | undefined {
  const normal = plays.filter((p) => !isBomb(p) && !p.cards.some((c) => isWild(c, ctx.view.level)));
  if (normal.length === 0) return undefined;
  normal.sort((a, b) => a.value - b.value || a.cards.length - b.cards.length);
  if (!ctx.view.trick.last) {
    const small = normal.filter((p) => p.type === 'single' || p.type === 'pair');
    return small[0] ?? normal[0]!;
  }
  return normal[0]!;
}

function tributeAction(view: PlayerView): Action {
  const t = view.myTribute!;
  // 在允许的牌里，挑拿走后理牌最省的；同样省就挑最小的（还贡时）
  let best = t.allowed[0]!;
  let bestCost = Infinity;
  for (const c of t.allowed) {
    const cost = planHand(minus(view.hand, [c]), view.level).cost;
    if (cost < bestCost - 1e-9) {
      best = c;
      bestCost = cost;
    }
  }
  return t.kind === 'tribute' ? { type: 'tribute', seat: view.seat, card: best } : { type: 'return', seat: view.seat, card: best };
}

// ───────────────────────── 工具 ─────────────────────────

/** 一手的"最低张"大小，用来决定领出顺序（小的先走）。 */
function lowCard(g: Pick<Group, 'type' | 'rank' | 'value'>): number {
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

function bombRank(p: Play): number {
  const tier = p.type === 'jokerBomb' ? 1000 : p.type === 'straightFlush' ? 55 : p.cards.length * 10;
  return tier * 100 + p.value;
}

/** 控制牌：大王小王、级牌（含逢人配当级牌）的单张对子，或者记牌后已经最大的一手。 */
function isControl(ctx: Ctx, g: Pick<Play, 'type' | 'value' | 'rank' | 'cards'>): boolean {
  if ((g.type === 'single' || g.type === 'pair') && g.value >= 15) return true;
  return isTop(ctx.mem, g);
}

/**
 * 同点有多张时，换成不在理牌计划里的炸弹/同花顺中的那张（只换同点数的牌，牌型不变）。
 * legalPlays 按手牌顺序挑牌，可能挑到同花顺里的那一张。
 */
function refine(ctx: Ctx, p: Play, protect: Set<Card>): Play {
  if (isBomb(p) || !p.cards.some((c) => protect.has(c))) return p;
  const used = new Set(p.cards);
  const level = ctx.view.level;
  const cards = p.cards.map((c) => {
    if (!protect.has(c) || isWild(c, level)) return c;
    const alt = ctx.view.hand.find((x) => !used.has(x) && !protect.has(x) && !isWild(x, level) && rankOf(x) === rankOf(c));
    if (alt === undefined) return c;
    used.add(alt);
    used.delete(c);
    return alt;
  });
  return { ...p, cards };
}

function protectedCards(plan: HandPlan): Set<Card> {
  const out = new Set<Card>();
  for (const g of plan.groups) if (isBombType(g.type)) for (const c of g.cards) out.add(c);
  return out;
}

/** 收尾判断：除了别人压不过的牌，只剩不到一手普通牌（先出大的拿住出牌权，最后一手留到最后）。 */
function canRunOut(ctx: Ctx, plan: HandPlan): boolean {
  let rest = 0;
  for (const g of plan.groups) if (!isBombType(g.type) && !isTop(ctx.mem, g)) rest++;
  return rest <= 1;
}

/** 这手出掉后手里还剩几手非炸弹的牌、多少炸弹。 */
function shape(plan: HandPlan): { normal: number; bombs: number } {
  let normal = 0;
  let bombs = 0;
  for (const g of plan.groups) {
    if (isBombType(g.type)) bombs++;
    else normal++;
  }
  return { normal, bombs };
}

interface Cand {
  p: Play;
  /** 拆了理牌计划里的炸弹/同花顺 */
  breaks: boolean;
  /** 出这手比"它本来就是理牌里的一手"多付出的代价（拆牌、用逢人配），越小越好 */
  delta: number;
  top: boolean;
  after: HandPlan;
}

function evalPlays(ctx: Ctx, plays: Play[], limit: number): Cand[] {
  const base = planOf(ctx, ctx.view.hand);
  const protect = protectedCards(base);
  const out: Cand[] = [];
  for (const raw of plays.slice(0, limit)) {
    const p = refine(ctx, raw, protect);
    const after = planOf(ctx, minus(ctx.view.hand, p.cards));
    const breaks = !isBomb(p) && p.cards.some((c) => protect.has(c));
    out.push({ p, breaks, delta: after.cost - (base.cost - 1), top: !isBomb(p) && isTop(ctx.mem, p), after });
  }
  return out;
}

// ───────────────────────── 领出 ─────────────────────────

function chooseLead(ctx: Ctx): Play {
  const { view, tune, mem } = ctx;
  const plan = planOf(ctx, view.hand);
  const bombs = plan.groups.filter((g) => isBombType(g.type));
  const normal = plan.groups.filter((g) => !isBombType(g.type));
  if (normal.length === 0) return groupToPlay([...bombs].sort((a, b) => bombRank(groupToPlay(a)) - bombRank(groupToPlay(b)))[0]!);

  const tops = normal.filter((g) => isTop(mem, g));
  const rest = normal.filter((g) => !isTop(mem, g));

  // 收尾：除了"最大"的牌只剩一手（或没有），先出最大的拿住出牌权，最后一手留到最后
  if (tops.length > 0 && rest.length <= 1) {
    // 出张数最多的那手最大牌，尽快把牌走掉
    return groupToPlay([...tops].sort((a, b) => b.cards.length - a.cards.length || a.value - b.value)[0]!);
  }
  // 只剩一手普通牌 + 炸弹：直接出这手，被压了再炸回来
  if (normal.length === 1) return groupToPlay(normal[0]!);

  // 队友快走完：送他接得住的小牌（对手不急的时候）
  if (tune.teamwork && ctx.partnerLeft > 0 && ctx.partnerLeft <= tune.feedAt && ctx.oppMin > 2 && rest.length > 2) {
    const feed = feedPartner(ctx, normal);
    if (feed) return feed;
  }

  let pool = normal;
  // 对手快走完：避开他一把能走的张数（单张、对子……），出他接不住的大牌型
  if (ctx.oppMin <= tune.threat) {
    const danger = new Set(ctx.opps.map((s) => view.counts[s]!).filter((n) => n <= tune.threat));
    const safe = normal.filter((g) => !danger.has(g.cards.length));
    if (safe.length) {
      pool = safe;
      // 张数比所有危险对手都多的牌型，他们只能用炸弹压
      const beyond = safe.filter((g) => g.cards.length > Math.max(...danger));
      if (beyond.length) pool = beyond;
    } else {
      // 只有危险牌型：出最大的顶住
      return groupToPlay([...normal].sort((a, b) => Number(isTop(mem, b)) - Number(isTop(mem, a)) || b.value - a.value)[0]!);
    }
  }
  // 控制牌（王、级牌、记牌后最大的牌）留到后面
  const cheap = pool.filter((g) => !isControl(ctx, g));
  if (cheap.length) pool = cheap;
  // 先出最难处理的小牌型：最低张小的先走；多张的牌型（顺子、三带二等）别人难接，同样小时先走
  const score = (g: Group) => lowCard(g) - (g.cards.length >= 5 ? 1.5 : g.cards.length >= 3 ? 0.5 : 0);
  pool = [...pool].sort((a, b) => score(a) - score(b) || b.cards.length - a.cards.length);
  return groupToPlay(pool[0]!);
}

/** 给快走完的队友送牌：他剩 1 张送单张，2 张优先送对子，其余送最小的单张或对子。 */
function feedPartner(ctx: Ctx, normal: Group[]): Play | null {
  const left = ctx.partnerLeft;
  const prefer = left === 1 ? ['single'] : left === 2 ? ['pair', 'single'] : left === 3 ? ['single', 'pair'] : ['pair', 'single'];
  for (const t of prefer) {
    const g = normal.filter((x) => x.type === t && x.value <= 10).sort((a, b) => a.value - b.value)[0];
    if (g) return groupToPlay(g);
  }
  if (left <= 2) {
    // 没有现成的：拆一张最小的单牌送过去
    const hand = ctx.view.hand.filter((c) => !isWild(c, ctx.view.level));
    const c = hand[0];
    if (c !== undefined) {
      const p = legalPlays(ctx.view).find((x) => x.type === 'single' && x.cards[0] === c);
      if (p && p.value <= 10) return p;
    }
  }
  return null;
}

// ───────────────────────── 跟牌 ─────────────────────────

function followPartner(ctx: Ctx, plays: Play[]): Play | null {
  const { view, tune } = ctx;
  if (!tune.teamwork) return null;
  const normal = plays.filter((p) => !isBomb(p)).sort((a, b) => a.value - b.value);
  if (normal.length === 0) return null;
  const cands = evalPlays(ctx, normal, 12);
  // 能借此一把出完：这手别人压不过，压过后除了最大的牌只剩一手，拿到出牌权就能一路走完
  for (const c of cands) if (c.top && canRunOut(ctx, c.after)) return c.p;
  // 队友明显出不完、对手快走了：队友这手对手压得过，就替他顶一手最大的
  const last = view.trick.last!;
  const nextOpp = nextSeat(view.seat);
  const nextActive = !view.finished.includes(nextOpp) && !view.trick.passed[nextOpp];
  if (nextActive && view.counts[nextOpp]! <= 2 && ctx.partnerLeft > 4 && !isTop(ctx.mem, last.play)) {
    const tops = cands.filter((c) => c.top);
    if (tops.length) return tops.sort((a, b) => a.delta - b.delta)[0]!.p;
    return cands.sort((a, b) => b.p.value - a.p.value)[0]!.p;
  }
  return null;
}

/**
 * 不急时跟对手的牌，愿意付出的拆牌代价。出牌权很值钱：单张、对子基本都压（拆顺子、拆三张也压），
 * 三张、三带二、顺子类拆得不大就跟；我是出牌人的下家时先顶；队友已经不要了（或出完了），我是这一轮最后能顶的人，再多让一点。
 */
function followTolerance(ctx: Ctx, target: Play): number {
  const { view, tune } = ctx;
  let tol = tune.breakTolerance + (target.type === 'single' || target.type === 'pair' ? tune.chase : tune.chase * 0.6);
  const partnerDone = view.finished.includes(ctx.partner) || view.trick.passed[ctx.partner];
  if (partnerDone) tol += tune.lastChance;
  // 我是出牌人的下家：先顶上去，别指望队友
  else if (view.trick.last && nextSeat(view.trick.last.seat) === view.seat) tol += tune.lastChance * 0.4;
  return tol;
}

/**
 * 明显浪费控制牌：牌还多时用王压 10 以下的小牌；或者手里控制牌只剩这一张，还拿它（级牌）去压 8 以下的牌。
 * 记牌后已经最大的级牌、A 不算浪费——压上去就拿回出牌权。
 */
function wastesControl(ctx: Ctx, c: Cand, target: Play): boolean {
  if (ctx.view.hand.length <= 12) return false;
  // 王单张永远压不过，但王是最后收尾的本钱，不拿来抢小牌
  if (c.p.value >= 16 && target.value <= 10) return true;
  if (c.top) return false;
  if (c.p.value === 15 && target.value <= 8) {
    let controls = 0;
    for (const x of ctx.view.hand) if (rankOf(x) >= 16 || rankOf(x) === ctx.view.level) controls++;
    return controls <= c.p.cards.length;
  }
  return false;
}

function followOpponent(ctx: Ctx, plays: Play[]): Play | null {
  const { view, tune, mem } = ctx;
  const last = view.trick.last!;
  const lastLeft = view.counts[last.seat]!;
  const urgent = ctx.oppMin <= tune.threat || lastLeft === 0;
  // 危急：对手剩的张数少到一两手就能走
  const critical = ctx.oppMin <= 2 || (lastLeft > 0 && lastLeft <= 4);
  const normal = plays.filter((p) => !isBomb(p)).sort((a, b) => a.value - b.value || a.extra - b.extra);
  const bombs = plays.filter((p) => isBomb(p)).sort((a, b) => bombRank(a) - bombRank(b));
  const base = planOf(ctx, view.hand);
  const baseShape = shape(base);

  const cands = evalPlays(ctx, normal, 16);
  if (cands.length) {
    // 记牌后发现能用最大的牌拿回出牌权，且之后只剩一两手：现在就出，别留着
    const finishing = cands.filter((c) => c.top && canRunOut(ctx, c.after));
    if (finishing.length) return finishing.sort((a, b) => a.delta - b.delta)[0]!.p;

    if (critical) {
      // 顶住：优先出别人压不过的（拆牌少的、小的）；没有就出最大的
      const tops = cands.filter((c) => c.top);
      const cheapTops = tops.filter((c) => c.delta <= 0.8);
      if (cheapTops.length) return cheapTops.sort((a, b) => a.delta - b.delta || a.p.value - b.p.value)[0]!.p;
      if (tops.length) return tops.sort((a, b) => a.p.value - b.p.value)[0]!.p;
      const big = [...cands].sort((a, b) => b.p.value - a.p.value)[0]!;
      if (big.delta <= 2.5 || bombs.length === 0) return big.p;
    } else {
      // 不拆炸弹/同花顺的压法里，挑代价最小的（差不多时挑小的）
      const pool = cands.filter((c) => !c.breaks);
      let best: Cand | null = null;
      for (const c of pool) if (!best || c.delta < best.delta - 0.2) best = c;
      if (best) {
        if (urgent && best.delta <= tune.breakTolerance + 1) return best.p;
        if (best.delta <= followTolerance(ctx, last.play) && !wastesControl(ctx, best, last.play)) return best.p;
        // 只剩两手了，压上去拿回出牌权
        if (baseShape.normal <= 2 && best.top) return best.p;
      }
    }
  }
  if (bombs.length === 0) return null;
  // 炸弹：挑最小的一个，优先不拆别的牌型
  const bombCands = evalPlays(ctx, bombs, 6);
  const bomb = bombCands.sort((a, b) => a.delta - b.delta + (bombRank(a.p) - bombRank(b.p)) * 1e-6)[0]!;
  const after = shape(bomb.after);
  if (urgent) {
    // 对手快走完但还不至于下一手就走，而且手里炸弹只有一个：最后关头再用
    if (!critical && baseShape.bombs <= 1 && after.normal > 3) return null;
    return bomb.p;
  }
  // 记牌：别人已经不可能有更大的炸弹，这一炸稳拿出牌权
  const safe = !bombPossible(mem, bomb.p);
  // 炸完只剩两手，抢出牌权就能走（只剩一手，或者炸了不会被反炸）
  if (after.normal <= 1 || (after.normal <= 2 && safe)) return bomb.p;
  // 对方出的是大牌型（顺子类、三带二或 A 以上的牌）且我炸弹多：炸
  const big = ['straight', 'tube', 'plate', 'fullHouse'].includes(last.play.type) || last.play.value >= 14;
  if (!isBomb(last.play) && big && baseShape.bombs >= 2 && after.normal <= 6) return bomb.p;
  return null;
}
