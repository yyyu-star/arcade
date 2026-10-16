import { describe, expect, it } from 'vitest';
import { createCloud, emptyStats, mergeStats, parseStats, type Stats } from '../src/net/cloud.ts';
import { KEYS } from '../src/store.ts';

type Handler = (req: Req) => Response | Promise<Response> | 'offline';
interface Req {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
  keepalive: boolean;
  headers: Record<string, string>;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const me = (id: string | null, saves = 'ok'): Response =>
  json(200, { user: id === null ? null : { id, username: id }, service: 'ok', saves, registration: 'closed' });
const saves = (rows: { rev: number; data: unknown }[] = []): Response =>
  json(200, { saves: rows.map((r) => ({ slot: 'stats', rev: r.rev, updatedAt: 1, data: r.data })) });
const ok = (rev: number): Response => json(200, { rev, updatedAt: 1 });

const S = (p: Partial<Stats> = {}): Stats => ({ ...emptyStats(), ...p });

/** 假环境：fetch 按"方法 路径"取排队的回应（最后一个重复用），定时器按假时钟跑 */
function env(opts: { hint?: boolean; store?: Record<string, string> } = {}) {
  let t = 1_000_000_000;
  const store = new Map(Object.entries(opts.store ?? {}));
  let failWrites = false;
  const routes = new Map<string, Handler[]>();
  const calls: Req[] = [];
  const timers = new Map<number, { at: number; fn: () => void }>();
  let nextId = 1;
  let hint = opts.hint ?? true;

  const route = (key: string, ...hs: (Handler | Response)[]): void => {
    routes.set(key, hs.map((h) => (h instanceof Response ? () => h.clone() : h)));
  };
  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const req: Req = {
      method,
      url,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      keepalive: init?.keepalive === true,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(req);
    const key = `${method} ${url.split('?')[0]}`;
    const q = routes.get(key);
    if (!q || q.length === 0) throw new TypeError(`没有路由 ${key}`);
    const h = q.length > 1 ? q.shift()! : q[0]!;
    const res = await h(req);
    if (res === 'offline') throw new TypeError('Failed to fetch');
    return res;
  }) as typeof globalThis.fetch;

  const storage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (failWrites) throw new DOMException('quota', 'QuotaExceededError');
      store.set(k, v);
    },
    removeItem: (k: string) => void store.delete(k),
  };

  const cloud = createCloud({
    fetch,
    storage,
    now: () => t,
    loggedInHint: () => hint,
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimeout: (h) => void timers.delete(h as number),
  });

  const idle = async (): Promise<void> => {
    for (let i = 0; i < 30; i++) await new Promise((r) => setImmediate(r));
  };
  /** 往前走 ms，到点的定时器依次触发 */
  const advance = async (ms: number): Promise<void> => {
    const end = t + ms;
    for (;;) {
      const due = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      t = Math.max(t, due[1].at);
      due[1].fn();
      await idle();
    }
    t = end;
    await idle();
  };
  const puts = (): Req[] => calls.filter((c) => c.method === 'PUT');
  const read = (k: string): unknown => (store.has(k) ? JSON.parse(store.get(k)!) : undefined);

  return {
    cloud,
    store,
    calls,
    route,
    puts,
    read,
    idle,
    advance,
    timers,
    setHint: (v: boolean) => void (hint = v),
    failWrites: (v: boolean) => void (failWrites = v),
    tick: (ms: number) => void (t += ms),
    now: () => t,
  };
}

const meta = (userId: string | null, rev = 0, dirty = false, lastPut = 0): string => JSON.stringify({ userId, rev, dirty, lastPut });

describe('战绩的数据和合并', () => {
  it('计数和最大值取大，布尔取或', () => {
    expect(mergeStats(S({ hands: 5, won: 1, best: 9, tips: true }), S({ hands: 3, won: 2, biggestPot: 40 }))).toEqual(
      S({ hands: 5, won: 2, best: 9, biggestPot: 40, tips: true }),
    );
  });

  it('坏数据不收：缺字段、类型不对、负数、非整数、版本不对', () => {
    expect(parseStats(S({ hands: 3 }))).toEqual(S({ hands: 3 }));
    const { hands: _, ...noHands } = S();
    for (const bad of [null, 1, 'x', [], noHands, { ...S(), won: -1 }, { ...S(), best: 1.5 }, { ...S(), hands: '3' }, { ...S(), tips: 1 }, { ...S(), v: 2 }, { ...S(), showdowns: Number.MAX_SAFE_INTEGER + 2 }])
      expect(parseStats(bad)).toBeNull();
  });

  it('本地坏数据按空档，不报错', () => {
    const e = env({ hint: false, store: { [KEYS.stats]: '{"v":1,"hands":-3}', [KEYS.meta]: 'not json' } });
    expect(e.cloud.stats()).toEqual(emptyStats());
  });
});

describe('启动', () => {
  it('没有提示 cookie 一个请求都不发', async () => {
    const e = env({ hint: false });
    await e.cloud.start();
    e.cloud.update((s) => ({ ...s, hands: s.hands + 1 }));
    e.cloud.flush();
    await e.cloud.recheck();
    await e.advance(3_600_000);
    expect(e.calls).toEqual([]);
    expect(e.cloud.state()).toBe('anon');
    expect(e.cloud.stats().hands).toBe(1);
    expect(e.read(KEYS.stats)).toEqual(S({ hands: 1 }));
  });

  it('user 为 null、401 都按没登录', async () => {
    for (const r of [me(null), json(401, { error: 'unauthorized', message: '' })]) {
      const e = env();
      e.route('GET /api/me', r);
      await e.cloud.start();
      expect(e.cloud.state()).toBe('anon');
      expect(e.calls.map((c) => c.url)).toEqual(['/api/me']);
    }
  });

  it('首次登录：本机数据合并进账号，备份 pre-sync，带 userId 上传', async () => {
    const e = env({ store: { [KEYS.stats]: JSON.stringify(S({ hands: 10, won: 4, tips: true })) } });
    e.route('GET /api/me', me('u1'));
    e.route('GET /api/saves/texas', saves([{ rev: 3, data: S({ hands: 7, won: 5, biggestPot: 80 }) }]));
    e.route('PUT /api/saves/texas/stats', ok(4));
    await e.cloud.start();
    expect(e.calls[1]!.url).toBe('/api/saves/texas?userId=u1');
    const merged = S({ hands: 10, won: 5, biggestPot: 80, tips: true });
    expect(e.cloud.stats()).toEqual(merged);
    expect(e.read(KEYS.preSync)).toEqual(S({ hands: 10, won: 4, tips: true }));
    expect(e.read(KEYS.meta)).toMatchObject({ userId: 'u1', rev: 3, dirty: true });
    expect(e.cloud.state()).toBe('pending');
    expect(e.cloud.userId()).toBe('u1');

    await e.advance(10_000);
    const [p] = e.puts();
    expect(p!.body).toEqual({ baseRev: 3, data: merged, userId: 'u1' });
    expect(p!.headers).toMatchObject({ 'X-Arcade': '1', 'content-type': 'application/json' });
    expect(p!.keepalive).toBe(false);
    expect(e.read(KEYS.meta)).toMatchObject({ rev: 4, dirty: false });
    expect(e.cloud.state()).toBe('merged');
  });

  it('首次登录、本地是空档：不上传', async () => {
    const e = env();
    e.route('GET /api/me', me('u1'));
    e.route('GET /api/saves/texas', saves());
    await e.cloud.start();
    await e.advance(3_600_000);
    expect(e.puts()).toEqual([]);
    expect(e.cloud.state()).toBe('synced');
    expect(e.read(KEYS.meta)).toMatchObject({ userId: 'u1', rev: 0, dirty: false });
  });

  it('云端坏数据按空档，本地的照样传上去', async () => {
    const e = env({ store: { [KEYS.stats]: JSON.stringify(S({ hands: 2 })), [KEYS.meta]: meta('u1', 1) } });
    e.route('GET /api/me', me('u1'));
    e.route('GET /api/saves/texas', saves([{ rev: 5, data: { v: 1, hands: 'lots' } }]));
    e.route('PUT /api/saves/texas/stats', ok(6));
    await e.cloud.start();
    expect(e.cloud.stats()).toEqual(S({ hands: 2 }));
    await e.advance(10_000);
    expect(e.puts()[0]!.body).toMatchObject({ baseRev: 5 });
  });

  it('/api/me 说存档暂停：本次不拉取', async () => {
    const e = env();
    e.route('GET /api/me', me('u1', 'paused'));
    await e.cloud.start();
    expect(e.cloud.state()).toBe('paused');
    expect(e.cloud.note()).not.toBeNull();
    expect(e.calls.length).toBe(1);
  });
});

/** 已登录 u1、拉取完、云端 rev 1 的环境 */
async function synced(store: Record<string, string> = {}) {
  const e = env({ store: { [KEYS.meta]: meta('u1', 1), [KEYS.stats]: JSON.stringify(S({ hands: 1 })), ...store } });
  e.route('GET /api/me', me('u1'));
  e.route('GET /api/saves/texas', saves([{ rev: 1, data: S({ hands: 1 }) }]));
  await e.cloud.start();
  expect(e.cloud.state()).toBe('synced');
  return e;
}
const play = (e: { cloud: { update(fn: (s: Stats) => Stats): void } }): void =>
  e.cloud.update((s) => ({ ...s, hands: s.hands + 1 }));

describe('上传节奏', () => {
  it('10 秒防抖：一直在改就一直往后推', async () => {
    const e = await synced();
    e.route('PUT /api/saves/texas/stats', ok(2), ok(3));
    play(e);
    expect(e.cloud.state()).toBe('pending');
    expect(e.read(KEYS.stats)).toEqual(S({ hands: 2 }));
    await e.advance(9_000);
    play(e);
    await e.advance(9_000);
    expect(e.puts().length).toBe(0);
    await e.advance(1_000);
    expect(e.puts().length).toBe(1);
    expect(e.puts()[0]!.body).toMatchObject({ baseRev: 1, data: S({ hands: 3 }) });
    expect(e.cloud.state()).toBe('synced');
  });

  it('同一槽两次上传至少隔 5 分钟', async () => {
    const e = await synced();
    e.route('PUT /api/saves/texas/stats', ok(2), ok(3));
    play(e);
    await e.advance(10_000);
    const first = e.now();
    play(e);
    await e.advance(4 * 60_000);
    expect(e.puts().length).toBe(1);
    await e.advance(60_000);
    expect(e.puts().length).toBe(2);
    expect(e.now() - first).toBeGreaterThanOrEqual(5 * 60_000);
    expect(e.puts()[1]!.body).toMatchObject({ baseRev: 2 });
  });

  it('间隔跨页面打开也算（存在元数据里）', async () => {
    const e = env({ store: { [KEYS.meta]: meta('u1', 1, true, 1_000_000_000 - 60_000), [KEYS.stats]: JSON.stringify(S({ hands: 2 })) } });
    e.route('GET /api/me', me('u1'));
    e.route('GET /api/saves/texas', saves([{ rev: 1, data: S({ hands: 1 }) }]));
    e.route('PUT /api/saves/texas/stats', ok(2));
    await e.cloud.start();
    await e.advance(3 * 60_000);
    expect(e.puts().length).toBe(0);
    await e.advance(60_000);
    expect(e.puts().length).toBe(1);
  });

  it('上传在途时又改了：成功后还是待上传', async () => {
    const e = await synced();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = async (): Promise<Response> => {
      await gate;
      return ok(2);
    };
    e.route('PUT /api/saves/texas/stats', () => slow());
    play(e);
    await e.advance(10_000);
    expect(e.cloud.state()).toBe('syncing');
    play(e);
    release();
    await e.idle();
    expect(e.read(KEYS.meta)).toMatchObject({ rev: 2, dirty: true });
    expect(e.cloud.state()).toBe('pending');
  });
});

describe('409', () => {
  it('conflict：备份、合并、用 current.rev 重交，只重交一次', async () => {
    const e = await synced();
    const conflict = (rev: number, data: Stats) => json(409, { error: 'conflict', message: '', current: { rev, updatedAt: 1, data } });
    e.route('PUT /api/saves/texas/stats', conflict(5, S({ hands: 1, won: 9 })), conflict(6, S({ hands: 1, won: 9, best: 77 })), ok(9));
    play(e);
    await e.advance(10_000);
    const ps = e.puts();
    expect(ps.length).toBe(2);
    expect(ps[1]!.body).toEqual({ baseRev: 5, data: S({ hands: 2, won: 9 }), userId: 'u1' });
    expect(e.read(KEYS.preSync)).toEqual(S({ hands: 2, won: 9 }));
    expect(e.cloud.stats()).toEqual(S({ hands: 2, won: 9, best: 77 }));
    expect(e.read(KEYS.meta)).toMatchObject({ rev: 6, dirty: true });
    expect(e.cloud.state()).toBe('pending');
    // 剩下的按正常节奏：5 分钟后再传
    await e.advance(4 * 60_000);
    expect(e.puts().length).toBe(2);
    await e.advance(60_000);
    expect(e.puts().length).toBe(3);
    expect(e.puts()[2]!.body).toMatchObject({ baseRev: 6 });
    expect(e.cloud.state()).toBe('merged');
  });

  it('conflict 的 current 为 null：用 0 重交', async () => {
    const e = await synced();
    e.route('PUT /api/saves/texas/stats', json(409, { error: 'conflict', message: '', current: null }), ok(1));
    play(e);
    await e.advance(10_000);
    expect(e.puts().map((p) => p.body!.baseRev)).toEqual([1, 0]);
    expect(e.cloud.state()).toBe('synced');
  });

  it('wrong_user：备份 pre-switch、本地清空、不上传旧数据，再问身份拉新号', async () => {
    const e = await synced();
    e.route('PUT /api/saves/texas/stats', json(409, { error: 'wrong_user', message: '账号换过了，刷新一下页面' }));
    play(e);
    e.route('GET /api/me', me('u2'));
    e.route('GET /api/saves/texas', saves([{ rev: 4, data: S({ hands: 50 }) }]));
    await e.advance(10_000);
    expect(e.read(KEYS.preSwitch('u1'))).toEqual(S({ hands: 2 }));
    expect(e.puts().length).toBe(1);
    expect(e.calls.at(-1)!.url).toBe('/api/saves/texas?userId=u2');
    expect(e.cloud.userId()).toBe('u2');
    expect(e.cloud.stats()).toEqual(S({ hands: 50 }));
    expect(e.read(KEYS.meta)).toMatchObject({ userId: 'u2', rev: 4, dirty: false });
    await e.advance(3_600_000);
    expect(e.puts().length).toBe(1);
  });

  it('wrong_user 后问不到身份：本地已是空档、元数据 userId 为 null，数据不会传给谁', async () => {
    const e = await synced();
    e.route('PUT /api/saves/texas/stats', json(409, { error: 'wrong_user', message: '' }));
    e.route('GET /api/me', () => 'offline');
    play(e);
    await e.advance(10_000);
    expect(e.read(KEYS.meta)).toMatchObject({ userId: null, rev: 0, dirty: false });
    expect(e.read(KEYS.stats)).toEqual(emptyStats());
    expect(e.cloud.state()).toBe('pending');
    expect(e.cloud.note()).not.toBeNull();
  });
});

describe('换号', () => {
  it('/api/me 换了人：备份旧号、清空、拉新号，不合并不上传', async () => {
    const e = env({ store: { [KEYS.meta]: meta('u1', 3, true), [KEYS.stats]: JSON.stringify(S({ hands: 9 })) } });
    e.route('GET /api/me', me('u2'));
    e.route('GET /api/saves/texas', saves([{ rev: 2, data: S({ hands: 4 }) }]));
    await e.cloud.start();
    expect(e.read(KEYS.preSwitch('u1'))).toEqual(S({ hands: 9 }));
    expect(e.cloud.stats()).toEqual(S({ hands: 4 }));
    expect(e.read(KEYS.meta)).toMatchObject({ userId: 'u2', rev: 2, dirty: false });
    await e.advance(3_600_000);
    expect(e.puts()).toEqual([]);
  });

  it('已有同名备份：先合并再写，备份只会变多', async () => {
    const e = env({
      store: { [KEYS.meta]: meta('u1', 3), [KEYS.stats]: JSON.stringify(S({ hands: 2 })), [KEYS.preSwitch('u1')]: JSON.stringify(S({ won: 7 })) },
    });
    e.route('GET /api/me', me('u2'));
    e.route('GET /api/saves/texas', saves());
    await e.cloud.start();
    expect(e.read(KEYS.preSwitch('u1'))).toEqual(S({ hands: 2, won: 7 }));
  });

  it('换回旧号：pre-switch 并回、上传，成功后改名 .restored，下次不再并', async () => {
    const e = env({
      store: { [KEYS.meta]: meta('u2', 1), [KEYS.stats]: JSON.stringify(S({ hands: 1 })), [KEYS.preSwitch('u1')]: JSON.stringify(S({ hands: 9, won: 3 })) },
    });
    e.route('GET /api/me', me('u1'));
    e.route('GET /api/saves/texas', saves([{ rev: 5, data: S({ hands: 6, won: 1, biggestPot: 20 }) }]));
    e.route('PUT /api/saves/texas/stats', ok(6));
    await e.cloud.start();
    // u2 的本地数据进 u2 的备份，u1 的备份并回
    expect(e.read(KEYS.preSwitch('u2'))).toEqual(S({ hands: 1 }));
    expect(e.cloud.stats()).toEqual(S({ hands: 9, won: 3, biggestPot: 20 }));
    expect(e.cloud.state()).toBe('pending');
    expect(e.read(KEYS.preSwitch('u1'))).toBeDefined();
    await e.advance(10_000);
    expect(e.puts()[0]!.body).toEqual({ baseRev: 5, data: S({ hands: 9, won: 3, biggestPot: 20 }), userId: 'u1' });
    expect(e.read(KEYS.preSwitch('u1'))).toBeUndefined();
    expect(e.read(`${KEYS.preSwitch('u1')}.restored`)).toEqual(S({ hands: 9, won: 3 }));
  });

  it('换回旧号、云端已经包含备份：不用上传，当场改名', async () => {
    const e = env({
      store: { [KEYS.meta]: meta('u1', 1), [KEYS.stats]: JSON.stringify(S()), [KEYS.preSwitch('u1')]: JSON.stringify(S({ hands: 3 })) },
    });
    e.route('GET /api/me', me('u1'));
    e.route('GET /api/saves/texas', saves([{ rev: 2, data: S({ hands: 5 }) }]));
    await e.cloud.start();
    expect(e.puts()).toEqual([]);
    expect(e.read(KEYS.preSwitch('u1'))).toBeUndefined();
    expect(e.read(`${KEYS.preSwitch('u1')}.restored`)).toEqual(S({ hands: 3 }));
  });

  it('上传失败时不改名，下次打开再并', async () => {
    const e = env({
      store: { [KEYS.meta]: meta('u1', 1), [KEYS.stats]: JSON.stringify(S()), [KEYS.preSwitch('u1')]: JSON.stringify(S({ hands: 9 })) },
    });
    e.route('GET /api/me', me('u1'));
    e.route('GET /api/saves/texas', saves([{ rev: 1, data: S({ hands: 1 }) }]));
    e.route('PUT /api/saves/texas/stats', () => 'offline');
    await e.cloud.start();
    await e.advance(10_000);
    expect(e.read(KEYS.preSwitch('u1'))).toEqual(S({ hands: 9 }));
    expect(e.read(`${KEYS.preSwitch('u1')}.restored`)).toBeUndefined();
  });

  it('同一个账号退出再登录：退出期间的照常补传', async () => {
    const e = env({ store: { [KEYS.meta]: meta('u1', 2, true), [KEYS.stats]: JSON.stringify(S({ hands: 8 })) } });
    e.route('GET /api/me', me('u1'));
    e.route('GET /api/saves/texas', saves([{ rev: 2, data: S({ hands: 5 }) }]));
    e.route('PUT /api/saves/texas/stats', ok(3));
    await e.cloud.start();
    expect(e.read(KEYS.preSwitch('u1'))).toBeUndefined();
    await e.advance(10_000);
    expect(e.puts()[0]!.body).toMatchObject({ baseRev: 2, data: S({ hands: 8 }) });
  });

  it('存储满了：备份写不进去就什么都不清、不拉新号、元数据保持旧号，暂停', async () => {
    const e = env({ store: { [KEYS.meta]: meta('u1', 3, true), [KEYS.stats]: JSON.stringify(S({ hands: 9 })) } });
    e.route('GET /api/me', me('u2'));
    e.route('GET /api/saves/texas', saves([{ rev: 2, data: S({ hands: 4 }) }]));
    e.failWrites(true);
    await e.cloud.start();
    expect(e.cloud.state()).toBe('paused');
    expect(e.cloud.note()).toContain('存储满了');
    expect(e.read(KEYS.stats)).toEqual(S({ hands: 9 }));
    expect(e.read(KEYS.meta)).toMatchObject({ userId: 'u1', rev: 3, dirty: true });
    expect(e.calls.map((c) => c.url)).toEqual(['/api/me']);
  });

  it('别的标签页已经换过号：只跟上，不把新号的数据备份成旧号的', async () => {
    const e = await synced();
    // 另一页换成 u2 并拉下了 u2 的数据，事件还没到这页
    e.store.set(KEYS.meta, meta('u2', 4));
    e.store.set(KEYS.stats, JSON.stringify(S({ hands: 40 })));
    e.route('GET /api/me', me('u2'));
    e.route('GET /api/saves/texas', saves([{ rev: 4, data: S({ hands: 40 }) }]));
    e.tick(61_000);
    await e.cloud.recheck();
    expect(e.read(KEYS.preSwitch('u1'))).toBeUndefined();
    expect(e.read(KEYS.preSwitch('u2'))).toBeUndefined();
    expect(e.cloud.userId()).toBe('u2');
    expect(e.cloud.stats()).toEqual(S({ hands: 40 }));
  });
});

describe('其他回应', () => {
  it('429 按 retryAfter 等，之间的改动和切后台都不提前', async () => {
    const e = await synced();
    e.route('PUT /api/saves/texas/stats', json(429, { error: 'too_soon', message: '', retryAfter: 600 }), ok(2));
    play(e);
    await e.advance(10_000);
    expect(e.puts().length).toBe(1);
    play(e);
    e.tick(5 * 60_000);
    e.cloud.flush();
    await e.advance(4 * 60_000);
    expect(e.puts().length).toBe(1);
    await e.advance(60_000);
    expect(e.puts().length).toBe(2);
    expect(e.cloud.state()).toBe('synced');
  });

  it('429 没有 retryAfter 字段就看 Retry-After 头', async () => {
    const e = await synced();
    e.route('PUT /api/saves/texas/stats', json(429, { error: 'rate_limited', message: '' }, { 'Retry-After': '1200' }), ok(2));
    play(e);
    await e.advance(10_000);
    expect(e.cloud.note()).not.toBeNull();
    await e.advance(19 * 60_000);
    expect(e.puts().length).toBe(1);
    await e.advance(60_000);
    expect(e.puts().length).toBe(2);
  });

  it('503 busy：本次打开暂停', async () => {
    const e = await synced();
    e.route('PUT /api/saves/texas/stats', json(503, { error: 'busy', message: '' }));
    play(e);
    await e.advance(10_000);
    expect(e.cloud.state()).toBe('paused');
    play(e);
    e.cloud.flush();
    await e.advance(3_600_000);
    expect(e.puts().length).toBe(1);
    expect(e.read(KEYS.meta)).toMatchObject({ dirty: true });
  });

  it('/api/me 503 busy 也暂停', async () => {
    const e = env();
    e.route('GET /api/me', json(503, { error: 'busy', message: '' }));
    await e.cloud.start();
    expect(e.cloud.state()).toBe('paused');
  });

  it('401：当作已退出，不再上传', async () => {
    const e = await synced();
    e.route('PUT /api/saves/texas/stats', json(401, { error: 'unauthorized', message: '' }));
    play(e);
    await e.advance(10_000);
    expect(e.cloud.state()).toBe('anon');
    expect(e.cloud.userId()).toBeNull();
    play(e);
    await e.advance(3_600_000);
    expect(e.puts().length).toBe(1);
  });

  it('回来的不是 JSON、连不上：保留待上传，小红点，不显示未登录', async () => {
    const e = await synced();
    e.route('PUT /api/saves/texas/stats', new Response('<html>vite</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    play(e);
    await e.advance(10_000);
    expect(e.cloud.state()).toBe('pending');
    expect(e.cloud.note()).toContain('连不上');
    expect(e.read(KEYS.meta)).toMatchObject({ dirty: true, rev: 1 });

    const f = env();
    f.route('GET /api/me', () => 'offline');
    await f.cloud.start();
    expect(f.cloud.state()).toBe('pending');
    expect(f.cloud.note()).toContain('连不上');
  });

  it('413、400：这个槽本次不再传，给一句说明', async () => {
    for (const [status, error] of [[413, 'too_large'], [400, 'bad_request']] as const) {
      const e = await synced();
      e.route('PUT /api/saves/texas/stats', json(status, { error, message: '' }));
      play(e);
      await e.advance(10_000);
      play(e);
      e.tick(10 * 60_000);
      e.cloud.flush();
      await e.advance(3_600_000);
      expect(e.puts().length).toBe(1);
      expect(e.cloud.state()).toBe('paused');
      expect(e.cloud.note()).not.toBeNull();
    }
  });

  it('改战绩时存储写失败：暂停，不清空', async () => {
    const e = await synced();
    e.failWrites(true);
    play(e);
    expect(e.cloud.state()).toBe('paused');
    expect(e.cloud.note()).toContain('存储满了');
    expect(e.cloud.stats().hands).toBe(2);
    expect(e.read(KEYS.stats)).toEqual(S({ hands: 1 }));
    await e.advance(3_600_000);
    expect(e.puts()).toEqual([]);
  });
});

describe('切后台补传', () => {
  it('用 keepalive，同槽在途不重复发', async () => {
    const e = await synced();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    e.route('PUT /api/saves/texas/stats', () => gate.then(() => ok(2)));
    play(e);
    e.cloud.flush();
    e.cloud.flush();
    expect(e.puts().length).toBe(1);
    expect(e.puts()[0]!.keepalive).toBe(true);
    expect(e.puts()[0]!.body).toMatchObject({ userId: 'u1', baseRev: 1 });
    // 防抖的定时器已经撤掉，不会再发一份
    await e.advance(10_000);
    expect(e.puts().length).toBe(1);
    release();
    await e.idle();
    expect(e.cloud.state()).toBe('synced');
  });

  it('离上次上传太近（3 分钟内）不补', async () => {
    const e = await synced();
    e.route('PUT /api/saves/texas/stats', ok(2), ok(3));
    play(e);
    await e.advance(10_000);
    play(e);
    e.tick(2 * 60_000);
    e.cloud.flush();
    expect(e.puts().length).toBe(1);
    e.tick(60_000);
    e.cloud.flush();
    expect(e.puts().length).toBe(2);
  });

  it('没东西要传不发', async () => {
    const e = await synced();
    e.cloud.flush();
    expect(e.puts()).toEqual([]);
  });
});

describe('复查身份', () => {
  it('离上次尝试不到 1 分钟不问；超过才问，连不上也算一次', async () => {
    const e = await synced();
    e.route('GET /api/me', () => 'offline');
    const n = (): number => e.calls.filter((c) => c.url === '/api/me').length;
    e.tick(30_000);
    await e.cloud.recheck();
    expect(n()).toBe(1);
    e.tick(31_000);
    await e.cloud.recheck();
    expect(n()).toBe(2);
    await e.cloud.recheck();
    expect(n()).toBe(2);
  });

  it('提示 cookie 没了：当作退出，不发请求', async () => {
    const e = await synced();
    e.setHint(false);
    e.tick(120_000);
    await e.cloud.recheck();
    expect(e.cloud.state()).toBe('anon');
    expect(e.calls.length).toBe(2);
  });
});

describe('多个标签页', () => {
  it('元数据：rev 取大、待上传取并集', async () => {
    const e = await synced();
    e.route('PUT /api/saves/texas/stats', ok(8));
    e.cloud.onStorage({ key: KEYS.meta, newValue: meta('u1', 7, true) });
    expect(e.cloud.state()).toBe('pending');
    await e.advance(10_000);
    expect(e.puts()[0]!.body).toMatchObject({ baseRev: 7 });
  });

  it('那边换了号这边跟着换，数据以存盘的为准', async () => {
    const e = await synced();
    e.store.set(KEYS.stats, JSON.stringify(S({ hands: 33 })));
    e.route('GET /api/saves/texas', saves([{ rev: 2, data: S({ hands: 33 }) }]));
    e.cloud.onStorage({ key: KEYS.stats, newValue: JSON.stringify(S({ hands: 33 })) });
    e.cloud.onStorage({ key: KEYS.meta, newValue: meta('u2', 2) });
    await e.idle();
    expect(e.cloud.userId()).toBe('u2');
    expect(e.cloud.stats()).toEqual(S({ hands: 33 }));
    expect(e.calls.at(-1)!.url).toBe('/api/saves/texas?userId=u2');
    expect(e.read(KEYS.preSwitch('u1'))).toBeUndefined();
  });

  it('坏的战绩事件按空档', async () => {
    const e = await synced();
    e.cloud.onStorage({ key: KEYS.stats, newValue: '{"v":1}' });
    expect(e.cloud.stats()).toEqual(emptyStats());
  });
});

describe('onChange', () => {
  it('状态变了会通知，退订后不再通知', async () => {
    const e = env();
    e.route('GET /api/me', me(null));
    let n = 0;
    const off = e.cloud.onChange(() => n++);
    await e.cloud.start();
    expect(n).toBeGreaterThan(0);
    off();
    const m = n;
    play(e);
    expect(n).toBe(m);
  });
});
