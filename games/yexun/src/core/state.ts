/**
 * 一局的全部状态（DESIGN.md 5.1）：怪、子弹、掉落物用定长的并列数组，空位用空闲表复用，热路径不分配对象。
 * `step` 原地修改这里的东西（主线批准的例外，见模块 AGENTS.md 第 3 节）。
 */
import { ENEMIES } from '../content/enemies.ts';
import type { Danger, WaveEvent } from '../content/waves.ts';
import { CHARACTERS, CURSE_IDS, MAX_CURSES, PERK_FX, PERKS, type CharacterId, type CurseId, type PerkId } from '../content/meta.ts';
import { MAPS, type Block, type MapId, type Rect } from '../content/maps.ts';
import { MAX_WEAPONS, MERGES, type MergeDef, type PassiveId, type WeaponId, type WeaponStats } from '../content/weapons.ts';
import { ARENA, PLAYER } from '../content/player.ts';
import { Events } from './events.ts';
import { Rng } from './rng.ts';
import { Raid } from '../explore/raid.ts';
import type { RaidSetup } from '../explore/host.ts';
import { BlockIndex, type RaidBlock } from '../explore/blocks.ts';

export const RULES_VERSION = 15;
export const TICKS_PER_SECOND = 30;

export const MAX_ENEMIES = 300;
/** 法器格最多几个：6 个，每合成一次空出一个（合成以后两件都还在出手） */
export const WEAPON_SLOTS = MAX_WEAPONS + MERGES.length;
export const MAX_SHOTS = 400;
export const MAX_DROPS = 400;
/** 场上可碰碎的摆设（灯笼架、纸扎）最多几个 */
export const MAX_PROPS = 48;

/** 子弹种类 */
export const Shot = {
  Talisman: 1,
  Coin: 2,
  Fly: 3,
  /** 敌人的：灯笼鬼的火球、尸王的尸气；sState 1 = 雪魅的冰锥（打中走路变慢），2 = 纸扎老爷的纸钱（旋着飞，sIdx 是第几圈） */
  Fireball: 4,
  /** 八卦镜的光波：sR 是当前半径（开始是负的 = 还没放出来），sDist 是推到多远 */
  Wave: 5,
  /** 桃花雨的一片花瓣：sLife 拍后落地 */
  Petal: 6,
  /** 纸鹤：sState 0 盘旋 1 俯冲（sLife 是还要飞几拍）2 飞回 */
  Crane: 7,
  /** 三昧真火留在地上的火：sLife 拍后灭 */
  Burn: 8,
} as const;
export type Shot = (typeof Shot)[keyof typeof Shot];

/** 掉落种类 */
export const Drop = {
  Soul: 1,
  Coin: 2,
  Bun: 3,
  Scroll: 4,
  Chest: 5,
  /** 符咒炸弹：捡到时附近的小怪全倒，精英和 Boss 掉一截血 */
  Bomb: 6,
  /** 铜钱袋：一次给一把铜钱 */
  Purse: 7,
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
  /** 黄历：暴击、宝箱多给、好卡的概率加成（0.1 一级） */
  luck: number;
  /** 灵芝、引魂灯：经验倍数 */
  xpMul: number;
  /** 引魂灯：铜钱多给的概率 */
  coinBonus: number;
  /** 墨斗：持续倍数（火、绳、铜钱、护盾回层） */
  durMul: number;
  /** 引魂灯的级数（怪多、怪快） */
  curse: number;
  /** 捆仙绳：捆住的挨打加倍 */
  bindDouble: boolean;
  /** 剑 2 件：暴击率另加；剑 3 件：暴击伤害另加 */
  critAdd: number;
  critDmg: number;
  /** 镇 3 件：靠近主角的怪减速 */
  nearSlow: boolean;
}

/** 三选一时除了选第几张以外的操作（step 的 choice 参数） */
export const Pick = {
  Reroll: 100,
  /** + 第几张 */
  Ban: 200,
  Skip: 300,
} as const;

export interface Choice {
  kind: 'weapon' | 'passive' | 'coins';
  id: WeaponId | PassiveId | 'coins';
}

export interface Setup {
  seed: number;
  /** 守夜 / 夜探 */
  mode: 'vigil' | 'raid';
  /** 夜探的模板和实盘档（mode 为 raid 时必有；种子和危险档以上面的为准） */
  raid?: Omit<RaidSetup, 'seed' | 'danger'>;
  /** 危险档 0–5（DESIGN.md 13.2） */
  danger: Danger;
  /** 这台设备上的第一局：3 分钟前不会死（DESIGN.md 13.2） */
  firstRun?: boolean;
  /** 地图（缺省雪原） */
  map?: MapId;
  /** 角色（缺省小道士；实盘固定小道士） */
  character?: CharacterId;
  /** 咒印，最多 MAX_CURSES 条（实盘为空） */
  curses?: readonly CurseId[];
  /** 永久加成的等级（实盘为空） */
  perks?: Partial<Record<PerkId, number>>;
  /** 连死以后开的"降低伤害"（成绩不进总榜） */
  assist?: boolean;
  /** 无尽：天亮不收工，一直打到倒下 */
  endless?: boolean;
}

/** 整理开局设置：咒印去重、截到上限，加成等级截到表里的最高级（录像和存档里来的数据不一定干净） */
export function normalizeSetup(s: Setup): Setup {
  const curses = CURSE_IDS.filter((c) => s.curses?.includes(c)).slice(0, MAX_CURSES);
  const perks: Partial<Record<PerkId, number>> = {};
  for (const [id, lv] of Object.entries(s.perks ?? {}) as [PerkId, number][]) {
    if (!(id in PERKS)) continue;
    const n = Math.max(0, Math.min(PERKS[id].cost.length, Math.floor(lv)));
    if (n > 0) perks[id] = n;
  }
  const character = s.character && s.character in CHARACTERS ? s.character : 'xiaodao';
  const danger = (Math.max(0, Math.min(5, Math.floor(s.danger))) || 0) as Danger;
  return { ...s, danger, character, curses, perks };
}

export class World {
  readonly setup: Setup;
  /** 夜探的状态（宝箱、门、背包、守卫）；守夜为 null */
  readonly raid: Raid | null;
  /** 场地大小：守夜 ARENA，夜探按镇子 */
  readonly arenaW: number;
  readonly arenaH: number;
  tick = 0;
  /** play：在打；choose：等升级三选一；over：结束 */
  phase: 'play' | 'choose' | 'over' = 'play';
  won = false;
  bossKilled = false;
  kills = 0;
  coins = 0;
  /** 铜钱从哪来的（结算页列来源用，只记不影响规则）：地上捡的、铜钱袋、摆设、宝箱 */
  readonly coinBy = { drop: 0, purse: 0, prop: 0, chest: 0 };
  /** 开过几个宝箱、一共升了几件；碰碎几个摆设（结算页用） */
  chests = 0;
  chestUps = 0;
  propsBroken = 0;

  // 随机数，按用途分流
  readonly rSpawn: Rng;
  readonly rDrop: Rng;
  readonly rUp: Rng;
  readonly rChest: Rng;
  readonly rAi: Rng;
  readonly rHit: Rng;
  readonly rWeapon: Rng;
  readonly rProp: Rng;

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
  /** 金钟罩：还能挡几下、最多几下；碎了的那一拍记一笔，下一拍出手时震开 */
  shield = 0;
  shieldMax = 0;
  shieldBurst = false;
  /** 凑成的套装（显示用）：比如 剑2、金3 */
  sets: string[] = [];
  /** 刷新、封禁还剩几次；封禁掉的（不再出现在三选一里） */
  rerolls = 2;
  bans = 1;
  banned: (WeaponId | PassiveId)[] = [];
  /** 合成了哪几个（MergeDef.id） */
  merges: MergeDef['id'][] = [];
  /** 往生铃：光环半径（这一拍），光环里的怪死了回血；下次能回血的拍 */
  bellArea = 0;
  /** 挡路的东西（地图上的墙、棺材） */
  /** 挡路的块：守夜是地图的，夜探是镇子生成的（推挤走 raid.map.index，分桶） */
  blocks: readonly (Block | RaidBlock)[];
  /** 地图的全部块（竹子倒了 blocks 里就没有它，这里还在）和每块的血（不会倒的是 Infinity）、上次受伤的拍；没有竹子时 blockHp 为空 */
  readonly allBlocks: readonly Block[];
  readonly blockHp: Float64Array;
  readonly blockAt: Int32Array;
  /** 地形：水区、冰区（夜探没有） */
  /** 块多的守夜图（竹林）也走分桶的索引，竹子倒了重建 */
  index: BlockIndex | null = null;
  readonly water: readonly Rect[];
  readonly ice: readonly Rect[];
  /** 主角在冰上的速度（冰上才用；离开冰面就按输入直接走） */
  pvx = 0;
  pvy = 0;
  /** 怪在冰上的速度 */
  readonly eVX = new Float64Array(MAX_ENEMIES);
  readonly eVY = new Float64Array(MAX_ENEMIES);
  /** 冰锥、水鬼：到这一拍之前主角走路变慢 */
  slowUntil = 0;
  /** 收获期：到这一拍之前少刷怪、多掉东西 */
  calmUntil = 0;
  /** 受伤补偿：下一个补偿肉包最早在这一拍 */
  mercyAt = 0;
  bellHealAt = 0;
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
  /** 最近一次挨打的拍和法器槽（连锁雷找"还没劈过的"） */
  readonly eLastHit = new Int32Array(MAX_ENEMIES);
  readonly eLastBy = new Int8Array(MAX_ENEMIES);
  /** 被缚妖索捆到第几拍（大于当前拍就走不动） */
  readonly eBind = new Int32Array(MAX_ENEMIES);
  /** 符剑合璧：身上的符几拍炸（0 = 没贴）；marks 是现在贴着几张，没有时不用扫 */
  readonly eMark = new Int32Array(MAX_ENEMIES);
  marks = 0;
  /** Boss 打到第几段（0 起） */
  readonly ePhase = new Uint8Array(MAX_ENEMIES);
  /** 在镇魂铃光环里：这一拍减速 */
  readonly eSlow = new Uint8Array(MAX_ENEMIES);
  /** 同一件法器连着打同一只的冷却：[怪 × 法器槽] = 下次能打的拍数 */
  readonly eHitAt = new Int32Array(MAX_ENEMIES * WEAPON_SLOTS);
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

  // 摆设（守夜才有）：走过去碰碎，掉吃的、铜钱、磁符、炸弹
  readonly pAlive = new Uint8Array(MAX_PROPS);
  readonly pGen = new Uint32Array(MAX_PROPS);
  readonly pKind = new Uint8Array(MAX_PROPS);
  readonly pX = new Float64Array(MAX_PROPS);
  readonly pY = new Float64Array(MAX_PROPS);
  /** 下次在主角附近补摆设的拍数 */
  propAt = 0;

  // 刷怪
  spawnAcc = 0;
  /** 这一局的定点事件（按危险档、咒印排好；createWorld 填） */
  schedule: WaveEvent[] = [];
  nextEvent = 0;
  bossSlot = -1;

  readonly ev = new Events();

  /** 复活还剩几次（永久加成"复活"） */
  revives = 0;
  /** 升级时给几张卡（永久加成"多一张"：4） */
  cardCount = 3;
  /** 胖师叔：这一拍挨了打，下一拍震开身边 */
  quake = false;

  constructor(raw: Setup) {
    const setup = normalizeSetup(raw);
    this.setup = setup;
    const perk = (id: PerkId): number => setup.perks?.[id] ?? 0;
    this.rerolls = setup.curses?.includes('noreroll') ? 0 : 2 + perk('shuaxin') * PERK_FX.shuaxin;
    this.revives = perk('fuhuo') * PERK_FX.fuhuo;
    this.cardCount = 3 + perk('kapian') * PERK_FX.kapian;
    this.raid = setup.mode === 'raid' && setup.raid ? new Raid({ ...setup.raid, seed: setup.seed, danger: setup.danger }) : null;
    this.arenaW = this.raid ? this.raid.map.size : ARENA.w;
    this.arenaH = this.raid ? this.raid.map.size : ARENA.h;
    const def = MAPS[setup.map ?? 'snow'];
    this.blocks = this.raid ? this.raid.map.blocks : def.blocks;
    this.allBlocks = this.raid ? [] : def.blocks;
    const dyn = !this.raid && def.blocks.some((b) => b.hp !== undefined);
    this.blockHp = new Float64Array(dyn ? def.blocks.length : 0);
    this.blockAt = new Int32Array(dyn ? def.blocks.length : 0);
    if (dyn) def.blocks.forEach((b, k) => (this.blockHp[k] = b.hp ?? Infinity));
    if (!this.raid && def.blocks.length > 40) this.index = new BlockIndex(def.blocks as readonly RaidBlock[], ARENA.w);
    this.water = this.raid ? [] : def.water ?? [];
    this.ice = this.raid ? [] : def.ice ?? [];
    if (this.raid) {
      this.x = this.px = this.raid.map.spawn.x;
      this.y = this.py = this.raid.map.spawn.y;
    }
    const s = setup.seed;
    this.rSpawn = new Rng(s, 'spawn');
    this.rDrop = new Rng(s, 'drop');
    this.rUp = new Rng(s, 'upgrade');
    this.rChest = new Rng(s, 'chest');
    this.rAi = new Rng(s, 'ai');
    this.rHit = new Rng(s, 'hit');
    this.rWeapon = new Rng(s, 'weapon');
    this.rProp = new Rng(s, 'prop');
    this.stats = baseStats();
  }
}

export function baseStats(): Stats {
  return { might: 1, cdMul: 1, areaMul: 1, amount: 0, speed: PLAYER.speed, magnet: PLAYER.magnet, armor: 0, hpMax: PLAYER.hp, regen: 0, luck: 0, xpMul: 1, coinBonus: 0, durMul: 1, curse: 0, bindDouble: false, critAdd: 0, critDmg: 0, nearSlow: false };
}

/** 怪种类编号 → 定义 */
export function enemyDef(code: number): (typeof ENEMIES)[number] {
  return ENEMIES[code]!;
}
