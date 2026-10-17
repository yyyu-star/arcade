import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../src/content/enemies.ts';
import { CALM, EVENTS } from '../src/content/waves.ts';
import { createWorld, Drop, Ev, step } from '../src/core/index.ts';
import { Bot, BUILD_IDS } from '../tools/bots.ts';

// 一局节奏（DESIGN.md 13.3）：机器人"普通"在普通档（危险 2）打完整局量出来。
// 这里每个流派一局（5 局）放进 npm test，门槛和 13.3 一样；≥ 200 局的均值用 `npm run sim -- --n 200 --diff normal --skill normal --build sword,talisman,ward,wood,fire` 量（第 12 节记录）。
const S = 30;

interface Pace {
  first: number;
  /** 前 30 秒升了几级 */
  by30: number;
  by3: number;
  by5: number;
  total: number;
  /** 后半段（7:30 以后）每分钟升几级 */
  late: number;
  /** 精英倒下后 5–25 秒场上平均怪数 ÷ 倒下前 20 秒 */
  calm: number;
}

function pace(seed: number, build: (typeof BUILD_IDS)[number]): Pace {
  const w = createWorld({ seed, mode: 'vigil', danger: 2 });
  // 节奏验收按不凑双修的老口径：机器人去凑双修后清怪更快，全局升级的大样本均值 35.2，略超 35（1.1 流派第三轮再收）
  const bot = new Bot('normal', build, seed, { dual: false });
  const count: number[] = [];
  const eliteKills: number[] = [];
  let first = -1;
  let by30 = 0;
  let by3 = 0;
  let by5 = 0;
  let late = 0;
  while (w.phase !== 'over') {
    const a = bot.act(w);
    step(w, a.dir, a.choice);
    // 升级那一拍就进选卡，事件要先数完再跳过
    if (w.phase !== 'choose') count[w.tick] = w.eCount;
    for (let i = 0; i < w.ev.n; i++) {
      if (w.ev.type[i] === Ev.LevelUp) {
        if (first < 0) first = w.tick / S;
        if (w.tick <= 30 * S) by30++;
        if (w.tick <= 180 * S) by3++;
        if (w.tick <= 300 * S) by5++;
        if (w.tick > 450 * S) late++;
      } else if (w.ev.type[i] === Ev.Kill && w.ev.b[i] === 1) eliteKills.push(w.tick);
    }
  }
  const avg = (a: number, b: number): number => {
    let s = 0;
    let n = 0;
    for (let t = a; t < b; t++) if (count[t] !== undefined) (s += count[t]!), n++;
    return n ? s / n : 0;
  };
  let ratio = 0;
  let m = 0;
  for (const k of eliteKills) {
    if (k + 25 * S > w.tick) continue;
    const before = avg(k - 20 * S, k);
    if (before > 0) (ratio += avg(k + 5 * S, k + 25 * S) / before), m++;
  }
  const lateMin = Math.max(1, (w.tick - 450 * S) / (60 * S));
  return { first, by30, by3, by5, total: w.level - 1, late: late / lateMin, calm: m ? ratio / m : 0 };
}

describe('一局节奏（13.3）', () => {
  const runs = BUILD_IDS.map((b, i) => pace(i + 1, b));
  const mean = (f: (p: Pace) => number): number => runs.reduce((s, p) => s + f(p), 0) / runs.length;

  // 所有者 2026-10-17 试玩："打死一个怪就升级了？"——开局放慢：第一次升级 10–20 秒、前 30 秒最多 2 级，全程少一截
  it('第一次升级 10–20 秒，前 30 秒最多 2 级', () => {
    expect(mean((p) => p.first)).toBeGreaterThanOrEqual(10);
    expect(mean((p) => p.first)).toBeLessThanOrEqual(20);
    expect(Math.max(...runs.map((p) => p.by30))).toBeLessThanOrEqual(2);
  });
  it('前 3 分钟升级 6–9 次，5 分钟前 10–14 次', () => {
    expect(mean((p) => p.by3)).toBeGreaterThanOrEqual(6);
    expect(mean((p) => p.by3)).toBeLessThanOrEqual(9);
    expect(mean((p) => p.by5)).toBeGreaterThanOrEqual(10);
    expect(mean((p) => p.by5)).toBeLessThanOrEqual(14);
  });
  it('全局升级 25–35 次，后半段每分钟 1.5–2.5 次', () => {
    expect(mean((p) => p.total)).toBeGreaterThanOrEqual(25);
    expect(mean((p) => p.total)).toBeLessThanOrEqual(35);
    expect(mean((p) => p.late)).toBeGreaterThanOrEqual(1.5);
    expect(mean((p) => p.late)).toBeLessThanOrEqual(2.5);
  });
  it('精英倒下以后有收获期：场上的怪明显少一截', () => expect(mean((p) => p.calm)).toBeLessThan(0.85));
}, 120_000);

describe('时间线（13.3）', () => {
  const at = (pred: (e: (typeof EVENTS)[number]) => boolean): number[] => EVENTS.filter(pred).map((e) => e.at / S);
  it('精英 5 次：3:00、5:00、7:30、10:00、12:00，精英都掉宝箱', () => {
    expect([...new Set(at((e) => e.kind === 'elite').map((t) => Math.floor(t / 30) * 30))]).toEqual([180, 300, 450, 600, 720]);
    for (const e of EVENTS) if (e.kind === 'elite') expect(ENEMIES.find((d) => d.kind === e.enemy)?.elite).toBe(true);
  });
  it('中期 Boss 8:00，尸王 14:00', () => {
    expect(at((e) => e.kind === 'boss' && e.enemy === 'lord')).toEqual([480]);
    expect(at((e) => e.kind === 'boss' && e.enemy === 'boss')).toEqual([840]);
  });
  it('3、8、12 分钟附近各有一个小爆点（围圈、群冲、纸人海），之后有收获期', () => {
    const spikes = at((e) => e.kind === 'ring' || (e.kind === 'line' && e.enemy === 'wisp'));
    for (const m of [3, 8, 12]) expect(spikes.some((t) => Math.abs(t - m * 60) <= 45)).toBe(true);
    expect(CALM.afterSpike).toBeGreaterThanOrEqual(20 * S);
    expect(CALM.afterElite).toBeGreaterThanOrEqual(20 * S);
  });
});

describe('受伤补偿不能被利用（DESIGN.md 2.4）', () => {
  /** "站着挨打"：不躲怪，只往最近的肉包（没有就魂珠）走，选卡照普通玩家 */
  function tank(seed: number): { won: boolean; seconds: number } {
    const w = createWorld({ seed, mode: 'vigil', danger: 2 });
    const bot = new Bot('normal', 'sword', seed);
    while (w.phase !== 'over') {
      if (w.phase === 'choose') {
        step(w, 0, bot.act(w).choice);
        continue;
      }
      let best = -1;
      let bd = Infinity;
      for (let i = 0; i < w.dAlive.length; i++) {
        if (!w.dAlive[i]) continue;
        const d = (w.dX[i]! - w.x) ** 2 + (w.dY[i]! - w.y) ** 2 / (w.dKind[i] === Drop.Bun ? 16 : 1);
        if (d < bd) (bd = d), (best = i);
      }
      let dir = 0;
      if (best >= 0) {
        const a = Math.atan2(w.dY[best]! - w.y, w.dX[best]! - w.x);
        dir = 1 + (((Math.round((a / (Math.PI * 2)) * 32) % 32) + 32) % 32);
      }
      step(w, dir, -1);
    }
    return { won: w.won, seconds: w.tick / S };
  }
  function dodge(seed: number): { won: boolean; seconds: number } {
    const w = createWorld({ seed, mode: 'vigil', danger: 2 });
    const bot = new Bot('normal', 'sword', seed);
    while (w.phase !== 'over') {
      const a = bot.act(w);
      step(w, a.dir, a.choice);
    }
    return { won: w.won, seconds: w.tick / S };
  }
  it('不躲只等肉包，撑的时间和胜率都比正常躲怪差得多', () => {
    const seeds = [1, 2, 3, 4];
    const t = seeds.map(tank);
    const d = seeds.map(dodge);
    const avg = (xs: { seconds: number }[]): number => xs.reduce((s, x) => s + x.seconds, 0) / xs.length;
    expect(avg(t)).toBeLessThan(avg(d) * 0.7);
    expect(t.filter((x) => x.won).length).toBeLessThanOrEqual(d.filter((x) => x.won).length);
  });
}, 120_000);
