import { describe, expect, it } from 'vitest';
import { SCHOOL_IDS, SCHOOLS, WEAPON_ROLE, GUIDE_EXAMPLES } from '../src/content/guide.ts';
import { PASSIVES, WEAPONS, type WeaponId } from '../src/content/weapons.ts';
import { BUILD_IDS, BUILDS } from '../tools/bots.ts';

// 玩法说明的流派单子和机器人用的是同一份打法：两边一改另一边就要跟（说明讲的就是模拟器验证过的路线）
describe('玩法说明的数据', () => {
  it('流派和机器人的单子一致', () => {
    expect([...SCHOOL_IDS]).toEqual([...BUILD_IDS]);
    for (const id of SCHOOL_IDS) {
      expect([...SCHOOLS[id].weapons]).toEqual(BUILDS[id].weapons);
      expect([...SCHOOLS[id].passives]).toEqual(BUILDS[id].passives);
    }
  });

  it('每件法器都标了干什么活；流派里的法器、被动都存在', () => {
    for (const id of Object.keys(WEAPONS) as WeaponId[]) expect(WEAPON_ROLE[id]).toBeDefined();
    for (const id of SCHOOL_IDS) {
      for (const w of SCHOOLS[id].weapons) expect(WEAPONS[w]).toBeDefined();
      for (const p of SCHOOLS[id].passives) expect(PASSIVES[p]).toBeDefined();
    }
    expect(GUIDE_EXAMPLES[0]).toBe('sword');
  });
});
