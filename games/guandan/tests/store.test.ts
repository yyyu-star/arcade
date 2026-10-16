/**
 * 设置、存档里的难度兼容旧值：0.12.1 起是新手 / 普通 / 高手三档，以前存的四档换过来，认不得的按默认"新手"。
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
  it('现在的三档照用；0.12.0 以前的四档换过来：简单→新手、普通照旧、较强→普通、困难→高手', async () => {
    for (const [old, now] of [['novice', 'novice'], ['normal', 'normal'], ['pro', 'pro'], ['easy', 'novice'], ['good', 'normal'], ['hard', 'pro']]) {
      mem.set('guandan.settings', JSON.stringify({ v: 1, volume: 0.5, difficulty: old }));
      vi.resetModules();
      const s = (await fresh()).getSettings();
      expect(s.difficulty).toBe(now);
      expect(s.volume).toBe(0.5);
    }
  });

  it('第一次玩、认不得的难度（以后的版本存的、手改坏的）都按默认"新手"，别的设置不丢', async () => {
    mem.set('guandan.settings', JSON.stringify({ v: 1, volume: 0.3, difficulty: 'insane' }));
    const s = (await fresh()).getSettings();
    expect(s.difficulty).toBe('novice');
    expect(s.volume).toBe(0.3);
    mem.delete('guandan.settings');
    vi.resetModules();
    expect((await fresh()).getSettings().difficulty).toBe('novice');
  });

  it('存档里的难度同样：旧的四档换过来，认不得的按"新手"接着打', async () => {
    const state = createGame('store-compat').state;
    const save = (difficulty: string) => mem.set('guandan.save', JSON.stringify({ v: 1, state, difficulty, counted: false, dealsCounted: 0 }));
    const store = await fresh();
    save('good');
    expect(store.loadSave()?.difficulty).toBe('normal');
    save('pro');
    expect(store.loadSave()?.difficulty).toBe('pro');
    save('insane');
    expect(store.loadSave()?.difficulty).toBe('novice');
  });
});
