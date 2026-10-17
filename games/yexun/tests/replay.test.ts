import { describe, expect, it } from 'vitest';
import { createWorld, fingerprint, RULES_VERSION, step, type World } from '../src/core/index.ts';
import type { OnlineSetup } from '../src/online/types.ts';
import { replayResult, replayTitle } from '../src/replay/describe.ts';
import { decodeDirs, decodePicks, encodeDirs, encodePicks, type ReplayRecord } from '../src/replay/format.ts';
import { ReplayPlayer } from '../src/replay/player.ts';
import { Recorder } from '../src/replay/recorder.ts';
import { addReplay, BUDGET_CHARS, loadReplays, RECENT_KEEP, REPLAYS_KEY, sizeOf, storeReplay, type KV } from '../src/replay/store.ts';

const setupOf = (seed: number): OnlineSetup => ({ seed, mode: 'vigil', danger: 2, curses: [] });

/** 带种子的伪随机"玩家"：一阵一阵换方向，升级时随机选卡、偶尔刷新 / 跳过 */
function playAndRecord(seed: number, ticks: number): { w: World; rec: ReplayRecord } {
  const setup = setupOf(seed);
  const w = createWorld(setup as never);
  const r = new Recorder(setup, 1_700_000_000_000);
  let s = seed >>> 0;
  let dir = 1;
  let frames = 0;
  while (w.tick < ticks && w.phase !== 'over' && frames++ < ticks * 20) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    if (s % 23 === 0) dir = s % 33;
    const choice = w.phase === 'choose' ? (s % 17 === 0 ? 100 : s % 3) : -1;
    r.before(w, dir, choice);
    step(w, dir, choice);
  }
  const rec = r.finish(w, { won: w.won, quit: false, seconds: Math.floor(w.tick / 30), kills: w.kills, level: w.level, bossKilled: w.bossKilled, loot: 0, daily: null }, { vigil: w.kills });
  return { w, rec };
}

describe('录像编码', () => {
  it('方向游程往返；连续相同的压得很小', () => {
    const dirs = new Uint8Array(27000);
    for (let i = 0; i < dirs.length; i++) dirs[i] = Math.floor(i / 7) % 33;
    const s = encodeDirs(dirs);
    expect(decodeDirs(s, dirs.length)).toEqual(dirs);
    expect(encodeDirs(new Uint8Array(1000))).toBe('rsA');
    // 15 分钟、平均 7 拍换一次方向：压缩后 < 20 KB
    expect(s.length).toBeLessThan(20_000);
  });
  it('坏数据解不开返回 null，不抛错', () => {
    expect(decodeDirs('3A', 4)).toBeNull();
    expect(decodeDirs('3A', 2)).toBeNull();
    expect(decodeDirs('zz', 2)).toBeNull();
    expect(decodeDirs('3~', 3)).toBeNull();
    expect(decodeDirs('', 0)).toEqual(new Uint8Array(0));
    expect(decodeDirs('1A', -1)).toBeNull();
  });
  it('选卡往返', () => {
    const p = [{ tick: 120, choice: 1 }, { tick: 120, choice: 100 }, { tick: 120, choice: 2 }];
    expect(decodePicks(encodePicks(p))).toEqual(p);
    expect(decodePicks('')).toEqual([]);
    expect(decodePicks('a:b')).toBeNull();
  });
});

describe('按录像重放', () => {
  it('同种子同输入重放，最终状态和原局逐位一致（含刷新、选卡）', () => {
    const { w, rec } = playAndRecord(20261017, 30 * 150);
    expect(rec.ticks).toBe(w.tick);
    expect(rec.picks.length).toBeGreaterThan(0);
    const p = ReplayPlayer.from(rec)!;
    expect(p.outdated).toBe(false);
    while (!p.done) p.tickOnce();
    expect(p.world.tick).toBe(w.tick);
    expect(fingerprint(p.world)).toBe(fingerprint(w));
    expect(p.exact).toBe(true);
    expect(p.world.kills).toBe(w.kills);
    expect(p.world.level).toBe(w.level);
  });

  it('经过 JSON 存取以后照样一致', () => {
    const { w, rec } = playAndRecord(5, 30 * 60);
    const p = ReplayPlayer.from(JSON.parse(JSON.stringify(rec)) as ReplayRecord)!;
    while (!p.done) p.tickOnce();
    expect(fingerprint(p.world)).toBe(fingerprint(w));
  });

  it('逐拍指纹相同（不只是终点）', () => {
    const setup = setupOf(77);
    const w = createWorld(setup as never);
    const rcd = new Recorder(setup, 1);
    const fps: number[] = [];
    let s = 77;
    for (let i = 0; i < 2400 && w.phase !== 'over'; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const dir = (s >>> 8) % 33;
      const choice = w.phase === 'choose' ? s % 3 : -1;
      rcd.before(w, dir, choice);
      step(w, dir, choice);
      if (w.phase === 'play') fps.push(fingerprint(w));
    }
    const p = ReplayPlayer.from(rcd.finish(w, { won: false, quit: true, seconds: 0, kills: 0, level: 1, bossKilled: false, loot: 0, daily: null }))!;
    // 选卡阶段空转的调用不记，所以只比 play 阶段的：重放每推一拍就该落在原局某个 play 拍的指纹上
    const seen = new Set(fps);
    let n = 0;
    while (!p.done) {
      p.tickOnce();
      if (p.world.phase === 'play') {
        expect(seen.has(fingerprint(p.world))).toBe(true);
        n++;
      }
    }
    expect(n).toBeGreaterThan(1000);
  });

  it('速度和暂停：2× 一帧推的拍数是 1× 的两倍；暂停不推；一次推不超过上限', () => {
    const { rec } = playAndRecord(9, 30 * 40);
    const a = ReplayPlayer.from(rec)!;
    const b = ReplayPlayer.from(rec)!;
    b.speed = 2;
    expect(a.advance(1000)).toBe(30);
    expect(b.advance(1000)).toBe(60);
    a.paused = true;
    expect(a.advance(1000)).toBe(0);
    const c = ReplayPlayer.from(rec)!;
    c.speed = 4;
    expect(c.advance(60_000)).toBe(60);
    expect(a.progress).toBeGreaterThan(0);
  });

  it('旧规则版本的录像标 outdated 但照放；放歪了 exact 为 false', () => {
    const { rec } = playAndRecord(3, 30 * 30);
    const old = ReplayPlayer.from({ ...rec, rules: RULES_VERSION - 1 })!;
    expect(old.outdated).toBe(true);
    while (!old.done) old.tickOnce();
    expect(old.exact).toBe(true);
    const bent = ReplayPlayer.from({ ...rec, fp: rec.fp ^ 1 })!;
    while (!bent.done) bent.tickOnce();
    expect(bent.exact).toBe(false);
    expect(ReplayPlayer.from({ ...rec, dirs: 'zz' })).toBeNull();
  });

  it('列表文字', () => {
    const { rec } = playAndRecord(3, 30 * 30);
    expect(replayTitle(rec)).toBe('守夜 · 危险2');
    expect(replayResult({ ...rec, summary: { ...rec.summary, won: true, kills: 1200 } })).toBe('天亮 · 斩1,200');
    expect(replayTitle({ ...rec, summary: { ...rec.summary, daily: '2026-10-17' } })).toBe('每日 · 守夜 · 危险2');
  });
});

// ───────── 存储 ─────────

function mem(): KV & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

function fake(id: string, at: number, scores: Record<string, number> = {}, ticks = 30): ReplayRecord {
  return {
    v: 1, id, rules: RULES_VERSION, at, setup: setupOf(at), dirs: encodeDirs(new Uint8Array(ticks)), ticks, picks: '', fp: 0,
    summary: { won: false, quit: false, seconds: 1, kills: 1, level: 1, bossKilled: false, loot: 0, daily: null }, bestFor: [], scores,
  };
}

describe('录像存储', () => {
  it('只留最近 5 局；每个榜最好的一局另外留着', () => {
    let list: ReplayRecord[] = [];
    list = addReplay(list, fake('best', 1, { vigil: 1000 }));
    for (let i = 2; i < 12; i++) list = addReplay(list, fake(`r${i}`, i, { vigil: i }));
    expect(list.length).toBe(RECENT_KEEP + 1);
    expect(list.find((r) => r.id === 'best')?.bestFor).toEqual(['vigil']);
    expect(list.filter((r) => r.id !== 'best').map((r) => r.id)).toEqual(['r11', 'r10', 'r9', 'r8', 'r7']);
  });
  it('刷新纪录时"最好"换人，原来那局回到普通局里排队', () => {
    let list = addReplay([], fake('a', 1, { vigil: 10 }));
    list = addReplay(list, fake('b', 2, { vigil: 20 }));
    expect(list.find((r) => r.id === 'b')?.bestFor).toEqual(['vigil']);
    expect(list.find((r) => r.id === 'a')?.bestFor).toEqual([]);
    list = addReplay(list, fake('c', 3, { vigil: 5 }));
    expect(list.find((r) => r.id === 'c')?.bestFor).toEqual([]);
    expect(list.find((r) => r.id === 'b')?.bestFor).toEqual(['vigil']);
  });
  it('同一局重复存只留一份', () => {
    const list = addReplay(addReplay([], fake('a', 1)), fake('a', 1));
    expect(list.length).toBe(1);
  });
  it('总量 ≤ 300 KB：超了先删最旧的普通局，最好的留到最后', () => {
    const big = (id: string, at: number, scores: Record<string, number> = {}): ReplayRecord => {
      // 随机方向的 27,000 拍压缩后每局约 55 KB
      const d = new Uint8Array(27000);
      let s = at;
      for (let i = 0; i < d.length; i++) {
        s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
        d[i] = (s >>> 20) % 33;
      }
      return { ...fake(id, at, scores), dirs: encodeDirs(d), ticks: d.length };
    };
    let list: ReplayRecord[] = [];
    list = addReplay(list, big('best', 1, { vigil: 99 }));
    for (let i = 2; i <= 9; i++) list = addReplay(list, big(`r${i}`, i, { vigil: i }));
    expect(sizeOf(list)).toBeLessThanOrEqual(BUDGET_CHARS);
    expect(list.some((r) => r.id === 'best')).toBe(true);
    expect(list.some((r) => r.id === 'r9')).toBe(true);
    expect(list.length).toBeLessThan(RECENT_KEEP + 1);
  });
  it('写进 yexun.replays，读回来一样；坏数据和不可用的存储不抛错', () => {
    const kv = mem();
    const { rec } = playAndRecord(11, 30 * 20);
    storeReplay(rec, kv);
    expect(kv.data.has(REPLAYS_KEY)).toBe(true);
    expect(REPLAYS_KEY.startsWith('yexun.')).toBe(true);
    expect(loadReplays(kv)).toEqual([{ ...rec, bestFor: ['vigil'] }]);
    kv.data.set(REPLAYS_KEY, '{坏');
    expect(loadReplays(kv)).toEqual([]);
    kv.data.set(REPLAYS_KEY, JSON.stringify({ v: 1, items: [{ ...rec, dirs: 'zz' }, 5, null] }));
    expect(loadReplays(kv)).toEqual([]);
    expect(loadReplays(undefined)).toEqual([]);
    expect(() => storeReplay(rec, { getItem: () => null, setItem: () => { throw new Error('满了'); } })).not.toThrow();
  });
});
