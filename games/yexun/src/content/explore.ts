/**
 * 夜探（搜打撤）的内容表（DESIGN.md 2.3、3.5、3.6、3.8、4.2）：地图模板、宝箱、撤离门的时间、夜探刷怪表、守卫的数值、结回倍数。
 * 规则在 `src/explore/`，这里只放数。时间以拍计（每秒 30 拍），距离以单位计（主角半径 14，每拍走 3）。
 */
import type { EnemyDef, EnemyKind } from './enemies.ts';
import type { Minute } from './waves.ts';

const S = 30;
const M = 60 * S;

export type RaidTemplateId = 'guzhen' | 'dukou' | 'shansi' | 'teach';

/** 块坐标（街道之间的第几块，从左上 0 起） */
export type BlockXY = readonly [number, number];

/**
 * 地图模板。骨架按格子生成：`streets` 是街所在的格子行列号（含两边的环街），街和街之间的格子并成一块"院"；
 * 院墙往街上让 `streetPad`（街的净宽 = cell − 2 × streetPad）。种子决定每块院的样子（院、空场、破院）、门开在哪边，
 * 以及宝箱、守卫、出生点。
 */
export interface RaidTemplate {
  id: RaidTemplateId;
  name: string;
  blurb: string;
  /** 场地边长（正方形） */
  size: number;
  cell: number;
  streets: readonly number[];
  streetPad: number;
  /** 街边木箱几个 */
  wood: number;
  /** 一块普通院放铜箱的概率；铜箱带精英守着的概率 */
  copperChance: number;
  copperGuardChance: number;
  /** 铜箱守卫从这几种精英里挑（守夜的精英，行为按守卫的规矩：守着、追远了回去） */
  copperGuards: readonly EnemyKind[];
  /** 空场（摆摊的场子，没墙）、破院（墙上多几个口子）的概率 */
  plazaChance: number;
  ruinChance: number;
  /** 庙：金箱 + 巡夜将 */
  temples: readonly BlockXY[];
  templeGuard: boolean;
  /** 最值钱的院子：镇门石兽守着，两个金箱；只开一个门 */
  vault: BlockXY | null;
  /** 渡口：这一行块整行换成河（含两边的环街），只在 `bridges` 条竖街上留桥 */
  river?: { row: number; bridges: number };
  /** 山寺：这几行横街上砌一道台阶墙（整行），只在 `gaps` 条竖街上留窄口 */
  terraces?: { rows: readonly number[]; gaps: number; gapWidth: number };
  /** 四座镇门（北东南西），按场地边长的比例给位置 */
  gates: readonly { name: string; fx: number; fy: number }[];
  /** 夜里游荡的巡夜将：第几拍从离主角远的路口出来 */
  roamers: readonly number[];
}

const FOUR_GATES = [
  { name: '北门', fx: 0.5, fy: 0.03125 },
  { name: '东门', fx: 0.96875, fy: 0.5 },
  { name: '南门', fx: 0.5, fy: 0.96875 },
  { name: '西门', fx: 0.03125, fy: 0.5 },
] as const;

export const RAID_TEMPLATES: Record<RaidTemplateId, RaidTemplate> = {
  guzhen: {
    id: 'guzhen',
    name: '古镇',
    blurb: '横平竖直的街巷，院连着院；镇中心的大院有石兽守着',
    size: 6400,
    cell: 400,
    streets: [0, 3, 6, 9, 12, 15],
    streetPad: 90,
    wood: 18,
    copperChance: 0.5,
    copperGuardChance: 0.3,
    copperGuards: ['shishi', 'whitefox'],
    plazaChance: 0.15,
    ruinChance: 0.15,
    temples: [[1, 1], [3, 3], [3, 1]],
    templeGuard: true,
    vault: [2, 2],
    gates: FOUR_GATES,
    roamers: [6 * M, 11 * M],
  },
  dukou: {
    id: 'dukou',
    name: '渡口',
    blurb: '一条河把镇子切成两半，只有三座桥',
    size: 6400,
    cell: 400,
    streets: [0, 3, 6, 9, 12, 15],
    streetPad: 90,
    wood: 18,
    copperChance: 0.5,
    copperGuardChance: 0.3,
    copperGuards: ['shishi', 'whitefox'],
    plazaChance: 0.2,
    ruinChance: 0.1,
    temples: [[1, 1], [3, 3]],
    templeGuard: true,
    vault: [3, 1],
    river: { row: 2, bridges: 3 },
    // 东西两门挪到岸上（正中是河）：东门在北岸、西门在南岸，两岸各两座门；离门最远的东北、西南两角各分到一座
    gates: [
      { name: '北门', fx: 0.5, fy: 0.03125 },
      { name: '东门', fx: 0.96875, fy: 0.3125 },
      { name: '南门', fx: 0.5, fy: 0.96875 },
      { name: '西门', fx: 0.03125, fy: 0.6875 },
    ],
    roamers: [6 * M, 11 * M],
  },
  shansi: {
    id: 'shansi',
    name: '山寺',
    blurb: '一层层台阶往上走，只有几个窄口；山门里是寺',
    size: 6400,
    cell: 400,
    streets: [0, 3, 6, 9, 12, 15],
    streetPad: 120,
    wood: 18,
    copperChance: 0.45,
    copperGuardChance: 0.35,
    copperGuards: ['shishi', 'general'],
    plazaChance: 0.1,
    ruinChance: 0.25,
    temples: [[1, 1], [3, 1], [2, 2]],
    templeGuard: true,
    vault: [2, 0],
    terraces: { rows: [6, 12], gaps: 3, gapWidth: 110 },
    gates: FOUR_GATES,
    roamers: [6 * M, 11 * M],
  },
  teach: {
    id: 'teach',
    name: '教学镇',
    blurb: '第一次夜探：小镇子，第 3 分钟就开门，死了也不丢包',
    size: 2800,
    cell: 400,
    streets: [0, 3, 6],
    streetPad: 90,
    wood: 6,
    copperChance: 1,
    copperGuardChance: 0,
    copperGuards: [],
    plazaChance: 0,
    ruinChance: 0,
    temples: [[1, 1]],
    templeGuard: false,
    vault: null,
    gates: FOUR_GATES,
    roamers: [],
  },
};

/** 墙厚；院门宽；院里正房的进深 */
export const RAID_WALL = { thick: 26, door: 140, houseDepth: 110 };

/** 宝箱三档（DESIGN.md 2.3） */
export type ChestTier = 'wood' | 'copper' | 'gold';
export const CHEST_TIERS: readonly ChestTier[] = ['wood', 'copper', 'gold'];

/**
 * 宝箱：几件宝物、每档的权重（凡 / 良 / 珍 / 绝）、深处（离镇中心近）往高档挪多少；铜箱、金箱另给一次守夜的升级宝箱（法器、被动、进化）。
 * deep：深度 0（镇边）到 1（镇中心）之间，按 deep × 深度 把"凡"的权重挪给后三档（按后三档原来的比例）。
 */
export const CHEST: Record<ChestTier, { items: number; weights: readonly [number, number, number, number]; deep: number; upgrade: boolean }> = {
  wood: { items: 1, weights: [0.75, 0.21, 0.035, 0.005], deep: 0.25, upgrade: false },
  copper: { items: 2, weights: [0.42, 0.4, 0.15, 0.03], deep: 0.3, upgrade: true },
  gold: { items: 3, weights: [0.15, 0.4, 0.33, 0.12], deep: 0.3, upgrade: true },
};

/** 开箱：站在 range 以内 hold 拍（1.5 秒）；走出去就从头来（挨打不打断，但会被推开） */
export const CHEST_OPEN = { range: 70, hold: 45 };

/** 宝箱之间至少隔多远、离出生点至少多远 */
export const CHEST_SPACING = { wood: 520, spawn: 700 };

/**
 * 撤离门（DESIGN.md 2.3）：三个时段。one = 随机开一座（第二段换一座没开过的），all = 四门全开。
 * 危险 0 和教学镇第一段从 3:00 开到 6:00（13.3：第 3 分钟开第一座门）。
 */
export const GATE_WINDOWS: readonly { from: number; to: number; all: boolean }[] = [
  { from: 5 * M, to: 6 * M, all: false },
  { from: 10 * M, to: 11 * M, all: false },
  { from: 14 * M, to: 15 * M, all: true },
];
export const GATE_WINDOWS_EARLY: readonly { from: number; to: number; all: boolean }[] = [
  { from: 3 * M, to: 6 * M, all: false },
  { from: 10 * M, to: 11 * M, all: false },
  { from: 14 * M, to: 15 * M, all: true },
];

/** 门圈半径；在圈里站 hold 拍（3 秒）撤出，挨打不打断，出圈从头来 */
export const GATE = { r: 110, hold: 90 };

/** 天亮（迷失）：15:00；14:00 起顶上换成天亮倒计时，最后 30 秒变红 */
export const RAID_DAWN = 15 * M;
export const DAWN_WARN = 14 * M;
export const DAWN_RED = 15 * M - 30 * S;

/** 出生点：四个角里种子挑一个（离镇子中心最远，深处要自己走进去） */
export const SPAWN_INSET = 200;

/**
 * 离镇中心越近怪越凶（DESIGN.md 2.3）：深度 d（0 镇边，1 镇中心）时血 × (1 + hp × d)、伤害 × (1 + dmg × d)、刷怪量 × (1 + count × d)。
 */
export const RAID_ZONE = { hp: 0.8, dmg: 0.4, count: 0.5 };

/**
 * 夜探的刷怪表（每分钟一档，形状同守夜 `waves.ts` 的 MINUTES）：场地大、有墙，场上保持的数量比守夜少；
 * 远程怪同样压在 8% 以下。没有定点的围圈、群冲和 Boss：压力来自守卫和时间。
 */
export const RAID_MINUTES: readonly Minute[] = [
  { keep: 14, rate: 2, mix: { paper: 0.8, wisp: 0.2 } },
  { keep: 22, rate: 3, mix: { paper: 0.55, wisp: 0.25, bat: 0.2 } },
  { keep: 32, rate: 3.5, mix: { paper: 0.4, wisp: 0.25, bat: 0.2, jiangshi: 0.15 } },
  { keep: 42, rate: 4, mix: { paper: 0.25, jiangshi: 0.4, horse: 0.15, bat: 0.2 } },
  { keep: 52, rate: 4.5, mix: { paper: 0.2, jiangshi: 0.4, weasel: 0.15, bone: 0.25 } },
  { keep: 60, rate: 5, mix: { jiangshi: 0.4, lantern: 0.08, bone: 0.3, weasel: 0.12, bat: 0.1 } },
  { keep: 68, rate: 5.5, mix: { jiangshi: 0.35, fox: 0.2, bone: 0.25, water: 0.12, lantern: 0.08 } },
  { keep: 78, rate: 6, mix: { jiangshi: 0.3, fox: 0.25, scarecrow: 0.15, water: 0.15, bone: 0.15 } },
  { keep: 88, rate: 6.5, mix: { jiangshi: 0.3, fox: 0.25, scarecrow: 0.15, weasel: 0.12, snow: 0.06, bone: 0.12 } },
  { keep: 98, rate: 7, mix: { jiangshi: 0.3, fox: 0.25, water: 0.15, bone: 0.2, snow: 0.07, lantern: 0.03 } },
  { keep: 108, rate: 7.5, mix: { jiangshi: 0.3, fox: 0.25, scarecrow: 0.15, bone: 0.2, snow: 0.07, weasel: 0.03 } },
  { keep: 118, rate: 8, mix: { jiangshi: 0.35, fox: 0.2, water: 0.1, bone: 0.2, snow: 0.07, horse: 0.08 } },
  { keep: 130, rate: 9, mix: { jiangshi: 0.35, fox: 0.2, scarecrow: 0.1, bone: 0.2, snow: 0.07, bat: 0.08 } },
  { keep: 145, rate: 10, mix: { jiangshi: 0.35, fox: 0.2, bone: 0.2, horse: 0.1, snow: 0.07, lantern: 0.08 } },
  { keep: 160, rate: 11, mix: { paper: 0.15, jiangshi: 0.4, fox: 0.2, bone: 0.25 } },
];

/**
 * 夜探的两种新怪（DESIGN.md 3.5）。字段同 `enemies.ts` 的 EnemyDef（kind、code 由核心接进 ENEMIES 时给，建议 18、19）。
 * 巡夜将：守金箱、会追人，比主角慢一点（追得上停下来的人，追不上一直跑的）；黑甲，刀剑砍着费劲。
 * 镇门石兽：守最值钱的院子，青石身子，刀剑、土都不太吃；怕水（冲刷）和镇（镇物压得住）。
 */
export type RaidEnemyKind = 'patrol' | 'beast';
export const RAID_ENEMIES: Record<RaidEnemyKind, Omit<EnemyDef, 'kind' | 'code'>> = {
  patrol: { hp: 900, speed: 2.5, dmg: 14, r: 26, xp: 30, steady: 0.9, elite: true, vs: { 剑: 0.7, 火: 1.25 } },
  beast: { hp: 9000, speed: 1.4, dmg: 20, r: 46, xp: 80, steady: 0.97, boss: true, vs: { 剑: 0.6, 土: 0.7, 水: 1.4, 镇: 1.3 } },
};

/**
 * 守卫的规矩（`src/explore/guards.ts`）：
 * - aggro：主角走到守的地方这么近（或离守卫本身 aggro × 0.6 以内）就追；
 * - leash：追出离家这么远就回去（回去的路上主角再进 aggro 又追）；
 * - homeSpeed：回家时的速度倍数。
 * 游荡的巡夜将没有家：看见（aggro 以内）就追，主角跑出 leash 就放弃，接着沿街走。
 */
export const GUARD = {
  copper: { aggro: 260, leash: 620, homeSpeed: 1.1 },
  patrol: { aggro: 340, leash: 900, homeSpeed: 1.1 },
  roamer: { aggro: 380, leash: 820 },
  beast: { aggro: 420, leash: 760, homeSpeed: 1.2 },
};

/**
 * 镇门石兽（DESIGN.md 3.5：扑击、甩尾扫一圈）。血少于一半进二段：技能更勤、扫的圈更大、扑击连扑两下。
 * pounce：先在落点画圈警告 warn 拍，再用 fly 拍扑过去，落地 radius 以内挨 dmg；
 * sweep：原地蓄力 warn 拍（画圈），然后一圈 radius 以内挨 dmg。
 */
export const BEAST = {
  every: [100, 70],
  phaseAt: 0.5,
  pounce: { warn: 24, fly: 14, radius: 95, dmg: 26, range: 520 },
  sweep: { warn: 20, radius: 165, dmg: 20, ragedRadius: 210 },
  /** 二段：扑完马上再扑一次 */
  ragedChain: 2,
};

/** 巡夜将游荡时的速度倍数（不追人时慢慢走） */
export const ROAM_SPEED = 0.6;

/**
 * 实盘结回（DESIGN.md 4.2）：倍数 = clamp(带出的宝物价值 ÷ 基准价值, 0, 封顶)，死亡或迷失为 0；结回 = 带入 × 倍数 向下取整，按万分之一传。
 * 基准价值目前按下面的"估算节奏"定（10 分钟撤约 1.3 倍）；第 7 步用机器人模拟的真实数换掉。
 * 封顶先和守夜打倒尸王一样是 3（4.1：夜探要不要放宽到 5 份，等模拟数出来报主线定）。
 * 档位 → 危险：小 0、中 2、大 3、豪华 4（4.1；夜探豪华档先不开）。
 */
export const RAID_LIVE = {
  cap: 3,
  base: { small: 221, mid: 221, large: 221 } as Record<RaidLiveTier, number>,
  danger: { small: 0, mid: 2, large: 3 } as Record<RaidLiveTier, number>,
};
export type RaidLiveTier = 'small' | 'mid' | 'large';

/**
 * 估算节奏（模拟器出数前用来定基准价值）：普通玩家撤出时大约开了几个箱子，箱子在什么深度。
 * 4.2 的形状：5 分钟早撤约 0.5、10 分钟约 1.3、15 分钟约 2。
 */
export const RAID_PACE_MODEL: readonly { minute: number; target: number; chests: Partial<Record<ChestTier, number>>; depth: number }[] = [
  { minute: 5, target: 0.5, chests: { wood: 5, copper: 2 }, depth: 0.2 },
  { minute: 10, target: 1.3, chests: { wood: 8, copper: 4, gold: 1 }, depth: 0.45 },
  { minute: 15, target: 2, chests: { wood: 10, copper: 5, gold: 2 }, depth: 0.55 },
];

/** 娱乐：撤出时背包按价值换铜钱（1 价值 = 1 铜钱）；死了或迷失拿这局捡到的铜钱的一半 */
export const RAID_EXCHANGE = { rate: 1, deathCoinShare: 0.5 };

/** 藏宝阁：带出过多少件不同的宝物解锁采药女（DESIGN.md 3.7） */
export const VAULT_UNLOCK = { herbalist: 20 };
