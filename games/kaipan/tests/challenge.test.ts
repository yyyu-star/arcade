import { describe, expect, it } from 'vitest';
import {
  canChallenge,
  challengeOf,
  challengeScore,
  challengeSetup,
  challengeStats,
  createRun,
  dailyScore,
  dailySetup,
  isChallengeRun,
  liveSetup,
  parseChallenge,
  parseChallengeStats,
  replay,
  runSummary,
  shortSetup,
  type ChallengePayload,
} from '../src/core/index.ts';
import { createChallenge, loadChallengeRecord, openChallenge, saveChallengeRecord, submitChallenge, type Fetch } from '../src/platform/challenge.ts';
import { emptyProfile, recordRun } from '../src/platform/profile.ts';
import { botByName, playRun, useExt, useMarket } from '../tools/bots.ts';

/** 0.13.0 异步挑战（docs/design-challenge.md）：payload、成绩、和平台说话、档案。 */

describe('哪些局能发、发出去是什么', () => {
  useExt(true);
  useMarket(null);

  it('打完的娱乐局能发（短局带上短局规则）；没打完、每日挑战、实盘、调试设置的局不能', () => {
    const end = playRun('ch-1', botByName('normal'), shortSetup('mom', 2));
    expect(canChallenge(end)).toBe(true);
    const p = challengeOf(end, '0.13.0')!;
    expect(p).toEqual({ f: 1, seed: 'ch-1', setup: { persona: 'mom', difficulty: 2, short: end.setup!.short }, segment: null, v: '0.13.0' });
    expect(challengeSetup(p)).toEqual({ persona: 'mom', difficulty: 2, short: end.setup!.short });
    expect(canChallenge(createRun('ch-2', shortSetup('newbie', 1)).state)).toBe(false);
    const d = dailySetup('2026-10-16');
    expect(canChallenge(playRun(d.seed, botByName('normal'), d.setup))).toBe(false);
    expect(canChallenge(playRun('ch-3', botByName('normal'), liveSetup('small')))).toBe(false);
    expect(canChallenge(playRun('ch-4', botByName('normal'), { persona: 'newbie', difficulty: 1, account: 1e6 }))).toBe(false);
  });

  it('同一个 payload 开两次、同一串操作，结果逐位相同；对得上的局才算挑战局', () => {
    const end = playRun('ch-same', botByName('normal'), { persona: 'newbie', difficulty: 2 });
    const p = challengeOf(end, 'x')!;
    const again = replay(p.seed, end.actions, challengeSetup(p), { ext: true });
    expect(again.account).toBe(end.account);
    expect(again.phase).toBe(end.phase);
    expect(isChallengeRun(again, p)).toBe(true);
    expect(isChallengeRun(again, { ...p, setup: { ...p.setup, difficulty: 3 } })).toBe(false);
    expect(isChallengeRun(again, { ...p, segment: 'abcdef' })).toBe(false);
  });

  it('成绩沿用每日挑战的分数；stats 只有称号和资产涨跌（千分之几）', () => {
    const sum = runSummary(playRun('ch-score', botByName('normal'), { persona: 'newbie', difficulty: 1 }));
    expect(challengeScore(sum)).toBe(dailyScore(sum.won, sum.account, sum.billsPaid));
    expect(challengeStats(sum)).toEqual({ title: sum.title, growth: Math.round((sum.account / sum.startAccount - 1) * 1000) });
  });
});

describe('读别人交上来的 payload：白名单逐项校验', () => {
  const good: ChallengePayload = { f: 1, seed: 'abc123', setup: { persona: 'newbie', difficulty: 2, short: { months: 5, billMult: 0.25, goal: 1.05 } }, segment: 'seg01x', v: '0.13.0' };

  it('合格的原样回；不合格的一律 null', () => {
    expect(parseChallenge(good)).toEqual(good);
    expect(parseChallenge({ ...good, setup: { persona: 'newbie', difficulty: 2 }, segment: null })).toEqual({ ...good, setup: { persona: 'newbie', difficulty: 2 }, segment: null });
    const bad: unknown[] = [
      null,
      [],
      { ...good, f: 2 },
      { ...good, extra: 1 },
      { ...good, seed: '' },
      { ...good, seed: 'a b' },
      { ...good, seed: 'x'.repeat(65) },
      { ...good, segment: '../x' },
      { ...good, v: '' },
      { ...good, setup: { ...good.setup, persona: 'ceo' } },
      { ...good, setup: { ...good.setup, difficulty: 0 } },
      { ...good, setup: { ...good.setup, difficulty: 2.5 } },
      { ...good, setup: { ...good.setup, difficulty: 99 } },
      { ...good, setup: { ...good.setup, account: 1e9 } },
      { ...good, setup: { ...good.setup, items: ['longtou'] } },
      { ...good, setup: { ...good.setup, live: { months: 5 } } },
      { ...good, setup: { ...good.setup, short: { months: 13, billMult: 0.25, goal: 1 } } },
      { ...good, setup: { ...good.setup, short: { months: 5, billMult: 0, goal: 1 } } },
      { ...good, setup: { ...good.setup, short: { months: 5, billMult: 0.25, goal: 4 } } },
      { ...good, setup: { ...good.setup, short: { months: 5, billMult: 0.25, goal: 1, x: 1 } } },
    ];
    for (const b of bad) expect(parseChallenge(b), JSON.stringify(b)).toBeNull();
  });

  it('合格的 payload 都开得了局', () => {
    const p = parseChallenge(good)!;
    expect(() => createRun(p.seed, challengeSetup(p))).not.toThrow();
  });

  it('别人的 stats：只认称号和涨跌，不合格整份不用', () => {
    expect(parseChallengeStats({ title: '上岸散户', growth: 286 })).toEqual({ title: '上岸散户', growth: 286 });
    for (const b of [null, { title: '', growth: 1 }, { title: 'x'.repeat(17), growth: 1 }, { title: 'a', growth: 1.5 }, { title: 'a', growth: -2000 }]) expect(parseChallengeStats(b)).toBeNull();
  });
});

describe('和平台说话（15.18）', () => {
  const payload: ChallengePayload = { f: 1, seed: 'abc123', setup: { persona: 'newbie', difficulty: 1 }, segment: null, v: '0.13.0' };
  const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  const fake = (reply: (url: string, init: RequestInit) => Response): { f: Fetch; calls: { url: string; init: RequestInit }[] } => {
    const calls: { url: string; init: RequestInit }[] = [];
    return {
      calls,
      f: async (url, init) => {
        calls.push({ url, init });
        return reply(url, init);
      },
    };
  };

  it('发起：POST /api/challenges，带 X-Arcade、游戏 id、payload、我的成绩；回 id', async () => {
    const t = fake(() => json({ id: 'lq1abc2def', until: 123 }));
    expect(await createChallenge(t.f, payload, 5, { title: 'x', growth: 0 })).toEqual({ ok: true, id: 'lq1abc2def', until: 123 });
    const c = t.calls[0]!;
    expect(c.url).toBe('/api/challenges');
    expect(c.init.method).toBe('POST');
    expect((c.init.headers as Record<string, string>)['X-Arcade']).toBe('1');
    expect(JSON.parse(c.init.body as string)).toEqual({ game: 'kaipan', payload, score: 5, stats: { title: 'x', growth: 0 } });
  });

  it('错误码：401 没登录、404 打不开、409 满了、429 发多了、503 忙、413/400 自己的 bug、断网连不上', async () => {
    for (const [status, why] of [[401, 'out'], [404, 'gone'], [409, 'full'], [429, 'limit'], [503, 'busy'], [413, 'bug'], [400, 'bug'], [502, 'offline']] as const) {
      expect(await createChallenge(fake(() => json({ error: 'x' }, status)).f, payload, 1, { title: 'x', growth: 0 })).toEqual({ ok: false, why });
    }
    const down: Fetch = async () => {
      throw new TypeError('offline');
    };
    expect(await submitChallenge(down, 'lq1abc2def', 1, { title: 'x', growth: 0 })).toEqual({ ok: false, why: 'offline' });
  });

  it('打开：校验 payload，找出发起人的成绩；别人的昵称和 stats 照外来数据处理；不是开盘的挑战当打不开', async () => {
    const body = {
      game: 'kaipan',
      payload,
      owner: { userId: 'u-owner', displayName: '老王' },
      until: 99,
      results: [
        { rank: 1, userId: 'u-me', displayName: '我', score: 100000000123, stats: { title: '上岸散户', growth: 50 }, isMe: true },
        { rank: 2, userId: 'u-owner', displayName: '老王', score: 3, stats: { evil: 1 }, isMe: false },
        { rank: 3, userId: 'u-x', displayName: 7, score: 'x' },
      ],
      count: 3,
      me: { rank: 1, score: 100000000123 },
    };
    const r = await openChallenge(fake(() => json(body)).f, 'lq1abc2def');
    expect(r.ok && r.view.owner).toBe('老王');
    expect(r.ok && r.view.ownerScore).toBe(3);
    expect(r.ok && r.view.results.map((e) => [e.rank, e.displayName, e.stats])).toEqual([
      [1, '我', { title: '上岸散户', growth: 50 }],
      [2, '老王', null],
    ]);
    expect(r.ok && r.view.me).toEqual({ rank: 1, score: 100000000123 });
    expect(await openChallenge(fake(() => json({ ...body, game: 'texas' })).f, 'lq1abc2def')).toEqual({ ok: false, why: 'gone' });
    expect(await openChallenge(fake(() => json({ ...body, payload: { ...payload, f: 9 } })).f, 'lq1abc2def')).toEqual({ ok: false, why: 'gone' });
    expect(await openChallenge(fake(() => json(body)).f, '../x')).toEqual({ ok: false, why: 'gone' });
  });

  it('交成绩：ok / already（平台只记第一次）', async () => {
    const t = fake(() => json({ result: 'ok' }));
    expect(await submitChallenge(t.f, 'lq1abc2def', 7, { title: 'x', growth: 0 })).toEqual({ ok: true, already: false });
    expect(t.calls[0]!.url).toBe('/api/challenges/lq1abc2def/results');
    expect(await submitChallenge(fake(() => json({ result: 'already', mine: { score: 1 } })).f, 'lq1abc2def', 7, { title: 'x', growth: 0 })).toEqual({ ok: true, already: true });
  });

  it('这台设备接下的挑战：存得下、读得回，坏的当没有', () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    expect(loadChallengeRecord(store)).toBeNull();
    saveChallengeRecord({ id: 'lq1abc2def', seed: 's1', owner: '老王', v: '0.13.0', sent: false }, store);
    expect(loadChallengeRecord(store)).toEqual({ id: 'lq1abc2def', seed: 's1', owner: '老王', v: '0.13.0', sent: false });
    m.set('kaipan.challenge', '{bad');
    expect(loadChallengeRecord(store)).toBeNull();
  });
});

describe('档案：照每日挑战的规矩', () => {
  useExt(true);
  useMarket(null);

  it('挑战局可以用还没解锁的人设和难度；不解锁难度、不记最好成绩，图鉴照常', () => {
    const end = Array.from({ length: 12 }, (_, i) => playRun(`ch-prof-${i}`, botByName('normal'), { persona: 'mom', difficulty: 3 })).find((s) => s.phase === 'won')!;
    const sum = runSummary(end);
    const p0 = emptyProfile();
    expect(recordRun(p0, sum, '2026-10-17').ignored).toBe('locked');
    const r = recordRun(p0, sum, '2026-10-17', { challenge: true });
    expect(r.ignored).toBeNull();
    expect(r.profile.runs).toBe(1);
    expect(r.profile.maxDifficulty).toBe(p0.maxDifficulty);
    expect(r.newBest).toBe(false);
    expect(Object.keys(r.profile.best)).toEqual([]);
    expect(r.profile.seen.stocks.length).toBeGreaterThan(0);
  });
});
