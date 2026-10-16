/**
 * 电脑这一手按什么打（DESIGN.md 第 5 节）：性格是底子，再叠三层，都只用这个座位看得见的东西：
 * 1. 这一场的状态（Tune.mood）：每个参数在性格的 swing 范围里浮动，同一个性格不同场次不一样；
 * 2. 场地的手软（Tune.soft）：新手场多打错、少防守、读牌粗、少碰少杠、少做大牌；
 * 3. 局面：落后了追（贪一点、防守松一点），领先了稳（防守紧），快输光了保命，刚点了炮输一大把会上头（看 temper），
 *    最后一局还落后就搏一把。都是按公开的筹码和每局小结算的，别人的手牌一张不看。
 * 没有随机数：浮动由 mood 和参数编号算出来（同一场同一结果）。
 */
import type { Tune } from '../core/variants/types.ts';
import type { XzView } from '../core/variants/sichuan-xuezhan/index.ts';
import type { Persona } from './personas.ts';

/** 这一手实际用的参数（同 Persona 的同名字段，已经叠好） */
export interface Style {
  defense: number;
  greed: number;
  kanLove: number;
  pon: number;
  slip: number;
  reads: number;
  /** 场地的手软，决定会不会放过真人打的小胡 */
  soft: number;
  /** 功力（性格 + 场地的手紧，手软再往下压），见 xuezhan.ts */
  skill: number;
  level: number;
}

/** 状态浮动最大 ±这么多（再乘 swing/1000） */
const MOOD_RANGE = 220;

const clamp = (x: number, lo = 0, hi = 1_000): number => Math.max(lo, Math.min(hi, Math.round(x)));

/** mood 和参数编号算出的 -1000..1000 */
function wobble(mood: number, i: number): number {
  let h = (mood ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return (h % 2_001) - 1_000;
}

/** 只叠状态和手软（不看局面）：模拟器统计"这一场的性格"用 */
export function moodStyle(p: Persona, t: Tune): Style {
  const m = (i: number, span = MOOD_RANGE): number => (t.mood === 0 ? 0 : (wobble(t.mood, i) * span * p.swing) / 1_000_000);
  // 手软最多 1500（娱乐新手档）：防守压到 0、读牌和功力没了、四成多的决定打错、真人的小胡放过三成多
  const soft = clamp(t.soft, 0, 1_500);
  const sharp = clamp(t.sharp ?? 0);
  return {
    defense: clamp(((p.defense + m(0)) * (1_500 - soft)) / 1_500),
    // 手软的也少做大牌（新手档的电脑像人一样弱：不刻意防守、不憋清一色）
    greed: clamp(((p.greed + m(1)) * (1_000 - soft / 2)) / 1_000),
    // 手软的也少碰少杠（慢一点，真人更容易先胡）
    kanLove: clamp(((p.kanLove + m(2)) * (1_000 - soft / 2)) / 1_000),
    pon: clamp(((p.pon + m(3)) * (1_000 - soft / 2)) / 1_000),
    // 手紧的少打错、读牌更准
    slip: clamp(((p.slip + m(4, p.slip / 2 + 20)) * (1_000 - sharp)) / 1_000 + soft / 4, 0, 500),
    reads: clamp(((p.reads + m(5) + sharp / 2) * (1_000 - soft)) / 1_000),
    soft,
    skill: clamp(((p.skill + sharp) * (1_000 - soft)) / 1_000),
    level: p.level,
  };
}

/** 这一手的参数：状态、手软，再按局面调 */
export function styleOf(v: XzView, p: Persona): Style {
  const me = v.me!;
  const st = moodStyle(p, me.tune);
  const chips = v.seats[me.seat]!.chips;
  const lead = ((chips - v.share) * 1_000) / v.share;
  let { defense, greed, slip } = st;
  // 快输光了：保命，少冒险
  if (chips * 4 <= v.share) {
    defense += 250;
    greed -= 200;
  } else if (lead <= -400) {
    // 落后：追分，贪一点、防守松一点；最后一局还落后就搏一把
    greed += 150;
    defense -= 120;
    if (v.round >= v.opts.rounds - 1) greed += 150;
  } else if (lead >= 800) {
    // 领先：稳住
    defense += 150;
    greed -= 150;
  }
  // 上一局点了炮、输了一大把：上头（temper 大的才明显）
  const last = v.history.at(-1);
  if (last && last.wins.some((w) => w.from === me.seat) && last.net[me.seat]! * 5 <= -v.share) {
    slip += p.temper / 8;
    defense -= p.temper / 5;
  }
  return { ...st, defense: clamp(defense), greed: clamp(greed), slip: clamp(slip, 0, 450) };
}

/** 模拟器里的"代理玩家"：直接用固定的参数，不浮动、不看局面 */
export function fixedStyle(p: Persona): Style {
  return { defense: p.defense, greed: p.greed, kanLove: p.kanLove, pon: p.pon, slip: p.slip, reads: p.reads, soft: 0, skill: p.skill, level: p.level };
}
