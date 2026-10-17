/**
 * 法器、被动、进化（DESIGN.md 3.1–3.3）。改数值只改这里，改完跑模拟器（DESIGN.md 第 8 节）。
 * 单位：时间按拍（每秒 30 拍），距离按世界单位（主角宽约 40），速度按每拍多少单位。
 * 第 2 步先做 6 件法器（八卦镜、火葫芦第 3 步加）和 2 个进化（斩妖剑、天师符雨）。
 */

export type WeaponId = 'sword' | 'talisman' | 'coins' | 'flysword' | 'thunder' | 'bell';
export type PassiveId = 'zhusha' | 'xianglu' | 'caoxie' | 'xiantao' | 'luopan' | 'daopao' | 'nianzhu' | 'lingpai';

/** 一件法器在某一级的数值 */
export interface WeaponStats {
  /** 每下伤害 */
  dmg: number;
  /** 冷却（拍） */
  cd: number;
  /** 范围：剑是斩痕半径，符是爆炸半径，铜钱是绕身半径，铃是光环半径，雷是落点半径 */
  area: number;
  /** 数量：剑几道、符几张、铜钱几枚、飞剑几把、雷几道 */
  amount: number;
  /** 飞行速度（每拍单位）；铜钱是每拍转过的方向表格数 */
  speed: number;
  /** 持续：符的寿命、铜钱一轮转多久、飞剑飞多远（单位） */
  duration: number;
  /** 击退力度（单位） */
  knock: number;
  /** 同一只怪被这件法器连着打的间隔（拍） */
  rehit: number;
}

export interface LevelUp {
  /** 卡片上的一句话 */
  text: string;
  delta: Partial<WeaponStats>;
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  /** 图集里的图标帧 */
  icon: string;
  /** 新拿到时卡片上的说明 */
  desc: string;
  base: WeaponStats;
  /** 第 2–8 级的提升（下标 0 是升到 2 级） */
  ups: LevelUp[];
  /** 进化：满级 + 这件被动，开宝箱时进化 */
  evolve?: { with: PassiveId; name: string; icon: string; desc: string; stats: WeaponStats };
}

export const MAX_WEAPON_LEVEL = 8;
export const MAX_WEAPONS = 6;
export const MAX_PASSIVES = 6;

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  sword: {
    id: 'sword',
    name: '桃木剑',
    icon: 'i_sword',
    desc: '朝面前横扫一道大弧',
    base: { dmg: 14, cd: 36, area: 118, amount: 2, speed: 0, duration: 0, knock: 10, rehit: 8 },
    ups: [
      { text: '多砍一道', delta: { amount: 1 } },
      { text: '伤害 +6', delta: { dmg: 6 } },
      { text: '范围变大', delta: { area: 20 } },
      { text: '多砍一道', delta: { amount: 1 } },
      { text: '伤害 +6', delta: { dmg: 6 } },
      { text: '出手更快', delta: { cd: -6 } },
      { text: '范围变大、伤害 +8', delta: { area: 20, dmg: 8 } },
    ],
    evolve: {
      with: 'zhusha',
      name: '斩妖剑',
      icon: 'i_sword_evo',
      desc: '前后各两道大斩，砍中回血',
      stats: { dmg: 44, cd: 26, area: 175, amount: 4, speed: 0, duration: 0, knock: 16, rehit: 8 },
    },
  },
  talisman: {
    id: 'talisman',
    name: '符咒',
    icon: 'i_talisman',
    desc: '黄符飞向最近的怪，命中爆开',
    base: { dmg: 10, cd: 30, area: 34, amount: 1, speed: 13, duration: 70, knock: 6, rehit: 10 },
    ups: [
      { text: '多发一张', delta: { amount: 1 } },
      { text: '伤害 +5', delta: { dmg: 5 } },
      { text: '出手更快', delta: { cd: -5 } },
      { text: '多发一张', delta: { amount: 1 } },
      { text: '爆炸更大', delta: { area: 14 } },
      { text: '伤害 +6', delta: { dmg: 6 } },
      { text: '多发一张', delta: { amount: 1 } },
    ],
    evolve: {
      with: 'xianglu',
      name: '天师符雨',
      icon: 'i_talisman_evo',
      desc: '符咒几乎不停地飞出去',
      stats: { dmg: 22, cd: 9, area: 56, amount: 3, speed: 16, duration: 80, knock: 8, rehit: 8 },
    },
  },
  coins: {
    id: 'coins',
    name: '铜钱剑',
    icon: 'i_coins',
    desc: '一串铜钱绕着身子转',
    base: { dmg: 9, cd: 150, area: 76, amount: 3, speed: 7, duration: 90, knock: 8, rehit: 12 },
    ups: [
      { text: '多一枚铜钱', delta: { amount: 1 } },
      { text: '转得更大圈', delta: { area: 16 } },
      { text: '转得更久', delta: { duration: 30 } },
      { text: '伤害 +5', delta: { dmg: 5 } },
      { text: '多一枚铜钱', delta: { amount: 1 } },
      { text: '转得更久、歇得更短', delta: { duration: 30, cd: -20 } },
      { text: '伤害 +6、多一枚', delta: { dmg: 6, amount: 1 } },
    ],
  },
  flysword: {
    id: 'flysword',
    name: '飞剑',
    icon: 'i_fly',
    desc: '飞剑绕身待命，看见怪就飞出去穿过一串',
    base: { dmg: 16, cd: 54, area: 0, amount: 2, speed: 22, duration: 340, knock: 6, rehit: 14 },
    ups: [
      { text: '多一把飞剑', delta: { amount: 1 } },
      { text: '伤害 +6', delta: { dmg: 6 } },
      { text: '出手更快', delta: { cd: -10 } },
      { text: '多一把飞剑', delta: { amount: 1 } },
      { text: '飞得更快更远', delta: { speed: 4, duration: 60 } },
      { text: '伤害 +8', delta: { dmg: 8 } },
      { text: '多一把飞剑', delta: { amount: 1 } },
    ],
  },
  thunder: {
    id: 'thunder',
    name: '雷符',
    icon: 'i_thunder',
    desc: '天雷劈向附近的怪，落点一圈都挨打',
    base: { dmg: 28, cd: 78, area: 50, amount: 1, speed: 0, duration: 430, knock: 4, rehit: 1 },
    ups: [
      { text: '多劈一道', delta: { amount: 1 } },
      { text: '伤害 +10', delta: { dmg: 10 } },
      { text: '落点更大', delta: { area: 14 } },
      { text: '多劈一道', delta: { amount: 1 } },
      { text: '劈得更勤', delta: { cd: -14 } },
      { text: '伤害 +14', delta: { dmg: 14 } },
      { text: '再多劈两道', delta: { amount: 2 } },
    ],
  },
  bell: {
    id: 'bell',
    name: '镇魂铃',
    icon: 'i_bell',
    desc: '身边一圈光环，里面的怪持续挨打、走得慢',
    base: { dmg: 5, cd: 18, area: 66, amount: 1, speed: 0, duration: 0, knock: 1, rehit: 1 },
    ups: [
      { text: '光环变大', delta: { area: 12 } },
      { text: '伤害 +2', delta: { dmg: 2 } },
      { text: '光环变大', delta: { area: 12 } },
      { text: '响得更勤', delta: { cd: -3 } },
      { text: '伤害 +3', delta: { dmg: 3 } },
      { text: '光环变大', delta: { area: 14 } },
      { text: '伤害 +3', delta: { dmg: 3 } },
    ],
  },
};

export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];

/** 某件法器在某一级（1–8）的数值；进化后用进化的数值 */
export function weaponStats(id: WeaponId, level: number, evolved: boolean): WeaponStats {
  const def = WEAPONS[id];
  if (evolved && def.evolve) return { ...def.evolve.stats };
  const s = { ...def.base };
  for (let i = 0; i < level - 1 && i < def.ups.length; i++) {
    const d = def.ups[i]!.delta;
    for (const k of Object.keys(d) as (keyof WeaponStats)[]) s[k] += d[k]!;
  }
  return s;
}

export interface PassiveDef {
  id: PassiveId;
  name: string;
  icon: string;
  /** 每级的说明 */
  text: string;
  max: number;
}

export const PASSIVES: Record<PassiveId, PassiveDef> = {
  zhusha: { id: 'zhusha', name: '朱砂', icon: 'p_zhusha', text: '伤害 +10%', max: 5 },
  xianglu: { id: 'xianglu', name: '香炉', icon: 'p_xianglu', text: '冷却 −8%', max: 5 },
  caoxie: { id: 'caoxie', name: '草鞋', icon: 'p_caoxie', text: '走得快 10%', max: 5 },
  xiantao: { id: 'xiantao', name: '仙桃', icon: 'p_xiantao', text: '血上限 +20，慢慢回血', max: 5 },
  luopan: { id: 'luopan', name: '罗盘', icon: 'p_luopan', text: '吸魂珠的范围 +30%', max: 5 },
  daopao: { id: 'daopao', name: '道袍', icon: 'p_daopao', text: '每次挨打少掉 1 点血', max: 5 },
  nianzhu: { id: 'nianzhu', name: '念珠', icon: 'p_nianzhu', text: '法器范围 +10%', max: 5 },
  lingpai: { id: 'lingpai', name: '令牌', icon: 'p_lingpai', text: '法器数量 +1', max: 2 },
};

export const PASSIVE_IDS = Object.keys(PASSIVES) as PassiveId[];
