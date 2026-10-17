import { describe, expect, it } from 'vitest';
import { CHARACTER_IDS, CHARACTERS, CHAR_FX } from '../src/content/meta.ts';
import { Bot } from '../tools/bots.ts';
import { PLAYER } from '../src/content/player.ts';
import { WEAPONS } from '../src/content/weapons.ts';
import { createWorld, Ev, spawnNow, step, type Setup, type World } from '../src/core/index.ts';
import { fingerprint } from '../src/core/fingerprint.ts';
import { charProgress, charOpen, fresh } from '../src/platform/save.ts';

// 六个角色各有一个让打法明显不同的专属被动（DESIGN.md 3.7）
const make = (character: Setup['character'], o: Partial<Setup> = {}): World => createWorld({ seed: 11, mode: 'vigil', danger: 2, character, ...o });

function run(w: World, ticks: number): void {
  for (let k = 0; k < ticks && w.phase !== 'over'; k++) step(w, 0, w.phase === 'choose' ? 0 : -1);
}

describe('角色表', () => {
  it('六个角色都有名字、起手法器、被动、解锁说明、人设和台词', () => {
    expect(CHARACTER_IDS.length).toBe(6);
    for (const id of CHARACTER_IDS) {
      const c = CHARACTERS[id];
      expect(WEAPONS[c.start]).toBeDefined();
      for (const t of [c.name, c.perkName, c.perk, c.unlock, c.look, c.line]) expect(t.length).toBeGreaterThan(1);
      expect(c.line.length).toBeLessThanOrEqual(20);
    }
    expect(new Set(CHARACTER_IDS.map((c) => CHARACTERS[c].start)).size).toBe(6);
  });
  it('没解锁的角色，进度写得出来', () => {
    const s = fresh();
    s.maxSeconds = 312;
    expect(charProgress(s, 'gengfu')).toContain('5:12');
    expect(charProgress(s, 'caiyao')).toContain('0 次');
    expect(charProgress(s, 'pang')).toContain('300');
    expect(charOpen(s, 'gengfu')).toBe(false);
  });
});

describe('专属被动', () => {
  it('小道士：每升 5 级属性涨一档', () => {
    const w = make('xiaodao');
    const bot = new Bot('normal', 'sword', 11);
    for (let k = 0; k < 30 * 60 * 8 && w.level < CHAR_FX.xiaodaoEvery && w.phase !== 'over'; k++) {
      const a = bot.act(w);
      step(w, a.dir, a.choice);
    }
    expect(w.level).toBeGreaterThanOrEqual(CHAR_FX.xiaodaoEvery);
    expect(w.stats.speed).toBeGreaterThanOrEqual(PLAYER.speed * (1 + CHAR_FX.xiaodaoStep));
  });
  it('符师：每第 4 次出符多飞一张（出手计数在法器上）', () => {
    const shots = (w: World): number => w.sAlive.reduce((n, v) => n + v, 0);
    const w = make('fushi');
    w.nextEvent = w.schedule.length;
    spawnNow(w, 'jiangshi', w.x + 120, w.y);
    const per: number[] = [];
    let seen = 0;
    for (let k = 0; k < 30 * 30 && per.length < 8; k++) {
      step(w, 0, w.phase === 'choose' ? 0 : -1);
      if (w.weapons[0]!.phase !== seen) {
        seen = w.weapons[0]!.phase;
        per.push(shots(w));
      }
    }
    expect(w.weapons[0]!.id).toBe('talisman');
    expect(seen).toBeGreaterThanOrEqual(4);
  });
  it('剑侠：走动时暴击更疼更多（统计里带上了加成）', () => {
    const a = make('jianxia');
    const b = make('xiaodao');
    expect(a.stats.critDmg - b.stats.critDmg).toBeCloseTo(CHAR_FX.jianxiaCritDmg, 6);
  });
  it('胖师叔：血多 50、走得慢、挨打震开身边', () => {
    const p = make('pang');
    const x = make('xiaodao');
    expect(p.stats.hpMax - x.stats.hpMax).toBe(CHAR_FX.pangHp);
    expect(p.hp).toBe(p.stats.hpMax);
    expect(p.stats.speed).toBeLessThan(x.stats.speed);
  });
  it('更夫：每 20 秒敲一次锣，范围内的怪挨一下，金钟罩补一层', () => {
    const g = make('gengfu');
    g.weapons.length = 0;
    g.nextEvent = g.schedule.length;
    const i = spawnNow(g, 'jiangshi', g.x + 200, g.y);
    const hp0 = g.eHp[i]!;
    g.shieldMax = 3;
    g.tick = CHAR_FX.gongEvery - 2;
    let gong = 0;
    for (let k = 0; k < 3; k++) {
      step(g, 0);
      for (let e = 0; e < g.ev.n; e++) if (g.ev.type[e] === Ev.Gong) gong++;
    }
    expect(gong).toBe(1);
    expect(g.eHp[i]!).toBeLessThan(hp0);
    expect(g.shield).toBe(1);
  });
  it('采药女：每秒回血、经验多、肉包加倍', () => {
    const c = make('caiyao');
    const x = make('xiaodao');
    expect(c.stats.regen).toBeCloseTo(CHAR_FX.caiyaoRegen, 6);
    expect(c.stats.xpMul).toBeGreaterThan(x.stats.xpMul);
    c.hp = 50;
    run(c, 30 * 5);
    expect(c.hp).toBeGreaterThan(50);
  });
  it('每个角色同种子同输入逐位相同', () => {
    for (const id of CHARACTER_IDS) {
      const a = make(id);
      const b = make(id);
      run(a, 30 * 90);
      run(b, 30 * 90);
      expect(fingerprint(a)).toBe(fingerprint(b));
    }
  });
});
