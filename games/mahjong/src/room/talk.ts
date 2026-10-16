/**
 * 好友房里电脑的互动（DESIGN.md 第 6 节）：和单机同一份 game/banter.ts，由房间发（kit 的 botEmote），所有人看到的一样。
 * - 主动：房间每一步之后（kit 的 onStep）对比上一步的公开统计，认出新的胡、杠、一局结完，交给 Banter；
 * - 回应：真人冲电脑发了东西（kit 的 onEmote），被冲着的电脑按性格回一下。
 * 为什么不直接看 g.events：电脑连着出手时 kit 一批推好几步，onStep 只看得到最后一步的事件，中间的胡会漏掉。
 * 只在内存里记上一步的样子，不写存储：房间被驱逐了就从下一步重新记（漏一两句不要紧）。好友房里电脑不催人（房间只有一个闹钟，不为这个另设）。
 * 只读公开的东西（谁胡了、点炮的是谁、几番、杠了几次、每局输赢），不读手牌；真人发的东西只用来回这一句，不记下来，电脑出牌也读不到。
 */
import { PERSONAS } from '../ai/personas.ts';
import { Banter, type Act, type Cast, type Moment } from '../game/banter.ts';
import type { XzState } from '../core/variants/sichuan-xuezhan/rules.ts';
import type { RoomState } from './rules.ts';

interface Seen {
  n: number;
  round: number;
  won: boolean[];
  gangs: number[];
  rounds: number;
}

export class RoomTalk {
  private readonly banter: Banter;
  private seen: Seen | null = null;
  private cast: Cast = [];

  constructor(seed: number) {
    this.banter = new Banter(seed);
  }

  /** 房间走了一步：新的公开的事 → 电脑发的 */
  step(s: RoomState, now: number): Act[] {
    const ms = this.watch(s);
    return ms.length ? this.banter.moments(this.cast, ms, now) : [];
  }

  /** 和上一步比，新出了哪些公开的事（同一步再调一次是空的） */
  watch(s: RoomState): Moment[] {
    const g = s.g as XzState;
    if (!g?.players || s.n === this.seen?.n) return [];
    this.cast = s.kinds.map((k, i) => (k === 'ai' ? (PERSONAS[g.personas[i]!] ?? null) : null));
    const prev = this.seen;
    this.seen = { n: s.n, round: g.round, won: g.players.map((p) => p.won !== null), gangs: g.stats.map((x) => x.gangs), rounds: g.history.length };
    if (!prev) return [];
    const ms: Moment[] = [];
    // 一局结完：上一局里还没看到的胡已经在小结里了
    const ended = g.history.length > prev.rounds ? g.history.at(-1) : undefined;
    if (ended) {
      for (const w of ended.wins) if (ended.round !== prev.round || !prev.won[w.seat]) ms.push({ k: 'hu', seat: w.seat, from: w.from, fan: w.fan });
      ms.push({ k: 'round', net: ended.net, chips: g.chips, share: g.share });
    } else if (g.round === prev.round) {
      g.players.forEach((p, i) => {
        if (p.won && !prev.won[i]) ms.push({ k: 'hu', seat: i, from: p.won.from, fan: p.won.fan });
      });
    }
    g.stats.forEach((x, i) => {
      if (x.gangs > (prev.gangs[i] ?? 0)) ms.push({ k: 'kan', seat: i });
    });
    return ms;
  }

  /** 真人 from 冲 to 发了 id：被冲着的电脑回一下（按上一步的座位） */
  reply(from: number, id: number, to: number | undefined, now: number): Act | null {
    return this.banter.reply(this.cast, from, id, to, now);
  }
}

/** 房间号 → 种子（同一个房间同一串事说同样的话，测试好复现） */
export function talkSeed(ref: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < ref.length; i++) h = Math.imul(h ^ ref.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}
