/**
 * 0.5 节奏与反馈：月度主题（"本月看点"）、中场 boss、月度目标、高光时刻、连击小奖励、平淡日。
 *
 * - 开局 planTempo 按种子、行情段（每个月大盘的真实涨跌和最大单日跌幅）、难度把 12 个月的主题抽好，不重复；第 4、8 个月从 boss 池抽。
 * - 主题只改规则和信息（rulesOf 叠加 MonthThemeDef.rules），不改走势；目标都能按局面判定（GoalKind）。
 * - 收盘 tempoClose：识别高光（持仓涨停 / 跌停、连板、炸板、妖股异动、大赚大亏、连击、目标达成、股灾）、发连击小奖励
 *   （连续赚钱给现金，押对跌、抓到涨停给碎片，碎片集满换道具）、更新目标进度、判定平淡日。
 * - 月末前一天本月还没有高光时，chat.ts 的 needsHeadline 让主题制造一条重磅情报（算一次高光）。
 *
 * 确定性：只用种子分流的随机数和加减乘除。
 */
import { BALANCE } from './balance.ts';
import { MONTH_THEMES, MONTH_THEME_SHORT, isMonthThemeId, monthThemeById, type MonthThemeCtx, type MonthThemeDef } from './content/monthThemes.ts';
import { stockById } from './content/index.ts';
import { formatMoney } from './format.ts';
import { rulesOf } from './market.ts';
import { rngFor } from './rng.ts';
import { trackMarketRet } from './real.ts';
import type { RealMarket } from './segment.ts';
import type { ComboReward, DayReport, DayTempo, GameEvent, GameState, Highlight, MonthGoalState, TempoState } from './types.ts';

export interface TempoCtx {
  emit(e: GameEvent): void;
  /** 账户加钱（元），返回实际变化 */
  addCash(amount: number): number;
  /** 发一个道具（碎片换、boss 奖励） */
  gainItem(id: string): void;
  /** 可以发的道具（没持有的） */
  itemPool(): string[];
}

/** 第 month 月（1..12）的第一个交易日（0 起）。 */
function firstDay(month: number): number {
  let n = 0;
  for (let m = 1; m < month; m++) n += BALANCE.monthDays[m - 1] ?? 0;
  return n;
}

/** 抽主题用的行情信息：这个月大盘真实累计涨跌、最大单日跌幅（放大后 pp）。 */
function monthCtx(month: number, difficulty: number, real: Readonly<RealMarket> | null, ext: boolean): MonthThemeCtx {
  let mret = 0;
  let mmin = 0;
  if (real) {
    const d0 = firstDay(month);
    for (let k = 0; k < (BALANCE.monthDays[month - 1] ?? 0); k++) {
      const i = Math.min(real.warm + d0 + k, real.market.length - 1);
      const x = trackMarketRet(real, i);
      mret += x;
      if (x < mmin) mmin = x;
    }
  }
  return { month, difficulty, regime: real?.regime ?? null, mret, mmin, ext };
}

/** 开局：12 个月的主题（不重复；第 4、8 个月是 boss）。 */
export function planTempo(seed: string, difficulty: number, real: Readonly<RealMarket> | null, ext: boolean): string[] {
  const rng = rngFor(seed, 'tempo');
  const used = new Set<string>();
  const out: string[] = [];
  for (let month = 1; month <= BALANCE.monthDays.length; month++) {
    const boss = BALANCE.tempo.bossMonths.includes(month);
    const c = monthCtx(month, difficulty, real, ext);
    const pool = MONTH_THEMES.filter((d) => !!d.boss === boss && !used.has(d.id) && (ext || !d.needsExt));
    if (pool.length === 0) break;
    let w = pool.map((d) => Math.max(0, d.weight(c)));
    if (w.every((x) => x <= 0)) w = pool.map(() => 1);
    const def = rng.weighted(pool, w);
    used.add(def.id);
    out.push(def.id);
  }
  return out;
}

export function newTempo(seed: string, difficulty: number, real: Readonly<RealMarket> | null, ext: boolean): TempoState {
  return { plan: planTempo(seed, difficulty, real, ext), cur: null, streak: 0, bestStreak: 0, shards: 0, results: [], bonus: 0 };
}

/** 难度加码后的目标数值。 */
export function goalTarget(def: MonthThemeDef, difficulty: number): number {
  const k = 1 + BALANCE.tempo.goalStep * (Math.max(1, difficulty) - 1);
  const g = def.goal;
  if (g.kind === 'keep') return Math.round((g.base / k) * 10) / 10;
  if (g.kind === 'gain' || g.kind === 'beat' || g.kind === 'bigDay') return Math.round(g.base * k * 10) / 10;
  return Math.ceil(g.base * k - 1e-9);
}

/** 本月常规月供（不含突发账单），奖励按它算。 */
function regularBill(s: Readonly<GameState>): number {
  let extra = 0;
  for (const x of s.bill.extras ?? []) extra += x.amount;
  return Math.max(0, s.bill.amount - extra);
}

function goalText(def: MonthThemeDef, target: number): string {
  return def.goal.text.replace('{n}', String(target));
}

function rewardText(g: Readonly<MonthGoalState>): string {
  const parts = [formatMoney(g.reward.cash)];
  if (g.reward.shards > 0) parts.push(`${g.reward.shards} 片道具碎片`);
  if (g.reward.item) parts.push('一个道具');
  return `完成奖励：${parts.join(' + ')}`;
}

/** 月初（算月供之前）：定好本月主题，规则表从这一刻起叠加主题的修改。 */
export function beginMonth(s: GameState): void {
  const t = s.tempo;
  if (!t) return;
  const id = t.plan[s.month - 1];
  if (!id || !isMonthThemeId(id)) {
    t.cur = null;
    return;
  }
  const def = monthThemeById(id);
  t.cur = {
    month: s.month,
    id,
    boss: !!def.boss,
    kind: def.goal.kind,
    target: goalTarget(def, s.difficulty),
    progress: 0,
    done: false,
    failed: false,
    reward: { cash: 0, shards: def.reward?.shards ?? 0, item: !!def.reward?.item },
    open: s.account,
    market: 0,
    highlights: 0,
  };
}

/** 月初（月供算好、monthStarted 发出之后）：发"本月看点"、年终奖。 */
export function announceMonth(s: GameState, ctx: TempoCtx): void {
  const cur = s.tempo?.cur;
  if (!cur || cur.month !== s.month) return;
  const def = monthThemeById(cur.id);
  const bill = regularBill(s);
  const ratio = (cur.boss ? BALANCE.tempo.bossCash : BALANCE.tempo.cash) * (def.reward?.cashMult ?? 1);
  cur.reward.cash = Math.round((bill * ratio) / 100) * 100;
  const roastBy = s.friends.some((f) => f.id === def.roast.friendId) ? def.roast.friendId : 'qunzhu';
  ctx.emit({
    type: 'monthTheme',
    goal: { ...cur, reward: { ...cur.reward } },
    name: def.name,
    intro: def.intro,
    rule: def.rule,
    goalText: goalText(def, cur.target),
    rewardText: rewardText(cur),
    roast: { friendId: roastBy, text: def.roast.text },
  });
  if (def.startCash) {
    const got = ctx.addCash(Math.round((bill * def.startCash) / 100) * 100);
    if (s.tempo) s.tempo.bonus += got;
  }
  cur.open = s.account;
}

/** 本月主题的展示信息（画面顶栏 / 看点卡用；没有主题时 null）。 */
export function monthThemeView(s: Readonly<GameState>): {
  goal: MonthGoalState;
  name: string;
  intro: string;
  rule: string;
  goalText: string;
  rewardText: string;
  daysLeft: number;
  /** 0.5 看点卡短版：主题 id、规则短标签（≤8 字）、一句 ≤12 字台词 */
  id: string;
  ruleShort: string;
  line: string;
} | null {
  const cur = s.tempo?.cur;
  if (!cur || cur.month !== s.month) return null;
  const def = monthThemeById(cur.id);
  return {
    goal: { ...cur, reward: { ...cur.reward } },
    name: def.name,
    intro: def.intro,
    rule: def.rule,
    goalText: goalText(def, cur.target),
    rewardText: rewardText(cur),
    daysLeft: Math.max(0, (BALANCE.monthDays[s.month - 1] ?? 0) - s.dayInMonth),
    id: def.id,
    ruleShort: MONTH_THEME_SHORT[def.id]?.rule ?? def.rule,
    line: MONTH_THEME_SHORT[def.id]?.line ?? def.roast.text,
  };
}

function finish(s: GameState, cur: MonthGoalState, ctx: TempoCtx): void {
  if (cur.done || cur.failed) return;
  cur.done = true;
  const cash = ctx.addCash(cur.reward.cash);
  const t = s.tempo as TempoState;
  t.bonus += cash;
  t.shards += cur.reward.shards;
  let itemId: string | null = null;
  if (cur.reward.item) {
    const pool = ctx.itemPool();
    if (pool.length > 0) {
      itemId = pool[rngFor(s.seed, 'tempoItem', cur.month).int(pool.length)] as string;
      ctx.gainItem(itemId);
    }
  }
  ctx.emit({ type: 'goalDone', goal: { ...cur, reward: { ...cur.reward } }, cash, shards: cur.reward.shards, itemId });
}

function fail(cur: MonthGoalState, ctx: TempoCtx): void {
  if (cur.done || cur.failed) return;
  cur.failed = true;
  ctx.emit({ type: 'goalFailed', goal: { ...cur, reward: { ...cur.reward } } });
}

/** 碎片集满换道具。 */
function cashShards(s: GameState, ctx: TempoCtx, combos: ComboReward[]): void {
  const t = s.tempo as TempoState;
  const need = BALANCE.tempo.shards;
  while (t.shards >= need) {
    const pool = ctx.itemPool();
    if (pool.length === 0) break;
    t.shards -= need;
    const id = pool[rngFor(s.seed, 'shardItem', s.dayIndex, t.shards).int(pool.length)] as string;
    ctx.gainItem(id);
    const c: ComboReward = { kind: 'shards', count: need, cash: 0, shards: -need, itemId: id, text: `集齐 ${need} 片碎片，换到一个道具` };
    combos.push(c);
    ctx.emit({ type: 'combo', ...c });
  }
}

/**
 * 收盘（report 已经算好、账户已经结算之后）：高光、连击、目标进度、平淡日。会给账户加小奖励（在 report.account.after 之后）。
 */
export function tempoClose(s: GameState, report: DayReport, ctx: TempoCtx): DayTempo {
  const t = s.tempo as TempoState;
  const T = BALANCE.tempo;
  const comboMult = comboMultOf(s);
  const highlights: Highlight[] = [];
  const combos: ComboReward[] = [];
  const moveOf = new Map(report.stocks.map((m) => [m.id, m]));
  const held = new Set(report.holdings.map((h) => h.stockId));
  // 识别出的连板、炸板、妖股异动（全场播报）
  for (const m of report.stocks) {
    const isHeld = held.has(m.id);
    if (m.boards >= 2) ctx.emit({ type: 'spotted', kind: 'boards', stockId: m.id, move: m.move, boards: m.boards, held: isHeld });
    if (m.blown) ctx.emit({ type: 'spotted', kind: 'blown', stockId: m.id, move: m.move, boards: 0, held: isHeld });
    if (m.wild) ctx.emit({ type: 'spotted', kind: 'wild', stockId: m.id, move: m.move, boards: m.boards, held: isHeld });
  }
  const name = (id: string): string => stockById(id).name;
  for (const h of report.holdings) {
    const m = moveOf.get(h.stockId);
    if (!m) continue;
    if (h.short) {
      if (m.limitDown) highlights.push({ kind: 'shortWin', text: `押跌的${name(h.stockId)}跌停了`, stockId: h.stockId });
      else if (m.limitUp) highlights.push({ kind: 'limitUp', text: `押跌的${name(h.stockId)}涨停，被轧了`, stockId: h.stockId });
      continue;
    }
    if (m.boards >= 2) highlights.push({ kind: 'boards', text: `${name(h.stockId)}连续 ${m.boards} 天涨停`, stockId: h.stockId });
    else if (m.limitUp) highlights.push({ kind: 'limitUp', text: `${name(h.stockId)}涨停`, stockId: h.stockId });
    else if (m.limitDown) highlights.push({ kind: 'limitDown', text: `${name(h.stockId)}跌停`, stockId: h.stockId });
    else if (m.blown) highlights.push({ kind: 'blown', text: `${name(h.stockId)}昨天涨停，今天被砸下来了`, stockId: h.stockId });
    else if (m.wild) highlights.push({ kind: 'wild', text: `${name(h.stockId)}妖性大发：${m.move > 0 ? '+' : ''}${m.move}%`, stockId: h.stockId });
    else if (m.move >= T.bigMove) highlights.push({ kind: 'bigWin', text: `${name(h.stockId)}大涨 ${m.move}%`, stockId: h.stockId });
    else if (m.move <= -T.bigMove) highlights.push({ kind: 'bigLoss', text: `${name(h.stockId)}大跌 ${m.move}%`, stockId: h.stockId });
  }
  const accRet = report.account.ret;
  if (report.holdings.length > 0 && accRet >= T.bigAcc && !highlights.some((x) => x.kind === 'bigWin')) highlights.push({ kind: 'bigWin', text: `账户一天赚了 ${accRet}%` });
  if (report.holdings.length > 0 && accRet <= -T.bigAcc && !highlights.some((x) => x.kind === 'bigLoss')) highlights.push({ kind: 'bigLoss', text: `账户一天亏了 ${-accRet}%` });
  if (report.crash) highlights.push({ kind: 'crash', text: '股灾来了' });

  // 连击：连续收盘赚钱（有持仓才算）
  const bill = regularBill(s);
  if (report.holdings.length > 0) {
    if (accRet > 0) t.streak += 1;
    else t.streak = 0;
    t.bestStreak = Math.max(t.bestStreak, t.streak);
  }
  if (report.holdings.length > 0 && accRet > 0 && t.streak >= T.streak) {
    const cash = ctx.addCash(Math.round((bill * T.streakCash * comboMult) / 10) * 10);
    t.bonus += cash;
    const c: ComboReward = { kind: 'streak', count: t.streak, cash, shards: 0, text: `连续 ${t.streak} 天赚钱，群里发来红包 ${formatMoney(cash)}` };
    combos.push(c);
    ctx.emit({ type: 'combo', ...c });
  }
  // 押对跌、抓到涨停：碎片
  for (const h of report.holdings) {
    const m = moveOf.get(h.stockId);
    if (!m) continue;
    const kind: ComboReward['kind'] | null = h.short ? (h.ret > 0 && m.move < 0 ? 'shortWin' : null) : m.limitUp ? 'limitUp' : null;
    if (!kind) continue;
    const n = comboMult >= 2 ? 2 : 1;
    t.shards += n;
    const c: ComboReward = { kind, count: 1, cash: 0, shards: n, text: kind === 'limitUp' ? `抓到涨停，拿到 ${n} 片道具碎片` : `押对了跌，拿到 ${n} 片道具碎片` };
    combos.push(c);
    ctx.emit({ type: 'combo', ...c });
  }
  cashShards(s, ctx, combos);
  if (combos.length > 0) highlights.push({ kind: 'combo', text: combos[0]?.text ?? '' });

  // 月度目标
  const cur = t.cur && t.cur.month === report.month ? t.cur : null;
  if (cur) {
    cur.market = Math.round((cur.market + report.market.ret) * 100) / 100;
    const before = cur.progress;
    const gain = Math.round((report.account.after / Math.max(1e-9, cur.open) - 1) * 10000) / 100;
    const longs = report.holdings.filter((h) => !h.short);
    switch (cur.kind) {
      case 'gain':
        cur.progress = gain;
        break;
      case 'beat':
        cur.progress = Math.round((gain - cur.market) * 100) / 100;
        break;
      case 'keep':
        cur.progress = Math.max(cur.progress, Math.round(-gain * 100) / 100);
        if (cur.progress > cur.target) fail(cur, ctx);
        break;
      case 'limitUp':
        cur.progress += longs.filter((h) => moveOf.get(h.stockId)?.limitUp).length;
        break;
      case 'shortWin':
        cur.progress += report.holdings.filter((h) => h.short && h.ret > 0).length;
        break;
      case 'streak':
        cur.progress = Math.max(cur.progress, Math.min(t.streak, report.dayInMonth + 1));
        break;
      case 'themes':
        cur.progress = Math.max(cur.progress, new Set(report.holdings.map((h) => stockById(h.stockId).theme)).size);
        break;
      case 'quickWin':
        cur.progress += longs.filter((h) => (s.slots[h.slot]?.boughtDay ?? -1) === report.day && h.ret > 0).length;
        break;
      case 'bigDay':
        for (const h of longs) cur.progress = Math.max(cur.progress, h.move);
        break;
    }
    const instant = cur.kind !== 'gain' && cur.kind !== 'beat' && cur.kind !== 'keep';
    if (instant && cur.progress >= cur.target) {
      finish(s, cur, ctx);
      highlights.push({ kind: 'goal', text: `本月目标达成：${monthThemeById(cur.id).name}` });
    }
    if (cur.progress !== before) ctx.emit({ type: 'goalProgress', goal: { ...cur, reward: { ...cur.reward } } });
    cur.highlights += highlights.length;
  }
  for (const h of highlights) ctx.emit({ type: 'highlight', ...h });
  const calm =
    highlights.length === 0 &&
    combos.length === 0 &&
    report.autoSold.length === 0 &&
    report.triggers.length === 0 &&
    !report.bank?.called &&
    !(report.bank?.seized.length ?? 0) &&
    Math.abs(accRet) < T.quietAcc &&
    report.holdings.every((h) => Math.abs(h.move) < T.quietMove);
  return { quiet: calm, highlights, combos, goal: cur ? { ...cur, reward: { ...cur.reward } } : null, streak: t.streak };
}

function comboMultOf(s: Readonly<GameState>): number {
  return rulesOf(s).comboMult;
}

/** 月底（还月供之前）：判定 gain / beat / keep，没达成的记失败；记下本月结果。 */
export function tempoMonthEnd(s: GameState, ctx: TempoCtx): void {
  const t = s.tempo;
  const cur = t?.cur;
  if (!t || !cur || cur.month !== s.month) return;
  if (!cur.done && !cur.failed) {
    if (cur.kind === 'gain' || cur.kind === 'beat') {
      if (cur.progress >= cur.target) finish(s, cur, ctx);
      else fail(cur, ctx);
    } else if (cur.kind === 'keep') finish(s, cur, ctx);
    else fail(cur, ctx);
  }
  if (cur.done) ctx.emit({ type: 'highlight', kind: 'goal', text: `本月目标达成：${monthThemeById(cur.id).name}` });
  t.results.push({ month: cur.month, id: cur.id, done: cur.done });
}

/**
 * 盘前是不是平淡日：不是月初、没有重磅情报、没有人聊你拿着的风口、格子都满了（没地方买新的）、今天不是传闻月。
 * 画面可以据此自动开盘（玩家随时能打断）。
 */
export function premarketQuiet(s: Readonly<GameState>): boolean {
  if (s.dayInMonth === 0) return false;
  if (s.notice) return false;
  if (s.today.messages.some((m) => m.big)) return false;
  const heldThemes = new Set(s.slots.filter((h) => h).map((h) => stockById((h as NonNullable<typeof h>).stockId).theme));
  if (s.slots.some((h) => h === null)) return false;
  return !s.today.messages.some((m) => heldThemes.has(m.theme));
}
