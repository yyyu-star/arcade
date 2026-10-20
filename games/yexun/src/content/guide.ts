/**
 * 玩法说明用的内容（所有者 10-20：参照掼蛋规则说明、麻将规则小册）。名字、配方、数值都从别的表现取，这里只放说明独有的东西：
 * 流派单子（和机器人 tools/bots.ts BUILDS 同一份，tests/guide.test.ts 锁住两边一致）、每件法器干什么活、每个流派一句心得。
 * 以后加法器、流派（纸人）、地图（荒庙）时，说明会自己跟上；漏登记的由测试拦下。
 */
import type { PassiveId, WeaponId } from './weapons.ts';

/** 法器干的活：清群（成片小怪）、单体（精英和 Boss）、保命（不让你被围死） */
export type Role = 'crowd' | 'single' | 'guard';
export const ROLE_NAME: Record<Role, string> = { crowd: '清群', single: '单体', guard: '保命' };
export const ROLE_TIP: Record<Role, string> = {
  crowd: '对付成片的小怪，前期最要紧',
  single: '对付精英和尸王，后半夜靠它',
  guard: '减速、推开、挡伤、回血，不让你被围死',
};

export const WEAPON_ROLE: Record<WeaponId, Role> = {
  sword: 'crowd',
  talisman: 'crowd',
  coins: 'guard',
  flysword: 'single',
  thunder: 'single',
  bell: 'guard',
  mirror: 'guard',
  gourd: 'crowd',
  rope: 'guard',
  petals: 'crowd',
  shield: 'guard',
  crane: 'single',
};

export type SchoolId = 'sword' | 'talisman' | 'ward' | 'wood' | 'fire';

export interface School {
  id: SchoolId;
  name: string;
  /** 想要的法器（按先后，第一件是起手） */
  weapons: readonly WeaponId[];
  /** 想要的被动（进化要的排前面） */
  passives: readonly PassiveId[];
  /** 一句心得：长处、短处、怎么补 */
  tip: string;
}

export const SCHOOL_IDS: readonly SchoolId[] = ['sword', 'talisman', 'ward', 'wood', 'fire'];

export const SCHOOLS: Record<SchoolId, School> = {
  sword: {
    id: 'sword',
    name: '剑修',
    weapons: ['sword', 'flysword', 'coins', 'thunder', 'bell'],
    passives: ['zhusha', 'caoxie', 'lingpai', 'xianglu', 'nianzhu', 'xiantao'],
    tip: '前期清群快，刀剑砍不动的硬怪多了会吃力：留一格给符、镇或火补刀',
  },
  talisman: {
    id: 'talisman',
    name: '符箓',
    weapons: ['talisman', 'thunder', 'crane', 'sword', 'flysword'],
    passives: ['xianglu', 'nianzhu', 'xiantao', 'yinhun', 'zhusha', 'lingpai'],
    tip: '符多就是一切：冷却和范围先拿满，符 3 件每次多飞一张',
  },
  ward: {
    id: 'ward',
    name: '镇守',
    weapons: ['bell', 'mirror', 'shield', 'rope', 'sword'],
    passives: ['xiantao', 'daopao', 'huangli', 'modou', 'nianzhu', 'zhusha'],
    tip: '站得住、死得少，但杀得慢：中期要补一件打得疼的',
  },
  wood: {
    id: 'wood',
    name: '五雷',
    weapons: ['thunder', 'sword', 'petals', 'talisman', 'gourd'],
    passives: ['nianzhu', 'zhusha', 'xiantao', 'lingzhi', 'xianglu', 'luopan'],
    tip: '木 3 件相生到火：雷、剑、花一起放，满屏开花',
  },
  fire: {
    id: 'fire',
    name: '烈火',
    weapons: ['talisman', 'gourd', 'thunder', 'sword', 'petals'],
    passives: ['xianglu', 'luopan', 'xiantao', 'zhusha', 'nianzhu', 'lingpai'],
    tip: '纸扎和僵尸都怕火；提灯鬼不怕，半夜见它要换着打',
  },
};

/** 例子页展开写的流派（第一个写完整路线，后两个各一段） */
export const GUIDE_EXAMPLES: readonly SchoolId[] = ['sword', 'talisman', 'ward'];
