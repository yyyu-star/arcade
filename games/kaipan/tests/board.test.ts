import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DAILY_RULES, DAILY_WIN_BASE, dailyBoardId, dailyScore, dailyScoreView, dailySegmentId, dailySetup, hashSeed, pickSegmentId, type GameState, type RunSummary } from '../src/core/index.ts';
import { DAILY_SEGMENTS } from '../src/core/content/dailySegments.ts';
import { boardDateOpen, askUser, cleanName, readBoard, shiftDate, submitScoreAs, type BoardDeps, type SubmitResult } from '../src/platform/board.ts';
import { KEEPALIVE_BYTES, keepaliveLeft, resetKeepalive } from '../src/platform/keepalive.ts';
import type { RecordResult } from '../src/platform/profile.ts';
import { BOARD_CACHE_MS, boardBeforeLeave, boardCheck, loadBoard, retryRun, runBoard, setBoardDeps, submitRun, warmBoardUser } from '../src/view/dailyBoard.ts';
import { boardLine, boardScoreText } from '../src/view/labels.ts';

/** 0.5.10 每日挑战排行榜：分数编码、段池、交分和读榜按平台 15.5 的回话处理、能不能上榜、结束页一行。 */

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Call {
  url: string;
  init: RequestInit;
  body: unknown;
}

/** 先认人（页面没记着账号就问平台）再交分 */
async function submitScore(d: BoardDeps, boardId: string, score: number): Promise<SubmitResult> {
  return submitScoreAs(d, d.userId() ?? (await askUser(d)), boardId, score);
}

function fake(reply: (c: Call) => Response | Promise<Response>, userId: string | null = 'u1') {
  const calls: Call[] = [];
  const deps: BoardDeps = {
    fetch: async (url, init) => {
      const c = { url, init, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined };
      calls.push(c);
      return reply(c);
    },
    userId: () => userId,
  };
  return { deps, calls };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

beforeEach(() => resetKeepalive());

describe('分数和榜单 ID', () => {
  it('通关的按账户排、都在没通关的前面；没通关的按还清几个月排', () => {
    const lost11 = dailyScore(false, 9e7, 11);
    const won = dailyScore(true, 1_000, 12);
    const wonMore = dailyScore(true, 54_687_100.37, 12);
    expect(dailyScore(false, 0, 3)).toBeLessThan(lost11);
    expect(lost11).toBeLessThan(won);
    expect(won).toBeLessThan(wonMore);
    for (const s of [lost11, won, wonMore]) {
      expect(Number.isSafeInteger(s)).toBe(true);
      expect(Math.abs(s)).toBeLessThanOrEqual(1e12);
    }
    expect(dailyScoreView(wonMore)).toEqual({ won: true, account: 54_687_100 });
    expect(dailyScoreView(lost11)).toEqual({ won: false, months: 11 });
    // 账户超出上限、负数、不是数也不出界
    expect(dailyScore(true, 1e20, 12)).toBe(2 * DAILY_WIN_BASE - 1);
    expect(dailyScore(true, -5, 12)).toBe(DAILY_WIN_BASE);
    expect(dailyScore(true, Number.NaN, 12)).toBe(DAILY_WIN_BASE);
    // 别人的分数（外来数据）不认识就按 0 个月
    expect(dailyScoreView(-1)).toEqual({ won: false, months: 0 });
    expect(dailyScoreView(1.5)).toEqual({ won: false, months: 0 });
    expect(boardScoreText(wonMore)).toBe('通关 ¥5,468.71万');
    expect(boardScoreText(lost11)).toBe('还清 11 个月');
  });

  it('榜单 ID 是 daily-YYYY-MM-DD（规则版本 0）', () => {
    expect(DAILY_RULES).toBe(0);
    expect(dailyBoardId('2026-10-14')).toBe('daily-2026-10-14');
    expect(dailyBoardId('2026-10-14')).toMatch(/^daily-\d{4}-\d{2}-\d{2}(-v[1-9]\d?)?$/);
  });

  it('段池冻结：都在段目录里、不重复；每日挑战只在池里抽，同一天总是同一段', () => {
    const index = JSON.parse(readFileSync('public/data/segments/index.json', 'utf8')) as { segments: { id: string }[] };
    const ids = index.segments.map((s) => s.id);
    expect(new Set(DAILY_SEGMENTS).size).toBe(DAILY_SEGMENTS.length);
    // 段库删了池里的段，那天的每日挑战就下载不到、只能退回模拟行情：要么别删，要么换池加版本
    for (const id of DAILY_SEGMENTS) expect(ids).toContain(id);
    const d = '2026-10-14';
    expect(dailySegmentId(d)).toBe(pickSegmentId(dailySetup(d).seed, DAILY_SEGMENTS, hashSeed));
    expect(dailySegmentId(d)).toBe(dailySegmentId(d));
  });

  it('段池锁死：这几天抽到的段写死在这里，池子或抽法一动就红（要动就加规则版本，换榜）', () => {
    // 0.5.10 冻结时算出来的，和 0.5.9 及以前按整个段目录抽的一样
    for (const [day, id] of [
      ['2026-10-14', 'seg_4dfb09075b'],
      ['2026-10-15', 'seg_440855e0fd'],
      ['2026-12-31', 'seg_82fced5703'],
      ['2027-02-28', 'seg_923a3f89bd'],
      ['2028-02-29', 'seg_62e2bca898'],
    ] as const)
      expect(dailySegmentId(day)).toBe(id);
    expect(DAILY_SEGMENTS).toHaveLength(135);
  });

  it('平台只收北京时间昨天、今天、明天', () => {
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01');
    expect(boardDateOpen('2026-10-13', '2026-10-14')).toBe(true);
    expect(boardDateOpen('2026-10-15', '2026-10-14')).toBe(true);
    expect(boardDateOpen('2026-10-12', '2026-10-14')).toBe(false);
    expect(boardDateOpen('2026-10-16', '2026-10-14')).toBe(false);
  });
});

describe('交分（POST /api/scores）', () => {
  it('带上 gameId、榜单、分数和页面认的账号，写请求带 X-Arcade', async () => {
    const f = fake(() => json({ best: 120, improved: true }));
    expect(await submitScore(f.deps, 'daily-2026-10-14', 120)).toEqual({ kind: 'ok', best: 120, improved: true });
    expect(f.calls).toHaveLength(1);
    const c = f.calls[0]!;
    expect(c.url).toBe('/api/scores');
    expect(c.init.method).toBe('POST');
    expect(c.body).toEqual({ gameId: 'kaipan', boardId: 'daily-2026-10-14', score: 120, userId: 'u1' });
    expect((c.init.headers as Record<string, string>)['X-Arcade']).toBe('1');
    expect(c.init.credentials).toBe('same-origin');
    expect(c.init.keepalive).toBe(true);
  });

  it('页面还没确认过账号：先问 /api/me；没登录就不交', async () => {
    const f = fake((c) => (c.url === '/api/me' ? json({ user: { id: 'u9' } }) : json({ best: 3, improved: false })), null);
    expect(await submitScore(f.deps, 'daily-2026-10-14', 3)).toEqual({ kind: 'ok', best: 3, improved: false });
    expect((f.calls[1]!.body as { userId: string }).userId).toBe('u9');
    const out = fake(() => json({ user: null }), null);
    expect(await submitScore(out.deps, 'daily-2026-10-14', 3)).toEqual({ kind: 'out' });
    expect(out.calls.map((c) => c.url)).toEqual(['/api/me']);
    const down = fake(() => Promise.reject(new TypeError('fetch failed')), null);
    expect(await submitScore(down.deps, 'daily-2026-10-14', 3)).toEqual({ kind: 'offline' });
  });

  for (const [what, res, want] of [
    ['429：今天交得太多了', () => json({ error: 'rate_limited', retryAfter: 100 }, 429), { kind: 'limit', retryAfter: 100 }],
    ['409 wrong_user：账号换过了', () => json({ error: 'wrong_user' }, 409), { kind: 'wrong_user' }],
    ['503 busy：排行榜暂停', () => json({ error: 'busy' }, 503), { kind: 'busy' }],
    ['不是 busy 的 503：按连不上', () => new Response('<html>bad gateway</html>', { status: 503 }), { kind: 'offline' }],
    ['401：没登录', () => json({ error: 'unauthorized' }, 401), { kind: 'out' }],
    ['422：游戏这边算错了', () => json({ error: 'invalid_board' }, 422), { kind: 'bug', status: 422, error: 'invalid_board' }],
    ['400：游戏这边算错了', () => json({ error: 'bad_request' }, 400), { kind: 'bug', status: 400, error: 'bad_request' }],
    ['连不上', () => Promise.reject(new TypeError('fetch failed')), { kind: 'offline' }],
    ['200 但回来的不是 JSON：多半记上了', () => new Response('oops', { status: 200 }), { kind: 'odd' }],
    ['200 但缺字段：多半记上了', () => json({ best: '120' }), { kind: 'odd' }],
    ['200 但名次是小数', () => json({ best: 1.5, improved: true }), { kind: 'odd' }],
  ] as const) {
    it(what, async () => {
      const f = fake(res as () => Response);
      expect(await submitScore(f.deps, 'daily-2026-10-14', 5)).toEqual(want);
      // 都只交一次，不自动重试
      expect(f.calls.filter((c) => c.url === '/api/scores')).toHaveLength(1);
    });
  }
});

describe('读榜（GET /api/boards/kaipan/<榜>）', () => {
  it('前 50 名、我的名次；不认识的行丢掉，昵称清理过', async () => {
    const entries = [
      { rank: 1, displayName: '老王', avatar: null, score: 100_000_001_000, isMe: false },
      { rank: 1, displayName: 'a\u0000b‮', avatar: null, score: 100_000_001_000, isMe: true },
      { rank: 'x', displayName: '坏行', score: 1 },
      { rank: 3, displayName: '这个昵称实在是太长了放不下的', score: 5, isMe: false },
      { rank: 0, displayName: '名次 0', score: 5, isMe: false },
      { rank: -2, displayName: '名次负数', score: 5, isMe: false },
    ];
    const f = fake(() => json({ entries, me: { rank: 1, score: 100_000_001_000 } }));
    const r = await readBoard(f.deps, 'daily-2026-10-14', 'friends');
    expect(f.calls[0]!.url).toBe('/api/boards/kaipan/daily-2026-10-14?scope=friends');
    expect(f.calls[0]!.init.method).toBe('GET');
    expect(r.kind).toBe('ok');
    if (r.kind !== 'ok') return;
    expect(r.entries.map((e) => [e.rank, e.displayName, e.isMe])).toEqual([
      [1, '老王', false],
      [1, 'ab', true],
      [3, '这个昵称实在是太长了放…', false],
    ]);
    expect(r.me).toEqual({ rank: 1, score: 100_000_001_000 });
  });

  it('没交过分：me 是 null；1 万名以后：rank 是 null', async () => {
    const none = await readBoard(fake(() => json({ entries: [], me: null })).deps, 'daily-2026-10-14', 'all');
    expect(none).toEqual({ kind: 'ok', entries: [], me: null });
    const far = await readBoard(fake(() => json({ entries: [], me: { rank: null, score: 4 } })).deps, 'daily-2026-10-14', 'all');
    expect(far).toEqual({ kind: 'ok', entries: [], me: { rank: null, score: 4 } });
  });

  it('错误码：401 没登录、503 busy、404 打不开、连不上', async () => {
    expect((await readBoard(fake(() => json({ error: 'unauthorized' }, 401)).deps, 'b', 'all')).kind).toBe('out');
    expect((await readBoard(fake(() => json({ error: 'busy' }, 503)).deps, 'b', 'all')).kind).toBe('busy');
    expect((await readBoard(fake(() => json({ error: 'not_found' }, 404)).deps, 'b', 'all')).kind).toBe('bug');
    expect((await readBoard(fake(() => Promise.reject(new TypeError('x'))).deps, 'b', 'all')).kind).toBe('offline');
    expect((await readBoard(fake(() => json({ entries: 'no' })).deps, 'b', 'all')).kind).toBe('offline');
  });

  it('昵称清理：空的叫无名氏', () => {
    expect(cleanName('')).toBe('无名氏');
    expect(cleanName(42)).toBe('无名氏');
    expect(cleanName('  小李  ')).toBe('小李');
  });
});

describe('这一局能不能上榜', () => {
  const date = '2026-10-14';
  const d = dailySetup(date);
  const seg = dailySegmentId(date)!;
  const sum = (o: Partial<RunSummary> = {}): RunSummary =>
    ({ runId: `r-${Math.random()}`, ended: true, won: true, account: 2_000_000, billsPaid: 12, seed: d.seed, persona: d.setup.persona, difficulty: d.setup.difficulty, daily: date, ...o }) as RunSummary;
  const state = (segId: string | null = seg): GameState => ({ real: segId ? { segId } : null }) as unknown as GameState;
  const ok = { ignored: null } as unknown as RecordResult;

  it('货真价实的每日挑战、计入档案、用的是当天那段真实行情、日期平台还收：交分', () => {
    expect(boardCheck(state(), sum(), ok, date)).toEqual({ state: 'sending', boardId: 'daily-2026-10-14', score: dailyScore(true, 2_000_000, 12) });
    // 跨零点：昨天的局今天结算也交
    expect(boardCheck(state(), sum(), ok, '2026-10-15').state).toBe('sending');
  });

  it('不是每日挑战、没计入档案、没结束：不提排行榜', () => {
    expect(boardCheck(state(), sum({ daily: null }), ok, date)).toEqual({ state: 'none' });
    expect(boardCheck(state(), sum({ seed: 'daily-2026-10-13' }), ok, date)).toEqual({ state: 'none' });
    expect(boardCheck(state(), sum(), { ignored: 'debug' } as unknown as RecordResult, date)).toEqual({ state: 'none' });
    expect(boardCheck(state(), sum(), null, date)).toEqual({ state: 'none' });
    expect(boardCheck(state(), sum({ ended: false }), ok, date)).toEqual({ state: 'none' });
  });

  it('退回了模拟行情（或者段不对）：和别人不是同一局，不交', () => {
    expect(boardCheck(state(null), sum(), ok, date)).toEqual({ state: 'skip', why: 'synthetic' });
    const other = DAILY_SEGMENTS.find((x) => x !== seg)!;
    expect(boardCheck(state(other), sum(), ok, date)).toEqual({ state: 'skip', why: 'synthetic' });
  });

  it('日期太早（比如隔了两天才打开结算）：平台不收了，不交', () => {
    expect(boardCheck(state(), sum(), ok, '2026-10-16')).toEqual({ state: 'skip', why: 'stale' });
  });

  it('交分只交一次；连不上可以重试，交上了再读一次榜拿名次', async () => {
    let up = false;
    const f = fake((c) => {
      if (!up) return Promise.reject(new TypeError('fetch failed'));
      if (c.url === '/api/scores') return json({ best: 7, improved: true });
      return json({ entries: [], me: { rank: 12, score: 7 } });
    });
    setBoardDeps(f.deps);
    const s = sum({ won: false, billsPaid: 7 });
    submitRun(s.runId, state(), s, ok, date);
    expect(runBoard(s.runId).state).toBe('sending');
    await settle();
    const first = runBoard(s.runId);
    expect(first).toMatchObject({ state: 'done', result: { kind: 'offline' } });
    expect(boardLine(first)).toEqual({ text: '没连上，成绩没记上', good: false, retry: true });
    // 同一局再调一次不再交
    submitRun(s.runId, state(), s, ok, date);
    await settle();
    expect(f.calls).toHaveLength(1);
    up = true;
    retryRun(s.runId);
    await settle();
    expect(runBoard(s.runId)).toMatchObject({ state: 'done', result: { kind: 'ok', best: 7, improved: true }, rank: 12 });
    expect(boardLine(runBoard(s.runId))?.text).toBe('新纪录！今日第 12 名');
    expect(f.calls.map((c) => c.url)).toEqual(['/api/scores', '/api/scores', '/api/boards/kaipan/daily-2026-10-14?scope=all']);
    // 交上了就不能再重试
    retryRun(s.runId);
    await settle();
    expect(f.calls).toHaveLength(3);
  });

  it('429、busy、wrong_user 不给重试', async () => {
    for (const [res, text] of [
      [json({ error: 'rate_limited' }, 429), '交成绩太频繁了，歇一会儿再试'],
      [json({ error: 'busy' }, 503), '服务器今天有点忙，成绩先交不上，明早恢复'],
      [json({ error: 'wrong_user' }, 409), '账号换过了，刷新后再打一局才能上榜'],
      [new Response('oops', { status: 200 }), '成绩交了，点「排行榜」看看'],
    ] as const) {
      const f = fake(() => res.clone());
      setBoardDeps(f.deps);
      const s = sum();
      submitRun(s.runId, state(), s, ok, date);
      await settle();
      expect(boardLine(runBoard(s.runId))).toEqual({ text, good: false, retry: false });
      retryRun(s.runId);
      await settle();
      expect(f.calls).toHaveLength(1);
    }
  });
});

describe('交分前确认账号（0.5.11）', () => {
  const date = '2026-10-14';
  const d = dailySetup(date);
  const seg = dailySegmentId(date)!;
  const sum = (): RunSummary =>
    ({ runId: `r-${Math.random()}`, ended: true, won: false, account: 0, billsPaid: 4, seed: d.seed, persona: d.setup.persona, difficulty: d.setup.difficulty, daily: date }) as RunSummary;
  const state = { real: { segId: seg } } as unknown as GameState;
  const ok = { ignored: null } as unknown as RecordResult;

  it('开局时提前问好账号：结束时直接交，不用再问 /api/me', async () => {
    const f = fake((c) => (c.url === '/api/me' ? json({ user: { id: 'u7' } }) : c.url === '/api/scores' ? json({ best: 4, improved: true }) : json({ entries: [], me: null })), null);
    setBoardDeps(f.deps);
    warmBoardUser(0);
    warmBoardUser(0);
    await settle();
    expect(f.calls.map((c) => c.url)).toEqual(['/api/me']);
    const s = sum();
    submitRun(s.runId, state, s, ok, date);
    expect(f.calls).toHaveLength(2);
    expect(f.calls[1]!.url).toBe('/api/scores');
    expect((f.calls[1]!.body as { userId: string }).userId).toBe('u7');
    // 回大厅不用等
    let left = false;
    void boardBeforeLeave().then(() => (left = true));
    await Promise.resolve();
    await Promise.resolve();
    expect(left).toBe(true);
  });

  it('云同步确认过账号就用它，不提前问', async () => {
    const f = fake(() => json({ user: { id: 'other' } }));
    setBoardDeps(f.deps);
    warmBoardUser(0);
    await settle();
    expect(f.calls).toHaveLength(0);
  });

  it('结束时还在问账号就点了「大厅」：等交分发出去再走', async () => {
    let answer: () => void = () => undefined;
    const f = fake((c) => (c.url === '/api/me' ? new Promise<Response>((r) => (answer = () => r(json({ user: { id: 'u8' } })))) : json({ best: 4, improved: false })), null);
    setBoardDeps(f.deps);
    const s = sum();
    submitRun(s.runId, state, s, ok, date);
    let left = false;
    const leave = boardBeforeLeave().then(() => (left = true));
    await settle();
    expect(left).toBe(false);
    answer();
    await leave;
    expect(f.calls.map((c) => c.url).slice(0, 2)).toEqual(['/api/me', '/api/scores']);
    expect(f.calls[1]!.init.keepalive).toBe(true);
  });

  it('问账号一直不回：最多等一会儿就走', async () => {
    const f = fake((c) => (c.url === '/api/me' ? new Promise<Response>(() => undefined) : json({})), null);
    setBoardDeps(f.deps);
    const s = sum();
    submitRun(s.runId, state, s, ok, date);
    const t = Date.now();
    await boardBeforeLeave(30);
    expect(Date.now() - t).toBeLessThan(1000);
    expect(f.calls.map((c) => c.url)).toEqual(['/api/me']);
  });

  it('交分的 keepalive 记进账里（离开时云存档补传扣掉它），回来后还回去', async () => {
    let done: () => void = () => undefined;
    const f = fake((c) => (c.url === '/api/scores' ? new Promise<Response>((r) => (done = () => r(json({ best: 4, improved: false })))) : json({ entries: [], me: null })));
    setBoardDeps(f.deps);
    const s = sum();
    submitRun(s.runId, state, s, ok, date);
    expect(keepaliveLeft()).toBe(KEEPALIVE_BYTES - (f.calls[0]!.init.body as string).length);
    done();
    await settle();
    expect(keepaliveLeft()).toBe(KEEPALIVE_BYTES);
  });
});

describe('读榜缓存（0.5.11）', () => {
  afterEach(() => vi.restoreAllMocks());

  it('同一个榜 45 秒内不重读；全站、好友分开；读失败的不缓存', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    let up = false;
    const f = fake(() => (up ? json({ entries: [], me: null }) : json({ error: 'busy' }, 503)));
    setBoardDeps(f.deps);
    expect((await loadBoard('daily-2026-10-14', 'all')).kind).toBe('busy');
    up = true;
    expect((await loadBoard('daily-2026-10-14', 'all')).kind).toBe('ok');
    expect((await loadBoard('daily-2026-10-14', 'all')).kind).toBe('ok');
    expect(f.calls).toHaveLength(2);
    await loadBoard('daily-2026-10-14', 'friends');
    await loadBoard('daily-2026-10-13', 'all');
    expect(f.calls).toHaveLength(4);
    now += BOARD_CACHE_MS;
    await loadBoard('daily-2026-10-14', 'all');
    expect(f.calls).toHaveLength(5);
  });

  it('交上分后之前读的作废，那次读全站榜放进缓存', async () => {
    vi.spyOn(Date, 'now').mockImplementation(() => 2_000_000);
    const date = '2026-10-14';
    const dd = dailySetup(date);
    const s = { runId: 'r-cache', ended: true, won: false, account: 0, billsPaid: 4, seed: dd.seed, persona: dd.setup.persona, difficulty: dd.setup.difficulty, daily: date } as RunSummary;
    const f = fake((c) => (c.url === '/api/scores' ? json({ best: 4, improved: true }) : json({ entries: [], me: { rank: 5, score: 4 } })));
    setBoardDeps(f.deps);
    await loadBoard('daily-2026-10-14', 'friends');
    await loadBoard('daily-2026-10-14', 'all');
    submitRun(s.runId, { real: { segId: dailySegmentId(date) } } as unknown as GameState, s, { ignored: null } as unknown as RecordResult, date);
    await settle();
    expect(runBoard(s.runId)).toMatchObject({ rank: 5 });
    const n = f.calls.length;
    await loadBoard('daily-2026-10-14', 'all');
    expect(f.calls).toHaveLength(n);
    await loadBoard('daily-2026-10-14', 'friends');
    expect(f.calls).toHaveLength(n + 1);
  });
  it('交上分、名次还没读回来时打开面板：不用交分前的缓存', async () => {
    vi.spyOn(Date, 'now').mockImplementation(() => 3_000_000);
    const date = '2026-10-14';
    const dd = dailySetup(date);
    const s = { runId: 'r-cache2', ended: true, won: false, account: 0, billsPaid: 6, seed: dd.seed, persona: dd.setup.persona, difficulty: dd.setup.difficulty, daily: date } as RunSummary;
    let posted = false;
    const f = fake((c) => {
      if (c.url === '/api/scores') {
        posted = true;
        return json({ best: 6, improved: true });
      }
      // 交分后的那次读一直不回
      return posted ? new Promise<Response>(() => undefined) : json({ entries: [], me: null });
    });
    setBoardDeps(f.deps);
    await loadBoard('daily-2026-10-14', 'all');
    submitRun(s.runId, { real: { segId: dailySegmentId(date) } } as unknown as GameState, s, { ignored: null } as unknown as RecordResult, date);
    await settle();
    const n = f.calls.length;
    void loadBoard('daily-2026-10-14', 'all');
    expect(f.calls).toHaveLength(n + 1);
  });
  it('作废前发出去的读榜晚回来：不写进缓存（0.5.12）；交分 odd 也作废', async () => {
    vi.spyOn(Date, 'now').mockImplementation(() => 4_000_000);
    const date = '2026-10-14';
    const dd = dailySetup(date);
    const s = { runId: 'r-cache3', ended: true, won: false, account: 0, billsPaid: 2, seed: dd.seed, persona: dd.setup.persona, difficulty: dd.setup.difficulty, daily: date } as RunSummary;
    let slow: () => void = () => undefined;
    let reads = 0;
    const f = fake((c) => {
      if (c.url === '/api/scores') return new Response('oops', { status: 200 });
      reads += 1;
      // 第一次读一直等到交完分才回
      return reads === 1 ? new Promise<Response>((r) => (slow = () => r(json({ entries: [], me: null })))) : json({ entries: [], me: { rank: 3, score: 2 } });
    });
    setBoardDeps(f.deps);
    const old = loadBoard('daily-2026-10-14', 'all');
    // 交分前读好的好友榜也要作废
    await loadBoard('daily-2026-10-14', 'friends');
    submitRun(s.runId, { real: { segId: dailySegmentId(date) } } as unknown as GameState, s, { ignored: null } as unknown as RecordResult, date);
    await settle();
    expect(runBoard(s.runId)).toMatchObject({ result: { kind: 'odd' } });
    slow();
    await old;
    const n = f.calls.length;
    expect((await loadBoard('daily-2026-10-14', 'all')).kind).toBe('ok');
    expect((await loadBoard('daily-2026-10-14', 'friends')).kind).toBe('ok');
    expect(f.calls).toHaveLength(n + 2);
  });
});

describe('结束页的一行', () => {
  it('各种状态的说法', () => {
    expect(boardLine({ state: 'none' })).toBeNull();
    expect(boardLine({ state: 'skip', why: 'synthetic' })?.text).toBe('这局用的是模拟行情，不计入排行');
    expect(boardLine({ state: 'skip', why: 'stale' })?.text).toBe('日期过了，这局不计入排行');
    expect(boardLine({ state: 'sending', boardId: 'b', score: 1 })?.text).toBe('正在交成绩……');
    const done = (result: SubmitResult, rank?: number | null) => boardLine({ state: 'done', boardId: 'b', score: 1, result, ...(rank === undefined ? {} : { rank }) });
    expect(done({ kind: 'ok', best: 5, improved: false }, 3)?.text).toBe('今日第 3 名 · 榜上最好：还清 5 个月');
    expect(done({ kind: 'ok', best: 5, improved: false })?.text).toBe('榜上最好：还清 5 个月');
    expect(done({ kind: 'ok', best: 5, improved: true }, null)).toEqual({ text: '新纪录！今日 1 万名以后', good: true, retry: false });
    expect(done({ kind: 'ok', best: 5, improved: true })?.text).toBe('新纪录！成绩交上了');
    expect(done({ kind: 'out' })?.text).toBe('登录后才能上排行');
    expect(done({ kind: 'odd' })).toEqual({ text: '成绩交了，点「排行榜」看看', good: false, retry: false });
    expect(done({ kind: 'bug', status: 422, error: 'invalid_board' })?.text).toBe('成绩没交上（游戏出了点错）');
  });
});
