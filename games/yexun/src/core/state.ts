/**
 * 一局的全部状态（DESIGN.md 5.1）：怪、子弹、掉落物用定长的并列数组，空位用空闲表复用，热路径不分配对象。
 * `step` 原地修改这里的东西（主线批准的例外，见模块 AGENTS.md 第 3 节）。
 */
import { ENEMIES } from '../content/enemies.ts';
import type { Difficulty } from '../content/waves.ts';
import { MAX_WEAPONS, type PassiveId, type WeaponId, type WeaponStats } from '../content/weapons.ts';
import { ARENA, PLAYER } from '../content/player.ts';
import { Events } from './events.ts';
import { Rng } from './rng.ts';

export const RULES_VERSION = 2;
export const TICKS_PER_SECOND = 30;

export const MAX_ENEMIES = 300;
export const MAX_SHOTS = 400;
export const MAX_DROPS = 400;

/** 子弹种类 */
export const Shot = {
  Talisman: 1,
  Coin: 2,
  Fly: 3,
  /** 敌人的：灯笼鬼的火球、尸王的尸气 */
  Fireball: 4,
} as const;
export type Shot = (typeof Shot)[keyof typeof Shot];

/** 掉落种类 */
export const Drop = {
  Soul: 1,
  Coin: 2,
  Bun: 3,
  Scroll: 4,
  Chest: 5,
} as const;
export type Drop = (typeof Drop)[keyof typeof Drop];

/** 一件拿在手上的法器 */
export interface OwnedWeapon {
  id: WeaponId;
  level: number;
  evolved: boolean;
  /** 离下次出手还有几拍 */
  timer: number;
  /** 这一局打出的伤害和击杀（结算页用） */
  dmg: number;
  kills: number;
  /** 铜钱：这一轮还转几拍；飞剑：轮到第几把出手 */
  phase: number;
  /** 铜钱：绕身的角度（方向表下标） */
  angle: number;
}

/** 汇总后的主角加成（被动改变时重算） */
export interface Stats {
  might: number;
  cdMul: number;
  areaMul: number;
  amount: number;
  speed: number;
  magnet: number;
  armor: number;
  hpMax: number;
  regen: number;
}

export interface Choice {
  kind: 'weapon' | 'passive' | 'coins';
  id: WeaponId | PassiveId | 'coins';
}

export interface Setup {
  seed: number;
  mode: 'vigil';
  difficulty: Difficulty;
}

export class World {
  readonly setup: Setup;
  tick = 0;
  /** play：在打；choose：等升级三选一；over：结束 */
  phase: 'play' | 'choose' | 'over' = 'play';
  won = false;
  bossKilled = false;
  kills = 0;
  coins = 0;

  // 随机数，按用途分流
  readonly rSpawn: Rng;
  readonly rDrop: Rng;
  readonly rUp: Rng;
  readonly rChest: Rng;
  readonly rAi: Rng;
  readonly rHit: Rng;
  readonly rWeapon: Rng;

  // 主角
  x = ARENA.w / 2;
  y = ARENA.h / 2;
  px = this.x;
  py = this.y;
  hp = PLAYER.hp;
  /** 面朝方向（方向表下标），一开始朝右 */
  face = 0;
  moving = false;
  invuln = 0;
  level = 1;
  xp = 0;
  /** 攒着还没选的升级次数 */
  pendingLevels = 0;
  choices: Choice[] = [];
  weapons: OwnedWeapon[] = [];
  /** 每件法器算上被动以后的数值（和 weapons 同下标；法器或被动变了就重算） */
  wstats: WeaponStats[] = [];
  passives: Partial<Record<PassiveId, number>> = {};
  stats: Stats;
  /** 回血的零头（每拍加一点，满 1 才加到血上，免得血量出现很长的小数） */
  regenAcc = 0;

  // 怪
  readonly eAlive = new Uint8Array(MAX_ENEMIES);
  readonly eGen = new Uint32Array(MAX_ENEMIES);
  readonly eKind = new Uint8Array(MAX_ENEMIES);
  readonly eX = new Float64Array(MAX_ENEMIES);
  readonly eY = new Float64Array(MAX_ENEMIES);
  readonly ePX = new Float64Array(MAX_ENEMIES);
  readonly ePY = new Float64Array(MAX_ENEMIES);
  /** 击退速度（每拍衰减） */
  readonly eKX = new Float64Array(MAX_ENEMIES);
  readonly eKY = new Float64Array(MAX_ENEMIES);
  readonly eHp = new Float64Array(MAX_ENEMIES);
  readonly eHpMax = new Float64Array(MAX_ENEMIES);
  readonly eSpeed = new Float64Array(MAX_ENEMIES);
  readonly eDmg = new Float64Array(MAX_ENEMIES);
  readonly eR = new Float64Array(MAX_ENEMIES);
  /** 个体的大小差别（0.9–1.1，画面按它缩放，碰撞半径也乘它） */
  readonly eSize = new Float64Array(MAX_ENEMIES);
  /** 行为计时（跳尸的跳、灯笼的火球、狐妖的冲刺、将军的召唤、尸王的技能） */
  readonly eT = new Int32Array(MAX_ENEMIES);
  /** 行为状态 */
  readonly eS = new Int32Array(MAX_ENEMIES);
  /** 行为参数（狐妖冲刺方向、尸王落点） */
  readonly eAX = new Float64Array(MAX_ENEMIES);
  readonly eAY = new Float64Array(MAX_ENEMIES);
  /** 行为里的速度（尸王跳砸这一跳每拍走多远） */
  readonly eV = new Float64Array(MAX_ENEMIES);
  /** 在镇魂铃光环里：这一拍减速 */
  readonly eSlow = new Uint8Array(MAX_ENEMIES);
  /** 同一件法器连着打同一只的冷却：[怪 × 法器槽] = 下次能打的拍数 */
  readonly eHitAt = new Int32Array(MAX_ENEMIES * MAX_WEAPONS);
  eCount = 0;

  // 子弹
  readonly sAlive = new Uint8Array(MAX_SHOTS);
  readonly sGen = new Uint32Array(MAX_SHOTS);
  readonly sKind = new Uint8Array(MAX_SHOTS);
  readonly sX = new Float64Array(MAX_SHOTS);
  readonly sY = new Float64Array(MAX_SHOTS);
  readonly sPX = new Float64Array(MAX_SHOTS);
  readonly sPY = new Float64Array(MAX_SHOTS);
  readonly sVX = new Float64Array(MAX_SHOTS);
  readonly sVY = new Float64Array(MAX_SHOTS);
  readonly sLife = new Int32Array(MAX_SHOTS);
  readonly sDmg = new Float64Array(MAX_SHOTS);
  readonly sR = new Float64Array(MAX_SHOTS);
  /** 还能穿几只（符咒）；飞剑的状态（0 待命 1 飞出 2 飞回） */
  readonly sState = new Int32Array(MAX_SHOTS);
  /** 属于哪个法器槽；飞剑、铜钱是第几把 */
  readonly sSlot = new Int8Array(MAX_SHOTS);
  readonly sIdx = new Int16Array(MAX_SHOTS);
  /** 飞了多远（飞剑） */
  readonly sDist = new Float64Array(MAX_SHOTS);
  sCount = 0;

  // 掉落物
  readonly dAlive = new Uint8Array(MAX_DROPS);
  readonly dGen = new Uint32Array(MAX_DROPS);
  readonly dKind = new Uint8Array(MAX_DROPS);
  readonly dX = new Float64Array(MAX_DROPS);
  readonly dY = new Float64Array(MAX_DROPS);
  readonly dPX = new Float64Array(MAX_DROPS);
  readonly dPY = new Float64Array(MAX_DROPS);
  readonly dVal = new Float64Array(MAX_DROPS);
  /** 被吸着走：速度 */
  readonly dPull = new Float64Array(MAX_DROPS);
  dCount = 0;
  /** 地上的魂珠数（超过上限就合并） */
  soulCount = 0;

  // 刷怪
  spawnAcc = 0;
  nextEvent = 0;
  bossSlot = -1;

  readonly ev = new Events();

  constructor(setup: Setup) {
    this.setup = setup;
    const s = setup.seed;
    this.rSpawn = new Rng(s, 'spawn');
    this.rDrop = new Rng(s, 'drop');
    this.rUp = new Rng(s, 'upgrade');
    this.rChest = new Rng(s, 'chest');
    this.rAi = new Rng(s, 'ai');
    this.rHit = new Rng(s, 'hit');
    this.rWeapon = new Rng(s, 'weapon');
    this.stats = baseStats();
  }
}

export function baseStats(): Stats {
  return { might: 1, cdMul: 1, areaMul: 1, amount: 0, speed: PLAYER.speed, magnet: PLAYER.magnet, armor: 0, hpMax: PLAYER.hp, regen: 0 };
}

/** 怪种类编号 → 定义 */
export function enemyDef(code: number): (typeof ENEMIES)[number] {
  return ENEMIES[code]!;
}
