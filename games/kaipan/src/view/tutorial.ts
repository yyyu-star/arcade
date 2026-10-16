import { FEEL_LABEL, chatView, holdingCards, stockById, themeById, type GameState } from '../core/index.ts';
import { touched } from '../platform/localChange.ts';
import { defaultStore, type KeyValueStore } from '../platform/settings.ts';
import { ellipsize, group } from '../core/format.ts';

/**
 * 分步教程的进度与触发条件（纯逻辑，不依赖 Phaser，可单测）。
 * 第一局里在恰当时机逐步露出，每步只出现一次；进度记在 localStorage（第二阶段可能迁到档案）。
 * 触发条件只用公开信息：查询函数、state.lastDay（收盘后的明细）和持仓。
 */

export type TutorialStep = 'goal' | 'chat' | 'rec' | 'open' | 'colors' | 'heat' | 'chain' | 'boards' | 'sell' | 'bill';

/** 同一时刻有多步可出时的先后。 */
export const TUTORIAL_ORDER: readonly TutorialStep[] = ['goal', 'chat', 'rec', 'open', 'colors', 'heat', 'chain', 'boards', 'sell', 'bill'];

export const TUTORIAL_KEY = 'kaipan.tutorial.v3';

export interface TutorialProgress {
  v: 1;
  /** 玩家关掉了教程（「跳过教程」或设置里关闭） */
  off: boolean;
  done: TutorialStep[];
  /**
   * 第几次"从头再来"（设置里重新开启教程时加一，没有 = 0）。云同步合并时次数大的一边整个说了算：
   * 不然按并集合并，别的设备上看过的步骤会把这次重开又抹掉。
   */
  reset?: number;
}

export function freshTutorial(): TutorialProgress {
  return { v: 1, off: false, done: [] };
}

/** 读进度；损坏或没有时返回新进度。 */
export function loadTutorial(store: KeyValueStore | null = defaultStore()): TutorialProgress {
  try {
    const raw = store?.getItem(TUTORIAL_KEY);
    return raw ? reviveTutorial(JSON.parse(raw)) : freshTutorial();
  } catch {
    return freshTutorial();
  }
}

/** 解析后的进度（本地或云端来的）→ 干净的进度：不认识的步骤丢掉。 */
export function reviveTutorial(raw: unknown): TutorialProgress {
  const p = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<TutorialProgress>;
  const done = Array.isArray(p.done) ? p.done.filter((x): x is TutorialStep => TUTORIAL_ORDER.includes(x as TutorialStep)) : [];
  const reset = typeof p.reset === 'number' && Number.isSafeInteger(p.reset) && p.reset > 0 ? p.reset : 0;
  return { v: 1, off: p.off === true, done: [...new Set(done)], ...(reset > 0 ? { reset } : {}) };
}

const listeners = new Set<(p: TutorialProgress) => void>();

export function saveTutorial(p: TutorialProgress, store: KeyValueStore | null = defaultStore()): void {
  try {
    store?.setItem(TUTORIAL_KEY, JSON.stringify(p));
  } catch {
    // 存储不可用：本次运行内照常生效
  }
  touched('tutorial');
  for (const fn of listeners) fn(p);
}

/** 订阅进度变化（设置里开关教程时，交易场景据此刷新）。 */
export function onTutorialChange(fn: (p: TutorialProgress) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 标记某一步已完成。 */
export function markStep(step: TutorialStep, store: KeyValueStore | null = defaultStore()): TutorialProgress {
  const p = loadTutorial(store);
  if (!p.done.includes(step)) {
    p.done.push(step);
    saveTutorial(p, store);
  }
  return p;
}

/** 设置里的开关：开启 = 从头再来；关闭 = 不再出现。 */
export function setTutorialOn(on: boolean, store: KeyValueStore | null = defaultStore()): TutorialProgress {
  const old = loadTutorial(store);
  const p: TutorialProgress = on ? { ...freshTutorial(), reset: (old.reset ?? 0) + 1 } : { ...old, off: true };
  saveTutorial(p, store);
  return p;
}

/** 教程还会不会出现（关掉了或全部看完都算不会）。 */
export function tutorialActive(p: TutorialProgress): boolean {
  return !p.off && TUTORIAL_ORDER.some((s) => !p.done.includes(s));
}

/** 一步出现时要指向的东西：stockId 为指向的那只持仓（连锁、连板）。 */
export interface StepHit {
  step: TutorialStep;
  stockId: string | null;
}

/** 当前局面下满足条件、还没完成的步骤（按 TUTORIAL_ORDER）。 */
export function eligibleSteps(s: Readonly<GameState>, p: TutorialProgress): StepHit[] {
  if (p.off) return [];
  const out: StepHit[] = [];
  const todo = (st: TutorialStep): boolean => !p.done.includes(st);
  if (s.phase === 'premarket') {
    const v = chatView(s);
    const cards = holdingCards(s);
    const held = new Set(cards.filter((c) => c !== null).map((c) => c.id));
    // 第一天第一步：先讲目标和办法
    if (todo('goal') && s.dayIndex === 0) out.push({ step: 'goal', stockId: null });
    if (todo('chat') && v.messages.length > 0) out.push({ step: 'chat', stockId: null });
    if (todo('rec') && v.buysLeft > 0 && v.recs.some((r) => !r.taken && !r.error)) out.push({ step: 'rec', stockId: null });
    if (todo('open') && !todo('rec')) out.push({ step: 'open', stockId: null });
    // 第一次开盘以后：先说红绿各代表什么，再讲热度
    if (todo('colors') && s.dayIndex >= 1) out.push({ step: 'colors', stockId: null });
    if (todo('heat') && s.dayIndex >= 1) out.push({ step: 'heat', stockId: null });
    const last = s.lastDay;
    if (todo('chain') && last) {
      const link = last.chains.find((c) => c.held.some((id) => held.has(id)));
      const id = link?.held.find((x) => held.has(x));
      if (id) out.push({ step: 'chain', stockId: id });
    }
    if (todo('boards') && last) {
      const was = new Set(last.holdings.map((h) => h.stockId));
      const m = last.stocks.find((st) => was.has(st.id) && held.has(st.id) && (st.boards >= 2 || st.blown));
      if (m) out.push({ step: 'boards', stockId: m.id });
    }
    if (todo('sell')) {
      const c = cards.find((x) => x?.canSell);
      if (c) out.push({ step: 'sell', stockId: c.id });
    }
  } else if (s.phase === 'reward' && todo('bill')) {
    out.push({ step: 'bill', stockId: null });
  }
  return out;
}

// ================================================================ 0.5.1 教程卡：一句话 + 图标数字

/** 教程卡上的小图标签：图标 + 2–4 字或数字；tone 决定着色。 */
interface TutorialChip {
  icon: string;
  text: string;
  tone?: 'up' | 'down' | 'accent';
}

/** 一步教程的卡面：一句不超过 15 字的话 + 几个图标签。 */
interface TutorialCard {
  line: string;
  chips: TutorialChip[];
}

/** 一句话的字数上限（教程卡）。 */
export const TUTORIAL_LINE_MAX = 15;

/** 名字太长时截短（保证整句不超过上限）。 */
function money(v: number): string {
  return `¥${group(Math.round(v))}`;
}

function pct(v: number): string {
  const a = Math.abs(v);
  return `${v >= 0 ? '+' : '-'}${a >= 10 ? a.toFixed(0) : a.toFixed(1)}%`;
}

/**
 * 第 step 步的卡面（纯函数，可单测）。数字来自公开信息：本月要还多少、昨天的涨跌和热度变化。
 * 一句话不超过 TUTORIAL_LINE_MAX 字；更多的东西用图标签表达。
 */
export function tutorialCard(step: TutorialStep, s: Readonly<GameState>, stockId: string | null = null, scheme: 'cn' | 'intl' = 'cn'): TutorialCard {
  const last = s.lastDay;
  const name = (id: string, n: number): string => ellipsize(stockById(id).name, n);
  switch (step) {
    case 'goal':
      return { line: '月底前，凑够要还的钱', chips: [{ icon: 'glyph:house', text: money(s.bill.amount), tone: 'accent' }, { icon: 'glyph:arrow_up', text: '买变火的', tone: 'up' }] };
    case 'chat':
      // 开局群友都是「新」，没有战绩可看：不举「说对 3/5」这种当下看不到的例子，只说战绩会记在名字后面
      return { line: '群友天天喊涨跌，看谁说得准', chips: [{ icon: 'glyph:horn', text: '喊涨跌' }, { icon: 'glyph:star', text: '战绩记在名字后', tone: 'accent' }] };
    case 'rec':
      return { line: `挑${FEEL_LABEL.warming}的风口，点买入`, chips: [{ icon: 'glyph:arrow_up', text: FEEL_LABEL.warming, tone: 'up' }, { icon: 'glyph:bag', text: '进持仓' }] };
    case 'open':
      return { line: '买好了，点开盘看涨跌', chips: [{ icon: 'glyph:bolt', text: '开盘', tone: 'accent' }, { icon: 'glyph:hourglass', text: '过一天' }] };
    case 'colors':
      return scheme === 'intl'
        ? { line: '绿涨红跌，设置里能换', chips: [{ icon: 'glyph:arrow_up', text: '涨', tone: 'up' }, { icon: 'glyph:arrow_down', text: '跌', tone: 'down' }] }
        : { line: '红涨绿跌，设置里能换', chips: [{ icon: 'glyph:arrow_up', text: '涨', tone: 'up' }, { icon: 'glyph:arrow_down', text: '跌', tone: 'down' }] };
    case 'heat': {
      const chips: TutorialChip[] = [];
      let line = '热度涨，股票就涨';
      if (last && last.themes.length > 0) {
        const mine = [...last.holdings].filter((x) => x.stockId).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0];
        if (mine) {
          line = `${name(mine.stockId, 6)}昨天${pct(mine.ret)}`;
          chips.push({ icon: 'glyph:wallet', text: pct(mine.ret), tone: mine.ret >= 0 ? 'up' : 'down' });
        }
        const ownTheme = mine ? stockById(mine.stockId).theme : null;
        const big = [...last.themes].filter((t) => t.id !== ownTheme).sort((a, b) => Math.abs(b.dH) - Math.abs(a.dH))[0];
        if (big && Math.abs(Math.round(big.dH)) >= 1) {
          const d = Math.round(big.dH);
          chips.push({ icon: `theme:${big.id}`, text: `热度${d > 0 ? '+' : ''}${d}`, tone: d > 0 ? 'up' : 'down' });
          if (!mine) line = `${ellipsize(themeById(big.id).name, 4)}热度${d > 0 ? '涨' : '跌'}，股票跟着${d > 0 ? '涨' : '跌'}`;
        }
      }
      if (chips.length === 0) chips.push({ icon: 'glyph:arrow_up', text: '热度↑', tone: 'up' }, { icon: 'glyph:arrow_up', text: '股价↑', tone: 'up' });
      return { line, chips };
    }
    case 'chain': {
      const link = last && stockId ? last.chains.find((c) => c.held.includes(stockId)) : undefined;
      const mv = last && stockId ? last.stocks.find((x) => x.id === stockId) : undefined;
      if (link && mv && mv.chain > 0) {
        return { line: `${name(link.leader, 5)}涨停，小弟跟涨`, chips: [{ icon: 'glyph:bolt', text: '大哥', tone: 'accent' }, { icon: 'glyph:arrow_up', text: `+${mv.chain.toFixed(1)}%`, tone: 'up' }] };
      }
      return { line: '大哥涨停，小弟跟着涨', chips: [{ icon: 'glyph:bolt', text: '大哥', tone: 'accent' }, { icon: 'glyph:arrow_up', text: '小弟', tone: 'up' }] };
    }
    case 'boards': {
      const mv = last && stockId ? last.stocks.find((x) => x.id === stockId) : undefined;
      if (mv?.blown && stockId) return { line: `${name(stockId, 6)}涨停没封住`, chips: [{ icon: 'glyph:bolt', text: '没封住', tone: 'accent' }, { icon: 'glyph:arrow_down', text: '连越久摔越疼', tone: 'down' }] };
      if (mv && stockId && mv.boards >= 2) return { line: `${name(stockId, 6)}连涨停${mv.boards}天`, chips: [{ icon: 'glyph:bolt', text: `连涨停${mv.boards}天`, tone: 'up' }, { icon: 'glyph:arrow_down', text: '随时会掉', tone: 'down' }] };
      return { line: '连着涨停，越连越悬', chips: [{ icon: 'glyph:bolt', text: '连涨停', tone: 'up' }, { icon: 'glyph:arrow_down', text: '随时会掉', tone: 'down' }] };
    }
    case 'sell':
      return { line: stockId ? `${name(stockId, 6)}今天能卖了` : '这只今天能卖了', chips: [{ icon: 'glyph:hourglass', text: '今买明卖' }, { icon: 'glyph:wallet', text: '卖出变现金', tone: 'accent' }] };
    case 'bill':
      return { line: '月底扣钱，挺过来挑奖励', chips: [{ icon: 'glyph:house', text: `-${money(s.bill.amount)}`, tone: 'down' }, { icon: 'glyph:gift', text: '三选一', tone: 'accent' }] };
  }
}
