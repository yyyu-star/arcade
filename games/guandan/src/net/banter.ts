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

/** 冷却的记录：调用方保存（单机在页面里，房间里可以放进状态） */
export interface BanterState {
  /** 每个座位上一次发的时间 */
  last: Record<number, number>;
  lastAny: number;
  /** 已经催过的那一手 */
  urged: string;
}

export function newBanter(): BanterState {
  return { last: {}, lastAny: -Infinity, urged: '' };
}

interface Profile {
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
  laozhang: { talk: 0.5, back: 0.45, shrug: 0.25, patience: 15000, react: [700, 1500] },
  xiaomei: { talk: 0.25, back: 0.2, shrug: 0.2, patience: 22000, react: [1000, 2000] },
  aqiang: { talk: 0.7, back: 0.75, shrug: 0.05, patience: 11000, react: [400, 1000] },
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

/** 这一次这个电脑有多想说：基本概率 × 状态（手热话多）× 上头（上头话更多） */
function eager(b: BanterBot): number {
  return Math.min(0.95, PROFILE[b.persona].talk * (1 + Math.max(0, b.form) * 0.6 + b.tilt * 0.6));
}

function free(st: BanterState, seat: number, now: number): boolean {
  return now - (st.last[seat] ?? -Infinity) >= COOLDOWN_MS && now - st.lastAny >= GAP_MS;
}

function emit(st: BanterState, b: BanterBot, id: number, now: number, rand: () => number, to?: number): BanterOut {
  const [lo, hi] = PROFILE[b.persona].react;
  const delay = Math.round(lo + rand() * (hi - lo));
  st.last[b.seat] = now;
  st.lastAny = now;
  return to === undefined ? { from: b.seat, id, delay } : { from: b.seat, id, to, delay };
}

/** 发给谁：道具一定要对象，嘲讽可以点名，表情和客气话不对谁 */
const targetFor = (id: number, to: number | undefined): number | undefined => (id >= PROP_BASE || (id >= TAUNT_BASE && id < STICKER_BASE) ? to : undefined);

/**
 * 公开事件之后电脑可能的反应（最多一条，免得一下子好几个人一起说）。
 * victim：这一手压下去的那手牌是谁出的（领出为 -1）；humans：哪些座位是真人。
 */
export function banterOnEvent(st: BanterState, e: GameEvent, victim: number, bots: readonly BanterBot[], humans: readonly number[], now: number, rand: () => number): BanterOut[] {
  const bot = (seat: number) => bots.find((b) => b.seat === seat);
  const tryOne = (b: BanterBot | undefined, pool: number[], to?: number): BanterOut[] => {
    if (!b || !free(st, b.seat, now) || rand() >= eager(b)) return [];
    const id = pick(pool, rand);
    return [emit(st, b, id, now, rand, targetFor(id, to))];
  };
  if (e.type === 'play' && isBomb(e.play) && victim >= 0 && team(victim) !== team(e.seat)) {
    // 电脑炸了别人：显摆（点名被炸的人）
    const brag = tryOne(bot(e.seat), BRAG[bot(e.seat)?.persona ?? 'laozhang'], victim);
    if (brag.length) return brag;
    // 电脑被炸：不服；上头的阿强有时直接扔个番茄回去
    const b = bot(victim);
    if (b && b.persona === 'aqiang' && b.tilt >= 0.5 && free(st, b.seat, now) && rand() < 0.5) return [emit(st, b, prop('tomato'), now, rand, e.seat)];
    return tryOne(b, STUNG[b?.persona ?? 'laozhang'], e.seat);
  }
  if (e.type === 'finish' && e.place === 1) {
    const mate = bot((e.seat + 2) % 4);
    // 队友（真人或电脑）头游：电脑搭档捧一下
    if (mate && humans.includes(e.seat)) {
      const out = tryOne(mate, CHEER[mate.persona], e.seat);
      if (out.length) return out;
    }
    const me = bot(e.seat);
    if (me) return tryOne(me, FIRST[me.persona]);
    // 真人头游：对手电脑里嘴快的那个不服
    const opp = bots.filter((b) => team(b.seat) !== team(e.seat)).sort((a, b) => eager(b) - eager(a))[0];
    return tryOne(opp, STUNG[opp?.persona ?? 'laozhang'], e.seat);
  }
  return [];
}

/** 一副结束：双下的那一队电脑庆祝，被双下的电脑认个怂 */
export function banterOnDeal(st: BanterState, r: DealResult, bots: readonly BanterBot[], now: number, rand: () => number): BanterOut[] {
  if (!r.doubleDown) return [];
  const losers = bots.filter((b) => team(b.seat) !== r.winnerTeam && free(st, b.seat, now));
  const winners = bots.filter((b) => team(b.seat) === r.winnerTeam && free(st, b.seat, now));
  const b = rand() < 0.5 ? (winners[0] ?? losers[0]) : (losers[0] ?? winners[0]);
  if (!b || rand() >= eager(b)) return [];
  if (team(b.seat) !== r.winnerTeam) return [emit(st, b, pick([sticker('cry'), phrase('服了'), phrase('手滑了')], rand), now, rand)];
  // 赢的一方：给搭档敬一杯，或者乐一下
  const id = pick([sticker('lol'), prop('cheers'), taunt('谢谢送分')], rand);
  return [emit(st, b, id, now, rand, id === prop('cheers') ? (b.seat + 2) % 4 : undefined)];
}

const ROUGH: readonly number[] = [prop('tomato'), prop('egg'), prop('stinkyEgg'), prop('slipper'), prop('bomb')];
const NICE: readonly number[] = [prop('rose'), prop('like'), prop('cheers')];

/**
 * 真人冲电脑来的（扔道具、点名嘲讽、催促炸弹，to 是电脑）：回怼、认怂或装没看见，按性格。
 * 送花、点赞这类友好的：回一句客气话或比个心。冷却照样算，被连着扔也不会一直回。
 */
export function banterOnEmote(st: BanterState, from: number, id: number, to: number | undefined, bots: readonly BanterBot[], now: number, rand: () => number): BanterOut[] {
  if (to === undefined) return [];
  const b = bots.find((x) => x.seat === to);
  if (!b || from === to || !free(st, b.seat, now)) return [];
  const p = PROFILE[b.persona];
  if (NICE.includes(id)) {
    if (rand() >= 0.6) return [];
    return [emit(st, b, pick([sticker('love'), phrase('配合得好'), phrase('好牌！')], rand), now, rand)];
  }
  const hostile = ROUGH.includes(id) || (id >= TAUNT_BASE && id < STICKER_BASE);
  if (!hostile) return [];
  const back = Math.min(0.95, p.back + b.tilt * 0.3);
  const r = rand();
  if (r < back) {
    // 回怼：扔回去同一样（阿强），或者回一句
    const pool = b.persona === 'aqiang' && ROUGH.includes(id) ? [id, id, taunt('等着瞧')] : [taunt('等着瞧'), taunt('就这？'), prop('egg'), sticker('sly')];
    const out = pick(pool, rand);
    return [emit(st, b, out, now, rand, targetFor(out, from))];
  }
  if (r < back + p.shrug) return [emit(st, b, pick([sticker('sweat'), sticker('cry'), phrase('服了')], rand), now, rand)];
  return [];
}

/**
 * 真人想太久（seat 是轮到的真人，ms 是他已经想了多久，key 区分"这一手"）：最没耐心的电脑催一下。
 * 队友催得客气（"别急，慢慢想"也算），对手催得冲（"等得花都谢了"、扔个催促炸弹）。每一手最多催一次。
 */
export function banterOnSlow(st: BanterState, seat: number, ms: number, key: string, bots: readonly BanterBot[], now: number, rand: () => number): BanterOut[] {
  if (st.urged === key) return [];
  const ready = bots
    .filter((b) => b.seat !== seat && ms >= PROFILE[b.persona].patience * (1 - b.tilt * 0.3) && free(st, b.seat, now))
    .sort((a, b) => PROFILE[a.persona].patience - PROFILE[b.persona].patience);
  const b = ready[0];
  if (!b) return [];
  st.urged = key;
  const mate = team(b.seat) === team(seat);
  const pool = mate ? [phrase('别急，慢慢想'), phrase('快点吧')] : b.persona === 'aqiang' ? [prop('bomb'), taunt('等得花都谢了'), prop('bomb')] : [taunt('等得花都谢了'), phrase('快点吧')];
  const id = pick(pool, rand);
  return [emit(st, b, id, now, rand, targetFor(id, seat))];
}
