import { describe, expect, it } from 'vitest';
import { CHEST, GATE_WINDOWS, GATE_WINDOWS_EARLY, RAID_DAWN, RAID_ENEMIES, RAID_LIVE, RAID_MINUTES, RAID_PACE_MODEL, RAID_TEMPLATES } from '../src/content/explore.ts';
import { ENEMY_BY_KIND } from '../src/content/enemies.ts';
import { TIERS, TREASURES, TREASURES_BY_TIER } from '../src/content/treasures.ts';
import { expectedChestValue, tierWeights } from '../src/explore/loot.ts';

describe('夜探内容表', () => {
  it('宝物 45 件、四档齐、id 不重复、每件有名字说明图标（13.1）', () => {
    expect(TREASURES.length).toBe(45);
    expect(new Set(TREASURES.map((t) => t.id)).size).toBe(45);
    for (const t of TIERS) expect(TREASURES_BY_TIER[t].length).toBeGreaterThanOrEqual(5);
    for (const t of TREASURES) {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.blurb.length).toBeGreaterThan(0);
      expect(t.icon.length).toBeGreaterThan(0);
      expect(Number.isInteger(t.value) && t.value > 0).toBe(true);
    }
  });

  it('档越高越值钱：每档最便宜的比下一档最贵的还贵', () => {
    for (let k = 1; k < TIERS.length; k++) {
      const lo = Math.max(...TREASURES_BY_TIER[TIERS[k - 1]!].map((i) => TREASURES[i]!.value));
      const hi = Math.min(...TREASURES_BY_TIER[TIERS[k]!].map((i) => TREASURES[i]!.value));
      expect(hi).toBeGreaterThan(lo);
    }
  });

  it('三个模板 + 教学镇（3.6）；教学镇是小地图、没有石兽', () => {
    expect(Object.keys(RAID_TEMPLATES).sort()).toEqual(['dukou', 'guzhen', 'shansi', 'teach']);
    expect(RAID_TEMPLATES.teach.size).toBeLessThan(RAID_TEMPLATES.guzhen.size / 2);
    expect(RAID_TEMPLATES.teach.vault).toBeNull();
    for (const id of ['guzhen', 'dukou', 'shansi'] as const) {
      expect(RAID_TEMPLATES[id].size).toBe(6400);
      expect(RAID_TEMPLATES[id].vault).not.toBeNull();
      expect(RAID_TEMPLATES[id].gates.length).toBe(4);
    }
    expect(RAID_TEMPLATES.dukou.river).toBeDefined();
    expect(RAID_TEMPLATES.shansi.terraces).toBeDefined();
  });

  it('宝箱三档：木 1 件、铜 2 件、金 3 件；权重和为 1，越深越值钱', () => {
    expect([CHEST.wood.items, CHEST.copper.items, CHEST.gold.items]).toEqual([1, 2, 3]);
    for (const t of ['wood', 'copper', 'gold'] as const) {
      for (const d of [0, 0.5, 1]) expect(tierWeights(t, d).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      expect(expectedChestValue(t, 1)).toBeGreaterThan(expectedChestValue(t, 0));
    }
    expect(expectedChestValue('gold', 0)).toBeGreaterThan(expectedChestValue('copper', 1));
    expect(expectedChestValue('copper', 0)).toBeGreaterThan(expectedChestValue('wood', 1));
  });

  it('撤离门：5:00、10:00 各开一座，14:00 四门全开到 15:00 天亮；危险 0 和教学镇 3:00 开第一座（13.3）', () => {
    expect(GATE_WINDOWS.map((w) => [w.from / 1800, w.to / 1800, w.all])).toEqual([[5, 6, false], [10, 11, false], [14, 15, true]]);
    expect(GATE_WINDOWS_EARLY[0]!.from).toBe(3 * 1800);
    expect(GATE_WINDOWS.at(-1)!.to).toBe(RAID_DAWN);
  });

  it('夜探刷怪表每分钟都有，远程怪每种 ≤ 8%，怪种都在怪物表里', () => {
    expect(RAID_MINUTES.length).toBe(15);
    for (const m of RAID_MINUTES) {
      expect(m.mix.lantern ?? 0).toBeLessThanOrEqual(0.08);
      expect(m.mix.snow ?? 0).toBeLessThanOrEqual(0.08);
      for (const k of Object.keys(m.mix)) expect(ENEMY_BY_KIND[k as keyof typeof ENEMY_BY_KIND]).toBeDefined();
    }
    for (let k = 1; k < RAID_MINUTES.length - 1; k++) expect(RAID_MINUTES[k]!.keep).toBeGreaterThanOrEqual(RAID_MINUTES[k - 1]!.keep);
  });

  it('巡夜将是精英、镇门石兽是 Boss（3.5）；巡夜将比主角慢', () => {
    expect(RAID_ENEMIES.patrol.elite).toBe(true);
    expect(RAID_ENEMIES.beast.boss).toBe(true);
    expect(RAID_ENEMIES.patrol.speed).toBeLessThan(3);
  });

  it('结回倍数形状（4.2）：估算节奏下 5 分钟约 0.5、10 分钟约 1.3、15 分钟约 2，单调涨，不超过封顶', () => {
    let prev = 0;
    for (const p of RAID_PACE_MODEL) {
      let v = 0;
      for (const [k, n] of Object.entries(p.chests)) v += expectedChestValue(k as 'wood', p.depth) * n;
      const m = v / RAID_LIVE.base.small;
      expect(Math.abs(m - p.target)).toBeLessThan(0.1);
      expect(m).toBeGreaterThan(prev);
      expect(m).toBeLessThanOrEqual(RAID_LIVE.cap);
      prev = m;
    }
    expect(RAID_LIVE.danger).toEqual({ small: 0, mid: 2, large: 3 });
  });
});
