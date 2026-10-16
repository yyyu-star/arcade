/**
 * 规则引擎：dispatch(state, action) → { state, events, error }，以及开局、回放。
 * 一天的流程：盘前（startDay：推进题材阶段、掷好今天的行情、生成群聊）→ 玩家买卖 → 开盘结算（open）
 * → 月底还月供 → 三选一奖励 → 事件（如有）→ 下个月。
 */
import { BALANCE, fx } from './balance.ts';
import { makeComments, makeMessages, makeRecs } from './chat.ts';
import { effectLabel, holdingParts, itemEffect, leadPart, leverageEffect, shortParts } from './explain.ts';
import { dayQuips, makeNews, stockQuip } from './story.ts';
import {
  BILL_NAMES,
  COLLATERAL_IDS,
  EXT_REACT_LINES,
  collateralTerms,
  EVENTS,
  GEAR_INTEREST_BILL,
  SHORT_GOAL_BILL,
  SURPRISE_BILLS,
  FRIENDS,
  ITEMS,
  MAX_DIFFICULTY,
  THEME_IDS,
  calendarOf,
  clampDifficulty,
  eventById,
  friendById,
  isFriendId,
  isItemId,
  isPersonaId,
  isStockId,
  isThemeId,
  itemById,
  personaAccount,
  personaById,
  stockById,
  stocksOf,
} from './content/index.ts';
import type { EventCtx, HoldingCtx, MarketRules, Rules } from './hooks.ts';
import { isLiveTier, liveLevered } from './liveTiers.ts';
import {
  MOODS,
  advanceStage,
  baseMarketRules,
  dirOf,
  feelOf,
  marketReturn,
  marketRulesFor,
  moveStocks,
  newStock,
  nextMood,
  rollDH,
  round2,
  rulesFor,
  runBillMult,
  rulesOf,
  settleTheme,
  stageDays,
  uniformInt,
  warmUpTheme,
  type RawPart,
} from './market.ts';
import { rngFor } from './rng.ts';
import { fitRoles, forwardRet, isTrack, realDH, realEnter, realMarketPct, realMood, realNextStage, realThemeRet, tapeIndex, trackMarketRet, trackMood, trackThemeRet, warmUpReal } from './real.ts';
import { themeTruth } from './chat.ts';
import { announceMonth, beginMonth, newTempo, premarketQuiet, tempoClose, tempoMonthEnd, type TempoCtx } from './tempo.ts';
import { needsHeadline } from './chat.ts';
import { realFromSegment, type RealMarket, type Segment } from './segment.ts';
import type {
  AccountEffect,
  Action,
  DayPlan,
  AutoSellReason,
  BillExtra,
  BuySize,
  CollateralId,
  ExtState,
  Loan,
  ChainLink,
  Comment,
  DayReport,
  Feel,
  GameEvent,
  GameState,
  Holding,
  HoldingMove,
  HoldingStep,
  ItemTrigger,
  MarketNotice,
  MessageJudge,
  PersonaId,
  Rarity,
  RewardCard,
  RunSetup,
  Stage,
  ThemeId,
  ThemeMove,
} from './types.ts';

export const MONTHS = BALANCE.monthDays.length;

export interface DispatchOptions {
  /** 是否收集事件，默认 true；模拟器可关掉 */
  events?: boolean;
  /** 直接修改传入的状态而不复制（模拟器提速用） */
  inPlace?: boolean;
}

export interface DispatchResult {
  state: GameState;
  events: GameEvent[];
  /** 非法操作的原因；此时 state 为原状态 */
  error: string | null;
}

interface Emitter {
  events: GameEvent[];
  enabled: boolean;
}

function emit(em: Emitter, e: GameEvent): void {
  if (em.enabled) em.events.push(e);
}

// ================================================================ 查询：日历、月供

/** 第 month 月（1..12）的交易日数。 */
export function daysInMonth(month: number): number {
  return BALANCE.monthDays[month - 1] ?? 0;
}

/** 0.10.0 娱乐短局的开局设置：规则从 BALANCE.short 抄进这局，首付比例按难度 */
export function shortSetup(persona: PersonaId, difficulty: number): RunSetup {
  const { months, billMult, goal } = BALANCE.short;
  const lv = clampDifficulty(difficulty);
  return { persona, difficulty: lv, short: { months, billMult, goal: goal[Math.min(lv, goal.length) - 1] as number } };
}

/** 短局最后要交的首付（元，取整到百元）：开局资产 × 这局的首付比例；不是短局为 0。开局面板用开局设置算，局里用 shortGoal */
export function shortGoalFor(setup: Readonly<RunSetup> | null): number {
  const g = setup?.short?.goal ?? 0;
  return g > 0 ? Math.round((g * (setup?.account ?? personaAccount(setup?.persona ?? 'newbie'))) / 100) * 100 : 0;
}

export function shortGoal(s: Readonly<GameState>): number {
  return shortGoalFor(s.setup);
}

/** 这一局打几个月：实盘（0.6.0）、娱乐短局（0.10.0）按开局设置，完整一年 12 个月。 */
export function runMonths(s: Readonly<GameState>): number {
  return s.setup?.live?.months ?? s.setup?.short?.months ?? MONTHS;
}

/** 一局的总交易日数。 */
export function totalDays(): number {
  let n = 0;
  for (const d of BALANCE.monthDays) n += d;
  return n;
}

/** 第 month 月的基础月供（未计难度、信用卡）：(base + step × (month−1)) × growth^(month−1)，取整到百元。 */
export function baseBill(month: number): number {
  let v = BALANCE.bills.base + BALANCE.bills.step * (month - 1);
  for (let m = 1; m < month; m++) v *= BALANCE.bills.growth;
  return Math.round(v / 100) * 100;
}

/**
 * 第 month 月的常规月供（取整到百元）：基础月供 × 规则表的 billMult（难度、人设、众筹炒股）× mult（信用卡、房东涨租）。
 * 第二个参数可以直接给规则表，也可以给难度等级（再给人设、道具）。
 */
export function billFor(
  month: number,
  difficulty: number | Readonly<Rules> = 1,
  mult = 1,
  persona: PersonaId = 'newbie',
  items: readonly string[] = [],
): number {
  const r = typeof difficulty === 'number' ? rulesFor(items, difficulty, persona) : difficulty;
  return Math.round((baseBill(month) * r.billMult * mult) / 100) * 100;
}

/**
 * 隐藏：本局的突发账单（由种子决定，月初才公布）。一局 count 次，第 k 次落在 windows[k] 里的某个月；
 * 名目不重复，金额在 BALANCE.surprise.amounts[id] 内均匀抽取，乘难度和人设的突发账单倍数（surpriseMult），取整到百元。
 */
export function surprisePlan(seed: string, difficulty = 1, persona: PersonaId = 'newbie', billMult = 1): { month: number; extra: BillExtra }[] {
  const p = BALANCE.surprise;
  const rng = rngFor(seed, 'surprise');
  const n = Math.min(p.windows.length, p.count[0] + rng.int(p.count[1] - p.count[0] + 1));
  const pool = SURPRISE_BILLS.filter((d) => p.amounts[d.id] !== undefined);
  // billMult：实盘的账单倍数（0.6.0），和常规月供打同样的折
  const mult = rulesFor([], difficulty, persona).surpriseMult * billMult;
  const out: { month: number; extra: BillExtra }[] = [];
  for (let k = 0; k < n && pool.length > 0; k++) {
    const [lo, hi] = p.windows[k] as readonly [number, number];
    const month = lo + rng.int(hi - lo + 1);
    const def = pool.splice(rng.int(pool.length), 1)[0] as (typeof pool)[number];
    const [a, b] = p.amounts[def.id] as readonly [number, number];
    const amount = Math.round(((a + rng.next() * (b - a)) * mult) / 100) * 100;
    out.push({ month, extra: { id: def.id, name: def.name, amount } });
  }
  return out;
}

/**
 * 隐藏：第 6 级"股灾"的月份和出事的交易日（由种子决定）。月份在那个月月初才公布（state.notice），
 * 出事的是哪一天不公布（BALANCE.crash.day 的范围是公开的规则）。难度不到 6 级时为 null。
 */
export function crashPlan(seed: string, difficulty: number, real: Readonly<RealMarket> | null = null): { month: number; dayInMonth: number } | null {
  if (clampDifficulty(difficulty) < CRASH_LEVEL) return null;
  const c = BALANCE.crash;
  // 真实行情：对齐到股灾可能出现的那几个月里大盘真实跌得最多的一天（跌得不够狠就还按种子）
  if (real) {
    let best: { month: number; dayInMonth: number; r: number } | null = null;
    for (const month of c.months) {
      let first = 0;
      for (let m = 1; m < month; m++) first += daysInMonth(m);
      for (let k = 0; k < daysInMonth(month); k++) {
        const r = real.market[tapeIndex(real, first + k)] ?? 0;
        if (!best || r < best.r) best = { month, dayInMonth: k, r };
      }
    }
    if (best && best.r <= BALANCE.real.crashReal) return { month: best.month, dayInMonth: best.dayInMonth };
  }
  const rng = rngFor(seed, 'crash');
  const month = c.months[rng.int(c.months.length)] as number;
  const [lo, hi] = c.day;
  const dayInMonth = Math.min(daysInMonth(month) - 1, uniformInt(rng, lo, hi));
  return { month, dayInMonth };
}

/** 今天的市场规则：当月日历 → 难度；股灾那个月大盘更容易转熊（BALANCE.crash.bear）。 */
export function dayMarketRules(s: Readonly<GameState>): MarketRules {
  const mr = marketRulesFor(s.month, s.difficulty);
  if (s.notice?.id === 'crash') mr.bearBias += BALANCE.crash.bear;
  return mr;
}

/** 股灾那个月的突发账单 id（不参加平时的随机突发账单）。 */
const CRASH_BILL_ID = 'bailout';

/** "股灾"从第几级开始。 */
export const CRASH_LEVEL = 6;

function crashNotice(month: number, real: boolean): MarketNotice {
  const [lo, hi] = real ? [0, daysInMonth(month) - 1] : BALANCE.crash.day;
  return {
    id: 'crash',
    month,
    name: '市场传闻',
    text: `传闻这个月要出大事：第 ${lo + 1}–${hi + 1} 个交易日里的某一天起，所有风口会一起降温`,
  };
}

/** 本月还剩几个交易日（含今天；盘前时今天还没结算）。 */
export function daysLeftInMonth(s: Readonly<GameState>): number {
  return Math.max(0, daysInMonth(s.month) - s.dayInMonth);
}

function firstEmpty(s: Readonly<GameState>): number {
  return s.slots.findIndex((h) => h === null);
}

/**
 * 每只持仓占账户的比例的分母：基础格数（4）；持仓超过基础格数（多开一格且拿满）时，
 * 多出来的每只只摊薄 fx('extra_slot','share') 份（1 = 按持仓数平分；0.5 = 拿满 5 只时每只占 1/4.5，总仓位 111%）。
 * 所以空着的基础格是现金、拖累收益，多开的那一格空着不拖累。
 */
export function holdingBase(s: Readonly<GameState>, holdings = usedUnits(s)): number {
  const extra = Math.max(0, holdings - BALANCE.slots);
  return BALANCE.slots + extra * (fx('extra_slot', 'share') || 1);
}

// ================================================================ 0.4 C：仓位、押跌、抵押

/** 一格持仓占几份钱（缺省 1 份 = 0.3 的一格）。 */
export function unitsOf(h: Readonly<Holding> | null | undefined): number {
  return h ? (h.units ?? 1) : 0;
}

/** 已经用掉的份数。 */
export function usedUnits(s: Readonly<GameState>): number {
  let n = 0;
  for (const h of s.slots) n += unitsOf(h);
  return n;
}

/** 还剩几份现金（总份数 = 格子数）；except 给出时把那一格当成卖掉（换股用）。 */
export function freeUnits(s: Readonly<GameState>, except?: number): number {
  const back = except !== undefined ? unitsOf(s.slots[except]) : 0;
  return Math.max(0, round2(s.slots.length - usedUnits(s) + back));
}

/** 按仓位选项算这次买几份（不够最小一份时为 0）。 */
export function sizeUnits(s: Readonly<GameState>, size: BuySize, except?: number): number {
  const free = freeUnits(s, except);
  const E = BALANCE.ext;
  const want = size === 'heavy' ? free : size === 'half' ? E.half : E.taste;
  const u = Math.min(want, free);
  return u + 1e-9 >= E.minUnit ? u : 0;
}

/**
 * 押跌的顺风逆风（pp / 天）：大环境最近在涨，押跌逆风；在跌，押跌顺风。
 * 真实行情看开盘前 20 个交易日大盘的累计涨跌（× shortWeather / 2，封顶 ±1.5 × shortWeather）；合成行情看今天的天气（晴 −、雨 +）。
 */
export function shortWind(s: Readonly<GameState>, mood: GameState['mood']): number {
  const k = BALANCE.ext.shortWeather;
  const real = s.real;
  if (!real) return mood === 'bull' ? -k : mood === 'bear' ? k : 0;
  const i = tapeIndex(real, s.dayIndex);
  let sum = 0;
  for (let j = Math.max(0, i - 20); j < i; j++) sum += real.market[j] ?? 0;
  const trend = sum / 100;
  return round2(Math.max(-1.5 * k, Math.min(1.5 * k, (-trend * k) / 2)));
}

/** 现在能不能押跌：押跌许可证、人设，或者难度够高。 */
export function canShortNow(s: Readonly<GameState>): boolean {
  return !!s.ext && (rulesOf(s).canShort || s.difficulty >= BALANCE.ext.shortLevel);
}

/** 欠银行多少（元）。 */
export function debtOf(s: Readonly<GameState>): number {
  let d = 0;
  for (const l of s.ext?.loans ?? []) d += l.amount;
  return round2(d);
}

/** 这件抵押物现在能押多少、利息多少；不能押时给原因。 */
export function loanOffer(s: Readonly<GameState>, id: CollateralId): { amount: number; rate: number; error: string | null } | null {
  const terms = collateralTerms(id, s.difficulty);
  if (!s.ext || !terms) return null;
  const rate = Math.round(terms.rate * rulesOf(s).interestMult * 10000) / 10000;
  const E = BALANCE.ext;
  let error: string | null = null;
  if (s.ext.log.seized.includes(id)) error = '已经被银行收走了';
  else if (s.ext.loans.some((l) => l.id === id)) error = '已经押在银行了';
  else if (s.month < E.bankMonth) error = `第 ${E.bankMonth} 个月起银行才肯借钱`;
  else if (s.phase !== 'premarket') error = '银行只在开盘前办事';
  else {
    const d = debtOf(s) + terms.amount;
    if (s.account + terms.amount < d * E.borrowLine) error = '银行看了看你的账户：家底太薄，不借';
  }
  return { amount: terms.amount, rate, error };
}

function newExt(): ExtState {
  return {
    loans: [],
    called: false,
    learned: [],
    log: {
      heavy: 0,
      maxUnits: 0,
      maxStock: null,
      adds: 0,
      trims: 0,
      shorts: 0,
      shortPnl: 0,
      shortBest: null,
      squeezes: 0,
      stubborn: 0,
      borrowed: [],
      calls: 0,
      seized: [],
      redeemed: [],
      interest: 0,
    },
  };
}

/** 0.4 C：群友对重仓、押跌、抵押的反应（只发事件，不改局面；说话的人得在群里）。 */
function react(s: Readonly<GameState>, em: Emitter, kind: string, key: number): Comment | null {
  if (!em.enabled || !s.ext) return null;
  const lines = (EXT_REACT_LINES[kind] ?? []).filter((l) => s.friends.some((f) => f.id === l.friendId));
  if (lines.length === 0) return null;
  const l = lines[rngFor(s.seed, 'react', kind, key).int(lines.length)] as (typeof lines)[number];
  const c: Comment = { friendId: l.friendId, text: l.text, mood: l.mood };
  emit(em, { type: 'comment', ...c });
  return c;
}

function learn(s: GameState, id: string, em: Emitter): void {
  if (!s.ext || s.ext.learned.includes(id)) return;
  s.ext.learned.push(id);
  emit(em, { type: 'learned', id });
}

function noteUnits(s: GameState, h: Holding): void {
  if (!s.ext) return;
  const u = unitsOf(h);
  if (u > s.ext.log.maxUnits) {
    s.ext.log.maxUnits = u;
    s.ext.log.maxStock = h.stockId;
  }
}

/** 银行看账户：跌破警戒线打电话，再跌就收走抵押物（先收借得最多的）。 */
function checkBank(s: GameState, em: Emitter, cause: 'trade' | 'bill' = 'trade'): { called: boolean; seized: CollateralId[] } {
  const out = { called: false, seized: [] as CollateralId[] };
  const x = s.ext;
  if (!x || x.loans.length === 0) {
    if (x) x.called = false;
    return out;
  }
  const E = BALANCE.ext;
  while (x.loans.length > 0 && s.account < debtOf(s) * E.seizeLine) {
    const loan = [...x.loans].sort((a, b) => b.amount - a.amount)[0] as Loan;
    const before = s.account;
    const debt = debtOf(s);
    const penalty = round2(loan.amount * E.penalty);
    setAccount(s, s.account - loan.amount - penalty);
    x.loans = x.loans.filter((l) => l !== loan);
    if (!x.log.seized.includes(loan.id)) x.log.seized.push(loan.id);
    out.seized.push(loan.id);
    emit(em, { type: 'seized', id: loan.id, amount: loan.amount, penalty, before, after: s.account, debt, line: round2(debt * E.seizeLine), cause });
    learn(s, 'seize', em);
  }
  const low = x.loans.length > 0 && s.account < debtOf(s) * E.callLine;
  if (low && !x.called) {
    x.log.calls += 1;
    out.called = true;
    emit(em, { type: 'bankCalled', account: s.account, debt: debtOf(s) });
    learn(s, 'call', em);
  }
  x.called = low;
  return out;
}

/** 第 slot 格的持仓今天能不能卖（T+1；FOMO 体质取消 T+1）。 */
export function canSell(s: Readonly<GameState>, slot: number): boolean {
  const h = s.slots[slot];
  return !!h && (h.boughtDay < s.today.day || rulesOf(s).noT1);
}

/** 今天没空看盘（加班事件）：不能买卖。 */
export function isBusy(s: Readonly<GameState>): boolean {
  return s.busyDay !== null && s.busyDay === s.today.day && s.phase === 'premarket';
}

// ================================================================ 校验

function slotError(s: Readonly<GameState>, slot: number | undefined, allowReplace: boolean): string | null {
  if (slot === undefined) return firstEmpty(s) >= 0 ? null : '手里已经拿满了，要先卖掉一只，或者选一只换掉';
  if (!Number.isInteger(slot) || slot < 0 || slot >= s.slots.length) return '没有这个位置';
  if (s.slots[slot] && !allowReplace) return '这个位置已经有股票了';
  return null;
}

/** 返回操作不合法的原因；合法返回 null。 */
export function validate(s: Readonly<GameState>, a: Action): string | null {
  if (s.phase === 'won' || s.phase === 'lost') return '本局已结束';
  switch (a.type) {
    case 'buy': {
      if (s.phase !== 'premarket') return '现在还不能买卖';
      if (isBusy(s)) return '今天在加班，没空买卖';
      const rec = Number.isInteger(a.rec) ? s.today.recs[a.rec] : undefined;
      if (!rec) return '没有这条推荐';
      if (rec.taken) return '这只今天已经买过了';
      if (s.today.buysLeft <= 0) return '今天能买的次数用完了';
      if (s.slots.some((h) => h?.stockId === rec.stockId)) return '手里已经有这只了';
      const only = rulesOf(s).onlyRoles;
      if (only && !only.includes(stockById(rec.stockId).role)) return '这个月只能买老实股';
      if ((a.size !== undefined || a.short) && !s.ext) return '这一局没有这个玩法';
      if (a.size !== undefined && a.size !== 'taste' && a.size !== 'half' && a.size !== 'heavy') return '没有这种买法';
      if (a.short && !canShortNow(s)) return '还没解锁押跌';
      const err = slotError(s, a.slot, true);
      if (err) return err;
      if (a.slot !== undefined && s.slots[a.slot] && !canSell(s, a.slot)) return '今天买的，明天才能卖（也不能换掉）';
      if (s.ext && sizeUnits(s, a.size ?? 'taste', a.slot) <= 0) return '现金用完了：先卖掉一些，或者选一只换掉';
      return null;
    }
    case 'add': {
      if (!s.ext) return '这一局没有这个玩法';
      if (s.phase !== 'premarket') return '现在还不能买卖';
      if (isBusy(s)) return '今天在加班，没空买卖';
      const h = Number.isInteger(a.slot) ? s.slots[a.slot] : undefined;
      if (!h) return '这个位置是空的';
      if (s.stocks[h.stockId]?.delisted) return '这只已经退市了';
      if (s.today.buysLeft <= 0 && !rulesOf(s).freeAdd) return '今天能买的次数用完了';
      if (freeUnits(s) + 1e-9 < BALANCE.ext.minUnit) return '现金用完了，加不了';
      return null;
    }
    case 'trim': {
      if (!s.ext) return '这一局没有这个玩法';
      if (s.phase !== 'premarket') return '现在还不能买卖';
      if (isBusy(s)) return '今天在加班，没空买卖';
      const h = Number.isInteger(a.slot) ? s.slots[a.slot] : undefined;
      if (!h) return '这个位置是空的';
      if (unitsOf(h) < 2 * BALANCE.ext.minUnit - 1e-9) return '只剩一小口了，要卖就清仓';
      return canSell(s, a.slot) ? null : '今天买的，明天才能卖';
    }
    case 'borrow': {
      if (!s.ext) return '这一局没有这个玩法';
      if (!(COLLATERAL_IDS as readonly string[]).includes(a.id)) return '没有这件东西';
      const o = loanOffer(s, a.id);
      if (!o) return '这个难度还押不了这件东西';
      return o.error;
    }
    case 'repay': {
      if (!s.ext) return '这一局没有这个玩法';
      if (s.phase !== 'premarket') return '银行只在开盘前办事';
      const loan = s.ext.loans.find((l) => l.id === a.id);
      if (!loan) return '这件东西没有押在银行';
      return s.account >= loan.amount ? null : '钱不够还';
    }
    case 'sell': {
      if (s.phase !== 'premarket') return '现在还不能买卖';
      if (isBusy(s)) return '今天在加班，没空买卖';
      if (!Number.isInteger(a.slot) || !s.slots[a.slot]) return '这个位置是空的';
      return canSell(s, a.slot) ? null : '今天买的，明天才能卖';
    }
    case 'open':
      return s.phase === 'premarket' ? null : '现在还不能开盘';
    case 'pickReward': {
      if (s.phase !== 'reward' || !s.reward) return '现在不是领奖励的时候';
      const card = Number.isInteger(a.index) ? s.reward.cards[a.index] : undefined;
      if (!card) return '没有这张奖励卡';
      if (card.kind === 'stock') return slotError(s, a.slot, true);
      return null;
    }
    case 'skipReward':
      return s.phase === 'reward' ? null : '现在不是领奖励的时候';
    case 'choose':
      if (s.phase !== 'event' || !s.event) return '现在没有事件';
      return a.option === 0 || a.option === 1 ? null : '只有两个选项';
    default:
      return `未知操作：${String((a as { type?: unknown }).type)}`;
  }
}

// ================================================================ 持仓

function feelNow(s: Readonly<GameState>, theme: ThemeId): Feel {
  return feelOf(s.themes[theme]?.history ?? []);
}

function newHolding(
  s: GameState,
  stockId: string,
  boughtDay: number,
  source: Holding['source'],
  extra: { recBy?: string | null; firstBuy?: boolean; contra?: boolean } = {},
): Holding {
  const theme = stockById(stockId).theme;
  const buyFeel = feelNow(s, theme);
  if (!s.stats.acquired.includes(stockId)) s.stats.acquired.push(stockId);
  return {
    stockId,
    boughtDay,
    value: 1,
    todayRet: null,
    lowBuy: buyFeel === 'cold' || buyFeel === 'cooling',
    buyFeel,
    buyStage: s.themes[theme]?.stage ?? 'cold',
    source,
    recBy: extra.recBy ?? null,
    firstBuy: extra.firstBuy ?? false,
    contra: extra.contra ?? false,
    sawEbb: false,
  };
}

/** 清掉一格持仓并记一笔交易。 */
function closeHolding(s: GameState, slot: number, reason: 'sell' | 'replace' | AutoSellReason | 'end'): Holding | null {
  const h = s.slots[slot];
  if (!h) return null;
  s.stats.trades.push({
    stockId: h.stockId,
    buyDay: h.boughtDay,
    sellDay: s.dayIndex,
    stage: h.buyStage,
    feel: h.buyFeel,
    ret: round2((h.value - 1) * 100),
    reason,
    recBy: h.recBy,
    contra: h.contra,
    guard: h.buyStage === 'climax' && h.sawEbb,
    ...(s.ext ? { short: !!h.short, units: unitsOf(h) } : {}),
  });
  s.slots[slot] = null;
  return h;
}

function markOp(s: GameState): void {
  if (s.today.ops === 0) s.stats.activeDays += 1;
  s.today.ops += 1;
}

/** 道具变化后补齐持仓格（多开一格）。格子只增不减。 */
function syncSlots(s: GameState): void {
  const n = rulesOf(s).slots;
  while (s.slots.length < n) s.slots.push(null);
}

function addFriend(s: GameState, id: string, em: Emitter): void {
  if (s.friends.some((f) => f.id === id)) return;
  const def = friendById(id);
  let topics: ThemeId[] = [];
  if (def.topics === 'random2') {
    const rng = rngFor(s.seed, 'friendTopics', id);
    const pool = [...s.themeIds];
    for (let k = 0; k < 2 && pool.length > 0; k++) topics.push(pool.splice(rng.int(pool.length), 1)[0] as ThemeId);
  } else if (Array.isArray(def.topics)) {
    topics = [...(def.topics as readonly ThemeId[])];
  }
  s.friends.push({ id, hits: 0, total: 0, topics });
  seeFriend(s, id);
  emit(em, { type: 'friendJoined', friendId: id, topics: [...topics] });
}

function seeFriend(s: GameState, id: string): void {
  if (!s.stats.seenFriends.includes(id)) s.stats.seenFriends.push(id);
}

function seeItem(s: GameState, id: string): void {
  if (!s.stats.seenItems.includes(id)) s.stats.seenItems.push(id);
}

/** 获得道具。taken：算不算"拿过道具"（人设自带、调试开局设置的不算）；untilMonth：临时道具到那个月月底失效。 */
function gainItem(s: GameState, id: string, em: Emitter, taken = true, untilMonth?: number): void {
  if (s.items.includes(id)) return;
  s.items.push(id);
  seeItem(s, id);
  if (taken && !s.stats.itemsTaken.includes(id)) s.stats.itemsTaken.push(id);
  if (untilMonth !== undefined) s.expiring.push({ id, month: untilMonth });
  itemById(id).onGain?.({ state: s, addFriend: (f) => addFriend(s, f, em) });
  syncSlots(s);
}

/**
 * 0.5.4：结算用的两项累计（炒股净赚、还掉的账单）。只在开局就有这两项的局里累计：
 * 0.5.3 打到一半的存档读进来时没有这两项，从半路开始记会得到半截数，宁可让结算走旧说法。
 */
function addStat(s: GameState, key: 'tradeMoney' | 'billMoney', delta: number): void {
  const v = s.stats[key];
  if (v !== undefined) s.stats[key] = round2(v + delta);
}

function setAccount(s: GameState, v: number): void {
  s.account = Math.max(0, round2(v));
  if (s.account > s.stats.peakAccount) s.stats.peakAccount = s.account;
}

// ================================================================ 月份与交易日

function startMonth(s: GameState, month: number, em: Emitter): void {
  s.month = month;
  s.dayInMonth = 0;
  // 0.5：先定本月主题（规则表从这一刻起叠加主题的修改，月供也按它算）
  beginMonth(s);
  const rules = rulesOf(s);
  const base = billFor(month, rules, s.nextBillMult);
  s.nextBillMult = 1;
  const extras = surprisePlan(s.seed, s.difficulty, s.persona, runBillMult(s.setup))
    .filter((x) => x.month === month)
    .map((x) => ({ ...x.extra }));
  // 第 6 级股灾那个月：爆仓的亲戚找你借钱救急（按常规月供的比例，和传闻一起在月初公布）
  const crashMonth = crashPlan(s.seed, s.difficulty, s.real ?? null);
  if (crashMonth && crashMonth.month === month && BALANCE.crash.bill > 0) {
    const def = SURPRISE_BILLS.find((d) => d.id === CRASH_BILL_ID);
    extras.push({ id: CRASH_BILL_ID, name: def?.name ?? '借钱救急', amount: Math.round((base * BALANCE.crash.bill) / 100) * 100 });
  }
  // 0.10.0 娱乐短局：最后一个月月底多交一笔首付（这局的最终目标，开局时就说了）
  const goal = shortGoal(s);
  if (goal > 0 && month === runMonths(s)) extras.push({ id: SHORT_GOAL_BILL.id, name: SHORT_GOAL_BILL.name, amount: goal });
  // 0.11.0 实盘杠杆：每月的融资利息（开局资产的比例，取整到百元）
  const interest = gearInterest(s);
  if (interest > 0) extras.push({ id: GEAR_INTEREST_BILL.id, name: GEAR_INTEREST_BILL.name, amount: interest });
  let amount = base;
  for (const x of extras) amount += x.amount;
  s.bill = { month, name: BILL_NAMES[month - 1] ?? '账单', amount, extras };
  emit(em, { type: 'monthStarted', month, days: daysInMonth(month), bill: { ...s.bill, extras: extras.map((x) => ({ ...x })) }, calendar: calendarOf(month).id });
  // 第 6 级股灾：那个月月初公布传闻
  const crash = crashPlan(s.seed, s.difficulty, s.real ?? null);
  s.notice = crash && crash.month === month ? crashNotice(month, !!s.real) : null;
  if (s.notice) emit(em, { type: 'marketNotice', notice: { ...s.notice } });
  // 事件留下的延后结算
  const due = s.pending.filter((p) => p.month === month);
  s.pending = s.pending.filter((p) => p.month !== month);
  for (const p of due) {
    const def = eventById(p.id);
    if (!def.settle) continue;
    const r = def.settle({ state: s, rng: rngFor(s.seed, 'pending', month, p.id), badMult: rules.eventBadMult }, p.amount);
    const before = s.account;
    setAccount(s, s.account + r.delta);
    emit(em, { type: 'pendingSettled', id: p.id, amount: p.amount, delta: round2(s.account - before), text: r.text });
  }
  for (const id of [...s.items]) {
    const def = itemById(id);
    def.onMonthStart?.({
      state: s,
      addAccount(amount, text) {
        const before = s.account;
        setAccount(s, s.account + amount);
        emit(em, { type: 'itemTriggered', itemId: id, slot: null, stockId: null, text, delta: round2(s.account - before) });
      },
    });
  }
  if (s.tempo) announceMonth(s, tempoCtx(s, em));
  s.stats.monthOpen = s.account;
}

/** 0.5：节奏模块要用的引擎能力（加钱、发道具、发事件）。 */
function tempoCtx(s: GameState, em: Emitter): TempoCtx {
  return {
    emit: (e) => emit(em, e),
    addCash(amount) {
      const before = s.account;
      setAccount(s, s.account + amount);
      return round2(s.account - before);
    },
    gainItem: (id) => gainItem(s, id, em),
    itemPool: () => rewardCandidates(s).item.map((c) => c.id),
  };
}

/**
 * 真实行情的今天（盘前就定好，收盘揭晓）：大盘涨跌 = amp × 真实涨跌 + 日历和难度的加成；
 * 各风口热度变化 = 真实行业的超额收益 + 日历、直播间、震荡等加成；阶段按热度判定。
 */
function realPlan(s: GameState, real: Readonly<RealMarket>, mr: MarketRules, crash: boolean): DayPlan {
  if (isTrack(real)) return trackPlan(s, real, mr, crash);
  const R = BALANCE.real;
  const day = s.dayIndex;
  const i = tapeIndex(real, day);
  const dH: Partial<Record<ThemeId, number>> = {};
  const baseDH: Partial<Record<ThemeId, number>> = {};
  for (const id of s.themeIds) {
    const t = s.themes[id];
    if (!t) continue;
    const rng = rngFor(s.seed, 'stage', id, day);
    const uIgnite = rng.next();
    const uChop = rng.next();
    const data = realDH(real, t, i);
    let bonus = (mr.themeDH[id] ?? 0) + (t.boost?.dH ?? 0);
    // 日历"更容易火"：冷门风口有一定概率被点燃
    if (t.stage === 'cold' && uIgnite < mr.sprout + (mr.sproutTheme[id] ?? 0)) bonus += R.igniteDH;
    // 震荡：热度变化多一层来回拉扯
    if (mr.dHNoise > 0) bonus += -mr.dHNoise + 2 * mr.dHNoise * uChop;
    let d = data + bonus;
    // 股灾：还没退潮、不在冷门的风口今天一起退潮（隐藏，收盘后揭晓）
    if (crash && (CRASH_STAGES as readonly string[]).includes(t.stage)) {
      t.lastStage = t.stage;
      t.stage = 'ebb';
      t.age = 0;
      t.sure = false;
      t.rebound = true;
      d += R.crashDH;
    }
    const forced = crash && t.rebound === true && t.age === 0;
    const next = forced ? 'ebb' : realNextStage(t, Math.round(d) || 0);
    if (next === 'ebb' && d < 0) d *= mr.ebbMult * (crash ? BALANCE.crash.plunge : 1);
    realEnter(t, next);
    dH[id] = Math.round(d) || 0;
    baseDH[id] = Math.round(data) || 0;
  }
  let mood = realMood(real, i, mr);
  const market = Math.round(R.ampMarket * mr.vol * realMarketPct(real, i) * 100) / 100 || 0;
  let extra = mr.marketAdd;
  // 日历、难度"更容易晴 / 转熊"：在真实涨跌上叠一层 0.3 的晴雨涨跌
  const u = rngFor(s.seed, 'mood', day).next();
  if (u < mr.bullBias) {
    mood = 'bull';
    extra += BALANCE.market.ret.bull;
  } else if (u < mr.bullBias + mr.bearBias) {
    mood = 'bear';
    extra += BALANCE.market.ret.bear;
  }
  if (crash) {
    mood = 'bear';
    extra += BALANCE.crash.marketHit;
  }
  return { mood, marketRet: round2(market + extra), dH, base: { market, dH: baseDH } };
}

/**
 * 0.5：个股照搬真实走势时的今天。大盘 = amp × 真实涨跌（日历、难度、股灾不再改大盘）；
 * 风口热度和阶段照 0.4（真实相对强弱 + 日历、直播间、震荡等加成，股灾时一起退潮）——热度只是信息，不影响个股涨跌。
 */
function trackPlan(s: GameState, real: Readonly<RealMarket>, mr: MarketRules, crash: boolean): DayPlan {
  const R = BALANCE.real;
  const day = s.dayIndex;
  const i = tapeIndex(real, day);
  const dH: Partial<Record<ThemeId, number>> = {};
  const baseDH: Partial<Record<ThemeId, number>> = {};
  for (const id of s.themeIds) {
    const t = s.themes[id];
    if (!t) continue;
    const rng = rngFor(s.seed, 'stage', id, day);
    const uIgnite = rng.next();
    const uChop = rng.next();
    const data = realDH(real, t, i);
    let bonus = (mr.themeDH[id] ?? 0) + (t.boost?.dH ?? 0);
    if (t.stage === 'cold' && uIgnite < mr.sprout + (mr.sproutTheme[id] ?? 0)) bonus += R.igniteDH;
    if (mr.dHNoise > 0) bonus += -mr.dHNoise + 2 * mr.dHNoise * uChop;
    let d = data + bonus;
    if (crash && (CRASH_STAGES as readonly string[]).includes(t.stage)) {
      t.lastStage = t.stage;
      t.stage = 'ebb';
      t.age = 0;
      t.sure = false;
      t.rebound = true;
      d += R.crashDH;
    }
    const forced = crash && t.rebound === true && t.age === 0;
    const next = forced ? 'ebb' : realNextStage(t, Math.round(d) || 0);
    if (next === 'ebb' && d < 0) d *= mr.ebbMult * (crash ? BALANCE.crash.plunge : 1);
    realEnter(t, next);
    dH[id] = Math.round(d) || 0;
    baseDH[id] = Math.round(data) || 0;
  }
  const market = round2(trackMarketRet(real, i));
  return { mood: trackMood(real, i), marketRet: market, dH, base: { market, dH: baseDH } };
}

function startDay(s: GameState, em: Emitter): void {
  s.phase = 'premarket';
  const day = s.dayIndex;
  const rules = rulesOf(s);
  const mr = dayMarketRules(s);
  const dH: Partial<Record<ThemeId, number>> = {};
  const crash = s.notice?.id === 'crash' && crashPlan(s.seed, s.difficulty, s.real ?? null)?.dayInMonth === s.dayInMonth;
  if (s.real) {
    s.today = { day, messages: [], recs: [], buysLeft: s.busyDay === day ? 0 : rules.buysPerDay, ops: 0, buys: 0, plan: realPlan(s, s.real, mr, crash) };
  }
  for (const id of s.real ? [] : s.themeIds) {
    const t = s.themes[id];
    if (!t) continue;
    advanceStage(t, mr, rngFor(s.seed, 'stage', id, day));
    // 股灾：所有还没退潮、不在冷门的题材今天起提前退潮（隐藏，收盘后揭晓）
    if (crash && (CRASH_STAGES as readonly string[]).includes(t.stage)) {
      t.stage = 'ebb';
      t.sure = false;
      t.rebound = true;
      const [lo, hi] = stageDays('ebb', id);
      t.left = uniformInt(rngFor(s.seed, 'crashStage', id), lo, hi);
    }
    dH[id] = rollDH(t, crash ? { ...mr, ebbMult: mr.ebbMult * BALANCE.crash.plunge } : mr, rngFor(s.seed, 'dH', id, day));
  }
  const moodRng = rngFor(s.seed, 'mood', day);
  let mood = s.real ? s.today.plan.mood : nextMood(s.mood, mr, moodRng);
  let marketRet = s.real ? s.today.plan.marketRet : marketReturn(mood, mr, moodRng);
  // 股灾当天：大盘暴跌（隐藏，收盘后揭晓）
  if (crash && !s.real) {
    mood = 'bear';
    marketRet = round2(marketRet + BALANCE.crash.marketHit);
  }
  const busy = s.busyDay === day;
  if (!s.real) s.today = { day, messages: [], recs: [], buysLeft: busy ? 0 : rules.buysPerDay, ops: 0, buys: 0, plan: { mood, marketRet, dH } };
  const manufactured = isTrack(s.real) && needsHeadline(s);
  s.today.messages = makeMessages(s, rules);
  s.today.recs = makeRecs(s, rules);
  if (s.tempo) s.today.quiet = premarketQuiet(s);
  emit(em, { type: 'dayStarted', day, month: s.month, dayInMonth: s.dayInMonth });
  emit(em, { type: 'chat', messages: s.today.messages.map((m) => ({ ...m })), recs: s.today.recs.map((r) => ({ ...r })) });
  // 0.5：本月还没有高光，主题在月末前一天放出一条重磅情报（算一次高光）
  const big = manufactured ? s.today.messages.find((m) => m.big) : undefined;
  if (big && s.tempo?.cur) {
    s.tempo.cur.highlights += 1;
    emit(em, { type: 'highlight', kind: 'headline', text: `重磅情报：${big.text}` });
  }
}

function buy(s: GameState, a: Extract<Action, { type: 'buy' }>, em: Emitter): void {
  const rec = s.today.recs[a.rec];
  if (!rec) return;
  const slot = a.slot ?? firstEmpty(s);
  const old = closeHolding(s, slot, 'replace');
  const theme = stockById(rec.stockId).theme;
  const contra = s.today.messages.some((m) => m.friendId === 'qunzhu' && m.theme === theme && m.claim === 'down');
  // 0.4 C：仓位（换股时那一格的钱先回来）
  const units = s.ext ? sizeUnits(s, a.size ?? 'taste') : 1;
  const h = newHolding(s, rec.stockId, s.today.day, 'rec', { recBy: rec.friendId, firstBuy: s.today.buys === 0, contra });
  if (s.ext) {
    h.units = units;
    if (a.short) {
      h.short = true;
      h.squeezed = 0;
      s.ext.log.shorts += 1;
      learn(s, 'short', em);
    }
    if (a.size === 'half' || a.size === 'heavy') learn(s, 'size', em);
    if (a.size === 'heavy') {
      s.ext.log.heavy += 1;
      learn(s, 'heavy', em);
    }
  }
  s.slots[slot] = h;
  noteUnits(s, h);
  // 0.4 C：一次买太多，价格被自己抬高一点（多出来的每份 impact pp，按这一笔的金额算）
  let cost = 0;
  if (s.ext && units > 1) {
    const b0 = s.account;
    setAccount(s, s.account * (1 - ((units / BALANCE.slots) * BALANCE.ext.impact * (units - 1)) / 100));
    cost = round2(b0 - s.account);
  }
  // 0.5（真实行情）：手续费（难度"熊出没"起），按这一笔的金额算
  const fee = isTrack(s.real) ? rulesOf(s).buyFee : 0;
  if (fee > 0) {
    const b0 = s.account;
    setAccount(s, s.account * (1 - ((units / BALANCE.slots) * fee) / 100));
    cost = round2(cost + b0 - s.account);
  }
  // 冲击成本、手续费也是炒股的一部分
  if (cost > 0) addStat(s, 'tradeMoney', -cost);
  rec.taken = true;
  s.today.buysLeft -= 1;
  s.today.buys += 1;
  s.stats.buys += 1;
  if (old) s.stats.sells += 1;
  markOp(s);
  emit(em, { type: 'bought', rec: a.rec, slot, stockId: rec.stockId, replaced: old?.stockId ?? null, ...(s.ext ? { units, short: !!a.short, cost } : cost > 0 ? { cost } : {}) });
  quip(s, em, old?.stockId ?? null, slot, 'sold', s.stats.sells);
  quip(s, em, rec.stockId, slot, 'bought', s.stats.buys);
  if (a.short) react(s, em, 'short', s.stats.buys);
  else if (a.size === 'heavy') react(s, em, 'heavy', s.stats.buys);
}

/** 0.3.1：买入、卖出时股票小人冒一句（只发事件，不改局面）。 */
function quip(s: GameState, em: Emitter, stockId: string | null, slot: number, moment: 'bought' | 'sold', key: number): void {
  if (!stockId || !em.enabled) return;
  const text = stockQuip(s, stockId, moment, key);
  if (text) emit(em, { type: 'quip', stockId, slot, moment, text });
}

function sell(s: GameState, slot: number, em: Emitter): void {
  const h = closeHolding(s, slot, 'sell');
  if (!h) return;
  s.stats.sells += 1;
  markOp(s);
  emit(em, { type: 'sold', slot, stockId: h.stockId, holdRet: round2((h.value - 1) * 100) });
  quip(s, em, h.stockId, slot, 'sold', s.stats.sells);
}

/** 0.4 C：加仓（+1 份，现金不够时有多少加多少）。持有收益按成本摊薄。 */
function addTo(s: GameState, slot: number, em: Emitter): void {
  const h = s.slots[slot];
  if (!h || !s.ext) return;
  const add = Math.min(BALANCE.ext.add, freeUnits(s));
  const u0 = unitsOf(h);
  h.value = 1 + (u0 * (h.value - 1)) / (u0 + add);
  h.units = round2(u0 + add);
  if (!rulesOf(s).freeAdd) s.today.buysLeft -= 1;
  s.today.buys += 1;
  s.stats.buys += 1;
  s.ext.log.adds += 1;
  noteUnits(s, h);
  markOp(s);
  learn(s, 'add', em);
  emit(em, { type: 'added', slot, stockId: h.stockId, units: h.units });
}

/** 0.4 C：减一半（按 0.5 份取整，至少留 0.5 份）。 */
function trim(s: GameState, slot: number, em: Emitter): void {
  const h = s.slots[slot];
  if (!h || !s.ext) return;
  const m = BALANCE.ext.minUnit;
  h.units = Math.max(m, Math.floor(unitsOf(h) / 2 / m + 1e-9) * m);
  s.stats.sells += 1;
  s.ext.log.trims += 1;
  markOp(s);
  learn(s, 'trim', em);
  emit(em, { type: 'trimmed', slot, stockId: h.stockId, units: h.units, holdRet: round2((h.value - 1) * 100) });
}

function borrow(s: GameState, id: CollateralId, em: Emitter): void {
  const o = loanOffer(s, id);
  if (!o || !s.ext) return;
  const loan: Loan = { id, amount: o.amount, rate: o.rate, month: s.month };
  s.ext.loans.push(loan);
  if (!s.ext.log.borrowed.includes(id)) s.ext.log.borrowed.push(id);
  setAccount(s, s.account + o.amount);
  learn(s, 'borrow', em);
  emit(em, { type: 'borrowed', loan: { ...loan }, account: s.account });
  react(s, em, 'borrow', s.ext.log.borrowed.length);
}

function repay(s: GameState, id: CollateralId, em: Emitter): void {
  const x = s.ext;
  const loan = x?.loans.find((l) => l.id === id);
  if (!x || !loan) return;
  setAccount(s, s.account - loan.amount);
  x.loans = x.loans.filter((l) => l !== loan);
  if (!x.log.redeemed.includes(id)) x.log.redeemed.push(id);
  x.called = x.loans.length > 0 && s.account < debtOf(s) * BALANCE.ext.callLine;
  learn(s, 'redeem', em);
  emit(em, { type: 'repaid', loan: { ...loan }, account: s.account });
  react(s, em, 'redeem', x.log.redeemed.length);
}

/** 开盘：按第 5 节的顺序结算今天，并推进到下一天 / 月底。 */
function open(s: GameState, em: Emitter): void {
  const day = s.today.day;
  const plan = s.today.plan;
  const rules = rulesOf(s);
  const mr = dayMarketRules(s);
  emit(em, { type: 'opened', day });

  // 1. 大盘天气、题材热度
  const moodBefore = s.mood;
  s.mood = plan.mood;
  emit(em, { type: 'marketMoved', moodBefore, mood: s.mood, ret: plan.marketRet });
  const themeRet: Partial<Record<ThemeId, number>> = {};
  const realBase: Partial<Record<ThemeId, number>> = {};
  const themes: ThemeMove[] = [];
  for (const id of s.themeIds) {
    const t = s.themes[id];
    if (!t) continue;
    const heatBefore = t.heat;
    const feelBefore = feelOf(t.history);
    const stage = t.stage;
    // 真实行情：风口涨跌 = 行业的真实超额收益（归一、均摊后 × themeK）+ 加成热度带来的涨跌（0.3 的 coef × ΔH）
    // 0.5：风口涨跌 = amp × 真实行业当天涨跌（和个股一致；热度只是信息）
    const realRet = isTrack(s.real)
      ? round2(trackThemeRet(s.real as RealMarket, id, tapeIndex(s.real as RealMarket, day)))
      : s.real
        ? round2(realThemeRet(s.real, t, tapeIndex(s.real, day), mr.vol) + BALANCE.heat.coef * ((plan.dH[id] ?? 0) - (plan.base?.dH[id] ?? 0)))
        : undefined;
    if (realRet !== undefined) realBase[id] = realThemeRet(s.real as RealMarket, t, tapeIndex(s.real as RealMarket, day), mr.vol);
    const r = settleTheme(t, plan.dH[id] ?? 0, mr, rngFor(s.seed, 'themeNoise', id, day), realRet);
    themeRet[id] = r.ret;
    const tm: ThemeMove = { id, heatBefore, heat: t.heat, dH: r.dH, ret: r.ret, feelBefore, feel: feelOf(t.history), stage };
    themes.push(tm);
    emit(em, { type: 'themeMoved', ...tm });
  }
  const stageOf = new Map(themes.map((t) => [t.id, t.stage]));

  // 2. 个股涨跌
  const held = new Set<string>();
  for (const h of s.slots) if (h) held.add(h.stockId);
  const rawParts = new Map<string, RawPart[]>();
  const boardsBefore = new Map<string, number>();
  for (const id of held) boardsBefore.set(id, s.stocks[id]?.boards ?? 0);
  const real = s.real
    ? {
        tape: s.real,
        i: tapeIndex(s.real, day),
        themeRet: realBase,
        marketExtra: plan.marketRet - (plan.base?.market ?? 0),
        extraDH: Object.fromEntries(s.themeIds.map((id) => [id, (plan.dH[id] ?? 0) - (plan.base?.dH[id] ?? 0)])) as Partial<Record<ThemeId, number>>,
      }
    : undefined;
  const moves = moveStocks({ seed: s.seed, day, state: s, themeRet, marketRet: plan.marketRet, mr, rules, held, partsOut: rawParts, real });
  const moveOf = new Map(moves.map((m) => [m.id, m]));

  // 3. 连锁：龙头涨停带动同题材跟风
  const chains: ChainLink[] = [];
  for (const m of moves) {
    const def = stockById(m.id);
    if (def.role !== 'leader' || !m.limitUp) continue;
    const followers = stocksOf(def.theme)
      .filter((d) => (moveOf.get(d.id)?.chain ?? 0) > 0 || moveOf.get(d.id)?.follow === true)
      .map((d) => d.id);
    if (followers.length === 0 && !held.has(m.id)) continue;
    chains.push({ leader: m.id, followers, held: followers.filter((id) => held.has(id)), leaderHeld: held.has(m.id) });
  }
  const leaderUp = new Set<ThemeId>();
  for (const c of chains) if (c.leaderHeld) leaderUp.add(stockById(c.leader).theme);

  // 4. 持仓收益与道具
  const triggers: ItemTrigger[] = [];
  const holdings: HoldingMove[] = [];
  for (let slot = 0; slot < s.slots.length; slot++) {
    const h = s.slots[slot];
    if (!h) continue;
    const stock = stockById(h.stockId);
    const move = moveOf.get(h.stockId);
    if (!move) continue;
    if (stageOf.get(stock.theme) === 'ebb') h.sawEbb = true;
    const steps: HoldingStep[] = [{ source: 'move', label: '股票本身的涨跌', value: move.move }];
    const itemParts: { itemId: string; value: number }[] = [];
    let current = '';
    const ctx: HoldingCtx = {
      state: s,
      slot,
      holding: h,
      stock,
      move,
      stage: stageOf.get(stock.theme) ?? 'cold',
      boughtToday: h.boughtDay >= day && !rules.noT1,
      leaderUp,
      ret: move.move,
      sell: move.st === 'delisted' ? 'delist' : null,
      trigger(text) {
        triggers.push({ itemId: current, slot, stockId: h.stockId, text, delta: 0 });
      },
    };
    const run = (phase: 'onHolding' | 'onExit'): void => {
      for (const id of s.items) {
        const fn = itemById(id)[phase];
        if (!fn) continue;
        current = id;
        const before = ctx.ret;
        const n = triggers.length;
        fn(ctx);
        if (ctx.ret !== before) itemParts.push({ itemId: id, value: ctx.ret - before });
        if (triggers.length > n) {
          const t = triggers[triggers.length - 1] as ItemTrigger;
          t.delta = round2(ctx.ret - before);
          steps.push({ source: id, label: itemById(id).name, value: round2(ctx.ret) });
        }
      }
    };
    // 0.4 C 押跌：它跌你赚、它涨你亏；涨停被轧亏得更狠；每天一点手续费。押跌不吃"买涨"的道具，只走自动卖出
    let squeeze = 0;
    if (h.short) {
      // 晴天押跌逆风、雨天押跌顺风（窗外天气就是今天的大环境）
      const wind = shortWind(s, plan.mood);
      ctx.ret = -move.move - BALANCE.ext.shortFee + wind;
      if (move.limitUp) {
        squeeze = -move.move * (BALANCE.ext.squeeze - 1) * rules.squeezeMult;
        ctx.ret += squeeze;
      }
    } else run('onHolding');
    run('onExit');
    const ret = round2(ctx.ret);
    h.value = h.value * (1 + ret / 100);
    h.todayRet = ret;
    const pctx = {
      stockId: h.stockId,
      move,
      dH: themes.find((t) => t.id === stock.theme)?.dH ?? 0,
      marketRet: plan.marketRet,
      boardsBefore: boardsBefore.get(h.stockId) ?? 0,
      track: !!s.real && isTrack(s.real),
    };
    const parts = h.short
      ? shortParts(move.move, squeeze, itemParts, ret, pctx)
      : holdingParts(rawParts.get(h.stockId) ?? [{ kind: 'noise', value: move.move }], itemParts, ret, pctx);
    const hm: HoldingMove = { slot, stockId: h.stockId, move: move.move, ret, parts, lead: leadPart(parts), amount: 0, steps, holdRet: round2((h.value - 1) * 100), sold: ctx.sell };
    if (s.ext) {
      hm.units = unitsOf(h);
      if (h.short) {
        hm.short = true;
        if (move.limitUp) {
          hm.squeeze = true;
          h.squeezed = (h.squeezed ?? 0) + 1;
          s.ext.log.squeezes += 1;
          s.ext.log.stubborn = Math.max(s.ext.log.stubborn, h.squeezed);
          emit(em, { type: 'squeezed', slot, stockId: h.stockId, ret });
          learn(s, 'squeeze', em);
        } else h.squeezed = 0;
      }
    }
    holdings.push(hm);
  }
  for (const hm of holdings) {
    const stock = moveOf.get(hm.stockId);
    if (stock) emit(em, { type: 'stockMoved', ...hm, stock });
  }
  for (const c of chains) emit(em, { type: 'chain', ...c });
  for (const t of triggers) emit(em, { type: 'itemTriggered', ...t });
  for (const m of moves) {
    if (!m.st) continue;
    emit(em, { type: 'stockNews', stockId: m.id, news: m.st, warnings: s.stocks[m.id]?.warnings ?? 0, held: held.has(m.id) });
  }

  // 5. 账户
  let gross = 0;
  let unitSum = 0;
  for (const hm of holdings) unitSum += hm.units ?? 1;
  const weight = 1 / holdingBase(s, unitSum);
  for (const hm of holdings) gross += hm.ret * weight * (hm.units ?? 1);
  gross = round2(gross);
  let accRet = round2(gross * rules.leverage);
  const levRet = accRet - gross;
  const accItems: { itemId: string; value: number }[] = [];
  const heldThemeCount = new Map<ThemeId, number>();
  for (const hm of holdings) {
    const th = stockById(hm.stockId).theme;
    heldThemeCount.set(th, (heldThemeCount.get(th) ?? 0) + 1);
  }
  for (const id of s.items) {
    const fn = itemById(id).onAccount;
    if (!fn) continue;
    const ctx = {
      state: s,
      themes: heldThemeCount.size,
      ret: accRet,
      trigger(text: string) {
        triggers.push({ itemId: id, slot: null, stockId: null, text, delta: 0 });
      },
    };
    const n = triggers.length;
    fn(ctx);
    if (triggers.length > n) {
      const t = triggers[triggers.length - 1] as ItemTrigger;
      t.delta = round2(ctx.ret - accRet);
      emit(em, { type: 'itemTriggered', ...t });
    }
    if (round2(ctx.ret) !== accRet) accItems.push({ itemId: id, value: round2(ctx.ret) - accRet });
    accRet = round2(ctx.ret);
  }
  const before = s.account;
  setAccount(s, before * (1 + accRet / 100));
  const effects = splitMoney(before, s.account, holdings, weight, levRet, accItems);
  if (s.ext) {
    for (const hm of holdings) {
      if (!hm.short) continue;
      const log = s.ext.log;
      log.shortPnl = round2(log.shortPnl + hm.amount);
    }
  }
  const autoSold: DayReport['autoSold'] = [];
  for (const hm of holdings) {
    if (!hm.sold) continue;
    closeHolding(s, hm.slot, hm.sold);
    autoSold.push({ slot: hm.slot, stockId: hm.stockId, reason: hm.sold });
    emit(em, { type: 'autoSold', slot: hm.slot, stockId: hm.stockId, reason: hm.sold, holdRet: hm.holdRet });
  }
  emit(em, { type: 'accountChanged', before, after: s.account, ret: accRet });
  // 收盘小结只讲交易带来的变化；银行收走东西另记在 report.bank 和 seized 事件里
  const afterTrade = s.account;
  // 0.5.4：炒股本身累计赚亏（结算页按它评价，不按最后剩多少钱——账单、利息、奖励都不算在里面）
  addStat(s, 'tradeMoney', afterTrade - before);
  const bank = s.ext ? checkBank(s, em) : null;

  // 6. 消息揭晓、群友战绩与吐槽
  const dHOf = new Map(themes.map((t) => [t.id, t.dH]));
  const score = (friendId: string, hit: boolean): void => {
    const f = s.friends.find((x) => x.id === friendId);
    if (f) {
      f.total += 1;
      if (hit) f.hits += 1;
    }
  };
  // 0.5（真实行情）：消息说的是风口接下来 days 天的真实累计方向；说一天的当天揭晓，说几天的到期那天收盘揭晓（report.intel）
  const track = isTrack(s.real) ? (s.real as RealMarket) : null;
  const judged: MessageJudge[] = [];
  s.today.messages.forEach((m, index) => {
    const days = m.days ?? 1;
    if (track && days > 1) {
      (s.watch ??= []).push({ day, index, friendId: m.friendId, theme: m.theme, claim: m.claim, days });
      return;
    }
    const truth = track ? themeTruth(track, m.theme, day, 1) : dirOf(dHOf.get(m.theme) ?? 0);
    const hit = truth === m.claim;
    score(m.friendId, hit);
    const j: MessageJudge = { index, friendId: m.friendId, theme: m.theme, claim: m.claim, truth, hit };
    if (track) j.days = 1;
    judged.push(j);
  });
  for (const j of judged) emit(em, { type: 'messageJudged', ...j });
  const intel: MessageJudge[] = [];
  if (track && s.watch && s.watch.length > 0) {
    const due = s.watch.filter((w) => w.day + w.days - 1 <= day || day >= track.days - 1);
    s.watch = s.watch.filter((w) => !due.includes(w));
    for (const w of due) {
      const truth = themeTruth(track, w.theme, w.day, w.days);
      const hit = truth === w.claim;
      score(w.friendId, hit);
      const j: MessageJudge = { index: w.index, day: w.day, days: w.days, friendId: w.friendId, theme: w.theme, claim: w.claim, truth, hit };
      intel.push(j);
      emit(em, { type: 'intelJudged', ...j });
    }
  }

  // 押跌的：跌停放烟花、涨停下雨
  const fireworks = holdings.some((hm) => (hm.short ? moveOf.get(hm.stockId)?.limitDown : moveOf.get(hm.stockId)?.limitUp));
  const rain = holdings.some((hm) => (hm.short ? moveOf.get(hm.stockId)?.limitUp : moveOf.get(hm.stockId)?.limitDown));
  const crashToday = s.notice?.id === 'crash' && crashPlan(s.seed, s.difficulty, s.real ?? null)?.dayInMonth === s.dayInMonth;
  const report: DayReport = {
    day,
    month: s.month,
    dayInMonth: s.dayInMonth,
    market: { moodBefore, mood: s.mood, ret: plan.marketRet },
    themes,
    stocks: moves,
    holdings,
    chains,
    triggers,
    account: { before, gross, ret: accRet, after: afterTrade, effects },
    autoSold,
    messages: judged,
    comments: [],
    fireworks,
    rain,
    crash: crashToday,
    news: [],
    quips: [],
  };
  if (bank) report.bank = bank;
  if (track) report.intel = intel;
  report.comments = makeComments(s, report);
  for (const c of report.comments) emit(em, { type: 'comment', ...c });
  // 0.4 C：被轧、银行打电话、东西被收走，群友接一句
  if (s.ext) {
    const shortWin = holdings.some((h) => h.short && moveOf.get(h.stockId)?.limitDown);
    const kind = bank?.seized.length ? 'seized' : bank?.called ? 'call' : holdings.some((h) => h.squeeze) ? 'squeeze' : shortWin ? 'shortWin' : null;
    const c = kind ? react(s, em, kind, day) : null;
    if (c) report.comments.push(c);
  }
  report.news = makeNews(s, report);
  for (const n of report.news) emit(em, { type: 'news', ...n });
  report.quips = dayQuips(s, report);
  for (const q of report.quips) emit(em, { type: 'quip', ...q });
  if (crashToday) emit(em, { type: 'crashHit', day, month: s.month });
  // 0.5：高光、连击、月度目标、平淡日（小奖励加在交易结算之后）
  if (s.tempo) report.tempo = tempoClose(s, report, tempoCtx(s, em));

  // 熬夜复盘：随机揭示一个题材当天的真实阶段（公开，到第二天盘前有效）
  if (rules.reviewOne && s.themeIds.length > 0) {
    const rng = rngFor(s.seed, 'review', day);
    const theme = s.themeIds[rng.int(s.themeIds.length)] as ThemeId;
    const stage: Stage = stageOf.get(theme) ?? 'cold';
    s.review = { theme, stage, day };
    emit(em, { type: 'themeReviewed', theme, stage, day });
  } else {
    s.review = null;
  }

  // 统计
  s.stats.days += 1;
  if (fireworks) s.stats.limitUpDays += 1;
  if (rain) s.stats.limitDownDays += 1;
  if (accRet > s.stats.maxDayRet) s.stats.maxDayRet = accRet;
  s.stats.maxThemes = Math.max(s.stats.maxThemes, heldThemeCount.size);
  for (const n of heldThemeCount.values()) s.stats.maxSameTheme = Math.max(s.stats.maxSameTheme, n);
  for (const hm of holdings) s.stats.maxBoards = Math.max(s.stats.maxBoards, moveOf.get(hm.stockId)?.boards ?? 0);
  const chainHits = chains.filter((c) => c.held.length > 0).length + (triggers.some((t) => t.itemId === 'longtou') ? 1 : 0);
  s.stats.chains += chainHits;

  s.lastDay = report;
  s.dayIndex += 1;
  s.dayInMonth += 1;
  emit(em, { type: 'dayClosed', report });

  if (marginCalled(s, em)) return;
  if (s.dayInMonth >= daysInMonth(s.month)) endMonth(s, em);
  else startDay(s, em);
}

/**
 * 0.11.0 实盘杠杆每月的利息（元，取整到百元）；没开杠杆为 0。interest 按结回倍数算（每月让结回少几成），
 * 折回游戏里的钱要除以这一档的涨跌倍数：不然越往上的档位利息被放大得越多，开杠杆在大档、豪华档几乎必输。
 */
export function gearInterest(s: Readonly<GameState>): number {
  const live = s.setup?.live;
  const g = live?.gear;
  if (!g || !(g.interest > 0)) return 0;
  const start = s.setup?.account ?? personaAccount(s.persona);
  return Math.round((g.interest * start) / (live.lev ?? 1) / 100) * 100;
}

/** 0.11.0 实盘杠杆：放大后的结回倍数（没截断）；没加杠杆为 null */
export function gearLevered(s: Readonly<GameState>): number | null {
  const live = s.setup?.live;
  if (!live?.gear || live.gear.x <= 1) return null;
  const start = s.setup?.account ?? personaAccount(s.persona);
  return liveLevered((s.account - debtOf(s)) / start, live.lev ?? 1, live.gear.x);
}

/** 0.11.0 爆仓：放大后的结回倍数跌到爆仓线，强制平仓、这局按 0 结（收盘后、月底还完账单后各查一次） */
function marginCalled(s: GameState, em: Emitter): boolean {
  const v = gearLevered(s);
  const call = s.setup?.live?.gear?.call ?? 0;
  if (v === null || v > call) return false;
  s.phase = 'lost';
  s.endReason = 'margin';
  emit(em, { type: 'gearWiped', month: s.month, account: s.account, levered: v });
  emit(em, { type: 'runLost', reason: 'margin', month: s.month, account: s.account, bill: 0 });
  return true;
}

/**
 * 0.3.1：把账户当天的变化分到每格持仓（holdings[].amount，按当天收益 × 权重）和账户层效果（借钱炒股、分散投资等）。
 * 各项取到分，零头并进金额绝对值最大的那一格（没有持仓时并进最后一项账户效果），保证总和等于 after − before。
 */
function splitMoney(
  before: number,
  after: number,
  holdings: HoldingMove[],
  weight: number,
  levRet: number,
  accItems: readonly { itemId: string; value: number }[],
): AccountEffect[] {
  for (const hm of holdings) hm.amount = round2((before * hm.ret * weight * (hm.units ?? 1)) / 100);
  const effects: AccountEffect[] = [];
  if (levRet !== 0) effects.push(leverageEffect(round2((before * levRet) / 100)));
  for (const it of accItems) effects.push(itemEffect(it.itemId, round2((before * it.value) / 100)));
  let sum = 0;
  for (const hm of holdings) sum += hm.amount;
  for (const e of effects) sum += e.amount;
  const rest = round2(after - before - sum);
  if (rest !== 0) {
    const big = holdings.reduce<HoldingMove | null>((a, hm) => (a && Math.abs(a.amount) >= Math.abs(hm.amount) ? a : hm), null);
    if (big) big.amount = round2(big.amount + rest);
    else if (effects.length > 0) {
      const last = effects[effects.length - 1] as AccountEffect;
      last.amount = round2(last.amount + rest);
    }
  }
  for (const e of effects) e.label = effectLabel(e);
  return effects;
}

function endMonth(s: GameState, em: Emitter): void {
  // 月底效果（价值眼光：白马分红）
  const weight = 1 / holdingBase(s);
  for (const id of [...s.items]) {
    const fn = itemById(id).onMonthEnd;
    if (!fn) continue;
    fn({
      state: s,
      addToHolding(slot, pct, text) {
        const h = s.slots[slot];
        if (!h) return;
        h.value *= 1 + pct / 100;
        const before = s.account;
        setAccount(s, s.account * (1 + (pct * weight * unitsOf(h)) / 100));
        // 持仓上的分红、加成算炒股赚的
        addStat(s, 'tradeMoney', s.account - before);
        emit(em, { type: 'itemTriggered', itemId: id, slot, stockId: h.stockId, text, delta: round2(s.account - before) });
      },
    });
  }
  // 0.5：月度目标（还月供之前判定，奖励先到账）
  if (s.tempo) tempoMonthEnd(s, tempoCtx(s, em));
  const monthRet = round2((s.account / Math.max(1e-9, s.stats.monthOpen) - 1) * 100);
  s.stats.monthRets.push(monthRet);
  // 0.4 C：月供之外另付借款利息
  if (s.ext && s.ext.loans.length > 0) {
    let interest = 0;
    for (const l of s.ext.loans) interest += l.amount * l.rate;
    interest = round2(interest);
    const b0 = s.account;
    setAccount(s, s.account - interest);
    s.ext.log.interest = round2(s.ext.log.interest + (b0 - s.account));
    emit(em, { type: 'interestPaid', amount: interest, before: b0, after: s.account });
    learn(s, 'interest', em);
  }
  const amount = s.bill.amount;
  const before = s.account;
  const paid = (): void => {
    for (const x of s.bill.extras ?? []) if (!s.stats.surprisesPaid.includes(x.id)) s.stats.surprisesPaid.push(x.id);
    if (s.notice?.id === 'crash') s.stats.crashRet = monthRet;
  };
  if (s.account >= amount) {
    setAccount(s, s.account - amount);
    addStat(s, 'billMoney', amount);
    paid();
    emit(em, { type: 'billPaid', month: s.month, amount, before, after: s.account, credit: false });
  } else if (s.items.includes('credit')) {
    s.items = s.items.filter((id) => id !== 'credit');
    s.nextBillMult = fx('credit', 'nextBillMult');
    s.stats.creditUsed += 1;
    paid();
    emit(em, { type: 'itemTriggered', itemId: 'credit', slot: null, stockId: null, text: '信用卡帮你垫上了这个月要还的钱', delta: 0 });
    emit(em, { type: 'billPaid', month: s.month, amount, before, after: s.account, credit: true });
  } else {
    s.phase = 'lost';
    s.endReason = 'bankrupt';
    emit(em, { type: 'bankrupt', month: s.month, amount, account: s.account });
    emit(em, { type: 'runLost', reason: 'bankrupt', month: s.month, account: s.account, bill: amount });
    return;
  }
  s.stats.billsPaid += 1;
  if (s.ext) checkBank(s, em, 'bill');
  if (marginCalled(s, em)) return;
  if (s.month >= runMonths(s)) {
    // 0.4 C：一年结束，银行把没还的借款收回去（东西还给你）
    if (s.ext) {
      for (const loan of [...s.ext.loans]) {
        setAccount(s, s.account - loan.amount);
        s.ext.loans = s.ext.loans.filter((l) => l !== loan);
        emit(em, { type: 'repaid', loan: { ...loan }, account: s.account });
      }
      s.ext.called = false;
    }
    s.phase = 'won';
    emit(em, { type: 'runWon', account: s.account });
    return;
  }
  openReward(s, em);
}

// ================================================================ 月度奖励

const STOCK_CARD_STAGES = ['cold', 'sprout'] as const;
/** 股灾时被强制退潮的阶段。 */
const CRASH_STAGES = ['sprout', 'ferment', 'rally', 'climax'] as const;

/** 奖励卡候选：未持有的道具、还没入群的群友、处在冷门或萌芽的题材的龙头 / 妖股。 */
function rewardCandidates(s: Readonly<GameState>): Record<RewardCard['kind'], RewardCard[]> {
  const inGroup = new Set(s.friends.map((f) => f.id));
  const banned = new Set(personaById(s.persona).bannedItems ?? []);
  const items: RewardCard[] = ITEMS.filter(
    (d) =>
      !s.items.includes(d.id) &&
      !banned.has(d.id) &&
      !(d.excludesFriend && inGroup.has(d.excludesFriend)) &&
      (!d.ext || (!!s.ext && (d.id !== 'short_permit' || !canShortNow(s)))),
  ).map(
    (d) => ({ kind: 'item', id: d.id, rarity: d.rarity }),
  );
  const friends: RewardCard[] = [];
  if (!inGroup.has('neimu') && !s.items.includes('paid_group')) friends.push({ kind: 'friend', id: 'neimu', rarity: 'rare' });
  if (!inGroup.has('zhuchang') && s.themeIds.includes('pig')) friends.push({ kind: 'friend', id: 'zhuchang', rarity: 'uncommon' });
  const held = new Set(s.slots.map((h) => h?.stockId));
  const stocks: RewardCard[] = [];
  for (const id of s.themeIds) {
    const t = s.themes[id];
    // 0.5 真实行情：股票卡是"内部消息"——以 BALANCE.intel.headline 的概率只给接下来一个月真实走势偏强的（不看风口阶段）
    const track = isTrack(s.real) ? (s.real as RealMarket) : null;
    if (!t || (!track && !(STOCK_CARD_STAGES as readonly string[]).includes(t.stage))) continue;
    for (const d of stocksOf(id)) {
      if ((d.role !== 'leader' && d.role !== 'meme') || held.has(d.id) || !s.stocks[d.id] || s.stocks[d.id]?.delisted) continue;
      if (track) {
        const good = forwardRet(track, 'stock', d.id, s.dayIndex, daysInMonth(Math.min(MONTHS, s.month + 1))) > 0;
        const honest = rngFor(s.seed, 'stockCard', s.month, d.id).next() < BALANCE.intel.headline;
        if (good !== honest) continue;
      }
      stocks.push({ kind: 'stock', id: d.id, rarity: d.role === 'leader' ? 'rare' : 'uncommon' });
    }
  }
  return { item: items, friend: friends, stock: stocks };
}

function rollRewards(s: GameState): RewardCard[] {
  const rng = rngFor(s.seed, 'reward', s.month);
  const cand = rewardCandidates(s);
  const kinds = ['item', 'friend', 'stock'] as const;
  const rw = BALANCE.reward.rarityWeights;
  const cards: RewardCard[] = [];
  const n = rulesOf(s).rewardCards;
  for (let k = 0; k < n; k++) {
    const avail = kinds.filter((x) => cand[x].length > 0);
    if (avail.length === 0) break;
    const kind = rng.weighted(avail, avail.map((x) => BALANCE.reward.kindWeights[x]));
    const list = cand[kind];
    const card = rng.weighted(list, list.map((c) => rw[c.rarity as Rarity]));
    cards.push(card);
    if (kind === 'stock') {
      const theme = stockById(card.id).theme;
      cand.stock = list.filter((c) => stockById(c.id).theme !== theme);
    } else {
      cand[kind] = list.filter((c) => c !== card);
    }
  }
  return cards;
}

function openReward(s: GameState, em: Emitter): void {
  s.phase = 'reward';
  s.reward = { month: s.month, cards: rollRewards(s) };
  for (const c of s.reward.cards) {
    if (c.kind === 'item') seeItem(s, c.id);
    else if (c.kind === 'friend') seeFriend(s, c.id);
  }
  emit(em, { type: 'rewardOffered', month: s.month, cards: s.reward.cards.map((c) => ({ ...c })) });
}

/** 把股票直接放进第 slot 格（月度奖励、事件用）：原来的持仓卖出；算作上一个交易日买入，下一个交易日就能卖。 */
function placeStock(s: GameState, stockId: string, slot: number, source: Holding['source']): string | null {
  const old = closeHolding(s, slot, 'replace');
  const h = newHolding(s, stockId, s.dayIndex - 1, source);
  // 0.4 C：送的股票占 1 份；现金不够时有多少占多少（至少半份）
  if (s.ext) h.units = Math.max(BALANCE.ext.minUnit, Math.min(BALANCE.ext.taste, freeUnits(s)));
  s.slots[slot] = h;
  return old?.stockId ?? null;
}

function pickReward(s: GameState, a: Extract<Action, { type: 'pickReward' }>, em: Emitter): void {
  const card = s.reward?.cards[a.index];
  if (!card) return;
  let slot: number | null = null;
  let replaced: string | null = null;
  if (card.kind === 'item') {
    gainItem(s, card.id, em);
  } else if (card.kind === 'friend') {
    addFriend(s, card.id, em);
  } else {
    // 稀有股票：所在题材当月一定处于萌芽期（冷门的被拉起萌芽），且这一轮萌芽不会夭折
    const t = s.themes[stockById(card.id).theme];
    if (t && s.real) {
      // 真实行情：冷门的被拉起冒头，之后几天有人持续带热度（必不夭折）
      if (t.stage !== 'sprout') {
        t.stage = 'sprout';
        t.age = 1;
      }
      t.sure = true;
      const R = BALANCE.real.sure;
      if (!t.boost || t.boost.dH < R.dH) t.boost = { dH: R.dH, days: R.days };
    } else if (t) {
      if (t.stage !== 'sprout') {
        t.stage = 'sprout';
        const [lo, hi] = stageDays('sprout', t.id);
        t.left = uniformInt(rngFor(s.seed, 'rewardStage', s.month), lo, hi);
      }
      t.sure = true;
    }
    slot = a.slot ?? firstEmpty(s);
    replaced = placeStock(s, card.id, slot, 'reward');
  }
  s.stats.picked.push(card.id);
  emit(em, { type: 'rewardPicked', card: { ...card }, slot, replaced });
  s.reward = null;
  maybeEvent(s, em);
}

function skipReward(s: GameState, em: Emitter): void {
  s.reward = null;
  emit(em, { type: 'rewardSkipped' });
  maybeEvent(s, em);
}

// ================================================================ 事件

function maybeEvent(s: GameState, em: Emitter): void {
  const rng = rngFor(s.seed, 'event', s.month);
  if (rng.next() < BALANCE.events.chance) {
    const ready = EVENTS.map((d) => ({ d, data: d.prepare({ state: s, rng: rngFor(s.seed, 'eventPrep', s.month, d.id), month: s.month }) })).filter(
      (x) => x.data !== null,
    );
    if (ready.length > 0) {
      const pick = ready[rng.int(ready.length)] as (typeof ready)[number];
      s.event = { ...pick.data, id: pick.d.id, month: s.month };
      s.phase = 'event';
      s.stats.events.push(pick.d.id);
      emit(em, { type: 'eventStarted', event: { ...s.event } });
      return;
    }
  }
  nextMonth(s, em);
}

function choose(s: GameState, option: number, em: Emitter): void {
  const e = s.event;
  if (!e) return;
  const def = eventById(e.id);
  const before = s.account;
  const badMult = rulesOf(s).eventBadMult;
  const ctx: EventCtx = {
    state: s,
    event: e,
    rng: rngFor(s.seed, 'eventResolve', s.month, e.id),
    badMult,
    addAccount(n, exact = false) {
      const b = s.account;
      setAccount(s, s.account + (n < 0 && !exact ? n * badMult : n));
      return round2(s.account - b);
    },
    gainItem: (id, untilMonth) => gainItem(s, id, em, true, untilMonth),
    placeStock: (stockId, slot) => {
      placeStock(s, stockId, slot, 'event');
    },
    boostTheme(theme, dH, days) {
      const t = s.themes[theme];
      if (t) t.boost = { dH, days };
    },
    scaleNextBill(mult) {
      s.nextBillMult *= mult > 1 ? 1 + (mult - 1) * badMult : mult;
    },
    addPending(amount, month) {
      if (month <= runMonths(s)) s.pending.push({ id: e.id, month, amount: round2(amount) });
    },
    skipNextDay() {
      s.busyDay = s.dayIndex;
    },
    takeLoan(id, rateMult) {
      const terms = collateralTerms(id, s.difficulty);
      const x = s.ext;
      if (!x || !terms || x.loans.some((l) => l.id === id) || x.log.seized.includes(id)) return false;
      if (s.account + terms.amount < (debtOf(s) + terms.amount) * BALANCE.ext.borrowLine) return false;
      const rate = Math.round(terms.rate * rulesOf(s).interestMult * rateMult * 10000) / 10000;
      const loan: Loan = { id, amount: terms.amount, rate, month: s.month };
      x.loans.push(loan);
      if (!x.log.borrowed.includes(id)) x.log.borrowed.push(id);
      setAccount(s, s.account + terms.amount);
      learn(s, 'borrow', em);
      emit(em, { type: 'borrowed', loan: { ...loan }, account: s.account });
      return true;
    },
    setLoanRate(id, rate) {
      const l = s.ext?.loans.find((x) => x.id === id);
      if (l) l.rate = rate;
    },
  };
  const text = def.resolve(ctx, option);
  emit(em, { type: 'eventResolved', id: e.id, option, text, delta: round2(s.account - before) });
  s.event = null;
  nextMonth(s, em);
}

function nextMonth(s: GameState, em: Emitter): void {
  const month = s.month + 1;
  // 临时道具到期（量化软件试用）
  const expired = s.expiring.filter((x) => x.month < month);
  if (expired.length > 0) {
    s.expiring = s.expiring.filter((x) => x.month >= month);
    for (const x of expired) {
      s.items = s.items.filter((id) => id !== x.id);
      emit(em, { type: 'itemExpired', itemId: x.id });
    }
  }
  startMonth(s, month, em);
  startDay(s, em);
}

// ================================================================ 入口

/** 一局开始时的统计（读档补缺省值也用它）。 */
export function emptyStats(account: number): GameState['stats'] {
  return {
    days: 0,
    buys: 0,
    sells: 0,
    activeDays: 0,
    limitUpDays: 0,
    maxBoards: 0,
    chains: 0,
    peakAccount: account,
    billsPaid: 0,
    trades: [],
    picked: [],
    events: [],
    limitDownDays: 0,
    maxDayRet: 0,
    surprisesPaid: [],
    creditUsed: 0,
    maxThemes: 0,
    maxSameTheme: 0,
    monthRets: [],
    monthOpen: account,
    crashRet: null,
    acquired: [],
    itemsTaken: [],
    seenItems: [],
    seenFriends: [],
  };
}

/** 正常开局（只用了 persona / difficulty / daily / short）：计入档案、成就。带调试字段的开局不计。 */
export function isRankedSetup(setup: RunSetup | null): boolean {
  if (!setup) return true;
  return Object.keys(setup).every((k) => k === 'persona' || k === 'difficulty' || k === 'daily' || k === 'short');
}

function checkSetup(setup: RunSetup | null): void {
  if (!setup) return;
  if (setup.persona !== undefined && !isPersonaId(setup.persona)) throw new Error(`未知人设：${String(setup.persona)}`);
  if (setup.difficulty !== undefined && (!Number.isFinite(setup.difficulty) || setup.difficulty > MAX_DIFFICULTY)) {
    throw new Error(`难度要在 1..${MAX_DIFFICULTY}`);
  }
  if (setup.daily !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(setup.daily)) throw new Error('每日挑战的日期要是 YYYY-MM-DD');
  for (const id of setup.items ?? []) if (!isItemId(id)) throw new Error(`未知道具：${id}`);
  for (const id of setup.friends ?? []) if (!isFriendId(id)) throw new Error(`未知群友：${id}`);
  for (const id of setup.holdings ?? []) if (!isStockId(id)) throw new Error(`未知股票：${id}`);
  if (setup.themes) {
    if (setup.themes.length !== BALANCE.activeThemes || new Set(setup.themes).size !== setup.themes.length) {
      throw new Error(`登场风口要 ${BALANCE.activeThemes} 个不重复的`);
    }
    for (const id of setup.themes) if (!isThemeId(id)) throw new Error(`未知风口：${id}`);
  }
  if (setup.account !== undefined && !(setup.account > 0)) throw new Error('开局账户要大于 0');
  if (setup.live !== undefined) {
    const { months, billMult, lev, tier } = setup.live;
    if (!Number.isInteger(months) || months < 1 || months > MONTHS) throw new Error(`实盘的月数要在 1..${MONTHS}`);
    if (!(billMult > 0 && billMult <= 1)) throw new Error('实盘的账单倍数要在 (0, 1]');
    if (lev !== undefined && !(lev >= 1 && lev <= 10)) throw new Error('实盘的涨跌倍数要在 1..10');
    if (tier !== undefined && !isLiveTier(tier)) throw new Error(`未知档位：${String(tier)}`);
    const g = setup.live.gear;
    if (g !== undefined && !(g.x >= 1 && g.x <= 5 && g.cap >= 1 && g.cap <= 10 && g.interest >= 0 && g.interest < 1 && g.call >= 0 && g.call < 1)) throw new Error('实盘的杠杆设置不对');
    if (setup.daily !== undefined) throw new Error('每日挑战不能是实盘');
  }
  if (setup.short !== undefined) {
    const { months, billMult, goal } = setup.short;
    if (!Number.isInteger(months) || months < 1 || months > MONTHS) throw new Error(`短局的月数要在 1..${MONTHS}`);
    if (!(billMult > 0 && billMult <= 2)) throw new Error('短局的账单倍数要在 (0, 2]');
    if (!(goal >= 0 && goal <= 3)) throw new Error('短局的首付比例要在 0..3');
    if (setup.daily !== undefined || setup.live !== undefined) throw new Error('每日挑战、实盘不能是短局');
  }
}

/** 本局登场的题材：随机 6 个（must 里的必定登场，人设用），按看板顺序（设计稿第 2.1 节的顺序）排列。 */
export function pickThemes(seed: string, must: readonly ThemeId[] = []): ThemeId[] {
  const rng = rngFor(seed, 'themes');
  const pool = THEME_IDS.filter((id) => !must.includes(id));
  const out: ThemeId[] = must.filter((id) => THEME_IDS.includes(id)).slice(0, BALANCE.activeThemes);
  while (out.length < BALANCE.activeThemes && pool.length > 0) out.push(pool.splice(rng.int(pool.length), 1)[0] as ThemeId);
  return THEME_IDS.filter((id) => out.includes(id));
}

/**
 * 开一局。正常开局 setup 只带 persona（人设，缺省 newbie）、difficulty（1..8，缺省 1）、daily（每日挑战日期）；
 * 其余字段仅供调试、测试、模拟跳到指定局面（这样的局不计入档案）。
 */
/** 开局选项：segment 是抽中的真实行情段（缺省或 null = 0.3 的合成行情）。 */
export interface CreateOptions {
  segment?: Readonly<Segment> | null;
  /** 0.4 C：打开仓位、押跌、抵押（正式游戏都开；缺省关 = 0.3 的玩法，replay-030 用） */
  ext?: boolean;
  /**
   * 0.5：月度主题、中场、高光、连击。缺省：有行情段时打开、合成行情关闭（replay-030 逐位不变）。
   * 回放要带同样的值：replay(seed, actions, setup, { segment, ext: !!state.ext, tempo: !!state.tempo })。
   */
  tempo?: boolean;
  /** 0.5：真实行情用 0.4 的映射（个股 = 大盘 + 风口 + 自身分别放大 + 连板惯性……）；只给对照和旧档测试用 */
  legacyReal?: boolean;
}

export function createRun(seed: string, setup: RunSetup | null = null, opts: CreateOptions = {}): { state: GameState; events: GameEvent[] } {
  checkSetup(setup);
  const persona: PersonaId = setup?.persona ?? 'newbie';
  const pdef = personaById(persona);
  const difficulty = clampDifficulty(setup?.difficulty);
  const themeIds = setup?.themes ? THEME_IDS.filter((id) => setup.themes?.includes(id)) : pickThemes(seed, pdef.themes);
  const themes: GameState['themes'] = {};
  const stocks: GameState['stocks'] = {};
  for (const id of themeIds) for (const d of stocksOf(id)) stocks[d.id] = newStock(seed, d.id, d.role);
  const seg = opts.segment ?? null;
  if (seg && seg.days < totalDays()) throw new Error(`行情段 ${seg.id} 只有 ${seg.days} 天，一局要 ${totalDays()} 天`);
  const real = seg ? realFromSegment(seg, themeIds, Object.keys(stocks), BALANCE.real.smooth) : null;
  // 0.5：个股照搬真实走势；开局按这一段的真实表现校正性格（只决定显示和情报口吻）
  if (real && !opts.legacyReal) {
    real.track = true;
    fitRoles(real, themeIds, (t) => stocksOf(t));
  }
  for (const id of themeIds) themes[id] = real ? warmUpReal(real, id) : warmUpTheme(seed, id);
  const account = setup?.account ?? personaAccount(persona);
  const rules0 = rulesFor([], difficulty, persona);
  const s: GameState = {
    version: 4,
    seed,
    setup,
    persona,
    difficulty,
    phase: 'premarket',
    account,
    month: 0,
    dayInMonth: 0,
    dayIndex: 0,
    themeIds,
    themes,
    stocks,
    mood: real ? (real.track ? trackMood(real, real.warm - 1) : realMood(real, real.warm - 1, baseMarketRules())) : (MOODS[rngFor(seed, 'mood0').int(MOODS.length)] ?? 'flat'),
    slots: Array.from({ length: rules0.slots }, () => null),
    friends: [],
    items: [],
    bill: { month: 1, name: '', amount: 0, extras: [] },
    nextBillMult: 1,
    today: { day: 0, messages: [], recs: [], buysLeft: 0, ops: 0, buys: 0, plan: { mood: 'flat', marketRet: 0, dH: {} } },
    reward: null,
    event: null,
    lastDay: null,
    endReason: null,
    review: null,
    notice: null,
    pending: [],
    expiring: [],
    busyDay: null,
    // 炒股净赚、还掉的账单只在新开的局里从 0 记起（emptyStats 也给读档补缺省值用，不能放在那里）
    stats: { ...emptyStats(account), tradeMoney: 0, billMoney: 0 },
    actions: [],
    real,
    ...(opts.ext ? { ext: newExt() } : {}),
    ...((opts.tempo ?? !!real) ? { tempo: newTempo(seed, difficulty, real, !!opts.ext), watch: [] } : {}),
  };
  const em: Emitter = { events: [], enabled: true };
  for (const def of FRIENDS) if (def.founding) addFriend(s, def.id, em);
  for (const id of setup?.friends ?? []) addFriend(s, id, em);
  for (const id of pdef.items) gainItem(s, id, em, false);
  for (const id of setup?.items ?? []) gainItem(s, id, em, false);
  for (const id of setup?.holdings ?? []) {
    const slot = firstEmpty(s);
    if (slot < 0) throw new Error('开局持仓超过格数');
    if (!s.stocks[id]) throw new Error(`开局持仓的股票不在本局登场的风口里：${id}`);
    s.slots[slot] = newHolding(s, id, -1, 'setup');
  }
  // 0.4 C：人设、难度一开局就能押跌时，空军老周直接在群里
  if (s.ext && canShortNow(s)) addFriend(s, 'kongjun', em);
  em.events = [];
  startMonth(s, 1, em);
  startDay(s, em);
  return { state: s, events: em.events };
}

export function dispatch(prev: GameState, action: Action, opts: DispatchOptions = {}): DispatchResult {
  const error = validate(prev, action);
  if (error) return { state: prev, events: [], error };
  const s = opts.inPlace ? prev : structuredClone(prev);
  const em: Emitter = { events: [], enabled: opts.events ?? true };
  s.actions.push({ ...action });
  switch (action.type) {
    case 'buy':
      buy(s, action, em);
      break;
    case 'sell':
      sell(s, action.slot, em);
      break;
    case 'add':
      addTo(s, action.slot, em);
      break;
    case 'trim':
      trim(s, action.slot, em);
      break;
    case 'borrow':
      borrow(s, action.id, em);
      break;
    case 'repay':
      repay(s, action.id, em);
      break;
    case 'open':
      open(s, em);
      break;
    case 'pickReward':
      pickReward(s, action, em);
      break;
    case 'skipReward':
      skipReward(s, em);
      break;
    case 'choose':
      choose(s, action.option, em);
      break;
  }
  return { state: s, events: em.events, error: null };
}

/** 由种子、开局设置和操作记录重建状态；任何一步非法都会抛错。 */
export function replay(seed: string, actions: readonly Action[], setup: RunSetup | null = null, opts: CreateOptions = {}): GameState {
  let state = createRun(seed, setup, opts).state;
  actions.forEach((a, i) => {
    const r = dispatch(state, a, { events: false, inPlace: true });
    if (r.error) throw new Error(`回放第 ${i} 步失败：${r.error}`);
    state = r.state;
  });
  return state;
}

