/**
 * 每日挑战的子榜（0.16.0）：一天几个每日榜，比如夜巡的守夜、夜探。这里把开盘的 daily 换成两个子榜（setDailyGamesForTests），
 * 看交分只收登记过的子榜、不带子榜的不收；排行榜页每个子榜一个今天的榜；好友周榜和超越提示按子榜各算各的。
 * 测试时间是北京时间 2026-10-14（周三）14:30。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { dailyTabs, GAMES } from '../src/games';
import { parseDaily } from '../worker/api/boards';
import { setDailyGamesForTests } from '../worker/api/daily';
import { call, env, registerUser, resetAll } from './helpers';

// 开盘的 daily 换成两个子榜；测完换回来
const GAMES_WITH_SUBS = GAMES.map((g) => (g.id === 'kaipan' ? { ...g, daily: [{ id: 'vigil', name: '守夜' }, { id: 'raid', name: '夜探' }] } : g));

beforeEach(async () => {
  await resetAll();
  setDailyGamesForTests(GAMES_WITH_SUBS);
});
afterEach(() => setDailyGamesForTests(null));


let ipSeq = 0;
const newUser = () => registerUser(undefined, undefined, `198.51.100.${++ipSeq % 250}`);
type U = Awaited<ReturnType<typeof newUser>>;
const score = (u: U, boardId: string, s: number) => call('/api/scores', { body: { gameId: 'kaipan', boardId, score: s }, cookie: u.cookie });
const put = (u: U, board: string, s: number) =>
  env.DB.prepare('INSERT INTO boards (user_id, game_id, board_id, score, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(u.user.id, 'kaipan', board, s, Date.now()).run();
async function befriend(a: U, b: U): Promise<void> {
  expect((await call('/api/friends/requests', { body: { friendCode: b.user.friendCode }, cookie: a.cookie })).status).toBe(200);
  expect((await call(`/api/friends/${a.user.id}/accept`, { body: {}, cookie: b.cookie })).status).toBe(200);
}

describe('子榜', () => {
  it('排行榜页的标签：没有子榜的一个"<名字>每日"，有子榜的每个子榜一个"<名字>每日·<子榜名>"', () => {
    expect(dailyTabs(GAMES_WITH_SUBS).filter((t) => t.game.id === 'kaipan').map((t) => [t.key, t.label])).toEqual([
      ['kaipan:vigil', '开盘每日·守夜'],
      ['kaipan:raid', '开盘每日·夜探'],
    ]);
    expect(dailyTabs(GAMES).filter((t) => t.game.id === 'kaipan').map((t) => [t.key, t.label])).toEqual([['kaipan', '开盘每日']]);
  });

  it('榜名：日期、子榜、版本号；v2 是版本号不是子榜；大写、太长、不是每日榜的为 null', () => {
    expect(parseDaily('daily-2026-10-14')).toEqual({ date: '2026-10-14', sub: null, v: 0 });
    expect(parseDaily('daily-2026-10-14-v2')).toEqual({ date: '2026-10-14', sub: null, v: 2 });
    expect(parseDaily('daily-2026-10-14-vigil')).toEqual({ date: '2026-10-14', sub: 'vigil', v: 0 });
    expect(parseDaily('daily-2026-10-14-raid-v3')).toEqual({ date: '2026-10-14', sub: 'raid', v: 3 });
    expect(parseDaily('daily-2026-10-14-vip')).toEqual({ date: '2026-10-14', sub: 'vip', v: 0 });
    for (const id of ['daily-2026-10-14-Vigil', 'daily-2026-10-14-' + 'a'.repeat(17), 'daily-2026-10-14-v2-vigil', 'endless', 'daily-2026-10-14-vigil-v0']) {
      expect(parseDaily(id), id).toBeNull();
    }
  });

  it('交分：登记过的子榜收（可带 -v<n>），没登记的、不带子榜的不收（422）；读榜同样', async () => {
    const a = await newUser();
    expect((await score(a, 'daily-2026-10-14-vigil', 10)).status).toBe(200);
    expect((await score(a, 'daily-2026-10-14-raid-v2', 10)).status).toBe(200);
    for (const id of ['daily-2026-10-14', 'daily-2026-10-14-v2', 'daily-2026-10-14-boss', 'daily-2026-10-14-Vigil', 'daily-2026-10-14-vigil-v0']) {
      expect((await score(a, id, 10)).status, id).toBe(422);
    }
    expect((await call('/api/boards/kaipan/daily-2026-10-14-vigil', { cookie: a.cookie })).status).toBe(200);
    expect((await call('/api/boards/kaipan/daily-2026-10-14', { cookie: a.cookie })).status).toBe(404);
    // 别的游戏还是不带子榜的那种
    expect((await call('/api/scores', { body: { gameId: 'guandan', boardId: 'daily-2026-10-14-vigil', score: 1 }, cookie: a.cookie })).status).toBe(422);
  });

  it('排行榜页：每个子榜一个今天的榜（版本最大的），还没人交的是 null', async () => {
    const a = await newUser();
    await score(a, 'daily-2026-10-14-vigil', 10);
    await score(a, 'daily-2026-10-14-vigil-v2', 10);
    const body = (await (await call('/api/leaderboard?scope=all', { cookie: a.cookie })).json()) as { daily: Record<string, string | null> };
    expect(body.daily['kaipan:vigil']).toBe('daily-2026-10-14-vigil-v2');
    expect(body.daily['kaipan:raid']).toBeNull();
    expect('kaipan' in body.daily).toBe(false);
  });

  it('好友周榜：按子榜各算各的，要带 ?board=；超越提示带上子榜', async () => {
    const a = await newUser();
    const b = await newUser();
    await befriend(a, b);
    await put(a, 'daily-2026-10-13-vigil', 100);
    await put(b, 'daily-2026-10-14-vigil', 300);
    await put(a, 'daily-2026-10-14-raid', 900);
    await put(b, 'daily-2026-10-12-raid', 50);
    const week = async (q: string) => call(`/api/friends/week/kaipan${q}`, { cookie: a.cookie });
    expect(((await (await week('?board=vigil')).json()) as { entries: { score: number }[] }).entries.map((e) => e.score)).toEqual([300, 100]);
    expect(((await (await week('?board=raid')).json()) as { entries: { score: number }[] }).entries.map((e) => e.score)).toEqual([900, 50]);
    expect((await week('')).status).toBe(404);
    expect((await week('?board=boss')).status).toBe(404);
    const over = (await (await call('/api/friends/overtakes', { cookie: a.cookie })).json()) as { overtakes: unknown[] };
    expect(over.overtakes).toEqual([{ gameId: 'kaipan', board: 'vigil', by: expect.objectContaining({ userId: b.user.id }), score: 300, mine: 100 }]);
  });
});
