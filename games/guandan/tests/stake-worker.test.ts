/**
 * 单机实盘的三个接口（worker/stake.ts）：假的平台（/api/me）和假的钱包 RPC，看 Worker 认人、拼 ref 和 op、查数、
 * 把钱包的回话原样带回，以及被拒、重复、到顶、没那一份这几种都不走样。
 */
import { describe, expect, it } from 'vitest';
import { handle, type Env, type Fetcher } from '../worker/gate.ts';
import type { WalletReply, WalletRpc } from '../worker/stake.ts';
import { SOLO_HOURS, WALLET_ID } from '../src/stake/index.ts';

const SITE = 'https://game.example.com';

type Call = { method: string; req: Record<string, unknown> };

/** 假钱包：记下每次调用，按 answer 回话 */
function wallet(answer: (method: string, req: Record<string, unknown>) => WalletReply | Promise<WalletReply>): WalletRpc & { calls: Call[] } {
  const calls: Call[] = [];
  const call = (method: string) => async (req: Record<string, unknown>) => {
    calls.push({ method, req });
    return answer(method, req);
  };
  return { calls, view: async () => ({ ok: true, wallet: { stakes: [] } }), buyin: call('buyin'), settle: call('settle'), refund: call('refund') } as WalletRpc & { calls: Call[] };
}

function arcade(user: { id: string; displayName: string } | null, status = 200): Fetcher {
  return {
    async fetch() {
      return new Response(JSON.stringify({ user }), { status, headers: { 'Content-Type': 'application/json', 'Set-Cookie': '__Host-sid=abc; Max-Age=60' } });
    },
  };
}

const assets: Fetcher = { fetch: async () => new Response('asset') };
const W = { balance: 8000, stakes: [] };

function env(w: WalletRpc | undefined, arc: Fetcher = arcade({ id: 'u1', displayName: '小王' })): Env {
  return { ASSETS: assets, ARCADE: arc, WALLET: w, GATE: 'login' };
}

/** 和浏览器的 fetch 一样带上 content-length（Node 的 Request 不会自己加） */
function post(action: string, body: unknown, headers: Record<string, string> = {}): Request {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request(`${SITE}/games/guandan/api/stake/${action}`, {
    method: 'POST',
    headers: { Origin: SITE, Cookie: '__Host-sid=abc', 'Content-Type': 'application/json', 'Content-Length': String(new TextEncoder().encode(text).length), ...headers },
    body: text,
  });
}

const REF = `solo-mid-${'ab'.repeat(16)}`;
/** 0.12.1 以前带入的旧 ref：没编档位 */
const OLD_REF = `solo-${'ab'.repeat(16)}`;

describe('带入', () => {
  it('认人后拼 ref 和 op，带入一份、client 模式、24 小时后到期；回话带上 ref、档位、一份、到期时间和钱包', async () => {
    const w = wallet(() => ({ ok: true, wallet: W }));
    const before = Date.now();
    const res = await handle(post('buyin', { tier: 'mid' }), env(w));
    expect(res.status).toBe(200);
    expect(res.headers.get('Set-Cookie')).toContain('__Host-sid');
    const body = (await res.json()) as Record<string, unknown>;
    expect(w.calls).toHaveLength(1);
    const { method, req } = w.calls[0]!;
    expect(method).toBe('buyin');
    expect(req).toMatchObject({ userId: 'u1', game: 'guandan', tier: 'mid', amount: 10_000, mode: 'client' });
    expect(req['ref']).toMatch(/^solo-mid-[0-9a-f]{32}$/);
    expect(req['op']).toBe(`${req['ref']}-in`);
    expect(req['op']).toMatch(WALLET_ID);
    expect(req['until']).toBeGreaterThanOrEqual(before + SOLO_HOURS * 3_600_000);
    expect(body).toEqual({ ok: true, wallet: W, ref: req['ref'], tier: 'mid', share: 10_000, until: req['until'] });
  });

  it('每次带入是新的 ref', async () => {
    const w = wallet(() => ({ ok: true, wallet: W }));
    await handle(post('buyin', { tier: 'small' }), env(w));
    await handle(post('buyin', { tier: 'small' }), env(w));
    expect(w.calls[0]!.req['ref']).not.toBe(w.calls[1]!.req['ref']);
  });

  it('钱包被拒：原样带回 error 和 wallet（200），页面去说人话', async () => {
    for (const error of ['no_funds', 'at_table', 'limit', 'busy', 'internal']) {
      const res = await handle(post('buyin', { tier: 'big' }), env(wallet(() => ({ ok: false, error, wallet: W }))));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: false, error, wallet: W });
    }
  });

  it('档位不对、不是 JSON：400，不问平台也不碰钱包', async () => {
    const w = wallet(() => ({ ok: true, wallet: W }));
    let asked = 0;
    const arc: Fetcher = { fetch: async () => (asked++, new Response('{}')) };
    for (const body of [{ tier: 'huge' }, {}, '不是 JSON', [1]]) {
      expect((await handle(post('buyin', body), env(w, arc))).status).toBe(400);
    }
    expect(asked).toBe(0);
    expect(w.calls).toHaveLength(0);
  });
});

describe('结回、放弃', () => {
  it('结回：按档位和净分算结回额，op 是 ref-out；credited / capped / dup 原样带回', async () => {
    const w = wallet(() => ({ ok: true, wallet: W, credited: 11_000, capped: 500, dup: true }));
    const res = await handle(post('settle', { ref: REF, tier: 'mid', points: 3, deals: 8 }), env(w));
    expect(await res.json()).toEqual({ ok: true, wallet: W, credited: 11_000, capped: 500, dup: true });
    expect(w.calls[0]).toEqual({ method: 'settle', req: { userId: 'u1', game: 'guandan', ref: REF, amount: 11_500, mode: 'client', op: `${REF}-out` } });
  });

  it('结回按 ref 里的档位算，不信页面带的（安全审计：小档带入报豪华档结回）', async () => {
    const w = wallet(() => ({ ok: true, wallet: W }));
    const small = `solo-small-${'cd'.repeat(16)}`;
    await handle(post('settle', { ref: small, tier: 'lux', points: 3, deals: 8 }), env(w));
    // 小档一份 2,000、每分 100：2,000 + 300；按豪华档会是 230,000
    expect(w.calls[0]!.req).toMatchObject({ ref: small, amount: 2_300 });
    // 页面不带档位也行
    await handle(post('settle', { ref: small, points: -2, deals: 8 }), env(w));
    expect(w.calls[1]!.req).toMatchObject({ amount: 1_800 });
  });

  it('旧 ref（0.12.1 以前带入、没编档位，最多 24 小时）照旧按页面带的档位结回；没带档位 400', async () => {
    const w = wallet(() => ({ ok: true, wallet: W }));
    await handle(post('settle', { ref: OLD_REF, tier: 'mid', points: 3, deals: 8 }), env(w));
    expect(w.calls[0]!.req).toMatchObject({ ref: OLD_REF, amount: 11_500 });
    expect((await handle(post('settle', { ref: OLD_REF, points: 3, deals: 8 }), env(w))).status).toBe(400);
  });

  it('战绩小结（平台 0.10.0）原样转给钱包，不改、不补；没带就不带', async () => {
    const w = wallet(() => ({ ok: true, wallet: W }));
    const stats = { rounds: 8, wins: 5, best: 1500, titles: ['bomb_maniac'], sum: { bombs: 3, firsts: 2 } };
    await handle(post('settle', { ref: REF, tier: 'mid', points: 3, deals: 8, stats }), env(w));
    expect(w.calls[0]!.req).toMatchObject({ amount: 11_500, stats });
    await handle(post('settle', { ref: REF, tier: 'mid', points: 3, deals: 8, stats: 'odd' }), env(w));
    expect(w.calls[1]!.req).toMatchObject({ stats: 'odd' });
  });

  it('结回的数不在规则范围里（|分| > 20、副数不对、每副超过 3 分）：400', async () => {
    const w = wallet(() => ({ ok: true, wallet: W }));
    for (const b of [
      { ref: REF, tier: 'mid', points: 21, deals: 8 },
      { ref: REF, tier: 'mid', points: 1, deals: 9 },
      { ref: REF, tier: 'mid', points: 7, deals: 2 },
      { ref: REF, tier: 'mid', points: 1 },
      { ref: OLD_REF, points: 1, deals: 1 },
      { ref: `${REF}:out`, tier: 'mid', points: 1, deals: 1 },
      { ref: 'gd-0123456789abcdef', tier: 'mid', points: 1, deals: 1 },
    ]) {
      expect((await handle(post('settle', b), env(w))).status, JSON.stringify(b)).toBe(400);
    }
    expect(w.calls).toHaveLength(0);
  });

  it('结回被拒（no_stake、expired）原样带回', async () => {
    for (const error of ['no_stake', 'expired']) {
      const res = await handle(post('settle', { ref: REF, tier: 'small', points: 0, deals: 0 }), env(wallet(() => ({ ok: false, error }))));
      expect(await res.json()).toEqual({ ok: false, error });
    }
  });

  it('放弃：op 是 ref-refund', async () => {
    const w = wallet(() => ({ ok: true, wallet: W, credited: 2000 }));
    const res = await handle(post('refund', { ref: REF }), env(w));
    expect(await res.json()).toEqual({ ok: true, wallet: W, credited: 2000 });
    expect(w.calls[0]).toEqual({ method: 'refund', req: { userId: 'u1', game: 'guandan', ref: REF, mode: 'client', op: `${REF}-refund` } });
  });
});

describe('没到钱包的情况', () => {
  it('没登录：401，带回平台清 cookie 的 Set-Cookie；没带会话 cookie 时不问平台', async () => {
    const w = wallet(() => ({ ok: true, wallet: W }));
    const res = await handle(post('buyin', { tier: 'small' }), env(w, arcade(null)));
    expect(res.status).toBe(401);
    expect(res.headers.get('Set-Cookie')).toContain('__Host-sid');
    let asked = 0;
    const arc: Fetcher = { fetch: async () => (asked++, new Response('{}')) };
    expect((await handle(post('buyin', { tier: 'small' }, { Cookie: '' }), env(w, arc))).status).toBe(401);
    expect(asked).toBe(0);
    expect(w.calls).toHaveLength(0);
  });

  it('平台连不上、钱包 RPC 抛异常：503；没有钱包绑定（单独部署）：409 no_wallet，不问平台', async () => {
    expect((await handle(post('buyin', { tier: 'small' }), env(wallet(() => ({ ok: true, wallet: W })), arcade(null, 500)))).status).toBe(503);
    for (const action of ['buyin', 'settle', 'refund']) {
      const none = await handle(post(action, { tier: 'small', ref: REF }), env(undefined));
      expect(none.status).toBe(409);
      expect(await none.json()).toEqual({ ok: false, error: 'no_wallet' });
    }
    const res = await handle(
      post('refund', { ref: REF }),
      env(
        wallet(() => {
          throw new Error('network');
        }),
      ),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: 'unavailable' });
  });

  it('请求体先限大小：不带 content-length（分块传输）、0、超过 1024 字节都是 400，不问平台、不读请求体', async () => {
    const w = wallet(() => ({ ok: true, wallet: W }));
    let asked = 0;
    const arc: Fetcher = { fetch: async () => (asked++, new Response('{}')) };
    const stream = new ReadableStream<Uint8Array>({
      pull(ctl) {
        ctl.enqueue(new TextEncoder().encode('{"tier":"small"}'));
        ctl.close();
      },
    });
    const chunked = new Request(`${SITE}/games/guandan/api/stake/buyin`, {
      method: 'POST',
      headers: { Origin: SITE, Cookie: '__Host-sid=abc', 'Content-Type': 'application/json' },
      body: stream,
      duplex: 'half',
    } as RequestInit);
    expect(chunked.headers.get('content-length')).toBeNull();
    expect((await handle(chunked, env(w, arc))).status).toBe(400);
    // 请求体没被读
    expect(chunked.bodyUsed).toBe(false);
    expect((await handle(post('buyin', { tier: 'small' }, { 'Content-Length': '0' }), env(w, arc))).status).toBe(400);
    const big = JSON.stringify({ tier: 'small', pad: 'x'.repeat(1100) });
    expect((await handle(post('buyin', big), env(w, arc))).status).toBe(400);
    expect(asked).toBe(0);
    expect(w.calls).toHaveLength(0);
  });

  it('不是本站页面发起的（Origin 不对、没带）：403；不是 POST：405；别的路径：404', async () => {
    const w = wallet(() => ({ ok: true, wallet: W }));
    expect((await handle(post('buyin', { tier: 'small' }, { Origin: 'https://evil.example' }), env(w))).status).toBe(403);
    const noOrigin = new Request(`${SITE}/games/guandan/api/stake/buyin`, { method: 'POST', headers: { Cookie: '__Host-sid=abc', 'Content-Length': '16' }, body: '{"tier":"small"}' });
    expect((await handle(noOrigin, env(w))).status).toBe(403);
    expect((await handle(new Request(`${SITE}/games/guandan/api/stake/buyin`), env(w))).status).toBe(405);
    expect((await handle(post('wallet', {}), env(w))).status).toBe(404);
    expect((await handle(post('', {}), env(w))).status).toBe(404);
    expect(w.calls).toHaveLength(0);
  });

  it('本地联调：SITE_ORIGIN 指定本机地址时认它', async () => {
    const w = wallet(() => ({ ok: true, wallet: W }));
    const e = { ...env(w), SITE_ORIGIN: 'http://127.0.0.1:8787' };
    expect((await handle(post('buyin', { tier: 'small' }, { Origin: 'http://127.0.0.1:8787' }), e)).status).toBe(200);
  });
});
