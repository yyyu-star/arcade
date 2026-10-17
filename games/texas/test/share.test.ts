/** 结算页的分享卡（0.14.0，docs/social.md 1.1）：只交公开的数，画法是 kit 的 */
import { describe, expect, it } from 'vitest';
import { parseCards } from '../src/core/cards.ts';
import { evalCards } from '../src/core/eval.ts';
import { roomCard, soloCard } from '../src/view/share.ts';
import type { SoloSummary } from '../src/view/summary.ts';

const base: SoloSummary = { practice: false, buyin: 2_000, out: 3_240, left: 3_240, hands: 37, won: 9, best: null, capped: 0, busted: false };

describe('分享卡', () => {
  it('单机：输赢、手数、赢了几手；最大一手只在摊牌赢的时候写牌型（别人都弃牌的不写），卡上没有一张牌', () => {
    const flush = evalCards(parseCards('Ah Kh 7h 4h 2h 9c 9d'));
    const c = soloCard({ ...base, best: { won: 860, value: flush }, titles: [{ title: '诈唬王', name: '小明', why: '诈唬成功 3 次' }] }, '小桌', '小明');
    expect(c).toMatchObject({ game: '德州扑克', title: '实盘 · 小桌 · 37 手', big: { value: '+1,240', label: '筹码' }, player: { name: '小明', badge: '诈唬王' }, line: '诈唬王：诈唬成功 3 次' });
    expect(c.stats).toEqual([{ label: '赢了', value: '9 手' }, { label: '最大一手 · 同花', value: '860' }]);
    // 牌面（A♥、Kh 这类）一律不进卡
    expect(JSON.stringify(c)).not.toMatch(/[♠♥♦♣]|\b[2-9TJQKA][shdc]\b/);
    const fold = soloCard({ ...base, practice: true, left: 1_500, best: { won: 120, value: null } }, '娱乐 · 新手', '小明');
    expect(fold).toMatchObject({ title: '娱乐 · 新手 · 37 手', big: { value: '−500', label: '筹码（娱乐，不算数）' } });
    expect(fold.stats![1]).toEqual({ label: '最大一池 · 弃牌赢', value: '120' });
    expect(fold.line).toBeUndefined();
  });

  it('好友房：我的输赢、同桌几人、名次；没坐过的不给卡', () => {
    const rows = [
      { name: '老王', net: 3_000, me: false },
      { name: '小明', net: -400, me: true },
      { name: '阿花', net: -2_600, me: false },
    ];
    expect(roomCard(rows, [], '小桌 · 6 人桌', '小明')).toMatchObject({ title: '好友房 · 小桌 · 6 人桌', big: { value: '−400' }, stats: [{ value: '3 人' }, { value: '第 2' }] });
    expect(roomCard(rows.map((r) => ({ ...r, me: false })), [], 'x', '小明')).toBeNull();
  });
});
