import { describe, expect, it } from 'vitest';
import { MERGES, PASSIVES, WEAPONS } from '../src/content/weapons.ts';
import { createWorld, Ev, grantWeapon, MAX_SHOTS, Shot, spawnNow, step, type World } from '../src/core/index.ts';
import { liveSetup } from '../src/platform/live.ts';

/** 干净的场：只拿纸兵，定点事件和补怪都关掉 */
function quiet(seed = 3): World {
  const w = createWorld({ seed, mode: 'vigil', danger: 2 });
  w.weapons.length = 0;
  w.wstats.length = 0;
  w.nextEvent = 1 << 30;
  w.spawnAcc = -1e9;
  grantWeapon(w, 'zhibing', 1);
  return w;
}
const soldiers = (w: World): number[] => {
  const out: number[] = [];
  for (let i = 0; i < MAX_SHOTS; i++) if (w.sAlive[i] && w.sKind[i] === Shot.Paper) out.push(i);
  return out;
};
const run = (w: World, n: number, seen?: Set<string>): void => {
  for (let t = 0; t < n; t++) {
    step(w, 0, -1);
    w.hp = w.stats.hpMax;
    if (seen) for (let k = 0; k < w.ev.n; k++) if (w.ev.type[k] === Ev.Paper) seen.add(`${w.ev.a[k]}`);
  }
};

describe('纸兵', () => {
  it('登记：土·灵，剪刀进化成撒豆成兵；两条双修火兵、鸣兵', () => {
    expect(WEAPONS.zhibing.el).toBe('土');
    expect(WEAPONS.zhibing.type).toBe('灵');
    expect(WEAPONS.zhibing.evolve?.with).toBe('jiandao');
    expect(PASSIVES.jiandao.name).toBe('剪刀');
    expect(MERGES.find((m) => m.id === 'huobing')).toMatchObject({ a: 'zhibing', b: 'gourd', dual: true });
    expect(MERGES.find((m) => m.id === 'mingbing')).toMatchObject({ a: 'zhibing', b: 'bell', dual: true });
  });

  it('隔 cd 补一个，最多 amount 个', () => {
    const w = quiet();
    run(w, WEAPONS.zhibing.base.cd * 4);
    expect(soldiers(w).length).toBe(WEAPONS.zhibing.base.amount);
  });

  it('走去顶住怪、打它；贴身挨着会折寿，比空站着早倒', () => {
    const w = quiet();
    run(w, 20);
    expect(soldiers(w).length).toBe(1);
    const e = spawnNow(w, 'jiangshi', w.x + 160, w.y);
    w.eHp[e] = 1e6;
    const hp0 = w.eHp[e]!;
    const idle = quiet();
    run(idle, 20);
    const seen = new Set<string>();
    let fellAt = -1;
    for (let t = 0; t < 400 && fellAt < 0; t++) {
      run(w, 1, seen);
      if (seen.has('0')) fellAt = t;
    }
    expect(w.eHp[e]!).toBeLessThan(hp0);
    expect(fellAt).toBeGreaterThan(0);
    // 同样补出来的第一个纸兵，没有怪时活满 duration
    expect(fellAt + 20).toBeLessThan(WEAPONS.zhibing.base.duration);
  });

  it('撒豆成兵倒下时炸开（事件 a = 1）', () => {
    const w = quiet();
    grantWeapon(w, 'zhibing', 8, true);
    const seen = new Set<string>();
    run(w, WEAPONS.zhibing.evolve!.stats.duration * 2, seen);
    expect(seen.has('1')).toBe(true);
  });

  it('鸣兵倒下时震开一圈（a = 2）；火兵倒下留火', () => {
    const w = quiet();
    w.merges.push('mingbing', 'huobing');
    const seen = new Set<string>();
    let burns = 0;
    for (let t = 0; t < WEAPONS.zhibing.base.duration * 2; t++) {
      run(w, 1, seen);
      for (let i = 0; i < MAX_SHOTS; i++) if (w.sAlive[i] && w.sKind[i] === Shot.Burn) burns++;
    }
    expect(seen.has('2')).toBe(true);
    expect(burns).toBeGreaterThan(0);
  });

  it('实盘局的卡池里没有纸兵和剪刀（系数配好前），娱乐局有', () => {
    const pool = (live: boolean): Set<string> => {
      const ids = new Set<string>();
      // 0.4.5 前几次升级偏向角色初始法器那一类，开局的卡换了一批：多跑几个种子、每局多一分钟
      for (let seed = 1; seed <= 32; seed++) {
        const w = createWorld(live ? liveSetup('medium', seed) : { seed, mode: 'vigil', danger: 2 });
        for (let t = 0; t < 30 * 120 && w.phase !== 'over'; t++) {
          step(w, (t >> 5) % 8 === 0 ? 1 : 5, -1);
          if (w.phase === 'choose') {
            for (const c of w.choices) ids.add(c.id);
            step(w, 0, 0);
          }
        }
      }
      return ids;
    };
    const live = pool(true);
    expect(live.has('zhibing') || live.has('jiandao')).toBe(false);
    const fun = pool(false);
    expect(fun.has('zhibing') || fun.has('jiandao')).toBe(true);
  }, 60_000);
});
