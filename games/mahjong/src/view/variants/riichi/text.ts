/**
 * 立直麻将给人看的字（AGENTS.md 第 4 节：中文、大白话）。役的名字在规则核心（score.ts 的 YAKU_NAME），这里不重复。
 */
import type { HandScore, RcEnd } from '../../../core/variants/riichi/index.ts';

export const RC_WIND = ['东', '南', '西', '北'] as const;
const NUM = ['一', '二', '三', '四'] as const;

/** 局名：东一局、南三局 */
export const roundName = (wind: number, hand: number): string => `${RC_WIND[wind] ?? '东'}${NUM[hand] ?? '一'}局`;

/** 一局怎么结束的（结算标题、牌桌上的大字） */
export const END_NAME: Record<RcEnd, string> = {
  ron: '荣和',
  tsumo: '自摸',
  draw: '荒牌流局',
  nagashi: '流局满贯',
  nine_terminals: '九种九牌',
  four_winds: '四风连打',
  four_kans: '四杠散了',
  four_riichi: '四家立直',
  three_ron: '三家和',
};

/** 中途流局的原因（一句话，不用术语） */
export const ABORT_WHY: Partial<Record<RcEnd, string>> = {
  nine_terminals: '第一巡手里有 9 种以上的幺九牌，宣告流局',
  four_winds: '第一巡四家打出同一种风牌',
  four_kans: '两人以上合计开了四个杠',
  four_riichi: '四家都立直了',
  three_ron: '三家同时和同一张牌',
};

/** 满贯以上的叫法 */
export const LIMIT_NAME: Record<HandScore['limit'], string> = {
  none: '',
  mangan: '满贯',
  haneman: '跳满',
  baiman: '倍满',
  sanbaiman: '三倍满',
  yakuman: '役满',
};

/** 点数怎么动的（结算里的流水） */
export const PAY_NAME: Record<string, string> = {
  ron: '荣和',
  tsumo: '自摸',
  honba: '本场',
  stick: '供托',
  pao: '包牌',
  noten: '不听罚符',
  nagashi: '流局满贯',
};

/** 振听的原因 */
export const FURITEN_WHY = { river: '舍张', passed: '同巡', riichi: '立直后' } as const;

/** 役满倍数的叫法 */
export const yakumanName = (n: number): string => (n <= 1 ? '役满' : n === 2 ? '双倍役满' : n === 3 ? '三倍役满' : `${n} 倍役满`);

/** 带一位小数和正负号的得分（千点）：+52.3、−18.4 */
export const scoreText = (points: number): string => {
  const x = Math.round(points / 100) / 10;
  return x > 0 ? `+${x.toFixed(1)}` : x < 0 ? `−${(-x).toFixed(1)}` : '0.0';
};
