/**
 * 好友房里电脑的互动（DESIGN.md 第 6 节，docs/table-fun.md 第 0 节）：怎么反应由 kit 的 botReact 定（和单机页面上的 TableFun 同一套数字），
 * 房间只负责认出事情、用 kit 的 botEmote 发出去，所有人看到的一样。
 * - 名场面：房间每一步之后（kit 的 onStep）对比上一步的公开统计，认出新的胡、杠，映射成 kit 的名场面（game/banter.ts），每个电脑座位问一次；
 * - 被扔：真人冲电脑扔道具、点名（kit 的 onEmote），被冲着的电脑按性格回。
 * 为什么不直接看 g.events：电脑连着出手时 kit 一批推好几步，onStep 只看得到最后一步的事件，中间的胡会漏掉。
 * 只在内存里记上一步的样子和电脑的反应账，不写存储：房间被驱逐了就从下一步重新记（漏一两句不要紧）。
 * 房间只有一个闹钟：botReact 给的延迟不用等，立刻发；页面上收到电脑座位发的会自己晚一点再播。
 * 只读公开的东西（谁胡了、点炮的是谁、几番、杠了几次），不读手牌；真人发的东西只用来回这一下，不记下来，电脑出牌也读不到。
 */
import { botEmoteIds, botReact, hitEvent, newBotState, type BotState, type FunEvent, type FunTemper } from 'arcade-kit/fun-logic';
import { PERSONAS } from '../ai/personas.ts';
import { funMoments, type Moment } from '../game/banter.ts';
import { PHRASE_COUNT } from '../game/emotes.ts';
import type { XzState } from '../core/variants/sichuan-xuezhan/rules.ts';
import type { RoomState } from './rules.ts';

interface Seen {
  n: number;
  round: number;
  won: boolean[];
  gangs: number[];
  rounds: number;
}

/** 电脑这一下发什么：座位、emote 编号、冲着谁 */
export interface BotEmote {
  seat: number;
  id: number;
  to?: number;
}

export class RoomTalk {
  private readonly bots: BotState = newBotState();
  private readonly rand: () => number;
  private seen: Seen | null = null;
  /** 每个座位是不是电脑、什么互动性格（真人是 null） */
  private tempers: (FunTemper | null)[] = [];

  /** seed 只为测试能复现：同一个房间同一串事反应一样 */
  constructor(seed: number) {
    this.rand = mulberry(seed);
  }

  /** 房间走了一步：新的名场面 → 电脑发的 */
  step(s: RoomState, now: number): BotEmote[] {
    const ms = this.watch(s);
    if (!ms.length) return [];
    const g = s.g as XzState;
    const out: BotEmote[] = [];
    for (const ev of funMoments(ms, g.players.map((p) => p.won === null), g.round)) {
      this.tempers.forEach((t, seat) => {
        if (t) out.push(...this.act(ev, seat, t, now));
      });
    }
    return out;
  }

  /** 和上一步比，新出了哪些公开的事（同一步再调一次是空的） */
  watch(s: RoomState): Moment[] {
    const g = s.g as XzState;
    if (!g?.players || s.n === this.seen?.n) return [];
    this.tempers = s.kinds.map((k, i) => (k === 'ai' ? (PERSONAS[g.personas[i]!]?.fun ?? 'normal') : null));
    const prev = this.seen;
    this.seen = { n: s.n, round: g.round, won: g.players.map((p) => p.won !== null), gangs: g.stats.map((x) => x.gangs), rounds: g.history.length };
    if (!prev) return [];
    const ms: Moment[] = [];
    // 一局结完：上一局里还没看到的胡已经在小结里了（小结里没有番型，杠上花、清一色认不出，只认自摸）；局中的胡从亮出的手牌认番型
    const ended = g.history.length > prev.rounds ? g.history.at(-1) : undefined;
    if (ended) {
      for (const w of ended.wins) if (ended.round !== prev.round || !prev.won[w.seat]) ms.push({ k: 'hu', seat: w.seat, from: w.from, fan: w.fan });
    } else if (g.round === prev.round) {
      g.players.forEach((p, i) => {
        if (p.won && !prev.won[i]) {
          const ids = p.won.items.map((x) => x.id);
          ms.push({ k: 'hu', seat: i, from: p.won.from, fan: p.won.fan, gangkai: ids.includes('gangkai'), qing: ids.includes('qing') });
        }
      });
    }
    g.stats.forEach((x, i) => {
      if (x.gangs > (prev.gangs[i] ?? 0)) ms.push({ k: 'kan', seat: i });
    });
    return ms;
  }

  /** 真人 from 冲 to 发了 id：被冲着的电脑按性格回（按上一步的座位） */
  reply(from: number, id: number, to: number | undefined, now: number): BotEmote[] {
    const ev = hitEvent(id, PHRASE_COUNT, from, to);
    const t = ev ? this.tempers[ev.to] : null;
    return ev && t ? this.act(ev, ev.to, t, now) : [];
  }

  private act(ev: FunEvent, seat: number, temper: FunTemper, now: number): BotEmote[] {
    const a = botReact(ev, { seat, temper }, this.bots, now, this.rand);
    return a ? botEmoteIds(a, PHRASE_COUNT).map((e) => ({ seat: a.from, ...e })) : [];
  }
}

/** 房间号 → 种子 */
export function talkSeed(ref: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < ref.length; i++) h = Math.imul(h ^ ref.charCodeAt(i), 0x01000193) >>> 0;
  return h;
}

/** 一个小的带种子随机数（只给画面层的反应用，不进牌局） */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}
