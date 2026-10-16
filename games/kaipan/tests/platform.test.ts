import { describe, expect, it } from 'vitest';
import { createRun, dispatch, type Action, type GameState } from '../src/core/index.ts';
import { DEFAULT_SETTINGS, loadSettings, sanitizeSettings, saveSettings, type KeyValueStore } from '../src/platform/settings.ts';
import { LEGACY_KEYS, clearLegacyKeys, clearSave, hasSave, loadSave, reviveState, writeSave } from '../src/platform/storage.ts';
import { APP_VERSION } from '../src/platform/version.ts';

/** 内存版 localStorage。 */
class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  failWrites = false;
  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
}

function playedState(): GameState {
  let s = createRun('platform-test').state;
  const actions: Action[] = [{ type: 'buy', rec: 0 }, { type: 'open' }, { type: 'open' }];
  for (const a of actions) {
    const r = dispatch(s, a);
    if (r.error) throw new Error(r.error);
    s = r.state;
  }
  return s;
}

/** 0.2 的存档（format 3）大致长这样。 */
const V02_SAVE = JSON.stringify({ format: 3, appVersion: '0.2.0', savedAt: 'x', state: { version: 2, seed: 'old', fund: 1e6, exam: { index: 3 } } });

describe('设置', () => {
  it('没有存储或内容损坏时用默认值', () => {
    expect(loadSettings(null)).toEqual({ ...DEFAULT_SETTINGS, reduceMotion: false });
    const store = new MemoryStore();
    store.setItem('kaipan.settings', '{坏掉的 json');
    expect(loadSettings(store).masterVolume).toBe(DEFAULT_SETTINGS.masterVolume);
  });

  it('保存后能原样读回；写入失败不抛错', () => {
    const store = new MemoryStore();
    const s = sanitizeSettings({ ...DEFAULT_SETTINGS, musicVolume: 0.2, animSpeed: 2, colorScheme: 'intl' });
    saveSettings(s, store);
    expect(loadSettings(store)).toEqual(s);
    store.failWrites = true;
    expect(() => saveSettings(s, store)).not.toThrow();
  });
});

describe('存档（format 5）', () => {
  it('写入后原样读回，带格式 5 与版本号', () => {
    const store = new MemoryStore();
    const s = playedState();
    writeSave(s, store);
    expect(JSON.parse(store.getItem('kaipan.save') ?? '{}')).toMatchObject({ format: 5, appVersion: APP_VERSION });
    expect(hasSave(store)).toBe(true);
    expect(loadSave(store)).toEqual({ state: s, notice: null });
    clearSave(store);
    expect(hasSave(store)).toBe(false);
    expect(loadSave(store)).toEqual({ state: null, notice: null });
  });

  it('读档直接用快照，读回的局面能继续玩', () => {
    const store = new MemoryStore();
    const edited = { ...playedState(), account: 12345.67 };
    writeSave(edited, store);
    const back = loadSave(store).state;
    expect(back?.account).toBe(12345.67);
    const r = dispatch(back as GameState, { type: 'open' });
    expect(r.error).toBeNull();
  });

  it('0.3 以前和 0.4.0-alpha.1 的存档（format ≤ 4、6）：清掉，提示后开新局，不再备份', () => {
    for (const format of [1, 2, 3, 4, 6]) {
      const store = new MemoryStore();
      store.setItem('kaipan.save', JSON.stringify({ format, appVersion: 'old', savedAt: 'x', state: { version: 1, seed: 'old' } }));
      expect(hasSave(store)).toBe(false);
      expect(loadSave(store)).toEqual({ state: null, notice: 'legacy' });
      expect([...store.data.keys()]).toEqual([]);
      expect(loadSave(store)).toEqual({ state: null, notice: null });
    }
  });

  it('人设、难度、延后结算都在快照里，读回后照常继续', () => {
    const store = new MemoryStore();
    const s = createRun('platform-persona', { persona: 'mom', difficulty: 6 }).state;
    s.pending.push({ id: 'classmate_loan', month: 3, amount: 5000 });
    s.expiring.push({ id: 'mood_meter', month: 2 });
    writeSave(s, store);
    const back = loadSave(store).state;
    expect(back?.persona).toBe('mom');
    expect(back?.difficulty).toBe(6);
    expect(back?.pending).toEqual([{ id: 'classmate_loan', month: 3, amount: 5000 }]);
    expect(back?.expiring).toEqual([{ id: 'mood_meter', month: 2 }]);
    expect(reviveState({ ...JSON.parse(JSON.stringify(s)), persona: 'nobody' })).toBeNull();
  });

  it('设置不受旧存档影响', () => {
    const store = new MemoryStore();
    const settings = sanitizeSettings({ ...DEFAULT_SETTINGS, musicVolume: 0.3 });
    saveSettings(settings, store);
    store.setItem('kaipan.save', V02_SAVE);
    loadSave(store);
    expect(loadSettings(store)).toEqual(settings);
  });

  it('损坏的存档先备份再清除', () => {
    const store = new MemoryStore();
    store.setItem('kaipan.save', '{"format":5,"state":{"oops":true}}');
    expect(hasSave(store)).toBe(false);
    expect(loadSave(store)).toEqual({ state: null, notice: 'corrupt' });
    expect(store.getItem('kaipan.save')).toBeNull();
    expect(store.getItem('kaipan.save.corrupt')).toContain('oops');
    store.setItem('kaipan.save', '{坏掉的 json');
    expect(loadSave(store).notice).toBe('corrupt');
    store.setItem('kaipan.save', JSON.stringify({ format: 99, state: {} }));
    expect(loadSave(store).notice).toBe('corrupt');
  });

  it('新版本删除了的道具、群友、股票被剔除，其余保留', () => {
    const s = structuredClone(playedState());
    s.items.push('removed_item');
    s.friends.push({ id: 'removed_friend', hits: 0, total: 0, topics: [] });
    s.slots[1] = { ...(s.slots[0] as NonNullable<GameState['slots'][number]>), stockId: 'removed_stock' };
    const revived = reviveState(JSON.parse(JSON.stringify(s)));
    expect(revived?.items).toEqual(s.items.filter((id) => id !== 'removed_item'));
    expect(revived?.friends.map((f) => f.id)).not.toContain('removed_friend');
    expect(revived?.slots[1]).toBeNull();
    expect(revived?.slots[0]).toEqual(s.slots[0]);
    expect(revived?.account).toBe(s.account);
  });

  it('结构不对的快照被拒绝', () => {
    expect(reviveState(null)).toBeNull();
    expect(reviveState({ version: 2 })).toBeNull();
    const s = playedState() as unknown as Record<string, unknown>;
    expect(reviveState(s)).not.toBeNull();
    expect(reviveState({ ...s, account: Number.NaN })).toBeNull();
    expect(reviveState({ ...s, phase: 'trading' })).toBeNull();
    expect(reviveState({ ...s, month: 13 })).toBeNull();
    expect(reviveState({ ...s, themeIds: ['nope'] })).toBeNull();
  });

  it('统计字段缺失或类型不对时补缺省值，读档后能接着玩到月底', () => {
    const raw = JSON.parse(JSON.stringify(playedState())) as GameState;
    const stats = raw.stats as unknown as Record<string, unknown>;
    for (const k of ['monthRets', 'acquired', 'seenItems', 'itemsTaken', 'picked', 'events', 'surprisesPaid', 'seenFriends', 'maxThemes']) delete stats[k];
    stats.limitDownDays = 'x';
    const revived = reviveState(raw);
    expect(revived).not.toBeNull();
    let st = revived as GameState;
    expect(st.stats.monthRets).toEqual([]);
    expect(st.stats.acquired).toEqual([]);
    expect(st.stats.limitDownDays).toBe(0);
    expect(st.stats.trades.length).toBe(playedState().stats.trades.length);
    // 一直开盘直到下个月（月底结算会用到 monthRets 等）
    const month = st.month;
    for (let i = 0; i < 40 && st.month === month && st.phase !== 'won' && st.phase !== 'lost'; i++) {
      const a: Action = st.phase === 'premarket' ? { type: 'open' } : st.phase === 'reward' ? { type: 'skipReward' } : { type: 'choose', option: 1 };
      const r = dispatch(st, a);
      expect(r.error).toBeNull();
      st = r.state;
    }
    expect(st.month === month + 1 || st.phase === 'lost').toBe(true);
  });

  it('0.3.0 存档里的上一天结算（没有归因、新闻、台词）读进来补空', () => {
    const raw = JSON.parse(JSON.stringify(playedState())) as GameState;
    expect(raw.lastDay).not.toBeNull();
    const last = raw.lastDay as unknown as Record<string, unknown> & { account: Record<string, unknown>; holdings: Record<string, unknown>[] };
    delete last.news;
    delete last.quips;
    delete last.account.effects;
    for (const h of last.holdings) {
      delete h.parts;
      delete h.amount;
    }
    const revived = reviveState(raw);
    expect(revived?.lastDay?.news).toEqual([]);
    expect(revived?.lastDay?.quips).toEqual([]);
    expect(revived?.lastDay?.account.effects).toEqual([]);
    for (const h of revived?.lastDay?.holdings ?? []) {
      expect(h.parts).toEqual([]);
      expect(h.amount).toBe(0);
    }
  });

  it('写入失败（配额不足）不抛错', () => {
    const store = new MemoryStore();
    store.failWrites = true;
    expect(() => writeSave(playedState(), store)).not.toThrow();
  });
});

describe('旧版本留在本机的 key（0.6.15 起启动时清掉）', () => {
  it('只清 LEGACY_KEYS，当前的存档、档案、设置、实盘、云同步等一个都不碰', () => {
    const store = new MemoryStore();
    // 现在还在用的（和没认出来的）key：清完必须一字不差
    const keep: Record<string, string> = {
      'kaipan.save': JSON.stringify({ format: 5, appVersion: APP_VERSION, savedAt: 'x', state: playedState() }),
      'kaipan.save.corrupt': '{坏的',
      'kaipan.profile': '{"v":1}',
      'kaipan.profile.corrupt': '{坏的',
      'kaipan.settings': '{"musicVolume":0.3}',
      'kaipan.live': '{"ref":"kaipan-x"}',
      'kaipan.cloud': '{}',
      'kaipan.profile.pre-sync': '{}',
      'kaipan.profile.pre-switch.u1.restored': '{}',
      'kaipan.tutorial.v3': '{}',
      'kaipan.save.v0.5': '以后的版本',
      'arcade.beta': '1',
    };
    for (const [k, v] of Object.entries(keep)) store.setItem(k, v);
    for (const k of LEGACY_KEYS) store.setItem(k, `old ${k}`);
    clearLegacyKeys(store);
    expect(Object.fromEntries(store.data)).toEqual(keep);
    // 没有旧 key 时什么都不做；再调一次也一样
    clearLegacyKeys(store);
    expect(Object.fromEntries(store.data)).toEqual(keep);
  });

  it('清单里只有旧版本的备份、0.3 的本地纪录和删掉的美股原型的 key', () => {
    expect([...LEGACY_KEYS].sort()).toEqual(
      [
        'kaipan.save.v1',
        'kaipan.save.v0.1',
        'kaipan.save.v0.2',
        'kaipan.save.v0.3',
        'kaipan.save.v0.3a',
        'kaipan.save.v0.4a',
        'kaipan.save.v0.3.restored',
        'kaipan.records',
        'kaipan.records.v0.2',
        'kaipan.records.v0.3',
        'kaipan.records.v0.4a',
        'kaipan.records.v0.3.restored',
        'kaipan.terms.v04',
      ].sort(),
    );
  });
});
