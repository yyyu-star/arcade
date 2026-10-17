import { beforeEach, describe, expect, it } from 'vitest';
import { Cloud, DEBOUNCE_MS, META_KEY, preSyncKey, preSwitchKey, profileSlot, resetKeepalive, type CloudDeps, type KeyValueStore, type SlotDef } from '../src/platform/cloud.ts';
import { coins, fresh, savePayload, type Save } from '../src/platform/save.ts';

class Mem implements KeyValueStore {
  m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

interface Req {
  method: string;
  url: string;
  body: Record<string, any> | null;
}

/** 假平台：一个账号、一个 profile 槽 */
function setup(over: { user?: string | null } = {}) {
  const store = new Mem();
  const reqs: Req[] = [];
  const timers: { fn: () => void; at: number; id: number }[] = [];
  let t = 1_000_000;
  let nid = 0;
  const server = {
    user: over.user === undefined ? 'u1' : over.user,
    slot: null as { rev: number; data: unknown } | null,
    down: false,
    status: 0, // 非 0 = 所有请求回这个状态
    forceConflictOnce: false,
  };
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const fetchFn = async (url: string, init: RequestInit) => {
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    reqs.push({ method: init.method ?? 'GET', url, body });
    if (server.down) throw new TypeError('offline');
    if (server.status) return json(server.status, { error: 'x' });
    if (url === '/api/me') return json(200, { user: server.user ? { id: server.user } : null });
    if (url.startsWith('/api/saves/yexun?')) {
      return json(200, { saves: server.slot ? [{ slot: 'profile', rev: server.slot.rev, data: server.slot.data }] : [] });
    }
    if (url === '/api/saves/yexun/profile' && init.method === 'PUT') {
      const cur = server.slot;
      if (server.forceConflictOnce || (cur ? body.baseRev !== cur.rev : body.baseRev !== 0)) {
        server.forceConflictOnce = false;
        return json(409, { error: 'conflict', current: cur ? { slot: 'profile', rev: cur.rev, data: cur.data } : null });
      }
      server.slot = { rev: (cur?.rev ?? 0) + 1, data: body.data };
      return json(200, { rev: server.slot.rev });
    }
    return json(404, {});
  };
  let applied = 0;
  const deps: CloudDeps = {
    store,
    fetch: fetchFn,
    slots: [profileSlot as SlotDef],
    hasLoginHint: () => true,
    now: () => t,
    setTimer: (fn, ms) => {
      const id = ++nid;
      timers.push({ fn, at: t + ms, id });
      return id;
    },
    clearTimer: (id) => {
      const i = timers.findIndex((x) => x.id === id);
      if (i >= 0) timers.splice(i, 1);
    },
    onApplied: () => applied++,
  };
  const cloud = new Cloud(deps);
  const advance = async (ms: number) => {
    t += ms;
    for (const x of timers.filter((x) => x.at <= t)) {
      timers.splice(timers.indexOf(x), 1);
      x.fn();
    }
    await settle();
  };
  return { store, reqs, cloud, server, deps, advance, applied: () => applied, puts: () => reqs.filter((r) => r.method === 'PUT') };
}

const settle = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
};

const put = (store: Mem, s: Save) => store.setItem('yexun.save', JSON.stringify(s));
const get = (store: Mem): Save => JSON.parse(store.getItem('yexun.save')!);
const withRun = (id: string, n: number, extra: Partial<Save> = {}): Save => ({ ...fresh(), runs: 1, ledger: [[`run:${id}`, n]], ...extra });

beforeEach(() => resetKeepalive());

describe('云存档', () => {
  it('首次同步：本地和云端各有进度，合并后写回本地并上传', async () => {
    const e = setup();
    put(e.store, withRun('a', 100, { maxKills: 50 }));
    e.server.slot = { rev: 3, data: savePayload(withRun('b', 70, { maxKills: 80 })) };
    await e.cloud.start();
    await settle();
    const s = get(e.store);
    expect(coins(s)).toBe(170);
    expect(s.maxKills).toBe(80);
    expect(e.applied()).toBe(1);
    expect(e.store.getItem(preSyncKey('profile'))).not.toBeNull();
    expect(e.puts()).toHaveLength(1);
    expect(e.puts()[0]!.body!.baseRev).toBe(3);
    expect(coins({ ...fresh(), ...(e.server.slot!.data as Save) })).toBe(170);
    expect(e.cloud.view.state).toBe('merged');
  });

  it('首次同步：云端没有、本地有就直接传；本地没有就取云端', async () => {
    const a = setup();
    put(a.store, withRun('a', 100));
    await a.cloud.start();
    await settle();
    expect(a.puts()).toHaveLength(1);
    expect(a.server.slot?.rev).toBe(1);

    const b = setup();
    b.server.slot = { rev: 2, data: savePayload(withRun('z', 40)) };
    await b.cloud.start();
    expect(coins(get(b.store))).toBe(40);
    expect(b.puts()).toHaveLength(0);
    expect(b.cloud.view.state).toBe('synced');
  });

  it('本地改动后防抖上传：连续改只传一次，传的是最新的', async () => {
    const e = setup();
    await e.cloud.start();
    await settle();
    put(e.store, withRun('a', 10));
    e.cloud.touch('profile');
    await e.advance(DEBOUNCE_MS - 1000);
    put(e.store, withRun('a', 10, { runs: 5 }));
    e.cloud.touch('profile');
    await e.advance(DEBOUNCE_MS - 1000);
    expect(e.puts()).toHaveLength(0);
    await e.advance(2000);
    expect(e.puts()).toHaveLength(1);
    expect((e.puts()[0]!.body!.data as Save).runs).toBe(5);
    expect(e.puts()[0]!.body!.data).not.toHaveProperty('tipsOff');
    expect(e.cloud.view.state).toBe('synced');
  });

  it('409 冲突：游戏自己合并，用新 rev 重传', async () => {
    const e = setup();
    put(e.store, withRun('a', 100));
    await e.cloud.start();
    await settle();
    // 另一台设备抢先写了云端
    e.server.slot = { rev: 7, data: savePayload(withRun('b', 30)) };
    put(e.store, withRun('a', 100, { runs: 2, ledger: [['run:a', 100], ['run:c', 5]] }));
    e.cloud.touch('profile');
    await e.advance(DEBOUNCE_MS + 10);
    await settle();
    expect(coins(get(e.store))).toBe(135);
    expect(e.server.slot!.rev).toBe(8);
    expect(e.puts().at(-1)!.body!.baseRev).toBe(7);
    expect(e.store.getItem(preSyncKey('profile'))).not.toBeNull();
    expect(e.cloud.view.state).not.toBe('pending');
  });

  it('换账号：旧账号的本地进度另存，不带给新账号', async () => {
    const e = setup({ user: 'u1' });
    put(e.store, withRun('a', 100));
    await e.cloud.start();
    await settle();
    expect(e.server.slot).not.toBeNull();

    // 同一页面换成另一个账号（云端为空）
    e.server.user = 'u2';
    e.server.slot = null;
    e.reqs.length = 0;
    await e.cloud.start();
    await settle();
    expect(coins(get(e.store))).toBe(0);
    expect(JSON.parse(e.store.getItem(preSwitchKey('profile', 'u1'))!).ledger).toEqual([['run:a', 100]]);
    expect(e.puts()).toHaveLength(0);
    expect(JSON.parse(e.store.getItem(META_KEY)!).userId).toBe('u2');

    // 回到旧账号：存着的并回来
    e.server.user = 'u1';
    e.server.slot = { rev: 1, data: savePayload(withRun('a', 100)) };
    await e.cloud.start();
    await settle();
    expect(coins(get(e.store))).toBe(100);
    expect(e.store.getItem(preSwitchKey('profile', 'u1'))).toBeNull();
  });

  it('没登录、401、连不上都不抛错，也不动本地', async () => {
    const local = withRun('a', 100);
    const out = setup({ user: null });
    put(out.store, local);
    await expect(out.cloud.start()).resolves.toBeUndefined();
    expect(out.cloud.view.state).toBe('out');

    const nohint = setup();
    nohint.deps.hasLoginHint = () => false;
    put(nohint.store, local);
    await nohint.cloud.start();
    expect(nohint.reqs).toHaveLength(0);

    const r401 = setup();
    r401.server.status = 401;
    put(r401.store, local);
    await expect(r401.cloud.start()).resolves.toBeUndefined();
    expect(r401.cloud.view.state).toBe('out');

    const down = setup();
    down.server.down = true;
    put(down.store, local);
    await expect(down.cloud.start()).resolves.toBeUndefined();
    down.cloud.touch('profile');
    expect(down.cloud.view.state).toBe('pending');
    expect(get(down.store).ledger).toEqual(local.ledger);
  });

  it('云端是坏数据：不污染本地，本地照常覆盖上去', async () => {
    const e = setup();
    const local = withRun('a', 100);
    put(e.store, local);
    e.server.slot = { rev: 4, data: { v: 1, ledger: 'oops', perks: { nope: 99 }, runs: 'x' } };
    await e.cloud.start();
    await settle();
    // 读得懂的部分按默认值：不会出现 NaN、负数、未知加成
    expect(coins(get(e.store))).toBe(100);
    const bad = setup();
    put(bad.store, local);
    bad.server.slot = { rev: 9, data: '乱码' };
    await bad.cloud.start();
    await settle();
    expect(get(bad.store).ledger).toEqual(local.ledger);
    expect(bad.puts()[0]!.body!.baseRev).toBe(9);

    // 本地存档坏了：当作没有，取云端
    const c = setup();
    c.store.setItem('yexun.save', '{坏');
    c.server.slot = { rev: 1, data: savePayload(withRun('z', 40)) };
    await c.cloud.start();
    expect(coins(get(c.store))).toBe(40);
  });

  it('切后台：待上传的用 keepalive 补传', async () => {
    const e = setup();
    await e.cloud.start();
    await settle();
    put(e.store, withRun('a', 10));
    e.cloud.touch('profile');
    e.cloud.hidden();
    await settle();
    expect(e.puts()).toHaveLength(1);
  });

  it('别的标签页传完了：本页不再重复传', async () => {
    const e = setup();
    await e.cloud.start();
    await settle();
    put(e.store, withRun('a', 10));
    e.cloud.touch('profile');
    // 另一个标签页传完，元数据里 rev 前进、dirty 清空
    e.store.setItem(META_KEY, JSON.stringify({ v: 1, userId: 'u1', rev: { profile: 5 }, dirty: [] }));
    e.cloud.absorb();
    await e.advance(DEBOUNCE_MS + 10);
    expect(e.puts()).toHaveLength(0);
    expect(e.cloud.view.state).toBe('synced');
  });
});
