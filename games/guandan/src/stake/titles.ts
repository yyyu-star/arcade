/**
 * 称号（0.6.0）：一副、一局打完时从公开出牌记录和名次算 2–3 个好玩的称号，显示在结算页、整局结束页；
 * 实盘结回时称号 id 随战绩小结报给平台（stats.ts），平台的称号墙按 public/titles.json 显示中文名。
 * 只用公开信息（谁出了什么、名次），不看任何人的手牌；只说打法，不说人。
 */
import { isBomb, teamOf, type DealResult, type PlayRecord } from '../core/index.ts';
import { dealPoints } from './index.ts';

/** 称号 id → 名字和怎么拿到的（public/titles.json 是同一份，tests/stats.test.ts 核对两边一致；id 只能往后加、不改） */
export const TITLE_INFO = {
  bomb_maniac: { name: '炸弹狂魔', desc: '一副里炸弹比谁都多（至少 2 个）' },
  best_partner: { name: '最佳搭档', desc: '和对家一起双下对面' },
  scapegoat: { name: '背锅侠', desc: '输的那一队里拿了末游' },
  ninja: { name: '忍者', desc: '一副里"不要"了 8 次以上，憋大招' },
  first_king: { name: '头游王', desc: '一局里拿了两次以上头游' },
} as const;
export type TitleId = keyof typeof TITLE_INFO;

export interface Title {
  id: TitleId;
  seat: number;
  why: string;
  /** 给一队两个人的（seat 是队里任意一人，画的时候连对家一起写） */
  pair?: boolean;
}


export function bombsBy(history: readonly PlayRecord[]): number[] {
  const n = [0, 0, 0, 0];
  for (const h of history) if (h.play && isBomb(h.play)) n[h.seat]!++;
  return n;
}

function top(n: readonly number[], min: number): number {
  let best = -1;
  n.forEach((v, i) => {
    if (v >= min && (best < 0 || v > n[best]!)) best = i;
  });
  // 并列第一不给（称号要有点"独一份"）
  return best >= 0 && n.filter((v) => v === n[best]).length === 1 ? best : -1;
}

/** 这一副的称号（最多 3 个） */
export function dealTitles(r: DealResult, history: readonly PlayRecord[]): Title[] {
  const out: Title[] = [];
  const bombs = bombsBy(history);
  const b = top(bombs, 2);
  if (b >= 0) out.push({ id: 'bomb_maniac', seat: b, why: `炸了 ${bombs[b]} 次` });
  if (r.doubleDown) {
    const w = r.order[0]!;
    out.push({ id: 'best_partner', seat: w, why: '一起双下对面', pair: true });
  }
  const last = r.order[3]!;
  if (teamOf(last) !== r.winnerTeam) out.push({ id: 'scapegoat', seat: last, why: '末游，这副输在这儿' });
  if (out.length < 3) {
    const passes = [0, 0, 0, 0];
    for (const h of history) if (!h.play) passes[h.seat]!++;
    const p = top(passes, 8);
    if (p >= 0 && !out.some((t) => t.seat === p)) out.push({ id: 'ninja', seat: p, why: `"不要"了 ${passes[p]} 次，憋大招` });
  }
  return out.slice(0, 3);
}

/** 一局（多副）攒下来的数 */
export interface MatchLog {
  deals: number;
  firsts: number[];
  lasts: number[];
  bombs: number[];
  /** 每队赢了几副 */
  wins: number[];
  /** 每个座位按名次攒的分：头游 3、二游 2、三游 1、末游 0（0.14.0，结束颁奖的 MVP 用）；之前开的好友房没有 */
  places?: number[];
  /** 每队这一场的分（每副按实盘的算法 dealPoints 加起来，不封顶；0.16.0，搭子战绩里实盘谁赢用）；之前开的房间没有 */
  score?: number[];
}

export const emptyMatchLog = (): MatchLog => ({ deals: 0, firsts: [0, 0, 0, 0], lasts: [0, 0, 0, 0], bombs: [0, 0, 0, 0], wins: [0, 0], places: [0, 0, 0, 0], score: [0, 0] });

export function logDeal(m: MatchLog, r: DealResult, history: readonly PlayRecord[]): MatchLog {
  const bombs = bombsBy(history);
  return {
    deals: m.deals + 1,
    firsts: m.firsts.map((v, i) => v + (r.order[0] === i ? 1 : 0)),
    lasts: m.lasts.map((v, i) => v + (r.order[3] === i ? 1 : 0)),
    bombs: m.bombs.map((v, i) => v + bombs[i]!),
    wins: m.wins.map((v, t) => v + (r.winnerTeam === t ? 1 : 0)),
    places: (m.places ?? [0, 0, 0, 0]).map((v, i) => v + 3 - r.order.indexOf(i)),
    score: (m.score ?? [0, 0]).map((v, t) => v + dealPoints(r, t)),
  };
}

/** 整局的称号（最多 3 个） */
export function matchTitles(m: MatchLog): Title[] {
  const out: Title[] = [];
  const f = top(m.firsts, 2);
  if (f >= 0) out.push({ id: 'first_king', seat: f, why: `拿了 ${m.firsts[f]} 次头游` });
  const b = top(m.bombs, 3);
  if (b >= 0) out.push({ id: 'bomb_maniac', seat: b, why: `一共炸了 ${m.bombs[b]} 次` });
  const l = top(m.lasts, 2);
  if (l >= 0 && out.length < 3) out.push({ id: 'scapegoat', seat: l, why: `末游 ${m.lasts[l]} 次` });
  if (out.length < 3 && m.deals >= 2) {
    const t = m.wins[0]! === m.wins[1]! ? -1 : m.wins[0]! > m.wins[1]! ? 0 : 1;
    if (t >= 0) out.push({ id: 'best_partner', seat: t, why: `两人一起赢了 ${m.wins[t]} 副`, pair: true });
  }
  return out.slice(0, 3);
}
