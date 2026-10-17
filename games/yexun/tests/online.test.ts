import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { askUser, cleanName, readBoard, submitScoreAs, type BoardDeps } from '../src/online/api.ts';
import { beijingDate, dailyBoardId, dailyDateOpen, dailyPlan, isDailySetup, shiftDate } from '../src/online/daily.ts';
import { buildShareCard } from '../src/online/share.ts';
import { createSocial } from '../src/online/social.ts';
import { decodeEndless, decodeVigil, endlessScore, formatScore, raidScore, scoresOfRun, submissionsFor, vigilScore } from '../src/online/score.ts';
import { createSubmitter } from '../src/online/submit.ts';
import { CURSE_IDS, type OnlineSetup, type RunSummary } from '../src/online/types.ts';

function run(over: Partial<Omit<RunSummary, 'setup'>> & { setup?: Partial<OnlineSetup> } = {}): RunSummary {
  const { setup, ...rest } = over;
  return {
    runId: 'r1',
    setup: { seed: 1, mode: 'vigil', danger: 2, curses: [], ...setup },
    won: false,
    quit: false,
    bossKilled: false,
    seconds: 300,
    kills: 400,
    level: 12,
    coins: 90,
    loot: 0,
    live: false,
    reducedDamage: false,
    daily: null,
    ...rest,
  };
}

describe('分数公式', () => {
  it('守夜：危险档 × 1e10 + 秒数 × 1e4 + 击杀，能还原', () => {
    const s = vigilScore({ danger: 3, seconds: 612, kills: 1234, bossKilled: false });
    expect(s).toBe(3e10 + 612e4 + 1234);
    expect(decodeVigil(s)).toEqual({ danger: 3, seconds: 612, kills: 1234 });
  });
  it('守夜：打倒尸王算撑满 900 秒再加 100；击杀封顶 9,999；危险档封顶 5', () => {
    expect(decodeVigil(vigilScore({ danger: 9, seconds: 700, kills: 99999, bossKilled: true }))).toEqual({ danger: 5, seconds: 1000, kills: 9999 });
  });
  it('高危险档一定排在低危险档前面，同档比时间，同时间比击杀', () => {
    const a = vigilScore({ danger: 3, seconds: 10, kills: 0, bossKilled: false });
    const b = vigilScore({ danger: 2, seconds: 900, kills: 9999, bossKilled: false });
    expect(a).toBeGreaterThan(b);
    expect(vigilScore({ danger: 2, seconds: 101, kills: 0, bossKilled: false })).toBeGreaterThan(vigilScore({ danger: 2, seconds: 100, kills: 9999, bossKilled: false }));
  });
  it('分数都是平台收的安全整数（≤ 1e12），坏输入当 0', () => {
    for (const s of [vigilScore({ danger: 5, seconds: 900, kills: 9999, bossKilled: true }), endlessScore({ seconds: 1e9, kills: 1e9 }), raidScore(1e12)]) {
      expect(Number.isSafeInteger(s)).toBe(true);
      expect(s).toBeLessThanOrEqual(1e12);
    }
    expect(vigilScore({ danger: NaN, seconds: -5, kills: Infinity, bossKilled: false })).toBe(0);
  });
  it('无尽：秒数 × 1e4 + 击杀', () => {
    expect(decodeEndless(endlessScore({ seconds: 1500, kills: 77 }))).toEqual({ seconds: 1500, kills: 77 });
  });
  it('榜上的分数写成人话', () => {
    expect(formatScore('vigil', vigilScore({ danger: 2, seconds: 65, kills: 8, bossKilled: false }))).toBe('危险2 · 1:05 · 斩8');
    expect(formatScore('daily-vigil', 1_000_123)).toBe('天亮 · 斩123');
    expect(formatScore('daily-vigil', 345)).toBe('撑了 5:45');
  });
});

describe('public/boards.json（平台排行页按它写总榜的分数）', () => {
  const boards = JSON.parse(readFileSync(new URL('../public/boards.json', import.meta.url), 'utf8')).boards as Record<string, { score: { fields?: Record<string, [number, number | null]>; text: string }[] }>;
  // 照平台的规则拆字段：floor(分数 / 除数) % 取模
  const field = (score: number, [div, mod]: [number, number | null]): number => (mod === null ? Math.floor(score / div) : Math.floor(score / div) % mod);
  it('守夜、无尽的字段和 score.ts 的编码一致', () => {
    const v = vigilScore({ danger: 3, seconds: 754, kills: 1234, bossKilled: false });
    const vf = boards.vigil!.score[0]!.fields!;
    expect({ danger: field(v, vf.d!), seconds: field(v, vf.s!), kills: field(v, vf.k!) }).toEqual(decodeVigil(v));
    const boss = vigilScore({ danger: 5, seconds: 600, kills: 9999, bossKilled: true });
    expect(field(boss, vf.s!)).toBe(1000);
    const e = endlessScore({ seconds: 4321, kills: 77 });
    const ef = boards.endless!.score[0]!.fields!;
    expect({ seconds: field(e, ef.s!), kills: field(e, ef.k!) }).toEqual(decodeEndless(e));
    expect(boards.raid!.score[0]!.text).toContain('{n}');
  });
});

describe('该交哪几个榜', () => {
  const today = '2026-10-17';
  it('普通守夜交 vigil；开了无尽交 endless；夜探撤出交 raid，没撤出不交', () => {
    expect(submissionsFor(run(), today).map((s) => s.boardId)).toEqual(['vigil']);
    expect(submissionsFor(run({ setup: { endless: true } }), today).map((s) => s.boardId)).toEqual(['endless']);
    expect(submissionsFor(run({ setup: { mode: 'raid' }, loot: 500 }), today).map((s) => s.boardId)).toEqual(['raid']);
    expect(submissionsFor(run({ setup: { mode: 'raid' }, loot: 0 }), today)).toEqual([]);
  });
  it('实盘、降低伤害、认输（无尽除外）都不交', () => {
    expect(submissionsFor(run({ live: true }), today)).toEqual([]);
    expect(submissionsFor(run({ reducedDamage: true }), today)).toEqual([]);
    expect(submissionsFor(run({ quit: true }), today)).toEqual([]);
    expect(submissionsFor(run({ quit: true, setup: { endless: true } }), today).map((s) => s.boardId)).toEqual(['endless']);
  });
  it('每日挑战只交当天的每日榜，不进总榜；日期过期不交', () => {
    const d = run({ daily: '2026-10-17', won: true, kills: 321 });
    expect(submissionsFor(d, today)).toEqual([{ board: 'daily-vigil', boardId: 'daily-2026-10-17-vigil', score: 1_000_321 }]);
    expect(submissionsFor(run({ daily: '2026-10-17', setup: { mode: 'raid' }, loot: 80 }), today)[0]?.boardId).toBe('daily-2026-10-17-raid');
    expect(submissionsFor(run({ daily: '2026-10-10' }), today)).toEqual([]);
    expect(submissionsFor(run({ daily: '2026-10-17', reducedDamage: true }), today)).toEqual([]);
  });
  it('榜名符合平台的写法', () => {
    for (const b of [dailyBoardId('2026-10-17', 'vigil'), dailyBoardId('2026-10-17', 'raid')]) {
      expect(b).toMatch(/^daily-\d{4}-\d{2}-\d{2}-(?!v\d)[a-z][a-z0-9]{0,15}$/);
    }
    expect(scoresOfRun(run(), today)).toEqual({ vigil: vigilScore({ danger: 2, seconds: 300, kills: 400, bossKilled: false }) });
  });
});

describe('每日挑战', () => {
  it('同一天同一模式永远一样，换天或换模式不一样', () => {
    expect(dailyPlan('2026-10-17', 'vigil')).toEqual(dailyPlan('2026-10-17', 'vigil'));
    expect(dailyPlan('2026-10-17', 'vigil').setup.seed).not.toBe(dailyPlan('2026-10-18', 'vigil').setup.seed);
    expect(dailyPlan('2026-10-17', 'vigil').setup.seed).not.toBe(dailyPlan('2026-10-17', 'raid').setup.seed);
  });
  it('咒印 1–2 条、不重复、都认识；一个月里两种数量、六种咒印、两张图都出现', () => {
    const seen = new Set<string>();
    const counts = new Set<number>();
    const maps = new Set<string | undefined>();
    for (let i = 0; i < 90; i++) {
      const p = dailyPlan(shiftDate('2026-10-01', i), i % 2 ? 'vigil' : 'raid');
      expect(p.curses.length).toBeGreaterThanOrEqual(1);
      expect(p.curses.length).toBeLessThanOrEqual(2);
      expect(new Set(p.curses).size).toBe(p.curses.length);
      p.curses.forEach((c) => {
        expect(CURSE_IDS).toContain(c);
        seen.add(c);
      });
      counts.add(p.curses.length);
      // 夜探那天抽的是模板（没有守夜的图）
      if (p.mode === 'vigil') maps.add(p.setup.map);
      else expect(['guzhen', 'dukou', 'shansi']).toContain(p.setup.raid?.template);
    }
    expect(seen.size).toBe(6);
    expect(counts.size).toBe(2);
    expect(maps.size).toBe(2);
  });
  it('固定值：2026-10-17 守夜的计划不随改动漂移（改了抽法要同时加 DAILY_RULES）', () => {
    const p = dailyPlan('2026-10-17', 'vigil');
    expect({ seed: p.setup.seed, map: p.setup.map, curses: p.curses, danger: p.setup.danger }).toMatchInlineSnapshot(`
      {
        "curses": [
          "more",
          "noreroll",
        ],
        "danger": 2,
        "map": "snow",
        "seed": 1254331827,
      }
    `);
  });
  it('isDailySetup 核对种子、图、咒印、危险档', () => {
    const p = dailyPlan('2026-10-17', 'vigil').setup;
    expect(isDailySetup('2026-10-17', p)).toBe(true);
    expect(isDailySetup('2026-10-17', { ...p, seed: p.seed + 1 })).toBe(false);
    expect(isDailySetup('2026-10-17', { ...p, danger: 3 })).toBe(false);
    expect(isDailySetup('2026-10-18', p)).toBe(false);
    expect(isDailySetup(null, p)).toBe(false);
  });
  it('北京时间日期和平台收分的窗口（昨天到明天）', () => {
    expect(beijingDate(Date.UTC(2026, 9, 16, 16, 30))).toBe('2026-10-17');
    expect(beijingDate(Date.UTC(2026, 9, 16, 15, 59))).toBe('2026-10-16');
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(dailyDateOpen('2026-10-16', '2026-10-17')).toBe(true);
    expect(dailyDateOpen('2026-10-15', '2026-10-17')).toBe(false);
    expect(dailyDateOpen('2026-10-19', '2026-10-17')).toBe(false);
  });
});

// ───────── 和平台说话（假 fetch） ─────────

type Handler = (url: string, init: RequestInit) => { status: number; body?: unknown } | Error;
function fake(h: Handler): BoardDeps & { calls: { url: string; init: RequestInit }[] } {
  const calls: { url: string; init: RequestInit }[] = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      const r = h(url, init);
      if (r instanceof Error) throw r;
      return new Response(JSON.stringify(r.body ?? null), { status: r.status });
    },
  };
}

describe('平台接口', () => {
  it('交分带 gameId、榜名、分数、账号和 X-Arcade', async () => {
    const d = fake(() => ({ status: 200, body: { best: 5, improved: true } }));
    expect(await submitScoreAs(d, 'u1', 'vigil', 5)).toEqual({ kind: 'ok', best: 5, improved: true });
    const c = d.calls[0]!;
    expect(c.url).toBe('/api/scores');
    expect(JSON.parse(c.init.body as string)).toEqual({ gameId: 'yexun', boardId: 'vigil', score: 5, userId: 'u1' });
    expect((c.init.headers as Record<string, string>)['X-Arcade']).toBe('1');
  });
  it('各种回话理成几种结果', async () => {
    const code = (status: number, body?: unknown) => submitScoreAs(fake(() => ({ status, body })), 'u', 'vigil', 1);
    expect(await code(429, { retryAfter: 60 })).toEqual({ kind: 'limit', retryAfter: 60 });
    expect(await code(409, { error: 'wrong_user' })).toEqual({ kind: 'wrong_user' });
    expect(await code(503, { error: 'busy' })).toEqual({ kind: 'busy' });
    expect(await code(422, { error: 'invalid_board' })).toEqual({ kind: 'bug', status: 422, error: 'invalid_board' });
    expect(await code(500)).toEqual({ kind: 'offline' });
    expect(await code(200, { best: 'x' })).toEqual({ kind: 'odd' });
    expect(await submitScoreAs(fake(() => new Error('断网')), 'u', 'vigil', 1)).toEqual({ kind: 'offline' });
    expect(await submitScoreAs(fake(() => ({ status: 200 })), null, 'vigil', 1)).toEqual({ kind: 'out' });
  });
  it('没登录 / 没有平台', async () => {
    expect(await askUser(fake(() => ({ status: 200, body: { user: null } })))).toBeNull();
    expect(await askUser(fake(() => ({ status: 404 })))).toBeNull();
    expect(await askUser(fake(() => ({ status: 200, body: { user: { id: 'abc' } } })))).toBe('abc');
    expect(await askUser(fake(() => ({ status: 500 })))).toBe('fail');
  });
  it('读榜：好友范围在查询里；坏条目丢掉；昵称清理', async () => {
    const d = fake(() => ({
      status: 200,
      body: {
        entries: [
          { rank: 1, displayName: 'A\u0000B', score: 10, isMe: false },
          { rank: 0, displayName: 'bad', score: 5 },
          { rank: 2, displayName: '', score: 1.5 },
          { rank: 3, displayName: '一二三四五六七八九十十一十二十三', score: 3, isMe: true },
        ],
        me: { rank: 3, score: 3 },
      },
    }));
    const r = await readBoard(d, 'daily-2026-10-17-vigil', 'friends');
    expect(d.calls[0]!.url).toBe('/api/boards/yexun/daily-2026-10-17-vigil?scope=friends');
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.entries.map((e) => e.displayName)).toEqual(['AB', '一二三四五六七八九十十…']);
      expect(r.entries[1]!.isMe).toBe(true);
      expect(r.me).toEqual({ rank: 3, score: 3 });
    }
    expect(cleanName(undefined)).toBe('无名氏');
  });
  it('一局只交一次，不重复占额度；断网的榜可单独重试', async () => {
    let fail = true;
    const d = fake((url) => {
      if (url === '/api/me') return { status: 200, body: { user: { id: 'u1' } } };
      return fail ? { status: 500 } : { status: 200, body: { best: 9, improved: true } };
    });
    const sub = createSubmitter(d, () => Date.UTC(2026, 9, 17, 4));
    const r = run();
    const [a, b] = await Promise.all([sub.submit(r), sub.submit(r)]);
    expect(a).toBe(b);
    expect(a[0]!.result.kind).toBe('offline');
    const posts = (): number => d.calls.filter((c) => c.url === '/api/scores').length;
    expect(posts()).toBe(1);
    await sub.submit(r);
    expect(posts()).toBe(1);
    fail = false;
    const again = await sub.retry(r);
    expect(again[0]!.result.kind).toBe('ok');
    expect(posts()).toBe(2);
    await sub.retry(r);
    expect(posts()).toBe(2);
  });
  it('不该交的局一个请求都不发', async () => {
    const d = fake(() => ({ status: 200 }));
    expect(await createSubmitter(d).submit(run({ live: true }))).toEqual([]);
    expect(d.calls.length).toBe(0);
  });
});

describe('分享卡和 social', () => {
  it('分享卡：守夜撑到天亮、夜探、咒印和尸王都写进卡里，字段在 kit 的限制内', () => {
    const win = buildShareCard(run({ won: true, seconds: 900, bossKilled: true, daily: '2026-10-17', setup: { curses: ['fast', 'dark'] } }));
    expect(win.title).toBe('每日挑战 · 守夜');
    expect(win.big.value).toBe('天亮');
    expect(win.line).toBe('咒印：怪更快、夜更黑；斩了尸王');
    expect(win.stats!.length).toBeLessThanOrEqual(3);
    const raid = buildShareCard(run({ setup: { mode: 'raid' }, loot: 1234, seconds: 300 }));
    expect(raid.big).toEqual({ value: '1,234', label: '带出铜钱' });
    expect(buildShareCard(run({ seconds: 125 })).big).toEqual({ value: '2:05', label: '撑了' });
  });
  it('social：没平台（挂不上）什么都不做；打着的时候点"去"先确认', async () => {
    const none = createSocial({ mount: async () => null });
    expect(await none.start()).toBe(false);
    none.setWhere('vigil');
    none.stop();

    const calls: string[] = [];
    let onGo: ((i: { game: string; room: string }) => void) | undefined;
    const soc = createSocial({
      mount: async (o) => {
        onGo = o.onGo;
        expect(o.where()).toEqual({ place: 'game', game: 'yexun' });
        expect(o.gameName?.('yexun')).toBe('夜巡');
        return { presenceNow: () => void calls.push('presence'), pollNow: () => {}, stop: () => void calls.push('stop') };
      },
      confirmLeave: (go) => {
        calls.push('confirm');
        go();
      },
      go: (i) => void calls.push(`go ${i.room}`),
    });
    expect(await soc.start()).toBe(true);
    onGo!({ game: 'guandan', room: 'A1' });
    soc.setWhere('vigil');
    onGo!({ game: 'guandan', room: 'B2' });
    soc.stop();
    expect(calls).toEqual(['go A1', 'presence', 'confirm', 'go B2', 'stop']);
  });
});
