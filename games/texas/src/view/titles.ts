/**
 * 名场面和称号（0.3.0，DESIGN.md 13.4）：只用公开信息——操作记录、摊牌亮出来的牌、桌上看得到的筹码。没亮的底牌一概不用。
 * 在每个人自己的页面上算，不进规则、不存盘（刷新从头算）。
 */
import { categoryOf, QUADS, STRAIGHT_FLUSH } from '../core/eval.ts';
import { bluffer, riverTurnaround } from '../core/fame.ts';
import type { HandResult, LogEntry } from '../core/table.ts';
import type { View } from '../core/view.ts';

export type Moment = 'river' | 'quads' | 'allin';

export interface Showcase {
  kind: Moment;
  /** 主角的座位（逆转、大牌是赢的那个；全下对决是赢了主池的那个） */
  seat: number;
  /** 全下对决主池平分了（seat 是其中一个，横幅不点名） */
  split?: true;
}

/** 这一手的名场面（摊牌以后才有）：河牌逆转 > 四条以上 > 全下对决 */
export function showcase(r: HandResult, log: readonly LogEntry[]): Showcase | null {
  if (r.byFold || r.shown.length < 2) return null;
  const river = riverTurnaround(r);
  if (river !== null) return { kind: 'river', seat: river };
  const big = r.shown.filter((s) => categoryOf(s.value) >= QUADS).sort((a, b) => b.value - a.value)[0];
  if (big) return { kind: 'quads', seat: big.seat };
  const allin = r.shown.some((s) => log.some((e) => e.seat === s.seat && e.allin && e.act !== 'sb' && e.act !== 'bb'));
  // 按主池的赢家写（0.3.0 实打：原来取"赢了任何一个池"的第一个，只平分了边池的人被写成了笑到最后）
  const main = r.pots[0]?.winners ?? [];
  if (!allin || !main.length) return null;
  return main.length > 1 ? { kind: 'allin', seat: main[0]!.seat, split: true } : { kind: 'allin', seat: main[0]!.seat };
}

/** 横幅上的一句 */
export function showcaseText(s: Showcase, name: string, r: HandResult): string {
  if (s.kind === 'river') return `河牌逆转！${name} 最后一张翻盘`;
  if (s.kind === 'allin') return s.split ? '全下对决，平分秋色' : `全下对决，${name} 笑到最后`;
  const v = r.shown.find((x) => x.seat === s.seat)!.value;
  return `${name} 亮出${categoryOf(v) === STRAIGHT_FLUSH ? '同花顺' : '四条'}！`;
}

interface Count {
  name: string;
  bluffs: number;
  calls: number;
  rivers: number;
}

/** 这一场每个人的数（按"座位上是谁"分开，和看对手同一个 key） */
export class Tally {
  private readonly by = new Map<string, Count>();

  /** 一手打完：log 是这一手完整的记录（停着的视图里的），who 给 key 和名字 */
  observe(r: HandResult, log: readonly LogEntry[], who: (seat: number) => { key: string; name: string }): void {
    const seats = new Set(log.filter((e) => e.seat >= 0).map((e) => e.seat));
    for (const i of seats) {
      const c = this.of(who(i));
      c.calls += log.filter((e) => e.seat === i && e.act === 'call').length;
    }
    if (!r.byFold) for (const s of r.shown) if (bluffer(log, s.seat, categoryOf(s.value))) this.of(who(s.seat)).bluffs++;
    const river = riverTurnaround(r);
    if (river !== null) this.of(who(river)).rivers++;
  }

  clear(): void {
    this.by.clear();
  }

  /**
   * 结算页的称号：诈唬王、跟注站、天选之人按数，大赢家、送财童子按这一场的输赢（rows，桌上看得到的）。
   * 同一项并列的取先到的；数不够的不给（诈唬、逆转至少 1 次，跟注至少 6 次）
   */
  titles(rows: readonly { name: string; net: number }[]): { title: string; name: string; why: string }[] {
    const all = [...this.by.values()];
    const top = (k: 'bluffs' | 'calls' | 'rivers', min: number): Count | null => {
      const best = all.reduce<Count | null>((a, c) => (c[k] >= min && (!a || c[k] > a[k]) ? c : a), null);
      return best;
    };
    const out: { title: string; name: string; why: string }[] = [];
    const b = top('bluffs', 1);
    if (b) out.push({ title: '诈唬王', name: b.name, why: `摊牌亮出 ${b.bluffs} 次诈唬` });
    const r = top('rivers', 1);
    if (r) out.push({ title: '天选之人', name: r.name, why: `河牌逆转 ${r.rivers} 次` });
    const c = top('calls', 6);
    if (c) out.push({ title: '跟注站', name: c.name, why: `跟了 ${c.calls} 次` });
    const win = rows.reduce<{ name: string; net: number } | null>((a, x) => (x.net > 0 && (!a || x.net > a.net) ? x : a), null);
    if (win) out.push({ title: '大赢家', name: win.name, why: `赢了 ${win.net.toLocaleString('zh-CN')}` });
    const lose = rows.reduce<{ name: string; net: number } | null>((a, x) => (x.net < 0 && (!a || x.net < a.net) ? x : a), null);
    if (lose) out.push({ title: '送财童子', name: lose.name, why: `送出 ${(-lose.net).toLocaleString('zh-CN')}` });
    return out;
  }

  private of(w: { key: string; name: string }): Count {
    let c = this.by.get(w.key);
    if (!c) this.by.set(w.key, (c = { name: w.name, bluffs: 0, calls: 0, rivers: 0 }));
    c.name = w.name;
    return c;
  }
}

/** 一手打完（prev 是打完前那一步）：这一手的结果和完整记录；不是这一步打完的回 null */
export function handOver(prev: View, next: View): { r: HandResult; log: readonly LogEntry[] } | null {
  const r = next.lastHand;
  if (!r || r.handNo !== prev.handNo || prev.phase === 'idle') return null;
  // 停着的视图里 log 是这一手完整的；老的房间状态（不停）只能用上一步的（少最后一下，一般是跟注或弃牌）
  return { r, log: next.hold ? next.log : prev.log };
}
