/** 开房和默认文案（0.8.0，client.ts）：createRoom 把各种回话收成 { code } 或 { error }；文案按 key 可以覆盖 */
import { describe, expect, it } from 'vitest';
import { closeText, createRoom, createText, ROOM_TEXT } from '../src/client.ts';
import { CLOSE, CLOSE_REASON } from '../src/protocol.ts';

/** 假的 fetch：记下请求，回指定的响应 */
function fakeFetch(reply: () => Response) {
  const got: Request[] = [];
  const f = ((input: RequestInfo | URL, init?: RequestInit) => {
    got.push(new Request(new URL(String(input), 'https://game.example.com/games/x/'), init));
    return Promise.resolve(reply());
  }) as typeof fetch;
  return { f, got };
}

describe('createRoom', () => {
  it('POST { opts }，带 X-Arcade；成功回房间码', async () => {
    const { f, got } = fakeFetch(() => Response.json({ code: '123456' }, { status: 201 }));
    expect(await createRoom('rooms', { tier: 'small' }, f)).toEqual({ code: '123456' });
    expect(got[0]!.method).toBe('POST');
    expect(got[0]!.headers.get('x-arcade')).toBe('1');
    expect(await got[0]!.json()).toEqual({ opts: { tier: 'small' } });
  });

  it('失败：错误码原样（has_room 带那个房间的码）；401 当 login；不是 JSON 当 unavailable；网络断了是 offline', async () => {
    expect(await createRoom('rooms', null, fakeFetch(() => Response.json({ error: 'has_room', code: '654321' }, { status: 409 })).f)).toEqual({ error: 'has_room', code: '654321' });
    expect(await createRoom('rooms', null, fakeFetch(() => new Response('<html>', { status: 401 })).f)).toEqual({ error: 'login' });
    expect(await createRoom('rooms', null, fakeFetch(() => new Response('<html>', { status: 502 })).f)).toEqual({ error: 'unavailable' });
    expect(await createRoom('rooms', null, (() => Promise.reject(new TypeError('offline'))) as typeof fetch)).toEqual({ error: 'offline' });
  });
});

describe('默认文案', () => {
  it('开房失败：按错误码给话，不认识的按 unavailable；游戏按 key 换掉个别措辞', () => {
    expect(createText('daily_limit')).toBe(ROOM_TEXT.daily_limit);
    expect(createText('whatever')).toBe(ROOM_TEXT.unavailable);
    expect(createText('busy', { busy: '换一句' })).toBe('换一句');
    // 断开用的 key 不会被开房错误码碰到
    expect(createText('noRoom')).toBe(ROOM_TEXT.unavailable);
  });

  it('断开：按关闭码给话，4000 带 quota 单独一句，没列出的给 other；游戏按 key 覆盖', () => {
    expect(closeText(CLOSE.noRoom)).toBe(ROOM_TEXT.noRoom);
    expect(closeText(CLOSE.roomClosed)).toBe(ROOM_TEXT.roomClosed);
    expect(closeText(CLOSE.roomClosed, CLOSE_REASON.quota)).toBe(ROOM_TEXT.quota);
    expect(closeText(CLOSE.busy)).toBe(ROOM_TEXT.busy);
    expect(closeText(CLOSE.unauthorized)).toBe(ROOM_TEXT.unauthorized);
    expect(closeText(CLOSE.policy)).toBe(ROOM_TEXT.other);
    expect(closeText(1006)).toBe(ROOM_TEXT.other);
    expect(closeText(CLOSE.roomClosed, undefined, { roomClosed: '房间关了，桌上的结回去了' })).toBe('房间关了，桌上的结回去了');
  });
});
