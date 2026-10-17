import { describe, expect, it } from 'vitest';
import { createWorld, grantWeapon } from '../src/core/index.ts';
import { mergeHint } from '../src/view/ui/mergeHint.ts';

function world() {
  const w = createWorld({ seed: 3, mode: 'vigil', danger: 0 });
  w.weapons.length = 0;
  w.wstats.length = 0;
  return w;
}

describe('选卡合成提示', () => {
  it('两件都差不多了，拿到最后一样就"凑成"', () => {
    const w = world();
    grantWeapon(w, 'sword', 8);
    w.passives.zhusha = 1;
    grantWeapon(w, 'flysword', 8);
    w.passives.caoxie = 1;
    // 手上都齐了，只差飞剑还没进化：此时拿到的卡不再补缺口，没有提示
    expect(mergeHint(w, { kind: 'weapon', id: 'flysword' })).toBeNull();
    // 飞剑没满级、差最后一级：这张补上，凑成
    w.weapons.find((o) => o.id === 'flysword')!.level = 7;
    const h = mergeHint(w, { kind: 'weapon', id: 'flysword' });
    expect(h?.ready).toBe(true);
    expect(h?.text).toBe('凑成 诛邪剑阵！');
    expect(h?.dual).toBe(false);
  });

  it('差一个被动：被动卡写"再拿 X"，别的卡没有', () => {
    const w = world();
    grantWeapon(w, 'flysword', 8, true);
    grantWeapon(w, 'talisman', 8);
    const h = mergeHint(w, { kind: 'passive', id: 'xianglu' });
    expect(h?.ready).toBe(true);
    expect(h?.id).toBe('fujian');
    expect(h?.dual).toBe(true);
    expect(mergeHint(w, { kind: 'passive', id: 'zhusha' })).toBeNull();
  });

  it('新法器：partner 在手，拿了只差一步就提示', () => {
    const w = world();
    grantWeapon(w, 'petals', 8, true);
    grantWeapon(w, 'bell', 7);
    w.passives.xiantao = 1;
    const h = mergeHint(w, { kind: 'weapon', id: 'bell' });
    expect(h?.id).toBe('linghua');
    expect(h?.ready).toBe(true);
  });

  it('已合成的、离得远的、铜钱卡都没有提示', () => {
    const w = world();
    grantWeapon(w, 'sword', 1);
    expect(mergeHint(w, { kind: 'weapon', id: 'sword' })).toBeNull();
    expect(mergeHint(w, { kind: 'coins', id: 'coins' })).toBeNull();
    w.merges.push('fujian');
    grantWeapon(w, 'flysword', 8, true);
    grantWeapon(w, 'talisman', 7);
    expect(mergeHint(w, { kind: 'weapon', id: 'talisman' })?.id).not.toBe('fujian');
  });
});
