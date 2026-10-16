/**
 * 单机实盘的钱（自审 C1–C3）：带入先存再发、回包丢了用同一个号重发；离开后只差结回的回来只结回；
 * 晚到的旧一场不碰新一场的存档。浏览器的 localStorage、fetch 用桩代替。
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { DEFAULT_OPTS } from '../src/core/variants/sichuan-xuezhan/index.ts';
import { loadSolo, newSolo, Solo, SOLO_KEY, unsettled, type SoloSave } from '../src/solo.ts';

const store = new Map<string, string>();
type Reply = { status: number; body: unknown } | 'lost';
let replies: Reply[] = [];
const sent: { url: string; body: { op: string; session: string; amount: number } }[] = [];

beforeEach(() => {
  store.clear();
  sent.length = 0;
  replies = [];
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    const r = replies.shift() ?? { status: 200, body: {} };
    if (r === 'lost') throw new TypeError('network');
    return new Response(JSON.stringify(r.body), { status: r.status });
  });
});
afterEach(() => vi.unstubAllGlobals());

const ui = { frame: vi.fn(), roundEnd: vi.fn(), settled: vi.fn() };
const ok = { status: 200, body: { credited: 2_000 } };

function wallet(): SoloSave {
  const s = newSolo('small', DEFAULT_OPTS, '我', `ref${Math.random().toString(36).slice(2, 10)}`, 2_000);
  s.buying = { op: `op${Math.random().toString(36).slice(2, 12)}`, amount: 2_000 };
  return s;
}

describe('带入（C3）', () => {
  test('回包丢了：存着"带入中"，刷新后用同一个操作号重发，成了才清掉', async () => {
    const s = wallet();
    replies = ['lost'];
    const r = await new Solo(s, ui).buyin();
    expect(r).toEqual({ ok: false, error: 'network' });
    const saved = loadSolo()!;
    expect(saved.buying).toEqual(s.buying);
    expect(saved.done).toBe(false);
    // 刷新：从存档重来，同一个号、同一个 ref
    replies = [ok];
    const again = new Solo(saved, ui);
    expect((await again.buyin()).ok).toBe(true);
    expect(sent.map((x) => x.body.op)).toEqual([s.buying!.op, s.buying!.op]);
    expect(sent[1]!.body.session).toBe(s.ref);
    expect(loadSolo()!.buying).toBeNull();
  });

  test('平台忙（503）也当可能扣了，留着重发；明确拒了（钱不够）就丢掉这一场', async () => {
    replies = [{ status: 503, body: { error: 'unavailable' } }];
    await new Solo(wallet(), ui).buyin();
    expect(loadSolo()?.buying).toBeTruthy();
    store.clear();
    replies = [{ status: 409, body: { error: 'no_funds' } }];
    await new Solo(wallet(), ui).buyin();
    expect(loadSolo()).toBeNull();
  });
});

describe('结回（C2）', () => {
  test('离开时结回没成：存着结回的数和号；回来只结回、不接着打，用同一个号', async () => {
    const s = wallet();
    s.buying = null;
    const a = new Solo(s, ui);
    replies = ['lost'];
    await a.leave();
    const saved = loadSolo()!;
    expect(saved.settle).not.toBeNull();
    expect(saved.done).toBe(false);
    expect(unsettled(saved)).toBe(true);
    const op = saved.settle!.op;
    const before = JSON.stringify(saved.state);
    replies = [ok];
    const b = new Solo(saved, ui);
    b.resume();
    await vi.waitFor(() => expect(loadSolo()).toBeNull());
    expect(sent.at(-1)!.body.op).toBe(op);
    expect(sent.at(-1)!.body.amount).toBe(saved.settle!.amount);
    // 牌局一步没动（没让电脑接着打）
    expect(JSON.stringify(b.save.state)).toBe(before);
  });

  test('娱乐局、结完的不算没结', () => {
    expect(unsettled(newSolo('fun', DEFAULT_OPTS, '我', null, 2_000))).toBe(false);
    expect(unsettled({ ...wallet(), done: true })).toBe(false);
    expect(unsettled(null)).toBe(false);
  });
});

describe('存档只改自己那份（C1）', () => {
  test('旧一场的结回晚到：成了也不删新一场的存档，没成也不盖掉', async () => {
    const old = wallet();
    old.buying = null;
    const a = new Solo(old, ui);
    a.stop();
    // 新的一场开始、存下（带入成了）
    replies = [ok];
    const fresh = wallet();
    await new Solo(fresh, ui).buyin();
    expect(loadSolo()!.id).toBe(fresh.id);
    // 旧那场的结回这时候才回来：没成（写不进新一场的位置），成了（删不掉新一场的）
    replies = ['lost'];
    await a.finish();
    expect(loadSolo()!.id).toBe(fresh.id);
    replies = [ok];
    await a.finish();
    expect(old.done).toBe(true);
    expect(loadSolo()!.id).toBe(fresh.id);
  });

  test('旧版本的存档（没有号）当作就是存着的那一场', async () => {
    const s = wallet();
    s.buying = null;
    delete s.id;
    store.set(SOLO_KEY, JSON.stringify(s));
    replies = [ok];
    const a = new Solo(loadSolo()!, ui);
    a.stop();
    await a.finish();
    expect(loadSolo()).toBeNull();
  });
});
