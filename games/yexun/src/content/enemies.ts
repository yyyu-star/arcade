import type { Element, WeaponType } from './weapons.ts';
import { RAID_ENEMIES } from './explore.ts';

/**
 * 怪物（DESIGN.md 3.4）。速度按每拍单位（主角 3.0），血量是第 0 分钟、"普通"难度的值，随时间和难度放大（waves.ts）。
 */

export type EnemyKind =
  | 'paper' | 'wisp' | 'jiangshi' | 'lantern' | 'fox' | 'shishi' | 'general' | 'boss'
  | 'horse' | 'water' | 'bone' | 'bat' | 'scarecrow' | 'weasel' | 'snow' | 'whitefox' | 'palanquin' | 'lord'
  | 'patrol'
  | 'beast';

export interface EnemyDef {
  kind: EnemyKind;
  /** 数组里的编号（核心用整数存种类） */
  code: number;
  hp: number;
  speed: number;
  /** 碰到主角掉多少血 */
  dmg: number;
  /** 碰撞半径 */
  r: number;
  /** 掉多少魂（经验） */
  xp: number;
  /** 抗击退（0 = 照单全收，1 = 推不动） */
  steady: number;
  /** 精英：掉宝箱 */
  elite?: boolean;
  /** Boss：血不随时间涨、顶上有血条、捆不住、不会被挪走或挤掉 */
  boss?: boolean;
  /**
   * 克制：按法器的类型或五行乘伤害（< 1 扛打，> 1 怕）。同一件法器类型和五行都对上就连乘。
   * 主线 #154：剑阵偏强，靠"有些怪顶得住刀剑"来克，不直接砍剑；纸扎的怪和僵尸（跳尸、尸王）怕火；僵尸怕镇尸铃（镇类），给火和镇守各一个主场。
   */
  vs?: Partial<Record<WeaponType | Element, number>>;
}

export const ENEMIES: readonly EnemyDef[] = [
  { kind: 'paper', code: 0, hp: 5, speed: 1.7, dmg: 5, r: 13, xp: 1, steady: 0, vs: { 火: 1.5 } },
  { kind: 'wisp', code: 1, hp: 4, speed: 2.5, dmg: 4, r: 11, xp: 1, steady: 0 },
  { kind: 'jiangshi', code: 2, hp: 18, speed: 1.45, dmg: 9, r: 17, xp: 2, steady: 0.3, vs: { 剑: 0.65, 火: 1.4, 镇: 1.3 } },
  { kind: 'lantern', code: 3, hp: 14, speed: 1.2, dmg: 6, r: 15, xp: 2, steady: 0.1, vs: { 剑: 0.6, 水: 1.5 } },
  { kind: 'fox', code: 4, hp: 12, speed: 1.9, dmg: 8, r: 14, xp: 2, steady: 0.1 },
  { kind: 'shishi', code: 5, hp: 320, speed: 1.15, dmg: 15, r: 30, xp: 20, steady: 0.9, elite: true, vs: { 剑: 0.5 } },
  { kind: 'general', code: 6, hp: 520, speed: 1.3, dmg: 16, r: 30, xp: 30, steady: 0.85, elite: true, vs: { 剑: 0.6, 火: 1.25, 镇: 1.3 } },
  { kind: 'boss', code: 7, hp: 20000, speed: 1.55, dmg: 22, r: 44, xp: 0, steady: 0.97, boss: true, vs: { 剑: 0.8, 火: 1.4, 镇: 1.3 } },
  // 第 4 步：编号接着往后排（存档、录像里存的是编号，已有的不挪）
  { kind: 'horse', code: 8, hp: 10, speed: 4, dmg: 7, r: 16, xp: 2, steady: 0.2, vs: { 火: 1.5 } },
  { kind: 'water', code: 9, hp: 22, speed: 0.9, dmg: 6, r: 15, xp: 2, steady: 0.5, vs: { 土: 1.5 } },
  { kind: 'bone', code: 10, hp: 16, speed: 1.6, dmg: 7, r: 14, xp: 1, steady: 0.2, vs: { 剑: 0.7, 镇: 1.4 } },
  { kind: 'bat', code: 11, hp: 6, speed: 2.7, dmg: 4, r: 10, xp: 1, steady: 0 },
  { kind: 'scarecrow', code: 12, hp: 55, speed: 1.1, dmg: 10, r: 18, xp: 4, steady: 0.8, vs: { 剑: 0.6, 火: 1.6 } },
  { kind: 'weasel', code: 13, hp: 14, speed: 2.4, dmg: 3, r: 13, xp: 2, steady: 0.1 },
  { kind: 'snow', code: 14, hp: 16, speed: 1.3, dmg: 5, r: 14, xp: 2, steady: 0.2, vs: { 剑: 0.5, 火: 1.5 } },
  { kind: 'whitefox', code: 15, hp: 500, speed: 1.7, dmg: 11, r: 26, xp: 25, steady: 0.85, elite: true, vs: { 剑: 0.6, 镇: 1.3 } },
  { kind: 'palanquin', code: 16, hp: 760, speed: 1, dmg: 14, r: 36, xp: 30, steady: 0.9, elite: true, vs: { 剑: 0.7, 火: 1.5 } },
  { kind: 'lord', code: 17, hp: 6000, speed: 1.15, dmg: 18, r: 40, xp: 60, steady: 0.96, boss: true, vs: { 火: 1.3 } },
  // 夜探的守卫（数值在 content/explore.ts，移动由 src/explore/guards.ts 算）
  { kind: 'patrol', code: 18, ...RAID_ENEMIES.patrol },
  { kind: 'beast', code: 19, ...RAID_ENEMIES.beast },
];

export const ENEMY_BY_KIND: Record<EnemyKind, EnemyDef> = Object.fromEntries(ENEMIES.map((e) => [e.kind, e])) as Record<EnemyKind, EnemyDef>;

/** 跳尸一跳的周期（拍）和腾空的那段：腾空时走、落地停一下 */
export const HOP_PERIOD = 26;
export const HOP_AIR = 16;
export const HOP_SPEED_MUL = 1.6;

/** 灯笼鬼：停在这个距离吐火球 */
export const LANTERN = { range: 270, every: 120, speed: 3.2, dmg: 5, life: 160, r: 9 };
/** 狐妖：近了停一下再冲 */
export const FOX = { trigger: 250, windup: 14, dash: 18, dashSpeed: 6.5, rest: 110 };
/** 狐妖、白狐的冲刺；白狐一次连冲 chain 下，两下之间只蓄力 rewind 拍 */
export const WHITEFOX = { chain: 3, rewind: 14 };
/** 雪魅：停在这个距离丢冰锥，打中主角走路变慢 slowTicks 拍 */
export const SNOW = { range: 300, every: 180, speed: 3.6, dmg: 4, life: 150, r: 9, slowTicks: 45 };
/** 主角被冰锥打中、被水鬼抓住时的走路速度倍数 */
export const PLAYER_SLOW = 0.62;
/** 水鬼：在主角附近冒出来，冒的那几拍不动也不伤人；抓住主角拖慢 grabTicks 拍 */
export const WATER = { emerge: 40, near: 200, far: 280, grabTicks: 50 };
/** 枯骨：打散成两只小的（个头 size、血是原来的 hp 倍），小的不再散 */
export const BONE = { split: 2, size: 0.62, hp: 0.4 };
/** 蝙蝠精：每隔几拍换一个侧向的晃动 */
export const BAT = { every: 8, wobble: 0.9 };
/** 稻草人：站着不动，主角走到 wake 以内才醒 */
export const SCARECROW = { wake: 190 };
/** 黄鼠狼：每 scan 拍找一次 range 以内的铜钱，叼走就跑（跑出 lose 就带着钱消失），打死还双倍 */
export const WEASEL = { scan: 15, range: 520, flee: 1.25, lose: 1000, payback: 2 };
/** 纸轿：每 every 拍从轿后放 drop 个纸人，打碎放出 burst 个 */
export const PALANQUIN = { every: 240, drop: 3, burst: 14 };
/** 跳尸将军：隔一阵召一圈小跳尸 */
export const GENERAL = { every: 260, count: 6, ring: 70 };
/**
 * 尸王：按血分三段（DESIGN.md 2.2）。一段（满血到 2/3）只跳砸和召唤；二段加尸气、更勤；三段（1/3 以下）发怒：
 * 跳砸的圈更大、尸气两圈、召唤更多。进新一段时吼一声（事件里 a = 4）。
 */
export const BOSS = {
  /** 每段两个技能之间隔几拍 */
  every: [150, 120, 90],
  /** 进入二段、三段的血线 */
  phaseAt: [2 / 3, 1 / 3],
  /** 跳砸：先在地上画圈警告，跳到主角站的地方砸下来 */
  stompWarn: 30,
  stompRadius: 120,
  stompDmg: 34,
  /** 召唤：一圈跳尸 */
  summon: 8,
  /** 尸气：一圈慢速弹 */
  breath: 14,
  breathSpeed: 2.6,
  breathDmg: 13,
  /** 三段：跳砸的圈放大、召唤加量 */
  ragedStomp: 1.35,
  ragedSummon: 12,
};

/**
 * 纸扎老爷（守夜中期 Boss，8:00）：两段。一段撒纸钱（一圈慢慢旋开的纸钱弹）；血少于一半进二段：纸钱撒两圈、更勤，
 * 每第三个技能召一顶纸轿（场上最多 2 顶，召来的不掉宝箱）。打倒掉宝箱。
 */
export const LORD = {
  every: [120, 90],
  money: 16,
  moneySpeed: 2.3,
  moneyDmg: 5,
  moneyLife: 260,
  moneyR: 10,
  /** 每拍纸钱的速度方向转一格（方向表 256 格），转成旋涡 */
  moneyTurn: 1,
  maxPalanquin: 2,
};
