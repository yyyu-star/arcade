/**
 * 牌局里公开的事 → 互动（DESIGN.md 第 6 节）：电脑怎么反应、冷却、护盾、连击回敬都在 kit 的 table-fun / fun-logic 里（docs/table-fun.md 第 0 节），
 * 这里只做本游戏那一半：从公开事件认出名场面，映射成 kit 的几类事件；再列出这一场的名场面（一场的总结算里用）。
 * 公平底线：只看公开的事（谁胡了、谁点炮、谁杠了），不看任何人的手牌；电脑出牌（src/ai）绝不读这里（test/arch.test.ts 检查 import）。
 * 单机在页面上用（main.ts 交给 TableFun.moment），好友房在房间里用（room/talk.ts 交给 botReact）：同一份映射。
 */
import type { FunEvent } from 'arcade-kit/fun-logic';
import type { FanId } from '../core/variants/sichuan-xuezhan/fan.ts';
import type { XzEvent } from '../core/variants/sichuan-xuezhan/rules.ts';
import type { RcHighlightId } from './riichi-fun.ts';

/** 牌局里刚发生的公开的事 */
export type Moment =
  | { k: 'hu'; seat: number; from: number | null; fan: number; /** 番型里有杠上开花、清一色 */ gangkai?: boolean; qing?: boolean }
  | { k: 'kan'; seat: number };

/** 这一步的事件 → 公开的事（只取公开的字段：暗杠的牌、摸到的牌都不看） */
export function momentsOf(events: readonly XzEvent[]): Moment[] {
  const out: Moment[] = [];
  for (const e of events) {
    if (e.e === 'hu') out.push({ k: 'hu', seat: e.seat, from: e.from, fan: e.fan, gangkai: e.items.some((x) => x.id === 'gangkai'), qing: e.items.some((x) => x.id === 'qing') });
    else if (e.e === 'kan') out.push({ k: 'kan', seat: e.seat });
  }
  return out;
}

type FunMoment = Extract<FunEvent, { kind: 'moment' }>;

/**
 * 麻将的名场面（docs/table-fun.md 第 4 节）：杠、杠上开花、自摸、清一色。别人点炮的普通小胡不算（不然一局吵好几回）。
 * 赢的是杠、胡的人；输的是点炮的人，自摸和杠是还在打的其他人。hand 是第几局（kit 按它数"每手电脑主动最多 2 次"）。
 */
export function funMoments(ms: readonly Moment[], playing: readonly boolean[], hand: number): FunMoment[] {
  const others = (seat: number): number[] => playing.flatMap((on, i) => (on && i !== seat ? [i] : []));
  const out: FunMoment[] = [];
  for (const m of ms) {
    if (m.k === 'kan') {
      out.push({ kind: 'moment', moment: 'kong', winners: [m.seat], losers: others(m.seat), hand });
      continue;
    }
    const moment = m.gangkai ? 'gang-flower' : m.qing ? 'flush' : m.from === null ? 'self-draw' : null;
    if (moment) out.push({ kind: 'moment', moment, winners: [m.seat], losers: m.from === null ? others(m.seat) : [m.from], hand });
  }
  return out;
}

/** 川麻的，加上立直的（game/riichi-fun.ts） */
export type HighlightId = 'multi2' | 'multi3' | 'gangkai' | 'qianggang' | 'tianhu' | 'dihu' | 'haidi' | 'longqidui' | 'qing' | 'jingou' | 'capped' | RcHighlightId;

export interface Highlight {
  id: HighlightId;
  /** 胡的人（一炮多响是点炮的人） */
  seat: number;
  round: number;
}

/** 番型 → 名场面（按这个顺序，一个胡只记最响的那一个） */
const FAN_HIGHLIGHT: [FanId, HighlightId][] = [
  ['tianhu', 'tianhu'],
  ['dihu', 'dihu'],
  ['gangkai', 'gangkai'],
  ['qianggang', 'qianggang'],
  ['haidi', 'haidi'],
  ['longqidui', 'longqidui'],
  ['jingou', 'jingou'],
  ['qing', 'qing'],
];

/** 这一步里的名场面：一炮多响、杠上开花、抢杠、天胡地胡、海底捞月、龙七对、金钩钓、清一色、封顶 */
export function highlightsOf(events: readonly XzEvent[], round: number, cap: number): Highlight[] {
  const out: Highlight[] = [];
  const hus = events.filter((e): e is Extract<XzEvent, { e: 'hu' }> => e.e === 'hu');
  const from = hus[0]?.from;
  if (hus.length >= 2 && from !== null && from !== undefined && hus.every((h) => h.from === from)) out.push({ id: hus.length >= 3 ? 'multi3' : 'multi2', seat: from, round });
  for (const h of hus) {
    const hit = FAN_HIGHLIGHT.find(([f]) => h.items.some((x) => x.id === f));
    if (hit) out.push({ id: hit[1], seat: h.seat, round });
    else if (h.fan >= cap) out.push({ id: 'capped', seat: h.seat, round });
  }
  return out;
}
