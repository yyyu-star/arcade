/** 立直的名场面、电脑起哄、好友动态、颁奖小计（src/game/riichi-fun.ts）：只看公开的和、杠，照川麻的规矩 */
import { describe, expect, test } from 'vitest';
import type { HandScore, RcEvent, YakuId } from '../src/core/variants/riichi/index.ts';
import { awardsOf } from '../src/game/awards.ts';
import { toReport } from '../src/game/feed.ts';
import { rcFeedMomentsOf, rcFunMoments, rcHighlightsOf, rcKansOf, rcTally, rcWinsOf, type RcWinMoment } from '../src/game/riichi-fun.ts';

function hs(ids: YakuId[], o: Partial<HandScore> = {}): HandScore {
  return { yaku: ids.map((id) => ({ id, han: 1 })), yakuman: 0, kazoe: false, han: ids.length, fu: 30, dora: 0, aka: 0, ura: 0, base: 0, limit: 'none', ...o };
}
const win = (seat: number, from: number | null, score: HandScore): RcWinMoment => ({ seat, from, score });
const ev = (w: RcWinMoment): RcEvent => ({ e: 'win', seat: w.seat, from: w.from, tile: 0, score: w.score, rob: false });

describe('名场面', () => {
  test('一个和只记最响的一个：役满 > 三倍满以上 > 岭上 > 抢杠 > 海底 / 河底 > 立直一发；普通的和没有', () => {
    const cases: [HandScore, string | null][] = [
      [hs(['kokushi'], { yakuman: 1, limit: 'yakuman' }), 'rc_yakuman'],
      [hs(['riichi', 'ippatsu', 'chinitsu'], { han: 13, yakuman: 1, kazoe: true, limit: 'yakuman' }), 'rc_sanbaiman'],
      [hs(['chinitsu', 'ippatsu'], { han: 11, limit: 'sanbaiman' }), 'rc_sanbaiman'],
      [hs(['rinshan', 'haitei', 'ippatsu']), 'rc_rinshan'],
      [hs(['chankan', 'ippatsu']), 'rc_chankan'],
      [hs(['riichi', 'ippatsu', 'haitei']), 'rc_haitei'],
      [hs(['houtei']), 'rc_houtei'],
      [hs(['riichi', 'ippatsu']), 'rc_ippatsu'],
      [hs(['riichi', 'pinfu'], { han: 6, limit: 'haneman' }), null],
    ];
    for (const [score, id] of cases) expect(rcHighlightsOf([win(1, 0, score)], 3).map((h) => h.id)[0] ?? null).toBe(id);
    expect(rcHighlightsOf([win(1, 0, hs(['houtei']))], 3)[0]).toEqual({ id: 'rc_houtei', seat: 1, round: 3 });
  });

  test('一炮双响记在放铳的人头上，两家各自的名场面照记', () => {
    const hs2 = rcHighlightsOf([win(1, 3, hs(['tanyao'])), win(2, 3, hs(['riichi', 'ippatsu']))], 0);
    expect(hs2).toEqual([
      { id: 'rc_multi2', seat: 3, round: 0 },
      { id: 'rc_ippatsu', seat: 2, round: 0 },
    ]);
  });

  test('从事件里取和、杠（别的事件不看）', () => {
    const w = win(0, null, hs(['tsumo']));
    const events: RcEvent[] = [{ e: 'kan', seat: 2, from: null, tile: 0, kan: 'concealed' }, { e: 'discard', seat: 1, tile: 4, riichi: false }, ev(w)];
    expect(rcWinsOf(events)).toEqual([w]);
    expect(rcKansOf(events)).toEqual([2]);
  });
});

describe('电脑起哄', () => {
  test('开杠、岭上开花、跳满以上、自摸才起哄；别人放铳的普通小和不算', () => {
    const ms = rcFunMoments(
      [win(0, null, hs(['tsumo'])), win(1, 2, hs(['tanyao'])), win(2, 3, hs(['riichi'], { han: 6, limit: 'haneman' })), win(3, null, hs(['rinshan']))],
      [1],
      4,
    );
    expect(ms.map((m) => [m.moment, m.winners, m.losers])).toEqual([
      ['kong', [1], [0, 2, 3]],
      ['self-draw', [0], [1, 2, 3]],
      ['big-win', [2], [3]],
      ['gang-flower', [3], [0, 1, 2]],
    ]);
    expect(ms.every((m) => m.hand === 4)).toBe(true);
  });
});

describe('好友动态', () => {
  test('只报自己和的名场面，役满报几倍、其余报番；一场同一个只报一次、最多两条', () => {
    const events = [win(0, 1, hs(['kokushi'], { yakuman: 2, han: 0, limit: 'yakuman' })), win(2, 1, hs(['riichi', 'ippatsu'], { han: 3 }))].map(ev);
    expect(rcFeedMomentsOf(events, 0)).toEqual([{ moment: 'rc_yakuman', n: 2 }]);
    expect(rcFeedMomentsOf(events, 2)).toEqual([{ moment: 'rc_ippatsu', n: 3 }]);
    expect(rcFeedMomentsOf(events, 1)).toEqual([]);
    expect(rcFeedMomentsOf([ev(win(0, 1, hs(['pinfu'])))], 0)).toEqual([]);
    expect(toReport([{ moment: 'rc_ippatsu', n: 3 }, { moment: 'rc_haitei', n: 2 }], ['rc_ippatsu'])).toEqual([{ moment: 'rc_haitei', n: 2 }]);
  });

  test('模板都在 public/moments.json 里，只用平台认的占位符', async () => {
    const { readFileSync } = await import('node:fs');
    const t = JSON.parse(readFileSync(new URL('../public/moments.json', import.meta.url), 'utf8')) as Record<string, { text: string }>;
    for (const id of ['rc_yakuman', 'rc_sanbaiman', 'rc_rinshan', 'rc_chankan', 'rc_haitei', 'rc_houtei', 'rc_ippatsu']) {
      expect(t[id]?.text).toMatch(/\{name\}.*\{n\}/);
      expect(t[id]!.text.replace(/\{(name|n)\}/g, '')).not.toMatch(/[{}]/);
    }
  });
});

describe('颁奖', () => {
  test('立直按净输赢评 MVP、手气最背，自摸 2 次以上评自摸王；没有杠数，不评杠王', () => {
    const tally = rcTally([
      { wins: 3, tsumo: 2 },
      { wins: 1, tsumo: 0 },
      { wins: 0, tsumo: 0 },
      { wins: 1, tsumo: 1 },
    ]);
    expect(tally.every((x) => x.gangs === 0)).toBe(true);
    expect(awardsOf([30_000, -5_000, -20_000, -5_000], tally)).toEqual([
      { id: 'mvp', seat: 0, n: 30_000 },
      { id: 'unlucky', seat: 2, n: 20_000 },
      { id: 'zimo', seat: 0, n: 2 },
    ]);
  });
});
