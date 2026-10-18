/**
 * 牌桌互动（DESIGN.md 第 6 节）：整套用 kit 的 `arcade-kit/table-fun`（docs/table-fun.md 第 0 节）——点头像菜单、互动面板、表情菜单、首次提示、
 * 冷却护盾连击回敬、单机电脑的反应、名场面横幅都在 kit 里，三个牌桌游戏一模一样。这里只接线：
 * 头像在哪、谁是电脑、什么性格（牌桌给），手牌和按钮不能盖，"互动"按钮的位置（牌桌上一个空位 .fun-slot），发送通道，本游戏的短语和电脑的口头禅。
 * 底线不变：人人一样、免费，不挂筹码；只是画面和声音，不停计时；电脑出牌读不到这里任何东西。
 */
import { playFunSound } from 'arcade-kit/fun';
import { TableFun, type ChatResultLike, type FunSeat, type RectLike } from 'arcade-kit/table-fun';
import { audioOut } from './sound.ts';
import { MOOD_LINES, PHRASES } from './text.ts';

/** 总开关"互动：开 / 不看"：关了别人的一律不播，单机电脑也不反应 */
export const OFF_KEY = 'mahjong.comms';
/** 好友房聊天"聊天：开 / 不看"（0.19.0）：关了别人说的不显示，自己还能说 */
export const CHAT_OFF_KEY = 'mahjong.chatOff';
/** 头像菜单里的 3 句点名短语："又点炮了哇""快点嘛，花儿都谢了""好牌，服了" */
const NAMED = [3, 7, 12] as const;

export interface FunWiring {
  seats(): readonly (FunSeat | null)[];
  avoid(): readonly DOMRect[];
  button(): DOMRect | null;
  send(id: number, to?: number): void;
  canSend(): boolean;
  /** 房间码；单机 'solo' */
  scope(): string;
  /** 单机：电脑的反应在页面上算 */
  localBots: boolean;
  onHit?(seat: number): void;
  /** 首次"点头像扔道具"的提示冒在哪个座位；null = 现在别冒（kit 0.17.0，过 2 秒再问） */
  hintSeat?(): number | null;
  /** 聊天（kit 0.18.0 好友房、0.18.1 单机的 localChat） */
  chat?(text: string): ChatResultLike;
  /** 聊天的摆放（kit 0.19.0）：中间信息区、电脑版聊天框、手机版"聊天"按钮、弹幕区 */
  center(): RectLike[];
  chatDock(): RectLike | null;
  chatButton(): RectLike | null;
  danmakuArea(): RectLike | null;
}

export function createFun(w: FunWiring): TableFun {
  return new TableFun({
    storageKey: 'mahjong',
    phrases: PHRASES,
    named: NAMED,
    seats: w.seats,
    avoid: w.avoid,
    button: w.button,
    send: w.send,
    canSend: w.canSend,
    enabled: () => !funOff(),
    scope: w.scope,
    localBots: w.localBots,
    moodLines: MOOD_LINES,
    sound: (prop, phase) => {
      const a = audioOut();
      if (a) playFunSound(a.ctx, a.out, prop, phase);
    },
    ...(w.onHit ? { onHit: w.onHit } : {}),
    ...(w.hintSeat ? { hintSeat: w.hintSeat } : {}),
    // 设置里"聊天：不看"只管别人说的（自己说的照常显示），和"互动"分开
    ...(w.chat ? { chat: w.chat, chatEnabled: () => !chatOff() } : {}),
    center: w.center,
    chatDock: w.chatDock,
    chatButton: w.chatButton,
    danmakuArea: w.danmakuArea,
    // 省内存设备（art.ts 写的 data-lite）弹幕默认关；弹幕开关存在 kit 默认的 mahjong.chat
    lite: () => document.documentElement.dataset.lite === '1',
    // 冒烟看流水（开发服务器上才挂到 window）
    ...(import.meta.env.DEV ? { log: (line: string) => ((window as { __funLog?: string[] }).__funLog ??= []).push(line) } : {}),
  });
}

export function funOff(): boolean {
  try {
    return localStorage.getItem(OFF_KEY) === '1';
  } catch {
    return false;
  }
}

export function setFunOff(off: boolean): void {
  try {
    if (off) localStorage.setItem(OFF_KEY, '1');
    else localStorage.removeItem(OFF_KEY);
  } catch {
    // 存不上就这一次有效
  }
}

export function chatOff(): boolean {
  try {
    return localStorage.getItem(CHAT_OFF_KEY) === '1';
  } catch {
    return false;
  }
}

export function setChatOff(off: boolean): void {
  try {
    if (off) localStorage.setItem(CHAT_OFF_KEY, '1');
    else localStorage.removeItem(CHAT_OFF_KEY);
  } catch {
    // 存不上就这一次有效
  }
}
