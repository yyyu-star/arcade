/**
 * 电脑的互动（0.7.1）：电脑什么时候发表情、短语、扔道具，被真人扔东西、点名时怎么回，真人想太久时怎么催。
 *
 * - 只看公开事件（谁出了什么、压了谁、谁出完了、谁扔了什么给谁）；电脑的出牌决策（src/ai）完全不读这里，也不读真人发的任何东西。
 * - 纯函数：随机数和时间都由调用方给（单机页面传 Math.random 和 Date.now；以后房间里用密钥分出来的流），不碰 DOM、网络。
 * - 按性格和这一场的状态：老张爱显摆炸弹、回怼一半；小美话少、多半装没看见；阿强嘴快，被扔了基本都要扔回去，上头时更凶。
 * - 不刷屏：每个电脑发完一次至少隔 COOLDOWN_MS，所有电脑合起来至少隔 GAP_MS；催人每一手只催一次。
 * - 只说牌局（嘲讽表里的话本来就只说牌局和打法）；编号和好友房完全一样（emotes.ts），画面也是同一套。
 * 座位都是同一种编号（单机是画面座位，我 = 0；房间里是真实座位），这里不关心是哪种。
 */
import { isBomb, type GameEvent, type DealResult } from '../core/index.ts';
import type { PersonaId } from '../ai/index.ts';
import { EMOTES, PROP_BASE, STICKER_BASE, TAUNTS, TAUNT_BASE } from './emotes.ts';

/** 每个电脑两次互动之间至少隔多久 */
export const COOLDOWN_MS = 9000;
/** 所有电脑合起来两次之间至少隔多久 */
export const GAP_MS = 2500;

// 和 arcade-kit/fun 的 STICKERS、PROPS 同一个顺序（测试核对）：这里不引 kit/fun，房间里也能用
const STICKER = ['smug', 'doge', 'cry', 'sweat', 'shock', 'sly', 'love', 'angry', 'sleep', 'clap', 'lol', 'cool'] as const;
const PROP = ['tomato', 'egg', 'stinkyEgg', 'slipper', 'bomb', 'rose', 'like', 'cheers'] as const;
type Sticker = (typeof STICKER)[number];
type Prop = (typeof PROP)[number];

const sticker = (s: Sticker): number => STICKER_BASE + STICKER.indexOf(s);
const prop = (p: Prop): number => PROP_BASE + PROP.indexOf(p);
const taunt = (t: (typeof TAUNTS)[number]): number => TAUNT_BASE + TAUNTS.indexOf(t);
const phrase = (t: (typeof EMOTES)[number]): number => EMOTES.indexOf(t);

/** 一个电脑此刻的样子：性格、这一场的状态、上头程度（src/ai 的 styleOf 给的同一份） */
export interface BanterBot {
  seat: number;
  persona: PersonaId;
  form: number;
  tilt: number;
}

/** 电脑要发的一条：谁、编号、对谁（扔道具、点名）、过多久发（像人一样反应一下） */
export interface BanterOut {
  from: number;
  id: number;
  to?: number;
  delay: number;
}

/**
 * 这一手压下去的是谁的牌：出牌记录里这一手之前最近一手有牌的（领出时是上一墩的，算不上"压"，
 * 但那手一定是自己人或自己出的，炸弹显摆只看对方，所以不会误认）。history 里最后一条是这一手本身
 */
export function victimOf(history: readonly { seat: number; play: unknown }[]): number {
  for (let i = history.length - 2; i >= 0; i--) if (history[i]!.play) return history[i]!.seat;
  return -1;
}

/** 每个电脑两次输出之间至少隔多久：电脑和真人一样守 1.5 秒的道具冷却 */
export const MIN_OUT_MS = 1500;
/** 回扔：同一个电脑在 COUNTER_WINDOW_MS 内最多扔 COUNTER_MAX 次 */
export const COUNTER_MAX = 2;
export const COUNTER_WINDOW_MS = 20000;
/** 电脑主动互动（名场面、催人、搭档捧场）每一副最多几次；被真人扔了回敬不算 */
export const HAND_MAX = 2;

/** 冷却的记录：调用方保存（单机在页面里，房间里可以放进状态） */
export interface BanterState {
  /** 每个座位上一次发的时间（主动互动用的 9 秒冷却） */
  last: Record<number, number>;
  lastAny: number;
  /** 已经催过的那一手 */
  urged: string;
  /** 每个座位最近一次任何输出的时间（回敬也算，守 MIN_OUT_MS） */
  lastOut: Record<number, number>;
  /** 每个座位最近回扔道具的时间（滑动窗口，限 COUNTER_MAX 次） */
  counters: Record<number, number[]>;
  /** 这一副电脑已经主动互动了几次 */
  n: number;
  /** n 对应的是哪一副（dealStart 事件给的 dealNo）；-1 = 还没见到 dealStart，靠 banterOnDeal 收尾时清零 */
  hand: number;
}

export function newBanter(): BanterState {
  return { last: {}, lastAny: -Infinity, urged: '', lastOut: {}, counters: {}, n: 0, hand: -1 };
}

/** 互动性格（写在人物表里）：爱闹 / 普通 / 高冷，是所有互动概率的倍数 */
export type Fun = 'rowdy' | 'normal' | 'cool';
const FUN_MULT: Record<Fun, number> = { rowdy: 1.5, normal: 1, cool: 0.3 };
const P_MAX = 0.95;

interface Profile {
  /** 互动性格 */
  fun: Fun;
  /** 主动发的基本概率 */
  talk: number;
  /** 被扔、被点名时：回怼 / 认怂的概率（剩下的装没看见） */
  back: number;
  shrug: number;
  /** 等真人等多久开始催（毫秒） */
  patience: number;
  /** 反应快慢（毫秒） */
  react: [number, number];
}

const PROFILE: Record<PersonaId, Profile> = {
  laozhang: { fun: 'normal', talk: 0.5, back: 0.45, shrug: 0.25, patience: 15000, react: [700, 1500] },
  xiaomei: { fun: 'cool', talk: 0.25, back: 0.2, shrug: 0.2, patience: 22000, react: [1000, 2000] },
  aqiang: { fun: 'rowdy', talk: 0.7, back: 0.75, shrug: 0.05, patience: 11000, react: [400, 1000] },
};

/** 各人顺手的说法：炸了显摆、被炸了不服、头游、队友漂亮 */
const BRAG: Record<PersonaId, number[]> = {
  laozhang: [taunt('炸弹准备好了'), sticker('cool'), sticker('lol'), sticker('smug')],
  xiaomei: [sticker('sly'), sticker('cool')],
  aqiang: [taunt('就这？'), sticker('smug'), sticker('doge'), taunt('这牌也敢出？')],
};
const STUNG: Record<PersonaId, number[]> = {
  laozhang: [sticker('shock'), taunt('手气而已，别骄傲'), taunt('等着瞧')],
  xiaomei: [sticker('sweat'), phrase('好牌！')],
  aqiang: [sticker('angry'), taunt('等着瞧'), taunt('手气而已，别骄傲')],
};
const FIRST: Record<PersonaId, number[]> = {
  laozhang: [taunt('谢谢送分'), sticker('lol'), sticker('cool')],
  xiaomei: [sticker('cool'), phrase('这把稳了')],
  aqiang: [taunt('这把你们没戏'), sticker('smug'), sticker('cool')],
};
const CHEER: Record<PersonaId, number[]> = {
  laozhang: [prop('cheers'), phrase('漂亮！'), prop('like')],
  xiaomei: [phrase('配合得好'), prop('rose'), sticker('clap')],
  aqiang: [prop('like'), phrase('漂亮！'), sticker('clap')],
};

const pick = <T>(xs: readonly T[], rand: () => number): T => xs[Math.floor(rand() * xs.length) % xs.length]!;
const team = (s: number): number => s % 2;

/** 这个人物所有互动概率的倍数（爱闹 1.5、普通 1、高冷 0.3） */
export const funMult = (persona: PersonaId): number => FUN_MULT[PROFILE[persona].fun];
/** 基础概率 × 性格倍数，封顶 0.95（总留一点"没理你"的可能） */
const chance = (base: number, b: BanterBot): number => Math.min(P_MAX, base * funMult(b.persona));

/** 这一次这个电脑有多想说：基本概率 × 状态（手热话多）× 上头（上头话更多）× 性格 */
function eager(b: BanterBot): number {
  return chance(PROFILE[b.persona].talk * (1 + Math.max(0, b.form) * 0.6 + b.tilt * 0.6), b);
}

function free(st: BanterState, seat: number, now: number): boolean {
  return now - (st.last[seat] ?? -Infinity) >= COOLDOWN_MS && now - st.lastAny >= GAP_MS && now - (st.lastOut[seat] ?? -Infinity) >= MIN_OUT_MS;
}

/** quiet：被真人扔了的回敬不占主动互动的冷却（视图层已经限了被连扔），只记 lastOut */
function emit(st: BanterState, b: BanterBot, id: number, now: number, rand: () => number, to?: number, delay?: number, quiet = false): BanterOut {
  const [lo, hi] = PROFILE[b.persona].react;
  const d = delay ?? Math.round(lo + rand() * (hi - lo));
  st.lastOut[b.seat] = now;
  if (!quiet) {
    st.last[b.seat] = now;
    st.lastAny = now;
  }
  return to === undefined ? { from: b.seat, id, delay: d } : { from: b.seat, id, to, delay: d };
}

/** 发给谁：道具一定要对象，嘲讽可以点名，表情和客气话不对谁 */
const targetFor = (id: number, to: number | undefined): number | undefined => (id >= PROP_BASE || (id >= TAUNT_BASE && id < STICKER_BASE) ? to : undefined);

const isTaunt = (id: number): boolean => id >= TAUNT_BASE && id < STICKER_BASE;

/** 名场面里输的一方：多半扔点顺手的（番茄、鸡蛋、拖鞋），或者一个难受的表情 */
const SORE_PROPS = [prop('tomato'), prop('egg'), prop('slipper')];
const SORE_STICKERS = [sticker('shock'), sticker('cry'), sticker('angry'), sticker('sweat')];
const SMUG = [sticker('smug'), sticker('cool'), sticker('lol')];
const soreOf = (rand: () => number): number => (rand() < 0.6 ? pick(SORE_PROPS, rand) : pick(SORE_STICKERS, rand));

/** 一副里还能再互动几次 */
const room = (st: BanterState): number => Math.max(0, HAND_MAX - st.n);

/** 名场面：输的电脑 40%×性格 冲赢家来，赢的电脑 30%×性格 乐一下；最多两条、不超过这一副的上限 */
function moment(st: BanterState, losers: readonly BanterBot[], winners: readonly BanterBot[], target: number, now: number, rand: () => number): BanterOut[] {
  // 先一起判冷却：同一事件里的两条不该互相挡（emit 会刷新 lastAny）
  const ok = (b: BanterBot) => free(st, b.seat, now);
  const L = losers.filter(ok);
  const W = winners.filter(ok);
  const out: BanterOut[] = [];
  const add = (b: BanterBot, id: number, to?: number) => {
    // 两条的延迟错开：后一条至少比前一条晚 400 毫秒
    const o = emit(st, b, id, now, rand, targetFor(id, to));
    const prev = out[out.length - 1];
    if (prev && Math.abs(o.delay - prev.delay) < 400) o.delay = prev.delay + 400 + Math.round(rand() * 400);
    out.push(o);
    st.n++;
  };
  for (const b of L) if (out.length < 2 && room(st) > 0 && rand() < chance(0.4, b)) add(b, soreOf(rand), target);
  for (const b of W) if (out.length < 2 && room(st) > 0 && rand() < chance(0.3, b)) add(b, pick(SMUG, rand));
  return out;
}

/** 赢家挑一个：有真人先挑真人，否则随便一个（props 对电脑也能扔，只是画面上不那么要紧） */
const pickWinner = (seats: readonly number[], humans: readonly number[]): number => seats.find((s) => humans.includes(s)) ?? seats[0]!;

/**
 * 公开事件之后电脑可能的反应（最多两条，且每一副电脑主动互动不超过 HAND_MAX 次）。
 * victim：这一手压下去的那手牌是谁出的（领出为 -1）；humans：哪些座位是真人。
 * 一副的计数以 dealStart 事件为界（调用方有就传进来）；没传的靠 banterOnDeal 收尾清零。
 */
export function banterOnEvent(st: BanterState, e: GameEvent, victim: number, bots: readonly BanterBot[], humans: readonly number[], now: number, rand: () => number): BanterOut[] {
  if (e.type === 'dealStart') {
    if (st.hand !== e.dealNo) {
      st.hand = e.dealNo;
      st.n = 0;
    }
    return [];
  }
  const bot = (seat: number) => bots.find((b) => b.seat === seat);
  if (e.type === 'play' && isBomb(e.play) && victim >= 0 && team(victim) !== team(e.seat)) {
    // 炸弹压了对方：被炸的电脑冲炸的人去，炸的一方乐一下
    const losers = bots.filter((b) => b.seat === victim);
    const winners = bots.filter((b) => team(b.seat) === team(e.seat));
    return moment(st, losers, winners, e.seat, now, rand);
  }
  if (e.type === 'finish' && e.place === 1) {
    const mate = bot((e.seat + 2) % 4);
    const out: BanterOut[] = [];
    let skip = -1;
    // 真人头游：电脑搭档先捧一下（也占这一副的次数）
    if (mate && humans.includes(e.seat) && room(st) > 0 && free(st, mate.seat, now) && rand() < eager(mate)) {
      const id = pick(CHEER[mate.persona], rand);
      out.push(emit(st, mate, id, now, rand, targetFor(id, e.seat)));
      st.n++;
      skip = mate.seat;
    }
    const losers = bots.filter((b) => team(b.seat) !== team(e.seat));
    const winners = bots.filter((b) => team(b.seat) === team(e.seat) && b.seat !== skip);
    const winSeats = [0, 1, 2, 3].filter((s) => team(s) === team(e.seat));
    const more = moment(st, losers, winners, pickWinner(winSeats, humans), now, rand);
    if (out.length && more.length && Math.abs(more[0]!.delay - out[0]!.delay) < 400) more[0]!.delay = out[0]!.delay + 400;
    return [...out, ...more].slice(0, 2);
  }
  return [];
}

/**
 * 一副结束：双下时，被双下的电脑 40%×性格 冲赢的一队去（humans 里有真人就挑真人），赢的电脑 30%×性格 乐一下。
 * 到这里这一副就完了，主动互动的计数清零。humans 不传 = 不偏向真人。
 */
export function banterOnDeal(st: BanterState, r: DealResult, bots: readonly BanterBot[], now: number, rand: () => number, humans: readonly number[] = []): BanterOut[] {
  if (st.hand >= 0 && st.hand !== r.dealNo) st.n = 0;
  let out: BanterOut[] = [];
  if (r.doubleDown) {
    const losers = bots.filter((b) => team(b.seat) !== r.winnerTeam);
    const winners = bots.filter((b) => team(b.seat) === r.winnerTeam);
    // 赢家按出完的先后挑：头游优先
    const winSeats = r.order.filter((s) => team(s) === r.winnerTeam);
    out = moment(st, losers, winners, pickWinner(winSeats, humans), now, rand);
  }
  st.n = 0;
  st.hand = -1;
  return out;
}

const ROUGH: readonly number[] = [prop('tomato'), prop('egg'), prop('stinkyEgg'), prop('slipper'), prop('bomb')];
const NICE: readonly number[] = [prop('rose'), prop('like'), prop('cheers')];

/** 回扔"同一类"：番茄回番茄，鸡蛋回拖鞋（互相不重样），点名嘲讽回番茄 */
const COUNTER: Record<number, number> = {
  [prop('tomato')]: prop('tomato'),
  [prop('egg')]: prop('slipper'),
  [prop('stinkyEgg')]: prop('stinkyEgg'),
  [prop('slipper')]: prop('slipper'),
  [prop('bomb')]: prop('bomb'),
  [prop('rose')]: prop('rose'),
  [prop('like')]: prop('like'),
  [prop('cheers')]: prop('cheers'),
};
export const counterOf = (id: number): number | undefined => (isTaunt(id) ? prop('tomato') : COUNTER[id]);

/** 回敬的概率、回扔占回敬的比例（不再乘性格）、反应快慢（毫秒） */
export const RESPOND_P = 0.6;
export const COUNTER_SHARE = 0.25;
export const RESPOND_DELAY: readonly [number, number] = [800, 2000];

/**
 * 真人冲电脑来的（扔道具、点名嘲讽，to 是电脑）：60%×性格 的概率回应，过 0.8–2 秒。
 * 粗的（番茄、鸡蛋、臭鸡蛋、拖鞋、炸弹、点名）回生气/冒汗/一句话，友好的（送花、点赞、干杯）回比心；
 * 其中四分之一改成回扔同类道具（同一个电脑 20 秒内最多 2 次，超了退回表情）。
 * 不看 9 秒冷却（视图层限了每个目标 10 秒最多被扔 6 次），只守每个电脑 1.5 秒的最小间隔，也不占每副主动互动的次数。
 */
export function banterOnEmote(st: BanterState, from: number, id: number, to: number | undefined, bots: readonly BanterBot[], now: number, rand: () => number): BanterOut[] {
  if (to === undefined) return [];
  const b = bots.find((x) => x.seat === to);
  if (!b || from === to) return [];
  const nice = NICE.includes(id);
  if (!nice && !ROUGH.includes(id) && !isTaunt(id)) return [];
  if (now - (st.lastOut[b.seat] ?? -Infinity) < MIN_OUT_MS) return [];
  if (rand() >= chance(RESPOND_P, b)) return [];
  const delay = Math.round(RESPOND_DELAY[0] + rand() * (RESPOND_DELAY[1] - RESPOND_DELAY[0]));
  const recent = (st.counters[b.seat] ?? []).filter((t) => now - t < COUNTER_WINDOW_MS);
  st.counters[b.seat] = recent;
  const counter = counterOf(id);
  if (rand() < COUNTER_SHARE && counter !== undefined && recent.length < COUNTER_MAX) {
    recent.push(now);
    return [emit(st, b, counter, now, rand, from, delay, true)];
  }
  const reply = nice ? sticker('love') : pick([sticker('angry'), sticker('sweat'), sticker('angry'), phrase('服了')], rand);
  return [emit(st, b, reply, now, rand, undefined, delay, true)];
}

/**
 * 真人想太久（seat 是轮到的真人，ms 是他已经想了多久，key 区分"这一手"）：最没耐心的电脑催一下。
 * 队友催得客气（"别急，慢慢想"也算），对手催得冲（"等得花都谢了"、扔个催促炸弹）。每一手最多催一次；
 * 催不催按性格掷一次（高冷的多半不催），掷过就算这一手催过了；催人也占这一副的主动互动次数。
 */
export function banterOnSlow(st: BanterState, seat: number, ms: number, key: string, bots: readonly BanterBot[], now: number, rand: () => number): BanterOut[] {
  if (st.urged === key || room(st) <= 0) return [];
  const ready = bots
    .filter((b) => b.seat !== seat && ms >= PROFILE[b.persona].patience * (1 - b.tilt * 0.3) && free(st, b.seat, now))
    .sort((a, b) => PROFILE[a.persona].patience - PROFILE[b.persona].patience);
  const b = ready[0];
  if (!b) return [];
  st.urged = key;
  if (rand() >= chance(1, b)) return [];
  st.n++;
  const mate = team(b.seat) === team(seat);
  const pool = mate ? [phrase('别急，慢慢想'), phrase('快点吧')] : b.persona === 'aqiang' ? [prop('bomb'), taunt('等得花都谢了'), prop('bomb')] : [taunt('等得花都谢了'), phrase('快点吧')];
  const id = pick(pool, rand);
  return [emit(st, b, id, now, rand, targetFor(id, seat))];
}
