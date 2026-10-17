import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, rewardCoins, rewardTitles } from '../src/content/achievements.ts';
import { ENEMIES } from '../src/content/enemies.ts';
import { MAX_WEAPON_LEVEL, MERGES, PASSIVES, WEAPONS, type PassiveId, type WeaponId } from '../src/content/weapons.ts';
import { RECORDS_KEY, applyRun, collection, emptyRecords, loadRecords, saveRecords, type Records, type RunSummary } from '../src/meta/records.ts';

const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];
const allPassives = (): Partial<Record<PassiveId, number>> => Object.fromEntries((Object.keys(PASSIVES) as PassiveId[]).map((id) => [id, PASSIVES[id].max]));

/** 一局很差的：开局就倒，什么都没有 */
const poor = (): RunSummary => ({
  danger: 0, map: 'snow', won: false, quit: false, seconds: 10, kills: 0, killsByKind: {}, seen: [], bossKilled: false, level: 1, coins: 0,
  weapons: [], merges: [], passives: {}, sets: [], hurts: 5, hpLeft: 0, hpMax: 100, chests: 0, blocks: 0,
});

/** 各种"极致"的局，合起来要能解锁全部 50 个 */
function godRuns(): RunSummary[] {
  const base: RunSummary = {
    ...poor(), danger: 4, won: true, seconds: 900, kills: 5000, level: 45, coins: 999, bossKilled: true,
    killsByKind: Object.fromEntries(ENEMIES.map((e) => [e.kind, 400])), seen: ENEMIES.map((e) => e.kind),
    weapons: WEAPON_IDS.slice(0, 6).map((id) => ({ id, level: MAX_WEAPON_LEVEL, evolved: true })),
    merges: MERGES.map((m) => m.id), passives: allPassives(), sets: ['剑3', '金3'], hurts: 3, hpLeft: 50, hpMax: 100, chests: 8, blocks: 20,
  };
  return [
    base,
    { ...base, weapons: WEAPON_IDS.slice(6).map((id) => ({ id, level: MAX_WEAPON_LEVEL, evolved: true })) },
    { ...base, danger: 2, map: 'yizhuang', hurts: 0 },
    { ...base, hpLeft: 5 },
  ];
}

function unlockAll(): Records {
  let rec = emptyRecords();
  for (let i = 0; i < 30; i++) for (const run of godRuns()) rec = applyRun(rec, run).records;
  return rec;
}

describe('成就数据', () => {
  it('正好 50 个，id 和名字都不重复', () => {
    expect(ACHIEVEMENTS.length).toBe(50);
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(50);
    expect(new Set(ACHIEVEMENTS.map((a) => a.name)).size).toBe(50);
    for (const a of ACHIEVEMENTS) {
      expect(a.coins).toBeGreaterThan(0);
      expect(a.desc.length).toBeGreaterThan(0);
    }
  });

  it('每个成就都能解锁（极致的局合起来能拿满 50 个）', () => {
    const rec = unlockAll();
    const missing = ACHIEVEMENTS.filter((a) => !rec.achievements.includes(a.id)).map((a) => a.id);
    expect(missing).toEqual([]);
    expect(collection(rec).percent).toBe(100);
  });

  it('什么都没做的一局不解锁任何成就', () => {
    expect(applyRun(emptyRecords(), poor()).unlocked).toEqual([]);
  });

  it('单局条件看这一局：没赢不算天亮，挨过打不算一尘不染', () => {
    const win = { ...poor(), won: true, seconds: 900, hurts: 0, hpLeft: 100 };
    expect(applyRun(emptyRecords(), win).unlocked).toContain('no_hit');
    expect(applyRun(emptyRecords(), { ...win, hurts: 1 }).unlocked).not.toContain('no_hit');
    expect(applyRun(emptyRecords(), { ...win, won: false }).unlocked).not.toContain('dawn_1');
    expect(applyRun(emptyRecords(), { ...win, quit: true }).unlocked).not.toContain('dawn_1');
  });

  it('累计条件跨局：5 次天亮才解锁五夜平安', () => {
    let rec = emptyRecords();
    const win = { ...poor(), won: true, seconds: 900 };
    for (let i = 0; i < 4; i++) rec = applyRun(rec, win).records;
    expect(rec.achievements).not.toContain('dawn_5');
    const r = applyRun(rec, win);
    expect(r.unlocked).toContain('dawn_5');
  });

  it('称号只发给带称号的成就，铜钱按成就累加', () => {
    expect(rewardCoins(['dawn_1', 'dawn_5'])).toBe(90);
    expect(rewardTitles(['dawn_1', 'dawn_hard', 'nope'])).toEqual(['dawn_hard']);
  });
});

describe('applyRun', () => {
  it('不改传进来的统计，同一局再并一次不会重复发奖', () => {
    const rec0 = emptyRecords();
    const run = godRuns()[0]!;
    const a = applyRun(rec0, run);
    expect(rec0).toEqual(emptyRecords());
    expect(a.unlocked.length).toBeGreaterThan(0);
    const b = applyRun(a.records, run);
    expect(b.unlocked.filter((id) => a.unlocked.includes(id))).toEqual([]);
    expect(new Set(b.records.achievements).size).toBe(b.records.achievements.length);
  });

  it('记下见过、打倒、用过、满级、进化、合成', () => {
    const run: RunSummary = {
      ...poor(), killsByKind: { paper: 3 }, seen: ['wisp'], kills: 3,
      weapons: [{ id: 'sword', level: 8, evolved: false }, { id: 'bell', level: 3, evolved: false }, { id: 'crane', level: 9, evolved: true }],
      merges: ['zhuxie'], passives: { zhusha: 5, xianglu: 2 },
    };
    const { records: r } = applyRun(emptyRecords(), run);
    expect(r.seen.sort()).toEqual(['paper', 'wisp']);
    expect(r.killed.paper).toBe(3);
    expect(r.weaponsUsed.sort()).toEqual(['bell', 'crane', 'sword']);
    expect(r.weaponsMaxed.sort()).toEqual(['crane', 'sword']);
    expect(r.weaponsEvolved).toEqual(['crane']);
    expect(r.merges).toEqual(['zhuxie']);
    expect(r.passivesMaxed).toEqual(['zhusha']);
    expect(r.runs).toBe(1);
  });
});

describe('存储', () => {
  const store = new Map<string, string>();
  const fake = {
    getItem: (k: string): string | null => store.get(k) ?? null,
    setItem: (k: string, v: string): void => void store.set(k, v),
  };
  afterEach(() => {
    store.clear();
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
  const install = (): void => void ((globalThis as { localStorage?: unknown }).localStorage = fake);

  it('key 是 yexun.records，存了能读回', () => {
    install();
    expect(RECORDS_KEY).toBe('yexun.records');
    const rec = unlockAll();
    saveRecords(rec);
    expect(store.has('yexun.records')).toBe(true);
    expect(loadRecords()).toEqual(rec);
  });

  it('没有存储、读到坏数据都兜底成空', () => {
    expect(loadRecords()).toEqual(emptyRecords());
    install();
    expect(loadRecords()).toEqual(emptyRecords());
    for (const bad of ['{{{', 'null', '123', '"x"', '[]', '{"runs":"a","seen":5,"killed":{"paper":-3,"zzz":9},"achievements":["nope",7]}']) {
      store.set('yexun.records', bad);
      const r = loadRecords();
      expect(r.runs).toBe(0);
      expect(r.seen).toEqual([]);
      expect(r.killed).toEqual({});
      expect(r.achievements).toEqual([]);
    }
  });

  it('认不得的 id 被丢掉，认得的留下', () => {
    install();
    store.set('yexun.records', JSON.stringify({ runs: 3, seen: ['paper', 'ghost'], achievements: ['dawn_1', 'x'] }));
    const r = loadRecords();
    expect(r.runs).toBe(3);
    expect(r.seen).toEqual(['paper']);
    expect(r.achievements).toEqual(['dawn_1']);
  });
});

describe('称号文件', () => {
  const titles = JSON.parse(readFileSync(new URL('../public/titles.json', import.meta.url), 'utf8')) as Record<string, { name: string; desc?: string }>;

  it('和成就数据里的称号一一对应（id、名字、说明）', () => {
    const want = Object.fromEntries(ACHIEVEMENTS.filter((a) => a.title).map((a) => [a.id, { name: a.title, desc: a.desc }]));
    expect(titles).toEqual(want);
    expect(Object.keys(titles).length).toBeGreaterThanOrEqual(10);
  });

  it('符合平台的读法：名字 ≤ 20 字、说明 ≤ 80 字、称号名不重复', () => {
    for (const t of Object.values(titles)) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.name.length).toBeLessThanOrEqual(20);
      expect((t.desc ?? '').length).toBeLessThanOrEqual(80);
    }
    expect(new Set(Object.values(titles).map((t) => t.name)).size).toBe(Object.keys(titles).length);
  });
});
