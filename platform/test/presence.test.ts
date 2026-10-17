/**
 * 好友在线（0.13.0，docs/social.md 1.2，platform-backend.md 15.13）：报位置的节流和写入行数、好友列表里的在线和在哪、
 * "让好友看到我在哪"开关（关了好友那边和离线一样），以及写不了时静默 204。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { advance, call, errorOf, flushMeter, registerUser, resetAll, rowsBy, rowsWritten } from './helpers';

beforeEach(() => resetAll());

let ipSeq = 0;
const newUser = () => registerUser(undefined, undefined, `198.51.100.${++ipSeq % 250}`);
type U = Awaited<ReturnType<typeof newUser>>;
interface Friend {
  userId: string;
  online: boolean;
  where?: { place: string; game?: string; room?: string; seats?: string };
}

const report = (u: U, body: unknown) => call('/api/presence', { body, cookie: u.cookie });
const friendsOf = async (u: U) => ((await (await call('/api/friends', { cookie: u.cookie })).json()) as { friends: Friend[] }).friends;
async function befriend(a: U, b: U): Promise<void> {
  expect((await call('/api/friends/requests', { body: { friendCode: b.user.friendCode }, cookie: a.cookie })).status).toBe(200);
  expect((await call(`/api/friends/${a.user.id}/accept`, { body: {}, cookie: b.cookie })).status).toBe(200);
}

describe('报位置', () => {
  it('204；第一次写 1 行（live 类），2 分钟内再报 0 行，过了再写；要登录、要 CSRF', async () => {
    const a = await newUser();
    expect((await report(a, { place: 'lobby' })).status).toBe(204);
    expect(rowsWritten()).toBe(1);
    expect(rowsBy('live')).toBe(1);
    advance(60_000);
    expect((await report(a, { place: 'game', game: 'kaipan' })).status).toBe(204);
    expect(rowsWritten()).toBe(0);
    advance(60_000);
    expect((await report(a, { place: 'game', game: 'kaipan' })).status).toBe(204);
    expect(rowsWritten()).toBe(1);
    expect((await call('/api/presence', { body: { place: 'lobby' } })).status).toBe(401);
    expect((await call('/api/presence', { body: { place: 'lobby' }, cookie: a.cookie, csrf: false })).status).toBe(403);
  });

  it('格式不对 400：不认识的地方、不认识的游戏、房间没带码、码和人数格式不对', async () => {
    const a = await newUser();
    for (const body of [
      {},
      { place: 'moon' },
      { place: 'game' },
      { place: 'game', game: 'chess' },
      { place: 'room', game: 'guandan' },
      { place: 'room', game: 'guandan', room: '12' },
      { place: 'room', game: 'guandan', room: 'abc123' },
      { place: 'room', game: 'guandan', room: '1234567' },
      { place: 'room', game: 'guandan', room: '123456', seats: 'three' },
    ]) {
      const res = await report(a, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await errorOf(res)).toBe('bad_request');
    }
  });

  it('live 类预算用完：静默 204，不写（不打扰玩家）', async () => {
    await resetAll({ budget: { live: 1 } });
    const a = await newUser();
    expect((await report(a, { place: 'lobby' })).status).toBe(204);
    expect(rowsWritten()).toBe(1);
    // live 预算用完（上一次那 1 行）：再报也是 204、0 行
    advance(200_000);
    await flushMeter();
    expect((await report(a, { place: 'lobby' })).status).toBe(204);
    expect(rowsWritten()).toBe(0);
  });
});

describe('好友列表里的在线和在哪', () => {
  it('好友在房间里：online 和 where（游戏、房间码、人数）；5 分钟没报就离线；不是好友的看不到', async () => {
    const [a, b, stranger] = [await newUser(), await newUser(), await newUser()];
    await befriend(a, b);
    expect((await friendsOf(b))[0]).toMatchObject({ userId: a.user.id, online: false });
    expect((await friendsOf(b))[0]!.where).toBeUndefined();
    await report(a, { place: 'room', game: 'guandan', room: '123456', seats: '3/4' });
    expect((await friendsOf(b))[0]).toMatchObject({ online: true, where: { place: 'room', game: 'guandan', room: '123456', seats: '3/4' } });
    expect(await friendsOf(stranger)).toEqual([]);
    advance(5 * 60_000);
    const later = (await friendsOf(b))[0]!;
    expect(later.online).toBe(false);
    expect(later.where).toBeUndefined();
  });

  it('隐私开关：A 关掉"让好友看到我在哪"，B 那边 A 既不在线也没有位置（和离线一样）；再打开又看得到', async () => {
    const [a, b] = [await newUser(), await newUser()];
    await befriend(a, b);
    await report(a, { place: 'room', game: 'guandan', room: '123456', seats: '3/4' });
    const off = await call('/api/me', { method: 'PATCH', body: { showWhere: false }, cookie: a.cookie });
    expect(off.status).toBe(200);
    expect(((await off.json()) as { user: { showWhere: boolean } }).user.showWhere).toBe(false);
    const hidden = (await friendsOf(b))[0]!;
    expect(hidden.online).toBe(false);
    expect(hidden.where).toBeUndefined();
    expect(JSON.stringify(hidden)).not.toContain('123456');
    // 关着的时候照常报（last_seen_at 跟着走），B 还是看不到
    advance(120_000);
    await report(a, { place: 'room', game: 'texas', room: '654321' });
    expect(JSON.stringify(await friendsOf(b))).not.toContain('654321');
    await call('/api/me', { method: 'PATCH', body: { showWhere: true }, cookie: a.cookie });
    expect((await friendsOf(b))[0]).toMatchObject({ online: true, where: { place: 'room', game: 'texas', room: '654321' } });
  });

  it('PATCH /api/me：只改开关不碰昵称；什么都不带、开关不是布尔 400', async () => {
    const a = await newUser();
    const me = async () => ((await (await call('/api/me', { cookie: a.cookie })).json()) as { user: { displayName: string; showWhere: boolean } }).user;
    const name = (await me()).displayName;
    expect((await me()).showWhere).toBe(true);
    expect((await call('/api/me', { method: 'PATCH', body: { showWhere: false }, cookie: a.cookie })).status).toBe(200);
    expect(await me()).toMatchObject({ displayName: name, showWhere: false });
    expect((await call('/api/me', { method: 'PATCH', body: {}, cookie: a.cookie })).status).toBe(400);
    expect((await call('/api/me', { method: 'PATCH', body: { showWhere: 'no' }, cookie: a.cookie })).status).toBe(400);
  });
});
