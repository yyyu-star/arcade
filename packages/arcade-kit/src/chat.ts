/**
 * 好友房聊天的过滤（0.18.0，设计见 docs/chat.md 第 2 节）：纯函数，房间和页面都 import，页面发之前跑一遍给即时提示，房间收到再跑一遍（以房间为准）。
 * 顺序：规整 → 判长度 → 判导流（整条拒发）→ 脏话打码（照发）。不碰 DOM、时间和随机数（只有末尾单机用的 localChat 默认读当前时间来限速）。
 * kit 里不出现任何游戏的名字和概念；词表不针对真实个人。
 */
import { CHAT_WORDS } from './chat-words.js';

/** 一条最多几个字（按码点） */
export const CHAT_MAX = 30;

/** 被拒的原因（页面挑说法用；房间回的 code 都是 chat_blocked） */
export type ChatBlockWhy = 'link' | 'number' | 'contact';

export type ChatCheck =
  | { ok: true; text: string; masked: boolean }
  | { ok: false; code: 'chat_empty' | 'chat_too_long' }
  | { ok: false; code: 'chat_blocked'; why: ChatBlockWhy };

/** 控制字符、零宽字符、方向控制符、变体选择符：拿来藏字、倒序显示、把号码拆开 */
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ]/gu;

/** 规整：NFKC（全角转半角、①转 1）、去掉看不见的字符、连续空白并成一个、去首尾空白 */
export function normalizeChat(raw: string): string {
  // 换行、制表先当空格，不然会被当成控制字符删掉、把两边的字粘在一起
  return raw.normalize('NFKC').replace(/[\t\n\v\f\r]/gu, ' ').replace(INVISIBLE, '').replace(/\s+/gu, ' ').trim();
}

/** 中文数字（含大写）转阿拉伯数字，只用来判号码，不改发出去的字 */
const CN_DIGIT: Record<string, string> = {
  〇: '0', 零: '0', 洞: '0', 一: '1', 壹: '1', 幺: '1', 二: '2', 贰: '2', 两: '2', 三: '3', 叁: '3', 四: '4', 肆: '4',
  五: '5', 伍: '5', 六: '6', 陆: '6', 七: '7', 柒: '7', 八: '8', 捌: '8', 九: '9', 玖: '9',
};
const CN_DIGITS = new RegExp(`[${Object.keys(CN_DIGIT).join('')}]`, 'gu');

/**
 * 筹码金额放行（主线 2026-10-17 审）：标准千分位写法（1,000,000）不算号码。前后不能再挨着数字或逗号，
 * 不然 "138,0013,8000" 这种乱分组的号码能混过去；总位数封顶 10 位：11 位的手机号写成千分位（13,800,138,000）照样拦
 */
// 不用后行断言（?<!）：iOS 16.4 以前的 Safari 不认，整个模块会解析失败、连带 RoomClient 起不来；前面那个字符用捕获组带回去
const AMOUNT = /(^|[^\d,])(\d{1,3}(?:,\d{3})+)(?![\d,])/gu;
const AMOUNT_MAX_DIGITS = 10;

/** 夹在号码中间的分隔符：空格、点、横线、下划线、斜杠、逗号、顿号、句号、各种破折号 */
const SEPARATORS = /[\s.\-_/,、。·•～~—–]/gu;

const TLD = 'com|cn|net|org|top|xyz|cc|io|me|vip|info|biz|club|site|online|shop|app|link|fun|tv|co|ly|gg|ink|wang|xin|ren|asia|hk|tw|us|uk';
/** 网址：协议、www、"字母数字 + 点 + 常见顶级域"（。和"点"当成点）。只在小写、去掉空白的文本上判 */
const LINK = new RegExp(`https?|:\\/\\/|www[.。点]|[a-z0-9][a-z0-9-]*(?:\\.|。|点)(?:${TLD})(?![a-z])`, 'u');

/**
 * 微信、QQ 一类的叫法，隔着最多 3 个字（"号是:"）跟着 ≥ 5 位字母数字就是在留联系方式。
 * 电话、手机不在这里：号码本身 ≥ 7 位就拦了，放进来反倒误伤"手机快没电了 hello"
 */
const CONTACT = /(?:微信|威信|薇信|徽信|vx|v信|wx|weixin|wechat|qq|扣扣|企鹅|加我|私聊|私信|加群|群号)[^a-z0-9]{0,3}[a-z0-9]{5,}/u;

/** 判导流：命中返回原因；先把常见的绕法还原（中文数字、分隔符、金额） */
export function blockReason(text: string): ChatBlockWhy | null {
  const lower = text.toLowerCase();
  if (LINK.test(lower.replace(/\s+/gu, ''))) return 'link';
  const digits = lower.replace(CN_DIGITS, (c) => CN_DIGIT[c]!);
  const compact = digits.replace(SEPARATORS, '');
  if (CONTACT.test(compact)) return 'contact';
  const noAmount = digits.replace(AMOUNT, (m, pre: string, num: string) => (num.replace(/,/gu, '').length <= AMOUNT_MAX_DIGITS ? `${pre} ` : m));
  if (/\d{7,}/u.test(noAmount.replace(SEPARATORS, ''))) return 'number';
  return null;
}

/** 能参与匹配的字（字母、数字、汉字等）；夹在中间的空格、符号跳过（"傻 逼"、"s.b" 也认） */
const WORD_CHAR = /[\p{L}\p{N}]/u;
const ASCII = /^[a-z0-9]+$/u;

/** 脏话打码：命中的每个字换成 *，返回打码后的文本和有没有打过码。words 是游戏加的词（不能删 kit 的） */
export function maskChat(text: string, words: readonly string[] = []): { text: string; masked: boolean } {
  const chars = Array.from(text);
  const at: number[] = [];
  const sk: string[] = [];
  chars.forEach((c, i) => {
    if (!WORD_CHAR.test(c)) return;
    at.push(i);
    // 个别字母小写后变两个码点（İ），只取第一个，保证 sk 和 at 一一对应
    sk.push(Array.from(c.toLowerCase())[0]!);
  });
  const hit = new Set<number>();
  for (const raw of [...CHAT_WORDS, ...words]) {
    const w = Array.from(normalizeChat(raw).toLowerCase()).filter((c) => WORD_CHAR.test(c));
    if (w.length === 0) continue;
    const ascii = ASCII.test(w.join(''));
    for (let i = 0; i + w.length <= sk.length; i++) {
      if (!w.every((c, k) => sk[i + k] === c)) continue;
      // 英文缩写要整词：sb 不该打掉 "isbn" 里的两个字母
      if (ascii && (/[a-z0-9]/u.test(sk[i - 1] ?? '') || /[a-z0-9]/u.test(sk[i + w.length] ?? ''))) continue;
      for (let k = 0; k < w.length; k++) hit.add(at[i + k]!);
    }
  }
  if (hit.size === 0) return { text, masked: false };
  return { text: chars.map((c, i) => (hit.has(i) ? '*' : c)).join(''), masked: true };
}

/** 一条聊天从头到尾过一遍：房间和页面用同一个函数 */
export function checkChat(raw: unknown, words: readonly string[] = []): ChatCheck {
  if (typeof raw !== 'string') return { ok: false, code: 'chat_empty' };
  // 先截一刀再规整：几十 KB 的消息早在 maxMessageBytes 就挡了，这里只防规整本身吃太多
  const text = normalizeChat(raw.slice(0, CHAT_MAX * 8));
  const n = Array.from(text).length;
  if (n === 0) return { ok: false, code: 'chat_empty' };
  if (n > CHAT_MAX || raw.length > CHAT_MAX * 8) return { ok: false, code: 'chat_too_long' };
  const why = blockReason(text);
  if (why) return { ok: false, code: 'chat_blocked', why };
  const m = maskChat(text, words);
  return { ok: true, text: m.text, masked: m.masked };
}

/** 被拒时给发的人看的话（页面用；房间只回 code） */
export function chatRejectText(code: string, why?: ChatBlockWhy): string {
  switch (code) {
    case 'chat_blocked':
      return why === 'link' ? '不能发链接' : '不能发号码，金额请写成 1,000,000';
    case 'chat_too_long':
      return `一条最多 ${CHAT_MAX} 个字`;
    case 'chat_too_fast':
      return '说慢一点';
    case 'not_seated':
      return '坐下才能说话';
    case 'room_over':
      return '这桌已经散了';
    case 'chat_offline':
      return '还没连上';
    default:
      return '没发出去';
  }
}

/**
 * 发一句的结果（0.18.0 起 RoomClient.chat、0.18.1 起 localChat 共用）：被挡下的 code 和房间回的一样（CHAT_ERRORS），
 * 多一个 chat_offline（没连上）；chat_blocked 带 why（链接还是号码，挑说法用），chat_too_fast 带 waitMs
 */
export type ChatSendResult =
  | { ok: true }
  | { ok: false; code: 'chat_off' | 'chat_empty' | 'chat_too_long' | 'chat_offline' }
  | { ok: false; code: 'chat_blocked'; why: ChatBlockWhy }
  | { ok: false; code: 'chat_too_fast'; waitMs: number };

export interface LocalChatOptions {
  /** 游戏加的打码词（和房间的 RoomGame.chatWords 一样，只能加） */
  words?: readonly string[];
  /** 两条至少隔多久（毫秒），默认和房间一样 3000；0 不限 */
  ms?: number;
  /** 滚动一分钟最多几条，默认 10；0 不限 */
  perMin?: number;
  /** 现在几点（毫秒），测试注入；默认 Date.now */
  now?(): number;
}

/**
 * 单机聊天（0.18.1，所有者要求单机也能聊）：返回一个和 RoomClient.chat 一样用法的发送函数，过滤、限速和房间同一套，
 * 行就调 say(打码后的字, 有没有打码) 让页面在自己头像旁显示。只在本机显示自己说的，不发到任何地方、不存；
 * 电脑不读、不回（公平：电脑的决策和反应都不看真人打的字）。不碰 DOM；时间只在这里用（上面的过滤仍然是纯函数）
 */
export function localChat(say: (text: string, masked: boolean) => void, opts: LocalChatOptions = {}): (text: string) => ChatSendResult {
  const ms = opts.ms ?? 3000;
  const perMin = opts.perMin ?? 10;
  const now = opts.now ?? ((): number => Date.now());
  let times: number[] = [];
  return (text) => {
    const c = checkChat(text, opts.words ?? []);
    if (!c.ok) return c.code === 'chat_blocked' ? { ok: false, code: c.code, why: c.why } : { ok: false, code: c.code };
    const t = now();
    times = times.filter((x) => t - x < 60_000);
    const last = times[times.length - 1];
    let wait = ms > 0 && last !== undefined ? last + ms - t : 0;
    if (perMin > 0 && times.length >= perMin) wait = Math.max(wait, times[times.length - perMin]! + 60_000 - t);
    if (wait > 0) return { ok: false, code: 'chat_too_fast', waitMs: wait };
    times.push(t);
    say(c.text, c.masked);
    return { ok: true };
  };
}
