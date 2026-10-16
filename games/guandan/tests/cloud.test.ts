import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CloudSync, DEBOUNCE_MS, HIDE_GAP_MS, MIN_GAP_MS, VERIFY_MS, merge, same, tapAction, type CloudMeta } from '../src/view/cloud.ts';
import { EMPTY_STATS, type Stats, type SyncSlot } from '../src/view/store.ts';

const stats = (p: Partial<Stats> = {}): Stats => ({ ...EMPTY_STATS, ...p });
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

/** user：发请求时 cookie 是哪个账号（平台按 cookie 记账）；sentUserId：请求体里带的 userId（单独拿出来，body 只留 baseRev、data） */
/** url 只留路径；query：GET 带的 ?userId= */
interface Call { method: string; url: string; query: string | null; init: RequestInit; body: { baseRev: number; data: unknown } | null; sentUserId?: unknown; user: string | null; status?: number }

/**
 * 假平台：按文档 15.3 的规则存档（baseRev 不对就 409 带 current），存档按账号分开，记在当前 cookie 的账号（server.user）名下；
 * 平台 0.7.1 的规则：PUT 带 userId 时先核对，和会话不一致 409 wrong_user（不写），格式不对 400；没登录 401。
 * 平台 0.7.3：GET /api/saves/<id>?userId= 同样核对，不一致 409 wrong_user（不给数据），格式不对 400。
 * server.hint 是浏览器里有没有提示 cookie。可以用 override 塞任意回应。
 * 本机存储是几个 Map，和 store.ts 的行为一致（读不到给默认值）；open() 在同一份存储上再开一个实例（下次打开 / 另一个标签页）。
 */
function setup(o: { hint?: boolean; user?: string | null; savesPaused?: boolean; remote?: Partial<Record<SyncSlot, { rev: number; data: unknown }>>; local?: Partial<Record<SyncSlot, unknown>>; meta?: CloudMeta | null } = {}) {
  const byUser = new Map<string, Map<string, { rev: number; data: unknown }>>();
  const savesOf = (u: string | null) => {
    const k = u ?? '';
    if (!byUser.has(k)) byUser.set(k, new Map());
    return byUser.get(k)!;
  };
  const server = {
    user: o.user === undefined ? 'u1' : o.user,
    hint: o.hint ?? true,
    /** 当前 cookie 账号的存档 */
    get saves() {
      return savesOf(this.user);
    },
    savesOf,
    savesPaused: o.savesPaused ?? false,
    /** 返回 Response 就用它，'throw' 抛网络错误，'hang' 永远不回（页面关掉前没等到），undefined 走正常逻辑 */
    override: null as null | ((c: Call) => Response | Promise<Response> | 'throw' | 'hang' | undefined),
  };
  for (const [k, v] of Object.entries(o.remote ?? {})) savesOf(server.user).set(k, v!);
  const calls: Call[] = [];
  const local = new Map<SyncSlot, unknown>(Object.entries(o.local ?? {}) as [SyncSlot, unknown][]);
  /** key：<槽>.<tag>，和 store.ts 的 backupKey 去掉 guandan. 前缀一致 */
  const backups = new Map<string, unknown>();
  /** full：本机存储满了，备份写不进去 */
  const disk = { full: false };
  let meta: CloudMeta | null = o.meta ?? null;
  const empty = (slot: SyncSlot) => (slot === 'stats' ? stats() : { v: 1, done: false });
  const fetch = async (url: string, init: RequestInit = {}) => {
    const raw = typeof init.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    const u = new URL(url, 'https://game.example.com');
    const c: Call = { method: init.method ?? 'GET', url: u.pathname, query: u.search ? u.search : null, init, body: null, user: server.user };
    if (raw) {
      const { userId, ...rest } = raw;
      c.body = rest as Call['body'];
      if ('userId' in raw) c.sentUserId = userId;
    }
    calls.push(c);
    const ov = server.override?.(c);
    if (ov === 'throw') throw new TypeError('Failed to fetch');
    if (ov === 'hang') return new Promise<Response>(() => {});
    if (ov) return ov;
    if (c.url === '/api/me') return json({ user: server.user ? { id: server.user, displayName: 'x' } : null, service: 'ok', saves: server.savesPaused ? 'paused' : 'ok' });
    if (c.url === '/api/saves/guandan' && c.method === 'GET') {
      const want = u.searchParams.get('userId');
      if (c.query !== null && (want === null || !/^[A-Za-z0-9_-]{1,64}$/.test(want))) return json({ error: 'bad_request', message: '' }, 400);
      if (want !== null && want !== server.user) return json({ error: 'wrong_user', message: '' }, 409);
      return json({ saves: [...server.saves].map(([slot, s]) => ({ slot, rev: s.rev, updatedAt: 1, data: s.data })) });
    }
    const m = /^\/api\/saves\/guandan\/(\w+)$/.exec(c.url);
    if (m && c.method === 'PUT') {
      if (!server.user) return json({ error: 'unauthorized', message: '' }, 401);
      if ('sentUserId' in c && (typeof c.sentUserId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(c.sentUserId))) return json({ error: 'bad_request', message: '' }, 400);
      if ('sentUserId' in c && c.sentUserId !== server.user) return json({ error: 'wrong_user', message: '' }, 409);
      const cur = server.saves.get(m[1]!) ?? null;
      if ((cur?.rev ?? 0) !== c.body!.baseRev) return json({ error: 'conflict', message: '', current: cur && { ...cur, updatedAt: 1 } }, 409);
      const next = { rev: (cur?.rev ?? 0) + 1, data: c.body!.data };
      server.saves.set(m[1]!, next);
      c.status = 200;
      return json({ rev: next.rev, updatedAt: 2 });
    }
    return json({ error: 'not_found' }, 404);
  };
  let forgot = 0;
  const open = () =>
    new CloudSync({
      fetch,
      hasLoginHint: () => server.hint,
      read: (slot) => structuredClone(local.get(slot) ?? empty(slot)),
      write: (slot, data) => void local.set(slot, structuredClone(data)),
      backup: (slot, tag, data) => {
        if (disk.full) return false;
        backups.set(`${slot}.${tag}`, structuredClone(data));
        return true;
      },
      readBackup: (slot, tag) => structuredClone(backups.get(`${slot}.${tag}`) ?? null),
      dropBackup: (slot, tag) => void backups.delete(`${slot}.${tag}`),
      empty,
      loadMeta: () => structuredClone(meta),
      saveMeta: (m) => void (meta = structuredClone(m)),
      forgetRoom: () => void forgot++,
    });
  const cloud = open();
  const puts = () => calls.filter((c) => c.method === 'PUT');
  /** 本机改了一个槽（相当于 store 里 recordDeal 之后的通知） */
  const play = (slot: SyncSlot, data: unknown, on: CloudSync = cloud) => {
    local.set(slot, data);
    on.markDirty(slot);
  };
  return { cloud, open, server, calls, puts, local, backups, disk, play, meta: () => meta, forgot: () => forgot };
}

/** 记到某个账号名下、而且平台收下了的 PUT */
const writesTo = (h: ReturnType<typeof setup>, user: string) => h.puts().filter((c) => c.user === user && c.status === 200);

/** 让挂着的 Promise（假 fetch、json()）都走完 */
const settle = async () => {
  // wrong_user 之后要接连等好几个请求（PUT → /api/me → 拉取），每个都有好几层 await
  for (let i = 0; i < 60; i++) await Promise.resolve();
};
const advance = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
  await settle();
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('合并规则', () => {
  it('计数取较大、布尔取"或"、数组取并集、对象逐字段，只有一边有的字段保留', () => {
    expect(merge(stats({ games: 5, wins: 1 }), stats({ games: 3, wins: 2 }))).toEqual(stats({ games: 5, wins: 2 }));
    expect(merge({ done: false }, { done: true })).toEqual({ done: true });
    expect(merge({ done: true }, { done: false })).toEqual({ done: true });
    expect(merge({ a: [1, { x: 1 }] }, { a: [{ x: 1 }, 2] })).toEqual({ a: [1, { x: 1 }, 2] });
    expect(merge({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
    expect(merge({ n: { c: 1 } }, { n: { c: 4, d: 1 } })).toEqual({ n: { c: 4, d: 1 } });
  });
  it('类型对不上以本地为准；本地没有就用云端', () => {
    expect(merge({ a: 'x' }, { a: 3 })).toEqual({ a: 'x' });
    expect(merge(null, { a: 1 })).toEqual({ a: 1 });
    expect(merge(stats({ games: 2 }), 'garbage')).toEqual(stats({ games: 2 }));
  });
  it('比较和键的顺序无关', () => {
    expect(same({ a: 1, b: [1, { c: 2, d: 3 }] }, { b: [1, { d: 3, c: 2 }], a: 1 })).toBe(true);
    expect(same({ a: 1 }, { a: 2 })).toBe(false);
    expect(same([1, 2], [2, 1])).toBe(false);
  });
});

describe('登录状态', () => {
  it('没有提示 cookie：一个请求都不发，显示未登录', async () => {
    const h = setup({ hint: false, local: { stats: stats({ games: 3 }) } });
    await h.cloud.start();
    h.play('stats', stats({ games: 4 }));
    await advance(MIN_GAP_MS * 2);
    expect(h.calls).toEqual([]);
    expect(h.cloud.status).toBe('loggedOut');
  });

  it('有提示 cookie 但 /api/me 说没登录（user null 或 401）：只问这一次', async () => {
    for (const ov of [undefined, () => json({ error: 'unauthorized' }, 401)]) {
      const h = setup({ user: null });
      if (ov) h.server.override = ov;
      await h.cloud.start();
      await advance(DEBOUNCE_MS);
      expect(h.calls.map((c) => c.url)).toEqual(['/api/me']);
      expect(h.cloud.status).toBe('loggedOut');
    }
  });

  it('先调 /api/me（续 last_seen），再拉存档；都是同源带 cookie 的 GET', async () => {
    const h = setup();
    await h.cloud.start();
    expect(h.calls.map((c) => `${c.method} ${c.url}`)).toEqual(['GET /api/me', 'GET /api/saves/guandan']);
    for (const c of h.calls) expect(c.init.credentials).toBe('same-origin');
    expect(h.cloud.status).toBe('synced');
    expect(h.meta()?.userId).toBe('u1');
  });
});

describe('第一次同步（这台设备没记过账号）', () => {
  it('云端没有、本地有战绩：马上建档，baseRev 0，带 X-Arcade 头', async () => {
    const h = setup({ local: { stats: stats({ games: 7, wins: 4 }) } });
    await h.cloud.start();
    await advance(0);
    expect(h.puts()).toHaveLength(1);
    const p = h.puts()[0]!;
    expect(p.url).toBe('/api/saves/guandan/stats');
    expect(p.body).toEqual({ baseRev: 0, data: stats({ games: 7, wins: 4 }) });
    const hd = p.init.headers as Record<string, string>;
    expect(hd['X-Arcade']).toBe('1');
    expect(hd['Content-Type']).toBe('application/json');
    expect(p.init.credentials).toBe('same-origin');
    expect(h.meta()).toMatchObject({ userId: 'u1', rev: { stats: 1, tutorial: 0 }, dirty: [] });
    expect(h.cloud.status).toBe('synced');
  });

  it('本地是空档：不上传', async () => {
    const h = setup();
    await h.cloud.start();
    await advance(MIN_GAP_MS);
    expect(h.puts()).toEqual([]);
  });

  it('两边都有：合并，本地先备份；合并结果比云端多就上传，基于云端的 rev', async () => {
    const before = stats({ games: 9, wins: 2, deals: 40 });
    const h = setup({ local: { stats: before }, remote: { stats: { rev: 5, data: stats({ games: 3, wins: 3, deals: 10 }) } } });
    await h.cloud.start();
    const merged = stats({ games: 9, wins: 3, deals: 40 });
    expect(h.backups.get('stats.pre-sync')).toEqual(before);
    expect(h.local.get('stats')).toEqual(merged);
    await advance(0);
    expect(h.puts().map((p) => p.body)).toEqual([{ baseRev: 5, data: merged }]);
    expect(h.server.saves.get('stats')).toEqual({ rev: 6, data: merged });
    expect(h.cloud.status).toBe('merged');
  });

  it('云端全都更大：直接收下，不用上传', async () => {
    const h = setup({ local: { stats: stats({ games: 1 }) }, remote: { stats: { rev: 2, data: stats({ games: 5, wins: 5 }) }, tutorial: { rev: 1, data: { v: 1, done: true } } } });
    await h.cloud.start();
    await advance(MIN_GAP_MS);
    expect(h.local.get('stats')).toEqual(stats({ games: 5, wins: 5 }));
    expect(h.local.get('tutorial')).toEqual({ v: 1, done: true });
    expect(h.puts()).toEqual([]);
    expect(h.cloud.status).toBe('merged');
  });

  it('两边一样：不备份，状态是已同步', async () => {
    const h = setup({ local: { stats: stats({ games: 2 }) }, remote: { stats: { rev: 1, data: stats({ games: 2 }) } } });
    await h.cloud.start();
    expect(h.backups.size).toBe(0);
    expect(h.cloud.status).toBe('synced');
  });
});

describe('换了账号', () => {
  const old: CloudMeta = { v: 1, userId: 'u1', rev: { stats: 3 }, dirty: ['stats'] };

  it('换了账号、退出、上传时被告知换了人：都忘掉本机记着的好友房（不能给新账号"回到房间"）；同一个账号不忘', async () => {
    const same = setup({ meta: { v: 1, userId: 'u1', rev: {}, dirty: [] } });
    await same.cloud.start();
    await advance(MIN_GAP_MS);
    expect(same.forgot()).toBe(0);

    const switched = setup({ user: 'u2', meta: old, local: { stats: stats({ games: 5 }) } });
    await switched.cloud.start();
    await advance(MIN_GAP_MS);
    expect(switched.forgot()).toBeGreaterThan(0);

    const out = setup({ user: null, meta: old });
    await out.cloud.start();
    await advance(MIN_GAP_MS);
    expect(out.forgot()).toBeGreaterThan(0);

    // 页面开着时别的标签页换了号：上传被 wrong_user 拒收
    const away = setup({ local: { stats: stats({ games: 1 }) } });
    await away.cloud.start();
    expect(away.forgot()).toBe(0);
    away.server.user = 'u2';
    away.play('stats', stats({ games: 2 }));
    await advance(DEBOUNCE_MS);
    await advance(MIN_GAP_MS * 2);
    expect(away.forgot()).toBeGreaterThan(0);
  });

  it('本机数据（哪怕还没传完）绝不传到新账号；先备份，再换成新账号云端的数据', async () => {
    const mine = stats({ games: 50, wins: 30 });
    const h = setup({ user: 'u2', meta: old, local: { stats: mine, tutorial: { v: 1, done: true } }, remote: { stats: { rev: 8, data: stats({ games: 2 }) } } });
    await h.cloud.start();
    await advance(MIN_GAP_MS);
    expect(h.puts()).toEqual([]);
    expect(h.backups.get('stats.pre-switch.u1')).toEqual(mine);
    expect(h.backups.get('tutorial.pre-switch.u1')).toEqual({ v: 1, done: true });
    expect(h.cloud.status).toBe('synced');
    expect(h.local.get('stats')).toEqual(stats({ games: 2 }));
    // 云端没有教程标记：新账号从头开始
    expect(h.local.get('tutorial')).toEqual({ v: 1, done: false });
    expect(h.meta()).toEqual({ v: 1, userId: 'u2', rev: { stats: 8, tutorial: 0 }, dirty: [] });
  });

  it('新账号云端什么都没有：本地清零，不上传；之后新玩的照常传', async () => {
    const h = setup({ user: 'u2', meta: old, local: { stats: stats({ games: 50 }) } });
    await h.cloud.start();
    await advance(MIN_GAP_MS);
    expect(h.puts()).toEqual([]);
    expect(h.local.get('stats')).toEqual(stats());
    h.play('stats', stats({ games: 1 }));
    await advance(DEBOUNCE_MS);
    expect(h.puts().map((p) => p.body)).toEqual([{ baseRev: 0, data: stats({ games: 1 }) }]);
  });

  it('同一个账号重新登录：不算换账号，退出期间玩的照常补传', async () => {
    const h = setup({ user: 'u1', meta: old, local: { stats: stats({ games: 9 }) }, remote: { stats: { rev: 3, data: stats({ games: 4 }) } } });
    await h.cloud.start();
    await advance(0);
    expect(h.backups.size).toBe(0);
    expect(h.puts().map((p) => p.body)).toEqual([{ baseRev: 3, data: stats({ games: 9 }) }]);
  });
});

describe('上传节奏', () => {
  it('10 秒防抖：连着改三次只传一次，10 秒前一次都不传', async () => {
    const h = setup();
    await h.cloud.start();
    h.play('stats', stats({ games: 1 }));
    await advance(4000);
    h.play('stats', stats({ games: 2 }));
    await advance(4000);
    h.play('stats', stats({ games: 3 }));
    expect(h.cloud.status).toBe('pending');
    await advance(DEBOUNCE_MS - 1);
    expect(h.puts()).toEqual([]);
    await advance(1);
    expect(h.puts().map((p) => p.body!.data)).toEqual([stats({ games: 3 })]);
    expect(h.cloud.status).toBe('synced');
  });

  it('同一个槽两次上传至少隔 5 分钟；一副一次地玩，一小时不超过 13 次', async () => {
    const h = setup();
    await h.cloud.start();
    for (let i = 1; i <= 60; i++) {
      h.play('stats', stats({ deals: i }));
      await advance(60_000);
    }
    expect(h.puts().length).toBeLessThanOrEqual(13);
    // 第二次上传在第一次之后至少 5 分钟
    const counts: number[] = [];
    const h2 = setup();
    await h2.cloud.start();
    h2.play('stats', stats({ deals: 1 }));
    await advance(DEBOUNCE_MS);
    counts.push(h2.puts().length);
    h2.play('stats', stats({ deals: 2 }));
    await advance(MIN_GAP_MS - 1000);
    counts.push(h2.puts().length);
    await advance(2000);
    counts.push(h2.puts().length);
    expect(counts).toEqual([1, 1, 2]);
    // 最后一次改动最终一定会传上去
    await advance(MIN_GAP_MS);
    expect(h.server.saves.get('stats')?.data).toEqual(stats({ deals: 60 }));
  });

  it('上传途中又改了：这次成功后接着再传新的', async () => {
    const h = setup();
    await h.cloud.start();
    h.play('stats', stats({ games: 1 }));
    // 第一个 PUT 发出去以后、回来之前，玩家又打完一副
    h.server.override = (c) => {
      if (c.method === 'PUT' && h.puts().length === 1) h.play('stats', stats({ games: 2 }));
      return undefined;
    };
    await advance(DEBOUNCE_MS);
    expect(h.puts().map((p) => p.body!.data)).toEqual([stats({ games: 1 })]);
    expect(h.meta()?.dirty).toEqual(['stats']);
    await advance(MIN_GAP_MS);
    expect(h.puts().map((p) => p.body!.data)).toEqual([stats({ games: 1 }), stats({ games: 2 })]);
    expect(h.meta()?.dirty).toEqual([]);
  });

  it('上次没传完的（记在 guandan.cloud 里）：下次打开补传', async () => {
    const meta: CloudMeta = { v: 1, userId: 'u1', rev: { stats: 2 }, dirty: ['stats'] };
    const h = setup({ meta, local: { stats: stats({ games: 6 }) }, remote: { stats: { rev: 2, data: stats({ games: 5 }) } } });
    await h.cloud.start();
    await advance(0);
    expect(h.puts().map((p) => p.body)).toEqual([{ baseRev: 2, data: stats({ games: 6 }) }]);
  });
});

describe('切到后台', () => {
  it('用 keepalive 只补传一个槽（战绩优先），不等防抖', async () => {
    const h = setup();
    await h.cloud.start();
    h.play('tutorial', { v: 1, done: true });
    h.play('stats', stats({ games: 1 }));
    h.cloud.flushOnHide();
    await settle();
    expect(h.puts()).toHaveLength(1);
    expect(h.puts()[0]!.url).toBe('/api/saves/guandan/stats');
    expect(h.puts()[0]!.init.keepalive).toBe(true);
    // 被取消的防抖不会再传一次战绩；教程标记照常按防抖传
    await advance(DEBOUNCE_MS);
    expect(h.puts().map((p) => p.url)).toEqual(['/api/saves/guandan/stats', '/api/saves/guandan/tutorial']);
    expect(h.puts()[1]!.init.keepalive).toBe(false);
  });

  it('请求体超过 60 KB 就不走 keepalive', async () => {
    const h = setup();
    await h.cloud.start();
    h.play('stats', { ...stats(), pad: 'x'.repeat(61 * 1024) });
    h.cloud.flushOnHide();
    await settle();
    expect(h.puts()[0]!.init.keepalive).toBe(false);
  });

  it('没有要传的：什么都不发', async () => {
    const h = setup();
    await h.cloud.start();
    h.cloud.flushOnHide();
    await settle();
    expect(h.puts()).toEqual([]);
  });
});

describe('冲突（409）', () => {
  it('别的设备先传了：本地备份后合并，用云端的 rev 重交合并后的数据', async () => {
    const h = setup({ remote: { stats: { rev: 1, data: stats({ games: 1 }) } }, local: { stats: stats({ games: 1 }) } });
    await h.cloud.start();
    // 另一台设备在这期间传了两次
    h.server.saves.set('stats', { rev: 3, data: stats({ games: 4, wins: 4 }) });
    h.play('stats', stats({ games: 2, firsts: 1 }));
    await advance(DEBOUNCE_MS);
    const merged = stats({ games: 4, wins: 4, firsts: 1 });
    expect(h.puts().map((p) => p.body)).toEqual([
      { baseRev: 1, data: stats({ games: 2, firsts: 1 }) },
      { baseRev: 3, data: merged },
    ]);
    expect(h.backups.get('stats.pre-sync')).toEqual(stats({ games: 2, firsts: 1 }));
    expect(h.local.get('stats')).toEqual(merged);
    expect(h.server.saves.get('stats')).toEqual({ rev: 4, data: merged });
    expect(h.meta()?.rev.stats).toBe(4);
  });

  it('云端那份没了（current 为 null）：用 baseRev 0 重新提交', async () => {
    const h = setup({ remote: { stats: { rev: 1, data: stats() } } });
    await h.cloud.start();
    h.server.saves.delete('stats');
    h.play('stats', stats({ games: 1 }));
    await advance(DEBOUNCE_MS);
    expect(h.puts().map((p) => p.body!.baseRev)).toEqual([1, 0]);
    expect(h.server.saves.get('stats')?.rev).toBe(1);
  });

  it('合并后和云端一样：不用重交', async () => {
    const h = setup({ remote: { stats: { rev: 1, data: stats() } } });
    await h.cloud.start();
    h.server.saves.set('stats', { rev: 2, data: stats({ games: 9 }) });
    h.play('stats', stats({ games: 3 }));
    await advance(DEBOUNCE_MS);
    expect(h.puts()).toHaveLength(1);
    expect(h.local.get('stats')).toEqual(stats({ games: 9 }));
    expect(h.cloud.status).toBe('merged');
  });

  it('重交又冲突：不再连着重试（不打满每天 100 次）', async () => {
    const h = setup();
    await h.cloud.start();
    h.server.override = (c) => (c.method === 'PUT' ? json({ error: 'conflict', message: '', current: { rev: 9, updatedAt: 1, data: stats({ games: 1 }) } }, 409) : undefined);
    h.play('stats', stats({ wins: 1 }));
    await advance(DEBOUNCE_MS);
    expect(h.puts()).toHaveLength(2);
  });
});

describe('其他错误', () => {
  const failing = async (reply: (c: Call) => Response | 'throw' | undefined) => {
    const h = setup();
    await h.cloud.start();
    h.server.override = (c) => (c.method === 'PUT' ? reply(c) : undefined);
    h.play('stats', stats({ games: 1 }));
    await advance(DEBOUNCE_MS);
    return h;
  };

  it('429 too_soon：按 retryAfter 等，再传', async () => {
    let n = 0;
    const h = await failing(() => (n++ === 0 ? json({ error: 'too_soon', message: '', retryAfter: 7 }, 429, { 'Retry-After': '7' }) : undefined));
    expect(h.puts()).toHaveLength(1);
    await advance(7000);
    expect(h.puts()).toHaveLength(1);
    await advance(1000);
    expect(h.puts()).toHaveLength(2);
    expect(h.cloud.status).toBe('synced');
  });

  it('429 只有 Retry-After 头也认', async () => {
    let n = 0;
    const h = await failing(() => (n++ === 0 ? json({ error: 'rate_limited', message: '' }, 429, { 'Retry-After': '30' }) : undefined));
    await advance(29_000);
    expect(h.puts()).toHaveLength(1);
    await advance(2000);
    expect(h.puts()).toHaveLength(2);
  });

  it('413：这个槽不再重试，给提示；别的槽照常', async () => {
    const h = await failing((c) => (c.url.endsWith('/stats') ? json({ error: 'too_large', message: '' }, 413) : undefined));
    expect(h.cloud.note).toBe('tooLarge');
    h.play('stats', stats({ games: 2 }));
    h.cloud.flushOnHide();
    await advance(MIN_GAP_MS * 2);
    expect(h.puts().filter((p) => p.url.endsWith('/stats'))).toHaveLength(1);
    h.play('tutorial', { v: 1, done: true });
    await advance(DEBOUNCE_MS);
    expect(h.puts().filter((p) => p.url.endsWith('/tutorial'))).toHaveLength(1);
  });

  it('503 busy：暂停同步，之后的改动都不传', async () => {
    const h = await failing(() => json({ error: 'busy', message: '' }, 503));
    expect(h.cloud.note).toBe('paused');
    h.play('stats', stats({ games: 2 }));
    h.cloud.flushOnHide();
    await advance(MIN_GAP_MS * 2);
    expect(h.puts()).toHaveLength(1);
    expect(h.meta()?.dirty).toEqual(['stats']);
  });

  it('/api/me 说 saves 暂停，或 /api/me 503：不拉也不传', async () => {
    const h1 = setup({ savesPaused: true, local: { stats: stats({ games: 3 }) } });
    await h1.cloud.start();
    h1.play('stats', stats({ games: 4 }));
    await advance(MIN_GAP_MS);
    expect(h1.calls.map((c) => c.url)).toEqual(['/api/me']);
    expect(h1.cloud.note).toBe('paused');
    const h2 = setup();
    h2.server.override = () => json({ error: 'busy', message: '' }, 503);
    await h2.cloud.start();
    expect(h2.calls).toHaveLength(1);
    expect(h2.cloud.note).toBe('paused');
  });

  it('401：当作已退出，不再传', async () => {
    const h = await failing(() => json({ error: 'unauthorized', message: '' }, 401));
    expect(h.cloud.status).toBe('loggedOut');
    h.play('stats', stats({ games: 2 }));
    h.cloud.flushOnHide();
    await advance(MIN_GAP_MS * 2);
    expect(h.puts()).toHaveLength(1);
  });

  it('连不上（抛错、或回来的不是 JSON）：留着待上传，下一次改动再试，成功后提示消失', async () => {
    // 200 的 HTML 也一样（比如开发时没开平台接口，vite 回了首页）：不能当成传成功
    for (const bad of [() => 'throw' as const, () => new Response('<html>502</html>', { status: 502 }), () => new Response('<!doctype html>', { status: 200 })]) {
      const h = await failing(bad);
      expect(h.cloud.note).toBe('offline');
      expect(h.cloud.status).toBe('pending');
      expect(h.meta()?.dirty).toEqual(['stats']);
      h.server.override = null;
      h.play('stats', stats({ games: 2 }));
      await advance(DEBOUNCE_MS);
      expect(h.puts()).toHaveLength(2);
      expect(h.cloud.note).toBe(null);
      expect(h.cloud.status).toBe('synced');
    }
  });

  it('启动时 /api/me 连不上：不拉存档，提示连不上', async () => {
    const h = setup();
    h.server.override = () => 'throw';
    await h.cloud.start();
    expect(h.calls).toHaveLength(1);
    expect(h.cloud.note).toBe('offline');
  });
});

describe('图标状态', () => {
  it('同步中 → 待上传 → 已同步，每次变化都通知', async () => {
    const h = setup();
    const seen: string[] = [];
    h.cloud.onChange(() => seen.push(h.cloud.status));
    await h.cloud.start();
    h.play('stats', stats({ games: 1 }));
    await advance(DEBOUNCE_MS);
    expect(seen).toEqual(['syncing', 'synced', 'pending', 'syncing', 'synced']);
  });
});

describe('换账号中途断了：下次打开也不能把旧账号的数据传给新账号（审阅第 1 条）', () => {
  const old: CloudMeta = { v: 1, userId: 'u1', rev: { stats: 3 }, dirty: ['stats'] };
  const mine = stats({ games: 50, wins: 30 });
  const cases: [string, (h: ReturnType<typeof setup>) => void][] = [
    ['拉取时连不上', (h) => (h.server.override = (c) => (c.url === '/api/saves/guandan' ? 'throw' : undefined))],
    ['拉取时 500', (h) => (h.server.override = (c) => (c.url === '/api/saves/guandan' ? json({ error: 'internal', message: '' }, 500) : undefined))],
    ['拉取时 401', (h) => (h.server.override = (c) => (c.url === '/api/saves/guandan' ? json({ error: 'unauthorized', message: '' }, 401) : undefined))],
    ['拉取时 429', (h) => (h.server.override = (c) => (c.url === '/api/saves/guandan' ? json({ error: 'rate_limited', message: '', retryAfter: 5 }, 429) : undefined))],
    ['拉取时 503', (h) => (h.server.override = (c) => (c.url === '/api/saves/guandan' ? json({ error: 'busy', message: '' }, 503) : undefined))],
    ['存档暂停（saves=paused）', (h) => (h.server.savesPaused = true)],
    ['拉取还没回来页面就关了', (h) => (h.server.override = (c) => (c.url === '/api/saves/guandan' ? 'hang' : undefined))],
  ];
  for (const [name, breakIt] of cases) {
    it(name, async () => {
      const h = setup({ user: 'u2', meta: old, local: { stats: mine, tutorial: { v: 1, done: true } } });
      breakIt(h);
      // 永远不回的拉取不能 await（页面就是在这时关掉的）
      void h.cloud.start();
      await advance(MIN_GAP_MS);
      // 第一次打开：识别到换账号的当下就清掉了本机数据并存了盘
      expect(h.puts()).toEqual([]);
      expect(h.local.get('stats')).toEqual(stats());
      expect(h.meta()?.userId).toBe('u2');
      // 下次打开（平台恢复了）：本地是空档，按新账号的首次同步处理，一个 PUT 都不发
      h.server.override = null;
      h.server.savesPaused = false;
      const again = h.open();
      await again.start();
      await advance(MIN_GAP_MS * 2);
      expect(h.puts()).toEqual([]);
      expect(h.backups.get('stats.pre-switch.u1')).toEqual(mine);
      expect(h.local.get('stats')).toEqual(stats());
    });
  }

  it('换账号的备份单独存一份，之后合并写的 pre-sync 不会盖掉它（审阅第 5 条）', async () => {
    const h = setup({ user: 'u2', meta: old, local: { stats: mine }, remote: { stats: { rev: 1, data: stats({ games: 2 }) } } });
    await h.cloud.start();
    h.server.saves.set('stats', { rev: 2, data: stats({ games: 5 }) });
    h.play('stats', stats({ games: 3 }));
    await advance(DEBOUNCE_MS);
    expect(h.backups.get('stats.pre-sync')).toEqual(stats({ games: 3 }));
    expect(h.backups.get('stats.pre-switch.u1')).toEqual(mine);
  });
});

describe('连不上、停服时不显示"未登录"，点了也不去登录页（审阅第 2 条）', () => {
  it('/api/me 连不上：待上传 + 连不上的说明，点了是说明', async () => {
    const h = setup();
    h.server.override = () => 'throw';
    await h.cloud.start();
    expect(h.cloud.status).toBe('pending');
    expect(h.cloud.note).toBe('offline');
    expect(tapAction(h.cloud.status, h.cloud.note)).toBe('explain');
  });

  it('/api/me 503：待上传 + 停服说明，点了是说明', async () => {
    const h = setup();
    h.server.override = () => json({ error: 'busy', message: '' }, 503);
    await h.cloud.start();
    expect(h.cloud.status).toBe('pending');
    expect(h.cloud.note).toBe('paused');
    expect(tapAction(h.cloud.status, h.cloud.note)).toBe('explain');
  });

  it('平台明确说没登录（user 为 null、或上传时 401）：未登录，点了去登录页；之前的"连不上"说明清掉', async () => {
    const h1 = setup({ user: null });
    await h1.cloud.start();
    expect([h1.cloud.status, tapAction(h1.cloud.status, h1.cloud.note)]).toEqual(['loggedOut', 'login']);
    const h2 = setup();
    await h2.cloud.start();
    h2.server.override = (c) => (c.method === 'PUT' ? 'throw' : undefined);
    h2.play('stats', stats({ games: 1 }));
    await advance(DEBOUNCE_MS);
    expect(h2.cloud.note).toBe('offline');
    h2.server.override = (c) => (c.method === 'PUT' ? json({ error: 'unauthorized', message: '' }, 401) : undefined);
    h2.play('stats', stats({ games: 2 }));
    await advance(DEBOUNCE_MS);
    expect([h2.cloud.status, h2.cloud.note, tapAction(h2.cloud.status, h2.cloud.note)]).toEqual(['loggedOut', null, 'login']);
  });

  it('没有提示 cookie：未登录，点了去登录页', async () => {
    const h = setup({ hint: false });
    await h.cloud.start();
    expect(tapAction(h.cloud.status, h.cloud.note)).toBe('login');
  });

  it('只要有说明就先说明，哪怕状态是未登录', () => {
    for (const n of ['offline', 'paused', 'tooLarge'] as const) expect(tapAction('loggedOut', n)).toBe('explain');
    for (const st of ['synced', 'syncing', 'pending', 'merged'] as const) expect(tapAction(st, null)).toBe('explain');
  });
});

describe('429 的等待、切后台的间隔（审阅第 3、4 条）', () => {
  it('429 之后玩家又改了：也不早于 retryAfter 再传', async () => {
    const h = setup();
    await h.cloud.start();
    let n = 0;
    h.server.override = (c) => (c.method === 'PUT' && n++ === 0 ? json({ error: 'rate_limited', message: '', retryAfter: 120 }, 429) : undefined);
    h.play('stats', stats({ games: 1 }));
    await advance(DEBOUNCE_MS);
    expect(h.puts()).toHaveLength(1);
    await advance(1000);
    h.play('stats', stats({ games: 2 }));
    h.cloud.flushOnHide();
    await advance(100_000);
    expect(h.puts()).toHaveLength(1);
    await advance(21_000);
    expect(h.puts()).toHaveLength(2);
    expect(h.puts()[1]!.body!.data).toEqual(stats({ games: 2 }));
  });

  it('切后台：离这个槽上次上传不到 3 分钟不补传，过了才补', async () => {
    const h = setup();
    await h.cloud.start();
    h.play('stats', stats({ games: 1 }));
    await advance(DEBOUNCE_MS);
    expect(h.puts()).toHaveLength(1);
    h.play('stats', stats({ games: 2 }));
    await advance(HIDE_GAP_MS - 20_000);
    h.cloud.flushOnHide();
    await settle();
    expect(h.puts()).toHaveLength(1);
    await advance(20_000);
    h.cloud.flushOnHide();
    await settle();
    expect(h.puts()).toHaveLength(2);
    expect(h.puts()[1]!.init.keepalive).toBe(true);
  });

  it('手机上两分钟一副、每副都切出去：一小时不超过 20 次（每天 100 次够玩 5 小时）', async () => {
    const h = setup();
    await h.cloud.start();
    for (let i = 1; i <= 30; i++) {
      h.play('stats', stats({ deals: i }));
      await advance(90_000);
      h.cloud.flushOnHide();
      await advance(30_000);
    }
    expect(h.puts().length).toBeLessThanOrEqual(20);
    // 最后的也会传上去（下一次切后台或计时器）
    await advance(MIN_GAP_MS);
    expect(h.server.saves.get('stats')?.data).toEqual(stats({ deals: 30 }));
  });
});

describe('多个标签页（审阅第 6 条）', () => {
  it('另一个标签页传完了：这边跟着更新 rev，再传不冲突', async () => {
    const h = setup();
    const tab2 = h.open();
    await h.cloud.start();
    await tab2.start();
    h.play('stats', stats({ games: 1 }));
    await advance(DEBOUNCE_MS);
    tab2.onExternalMeta();
    h.play('stats', stats({ games: 2 }), tab2);
    await advance(DEBOUNCE_MS);
    expect(h.puts().map((p) => p.body!.baseRev)).toEqual([0, 1]);
    expect(h.server.saves.get('stats')).toEqual({ rev: 2, data: stats({ games: 2 }) });
  });

  it('另一个标签页有待上传的：这边也看得到（图标是待上传）', async () => {
    const h = setup();
    const tab2 = h.open();
    await h.cloud.start();
    await tab2.start();
    h.play('stats', stats({ games: 1 }));
    expect(tab2.status).toBe('synced');
    tab2.onExternalMeta();
    expect(tab2.status).toBe('pending');
  });

  it('另一个标签页换了账号：这边改用新账号的元数据', async () => {
    const h = setup({ remote: { stats: { rev: 4, data: stats({ games: 9 }) } }, local: { stats: stats({ games: 9 }) } });
    await h.cloud.start();
    const other = h.open();
    h.server.user = 'u2';
    h.server.saves.clear();
    await other.start();
    h.cloud.onExternalMeta();
    h.play('stats', stats({ games: 1 }));
    await advance(DEBOUNCE_MS);
    expect(h.puts().map((p) => p.body)).toEqual([{ baseRev: 0, data: stats({ games: 1 }) }]);
  });
});

describe('页面开着时别的标签页换了账号：旧账号的战绩不能写进新账号（复审 A）', () => {
  const mine = stats({ games: 41, wins: 20 });

  it('换成的账号没有存档：平台回 wrong_user，不合并、不重试，改走换账号', async () => {
    const h = setup({ remote: { stats: { rev: 3, data: mine } }, local: { stats: mine } });
    await h.cloud.start();
    h.server.user = 'u2';
    h.play('stats', stats({ games: 42, wins: 20 }));
    await advance(DEBOUNCE_MS);
    await advance(MIN_GAP_MS * 2);
    expect(writesTo(h, 'u2')).toEqual([]);
    expect(h.server.savesOf('u2').size).toBe(0);
    // 只发了一次，被平台以 wrong_user 拒收；没有用 baseRev 0 重交
    expect(h.puts().map((p) => [p.body!.baseRev, p.sentUserId])).toEqual([[3, 'u1']]);
    expect(h.local.get('stats')).toEqual(stats());
    expect(h.backups.get('stats.pre-switch.u1')).toEqual(stats({ games: 42, wins: 20 }));
    expect(h.meta()?.userId).toBe('u2');
  });

  it('换成的账号有存档、rev 碰巧一样：平台按 userId 拒收，u2 的存档原样不动，本机换成 u2 的', async () => {
    const h = setup({ remote: { stats: { rev: 3, data: mine } }, local: { stats: mine } });
    await h.cloud.start();
    h.server.savesOf('u2').set('stats', { rev: 3, data: stats({ games: 1 }) });
    h.server.user = 'u2';
    h.play('stats', stats({ games: 42, wins: 20 }));
    await advance(DEBOUNCE_MS);
    await advance(MIN_GAP_MS * 2);
    expect(writesTo(h, 'u2')).toEqual([]);
    expect(h.puts()).toHaveLength(1);
    expect(h.server.savesOf('u2').get('stats')).toEqual({ rev: 3, data: stats({ games: 1 }) });
    expect(h.backups.get('stats.pre-switch.u1')).toEqual(stats({ games: 42, wins: 20 }));
    expect(h.local.get('stats')).toEqual(stats({ games: 1 }));
    expect(h.meta()?.userId).toBe('u2');
  });

  it('回到前台时确认身份：换了账号当场切换；1 分钟内不重复问', async () => {
    const h = setup({ remote: { stats: { rev: 3, data: mine } }, local: { stats: mine } });
    await h.cloud.start();
    h.server.user = 'u2';
    await h.cloud.resume();
    expect(h.calls.filter((c) => c.url === '/api/me')).toHaveLength(1);
    await advance(VERIFY_MS);
    await h.cloud.resume();
    expect(h.calls.filter((c) => c.url === '/api/me')).toHaveLength(2);
    expect(h.meta()?.userId).toBe('u2');
    expect(h.local.get('stats')).toEqual(stats());
    h.play('stats', stats({ games: 1 }));
    await advance(DEBOUNCE_MS);
    expect(writesTo(h, 'u2').map((p) => p.body!.data)).toEqual([stats({ games: 1 })]);
  });

  it('别的标签页退出了（提示 cookie 没了）：不传，显示未登录', async () => {
    const h = setup({ remote: { stats: { rev: 3, data: mine } }, local: { stats: mine } });
    await h.cloud.start();
    h.server.hint = false;
    h.server.user = null;
    h.play('stats', stats({ games: 42 }));
    await advance(DEBOUNCE_MS);
    h.cloud.flushOnHide();
    await advance(MIN_GAP_MS);
    expect(h.puts()).toEqual([]);
    expect(h.cloud.status).toBe('loggedOut');
  });

  it('提示 cookie 还在、但会话在别处失效了：平台 401，不再传，显示未登录', async () => {
    const h = setup({ remote: { stats: { rev: 3, data: mine } }, local: { stats: mine } });
    await h.cloud.start();
    h.server.user = null;
    h.play('stats', stats({ games: 42 }));
    await advance(DEBOUNCE_MS);
    h.play('stats', stats({ games: 43 }));
    await advance(MIN_GAP_MS);
    expect(h.puts().map((p) => p.status)).toEqual([undefined]);
    expect(h.cloud.status).toBe('loggedOut');
  });

  it('关页面时照常补传（带着 userId，换了账号平台会拒收）', async () => {
    const h = setup();
    await h.cloud.start();
    await advance(VERIFY_MS + 1000);
    h.play('stats', stats({ games: 1 }));
    h.cloud.flushOnHide();
    await settle();
    expect(h.puts().map((p) => [p.init.keepalive, p.sentUserId, p.status])).toEqual([[true, 'u1', 200]]);
  });

  it('启动时没问到身份（连不上）：回到前台再问，问到了照常同步', async () => {
    const h = setup({ local: { stats: stats({ games: 2 }) } });
    h.server.override = () => 'throw';
    await h.cloud.start();
    expect(h.cloud.note).toBe('offline');
    h.server.override = null;
    await advance(VERIFY_MS);
    await h.cloud.resume();
    await advance(0);
    expect(h.cloud.note).toBe(null);
    expect(h.puts().map((p) => p.body)).toEqual([{ baseRev: 0, data: stats({ games: 2 }) }]);
  });
});

describe('多个标签页：没在玩的那页，待上传会跟着消掉（复审 B）', () => {
  it('别的页传完了、本页没改过：本页不再待上传，也不多传', async () => {
    const h = setup();
    const idle = h.open();
    await h.cloud.start();
    await idle.start();
    h.play('stats', stats({ games: 1 }));
    idle.onExternalMeta();
    expect(idle.status).toBe('pending');
    await advance(DEBOUNCE_MS);
    idle.onExternalMeta();
    expect(idle.status).toBe('synced');
    idle.flushOnHide();
    await advance(MIN_GAP_MS * 2);
    expect(h.puts()).toHaveLength(1);
  });

  it('本页自己也改过：不清，按别的页传完后的 rev 再传，不冲突', async () => {
    const h = setup();
    const tab2 = h.open();
    await h.cloud.start();
    await tab2.start();
    h.play('stats', stats({ games: 1 }));
    await advance(5000);
    // 两页共用本机存储：这页在那页的基础上又打了一副
    h.play('stats', stats({ games: 2 }), tab2);
    await advance(DEBOUNCE_MS - 5000);
    expect(h.puts()).toHaveLength(1);
    tab2.onExternalMeta();
    expect(tab2.status).toBe('pending');
    await advance(DEBOUNCE_MS);
    expect(h.puts().map((p) => [p.body!.baseRev, p.status])).toEqual([[0, 200], [1, 200]]);
    expect(h.server.saves.get('stats')?.data).toEqual(stats({ games: 2 }));
  });
});

describe('上传带 userId、处理 wrong_user（平台 0.7.1）', () => {
  it('每个 PUT 都带 /api/me 给的 user.id（正常上传、409 后重交、切后台补传）', async () => {
    const h = setup({ remote: { stats: { rev: 1, data: stats() } } });
    await h.cloud.start();
    h.server.saves.set('stats', { rev: 2, data: stats({ games: 5 }) });
    h.play('stats', stats({ games: 1, wins: 1 }));
    await advance(DEBOUNCE_MS);
    h.play('tutorial', { v: 1, done: true });
    h.cloud.flushOnHide();
    await advance(DEBOUNCE_MS);
    // [keepalive, baseRev, userId]：正常上传（撞上 409）、409 后按云端 rev 重交、切后台的 keepalive 补传
    expect(h.puts().map((p) => [p.init.keepalive, p.body!.baseRev, p.sentUserId])).toEqual([
      [false, 1, 'u1'],
      [false, 2, 'u1'],
      [true, 0, 'u1'],
    ]);
  });

  it('wrong_user 时 /api/me 也连不上：本机照样备份、清空，不再传；回到前台问到新账号后接着同步', async () => {
    const h = setup({ remote: { stats: { rev: 3, data: stats({ games: 41 }) } }, local: { stats: stats({ games: 41 }) } });
    await h.cloud.start();
    h.server.user = 'u2';
    h.server.override = (c) => (c.url === '/api/me' ? 'throw' : undefined);
    h.play('stats', stats({ games: 42 }));
    await advance(DEBOUNCE_MS);
    expect(h.local.get('stats')).toEqual(stats());
    expect(h.backups.get('stats.pre-switch.u1')).toEqual(stats({ games: 42 }));
    expect([h.cloud.status, h.cloud.note]).toEqual(['pending', 'offline']);
    // 元数据当下就存了盘、不记账号：这时关掉页面，下次打开也只是"本地空档的首次同步"
    expect(h.meta()).toEqual({ v: 1, userId: null, rev: {}, dirty: [] });
    h.play('stats', stats({ games: 1 }));
    await advance(MIN_GAP_MS);
    expect(h.puts()).toHaveLength(1);
    h.server.override = null;
    await advance(VERIFY_MS);
    await h.cloud.resume();
    await advance(DEBOUNCE_MS);
    expect(h.meta()?.userId).toBe('u2');
    // 连不上期间新玩的那副（本机已是空档基础上的）算 u2 登录前玩的，并进 u2
    expect(h.puts().slice(1).map((p) => [p.user, p.sentUserId, p.status])).toEqual([['u2', 'u2', 200]]);
    expect(h.server.savesOf('u1').get('stats')).toEqual({ rev: 3, data: stats({ games: 41 }) });
  });

  it('wrong_user 不当成连不上，也不按 conflict 合并', async () => {
    const h = setup({ remote: { stats: { rev: 3, data: stats({ games: 41 }) } }, local: { stats: stats({ games: 41 }) } });
    await h.cloud.start();
    h.server.user = 'u2';
    h.play('stats', stats({ games: 42 }));
    await advance(DEBOUNCE_MS);
    expect(h.cloud.note).toBe(null);
    expect(h.backups.has('stats.pre-sync')).toBe(false);
    expect(h.cloud.status).toBe('synced');
  });
});

describe('连不上时回到前台：按上次尝试的时间限频（不只看上次成功）', () => {
  it('启动时连不上，之后频繁切回来：1 分钟内最多问一次 /api/me', async () => {
    const h = setup();
    h.server.override = () => 'throw';
    await h.cloud.start();
    for (let i = 0; i < 10; i++) {
      await h.cloud.resume();
      await advance(5000);
    }
    // 这 10 次切回来共 50 秒，都在启动那次尝试的 1 分钟内：只有启动时问的 1 次
    expect(h.calls.filter((c) => c.url === '/api/me')).toHaveLength(1);
    // 到第 65 秒：离上次尝试超过 1 分钟，再问 1 次
    await advance(15_000);
    await h.cloud.resume();
    expect(h.calls.filter((c) => c.url === '/api/me')).toHaveLength(2);
    // 刚失败的这次也算：紧接着再切回来不问
    await advance(30_000);
    await h.cloud.resume();
    expect(h.calls.filter((c) => c.url === '/api/me')).toHaveLength(2);
  });
});

describe('换号时的备份（0.1.8 审阅）', () => {
  const mine = stats({ games: 41, wins: 20 });
  const theirs = stats({ games: 7, wins: 30, firsts: 5 });

  it('两个标签页：别的页已经换号、备份并拉成了 u2，本页迟到的 wrong_user 不再备份、不再清空', async () => {
    const h = setup({ remote: { stats: { rev: 3, data: mine } }, local: { stats: mine } });
    const tabA = h.cloud;
    const tabB = h.open();
    await tabA.start();
    await tabB.start();
    h.server.savesOf('u2').set('stats', { rev: 1, data: theirs });
    await advance(VERIFY_MS);
    h.server.user = 'u2';
    // A 页打完一副（本机共用存储），还没传；B 页切回前台，先发现了换号
    h.play('stats', stats({ games: 42, wins: 20 }), tabA);
    await tabB.resume();
    expect(h.backups.get('stats.pre-switch.u1')).toEqual(stats({ games: 42, wins: 20 }));
    expect(h.local.get('stats')).toEqual(theirs);
    // A 页的 u1 上传这时被拒（storage 事件还没到）
    await advance(DEBOUNCE_MS);
    expect(h.puts().map((p) => [p.sentUserId, p.status])).toEqual([['u1', undefined]]);
    // u1 的备份没被 u2 的数据混进去，本机 u2 的数据也没被清掉
    expect(h.backups.get('stats.pre-switch.u1')).toEqual(stats({ games: 42, wins: 20 }));
    expect(h.local.get('stats')).toEqual(theirs);
    expect(h.meta()?.userId).toBe('u2');
    expect(writesTo(h, 'u2')).toEqual([]);
  });

  it('两个标签页：别的页已经换号，本页回到前台才发现（storage 事件还没到）——不再备份、不清掉已拉下来的 u2 数据', async () => {
    const h = setup({ remote: { stats: { rev: 3, data: mine } }, local: { stats: mine } });
    const tabA = h.cloud;
    const tabB = h.open();
    await tabA.start();
    await tabB.start();
    h.server.savesOf('u2').set('stats', { rev: 1, data: theirs });
    await advance(VERIFY_MS);
    h.server.user = 'u2';
    await tabB.resume();
    expect(h.backups.get('stats.pre-switch.u1')).toEqual(mine);
    expect(h.local.get('stats')).toEqual(theirs);
    await tabA.resume();
    await advance(MIN_GAP_MS);
    expect(h.backups.get('stats.pre-switch.u1')).toEqual(mine);
    expect(h.local.get('stats')).toEqual(theirs);
    expect(h.puts()).toEqual([]);
  });

  it('换号时备份没存上（存储满了）：不清空本地，不拉新账号的数据，暂停并提示；腾出空间后下次打开照常换号', async () => {
    const old: CloudMeta = { v: 1, userId: 'u1', rev: { stats: 3 }, dirty: [] };
    const h = setup({ user: 'u2', meta: old, local: { stats: mine }, remote: { stats: { rev: 1, data: theirs } } });
    h.disk.full = true;
    await h.cloud.start();
    await advance(MIN_GAP_MS);
    expect(h.local.get('stats')).toEqual(mine);
    expect(h.calls.map((c) => c.url)).toEqual(['/api/me']);
    expect([h.cloud.status, h.cloud.note, tapAction(h.cloud.status, h.cloud.note)]).toEqual(['pending', 'noSpace', 'explain']);
    expect(h.meta()).toEqual(old);
    h.disk.full = false;
    const again = h.open();
    await again.start();
    expect(h.backups.get('stats.pre-switch.u1')).toEqual(mine);
    expect(h.local.get('stats')).toEqual(theirs);
    expect(h.puts()).toEqual([]);
  });

  it('wrong_user 时备份没存上：同样不清空、不再传', async () => {
    const h = setup({ remote: { stats: { rev: 3, data: mine } }, local: { stats: mine } });
    await h.cloud.start();
    h.server.user = 'u2';
    h.disk.full = true;
    h.play('stats', stats({ games: 42, wins: 20 }));
    await advance(DEBOUNCE_MS);
    h.play('stats', stats({ games: 43, wins: 20 }));
    await advance(MIN_GAP_MS * 2);
    expect(h.local.get('stats')).toEqual(stats({ games: 43, wins: 20 }));
    expect(h.cloud.note).toBe('noSpace');
    expect(h.puts()).toHaveLength(1);
    expect(h.meta()?.userId).toBe('u1');
  });

  it('wrong_user 后问到的还是原账号（换走又换回来）：备份里没传上去的并回本地、补传，不盖云端', async () => {
    const h = setup({ remote: { stats: { rev: 3, data: mine } }, local: { stats: mine } });
    await h.cloud.start();
    // 别的设备期间也传过（云端 wins 更大）
    h.server.saves.set('stats', { rev: 4, data: stats({ games: 41, wins: 25 }) });
    let once = true;
    h.server.override = (c) => {
      if (c.method !== 'PUT' || !once) return undefined;
      once = false;
      return json({ error: 'wrong_user', message: '' }, 409);
    };
    h.play('stats', stats({ games: 42, wins: 20 }));
    await advance(DEBOUNCE_MS);
    // 被拒 → 问 /api/me → 拉取 → 并回备份，之后才排补传
    await advance(1000);
    const want = stats({ games: 42, wins: 25 });
    expect(h.local.get('stats')).toEqual(want);
    expect(h.puts().slice(1).map((p) => [p.body, p.sentUserId, p.status])).toEqual([[{ baseRev: 4, data: want }, 'u1', 200]]);
    expect(h.server.saves.get('stats')).toEqual({ rev: 5, data: want });
  });

  it('跨会话换回来（u1 → u2 → u1）：u1 当时没传上去的也并回来', async () => {
    const h = setup({ user: 'u1', meta: { v: 1, userId: 'u2', rev: { stats: 1 }, dirty: [] }, local: { stats: theirs }, remote: { stats: { rev: 4, data: stats({ games: 45 }) } } });
    h.backups.set('stats.pre-switch.u1', stats({ games: 50, wins: 20 }));
    await h.cloud.start();
    await advance(0);
    expect(h.backups.get('stats.pre-switch.u2')).toEqual(theirs);
    expect(h.puts().map((p) => p.body)).toEqual([{ baseRev: 4, data: stats({ games: 50, wins: 20 }) }]);
  });

  it('同一个备份 key 只会变多：已经有备份时再备份，和旧的合并而不是覆盖', async () => {
    const h = setup({ user: 'u2', meta: { v: 1, userId: 'u1', rev: {}, dirty: [] }, local: { stats: stats({ games: 3 }) } });
    h.backups.set('stats.pre-switch.u1', stats({ games: 1, wins: 9 }));
    await h.cloud.start();
    expect(h.backups.get('stats.pre-switch.u1')).toEqual(stats({ games: 3, wins: 9 }));
  });
});

describe('400 和换号后的状态（0.1.8 审阅）', () => {
  it('400：这个槽本次不再传，给"云端不收"的说明（不是"连不上"）；别的槽照常', async () => {
    const h = setup();
    await h.cloud.start();
    h.server.override = (c) => (c.method === 'PUT' && c.url.endsWith('/stats') ? json({ error: 'bad_request', message: '' }, 400) : undefined);
    h.play('stats', stats({ games: 1 }));
    await advance(DEBOUNCE_MS);
    expect([h.cloud.note, tapAction(h.cloud.status, h.cloud.note)]).toEqual(['rejected', 'explain']);
    h.play('stats', stats({ games: 2 }));
    h.cloud.flushOnHide();
    await advance(MIN_GAP_MS * 2);
    expect(h.puts().filter((p) => p.url.endsWith('/stats'))).toHaveLength(1);
    h.play('tutorial', { v: 1, done: true });
    await advance(DEBOUNCE_MS);
    expect(h.puts().filter((p) => p.url.endsWith('/tutorial')).map((p) => p.status)).toEqual([200]);
  });

  it('旧账号的 413 封槽、429 等待、上传间隔不带到新账号', async () => {
    const h = setup();
    await h.cloud.start();
    h.server.override = (c) => {
      if (c.method !== 'PUT') return undefined;
      return c.url.endsWith('/stats') ? json({ error: 'too_large', message: '' }, 413) : json({ error: 'rate_limited', message: '', retryAfter: 3600 }, 429);
    };
    h.play('stats', stats({ games: 1 }));
    h.play('tutorial', { v: 1, done: true });
    await advance(DEBOUNCE_MS);
    h.server.override = null;
    h.server.user = 'u2';
    await advance(VERIFY_MS);
    await h.cloud.resume();
    h.play('stats', stats({ games: 1 }));
    h.play('tutorial', { v: 1, done: true });
    await advance(DEBOUNCE_MS);
    expect(writesTo(h, 'u2').map((p) => p.url.split('/').pop()).sort()).toEqual(['stats', 'tutorial']);
  });
});

describe('并回备份只并一次（0.1.8 复审）', () => {
  it('并回、传上去以后备份改名成 .restored；之后输了一局连胜归零，再打开不会被抬回去、也不多传', async () => {
    const h = setup({ user: 'u1', meta: { v: 1, userId: 'u2', rev: { stats: 1 }, dirty: [] }, local: { stats: stats({ games: 2 }) }, remote: { stats: { rev: 4, data: stats({ games: 8 }) } } });
    h.backups.set('stats.pre-switch.u1', stats({ games: 10, wins: 6, streak: 5, bestStreak: 5 }));
    await h.cloud.start();
    await advance(1000);
    expect(h.server.saves.get('stats')).toEqual({ rev: 5, data: stats({ games: 10, wins: 6, streak: 5, bestStreak: 5 }) });
    expect(h.backups.has('stats.pre-switch.u1')).toBe(false);
    expect(h.backups.get('stats.pre-switch.u1.restored')).toEqual(stats({ games: 10, wins: 6, streak: 5, bestStreak: 5 }));
    // 输一局：连胜归零
    const lost = stats({ games: 11, wins: 6, streak: 0, bestStreak: 5 });
    h.play('stats', lost);
    await advance(MIN_GAP_MS);
    expect(h.server.saves.get('stats')).toEqual({ rev: 6, data: lost });
    const before = h.puts().length;
    // 下次打开
    const again = h.open();
    await again.start();
    await advance(MIN_GAP_MS * 2);
    expect(h.puts()).toHaveLength(before);
    expect(h.local.get('stats')).toEqual(lost);
    expect(h.server.saves.get('stats')?.data).toEqual(lost);
  });

  it('备份里的都已经在云端了（并回后没变化、也没有待上传）：当场改名，不传', async () => {
    const h = setup({ user: 'u1', meta: { v: 1, userId: 'u2', rev: {}, dirty: [] }, remote: { stats: { rev: 4, data: stats({ games: 8 }) } } });
    h.backups.set('stats.pre-switch.u1', stats({ games: 3 }));
    await h.cloud.start();
    await advance(MIN_GAP_MS);
    expect(h.puts()).toEqual([]);
    expect(h.backups.has('stats.pre-switch.u1')).toBe(false);
    expect(h.backups.get('stats.pre-switch.u1.restored')).toEqual(stats({ games: 3 }));
  });

  it('还没传上去就关了页面：备份还在，下次打开再并（不丢）', async () => {
    const h = setup({ user: 'u1', meta: { v: 1, userId: 'u2', rev: {}, dirty: [] }, remote: { stats: { rev: 4, data: stats({ games: 8 }) } } });
    h.backups.set('stats.pre-switch.u1', stats({ games: 10 }));
    h.server.override = (c) => (c.method === 'PUT' ? 'throw' : undefined);
    await h.cloud.start();
    await advance(1000);
    expect(h.backups.get('stats.pre-switch.u1')).toEqual(stats({ games: 10 }));
    h.server.override = null;
    const again = h.open();
    await again.start();
    await advance(1000);
    expect(h.server.saves.get('stats')?.data).toEqual(stats({ games: 10 }));
    expect(h.backups.has('stats.pre-switch.u1')).toBe(false);
  });
});

describe('拉取带预期账号（平台 0.7.3）', () => {
  const mine = stats({ games: 41, wins: 20 });
  const theirs = stats({ games: 7, wins: 30, firsts: 5 });

  it('GET 带 ?userId=<user.id>', async () => {
    const h = setup();
    await h.cloud.start();
    expect(h.calls.filter((c) => c.url === '/api/saves/guandan').map((c) => c.query)).toEqual(['?userId=u1']);
  });

  it('问完 /api/me、拉取之前 cookie 换成了 u2：平台回 wrong_user，不拉进 u2 的数据，按换号处理', async () => {
    const h = setup({ remote: { stats: { rev: 3, data: mine } }, local: { stats: mine } });
    h.server.savesOf('u2').set('stats', { rev: 1, data: theirs });
    let first = true;
    h.server.override = (c) => {
      if (c.url === '/api/saves/guandan' && first) {
        first = false;
        h.server.user = 'u2';
      }
      return undefined;
    };
    await h.cloud.start();
    await advance(MIN_GAP_MS);
    expect(h.backups.get('stats.pre-switch.u1')).toEqual(mine);
    expect(h.local.get('stats')).toEqual(theirs);
    expect(h.meta()?.userId).toBe('u2');
    expect(h.puts()).toEqual([]);
  });

  it('拉取还没回来时本页已经换了号：回来的旧账号数据丢掉，不混进新账号', async () => {
    const h = setup({ remote: { stats: { rev: 3, data: mine } }, local: { stats: mine } });
    h.server.savesOf('u2').set('stats', { rev: 1, data: theirs });
    let release: (r: Response) => void = () => {};
    let first = true;
    h.server.override = (c) => {
      if (c.url !== '/api/saves/guandan' || !first) return undefined;
      first = false;
      return new Promise<Response>((res) => (release = res));
    };
    void h.cloud.start();
    await advance(VERIFY_MS);
    h.server.user = 'u2';
    await h.cloud.resume();
    expect(h.local.get('stats')).toEqual(theirs);
    // u1 的那次拉取这时才回来
    release(json({ saves: [{ slot: 'stats', rev: 3, updatedAt: 1, data: mine }] }));
    await advance(MIN_GAP_MS);
    expect(h.local.get('stats')).toEqual(theirs);
    expect(h.puts()).toEqual([]);
    expect(h.meta()?.rev.stats).toBe(1);
  });
});

describe('并回备份的收尾（0.1.8 复审第二轮）', () => {
  it('并回后上传撞上 409、合并后和云端一样不用重交：备份照样改名，下次不再并', async () => {
    const h = setup({ user: 'u1', meta: { v: 1, userId: 'u2', rev: {}, dirty: [] }, remote: { stats: { rev: 4, data: stats({ games: 8 }) } } });
    h.backups.set('stats.pre-switch.u1', stats({ games: 10, streak: 3 }));
    // 并回后、上传前，别的设备传了一份更大的
    let first = true;
    h.server.override = (c) => {
      if (c.method === 'PUT' && first) {
        first = false;
        h.server.saves.set('stats', { rev: 5, data: stats({ games: 12, streak: 3 }) });
      }
      return undefined;
    };
    await h.cloud.start();
    await advance(1000);
    expect(h.puts().map((p) => p.body!.baseRev)).toEqual([4]);
    expect(h.backups.has('stats.pre-switch.u1')).toBe(false);
    expect(h.backups.get('stats.pre-switch.u1.restored')).toEqual(stats({ games: 10, streak: 3 }));
  });

  it('多标签页 u1→u2→u1：A 页跟着别的页换号时丢掉"等上传成功后改名"的记录，不会替 B 页把还没并回的 pre-switch.u1 提前改名', async () => {
    const h = setup({ user: 'u1', meta: { v: 1, userId: 'u2', rev: {}, dirty: [] }, remote: { stats: { rev: 4, data: stats({ games: 8 }) } } });
    h.backups.set('stats.pre-switch.u1', stats({ games: 10 }));
    const tabA = h.cloud;
    // A 页并回了 games 10，但上传失败（还等着成功后改名）
    h.server.override = (c) => (c.method === 'PUT' ? 'throw' : undefined);
    await tabA.start();
    await advance(1000);
    expect(h.local.get('stats')).toEqual(stats({ games: 10 }));
    h.server.override = null;
    // B 页：这台设备上又玩了一点（games 12），然后换成 u2——games 12 进了 pre-switch.u1
    h.local.set('stats', stats({ games: 12 }));
    h.server.user = 'u2';
    const tabB = h.open();
    await tabB.start();
    expect(h.backups.get('stats.pre-switch.u1')).toEqual(stats({ games: 12 }));
    tabA.onExternalMeta();
    // B 页又换回 u1：存了元数据，但拉取还没回来（还没并回 pre-switch.u1）
    let release: (r: Response) => void = () => {};
    let hold = true;
    h.server.user = 'u1';
    h.server.override = (c) => {
      if (c.url !== '/api/saves/guandan' || !hold) return undefined;
      hold = false;
      return new Promise<Response>((res) => (release = res));
    };
    await advance(VERIFY_MS);
    void tabB.resume();
    await settle();
    tabA.onExternalMeta();
    // A 页这时传了一次（u1，成功或撞 409 都一样）
    h.play('stats', stats({ games: 1 }), tabA);
    await advance(DEBOUNCE_MS);
    expect(h.backups.get('stats.pre-switch.u1')).toEqual(stats({ games: 12 }));
    // B 页的拉取回来，把 games 12 并回、传上去
    release(json({ saves: [{ slot: 'stats', rev: h.server.saves.get('stats')!.rev, updatedAt: 1, data: h.server.saves.get('stats')!.data }] }));
    await advance(1000);
    await advance(MIN_GAP_MS);
    expect((h.server.saves.get('stats')?.data as Stats).games).toBe(12);
  });

  it('拉取回 400：给"云端不收"的说明，不是静默停下', async () => {
    const h = setup();
    h.server.override = (c) => (c.url === '/api/saves/guandan' ? json({ error: 'bad_request', message: '' }, 400) : undefined);
    await h.cloud.start();
    expect([h.cloud.note, tapAction(h.cloud.status, h.cloud.note)]).toEqual(['rejected', 'explain']);
  });
});

describe('回大厅时的补传（0.1.9）', () => {
  it('不受切后台 3 分钟间隔限制；封了槽、在等 429、没登录照样不传', async () => {
    const h = setup();
    await h.cloud.start();
    h.play('stats', stats({ games: 1 }));
    await advance(DEBOUNCE_MS);
    h.play('stats', stats({ games: 2 }));
    h.cloud.flushOnHide();
    await settle();
    expect(h.puts()).toHaveLength(1);
    h.cloud.flushOnHide(true);
    await settle();
    expect(h.puts().map((p) => [p.init.keepalive, p.body!.data])).toEqual([
      [false, stats({ games: 1 })],
      [true, stats({ games: 2 })],
    ]);
    // 在等 429：不传
    const h2 = setup();
    await h2.cloud.start();
    h2.server.override = (c) => (c.method === 'PUT' ? json({ error: 'rate_limited', message: '', retryAfter: 600 }, 429) : undefined);
    h2.play('stats', stats({ games: 1 }));
    await advance(DEBOUNCE_MS);
    h2.cloud.flushOnHide(true);
    await settle();
    expect(h2.puts()).toHaveLength(1);
    // 封了槽（413）：不传
    const h3 = setup();
    await h3.cloud.start();
    h3.server.override = (c) => (c.method === 'PUT' ? json({ error: 'too_large', message: '' }, 413) : undefined);
    h3.play('stats', stats({ games: 1 }));
    await advance(DEBOUNCE_MS);
    h3.cloud.flushOnHide(true);
    await settle();
    expect(h3.puts()).toHaveLength(1);
    // 没登录：一个请求都不发
    const h4 = setup({ hint: false });
    await h4.cloud.start();
    h4.play('stats', stats({ games: 1 }));
    h4.cloud.flushOnHide(true);
    await settle();
    expect(h4.calls).toEqual([]);
  });
});
