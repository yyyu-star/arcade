/**
 * 斗地主画面用的纯函数（牌馆 0.28.0，docs/doudizhu.md 第 4 节）：手牌怎么理、怎么分列，一手牌怎么写，牌点的名字。
 * 不碰 Phaser，单测直接测（tests/ddz-view.test.ts）。
 */
import { rankName, suitOf, type Card } from '../core/cards.ts';
import { DDZ_TYPE_NAMES, ddzValue, isBombish, planHand, sortDdz, type DdzPlay, type DdzType } from '../variants/doudizhu/index.ts';
import { MAX_COL, type SortMode } from './table/columns.ts';
import type { HandOrder } from './table/hand.ts';

/** 点数名：2 记 15，王 16/17 */
export function ddzRankName(v: number): string {
  return v === 15 ? '2' : rankName(v);
}

function splitCol(col: Card[], maxCol: number): Card[][] {
  if (col.length <= maxCol) return [col];
  const half = Math.ceil(col.length / 2);
  return [col.slice(0, half), col.slice(half)];
}

/** 按牌型理牌时各组的先后：大的、整的在左 */
const TYPE_ORDER: Record<DdzType, number> = {
  rocket: 0, bomb: 1, plane2: 2, plane1: 2, plane: 2, straight: 3, pairs: 4, four22: 5, four2: 5, triple2: 6, triple1: 6, triple: 6, pair: 7, single: 8,
};

/** 分列：按点数时同点一列、大的在左；按牌型时按电脑的拆法一组一列（一组太长拆成相邻两列） */
export function ddzColumns(hand: readonly Card[], mode: SortMode, maxCol = MAX_COL): Card[][] {
  const sorted = sortDdz(hand);
  if (mode === 'type') {
    const plan = planHand(sorted, 250);
    const used = new Set<Card>();
    const groups = [...plan.groups].sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || b.cards.length - a.cards.length || b.v - a.v);
    const cols: Card[][] = [];
    for (const g of groups) {
      const cards = g.cards.filter((c) => !used.has(c));
      cards.forEach((c) => used.add(c));
      if (cards.length) cols.push(...splitCol(cards, maxCol));
    }
    const rest = sorted.filter((c) => !used.has(c));
    if (rest.length) cols.push(...ddzColumns(rest, 'rank', maxCol));
    return cols;
  }
  const byV = new Map<number, Card[]>();
  for (const c of sorted) byV.set(ddzValue(c), [...(byV.get(ddzValue(c)) ?? []), c]);
  return [...byV.keys()]
    .sort((a, b) => b - a)
    .flatMap((v) => splitCol(byV.get(v)!.sort((a, b) => suitOf(a) - suitOf(b)), maxCol));
}

/** 给 HandView 的：斗地主没有级牌，level 不用 */
export const DDZ_ORDER: HandOrder = {
  sort: (cards) => sortDdz(cards),
  columns: (cards, _level, mode, maxCol) => ddzColumns(cards, mode, maxCol),
};

/** 出牌区上那手的字，例如"顺子"、"炸弹"、"王炸" */
export function ddzPlayLabel(p: Pick<DdzPlay, 'type'>): string {
  return DDZ_TYPE_NAMES[p.type];
}

/** 一手牌的简短说明（状态栏用），例如"顺子 3 到 7"、"三带一 8" */
export function ddzPlayDetail(p: DdzPlay): string {
  const name = DDZ_TYPE_NAMES[p.type];
  if (p.type === 'rocket') return name;
  if (p.len > 1) return `${name} ${ddzRankName(p.v)} 到 ${ddzRankName(p.v + p.len - 1)}`;
  return `${name} ${ddzRankName(p.v)}`;
}

export const ddzDescribe = (p: DdzPlay): { label: string; bomb: boolean } => ({ label: ddzPlayLabel(p), bomb: isBombish(p) });
