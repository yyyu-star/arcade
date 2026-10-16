import { describe, expect, it } from 'vitest';
import { createRun, liveSetup, runSummary, type RunSummary } from '../src/core/index.ts';
import { emptyProfile, recordRun } from '../src/platform/profile.ts';
import type { LiveRecord } from '../src/platform/live.ts';
import { LIVE_GUARD, LIVE_LOBBY_CONFIRM, LIVE_RULE, buyinFailText, chips, chipsDiff, liveEndText, liveNoticeTitle, quitConfirm } from '../src/view/liveText.ts';
import { botByName, playRun, useExt, useMarket } from '../tools/bots.ts';

/** 0.6.0 实盘在画面这一层的规矩：说话的分寸（设计稿第 5 节）、档案只记图鉴（第 7 节）。 */

const rec = (over: Partial<LiveRecord>): LiveRecord => ({ ref: 'kaipan-0123456789', tier: 'small', stake: 2_000, seed: 's', at: 0, until: 1, step: 'done', kind: 'settle', bp: 10_000, ...over });

/** 各种结果下会出现的全部文字 */
function allTexts(): string[] {
  const out: string[] = [LIVE_RULE, ...Object.values(LIVE_LOBBY_CONFIRM), ...Object.values(LIVE_GUARD)];
  const cases: Partial<LiveRecord>[] = [
    { credited: 2_120, bp: 10_600 },
    { credited: 1_640, bp: 8_200 },
    { credited: 0, bp: 0 },
    { credited: 4_000, capped: 380, bp: 21_900 },
    { kind: 'refund', credited: 2_000 },
    { step: 'settling' },
    { step: 'settling', wait: 'login' },
    { step: 'settling', kind: 'refund' },
    { step: 'void', error: 'expired' },
    { step: 'void', error: 'no_stake' },
    { step: 'error', error: 'bad_amount' },
  ];
  for (const c of cases) {
    for (const won of [true, false]) {
      const t = liveEndText(rec(c), won);
      out.push(t.head, t.body, liveNoticeTitle(rec(c)));
    }
  }
  for (const b of [true, false]) out.push(...Object.values(quitConfirm(b, 2_000, 2_104)));
  const say = (t: { title: string; body: string }): string[] => [t.title, t.body];
  for (const e of ['retry', 'no_funds', 'at_table', 'limit', 'pending', 'bad_amount']) out.push(...say(buyinFailText(e)), ...say(buyinFailText(e, 'login')));
  for (const code of ['busy', 'internal']) out.push(...say(buyinFailText('retry', 'offline', code)));
  return out;
}

describe('说话的分寸', () => {
  it('不出现"回本""翻本""再来一把""就差一点""马上""限时"，不倒计时', () => {
    const texts = allTexts();
    for (const w of ['回本', '翻本', '再来一把', '再来一局', '就差一点', '马上', '限时', '倒计时', '最后机会', '乘胜追击']) {
      for (const t of texts) expect(t, `"${t}" 里不该有"${w}"`).not.toContain(w);
    }
    // 24 小时的期限不在结算、确认框里说（只在开局按钮的悬停里提一次）
    for (const t of texts.filter((x) => !x.includes('超过一天') && !x.includes('一天内没打完'))) expect(t).not.toMatch(/小时|分钟/);
  });

  it('赚了：大字写结回多少和差额；小亏说安慰话；赔光提明天的补给和娱乐模式', () => {
    expect(liveEndText(rec({ credited: 2_120, bp: 10_600 }), true)).toEqual({ head: '结回 2,120 筹码（+120）', body: '几个月打下来，结回是带进来那一份的 ×1.06。' });
    const small = liveEndText(rec({ credited: 1_640, bp: 8_200 }), true);
    expect(small.head).toBe('结回 1,640 筹码（−360）');
    expect(small.body).toContain('下次换个档位或换个打法试试');
    const zero = liveEndText(rec({ credited: 0, bp: 0 }), false);
    expect(zero.head).toBe('结回 0 筹码（−2,000）');
    expect(zero.body).toContain('别往心里去');
    // 补给额是平台的设置（管理员可调），文案不写死数字
    expect(zero.body).toContain('每天能领补给');
    expect(zero.body).not.toMatch(/补到 [\d,]+/);
    expect(zero.body).toContain('娱乐模式');
    // 输了不推荐更高的档位
    for (const t of [small.body, zero.body]) expect(t).not.toMatch(/大档|豪华|更高/);
  });

  it('到顶：大字写进了钱包的数，另说一句没进钱包的数', () => {
    const t = liveEndText(rec({ credited: 4_000, capped: 380, bp: 21_900 }), true);
    // 大字是进了钱包的数（credited），没进的另说
    expect(t.head).toBe('结回 4,000 筹码（+2,000）');
    expect(t.body).toContain('今天单机实盘赢够了：这局多出的 380 筹码没进钱包，明天再来。');
  });

  it('待结：按记下的倍数估；登录、联网分开说', () => {
    expect(liveEndText(rec({ step: 'settling', bp: 10_520 }), true)).toEqual({ head: '约结回 2,104 筹码', body: '成绩记下了，联网后自动结回。' });
    expect(liveEndText(rec({ step: 'settling', wait: 'login' }), true).body).toBe('成绩记下了，登录后自动结回。');
  });

  it('数字的写法', () => {
    expect(chips(0)).toBe('0');
    expect(chips(2_000)).toBe('2,000');
    expect(chips(1_234_567)).toBe('1,234,567');
    expect(chipsDiff(120)).toBe('+120');
    expect(chipsDiff(-2_000)).toBe('−2,000');
    expect(chipsDiff(0)).toBe('±0');
  });
});

describe('档案：实盘局只记图鉴', () => {
  useExt(true);
  useMarket(null);
  const ended = (setup = liveSetup('small')): RunSummary => runSummary(playRun('live-profile', botByName('normal'), setup));

  it('见过的股票、群友、道具、事件、小知识照记；局数、通关、最好成绩、成就、解锁都不动', () => {
    const sum = ended();
    expect(sum.live?.clean).toBe(true);
    expect(sum.ranked).toBe(false);
    const before = emptyProfile();
    const r = recordRun(before, sum, '2026-10-15');
    expect(r.ignored).toBeNull();
    expect(r.profile.seen.stocks.length).toBeGreaterThan(0);
    expect(r.newSeen.stocks.length).toBe(r.profile.seen.stocks.length);
    expect(r.profile.runs).toBe(0);
    expect(r.profile.wins).toBe(0);
    expect(r.profile.best).toEqual({});
    expect(r.profile.achievements).toEqual({});
    expect(r.profile.maxDifficulty).toBe(before.maxDifficulty);
    expect(r.profile.segments).toEqual({});
    expect(r.newAchievements).toEqual([]);
    expect(r.newBest).toBe(false);
    // 同一局只记一次
    expect(recordRun(r.profile, sum, '2026-10-15').ignored).toBe('duplicate');
  });

  it('带调试字段的实盘局什么都不记；没解锁的人设也不记', () => {
    expect(recordRun(emptyProfile(), ended({ ...liveSetup('small'), account: 50_000 }), '2026-10-15').ignored).toBe('debug');
    expect(recordRun(emptyProfile(), ended(liveSetup('small', 'youzi')), '2026-10-15').ignored).toBe('locked');
  });

  it('结算页的数：档位、一份、按倍数结回多少', () => {
    const s = createRun('live-sum', liveSetup('big'), { ext: true }).state;
    expect(runSummary(s).live).toMatchObject({ tier: 'big', stake: 50_000, value: 50_000, bp: 10_000, clean: true });
  });
});
