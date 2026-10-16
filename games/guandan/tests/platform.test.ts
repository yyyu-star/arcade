/**
 * 单独部署时页面怎么降级（0.8.0，src/view/platform.ts）：/api/me 404 → 没有平台。不起浏览器：假的 localStorage 和 fetch。
 * platform.ts 的结果是模块级的（启动时问一次），这个文件只测"没有平台"这一面；有平台时什么都不变，由其余测试和冒烟管。
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createRoom, currentUserId } from '../src/view/net.ts';
import { GUEST_ID, detectOnce, lobbyName, lobbyUrl, standalone, withNick } from '../src/view/platform.ts';
import { KEYS, getNick, setNick } from '../src/view/store.ts';

const mem = new Map<string, string>();
const asked: string[] = [];

beforeAll(async () => {
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  });
  // 单独部署：同域没有 /api/me，静态资源回 404
  vi.stubGlobal('fetch', async (url: string) => {
    asked.push(url);
    return new Response('not found', { status: 404 });
  });
  await detectOnce();
});
afterAll(() => vi.unstubAllGlobals());

describe('单独部署（没有平台）', () => {
  it('/api/me 404 → 没有平台："大厅"变"首页"、回游戏自己的首页', () => {
    expect(asked).toEqual(['/api/me']);
    expect(standalone()).toBe(true);
    expect(lobbyUrl()).toBe('./');
    expect(lobbyName()).toBe('首页');
  });

  it('现在是谁：不问平台，同一个浏览器就是同一个游客（本机记着的房间都算他的）', async () => {
    const f = vi.fn();
    expect(await currentUserId(f as unknown as typeof fetch)).toBe(GUEST_ID);
    expect(f).not.toHaveBeenCalled();
  });

  it('昵称存在 guandan.nick，开房、进房的地址带上；清空就不带', async () => {
    expect(withNick('/games/guandan/room/rooms')).toBe('/games/guandan/room/rooms');
    setNick('阿花');
    expect(mem.get(KEYS.nick)).toBe(JSON.stringify('阿花'));
    expect(getNick()).toBe('阿花');
    expect(withNick('/games/guandan/room/rooms')).toBe(`/games/guandan/room/rooms?name=${encodeURIComponent('阿花')}`);
    const urls: string[] = [];
    await createRoom((async (url: string) => (urls.push(url), new Response(JSON.stringify({ code: '123456' }), { status: 201 }))) as unknown as typeof fetch);
    expect(urls).toEqual([`/games/guandan/room/rooms?name=${encodeURIComponent('阿花')}`]);
    setNick('');
    expect(mem.has(KEYS.nick)).toBe(false);
  });

  it('开房 401（浏览器没存住游客 cookie）：说刷新，不往登录页带', async () => {
    const r = await createRoom((async () => new Response('', { status: 401 })) as unknown as typeof fetch);
    expect(r).toEqual({ error: '认不出你是谁，刷新页面再试' });
  });
});
