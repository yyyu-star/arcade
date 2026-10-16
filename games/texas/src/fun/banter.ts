/**
 * 电脑的互动（0.6.0，DESIGN.md 13.5）：被真人扔东西、点名时回应，一手打完按公开发生的事主动来一下，真人想太久时催一下。
 * 单机的页面和好友房的房间共用（0.6.1：好友房一手打完的那一下由房间替电脑广播，kit 的 botEmote，大家看到的一样）。
 * 这里不碰随机和时间：随机数、钟都由调用方给（单机页面给 Math.random、performance.now；房间给带种子的流和手数），测试里换成固定的。
 * 电脑的出牌决定（src/ai）不引用这里、也拿不到这里的任何东西：互动不影响它怎么打（test/arch.test.ts 查）。
 * 触发只看公开的事（谁对谁扔了什么、谁赢了谁的大池子、轮到谁想了多久）；嘲讽只说牌局，不说人。
 */
import { categoryOf } from '../core/eval.ts';
import { bluffer, putIn, riverTurnaround } from '../core/fame.ts';
import type { HandResult, LogEntry } from '../core/table.ts';
import { PROP_BASE, STICKER_BASE } from '../room/rules.ts';
import { tauntId as T } from './taunts.ts';

/**
 * kit/fun 的 STICKERS、PROPS 的顺序（emote 编号按它排，只往后加）。房间的代码不能引 kit/fun（它带着画面的类型），
 * 所以这里抄一份，test/banter.test.ts 核对和 kit 的一样
 */
export const STICKER_ORDER = ['smug', 'doge', 'cry', 'sweat', 'shock', 'sly', 'love', 'angry', 'sleep', 'clap', 'lol', 'cool'] as const;
export const PROP_ORDER = ['tomato', 'egg', 'stinkyEgg', 'slipper', 'bomb', 'rose', 'like', 'cheers'] as const;
type StickerId = (typeof STICKER_ORDER)[number];
type PropId = (typeof PROP_ORDER)[number];

/** 每种性格多爱说话（‰），顺序同 PERSONAS：稳哥、阿飙、老好、慢慢、算盘、江湖、虎子、老鹰、叨叨、小白。电脑说话（view/talk.ts）也按它 */
export const CHATTY = [150, 450, 350, 200, 150, 300, 550, 150, 900, 450];

/** 能发进房间的：表情、嘲讽短语（可以点名）、对谁扔个道具（都换成 emote 编号，emoteOf） */
export type Emote = { sticker: StickerId } | { taunt: number; to?: number } | { prop: PropId; to: number };
/** 电脑这一下做什么：上面这些，或者说一句自己的话（冒泡；只在单机的页面上，房间发不了自由文本） */
export type Out = { say: string } | Emote;

/** 换成房间的 emote 编号（rules.ts 的编号表：短语、表情、道具） */
export function emoteOf(e: Emote): { id: number; to?: number } {
  if ('taunt' in e) return { id: e.taunt, ...(e.to !== undefined ? { to: e.to } : {}) };
  if ('sticker' in e) return { id: STICKER_BASE + STICKER_ORDER.indexOf(e.sticker) };
  return { id: PROP_BASE + PROP_ORDER.indexOf(e.prop), to: e.to };
}

/** 房间转发的 emote 编号换回"真人做了什么"（嘲讽、表情、道具）；编号不对回 null */
export function pokeOf(id: number): Poke | null {
  if (id < 0 || !Number.isInteger(id)) return null;
  if (id < STICKER_BASE) return { taunt: id };
  if (id < PROP_BASE) {
    const k = STICKER_ORDER[id - STICKER_BASE];
    return k ? { sticker: k } : null;
  }
  const k = PROP_ORDER[id - PROP_BASE];
  return k ? { prop: k } : null;
}

/** 一手打完算这一手谁赢谁输用的：座位上是谁（电脑才互动）、什么性格 */
export interface SeatLike {
  owner: string;
  persona: number;
}

/** 真人对电脑做了什么：嘲讽短语、表情、道具 */
export type Poke = { taunt: number } | { sticker: StickerId } | { prop: PropId };

const HOSTILE: readonly PropId[] = ['tomato', 'egg', 'stinkyEgg', 'slipper', 'bomb'];

/**
 * 每种性格被招惹时怎么回（顺序同 PERSONAS）：回怼、装没看见、认怂三种的权重；urge 是真人想太久时它出来催的权重；
 * props 是它回怼时爱扔的；meek、shrug 是认怂、装没看见时偶尔说的话
 */
interface Temper {
  back: number;
  shrug: number;
  meek: number;
  urge: number;
  props: readonly PropId[];
  meekSay: readonly string[];
  shrugSay: readonly string[];
}

const TEMPER: readonly Temper[] = [
  { back: 2, shrug: 6, meek: 2, urge: 1, props: ['slipper'], meekSay: ['好好打牌'], shrugSay: ['……', '不影响'] },
  { back: 7, shrug: 2, meek: 1, urge: 5, props: ['tomato', 'slipper', 'bomb'], meekSay: ['行，算你狠'], shrugSay: ['挠痒痒'] },
  { back: 2, shrug: 3, meek: 5, urge: 1, props: ['rose'], meekSay: ['好好好，我认', '手下留情啊'], shrugSay: ['没事没事'] },
  { back: 1, shrug: 2, meek: 7, urge: 0, props: ['egg'], meekSay: ['别、别扔了…', '我、我错了…'], shrugSay: ['……'] },
  { back: 3, shrug: 6, meek: 1, urge: 2, props: ['egg'], meekSay: ['这把算你的'], shrugSay: ['不影响胜率', '情绪不进赔率'] },
  { back: 5, shrug: 4, meek: 1, urge: 2, props: ['slipper', 'stinkyEgg'], meekSay: ['好汉饶命'], shrugSay: ['江湖小事', '不跟你一般见识'] },
  { back: 8, shrug: 1, meek: 1, urge: 6, props: ['bomb', 'tomato', 'stinkyEgg'], meekSay: ['这次让你'], shrugSay: ['就这力气？'] },
  { back: 3, shrug: 7, meek: 0, urge: 1, props: ['stinkyEgg'], meekSay: ['记下了'], shrugSay: ['……', '牌桌上见'] },
  { back: 5, shrug: 1, meek: 4, urge: 7, props: ['tomato', 'egg'], meekSay: ['哎哟别砸', '哎呀饶了我吧'], shrugSay: ['我才不理你'] },
  { back: 2, shrug: 2, meek: 6, urge: 3, props: ['egg'], meekSay: ['为什么扔我…', '我做错什么了？'], shrugSay: ['这是什么？'] },
];

/**
 * 互动性格（docs/table-fun.md 第 4 节），顺序同 PERSONAS：爱闹的回应、名场面出手的概率 ×1.5，高冷的 ×0.3。
 * 和 CHATTY（多爱说话）分开：话多不等于爱扔东西
 */
export const FUN_STYLE = ['普通', '爱闹', '普通', '高冷', '高冷', '普通', '爱闹', '高冷', '爱闹', '普通'] as const;
const STYLE_MULT = { 爱闹: 1.5, 普通: 1, 高冷: 0.3 } as const;
export const funMult = (persona: number): number => STYLE_MULT[FUN_STYLE[persona] ?? '普通'];

/** 被扔回去的同类道具：番茄还番茄，鸡蛋还拖鞋（规范 4 节） */
export const ECHO: Readonly<Record<PropId, PropId>> = { tomato: 'tomato', egg: 'slipper', stinkyEgg: 'stinkyEgg', slipper: 'slipper', bomb: 'bomb', rose: 'rose', like: 'like', cheers: 'cheers' };

/** 被招惹后多久回（毫秒，像人：看一眼再回；规范 0.8–2 秒） */
export const REPLY_DELAY: readonly [number, number] = [800, 2_000];
/** 被扔道具时回应的概率（再乘互动性格）；只是冲他做个表情、点名一句的少一些 */
export const REACT_P = 0.6;
const REACT_P_SOFT = 0.35;
/** 回应里直接回敬一个道具的比例；同一个电脑 REVENGE_WINDOW_MS 里最多回敬 REVENGE_MAX 次 */
export const REVENGE_P = 0.25;
export const REVENGE_WINDOW_MS = 20_000;
export const REVENGE_MAX = 2;
/** 同一个电脑两次回应至少隔这么久（真人连着扔，不每下都回） */
export const REACT_GAP_MS = 2_500;
/** 名场面：输的电脑出手、赢的电脑得意的概率（再乘互动性格）；每手最多 MOMENT_MAX 次电脑主动互动 */
export const MOMENT_LOSER_P = 0.4;
export const MOMENT_WINNER_P = 0.3;
export const MOMENT_MAX = 2;
/** 同一个电脑两次互动至少隔这么久（不连着刷） */
export const SEAT_GAP_MS = 10_000;
/** 整桌两次主动互动（一手打完、催人）至少隔这么久；回应被招惹的不看它 */
export const TABLE_GAP_MS = 6_000;
/** 真人想了这么久，电脑出来催（好友房的催促炸弹给真人是 8 秒；电脑等得更久一点再催） */
export const AI_URGE_MS = 15_000;

export interface Seat {
  seat: number;
  persona: number;
}

export class Banter {
  private lastSeat = new Map<number, number>();
  private lastReact = new Map<number, number>();
  /** 每个电脑最近几次回敬的时间 */
  private revenges = new Map<number, number[]>();
  private lastTable = -Infinity;
  /** 每个电脑这一场的情绪：最近输赢（大盲）的滑动和，正的是顺、负的是背 */
  private mood = new Map<number, number>();

  private rand: () => number;
  private now: () => number;
  private talk: boolean;

  /**
   * rand：[0, 1) 的随机数；now：毫秒的钟。talk：能不能说自己的话（单机的页面能；房间只能发编号，自己的话换成意思相近的表情）
   */
  constructor(rand: () => number, now: () => number, talk = true) {
    this.rand = rand;
    this.now = now;
    this.talk = talk;
  }

  /** 说一句自己的话；房间里（talk 为 false）换成 alt 这个表情 */
  private say(text: string, alt: StickerId): Out {
    return this.talk ? { say: text } : { sticker: alt };
  }

  /** 换桌、换人：全清 */
  clear(): void {
    this.lastSeat.clear();
    this.lastReact.clear();
    this.revenges.clear();
    this.lastTable = -Infinity;
    this.mood.clear();
  }

  /** 一手打完：这个座位这一手净输赢多少个大盲（公开的：筹码变化） */
  result(seat: number, bb: number): void {
    const m = (this.mood.get(seat) ?? 0) * 0.7 + bb;
    this.mood.set(seat, Math.max(-200, Math.min(200, m)));
  }

  /**
   * 真人 from 对电脑 who 做了 poke：回什么（不回就 null）。被扔道具 60% 回（乘互动性格），其中 25% 直接回敬同类道具
   * （20 秒最多 2 次）；别的按脾气：回怼的生气、点名，认怂的流汗，不理的打哈欠。顺的时候更爱回怼，背的时候爱赌的更冲、胆小的更怂
   */
  react(who: Seat, from: number, poke: Poke): Out | null {
    const t = this.now();
    if (t - (this.lastReact.get(who.seat) ?? -Infinity) < REACT_GAP_MS) return null;
    const tp = TEMPER[who.persona] ?? TEMPER[0]!;
    const friendly = 'prop' in poke ? !HOSTILE.includes(poke.prop) : 'sticker' in poke ? poke.sticker === 'love' || poke.sticker === 'clap' : poke.taunt === T('好牌，服了');
    const p = ('prop' in poke ? REACT_P : REACT_P_SOFT) * funMult(who.persona);
    if (this.rand() >= p) return null;
    this.lastReact.set(who.seat, t);
    if (friendly) return this.pick<Out>([[{ sticker: 'love' }, 4], [{ sticker: 'clap' }, 2], [{ prop: 'cheers', to: from }, 1], [this.say('谢谢', 'clap'), 1]]);
    if ('prop' in poke && this.rand() < REVENGE_P) {
      const recent = (this.revenges.get(who.seat) ?? []).filter((x) => t - x < REVENGE_WINDOW_MS);
      if (recent.length < REVENGE_MAX) {
        this.revenges.set(who.seat, [...recent, t]);
        return { prop: ECHO[poke.prop], to: from };
      }
    }
    const mood = this.mood.get(who.seat) ?? 0;
    const hot = tp.back > tp.meek;
    let back = tp.back;
    let meek = tp.meek;
    if (mood > 30) {
      back *= 1.5;
      meek *= 0.5;
    } else if (mood < -30) {
      if (hot) back *= 1.5;
      else meek *= 1.5;
    }
    const kind = this.pick<'back' | 'shrug' | 'meek'>([['back', back], ['shrug', tp.shrug], ['meek', meek]]);
    if (kind === 'back')
      return this.pick<Out>([
        [{ sticker: 'angry' }, 3],
        [{ taunt: T('就这？'), to: from }, 2],
        [{ taunt: T('跟啊，怕了？'), to: from }, 1],
        [{ taunt: T('下一把轮到我了'), to: from }, 1],
      ]);
    if (kind === 'meek') return this.pick<Out>([[{ sticker: 'sweat' }, 3], [{ sticker: 'cry' }, 1], [this.say(this.one(tp.meekSay), 'sweat'), 3]]);
    return this.pick<Out>([[{ sticker: 'sleep' }, 2], [this.say(this.one(tp.shrugSay), 'sleep'), 2]]);
  }

  /**
   * 一手打完，电脑主动来一下（只看公开的结果）：赢了别人的大池子得意（点名"谢谢老板"、扔个干杯），
   * 输了大池子不服（点名"运气而已"、"再来！"）。won：这个电脑是赢的那个；other：对面（输给它的、赢了它的那个座位，没有就 null）
   */
  after(seat: Seat, won: boolean, other: number | null): Emote | null {
    const t = this.now();
    if (t - this.lastTable < TABLE_GAP_MS || t - (this.lastSeat.get(seat.seat) ?? -Infinity) < SEAT_GAP_MS) return null;
    const chatty = (CHATTY[seat.persona] ?? 300) / 1000;
    if (this.rand() >= chatty * 0.5) return null;
    this.lastTable = t;
    this.lastSeat.set(seat.seat, t);
    const tp = TEMPER[seat.persona] ?? TEMPER[0]!;
    if (won)
      return this.pick<Emote>(
        other === null
          ? [[{ sticker: 'smug' }, 2], [{ taunt: T('手气来了挡不住') }, 1]]
          : [[{ taunt: T('谢谢老板'), to: other }, 3], [{ prop: 'cheers', to: other }, 1], [{ taunt: T('就这？'), to: other }, tp.back]],
      );
    return this.pick<Emote>(
      other === null
        ? [[{ sticker: 'angry' }, tp.back], [{ sticker: 'cry' }, tp.meek]]
        : [[{ taunt: T('运气而已，别骄傲'), to: other }, 2], [{ taunt: T('再来！'), to: other }, 2], [{ prop: 'like', to: other }, tp.shrug / 3]],
    );
  }

  /**
   * 一手打完（只用公开的：投进去多少看操作记录，分到多少看结果）：记下每个电脑这一手的输赢（情绪）。
   * 名场面（全下赢、反超、诈唬被抓，momentOf）：输的电脑 40% 冲赢家扔个道具或冒表情，赢的电脑 30% 得意（都乘互动性格）；
   * 没有名场面时，赢了或输了 ≥ 20 个大盲的电脑偶尔对对面来一下（after）。每手最多 MOMENT_MAX 次
   */
  afterHand(seats: readonly SeatLike[], bb: number, r: HandResult, log: readonly LogEntry[]): { seat: number; out: Emote }[] {
    const net = new Map<number, number>();
    for (const [s, x] of putIn(log)) net.set(s, -x);
    for (const p of r.pots) for (const w of p.winners) net.set(w.seat, (net.get(w.seat) ?? 0) + w.won);
    if (r.uncalled) net.set(r.uncalled.seat, (net.get(r.uncalled.seat) ?? 0) + r.uncalled.amount);
    const house = (i: number): boolean => seats[i]?.owner === 'house';
    for (const [s, x] of net) if (house(s)) this.result(s, x / bb);
    const m = momentOf(r, log);
    if (m) {
      const outs: { seat: number; out: Emote }[] = [];
      for (const l of m.losers) {
        if (!house(l) || this.rand() >= MOMENT_LOSER_P * funMult(seats[l]!.persona)) continue;
        const tp = TEMPER[seats[l]!.persona] ?? TEMPER[0]!;
        const prop = tp.props.find((x) => HOSTILE.includes(x)) ?? 'tomato';
        outs.push({ seat: l, out: this.pick<Emote>([[{ prop, to: m.winner }, 3], [{ sticker: 'angry' }, 1], [{ sticker: 'cry' }, 1], [{ sticker: 'shock' }, 1]]) });
      }
      if (house(m.winner) && this.rand() < MOMENT_WINNER_P * funMult(seats[m.winner]!.persona)) outs.push({ seat: m.winner, out: this.pick<Emote>([[{ sticker: 'smug' }, 3], [{ sticker: 'cool' }, 2]]) });
      if (outs.length) {
        const t = this.now();
        this.lastTable = t;
        for (const o of outs) this.lastSeat.set(o.seat, t);
        return outs.slice(0, MOMENT_MAX);
      }
    }
    const ranked = [...net].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
    const top = ranked[0];
    const bottom = ranked[ranked.length - 1];
    if (!top || !bottom || top[0] === bottom[0]) return [];
    const big = 20 * bb;
    const [seat, won, other] = house(top[0]) && top[1] >= big ? [top[0], true, bottom[0]] : house(bottom[0]) && -bottom[1] >= big ? [bottom[0], false, top[0]] : [-1, false, -1];
    if (seat < 0) return [];
    const out = this.after({ seat, persona: seats[seat]!.persona }, won, other);
    return out ? [{ seat, out }] : [];
  }

  /**
   * 真人 slow 想了 AI_URGE_MS 以上：桌上的电脑里挑一个出来催（话多、性子急的多），扔炸弹或者说"快点吧"。
   * 一个决定点只催一次由调用方管；这里只管冷却
   */
  urge(slow: number, house: readonly Seat[]): { from: number; out: Emote } | null {
    const t = this.now();
    if (t - this.lastTable < TABLE_GAP_MS) return null;
    const ready = house.filter((s) => s.seat !== slow && t - (this.lastSeat.get(s.seat) ?? -Infinity) >= SEAT_GAP_MS && (TEMPER[s.persona]?.urge ?? 0) > 0);
    if (!ready.length) return null;
    const who = this.pick<Seat>(ready.map((s) => [s, TEMPER[s.persona]!.urge]));
    this.lastTable = t;
    this.lastSeat.set(who.seat, t);
    return {
      from: who.seat,
      out: this.pick<Emote>([
        [{ prop: 'bomb', to: slow }, 3],
        [{ taunt: T('快点吧，花都谢了'), to: slow }, 3],
        [{ taunt: T('别墨迹，全下吧'), to: slow }, 1],
      ]),
    };
  }

  private one(xs: readonly string[]): string {
    return xs[Math.floor(this.rand() * xs.length)]!;
  }

  /** 按权重挑一个 */
  private pick<X>(xs: readonly (readonly [X, number])[]): X {
    const total = xs.reduce((a, [, w]) => a + w, 0);
    let r = this.rand() * total;
    for (const [x, w] of xs) if ((r -= w) < 0) return x;
    return xs[xs.length - 1]![0];
  }
}

/**
 * 这一手是不是名场面（docs/table-fun.md 第 4 节，德州：全下赢、反超、诈唬被抓），只看摊牌亮出来的牌和操作记录。
 * 主池只有一个赢家才算（平分了没有"赢家"可冲）；losers 是亮了牌、没赢主池的
 */
export function momentOf(r: HandResult, log: readonly LogEntry[]): { winner: number; losers: number[] } | null {
  if (r.byFold || r.shown.length < 2) return null;
  const main = r.pots[0]?.winners ?? [];
  if (main.length !== 1) return null;
  const winner = main[0]!.seat;
  const losers = r.shown.map((x) => x.seat).filter((x) => x !== winner);
  const allin = r.shown.some((x) => log.some((e) => e.seat === x.seat && e.allin && e.act !== 'sb' && e.act !== 'bb'));
  const caught = r.shown.some((x) => x.seat !== winner && bluffer(log, x.seat, categoryOf(x.value)));
  return allin || caught || riverTurnaround(r) === winner ? { winner, losers } : null;
}
