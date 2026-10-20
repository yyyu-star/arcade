/**
 * 牌型识别框架（牌馆通用层，docs/doudizhu.md 1.1）：一手牌的通用形状和每个玩法要给的那几个函数。
 * 流程两个玩法一样：选中的牌 → interpret 列出所有读法 → 首出时让人在读法里挑、跟牌时 choose 取压得上的；电脑和"提示"用 enumerate。
 * 规则核心的约束照旧：纯函数，不碰 DOM、时间、Math.random。
 */
import type { Card } from './cards.ts';

/** 一手牌最少要有的：牌型名和这几张牌（各玩法在上面加自己的字段：掼蛋的 rank/value/extra，斗地主的 v/len） */
export interface PlayBase {
  type: string;
  cards: Card[];
}

/**
 * 一个玩法的牌型规则。C 是识别时要的上下文（掼蛋是级牌和规则开关，斗地主不要，传 undefined）。
 * 各函数的含义以玩法自己的规则文档为准（docs/rules.md）。
 */
export interface PatternSet<P extends PlayBase, C> {
  /** 这几张牌能当哪些牌型；不成牌型回空数组 */
  interpret(cards: readonly Card[], ctx: C): P[];
  /** a 能不能压 b */
  beats(a: P, b: P): boolean;
  /** 炸弹类（翻倍、压一切非炸弹的那些） */
  isBomb(p: P): boolean;
  /** 几种读法里选一种：target 是要压的那手（首出时 null）；选不出回 null */
  choose(options: readonly P[], target: P | null): P | null;
  /** 手里能出的（电脑、提示用；不要求列全，规则文档写明列到什么程度） */
  enumerate(hand: readonly Card[], ctx: C): P[];
}

/** 手里能压住 target 的（首出时 target 为 null，就是全部） */
export function playsBeatingWith<P extends PlayBase, C>(set: PatternSet<P, C>, hand: readonly Card[], target: P | null, ctx: C): P[] {
  const all = set.enumerate(hand, ctx);
  return target ? all.filter((p) => set.beats(p, target)) : all;
}
