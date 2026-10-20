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
  it('胖师叔：血多、走得慢、挨打震开身边', () => {
    const p = make('pang');
    const x = make('xiaodao');
    expect(p.stats.hpMax).toBe(Math.round(x.stats.hpMax * CHARACTERS.pang.base.hp));
    expect(p.stats.hpMax).toBeGreaterThan(x.stats.hpMax);
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

describe('角色初始数值和小特权（所有者 10-20，0.4.5）', () => {
  const at = (ch: Setup['character'], extra: Partial<Setup> = {}): World => createWorld({ seed: 9, mode: 'vigil', danger: 0, character: ch, ...extra });
  it('初始数值按 base 乘到小道士身上；实盘局一样', () => {
    const x = at('xiaodao');
    for (const id of CHARACTER_IDS) {
      const w = at(id);
      const b = CHARACTERS[id].base;
      expect(w.stats.hpMax).toBeCloseTo(x.stats.hpMax + PLAYER.hp * (b.hp - 1), 6);
      expect(w.stats.might / x.stats.might).toBeCloseTo(b.might, 6);
      expect(w.stats.areaMul / x.stats.areaMul).toBeCloseTo(b.area, 6);
      expect(w.stats.magnet / x.stats.magnet).toBeCloseTo(b.magnet, 6);
      expect(w.stats.luck - x.stats.luck).toBeCloseTo(b.luck, 6);
      // 符师的连环符不改 cdMul（只改符类），这里直接和小道士比
      expect(w.stats.cdMul / x.stats.cdMul).toBeCloseTo(b.cd, 6);
      expect(at(id, { live: true }).stats.hpMax).toBe(w.stats.hpMax);
    }
  });
  it('数值大致相抵：没有哪个角色六项全不吃亏', () => {
    for (const id of CHARACTER_IDS) {
      if (id === 'xiaodao') continue;
      const b = CHARACTERS[id].base;
      const worse = b.hp < 1 || b.speed < 1 || b.might < 1 || b.cd > 1 || b.area < 1 || b.magnet < 1;
      expect(worse, id).toBe(true);
    }
  });
  it('小道士起步多 1 次刷新、符师多 1 次封禁', () => {
    expect(at('xiaodao').rerolls - at('jianxia').rerolls).toBe(1);
    expect(at('fushi').bans - at('jianxia').bans).toBe(1);
  });
  it('剑侠打倒精英多补 1 次刷新', () => {
    const got = (ch: Setup['character']): number => {
      const w = at(ch);
      const r0 = w.rerolls;
      const i = spawnNow(w, 'shishi', w.x + 60, w.y);
      for (let t = 0; t < 600 && w.eAlive[i]; t++) {
        w.eHp[i] = Math.min(w.eHp[i]!, 0.001);
        step(w, 0, w.phase === 'choose' ? 0 : -1);
      }
      return w.rerolls - r0;
    };
    expect(got('jianxia') - got('fushi')).toBe(CHAR_FX.jianxiaReroll);
  });
  it('胖师叔跳过抽到回血的机会翻倍', () => {
    const heals = (ch: Setup['character']): number => {
      let n = 0;
      for (let s = 0; s < 600; s++) {
        const w = createWorld({ seed: 2000 + s, mode: 'vigil', danger: 0, character: ch });
        w.hp = 10;
        w.pendingLevels = 1;
        step(w, 0);
        step(w, 0, 300);
        for (let i = 0; i < w.ev.n; i++) if (w.ev.type[i] === Ev.Skip && w.ev.a[i] === 1) n++;
      }
      return n;
    };
    const p = heals('pang');
    const x = heals('xiaodao');
    // 回血 25%：别人约 150 次，胖师叔 2 / (1 + 1.25) ≈ 40% 约 240 次
    expect(p).toBeGreaterThan(x * 1.4);
  });
  it('前 5 次升级里和初始法器同一类的法器卡出得更多', () => {
    // 符师（符）开局前几级：符类法器卡的占比高于剑侠开局
    const share = (ch: Setup['character']): number => {
      let hit = 0;
      let all = 0;
      for (let s = 0; s < 300; s++) {
        const w = createWorld({ seed: 3000 + s, mode: 'vigil', danger: 0, character: ch });
        w.pendingLevels = 1;
        step(w, 0);
        for (const c of w.choices) {
          if (c.kind !== 'weapon') continue;
          all++;
          if (WEAPONS[c.id as keyof typeof WEAPONS].type === '符') hit++;
        }
      }
      return hit / all;
    };
    expect(share('fushi')).toBeGreaterThan(share('jianxia'));
  }, 30_000);
});
