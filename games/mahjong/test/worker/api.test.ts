/**
 * Worker 这一层（DESIGN.md 第 4 节）：登录闸门带 next、单机带入结回的 CSRF / 登录 / 请求体检查、转给平台钱包（client 模式）、小结原样转发。
 * 平台的 /api/me 和钱包都换成假的（只在这个文件里），直接调 Worker 的 fetch；跑在 workerd 里（vitest.worker.config.ts），
 * 因为 Worker 引用了 kit 的房间（cloudflare:workers），Node 里加载不了。真的房间和钱包见 room.test.ts。
 */
import { describe, expect, it } from 'vitest';
import worker, { type Env, type PlatformWallet } from '../../worker/main.ts';

const SITE = 'https://game.yyyu.org';
const BASE = `${SITE}/games/mahjong`;

/** 假平台：cookie 里 __Host-sid=<id> 就认作这个人；anon 是没登录（清 cookie），bad 是平台挂了 */
const arcade = {
  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const req = new Request(input, init);
    const sid = /__Host-sid=([^;]+)/.exec(req.headers.get('cookie') ?? '')?.[1];
    if (sid === 'bad') return new Response('down', { status: 503 });
    if (sid === 'anon') return Response.json({ user: null }, { headers: { 'set-cookie': '__Host-sid=; Max-Age=0; Path=/' } });
    return Response.json({ user: { id: sid, displayName: `玩家${sid}` } });
  },
} as unknown as Fetcher;

function fakeWallet(): PlatformWallet & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    async buyin(req) {
      calls.push({ t: 'buyin', ...req });
      return req.amount > 10_000 ? { ok: false, error: 'no_funds', wallet: { balance: 5 } } : { ok: true, wallet: { balance: 1 } };
    },
    async settle(req) {
      calls.push({ t: 'settle', ...req });
      return { ok: true, credited: req.amount };
    },
  };
}

function env(patch: Partial<Env> = {}): Env & { WALLET: ReturnType<typeof fakeWallet> } {
  return {
    ASSETS: { fetch: async () => new Response('mahjong page') } as unknown as Fetcher,
    ARCADE: arcade,
    WALLET: fakeWallet(),
    SITE_ORIGIN: SITE,
    GATE: 'login',
    ...patch,
  } as Env & { WALLET: ReturnType<typeof fakeWallet> };
}

const call = (path: string, e: Env, init: RequestInit = {}): Promise<Response> =>
  worker.fetch(new Request(`${BASE}${path}`, { redirect: 'manual', ...init }) as never, e);

/** 浏览器发字符串请求体总带 content-length（Worker 靠它先挡大请求体），这里照样带上 */
const post = (path: string, e: Env, body: unknown, sid: string | null = 'u1', headers: Record<string, string> = {}): Promise<Response> => {
  const text = JSON.stringify(body);
  return call(path, e, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'content-length': String(new TextEncoder().encode(text).byteLength),
      'x-arcade': '1',
      origin: SITE,
      ...(sid ? { cookie: `__Host-sid=${sid}` } : {}),
      ...headers,
    },
    body: text,
  });
};

describe('登录闸门', () => {
  it('没有结尾斜杠 301 到带斜杠的（查询参数带上）', async () => {
    const res = await call('?room=123456', env());
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe(`${BASE}/?room=123456`);
  });

  it('登录了放行，不缓存', async () => {
    const res = await call('/', env(), { headers: { cookie: '__Host-sid=u1' } });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('mahjong page');
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('没登录 302 到 /login?next=原路径和查询（房间码登录完带回来）；会话失效的清 cookie 带回去', async () => {
    const res = await call('/?room=123456', env());
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(`/login?next=${encodeURIComponent('/games/mahjong/?room=123456')}`);
    const anon = await call('/index.html', env(), { headers: { cookie: '__Host-sid=anon' } });
    expect(anon.status).toBe(302);
    expect(anon.headers.get('location')).toBe(`/login?next=${encodeURIComponent('/games/mahjong/index.html')}`);
    expect(anon.headers.getSetCookie().length).toBe(1);
  });

  it('平台不可用 503（fail-closed）；GATE=off 不问平台', async () => {
    expect((await call('/', env(), { headers: { cookie: '__Host-sid=bad' } })).status).toBe(503);
    expect((await call('/', env({ ARCADE: undefined }), { headers: { cookie: '__Host-sid=u1' } })).status).toBe(503);
    expect((await call('/', env({ GATE: 'off' }))).status).toBe(200);
  });
});

describe('单机带入、结回', () => {
  const buy = { op: 'op-000001', session: 'session-0001', stakes: 'small', amount: 2_000 };

  it('带入：client 模式、按档位、24 小时到期，转给平台钱包', async () => {
    const e = env();
    const res = await post('/api/stake/buyin', e, buy);
    expect(res.status).toBe(200);
    expect(e.WALLET.calls).toEqual([
      expect.objectContaining({ t: 'buyin', userId: 'u1', game: 'mahjong', ref: 'session-0001', mode: 'client', op: 'op-000001', tier: 'small', amount: 2_000 }),
    ]);
  });

  it('钱包不够一份可以少带（数由平台判）；被拒按状态码回、带上钱包', async () => {
    const e = env();
    expect((await post('/api/stake/buyin', e, { ...buy, amount: 500 })).status).toBe(200);
    const res = await post('/api/stake/buyin', e, { ...buy, amount: 20_000 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, error: 'no_funds', wallet: { balance: 5 } });
  });

  it('结回：小结原样转发，不改不补', async () => {
    const e = env();
    const stats = { rounds: 8, wins: 3, best: 400, titles: ['xz_qing'], max: { xz_fan: 2 }, sum: { xz_gang: 1, xz_zimo: 1 }, extra: 'x' };
    const res = await post('/api/stake/settle', e, { op: 'op-000002', session: 'session-0001', amount: 2_400, stats });
    expect(res.status).toBe(200);
    expect(e.WALLET.calls).toEqual([expect.objectContaining({ t: 'settle', amount: 2_400, stats, mode: 'client', game: 'mahjong' })]);
  });

  it('CSRF、登录、请求体：不合格的不碰钱包', async () => {
    const e = env();
    expect((await post('/api/stake/buyin', e, buy, 'u1', { 'x-arcade': '' })).status).toBe(403);
    expect((await post('/api/stake/buyin', e, buy, 'u1', { origin: 'https://evil.example' })).status).toBe(403);
    expect((await post('/api/stake/buyin', e, buy, null)).status).toBe(401);
    expect((await post('/api/stake/buyin', e, { ...buy, stakes: 'fun' })).status).toBe(400);
    expect((await post('/api/stake/buyin', e, { ...buy, op: 'x' })).status).toBe(400);
    expect((await post('/api/stake/buyin', e, { ...buy, amount: -1 })).status).toBe(400);
    expect((await post('/api/stake/settle', e, { ...buy, stats: 'x'.repeat(2_000) })).status).toBe(400);
    expect((await post('/api/stake/refund', e, buy)).status).toBe(404);
    expect((await call('/api/stake/buyin', e)).status).toBe(405);
    expect(e.WALLET.calls).toEqual([]);
  });

  it('连不上平台钱包：503，页面留着操作号重发', async () => {
    const e = env();
    e.WALLET.buyin = async () => {
      throw new Error('down');
    };
    expect((await post('/api/stake/buyin', e, buy)).status).toBe(503);
  });
});
