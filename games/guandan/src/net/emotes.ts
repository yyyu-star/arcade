/**
 * 好友房的快捷互动（arcade-kit 0.6.0 起的 emotes）：房间只转发编号，内容在这里和页面里定。编号只能往后加、不能改顺序或删：
 * 正在打的房间和新旧页面靠编号对上。
 *
 * - 0–7 短语（0.5.5）：朋友间的客气话；
 * - 8–19 嘲讽（0.6.0）：只说牌局和打法，不说人（不涉及长相、家人、地域、性别，不带脏字）；
 * - 20–31 表情包：arcade-kit/fun 的 STICKERS 按下标；
 * - 32–39 互动道具：arcade-kit/fun 的 PROPS 按下标（扔向某人，带 to）。
 * 所有人一样、免费，不能买、不和筹码挂钩，不影响对局。
 */
export const EMOTES = ['好牌！', '漂亮！', '配合得好', '快点吧', '别急，慢慢想', '这把稳了', '手滑了', '服了'] as const;

export const TAUNTS = [
  '就这？',
  '炸弹准备好了',
  '对家靠你了',
  '这把你们没戏',
  '手气而已，别骄傲',
  '谢谢送分',
  '等着瞧',
  '这牌也敢出？',
  '稳住，我们能赢',
  '别藏了，炸吧',
  '这是在送分吧',
  '等得花都谢了',
] as const;

const TAUNT_BASE = EMOTES.length;
export const STICKER_BASE = TAUNT_BASE + TAUNTS.length;
export const STICKER_COUNT = 12;
export const PROP_BASE = STICKER_BASE + STICKER_COUNT;
export const PROP_COUNT = 8;
/** 房间的 RoomGame.emotes */
export const EMOTE_COUNT = PROP_BASE + PROP_COUNT;

export type Emote = { kind: 'phrase' | 'taunt'; text: string } | { kind: 'sticker'; index: number } | { kind: 'prop'; index: number };

export function emoteOf(id: number): Emote | null {
  if (!Number.isInteger(id) || id < 0 || id >= EMOTE_COUNT) return null;
  if (id < TAUNT_BASE) return { kind: 'phrase', text: EMOTES[id]! };
  if (id < STICKER_BASE) return { kind: 'taunt', text: TAUNTS[id - TAUNT_BASE]! };
  if (id < PROP_BASE) return { kind: 'sticker', index: id - STICKER_BASE };
  return { kind: 'prop', index: id - PROP_BASE };
}

/** 嘲讽短语的编号 */
export const taunt = (text: (typeof TAUNTS)[number]): number => TAUNT_BASE + TAUNTS.indexOf(text);
