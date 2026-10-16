import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/core/balance.ts';
import { MONTH_THEMES, monthThemeById } from '../src/core/content/monthThemes.ts';
import { stockById } from '../src/core/content/index.ts';
import { createRun, dispatch, replay } from '../src/core/engine.ts';
import { rulesOf } from '../src/core/market.ts';
import { themeTruth } from '../src/core/chat.ts';
import { forwardRet } from '../src/core/real.ts';
import type { GameEvent, GameState } from '../src/core/types.ts';
import { botByName, playRun, useMarket } from '../tools/bots.ts';
import { loadSegment, segmentIndex } from '../tools/segments-disk.ts';

const segs = segmentIndex().segments.map((e) => loadSegment(e.id));

/** 一直开盘、奖励跳过、事件选不要，走完一局，收集事件。 */
function playOpen(s0: GameState, onDay?: (s: GameState, evs: readonly GameEvent[]) => void): GameState {
  let s = s0;
  for (let i = 0; i < 400 && s.phase !== 'won' && s.phase !== 'lost'; i++) {
    const a = s.phase === 'premarket' ? { type: 'open' as const } : s.phase === 'reward' ? { type: 'skipReward' as const } : { type: 'choose' as const, option: 1 };
    const r = dispatch(s, a, { inPlace: true });
    s = r.state;
    onDay?.(s, r.events);
  }
  return s;
}

describe('0.5 个股照搬真实走势', () => {
  it('当天涨跌 = amp × 真实涨跌，按涨跌停截断；归因之和等于涨跌；识别连板、炸板、妖股异动', () => {
    const amp = BALANCE.track.amp;
    let checked = 0;
    for (const seg of segs.slice(0, 6)) {
      const s0 = createRun(`track-${seg.id}`, { account: 1e9, holdings: [] }, { segment: seg }).state;
      expect(s0.real?.track).toBe(true);
      const boards = new Map<string, number>();
      playOpen(s0, (s, evs) => {
        for (const e of evs) {
          if (e.type !== 'dayClosed' || !s.real) continue;
          const rules = rulesOf(s);
          const i = s.real.warm + e.report.day;
          for (const m of e.report.stocks) {
            const lim = BALANCE.roles[stockById(m.id).role].limit * rules.limitMult;
            const up = Math.round(lim * rules.limitUpMult * 100) / 100;
            const raw = (amp * (s.real.stocks[m.id]?.r[i] ?? 0)) / 100;
            const want = Math.round(Math.min(up, Math.max(-lim, raw)) * 100) / 100 || 0;
            expect(m.move).toBeCloseTo(want, 6);
            expect(m.jump).toBe(0);
            expect(m.chain).toBe(0);
            const prev = boards.get(m.id) ?? 0;
            expect(m.boards).toBe(m.limitUp ? prev + 1 : 0);
            expect(m.blown).toBe(prev > 0 && m.move <= BALANCE.track.blown);
            expect(!!m.wild).toBe(stockById(m.id).role === 'meme' && Math.abs(m.move) >= BALANCE.track.wild);
            boards.set(m.id, m.boards);
            checked += 1;
          }
          expect(e.report.market.ret).toBeCloseTo(Math.round(((amp * (s.real.market[i] ?? 0)) / 100) * 100) / 100, 6);
          for (const h of e.report.holdings) {
            let sum = 0;
            for (const p of h.parts) sum += p.value;
            expect(sum).toBeCloseTo(h.ret, 1);
          }
        }
      });
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it('性格校正只在风口内换绑定的真实序列，不丢股票；0.4 的映射（legacyReal）不校正', () => {
    const seg = segs[3] as (typeof segs)[number];
    const a = createRun('fit', null, { segment: seg }).state;
    const b = createRun('fit', null, { segment: seg, legacyReal: true }).state;
    expect(b.real?.track).toBeUndefined();
    expect(Object.keys(a.real?.stocks ?? {}).sort()).toEqual(Object.keys(b.real?.stocks ?? {}).sort());
    const idsA = Object.values(a.real?.stocks ?? {}).map((x) => x.id).sort();
    const idsB = Object.values(b.real?.stocks ?? {}).map((x) => x.id).sort();
    expect(idsA).toEqual(idsB);
    for (const [slot, x] of Object.entries(a.real?.stocks ?? {})) expect(x.id.split('_')[0]).toBe(seg.themes[stockById(slot).theme].stocks[0]?.id.split('_')[0]);
  });

  it('合成行情没有月度主题、没有 track（replay-030 不受影响）', () => {
    const s = createRun('synthetic').state;
    expect(s.tempo).toBeUndefined();
    expect(s.real ?? null).toBeNull();
  });
});

describe('0.5 情报从真实未来推算', () => {
  it('消息按风口接下来 days 天的真实方向揭晓；多日消息到期揭晓；战绩照样统计', () => {
    let multi = 0;
    for (const seg of segs.slice(0, 10)) {
      const s0 = createRun(`intel-${seg.id}`, { account: 1e9 }, { segment: seg }).state;
      let total = 0;
      const end = playOpen(s0, (s, evs) => {
        for (const e of evs) {
          if (e.type === 'messageJudged' || e.type === 'intelJudged') {
            total += 1;
            const day = e.type === 'intelJudged' ? (e.day as number) : (s.lastDay?.day as number);
            expect(e.truth).toBe(themeTruth(s.real as NonNullable<GameState['real']>, e.theme, day, e.days ?? 1));
            expect(e.hit).toBe(e.truth === e.claim);
            if (e.type === 'intelJudged') {
              multi += 1;
              expect(e.days).toBeGreaterThan(1);
            }
          }
        }
      });
      expect(end.friends.reduce((n, f) => n + f.total, 0)).toBe(total);
    }
    expect(multi).toBeGreaterThan(10);
  });

  it('靠谱的人说得准，群主经常反着说', () => {
    const hits = new Map<string, [number, number]>();
    for (const seg of segs.slice(0, 40)) {
      const end = playOpen(createRun(`acc-${seg.id}`, { account: 1e9 }, { segment: seg }).state);
      for (const f of end.friends) {
        const x = hits.get(f.id) ?? [0, 0];
        x[0] += f.hits;
        x[1] += f.total;
        hits.set(f.id, x);
      }
    }
    const rate = (id: string): number => {
      const x = hits.get(id) ?? [0, 1];
      return x[0] / Math.max(1, x[1]);
    };
    expect(rate('laowang')).toBeGreaterThan(0.6);
    expect(rate('laozhao')).toBeGreaterThan(0.6);
    expect(rate('qunzhu')).toBeLessThan(0.4);
    expect(rate('laowang') - rate('qunzhu')).toBeGreaterThan(0.25);
  });

  it('靠谱群友推荐的股票接下来真的涨得多，群主推的跌得多', () => {
    const sum = new Map<string, [number, number]>();
    for (const seg of segs.slice(0, 40)) {
      playOpen(createRun(`rec-${seg.id}`, { account: 1e9 }, { segment: seg }).state, (s, evs) => {
        for (const e of evs) {
          if (e.type !== 'chat' || !s.real) continue;
          for (const r of e.recs) {
            if (r.short) continue;
            const x = sum.get(r.friendId) ?? [0, 0];
            x[0] += forwardRet(s.real, 'stock', r.stockId, s.today.day, r.days ?? 1);
            x[1] += 1;
            sum.set(r.friendId, x);
          }
        }
      });
    }
    const avg = (id: string): number => (sum.get(id)?.[0] ?? 0) / Math.max(1, sum.get(id)?.[1] ?? 0);
    expect(avg('laowang')).toBeGreaterThan(0.5);
    expect(avg('qunzhu')).toBeLessThan(0);
  });
});

describe('0.5 月度主题、高光、连击', () => {
  it('主题池至少 12 个；每局 12 个月不重复，第 4、8 个月是 boss；每月月初发看点卡', () => {
    expect(MONTH_THEMES.length).toBeGreaterThanOrEqual(12);
    for (const seg of segs.filter((_, i) => i % 9 === 0)) {
      for (const lv of [1, 6]) {
        const run = createRun(`plan-${seg.id}-${lv}`, { account: 1e9, difficulty: lv }, { segment: seg, ext: lv === 6 });
        const s0 = run.state;
        const plan = s0.tempo?.plan ?? [];
        expect(plan.length).toBe(12);
        expect(new Set(plan).size).toBe(12);
        plan.forEach((id, k) => expect(!!monthThemeById(id).boss).toBe(BALANCE.tempo.bossMonths.includes(k + 1)));
        let cards = run.events.filter((e) => e.type === 'monthTheme').length;
        const hl = new Map<number, number>();
        const end = playOpen(s0, (s, evs) => {
          for (const e of evs) {
            if (e.type === 'monthTheme') {
              cards += 1;
              expect(e.goal.id).toBe(plan[e.goal.month - 1]);
              expect(e.intro.length).toBeGreaterThan(0);
              expect(e.roast.text.length).toBeGreaterThan(0);
            }
            if (e.type === 'highlight') hl.set(s.month, (hl.get(s.month) ?? 0) + 1);
          }
        });
        expect(cards).toBe(12);
        expect(end.tempo?.results.length).toBe(12);
        for (let m = 1; m <= 12; m++) expect(hl.get(m) ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it('收盘带节奏信息；平淡日真的没什么事；目标达成就发奖励', () => {
    useMarket((seed) => segs[Number(seed.split('-')[1]) % segs.length] ?? null);
    try {
      let quiet = 0;
      let done = 0;
      for (let k = 0; k < 20; k++) {
        playRun(`rhythm-${k}`, botByName('smart'), null, (_s, evs) => {
          for (const e of evs) {
            if (e.type === 'dayClosed') {
              const t = e.report.tempo;
              expect(t).toBeDefined();
              if (t?.quiet) {
                quiet += 1;
                expect(t.highlights.length).toBe(0);
                expect(Math.abs(e.report.account.ret)).toBeLessThan(BALANCE.tempo.quietAcc);
              }
            }
            if (e.type === 'goalDone') {
              done += 1;
              expect(e.goal.done).toBe(true);
            }
          }
        });
      }
      expect(quiet).toBeGreaterThan(0);
      expect(done).toBeGreaterThan(10);
    } finally {
      useMarket(null);
    }
  }, 60_000);

  it('考试月只能买老实股；难度在真实行情下改成手续费、涨停收窄', () => {
    const seg = segs[0] as (typeof segs)[number];
    const s = createRun('exam', { difficulty: 5 }, { segment: seg }).state;
    if (s.tempo) s.tempo.cur = { ...(s.tempo.cur as NonNullable<typeof s.tempo.cur>), id: 'exam_month', month: s.month };
    const r = rulesOf(s);
    expect(r.onlyRoles).toEqual(['bluechip']);
    expect(r.buyFee).toBeGreaterThan(0);
    expect(r.limitUpMult).toBeLessThan(1);
    const i = s.today.recs.findIndex((x) => stockById(x.stockId).role !== 'bluechip');
    if (i >= 0) expect(dispatch(s, { type: 'buy', rec: i }).error).toBe('这个月只能买老实股');
  });

  it('确定性：带月度主题的真实行情局，回放逐位相同', () => {
    useMarket(() => segs[5] ?? null);
    try {
      const end = playRun('det-05', botByName('smart'));
      const again = replay('det-05', end.actions, null, { segment: segs[5], ext: !!end.ext, tempo: !!end.tempo });
      expect(JSON.stringify(again)).toBe(JSON.stringify(end));
    } finally {
      useMarket(null);
    }
  });
});
