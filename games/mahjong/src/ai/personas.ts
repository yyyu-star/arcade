/**
 * 电脑的性格（DESIGN.md 第 5 节）：化名，不用真人；名字要加进平台的保留昵称。
 * 参数都是整数千分比（不用浮点的平台相关函数，同一局面同一选择）。
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
  /** 偶尔打错：千分之几的时候不打最好的那张，在第 2 到第 4 好里挑（新手连向听都会打坏） */
  slip: number;
  /** 读牌：看出别人在做清一色（副露、弃牌都偏一门）就不打那一门（0–1000，越大越准） */
  reads: number;
  /** 档位：0 小档常见、3 只在大档豪华档出现（越大越强） */
  level: number;
}

export const PERSONAS: readonly Persona[] = [
  { name: '幺妹儿', style: '快：见胡就胡，不贪', defense: 400, greed: 0, kanLove: 300, slip: 60, reads: 300, level: 1 },
  { name: '熊猫哥', style: '贪：爱做清一色、对对胡', defense: 250, greed: 900, kanLove: 500, slip: 60, reads: 200, level: 1 },
  { name: '盖碗儿', style: '稳：防守重，很少点炮', defense: 950, greed: 200, kanLove: 200, slip: 20, reads: 700, level: 2 },
  { name: '兔头哥', style: '爱杠：能杠就杠', defense: 300, greed: 400, kanLove: 1000, slip: 60, reads: 300, level: 1 },
  { name: '火锅婆婆', style: '老练：牌效和防守都细', defense: 750, greed: 350, kanLove: 400, slip: 0, reads: 1000, level: 3 },
  { name: '板凳儿', style: '新手：常打错，不太防守', defense: 50, greed: 100, kanLove: 600, slip: 300, reads: 0, level: 0 },
];

/**
 * 按档位挑三个（或四个）不同的性格：level 是档位的序号（娱乐和小档 0、中档 1、大档 2、豪华 3）。
 * 档位越高，越挑"老练"的；小档里常有新手。
 */
export function pickPersonas(rng: RandomStream, level: number, n: number): number[] {
  const pool = PERSONAS.map((p, i) => ({ i, w: weight(p.level, level) })).filter((x) => x.w > 0);
  const out: number[] = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((a, x) => a + x.w, 0);
    let r = rng.below(total);
    const at = pool.findIndex((x) => (r -= x.w) < 0);
    out.push(pool[at]!.i);
    pool.splice(at, 1);
  }
  return out;
}

function weight(p: number, level: number): number {
  const d = Math.abs(p - level);
  return d === 0 ? 6 : d === 1 ? 3 : d === 2 ? 1 : level >= 2 && p === 0 ? 0 : 1;
}
