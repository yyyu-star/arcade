/** 给玩家看的短文字：牌型名、名次、座位名。只做"翻译"，不算规则。 */
import { PLAY_TYPE_NAMES, rankName, type Play } from '../variants/guandan/core/index.ts';
import { PERSONAS, type AvatarId } from './art/index.ts';
import type { PersonaId } from '../variants/guandan/ai/index.ts';

/** 中央显示的牌型名：炸弹带张数，例如"炸弹×6"。 */
export function playLabel(p: Play): string {
  if (p.type === 'bomb') return `炸弹×${p.cards.length}`;
  if (p.type === 'triple') return '三张';
  return PLAY_TYPE_NAMES[p.type];
}

/** 一手牌的简短说明（选择逢人配解释时用），例如"顺子 到 7""三带二 8带5"。 */
export function playDetail(p: Play): string {
  const r = rankName(p.rank);
  switch (p.type) {
    case 'straight':
    case 'straightFlush':
      return `${playLabel(p)} 到${r}`;
    case 'tube':
      return `三连对 到${r}`;
    case 'plate':
      return `钢板 到${r}`;
    case 'fullHouse':
      return `三带二 ${r}带${rankName(p.extra)}`;
    case 'jokerBomb':
      return '天王炸';
    default:
      return `${playLabel(p)} ${r}`;
  }
}

export const PLACE_NAMES = ['头游', '二游', '三游', '末游'];

/** 级数显示：2..10、J、Q、K、A。 */
export function levelName(lv: number): string {
  return rankName(lv);
}

/** 赢下整局要做到的（0.25.0）：完整是"过 A"，短局是"打到 10"（终点按规则核心的 endLevelOf） */
export function goalWord(endLevel: number): string {
  return endLevel >= 14 ? '过 A' : `打到 ${levelName(endLevel)}`;
}

export type SeatId = AvatarId;
/** 座位 → 人物：0 我（下）、1 下家老张（右）、2 对家小美（上）、3 上家阿强（左）。 */
const SEAT_PERSON: readonly SeatId[] = ['me', 'laozhang', 'xiaomei', 'aqiang'];
/** 斗地主（牌馆 0.28.0）：0 我、1 下家老周（右）、2 上家王姐（左） */
export const DDZ_SEAT_PERSON: readonly SeatId[] = ['me', 'laozhou', 'wangjie'];

/** 这张桌子的座位 → 人物（掼蛋的牌桌用默认的，斗地主的牌桌建起来时换成 DDZ_SEAT_PERSON，离开时换回来） */
let seatPersons: readonly SeatId[] = SEAT_PERSON;

export function setTablePersons(list: readonly SeatId[] | null): void {
  seatPersons = list ?? SEAT_PERSON;
}

/**
 * 联机时座位上坐的是谁（画面座位号，我 = 0）：真人用昵称、头像统一用"你"那张；电脑是老张、小美、阿强，
 * 按真实座位定（0.7.0 起，和房间里电脑的打法同一份 SEAT_PERSONA），每个人屏幕上同一个电脑叫同一个名字。
 * 单机时全是 null，照旧按固定人物。由联机会话（net.ts）在每次收到房间信息时更新。
 */
export interface SeatIdentity {
  human: boolean;
  name: string;
  /** 真人掉线了（座位还留着） */
  away: boolean;
  /** 掉线太久，电脑在代打 */
  auto: boolean;
  /** 人还连着但走开了，房间每手几秒就替他出（0.6.3） */
  afk?: boolean;
  /** 电脑座位：是哪个人物 */
  persona?: PersonaId;
}
export const seatIdentity: (SeatIdentity | null)[] = [null, null, null, null];

/**
 * 旁观（0.13.0，docs/social.md 1.4）：好友房开打后没坐下的人看牌桌，画面座位 0 是真实的 0 号座位上的人，不是"你"。
 * 由联机会话跟着座位更新；单机一直是 false
 */
let watching = false;

export function setWatching(on: boolean): void {
  watching = on;
}

export function isWatching(): boolean {
  return watching;
}

export function setSeatIdentities(list: (SeatIdentity | null)[]): void {
  for (let i = 0; i < 4; i++) seatIdentity[i] = list[i] ?? null;
}

/** 头像用哪个人物：联机的真人一律用"你"那张，名字区分 */
export function seatPerson(seat: number): SeatId {
  const who = seatIdentity[seat];
  return who?.human ? 'me' : (who?.persona ?? seatPersons[seat]!);
}

export function seatName(seat: number): string {
  const full = fullSeatName(seat);
  // 平台昵称可能很长：画面上一律最多 NAME_MAX 个字，多了截短加"…"，名牌、结算表、句子里都排得下
  const chars = [...full];
  return chars.length > NAME_MAX ? `${chars.slice(0, NAME_MAX - 1).join('')}…` : full;
}

/** 画面上的名字最多几个字（seatName 截短用） */
export const NAME_MAX = 7;

/** 不截短的名字：只给认人、取全名用，不往画面上放 */
export function fullSeatName(seat: number): string {
  if (seat === 0 && !watching) return '你';
  const who = seatIdentity[seat];
  if (who?.human) return who.name;
  return PERSONAS[seatPerson(seat) as Exclude<SeatId, 'me'>].name;
}
