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
 * 难度只调"记性、配合、失误"：新手、简单不记牌、不配合、偶尔犯新手错（新手还会手软）；普通只记大牌；较强、困难全记。
 * 性格、每场的状态、随局面的调整在 persona.ts：给了性格才有，没给就是难度预设本身。
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
} from '../core/index.ts';
import { buildMemory, bombPossible, isTop, type Memory } from './memory.ts';
import { groupToPlay, isBombType, planHand, type Group, type HandPlan } from './plan.ts';
import { TUNING, tuningFor, type Difficulty, type PersonaId, type Tuning } from './persona.ts';

export type { Difficulty, PersonaId, Tuning };

export interface BotConfig {
  seed: string | number;
  difficulty?: Difficulty;
  /** 性格（persona.ts）：不给就是难度预设本身 */
  persona?: PersonaId;
  /** 这一场的种子：每场的状态按它抽（不给就用 seed）。seed 每步都变的地方（联机房间）要另给 */
  match?: string | number;
  /** 只给模拟调参用：在算好的参数上覆盖部分 */
  tuning?: Partial<Tuning>;
}

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
  if (view.myTribute) return tributeAction(view);
  if (view.phase !== 'play' || view.turn !== view.seat) return null;
  const tuned = tuningFor(view, cfg.difficulty ?? 'normal', cfg.persona, cfg.match ?? cfg.seed);
  const tune = cfg.tuning ? { ...tuned, ...cfg.tuning } : tuned;
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
  // 新手错只在不要紧的时候犯：有人一两张就能走时还乱出，看起来就是"蠢"，不是"弱"
  if (tune.slip > 0 && rng.next() < tune.slip && ctx.oppMin > 2) {
    const s = slipPlay(ctx, plays);
    if (s !== undefined) return s;
  }
  if (!last) return chooseLead(ctx);
  const p = teamOf(last.seat) === teamOf(view.seat) ? followPartner(ctx, plays) : followOpponent(ctx, plays);
  if (p) return p;
  return canPass(view) ? null : plays[0]!;
}

/**
 * 新手错：领出时出手里最小的单张/对子（不管牌型规划）；跟对手时只要有不用炸弹的就压最小的。
 * 新手也不会去拆自己的炸弹/同花顺，更不会压队友——那看起来是"蠢"，不是"弱"：
 * 用到理牌里炸弹/同花顺的压法不算（同点有别的牌时先换一张），队友出的牌不犯错。
 * 返回 undefined 表示这次不犯错。
 */
function slipPlay(ctx: Ctx, plays: Play[]): Play | null | undefined {
  const { view } = ctx;
  if (view.trick.last && teamOf(view.trick.last.seat) === teamOf(view.seat)) return undefined;
  const protect = protectedCards(planOf(ctx, view.hand), view.level);
  const normal = plays
    .filter((p) => !isBomb(p) && !p.cards.some((c) => isWild(c, view.level)))
    .map((p) => refine(ctx, p, protect))
    .filter((p) => !p.cards.some((c) => protect.has(c)));
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

/**
 * 理牌计划里炸弹/同花顺的牌。hardOnly 时只算不靠逢人配凑成的：逢人配凑的炸弹拆掉只是少用一次万能牌，
 * 代价已经算在理牌估价里，不该一刀切地不许拆（否则会为了"不拆"去用这个炸弹压一手三带二）。
 */
function protectedCards(plan: HandPlan, level: number, hardOnly = false): Set<Card> {
  const out = new Set<Card>();
  for (const g of plan.groups) {
    if (!isBombType(g.type)) continue;
    if (hardOnly && g.cards.some((c) => isWild(c, level))) continue;
    for (const c of g.cards) out.add(c);
  }
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
  /** 拆了理牌计划里天然的炸弹/同花顺 */
  breaks: boolean;
  /** 出这手比"它本来就是理牌里的一手"多付出的代价（拆牌、用逢人配），越小越好 */
  delta: number;
  top: boolean;
  after: HandPlan;
}

/**
 * 普通牌型里每用一张逢人配额外记的代价。理牌估价只看"出完这手剩下的牌好不好打"，逢人配原本在计划里补顺子时，
 * 换个地方用看起来不花钱；但它留到后面能凑炸弹、救残局，人也不爱看电脑（和提示）随手把万能牌打出去。
 */
const WILD_SPEND = 1;
/**
 * 牌还多（15 张以上）时，拿逢人配凑三带二、对子、三张、单张去跟牌的代价（0.6.1）：这几种牌型手里常有别的压法，
 * 逢人配留着后面凑炸弹、补顺子更值钱；困难档原来约每五副就有一次拿它配对子去跟三带二，人看着很亏。顺子类不加（补顺子本来就是它的用处）
 */
const WILD_SPEND_EARLY = 3;
const WILD_CHEAP_TYPES: readonly string[] = ['single', 'pair', 'triple', 'fullHouse'];

function evalPlays(ctx: Ctx, plays: Play[], limit: number): Cand[] {
  const level = ctx.view.level;
  const base = planOf(ctx, ctx.view.hand);
  const protect = protectedCards(base, level);
  const hard = protectedCards(base, level, true);
  const out: Cand[] = [];
  for (const raw of plays.slice(0, limit)) {
    const p = refine(ctx, raw, protect);
    const after = planOf(ctx, minus(ctx.view.hand, p.cards));
    const bomb = isBomb(p);
    const breaks = !bomb && p.cards.some((c) => hard.has(c));
    let delta = after.cost - (base.cost - 1);
    const spend = ctx.view.hand.length >= 15 && WILD_CHEAP_TYPES.includes(p.type) ? WILD_SPEND_EARLY : WILD_SPEND;
    if (!bomb) for (const c of p.cards) if (isWild(c, level)) delta += spend;
    out.push({ p, breaks, delta, top: !bomb && isTop(ctx.mem, p), after });
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
  // 对手快走完：避开他一把能走的张数（单张、对子……），出他接不住的大牌型。新手场的电脑有时手软，照常出
  if (ctx.oppMin <= tune.threat && !(tune.soft > 0 && ctx.rng.next() < tune.soft)) {
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
  // 控制牌（王、级牌、记牌后最大的牌）留到后面；急性子有时等不及，先亮出来
  const rush = tune.rush > 0 && ctx.rng.next() < tune.rush;
  const cheap = pool.filter((g) => !isControl(ctx, g));
  if (cheap.length && !rush) pool = cheap;
  else if (rush && pool.length > cheap.length) return groupToPlay(pool.filter((g) => isControl(ctx, g)).sort((a, b) => b.cards.length - a.cards.length || a.value - b.value)[0]!);
  // 先出最难处理的小牌型：最低张小的先走；多张的牌型（顺子、三带二等）别人难接，同样小时先走
  const score = (g: Group) => lowCard(g) - (g.cards.length >= 5 ? 1.5 : g.cards.length >= 3 ? 0.5 : 0);
  pool = [...pool].sort((a, b) => score(a) - score(b) || b.cards.length - a.cards.length);
  // 差不多的两手换着先出，同样的牌型不总是一个出法
  if (tune.jitter > 0 && pool.length > 1 && score(pool[1]!) - score(pool[0]!) <= 2 && ctx.rng.next() < tune.jitter) return groupToPlay(pool[1]!);
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
  // 危急：对手剩的张数少到一两手就能走；或者出牌的人刚出完，没人压就由他对家接风，而他对家也不多了
  const critical = ctx.oppMin <= 2 || (lastLeft > 0 && lastLeft <= 4) || (lastLeft === 0 && ctx.oppMin <= 8);
  // 开局（双方牌都还多）：出牌权没那么值钱，炸弹留着
  const early = view.hand.length >= 18 && ctx.oppMin >= 12;
  // 新手场的电脑手软：对手快走完、本该拼命顶的时候，有时就放过去了（让人有赢的机会）
  if (critical && tune.soft > 0 && canPass(view) && ctx.rng.next() < tune.soft) return null;
  const normal = plays.filter((p) => !isBomb(p)).sort((a, b) => a.value - b.value || a.extra - b.extra);
  const bombs = plays.filter((p) => isBomb(p)).sort((a, b) => bombRank(a) - bombRank(b));
  const base = planOf(ctx, view.hand);
  const baseShape = shape(base);

  const cands = evalPlays(ctx, normal, 16);
  if (cands.length) {
    // 记牌后发现能用最大的牌拿回出牌权，且之后只剩一两手：现在就出，别留着
    const finishing = cands.filter((c) => c.top && canRunOut(ctx, c.after));
    if (finishing.length) return finishing.sort((a, b) => a.delta - b.delta)[0]!.p;

    // 危急时手里有炸弹：别为了出一张普通的大牌去拆炸弹/同花顺，那还不如直接炸；拆不拆都只剩拆的压法时走下面的炸弹分支
    const hold = critical && bombs.length > 0 ? cands.filter((c) => !c.breaks) : cands;
    if (critical && hold.length) {
      // 顶住：优先出别人压不过的（拆牌少的、小的）；没有就出最大的
      const tops = hold.filter((c) => c.top);
      const cheapTops = tops.filter((c) => c.delta <= 0.8);
      if (cheapTops.length) return cheapTops.sort((a, b) => a.delta - b.delta || a.p.value - b.p.value)[0]!.p;
      if (tops.length) return tops.sort((a, b) => a.p.value - b.p.value)[0]!.p;
      const big = [...hold].sort((a, b) => b.p.value - a.p.value)[0]!;
      if (big.delta <= 2.5 || bombs.length === 0) return big.p;
    } else if (!critical) {
      // 不拆炸弹/同花顺的压法里，挑代价最小的（差不多时挑小的）
      const pool = cands.filter((c) => !c.breaks);
      let best: Cand | null = null;
      for (const c of pool) if (!best || c.delta < best.delta - 0.2) best = c;
      // 换着出：代价差不多的另一手（比如压对 5 还是对 7）
      if (best && tune.jitter > 0 && ctx.rng.next() < tune.jitter) {
        const alt = pool.find((c) => c !== best && c.delta <= best!.delta + 0.4 && !wastesControl(ctx, c, last.play));
        if (alt) best = alt;
      }
      if (best) {
        if (urgent && best.delta <= tune.breakTolerance + 1) return best.p;
        if (best.delta <= followTolerance(ctx, last.play) && (!wastesControl(ctx, best, last.play) || (tune.rush > 0 && ctx.rng.next() < tune.rush))) return best.p;
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
  // 手里能炸几次：理牌里的炸弹，加上这次用的不是其中之一（比如拆顺子凑出的同花顺）
  const protect = protectedCards(base, view.level);
  const held = baseShape.bombs + (bomb.p.cards.every((c) => protect.has(c)) ? 0 : 1);
  // 爱炸（bombLove ≥ 1）不急也肯炸、炸得早；捂炸弹（≤ -1）留到最后；中间是原来的做法
  const love = tune.bombLove >= 1 ? 1 : tune.bombLove <= -1 ? -1 : 0;
  if (urgent) {
    // 对手快走完但还不至于下一手就走，而且手里炸弹只有一个（捂炸弹的人两个也留着）：最后关头再用
    if (!critical && love <= 0 && held <= (love < 0 ? 2 : 1) && after.normal > 3) return null;
    return bomb.p;
  }
  // 记牌：别人已经不可能有更大的炸弹，这一炸稳拿出牌权
  const safe = !bombPossible(mem, bomb.p);
  // 炸完只剩两手，抢出牌权就能走（只剩一手，或者炸了不会被反炸）
  if (after.normal <= 1 || (after.normal <= 2 && safe)) return bomb.p;
  // 对方出的是大牌型（顺子类、三带二或 A 以上的牌）且我炸弹多：炸。开局不这么干，除非炸完就快走完了
  const big = ['straight', 'tube', 'plate', 'fullHouse'].includes(last.play.type) || last.play.value >= (love > 0 ? 13 : 14);
  const need = love > 0 ? 1 : love < 0 ? 3 : 2;
  const room = (early ? 3 : 6) + (love > 0 ? 1 : love < 0 ? -2 : 0);
  if (!isBomb(last.play) && big && baseShape.bombs >= need && after.normal <= room) return bomb.p;
  return null;
}
