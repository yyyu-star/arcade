/**
 * 牌桌互动（DESIGN.md 第 6 节）：整套用 kit 的 `arcade-kit/table-fun`（docs/table-fun.md 第 0 节）——点头像菜单、互动面板、表情菜单、首次提示、
 * 冷却护盾连击回敬、单机电脑的反应、名场面横幅都在 kit 里，三个牌桌游戏一模一样。这里只接线：
 * 头像在哪、谁是电脑、什么性格（牌桌给），手牌和按钮不能盖，"互动"按钮的位置（牌桌上一个空位 .fun-slot），发送通道，本游戏的短语和电脑的口头禅。
 * 底线不变：人人一样、免费，不挂筹码；只是画面和声音，不停计时；电脑出牌读不到这里任何东西。
 */
import { playFunSound } from 'arcade-kit/fun';
import { TableFun, type ButtonStyle, type ChatResultLike, type FunSeat, type RectLike } from 'arcade-kit/table-fun';
import { audioOut } from './sound.ts';
import { MOOD_LINES, PHRASES } from './text.ts';

/** 总开关"互动：开 / 不看"：关了别人的一律不播，单机电脑也不反应 */
export const OFF_KEY = 'mahjong.comms';
/** 聊天的开关（0.19.0 两档，0.21.0 三档，见 chatMode） */
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
    buttonStyle,
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

/**
 * "互动""聊天"按钮的大小（kit 0.20.1 的 buttonStyle，以前在 style.css 里硬改 .atf-btn）：按钮浮在舞台外面（屏幕像素），
 * 字号跟牌桌上别的按钮的 --fs-lg 走、按舞台缩放（viewport.ts 写的 --stage-scale）换成屏幕像素，电脑上舞台放大后不是大框小字
 */
function buttonStyle(): ButtonStyle {
  const s = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--stage-scale')) || 1;
  const fsLg = Math.max(18, 16 * Math.max(1, 1 / s));
  return { row: true, fontSize: Math.max(13, fsLg * s), icon: Math.max(18, 24 * s) };
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

export type ChatMode = 'on' | 'stranger' | 'off';

/**
 * 聊天三档（0.21.0 快速匹配起；手机横屏的设置面板放不下再加一行，并成一个按钮轮着切）：
 * 开；不和陌生人（匹配桌不看也不能说，连接不带 chat=1；好友房、单机照开）；不看（别人说的都不显示，自己还能说）。
 * 存在原来的 mahjong.chatOff：'1' 是不看（0.19.0 起就这么存），'stranger' 是不和陌生人，没有是开
 */
export function chatMode(): ChatMode {
  try {
    const v = localStorage.getItem(CHAT_OFF_KEY);
    return v === '1' ? 'off' : v === 'stranger' ? 'stranger' : 'on';
  } catch {
    return 'on';
  }
}

export function setChatMode(m: ChatMode): void {
  try {
    if (m === 'on') localStorage.removeItem(CHAT_OFF_KEY);
    else localStorage.setItem(CHAT_OFF_KEY, m === 'off' ? '1' : 'stranger');
  } catch {
    // 存不上就这一次有效
  }
}

export function chatOff(): boolean {
  return chatMode() === 'off';
}
