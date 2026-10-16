/**
 * 电脑的互动（0.6.0，DESIGN.md 13.5）：被真人扔东西、点名时回应，一手打完按公开发生的事主动发一句、扔个道具，真人想太久时催一下。
 * 只在画面层，用 Math.random（可以换成别的，测试里换）：好友房里各台设备看到的可以不一样，和电脑说话（talk.ts）一样。
 * 电脑的出牌决定（src/ai）不引用这里、也拿不到这里的任何东西：互动不影响它怎么打（test/arch.test.ts 查）。
 * 触发只看公开的事（谁对谁扔了什么、谁赢了谁的大池子、轮到谁想了多久）；嘲讽只说牌局，不说人。
 */
import type { PropId, StickerId } from 'arcade-kit/fun';
import { TAUNTS } from './fun.ts';
import { CHATTY } from './talk.ts';

/** 电脑这一下做什么：说一句（冒泡）、做个表情、发一句嘲讽短语（可以点名）、对谁扔个道具 */
export type Out = { say: string } | { sticker: StickerId } | { taunt: number; to?: number } | { prop: PropId; to: number };

/** 真人对电脑做了什么：嘲讽短语、表情、道具 */
export type Poke = { taunt: number } | { sticker: StickerId } | { prop: PropId };

const T = (s: (typeof TAUNTS)[number]): number => TAUNTS.indexOf(s);
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

/** 被招惹后多久回（毫秒，像人：看一眼再回） */
export const REPLY_DELAY: readonly [number, number] = [600, 1_500];
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
  private lastTable = -Infinity;
  /** 每个电脑这一场的情绪：最近输赢（大盲）的滑动和，正的是顺、负的是背 */
  private mood = new Map<number, number>();

  private rand: () => number;
  private now: () => number;

  constructor(rand: () => number = Math.random, now: () => number = () => performance.now()) {
    this.rand = rand;
    this.now = now;
  }

  /** 换桌、换人：全清 */
  clear(): void {
    this.lastSeat.clear();
    this.lastTable = -Infinity;
    this.mood.clear();
  }

  /** 一手打完：这个座位这一手净输赢多少个大盲（公开的：筹码变化） */
  result(seat: number, bb: number): void {
    const m = (this.mood.get(seat) ?? 0) * 0.7 + bb;
    this.mood.set(seat, Math.max(-200, Math.min(200, m)));
  }

  /**
   * 真人 from 对电脑 who 做了 poke：回什么（不回就 null）。话多的回得勤；顺的时候更爱回怼、少认怂，背的时候爱赌的更冲、胆小的更怂
   */
  react(who: Seat, from: number, poke: Poke): Out | null {
    const t = this.now();
    if (t - (this.lastSeat.get(who.seat) ?? -Infinity) < SEAT_GAP_MS) return null;
    const chatty = (CHATTY[who.persona] ?? 300) / 1000;
    const tp = TEMPER[who.persona] ?? TEMPER[0]!;
    const friendly = 'prop' in poke ? !HOSTILE.includes(poke.prop) : 'sticker' in poke ? poke.sticker === 'love' || poke.sticker === 'clap' : poke.taunt === T('好牌，服了');
    // 被点名、被扔东西的回得多；只是冲他做个表情的少回
    const p = ('sticker' in poke ? 0.2 : 0.45) + chatty * 0.5;
    if (this.rand() >= p) return null;
    this.lastSeat.set(who.seat, t);
    if (friendly) return this.pick<Out>([[{ sticker: 'love' }, 3], [{ sticker: 'clap' }, 2], [{ prop: 'cheers', to: from }, 2], [{ say: '谢谢' }, 1]]);
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
    if (kind === 'back') {
      const prop = tp.props[Math.floor(this.rand() * tp.props.length)]!;
      const echo = 'prop' in poke ? poke.prop : prop;
      return this.pick<Out>([
        [{ prop: echo, to: from }, 3],
        [{ prop, to: from }, 2],
        [{ taunt: T('就这？'), to: from }, 2],
        [{ taunt: T('跟啊，怕了？'), to: from }, 1],
        [{ taunt: T('下一把轮到我了'), to: from }, 1],
      ]);
    }
    if (kind === 'meek') return this.pick<Out>([[{ sticker: 'sweat' }, 2], [{ sticker: 'cry' }, 1], [{ say: this.one(tp.meekSay) }, 3]]);
    // 装没看见：多半什么都不说，偶尔打个哈欠、嘀咕一句
    return this.pick<Out | null>([[null, 3], [{ sticker: 'sleep' }, 2], [{ say: this.one(tp.shrugSay) }, 2]]);
  }

  /**
   * 一手打完，电脑主动来一下（只看公开的结果）：赢了别人的大池子得意（点名"谢谢老板"、扔个干杯），
   * 输了大池子不服（点名"运气而已"、"再来！"）。won：这个电脑是赢的那个；other：对面（输给它的、赢了它的那个座位，没有就 null）
   */
  after(seat: Seat, won: boolean, other: number | null): Out | null {
    const t = this.now();
    if (t - this.lastTable < TABLE_GAP_MS || t - (this.lastSeat.get(seat.seat) ?? -Infinity) < SEAT_GAP_MS) return null;
    const chatty = (CHATTY[seat.persona] ?? 300) / 1000;
    if (this.rand() >= chatty * 0.5) return null;
    this.lastTable = t;
    this.lastSeat.set(seat.seat, t);
    const tp = TEMPER[seat.persona] ?? TEMPER[0]!;
    if (won)
      return this.pick<Out>(
        other === null
          ? [[{ sticker: 'smug' }, 2], [{ taunt: T('手气来了挡不住') }, 1]]
          : [[{ taunt: T('谢谢老板'), to: other }, 3], [{ prop: 'cheers', to: other }, 1], [{ taunt: T('就这？'), to: other }, tp.back]],
      );
    return this.pick<Out>(
      other === null
        ? [[{ sticker: 'angry' }, tp.back], [{ sticker: 'cry' }, tp.meek]]
        : [[{ taunt: T('运气而已，别骄傲'), to: other }, 2], [{ taunt: T('再来！'), to: other }, 2], [{ prop: 'like', to: other }, tp.shrug / 3]],
    );
  }

  /**
   * 真人 slow 想了 AI_URGE_MS 以上：桌上的电脑里挑一个出来催（话多、性子急的多），扔炸弹或者说"快点吧"。
   * 一个决定点只催一次由调用方管；这里只管冷却
   */
  urge(slow: number, house: readonly Seat[]): { from: number; out: Out } | null {
    const t = this.now();
    if (t - this.lastTable < TABLE_GAP_MS) return null;
    const ready = house.filter((s) => s.seat !== slow && t - (this.lastSeat.get(s.seat) ?? -Infinity) >= SEAT_GAP_MS && (TEMPER[s.persona]?.urge ?? 0) > 0);
    if (!ready.length) return null;
    const who = this.pick<Seat>(ready.map((s) => [s, TEMPER[s.persona]!.urge]));
    this.lastTable = t;
    this.lastSeat.set(who.seat, t);
    return {
      from: who.seat,
      out: this.pick<Out>([
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
