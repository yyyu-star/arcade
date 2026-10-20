/**
 * 实盘（DESIGN.md 第 4 节）：档位、开局配置、结回倍数。Worker 只从这里取档位表和 liveReturn，不引规则核心（整个核心会被打进 Worker）。
 * 倍数曲线第 7 步按模拟器每格 2,000 局配到 balance.md 第 2 节的区间：形状四档共用，天亮倍数每档一个（DESIGN.md 4.2）。
 */
import type { MapId } from './maps.ts';
import type { CharacterId } from './meta.ts';
import type { Danger } from './waves.ts';

/**
 * 实盘开没开（守夜）。第 7 步按模拟器每格 2,000 局把四档的天亮倍数配进 balance.md 的区间后打开（2026-10-17）。
 * 关掉时菜单不显示实盘，Worker 拒绝带入（直接调接口也带不进去）；结回、退回照常，免得万一有挂着的一份结不掉。
 * 夜探实盘另做（基准价值要先模拟），菜单上先写"很快开放"。
 */
export const LIVE_OPEN = true;

/**
 * 实盘暂不开放的守夜图：新图要先按 LIVE_MAP_BP 同一套方法拟合系数、偏离同档平均 ±0.15 份以内才开（DESIGN 8.1，主线 10-20）。
 * 菜单上这几张图在实盘里灰着；直接调带入也会退回雪原（main.ts startLive）。
 */
export const LIVE_MAP_CLOSED: readonly MapId[] = ['temple'];
export const liveMapOk = (m: MapId): boolean => !LIVE_MAP_CLOSED.includes(m);

export type LiveTier = 'small' | 'medium' | 'large' | 'luxe';
export const LIVE_TIER_IDS: readonly LiveTier[] = ['small', 'medium', 'large', 'luxe'];

/** 平台钱包的档位名（docs/economy.md：small / mid / big / lux）。夜巡自己叫 medium / large / luxe，带入时要换成钱包的名字，
 *  不换钱包回 bad_request（0.3.8 修：0.3.0 起中、大、豪华档一直带不进去，只有小档两边同名） */
export type WalletTier = 'small' | 'mid' | 'big' | 'lux';

export interface LiveTierDef {
  id: LiveTier;
  wallet: WalletTier;
  name: string;
  /** 一份多少筹码（docs/economy.md 第 2 节） */
  stake: number;
  /** 固定映射的危险档（4.1）：只维护一套怪表 */
  danger: Danger;
  /** 撑到天亮结回几倍（万分比）；中途倒下按 VIGIL_SHAPE 折算，打倒尸王再加 VIGIL_BOSS_ADD_BP。第 7 步用 .local 的 fit.mjs 从模拟器结局拟合 */
  dawnBp: number;
}

export const LIVE_TIERS: Record<LiveTier, LiveTierDef> = {
  small: { id: 'small', wallet: 'small', name: '小', stake: 2_000, danger: 0, dawnBp: 12_700 },
  medium: { id: 'medium', wallet: 'mid', name: '中', stake: 10_000, danger: 2, dawnBp: 16_000 },
  large: { id: 'large', wallet: 'big', name: '大', stake: 50_000, danger: 3, dawnBp: 16_000 },
  luxe: { id: 'luxe', wallet: 'lux', name: '豪华', stake: 200_000, danger: 4, dawnBp: 16_000 },
};

export function isLiveTier(v: unknown): v is LiveTier {
  return typeof v === 'string' && (LIVE_TIER_IDS as readonly string[]).includes(v);
}

/** 一场最多赢 3 份（结回 ≤ 带入 × 3，economy.md 第 2 节）；倍数按万分之一传 */
export const LIVE_MAX_BP = 30_000;

/**
 * 守夜的结回倍数（4.2）：中途倒下按撑到的秒数逐拍插值，点是 [秒, 占天亮倍数的万分比]；3:00 以前为 0。
 * 曲线从 3:00 起平滑上升，没有"4 分 01 秒才有钱"的断崖。四档形状相同，只按 dawnBp 缩放：配平时每档只调一个数。
 * 第 12 轮全量（每格 2,000 局）拟合：中途回得少、天亮给得多，小白（早死）和普通（多半撑到天亮）才拉得开，
 * 原来的形状（10 分钟回 55%）下四档小白都压不进 balance.md 的区间。
 */
export const VIGIL_SHAPE: readonly (readonly [number, number])[] = [
  [180, 0],
  [300, 560],
  [600, 2_200],
  [840, 2_880],
  [900, 10_000],
];
/** 打倒尸王比撑到天亮多结回多少（万分比），总数不超过 LIVE_MAX_BP */
export const VIGIL_BOSS_ADD_BP = 2_000;

/**
 * 实盘可以选已解锁的角色和地图（0.3.6，DESIGN.md 4.1、4.2）。各角色、各地图的实盘期望若比同档最高、最低差出 0.15 份以上，
 * 就在这里给一个单独的系数（万分比，乘在这一档的 dawnBp 上，没写 = 10_000 = 不调）；不改角色、地图本身的数值，不改对局规则。
 * 难度随档位涨得快的角色、地图（比如义庄）在各档需要的补偿不一样，所以系数按档写。
 * 角色和地图分开扫、各自对着小道士、雪原拟合，两个系数默认相乘；乘出来偏离同档平均 ±0.15 份以上的组合（胖师叔、采药女在义庄等，
 * 角色和地图的强弱不是各管各的）单独写在 LIVE_COMBO_BP，整套系数直接替换乘积。夜探的角色系数在 explore.ts 的 RAID_LIVE.charBp。
 */
export type LiveCoef<K extends string> = Partial<Record<K, Partial<Record<LiveTier, number>>>>;
export const LIVE_CHAR_BP: LiveCoef<CharacterId> = {
  fushi: { medium: 10_900, large: 11_500, luxe: 10_900 },
  jianxia: { medium: 11_200, large: 12_100, luxe: 11_100 },
  pang: { medium: 9_100, large: 9_200, luxe: 8_000 },
  caiyao: { medium: 10_600, large: 11_200 },
  gengfu: { large: 10_900, luxe: 10_800 },
};
export const LIVE_MAP_BP: LiveCoef<MapId> = {
  yizhuang: { small: 10_800, medium: 14_200, large: 15_400, luxe: 23_700 },
  bamboo: { medium: 8_900, large: 9_000, luxe: 8_900 },
  icelake: { medium: 11_100, large: 12_400, luxe: 12_900 },
  riverbank: { luxe: 10_800 },
};

/**
 * 组合系数（0.3.7）：「角色 × 地图 × 档」整套系数（万分比），写了就替换 LIVE_CHAR_BP × LIVE_MAP_BP 的乘积。
 * 只给乘积偏出同档平均 0.15 份以上的格子（新种子模拟，每格 2,000–6,000 局拟合，见 CHANGELOG 0.3.7）；没写的组合仍按乘积。
 */
export const LIVE_COMBO_BP: Partial<Record<CharacterId, Partial<Record<MapId, Partial<Record<LiveTier, number>>>>>> = {
  pang: { yizhuang: { medium: 10_000, large: 10_100, luxe: 10_000 }, riverbank: { luxe: 7_200 } },
  caiyao: { yizhuang: { medium: 13_000, large: 13_900, luxe: 15_300 }, icelake: { medium: 10_400, large: 12_200 } },
  jianxia: { bamboo: { large: 9_300 } },
  fushi: { bamboo: { large: 8_900 }, icelake: { large: 12_200 } },
  gengfu: { icelake: { luxe: 11_200 } },
};

/** 实盘档 tier 的守夜撑了 ticks 拍（每秒 30 拍）、赢没赢、打没打倒尸王 → 结回倍数（万分比，整数）；角色、地图缺省 = 小道士、雪原 */
export function vigilBp(tier: LiveTier, ticks: number, won: boolean, bossKilled: boolean, character: CharacterId = 'xiaodao', map: MapId = 'snow'): number {
  const combo = LIVE_COMBO_BP[character]?.[map]?.[tier];
  const dawn = combo !== undefined
    ? Math.floor((LIVE_TIERS[tier].dawnBp * combo) / 10_000)
    : Math.floor((Math.floor((LIVE_TIERS[tier].dawnBp * (LIVE_CHAR_BP[character]?.[tier] ?? 10_000)) / 10_000) * (LIVE_MAP_BP[map]?.[tier] ?? 10_000)) / 10_000);
  if (bossKilled) return Math.min(LIVE_MAX_BP, dawn + VIGIL_BOSS_ADD_BP);
  if (won) return Math.min(LIVE_MAX_BP, dawn);
  // 按拍插值：整数运算，浏览器和 Worker、各平台算出来一样
  const t = Math.max(0, Math.floor(ticks));
  let share = VIGIL_SHAPE[VIGIL_SHAPE.length - 1]![1];
  for (let i = 1; i < VIGIL_SHAPE.length; i++) {
    const [s1, b1] = VIGIL_SHAPE[i]!;
    if (t >= s1 * 30) continue;
    const [s0, b0] = VIGIL_SHAPE[i - 1]!;
    share = t <= s0 * 30 ? b0 : b0 + Math.floor(((b1 - b0) * (t - s0 * 30)) / ((s1 - s0) * 30));
    break;
  }
  return Math.min(LIVE_MAX_BP, Math.floor((share * dawn) / 10_000));
}

/** 危险档对应的实盘档（模拟器按它算期望；危险 1、5 没有实盘，返回 undefined） */
export function tierOfDanger(d: number): LiveTier | undefined {
  return LIVE_TIER_IDS.find((t) => LIVE_TIERS[t].danger === d);
}

/** 结回多少筹码：桌上那一份 × 倍数，向下取整（和开盘一样） */
export function liveReturn(stake: number, bp: number): number {
  return Math.floor((stake * Math.max(0, Math.min(LIVE_MAX_BP, Math.floor(bp)))) / 10_000);
}
