/** 排行榜（简单版，不防作弊）：交分只留最好的、写入行数、榜单 ID 和分数检查、每天上限、读榜的名次和范围、读的行数、清理。 */
import { beforeEach, describe, expect, it } from 'vitest';
import { fixedBoards, GAMES } from '../src/games';
import { acceptsScore, FIXED_BOARD_RE, isKnownBoard } from '../worker/api/boards';
import { beijingDate } from '../worker/api/time';
import { runCleanup } from '../worker/api/cron';
import { advance, call, count, env, errorOf, FIXED_NOW, registerUser, resetAll, rowsBy, rowsRead, rowsWritten } from './helpers';

beforeEach(() => resetAll());

let ipSeq = 0;
const newUser = () => registerUser(undefined, undefined, `192.0.2.${++ipSeq % 250}`);
type U = Awaited<ReturnType<typeof newUser>>;

/** FIXED_NOW 是北京时间 2026-10-14。 */
const TODAY = 'daily-2026-10-14';

const submit = (u: U, score: unknown, boardId: unknown = TODAY, gameId: unknown = 'kaipan') =>
  call('/api/scores', { body: { gameId, boardId, score }, cookie: u.cookie });
const board = (u: U, scope?: string, path = `kaipan/${TODAY}`) =>
  call(`/api/boards/${path}${scope ? `?scope=${scope}` : ''}`, { cookie: u.cookie });

interface Entry {
  rank: number;
  displayName: string;
  avatar: unknown;
  score: number;
  isMe: boolean;
}
interface Board {
  entries: Entry[];
  me: { rank: number | null; score: number } | null;
}
const read = async (u: U, scope?: string) => (await (await board(u, scope)).json()) as Board;

const insertRow = (userId: string, boardId: string, score: number, gameId = 'kaipan', updatedAt = FIXED_NOW) =>
  env.DB.prepare('INSERT INTO boards (user_id, game_id, board_id, score, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(
    userId, gameId, boardId, score, updatedAt,
  );

const seedUser = (id: string, i: number, lastSeen = FIXED_NOW) =>
  env.DB.prepare(
    'INSERT INTO users (id, username, display_name, friend_code, created_at, last_seen_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)',
  ).bind(id, `seed_${i}`, `路人${i}`, `S${String(i).padStart(7, '0')}`, lastSeen);

/** 直接往库里塞一批人和成绩（不走注册，省时间）。 */
async function seedBoard(n: number, scoreOf: (i: number) => number, boardId = TODAY): Promise<void> {
  const stmts = [];
  for (let i = 0; i < n; i++) {
    const id = `seed${String(i).padStart(18, '0')}`;
    stmts.push(seedUser(id, i), insertRow(id, boardId, scoreOf(i), 'kaipan', FIXED_NOW + i));
  }
  await env.DB.batch(stmts);
}

/** 少数几个人、每人很多条成绩：表很大，但 users 表小（Cron 里别的步骤扫 users，不在这里测）。都是 60 天内的每日榜。 */
async function seedWide(users: number, boardsEach: number): Promise<void> {
  const stmts = [];
  for (let u = 0; u < users; u++) {
    const id = `wide${String(u).padStart(16, '0')}`;
    stmts.push(seedUser(id, 9000 + u));
    for (let b = 0; b < boardsEach; b++) {
      stmts.push(insertRow(id, `daily-2026-10-${String(1 + (b % 14)).padStart(2, '0')}-v${1 + Math.floor(b / 14)}`, b));
    }
  }
  await env.DB.batch(stmts);
}

describe('交分', () => {
  it('第一次上榜：3 行（计数 1 + 表 1 + 排名索引 1），单独记在排行榜类', async () => {
    const u = await newUser();
    const res = await submit(u, 120);
    expect(await res.json()).toEqual({ best: 120, improved: true });
    expect(rowsWritten()).toBe(3);
    expect(rowsBy('board')).toBe(3);
    expect(rowsBy('save')).toBe(0);
  });

  it('只留最好的：更低、相等都不写（只有计数 1 行）；更高才改', async () => {
    const u = await newUser();
    await submit(u, 120);
    expect(await (await submit(u, 80)).json()).toEqual({ best: 120, improved: false });
    expect(rowsWritten()).toBe(1);
    expect(await (await submit(u, 120)).json()).toEqual({ best: 120, improved: false });
    expect(rowsWritten()).toBe(1);
    expect(await (await submit(u, 300)).json()).toEqual({ best: 300, improved: true });
    // 计数 1 + 改分数：表 1 + 排名索引 1（实测）
    expect(rowsWritten()).toBe(3);
    expect(await count('SELECT score AS n FROM boards WHERE user_id = ?1', u.user.id)).toBe(300);
  });

  it('负分可以（越低越好的游戏交相反数）；昨天、明天、带版本号的每日榜、不同游戏分开', async () => {
    const u = await newUser();
    expect(await (await submit(u, -50)).json()).toEqual({ best: -50, improved: true });
    expect(await (await submit(u, -80)).json()).toEqual({ best: -50, improved: false });
    expect(await (await submit(u, 10, 'daily-2026-10-13')).json()).toEqual({ best: 10, improved: true });
    expect(await (await submit(u, 11, 'daily-2026-10-15')).json()).toEqual({ best: 11, improved: true });
    expect(await (await submit(u, 12, 'daily-2026-10-14-v2')).json()).toEqual({ best: 12, improved: true });
    expect(await (await submit(u, 5, `${TODAY}-ddz`, 'guandan')).json()).toEqual({ best: 5, improved: true });
    expect(await count('SELECT COUNT(*) AS n FROM boards WHERE user_id = ?1', u.user.id)).toBe(5);
  });

  it('格式检查：游戏不在白名单 404；榜单不收、分数不合规 422；类型不对 400；都不写、不计数', async () => {
    const u = await newUser();
    const cases: [unknown, unknown, unknown, number, string][] = [
      ['nope', TODAY, 1, 404, 'unknown_game'],
      // 只收北京时间昨天、今天、明天的每日榜
      ['kaipan', 'daily-2026-10-16', 1, 422, 'invalid_board'],
      ['kaipan', 'daily-2026-10-12', 1, 422, 'invalid_board'],
      ['kaipan', 'daily-9999-12-31', 1, 422, 'invalid_board'],
      ['kaipan', 'daily-2026-10-14-v0', 1, 422, 'invalid_board'],
      ['kaipan', 'daily-2026-10-14-v100', 1, 422, 'invalid_board'],
      ['kaipan', 'daily-v2-2026-10-14', 1, 422, 'invalid_board'],
      // 没登记的固定榜、随意开的榜
      ['kaipan', 'endless', 1, 422, 'invalid_board'],
      ['kaipan', 'challenge-ab12cd', 1, 422, 'invalid_board'],
      ['kaipan', 'Daily_2026', 1, 422, 'invalid_board'],
      ['kaipan', '', 1, 422, 'invalid_board'],
      ['kaipan', TODAY, 1.5, 422, 'invalid_score'],
      ['kaipan', TODAY, 1e12 + 1, 422, 'invalid_score'],
      ['kaipan', TODAY, -1e12 - 1, 422, 'invalid_score'],
      ['kaipan', TODAY, 2 ** 53, 422, 'invalid_score'],
      ['kaipan', TODAY, '100', 400, 'bad_request'],
      ['kaipan', 1, 100, 400, 'bad_request'],
    ];
    for (const [gameId, boardId, score, status, code] of cases) {
      const res = await submit(u, score, boardId, gameId);
      expect([res.status, await errorOf(res)], JSON.stringify([gameId, boardId, score])).toEqual([status, code]);
      expect(rowsWritten()).toBe(0);
    }
    // 边界值可以
    expect((await submit(u, 1e12)).status).toBe(200);
    expect((await submit(u, -1e12, 'daily-2026-10-13')).status).toBe(200);
    expect(await count("SELECT COUNT(*) AS n FROM rate_counters WHERE key LIKE 'score:%'")).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM boards')).toBe(2);
  });

  // 要真交 200 次分才碰得到上限：单独跑约 2.5 秒，机器忙时（几个模块一起装依赖、跑测试）会贴着默认的 5 秒超时，所以这一条单独给 20 秒
  it('每天上限默认 200（0.10.2 从 50 放宽）（没更好也算一次）：超了 429、0 行；第二天恢复', async () => {
    const u = await newUser();
    for (let i = 0; i < 200; i++) expect((await submit(u, i % 3)).status).toBe(200);
    const over = await submit(u, 99);
    expect(over.status).toBe(429);
    expect(rowsWritten()).toBe(0);
    advance(24 * 3_600_000);
    // 第二天：昨天的榜也还收
    expect((await submit(u, 99)).status).toBe(200);
  }, 20_000);

  it('并发交分冲不破每天上限', async () => {
    await resetAll.limits({ scorePerDay: 3 });
    const u = await newUser();
    const res = await Promise.all(Array.from({ length: 10 }, (_, i) => submit(u, i, `daily-2026-10-14-v${i + 1}`)));
    expect(res.filter((r) => r.status === 200).length).toBe(3);
    expect(await count('SELECT COUNT(*) AS n FROM boards WHERE user_id = ?1', u.user.id)).toBe(3);
  });

  it('同一个榜并发交不同的分，最后留下最高的', async () => {
    const u = await newUser();
    const scores = [5, 90, 30, 77, 12, 64, 90, 1];
    const res = await Promise.all(scores.map((s) => submit(u, s)));
    expect(res.every((r) => r.status === 200)).toBe(true);
    expect(await count('SELECT score AS n FROM boards WHERE user_id = ?1', u.user.id)).toBe(90);
    expect(await count('SELECT COUNT(*) AS n FROM boards')).toBe(1);
  });

  it('停增长档（库太大）：交分 503 busy、0 行，读榜照常', async () => {
    const u = await newUser();
    await submit(u, 10);
    await resetAll.limits({ noGrowthDbBytes: 1 });
    const res = await submit(u, 20);
    expect([res.status, await errorOf(res)]).toEqual([503, 'busy']);
    expect(rowsWritten()).toBe(0);
    expect((await read(u)).me).toEqual({ rank: 1, score: 10 });
  });

  it('要登录；要 X-Arcade 和 Origin；都写 0 行', async () => {
    const u = await newUser();
    expect((await call('/api/scores', { body: { gameId: 'kaipan', boardId: TODAY, score: 1 } })).status).toBe(401);
    expect(rowsWritten()).toBe(0);
    expect((await call('/api/scores', { body: { gameId: 'kaipan', boardId: TODAY, score: 1 }, cookie: u.cookie, csrf: false })).status).toBe(403);
    expect(rowsWritten()).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM boards')).toBe(0);
  });
});

describe('交分的预期账号（userId）', () => {
  const as = (u: U, userId: unknown) => call('/api/scores', { body: { gameId: 'kaipan', boardId: TODAY, score: 1, userId }, cookie: u.cookie });

  it('一致照常；不一致 409 wrong_user、0 行、不计数（额度用完也先报这个）；格式不对 400、0 行', async () => {
    const [a, b] = [await newUser(), await newUser()];
    expect(await (await as(a, a.user.id)).json()).toEqual({ best: 1, improved: true });
    expect(rowsWritten()).toBe(3);
    const wrong = await as(b, a.user.id);
    expect([wrong.status, await errorOf(wrong)]).toEqual([409, 'wrong_user']);
    expect(rowsWritten()).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM rate_counters WHERE key = ?1', `score:${b.user.id}`)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM boards WHERE user_id = ?1', b.user.id)).toBe(0);
    await resetAll.limits({ scorePerDay: 1 });
    expect((await as(a, a.user.id)).status).toBe(429);
    expect(await errorOf(await as(a, b.user.id))).toBe('wrong_user');
    for (const bad of [1, '', 'a/b', null]) {
      const res = await as(a, bad);
      expect([res.status, await errorOf(res)], JSON.stringify(bad)).toEqual([400, 'bad_request']);
      expect(rowsWritten()).toBe(0);
    }
  });
});

describe('榜单 ID', () => {
  const fixed = new Map([['kaipan', new Set(['endless'])]]);

  it('固定榜登记了才收；每日榜只收北京时间昨天到明天；读榜认任何日期的每日榜', () => {
    expect(acceptsScore('kaipan', 'endless', FIXED_NOW, fixed)).toBe(true);
    expect(acceptsScore('guandan', 'endless', FIXED_NOW, fixed)).toBe(false);
    expect(acceptsScore('kaipan', 'endless-2', FIXED_NOW, fixed)).toBe(false);
    expect(acceptsScore('kaipan', 'daily-2026-10-15-v9', FIXED_NOW, fixed)).toBe(true);
    expect(acceptsScore('kaipan', 'daily-2026-10-16', FIXED_NOW, fixed)).toBe(false);
    // 北京时间 10-14 的最后一刻：明天是 10-15，10-16 还不收；过了零点就收
    const lastMoment = Date.UTC(2026, 9, 14, 15, 59, 59);
    expect(acceptsScore('kaipan', 'daily-2026-10-16', lastMoment, fixed)).toBe(false);
    expect(acceptsScore('kaipan', 'daily-2026-10-16', lastMoment + 1000, fixed)).toBe(true);
    expect(isKnownBoard('kaipan', 'daily-2026-08-01', fixed)).toBe(true);
    expect(isKnownBoard('kaipan', 'endless', fixed)).toBe(true);
    expect(isKnownBoard('kaipan', 'other', fixed)).toBe(false);
  });

  it('games.ts 里登记的固定榜名字合规：不以 daily 开头（不和每日榜混、不被 Cron 当成每日榜删）', () => {
    for (const g of GAMES) for (const { id } of fixedBoards(g)) expect(FIXED_BOARD_RE.test(id), `${g.id}/${id}`).toBe(true);
    expect(FIXED_BOARD_RE.test('daily')).toBe(false);
    expect(FIXED_BOARD_RE.test('daily-best')).toBe(false);
    expect(FIXED_BOARD_RE.test('endless')).toBe(true);
  });
});

describe('读榜', () => {
  it('前几名：同分同名次，同分先达到的在前；只有公开资料；isMe；0 行', async () => {
    const [a, b, c, d] = [await newUser(), await newUser(), await newUser(), await newUser()];
    await submit(a, 100);
    advance(1000);
    await submit(b, 300);
    advance(1000);
    await submit(c, 300);
    advance(1000);
    await submit(d, 50);
    const res = await board(c);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Board;
    expect(rowsWritten()).toBe(0);
    expect(body.entries.map((e) => [e.rank, e.score, e.isMe])).toEqual([
      [1, 300, false],
      [1, 300, true],
      [3, 100, false],
      [4, 50, false],
    ]);
    expect(Object.keys(body.entries[0]!).sort()).toEqual(['avatar', 'displayName', 'isMe', 'rank', 'score']);
    expect(body.me).toEqual({ rank: 1, score: 300 });
  });

  it('只给前 50 名；不在前 50 也告诉我第几名；没交过分 me 为 null', async () => {
    const [u, v] = [await newUser(), await newUser()];
    await seedBoard(60, (i) => 1000 + i);
    await submit(u, 5);
    const body = await read(u);
    expect(body.entries).toHaveLength(50);
    expect(body.entries[0]).toMatchObject({ rank: 1, score: 1059 });
    expect(body.entries.some((e) => e.isMe)).toBe(false);
    expect(body.me).toEqual({ rank: 61, score: 5 });
    expect((await read(v)).me).toBeNull();
  });

  it('和第 50 名同分但达到得晚：名次是并列的（≤ 50），但不在 entries 里', async () => {
    const u = await newUser();
    await seedBoard(50, (i) => (i < 49 ? 1000 + i : 7));
    advance(1000);
    await submit(u, 7);
    const body = await read(u);
    expect(body.entries).toHaveLength(50);
    expect(body.entries.at(-1)).toMatchObject({ rank: 50, score: 7, isMe: false });
    expect(body.me).toEqual({ rank: 50, score: 7 });
  });

  it('名次只数到上限，再多 rank 为 null（读的行数有上限）', async () => {
    await resetAll.limits({ boardRankCountMax: 10 });
    const u = await newUser();
    await seedBoard(60, (i) => 1000 + i);
    await submit(u, 5);
    expect((await read(u)).me).toEqual({ rank: null, score: 5 });
  });

  it('好友范围：只有我和我的好友（不含待处理的请求、陌生人、屏蔽了的人）', async () => {
    const [me, f1, f2, pending, stranger, blockedByMe, blocksMe] = [
      await newUser(), await newUser(), await newUser(), await newUser(), await newUser(), await newUser(), await newUser(),
    ];
    for (const f of [f1, f2, blockedByMe, blocksMe]) {
      await call('/api/friends/requests', { body: { friendCode: f.user.friendCode }, cookie: me.cookie });
      await call(`/api/friends/${me.user.id}/accept`, { body: {}, cookie: f.cookie });
    }
    await call('/api/friends/requests', { body: { friendCode: pending.user.friendCode }, cookie: me.cookie });
    expect((await call('/api/blocks', { body: { userId: blockedByMe.user.id }, cookie: me.cookie })).status).toBe(204);
    expect((await call('/api/blocks', { body: { userId: me.user.id }, cookie: blocksMe.cookie })).status).toBe(204);
    await submit(stranger, 999);
    await submit(pending, 500);
    await submit(blockedByMe, 400);
    await submit(blocksMe, 350);
    await submit(f1, 300);
    await submit(me, 200);
    await submit(f2, 100);
    const body = await read(me, 'friends');
    expect(rowsWritten()).toBe(0);
    expect(body.entries.map((e) => [e.rank, e.score, e.isMe])).toEqual([
      [1, 300, false],
      [2, 200, true],
      [3, 100, false],
    ]);
    expect(body.me).toEqual({ rank: 2, score: 200 });
    // 全站范围里都在
    expect((await read(me, 'all')).me).toEqual({ rank: 6, score: 200 });
  });

  it('读的行数和榜的大小无关（2000 人的榜：全站、好友、不在前 50 都只读一两百行）', async () => {
    await resetAll.limits({ boardRankCountMax: 50 });
    const [top, low, friend] = [await newUser(), await newUser(), await newUser()];
    await call('/api/friends/requests', { body: { friendCode: friend.user.friendCode }, cookie: low.cookie });
    await call(`/api/friends/${low.user.id}/accept`, { body: {}, cookie: friend.cookie });
    await seedBoard(2000, (i) => 1000 + (i % 97));
    await submit(top, 5000);
    await submit(low, 1);
    await submit(friend, 2);
    const reads: number[] = [];
    for (const [u, scope] of [[top, 'all'], [low, 'all'], [low, 'friends']] as const) {
      await read(u, scope);
      reads.push(rowsRead());
    }
    expect(reads.every((n) => n > 0 && n < 300), JSON.stringify(reads)).toBe(true);
    expect((await read(low, 'friends')).entries.map((e) => e.score)).toEqual([2, 1]);
  });

  it('游戏不在白名单 404 unknown_game；不认识的榜 404；过期没删的每日榜能读；scope 不对 400；没登录 401', async () => {
    const u = await newUser();
    expect(await errorOf(await board(u, undefined, `nope/${TODAY}`))).toBe('unknown_game');
    expect((await board(u, undefined, 'kaipan/Bad_Board')).status).toBe(404);
    expect((await board(u, undefined, 'kaipan/endless')).status).toBe(404);
    expect((await board(u, undefined, 'kaipan/daily-2026-08-01')).status).toBe(200);
    expect((await board(u, 'everyone')).status).toBe(400);
    expect((await call(`/api/boards/kaipan/${TODAY}`)).status).toBe(401);
    // 空榜
    expect(await read(u)).toEqual({ entries: [], me: null });
  });
});

describe('删除', () => {
  it('注销时删掉这个人的成绩和交分计数，别人的不动；表很大时也只读这个人的行', async () => {
    const [a, b] = [await newUser(), await newUser()];
    await seedWide(20, 150);
    await submit(a, 10);
    await submit(a, 20, 'daily-2026-10-13');
    await submit(b, 30);
    expect((await call('/api/account/delete', { body: { currentPassword: a.password }, cookie: a.cookie })).status).toBe(204);
    expect(rowsRead()).toBeLessThan(200);
    expect(await count('SELECT COUNT(*) AS n FROM boards WHERE user_id = ?1', a.user.id)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM rate_counters WHERE key = ?1', `score:${a.user.id}`)).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM boards')).toBe(3001);
  });

  it('Cron 删 60 天以前的每日榜（北京时间，带不带版本号都算，所有游戏），固定榜不动', async () => {
    const u = await newUser();
    // 60 天前是 2026-08-15
    const ids = ['daily-2026-08-14', 'daily-2026-08-01-v5', 'daily-2026-08-15', 'daily-2026-08-15-v2', TODAY, 'endless'];
    await env.DB.batch([...ids.map((id) => insertRow(u.user.id, id, 1)), insertRow(u.user.id, 'daily-2026-08-14', 1, 'guandan')]);
    await runCleanup(env, FIXED_NOW);
    const left = await env.DB.prepare("SELECT game_id || '/' || board_id AS id FROM boards ORDER BY id").all<{ id: string }>();
    expect(left.results.map((r) => r.id)).toEqual([
      'kaipan/daily-2026-08-15', 'kaipan/daily-2026-08-15-v2', 'kaipan/daily-2026-10-14', 'kaipan/endless',
    ]);
  });

  it('Cron 的读行数和表的大小无关：只读要删的旧榜和一年没来的人的行', async () => {
    await seedWide(20, 150);
    // 一个一年没来的人，有 40 条成绩
    const gone = 'gone0000000000000000';
    await env.DB.batch([seedUser(gone, 8000, 0), ...Array.from({ length: 40 }, (_, i) => insertRow(gone, `daily-2026-10-14-v${i + 1}`, i))]);
    // 5 条过期的每日榜
    await env.DB.batch(Array.from({ length: 5 }, (_, i) => insertRow(`old${i}`, 'daily-2026-01-01', i)));
    const { rowsRead: n } = await runCleanup(env, FIXED_NOW);
    expect(n).toBeLessThan(300);
    expect(await count('SELECT COUNT(*) AS n FROM boards')).toBe(3000);
  });

  it('Cron 每次清理有上限，删不完留到下次', async () => {
    await resetAll.limits({ cleanupMaxRows: 3 });
    await seedBoard(5, (i) => i, 'daily-2026-01-01');
    await runCleanup(env, FIXED_NOW);
    expect(await count('SELECT COUNT(*) AS n FROM boards')).toBe(2);
  });

  it('北京时间的日期', () => {
    expect(beijingDate(FIXED_NOW)).toBe('2026-10-14');
    expect(beijingDate(Date.UTC(2026, 9, 13, 16, 0))).toBe('2026-10-14');
    expect(beijingDate(Date.UTC(2026, 9, 13, 15, 59))).toBe('2026-10-13');
  });
});
