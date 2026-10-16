/**
 * 设置、存档里的难度兼容旧值（0.8.2 加了"较强"）：旧版本存的三档照用，认不得的按默认"普通"。
 * store.ts 的设置是模块级缓存，每个用例重新导入一份。不起浏览器：假的 localStorage。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame } from '../src/core/index.ts';

const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  mem.clear();
  vi.resetModules();
});
const fresh = () => import('../src/view/store.ts');

describe('难度兼容旧值', () => {
  it('旧版本存的三档照用，新的"较强"存得住', async () => {
    for (const d of ['easy', 'normal', 'hard', 'good']) {
      mem.set('guandan.settings', JSON.stringify({ v: 1, volume: 0.5, difficulty: d }));
      vi.resetModules();
      const s = (await fresh()).getSettings();
      expect(s.difficulty).toBe(d);
      expect(s.volume).toBe(0.5);
    }
  });

  it('认不得的难度（以后的版本存的、手改坏的）按默认"普通"，别的设置不丢', async () => {
    mem.set('guandan.settings', JSON.stringify({ v: 1, volume: 0.3, difficulty: 'insane' }));
    const s = (await fresh()).getSettings();
    expect(s.difficulty).toBe('normal');
    expect(s.volume).toBe(0.3);
  });

  it('存档里的难度同样：认得的照用，认不得的按"普通"接着打', async () => {
    const state = createGame('store-compat').state;
    const save = (difficulty: string) => mem.set('guandan.save', JSON.stringify({ v: 1, state, difficulty, counted: false, dealsCounted: 0 }));
    const store = await fresh();
    save('good');
    expect(store.loadSave()?.difficulty).toBe('good');
    save('insane');
    expect(store.loadSave()?.difficulty).toBe('normal');
  });
});
