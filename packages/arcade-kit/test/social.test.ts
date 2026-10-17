/**
 * 社交第一期（0.12.0）：报位置、邀请的接口调用（假 fetch 查方法、地址、头、请求体）和挑哪条邀请弹。
 * 横条本身在浏览器里看（demo/social.html）；workerd 里没有 document，mountSocial 一律不挂。
 */
import { describe, expect, it } from 'vitest';
import {
  type Invite,
  dismissInvite,
  fetchFriends,
  fetchInvites,
  inviteText,
  inviteUrl,
  mountSocial,
  parseFriend,
  parseInvites,
  pickInvite,
  postPresence,
  sendInvite,
  setShowWhere,
  untilOf,
} from '../src/social.ts';

interface Call {
  url: string;
  init: RequestInit;
}

/** 假 fetch：记下每次调用，按顺序回给定的响应 */
function fake(...replies: (Response | Error)[]): { f: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const f = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = replies.shift() ?? new Response(null, { status: 500 });
    if (r instanceof Error) throw r;
    return r;
  }) as typeof fetch;
  return { f, calls };
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const hdr = (c: Call, k: string): string | undefined => (c.init.headers as Record<string, string>)[k];

const inv = (id: string, until: number, extra: Partial<Invite> = {}): Invite => ({ id, from: { id: 'u1', name: '老王' }, game: 'cards', room: 'ABC123', until, ...extra });

describe('接口：写的请求带 x-arcade、同源 cookie', () => {
  it('报位置 POST /api/presence', async () => {
    const { f, calls } = fake(new Response(null, { status: 204 }));
    expect(await postPresence({ place: 'room', game: 'cards', room: 'ABC123', seats: '3/4' }, { fetchImpl: f })).toBe(204);
    const c = calls[0]!;
    expect(c.url).toBe('/api/presence');
    expect(c.init.method).toBe('POST');
    expect(c.init.credentials).toBe('same-origin');
    expect(hdr(c, 'x-arcade')).toBe('1');
    expect(hdr(c, 'content-type')).toBe('application/json');
    expect(JSON.parse(String(c.init.body))).toEqual({ place: 'room', game: 'cards', room: 'ABC123', seats: '3/4' });
  });

  it('报位置连不上回 0', async () => {
    const { f } = fake(new TypeError('offline'));
    expect(await postPresence({ place: 'lobby' }, { fetchImpl: f })).toBe(0);
  });

  it('不了 POST /api/invites/<id>/dismiss，id 编码', async () => {
    const { f, calls } = fake(new Response(null, { status: 204 }));
    expect(await dismissInvite('a/b', { fetchImpl: f, keepalive: true })).toBe(true);
    expect(calls[0]!.url).toBe('/api/invites/a%2Fb/dismiss');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.keepalive).toBe(true);
    expect(hdr(calls[0]!, 'x-arcade')).toBe('1');
    expect(calls[0]!.init.body).toBeUndefined();
  });

  it('开关 PATCH /api/me {showWhere}', async () => {
    const { f, calls } = fake(new Response(null, { status: 204 }));
    expect(await setShowWhere(false, { fetchImpl: f })).toBe(true);
    expect(calls[0]!.url).toBe('/api/me');
    expect(calls[0]!.init.method).toBe('PATCH');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ showWhere: false });
  });

  it('发邀请：成功拿 id，429 是超限（带 retry-after），403 是被屏蔽，401 没登录', async () => {
    const { f, calls } = fake(
      json({ id: 'i1' }),
      json({ error: 'limit' }, 429, { 'retry-after': '42' }),
      json({ error: 'blocked' }, 403),
      json({ error: 'login' }, 401),
      json({}, 500),
      new TypeError('offline'),
    );
    const to = { to: 'u2', game: 'cards', room: 'ABC123' };
    expect(await sendInvite(to, { fetchImpl: f })).toEqual({ ok: true, id: 'i1' });
    expect(await sendInvite(to, { fetchImpl: f })).toEqual({ ok: false, error: 'limit', retryAfter: 42 });
    expect(await sendInvite(to, { fetchImpl: f })).toEqual({ ok: false, error: 'blocked' });
    expect(await sendInvite(to, { fetchImpl: f })).toEqual({ ok: false, error: 'login' });
    expect(await sendInvite(to, { fetchImpl: f })).toEqual({ ok: false, error: 'failed' });
    expect(await sendInvite(to, { fetchImpl: f })).toEqual({ ok: false, error: 'failed' });
    expect(calls[0]!.url).toBe('/api/invites');
    expect(calls[0]!.init.method).toBe('POST');
    expect(hdr(calls[0]!, 'x-arcade')).toBe('1');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual(to);
  });
});

describe('接口：读', () => {
  it('问邀请 GET /api/invites，形状不对的丢掉', async () => {
    const { f, calls } = fake(
      json({
        invites: [
          { id: 'i1', from: { id: 'u1', name: '老王' }, game: 'cards', room: 'ABC123', until: 1000 },
          { id: 'i2', from: { id: 'u1', name: '老王' }, game: '../admin', room: 'ABC123', until: 1000 },
          { id: 'i3', from: { id: 'u1', name: '老王' }, game: 'cards', room: 'AB/12', until: 1000 },
          { id: 'i4', from: { id: 'u1', name: '' }, game: 'cards', room: 'ABC123', until: 1000 },
          { id: 'i5', from: { id: 'u1', name: '小李' }, game: 'cards', room: 'ABC123', until: '2026-10-16T12:00:00Z' },
          null,
        ],
      }),
    );
    const r = await fetchInvites({ fetchImpl: f });
    expect(r.status).toBe(200);
    expect(r.invites.map((v) => v.id)).toEqual(['i1', 'i5']);
    expect(r.invites[1]!.until).toBe(Date.parse('2026-10-16T12:00:00Z'));
    expect(calls[0]!.url).toBe('/api/invites');
    expect(calls[0]!.init.method).toBeUndefined();
    expect(calls[0]!.init.credentials).toBe('same-origin');
  });

  it('问邀请：401 带出状态，连不上是 0', async () => {
    const { f } = fake(json({ error: 'login' }, 401), new TypeError('offline'));
    expect(await fetchInvites({ fetchImpl: f })).toEqual({ status: 401, invites: [] });
    expect(await fetchInvites({ fetchImpl: f })).toEqual({ status: 0, invites: [] });
  });

  it('好友列表：平台的真实形状 { userId, displayName, avatar }（platform-backend 15.4）统一成 id、name，原样字段留着', async () => {
    const { f } = fake(
      json({
        friends: [
          { userId: 'u1', displayName: '老王', avatar: 3, online: true, where: { place: 'room', game: 'cards', room: 'ABC123', seats: '3/4' } },
          { userId: 'u2', displayName: '小李', avatar: null, online: false },
          { displayName: '没有 id' },
        ],
      }),
    );
    expect(await fetchFriends({ fetchImpl: f })).toEqual([
      { id: 'u1', userId: 'u1', name: '老王', displayName: '老王', avatar: 3, online: true, where: { place: 'room', game: 'cards', room: 'ABC123', seats: '3/4' } },
      { id: 'u2', userId: 'u2', name: '小李', displayName: '小李', avatar: null, online: false },
    ]);
    expect(parseFriend(null)).toBeNull();
    expect(parseFriend({ userId: 7 })).toBeNull();
  });

  it('好友列表：online 只认 true，where 原样（也认 id、name）', async () => {
    const { f, calls } = fake(
      json({ friends: [{ id: 'u1', name: '老王', online: true, where: { place: 'lobby' } }, { id: 'u2', name: '小李', online: 'yes' }, { name: 'x' }] }),
      json({}, 500),
    );
    expect(await fetchFriends({ fetchImpl: f })).toEqual([
      { id: 'u1', name: '老王', online: true, where: { place: 'lobby' } },
      { id: 'u2', name: '小李', online: false },
    ]);
    expect(calls[0]!.url).toBe('/api/friends');
    expect(await fetchFriends({ fetchImpl: f })).toBeNull();
  });
});

describe('挑哪条邀请弹', () => {
  it('过期的、弹过的不弹；先到期的先弹', () => {
    const list = [inv('a', 500), inv('b', 300), inv('c', 100), inv('d', 400)];
    expect(pickInvite(list, 200, new Set())?.id).toBe('b');
    expect(pickInvite(list, 200, new Set(['b']))?.id).toBe('d');
    expect(pickInvite(list, 500, new Set())).toBeNull();
  });

  it('我已经在那个房间里就不弹', () => {
    const list = [inv('a', 500)];
    expect(pickInvite(list, 0, new Set(), { place: 'room', game: 'cards', room: 'ABC123' })).toBeNull();
    expect(pickInvite(list, 0, new Set(), { place: 'room', game: 'cards', room: 'XYZ999' })?.id).toBe('a');
    expect(pickInvite(list, 0, new Set(), { place: 'game', game: 'cards' })?.id).toBe('a');
  });

  it('跳转地址和那句话', () => {
    expect(inviteUrl({ game: 'cards', room: 'ABC123' })).toBe('/games/cards/?room=ABC123');
    const names = (id: string): string | undefined => ({ cards: '打牌' })[id];
    expect(inviteText(inv('a', 0), names)).toBe('老王叫你来打牌');
    expect(inviteText(inv('a', 0, { game: 'other' }), names)).toBe('老王叫你一起玩');
    expect(inviteText(inv('a', 0, { from: { id: 'u', name: '名'.repeat(30) } }))).toBe(`${'名'.repeat(12)}叫你一起玩`);
  });

  it('过期时间：数字、数字串、ISO', () => {
    expect(untilOf(5)).toBe(5);
    expect(untilOf('123')).toBe(123);
    expect(untilOf('2026-10-16T00:00:00Z')).toBe(Date.parse('2026-10-16T00:00:00Z'));
    expect(untilOf(null)).toBeNaN();
  });

  it('没有页面（房间、Node）时不挂，也不发请求', async () => {
    const { f, calls } = fake(json({ user: { id: 'u1' } }));
    expect(await mountSocial({ where: () => null, fetchImpl: f })).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
