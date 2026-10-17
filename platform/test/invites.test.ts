/**
 * 一键叫人（0.14.0，docs/social.md 1.3，platform-backend.md 15.15）：发邀请的格式、只能叫好友、被屏蔽发不出、
 * 每天 50 条和同一个好友 1 分钟 1 条（超了 429 写 0 行）、收邀请只读、"不了"、过期、删号和 Cron 清理。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { runCleanup } from '../worker/api/cron';
import { advance, call, count, env, errorOf, registerUser, resetAll, rowsBy, rowsWritten } from './helpers';

beforeEach(() => resetAll());

let ipSeq = 0;
const newUser = () => registerUser(undefined, undefined, `198.51.100.${++ipSeq % 250}`);
type U = Awaited<ReturnType<typeof newUser>>;
interface Invite {
  id: string;
  from: { id: string; name: string };
  game: string;
  room: string;
  until: number;
}

const invite = (from: U, to: U | string, game = 'guandan', room = '123456') =>
  call('/api/invites', { body: { to: typeof to === 'string' ? to : to.user.id, game, room }, cookie: from.cookie });
const inbox = async (u: U) => ((await (await call('/api/invites', { cookie: u.cookie })).json()) as { invites: Invite[] }).invites;
const dismiss = (u: U, id: string) => call(`/api/invites/${id}/dismiss`, { body: {}, cookie: u.cookie });
async function befriend(a: U, b: U): Promise<void> {
  expect((await call('/api/friends/requests', { body: { friendCode: b.user.friendCode }, cookie: a.cookie })).status).toBe(200);
  expect((await call(`/api/friends/${a.user.id}/accept`, { body: {}, cookie: b.cookie })).status).toBe(200);
}
async function pair(): Promise<[U, U]> {
  const a = await newUser();
  const b = await newUser();
  await befriend(a, b);
  return [a, b];
}

describe('发邀请', () => {
  it('好友之间：回 {id}，写 3 行（live 类）；对方收到谁、哪个游戏、房间码、10 分钟后过期', async () => {
    const [a, b] = await pair();
    const res = await invite(a, b);
    expect(res.status).toBe(200);
    expect(rowsWritten()).toBe(3);
    expect(rowsBy('live')).toBe(3);
    const { id } = (await res.json()) as { id: string };
    const list = await inbox(b);
    expect(rowsWritten()).toBe(0);
    expect(list).toEqual([{ id, from: { id: a.user.id, name: expect.stringMatching(/^玩家/) }, game: 'guandan', room: '123456', until: Date.now() + 600_000 }]);
    // 发的人自己收不到
    expect(await inbox(a)).toEqual([]);
  });

  it('格式不对 400、0 行：没登记的游戏、不是 6 位数字的房间码、缺字段', async () => {
    const [a, b] = await pair();
    for (const [game, room] of [['nope', '123456'], ['guandan', '12345'], ['guandan', 'abc123'], ['guandan', '1234567'], ['../x', '123456'], ['guandan', '123456/../x']]) {
      const res = await invite(a, b, game, room);
      expect(res.status, `${game} ${room}`).toBe(400);
      expect(rowsWritten()).toBe(0);
    }
    expect((await call('/api/invites', { body: { game: 'guandan', room: '123456' }, cookie: a.cookie })).status).toBe(400);
  });

  it('只能叫好友：陌生人、请求还没接受的、自己、不存在的人都 403 not_friend，0 行', async () => {
    const a = await newUser();
    const c = await newUser();
    const d = await newUser();
    expect((await call('/api/friends/requests', { body: { friendCode: d.user.friendCode }, cookie: a.cookie })).status).toBe(200);
    for (const to of [c, d, a, 'A'.repeat(22)]) {
      const res = await invite(a, to);
      expect(res.status).toBe(403);
      expect(await errorOf(res)).toBe('not_friend');
      expect(rowsWritten()).toBe(0);
    }
  });

  it('被屏蔽发不出：B 屏蔽了 A，A 叫 B 403、0 行；B 之前收到的也不再显示', async () => {
    const [a, b] = await pair();
    expect((await invite(a, b)).status).toBe(200);
    expect(await inbox(b)).toHaveLength(1);
    expect((await call('/api/blocks', { body: { userId: a.user.id }, cookie: b.cookie })).status).toBe(204);
    advance(61_000);
    const res = await invite(a, b);
    expect(res.status).toBe(403);
    expect(rowsWritten()).toBe(0);
    expect(await inbox(b)).toEqual([]);
  });

  it('删了好友：之前的邀请不再给对方看', async () => {
    const [a, b] = await pair();
    await invite(a, b);
    expect((await call(`/api/friends/${a.user.id}`, { method: 'DELETE', cookie: b.cookie })).status).toBe(204);
    expect(await inbox(b)).toEqual([]);
  });

  it('同一个好友 1 分钟 1 条：再叫 429（带 Retry-After）、0 行；叫别的好友不受影响；过了 1 分钟又能叫', async () => {
    const [a, b] = await pair();
    const c = await newUser();
    await befriend(a, c);
    expect((await invite(a, b)).status).toBe(200);
    advance(20_000);
    const again = await invite(a, b);
    expect(again.status).toBe(429);
    expect(again.headers.get('retry-after')).toBe('40');
    expect(rowsWritten()).toBe(0);
    expect((await invite(a, c)).status).toBe(200);
    advance(40_000);
    expect((await invite(a, b)).status).toBe(200);
  });

  it('每人 24 小时 50 条：第 51 条 429、0 行；最早那条满 24 小时后又能发', async () => {
    await resetAll({ inviteGapMs: 1 });
    const [a, b] = await pair();
    for (let i = 0; i < 50; i++) {
      expect((await invite(a, b)).status, `第 ${i + 1} 条`).toBe(200);
      advance(1_000);
    }
    const over = await invite(a, b);
    expect(over.status).toBe(429);
    expect(rowsWritten()).toBe(0);
    expect(Number(over.headers.get('retry-after'))).toBe(86_400 - 50);
    advance(86_400_000 - 50_000 + 1);
    expect((await invite(a, b)).status).toBe(200);
  });

  it('同时发两条也冲不破上限：数和插入在同一条语句里', async () => {
    await resetAll({ invitesPerDay: 1, inviteGapMs: 1 });
    const [a, b] = await pair();
    const rs = await Promise.all([invite(a, b), invite(a, b), invite(a, b)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 429, 429]);
    expect(await count('SELECT COUNT(*) AS n FROM invites')).toBe(1);
  });

  it('要登录、要 CSRF', async () => {
    const [a, b] = await pair();
    expect((await call('/api/invites', { body: { to: b.user.id, game: 'guandan', room: '123456' } })).status).toBe(401);
    expect((await call('/api/invites', { body: { to: b.user.id, game: 'guandan', room: '123456' }, cookie: a.cookie, csrf: false })).status).toBe(403);
    expect((await call('/api/invites')).status).toBe(401);
    expect((await call('/api/invites/AAAAAAAAAAAAAAAA/dismiss', { body: {}, cookie: b.cookie, csrf: false })).status).toBe(403);
    expect(await count('SELECT COUNT(*) AS n FROM invites')).toBe(0);
  });
});

describe('收邀请', () => {
  it('10 分钟后过期就不给了；先到期的在前', async () => {
    const [a, b] = await pair();
    const c = await newUser();
    await befriend(c, b);
    await invite(a, b, 'guandan', '111111');
    advance(300_000);
    await invite(c, b, 'texas', '222222');
    expect((await inbox(b)).map((v) => v.room)).toEqual(['111111', '222222']);
    advance(300_000);
    expect((await inbox(b)).map((v) => v.room)).toEqual(['222222']);
    advance(300_000);
    expect(await inbox(b)).toEqual([]);
  });

  it('"不了"：204、1 行，以后不再给；再点、点别人的、点不存在的都 204、0 行，别人的照样在', async () => {
    const [a, b] = await pair();
    const c = await newUser();
    await befriend(a, c);
    const { id } = (await (await invite(a, b)).json()) as { id: string };
    const { id: idC } = (await (await invite(a, c)).json()) as { id: string };
    expect((await dismiss(b, id)).status).toBe(204);
    expect(rowsWritten()).toBe(1);
    expect(await inbox(b)).toEqual([]);
    expect((await dismiss(b, id)).status).toBe(204);
    expect(rowsWritten()).toBe(0);
    expect((await dismiss(b, idC)).status).toBe(204);
    expect(rowsWritten()).toBe(0);
    expect(await inbox(c)).toHaveLength(1);
    expect((await dismiss(b, 'x'.repeat(16))).status).toBe(204);
    expect((await dismiss(b, 'bad')).status).toBe(404);
  });
});

describe('清理', () => {
  it('删号：发出的、收到的邀请都删掉', async () => {
    const [a, b] = await pair();
    await invite(a, b);
    await invite(b, a);
    expect((await call('/api/account/delete', { body: { currentPassword: a.password }, cookie: a.cookie })).status).toBe(204);
    expect(await count('SELECT COUNT(*) AS n FROM invites')).toBe(0);
  });

  it('Cron 删 2 天前的，近的留着（按 24 小时数次数要用）', async () => {
    const [a, b] = await pair();
    await invite(a, b);
    advance(2 * 86_400_000 + 1);
    await invite(a, b);
    await runCleanup(env, Date.now());
    expect(await count('SELECT COUNT(*) AS n FROM invites')).toBe(1);
  });
});
