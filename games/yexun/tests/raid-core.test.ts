import { describe, expect, it } from 'vitest';
import { ENEMY_BY_KIND } from '../src/content/enemies.ts';
import { RaidEv } from '../src/explore/host.ts';
import { RaidBot } from '../src/explore/bot.ts';
import { createWorld, Ev, fingerprint, step, type World } from '../src/core/index.ts';
import type { RaidTemplateId } from '../src/content/explore.ts';

// 夜探接进规则核心（第 6 步，src/explore/host.ts 末尾的清单）
const raidWorld = (seed: number, template: RaidTemplateId, danger: 0 | 2 = 2): World => createWorld({ seed, mode: 'raid', danger, raid: { template } });

/** 只看指引走的机器人打完一局（选卡选第一张）；返回结局 */
function play(w: World, leaveAt: number, cap = 15 * 60 * 30 + 10): string {
  const bot = new RaidBot(w.raid!, leaveAt);
  while (w.phase !== 'over' && w.tick < cap) {
    if (w.phase === 'choose') step(w, 0, 0);
    else step(w, bot.dir(w.x, w.y, w.tick));
  }
  return w.raid!.outcome;
}

describe('夜探接进核心', () => {
  it('场地按镇子大小，主角在出生点，开局刷出地图上的守卫', () => {
    const w = raidWorld(3, 'guzhen');
    expect(w.arenaW).toBe(w.raid!.map.size);
    expect(w.x).toBe(w.raid!.map.spawn.x);
    expect(w.blocks.length).toBeGreaterThan(0);
    step(w, 0);
    let guards = 0;
    for (let i = 0; i < w.eAlive.length; i++) if (w.eAlive[i] && w.raid!.guardAt(i, w.eGen[i]!) >= 0) guards++;
    expect(guards).toBe(w.raid!.map.guards.length);
    expect(ENEMY_BY_KIND.beast.code).toBe(19);
  });
  it('夜探的事件编号和核心的 Ev 一致', () => {
    for (const [k, v] of Object.entries(RaidEv)) expect((Ev as Record<string, number>)[k]).toBe(v);
  });
  it('同种子、同输入逐位相同（指纹里带着夜探的状态）', () => {
    const run = (): number[] => {
      const w = raidWorld(11, 'dukou');
      const bot = new RaidBot(w.raid!, 4 * 60 * 30);
      const fps: number[] = [];
      while (w.phase !== 'over' && w.tick < 5 * 60 * 30) {
        if (w.phase === 'choose') step(w, 0, 0);
        else step(w, bot.dir(w.x, w.y, w.tick));
        if (w.tick % 300 === 0) fps.push(fingerprint(w));
      }
      return fps;
    };
    expect(run()).toEqual(run());
  });
  it('教学镇、危险 0：只看指引的机器人撤得出来，撤出算赢', () => {
    const w = raidWorld(5, 'teach', 0);
    expect(play(w, 3 * 60 * 30)).toBe('escaped');
    expect(w.won).toBe(true);
  }, 60_000);
});
