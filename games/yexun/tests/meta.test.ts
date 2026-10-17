import { describe, expect, it } from 'vitest';
import { ENEMY_BY_KIND } from '../src/content/enemies.ts';
import { ASSIST, CHARACTERS, CHARACTER_IDS, PERK_FX } from '../src/content/meta.ts';
import { DANGERS, EVENTS, TWIN_BOSS_HP } from '../src/content/waves.ts';
import { createWorld, Ev, normalizeSetup, spawnNow, step, type Setup, type World } from '../src/core/index.ts';

// 第 5 步：危险 0–5、咒印、角色、永久加成、无尽、降低伤害（DESIGN.md 3.7、3.8、13.2）
const make = (o: Partial<Setup> = {}): World => createWorld({ seed: 7, mode: 'vigil', danger: 2, ...o });

/** 站着不动跑到某一拍（选卡选第一张） */
function runTo(w: World, tick: number): void {
  while (w.tick < tick && w.phase !== 'over') step(w, 0, w.phase === 'choose' ? 0 : -1);
}

function count(w: World, kind: keyof typeof ENEMY_BY_KIND): number {
  let n = 0;
  for (let i = 0; i < w.eAlive.length; i++) if (w.eAlive[i] && w.eKind[i] === ENEMY_BY_KIND[kind].code) n++;
  return n;
}

describe('危险档', () => {
  it('危险 0、1 精英晚 30 秒；危险 2 起按时间线；危险 4 起每次多一只', () => {
    const at = (d: Setup['danger']): number => make({ danger: d }).schedule.find((e) => e.kind === 'elite')!.at;
    const first = EVENTS.find((e) => e.kind === 'elite')!.at;
    expect(at(0)).toBe(first + DANGERS[0].eliteLate);
    expect(at(1)).toBe(first + DANGERS[1].eliteLate);
    expect(at(2)).toBe(first);
    const n = (d: Setup['danger']): number => (make({ danger: d }).schedule.find((e) => e.kind === 'elite') as { count: number }).count;
    expect(n(4)).toBe(n(2) + 1);
    // 排好序：拍数不减
    const s = make({ danger: 0 }).schedule;
    for (let i = 1; i < s.length; i++) expect(s[i]!.at).toBeGreaterThanOrEqual(s[i - 1]!.at);
  });
  it('危险 3–5 血和伤害逐档涨，危险 5 两只尸王各 75% 血、两只都倒了才算打倒', () => {
    // 具体倍数第 7 步按模拟器调，这里只锁"逐档涨"
    for (const d of [3, 4, 5] as const) {
      expect(DANGERS[d].hpMul).toBeGreaterThan(DANGERS[(d - 1) as 2 | 3 | 4].hpMul);
      expect(DANGERS[d].dmgMul).toBeGreaterThan(DANGERS[(d - 1) as 2 | 3 | 4].dmgMul);
    }
    const w = make({ danger: 5 });
    w.nextEvent = w.schedule.findIndex((e) => e.kind === 'boss' && e.enemy === 'boss');
    w.tick = w.schedule[w.nextEvent]!.at - 1;
    step(w, 0);
    expect(count(w, 'boss')).toBe(2);
    const bosses: number[] = [];
    for (let i = 0; i < w.eAlive.length; i++) if (w.eAlive[i] && w.eKind[i] === ENEMY_BY_KIND.boss.code) bosses.push(i);
    expect(w.eHpMax[bosses[0]!]).toBeCloseTo(ENEMY_BY_KIND.boss.hp * DANGERS[5].hpMul * TWIN_BOSS_HP);
  });
  it('开局设置整理：危险档截到 0–5、咒印去重截到 3 条、加成截到最高级、角色不认识就是小道士', () => {
    const s = normalizeSetup({ seed: 1, mode: 'vigil', danger: 9 as never, curses: ['dark', 'dark', 'fast', 'more', 'elites'], perks: { liliang: 99 }, character: 'nobody' as never });
    expect(s.danger).toBe(5);
    expect(s.curses).toEqual(['fast', 'more', 'elites']);
    expect(s.perks).toEqual({ liliang: 5 });
    expect(s.character).toBe('xiaodao');
  });
});

describe('咒印', () => {
  it('定：不能刷新；凶：精英多一只；疾：怪更快；众：场上更多', () => {
    expect(make({ curses: ['noreroll'] }).rerolls).toBe(0);
    const e = (w: World): number => (w.schedule.find((x) => x.kind === 'elite') as { count: number }).count;
    expect(e(make({ curses: ['elites'] }))).toBe(e(make()) + 1);
    const a = make();
    const b = make({ curses: ['fast'] });
    const ia = spawnNow(a, 'paper', a.x + 300, a.y);
    const ib = spawnNow(b, 'paper', b.x + 300, b.y);
    expect(b.eSpeed[ib]! / a.eSpeed[ia]!).toBeCloseTo(1.15);
    const m1 = make();
    const m2 = make({ curses: ['more'] });
    runTo(m1, 90 * 30);
    runTo(m2, 90 * 30);
    expect(m2.eCount).toBeGreaterThan(m1.eCount);
  });
});

describe('永久加成', () => {
  it('体魄加血、刷新加次数、多一张给四张卡、复活站起来一次', () => {
    const w = make({ perks: { tipo: 2, shuaxin: 1, kapian: 1, fuhuo: 1 } });
    expect(w.stats.hpMax).toBe(make().stats.hpMax + 2 * PERK_FX.tipo);
    expect(w.hp).toBe(w.stats.hpMax);
    expect(w.rerolls).toBe(3);
    w.pendingLevels = 1;
    step(w, 0);
    expect(w.choices.length).toBe(4);
    step(w, 0, 0);
    w.hp = -5;
    step(w, 0);
    expect(w.phase).not.toBe('over');
    expect(w.hp).toBe(Math.round(w.stats.hpMax / 2));
    expect(w.revives).toBe(0);
  });
});

describe('角色', () => {
  it('起手法器按角色', () => {
    for (const c of CHARACTER_IDS) expect(make({ character: c }).weapons[0]!.id).toBe(CHARACTERS[c].start);
  });
  it('更夫整分钟敲锣；胖师叔挨打震开身边', () => {
    const g = make({ character: 'gengfu' });
    let gong = 0;
    g.tick = 60 * 30 - 2;
    g.nextEvent = g.schedule.length;
    for (let k = 0; k < 3; k++) {
      step(g, 0);
      for (let i = 0; i < g.ev.n; i++) if (g.ev.type[i] === Ev.Gong) gong++;
    }
    expect(gong).toBe(1);
    // 收掉法器，只剩震开这一下能推怪
    const p = make({ character: 'pang' });
    p.weapons.length = 0;
    const i = spawnNow(p, 'jiangshi', p.x + 30, p.y);
    runTo(p, 40);
    expect(p.hp).toBeLessThan(p.stats.hpMax);
    const q = make({ character: 'xiaodao' });
    q.weapons.length = 0;
    const j = spawnNow(q, 'jiangshi', q.x + 30, q.y);
    runTo(q, 40);
    const dist = (w: World, k: number): number => Math.abs(w.eX[k]! - w.x) + Math.abs(w.eY[k]! - w.y);
    expect(dist(p, i)).toBeGreaterThan(dist(q, j));
  });
});

describe('无尽和降低伤害', () => {
  it('无尽：天亮不收工', () => {
    const w = make({ endless: true, danger: 0 });
    w.tick = 15 * 60 * 30 - 1;
    w.nextEvent = w.schedule.length;
    step(w, 0);
    expect(w.phase).not.toBe('over');
  });
  it('降低伤害：挨打打折', () => {
    const hit = (assist: boolean): number => {
      const w = make({ assist });
      w.tick = 400 * 30;
      w.nextEvent = w.schedule.length;
      spawnNow(w, 'jiangshi', w.x + 10, w.y);
      const hp = w.hp;
      for (let k = 0; k < 3; k++) step(w, 0);
      return hp - w.hp;
    };
    expect(hit(true)).toBeLessThan(hit(false));
    expect(ASSIST.dmg).toBeLessThan(1);
  });
});
