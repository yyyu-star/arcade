/**
 * 法器、被动、进化（DESIGN.md 3.1–3.3）。改数值只改这里，改完跑模拟器（DESIGN.md 第 8 节）。
 * 单位：时间按拍（每秒 30 拍），距离按世界单位（主角宽约 40），速度按每拍多少单位。
 * 12 件法器、12 个被动、12 个进化、3 个合成（3b 起齐了）。
 */

// 顺序决定法器编号（事件、宝箱里用），只往后加
export type WeaponId = 'sword' | 'talisman' | 'coins' | 'flysword' | 'thunder' | 'bell' | 'mirror' | 'gourd' | 'rope' | 'petals' | 'shield' | 'crane';

/** 五行和类型标签（DESIGN.md 3.1、3.4：同标签凑件数有套装加成） */
export type Element = '金' | '木' | '水' | '火' | '土';
export type WeaponType = '剑' | '符' | '镇' | '灵';
export type PassiveId = 'zhusha' | 'xianglu' | 'caoxie' | 'xiantao' | 'luopan' | 'daopao' | 'nianzhu' | 'lingpai' | 'huangli' | 'lingzhi' | 'modou' | 'yinhun';

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
  el: Element;
  type: WeaponType;
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
    el: '木',
    type: '剑',
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
    el: '火',
    type: '符',
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
    el: '金',
    type: '剑',
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
    evolve: {
      with: 'lingpai',
      name: '金钱阵',
      icon: 'i_coins_evo',
      desc: '两圈铜钱常驻绕身，不再歇',
      stats: { dmg: 30, cd: 30, area: 96, amount: 8, speed: 8, duration: 0, knock: 10, rehit: 10 },
    },
  },
  flysword: {
    id: 'flysword',
    name: '飞剑',
    icon: 'i_fly',
    desc: '飞剑绕身待命，看见怪就飞出去穿过一串',
    el: '金',
    type: '剑',
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
    evolve: {
      with: 'caoxie',
      name: '万剑归宗',
      icon: 'i_fly_evo',
      desc: '一出手就是一扇面，飞回来再打一遍',
      stats: { dmg: 40, cd: 40, area: 0, amount: 8, speed: 28, duration: 460, knock: 8, rehit: 10 },
    },
  },
  thunder: {
    id: 'thunder',
    name: '雷符',
    icon: 'i_thunder',
    desc: '天雷劈向附近的怪，落点一圈都挨打',
    el: '木',
    type: '符',
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
    evolve: {
      with: 'nianzhu',
      name: '五雷正法',
      icon: 'i_thunder_evo',
      desc: '每道雷连着劈五只',
      stats: { dmg: 70, cd: 54, area: 70, amount: 2, speed: 0, duration: 460, knock: 6, rehit: 1 },
    },
  },
  bell: {
    id: 'bell',
    name: '镇魂铃',
    icon: 'i_bell',
    desc: '身边一圈光环，里面的怪持续挨打、走得慢',
    el: '金',
    type: '镇',
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
    evolve: {
      with: 'xiantao',
      name: '往生铃',
      icon: 'i_bell_evo',
      desc: '光环更大，光环里的怪死了给你回血',
      stats: { dmg: 18, cd: 12, area: 150, amount: 1, speed: 0, duration: 0, knock: 1, rehit: 1 },
    },
  },
  mirror: {
    id: 'mirror',
    name: '八卦镜',
    icon: 'i_mirror',
    desc: '一圈光波往外推，推开并打伤一圈怪',
    el: '水',
    type: '镇',
    // area：光波推到多远；speed：光波每拍扩多少；amount：一次连放几道（隔 8 拍）
    base: { dmg: 12, cd: 96, area: 150, amount: 1, speed: 9, duration: 0, knock: 26, rehit: 30 },
    ups: [
      { text: '光波推得更远', delta: { area: 20 } },
      { text: '伤害 +6', delta: { dmg: 6 } },
      { text: '放得更勤', delta: { cd: -12 } },
      { text: '一次两道光波', delta: { amount: 1 } },
      { text: '推得更远、更狠', delta: { area: 20, knock: 8 } },
      { text: '伤害 +8', delta: { dmg: 8 } },
      { text: '放得更勤', delta: { cd: -14 } },
    ],
    evolve: {
      with: 'daopao',
      name: '太极镜',
      icon: 'i_mirror_evo',
      desc: '一黑一白两道光波，扫掉怪的火球',
      stats: { dmg: 40, cd: 60, area: 230, amount: 2, speed: 10, duration: 0, knock: 40, rehit: 6 },
    },
  },
  gourd: {
    id: 'gourd',
    name: '火葫芦',
    icon: 'i_gourd',
    desc: '朝最近的怪喷一道火，扇面里都挨烧',
    el: '火',
    type: '灵',
    // area：火舌多长；duration：一次喷几拍；amount：扇面宽（每多 1 宽 6°，基础 ±22°）
    base: { dmg: 6, cd: 84, area: 130, amount: 1, speed: 0, duration: 36, knock: 2, rehit: 6 },
    ups: [
      { text: '伤害 +2', delta: { dmg: 2 } },
      { text: '火舌更长', delta: { area: 20 } },
      { text: '喷得更久', delta: { duration: 12 } },
      { text: '扇面更宽', delta: { amount: 1 } },
      { text: '伤害 +3', delta: { dmg: 3 } },
      { text: '喷得更勤', delta: { cd: -14 } },
      { text: '扇面更宽、伤害 +3', delta: { amount: 1, dmg: 3 } },
    ],
    evolve: {
      with: 'luopan',
      name: '三昧真火',
      icon: 'i_gourd_evo',
      desc: '喷过的地方留一摊火，烧一阵',
      stats: { dmg: 20, cd: 60, area: 170, amount: 3, speed: 0, duration: 54, knock: 2, rehit: 6 },
    },
  },
  rope: {
    id: 'rope',
    name: '缚妖索',
    icon: 'i_rope',
    desc: '甩出绳索捆住一串怪，捆住的走不动',
    el: '土',
    type: '镇',
    // amount：一次捆几只；area：从第一只往外找下一只的距离；duration：捆几拍
    // 主要是控场：伤害低，捆住的怪不会马上死，拖住才有用
    base: { dmg: 3, cd: 120, area: 140, amount: 3, speed: 0, duration: 75, knock: 0, rehit: 1 },
    ups: [
      { text: '多捆两只', delta: { amount: 2 } },
      { text: '捆得更久', delta: { duration: 15 } },
      { text: '伤害 +4', delta: { dmg: 4 } },
      { text: '多捆两只', delta: { amount: 2 } },
      { text: '甩得更勤', delta: { cd: -20 } },
      { text: '捆得更久', delta: { duration: 20 } },
      { text: '多捆三只', delta: { amount: 3 } },
    ],
    evolve: {
      with: 'modou',
      name: '捆仙绳',
      icon: 'i_rope_evo',
      desc: '一次捆一大片，捆住的挨打加倍',
      stats: { dmg: 10, cd: 90, area: 200, amount: 18, speed: 0, duration: 130, knock: 0, rehit: 1 },
    },
  },
  petals: {
    id: 'petals',
    name: '桃花雨',
    icon: 'i_petal',
    desc: '身边落桃花，砸中的怪挨打，主角回一点血',
    el: '木',
    type: '灵',
    // amount：一次落几片；area：落在身边多大一圈；duration：花瓣落地要几拍
    base: { dmg: 9, cd: 60, area: 150, amount: 4, speed: 0, duration: 14, knock: 3, rehit: 1 },
    ups: [
      { text: '多落两片', delta: { amount: 2 } },
      { text: '伤害 +4', delta: { dmg: 4 } },
      { text: '落得更开', delta: { area: 20 } },
      { text: '多落两片', delta: { amount: 2 } },
      { text: '落得更勤', delta: { cd: -10 } },
      { text: '伤害 +5', delta: { dmg: 5 } },
      { text: '多落三片', delta: { amount: 3 } },
    ],
    evolve: {
      with: 'lingzhi',
      name: '十里桃林',
      icon: 'i_petal_evo',
      desc: '花瓣铺满一圈，回血更多',
      stats: { dmg: 26, cd: 40, area: 200, amount: 18, speed: 0, duration: 14, knock: 3, rehit: 1 },
    },
  },
  shield: {
    id: 'shield',
    name: '金钟罩',
    icon: 'i_shield',
    desc: '护盾挡下一次伤害，碎的时候震开身边的怪',
    el: '土',
    type: '镇',
    // amount：最多挡几下；cd：回一层要几拍；area、dmg：碎的时候震多大、打多少
    base: { dmg: 20, cd: 360, area: 110, amount: 1, speed: 0, duration: 0, knock: 30, rehit: 1 },
    ups: [
      { text: '回得更快', delta: { cd: -60 } },
      { text: '震得更疼', delta: { dmg: 12 } },
      { text: '多挡一下', delta: { amount: 1 } },
      { text: '震得更远', delta: { area: 20 } },
      { text: '回得更快', delta: { cd: -60 } },
      { text: '震得更疼', delta: { dmg: 16 } },
      { text: '多挡一下', delta: { amount: 1 } },
    ],
    evolve: {
      with: 'huangli',
      name: '不坏金身',
      icon: 'i_shield_evo',
      desc: '护盾一回就回满，碎的时候震开全屏',
      stats: { dmg: 70, cd: 90, area: 600, amount: 3, speed: 0, duration: 0, knock: 40, rehit: 1 },
    },
  },
  crane: {
    id: 'crane',
    name: '纸鹤',
    icon: 'i_crane',
    desc: '纸鹤在身边盘旋，俯冲去啄最近的怪',
    el: '水',
    type: '符',
    // amount：几只纸鹤；area：看多远的怪；speed：俯冲多快；cd：一轮俯冲的间隔（几只轮流）
    base: { dmg: 13, cd: 70, area: 300, amount: 1, speed: 15, duration: 0, knock: 6, rehit: 10 },
    ups: [
      { text: '多一只纸鹤', delta: { amount: 1 } },
      { text: '伤害 +5', delta: { dmg: 5 } },
      { text: '啄得更勤', delta: { cd: -12 } },
      { text: '多一只纸鹤', delta: { amount: 1 } },
      { text: '飞得更快、伤害 +5', delta: { speed: 4, dmg: 5 } },
      { text: '多一只纸鹤', delta: { amount: 1 } },
      { text: '伤害 +8', delta: { dmg: 8 } },
    ],
    evolve: {
      with: 'yinhun',
      name: '千鹤引魂',
      icon: 'i_crane_evo',
      desc: '一群纸鹤，啄死的怪变成小纸鹤',
      stats: { dmg: 36, cd: 40, area: 340, amount: 6, speed: 20, duration: 0, knock: 6, rehit: 10 },
    },
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
  huangli: { id: 'huangli', name: '黄历', icon: 'p_huangli', text: '幸运 +10%：暴击、宝箱多给、好卡', max: 5 },
  lingzhi: { id: 'lingzhi', name: '灵芝', icon: 'p_lingzhi', text: '魂珠经验 +8%', max: 5 },
  modou: { id: 'modou', name: '墨斗', icon: 'p_modou', text: '持续 +10%：火、绳、铜钱、护盾', max: 5 },
  yinhun: { id: 'yinhun', name: '引魂灯', icon: 'p_yinhun', text: '怪多 10%、快 5%，经验和铜钱 +12%', max: 5 },
};

/** 合成（DESIGN.md 3.3）：两件都进化了，宝箱里合成一件，空出一个法器格；a 留在原来的格子里，b 也照常出手 */
export interface MergeDef {
  id: 'zhuxie' | 'leihuo' | 'yinyang';
  name: string;
  icon: string;
  desc: string;
  a: WeaponId;
  b: WeaponId;
}

export const MERGES: readonly MergeDef[] = [
  { id: 'zhuxie', name: '诛邪剑阵', icon: 'm_sword', desc: '每次挥剑，待命的飞剑一起射出去', a: 'sword', b: 'flysword' },
  { id: 'leihuo', name: '雷火符箓', icon: 'm_talisman', desc: '每张符爆开时落一道雷', a: 'talisman', b: 'thunder' },
  { id: 'yinyang', name: '阴阳镇魂', icon: 'm_mirror', desc: '光环里的怪减速一半，光波从光环边上再放一圈', a: 'mirror', b: 'bell' },
];

export const PASSIVE_IDS = Object.keys(PASSIVES) as PassiveId[];
