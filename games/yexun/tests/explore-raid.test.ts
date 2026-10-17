import { describe, expect, it } from 'vitest';
import { CHEST_OPEN, DAWN_RED, DAWN_WARN, GATE, RAID_DAWN, RAID_ENEMIES, RAID_EXCHANGE, RAID_LIVE, type RaidTemplateId } from '../src/content/explore.ts';
import { ENEMY_BY_KIND, type EnemyKind } from '../src/content/enemies.ts';
import { TREASURES } from '../src/content/treasures.ts';
import { inputCos, inputSin } from '../src/core/fmath.ts';
import { RaidBot } from '../src/explore/bot.ts';
import { GUARD_MOVE, guardStep } from '../src/explore/guards.ts';
import { gateField, guide, newGuide } from '../src/explore/guide.ts';
import { NAV_CELL, NAV_INF } from '../src/explore/nav.ts';
import { RaidEv, type GuardHost } from '../src/explore/host.ts';
import { bagValue } from '../src/explore/loot.ts';
import { Raid, raidFingerprint } from '../src/explore/raid.ts';
import { liveBp, livePayout, settleRaid } from '../src/explore/settle.ts';
import { raidMinute, raidSpawnPoint, raidZoneMul } from '../src/explore/spawn.ts';
import { emptyVault, herbalistUnlocked, normalizeVault, recordRaid, vaultProgress } from '../src/explore/vault.ts';

const M = 1800;

/** 假的核心：主角位置、事件、怪数组（核心接好以后由 World 本身满足这些接口） */
type FakeHost = GuardHost & { tick: number; x: number; y: number; evs: number[][] };
function fakeHost(x: number, y: number): FakeHost {
  const N = 300;
  const evs: number[][] = [];
  return {
    tick: 0,
    x,
    y,
    evs,
    ev: { push: (t: number, ex: number, ey: number, a = 0, b = 0, c = 0) => void evs.push([t, ex, ey, a, b, c]) },
    eAlive: new Uint8Array(N),
    eGen: new Uint32Array(N),
    eX: new Float64Array(N),
    eY: new Float64Array(N),
    eHp: new Float64Array(N),
    eHpMax: new Float64Array(N),
    eSpeed: new Float64Array(N),
    eT: new Int32Array(N),
    eS: new Int32Array(N),
    eAX: new Float64Array(N),
    eAY: new Float64Array(N),
    eV: new Float64Array(N),
    ePhase: new Uint8Array(N),
  };
}
const evOf = (h: FakeHost, t: number): number[][] => h.evs.filter((e) => e[0] === t);

/** 跳到第 t 拍（主角不动） */
function runTo(raid: Raid, h: FakeHost, t: number): void {
  while (h.tick < t) {
    h.tick++;
    raid.tick(h);
  }
}

/**
 * 假核心跑一局：机器人只按指引走（bot.ts），守卫按 guards.ts 走，没有普通怪、主角不会死。
 * 返回每拍的指纹（夜探状态 + 主角位置 + 守卫位置）和结局。
 */
function simulate(template: RaidTemplateId, seed: number, leaveAt = 0, danger = 2): { fps: number[]; raid: Raid; hurt: number } {
  const raid = new Raid({ seed, template, danger });
  const h = fakeHost(raid.map.spawn.x, raid.map.spawn.y);
  const bot = new RaidBot(raid, leaveAt);
  let hurt = 0;
  const fx = { hurt: (d: number) => void (hurt += d) };
  let slots = 0;
  const fps: number[] = [];
  const p = { x: 0, y: 0 };
  while (raid.outcome === 'none') {
    h.tick++;
    for (let g; (g = raid.takeSpawn()) >= 0; ) {
      const s = raid.guardSpawn(g);
      const i = slots++;
      const def = s.kind === 'patrol' || s.kind === 'beast' ? RAID_ENEMIES[s.kind] : ENEMY_BY_KIND[s.kind as EnemyKind];
      h.eAlive[i] = 1;
      h.eGen[i]!++;
      h.eX[i] = s.x;
      h.eY[i] = s.y;
      h.eSpeed[i] = def.speed;
      h.eHp[i] = h.eHpMax[i] = def.hp;
      raid.bindGuard(g, i, h);
    }
    const d = bot.dir(h.x, h.y, h.tick);
    p.x = Math.min(raid.map.size - 20, Math.max(20, h.x + inputCos(d) * 3));
    p.y = Math.min(raid.map.size - 20, Math.max(20, h.y + inputSin(d) * 3));
    raid.map.index.pushOut(p, 14);
    h.x = p.x;
    h.y = p.y;
    let gfp = 0;
    for (let i = 0; i < slots; i++) {
      const g = raid.guardAt(i, h.eGen[i]!);
      if (g < 0) continue;
      const sp = guardStep(raid, g, h, i, fx);
      if (GUARD_MOVE.own) {
        // 守铜箱的精英追人时照自己的行为：这里简单地直追
        const dx = h.x - h.eX[i]!;
        const dy = h.y - h.eY[i]!;
        const dd = Math.hypot(dx, dy) || 1;
        GUARD_MOVE.vx = dx / dd;
        GUARD_MOVE.vy = dy / dd;
      }
      p.x = h.eX[i]! + GUARD_MOVE.vx * sp;
      p.y = h.eY[i]! + GUARD_MOVE.vy * sp;
      raid.map.index.pushOut(p, 26);
      h.eX[i] = p.x;
      h.eY[i] = p.y;
      gfp = (Math.imul(gfp, 31) + (p.x * 64) + (p.y * 64)) | 0;
    }
    raid.tick(h);
    fps.push((raidFingerprint(raid) ^ (h.x * 1024) ^ (h.y * 7)) + gfp);
  }
  return { fps, raid, hurt };
}

describe('夜探：撤离门', () => {
  it('5:00 开一座、6:00 关；10:00 换一座；14:00 四门全开；每次开门发一次事件（全屏提示）', () => {
    const raid = new Raid({ seed: 11, template: 'guzhen', danger: 2 });
    const h = fakeHost(raid.map.spawn.x, raid.map.spawn.y);
    runTo(raid, h, 5 * M - 1);
    expect(raid.gateMask).toBe(0);
    runTo(raid, h, 5 * M);
    expect(raid.gateOpen.reduce((a, b) => a + b, 0)).toBe(1);
    const first = raid.gateOpen.indexOf(1);
    expect(evOf(h, RaidEv.GateOpen).map((e) => e[3])).toEqual([first]);
    runTo(raid, h, 6 * M);
    expect(raid.gateMask).toBe(0);
    expect(evOf(h, RaidEv.GateClose).length).toBe(1);
    runTo(raid, h, 10 * M);
    const second = raid.gateOpen.indexOf(1);
    expect(second).not.toBe(first);
    runTo(raid, h, 14 * M);
    expect([...raid.gateOpen]).toEqual([1, 1, 1, 1]);
    expect(evOf(h, RaidEv.GateOpen).length).toBe(6);
  });

  it('危险 0 和教学镇第 3 分钟开第一座门（13.3）；危险 2 不开', () => {
    for (const [template, danger, open] of [['guzhen', 0, true], ['teach', 3, true], ['dukou', 2, false]] as const) {
      const raid = new Raid({ seed: 3, template, danger });
      const h = fakeHost(raid.map.spawn.x, raid.map.spawn.y);
      runTo(raid, h, 3 * M);
      expect(raid.gateMask !== 0).toBe(open);
    }
  });

  it('站进开着的门圈 3 秒撤出（挨打不打断）；出圈从头来；关着的门站多久都没用', () => {
    const raid = new Raid({ seed: 5, template: 'guzhen', danger: 2 });
    const h = fakeHost(0, 0);
    runTo(raid, h, 5 * M - 200);
    const closed = raid.windows[0]!.gates[0]!;
    const gate = raid.map.gates[closed]!;
    h.x = gate.x;
    h.y = gate.y;
    runTo(raid, h, 5 * M - 1);
    expect(raid.outcome).toBe('none');
    runTo(raid, h, 5 * M + GATE.hold - 10);
    // 走出圈再回来：从头数
    h.x = gate.x + GATE.r + 5;
    runTo(raid, h, h.tick + 1);
    expect(raid.exitProgress()).toBe(0);
    h.x = gate.x + GATE.r - 5;
    runTo(raid, h, h.tick + GATE.hold - 1);
    expect(raid.outcome).toBe('none');
    expect(raid.exitProgress()).toBeCloseTo((GATE.hold - 1) / GATE.hold, 9);
    runTo(raid, h, h.tick + 1);
    expect(raid.outcome).toBe('escaped');
    expect(evOf(h, RaidEv.Escape)[0]![3]).toBe(closed);
  });

  it('14:00 天亮倒计时、14:30 变红；15:00 还在镇里算迷失', () => {
    const raid = new Raid({ seed: 2, template: 'shansi', danger: 2 });
    const h = fakeHost(raid.map.spawn.x, raid.map.spawn.y);
    runTo(raid, h, DAWN_WARN);
    expect(evOf(h, RaidEv.Dawn).map((e) => e[3])).toEqual([0]);
    runTo(raid, h, DAWN_RED);
    expect(evOf(h, RaidEv.Dawn).map((e) => e[3])).toEqual([0, 1]);
    runTo(raid, h, RAID_DAWN - 1);
    expect(raid.outcome).toBe('none');
    runTo(raid, h, RAID_DAWN);
    expect(raid.outcome).toBe('lost');
    expect(evOf(h, RaidEv.Lost).length).toBe(1);
  });
});

describe('夜探：宝箱和背包', () => {
  it('站在箱子旁边 1.5 秒打开，宝物进背包；走开从头来；铜箱、金箱另给一次升级', () => {
    const raid = new Raid({ seed: 8, template: 'guzhen', danger: 2 });
    const h = fakeHost(0, 0);
    const ci = raid.map.chests.findIndex((c) => c.tier === 'copper');
    const c = raid.map.chests[ci]!;
    h.x = c.x + CHEST_OPEN.range - 1;
    h.y = c.y;
    runTo(raid, h, CHEST_OPEN.hold - 1);
    expect(raid.chestOpen[ci]).toBe(0);
    expect(raid.searchProgress()).toBeGreaterThan(0.9);
    h.x = c.x + CHEST_OPEN.range + 1;
    runTo(raid, h, h.tick + 1);
    expect(raid.searchProgress()).toBe(0);
    h.x = c.x;
    runTo(raid, h, h.tick + CHEST_OPEN.hold);
    expect(raid.chestOpen[ci]).toBe(1);
    expect(raid.bag).toEqual(c.items);
    expect(evOf(h, RaidEv.ChestOpen)).toEqual([[RaidEv.ChestOpen, c.x, c.y, ci, 1, 2]]);
    expect(evOf(h, RaidEv.Loot).map((e) => e[3])).toEqual(c.items);
    expect(raid.takeUpgrade()).toBe(true);
    expect(raid.takeUpgrade()).toBe(false);
    // 开过的不会再开
    runTo(raid, h, h.tick + CHEST_OPEN.hold * 2);
    expect(raid.bag.length).toBe(2);
  });

  it('木箱不给升级', () => {
    const raid = new Raid({ seed: 8, template: 'guzhen', danger: 2 });
    const h = fakeHost(0, 0);
    const c = raid.map.chests.find((c) => c.tier === 'wood')!;
    h.x = c.x;
    h.y = c.y;
    runTo(raid, h, CHEST_OPEN.hold);
    expect(raid.bag.length).toBe(1);
    expect(raid.upgrades).toBe(0);
  });
});

describe('夜探：结算、实盘倍数、藏宝阁', () => {
  const withBag = (template: RaidTemplateId, outcome: Raid['outcome'], live?: 'small'): Raid => {
    const raid = new Raid({ seed: 1, template, danger: 0, live });
    raid.bag.push(0, 20, 31, 40);
    raid.outcome = outcome;
    return raid;
  };

  it('撤出：带出全部，娱乐按价值换铜钱', () => {
    const r = settleRaid(withBag('guzhen', 'escaped'), 37);
    expect(r.kept).toEqual([0, 20, 31, 40]);
    expect(r.value).toBe(bagValue([0, 20, 31, 40]));
    expect(r.coins).toBe(37 + Math.floor(r.value * RAID_EXCHANGE.rate));
    expect(r.bp).toBe(0);
  });

  it('死亡、迷失：背包全丢，娱乐拿捡到的铜钱的一半，实盘 0', () => {
    for (const o of ['dead', 'lost'] as const) {
      const r = settleRaid(withBag('guzhen', o), 37);
      expect(r.kept).toEqual([]);
      expect(r.lost.length).toBe(4);
      expect(r.coins).toBe(18);
      expect(settleRaid(withBag('guzhen', o, 'small'), 37).bp).toBe(0);
    }
  });

  it('教学镇死了不丢包；教学镇不能开实盘', () => {
    const r = settleRaid(withBag('teach', 'dead'), 10);
    expect(r.kept.length).toBe(4);
    expect(r.coins).toBe(10 + r.value);
    expect(() => new Raid({ seed: 1, template: 'teach', danger: 0, live: 'small' })).toThrow();
  });

  it('实盘：倍数 = 价值 ÷ 基准，封顶，万分之一向下取整；结回向下取整（4.2）', () => {
    const base = RAID_LIVE.base.small;
    expect(liveBp(0, 'small')).toBe(0);
    expect(liveBp(base, 'small')).toBe(10000);
    expect(liveBp(base * 100, 'small')).toBe(RAID_LIVE.cap * 10000);
    expect(liveBp(1, 'small')).toBe(Math.floor((1 / base) * 10000));
    let prev = -1;
    for (let v = 0; v < base * 4; v += 7) {
      const bp = liveBp(v, 'small');
      expect(bp).toBeGreaterThanOrEqual(prev);
      prev = bp;
    }
    expect(livePayout(2000, 13001)).toBe(2600);
    expect(livePayout(2000, 0)).toBe(0);
    const r = settleRaid(withBag('guzhen', 'escaped', 'small'), 5);
    expect(r.bp).toBe(liveBp(r.value, 'small'));
    expect(r.coins).toBe(5);
  });

  it('藏宝阁：带出的点亮、丢了的只算见过；第一次收藏的单独列出；收藏 20 件解锁采药女', () => {
    let v = emptyVault();
    const a = recordRaid(v, { kept: [0, 0, 5], lost: [44] });
    v = a.vault;
    expect(a.fresh).toEqual([TREASURES[0]!.id, TREASURES[5]!.id]);
    expect(v.got[TREASURES[0]!.id]).toBe(2);
    expect(v.got[TREASURES[44]!.id]).toBeUndefined();
    expect(v.seen).toContain(TREASURES[44]!.id);
    const p = vaultProgress(v);
    expect(p).toMatchObject({ got: 2, seen: 3, total: 45 });
    expect(p.byTier.fan.got).toBe(2);
    expect(herbalistUnlocked(v)).toBe(false);
    v = recordRaid(v, { kept: Array.from({ length: 20 }, (_, i) => i), lost: [] }).vault;
    expect(herbalistUnlocked(v)).toBe(true);
    // 存档读回：坏数据丢掉
    expect(normalizeVault({ got: { [TREASURES[1]!.id]: 3, nope: 2, [TREASURES[2]!.id]: -1 }, seen: ['nope', 7] })).toEqual({ got: { [TREASURES[1]!.id]: 3 }, seen: [TREASURES[1]!.id] });
    expect(normalizeVault(null)).toEqual(emptyVault());
  });
});

describe('夜探：刷怪辅助', () => {
  it('离镇中心越近怪越凶；刷怪表按分钟取，过了最后一档用最后一档', () => {
    const raid = new Raid({ seed: 4, template: 'guzhen', danger: 2 });
    const c = raid.map.center;
    const inner = { ...raidZoneMul(raid.map, c, c) };
    const outer = { ...raidZoneMul(raid.map, 100, 100) };
    expect(inner.hp).toBeGreaterThan(outer.hp);
    expect(inner.dmg).toBeGreaterThan(outer.dmg);
    expect(inner.count).toBeGreaterThan(outer.count);
    expect(outer.hp).toBe(1);
    expect(raidMinute(0).keep).toBeLessThan(raidMinute(14 * M).keep);
    expect(raidMinute(99 * M)).toBe(raidMinute(14 * M));
  });

  it('刷怪点推出墙、夹进场地', () => {
    const raid = new Raid({ seed: 4, template: 'dukou', danger: 2 });
    const river = raid.map.blocks.find((b) => b.look === 'river')!;
    const p = { x: river.x + 30, y: river.y + 20 };
    raidSpawnPoint(raid, p);
    expect(raid.map.index.free(p.x, p.y, 16)).toBe(true);
    const q = { x: -50, y: raid.map.size + 50 };
    raidSpawnPoint(raid, q);
    expect(q.x).toBeGreaterThanOrEqual(10);
    expect(q.y).toBeLessThanOrEqual(raid.map.size - 10);
  });
});

describe('夜探：撤离指引和只看指引的机器人', () => {
  it('指引：最近的开着的门（按沿路距离）、方向是单位向量、脚印一路走近门', () => {
    const raid = new Raid({ seed: 9, template: 'shansi', danger: 2 });
    const h = fakeHost(raid.map.spawn.x, raid.map.spawn.y);
    const g = newGuide();
    expect(guide(raid, h.x, h.y, g)).toBe(false);
    runTo(raid, h, 14 * M);
    expect(guide(raid, h.x, h.y, g)).toBe(true);
    expect(g.gate).toBeGreaterThanOrEqual(0);
    expect(g.dirX * g.dirX + g.dirY * g.dirY).toBeCloseTo(1, 9);
    expect(g.trailN).toBeGreaterThan(0);
    const gate = raid.map.gates[g.gate]!;
    expect(g.dist).toBeGreaterThanOrEqual(Math.hypot(gate.x - h.x, gate.y - h.y) - GATE.r - 50);
    // 第一个脚印比主角离门更近（沿路）
    const g2 = newGuide();
    guide(raid, g.trail[0]!, g.trail[1]!, g2);
    expect(g2.dist).toBeLessThan(g.dist);
  });

  it('14:00 四门全开时，从地图上任何走得到的地方沿路走到门再站够 3 秒都不到 1 分钟，95% 的地方不到 50 秒（小白不会因为找不到门迷失）', () => {
    for (const t of ['guzhen', 'dukou', 'shansi', 'teach'] as const) {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const raid = new Raid({ seed, template: t, danger: 2 });
        const h = fakeHost(0, 0);
        runTo(raid, h, 14 * M);
        const nav = raid.map.nav;
        const field = gateField(raid)!;
        const reach = nav.field([nav.index(raid.map.spawn.x, raid.map.spawn.y)]);
        const secs: number[] = [];
        for (let c = 0; c < nav.free.length; c++) {
          if (!nav.free[c] || reach[c]! >= NAV_INF) continue;
          expect(field[c]!, `${t}/${seed} 有地方走不到门`).toBeLessThan(NAV_INF);
          // 主角每秒 90 单位；格子路长按直走 10、斜走 14 算，比实际走的略长
          secs.push(((field[c]! / 10) * NAV_CELL) / 90 + GATE.hold / 30);
        }
        secs.sort((x, y) => x - y);
        expect(secs.at(-1)!, `${t}/${seed} 最远`).toBeLessThan(60);
        expect(secs[Math.floor(secs.length * 0.95)]!, `${t}/${seed} 95%`).toBeLessThan(50);
      }
    }
  }, 60000);

  it('同种子同输入逐拍相同（含守卫）；换种子不同', () => {
    const a = simulate('guzhen', 7, 9 * M);
    const b = simulate('guzhen', 7, 9 * M);
    expect(a.fps.length).toBe(b.fps.length);
    expect(a.fps).toEqual(b.fps);
    expect(a.raid.bag).toEqual(b.raid.bag);
    const c = simulate('guzhen', 8, 9 * M);
    expect(c.fps).not.toEqual(a.fps);
  }, 60000);

  it('只看指引的机器人：各模板都撤得出去、背包有东西；教学镇和危险 0 在 6:00 前撤出', () => {
    for (const t of ['guzhen', 'dukou', 'shansi', 'teach'] as const) {
      for (const seed of [1, 2]) {
        const { raid } = simulate(t, seed, 0, t === 'teach' ? 0 : 2);
        expect(raid.outcome, `${t}/${seed}`).toBe('escaped');
        expect(raid.bag.length).toBeGreaterThan(0);
        if (t === 'teach') expect(raid.endTick).toBeLessThan(6 * M);
      }
    }
    const { raid } = simulate('dukou', 3, 0, 0);
    expect(raid.endTick).toBeLessThan(6 * M);
  }, 120000);

  it('越晚撤搜得越多（同一张图，9 分钟后才走的比门一开就走的背包更值钱）', () => {
    let early = 0;
    let late = 0;
    for (const seed of [1, 2]) {
      early += bagValue(simulate('guzhen', seed, 0).raid.bag);
      late += bagValue(simulate('guzhen', seed, 14 * M).raid.bag);
    }
    expect(late).toBeGreaterThan(early);
  }, 120000);
});
