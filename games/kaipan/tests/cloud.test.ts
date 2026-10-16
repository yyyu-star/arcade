import { beforeEach, describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, KNOWLEDGE, PERSONAS, STOCKS } from '../src/core/index.ts';
import { Cloud, DEBOUNCE_MS, FORCE_GAP_MS, HIDDEN_GAP_MS, MAX_WAIT_MS, META_KEY, NOTE, RECHECK_MS, SESSION_PUTS, loadMeta, preSwitchKey, preSyncKey, stable, type CloudDeps } from '../src/platform/cloud.ts';
import { PROFILE_KEY, CLOUD_PROFILE_BYTES, cloudProfile, emptyProfile, mergeProfile, type Profile } from '../src/platform/profile.ts';
import { KEEPALIVE_BYTES, keepaliveLeft, keepaliveSend, resetKeepalive } from '../src/platform/keepalive.ts';
import type { KeyValueStore } from '../src/platform/settings.ts';
import { SLOTS, tutorialSlot } from '../src/view/cloudSync.ts';
import { EXT_TIPS_KEY } from '../src/view/extTips.ts';
import { TUTORIAL_KEY } from '../src/view/tutorial.ts';

/** 0.5.7 云存档：假平台按 docs/platform-backend.md 15.3 的规矩回话，计时器手动拨。 */

// 没回来的 keepalive 会一直占着记账（keepalive.ts），每个测试从零开始
beforeEach(() => resetKeepalive());

class MemoryStore implements KeyValueStore {
  data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Call {
  method: string;
  url: string;
  body: { baseRev: number; userId?: string | null; data: unknown } | undefined;
  init: RequestInit;
}

/**
 * 假平台：存档按账号、按槽存 {rev, data}（cookie 是谁就记在谁名下），PUT 按 baseRev 判冲突
 * （baseRev 0 而云端已有、baseRev > 0 而云端没有，都是 409）。p.slots 是当前账号的那一份。
 */
function platform() {
  const byUser = new Map<string, Map<string, { rev: number; data: unknown }>>();
  const mine = (): Map<string, { rev: number; data: unknown }> => {
    const id = p.user?.id ?? '-';
    if (!byUser.has(id)) byUser.set(id, new Map());
    return byUser.get(id)!;
  };
  const p = {
    user: { id: 'u1' } as { id: string } | null,
    saves: 'ok' as 'ok' | 'paused',
    get slots(): Map<string, { rev: number; data: unknown }> {
      return mine();
    },
    set slots(m: Map<string, { rev: number; data: unknown }>) {
      byUser.set(p.user?.id ?? '-', m);
    },
    of: (id: string): Map<string, { rev: number; data: unknown }> => byUser.get(id) ?? new Map(),
    calls: [] as Call[],
    /** 下一次请求先问它；返回 Response 就用它的 */
    hooks: [] as ((c: Call) => Response | null)[],
    offline: false,
    checkUser: true,
    fetch: async (url: string, init: RequestInit): Promise<Response> => {
      const c: Call = { method: init.method ?? 'GET', url, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined, init };
      p.calls.push(c);
      const hook = p.hooks.shift();
      const r = hook?.(c);
      if (r) return r;
      if (p.offline) throw new TypeError('fetch failed');
      if (url === '/api/me') return json({ user: p.user, service: 'ok', saves: p.saves });
      if (!p.user) return json({ error: 'unauthorized' }, 401);
      const q = new URL(url, 'http://x');
      // 平台 0.7.3：拉取带了 userId 而和会话不是同一个人，409 wrong_user、不给数据
      if (c.method === 'GET' && q.pathname === '/api/saves/kaipan' && p.checkUser && q.searchParams.has('userId') && q.searchParams.get('userId') !== p.user.id) return json({ error: 'wrong_user' }, 409);
      if (c.method === 'GET' && q.pathname === '/api/saves/kaipan') return json({ saves: [...p.slots].map(([slot, v]) => ({ slot, rev: v.rev, updatedAt: 1, data: v.data })) });
      const m = /^\/api\/saves\/kaipan\/([a-z0-9-]+)$/.exec(url);
      if (c.method === 'PUT' && m && c.body) {
        // 平台 0.7.1：带了 userId 而和会话不是同一个人，409 wrong_user、不写库
        if (p.checkUser && c.body.userId !== undefined && c.body.userId !== p.user.id) return json({ error: 'wrong_user' }, 409);
        const cur = p.slots.get(m[1]!);
        if ((cur?.rev ?? 0) !== c.body.baseRev) return json({ error: 'conflict', current: cur ? { rev: cur.rev, updatedAt: 1, data: cur.data } : null }, 409);
        const rev = (cur?.rev ?? 0) + 1;
        p.slots.set(m[1]!, { rev, data: c.body.data });
        return json({ rev, updatedAt: 2 });
      }
      return json({ error: 'not_found' }, 404);
    },
    puts: (): Call[] => p.calls.filter((c) => c.method === 'PUT'),
  };
  return p;
}

function clock() {
  let t = 1_000_000;
  let n = 0;
  let q: { at: number; fn: () => void; id: number }[] = [];
  return {
    now: () => t,
    setTimer: (fn: () => void, ms: number): unknown => {
      q.push({ at: t + ms, fn, id: ++n });
      return n;
    },
    clearTimer: (id: unknown): void => {
      q = q.filter((x) => x.id !== id);
    },
    pending: (): number[] => q.map((x) => x.at - t),
    async advance(ms: number): Promise<void> {
      t += ms;
      const due = q.filter((x) => x.at <= t).sort((a, b) => a.at - b.at);
      q = q.filter((x) => x.at > t);
      for (const x of due) x.fn();
      await settle();
    },
  };
}

/** 等所有已排队的 fetch / json 回来 */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

function setup(o: { store?: MemoryStore; hint?: boolean; plat?: ReturnType<typeof platform> } = {}) {
  const store = o.store ?? new MemoryStore();
  const plat = o.plat ?? platform();
  const clk = clock();
  let applied = 0;
  const deps: CloudDeps = {
    store,
    fetch: plat.fetch,
    slots: SLOTS,
    hasLoginHint: () => o.hint ?? true,
    now: clk.now,
    setTimer: clk.setTimer,
    clearTimer: clk.clearTimer,
    onApplied: () => {
      applied += 1;
    },
  };
  const cloud = new Cloud(deps);
  return { store, plat, clk, cloud, applied: () => applied };
}

function profileWith(f: (p: Profile) => void): Profile {
  const p = emptyProfile();
  f(p);
  return p;
}
const putProfile = (store: KeyValueStore, p: Profile): void => store.setItem(PROFILE_KEY, JSON.stringify(p));
const readProfile = (store: KeyValueStore): Profile => JSON.parse(store.getItem(PROFILE_KEY)!) as Profile;
const S = STOCKS.map((s) => s.id);
const A = ACHIEVEMENTS.map((a) => a.id);

describe('启动：先问登录，再取存档', () => {
  it('没有提示 cookie：一个请求都不发，云朵是未登录', async () => {
    const { cloud, plat } = setup({ hint: false });
    await cloud.start();
    expect(plat.calls).toHaveLength(0);
    expect(cloud.view.state).toBe('out');
  });

  it('先调 /api/me（存档接口不续 last_seen），再 GET 存档', async () => {
    const { cloud, plat } = setup();
    await cloud.start();
    expect(plat.calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET /api/me', 'GET /api/saves/kaipan?userId=u1']);
    expect(plat.calls[0]!.init.credentials).toBe('same-origin');
    expect(cloud.view.state).toBe('synced');
  });

  it('cookie 还在但会话失效（user 为 null）：未登录，不取存档', async () => {
    const plat = platform();
    plat.user = null;
    const { cloud } = setup({ plat });
    await cloud.start();
    expect(plat.calls).toHaveLength(1);
    expect(cloud.view.state).toBe('out');
  });

  it('/api/me 说 saves: paused：暂停同步，不取存档，本地照常', async () => {
    const plat = platform();
    plat.saves = 'paused';
    const { cloud, store } = setup({ plat });
    putProfile(store, profileWith((p) => (p.runs = 3)));
    await cloud.start();
    expect(plat.calls).toHaveLength(1);
    expect(cloud.view).toEqual({ state: 'pending', note: NOTE.paused });
    cloud.touch('profile');
    expect(plat.puts()).toHaveLength(0);
  });

  it('连不上：待上传、说明连不上；下次打开再传', async () => {
    const plat = platform();
    plat.offline = true;
    const store = new MemoryStore();
    putProfile(store, profileWith((p) => (p.runs = 2)));
    const first = setup({ plat, store });
    await first.cloud.start();
    expect(first.cloud.view).toEqual({ state: 'pending', note: NOTE.offline });
    plat.offline = false;
    const second = setup({ plat, store });
    await second.cloud.start();
    expect(plat.slots.get('profile')?.data).toMatchObject({ runs: 2 });
    expect(second.cloud.view.state).toBe('synced');
  });
});

describe('第一次同步和合并', () => {
  it('云端是空的：把本地的进度传上去（baseRev 0），记下 userId 和 rev', async () => {
    const { cloud, plat, store } = setup();
    putProfile(store, profileWith((p) => {
      p.runs = 5;
      p.seen.stocks = [S[0]!];
      p.last = 'seed|99';
    }));
    store.setItem(TUTORIAL_KEY, JSON.stringify({ v: 1, off: false, done: ['goal', 'chat'] }));
    await cloud.start();
    const puts = plat.puts();
    expect(puts.map((c) => c.url).sort()).toEqual(['/api/saves/kaipan/profile', '/api/saves/kaipan/tutorial']);
    expect(puts.every((c) => c.body?.baseRev === 0)).toBe(true);
    // 写请求带 X-Arcade、是 JSON
    const h = puts[0]!.init.headers as Record<string, string>;
    expect(h['X-Arcade']).toBe('1');
    expect(h['Content-Type']).toBe('application/json');
    // last 只在本机有意义，不上传
    expect((plat.slots.get('profile')!.data as Profile).last).toBe('');
    expect(loadMeta(store)).toEqual({ v: 1, userId: 'u1', rev: { profile: 1, tutorial: 1 }, dirty: [] });
    expect(cloud.view.state).toBe('synced');
  });

  it('本地什么都没有、云端有：直接用云端的，不上传，通知画面重画', async () => {
    const plat = platform();
    plat.slots.set('profile', { rev: 4, data: profileWith((p) => (p.wins = 2)) });
    const { cloud, store, applied } = setup({ plat });
    await cloud.start();
    expect(readProfile(store).wins).toBe(2);
    expect(plat.puts()).toHaveLength(0);
    expect(applied()).toBe(1);
    expect(loadMeta(store).rev.profile).toBe(4);
  });

  it('两边各有对方没有的：并集 / 取大，合并前备份本地，用云端的 rev 交上去，云朵是"已合并"', async () => {
    const plat = platform();
    const cloudP = profileWith((p) => {
      p.runs = 10;
      p.seen.stocks = [S[1]!];
      p.achievements[A[0]!] = 7;
    });
    plat.slots.set('profile', { rev: 3, data: cloudP });
    const { cloud, store } = setup({ plat });
    const localP = profileWith((p) => {
      p.runs = 4;
      p.wins = 3;
      p.seen.stocks = [S[0]!];
      p.achievements[A[0]!] = 2;
    });
    putProfile(store, localP);
    await cloud.start();
    const merged = readProfile(store);
    expect(merged.runs).toBe(10);
    expect(merged.wins).toBe(3);
    expect(merged.seen.stocks).toEqual([S[0], S[1]]);
    expect(merged.achievements[A[0]!]).toBe(2);
    expect(JSON.parse(store.getItem(preSyncKey('profile'))!)).toEqual(JSON.parse(JSON.stringify(localP)));
    const put = plat.puts()[0]!;
    expect(put.body?.baseRev).toBe(3);
    expect(plat.slots.get('profile')!.rev).toBe(4);
    expect(cloud.view.state).toBe('merged');
  });

  it('两边一样：不上传；再打开一次也不上传（不会每次打开都写一遍）', async () => {
    const plat = platform();
    const store = new MemoryStore();
    putProfile(store, profileWith((p) => (p.runs = 1)));
    await setup({ plat, store }).cloud.start();
    expect(plat.puts()).toHaveLength(1);
    await setup({ plat, store }).cloud.start();
    await setup({ plat, store }).cloud.start();
    expect(plat.puts()).toHaveLength(1);
  });

  it('云端的数据读不懂（不是档案）：用本地的覆盖', async () => {
    const plat = platform();
    plat.slots.set('profile', { rev: 2, data: { hello: 'x' } });
    const { cloud, store } = setup({ plat });
    putProfile(store, profileWith((p) => (p.runs = 1)));
    await cloud.start();
    expect(plat.puts()[0]!.body?.baseRev).toBe(2);
    expect(plat.slots.get('profile')!.data).toMatchObject({ runs: 1 });
  });
});

describe('改了之后上传', () => {
  async function started() {
    const s = setup();
    putProfile(s.store, profileWith((p) => (p.runs = 1)));
    await s.cloud.start();
    s.plat.calls.length = 0;
    return s;
  }

  it('静下来 10 秒才传；10 秒内再改就重新等', async () => {
    const { cloud, plat, clk, store } = await started();
    putProfile(store, profileWith((p) => (p.runs = 2)));
    cloud.touch('profile');
    expect(cloud.view.state).toBe('pending');
    await clk.advance(DEBOUNCE_MS - 1);
    expect(plat.puts()).toHaveLength(0);
    cloud.touch('profile');
    await clk.advance(DEBOUNCE_MS - 1);
    expect(plat.puts()).toHaveLength(0);
    await clk.advance(1);
    expect(plat.puts()).toHaveLength(1);
    expect(plat.slots.get('profile')!.data).toMatchObject({ runs: 2 });
    expect(cloud.view.state).toBe('synced');
  });

  it('一直在改也最多等 60 秒', async () => {
    const { cloud, plat, clk } = await started();
    for (let t = 0; t < MAX_WAIT_MS; t += 5_000) {
      cloud.touch('profile');
      await clk.advance(5_000);
    }
    expect(plat.puts()).toHaveLength(1);
  });

  it('上传途中又改了：传完仍是待上传', async () => {
    const { cloud, plat, clk } = await started();
    cloud.touch('profile');
    plat.hooks.push(() => {
      cloud.touch('profile');
      return null;
    });
    await clk.advance(DEBOUNCE_MS);
    expect(cloud.view.state).toBe('pending');
  });

  it('冲突（别的设备先写了）：合并云端的，拿它的 rev 重交，两边的东西都在', async () => {
    const { cloud, plat, clk, store } = await started();
    // 另一台设备写了一版：多见过一只股票
    plat.slots.set('profile', { rev: 2, data: profileWith((p) => {
      p.runs = 1;
      p.seen.stocks = [S[2]!];
    }) });
    putProfile(store, profileWith((p) => {
      p.runs = 3;
      p.seen.stocks = [S[0]!];
    }));
    cloud.touch('profile');
    await clk.advance(DEBOUNCE_MS);
    const puts = plat.puts();
    expect(puts.map((c) => c.body?.baseRev)).toEqual([1, 2]);
    const final = plat.slots.get('profile')!.data as Profile;
    expect(final.runs).toBe(3);
    expect(final.seen.stocks).toEqual([S[0], S[2]]);
    expect(store.getItem(preSyncKey('profile'))).not.toBeNull();
    // 两边各有对方没有的：传完显示"已合并"，下次本地再改就回到平常
    expect(cloud.view.state).toBe('merged');
    cloud.touch('profile');
    await clk.advance(DEBOUNCE_MS);
    expect(cloud.view.state).toBe('synced');
  });

  it('冲突但云端没有这个槽（被清理过）：改用 baseRev 0 重交', async () => {
    const { cloud, plat, clk } = await started();
    plat.slots.delete('profile');
    cloud.touch('profile');
    await clk.advance(DEBOUNCE_MS);
    expect(plat.puts().map((c) => c.body?.baseRev)).toEqual([1, 0]);
    expect(plat.slots.get('profile')!.rev).toBe(1);
  });

  it('429 too_soon：按 retryAfter 再传', async () => {
    const { cloud, plat, clk } = await started();
    plat.hooks.push(() => json({ error: 'too_soon', message: '慢点', retryAfter: 7 }, 429));
    cloud.touch('profile');
    await clk.advance(DEBOUNCE_MS);
    expect(plat.puts()).toHaveLength(1);
    expect(clk.pending()).toEqual([7_000]);
    await clk.advance(7_000);
    expect(plat.puts()).toHaveLength(2);
    expect(cloud.view.state).toBe('synced');
  });

  it('413：不再重试，说明太大', async () => {
    const { cloud, plat, clk } = await started();
    plat.hooks.push(() => json({ error: 'too_large', message: '太大' }, 413));
    cloud.touch('profile');
    await clk.advance(DEBOUNCE_MS);
    cloud.touch('profile');
    await clk.advance(DEBOUNCE_MS * 10);
    expect(plat.puts()).toHaveLength(1);
    expect(cloud.view).toEqual({ state: 'pending', note: NOTE.tooLarge });
  });

  it('503 busy：暂停同步，这次打开里不再传', async () => {
    const { cloud, plat, clk } = await started();
    plat.hooks.push(() => json({ error: 'busy', message: '忙' }, 503));
    cloud.touch('profile');
    await clk.advance(DEBOUNCE_MS);
    cloud.touch('profile');
    await clk.advance(DEBOUNCE_MS * 10);
    expect(plat.puts()).toHaveLength(1);
    expect(cloud.view).toEqual({ state: 'pending', note: NOTE.paused });
  });

  it('401：当作已退出', async () => {
    const { cloud, plat, clk } = await started();
    plat.hooks.push(() => json({ error: 'unauthorized', message: '' }, 401));
    cloud.touch('profile');
    await clk.advance(DEBOUNCE_MS);
    expect(cloud.view.state).toBe('out');
    cloud.touch('profile');
    await clk.advance(DEBOUNCE_MS);
    expect(plat.puts()).toHaveLength(1);
  });

  it('连不上：留着待上传，下次改了再试', async () => {
    const { cloud, plat, clk } = await started();
    plat.offline = true;
    cloud.touch('profile');
    await clk.advance(DEBOUNCE_MS);
    expect(cloud.view).toEqual({ state: 'pending', note: NOTE.offline });
    plat.offline = false;
    cloud.touch('profile');
    await clk.advance(DEBOUNCE_MS);
    expect(cloud.view.state).toBe('synced');
  });

  it('切到后台：用 keepalive 只补传一个槽，档案排前面', async () => {
    const { cloud, plat, store } = await started();
    store.setItem(TUTORIAL_KEY, JSON.stringify({ v: 1, off: false, done: ['goal'] }));
    cloud.touch('tutorial');
    cloud.touch('profile');
    cloud.hidden();
    await settle();
    const puts = plat.puts();
    expect(puts).toHaveLength(1);
    expect(puts[0]!.url).toBe('/api/saves/kaipan/profile');
    expect(puts[0]!.init.keepalive).toBe(true);
  });

  it('一次打开里 PUT 有上限（平台每天 100 次）', async () => {
    const { cloud, plat, clk } = await started();
    for (let i = 0; i < SESSION_PUTS + 10; i++) {
      cloud.touch('profile');
      await clk.advance(DEBOUNCE_MS);
    }
    expect(plat.puts().length).toBeLessThanOrEqual(SESSION_PUTS);
  });
});

describe('换了账号', () => {
  it('本地是上一个账号的：不传给新账号；没传上去的改动存起来，上一个账号回来时补上', async () => {
    const plat = platform();
    const store = new MemoryStore();
    // 账号 A 同步过，又改了没来得及传
    putProfile(store, profileWith((p) => (p.runs = 1)));
    await setup({ plat, store }).cloud.start();
    putProfile(store, profileWith((p) => {
      p.runs = 9;
      p.seen.stocks = [S[3]!];
    }));
    store.setItem(META_KEY, JSON.stringify({ ...loadMeta(store), dirty: ['profile'] }));
    const aCloud = plat.slots.get('profile')!.data;
    // 换成账号 B 登录（B 云端有自己的进度）
    plat.user = { id: 'u2' };
    plat.slots = new Map([['profile', { rev: 5, data: profileWith((p) => (p.wins = 1)) }]]);
    expect(plat.of('u1').get('profile')!.data).toEqual(aCloud);
    plat.calls.length = 0;
    await setup({ plat, store }).cloud.start();
    // B 的云端没被 A 的东西污染，本地换成了 B 的
    expect(plat.puts()).toHaveLength(0);
    expect(plat.slots.get('profile')!.data).toMatchObject({ runs: 0, wins: 1 });
    expect(readProfile(store)).toMatchObject({ runs: 0, wins: 1 });
    expect(loadMeta(store).userId).toBe('u2');
    expect(JSON.parse(store.getItem(preSwitchKey('profile', 'u1'))!)).toMatchObject({ runs: 9 });
    // A 回来：云端是 A 的那份，加上存起来的改动
    plat.user = { id: 'u1' };
    expect(plat.slots.get('profile')!.data).toEqual(aCloud);
    await setup({ plat, store }).cloud.start();
    expect(plat.slots.get('profile')!.data).toMatchObject({ runs: 9, seen: { stocks: [S[3]] } });
    expect(store.getItem(preSwitchKey('profile', 'u1'))).toBeNull();
    // 改名留底，以后不再并
    expect(JSON.parse(store.getItem(`${preSwitchKey('profile', 'u1')}.restored`)!)).toMatchObject({ runs: 9 });
  });

  it('从没同步过（没登录时玩的）：算作这个账号的首次同步，并进去', async () => {
    const plat = platform();
    plat.slots.set('profile', { rev: 2, data: profileWith((p) => (p.wins = 4)) });
    const { cloud, store } = setup({ plat });
    putProfile(store, profileWith((p) => (p.runs = 6)));
    await cloud.start();
    expect(plat.slots.get('profile')!.data).toMatchObject({ runs: 6, wins: 4 });
  });
});

describe('合并规则', () => {
  const a = profileWith((p) => {
    p.runs = 5;
    p.wins = 1;
    p.seen.stocks = [S[0]!, S[2]!];
    p.achievements[A[0]!] = 3;
    p.achievements[A[1]!] = 4;
    p.personas = [...p.personas, PERSONAS.at(-1)!.id];
    p.maxDifficulty = 2;
    p.best['newbie:1'] = { runs: 3, wins: 1, bestAccount: 500, bestMonths: 12 };
    p.daily['2026-10-01'] = { persona: 'newbie', difficulty: 1, attempts: 2, won: false, bestAccount: 0, bestMonths: 5 };
    p.segments.s1 = { id: 's1', regime: 'bull', title: '牛', runs: 2, wins: 0, story: ['本地的故事'] };
    p.knowledge = [KNOWLEDGE[0]!.id];
    p.last = 'local';
  });
  const b = profileWith((p) => {
    p.runs = 7;
    p.wins = 0;
    p.seen.stocks = [S[1]!, S[2]!];
    p.achievements[A[0]!] = 1;
    p.maxDifficulty = 4;
    p.best['newbie:1'] = { runs: 2, wins: 2, bestAccount: 900, bestMonths: 8 };
    p.best['newbie:2'] = { runs: 1, wins: 0, bestAccount: 0, bestMonths: 3 };
    p.daily['2026-10-01'] = { persona: 'newbie', difficulty: 1, attempts: 1, won: true, bestAccount: 800, bestMonths: 12 };
    p.daily['2026-10-02'] = { persona: 'newbie', difficulty: 1, attempts: 1, won: false, bestAccount: 0, bestMonths: 2 };
    p.segments.s1 = { id: 's1', regime: 'bull', title: '牛', runs: 1, wins: 1 };
    p.segments.s2 = { id: 's2', regime: 'bear', title: '熊', runs: 1, wins: 0 };
    p.knowledge = [KNOWLEDGE[1]!.id];
    p.last = 'cloud';
  });

  it('集合取并集、计数取较大、成就取较早的那局', () => {
    const m = mergeProfile(a, b);
    expect(m.runs).toBe(7);
    expect(m.wins).toBe(1);
    expect(m.seen.stocks).toEqual([S[0], S[1], S[2]]);
    expect(m.achievements).toEqual({ [A[0]!]: 1, [A[1]!]: 4 });
    expect(m.personas).toContain(PERSONAS.at(-1)!.id);
    expect(m.maxDifficulty).toBe(4);
    expect(m.best['newbie:1']).toEqual({ runs: 3, wins: 2, bestAccount: 900, bestMonths: 12 });
    expect(m.best['newbie:2']).toEqual(b.best['newbie:2']);
    expect(m.daily['2026-10-01']).toEqual({ persona: 'newbie', difficulty: 1, attempts: 2, won: true, bestAccount: 800, bestMonths: 12 });
    expect(Object.keys(m.daily).sort()).toEqual(['2026-10-01', '2026-10-02']);
    expect(m.segments.s1).toEqual({ id: 's1', regime: 'bull', title: '牛', runs: 2, wins: 1, story: ['本地的故事'] });
    expect(m.segments.s2).toEqual(b.segments.s2);
    expect(m.knowledge).toEqual([KNOWLEDGE[0]!.id, KNOWLEDGE[1]!.id]);
    expect(m.last).toBe('local');
  });

  it('换个顺序结果一样（last 除外）；和自己合并不变；不改传入的档案', () => {
    const before = JSON.stringify(a);
    const ab = { ...mergeProfile(a, b), last: '' };
    const ba = { ...mergeProfile(b, a), last: '' };
    // 行情段的小故事两边都有时取前者的，这里只有 a 有，所以顺序无关
    expect(stable(ab)).toBe(stable(ba));
    expect(stable(mergeProfile(a, a))).toBe(stable(a));
    expect(JSON.stringify(a)).toBe(before);
  });

  it('教程：看过的步骤和提示取并集，任何一边关掉就算关掉', () => {
    const m = tutorialSlot.merge({ tutorial: { v: 1, off: false, done: ['chat', 'goal'] }, tips: ['bank'] }, { tutorial: { v: 1, off: true, done: ['open'] }, tips: ['size', 'bank'] });
    expect(m).toEqual({ tutorial: { v: 1, off: true, done: ['goal', 'chat', 'open'] }, tips: ['size', 'bank'] });
  });

  it('云端来的教程数据不认识的步骤丢掉', () => {
    expect(tutorialSlot.revive({ tutorial: { off: 'yes', done: ['goal', 'hack', 1] }, tips: ['bank', '<x>'] })).toEqual({ tutorial: { v: 1, off: false, done: ['goal'] }, tips: ['bank'] });
    expect(tutorialSlot.revive('nope')).toBeNull();
  });

  it('教程槽：本地没有任何记录时算没有；只有提示记录也算有', () => {
    const s = new MemoryStore();
    expect(tutorialSlot.read(s)).toBeNull();
    s.setItem(EXT_TIPS_KEY, '["bank"]');
    expect(tutorialSlot.read(s)).toEqual({ tutorial: { v: 1, off: false, done: [] }, tips: ['bank'] });
  });
});

describe('上传的档案不超过 48 KB', () => {
  it('不大时原样（只去掉 last）', () => {
    const p = profileWith((x) => (x.last = 'abc'));
    expect(cloudProfile(p)).toEqual({ ...p, last: '' });
  });

  it('太大时先去掉行情段的小故事，再从最早的日子删每日挑战；本地那份不动', () => {
    const p = profileWith((x) => {
      for (let i = 0; i < 300; i++) x.segments[`seg${i}`] = { id: `seg${i}`, regime: 'bull', title: '一段行情', runs: 1, wins: 0, story: Array.from({ length: 12 }, () => '这是一句很长很长的小故事，讲这一局赚了谁亏了谁') };
      for (let d = 1; d <= 400; d++) {
        const day = `2025-${String(Math.ceil(d / 31)).padStart(2, '0')}-${String(((d - 1) % 31) + 1).padStart(2, '0')}`;
        x.daily[day] = { persona: 'newbie', difficulty: 1, attempts: 1, won: false, bestAccount: 0, bestMonths: 1 };
      }
    });
    const before = JSON.stringify(p);
    const c = cloudProfile(p);
    expect(new TextEncoder().encode(JSON.stringify(c)).length).toBeLessThanOrEqual(CLOUD_PROFILE_BYTES);
    expect(Object.values(c.segments).every((s) => s.story === undefined)).toBe(true);
    expect(Object.keys(c.segments)).toHaveLength(300);
    const kept = Object.keys(c.daily).sort();
    const all = Object.keys(p.daily).sort();
    expect(kept.length).toBeLessThan(all.length);
    // 删的是最早的
    expect(kept).toEqual(all.slice(all.length - kept.length));
    expect(JSON.stringify(p)).toBe(before);
  });
});

describe('换账号和多标签页的坑（掼蛋审出来的，旧仓库 PR 28）', () => {
  /** u1 同步过、又有没传上去的改动的一台设备 */
  async function deviceOfU1() {
    const plat = platform();
    const store = new MemoryStore();
    putProfile(store, profileWith((p) => (p.runs = 1)));
    await setup({ plat, store }).cloud.start();
    putProfile(store, profileWith((p) => {
      p.runs = 9;
      p.seen.stocks = [S[3]!];
    }));
    store.setItem(META_KEY, JSON.stringify({ ...loadMeta(store), dirty: ['profile'] }));
    plat.calls.length = 0;
    return { plat, store };
  }

  for (const [why, hook] of [
    ['取存档时连不上', (c: Call) => (c.url.startsWith('/api/saves/kaipan?') ? (() => { throw new TypeError('fetch failed'); })() : null)],
    ['取存档时 401', (c: Call) => (c.url.startsWith('/api/saves/kaipan?') ? json({ error: 'unauthorized' }, 401) : null)],
    ['取存档时 429', (c: Call) => (c.url.startsWith('/api/saves/kaipan?') ? json({ error: 'rate_limited', retryAfter: 5 }, 429) : null)],
  ] as const) {
    it(`换账号到一半断了（${why}）：下次打开不会把旧账号的东西当成首次同步传给新账号`, async () => {
      const { plat, store } = await deviceOfU1();
      plat.user = { id: 'u2' };
      plat.hooks.push(() => null, hook as (c: Call) => Response | null);
      const first = setup({ plat, store });
      await first.cloud.start().catch(() => undefined);
      expect(first.cloud.view.state).not.toBe('synced');
      // 一认出换了账号就落盘：元数据已是 u2、本地是空档、u1 的那份存起来了
      expect(loadMeta(store).userId).toBe('u2');
      expect(readProfile(store).runs).toBe(0);
      expect(JSON.parse(store.getItem(preSwitchKey('profile', 'u1'))!)).toMatchObject({ runs: 9 });
      await setup({ plat, store }).cloud.start();
      const u2 = plat.of('u2').get('profile');
      expect(u2 === undefined || (u2.data as Profile).runs === 0).toBe(true);
      expect(plat.puts().every((c) => (c.body?.data as Profile | undefined)?.runs !== 9)).toBe(true);
    });
  }

  it('合并前的备份和换账号的备份分开存，不互相覆盖', async () => {
    const { plat, store } = await deviceOfU1();
    plat.user = { id: 'u2' };
    plat.slots = new Map([['profile', { rev: 2, data: profileWith((p) => (p.wins = 5)) }]]);
    // 新账号在这台设备上以前存过一份（会并回来，和云端合并 → 写 pre-sync）
    store.setItem(preSwitchKey('profile', 'u2'), JSON.stringify(profileWith((p) => (p.runs = 4))));
    await setup({ plat, store }).cloud.start();
    expect(JSON.parse(store.getItem(preSwitchKey('profile', 'u1'))!)).toMatchObject({ runs: 9 });
    expect(JSON.parse(store.getItem(preSyncKey('profile'))!)).toMatchObject({ runs: 4 });
    expect(plat.slots.get('profile')!.data).toMatchObject({ runs: 4, wins: 5 });
  });

  it('页面开着时别的标签页换了账号：过了 1 分钟上传前先确认，不拿 u1 的数据传给 u2', async () => {
    const s = setup();
    putProfile(s.store, profileWith((p) => (p.runs = 3)));
    await s.cloud.start();
    s.plat.user = { id: 'u2' };
    s.plat.slots = new Map([['profile', { rev: 1, data: profileWith((p) => (p.wins = 7)) }]]);
    putProfile(s.store, profileWith((p) => (p.runs = 8)));
    await s.clk.advance(RECHECK_MS);
    s.cloud.touch('profile');
    await s.clk.advance(DEBOUNCE_MS);
    await settle();
    // u2 的云端没被 u1 的进度覆盖（rev 碰巧一样也不行）
    expect(s.plat.of('u2').get('profile')!.data).toMatchObject({ runs: 0, wins: 7 });
    expect(loadMeta(s.store).userId).toBe('u2');
    expect(JSON.parse(s.store.getItem(preSwitchKey('profile', 'u1'))!)).toMatchObject({ runs: 8 });
  });

  it('换账号后收到 409（current 为 null）：先确认账号，不用 baseRev 0 把 u1 的整份写进 u2', async () => {
    const s = setup();
    putProfile(s.store, profileWith((p) => (p.runs = 3)));
    await s.cloud.start();
    s.plat.user = { id: 'u2' };
    const before = s.plat.puts().length;
    s.cloud.touch('profile');
    await s.clk.advance(DEBOUNCE_MS);
    await settle();
    const u2 = s.plat.of('u2').get('profile');
    expect(u2 === undefined || (u2.data as Profile).runs !== 3).toBe(true);
    // 换账号之后只发过那一次撞上 409 的 PUT，没有用 0 重交
    expect(s.plat.puts().slice(before).map((c) => c.body?.baseRev)).toEqual([1]);
  });

  it('切回前台隔 1 分钟以上才重新问 /api/me', async () => {
    const s = setup();
    await s.cloud.start();
    const me = (): number => s.plat.calls.filter((c) => c.url === '/api/me').length;
    s.cloud.visible();
    await settle();
    expect(me()).toBe(1);
    await s.clk.advance(RECHECK_MS);
    s.cloud.visible();
    await settle();
    expect(me()).toBe(2);
  });

  it('连不上或停服时不显示"未登录"；只有平台明确说没登录才是', async () => {
    for (const reply of [() => { throw new TypeError('fetch failed'); }, () => json({ error: 'busy' }, 503), () => json({ hello: 1 })]) {
      const plat = platform();
      plat.hooks.push(reply);
      const { cloud } = setup({ plat });
      await cloud.start();
      expect(cloud.view.state).toBe('pending');
      expect(cloud.view.note).not.toBeNull();
    }
  });

  it('429 的 retryAfter 不会被之后的改动提前', async () => {
    const s = setup();
    putProfile(s.store, profileWith((p) => (p.runs = 1)));
    await s.cloud.start();
    s.plat.hooks.push(() => json({ error: 'too_soon', retryAfter: 30 }, 429));
    s.cloud.touch('profile');
    await s.clk.advance(DEBOUNCE_MS);
    expect(s.plat.puts()).toHaveLength(2);
    s.cloud.touch('profile');
    await s.clk.advance(DEBOUNCE_MS);
    expect(s.plat.puts()).toHaveLength(2);
    await s.clk.advance(30_000 - DEBOUNCE_MS);
    expect(s.plat.puts()).toHaveLength(3);
  });

  it('切到后台补传两次之间至少隔 3 分钟', async () => {
    const s = setup();
    putProfile(s.store, profileWith((p) => (p.runs = 1)));
    await s.cloud.start();
    const kept = (): number => s.plat.puts().filter((c) => c.init.keepalive === true).length;
    s.cloud.touch('profile');
    s.cloud.hidden();
    await settle();
    s.cloud.touch('profile');
    s.cloud.hidden();
    await settle();
    expect(kept()).toBe(1);
    await s.clk.advance(HIDDEN_GAP_MS);
    s.cloud.touch('profile');
    s.cloud.hidden();
    await settle();
    expect(kept()).toBe(2);
  });

  it('点了「大厅」要离开（0.5.8）：刚补传过也再补传一次；紧接着离开页面的 visibilitychange 不重复传', async () => {
    const s = setup();
    putProfile(s.store, profileWith((p) => (p.runs = 1)));
    await s.cloud.start();
    const kept = (): number => s.plat.puts().filter((c) => c.init.keepalive === true).length;
    s.cloud.touch('profile');
    s.cloud.hidden();
    await settle();
    s.cloud.touch('profile');
    s.cloud.hidden(true);
    await settle();
    expect(kept()).toBe(2);
    expect(s.cloud.view.state).toBe('synced');
    s.cloud.touch('profile');
    s.cloud.hidden();
    await settle();
    expect(kept()).toBe(2);
  });

  it('离开时档案和教程都待上传：两个都补传（keepalive，档案在前）', async () => {
    const s = setup();
    putProfile(s.store, profileWith((p) => (p.runs = 1)));
    await s.cloud.start();
    putProfile(s.store, profileWith((p) => (p.runs = 2)));
    s.store.setItem(TUTORIAL_KEY, JSON.stringify({ v: 1, off: false, done: ['goal'] }));
    s.cloud.touch('profile');
    s.cloud.touch('tutorial');
    s.plat.calls.length = 0;
    s.cloud.hidden(true);
    await settle();
    expect(s.plat.puts().map((c) => [c.url, c.init.keepalive])).toEqual([
      ['/api/saves/kaipan/profile', true],
      ['/api/saves/kaipan/tutorial', true],
    ]);
    expect(s.cloud.view.state).toBe('synced');
  });

  it('离开时档案正有普通请求在途（页面一走会被取消）：再补一个 keepalive；已经是 keepalive 在途的不重复', async () => {
    const s = setup();
    putProfile(s.store, profileWith((p) => (p.runs = 1)));
    await s.cloud.start();
    let release: (() => void) | null = null;
    s.plat.hooks.push((c) => (c.method === 'PUT' ? (new Promise<Response>((r) => (release = () => r(json({ rev: 2, updatedAt: 2 })))) as unknown as Response) : null));
    putProfile(s.store, profileWith((p) => (p.runs = 2)));
    s.cloud.touch('profile');
    await s.clk.advance(DEBOUNCE_MS);
    expect(s.plat.puts().map((c) => c.init.keepalive)).toEqual([false, false]);
    s.cloud.hidden(true);
    await settle();
    const puts = s.plat.puts().slice(1);
    expect(puts.map((c) => c.init.keepalive)).toEqual([false, true]);
    expect(puts[1]!.body).toEqual(puts[0]!.body);
    // 先发的回来了：照常记下 rev，不再待上传
    release!();
    await settle();
    expect(s.cloud.view.state).toBe('synced');
    // keepalive 在途时再离开：不再补
    s.plat.hooks.push((c) => (c.method === 'PUT' ? (new Promise<Response>(() => undefined) as unknown as Response) : null));
    putProfile(s.store, profileWith((p) => (p.runs = 3)));
    s.cloud.touch('profile');
    s.cloud.hidden(true);
    await settle();
    const n = s.plat.puts().length;
    s.cloud.hidden(true);
    await settle();
    expect(s.plat.puts().length).toBe(n);
  });

  it('补过 keepalive 的槽（0.5.11）：再点一次「大厅」不再补；补的那份回来了、页面还在，再离开才再补', async () => {
    const s = setup();
    putProfile(s.store, profileWith((p) => (p.runs = 1)));
    await s.cloud.start();
    const pending: (() => void)[] = [];
    const hang = (c: { method: string }): Response | null => (c.method === 'PUT' ? (new Promise<Response>((r) => pending.push(() => r(json({ error: 'conflict' }, 409))))) as unknown as Response : null);
    s.plat.hooks.push(hang, hang);
    putProfile(s.store, profileWith((p) => (p.runs = 2)));
    s.cloud.touch('profile');
    await s.clk.advance(DEBOUNCE_MS);
    s.cloud.hidden(true);
    await settle();
    s.cloud.hidden(true);
    await settle();
    const kept = (): number => s.plat.puts().filter((c) => c.init.keepalive === true).length;
    expect(kept()).toBe(1);
    // 补的那份回来了（普通的还在途）：这时再离开可以再补
    pending[1]!();
    await settle();
    s.cloud.hidden(true);
    await settle();
    expect(kept()).toBe(2);
  });

  it('离开时的额度扣掉已经在途的 keepalive（0.5.11，比如交分）：剩的不够就不补', async () => {
    const s = setup();
    putProfile(s.store, profileWith((p) => (p.runs = 1)));
    await s.cloud.start();
    putProfile(s.store, profileWith((p) => (p.runs = 2)));
    s.cloud.touch('profile');
    s.plat.calls.length = 0;
    let release: () => void = () => undefined;
    const other = keepaliveSend('x'.repeat(KEEPALIVE_BYTES - 100), () => new Promise<void>((r) => (release = r)));
    expect(keepaliveLeft()).toBe(100);
    s.cloud.hidden(true);
    await settle();
    expect(s.plat.puts()).toHaveLength(0);
    // 在途的回来了，额度还回去：再离开就补上（补的这份自己也记账，回来后还回去）
    release();
    await other;
    expect(keepaliveLeft()).toBe(KEEPALIVE_BYTES);
    s.cloud.hidden(true);
    await settle();
    expect(s.plat.puts().map((c) => c.init.keepalive)).toEqual([true]);
    expect(keepaliveLeft()).toBe(KEEPALIVE_BYTES);
  });

  it('离开时额度不够、没补成（0.5.12）：原来排好的普通上传不清掉；没排的给排一个', async () => {
    const s = setup();
    putProfile(s.store, profileWith((p) => (p.runs = 1)));
    await s.cloud.start();
    let release: () => void = () => undefined;
    const other = keepaliveSend('x'.repeat(KEEPALIVE_BYTES - 100), () => new Promise<void>((r) => (release = r)));
    // 已经排好了普通上传，过了一半时离开：补不成，原来那个照常到点就传（不是从头再等）
    putProfile(s.store, profileWith((p) => (p.runs = 2)));
    s.cloud.touch('profile');
    await s.clk.advance(DEBOUNCE_MS / 2);
    s.plat.calls.length = 0;
    s.cloud.hidden(true);
    await settle();
    expect(s.plat.puts()).toHaveLength(0);
    await s.clk.advance(DEBOUNCE_MS / 2);
    expect(s.plat.puts().map((c) => c.init.keepalive)).toEqual([false]);
    // 上一次普通上传连不上（不再排），这时离开又补不成：给排一个，页面没走成照样传上
    putProfile(s.store, profileWith((p) => (p.runs = 3)));
    s.cloud.touch('profile');
    s.plat.offline = true;
    await s.clk.advance(DEBOUNCE_MS);
    s.plat.offline = false;
    expect(s.clk.pending()).toHaveLength(0);
    s.plat.calls.length = 0;
    s.cloud.hidden(true);
    await settle();
    expect(s.plat.puts()).toHaveLength(0);
    expect(s.clk.pending()).toEqual([DEBOUNCE_MS]);
    await s.clk.advance(DEBOUNCE_MS);
    expect(s.plat.puts().map((c) => c.init.keepalive)).toEqual([false]);
    expect(s.cloud.view.state).toBe('synced');
    release();
    await other;
  });

  it('多标签页：别的页传完的槽，本页记下新 rev、不再显示待上传，也不重复上传', async () => {
    const plat = platform();
    const store = new MemoryStore();
    putProfile(store, profileWith((p) => (p.runs = 1)));
    const a = setup({ plat, store });
    const b = setup({ plat, store });
    await a.cloud.start();
    await b.cloud.start();
    putProfile(store, profileWith((p) => (p.runs = 2)));
    a.cloud.touch('profile');
    b.cloud.touch('profile');
    await a.clk.advance(DEBOUNCE_MS);
    expect(plat.puts()).toHaveLength(2);
    b.cloud.absorb();
    expect(b.cloud.view.state).toBe('synced');
    await b.clk.advance(DEBOUNCE_MS);
    expect(plat.puts()).toHaveLength(2);
  });

  it('多标签页：别的页认出换了账号，本页也跟着重来', async () => {
    const plat = platform();
    const store = new MemoryStore();
    putProfile(store, profileWith((p) => (p.runs = 1)));
    const a = setup({ plat, store });
    const b = setup({ plat, store });
    await a.cloud.start();
    await b.cloud.start();
    plat.user = { id: 'u2' };
    await setup({ plat, store }).cloud.start();
    a.cloud.absorb();
    await settle();
    const me = plat.calls.filter((c) => c.url === '/api/me').length;
    expect(me).toBeGreaterThanOrEqual(4);
    expect(loadMeta(store).userId).toBe('u2');
  });
});

describe('上传带上确认过的账号（平台 0.7.1 的 wrong_user）', () => {
  it('每个 PUT 都带最近一次 /api/me 确认的 userId', async () => {
    const s = setup();
    putProfile(s.store, profileWith((p) => (p.runs = 1)));
    await s.cloud.start();
    s.cloud.touch('profile');
    s.cloud.hidden();
    await settle();
    expect(s.plat.puts().length).toBeGreaterThanOrEqual(2);
    expect(s.plat.puts().every((c) => c.body?.userId === 'u1')).toBe(true);
  });

  it('1 分钟内别的标签页换了账号（还没到重新确认的时候）：平台回 wrong_user，不写库，按换账号从头来', async () => {
    const s = setup();
    putProfile(s.store, profileWith((p) => (p.runs = 3)));
    await s.cloud.start();
    s.plat.user = { id: 'u2' };
    s.plat.slots = new Map([['profile', { rev: 1, data: profileWith((p) => (p.wins = 7)) }]]);
    putProfile(s.store, profileWith((p) => (p.runs = 8)));
    s.cloud.touch('profile');
    await s.clk.advance(DEBOUNCE_MS);
    await settle();
    expect(s.plat.of('u2').get('profile')!.data).toMatchObject({ runs: 0, wins: 7 });
    expect(loadMeta(s.store).userId).toBe('u2');
    expect(JSON.parse(s.store.getItem(preSwitchKey('profile', 'u1'))!)).toMatchObject({ runs: 8 });
  });
});

describe('独立审阅（旧仓库 PR 31）：旧标签页、备份失败、重试', () => {
  /** u1（alice）同步过的设备 */
  async function synced(runs = 5) {
    const plat = platform();
    const store = new MemoryStore();
    putProfile(store, profileWith((p) => {
      p.runs = runs;
      p.seen.stocks = [S[0]!];
    }));
    await setup({ plat, store }).cloud.start();
    return { plat, store };
  }

  it('没启动的旧标签页（已退出）在别的页换成 u2 之后改了档案：不把磁盘元数据改回 u1，也不覆盖 u1 的备份', async () => {
    const { plat, store } = await synced();
    // 标签页 A：打开时已退出（没有提示 cookie），内存里的元数据是 u1
    const a = setup({ plat, store, hint: false });
    await a.cloud.start();
    expect(a.cloud.view.state).toBe('out');
    // 标签页 B：u2 登录
    plat.user = { id: 'u2' };
    plat.slots = new Map([['profile', { rev: 3, data: profileWith((p) => (p.wins = 2)) }]]);
    await setup({ plat, store }).cloud.start();
    const backup = store.getItem(preSwitchKey('profile', 'u1'));
    expect(JSON.parse(backup!)).toMatchObject({ runs: 5 });
    // A 里打完一局
    putProfile(store, { ...readProfile(store), runs: 1 });
    a.cloud.touch('profile');
    expect(loadMeta(store).userId).toBe('u2');
    // 下次以 u2 打开：不再走换账号，u1 的备份原样
    await setup({ plat, store }).cloud.start();
    expect(store.getItem(preSwitchKey('profile', 'u1'))).toBe(backup);
    // u1 回来：拿回的是 u1 自己的进度，没有 u2 的
    plat.user = { id: 'u1' };
    await setup({ plat, store }).cloud.start();
    const u1 = plat.of('u1').get('profile')!.data as Profile;
    expect(u1.runs).toBe(5);
    expect(u1.wins).toBe(0);
  });

  it('已启动的旧标签页（u1）在别的页换成 u2 之后改了档案：不改回磁盘元数据，不把本地传给任何人', async () => {
    const { plat, store } = await synced();
    const a = setup({ plat, store });
    await a.cloud.start();
    plat.user = { id: 'u2' };
    await setup({ plat, store }).cloud.start();
    const backup = store.getItem(preSwitchKey('profile', 'u1'));
    const u1Before = JSON.stringify(plat.of('u1').get('profile'));
    putProfile(store, { ...readProfile(store), runs: 2 });
    a.cloud.touch('profile');
    expect(loadMeta(store).userId).toBe('u2');
    await a.clk.advance(DEBOUNCE_MS);
    a.cloud.hidden();
    await settle();
    expect(JSON.stringify(plat.of('u1').get('profile'))).toBe(u1Before);
    expect(store.getItem(preSwitchKey('profile', 'u1'))).toBe(backup);
    expect(loadMeta(store).userId).toBe('u2');
  });

  it('换账号的备份已有一份时合并进去，不覆盖', async () => {
    const { plat, store } = await synced();
    store.setItem(preSwitchKey('profile', 'u1'), JSON.stringify(profileWith((p) => (p.seen.stocks = [S[4]!]))));
    plat.user = { id: 'u2' };
    await setup({ plat, store }).cloud.start();
    expect((JSON.parse(store.getItem(preSwitchKey('profile', 'u1'))!) as Profile).seen.stocks).toEqual([S[0], S[4]]);
  });

  it('换账号时备份存不上（存储满了）：本地不清、元数据不改，云朵说明原因', async () => {
    const { plat, store } = await synced();
    const full = new (class extends MemoryStore {
      override setItem(k: string, v: string): void {
        if (k.includes('.pre-switch.')) throw new Error('QuotaExceededError');
        super.setItem(k, v);
      }
    })();
    full.data = new Map(store.data);
    plat.user = { id: 'u2' };
    const { cloud } = setup({ plat, store: full });
    await cloud.start();
    expect(readProfile(full).runs).toBe(5);
    expect(loadMeta(full).userId).toBe('u1');
    expect(cloud.view).toEqual({ state: 'pending', note: NOTE.storage });
    expect(plat.puts().filter((c) => c.body?.userId === 'u2')).toHaveLength(0);
  });

  it('合并前的备份存不上：本地不动，rev 不记成云端的（不会拿没合进去的本地覆盖云端）', async () => {
    const plat = platform();
    plat.slots.set('profile', { rev: 6, data: profileWith((p) => (p.wins = 9)) });
    const full = new (class extends MemoryStore {
      override setItem(k: string, v: string): void {
        if (k.endsWith('.pre-sync')) throw new Error('QuotaExceededError');
        super.setItem(k, v);
      }
    })();
    putProfile(full, profileWith((p) => (p.runs = 3)));
    const { cloud } = setup({ plat, store: full });
    await cloud.start();
    expect(readProfile(full)).toMatchObject({ runs: 3, wins: 0 });
    expect(loadMeta(full).rev.profile ?? 0).not.toBe(6);
    expect(plat.puts()).toHaveLength(0);
    expect(cloud.view.note).toBe(NOTE.storage);
  });

  it('429 之后切到后台也不抢跑 keepalive', async () => {
    const s = setup();
    putProfile(s.store, profileWith((p) => (p.runs = 1)));
    await s.cloud.start();
    s.plat.hooks.push(() => json({ error: 'too_soon', retryAfter: 30 }, 429));
    s.cloud.touch('profile');
    await s.clk.advance(DEBOUNCE_MS);
    const n = s.plat.puts().length;
    s.cloud.hidden();
    await settle();
    expect(s.plat.puts()).toHaveLength(n);
  });

  it('不是 busy 的 503（网关、不是 JSON）按连不上，不当停服', async () => {
    const s = setup();
    putProfile(s.store, profileWith((p) => (p.runs = 1)));
    await s.cloud.start();
    s.plat.hooks.push(() => new Response('<html>bad gateway</html>', { status: 503 }));
    s.cloud.touch('profile');
    await s.clk.advance(DEBOUNCE_MS);
    expect(s.cloud.view).toEqual({ state: 'pending', note: NOTE.offline });
    s.cloud.touch('profile');
    await s.clk.advance(DEBOUNCE_MS);
    expect(s.cloud.view.state).toBe('synced');
  });

  it('打开时连不上：回到前台隔 1 分钟以上再从头试；未登录的页登录后同理', async () => {
    const plat = platform();
    plat.offline = true;
    const s = setup({ plat });
    putProfile(s.store, profileWith((p) => (p.runs = 4)));
    await s.cloud.start();
    expect(s.cloud.view.state).toBe('pending');
    plat.offline = false;
    s.cloud.visible();
    await settle();
    expect(plat.puts()).toHaveLength(0);
    await s.clk.advance(RECHECK_MS);
    s.cloud.visible();
    await settle();
    expect(plat.slots.get('profile')?.data).toMatchObject({ runs: 4 });
    expect(s.cloud.view.state).toBe('synced');

    const plat2 = platform();
    plat2.user = null;
    const t = setup({ plat: plat2 });
    await t.cloud.start();
    expect(t.cloud.view.state).toBe('out');
    plat2.user = { id: 'u9' };
    await t.clk.advance(RECHECK_MS);
    t.cloud.visible();
    await settle();
    expect(t.cloud.view.state).toBe('synced');
  });

  it('wrong_user 回包里就算带了 current 也不合并、不重交', async () => {
    const s = setup();
    putProfile(s.store, profileWith((p) => (p.runs = 3)));
    await s.cloud.start();
    const n = s.plat.puts().length;
    s.plat.hooks.push(() => json({ error: 'wrong_user', current: { rev: 9, updatedAt: 1, data: profileWith((p) => (p.runs = 77)) } }, 409));
    s.cloud.touch('profile');
    await s.clk.advance(DEBOUNCE_MS);
    await settle();
    const after = s.plat.puts().slice(n);
    expect(after).toHaveLength(1);
    expect(readProfile(s.store).runs).not.toBe(77);
  });
});

describe('一层一层的保护各自都管用（没有 wrong_user 兜底时）', () => {
  /** u1 同步过；标签页 A 以 u1 启动；标签页 B 换成 u2（本地换成 u2 的进度） */
  async function twoTabs() {
    const plat = platform();
    const store = new MemoryStore();
    putProfile(store, profileWith((p) => {
      p.runs = 5;
      p.seen.stocks = [S[0]!];
    }));
    const a = setup({ plat, store });
    await a.cloud.start();
    plat.user = { id: 'u2' };
    plat.slots = new Map([['profile', { rev: 3, data: profileWith((p) => (p.wins = 8)) }]]);
    await setup({ plat, store }).cloud.start();
    expect(readProfile(store).wins).toBe(8);
    return { plat, store, a };
  }

  it('切后台补传来不及问 /api/me：磁盘上已是别的账号就不传（cookie 又换回 u1 也不行）', async () => {
    const { plat, a } = await twoTabs();
    plat.user = { id: 'u1' };
    a.cloud.touch('profile');
    a.cloud.hidden();
    await settle();
    expect((plat.of('u1').get('profile')!.data as Profile).wins).toBe(0);
  });

  it('cookie 换回 u1、磁盘还是 u2：回到前台后本页按换号处理（u2 的本地进度存起来，拉 u1 的）', async () => {
    const { plat, store, a } = await twoTabs();
    plat.user = { id: 'u1' };
    await a.clk.advance(RECHECK_MS);
    a.cloud.visible();
    await settle();
    expect(loadMeta(store).userId).toBe('u1');
    expect(JSON.parse(store.getItem(preSwitchKey('profile', 'u2'))!)).toMatchObject({ wins: 8 });
    expect(readProfile(store)).toMatchObject({ runs: 5, wins: 0 });
  });

  it('页面打开后、启动前别的页换了号：启动时以磁盘为准，不把 u2 的进度当成 u1 的备份', async () => {
    const plat = platform();
    const store = new MemoryStore();
    putProfile(store, profileWith((p) => (p.runs = 5)));
    await setup({ plat, store }).cloud.start();
    const late = setup({ plat, store });
    plat.user = { id: 'u2' };
    plat.slots = new Map([['profile', { rev: 3, data: profileWith((p) => (p.wins = 8)) }]]);
    await setup({ plat, store }).cloud.start();
    const backup = store.getItem(preSwitchKey('profile', 'u1'));
    await late.cloud.start();
    expect(store.getItem(preSwitchKey('profile', 'u1'))).toBe(backup);
    expect(JSON.parse(backup!)).toMatchObject({ runs: 5, wins: 0 });
  });

  it('换号时清本地没写上（存储报错但被吞掉）：不换号，u1 的进度不进 u2', async () => {
    const plat = platform();
    const store = new (class extends MemoryStore {
      broken = false;
      override setItem(k: string, v: string): void {
        if (this.broken && k === PROFILE_KEY) throw new Error('QuotaExceededError');
        super.setItem(k, v);
      }
    })();
    putProfile(store, profileWith((p) => (p.runs = 5)));
    await setup({ plat, store }).cloud.start();
    store.broken = true;
    plat.user = { id: 'u2' };
    const { cloud } = setup({ plat, store });
    await cloud.start();
    expect(plat.of('u2').get('profile')).toBeUndefined();
    expect(cloud.view.note).toBe(NOTE.storage);
  });

  for (const check of [true, false]) {
    const tag = check ? '平台校验 userId' : '平台不校验 userId';
    it(`（${tag}）过了 1 分钟上传前先确认账号，u1 的进度不传给 u2`, async () => {
      const s = setup();
      s.plat.checkUser = check;
      putProfile(s.store, profileWith((p) => (p.runs = 3)));
      await s.cloud.start();
      s.plat.user = { id: 'u2' };
      s.plat.slots = new Map([['profile', { rev: 1, data: profileWith((p) => (p.wins = 7)) }]]);
      putProfile(s.store, profileWith((p) => (p.runs = 8)));
      await s.clk.advance(RECHECK_MS);
      s.cloud.touch('profile');
      await s.clk.advance(DEBOUNCE_MS);
      await settle();
      expect(s.plat.of('u2').get('profile')!.data).toMatchObject({ runs: 0, wins: 7 });
    });

    it(`（${tag}）409 之后先确认账号，不用 0 重交`, async () => {
      const s = setup();
      s.plat.checkUser = check;
      putProfile(s.store, profileWith((p) => (p.runs = 3)));
      await s.cloud.start();
      s.plat.user = { id: 'u2' };
      s.cloud.touch('profile');
      await s.clk.advance(DEBOUNCE_MS);
      await settle();
      const u2 = s.plat.of('u2').get('profile');
      expect(u2 === undefined || (u2.data as Profile).runs !== 3).toBe(true);
    });
  }

  it('拉取时 cookie 换成了别人（GET 回 wrong_user）：不用回来的数据，按换号从头来', async () => {
    const plat = platform();
    const store = new MemoryStore();
    putProfile(store, profileWith((p) => (p.runs = 5)));
    await setup({ plat, store }).cloud.start();
    plat.of('u2');
    plat.hooks.push(() => null, (c) => {
      // /api/me 刚说完 u1，拉取前 cookie 换成 u2
      if (c.url.startsWith('/api/saves/kaipan?')) plat.user = { id: 'u2' };
      return null;
    });
    const { cloud } = setup({ plat, store });
    await cloud.start();
    await settle();
    expect(plat.calls.some((c) => c.url === '/api/saves/kaipan?userId=u1')).toBe(true);
    expect(loadMeta(store).userId).toBe('u2');
    expect(JSON.parse(store.getItem(preSwitchKey('profile', 'u1'))!)).toMatchObject({ runs: 5 });
    const u2 = plat.of('u2').get('profile');
    expect(u2 === undefined || (u2.data as Profile).runs !== 5).toBe(true);
  });
});

describe('复审（旧仓库 PR 31）：拉取回来时、换号恢复途中、教程重开、确认节流', () => {
  /** u1 同步过（本地 runs 5），之后别的设备往 u1 的云端加了 S[7] */
  async function u1Device() {
    const plat = platform();
    const store = new MemoryStore();
    putProfile(store, profileWith((p) => (p.runs = 5)));
    await setup({ plat, store }).cloud.start();
    plat.slots.set('profile', { rev: 2, data: profileWith((p) => {
      p.runs = 6;
      p.seen.stocks = [S[7]!];
    }) });
    return { plat, store };
  }

  it('拉取回来之前别的标签页换成了 u2：不把 u1 的云端合进 u2 的本地，也不传', async () => {
    const { plat, store } = await u1Device();
    plat.hooks.push(() => null, () => {
      // 回包路上：别的标签页认出 u2、把本地换成了 u2 的进度；这次回来的仍是 u1 的数据
      const u1 = json({ saves: [...plat.of('u1')].map(([slot, v]) => ({ slot, rev: v.rev, updatedAt: 1, data: v.data })) });
      plat.user = { id: 'u2' };
      store.setItem(META_KEY, JSON.stringify({ v: 1, userId: 'u2', rev: {}, dirty: ['profile'] }));
      putProfile(store, profileWith((p) => (p.wins = 8)));
      return u1;
    });
    const { cloud } = setup({ plat, store });
    await cloud.start();
    await settle();
    const local = readProfile(store);
    expect(local).toMatchObject({ wins: 8, runs: 0 });
    expect(local.seen.stocks).not.toContain(S[7]);
    expect(loadMeta(store).userId).toBe('u2');
    expect(plat.of('u1').get('profile')!.rev).toBe(2);
    const u2 = plat.of('u2').get('profile')!.data as Profile;
    expect(u2.seen.stocks).not.toContain(S[7]);
    expect(u2.wins).toBe(8);
    // 磁盘上不留 u2 名下的"u1 备份"
    expect(store.getItem(preSwitchKey('profile', 'u2'))).toBeNull();
  });

  it('换号后并回这个账号以前的进度时存储满了：先记成新账号；下次打开接着并完再改名，旧账号的备份不混进新账号的东西', async () => {
    const plat = platform();
    const store = new (class extends MemoryStore {
      broken = false;
      override setItem(k: string, v: string): void {
        if (this.broken && k === TUTORIAL_KEY && v.includes('goal')) throw new Error('QuotaExceededError');
        super.setItem(k, v);
      }
    })();
    putProfile(store, profileWith((p) => (p.runs = 5)));
    await setup({ plat, store }).cloud.start();
    // u2 以前在这台设备上被换走时存下的
    const pk = preSwitchKey('profile', 'u2');
    const tk = preSwitchKey('tutorial', 'u2');
    store.setItem(pk, JSON.stringify(profileWith((p) => (p.wins = 4))));
    store.setItem(tk, JSON.stringify({ tutorial: { v: 1, off: false, done: ['goal'] }, tips: ['bank'] }));
    store.setItem(`${pk}.restored`, '"更早的一份"');
    store.broken = true;
    plat.user = { id: 'u2' };
    const first = setup({ plat, store });
    await first.cloud.start();
    expect(first.cloud.view.note).toBe(NOTE.storage);
    expect(loadMeta(store).userId).toBe('u2');
    expect(store.getItem(pk)).not.toBeNull();
    expect(store.getItem(tk)).not.toBeNull();
    // 没全并完就不改名（改了名的那槽以后就不会再并）
    expect(store.getItem(`${pk}.restored`)).toBe('"更早的一份"');
    expect(JSON.parse(store.getItem(preSwitchKey('profile', 'u1'))!)).toMatchObject({ runs: 5, wins: 0 });
    expect(plat.puts().filter((c) => c.url.endsWith('/profile') && (c.body?.data as Profile).wins === 4)).toEqual([]);
    // 存储好了，下次打开：不再走换号（u1 的备份原样），把剩下的并完、改名
    store.broken = false;
    const u1Backup = store.getItem(preSwitchKey('profile', 'u1'));
    await setup({ plat, store }).cloud.start();
    expect(store.getItem(preSwitchKey('profile', 'u1'))).toBe(u1Backup);
    expect(readProfile(store)).toMatchObject({ wins: 4, runs: 0 });
    expect(JSON.parse(store.getItem(TUTORIAL_KEY)!).done).toEqual(['goal']);
    expect(store.getItem(pk)).toBeNull();
    expect(store.getItem(tk)).toBeNull();
    // 每个账号每个槽只留最近一份
    expect(JSON.parse(store.getItem(`${pk}.restored`)!)).toMatchObject({ wins: 4 });
    expect(store.getItem(`${tk}.restored`)).not.toBeNull();
    expect((plat.of('u2').get('profile')!.data as Profile).wins).toBe(4);
  });

  it('教程：重新开启过的次数多的一边整个说了算；次数一样才取并集', () => {
    const reset = { tutorial: { v: 1 as const, off: false, done: [], reset: 2 }, tips: ['bank' as const] };
    const old = { tutorial: { v: 1 as const, off: true, done: ['goal' as const, 'chat' as const], reset: 1 }, tips: ['size' as const] };
    for (const m of [tutorialSlot.merge(reset, old), tutorialSlot.merge(old, reset)]) {
      expect(m.tutorial).toEqual({ v: 1, off: false, done: [], reset: 2 });
      expect([...m.tips].sort()).toEqual(['bank', 'size']);
    }
    const same = tutorialSlot.merge({ ...reset, tutorial: { ...reset.tutorial, done: ['chat'] } }, { ...old, tutorial: { ...old.tutorial, reset: 2 } });
    expect(same.tutorial).toEqual({ v: 1, off: true, done: ['goal', 'chat'], reset: 2 });
    expect(tutorialSlot.revive({ tutorial: { done: [], reset: 3 }, tips: [] })!.tutorial.reset).toBe(3);
  });

  it('本机重新开启了教程：云端旧的看过步骤不会把它抹掉，交上去的是重开后的', async () => {
    const plat = platform();
    plat.slots = new Map([['tutorial', { rev: 4, data: { tutorial: { v: 1, off: false, done: ['goal', 'chat'] }, tips: [] } }]]);
    const store = new MemoryStore();
    store.setItem(TUTORIAL_KEY, JSON.stringify({ v: 1, off: false, done: [], reset: 1 }));
    await setup({ plat, store }).cloud.start();
    expect(JSON.parse(store.getItem(TUTORIAL_KEY)!)).toEqual({ v: 1, off: false, done: [], reset: 1 });
    expect(plat.slots.get('tutorial')!.data).toMatchObject({ tutorial: { done: [], reset: 1 } });
  });

  for (const offline of [true, false]) {
    it(`账号对不上期间连着改（${offline ? '连不上' : '连得上'}）：几秒内不反复问 /api/me`, async () => {
      const plat = platform();
      const store = new MemoryStore();
      putProfile(store, profileWith((p) => (p.runs = 5)));
      const a = setup({ plat, store });
      await a.cloud.start();
      plat.user = { id: 'u2' };
      await setup({ plat, store }).cloud.start();
      plat.offline = offline;
      await a.clk.advance(FORCE_GAP_MS);
      const me = (): number => plat.calls.filter((c) => c.url === '/api/me').length;
      const before = me();
      for (let i = 0; i < 10; i++) {
        putProfile(store, { ...readProfile(store), runs: i });
        a.cloud.touch('profile');
        await settle();
      }
      expect(me() - before).toBeLessThanOrEqual(offline ? 1 : 2);
      if (offline) {
        await a.clk.advance(FORCE_GAP_MS);
        a.cloud.touch('profile');
        await settle();
        expect(me() - before).toBe(2);
      } else expect(loadMeta(store).userId).toBe('u2');
      expect((plat.of('u1').get('profile')!.data as Profile).runs).toBe(5);
    });
  }
});
