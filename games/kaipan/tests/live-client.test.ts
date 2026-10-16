import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIVE_KEY, LiveClient, classify, reviveLive, walletView, type LiveRecord } from '../src/platform/live.ts';
import type { KeyValueStore } from '../src/platform/settings.ts';

/** 0.6.0 实盘的本机账（src/platform/live.ts）：带入、结回、放弃、重试、作废，钱包和 Worker 用假的。 */

function memStore(init: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(init));
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

type Reply = { status: number; body?: unknown } | 'offline';

/** 假的 fetch：按顺序取回话；记下发了什么 */
function fakeFetch(replies: Reply[]) {
  const calls: { url: string; init: RequestInit; body: Record<string, unknown> | null }[] = [];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init, body: typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null });
    const r = replies.shift() ?? { status: 200, body: { ok: true, wallet: { balance: 0, stakes: [] } } };
    if (r === 'offline') throw new TypeError('Failed to fetch');
    return new Response(r.body === undefined ? 'oops' : JSON.stringify(r.body), { status: r.status });
  };
  return { fetch, calls };
}

const OK = (extra: Record<string, unknown> = {}): Reply => ({ status: 200, body: { ok: true, wallet: { balance: 5_000, stakes: [] }, ...extra } });
const NO = (error: string): Reply => ({ status: 200, body: { ok: false, error, wallet: { balance: 5_000, stakes: [] } } });

function client(replies: Reply[], store = memStore(), now = 1_000_000) {
  const f = fakeFetch(replies);
  let changes = 0;
  const c = new LiveClient({ store, fetch: f.fetch, now: () => now, onChange: () => (changes += 1) });
  return { c, store, calls: f.calls, changes: () => changes };
}

const saved = (store: KeyValueStore): LiveRecord | null => {
  const raw = store.getItem(LIVE_KEY);
  return raw ? (JSON.parse(raw) as LiveRecord) : null;
};

afterEach(() => vi.restoreAllMocks());

describe('带入', () => {
  it('成功：只发 ref 和 tier，带 X-Arcade，相对路径；记录是 playing，到期按本机时钟 + 24 小时', async () => {
    const { c, store, calls } = client([OK()]);
    const r = await c.buyin('mid', 'seed-1');
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('api/live/buyin');
    expect(calls[0]!.init.method).toBe('POST');
    expect((calls[0]!.init.headers as Record<string, string>)['X-Arcade']).toBe('1');
    expect(Object.keys(calls[0]!.body ?? {}).sort()).toEqual(['ref', 'tier']);
    expect(calls[0]!.body?.tier).toBe('mid');
    const ref = String(calls[0]!.body?.ref);
    expect(ref).toMatch(/^kaipan-[0-9a-f-]{36}$/);
    expect(`${ref}-refund`.length).toBeLessThanOrEqual(64);
    expect(saved(store)).toMatchObject({ ref, tier: 'mid', stake: 10_000, seed: 'seed-1', step: 'playing', at: 1_000_000, until: 1_000_000 + 86_400_000 });
    expect(c.pendingFor('seed-1')).toBe(true);
    expect(c.pendingFor('other')).toBe(false);
  });

  it('钱包明确拒了（钱不够、桌上已有、今天写满）：记录清掉，原样告诉调用方', async () => {
    for (const e of ['no_funds', 'at_table', 'limit']) {
      const { c, store } = client([NO(e)]);
      const r = await c.buyin('small', 's');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.outcome).toMatchObject({ kind: 'reject', error: e });
      expect(saved(store)).toBeNull();
    }
  });

  it('连不上、Worker 503、钱包忙：不开局，记录留在 buying；下次带入前先用 refund 收回那个 ref', async () => {
    for (const first of ['offline', { status: 503, body: { ok: false, error: 'unavailable' } }, NO('busy'), NO('internal')] as Reply[]) {
      const { c, store, calls } = client([first, NO('no_stake'), OK()]);
      const r = await c.buyin('small', 's1');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.outcome.kind).toBe('retry');
      const pending = saved(store);
      expect(pending?.step).toBe('buying');
      const again = await c.buyin('small', 's2');
      expect(again.ok).toBe(true);
      expect(calls.map((x) => x.url)).toEqual(['api/live/buyin', 'api/live/refund', 'api/live/buyin']);
      expect(calls[1]!.body).toEqual({ ref: pending?.ref });
      expect(calls[2]!.body?.ref).not.toBe(pending?.ref);
      expect(saved(store)?.seed).toBe('s2');
    }
  });

  it('没认出人（401、no_user）：在动钱包之前就挡下了，记录直接清掉', async () => {
    for (const reply of [{ status: 401, body: { ok: false, error: 'login' } }, NO('no_user')] as Reply[]) {
      const { c, store } = client([reply]);
      const r = await c.buyin('small', 's');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.outcome).toEqual({ kind: 'retry', why: 'login' });
      expect(saved(store)).toBeNull();
    }
  });

  it('收尾的 refund 也连不上：不再带入，告诉调用方上一局还没结完', async () => {
    const { c, calls } = client(['offline', 'offline']);
    await c.buyin('small', 's1');
    const r = await c.buyin('small', 's2');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.outcome).toMatchObject({ kind: 'reject', error: 'pending' });
    expect(calls.map((x) => x.url)).toEqual(['api/live/buyin', 'api/live/refund']);
  });

  it('开盘自己的 bug（bad_*、unknown_game、Worker 400）：记录清掉，控制台留证据', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const reply of [NO('bad_amount'), NO('unknown_game'), NO('bad_request'), { status: 400, body: { ok: false, error: 'bad_tier' } }] as Reply[]) {
      const { c, store } = client([reply]);
      const r = await c.buyin('small', 's');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.outcome.kind).toBe('bug');
      expect(saved(store)).toBeNull();
    }
    expect(err).toHaveBeenCalledTimes(4);
  });
});

describe('结回、放弃', () => {
  async function playing(replies: Reply[]) {
    const t = client([OK(), ...replies]);
    await t.c.buyin('small', 'seed');
    return t;
  }

  it('结回：发 ref、tier、bp；成了记 done、进钱包和到顶的数', async () => {
    const { c, store, calls } = await playing([OK({ credited: 1_500, capped: 608 })]);
    await c.finish('seed', 'settle', 10_543.9);
    expect(calls[1]!.url).toBe('api/live/settle');
    expect(calls[1]!.body).toEqual({ ref: calls[0]!.body?.ref, tier: 'small', bp: 10_543 });
    expect(saved(store)).toMatchObject({ step: 'done', kind: 'settle', bp: 10_543, credited: 1_500, capped: 608, told: false });
    expect(c.pendingFor('seed')).toBe(false);
  });

  it('0.6.5 战绩小结：按截好的 bp 和这一份算一次，记进记录，重发时原样再带', async () => {
    const { c, store, calls } = await playing(['offline', OK({ credited: 2_100 })]);
    const seen: [number, number][] = [];
    await c.finish('seed', 'settle', 10_500.7, (bp, stake) => {
      seen.push([bp, stake]);
      return { rounds: 1, wins: 1, best: 100, titles: ['ashore'], max: { bp }, sum: { limitup: 2 } };
    });
    expect(seen).toEqual([[10_500, 2_000]]);
    expect(saved(store)?.stats).toEqual({ rounds: 1, wins: 1, best: 100, titles: ['ashore'], max: { bp: 10_500 }, sum: { limitup: 2 } });
    await c.retry();
    const settles = calls.filter((x) => x.url === 'api/live/settle');
    expect(settles).toHaveLength(2);
    expect(settles[0]!.body?.stats).toEqual(settles[1]!.body?.stats);
    expect(saved(store)).toMatchObject({ step: 'done', credited: 2_100 });
  });

  it('放弃（还没开盘）：只发 ref；退回的数就是 credited', async () => {
    const { c, store, calls } = await playing([OK({ credited: 2_000 })]);
    await c.finish('seed', 'refund', 0);
    expect(calls[1]!.url).toBe('api/live/refund');
    expect(calls[1]!.body).toEqual({ ref: calls[0]!.body?.ref });
    expect(saved(store)).toMatchObject({ step: 'done', kind: 'refund', credited: 2_000 });
  });

  it('连不上、503、busy、internal 都停在 settling 之后重发（internal 和 busy 一样）；no_user、401 等登录；重发的是同一个 ref', async () => {
    const { c, store, calls } = await playing(['offline', { status: 503, body: { ok: false, error: 'unavailable' } }, NO('busy'), NO('internal'), NO('no_user'), { status: 401, body: { ok: false, error: 'login' } }, OK({ credited: 2_100 })]);
    await c.finish('seed', 'settle', 10_500);
    const waits: unknown[] = [saved(store)?.wait];
    for (let i = 0; i < 5; i++) {
      expect(saved(store)?.step).toBe('settling');
      await c.retry();
      waits.push(saved(store)?.wait);
    }
    expect(waits).toEqual(['offline', 'offline', 'offline', 'offline', 'login', 'login']);
    expect(saved(store)?.step).toBe('settling');
    await c.retry();
    expect(saved(store)).toMatchObject({ step: 'done', credited: 2_100 });
    const settles = calls.filter((x) => x.url === 'api/live/settle');
    expect(settles).toHaveLength(7);
    expect(new Set(settles.map((x) => x.body?.ref)).size).toBe(1);
  });

  it('钱包说已经到期退回（expired）或没有这一份（no_stake）：改成不算筹码', async () => {
    for (const e of ['expired', 'no_stake']) {
      const { c, store } = await playing([NO(e)]);
      await c.finish('seed', 'settle', 9_000);
      expect(saved(store)).toMatchObject({ step: 'void', error: e });
    }
  });

  it('开盘自己的 bug：记 error，不自动重发', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { c, store, calls } = await playing([NO('bad_amount')]);
    await c.finish('seed', 'settle', 9_000);
    expect(saved(store)).toMatchObject({ step: 'error', error: 'bad_amount' });
    await c.retry();
    expect(calls).toHaveLength(2);
  });

  it('同一时间只发一个：重试的触发很多（打开、回到前台、联网）', async () => {
    const { c, calls } = await playing([OK({ credited: 1 })]);
    await Promise.all([c.finish('seed', 'settle', 1), c.retry(), c.retry()]);
    expect(calls.filter((x) => x.url === 'api/live/settle')).toHaveLength(1);
  });

  it('种子对不上、已经在结了：什么都不发；倍数夹在 0..30000', async () => {
    const { c, store, calls } = await playing([OK({ credited: 6_000 })]);
    await c.finish('other-seed', 'settle', 10_000);
    expect(calls).toHaveLength(1);
    await c.finish('seed', 'settle', 99_999);
    expect(calls[1]!.body?.bp).toBe(30_000);
    await c.finish('seed', 'settle', 10_000);
    expect(calls).toHaveLength(2);
    expect(saved(store)?.step).toBe('done');
  });

  it('发的这段时间里标了"说过了"：结果出来后还要再说一次（told 回到 false）', async () => {
    const t = await playing(['offline', OK({ credited: 2_000 })]);
    await t.c.finish('seed', 'settle', 10_000);
    t.c.markTold();
    expect(saved(t.store)?.told).toBe(true);
    await t.c.retry();
    expect(saved(t.store)).toMatchObject({ step: 'done', told: false });
  });
});

describe('到期、读回', () => {
  it('playing 过了 24 小时：改成不算筹码（钱包会原样退回），不再找钱包', async () => {
    const store = memStore();
    const a = client([OK()], store, 1_000);
    await a.c.buyin('small', 's');
    const b = client([], store, 1_000 + 86_400_000 + 1);
    expect(b.c.expire()).toBe(true);
    expect(saved(store)).toMatchObject({ step: 'void', error: 'expired' });
    expect(b.c.expire()).toBe(false);
    await b.c.retry();
    expect(b.calls).toHaveLength(0);
  });

  it('读回：格式不对当没有；settling 缺了要发的东西改成 error 留着排查', () => {
    const base = { ref: 'kaipan-0123456789', tier: 'small', stake: 2_000, seed: 's', at: 1, until: 2, step: 'playing' };
    expect(reviveLive(base)).toMatchObject({ step: 'playing' });
    expect(reviveLive({ ...base, tier: 'huge' })).toBeNull();
    expect(reviveLive({ ...base, ref: 'short' })).toBeNull();
    expect(reviveLive({ ...base, step: 'weird' })).toBeNull();
    expect(reviveLive('x')).toBeNull();
    expect(reviveLive({ ...base, step: 'settling' })).toMatchObject({ step: 'error', error: 'bad_record' });
    expect(reviveLive({ ...base, step: 'settling', kind: 'settle', bp: 10_000 })).toMatchObject({ step: 'settling' });
    expect(reviveLive({ ...base, step: 'settling', kind: 'refund' })).toMatchObject({ step: 'settling' });
    const store = memStore({ [LIVE_KEY]: '{not json' });
    expect(new LiveClient({ store, fetch: fakeFetch([]).fetch, now: () => 0 }).record).toBeNull();
  });
});

describe('回话分类和钱包', () => {
  it('按"该怎么办"分', () => {
    expect(classify(0, null)).toEqual({ kind: 'retry', why: 'offline' });
    expect(classify(503, { ok: false, error: 'unavailable' })).toEqual({ kind: 'retry', why: 'offline' });
    expect(classify(502, null)).toEqual({ kind: 'retry', why: 'offline' });
    expect(classify(200, null)).toEqual({ kind: 'retry', why: 'offline' });
    expect(classify(401, { ok: false, error: 'login' })).toEqual({ kind: 'retry', why: 'login' });
    expect(classify(200, { ok: false, error: 'no_user' })).toEqual({ kind: 'retry', why: 'login' });
    expect(classify(200, { ok: false, error: 'busy' })).toEqual({ kind: 'retry', why: 'offline', code: 'busy' });
    expect(classify(200, { ok: false, error: 'internal' })).toEqual({ kind: 'retry', why: 'offline', code: 'internal' });
    for (const e of ['no_funds', 'at_table', 'limit', 'expired', 'no_stake']) expect(classify(200, { ok: false, error: e })).toMatchObject({ kind: 'reject', error: e });
    for (const e of ['bad_amount', 'bad_until', 'bad_mode', 'bad_game', 'bad_request', 'unknown_game', 'something_new']) expect(classify(200, { ok: false, error: e })).toEqual({ kind: 'bug', error: e });
    expect(classify(403, { ok: false, error: 'csrf' })).toEqual({ kind: 'bug', error: 'csrf' });
    expect(classify(404, null)).toEqual({ kind: 'bug', error: 'http_404' });
    expect(classify(200, { ok: true, credited: 10, capped: 2, dup: true })).toMatchObject({ kind: 'ok', credited: 10, capped: 2 });
  });

  it('GET /api/wallet：余额和开盘桌上的几份', async () => {
    expect(
      walletView({ balance: 12_340, stakes: [{ game: 'texas', ref: 'room-1', tier: 'small' }, { game: 'kaipan', ref: 'kaipan-x', tier: 'mid', amount: 10_000, until: 9 }, { game: 'kaipan', ref: 'kaipan-y', tier: 'small', amount: 2_000, until: 8 }] }),
    ).toEqual({
      balance: 12_340,
      stakes: [
        { ref: 'kaipan-x', tier: 'mid', amount: 10_000, until: 9 },
        { ref: 'kaipan-y', tier: 'small', amount: 2_000, until: 8 },
      ],
    });
    expect(walletView({ balance: 0 })).toEqual({ balance: 0, stakes: [] });
    expect(walletView({})).toBeNull();
    const ok = client([{ status: 200, body: { wallet: { balance: 7, stakes: [] }, tiers: {}, reliefTo: 2_000 } }]);
    expect(await ok.c.wallet()).toEqual({ balance: 7, stakes: [] });
    expect(ok.calls[0]!.url).toBe('/api/wallet');
    expect(await client([{ status: 401, body: {} }]).c.wallet()).toBe('login');
    expect(await client(['offline']).c.wallet()).toBeNull();
    expect(await client([{ status: 503, body: {} }]).c.wallet()).toBeNull();
  });
});

describe('审阅后补的几处', () => {
  it('带入还在等回话时，回到前台 / 联网触发的重试不会把这个 ref 拿去收回', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const store = memStore();
    const calls: string[] = [];
    const c = new LiveClient({
      store,
      now: () => 0,
      fetch: async (url) => {
        calls.push(url);
        if (url.endsWith('buyin')) await gate;
        return new Response(JSON.stringify({ ok: true, wallet: { balance: 1, stakes: [] }, user: 'u1' }), { status: 200 });
      },
    });
    const p = c.buyin('small', 's');
    await Promise.resolve();
    const r1 = c.retry();
    const r2 = c.cleanup();
    release();
    expect((await p).ok).toBe(true);
    await Promise.all([r1, r2]);
    expect(calls).toEqual(['api/live/buyin']);
    expect(saved(store)).toMatchObject({ step: 'playing', user: 'u1' });
  });

  it('记下带入的账号，结回、放弃时带上；换了账号（409 wrong_user）停在 settling 等登录', async () => {
    const { c, store, calls } = client([{ status: 200, body: { ok: true, wallet: { balance: 1, stakes: [] }, user: 'u1' } }, { status: 409, body: { ok: false, error: 'wrong_user' } }, OK({ credited: 2_000 })]);
    await c.buyin('small', 'seed');
    await c.finish('seed', 'settle', 10_000);
    expect(calls[1]!.body).toMatchObject({ user: 'u1' });
    expect(saved(store)).toMatchObject({ step: 'settling', wait: 'login' });
    await c.retry();
    expect(saved(store)?.step).toBe('done');
  });

  it('结回遇到钱包的每日写入上限（limit）：留着明天再结', async () => {
    const { c, store } = client([OK(), NO('limit')]);
    await c.buyin('small', 'seed');
    await c.finish('seed', 'settle', 10_000);
    expect(saved(store)).toMatchObject({ step: 'settling', wait: 'offline' });
  });

  it('收回没开成的那一份：bug 记成 error 留着排查；limit、忙都留在 buying', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const [reply, step] of [[NO('bad_request'), 'error'], [NO('limit'), 'buying'], [NO('busy'), 'buying']] as const) {
      const { c, store } = client(['offline', reply]);
      await c.buyin('small', 's');
      await c.retry();
      expect(saved(store)?.step).toBe(step);
    }
  });

  it('几个标签页：别的页已经开了新的一局，这一页拿着旧记录结不会盖掉它', async () => {
    const store = memStore();
    const a = client([OK()], store);
    await a.c.buyin('small', 'seed-1');
    const b = client([OK({ credited: 1 })], store);
    expect(b.c.record?.seed).toBe('seed-1');
    // A 页结完、开了下一局
    const a2 = client([OK({ credited: 2_000 }), OK()], store);
    await a2.c.finish('seed-1', 'settle', 10_000);
    await a2.c.buyin('mid', 'seed-2');
    expect(saved(store)).toMatchObject({ seed: 'seed-2', step: 'playing' });
    // B 页按旧局面结：看到的已经是新的一局，不发、不写
    await b.c.finish('seed-1', 'settle', 10_000);
    expect(b.calls).toHaveLength(0);
    expect(saved(store)).toMatchObject({ seed: 'seed-2', step: 'playing' });
    expect(b.c.pendingFor('seed-2')).toBe(true);
  });
});
