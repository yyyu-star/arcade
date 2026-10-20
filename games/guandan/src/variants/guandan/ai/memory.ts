/**
 * 记牌：只用 viewFor 里公开的信息（自己的手牌 + 本副出牌记录）推算"别人手里还可能有什么"。
 *
 * - `unseen[r]`：除了我的手牌和已经出过的牌，点数 r 还剩几张（不含逢人配；王是 16/17）。这些牌在另外三家手里（含队友）。
 * - `unseenWild`：还没出现的逢人配张数。
 * 判断"我这手是不是已经最大"时把三家当成一个整体（保守：队友手里的也算），只看非炸弹能否压过；
 * 炸弹另用 `bombPossible` 估计。
 *
 * 记性分档：`full` 记全部出牌；`high` 只记大牌（王、级牌、A、K，人类玩家通常只数这些）；`none` 不记牌，只扣掉自己手里的。
 */
import { ACE, BIG_JOKER, SMALL_JOKER, isWild, natRank, orderValue, rankOf, type Card, type Play, type PlayerView } from '../core/index.ts';

export type Recall = 'none' | 'high' | 'full';

export interface Memory {
  level: number;
  /** 下标 0..17；2..14 普通点数，16/17 王 */
  unseen: number[];
  unseenWild: number;
}


export function buildMemory(view: Pick<PlayerView, 'hand' | 'history' | 'level'>, recall: Recall = 'full'): Memory {
  const level = view.level;
  const unseen = new Array<number>(18).fill(0);
  for (let r = 2; r <= ACE; r++) unseen[r] = r === level ? 6 : 8;
  unseen[SMALL_JOKER] = 2;
  unseen[BIG_JOKER] = 2;
  let unseenWild = 2;
  const remove = (c: Card) => {
    if (isWild(c, level)) unseenWild--;
    else unseen[rankOf(c)]!--;
  };
  for (const c of view.hand) remove(c);
  if (recall !== 'none') {
    for (const rec of view.history) {
      if (!rec.play) continue;
      for (const c of rec.play.cards) {
        if (recall === 'high') {
          const r = rankOf(c);
          if (!(isWild(c, level) || r >= SMALL_JOKER || r === level || r >= 13)) continue;
        }
        remove(c);
      }
    }
  }
  return { level, unseen, unseenWild };
}

/** 别人用某个点数凑够 n 张（可借逢人配，王不能借）是否可能。 */
function canMake(m: Memory, r: number, n: number): boolean {
  const have = m.unseen[r]!;
  if (r >= SMALL_JOKER) return have >= n;
  if (have + m.unseenWild < n) return false;
  // 全是逢人配时只能当级牌
  return have > 0 || r === m.level;
}

/** 顺子类 need 列表能否被别人凑出（逢人配补缺口；同一张逢人配不能用两次）。 */
function canMakeSeq(m: Memory, need: [number, number][]): boolean {
  let deficit = 0;
  for (const [r, n] of need) deficit += Math.max(0, n - m.unseen[r]!);
  return deficit <= m.unseenWild;
}

function seqNeed(type: 'straight' | 'tube' | 'plate', top: number): [number, number][] {
  const need: [number, number][] = [];
  if (type === 'straight') for (let r = top - 4; r <= top; r++) need.push([natRank(r), 1]);
  else if (type === 'tube') for (let r = top - 2; r <= top; r++) need.push([natRank(r), 2]);
  else need.push([natRank(top - 1), 3], [top, 3]);
  return need;
}

/** 别人能不能用非炸弹压过这一手（炸弹类返回别人能否用更大的炸弹压）。 */
export function beatableByOthers(m: Memory, p: Pick<Play, 'type' | 'value' | 'rank' | 'cards'>): boolean {
  const level = m.level;
  switch (p.type) {
    case 'single':
    case 'pair':
    case 'triple':
    case 'fullHouse': {
      const n = p.type === 'single' ? 1 : p.type === 'pair' ? 2 : 3;
      const maxR = p.type === 'single' || p.type === 'pair' ? BIG_JOKER : ACE;
      for (let r = 2; r <= maxR; r++) {
        if (r === 15) continue;
        if (orderValue(r, level) <= p.value) continue;
        if (canMake(m, r, n)) return true;
      }
      return false;
    }
    case 'straight':
    case 'tube':
    case 'plate':
      for (let top = p.rank + 1; top <= ACE; top++) if (canMakeSeq(m, seqNeed(p.type, top))) return true;
      return false;
    default:
      return bombPossible(m, p);
  }
}

/** 别人可能有能压过 p 的炸弹吗（p 为 null 或非炸弹时：有没有任何炸弹）。按"三家合起来"估计，偏保守。 */
export function bombPossible(m: Memory, p: Pick<Play, 'type' | 'value' | 'cards'> | null): boolean {
  const tier = !p ? 0 : p.type === 'jokerBomb' ? 1000 : p.type === 'straightFlush' ? 55 : p.type === 'bomb' ? p.cards.length * 10 : 0;
  if (tier >= 1000) return false;
  if (m.unseen[SMALL_JOKER] === 2 && m.unseen[BIG_JOKER] === 2) return true;
  for (let r = 2; r <= ACE; r++) {
    const max = m.unseen[r]! + m.unseenWild;
    if (max < 4) continue;
    const size = Math.min(max, 10);
    const t = size * 10;
    if (t > tier || (t === tier && orderValue(r, m.level) > (p?.value ?? 0))) return true;
  }
  // 同花顺：只要某个点数段还剩得多就有可能，这里不细算花色，粗略认为 tier < 55 时可能
  return tier < 55 && hasSeqStock(m);
}

function hasSeqStock(m: Memory): boolean {
  let run = 0;
  for (let r = 2; r <= ACE; r++) {
    run = m.unseen[r]! > 0 ? run + 1 : 0;
    if (run >= 5) return true;
  }
  return false;
}

/** 这一手（非炸弹）是不是已经"最大"：别人除炸弹外压不过。 */
export function isTop(m: Memory, p: Pick<Play, 'type' | 'value' | 'rank' | 'cards'>): boolean {
  return !beatableByOthers(m, p);
}
