/**
 * 电脑的互动（DESIGN.md 第 6 节）：什么时候发短语、表情、道具，冲谁发。单机在页面上跑，好友房由房间经 kit 的 botEmote 发（同一份代码）。
 * 公平底线：
 * - 只看公开的事（谁胡了、谁点炮、谁杠了、一局的输赢、谁冲谁发了什么），不看任何人的手牌；
 * - 反过来，电脑出牌（src/ai）绝不读这里，也不读真人发的东西（test/arch.test.ts 检查 import）；
 * - 只说牌局不说人（短语见 view/text.ts 的 PHRASES）。
 * 发不发由话多不多（talk）、脾气（temper）定，每个电脑有冷却，不刷屏。"随机"是种子和次数算出来的哈希：同一个种子同一串事得到同样的结果，测试能复现。
 */
import type { Persona } from '../ai/personas.ts';
import type { FanId } from '../core/variants/sichuan-xuezhan/fan.ts';
import type { XzEvent } from '../core/variants/sichuan-xuezhan/rules.ts';
import { PROP_BASE, STICKER_BASE } from './emotes.ts';

/** 同一个电脑两次互动至少隔这么久 */
export const COOL_MS = 8_000;
/** 单机里真人想了这么久，急性子的电脑催一下（催促炸弹的门槛是 8 秒，这里更宽一点） */
export const AI_URGE_MS = 12_000;
/** 被扔后回应的概率、回应里直接回敬的比例（千分比，再乘互动性格） */
const REACT_CHANCE = 600;
const REVENGE_CHANCE = 250;
/** 每个电脑回敬的限额：这么久里最多这么多次 */
const REVENGE_WINDOW_MS = 20_000;
const REVENGE_MAX = 2;
/** 名场面：输家冲赢家扔、赢家得意的概率；每手电脑主动互动的上限 */
const SCENE_LOSER = 400;
const SCENE_WINNER = 300;
const HAND_MAX = 2;
const FUN_MULT = { lively: 1.5, normal: 1, cool: 0.3 } as const;

// kit 的 STICKERS、PROPS 顺序（game/emotes.ts 说明为什么不 import kit 的 fun），test/emotes.test.ts 对得上
const STICKER = { smug: 0, doge: 1, cry: 2, sweat: 3, shock: 4, sly: 5, love: 6, angry: 7, sleep: 8, clap: 9, lol: 10, cool: 11 } as const;
const PROP = { tomato: 0, egg: 1, stinkyEgg: 2, slipper: 3, bomb: 4, rose: 5, like: 6, cheers: 7 } as const;
export const stickerId = (s: keyof typeof STICKER): number => STICKER_BASE + STICKER[s];
export const propId = (s: keyof typeof PROP): number => PROP_BASE + PROP[s];
/** 脏东西被扔了回什么（PROP 的下标）：番茄还番茄、鸡蛋还拖鞋 */
const REVENGE_OF: Readonly<Record<number, number>> = { 0: 0, 1: 3, 2: 1, 3: 3, 4: 0 };

/** 短语的编号（PHRASES 的下标） */
const SAY = { up: 0, sweet: 1, lucky: 2, pao: 3, calm: 4, kan: 5, hurry: 7, nice: 8, fight: 9, unlucky: 10, good: 12, again: 13 } as const;

/** 冲人发了算挑衅的：番茄、鸡蛋、臭蛋、拖鞋、炸弹，"又点炮了哇""快点嘛""手气背哦""这张你要不要嘛"，得意、狗头、坏笑、笑哭、生气 */
const HOSTILE = new Set<number>([
  ...[SAY.pao, SAY.hurry, SAY.unlucky, 11],
  ...(['smug', 'doge', 'sly', 'lol', 'angry'] as const).map(stickerId),
  ...(['tomato', 'egg', 'stinkyEgg', 'slipper', 'bomb'] as const).map(propId),
]);
/** 冲人发了算捧场的：玫瑰、点赞、干杯，"你娃手气好哦""安逸""好牌，服了"，比心、鼓掌 */
const FRIENDLY = new Set<number>([SAY.lucky, SAY.nice, SAY.good, stickerId('love'), stickerId('clap'), ...(['rose', 'like', 'cheers'] as const).map(propId)]);

/** 电脑的口吻（单机按性格换成 VOICES 里的一句；好友房只发编号，就是那句短语） */
export type Voice = 'hu' | 'pao' | 'kan' | 'pon';

/** 电脑这一下发什么：id 是 emote 编号，to 是冲着哪个座位 */
export interface Act {
  seat: number;
  id: number;
  to?: number;
  voice?: Voice;
  /** 过多久再发（毫秒；被扔后的回应 0.8–2 秒，没有就由调用的人定） */
  after?: number;
}

/** 牌局里刚发生的公开的事 */
export type Moment =
  | { k: 'hu'; seat: number; from: number | null; fan: number; /** 自摸、杠上花、清一色之一 */ scene?: boolean }
  | { k: 'kan'; seat: number }
  | { k: 'pon'; seat: number }
  /** 一局结完：每家这一局的净输赢、现在的筹码 */
  | { k: 'round'; net: readonly number[]; chips: readonly number[]; share: number };

/** 这一步的事件 → 电脑会接话的事（只取公开的字段：暗杠的牌、摸到的牌都不看） */
export function momentsOf(events: readonly XzEvent[]): Moment[] {
  const out: Moment[] = [];
  for (const e of events) {
    if (e.e === 'hu') out.push({ k: 'hu', seat: e.seat, from: e.from, fan: e.fan, scene: e.from === null || e.items.some((x) => x.id === 'gangkai' || x.id === 'qing') });
    else if (e.e === 'kan') out.push({ k: 'kan', seat: e.seat });
    else if (e.e === 'pon') out.push({ k: 'pon', seat: e.seat });
  }
  return out;
}

/** 牌桌上谁是电脑、什么性格（真人是 null） */
export type Cast = readonly (Persona | null)[];

export class Banter {
  private readonly last = new Map<number, number>();
  /** 被扔后上次回应的时间、回敬的时间（20 秒窗口） */
  private readonly revenges = new Map<number, number[]>();
  /** 这一手电脑主动互动了几次 */
  private handActs = 0;
  private n = 0;
  private readonly seed: number;

  /** 座位上坐的是谁每次调用时给（好友房里会换人） */
  constructor(seed: number) {
    this.seed = seed;
  }

  /**
   * 公开的事 → 电脑主动发的（每个电脑一次最多一下，冷却里的不发；每手最多 HAND_MAX 次，一局结完清零）。
   * 名场面（杠、自摸、杠上花、清一色）先过 scene：输家冲赢家扔，赢家得意
   */
  moments(cast: Cast, ms: readonly Moment[], now: number): Act[] {
    const out: Act[] = [];
    let used = this.handActs;
    for (const m of ms) {
      const roundEnd = m.k === 'round';
      const sent: Act[] = [];
      for (let seat = 0; seat < cast.length; seat++) {
        const p = cast[seat];
        if (!p || !this.ready(seat, now) || out.some((a) => a.seat === seat)) continue;
        // 一局结完的话不占名额
        if (!roundEnd && used + sent.length >= HAND_MAX) continue;
        const act = this.scene(m, seat, p) ?? this.react(m, seat, p);
        if (act) {
          sent.push(act);
          this.last.set(seat, now);
        }
      }
      out.push(...sent);
      used = roundEnd ? 0 : used + sent.length;
    }
    this.handActs = used;
    return out;
  }

  /** 名场面里这个电脑的一下：输家 40% 冲赢家扔道具或表情，赢家 30% 得意（再乘性格） */
  private scene(m: Moment, seat: number, p: Persona): Act | null {
    let winner: number;
    let loser: boolean;
    if (m.k === 'kan') [winner, loser] = [m.seat, m.seat !== seat];
    else if (m.k === 'hu' && m.scene) [winner, loser] = [m.seat, m.seat !== seat && (m.from === null || m.from === seat)];
    else return null;
    if (winner === seat) return this.roll(seat, this.fun(p, SCENE_WINNER)) ? { seat, id: stickerId(this.roll(seat, 500) ? 'smug' : 'cool') } : null;
    if (!loser || !this.roll(seat, this.fun(p, SCENE_LOSER))) return null;
    // 扔道具或表情：脾气大的扔番茄、拖鞋，别的哭、流汗
    if (p.temper >= 500 && this.roll(seat, 600)) return { seat, id: propId(this.roll(seat, 500) ? 'tomato' : 'slipper'), to: winner };
    return { seat, id: stickerId(p.temper >= 500 ? 'angry' : this.roll(seat, 500) ? 'sweat' : 'cry') };
  }

  /**
   * from 发了 id、冲着 to：被冲着的电脑回一下。
   * 道具：REACT_CHANCE 回应（脏东西 → 生气、流汗表情或一句短语；玫瑰 → 比心），其中 REVENGE_CHANCE 回敬同类
   * （番茄还番茄、鸡蛋还拖鞋），每个电脑 20 秒内最多回敬 2 次；概率都乘互动性格；0.8–2 秒后发（Act.after）。
   * 短语、表情：真人对大家发的不回（免得一句话招来三个电脑），冲着点名的回怼、装没看见或认怂，按性格。
   */
  reply(cast: Cast, from: number, id: number, to: number | undefined, now: number): Act | null {
    if (to === undefined || to === from) return null;
    const p = cast[to];
    if (!p) return null;
    if (id >= PROP_BASE) return this.replyProp(p, from, id, to, now);
    if (cast[from] || !this.ready(to, now)) return null;
    const hostile = HOSTILE.has(id);
    const friendly = FRIENDLY.has(id);
    // 话少的多半装没看见
    if (!this.roll(to, (friendly || hostile ? p.talk : p.talk / 3) + 150)) return null;
    let act: Act;
    if (friendly) act = this.roll(to, 500) ? { seat: to, id: stickerId('love') } : { seat: to, id: SAY.nice, to: from };
    else if (!hostile) act = { seat: to, id: stickerId(this.roll(to, 500) ? 'doge' : 'lol') };
    // 新手、稳当的认怂（先看这个：板凳儿脾气也大，但被扔了是慌）
    else if (p.level === 0 || p.defense >= 900) act = { seat: to, id: stickerId(p.level === 0 ? 'cry' : 'sweat') };
    else if (p.temper >= 600) act = { seat: to, id: SAY.fight, to: from };
    else if (p.reads >= 900) act = { seat: to, id: this.roll(to, 500) ? stickerId('sly') : SAY.calm, ...(this.roll(to, 500) ? {} : { to: from }) };
    else act = { seat: to, id: stickerId(this.roll(to, 500) ? 'doge' : 'sweat') };
    // 回别人的表情：表情包不带对象（kit 允许，但画面上只有道具和短语用得到）
    if (act.id >= STICKER_BASE && act.id < PROP_BASE) delete act.to;
    act.after = 900;
    this.last.set(to, now);
    return act;
  }

  private replyProp(p: Persona, from: number, id: number, to: number, now: number): Act | null {
    // 每一下都按 60% 掷（规范第 4 节）：不另设间隔——道具本来就有 1.5 秒冷却，再加间隔连着扔就有一半没反应
    if (!this.roll(to, this.fun(p, REACT_CHANCE))) return null;
    const after = 800 + this.pick(to, 1_200);
    const kind = id - PROP_BASE;
    if (!HOSTILE.has(id)) {
      // 善意的道具：玫瑰比心，点赞、干杯比心或鼓掌
      return { seat: to, id: stickerId(kind === PROP.rose || this.roll(to, 500) ? 'love' : 'clap'), after };
    }
    const recent = (this.revenges.get(to) ?? []).filter((t) => now - t < REVENGE_WINDOW_MS);
    this.revenges.set(to, recent);
    if (recent.length < REVENGE_MAX && this.roll(to, this.fun(p, REVENGE_CHANCE))) {
      recent.push(now);
      return { seat: to, id: PROP_BASE + (REVENGE_OF[kind] ?? kind), to: from, after };
    }
    // 不回敬：新手、稳当的慌，脾气大的生气或喊一句，别的流汗
    if (p.level === 0 || p.defense >= 900) return { seat: to, id: stickerId(p.level === 0 ? 'cry' : 'sweat'), after };
    if (p.temper >= 600) return this.roll(to, 500) ? { seat: to, id: stickerId('angry'), after } : { seat: to, id: SAY.fight, to: from, after };
    return { seat: to, id: this.roll(to, 500) ? stickerId('sweat') : SAY.calm, after };
  }

  /** 单机：真人 seat 想了很久，最急的那个电脑催一下（急性子扔炸弹，别的说"快点嘛"）；冷却里的不催 */
  urge(cast: Cast, seat: number, now: number): Act | null {
    let best = -1;
    let score = -1;
    cast.forEach((p, i) => {
      if (!p || i === seat || !this.ready(i, now)) return;
      const s = p.talk + p.temper;
      if (s > score) [best, score] = [i, s];
    });
    if (best < 0) return null;
    const p = cast[best]!;
    this.last.set(best, now);
    return p.temper >= 600 && this.roll(best, 600) ? { seat: best, id: propId('bomb'), to: seat } : { seat: best, id: SAY.hurry, to: seat };
  }

  private ready(seat: number, now: number): boolean {
    const t = this.last.get(seat);
    return t === undefined || now - t >= COOL_MS;
  }

  /** 概率乘上这个电脑的互动性格（爱闹 ×1.5、高冷 ×0.3），封顶千分之千 */
  private fun(p: Persona, chance: number): number {
    return Math.min(1_000, Math.round(chance * FUN_MULT[p.fun]));
  }

  /** 0 到 n-1 的整数（和 roll 同一个哈希） */
  private pick(seat: number, n: number): number {
    return this.hash(seat) % n;
  }

  /** 种子 + 第几次 + 座位的哈希 */
  private hash(seat: number): number {
    let h = (this.seed ^ Math.imul(++this.n, 0x9e3779b1) ^ Math.imul(seat + 1, 0x85ebca6b)) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
    h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }

  /** 千分之 chance 的概率 */
  private roll(seat: number, chance: number): boolean {
    return this.hash(seat) % 1_000 < chance;
  }

  private react(m: Moment, seat: number, p: Persona): Act | null {
    const talk = p.talk;
    if (m.k === 'hu' && m.seat === seat) {
      // 自己胡了：大牌得意（脾气大的点名"又点炮了哇"），小胡说一句
      if (!this.roll(seat, talk * (m.fan >= 2 ? 0.9 : 0.6))) return null;
      if (m.fan >= 2 && m.from !== null && p.temper >= 600 && this.roll(seat, 400)) return { seat, id: SAY.pao, to: m.from };
      if (m.fan >= 2 && this.roll(seat, 500)) return { seat, id: stickerId(p.temper >= 500 ? 'smug' : 'cool') };
      return { seat, id: SAY.nice, voice: 'hu' };
    }
    if (m.k === 'hu' && m.from === seat) {
      // 自己点了炮：脾气大的冲赢家扔番茄，胆小的哭，别的叹一句
      if (!this.roll(seat, talk * 0.6)) return null;
      if ((p.level === 0 || p.defense >= 900) && this.roll(seat, 500)) return { seat, id: stickerId(p.level === 0 ? 'cry' : 'sweat') };
      if (p.temper >= 650 && m.fan >= 2 && this.roll(seat, 500)) return { seat, id: propId('tomato'), to: m.seat };
      return { seat, id: SAY.unlucky, voice: 'pao' };
    }
    if (m.k === 'hu' && m.fan >= 3) {
      // 别人胡了大牌：老练的点名夸一句，别的偶尔鼓掌、吓一跳
      if (p.reads >= 900 && this.roll(seat, 600)) return { seat, id: SAY.good, to: m.seat };
      return this.roll(seat, talk / 4) ? { seat, id: stickerId(this.roll(seat, 500) ? 'clap' : 'shock') } : null;
    }
    if (m.k === 'kan' && m.seat === seat) return this.roll(seat, talk * 0.6) ? { seat, id: SAY.kan, voice: 'kan' } : null;
    if (m.k === 'pon' && m.seat === seat) return this.roll(seat, talk * 0.3) ? { seat, id: SAY.calm, voice: 'pon' } : null;
    if (m.k === 'round') {
      const net = m.net[seat] ?? 0;
      const best = Math.max(...m.net);
      const worst = Math.min(...m.net);
      if (!this.roll(seat, talk * 0.4)) return null;
      // 这一局赢得最多：得意或者装酷
      if (net > 0 && net === best) return { seat, id: stickerId(p.temper >= 500 ? 'smug' : 'cool') };
      // 输得最多：筹码不多了喊"雄起"、脾气大的"血战到底"、别的"下把再来"
      if (net < 0 && net === worst) {
        const low = (m.chips[seat] ?? 0) * 3 <= m.share;
        return { seat, id: low ? SAY.up : p.temper >= 600 ? SAY.fight : SAY.again };
      }
    }
    return null;
  }
}

/** 名场面（一场里值得记一笔的公开时刻）：胡牌横幅和一场的总结算用 */
export type HighlightId = 'multi2' | 'multi3' | 'gangkai' | 'qianggang' | 'tianhu' | 'dihu' | 'haidi' | 'longqidui' | 'qing' | 'jingou' | 'capped';

export interface Highlight {
  id: HighlightId;
  /** 胡的人（一炮多响是点炮的人） */
  seat: number;
  round: number;
}

/** 番型 → 名场面（按这个顺序，一个胡只记最响的那一个） */
const FAN_HIGHLIGHT: [FanId, HighlightId][] = [
  ['tianhu', 'tianhu'],
  ['dihu', 'dihu'],
  ['gangkai', 'gangkai'],
  ['qianggang', 'qianggang'],
  ['haidi', 'haidi'],
  ['longqidui', 'longqidui'],
  ['jingou', 'jingou'],
  ['qing', 'qing'],
];

/** 这一步里的名场面：一炮多响、杠上开花、抢杠、天胡地胡、海底捞月、龙七对、金钩钓、清一色、封顶 */
export function highlightsOf(events: readonly XzEvent[], round: number, cap: number): Highlight[] {
  const out: Highlight[] = [];
  const hus = events.filter((e): e is Extract<XzEvent, { e: 'hu' }> => e.e === 'hu');
  const from = hus[0]?.from;
  if (hus.length >= 2 && from !== null && from !== undefined && hus.every((h) => h.from === from)) out.push({ id: hus.length >= 3 ? 'multi3' : 'multi2', seat: from, round });
  for (const h of hus) {
    const hit = FAN_HIGHLIGHT.find(([f]) => h.items.some((x) => x.id === f));
    if (hit) out.push({ id: hit[1], seat: h.seat, round });
    else if (h.fan >= cap) out.push({ id: 'capped', seat: h.seat, round });
  }
  return out;
}

/** 扔道具的画面账（纯数据，comms 用）：目标保护、连击、回敬 */
export const SHIELD_MS = 10_000;
export const SHIELD_MAX = 6;
export const COMBO_MS = 3_000;
export const REVENGE_MS = 3_000;

export interface HitInfo {
  /** 这人 10 秒里已经被打中 6 次：不播，头像上闪一下护盾 */
  shield: boolean;
  /** 同一个人 3 秒内连续扔同一个目标的第几次（1 = 没连上） */
  combo: number;
  /** 被扔后 3 秒内扔回给对方 */
  revenge: boolean;
}

export class FunTally {
  private readonly hits = new Map<number, number[]>();
  private readonly streak = new Map<string, { n: number; at: number }>();
  private readonly lastHit = new Map<number, { from: number; at: number }>();

  /** from 把一个道具扔向 to；护盾挡下的不算连击和回敬 */
  hit(from: number, to: number, now: number): HitInfo {
    const recent = (this.hits.get(to) ?? []).filter((t) => now - t < SHIELD_MS);
    this.hits.set(to, recent);
    if (recent.length >= SHIELD_MAX) return { shield: true, combo: 1, revenge: false };
    recent.push(now);
    const key = `${from}>${to}`;
    const s = this.streak.get(key);
    const combo = s && now - s.at < COMBO_MS ? s.n + 1 : 1;
    this.streak.set(key, { n: combo, at: now });
    const back = this.lastHit.get(from);
    const revenge = !!back && back.from === to && now - back.at < REVENGE_MS;
    this.lastHit.set(to, { from, at: now });
    return { shield: false, combo, revenge };
  }
}

/** 一个人的发送冷却：道具 1.5 秒，表情、短语 1 秒 */
export const COOL_PROP_MS = 1_500;
export const COOL_TALK_MS = 1_000;
