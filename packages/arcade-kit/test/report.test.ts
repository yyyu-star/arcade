/**
 * 浏览器错误上报：测试跑在 workerd 里没有 DOM，手工替身 window / navigator / location。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reportErrors } from '../src/report.ts';

type Fn = (e: unknown) => void;
let handlers: Record<string, Set<Fn>>;
let beacon: ReturnType<typeof vi.fn>;

const fire = (type: string, e: unknown): void => handlers[type]?.forEach((h) => h(e));
const err = (e: Error): unknown => ({ message: e.message, error: e });
const bodyOf = async (i = 0): Promise<Record<string, string>> =>
  JSON.parse(await (beacon.mock.calls[i]![1] as Blob).text()) as Record<string, string>;

beforeEach(() => {
  handlers = { error: new Set(), unhandledrejection: new Set() };
  beacon = vi.fn(() => true);
  vi.stubGlobal('window', {
    addEventListener: (t: string, h: Fn) => handlers[t]!.add(h),
    removeEventListener: (t: string, h: Fn) => handlers[t]!.delete(h),
  });
  vi.stubGlobal('navigator', { sendBeacon: beacon });
  vi.stubGlobal('location', { pathname: '/games/x/', search: '?room=ABCD', hash: '#me' });
});
afterEach(() => vi.unstubAllGlobals());

const opts = { game: 'x', version: '1.2.3' };

describe('reportErrors', () => {
  it('发 game、ver、msg、stack、path，path 不带 query 和 hash', async () => {
    reportErrors(opts);
    fire('error', err(new Error('boom')));
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(beacon.mock.calls[0]![0]).toBe('/api/client-error');
    const b = await bodyOf();
    expect(b).toMatchObject({ game: 'x', ver: '1.2.3', msg: 'boom', path: '/games/x/' });
    expect(Object.keys(b).sort()).toEqual(['game', 'msg', 'path', 'stack', 'ver']);
  });

  it('unhandledrejection：Error 和非 Error 都报', async () => {
    reportErrors({ ...opts, endpoint: '/e' });
    fire('unhandledrejection', { reason: new Error('r1') });
    fire('unhandledrejection', { reason: 'plain' });
    expect(beacon.mock.calls[0]![0]).toBe('/e');
    expect((await bodyOf(0)).msg).toBe('r1');
    expect((await bodyOf(1)).msg).toBe('plain');
  });

  it('msg 截 200、stack 截 1000', async () => {
    reportErrors(opts);
    const e = new Error('m'.repeat(500));
    e.stack = 's'.repeat(3000);
    fire('error', err(e));
    const b = await bodyOf();
    expect(b.msg).toHaveLength(200);
    expect(b.stack).toHaveLength(1000);
  });

  it('同签名（前 80 字）只报一次', () => {
    reportErrors(opts);
    const head = 'a'.repeat(80);
    fire('error', err(new Error(head + '1')));
    fire('error', err(new Error(head + '2')));
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it('一页最多 5 条', () => {
    reportErrors(opts);
    for (let i = 0; i < 10; i++) fire('error', err(new Error(`e${i}`)));
    expect(beacon).toHaveBeenCalledTimes(5);
  });

  it('Script error. 不报', () => {
    reportErrors(opts);
    fire('error', { message: 'Script error.', error: null });
    expect(beacon).not.toHaveBeenCalled();
  });

  it('扩展脚本的报错不报', () => {
    reportErrors(opts);
    for (const u of ['chrome-extension://abc/x.js', 'moz-extension://abc/x.js']) {
      const e = new Error('ext ' + u);
      e.stack = `Error\n    at ${u}:1:1`;
      fire('error', err(e));
    }
    expect(beacon).not.toHaveBeenCalled();
  });

  it('卸载后不再报', () => {
    const off = reportErrors(opts);
    off();
    fire('error', err(new Error('late')));
    expect(beacon).not.toHaveBeenCalled();
  });

  it('没有 sendBeacon 时退回 fetch（keepalive、同源凭证），失败吞掉', () => {
    vi.stubGlobal('navigator', {});
    const f = vi.fn((_u: string, _i: RequestInit) => Promise.reject(new Error("net")));
    vi.stubGlobal('fetch', f);
    reportErrors(opts);
    fire('error', err(new Error('x')));
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]![1]).toMatchObject({ method: 'POST', keepalive: true, credentials: 'same-origin' });
  });

  it('sendBeacon 抛错也不外泄', () => {
    beacon.mockImplementation(() => { throw new Error('no'); });
    reportErrors(opts);
    expect(() => fire('error', err(new Error('y')))).not.toThrow();
  });

  it('没有 window 时返回空函数', () => {
    vi.unstubAllGlobals();
    const off = reportErrors(opts);
    expect(() => off()).not.toThrow();
  });
});
