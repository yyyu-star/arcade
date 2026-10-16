/**
 * 电脑的性格（DESIGN.md 第 5 节）：化名，不用真人；名字要加进平台的保留昵称。
 * 参数都是整数千分比（不用浮点的平台相关函数，同一局面同一选择）。
 * 性格只是底子：每一场按 Tune 的种子在 swing 的范围里浮动，场地的"手软"和局面（领先、落后、快输光、刚点了炮）再往上加减（style.ts）。
 */
import type { RandomStream } from 'arcade-kit/rng';

export interface Persona {
  name: string;
  /** 一句话的打法（结算页、头像上的小字） */
  style: string;
  /** 防守：别人像听牌时多重视"不放炮"（0–1000） */
  defense: number;
  /** 贪：放过小胡等大胡、冲清一色对对胡（0–1000） */
  greed: number;
  /** 爱杠：听牌时也杠（0–1000） */
  kanLove: number;
  /** 爱碰：碰了能快一点就碰，不在乎门清（0–1000；低的守门清） */
  pon: number;
  /** 偶尔打错：千分之几的时候不打最好的那张，在第 2 到第 4 好里挑（新手连向听都会打坏） */
  slip: number;
  /** 读牌：看出别人在做清一色（副露、弃牌都偏一门）就不打那一门（0–1000，越大越准） */
  reads: number;
  /** 上头：刚点了炮、输了一大把以后打得更急、更容易错（0–1000） */
  temper: number;
  /** 状态起伏：每一场在性格范围里浮动多大（0–1000，新手忽好忽坏，老手稳） */
  swing: number;
  /** 出手快慢：单机里思考时间的千分比（1000 = 平常） */
  tempo: number;
  /** 话多：单机里胡、杠、点炮以后开口的千分比 */
  talk: number;
  /** 互动性格：爱闹（概率 ×1.5）、普通（×1）、高冷（×0.3），乘在被扔后回应、名场面扔东西的概率上（game/banter.ts 读；电脑出牌不读） */
  fun: 'lively' | 'normal' | 'cool';
  /** 强弱的档：0 新手、1 普通、2 稳、3 老练（场地表按它排，见 venues.ts） */
  level: number;
  /** 功力：牌效多看一步、按胡牌的番算听牌好坏、读牌和防守更细（0–1000；场地的手紧再往上加，见 style.ts） */
  skill: number;
}

export const PERSONAS: readonly Persona[] = [
  { name: '幺妹儿', style: '快：见胡就胡，能碰就碰', defense: 350, greed: 0, kanLove: 300, pon: 900, slip: 50, reads: 250, temper: 300, swing: 300, tempo: 650, talk: 700, fun: 'lively', level: 1, skill: 0 },
  { name: '熊猫哥', style: '贪：爱做清一色、对对胡', defense: 200, greed: 950, kanLove: 500, pon: 450, slip: 60, reads: 200, temper: 600, swing: 500, tempo: 1_000, talk: 800, fun: 'normal', level: 1, skill: 0 },
  { name: '盖碗儿', style: '稳：守门清，少碰少杠', defense: 950, greed: 200, kanLove: 150, pon: 150, slip: 20, reads: 700, temper: 100, swing: 200, tempo: 1_350, talk: 250, fun: 'cool', level: 2, skill: 300 },
  { name: '兔头哥', style: '爱杠：能杠就杠，输了容易上头', defense: 300, greed: 400, kanLove: 1_000, pon: 600, slip: 60, reads: 300, temper: 700, swing: 500, tempo: 850, talk: 900, fun: 'lively', level: 1, skill: 0 },
  { name: '火锅婆婆', style: '老练：牌效和防守都细', defense: 750, greed: 350, kanLove: 400, pon: 450, slip: 0, reads: 1_000, temper: 0, swing: 250, tempo: 1_150, talk: 400, fun: 'cool', level: 3, skill: 1_000 },
  { name: '板凳儿', style: '新手：常打错，不太防守', defense: 50, greed: 100, kanLove: 600, pon: 700, slip: 300, reads: 0, temper: 900, swing: 800, tempo: 900, talk: 600, fun: 'normal', level: 0, skill: 0 },
];

/** 最强的性格（档最高的那个） */
export const STRONGEST = PERSONAS.reduce((best, p, i) => (p.level > PERSONAS[best]!.level ? i : best), 0);

/** 按权重挑 n 个不同的性格（weights[i] 是 PERSONAS[i] 的权重，0 不挑）；挑不够 n 个时剩下的用第一个补（好友房实盘只有火锅婆婆一个） */
export function pickPersonas(rng: RandomStream, weights: readonly number[], n: number): number[] {
  const pool = weights.map((w, i) => ({ i, w })).filter((x) => x.w > 0);
  const out: number[] = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((a, x) => a + x.w, 0);
    let r = rng.below(total);
    const at = pool.findIndex((x) => (r -= x.w) < 0);
    out.push(pool[at]!.i);
    pool.splice(at, 1);
  }
  while (out.length < n) out.push(out[0] ?? 0);
  return out;
}
