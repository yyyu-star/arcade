/**
 * 守夜的刷怪节奏（DESIGN.md 2.2）和难度。每分钟一档：场上至少保持多少只、每秒补多少只、各种怪的比例；
 * 加上几个定点事件（开场正面一波、围圈、精英、群冲、纸人海、尸王）。
 */
import type { EnemyKind } from './enemies.ts';

export interface Minute {
  /** 场上保持的数量 */
  keep: number;
  /** 每秒补多少只（不到 keep 的一半时翻倍） */
  rate: number;
  /** 各种怪的比例（会远程的灯笼鬼、雪魅压在 8% 以下：场上几十只一起吐弹，近战流派没法打） */
  mix: Partial<Record<EnemyKind, number>>;
}

export const MINUTES: readonly Minute[] = [
  { keep: 22, rate: 3, mix: { paper: 1 } },
  { keep: 40, rate: 4, mix: { paper: 0.6, wisp: 0.25, bat: 0.15 } },
  { keep: 60, rate: 5, mix: { paper: 0.45, wisp: 0.25, bat: 0.3 } },
  { keep: 80, rate: 6, mix: { paper: 0.25, jiangshi: 0.45, horse: 0.15, bat: 0.15 } },
  { keep: 100, rate: 7, mix: { paper: 0.2, wisp: 0.15, jiangshi: 0.45, horse: 0.2 } },
  { keep: 115, rate: 7.5, mix: { paper: 0.15, jiangshi: 0.4, lantern: 0.08, bone: 0.25 } },
  { keep: 130, rate: 8, mix: { jiangshi: 0.35, lantern: 0.08, bone: 0.3, horse: 0.15 } },
  { keep: 150, rate: 9, mix: { jiangshi: 0.3, lantern: 0.08, bone: 0.3, bat: 0.2 } },
  { keep: 165, rate: 10, mix: { paper: 0.15, jiangshi: 0.2, fox: 0.25, water: 0.2, scarecrow: 0.2 } },
  { keep: 185, rate: 11, mix: { jiangshi: 0.25, fox: 0.25, water: 0.15, scarecrow: 0.15, bone: 0.2 } },
  { keep: 210, rate: 12, mix: { jiangshi: 0.25, lantern: 0.08, fox: 0.2, snow: 0.07, weasel: 0.1, bone: 0.15 } },
  { keep: 230, rate: 13, mix: { jiangshi: 0.25, fox: 0.2, snow: 0.07, weasel: 0.1, bone: 0.15, bat: 0.1 } },
  { keep: 285, rate: 16, mix: { jiangshi: 0.3, fox: 0.2, snow: 0.07, water: 0.1, bone: 0.15, horse: 0.1 } },
  { keep: 300, rate: 17, mix: { jiangshi: 0.35, lantern: 0.08, fox: 0.2, snow: 0.07, bone: 0.2, scarecrow: 0.1 } },
  { keep: 280, rate: 15, mix: { paper: 0.2, jiangshi: 0.4, fox: 0.2, bone: 0.2 } },
];

export type WaveEvent =
  | { at: number; kind: 'front'; enemy: EnemyKind; count: number }
  | { at: number; kind: 'ring'; enemy: EnemyKind; count: number; radius: number }
  | { at: number; kind: 'line'; enemy: EnemyKind; count: number }
  | { at: number; kind: 'elite'; enemy: EnemyKind; count: number }
  | { at: number; kind: 'boss'; enemy: 'boss' | 'lord' };

const S = 30;
/**
 * 定点事件，at 是拍数。精英 5 次（3:00、5:00、7:30、10:00、12:00）；"小爆点"在 2:30（纸人围圈）、7:30（小鬼火群冲）、12:30（纸人海），
 * 纸马群冲在 4:00、9:00 垫一下（DESIGN.md 2.2、13.3）。
 */
export const EVENTS: readonly WaveEvent[] = [
  // 开场 2 秒：正面近处来一小群纸人，保证 10 秒内第一次升级（验收 ①）
  { at: 2 * S, kind: 'front', enemy: 'paper', count: 12 },
  { at: 150 * S, kind: 'ring', enemy: 'paper', count: 56, radius: 400 },
  { at: 180 * S, kind: 'elite', enemy: 'shishi', count: 1 },
  { at: 240 * S, kind: 'line', enemy: 'horse', count: 14 },
  { at: 300 * S, kind: 'elite', enemy: 'whitefox', count: 1 },
  { at: 450 * S, kind: 'elite', enemy: 'palanquin', count: 1 },
  { at: 452 * S, kind: 'line', enemy: 'wisp', count: 34 },
  { at: 480 * S, kind: 'boss', enemy: 'lord' },
  { at: 540 * S, kind: 'line', enemy: 'horse', count: 20 },
  { at: 600 * S, kind: 'elite', enemy: 'general', count: 2 },
  { at: 720 * S, kind: 'elite', enemy: 'shishi', count: 1 },
  { at: 721 * S, kind: 'elite', enemy: 'whitefox', count: 1 },
  { at: 750 * S, kind: 'ring', enemy: 'paper', count: 90, radius: 430 },
  { at: 840 * S, kind: 'boss', enemy: 'boss' },
];

/**
 * 收获期（DESIGN.md 2.2）：精英倒下、爆点刷出来以后的一段时间里，场上保持的数量和补怪速度打 keepMul 折，铜钱、肉包掉率乘 dropMul。
 * 爆点的收获期从刷出来那一刻算，所以是"先挤一下、再松一口气"。
 */
export const CALM = { afterElite: 25 * S, afterSpike: 30 * S, keepMul: 0.5, dropMul: 2 };

/**
 * 提灯鬼（不怕火，克火流派）：只在守夜、危险 minDanger 起，第 from 分钟起占常规怪的 share[0]，第 late 分钟起 share[1]。
 * 夜探走自己的刷怪表（explore.ts），不受影响。
 */
export const LAMP = { minDanger: 3 as Danger, from: 5, late: 12, share: [0.15, 0.25] as const };
/** 这一分钟提灯鬼占多少（0 = 不出） */
export function lampShare(mode: 'vigil' | 'raid', danger: Danger, minute: number): number {
  if (mode !== 'vigil' || danger < LAMP.minDanger || minute < LAMP.from) return 0;
  return minute >= LAMP.late ? LAMP.share[1] : LAMP.share[0];
}

/** 一局多长：15 分钟天亮 */
export const DAWN_TICK = 15 * 60 * S;

/** 怪随时间变硬：血量 × (1 + 每分钟 hpPerMin)，伤害 × (1 + 每分钟 dmgPerMin) */
export const SCALE = { hpPerMin: 0.29, dmgPerMin: 0.09 };

/** 危险档 0–5（DESIGN.md 13.2）。危险 2 是配平的基准（4c 按它调到普通玩家 55–65%），别的档相对它偏移 */
export type Danger = 0 | 1 | 2 | 3 | 4 | 5;
export const DANGER_IDS: readonly Danger[] = [0, 1, 2, 3, 4, 5];

export interface DangerDef {
  id: Danger;
  name: string;
  /** 选档卡上的星（电脑多强，balance.md 第 5 节） */
  stars: number;
  hpMul: number;
  dmgMul: number;
  /** 刷怪量 */
  countMul: number;
  /** 开场 OPEN_TICKS 拍里怪走路的速度倍数（危险 0：怪只会慢慢靠近，原地不动也撑得过第一次升级） */
  openSlow: number;
  /** 吸魂珠的范围倍数（危险 0：剑砍死的怪掉的珠子站着也吸得到） */
  magnetMul: number;
  /** 前 EARLY_TICKS 拍挨打的伤害倍数（受伤补偿：开局手忙脚乱时少掉点血） */
  earlyDmg: number;
  /** 前几次升级保证至少两张是法器（危险 0：先给能打的） */
  armsFirst: number;
  /** 每分钟的怪种比例往后挪几分钟（−1：更难的常规怪晚一分钟出；13.2"D1 加新怪"就是从 −1 回到 0） */
  mixShift: number;
  /** 精英晚到多少拍（13.2"D2 精英波提前"：危险 0、1 晚 30 秒，危险 2 起按时间线） */
  eliteLate: number;
  /** 每次精英多来几只（13.2"D4 精英窗口加宽"） */
  eliteExtra: number;
  /** 两只尸王，各 75% 血（危险 5） */
  twinBoss: boolean;
  /**
   * 精英不吃镇守的减速：主角带两件以上镇类法器（ELITE_NO_WARD_PIECES）时，精英不被镇 3 件和镇魂铃减速（危险 4 起）。
   * 镇守靠减速把怪留在近身，混搭火葫芦时扇面多烧几轮，焚天金钟危险 5 胜率改前 59.5% 超标；按 8.1 加克制的怪，不砍法器（DESIGN 8.1、12）
   */
  eliteNoWard: boolean;
  /** 一句话 */
  blurb: string;
}

/** 受伤打折的前几分钟：5 分钟 */
export const EARLY_TICKS = 300 * S;
/** 开场保护多长：30 秒 */
export const OPEN_TICKS = 30 * S;
/** 第一局：3 分钟前血最少留 1（DESIGN.md 13.2 新手保护） */
export const FIRST_RUN_GUARD = 180 * S;

/**
 * 逐档继承（13.2）：D0 新手照顾 → D1 怪种按时出 → D2 精英按时出（配平基准）→ D3 血和伤害比 D2 +15% → D4 +21%、精英多一只、精英不吃镇守减速 → D5 +35%、两只尸王（第 7 步按模拟器定的数）。
 * 实盘四档固定用危险 0 / 2 / 3 / 4（DESIGN.md 4.1）。
 */
export const DANGERS: Record<Danger, DangerDef> = {
  0: { id: 0, name: '危险 0', stars: 1, hpMul: 0.72, dmgMul: 0.6, countMul: 0.85, openSlow: 0.5, magnetMul: 2.4, earlyDmg: 0.8, armsFirst: 4, mixShift: -1, eliteLate: 30 * S, eliteExtra: 0, twinBoss: false, eliteNoWard: false, blurb: '第一次玩选这个' },
  1: { id: 1, name: '危险 1', stars: 1, hpMul: 1.0, dmgMul: 1.0, countMul: 1.0, openSlow: 1, magnetMul: 1.4, earlyDmg: 0.8, armsFirst: 0, mixShift: 0, eliteLate: 30 * S, eliteExtra: 0, twinBoss: false, eliteNoWard: false, blurb: '怪种按时出' },
  2: { id: 2, name: '危险 2', stars: 2, hpMul: 1.2, dmgMul: 1.2, countMul: 1.1, openSlow: 1, magnetMul: 1, earlyDmg: 0.8, armsFirst: 0, mixShift: 0, eliteLate: 0, eliteExtra: 0, twinBoss: false, eliteNoWard: false, blurb: '会躲会选就能撑到天亮' },
  3: { id: 3, name: '危险 3', stars: 3, hpMul: 1.38, dmgMul: 1.36, countMul: 1.16, openSlow: 1, magnetMul: 1, earlyDmg: 1, armsFirst: 0, mixShift: 0, eliteLate: -20 * S, eliteExtra: 0, twinBoss: false, eliteNoWard: false, blurb: '怪更硬、下手更重' },
  4: { id: 4, name: '危险 4', stars: 3, hpMul: 1.56, dmgMul: 1.5, countMul: 1.22, openSlow: 1, magnetMul: 1, earlyDmg: 1, armsFirst: 0, mixShift: 0, eliteLate: 0, eliteExtra: 1, twinBoss: false, eliteNoWard: true, blurb: '精英成群，带两件镇类时不吃减速' },
  5: { id: 5, name: '危险 5', stars: 4, hpMul: 1.75, dmgMul: 1.65, countMul: 1.28, openSlow: 1, magnetMul: 1, earlyDmg: 1, armsFirst: 0, mixShift: 0, eliteLate: 0, eliteExtra: 1, twinBoss: true, eliteNoWard: true, blurb: '两只尸王，精英也不吃镇守减速' },
};
/**
 * 夜探的危险档（DESIGN.md 4.2）：夜探没有天亮可撑、还有巡夜将，同一档比守夜难得多（第 3 轮：普通玩家危险 0 撤出 80%，危险 1 只剩 45%），
 * 所以单独一条更缓的坡：危险 1、2 取守夜危险 0 到 1 的三分之一、三分之二处，危险 3 起顺延守夜的 1、2、3。
 * 实盘中、大档（危险 1、2）就落在这两档上。整数项四舍五入。
 */
function lerpDanger(a: DangerDef, b: DangerDef, t: number, id: Danger): DangerDef {
  const f = (x: number, y: number): number => x + (y - x) * t;
  const i = (x: number, y: number): number => Math.round(f(x, y));
  return {
    ...a, id, name: `危险 ${id}`,
    hpMul: f(a.hpMul, b.hpMul), dmgMul: f(a.dmgMul, b.dmgMul), countMul: f(a.countMul, b.countMul), openSlow: f(a.openSlow, b.openSlow),
    magnetMul: f(a.magnetMul, b.magnetMul), earlyDmg: f(a.earlyDmg, b.earlyDmg), armsFirst: i(a.armsFirst, b.armsFirst), mixShift: i(a.mixShift, b.mixShift),
    eliteLate: i(a.eliteLate, b.eliteLate), eliteExtra: i(a.eliteExtra, b.eliteExtra),
  };
}
export const RAID_DANGERS: Record<Danger, DangerDef> = {
  0: DANGERS[0],
  1: lerpDanger(DANGERS[0], DANGERS[1], 1 / 3, 1),
  2: lerpDanger(DANGERS[0], DANGERS[1], 2 / 3, 2),
  3: { ...DANGERS[1], id: 3, name: '危险 3' },
  4: { ...DANGERS[2], id: 4, name: '危险 4' },
  5: { ...DANGERS[3], id: 5, name: '危险 5' },
};
/** 这一局用的危险档参数：夜探走 RAID_DANGERS */
export function dangerDef(mode: 'vigil' | 'raid', d: Danger): DangerDef {
  return mode === 'raid' ? RAID_DANGERS[d] : DANGERS[d];
}

/** 两只尸王时每只的血 */
export const TWIN_BOSS_HP = 0.75;

/** 菜单上的三档（第 5 步选档界面做完以前沿用）：新手 / 普通 / 高手 = 危险 0 / 2 / 4，balance.md 第 3 节按这三档量 */
export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: Record<Difficulty, { id: Difficulty; name: string; stars: number; danger: Danger; blurb: string }> = {
  easy: { id: 'easy', name: '新手', stars: 1, danger: 0, blurb: '第一次玩选这个' },
  normal: { id: 'normal', name: '普通', stars: 2, danger: 2, blurb: '会躲会选就能撑到天亮' },
  hard: { id: 'hard', name: '高手', stars: 3, danger: 4, blurb: '怪更多更硬' },
};
