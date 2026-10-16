/**
 * 长线系统（0.3.0）给画面和档案用的规则层数据：人设、难度、成就判定、图鉴条目、每日挑战。
 * 全部是纯函数、确定性；档案的存取在 src/platform/profile.ts。
 */
import { fx } from './balance.ts';
import {
  ACHIEVEMENTS,
  DIFFICULTIES,
  EVENTS,
  FRIENDS,
  ITEMS,
  PERSONAS,
  STOCKS,
  achievementById,
  clampDifficulty,
  difficultyDef,
  personaById,
  themeById,
} from './content/index.ts';
import { ITEM_KIND_LABEL, RARITY_LABEL, ROLE_LABEL } from './labels.ts';
import type {
  AchievementIcon,
  AchievementTier,
  GameState,
  ItemKind,
  PersonaId,
  Rarity,
  Role,
  ThemeId,
  TradeLog,
} from './types.ts';

// ================================================================ 人设、难度

export interface PersonaView {
  id: PersonaId;
  name: string;
  title: string;
  /** 开局条件（一句话） */
  desc: string;
  flavor: string;
  /** 开局账户（元） */
  account: number;
  /** 开局自带的道具 id */
  items: string[];
  /** 必定登场的题材 id */
  themes: ThemeId[];
  /** 开局就能选 */
  starter: boolean;
  /** 解锁它的成就（开局可选的为 null） */
  unlockBy: { id: string; name: string; desc: string } | null;
}

export function personaView(id: PersonaId): PersonaView {
  const d = personaById(id);
  const ach = d.unlock === 'start' ? null : achievementById(d.unlock.achievement);
  return {
    id,
    name: d.name,
    title: d.title,
    desc: d.desc(),
    flavor: d.flavor,
    account: fx(id, 'account'),
    items: [...d.items],
    themes: [...d.themes],
    starter: d.unlock === 'start',
    unlockBy: ach ? { id: ach.id, name: ach.name, desc: ach.desc } : null,
  };
}

/** 全部人设（按固定顺序：newbie、retiree、mom、coder、youzi）。 */
export function personasView(): PersonaView[] {
  return PERSONAS.map((d) => personaView(d.id));
}

export interface DifficultyView {
  level: number;
  id: string;
  name: string;
  /** 这一级新增的约束：一句体感，不带数字 */
  desc: string;
  /** 具体数字（画面悬停时显示）；这一级没有要补充的数字时为 null */
  detail: string | null;
  /** 0.10.0 适合谁（新手 / 普通 / 高手三级有，后面的挑战级为 null） */
  who: string | null;
  /** 1..level 全部约束（逐级叠加），按级排列 */
  all: { level: number; name: string; desc: string; detail: string | null }[];
}

export function difficultyView(level: number): DifficultyView {
  const lv = clampDifficulty(level);
  const d = difficultyDef(lv);
  return {
    level: lv,
    id: d.id,
    name: d.name,
    desc: d.desc,
    detail: d.detail ?? null,
    who: d.who ?? null,
    all: DIFFICULTIES.filter((x) => x.level <= lv).map((x) => ({ level: x.level, name: x.name, desc: x.desc, detail: x.detail ?? null })),
  };
}

export function difficultiesView(): DifficultyView[] {
  return DIFFICULTIES.map((d) => difficultyView(d.level));
}

// ================================================================ 成就

export interface AchievementView {
  id: string;
  name: string;
  desc: string;
  tier: AchievementTier;
  /** 铜 / 银 / 金 */
  tierLabel: string;
  icon: AchievementIcon;
  /** 达成后解锁的人设 */
  unlocks: PersonaId | null;
  /** 隐藏结局 */
  hidden: boolean;
}

export const TIER_LABEL: Record<AchievementTier, string> = { bronze: '铜', silver: '银', gold: '金' };

export function achievementView(id: string): AchievementView {
  const d = achievementById(id);
  return { id, name: d.name, desc: d.desc, tier: d.tier, tierLabel: TIER_LABEL[d.tier], icon: d.icon, unlocks: d.unlocks ?? null, hidden: d.hidden ?? false };
}

export function achievementsView(): AchievementView[] {
  return ACHIEVEMENTS.map((d) => achievementView(d.id));
}

/** 全部交易：已了结的 + 结束时还拿着的（reason 为 'end'）。 */
export function allTrades(s: Readonly<GameState>): TradeLog[] {
  const out = [...s.stats.trades];
  for (const h of s.slots) {
    if (!h) continue;
    out.push({
      stockId: h.stockId,
      buyDay: h.boughtDay,
      sellDay: s.dayIndex,
      stage: h.buyStage,
      feel: h.buyFeel,
      ret: Math.round((h.value - 1) * 10000) / 100,
      reason: 'end',
      recBy: h.recBy,
      contra: h.contra,
      guard: h.buyStage === 'climax' && h.sawEbb,
      ...(s.ext ? { short: !!h.short, units: h.units ?? 1 } : {}),
    });
  }
  return out;
}

/**
 * 本局达成的成就 id（按 ACHIEVEMENTS 的顺序）。只在一局结束（won / lost）后判定，局中返回空数组
 * （有的成就要用隐藏信息判定，局中判定会剧透）。不管开局设置是不是调试用的，档案层再决定计不计。
 */
export function achievementsOf(s: Readonly<GameState>): string[] {
  if (s.phase !== 'won' && s.phase !== 'lost') return [];
  const ctx = { state: s, won: s.phase === 'won', trades: allTrades(s) };
  return ACHIEVEMENTS.filter((d) => d.check(ctx)).map((d) => d.id);
}

/** 结束页"下次可以试试"的一条：一个还没拿到的计数型成就，这局做到了多少 */
export interface AchievementHint {
  id: string;
  name: string;
  desc: string;
  have: number;
  need: number;
}

/**
 * 0.6.8 结束页"下次可以试试"：这局做到一部分、档案里还没有的计数型公开成就（隐藏结局不剧透），
 * 按完成度从高到低取前 n 个，同样高的按成就表的顺序。只看这局，局还没结束为空。
 */
export function achievementHints(s: Readonly<GameState>, owned: Iterable<string>, n = 2): AchievementHint[] {
  if (s.phase !== 'won' && s.phase !== 'lost') return [];
  const have = new Set(owned);
  const ctx = { state: s, won: s.phase === 'won', trades: allTrades(s) };
  const out: (AchievementHint & { r: number; i: number })[] = [];
  ACHIEVEMENTS.forEach((d, i) => {
    if (d.hidden || !d.progress || have.has(d.id) || d.check(ctx)) return;
    const [got, need] = d.progress(ctx);
    if (!(got > 0) || !(need > 0) || got >= need) return;
    out.push({ id: d.id, name: d.name, desc: d.desc, have: got, need, r: got / need, i });
  });
  return out
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .slice(0, n)
    .map(({ id, name, desc, have: h, need }) => ({ id, name, desc, have: h, need }));
}

// ================================================================ 图鉴

/** 一局里见过的东西（档案合并进图鉴）。 */
export interface SeenSets {
  /** 本局登场的股票（看板上都能看到） */
  stocks: string[];
  /** 入群或出现在奖励卡上的群友 */
  friends: string[];
  /** 持有过或出现在奖励卡上的道具 */
  items: string[];
  /** 遇到过的事件 */
  events: string[];
}

export function seenOf(s: Readonly<GameState>): SeenSets {
  const friends = new Set([...s.friends.map((f) => f.id), ...s.stats.seenFriends]);
  const items = new Set([...s.items, ...s.stats.seenItems]);
  return {
    stocks: STOCKS.filter((d) => s.stocks[d.id]).map((d) => d.id),
    friends: FRIENDS.filter((d) => friends.has(d.id)).map((d) => d.id),
    items: ITEMS.filter((d) => items.has(d.id)).map((d) => d.id),
    events: EVENTS.filter((d) => s.stats.events.includes(d.id)).map((d) => d.id),
  };
}

export type CodexKind = 'stock' | 'friend' | 'item' | 'event' | 'achievement';

export interface CodexEntry {
  kind: CodexKind;
  id: string;
  name: string;
  /** 一句话说明（股票：题材 + 角色；群友：身份 + 性格；道具：效果；事件：开头；成就：条件） */
  desc: string;
  /** 小字：俏皮话、分类、档位等 */
  note: string;
  /** 股票 */
  theme?: ThemeId;
  role?: Role;
  /** 道具 */
  itemKind?: ItemKind;
  rarity?: Rarity;
  /** 成就 */
  tier?: AchievementTier;
  icon?: AchievementIcon;
  /** 隐藏结局（没达成前不剧透） */
  hidden?: boolean;
}

export interface Codex {
  stocks: CodexEntry[];
  friends: CodexEntry[];
  items: CodexEntry[];
  events: CodexEntry[];
  achievements: CodexEntry[];
}

/** 图鉴的全部条目（与见没见过无关；画面按档案里的 seen / achievements 决定点亮还是剪影）。 */
export function codex(): Codex {
  return {
    stocks: STOCKS.map((d) => ({
      kind: 'stock',
      id: d.id,
      name: d.name,
      desc: `${themeById(d.theme).name}${ROLE_LABEL[d.role]}`,
      note: ROLE_LABEL[d.role],
      theme: d.theme,
      role: d.role,
    })),
    friends: FRIENDS.map((d) => ({ kind: 'friend', id: d.id, name: d.name, desc: `${d.title}：${d.desc}`, note: d.founding ? '开局在群' : '道具或奖励带来' })),
    items: ITEMS.map((d) => ({
      kind: 'item',
      id: d.id,
      name: d.name,
      desc: d.desc(),
      note: `${ITEM_KIND_LABEL[d.kind]} · ${RARITY_LABEL[d.rarity]} · ${d.flavor}`,
      itemKind: d.kind,
      rarity: d.rarity,
    })),
    events: EVENTS.map((d) => ({ kind: 'event', id: d.id, name: d.name, desc: EVENT_BLURB[d.id] ?? d.name, note: '月度奖励之后随机出现' })),
    achievements: ACHIEVEMENTS.map((d) => ({
      kind: 'achievement',
      id: d.id,
      name: d.name,
      desc: d.desc,
      note: `${TIER_LABEL[d.tier]}${d.unlocks ? ` · 解锁人设：${personaById(d.unlocks).name}` : ''}`,
      tier: d.tier,
      icon: d.icon,
      hidden: d.hidden ?? false,
    })),
  };
}

/** 事件的图鉴简介（不依赖局面）。 */
const EVENT_BLURB: Record<string, string> = {
  bank_manager: '银行经理上门，劝你押点东西借钱',
  bear_live: '戴墨镜的大V送你一张押跌体验卡',
  mother_in_law: '东西押出去了，丈母娘打电话来查岗',
  parents_call: '爸妈打电话问养老钱用得怎么样',
  cousin: '表哥神秘兮兮地推荐了一只过山车股',
  livestream: '大V直播间喊你跟着买',
  lottery_party: '公司年会抽红包',
  course: '韭菜收割机私聊你卖课',
  lottery: '路过彩票店',
  bonus: '公司发年终奖',
  landlord: '房东说下个月起涨房租',
  classmate_loan: '大学室友找你借钱',
  side_hustle: '朋友拉你周末去夜市摆摊',
  cat_keyboard: '猫踩过键盘，下了一笔买单',
  red_packet: '韭菜收割机在群里发拼手气红包',
  quant_trial: '炒股软件邀请你免费试用',
  blind_box: '楼下开了家炒股盲盒店',
  fund_manager: '银行理财经理打来电话',
  overtime: '老板喊你周末加班',
};

// ================================================================ 每日挑战（实现在 daily.ts）

export { DAILY_LEVELS, dailySetup, isDailyRun } from './daily.ts';

/** 32 位 FNV-1a（十六进制 8 位），给 runId 用。 */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * 一局的唯一标识（档案去重用）：种子 + 人设 + 难度 + 操作数 + 全部操作的哈希。
 * 同种子再来、步数相同但操作不同的两局 runId 不同；操作完全相同的两局就是同一局（引擎是确定的）。
 */
export function runId(s: Readonly<GameState>): string {
  return `${s.seed}|${s.persona}|${s.difficulty}|${s.actions.length}|${fnv1a(JSON.stringify(s.actions))}`;
}

