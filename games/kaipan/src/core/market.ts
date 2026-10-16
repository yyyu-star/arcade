/**
 * 行情：题材生命周期、大盘、个股涨跌（纯函数，只依赖传入的状态和按用途分流的随机数）。
 */
import { BALANCE } from './balance.ts';
import { isMonthThemeId, monthThemeById } from './content/monthThemes.ts';
import { DIFFICULTIES, ITEMS, calendarOf, clampDifficulty, isItemId, isPersonaId, itemById, personaById, stocksOf } from './content/index.ts';
import type { MarketRules, Rules } from './hooks.ts';
import { isTrack, realMarketPct, realSectorPct, realStockPct } from './real.ts';
import { rngFor, type Rng } from './rng.ts';
import type { RealMarket, Regime } from './segment.ts';
import type { Dir, Feel, GameState, Mood, PersonaId, RunSetup, Stage, StockMove, StockState, ThemeId, ThemeState } from './types.ts';

export const STAGES: readonly Stage[] = ['cold', 'sprout', 'ferment', 'rally', 'climax', 'ebb'];
export const FEELS: readonly Feel[] = ['cold', 'warming', 'hot', 'overheated', 'cooling'];
export const MOODS: readonly Mood[] = ['bull', 'flat', 'bear'];
export const DIRS: readonly Dir[] = ['up', 'flat', 'down'];

/** 保留 2 位小数（顺带把 -0 变成 0，存档往返时保持一致）。 */
export function round2(x: number): number {
  return Math.round(x * 100) / 100 || 0;
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** [lo, hi] 上的均匀数。 */
function uniform(rng: Rng, lo: number, hi: number): number {
  return lo + (hi - lo) * rng.next();
}

/** [lo, hi] 上的均匀整数。 */
export function uniformInt(rng: Rng, lo: number, hi: number): number {
  return lo + rng.int(Math.max(1, hi - lo + 1));
}

// ================================================================ 规则表

export function baseRules(): Rules {
  return {
    slots: BALANCE.slots,
    buysPerDay: BALANCE.buysPerDay,
    leverage: 1,
    momentumMult: 1,
    blowMult: 1,
    revealStages: false,
    credOverride: {},
    credDelta: 0,
    msgNoise: 0,
    turnCredMult: 1,
    credBonus: {},
    friendWeight: {},
    billMult: 1,
    surpriseMult: 1,
    buysCap: null,
    rewardCards: BALANCE.reward.cards,
    eventBadMult: 1,
    extraRecs: 0,
    extraMessages: 0,
    noT1: false,
    reverseQunzhu: false,
    reviewOne: false,
    canShort: false,
    squeezeMult: 1,
    interestMult: 1,
    freeAdd: false,
    buyFee: 0,
    limitMult: 1,
    limitUpMult: 1,
    onlyRoles: null,
    recRoleBoost: {},
    headlines: 0,
    comboMult: 1,
  };
}

/** 难度 1..level 的定义（高等级包含低等级的全部约束）。 */
function difficultyMods(level: number): typeof DIFFICULTIES {
  const lv = clampDifficulty(level);
  return DIFFICULTIES.filter((d) => d.level <= lv);
}

/**
 * 玩家规则表：难度 → 人设 → 道具（按获得顺序）依次修改，最后套上人设的买入上限。
 * 0.5：track（个股照搬真实走势）时难度再套 realRules；monthMod 是本月主题的规则修改（rulesOf 传入）。
 */
export function rulesFor(
  items: readonly string[],
  difficulty: number,
  persona: PersonaId = 'newbie',
  track: boolean | Regime = false,
  monthMod?: (r: Rules) => void,
  short = false,
): Rules {
  const r = baseRules();
  for (const d of difficultyMods(difficulty)) {
    d.rules?.(r);
    if (track) d.realRules?.(r, short);
  }
  if (track) r.billMult *= BALANCE.track.billMult * (track === true ? 1 : BALANCE.track.regimeBill[track]);
  monthMod?.(r);
  if (isPersonaId(persona)) personaById(persona).rules?.(r);
  for (const id of items) if (isItemId(id)) itemById(id).rules?.(r);
  r.slots = Math.max(1, Math.floor(r.slots));
  r.buysPerDay = Math.max(0, Math.floor(r.buysPerDay));
  if (r.buysCap !== null) r.buysPerDay = Math.min(r.buysPerDay, r.buysCap);
  r.rewardCards = Math.max(1, Math.floor(r.rewardCards));
  return r;
}

/** 这一局的账单整体打几折：实盘、娱乐短局按开局设置，完整一年不打折。 */
export function runBillMult(setup: Readonly<RunSetup> | null): number {
  return setup?.live?.billMult ?? setup?.short?.billMult ?? 1;
}

export function rulesOf(s: Readonly<GameState>): Rules {
  const cur = s.tempo?.cur;
  const mod = cur && cur.month === s.month && isMonthThemeId(cur.id) ? monthThemeById(cur.id).rules : undefined;
  const r = rulesFor(s.items, s.difficulty, s.persona, s.real?.track ? s.real.regime : false, mod, !!s.setup?.short);
  // 0.6.0 实盘、0.10.0 娱乐短局：常规月供整体打折（突发账单在 surprisePlan 里打同样的折）
  r.billMult *= runBillMult(s.setup);
  return r;
}

export function baseMarketRules(): MarketRules {
  return {
    bullBias: 0,
    bearBias: 0,
    marketAdd: 0,
    sprout: 0,
    sproutTheme: {},
    themeDH: {},
    ebbMult: 1,
    beta: {},
    noise: {},
    vol: 1,
    memeDown: 0.5,
    stWarnMult: 1,
    blowMult: 1,
    failMult: 1,
    dHNoise: 0,
  };
}

/** 某月的市场规则（日历 → 难度）；month 为 0 表示开局前的预跑，不受日历影响。 */
export function marketRulesFor(month: number, difficulty: number): MarketRules {
  const r = baseMarketRules();
  if (month >= 1) calendarOf(month).market?.(r);
  for (const d of difficultyMods(difficulty)) d.market?.(r, month);
  return r;
}

// ================================================================ 题材生命周期

/** 某阶段的持续天数范围（按题材速度、冷门倍数缩放）。 */
export function stageDays(stage: Stage, theme: ThemeId): [number, number] {
  const p = BALANCE.stages[stage];
  const t = BALANCE.themes[theme];
  const mult = (stage === 'cold' ? t.coldMult : 1) / t.speed;
  const lo = Math.max(1, Math.round(p.days[0] * mult));
  const hi = Math.max(lo, Math.round(p.days[1] * mult));
  return [lo, hi];
}

/** 某阶段失败岔路的概率（萌芽假启动、发酵证伪）；mr.failMult 是难度"震荡"的倍数。 */
export function failChance(stage: Stage, theme: ThemeId, mr?: Readonly<MarketRules>): number {
  const p = BALANCE.stages[stage].fail * (mr?.failMult ?? 1);
  return clamp(stage === 'sprout' ? p * BALANCE.themes[theme].failMult : p, 0, 1);
}

/** 某阶段每天热度变化的范围（按振幅、退潮倍数缩放，未加日历和直播间加成）。 */
export function stageDH(stage: Stage, theme: ThemeId, mr: MarketRules): [number, number] {
  const p = BALANCE.stages[stage];
  const amp = BALANCE.themes[theme].amp * (stage === 'ebb' ? mr.ebbMult : 1);
  return [p.dH[0] * amp, p.dH[1] * amp];
}

/** 阶段自然结束后的下一个阶段。 */
function successor(t: ThemeState, mr: Readonly<MarketRules>, rng: Rng): Stage {
  switch (t.stage) {
    case 'cold':
      return 'sprout';
    case 'sprout':
      return !t.sure && rng.next() < failChance('sprout', t.id, mr) ? 'cold' : 'ferment';
    case 'ferment':
      return rng.next() < failChance('ferment', t.id, mr) ? 'ebb' : 'rally';
    case 'rally':
      return 'climax';
    case 'climax':
      return 'ebb';
    case 'ebb':
      return 'cold';
  }
}

function enter(t: ThemeState, stage: Stage, rng: Rng): void {
  if (t.stage === 'sprout' && stage !== 'sprout') t.sure = false;
  t.stage = stage;
  const [lo, hi] = stage === 'cold' && t.rebound ? BALANCE.crash.rebound : stageDays(stage, t.id);
  t.left = uniformInt(rng, lo, hi);
  // 股灾后的报复性反弹：短暂冷门之后的这一轮萌芽不会夭折
  if (stage === 'sprout' && t.rebound) {
    if (BALANCE.crash.sureRebound) t.sure = true;
    t.rebound = false;
  }
}

/**
 * 开盘前推进题材阶段：热度触顶时强制进入高潮（已在高潮则进入退潮）；
 * 否则阶段天数用完时自然转入下一阶段；冷门题材还可能被日历提前点燃。
 */
export function advanceStage(t: ThemeState, mr: MarketRules, rng: Rng): void {
  const uSprout = rng.next();
  if (t.heat >= BALANCE.heat.max && (t.stage === 'sprout' || t.stage === 'ferment' || t.stage === 'rally')) {
    enter(t, 'climax', rng);
  } else if (t.heat >= BALANCE.heat.max && t.stage === 'climax') {
    enter(t, 'ebb', rng);
  } else if (t.left <= 0) {
    enter(t, successor(t, mr, rng), rng);
  } else if (t.stage === 'cold' && uSprout < mr.sprout + (mr.sproutTheme[t.id] ?? 0)) {
    enter(t, 'sprout', rng);
  }
}

/**
 * 隐藏：今天是不是题材的拐点（阶段今天刚切换）。start 启动（冷门 → 萌芽）、top 见顶（进入高潮）、
 * ebb 退潮（进入退潮，含发酵证伪）、fizzle 假启动（萌芽 → 冷门）。群友更爱在拐点上聊这个题材。
 */
export function turnOf(t: Readonly<ThemeState>): 'start' | 'top' | 'ebb' | 'fizzle' | null {
  if (t.stage === t.lastStage) return null;
  if (t.stage === 'sprout') return 'start';
  if (t.stage === 'climax') return 'top';
  if (t.stage === 'ebb') return 'ebb';
  if (t.stage === 'cold' && t.lastStage === 'sprout') return 'fizzle';
  return null;
}

/** 冷门期热度回落的量（热度高于 coldBase 时为负）。 */
export function coldPull(stage: Stage, heat: number): number {
  if (stage !== 'cold') return 0;
  return -Math.round(BALANCE.heat.coldPull * Math.max(0, heat - BALANCE.heat.coldBase)) || 0;
}

/** 今天热度变化的加成：日历利好、直播间跟单、冷门回落。 */
export function dHBonus(t: Readonly<ThemeState>, mr: MarketRules): number {
  return (mr.themeDH[t.id] ?? 0) + (t.boost?.dH ?? 0) + coldPull(t.stage, t.heat);
}

/** 今天的热度变化（整数，未截断）。 */
export function rollDH(t: ThemeState, mr: MarketRules, rng: Rng): number {
  const [lo, hi] = stageDH(t.stage, t.id, mr);
  const base = uniform(rng, lo, hi);
  // 震荡：每天的热度变化再叠一层来回拉扯的噪声（只有难度"震荡"起才有，不改变第 1 级的随机数序列）
  const chop = mr.dHNoise > 0 ? uniform(rng, -mr.dHNoise, mr.dHNoise) : 0;
  return Math.round(base + chop + dHBonus(t, mr)) || 0;
}

/** 截断到 0..100 后的实际热度变化。 */
export function effectiveDH(heat: number, dH: number): number {
  return clamp(heat + dH, 0, BALANCE.heat.max) - heat || 0;
}

export function dirOf(dH: number): Dir {
  const t = BALANCE.heat.dirThreshold;
  return dH >= t ? 'up' : dH <= -t ? 'down' : 'flat';
}

/** 体感标签：只由公开的热度和走势算出（不等于真实阶段）。 */
export function feelOf(history: readonly number[]): Feel {
  const n = history.length;
  const heat = history[n - 1] ?? 0;
  const d1 = n >= 2 ? heat - (history[n - 2] ?? heat) : 0;
  if (d1 <= -4) return 'cooling';
  if (heat >= 85) return 'overheated';
  if (heat >= 55) return 'hot';
  if (d1 >= 3) return 'warming';
  return 'cold';
}

/** 结算题材：热度变化、题材当日涨幅（pp）。会修改 t。 */
export function settleTheme(t: ThemeState, dH: number, mr: MarketRules, rng: Rng, realRet?: number): { dH: number; ret: number } {
  const d = effectiveDH(t.heat, dH);
  const noise = BALANCE.heat.noise * BALANCE.themes[t.id].noise * mr.vol;
  // 真实行情：风口涨跌由调用方按真实行业算好（不掷随机数）
  const ret = realRet !== undefined ? realRet : round2(BALANCE.heat.coef * d + uniform(rng, -noise, noise));
  t.lastStage = t.stage;
  t.heat += d;
  t.history.push(t.heat);
  while (t.history.length > BALANCE.historyDays) t.history.shift();
  t.left -= 1;
  if (t.boost) {
    t.boost.days -= 1;
    if (t.boost.days <= 0) t.boost = null;
  }
  return { dH: d, ret };
}

/** 新题材（预跑前）：冷门，热度 5..25。 */
function newTheme(id: ThemeId, rng: Rng): ThemeState {
  const heat = uniformInt(rng, 5, 25);
  const hi = stageDays('cold', id)[1];
  return { id, heat, history: [heat], stage: 'cold', lastStage: 'cold', left: uniformInt(rng, 1, hi), sure: false, boost: null };
}

/**
 * 开局前预跑：让各题材处在自然的阶段，并有近几日的走势。
 * onDay 收到每个预跑日（d 为负）结算后的风口涨跌和热度，只给画面补开局前走势用（preHistory），不影响结果。
 */
export function warmUpTheme(seed: string, id: ThemeId, onDay?: (d: number, ret: number, heat: number) => void): ThemeState {
  const t = newTheme(id, rngFor(seed, 'themeInit', id));
  const mr = baseMarketRules();
  for (let d = -BALANCE.warmupDays; d < 0; d++) {
    advanceStage(t, mr, rngFor(seed, 'stage', id, d));
    const dH = rollDH(t, mr, rngFor(seed, 'dH', id, d));
    const { ret } = settleTheme(t, dH, mr, rngFor(seed, 'themeNoise', id, d));
    onDay?.(d, ret, t.heat);
  }
  return t;
}

// ================================================================ 大盘

export function nextMood(mood: Mood, mr: MarketRules, rng: Rng): Mood {
  const u = rng.next();
  if (u < mr.bullBias) return 'bull';
  if (u < mr.bullBias + mr.bearBias) return 'bear';
  if (rng.next() < BALANCE.market.persist) return mood;
  const others = MOODS.filter((m) => m !== mood);
  return others[rng.int(others.length)] as Mood;
}

export function marketReturn(mood: Mood, mr: MarketRules, rng: Rng): number {
  return round2(BALANCE.market.ret[mood] + mr.marketAdd + BALANCE.market.noise * mr.vol * rng.normal());
}

// ================================================================ 个股

export function newStock(seed: string, id: string, role: keyof typeof BALANCE.roles): StockState {
  const [lo, hi] = BALANCE.roles[role].price;
  const price = round2(uniform(rngFor(seed, 'price', id), lo, hi));
  return { id, price, move: 0, boards: 0, history: [], warnings: 0, uncap: 0, delisted: false };
}

interface MoveInput {
  seed: string;
  day: number;
  state: GameState;
  /** 各题材当日涨幅（pp） */
  themeRet: Partial<Record<ThemeId, number>>;
  marketRet: number;
  mr: MarketRules;
  rules: Rules;
  /** 持仓里的股票 id（连板梦只作用于持仓） */
  held: ReadonlySet<string>;
  /**
   * 0.3.1：给出持仓股票涨跌的未取整归因（只记录，不参与计算，不改变任何结果）。
   * 各项之和等于取整前的涨跌；取整的零头由调用方并进"随机波动"。
   */
  partsOut?: Map<string, RawPart[]>;
  /**
   * 0.4 重做：真实行情。有这一项时个股涨跌 = amp × 绑定的真实股票当天的总收益（大盘、行业超额、个股自身三块），
   * 加上日历、难度、道具、事件给大盘和风口的加成（marketExtra、extraDH），再套 0.3 的连板、炸板、妖股、ST、带小弟、涨跌停。
   */
  real?: { tape: Readonly<RealMarket>; i: number; themeRet: Partial<Record<ThemeId, number>>; marketExtra: number; extraDH: Partial<Record<ThemeId, number>> };
}

/** 未取整的归因项（kind 同 RetPartKind，不含 item）。 */
export interface RawPart {
  kind: 'theme' | 'role' | 'market' | 'momentum' | 'chain' | 'jump' | 'news' | 'blown' | 'limit' | 'noise';
  value: number;
}

/**
 * 当天所有在场股票的涨跌。每个题材先算龙头，龙头涨停时同题材跟风股 +chain。
 * 会修改 state.stocks（价格、连板、ST 状态）。随机数一次取齐，分支不同也不会扰动其他用途。
 */
export function moveStocks(inp: MoveInput): StockMove[] {
  if (inp.real && isTrack(inp.real.tape)) return moveStocksTrack(inp, inp.real.tape, inp.real.i);
  const { state: s, mr, rules } = inp;
  const out: StockMove[] = [];
  for (const theme of s.themeIds) {
    const list = stocksOf(theme).filter((d) => s.stocks[d.id] && !s.stocks[d.id]?.delisted);
    list.sort((a, b) => (a.role === 'leader' ? 0 : 1) - (b.role === 'leader' ? 0 : 1));
    let leaderUp = false;
    for (const def of list) {
      const st = s.stocks[def.id] as StockState;
      const p = BALANCE.roles[def.role];
      const rng = rngFor(inp.seed, 'stock', def.id, inp.day);
      const z = rng.normal();
      const uJump = rng.next();
      const uJumpSize = rng.next();
      const uJumpDir = rng.next();
      const uBlow = rng.next();
      const uUncap = rng.next();
      const uWarn = rng.next();
      const uUncapDays = rng.next();

      const held = inp.held.has(def.id);
      const beta = p.beta * (mr.beta[def.role] ?? 1);
      const noise = p.noise * (mr.noise[def.role] ?? 1) * mr.vol;
      let x: number;
      const parts: RawPart[] | null = held && inp.partsOut ? [] : null;
      const rl = inp.real;
      if (rl) {
        // 真实行情：大盘 + 行业超额 × 题材系数倍数（日历"中报"）+ 个股自身 × 噪声倍数（日历"年报"）
        const R = BALANCE.real;
        const m = R.ampMarket * mr.vol * realMarketPct(rl.tape, rl.i);
        const e = rl.themeRet[theme] ?? 0;
        // 个股自身那块：真实的方向和相对大小，幅度按 0.3 的角色噪声（白马小、妖股大）
        const own = (R.ownK * p.noise * mr.vol * (realStockPct(rl.tape, def.id, rl.i) - realSectorPct(rl.tape, theme, rl.i))) / (rl.tape.stocks[def.id]?.scale ?? 1);
        const bm = mr.beta[def.role] ?? 1;
        const nm = mr.noise[def.role] ?? 1;
        const extraTheme = BALANCE.heat.coef * (rl.extraDH[theme] ?? 0);
        const mom = st.boards * BALANCE.boards.momentum * (held ? rules.momentumMult : 1);
        // 角色性格照 0.3：风口那块乘题材系数（龙头 1.5、白马 0.5……），大盘那块乘大盘系数
        const tb = p.beta * bm;
        x = p.market * (m + rl.marketExtra) + tb * (e + extraTheme) + nm * own + mom;
        if (parts) {
          parts.push({ kind: 'market', value: p.market * (m + rl.marketExtra) }, { kind: 'theme', value: e + extraTheme });
          parts.push({ kind: 'role', value: (tb - 1) * (e + extraTheme) }, { kind: 'noise', value: nm * own }, { kind: 'momentum', value: mom });
        }
      } else {
        x = beta * (inp.themeRet[theme] ?? 0) + p.market * inp.marketRet + noise * z;
        x += st.boards * BALANCE.boards.momentum * (held ? rules.momentumMult : 1);
      }
      // 归因只记录，不改动 x 的算法（同种子同操作的结果必须和 0.3.0 逐位相同）
      if (parts && !rl) {
        const tr = inp.themeRet[theme] ?? 0;
        parts.push({ kind: 'theme', value: tr }, { kind: 'role', value: beta * tr - tr }, { kind: 'market', value: p.market * inp.marketRet });
        parts.push({ kind: 'noise', value: noise * z }, { kind: 'momentum', value: st.boards * BALANCE.boards.momentum * (held ? rules.momentumMult : 1) });
      }
      let xs = x;
      const shift = (kind: RawPart['kind']): void => {
        if (parts && x !== xs) parts.push({ kind, value: x - xs });
        xs = x;
      };

      let jump = 0;
      if (p.jumpProb > 0 && uJump < p.jumpProb) {
        const size = p.jump[0] + (p.jump[1] - p.jump[0]) * uJumpSize;
        jump = round2(uJumpDir < mr.memeDown ? -size : size);
        x += jump;
      }
      shift('jump');

      let blown = false;
      if (st.boards > 0 && uBlow < st.boards * BALANCE.boards.blow * mr.blowMult * (held ? rules.blowMult : 1)) {
        blown = true;
        x = BALANCE.boards.blowMove;
      }
      shift('blown');

      let stNews: StockMove['st'] = null;
      let delistNow = false;
      if (def.role === 'st') {
        if (st.uncap > 0) {
          st.uncap -= 1;
          x = p.limit;
        } else if (uUncap < BALANCE.st.uncap) {
          stNews = 'uncap';
          st.warnings = 0;
          const [lo, hi] = BALANCE.st.uncapDays;
          st.uncap = Math.max(0, lo + Math.floor(uUncapDays * (hi - lo + 1)) - 1);
          x = p.limit;
        } else if (uWarn < BALANCE.st.warn * mr.stWarnMult) {
          st.warnings += 1;
          stNews = 'warning';
          if (st.warnings >= BALANCE.st.warnings) {
            stNews = 'delisted';
            delistNow = true;
            st.delisted = true;
            x = BALANCE.st.delistMove;
          }
        }
      }

      shift('news');

      let chain = 0;
      if (def.role === 'follower' && leaderUp && !blown) {
        chain = BALANCE.chain;
        x += chain;
      }
      shift('chain');

      x = delistNow ? x : clamp(x, -p.limit, p.limit);
      shift('limit');
      x = round2(x);
      if (parts) {
        shift('noise');
        inp.partsOut?.set(def.id, parts);
      }
      const limitUp = !delistNow && x >= p.limit - 1e-9;
      const limitDown = !delistNow && x <= -p.limit + 1e-9;
      if (def.role === 'leader' && limitUp) leaderUp = true;
      st.boards = limitUp ? st.boards + 1 : 0;
      st.move = x;
      st.history.push(x);
      while (st.history.length > 5) st.history.shift();
      st.price = Math.max(0.01, round2(st.price * (1 + x / 100)));
      out.push({ id: def.id, move: x, limitUp, limitDown, boards: st.boards, blown, jump, chain, st: stNews });
    }
  }
  return out;
}

/**
 * 0.5：个股照搬真实走势。当天涨跌 = amp × 绑定的真实股票当天的真实涨跌，再按涨跌停（角色涨跌停 × rules.limitMult）截断。
 * 连板、炸板、妖股异动、ST 消息、大哥带小弟都从截断后的走势里识别出来（只播报，不改涨跌）：
 * - 连板：触及涨停，boards + 1；
 * - 炸板：前一天涨停（boards > 0）、今天跌 ≤ BALANCE.track.blown；
 * - 妖股异动（wild）：过山车股单日 |涨跌| ≥ BALANCE.track.wild；
 * - ST：危险股跌停记一次退市警告（不会真的退市），涨停且有警告时摘帽；
 * - 跟涨（follow）：同风口大哥涨停、小弟涨 ≥ BALANCE.track.follow。
 * 归因：大盘 + 风口（行业相对大盘）+ 个股自身（相对行业）+ 涨跌停截断，之和等于当天涨跌。不掷随机数。
 */
function moveStocksTrack(inp: MoveInput, tape: Readonly<RealMarket>, i: number): StockMove[] {
  const { state: s, rules } = inp;
  const T = BALANCE.track;
  const out: StockMove[] = [];
  const mk = T.amp * realMarketPct(tape, i);
  for (const theme of s.themeIds) {
    const list = stocksOf(theme).filter((d) => s.stocks[d.id] && !s.stocks[d.id]?.delisted);
    list.sort((a, b) => (a.role === 'leader' ? 0 : 1) - (b.role === 'leader' ? 0 : 1));
    const sec = T.amp * realSectorPct(tape, theme, i);
    let leaderUp = false;
    for (const def of list) {
      const st = s.stocks[def.id] as StockState;
      const limit = BALANCE.roles[def.role].limit * rules.limitMult;
      const upLimit = round2(limit * rules.limitUpMult);
      const raw = T.amp * realStockPct(tape, def.id, i);
      const x = round2(clamp(raw, -limit, upLimit));
      const limitUp = x >= upLimit - 1e-9;
      const limitDown = x <= -limit + 1e-9;
      if (inp.partsOut && inp.held.has(def.id)) {
        const parts: RawPart[] = [
          { kind: 'market', value: mk },
          { kind: 'theme', value: sec - mk },
          { kind: 'noise', value: raw - sec },
        ];
        if (x !== raw) parts.push({ kind: 'limit', value: x - raw });
        inp.partsOut.set(def.id, parts);
      }
      const blown = st.boards > 0 && x <= T.blown;
      const wild = def.role === 'meme' && (x >= T.wild || x <= -T.wild);
      const follow = def.role === 'follower' && leaderUp && x >= T.follow;
      let stNews: StockMove['st'] = null;
      if (def.role === 'st') {
        if (limitDown) {
          st.warnings += 1;
          stNews = 'warning';
        } else if (limitUp && st.warnings > 0) {
          st.warnings = 0;
          stNews = 'uncap';
        }
      }
      if (def.role === 'leader' && limitUp) leaderUp = true;
      st.boards = limitUp ? st.boards + 1 : 0;
      st.move = x;
      st.history.push(x);
      while (st.history.length > 5) st.history.shift();
      st.price = Math.max(0.01, round2(st.price * (1 + x / 100)));
      const m: StockMove = { id: def.id, move: x, limitUp, limitDown, boards: st.boards, blown, jump: 0, chain: 0, st: stNews };
      if (wild) m.wild = true;
      if (follow) m.follow = true;
      out.push(m);
    }
  }
  return out;
}

/** 道具列表里有没有某个道具（模拟、查询常用）。 */
export function hasItem(s: Readonly<GameState>, id: string): boolean {
  return s.items.includes(id);
}

/** 全部道具 id（按定义顺序）。 */
export const ITEM_IDS: readonly string[] = ITEMS.map((d) => d.id);
