import { describe, expect, it, vi } from 'vitest';
import { LIVE_KEY, LiveClient, classify, liveSetup, reviveLive } from '../src/platform/live.ts';
import { LIVE_MAX_BP, LIVE_TIER_IDS, LIVE_TIERS, VIGIL_BOSS_ADD_BP, vigilBp } from '../src/content/live.ts';
import { normalizeSetup } from '../src/core/state.ts';

const res = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const OK = { ok: true, wallet: { balance: 1 }, credited: 0, capped: 0, user: 'u1' };

describe('守夜结回倍数', () => {
  it('天亮倍数随档位不降：越大的档不会更难还给得更少（主线 #211）', () => {
    for (let i = 1; i < LIVE_TIER_IDS.length; i++) {
      expect(LIVE_TIERS[LIVE_TIER_IDS[i]!].dawnBp).toBeGreaterThanOrEqual(LIVE_TIERS[LIVE_TIER_IDS[i - 1]!].dawnBp);
    }
  });
  it('每档：3:00 前为 0、随撑的时间不减、天亮 = dawnBp、尸王再加且封顶', () => {
    for (const t of LIVE_TIER_IDS) {
      const dawn = LIVE_TIERS[t].dawnBp;
      expect(vigilBp(t, 180 * 30, false, false)).toBe(0);
      let prev = 0;
      for (let tick = 0; tick < 900 * 30; tick += 97) {
        const b = vigilBp(t, tick, false, false);
        expect(Number.isInteger(b) && b >= prev && b <= dawn).toBe(true);
        prev = b;
      }
      expect(vigilBp(t, 27_000, true, false)).toBe(dawn);
      expect(vigilBp(t, 27_000, true, true)).toBe(Math.min(LIVE_MAX_BP, dawn + VIGIL_BOSS_ADD_BP));
    }
  });
});

function mem(): { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem(k: string): void; m: Map<string, string> } {
  const m = new Map<string, string>();
  return { m, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

type Req = { url: string; init: RequestInit; body: Record<string, unknown> };
function rig(handler: (r: Req) => Response | Promise<Response> = () => res(200, OK), store = mem(), clock = { t: 1_000_000 }) {
  const calls: Req[] = [];
  const c = new LiveClient({
    store,
    now: () => clock.t,
    fetch: async (url, init) => {
      const r = { url, init, body: JSON.parse(String(init.body)) as Record<string, unknown> };
      calls.push(r);
      return handler(r);
    },
  });
  return { c, calls, store, clock };
}
const saved = (s: ReturnType<typeof mem>) => JSON.parse(s.m.get(LIVE_KEY) ?? 'null');

describe('liveSetup', () => {
  it('固定小道士、没有咒印和加成、危险档按档位映射', () => {
    const want = { small: 0, medium: 2, large: 3, luxe: 4 } as const;
    for (const t of Object.keys(want) as (keyof typeof want)[]) {
      const s = liveSetup(t, 42);
      expect(s).toMatchObject({ seed: 42, mode: 'vigil', danger: want[t], character: 'xiaodao' });
      expect(s.curses ?? []).toEqual([]);
      expect(Object.keys(s.perks ?? {})).toEqual([]);
      expect(s.assist).toBeFalsy();
      expect(s.endless).toBeFalsy();
      // 经核心整理后仍然没有咒印、加成
      const n = normalizeSetup(s);
      expect(n.curses ?? []).toEqual([]);
      expect(Object.keys(n.perks ?? {})).toEqual([]);
      expect(LIVE_TIERS[t].danger).toBe(want[t]);
    }
  });
});

describe('带入', () => {
  it('成功：POST api/live/buyin，带 X-Arcade、同源，记进 yexun.live（含账号）', async () => {
    const { c, calls, store } = rig();
    const r = await c.buyin('medium', 77);
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('api/live/buyin');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.init.credentials).toBe('same-origin');
    expect((calls[0]!.init.headers as Record<string, string>)['X-Arcade']).toBe('1');
    // 浏览器只报 ref 和档位，不报金额
    expect(Object.keys(calls[0]!.body).sort()).toEqual(['ref', 'tier']);
    expect(String(calls[0]!.body.ref)).toMatch(/^yexun-[0-9a-f-]{36}$/);
    const s = saved(store);
    expect(s).toMatchObject({ tier: 'medium', stake: 10_000, seed: 77, step: 'playing', user: 'u1', ref: calls[0]!.body.ref });
    expect(c.busy).toBe(true);
  });

  it('业务拒绝（钱不够）：清掉记录，不留尾巴', async () => {
    const { c, store } = rig(() => res(200, { ok: false, error: 'no_funds' }));
    const r = await c.buyin('small', 1);
    expect(r).toMatchObject({ ok: false, outcome: { kind: 'reject', error: 'no_funds' } });
    expect(store.m.has(LIVE_KEY)).toBe(false);
  });

  it('没登录 401：清掉记录（肯定没带入）', async () => {
    const { c, store } = rig(() => res(401, { ok: false, error: 'login' }));
    const r = await c.buyin('small', 1);
    expect(r).toMatchObject({ ok: false, outcome: { kind: 'retry', why: 'login' } });
    expect(store.m.has(LIVE_KEY)).toBe(false);
  });

  it('连不上：记录留在 buying，下次 resume 用 refund 收回', async () => {
    let down = true;
    const { c, calls, store } = rig(() => {
      if (down) throw new Error('offline');
      return res(200, { ok: false, error: 'no_stake', user: 'u1' });
    });
    const r = await c.buyin('small', 1);
    expect(r).toMatchObject({ ok: false, outcome: { kind: 'retry', why: 'offline' } });
    expect(saved(store).step).toBe('buying');
    down = false;
    await c.resume();
    expect(calls.at(-1)!.url).toBe('api/live/refund');
    expect(calls.at(-1)!.body.ref).toBe(saved(store)?.ref ?? calls[0]!.body.ref);
    expect(store.m.has(LIVE_KEY)).toBe(false);
  });

  it('已有没结完的一份：不再带入', async () => {
    const { c, calls } = rig();
    await c.buyin('small', 1);
    const r = await c.buyin('large', 2);
    expect(r).toMatchObject({ ok: false, outcome: { kind: 'reject', error: 'pending' } });
    expect(calls).toHaveLength(1);
  });

  it('501（单独部署）：实盘不可用，记录清掉，之后不再发请求', async () => {
    const { c, calls, store } = rig(() => res(501, { ok: false, error: 'no_wallet' }));
    const r = await c.buyin('small', 1);
    expect(r).toMatchObject({ ok: false, outcome: { kind: 'unavailable' } });
    expect(c.unavailable).toBe(true);
    expect(store.m.has(LIVE_KEY)).toBe(false);
    const again = await c.buyin('small', 2);
    expect(again).toMatchObject({ ok: false, outcome: { kind: 'unavailable' } });
    expect(calls).toHaveLength(1);
  });
});

describe('结回', () => {
  it('局打完：按 vigilBp 算倍数、带战绩小结，成功后记成 done 并带上进账', async () => {
    const { c, calls, store } = rig((r) => (r.url.endsWith('settle') ? res(200, { ...OK, credited: 3_600 }) : res(200, OK)));
    await c.buyin('small', 5);
    const stats = { ticks: 9000, kills: 3 };
    await c.finish(5, { ticks: 9000, won: false, bossKilled: false }, stats);
    const last = calls.at(-1)!;
    expect(last.url).toBe('api/live/settle');
    expect(last.body).toMatchObject({ tier: 'small', bp: vigilBp('small', 9000, false, false), user: 'u1', stats });
    expect(typeof last.body.ref).toBe('string');
    expect(saved(store)).toMatchObject({ step: 'done', credited: 3_600 });
    expect(c.busy).toBe(false);
    c.clearFinished();
    expect(store.m.has(LIVE_KEY)).toBe(false);
  });

  it('天亮和尸王的倍数', async () => {
    for (const [won, boss] of [[true, false], [true, true]] as const) {
      const { c, calls } = rig();
      await c.buyin('small', 5);
      await c.finish(5, { ticks: 27_000, won, bossKilled: boss });
      expect(calls.at(-1)!.body.bp).toBe(vigilBp('small', 27_000, won, boss));
    }
  });

  it('连不上：停在 settling，下次 resume 重发同一个 ref', async () => {
    let down = false;
    const { c, calls, store } = rig(() => {
      if (down) throw new Error('offline');
      return res(200, OK);
    });
    await c.buyin('small', 5);
    down = true;
    await c.finish(5, { ticks: 9000, won: false, bossKilled: false });
    expect(saved(store)).toMatchObject({ step: 'settling', kind: 'settle', wait: 'offline' });
    down = false;
    await c.resume();
    expect(saved(store).step).toBe('done');
    const settles = calls.filter((x) => x.url.endsWith('settle'));
    expect(settles).toHaveLength(2);
    expect(settles[1]!.body.ref).toBe(settles[0]!.body.ref);
  });

  it('种子对不上的 finish 什么都不做', async () => {
    const { c, calls } = rig();
    await c.buyin('small', 5);
    await c.finish(6, { ticks: 1, won: true, bossKilled: false });
    expect(calls).toHaveLength(1);
    expect(c.record?.step).toBe('playing');
  });

  it('钱包说已到期退回（expired / no_stake）：改成 void，不算筹码', async () => {
    const { c, store } = rig((r) => (r.url.endsWith('settle') ? res(200, { ok: false, error: 'expired', user: 'u1' }) : res(200, OK)));
    await c.buyin('small', 5);
    await c.finish(5, { ticks: 100, won: false, bossKilled: false });
    expect(saved(store)).toMatchObject({ step: 'void', error: 'expired' });
  });

  it('夜巡自己的 bug（400、未知错误码）：记 error，不自动重发', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { c, calls, store } = rig((r) => (r.url.endsWith('settle') ? res(400, { ok: false, error: 'bad_bp' }) : res(200, OK)));
    await c.buyin('small', 5);
    await c.finish(5, { ticks: 100, won: false, bossKilled: false });
    expect(saved(store)).toMatchObject({ step: 'error', error: 'bad_bp' });
    await c.resume();
    expect(calls.filter((x) => x.url.endsWith('settle'))).toHaveLength(1);
    err.mockRestore();
  });
});

describe('放弃', () => {
  it('局没开始：POST refund 原样退回，记成 done', async () => {
    const { c, calls, store } = rig((r) => (r.url.endsWith('refund') ? res(200, { ...OK, credited: 2_000 }) : res(200, OK)));
    await c.buyin('small', 5);
    await c.abandon(5);
    expect(calls.at(-1)!.url).toBe('api/live/refund');
    expect(calls.at(-1)!.body).toMatchObject({ user: 'u1' });
    expect('bp' in calls.at(-1)!.body).toBe(false);
    expect(saved(store)).toMatchObject({ step: 'done', kind: 'refund', credited: 2_000 });
  });
});

describe('重开页面', () => {
  it('结回到一半（settling）关了页面：新页面 resume 接着结', async () => {
    const store = mem();
    let down = false;
    const a = rig(() => {
      if (down) throw new Error('offline');
      return res(200, OK);
    }, store);
    await a.c.buyin('small', 5);
    down = true;
    await a.c.finish(5, { ticks: 9000, won: false, bossKilled: false });
    const ref = saved(store).ref;
    const b = rig(() => res(200, OK), store);
    expect(b.c.record?.step).toBe('settling');
    await b.c.resume();
    expect(b.calls[0]!.body).toMatchObject({ ref, bp: vigilBp('small', 9000, false, false), user: 'u1' });
    expect(saved(store).step).toBe('done');
  });

  it('局打到一半关页面（playing）：算输，按最后记下的拍数结回', async () => {
    const store = mem();
    const a = rig(undefined, store);
    await a.c.buyin('small', 5);
    a.c.progress(5, 6000);
    a.c.progress(5, 4000); // 只往大记
    a.c.progress(9, 99_999); // 别的局的不记
    const b = rig(undefined, store);
    await b.c.resume();
    expect(b.calls[0]!.url).toBe('api/live/settle');
    expect(b.calls[0]!.body.bp).toBe(vigilBp('small', 6000, false, false));
    expect(saved(store).step).toBe('done');
  });

  it('打到一半关页面且没记过拍数：bp 为 0（输掉这一份）', async () => {
    const store = mem();
    await rig(undefined, store).c.buyin('small', 5);
    const b = rig(undefined, store);
    await b.c.resume();
    expect(b.calls[0]!.body.bp).toBe(0);
  });

  it('过了 24 小时的 playing：钱包已退回，作废，不再发', async () => {
    const store = mem();
    const a = rig(undefined, store);
    await a.c.buyin('small', 5);
    const b = rig(undefined, store, { t: a.clock.t + 25 * 3_600_000 });
    await b.c.resume();
    expect(b.calls).toHaveLength(0);
    expect(saved(store)).toMatchObject({ step: 'void', error: 'expired' });
  });

  it('坏记录当作没有', () => {
    expect(reviveLive({ ref: 'x' })).toBeNull();
    expect(reviveLive(null)).toBeNull();
    expect(reviveLive({ ref: 'yexun-abcdef12', tier: 'mid', stake: 1, seed: 1, at: 1, until: 1, step: 'playing' })).toBeNull();
    const bad = reviveLive({ ref: 'yexun-abcdef12', tier: 'small', stake: 2000, seed: 1, at: 1, until: 1, step: 'settling', kind: 'settle' });
    expect(bad).toMatchObject({ step: 'error', error: 'bad_record' });
  });
});

describe('换账号', () => {
  it('结回、放弃带带入时的账号；Worker 回 409 wrong_user 时停在 settling 等换回去，不丢记录', async () => {
    let user: string | null = null;
    const { c, calls, store } = rig((r) => {
      if (r.url.endsWith('buyin')) return res(200, OK);
      user = r.body.user as string;
      return res(409, { ok: false, error: 'wrong_user' });
    });
    await c.buyin('small', 5);
    await c.finish(5, { ticks: 9000, won: false, bossKilled: false });
    expect(user).toBe('u1');
    expect(saved(store)).toMatchObject({ step: 'settling', wait: 'login', user: 'u1' });
    await c.abandon(5); // 已经在结了：不改成放弃
    expect(saved(store).kind).toBe('settle');
    expect(calls.filter((x) => x.url.endsWith('refund'))).toHaveLength(0);
  });

  it('换回原账号后重发成功', async () => {
    let who = 'u2';
    const { c, store } = rig((r) => {
      if (r.url.endsWith('buyin')) return res(200, OK);
      return who === r.body.user ? res(200, OK) : res(409, { ok: false, error: 'wrong_user' });
    });
    await c.buyin('small', 5);
    await c.finish(5, { ticks: 9000, won: false, bossKilled: false });
    expect(saved(store).step).toBe('settling');
    who = 'u1';
    await c.resume();
    expect(saved(store).step).toBe('done');
  });
});

describe('classify', () => {
  it('分类', () => {
    expect(classify(501, null)).toEqual({ kind: 'unavailable' });
    expect(classify(401, {})).toMatchObject({ kind: 'retry', why: 'login' });
    expect(classify(409, { error: 'wrong_user' })).toMatchObject({ kind: 'retry', why: 'login' });
    expect(classify(409, { error: 'other' })).toMatchObject({ kind: 'bug' });
    expect(classify(503, null)).toMatchObject({ kind: 'retry', why: 'offline' });
    expect(classify(0, null)).toMatchObject({ kind: 'retry', why: 'offline' });
    expect(classify(200, { ok: false, error: 'busy' })).toMatchObject({ kind: 'retry', code: 'busy' });
    expect(classify(200, { ok: false, error: 'at_table' })).toEqual({ kind: 'reject', error: 'at_table' });
    expect(classify(200, { ok: false, error: 'weird' })).toEqual({ kind: 'bug', error: 'weird' });
    expect(classify(403, { error: 'csrf' })).toEqual({ kind: 'bug', error: 'csrf' });
  });
});
