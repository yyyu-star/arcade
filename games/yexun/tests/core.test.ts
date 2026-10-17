import { describe, expect, it } from 'vitest';
import { createWorld, Drop, Ev, fingerprint, step, type World } from '../src/core/index.ts';
import { PICKUP } from '../src/content/player.ts';
import { Bot } from '../tools/bots.ts';
import { fsqrt } from '../src/core/fmath.ts';
import { COS, SIN } from '../src/core/dirs.ts';

/** 测试用的输入：带种子的伪随机摇杆（一阵一阵换方向，像人） */
function play(seed: number, ticks: number, onTick?: (w: World, t: number) => void): World {
  const w = createWorld({ seed, mode: 'vigil', danger: 2 });
  let s = seed >>> 0;
  let dir = 1;
  for (let t = 0; t < ticks && w.phase !== 'over'; t++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    if (s % 23 === 0) dir = s % 33;
    step(w, dir, w.phase === 'choose' ? s % 3 : -1);
    onTick?.(w, t);
  }
  return w;
}

describe('确定性', () => {
  it('同种子同输入，逐拍指纹相同', () => {
    const a: number[] = [];
    const b: number[] = [];
    play(7, 6000, (w, t) => t % 50 === 0 && a.push(fingerprint(w)));
    play(7, 6000, (w, t) => t % 50 === 0 && b.push(fingerprint(w)));
    expect(a.length).toBeGreaterThan(50);
    expect(b).toEqual(a);
  });

  it('换个种子，局面就不一样', () => {
    expect(fingerprint(play(1, 2000))).not.toBe(fingerprint(play(2, 2000)));
  });

  it('金标准：固定种子和输入跑 3 分钟的指纹（规则变了要有意识地更新它，并加 RULES_VERSION）', () => {
    const w = play(20261016, 30 * 180);
    expect({ tick: w.tick, kills: w.kills, level: w.level, fp: fingerprint(w) }).toMatchInlineSnapshot(`
      {
        "fp": 713488373,
        "kills": 718,
        "level": 5,
        "tick": 5396,
      }
    `);
  });
});

describe('数学', () => {
  it('fsqrt 和 Math.sqrt 差不到 1e-14（相对）', () => {
    for (const x of [1e-6, 0.5, 1, 2, 3.999, 4, 17, 12345.678, 9.9e7]) expect(Math.abs(fsqrt(x) - Math.sqrt(x)) / Math.sqrt(x)).toBeLessThan(1e-14);
    expect(fsqrt(0)).toBe(0);
    expect(fsqrt(-1)).toBe(0);
  });
  it('方向表是单位向量', () => {
    for (let i = 0; i < 256; i++) {
      expect(Math.abs(COS[i]! - Math.cos((i / 256) * Math.PI * 2))).toBeLessThan(1e-15);
      expect(Math.abs(SIN[i]! - Math.sin((i / 256) * Math.PI * 2))).toBeLessThan(1e-15);
    }
  });
});

describe('一局', () => {
  it('选卡时时间不走，选完接着走', () => {
    const w = createWorld({ seed: 5, mode: 'vigil', danger: 0 });
    const bot = new Bot('normal', 'sword', 5);
    for (let n = 0; n < 5000 && w.phase === 'play'; n++) step(w, bot.act(w).dir);
    expect(w.phase).toBe('choose');
    const t = w.tick;
    step(w, 5);
    step(w, 5);
    expect(w.tick).toBe(t);
    step(w, 0, 0);
    expect(w.phase).toBe('play');
  });

  it('开场节奏（DESIGN.md 13.3）：第一次升级 10–20 秒，前 3 分钟升级 6–9 次（普通玩家、普通难度，20 局均值）', () => {
    let first = 0;
    let three = 0;
    const n = 20;
    for (let seed = 1; seed <= n; seed++) {
      const w = createWorld({ seed, mode: 'vigil', danger: 2 });
      const bot = new Bot('normal', 'sword', seed);
      let f = -1;
      while (w.phase !== 'over' && w.tick < 30 * 180) {
        const a = bot.act(w);
        step(w, a.dir, a.choice);
        for (let i = 0; i < w.ev.n; i++) if (w.ev.type[i] === Ev.LevelUp && f < 0) f = w.tick / 30;
      }
      first += f;
      three += w.level - 1;
    }
    expect(first / n).toBeGreaterThanOrEqual(10);
    expect(first / n).toBeLessThanOrEqual(20);
    expect(three / n).toBeGreaterThanOrEqual(6);
    expect(three / n).toBeLessThanOrEqual(9);
  }, 30_000);
});

describe('魂珠', () => {
  it('地上的魂珠不超过上限，多出来的经验并进大珠，不丢', () => {
    // 小白只顾躲，不专门去捡珠子，地上会越积越多
    const w = createWorld({ seed: 11, mode: 'vigil', danger: 2 });
    const bot = new Bot('novice', 'ward', 11);
    let maxVal = 0;
    while (w.tick < 30 * 240 && w.phase !== 'over') {
      const a = bot.act(w);
      step(w, a.dir, w.phase === 'choose' ? a.choice : -1);
      let n = 0;
      for (let i = 0; i < w.dAlive.length; i++) {
        if (w.dAlive[i] && w.dKind[i] === Drop.Soul) {
          n++;
          maxVal = Math.max(maxVal, w.dVal[i]!);
        }
      }
      expect(n).toBe(w.soulCount);
      expect(n).toBeLessThanOrEqual(PICKUP.soulCap);
    }
    expect(maxVal).toBeGreaterThan(20);
  }, 30_000);
});
