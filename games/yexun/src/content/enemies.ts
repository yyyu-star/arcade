/**
 * 怪物（DESIGN.md 3.4）。速度按每拍单位（主角 3.0），血量是第 0 分钟、"普通"难度的值，随时间和难度放大（waves.ts）。
 */

export type EnemyKind = 'paper' | 'wisp' | 'jiangshi' | 'lantern' | 'fox' | 'shishi' | 'general' | 'boss';

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
}

export const ENEMIES: readonly EnemyDef[] = [
  { kind: 'paper', code: 0, hp: 5, speed: 1.7, dmg: 5, r: 13, xp: 1, steady: 0 },
  { kind: 'wisp', code: 1, hp: 4, speed: 2.5, dmg: 4, r: 11, xp: 1, steady: 0 },
  { kind: 'jiangshi', code: 2, hp: 18, speed: 1.45, dmg: 9, r: 17, xp: 2, steady: 0.3 },
  { kind: 'lantern', code: 3, hp: 14, speed: 1.2, dmg: 6, r: 15, xp: 2, steady: 0.1 },
  { kind: 'fox', code: 4, hp: 12, speed: 1.9, dmg: 8, r: 14, xp: 2, steady: 0.1 },
  { kind: 'shishi', code: 5, hp: 320, speed: 1.15, dmg: 15, r: 30, xp: 20, steady: 0.9, elite: true },
  { kind: 'general', code: 6, hp: 520, speed: 1.3, dmg: 16, r: 30, xp: 30, steady: 0.85, elite: true },
  { kind: 'boss', code: 7, hp: 14000, speed: 1.55, dmg: 22, r: 44, xp: 0, steady: 0.97 },
];

export const ENEMY_BY_KIND: Record<EnemyKind, EnemyDef> = Object.fromEntries(ENEMIES.map((e) => [e.kind, e])) as Record<EnemyKind, EnemyDef>;

/** 跳尸一跳的周期（拍）和腾空的那段：腾空时走、落地停一下 */
export const HOP_PERIOD = 26;
export const HOP_AIR = 16;
export const HOP_SPEED_MUL = 1.6;

/** 灯笼鬼：停在这个距离吐火球 */
export const LANTERN = { range: 270, every: 96, speed: 3.2, dmg: 7, life: 160, r: 9 };
/** 狐妖：近了停一下再冲 */
export const FOX = { trigger: 250, windup: 14, dash: 18, dashSpeed: 6.5, rest: 110 };
/** 跳尸将军：隔一阵召一圈小跳尸 */
export const GENERAL = { every: 260, count: 6, ring: 70 };
/** 尸王：三段技能轮流放，血少于一半时更勤 */
export const BOSS = {
  every: 150,
  everyEnraged: 105,
  /** 跳砸：先在地上画圈警告，跳到主角站的地方砸下来 */
  stompWarn: 30,
  stompRadius: 120,
  stompDmg: 26,
  /** 召唤：一圈跳尸 */
  summon: 8,
  /** 尸气：一圈慢速弹 */
  breath: 14,
  breathSpeed: 2.6,
  breathDmg: 10,
};
