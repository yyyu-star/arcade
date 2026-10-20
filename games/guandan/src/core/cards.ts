/**
 * 牌的编码（牌馆通用层，docs/doudizhu.md 第 1 节；掼蛋的级牌、逢人配、理牌在 variants/guandan/core/cards.ts）。
 *
 * 一张牌是 0..107 的整数：两副牌各 54 张，id = 副号 × 54 + i（斗地主只用一副，0..53）。
 * i < 52 时花色 = ⌊i/13⌋（0 黑桃 1 红桃 2 梅花 3 方块），点数 = i % 13 + 2（11 J、12 Q、13 K、14 A）；
 * i = 52 小王，i = 53 大王。用整数是为了状态能直接 JSON 序列化、比较便宜。
 */

export type Card = number;

export const SPADE = 0;
export const HEART = 1;
export const CLUB = 2;
export const DIAMOND = 3;

/** 小王、大王的"点数"。15 留给级牌在单张类牌型里的位置。 */
export const SMALL_JOKER = 16;
export const BIG_JOKER = 17;
export const ACE = 14;
/** 顺子类里 A 可作 1：点数 1 映射回 A。 */
export const natRank = (r: number): number => (r === 1 ? ACE : r);


/** 点数：2..14，小王 16，大王 17。 */
export function rankOf(c: Card): number {
  const i = c % 54;
  if (i === 52) return SMALL_JOKER;
  if (i === 53) return BIG_JOKER;
  return (i % 13) + 2;
}

/** 花色 0..3；王返回 -1。 */
export function suitOf(c: Card): number {
  const i = c % 54;
  return i >= 52 ? -1 : Math.floor(i / 13);
}

export function isJoker(c: Card): boolean {
  return c % 54 >= 52;
}


/** 由花色和点数造牌（deck 0/1）。点数 16/17 表示王，花色忽略。 */
export function makeCard(rank: number, suit: number, deck = 0): Card {
  if (rank === SMALL_JOKER) return deck * 54 + 52;
  if (rank === BIG_JOKER) return deck * 54 + 53;
  return deck * 54 + suit * 13 + (rank - 2);
}


const RANK_NAMES: Record<number, string> = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A', 16: '小王', 17: '大王' };
const SUIT_NAMES = ['♠', '♥', '♣', '♦'];

export function rankName(rank: number): string {
  return RANK_NAMES[rank] ?? String(rank);
}

/** 牌面文字，例如 "♥7"、"大王"。调试和测试用，画面层自己画牌。 */
export function cardName(c: Card): string {
  if (isJoker(c)) return rankName(rankOf(c));
  return `${SUIT_NAMES[suitOf(c)]}${rankName(rankOf(c))}`;
}

/**
 * 测试和调试用：把 "♠3 ♥7 小王 大王" 或 "S3 H7 SJ BJ" 解析成牌。同一张牌出现两次时第二次取第二副。
 */
export function parseCards(text: string): Card[] {
  const used = new Set<Card>();
  const out: Card[] = [];
  const suitMap: Record<string, number> = { '♠': 0, S: 0, '♥': 1, H: 1, '♣': 2, C: 2, '♦': 3, D: 3 };
  const rankMap: Record<string, number> = { J: 11, Q: 12, K: 13, A: 14, T: 10 };
  for (const tok of text.trim().split(/\s+/)) {
    if (!tok) continue;
    let rank: number;
    let suit = 0;
    if (tok === '小王' || tok === 'SJ') rank = SMALL_JOKER;
    else if (tok === '大王' || tok === 'BJ') rank = BIG_JOKER;
    else {
      const s = suitMap[tok[0] as string];
      if (s === undefined) throw new Error(`parseCards: 不认识 ${tok}`);
      suit = s;
      const r = tok.slice(1);
      rank = rankMap[r] ?? Number(r);
      if (!(rank >= 2 && rank <= 14)) throw new Error(`parseCards: 不认识 ${tok}`);
    }
    let c = makeCard(rank, suit, 0);
    if (used.has(c)) c = makeCard(rank, suit, 1);
    if (used.has(c)) throw new Error(`parseCards: ${tok} 超过两张`);
    used.add(c);
    out.push(c);
  }
  return out;
}
