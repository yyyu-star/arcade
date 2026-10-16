import type { AchievementDef, CalendarDef, DifficultyDef, EventDef, ItemDef, PersonaDef } from '../hooks.ts';
import type { FriendDef, PersonaId, StockDef, ThemeDef, ThemeId } from '../types.ts';
import { ACHIEVEMENTS } from './achievements.ts';
import { CALENDAR } from './calendar.ts';
import { DIFFICULTIES, MAX_DIFFICULTY, MIN_DIFFICULTY } from './difficulty.ts';
import { EVENTS } from './events.ts';
import { FRIENDS } from './friends.ts';
import { ITEMS } from './items.ts';
import { PERSONAS } from './personas.ts';
import { STOCKS, THEMES } from './stocks.ts';

export { ACHIEVEMENTS } from './achievements.ts';
export { BILL_NAMES, CALENDAR, SURPRISE_BILLS } from './calendar.ts';
export { DIFFICULTIES, MAX_DIFFICULTY, MIN_DIFFICULTY } from './difficulty.ts';
export { PERSONAS, PERSONA_IDS, personaAccount } from './personas.ts';
export { EVENTS, EVENT_BRIEF, eventSlot, type EventBrief, type EventPick } from './events.ts';
export {
  BIG_LOSS_LINES,
  BIG_WIN_LINES,
  BLAME_LINES,
  BRAG_LINES,
  CHEER_LINES,
  EXT_REACT_LINES,
  FRIENDS,
  HAND_TAILS,
  MESSAGE_LINES,
  MISS_LINES,
  MOCK_LINES,
  REACT_LINES,
  REACT_MOOD,
  REC_LINES,
  TURN_LINES,
  type ReactMoment,
} from './friends.ts';
export { ITEMS, ITEM_BRIEF } from './items.ts';
export {
  COLLATERALS,
  COLLATERAL_IDS,
  EXT_TIPS,
  KNOWLEDGE,
  collateralById,
  collateralTerms,
  isCollateralId,
  knowledgeById,
  type CollateralDef,
  type KnowledgeDef,
} from './ext.ts';
export { ROLES, STOCKS, THEME_IDS, THEMES } from './stocks.ts';

function lookup<T extends { id: string }>(list: readonly T[], what: string): { has(id: string): boolean; get(id: string): T } {
  const map = new Map(list.map((d) => [d.id, d]));
  return {
    has: (id) => map.has(id),
    get(id) {
      const d = map.get(id);
      if (!d) throw new Error(`未知${what}：${id}`);
      return d;
    },
  };
}

const items = lookup(ITEMS, '道具');
const stocks = lookup(STOCKS, '股票');
const themes = lookup(THEMES, '风口');
const friends = lookup(FRIENDS, '群友');
const events = lookup(EVENTS, '事件');
const personas = lookup(PERSONAS, '人设');
const achievements = lookup(ACHIEVEMENTS, '成就');

export const isItemId = (id: string): boolean => items.has(id);
export const itemById = (id: string): ItemDef => items.get(id);
export const isStockId = (id: string): boolean => stocks.has(id);
export const stockById = (id: string): StockDef => stocks.get(id);
export const isThemeId = (id: string): id is ThemeId => themes.has(id);
export const themeById = (id: ThemeId): ThemeDef => themes.get(id);
export const isFriendId = (id: string): boolean => friends.has(id);
export const friendById = (id: string): FriendDef => friends.get(id);
export const isEventId = (id: string): boolean => events.has(id);
export const eventById = (id: string): EventDef => events.get(id);
export const isPersonaId = (id: string): id is PersonaId => personas.has(id);
export const personaById = (id: PersonaId): PersonaDef => personas.get(id);
export const isAchievementId = (id: string): boolean => achievements.has(id);
export const achievementById = (id: string): AchievementDef => achievements.get(id);

/** 某月的日历事件（1..12）。 */
export function calendarOf(month: number): CalendarDef {
  const c = CALENDAR.find((d) => d.month === month);
  if (!c) throw new Error(`没有 ${month} 月的日历`);
  return c;
}

/** 把难度等级规整到 1..8（缺省、0.3.0-alpha.1 的 0 都按 1）。 */
export function clampDifficulty(level: number | undefined): number {
  const v = Math.floor(Number.isFinite(level) ? (level as number) : MIN_DIFFICULTY);
  return Math.max(MIN_DIFFICULTY, Math.min(MAX_DIFFICULTY, v));
}

/** 难度等级定义（1..8）；超出范围时就近取。 */
export function difficultyDef(level: number): DifficultyDef {
  return DIFFICULTIES[clampDifficulty(level) - 1] as DifficultyDef;
}

/** 某题材的股票（按股票池顺序）。 */
const byTheme = new Map<ThemeId, StockDef[]>();
for (const d of STOCKS) {
  const list = byTheme.get(d.theme) ?? [];
  list.push(d);
  byTheme.set(d.theme, list);
}
export function stocksOf(theme: ThemeId): readonly StockDef[] {
  return byTheme.get(theme) ?? [];
}
