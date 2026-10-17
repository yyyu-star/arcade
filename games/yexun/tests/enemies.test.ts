import { describe, expect, it } from 'vitest';
import { BONE, ENEMY_BY_KIND, PALANQUIN, WATER, WEASEL } from '../src/content/enemies.ts';
import { CALM, DIFFICULTIES, OPEN_TICKS } from '../src/content/waves.ts';
import { createWorld, Drop, Ev, grantWeapon, spawnNow, step, type World } from '../src/core/index.ts';

/** 一个干净的场：没有法器（不会误伤），开场事件已经过了，不再按分钟补怪 */
function quiet(seed = 5): World {
  const w = createWorld({ seed, mode: 'vigil', difficulty: 'normal' });
  w.weapons.length = 0;
  w.wstats.length = 0;
  w.nextEvent = 1 << 30;
  return w;
}
function alive(w: World, kind: keyof typeof ENEMY_BY_KIND): number {
  let n = 0;
  for (let i = 0; i < w.eAlive.length; i++) if (w.eAlive[i] && w.eKind[i] === ENEMY_BY_KIND[kind].code) n++;
  return n;
}
/** 把第 i 只怪打死（用一记足够大的伤害，走正常的死亡流程） */
function kill(w: World, i: number): void {
  w.eHp[i] = 0.5;
  grantWeapon(w, 'bell', 8);
  w.eX[i] = w.x + 20;
  w.eY[i] = w.y;
  for (let t = 0; t < 120 && w.eAlive[i] && w.eGen[i]; t++) step(w, 0, 0);
}

describe('新怪', () => {
  it('枯骨打散成两只小的，小的不再散', () => {
    const w = quiet();
    const i = spawnNow(w, 'bone', w.x + 300, w.y);
    w.eSize[i] = 1;
    const gen = w.eGen[i];
    kill(w, i);
    expect(w.eAlive[i] && w.eGen[i] === gen).toBeFalsy();
    let small = 0;
    for (let j = 0; j < w.eAlive.length; j++) if (w.eAlive[j] && w.eKind[j] === ENEMY_BY_KIND.bone.code && w.eSize[j] === BONE.size) small++;
    // 钟一直在敲，小的可能也死了；至少当场生过两只
    expect(small + w.kills).toBeGreaterThanOrEqual(BONE.split);
  });

  it('黄鼠狼叼走地上的铜钱，打死双倍还', () => {
    const w = quiet();
    // 放一枚铜钱在主角远处（不会被吸）
    w.dAlive[0] = 1;
    w.dKind[0] = Drop.Coin;
    w.dX[0] = w.x + 400;
    w.dY[0] = w.y;
    w.dVal[0] = 1;
    w.dPull[0] = 0;
    w.dCount++;
    const i = spawnNow(w, 'weasel', w.x + 500, w.y);
    let stole = false;
    for (let t = 0; t < 300 && !stole; t++) {
      step(w, 0, -1);
      for (let k = 0; k < w.ev.n; k++) if (w.ev.type[k] === Ev.Steal) stole = true;
    }
    expect(stole).toBe(true);
    expect(w.eS[i]).toBe(1);
    expect(w.eV[i]).toBe(1);
    kill(w, i);
    let coins = 0;
    for (let d = 0; d < w.dAlive.length; d++) if (w.dAlive[d] && w.dKind[d] === Drop.Coin) coins += w.dVal[d]!;
    expect(coins + w.coins).toBeGreaterThanOrEqual(WEASEL.payback);
  });

  it('水鬼冒出来的那几拍不伤人，冒出来以后抓住主角会拖慢', () => {
    const w = quiet();
    const i = spawnNow(w, 'water', w.x + 4, w.y);
    for (let t = 0; t < WATER.emerge - 2; t++) step(w, 0, -1);
    expect(w.hp).toBe(100);
    for (let t = 0; t < 10; t++) {
      w.eX[i] = w.x + 4;
      w.eY[i] = w.y;
      step(w, 0, -1);
    }
    expect(w.hp).toBeLessThan(100);
    expect(w.slowUntil).toBeGreaterThan(w.tick);
    // 拖慢时走一拍的距离变短
    const x0 = w.x;
    w.eAlive[i] = 0;
    w.eCount--;
    step(w, 1, -1);
    expect(w.x - x0).toBeLessThan(w.stats.speed * 0.7);
  });

  it('雪魅的冰锥打中会拖慢', () => {
    const w = quiet();
    spawnNow(w, 'snow', w.x + 200, w.y);
    let hitSlow = false;
    for (let t = 0; t < 400 && !hitSlow; t++) {
      step(w, 0, -1);
      if (w.slowUntil > w.tick) hitSlow = true;
    }
    expect(hitSlow).toBe(true);
  });

  it('铜钱剑挡下飞来的弹', () => {
    const w = quiet();
    grantWeapon(w, 'coins', 8, true);
    spawnNow(w, 'lantern', w.x + 220, w.y);
    let blocked = 0;
    for (let t = 0; t < 900; t++) {
      step(w, 0, 0);
      for (let k = 0; k < w.ev.n; k++) if (w.ev.type[k] === Ev.Block) blocked++;
    }
    expect(blocked).toBeGreaterThan(0);
  });

  it('纸轿打碎放出一群纸人，精英倒下进收获期', () => {
    const w = quiet();
    const i = spawnNow(w, 'palanquin', w.x + 300, w.y);
    const before = alive(w, 'paper');
    w.eHp[i] = 0.5;
    w.eX[i] = w.x + 20;
    grantWeapon(w, 'bell', 8);
    let burst = false;
    for (let t = 0; t < 60 && !burst; t++) {
      step(w, 0, 0);
      for (let k = 0; k < w.ev.n; k++) if (w.ev.type[k] === Ev.Kill && w.ev.a[k] === ENEMY_BY_KIND.palanquin.code) burst = true;
    }
    expect(burst).toBe(true);
    expect(alive(w, 'paper') + w.kills).toBeGreaterThan(before + PALANQUIN.burst / 2);
    expect(w.calmUntil).toBeGreaterThan(w.tick + CALM.afterElite - 70);
  });

  it('白狐一次连冲三下', () => {
    const w = quiet();
    const i = spawnNow(w, 'whitefox', w.x + 200, w.y);
    let dashes = 0;
    let prev = 0;
    for (let t = 0; t < 200; t++) {
      step(w, 0, -1);
      if (w.eS[i] === 2 && prev !== 2) dashes++;
      prev = w.eS[i]!;
      if (w.eS[i] === 0 && dashes > 0) break;
    }
    expect(dashes).toBe(3);
  });
});

describe('新手保护', () => {
  it('新手档开场怪走得慢：原地不动也撑得过第一次升级', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const w = createWorld({ seed, mode: 'vigil', difficulty: 'easy' });
      while (w.level < 2 && w.phase === 'play' && w.tick < OPEN_TICKS * 2) step(w, 0, -1);
      expect(w.level).toBeGreaterThanOrEqual(2);
    }
  });

  it('第一局 3 分钟前不会死（原地不动、一直选第一张）', () => {
    const w = createWorld({ seed: 9, mode: 'vigil', difficulty: 'easy', firstRun: true });
    let lowest = 100;
    while (w.tick < 30 * 180 && w.phase !== 'over') {
      step(w, 0, 0);
      lowest = Math.min(lowest, w.hp);
    }
    expect(w.phase).not.toBe('over');
    expect(lowest).toBeGreaterThanOrEqual(1);
  });

  it('新手档前几次升级至少两张是法器', () => {
    const w = createWorld({ seed: 4, mode: 'vigil', difficulty: 'easy' });
    let seen = 0;
    while (seen < DIFFICULTIES.easy.armsFirst && w.tick < 30 * 300 && w.phase !== 'over') {
      step(w, 0, -1);
      if (w.phase === 'choose') {
        expect(w.choices.filter((c) => c.kind === 'weapon').length).toBeGreaterThanOrEqual(2);
        seen++;
        step(w, 0, 0);
      }
    }
    expect(seen).toBe(DIFFICULTIES.easy.armsFirst);
  });
});

