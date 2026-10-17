/**
 * 好友周榜和超越提示（0.15.0，docs/social.md 1.5，platform-backend.md 15.16）：只列我和好友、按这周最好成绩排、
 * 只认这周最新那一版的榜、上周的不算、非好友不出现；超越提示读的时候比；都是 0 行写入。
 * 测试时间是北京时间 2026-10-14（周三）14:30，这周一是 10-12。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { call, env, registerUser, resetAll, rowsWritten } from './helpers';

beforeEach(() => resetAll());

let ipSeq = 0;
const newUser = () => registerUser(undefined, undefined, `198.51.100.${++ipSeq % 250}`);
type U = Awaited<ReturnType<typeof newUser>>;
interface Entry {
  rank: number;
  displayName: string;
  score: number;
  isMe: boolean;
}

async function befriend(a: U, b: U): Promise<void> {
  expect((await call('/api/friends/requests', { body: { friendCode: b.user.friendCode }, cookie: a.cookie })).status).toBe(200);
  expect((await call(`/api/friends/${a.user.id}/accept`, { body: {}, cookie: b.cookie })).status).toBe(200);
}
/** 直接放一条成绩（交分接口只收昨天到明天的，这里要放这周早些天和上周的） */
const put = (u: U, board: string, score: number, at = Date.now(), game = 'kaipan') =>
  env.DB.prepare('INSERT INTO boards (user_id, game_id, board_id, score, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(u.user.id, game, board, score, at)
    .run();
const week = async (u: U, game = 'kaipan') => call(`/api/friends/week/${game}`, { cookie: u.cookie });
const nameOf = async (u: U) => ((await (await call('/api/me', { cookie: u.cookie })).json()) as { user: { displayName: string } }).user.displayName;

describe('好友周榜', () => {
  it('两个好友各交一个分：都在、按分排、我标出来；非好友不出现；0 行', async () => {
    const a = await newUser();
    const b = await newUser();
    const stranger = await newUser();
    await befriend(a, b);
    expect((await call('/api/scores', { body: { gameId: 'kaipan', boardId: 'daily-2026-10-14', score: 300 }, cookie: a.cookie })).status).toBe(200);
    expect((await call('/api/scores', { body: { gameId: 'kaipan', boardId: 'daily-2026-10-14', score: 500 }, cookie: b.cookie })).status).toBe(200);
    await put(stranger, 'daily-2026-10-14', 900);
    const res = await week(a);
    expect(res.status).toBe(200);
    expect(rowsWritten()).toBe(0);
    const body = (await res.json()) as { week: string; entries: Entry[]; me: { rank: number; score: number } | null };
    expect(body.week).toBe('2026-10-12');
    expect(body.entries).toEqual([
      expect.objectContaining({ rank: 1, displayName: await nameOf(b), score: 500, isMe: false }),
      expect.objectContaining({ rank: 2, displayName: await nameOf(a), score: 300, isMe: true }),
    ]);
    expect(body.me).toEqual({ rank: 2, score: 300 });
  });

  it('这周每人取最好的一天；上周的、下周一的不算', async () => {
    const a = await newUser();
    const b = await newUser();
    await befriend(a, b);
    await put(a, 'daily-2026-10-12', 100);
    await put(a, 'daily-2026-10-13', 700);
    await put(a, 'daily-2026-10-14', 200);
    await put(b, 'daily-2026-10-11', 9_999); // 上周日
    await put(b, 'daily-2026-10-19', 9_999); // 下周一
    await put(b, 'daily-2026-10-14', 50);
    const body = (await (await week(a)).json()) as { entries: Entry[] };
    expect(body.entries.map((e) => e.score)).toEqual([700, 50]);
  });

  it('同一周规则改版：只认最新那一版（-v2），旧版的分数不拿来比', async () => {
    const a = await newUser();
    const b = await newUser();
    await befriend(a, b);
    await put(a, 'daily-2026-10-12', 9_000);
    await put(a, 'daily-2026-10-14-v2', 30);
    await put(b, 'daily-2026-10-13-v2', 40);
    const body = (await (await week(a)).json()) as { entries: Entry[] };
    expect(body.entries.map((e) => e.score)).toEqual([40, 30]);
  });

  it('没有每日榜的游戏 404，不认识的游戏 404；要登录', async () => {
    const a = await newUser();
    expect((await week(a, 'guandan')).status).toBe(404);
    expect((await week(a, 'nope')).status).toBe(404);
    expect((await call('/api/friends/week/kaipan')).status).toBe(401);
  });
});

describe('超越提示', () => {
  it('好友这周的最好成绩比我高：提最高的那个；我更高、我这周没成绩、非好友都不提；0 行', async () => {
    const a = await newUser();
    const b = await newUser();
    const c = await newUser();
    const stranger = await newUser();
    await befriend(a, b);
    await befriend(a, c);
    const over = async (u: U) => ((await (await call('/api/friends/overtakes', { cookie: u.cookie })).json()) as { overtakes: unknown[] }).overtakes;
    // 我这周还没成绩：没有纪录可超
    await put(b, 'daily-2026-10-13', 500);
    expect(await over(a)).toEqual([]);
    await put(a, 'daily-2026-10-14', 300);
    await put(c, 'daily-2026-10-14', 800);
    await put(stranger, 'daily-2026-10-14', 9_000);
    expect(await over(a)).toEqual([{ gameId: 'kaipan', by: { userId: c.user.id, displayName: await nameOf(c) }, score: 800, mine: 300 }]);
    expect(rowsWritten()).toBe(0);
    // b 只看到自己被 c 超过（a 比 b 低，不提）
    expect(await over(b)).toEqual([]);
    await befriend(b, c);
    expect(await over(b)).toEqual([expect.objectContaining({ by: expect.objectContaining({ userId: c.user.id }), score: 800, mine: 500 })]);
  });
});
