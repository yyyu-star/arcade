/** 排行榜页接口（0.10.4，docs/platform-backend.md 15.12）：本周净赢、称号收集从 career 汇总，读走缓存，写 0 行。 */
import { exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { dailyTabs } from '../src/games';
import type { WalletReply } from '../worker/api/wallet-store';
import { advance, call, env, registerUser, resetAll, rowsWritten } from './helpers';

beforeEach(() => resetAll());

type Stub = { buyin(req: unknown): Promise<WalletReply>; settle(req: unknown): Promise<WalletReply> };
const boundTo = (game: string) => (exports as unknown as { WalletService: (o: { props: { game: string } }) => Stub }).WalletService({ props: { game } });
let n = 0;
const id = (p: string) => `${p}-${String(++n).padStart(6, '0')}`;

/** 带 2,000 上桌、结回 amount（好友房 server 模式，不受单机上限影响） */
async function play(userId: string, game: string, amount: number, titles: string[] = []) {
  const base = { userId, game, ref: id('ref'), mode: 'server' };
  await boundTo(game).buyin({ ...base, tier: 'small', amount: 2_000, until: Date.now() + 3_600_000, op: id('op') });
  await boundTo(game).settle({ ...base, amount, op: id('op'), stats: { rounds: 1, wins: 0, best: 0, titles } });
}

type Board = { entries: { rank: number; userId: string; value: number; isMe: boolean }[]; me: { rank: number; value: number } | null };
type Body = { week: string; boards: Record<string, Board>; daily: Record<string, string | null> };
const read = async (cookie: string, scope = 'all') => (await (await call(`/api/leaderboard?scope=${scope}`, { cookie })).json()) as Body;
const ranks = (b: Board) => b.entries.map((e) => [e.userId, e.rank, e.value]);

describe('GET /api/leaderboard', () => {
  it('本周净赢：总榜按各游戏合计排，同分同名次；每个游戏单独一榜；称号榜按个数；写 0 行', async () => {
    const [a, b, c] = [await registerUser(), await registerUser(), await registerUser()];
    await play(a.user.id, 'texas', 5_000, ['bluff_king']);
    await play(a.user.id, 'guandan', 1_000);
    await play(b.user.id, 'texas', 4_000, ['all_in', 'river_rat']);
    await play(c.user.id, 'kaipan', 4_000);
    const body = await read(b.cookie);
    expect(rowsWritten()).toBe(0);
    expect(body.week).toBe('2026-10-12');
    // a：德州 +3,000、掼蛋 −1,000；b：德州 +2,000；c：开盘 +2,000，三个人并列第一
    expect(body.boards.total!.entries.map((e) => e.value)).toEqual([2_000, 2_000, 2_000]);
    expect(body.boards.total!.entries.map((e) => e.rank)).toEqual([1, 1, 1]);
    expect(ranks(body.boards.texas!)).toEqual([
      [a.user.id, 1, 3_000],
      [b.user.id, 2, 2_000],
    ]);
    expect(ranks(body.boards.guandan!)).toEqual([[a.user.id, 1, -1_000]]);
    expect(ranks(body.boards.titles!)).toEqual([
      [b.user.id, 1, 2],
      [a.user.id, 2, 1],
    ]);
    expect(body.boards.texas!.me).toEqual({ rank: 2, value: 2_000 });
    expect(body.boards.guandan!.me).toBeNull();
  });

  it('只看好友：我和我的好友；读走 5 分钟缓存，过了才看到新结回的；换周后本周榜清零、称号榜还在', async () => {
    const [a, b, c] = [await registerUser(), await registerUser(), await registerUser()];
    expect((await call('/api/friends/requests', { body: { friendCode: b.user.friendCode }, cookie: a.cookie })).status).toBe(200);
    expect((await call(`/api/friends/${a.user.id}/accept`, { body: {}, cookie: b.cookie })).status).toBe(200);
    await play(a.user.id, 'texas', 3_000, ['bluff_king']);
    await play(b.user.id, 'texas', 2_500);
    await play(c.user.id, 'texas', 9_000);
    expect((await read(a.cookie, 'friends')).boards.texas!.entries.map((e) => e.userId)).toEqual([a.user.id, b.user.id]);
    expect((await read(a.cookie)).boards.texas!.entries.map((e) => e.userId)).toEqual([c.user.id, a.user.id, b.user.id]);
    await play(b.user.id, 'texas', 20_000);
    expect((await read(a.cookie)).boards.texas!.entries[0]!.userId).toBe(c.user.id);
    advance(5 * 60_000 + 1);
    expect((await read(a.cookie)).boards.texas!.entries[0]!.userId).toBe(b.user.id);
    advance(6 * 24 * 3_600_000);
    const next = await read(a.cookie);
    expect([next.week, next.boards.total!.entries.length, next.boards.titles!.entries.length]).toEqual(['2026-10-19', 0, 1]);
  });

  it('告诉页面登记了每日榜的游戏今天的榜 id（规则版本最大的那个）；没人交过是 null；没登记的游戏不给；scope 不对 400', async () => {
    const a = await registerUser();
    // 有子榜的游戏（夜巡）按"游戏 id:子榜 id"给
    const daily = Object.fromEntries(dailyTabs().map((t) => [t.key, null]));
    expect(daily).toHaveProperty('kaipan');
    expect((await read(a.cookie)).daily).toEqual(daily);
    const rows: [string, string][] = [
      ...['daily-2026-10-14', 'daily-2026-10-14-v2', 'daily-2026-10-14-v10', 'daily-2026-10-13-v3'].map((b) => ['kaipan', b] as [string, string]),
      ['guandan', 'daily-2026-10-14'],
    ];
    for (const [game, board] of rows) {
      await env.DB.prepare('INSERT INTO boards (user_id, game_id, board_id, score, updated_at) VALUES (?1, ?2, ?3, 1, 0)').bind(a.user.id, game, board).run();
    }
    advance(5 * 60_000 + 1);
    expect((await read(a.cookie)).daily).toEqual({ ...daily, kaipan: 'daily-2026-10-14-v10' });
    expect((await call('/api/leaderboard?scope=x', { cookie: a.cookie })).status).toBe(400);
    expect((await call('/api/leaderboard')).status).toBe(401);
  });
});
