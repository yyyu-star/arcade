/**
 * 玩法的统一接口（DESIGN.md 3.4）。房间、单机、界面、电脑都只通过它碰一个玩法；
 * 玩法之间不互相 import，只依赖 tiles、hand、table、match（test/arch.test.ts 检查）。
 *
 * 状态、动作、视图都是能直接存进 JSON 的普通对象，状态和视图带 variant 字段，拿到先看它再交给对应的玩法。
 */
import type { Entropy } from 'arcade-kit/rng';
import type { SettleStats } from '../match/index.ts';
import type { TileSet } from '../tiles/index.ts';

/** 座位上是谁：开局时由房间（或单机）告诉玩法 */
export type SeatKind = 'human' | 'ai';

/** 这一刻谁能出手：一个人，或一组人同时（换三张、定缺、声明窗口）。group 是这一组的标识 */
export interface Actors {
  seats: number[];
  group: string;
}

/**
 * 一场的钱和电脑：share 是带进来的一份（娱乐按小档的数），base 是底分（玩法自己的计分单位换成筹码），
 * personas 是每个座位当电脑时的性格编号（由调用方按档位挑，见 src/ai/personas.ts；真人座位离座后电脑用它）
 */
/**
 * 电脑这一场的"状态"（DESIGN.md 第 5 节）：mood 是这一场的种子（房间、单机开场时用带种子的随机数定），
 * 电脑按它在自己性格的范围里浮动，同一个性格不同场次打法不一样；0 是不浮动（测试、模拟器里的代理玩家）。
 * soft 是场地的"手软"（0–1000）：新手场大，电脑偶尔打错、少防守、偶尔放过小胡。
 * sharp 是场地的"手紧"（0–1000）：大档、豪华档大，电脑牌效和读牌更细、不打错。两个都只有电脑用，规则不看；
 * sharp 是后来加的，旧存档、旧房间里没有，按 0 算
 */
export interface Tune {
  mood: number;
  soft: number;
  sharp?: number;
}

export const NEUTRAL_TUNE: Tune = { mood: 0, soft: 0 };

export interface MatchSetup {
  share: number;
  base: number;
  personas: number[];
  /** 每个座位当电脑时这一场的状态；不给就是不浮动 */
  tunes?: Tune[];
  /** 每个座位实际带进来的（钱包不够一份时可以少带）；不给就是每人一份 */
  chips?: number[];
}

/** 一场打完，每个座位的结果 */
export interface SeatResult {
  /** 最后手上的筹码（实盘按它结回钱包；已按"最多赢 3 份"截过） */
  chips: number;
  /** 净输赢 = chips - 带进来的 */
  net: number;
  /** 给钱包的小结 */
  stats: SettleStats;
}

export interface MatchResult {
  seats: SeatResult[];
}

/**
 * 电脑：只拿视图，不拿状态（看不到别人的牌和牌墙）。写在 src/ai/ 里，规则核心不 import 它，
 * 由用到的一方（房间、单机）把它交给 auto、timeout。性格在视图里（自己座位的 persona）
 */
export interface VariantAi<V, A> {
  decide(view: V): A;
}

export interface Variant<S, A, V, O> {
  id: string;
  /** 给人看的名字 */
  name: string;
  tileSet: TileSet;
  rulesVersion: number;
  seats: number;
  defaults: O;
  /** 房间选项校验：不合格返回 null */
  options(raw: unknown): O | null;
  /** 一场开始。key 是 256 位的随机数密钥（好友房是房间现生成的熵，单机是浏览器生成的），只在状态里、视图绝不带 */
  begin(key: Entropy, opts: O, seats: readonly SeatKind[], setup: MatchSetup): S;
  actors(s: S): Actors | null;
  /** 做一步：不改原状态，返回新状态；不合法返回固定的错误码 */
  apply(s: S, seat: number, a: A): S | { error: string };
  /** 校验动作的形状（房间收到的是不可信的 JSON） */
  parse(raw: unknown): A | null;
  /** kit 的"不轮流的操作"：这些动作发了以后名单、期限都不变（声明窗口里真人的回答） */
  free(a: A): boolean;
  /** 局间停顿（毫秒）和停够了以后的下一步 */
  pause(s: S): number | null;
  resume(s: S): S;
  /** 这一手（组）的时限毫秒 */
  turnMs(s: S): number;
  /** 这个座位能看到的（含"我现在能做什么"）；null 是没入座的人 */
  view(s: S, seat: number | null): V;
  /** 超时代出（只看这个座位能看到的；换三张、定缺这类选择照电脑的选法） */
  timeout(s: S, seat: number, ai: VariantAi<V, A>): A;
  /** 电脑、托管出手：玩法把这个座位的视图交给 ai，再包成房间要的动作（声明窗口里的回答带 bot 标记，不走 free） */
  auto(s: S, seat: number, ai: VariantAi<V, A>): A;
  over(s: S): boolean;
  /** 一局打完、停在结算的时候（适合收场） */
  breakPoint(s: S): boolean;
  result(s: S): MatchResult;
  /** 开打以后座位换了人（接管电脑、离座交给电脑）：电脑的性格、这个座位的统计从这里换 */
  seated(s: S, seat: number, kind: SeatKind): S;
  /** 好友房有人接管电脑的座位、带入到账：这个座位从 chips 重新算（输赢、"最多赢 3 份"都按它） */
  restake(s: S, seat: number, chips: number): S;
  /** 这一场到此为止（好友房实盘只剩一个真人）：桌上的筹码按现在的数算，不再往下打，over 变 true */
  finish(s: S): S;
}
