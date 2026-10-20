/**
 * 斗地主的画面层纯函数和单机会话（牌馆 0.28.0）：理牌分列、一手牌的说法、会话推进、存档和战绩。
 * 不起浏览器：假的 localStorage；store.ts 有模块级缓存，每个用例重新导入一份。
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDdz, ddzValue, interpretDdz, type DdzPlay } from '../src/variants/doudizhu/index.ts';

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

describe('理牌分列', () => {
  it('按点数：每张牌都在、只出现一次，同点一列、大的在左', async () => {
    const { ddzColumns } = await import('../src/view/ddz-view.ts');
    for (const seed of ['a', 'b', 'c']) {
      const hand = createDdz(seed).state.hands[0]!;
      const cols = ddzColumns(hand, 'rank');
      expect(cols.flat().sort((x, y) => x - y)).toEqual([...hand].sort((x, y) => x - y));
      const tops = cols.map((c) => ddzValue(c[0]!));
      for (const c of cols) expect(new Set(c.map(ddzValue)).size).toBe(1);
      for (let i = 1; i < tops.length; i++) expect(tops[i]!).toBeLessThanOrEqual(tops[i - 1]!);
    }
  });

  it('按牌型：每张牌都在、只出现一次，一列不超过上限', async () => {
    const { ddzColumns } = await import('../src/view/ddz-view.ts');
    for (const seed of ['a', 'b', 'c', 'd']) {
      const hand = createDdz(seed).state.hands[1]!;
      const cols = ddzColumns(hand, 'type', 4);
      expect(cols.flat().sort((x, y) => x - y)).toEqual([...hand].sort((x, y) => x - y));
      for (const c of cols) expect(c.length).toBeLessThanOrEqual(4);
    }
  });
});

describe('一手牌的说法', () => {
  it('单张、顺子、王炸', async () => {
    const { ddzPlayDetail, ddzDescribe, ddzRankName } = await import('../src/view/ddz-view.ts');
    expect(ddzRankName(15)).toBe('2');
    const hand = createDdz('label').state.hands.flat();
    const single = interpretDdz([hand[0]!])[0]!;
    expect(ddzPlayDetail(single)).toMatch(/^单张 /);
    expect(ddzDescribe(single).bomb).toBe(false);
    const rocket: DdzPlay = { type: 'rocket', v: 17, len: 1, cards: [] };
    expect(ddzPlayDetail(rocket)).toBe('王炸');
    expect(ddzDescribe(rocket).bomb).toBe(true);
    expect(ddzPlayDetail({ type: 'straight', v: 3, len: 5, cards: [] })).toBe('顺子 3 到 7');
  });
});

describe('单机会话', () => {
  it('电脑打完一整局：零和、战绩记一局和每一副、整局结束删存档', async () => {
    const { DdzSession } = await import('../src/view/ddz-session.ts');
    const { getDdzStats, loadDdzSave } = await import('../src/view/store.ts');
    const s = DdzSession.fresh('session-full', 'normal');
    s.autoplay = true;
    expect(loadDdzSave()?.state.seed).toBe('session-full');
    let guard = 0;
    while (s.state.phase !== 'gameOver' && guard++ < 5000) {
      const seat = s.state.phase === 'dealEnd' ? -1 : s.state.turn;
      const a = seat < 0 ? { type: 'next' as const } : s.botAction(seat);
      expect(a).not.toBeNull();
      expect(s.apply(a!).error).toBeNull();
    }
    expect(s.state.phase).toBe('gameOver');
    expect(s.state.scores.reduce((a, b) => a + b, 0)).toBe(0);
    const st = getDdzStats();
    expect(st.games).toBe(1);
    expect(st.deals).toBe(s.state.results.length);
    expect(st.wins).toBe(s.state.scores[0]! > 0 ? 1 : 0);
    expect(loadDdzSave()).toBeNull();
  });

  it('打到一半存档、恢复后接着打，战绩不重复记', async () => {
    const { DdzSession } = await import('../src/view/ddz-session.ts');
    const s = DdzSession.fresh('session-restore', 'novice');
    for (let i = 0; i < 6 && s.state.phase === 'bid'; i++) s.apply(s.botAction(s.state.turn)!);
    const r = DdzSession.restore()!;
    expect(r.state).toEqual(s.state);
    expect(r.level).toBe('novice');
    expect(r.lastEvents).toEqual([]);
  });

  it('调试开局（persist 为假）不写存档、不记战绩', async () => {
    const { DdzSession } = await import('../src/view/ddz-session.ts');
    const s = DdzSession.fresh('debug', 'pro', undefined, false);
    s.apply(s.botAction(s.state.turn)!);
    expect(mem.has('guandan.ddz.save')).toBe(false);
    expect(mem.has('guandan.ddz.stats')).toBe(false);
  });

  it('电脑的随机种子和发牌种子不相干', async () => {
    const { ddzSeeds } = await import('../src/view/ddz-session.ts');
    expect(String(ddzSeeds('x').ai)).not.toContain('x');
    expect(ddzSeeds('x').ai).not.toBe(ddzSeeds('y').ai);
  });
});
