/**
 * 牌桌互动接 arcade-kit/table-fun（0.12.0，仓库根 docs/table-fun.md 第 0 节）：掼蛋只管三件事——短语表、电脑的互动性格、
 * 把自己的公开事件认成 kit 的名场面。电脑怎么反应（概率、冷却、回扔）全在 kit 的 botReact，页面（单机）和房间（好友房）共用这一份。
 *
 * 只看公开事件（谁出了什么、压了谁、谁出完了、是不是双下）；电脑的出牌决策（src/ai）完全不读这里。
 * 座位用调用方的编号（单机是画面座位，我 = 0；房间里是真实座位），同一次调用里一致就行。
 */
import type { FunBot, FunEvent, FunMood, FunTemper } from 'arcade-kit/fun-logic';
import { isBomb, type DealResult, type GameEvent } from '../core/index.ts';
import type { PersonaId } from '../ai/index.ts';
import { EMOTES, TAUNTS } from '../../../net/emotes.ts';

/** kit 的短语表：客气话在前、嘲讽在后，编号和房间转发的 emote 一致（表情从 20 起、道具从 32 起，emotes.ts） */
export const PHRASES: readonly string[] = [...EMOTES, ...TAUNTS];

/** 互动性格：阿强爱闹、老张普通、小美高冷（概率的倍数在 kit：×1.5 / ×1 / ×0.3） */
export const TEMPER: Record<PersonaId, FunTemper> = { laozhang: 'normal', xiaomei: 'cool', aqiang: 'rowdy' };

/**
 * 电脑表情旁那句话（kit 的 moodLines）：掼蛋的说法——炸弹、头游、进贡、接风、双下。kit 按情绪挑一句，
 * 被扔了回应、名场面起哄都用它；只说牌局，不说人（同 emotes.ts 的嘲讽）
 */
export const MOOD_LINES: Record<FunMood, readonly string[]> = {
  angry: ['炸我？等着瞧', '这一墩我记下了', '下把专门炸你', '别得意，级还没过呢', '有本事接着出'],
  sweat: ['手滑了手滑了', '这手牌没法打', '贡都快进不起了', '别扔了，给条活路', '让我缓一手'],
  love: ['够意思！', '谢了搭档', '这配合，稳', '收下了，回头还你', '接风接得漂亮'],
  smug: ['就这？', '炸弹准备好了', '头游拿了，承让', '谢谢送分', '这把你们没戏', '还贡记得挑张好的'],
  shock: ['这也能炸？', '天王炸都出来了', '好家伙，同花顺', '这都能接风？', '藏得够深啊'],
  cry: ['又被双下了', '这贡进得心疼', '末游背锅了', '服了，下副再来', '炸弹全白攒了'],
};

type Moment = Extract<FunEvent, { kind: 'moment' }>;

const team = (s: number): number => s % 2;
/** 一队的两个座位，先放 first（炸的人、头游） */
const teamOf = (first: number): number[] => [first, (first + 2) % 4];
const others = (s: number): number[] => [(s + 1) % 4, (s + 3) % 4];

/**
 * 这一手压下去的是谁的牌：出牌记录里这一手之前最近一手有牌的（领出时是上一墩的，算不上"压"，
 * 但那手一定是自己人或自己出的，炸弹只看压了对方，所以不会误认）。history 里最后一条是这一手本身
 */
export function victimOf(history: readonly { seat: number; play: unknown }[]): number {
  for (let i = history.length - 2; i >= 0; i--) if (history[i]!.play) return history[i]!.seat;
  return -1;
}

/**
 * 一手牌、一个名次之后的名场面：炸弹压了对方（被炸的是输家）、头游（对方两家是输家）。hand 是第几副（kit 按它算每手的上限）。
 * 不是名场面回 null
 */
export function momentOf(e: GameEvent, victim: number, hand: number): Moment | null {
  if (e.type === 'play' && isBomb(e.play) && victim >= 0 && team(victim) !== team(e.seat)) {
    return { kind: 'moment', moment: 'bomb', winners: teamOf(e.seat), losers: [victim], hand };
  }
  if (e.type === 'finish' && e.place === 1) return { kind: 'moment', moment: 'first-out', winners: teamOf(e.seat), losers: others(e.seat), hand };
  return null;
}

/** 一副结束：双下是名场面（赢的一队按出完的先后排） */
export function dealMoment(r: DealResult): Moment | null {
  if (!r.doubleDown) return null;
  const winners = r.order.filter((s) => team(s) === r.winnerTeam);
  const losers = [0, 1, 2, 3].filter((s) => team(s) !== r.winnerTeam);
  return { kind: 'moment', moment: 'double-down', winners, losers, hand: r.dealNo };
}

/** 单机：我想了多久以后，爱闹的电脑可能扔个"催促炸弹"过来 */
export const URGE_AFTER_MS = 8000;
/** 爱闹的电脑到点扔的概率（0.11.x 以前 banter 的 min(0.95, 1 × 1.5)） */
export const URGE_P = 0.95;

/**
 * 单机里电脑催人：轮到真人、他想了 URGE_AFTER_MS 以上，爱闹的电脑按 URGE_P 扔一次催促炸弹，这一手（key）最多判一次。
 * 返回扔的那个电脑的座位，不扔回 null。st 由调用方存（记着判过的那一手）
 */
export function slowUrge(st: { key: string }, key: string, ms: number, bots: readonly FunBot[], rand: () => number): number | null {
  if (st.key === key || ms < URGE_AFTER_MS) return null;
  const b = bots.find((x) => x.temper === 'rowdy');
  if (!b) return null;
  st.key = key;
  return rand() < URGE_P ? b.seat : null;
}
