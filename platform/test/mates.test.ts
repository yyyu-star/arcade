/**
 * 搭子战绩（0.19.0，docs/platform-backend.md 15.19）：房间服务端经钱包绑定的 together() 报一场整桌真人，平台只给已经是好友的对累计；
 * 同一个 op 重报不加；好友列表、战绩页只给好友看，任意一方关了开关两边都看不到；删好友、屏蔽、注销删干净；写不了回 busy。
 */
import { exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { lastWalletStats, type TogetherReply } from '../worker/wallet-service';
import { call, count, flushMeter, registerUser, resetAll, rowsWritten } from './helpers';

beforeEach(() => resetAll());

let ipSeq = 0;
const newUser = () => registerUser(undefined, undefined, `198.51.100.${++ipSeq % 250}`);
type U = Awaited<ReturnType<typeof newUser>>;
interface Together {
  n: number;
  wins: number;
  theirWins: number;
  teamN: number;
  teamWins: number;
}

type Stub = { together(req: unknown): Promise<TogetherReply> };
const boundTo = (game: string) =>
  (exports as unknown as { WalletService: (o: { props: { game: string } }) => Stub }).WalletService({ props: { game } });
const unbound = (exports as unknown as { WalletService: Stub }).WalletService;
const wrote = () => lastWalletStats.rowsWritten;

let opSeq = 0;
const newOp = () => `room-123456-${String(++opSeq).padStart(4, '0')}`;
const report = (players: { userId: string; team?: number; win: boolean }[], o: { game?: string; op?: string } = {}) =>
  boundTo(o.game ?? 'guandan').together({ op: o.op ?? newOp(), players });
const p = (u: U, win: boolean, team?: number) => (team === undefined ? { userId: u.user.id, win } : { userId: u.user.id, team, win });

async function befriend(a: U, b: U): Promise<void> {
  expect((await call('/api/friends/requests', { body: { friendCode: b.user.friendCode }, cookie: a.cookie })).status).toBe(200);
  expect((await call(`/api/friends/${a.user.id}/accept`, { body: {}, cookie: b.cookie })).status).toBe(200);
}
const friendsOf = async (u: U) =>
  ((await (await call('/api/friends', { cookie: u.cookie })).json()) as { friends: { userId: string; together?: Together }[] }).friends;
const togetherOf = async (u: U, other: U) => (await friendsOf(u)).find((f) => f.userId === other.user.id)?.together;
const statsOf = async (u: U, other: U) =>
  ((await (await call(`/api/stats/${other.user.id}`, { cookie: u.cookie })).json()) as { together?: Record<string, Together> }).together;

describe('together()：报一场', () => {
  it('4 人掼蛋两队：只给好友对记（3 对好友 3 行，陌生人 0）；队友赢了算搭档赢；各自视角的赢场', async () => {
    const [a, b, c, d] = [await newUser(), await newUser(), await newUser(), await newUser()];
    await befriend(a, b);
    await befriend(a, c);
    await befriend(b, c);
    // a、b 一队赢了；c、d 一队输了；d 和谁都不是好友
    const r = await report([p(a, true, 0), p(b, true, 0), p(c, false, 1), p(d, false, 1)]);
    expect(r).toEqual({ ok: true, pairs: 3 });
    expect(lastWalletStats.byCategory.board).toBe(wrote());
    expect(await count('SELECT COUNT(*) AS n FROM mates')).toBe(3);
    expect(await togetherOf(a, b)).toEqual({ n: 1, wins: 1, theirWins: 1, teamN: 1, teamWins: 1 });
    expect(await togetherOf(c, a)).toEqual({ n: 1, wins: 0, theirWins: 1, teamN: 0, teamWins: 0 });
    expect(await togetherOf(a, c)).toEqual({ n: 1, wins: 1, theirWins: 0, teamN: 0, teamWins: 0 });
    // 再打一场：同一行加，不多行
    await report([p(a, false, 0), p(b, false, 0), p(c, true, 1), p(d, true, 1)]);
    expect(await count('SELECT COUNT(*) AS n FROM mates')).toBe(3);
    expect(await togetherOf(b, a)).toEqual({ n: 2, wins: 1, theirWins: 1, teamN: 2, teamWins: 1 });
  });

  it('写入行数：新的一对 2 行（表 + hi 索引），已有的一对加一场 1 行；同一个 op 重报 0 行、pairs 0', async () => {
    const [a, b] = [await newUser(), await newUser()];
    await befriend(a, b);
    const op = newOp();
    expect(await report([p(a, true), p(b, false)], { op })).toEqual({ ok: true, pairs: 1 });
    expect(wrote()).toBe(2);
    expect(await report([p(a, true), p(b, false)], { op })).toEqual({ ok: true, pairs: 0 });
    expect(wrote()).toBe(0);
    expect(await report([p(a, true), p(b, false)])).toEqual({ ok: true, pairs: 1 });
    expect(wrote()).toBe(1);
    expect(await togetherOf(a, b)).toMatchObject({ n: 2, wins: 2, theirWins: 0 });
  });

  it('游戏分开记：game 取绑定上的；战绩页按游戏分开给，好友列表加起来', async () => {
    const [a, b] = [await newUser(), await newUser()];
    await befriend(a, b);
    await report([p(a, true), p(b, false)], { game: 'texas' });
    await report([p(a, false), p(b, true)], { game: 'mahjong' });
    expect(await statsOf(a, b)).toEqual({
      texas: { n: 1, wins: 1, theirWins: 0, teamN: 0, teamWins: 0 },
      mahjong: { n: 1, wins: 0, theirWins: 1, teamN: 0, teamWins: 0 },
    });
    expect(await togetherOf(a, b)).toEqual({ n: 2, wins: 1, theirWins: 1, teamN: 0, teamWins: 0 });
  });

  it('没有好友对：pairs 0、0 行；格式不对 bad_request；没绑游戏 bad_game；都不写', async () => {
    const [a, b, c] = [await newUser(), await newUser(), await newUser()];
    expect(await report([p(a, true), p(b, false)])).toEqual({ ok: true, pairs: 0 });
    expect(wrote()).toBe(0);
    await befriend(a, b);
    for (const req of [
      null,
      { op: newOp() },
      { op: 'short', players: [p(a, true), p(b, false)] },
      { op: newOp(), players: [p(a, true)] },
      { op: newOp(), players: [p(a, true), p(a, false)] },
      { op: newOp(), players: [p(a, true), { userId: b.user.id }] },
      { op: newOp(), players: [p(a, true), { userId: b.user.id, win: false, team: 4 }] },
      { op: newOp(), players: [p(a, true), { userId: '../x', win: false }] },
      { op: newOp(), players: Array.from({ length: 9 }, (_, i) => ({ userId: `user${i}`, win: false })) },
    ]) {
      expect(await boundTo('guandan').together(req), JSON.stringify(req)).toEqual({ ok: false, error: 'bad_request' });
    }
    expect(await unbound.together({ op: newOp(), players: [p(a, true), p(c, false)] })).toEqual({ ok: false, error: 'bad_game' });
    expect(await count('SELECT COUNT(*) AS n FROM mates')).toBe(0);
  });

  it('排行榜类预算用完、停增长档：busy、0 行', async () => {
    const [a, b] = [await newUser(), await newUser()];
    await befriend(a, b);
    await resetAll.limits({ budget: { board: 1 } });
    await report([p(a, true), p(b, false)]);
    await flushMeter();
    expect(await report([p(a, true), p(b, false)])).toEqual({ ok: false, error: 'busy' });
    expect(wrote()).toBe(0);
    await resetAll.limits({ noGrowthDbBytes: 1 });
    expect(await report([p(a, true), p(b, false)])).toEqual({ ok: false, error: 'busy' });
    expect(await count('SELECT n FROM mates')).toBe(1);
  });
});

describe('看', () => {
  it('不是好友看不到：好友列表里没有、战绩页不带；没一起打过的好友也不带', async () => {
    const [a, b, c] = [await newUser(), await newUser(), await newUser()];
    await befriend(a, b);
    await befriend(a, c);
    await report([p(a, true), p(b, false)]);
    expect(await togetherOf(a, c)).toBeUndefined();
    expect(await statsOf(c, b)).toBeUndefined();
    expect(await statsOf(a, c)).toBeUndefined();
    expect(await statsOf(a, b)).toBeDefined();
  });

  it('开关：任意一方关了两边都看不到，照样记；再打开看得到以前的', async () => {
    const [a, b] = [await newUser(), await newUser()];
    await befriend(a, b);
    await report([p(a, true), p(b, false)]);
    const off = await call('/api/me', { method: 'PATCH', body: { showMates: false }, cookie: b.cookie });
    expect(((await off.json()) as { user: { showMates: boolean } }).user.showMates).toBe(false);
    expect(await togetherOf(a, b)).toBeUndefined();
    expect(await togetherOf(b, a)).toBeUndefined();
    expect(await statsOf(a, b)).toBeUndefined();
    expect(await statsOf(b, a)).toBeUndefined();
    expect(await report([p(a, true), p(b, false)])).toEqual({ ok: true, pairs: 1 });
    await call('/api/me', { method: 'PATCH', body: { showMates: true }, cookie: b.cookie });
    expect(await togetherOf(a, b)).toMatchObject({ n: 2 });
    expect((await call('/api/me', { method: 'PATCH', body: { showMates: 'no' }, cookie: b.cookie })).status).toBe(400);
  });
});

describe('删干净', () => {
  it('删好友：这一对各游戏的行一起删（好友 1 + 两个游戏 2 = 3 行），再加回来从 0 算', async () => {
    const [a, b] = [await newUser(), await newUser()];
    await befriend(a, b);
    await report([p(a, true), p(b, false)], { game: 'texas' });
    await report([p(a, true), p(b, false)], { game: 'mahjong' });
    const res = await call(`/api/friends/${b.user.id}`, { method: 'DELETE', cookie: a.cookie });
    expect(res.status).toBe(204);
    expect(rowsWritten()).toBe(3);
    expect(await count('SELECT COUNT(*) AS n FROM mates')).toBe(0);
    await befriend(a, b);
    expect(await togetherOf(a, b)).toBeUndefined();
    // 撤回请求、删不存在的：照旧 404，不碰别人
    expect((await call(`/api/friends/${(await newUser()).user.id}`, { method: 'DELETE', cookie: a.cookie })).status).toBe(404);
  });

  it('屏蔽：这一对的行一起删；别的好友对不动', async () => {
    const [a, b, c] = [await newUser(), await newUser(), await newUser()];
    await befriend(a, b);
    await befriend(a, c);
    await report([p(a, true), p(b, false), p(c, false)]);
    expect((await call('/api/blocks', { body: { userId: a.user.id }, cookie: b.cookie })).status).toBe(204);
    // 计数 1 + 屏蔽 1 + 好友关系 1 + 这一对 1 个游戏 1
    expect(rowsWritten()).toBe(4);
    expect(await count('SELECT COUNT(*) AS n FROM mates')).toBe(1);
    expect(await togetherOf(a, c)).toMatchObject({ n: 1 });
  });

  it('注销：本人在 lo、hi 两边的行都删', async () => {
    const [a, b, c] = [await newUser(), await newUser(), await newUser()];
    await befriend(a, b);
    await befriend(a, c);
    await befriend(b, c);
    await report([p(a, true), p(b, false), p(c, false)]);
    expect(await count('SELECT COUNT(*) AS n FROM mates')).toBe(3);
    expect((await call('/api/account/delete', { body: { currentPassword: a.password }, cookie: a.cookie })).status).toBe(204);
    expect(await count('SELECT COUNT(*) AS n FROM mates')).toBe(1);
    expect(await count('SELECT COUNT(*) AS n FROM mates WHERE lo = ?1 OR hi = ?1', a.user.id)).toBe(0);
  });
});
