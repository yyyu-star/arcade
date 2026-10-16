/**
 * 电脑的性格、每场的状态、随局面的调整（0.7.0 起，docs/ai.md）。
 *
 * 强弱（Difficulty）定"会不会打"：记牌、配合、失误；性格定"爱怎么打"：爱不爱炸、抢不抢出牌权、细不细心、输了上不上头。
 * 两者叠起来才是一个电脑这一手的参数，按三层算：
 * 1. 性格：老张、小美、阿强各有一组偏好（下面的 PERSONAS）；
 * 2. 状态：每一场开局时按种子抽一次（-1 到 1，乘上性格的"起伏"），同一个人这场手热、下场收着打；每副再小幅抖一下；
 * 3. 局面：级数落后多了就拼、领先多了就稳；上一副输了，爱上头的人更急也更粗心；这一副对手炸得多，就早点防着对手走。
 * 全部从种子和公开信息算出来：不看别人的牌，同一个种子同一串操作结果完全一样。
 */
import { rngFor, teamOf, type PlayerView } from '../core/index.ts';
import type { Recall } from './memory.ts';

export type Difficulty = 'novice' | 'easy' | 'normal' | 'good' | 'hard';
export const DIFFICULTIES: readonly Difficulty[] = ['novice', 'easy', 'normal', 'good', 'hard'];

/** 一个电脑这一手的全部参数。 */
export interface Tuning {
  /** 记牌程度 */
  recall: Recall;
  /** 是否和队友配合（不压队友、送牌、帮队友顶） */
  teamwork: boolean;
  /** 对手剩几张以内算"快出完"，开始拼命压 */
  threat: number;
  /** 不紧急时，愿意为压牌多付出的拆牌代价 */
  breakTolerance: number;
  /** 犯"新手错"的概率：跟牌时只看能不能压、领出时随手出最小的 */
  slip: number;
  /** 队友剩几张以内开始送牌 */
  feedAt: number;
  /** 跟对手的单张、对子时额外愿意付的拆牌代价（其他牌型按 6 成算）：越大越爱抢出牌权 */
  chase: number;
  /** 队友已经不要、我是这一轮最后能顶的人时，再多愿意付的代价 */
  lastChance: number;
  /** 爱炸程度：正的不急也肯炸、炸得早，负的炸弹捂到最后；0 是原来的做法 */
  bombLove: number;
  /** 手软：对手快走完、本该顶住时，有这么大的概率放他一马（只给新手场的电脑） */
  soft: number;
  /** 差不多好的几种出法里换着出的概率：同样的局面不总是同一手，没有固定套路可钻 */
  jitter: number;
  /** 急：领出时不把王、级牌、最大的牌留到后面，跟牌时也舍得拿它们抢出牌权（每次按这个概率） */
  rush: number;
}

/** 强弱预设。easy / normal / hard 的数是 0.1.3 起按 npm run sim 校准的；novice、good 是 0.7.0 加的两头 */
export const TUNING: Record<Difficulty, Tuning> = {
  // 新手场：不记牌、不配合、常犯小错，对手快走完时还常常手软
  novice: { recall: 'none', teamwork: false, threat: 2, breakTolerance: 1.2, slip: 0.3, feedAt: 0, chase: 0.4, lastChance: 0.1, bombLove: 0, soft: 0.4, jitter: 0, rush: 0 },
  // 失误率按 npm run sim 校准（0.1.3）：简单对普通整局胜率约 2 成多，困难对普通约 7 成。
  // 失误不再拆炸弹/同花顺、不压队友以后（0.2.x），一次失误亏得少了，按同样目标重调：简单 0.13 → 0.25，普通 0.05 → 0.1
  easy: { recall: 'none', teamwork: false, threat: 2, breakTolerance: 1.2, slip: 0.25, feedAt: 0, chase: 0.6, lastChance: 0.2, bombLove: 0, soft: 0, jitter: 0, rush: 0 },
  normal: { recall: 'high', teamwork: true, threat: 6, breakTolerance: 0.6, slip: 0.1, feedAt: 6, chase: 1.6, lastChance: 0.5, bombLove: 0, soft: 0, jitter: 0, rush: 0 },
  // 普通和困难之间：全记牌，偶尔失误（单机实盘中档的对手）
  good: { recall: 'full', teamwork: true, threat: 7, breakTolerance: 0.6, slip: 0.03, feedAt: 6, chase: 1.6, lastChance: 0.5, bombLove: 0, soft: 0, jitter: 0, rush: 0 },
  hard: { recall: 'full', teamwork: true, threat: 8, breakTolerance: 0.6, slip: 0, feedAt: 6, chase: 1.6, lastChance: 0.5, bombLove: 0, soft: 0, jitter: 0, rush: 0 },
};

export type PersonaId = 'laozhang' | 'xiaomei' | 'aqiang';
export const PERSONA_IDS: readonly PersonaId[] = ['laozhang', 'xiaomei', 'aqiang'];

/** 性格：在强弱预设上加减（slip 是乘），再按状态、局面浮动 */
export interface Persona {
  /** 爱炸 */
  bombLove: number;
  /** 抢出牌权 */
  chase: number;
  /** 最后一个能顶时再多拼一点 */
  lastChance: number;
  /** 失误率的倍数：细心的小于 1 */
  slipMul: number;
  /** 输了上头的程度（0 到 1）：上一副输了、级数落后时更急、更粗心 */
  tilt: number;
  /** 每场状态的起伏（0 到 1） */
  swing: number;
  /** 换着出的概率 */
  jitter: number;
  /** 急（见 Tuning.rush） */
  rush: number;
}

export const PERSONAS: Record<PersonaId, Persona> = {
  // 老张：豪爽，手里有炸弹就想响一下；抢牌一般，不太上头，状态时好时坏
  laozhang: { bombLove: 1.6, chase: 0, lastChance: 0.1, slipMul: 1, tilt: 0.3, swing: 0.6, jitter: 0.12, rush: 0 },
  // 小美：稳，炸弹捂着留到关键时候；不乱抢、细心，输了也不急，状态起伏小
  xiaomei: { bombLove: -1.4, chase: -0.5, lastChance: 0, slipMul: 0.6, tilt: 0, swing: 0.3, jitter: 0.08, rush: 0 },
  // 阿强：莽，什么都想压，最后一个也要顶；急，有时先亮王和级牌；粗心，输了就上头，状态起伏最大
  aqiang: { bombLove: 0.4, chase: 1.4, lastChance: 0.6, slipMul: 1.1, tilt: 1, swing: 0.8, jitter: 0.15, rush: 0.12 },
};

/**
 * 越强的电脑性格露得越少（性格、状态、上头的幅度都乘这个数）：高手也有自己的路数，但不会为了路数白送；
 * 新手场的电脑性格最鲜明，输赢也最不讲究
 */
export const STYLE_SCALE: Record<Difficulty, number> = { novice: 1, easy: 1, normal: 1, good: 0.5, hard: 0.35 };

/**
 * 联机房间里每个真实座位坐的电脑是谁（单机我坐 0，1、2、3 就是老张、小美、阿强）。
 * 0 号一般是房主；房主离开后真没人了才会是电脑，借老张的性格（和 1 号不在一队）。
 * 页面上按真实座位显示名字，所以同一个电脑在每个人的屏幕上都叫同一个名字、说同一种话。
 */
export const SEAT_PERSONA: readonly PersonaId[] = ['laozhang', 'laozhang', 'xiaomei', 'aqiang'];

/** 这一场的状态：-1（手冷、收着打）到 1（手热、放开打），再乘性格的起伏。每副另有一点小抖动 */
export function formOf(match: string | number, seat: number, dealNo: number, persona: PersonaId): number {
  const p = PERSONAS[persona];
  const base = rngFor(match, 'form', seat).next() * 2 - 1;
  const deal = rngFor(match, 'form', seat, dealNo).next() * 2 - 1;
  return (base * 0.8 + deal * 0.2) * p.swing;
}

/** 局面：只看公开的级数、上一副的结果、这一副的出牌记录 */
export interface Situation {
  /** 我方级数减对方级数 */
  lead: number;
  /** 上一副我方输了 */
  lostLast: boolean;
  /** 这一副对手出了几个炸弹 */
  oppBombs: number;
}

/** seat 默认是看这份 view 的人；页面上也拿自己的 view 算别的座位（只用公开的信息） */
export function situationOf(view: PlayerView, seat: number = view.seat): Situation {
  const mine = teamOf(seat);
  let oppBombs = 0;
  for (const h of view.history) if (h.play && teamOf(h.seat) !== mine && ['bomb', 'straightFlush', 'jokerBomb'].includes(h.play.type)) oppBombs++;
  return {
    lead: view.levels[mine]! - view.levels[1 - mine]!,
    lostLast: view.lastDeal !== null && view.lastDeal.winnerTeam !== mine,
    oppBombs,
  };
}

/** 上头的程度（0 到 1）：上一副输了算一半，级数落后 3 级以上再加一半，乘性格的 tilt */
export function tiltOf(p: Persona, sit: Situation): number {
  return p.tilt * ((sit.lostLast ? 0.5 : 0) + (sit.lead <= -3 ? 0.5 : 0));
}

/** 这个电脑此刻的状态和上头程度（已乘 STYLE_SCALE）：出牌参数和页面上的口吻、节奏用同一份 */
export function styleOf(view: PlayerView, difficulty: Difficulty, persona: PersonaId, match: string | number, seat: number = view.seat): { form: number; tilt: number; sit: Situation } {
  const k = STYLE_SCALE[difficulty];
  const sit = situationOf(view, seat);
  return { form: formOf(match, seat, view.dealNo, persona) * k, tilt: tiltOf(PERSONAS[persona], sit) * k, sit };
}

/**
 * 这一手的参数：强弱预设 + 性格 + 状态 + 局面。
 * 没给性格时就是强弱预设本身（聪明提示、代打、模拟里的"真人"都用这个），和 0.7.0 以前一模一样。
 */
export function tuningFor(view: PlayerView, difficulty: Difficulty, persona?: PersonaId, match?: string | number): Tuning {
  const base = TUNING[difficulty];
  if (!persona) return base;
  const p = PERSONAS[persona];
  const k = STYLE_SCALE[difficulty];
  const { form, tilt, sit } = styleOf(view, difficulty, persona, match ?? 'match');
  // 落后多了就拼（抢、炸），领先多了就稳（少炸）
  const behind = sit.lead <= -3 ? 1 : 0;
  const ahead = sit.lead >= 3 ? 1 : 0;
  return {
    ...base,
    chase: Math.max(0, base.chase + p.chase * k + form * 0.9 + behind * 0.3 + tilt * 0.6),
    lastChance: base.lastChance + p.lastChance * k,
    bombLove: p.bombLove * k + form * 1.2 + behind * 0.5 - ahead * 0.4 + tilt * 0.4,
    // 手热的时候细心，手冷、上头的时候粗心；困难（0 失误）只有上头时才会出错
    slip: Math.min(0.45, Math.max(0, base.slip * (1 + (p.slipMul - 1) * k) * (1 - form * 0.35) + tilt * 0.04)),
    // 这一副对手已经炸了两个以上：早一点防着他们走
    threat: base.threat + (sit.oppBombs >= 2 ? 1 : 0),
    jitter: p.jitter * k,
    rush: Math.min(1, Math.max(0, p.rush * k + form * 0.2 + tilt * 0.2)),
  };
}
