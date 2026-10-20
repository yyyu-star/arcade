import { describe, expect, it } from 'vitest';
import { PICKS, SKIP_FX, SKIP_PRIZES } from '../src/content/picks.ts';
import { createWorld, Ev, Pick, spawnNow, step, type Setup, type World } from '../src/core/index.ts';
import { Bot } from '../tools/bots.ts';

/** 跑到第一次弹三选一 */
function toChoice(seed: number, extra: Partial<Setup> = {}): World {
  const w = createWorld({ seed, mode: 'vigil', danger: 0, ...extra });
  const bot = new Bot('normal', 'sword', seed);
  while (w.phase === 'play' && w.tick < 30 * 120) step(w, bot.act(w).dir, -1);
  if (w.phase !== 'choose') throw new Error(`种子 ${seed} 两分钟内没升级`);
  return w;
}
const evs = (w: World, t: number): { a: number; b: number }[] => {
  const out = [];
  for (let i = 0; i < w.ev.n; i++) if (w.ev.type[i] === t) out.push({ a: w.ev.a[i]!, b: w.ev.b[i]! });
  return out;
};

describe('选卡三件套（10-20）', () => {
  it('起步刷新 3、封禁 2；实盘局暂照旧 2、1', () => {
    const w = createWorld({ seed: 1, mode: 'vigil', danger: 0 });
    expect([w.rerolls, w.bans]).toEqual([PICKS.rerolls, PICKS.bans]);
    const l = createWorld({ seed: 1, mode: 'vigil', danger: 0, live: true });
    expect([l.rerolls, l.bans]).toEqual([PICKS.liveRerolls, PICKS.liveBans]);
  });

  it('跳过：抽一样小奖，不加经验；同一种子抽到的一样（录像能复现）', () => {
    const w = toChoice(7);
    const xp = w.xp;
    const before = { coins: w.coins, hp: w.hp, rerolls: w.rerolls };
    step(w, 0, Pick.Skip);
    const [e] = evs(w, Ev.Skip);
    expect(e).toBeDefined();
    expect(w.xp).toBe(xp);
    const id = SKIP_PRIZES[e!.a]!.id;
    if (id === 'coins') expect(w.coins - before.coins).toBe(SKIP_FX.coinBase + SKIP_FX.coinPerLevel * w.level);
    if (id === 'heal') expect(w.hp).toBeGreaterThan(before.hp);
    if (id === 'card') expect(w.bonusCard).toBe(1);
    if (id === 'reroll') expect(w.rerolls).toBe(before.rerolls + 1);
    const again = toChoice(7);
    step(again, 0, Pick.Skip);
    expect(evs(again, Ev.Skip)[0]).toEqual(e);
  }, 20_000);

  it('四样都抽得到，比例大致按表；满血不出回血', () => {
    const n = [0, 0, 0, 0];
    let fullHeal = 0;
    const base = toChoice(11);
    for (let s = 0; s < 400; s++) {
      // 开局直接弹一次选卡（不用跑到第一次升级），换 400 个种子看跳过抽到什么；单数局满血
      const w = createWorld({ seed: 1000 + s, mode: 'vigil', danger: 0 });
      w.pendingLevels = 1;
      w.level = base.level;
      if (s % 2 === 0) w.hp = 10;
      step(w, 0);
      step(w, 0, Pick.Skip);
      const e = evs(w, Ev.Skip)[0]!;
      n[e.a]!++;
      if (s % 2 === 1 && SKIP_PRIZES[e.a]!.id === 'heal') fullHeal++;
    }
    expect(fullHeal).toBe(0);
    for (const c of n) expect(c).toBeGreaterThan(20);
  });

  it('下次多一张卡：只管下一次升级，不叠加', () => {
    const w = createWorld({ seed: 3, mode: 'vigil', danger: 0 });
    w.bonusCard = 1;
    w.pendingLevels = 1;
    step(w, 0);
    expect(w.choices.length).toBe(4);
    step(w, 0, Pick.Reroll);
    expect(w.choices.length).toBe(4);
    step(w, 0, 0);
    expect(w.bonusCard).toBe(0);
    w.pendingLevels = 1;
    step(w, 0);
    expect(w.choices.length).toBe(3);
  });

  it('打倒精英补一次刷新，最多攒到 9；实盘局不补', () => {
    for (const live of [false, true]) {
      const w = createWorld({ seed: 5, mode: 'vigil', danger: 0, live });
      w.rerolls = PICKS.rerollMax - 1;
      let got = 0;
      for (let k = 0; k < 2; k++) {
        const i = spawnNow(w, 'shishi', w.x + 60, w.y);
        w.eHp[i] = 0.001;
        for (let t = 0; t < 600 && w.eAlive[i]; t++) {
          w.eHp[i] = Math.min(w.eHp[i]!, 0.001);
          // 打死怪的魂可能升一级：停在选卡上就选第一张
          step(w, 0, w.phase === 'choose' ? 0 : -1);
          got += evs(w, Ev.Reroll).length;
        }
        expect(w.eAlive[i]).toBe(0);
      }
      expect(w.rerolls).toBe(live ? PICKS.rerollMax - 1 : PICKS.rerollMax);
      expect(got).toBe(live ? 0 : 1);
    }
  });

  it('实盘局跳过照旧换一点魂', () => {
    const w = toChoice(7, { live: true });
    const xp = w.xp;
    step(w, 0, Pick.Skip);
    expect(w.xp).toBeGreaterThan(xp);
    expect(evs(w, Ev.Skip)[0]!.a).toBe(-1);
  }, 20_000);
});
