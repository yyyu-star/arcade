/**
 * 好友房聊天（0.18.0，docs/chat.md）：过滤的纯函数，房间转发、限速、不落库，RoomClient 本地先挡。
 */
import { runInDurableObject } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import chatSrc from '../src/chat.ts?raw';
import roomSrc from '../src/room.ts?raw';
import { CHAT_MAX, blockReason, chatRejectText, checkChat, localChat, maskChat, normalizeChat } from '../src/chat.ts';
import { RoomClient, type WebSocketLike } from '../src/client.ts';
import type { ChattedMsg, DownMsg, EmotedMsg } from '../src/protocol.ts';
import { chatRateOf } from '../src/room.ts';
import { advance, type Conn, freezeClock, inspect, join, openRoom, resetMeter, roomRow, stub } from './helpers.ts';
import type { ToyRoom, ToyView } from './worker.ts';

describe('过滤（纯函数）', () => {
  it('规整：全角转半角、去零宽和方向控制符、空白并成一个、去首尾', () => {
    expect(normalizeChat('  ＡＢＣ１２３　好​的‮  啊\n\t吧 ')).toBe('ABC123 好的 啊 吧');
    expect(normalizeChat('①②③')).toBe('123');
  });

  it('长度按码点算，30 个字以内；空的、全是空白的回 chat_empty；不是字符串也是 chat_empty', () => {
    expect(checkChat('好'.repeat(CHAT_MAX))).toEqual({ ok: true, text: '好'.repeat(CHAT_MAX), masked: false });
    expect(checkChat('好'.repeat(CHAT_MAX + 1))).toEqual({ ok: false, code: 'chat_too_long' });
    // emoji 一个算一个（两个 UTF-16 单元）
    expect(checkChat('😀'.repeat(CHAT_MAX)).ok).toBe(true);
    expect(checkChat('   ​ ')).toEqual({ ok: false, code: 'chat_empty' });
    expect(checkChat(42)).toEqual({ ok: false, code: 'chat_empty' });
    expect(checkChat('x'.repeat(10_000))).toEqual({ ok: false, code: 'chat_too_long' });
  });

  it('链接整条拒发：协议、www、域名，加空格、用"点"和"。"的绕法也认', () => {
    for (const t of ['看 http://a.b', 'www.abc.com', 'abc.com 来', 'a b c . c o m', 'abc点com', 'abc。cn', 'HTTPS 走起', 'xx.top']) {
      expect(blockReason(normalizeChat(t)), t).toBe('link');
    }
  });

  it('号码整条拒发：连续 7 位以上，空格、横线、点、中文数字拆开的也认', () => {
    for (const t of ['13800138000', '138 0013 8000', '1-3-8-0-0-1-3-8', '幺三八零零幺三八零零零', '一三八〇〇一三八', '138.001.380', '１３８００１３８０００', '138,0013,8000']) {
      expect(blockReason(normalizeChat(t)), t).toBe('number');
    }
  });

  it('筹码金额放行（主线 10-17）：标准千分位写法不算号码；11 位的手机号写成千分位照样拦', () => {
    for (const t of ['我赢了 1,000,000', '输了 12,500 筹码', '9,999,999,999 封顶', '1,000,000 和 2,000,000']) {
      expect(checkChat(t).ok, t).toBe(true);
    }
    expect(blockReason('13,800,138,000')).toBe('number');
    expect(blockReason('138,001,380,00')).toBe('number');
    // 不带逗号的照样拦，拒发的话教人怎么写
    expect(checkChat('赢了1000000')).toEqual({ ok: false, code: 'chat_blocked', why: 'number' });
    expect(chatRejectText('chat_blocked', 'number')).toBe('不能发号码，金额请写成 1,000,000');
    expect(chatRejectText('chat_blocked', 'link')).toBe('不能发链接');
  });

  it('微信、QQ 号样式整条拒发：叫法后面跟着 5 位以上字母数字', () => {
    for (const t of ['加我微信 abc123', 'vx: zhangsan', 'v信 wxid_abcde', 'qq 12345', '扣扣：五六七八九', '私聊 hello1', '企鹅 88888']) {
      expect(blockReason(normalizeChat(t)), t).toBe('contact');
    }
  });

  it('常用的话、牌面、比分、短数字都不误伤', () => {
    for (const t of ['好牌！', '打 2', 'A×2', '10 张', '我方 5 对方 2', '第 3 副', '炸弹 4 个 8', '再来一局', '加我们一队', '手机快没电了 hello', 'qq 好玩', '快点出', '2026 年', '7 点开打', '三缺一', '一二三四五六']) {
      const c = checkChat(t);
      expect(c.ok, t).toBe(true);
    }
  });

  it('脏话打码：命中的字换成 *、照发；中间夹空格符号的也认；英文缩写要整词；游戏加的词也认', () => {
    expect(maskChat('你个傻逼')).toEqual({ text: '你个**', masked: true });
    expect(maskChat('傻 . 逼')).toEqual({ text: '* . *', masked: true });
    expect(maskChat('SB 吧')).toEqual({ text: '** 吧', masked: true });
    expect(maskChat('isbn 号')).toEqual({ text: 'isbn 号', masked: false });
    expect(maskChat('土豆泥')).toEqual({ text: '土豆泥', masked: false });
    expect(maskChat('土 豆泥', ['土豆泥'])).toEqual({ text: '* **', masked: true });
    expect(checkChat('傻逼你好', [])).toEqual({ ok: true, text: '**你好', masked: true });
    // 不收会误伤的："生日你快乐"里没有词表的词
    expect(checkChat('生日你快乐')).toEqual({ ok: true, text: '生日你快乐', masked: false });
  });

  it('chat.ts 是纯函数：不碰 DOM、时间、随机数、存储（单机的 localChat 只默认读 Date.now 限速）', () => {
    const pure = chatSrc.slice(0, chatSrc.indexOf('export type ChatSendResult'));
    for (const bad of ['document', 'window', 'Date.now', 'new Date', 'Math.random', 'localStorage', 'storage.']) expect(pure, bad).not.toContain(bad);
    for (const bad of ['document', 'window', 'Math.random', 'localStorage', 'sessionStorage', 'indexedDB', 'fetch(']) expect(chatSrc, bad).not.toContain(bad);
    // 后行断言在 iOS 16.4 以前的 Safari 是语法错误，会让引了它的 RoomClient 整个起不来
    expect(chatSrc).not.toMatch(/\(\?<[!=]/);
  });
});

// ---------- 房间 ----------

const chatted = (m: DownMsg<ToyView> | EmotedMsg | ChattedMsg): m is ChattedMsg => m.t === 'chat';

/** 开房，u1 0 号、u2 1 号（都带 chat=1），u3 只是来看的（带 chat=1），u4 坐 2 号但是旧页面（没带 chat=1）。 */
async function table(): Promise<{ code: string; a: Conn; b: Conn; watcher: Conn; old: Conn }> {
  const code = await openRoom('u1');
  const a = (await join(code, 'u1', '', true)).conn;
  const b = (await join(code, 'u2', '', true)).conn;
  b.send({ t: 'sit', seat: 1 });
  await b.until((m) => m.t === 'state' && m.you.seat === 1);
  const old = (await join(code, 'u4')).conn;
  old.send({ t: 'sit', seat: 2 });
  await old.until((m) => m.t === 'state' && m.you.seat === 2);
  const watcher = (await join(code, 'u3', '', true)).conn;
  for (const c of [a, b, watcher, old]) c.drain();
  return { code, a, b, watcher, old };
}

describe('房间转发聊天', () => {
  beforeEach(async () => {
    freezeClock();
    await resetMeter();
  });

  it('入座的人说：带了 chat=1 的都收到（含自己、来看的），旧页面收不到；不写库、不改 seq', async () => {
    const { code, a, b, watcher, old } = await table();
    const before = await inspect(code);
    b.send({ t: 'chat', text: '  打得好  ' });
    for (const c of [a, b, watcher]) expect(await c.until(chatted)).toEqual({ t: 'chat', seat: 1, text: '打得好' });
    const after = await inspect(code);
    expect(after.last).toBe(0);
    expect(after.total).toBe(before.total);
    expect(after.persist.seq).toBe(before.persist.seq);
    // 旧页面：之后收到的第一条是短语，前面没有聊天
    b.send({ t: 'emote', id: 1 });
    const first = await old.until((m) => m.t === 'emote' || m.t === 'chat');
    expect(first.t).toBe('emote');
  });

  it('脏话打码后照发（带 masked），游戏加的词也打；导流整条拒发 chat_blocked、只回发的人', async () => {
    const { a, b } = await table();
    b.send({ t: 'chat', text: '傻逼吧' });
    expect(await a.until(chatted)).toEqual({ t: 'chat', seat: 1, text: '**吧', masked: true });
    advance(3_000);
    b.send({ t: 'chat', text: '土豆泥' });
    expect(await a.until(chatted)).toEqual({ t: 'chat', seat: 1, text: '***', masked: true });
    advance(3_000);
    b.send({ t: 'chat', text: '加我 13800138000' });
    expect(await b.until((m) => m.t === 'error')).toEqual({ t: 'error', code: 'chat_blocked' });
    // 被拒的不占条数：马上能说下一句
    b.send({ t: 'chat', text: '我赢了 1,000,000' });
    expect(await a.until(chatted)).toEqual({ t: 'chat', seat: 1, text: '我赢了 1,000,000' });
  });

  it('没入座的 not_seated；空的、太长的、不是字符串的被拒；都不转发', async () => {
    const { a, b, watcher } = await table();
    watcher.send({ t: 'chat', text: '我也想说' });
    expect(await watcher.until((m) => m.t === 'error')).toEqual({ t: 'error', code: 'not_seated' });
    for (const [text, code] of [['  ', 'chat_empty'], [null, 'chat_empty'], ['好'.repeat(31), 'chat_too_long']] as const) {
      b.send({ t: 'chat', text });
      expect(await b.until((m) => m.t === 'error'), String(text)).toEqual({ t: 'error', code });
    }
    b.send({ t: 'chat', text: '第一句' });
    expect(await a.until(chatted)).toEqual({ t: 'chat', seat: 1, text: '第一句' });
  });

  it('限速两道：3 秒一条、一分钟最多 10 条；别的座位不受影响；被拒的不占条数', async () => {
    const { a, b } = await table();
    b.send({ t: 'chat', text: '1' });
    expect(await a.until(chatted)).toMatchObject({ text: '1' });
    advance(2_999);
    b.send({ t: 'chat', text: '2' });
    expect(await b.until((m) => m.t === 'error')).toEqual({ t: 'error', code: 'chat_too_fast' });
    a.send({ t: 'chat', text: '我说' });
    expect(await b.until(chatted)).toEqual({ t: 'chat', seat: 0, text: '我说' });
    advance(1);
    for (let i = 2; i <= 10; i++) {
      b.send({ t: 'chat', text: String(i) });
      expect(await a.until((m) => chatted(m) && m.seat === 1)).toMatchObject({ seat: 1, text: String(i) });
      advance(3_000);
    }
    // 这一分钟（从第 1 条起）已经 10 条：第 11 条被拒
    b.send({ t: 'chat', text: '11' });
    expect(await b.until((m) => m.t === 'error')).toEqual({ t: 'error', code: 'chat_too_fast' });
    advance(60_000);
    b.send({ t: 'chat', text: '12' });
    expect(await a.until((m) => chatted(m) && m.seat === 1)).toMatchObject({ seat: 1, text: '12' });
  });

  it('进房的快照带节奏和字数；KIT_QUOTA 里的 chatMs / chatPerMin 覆盖默认，不合格的忽略', async () => {
    const code = await openRoom('u9');
    const { welcome } = await join(code, 'u9', '', true);
    expect(welcome.chat).toEqual({ ms: 3000, perMin: 10, max: 30 });
    const base = { ms: 3000, perMin: 10 };
    expect(chatRateOf(undefined, base)).toEqual(base);
    expect(chatRateOf({ chatMs: 1000, chatPerMin: 20, emoteMs: 9 }, base)).toEqual({ ms: 1000, perMin: 20 });
    expect(chatRateOf('{"chatPerMin":0}', base)).toEqual({ ms: 3000, perMin: 0 });
    expect(chatRateOf({ chatMs: -1, chatPerMin: 1.5 }, base)).toEqual(base);
    expect(chatRateOf('oops', base)).toEqual(base);
  });

  it('游戏没开聊天：chat_off，快照里也没有节奏', async () => {
    const code = await openRoom('u1', '/flaky');
    const { conn, welcome } = await join(code, 'u1', '/flaky', true);
    expect(welcome.chat).toBeUndefined();
    conn.send({ t: 'chat', text: '在吗' });
    expect(await conn.until((m) => m.t === 'error')).toEqual({ t: 'error', code: 'chat_off' });
  });

  it('不进快照、不进存储：重连进来的人看不到以前说的，存储里找不到说过的话', async () => {
    const { code, a, b } = await table();
    b.send({ t: 'chat', text: '秘密暗号' });
    await a.until(chatted);
    const again = await join(code, 'u1', '', true);
    expect(JSON.stringify(again.welcome)).not.toContain('秘密暗号');
    const dump = JSON.stringify(await roomRow(stub(code), code));
    expect(dump).not.toContain('秘密暗号');
  });

  it('架构：房间里聊天那段代码不碰存储、不交给规则和互动钩子', () => {
    const body = roomSrc.slice(roomSrc.indexOf('  private chat(ws'), roomSrc.indexOf('  private chatRate('));
    expect(body.length).toBeGreaterThan(100);
    for (const bad of ['storage', 'sql', 'commit', 'onStep', 'onEmote', 'this.game.apply', 'setAlarm']) expect(body, bad).not.toContain(bad);
  });
});

// ---------- RoomClient ----------

class FakeWs implements WebSocketLike {
  static last: FakeWs;
  readyState = 0;
  sent: string[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {
    FakeWs.last = this;
  }
  send(d: string): void {
    this.sent.push(d);
  }
  close(): void {
    this.readyState = 3;
  }
  open(welcome: object): void {
    this.readyState = 1;
    this.onopen?.({});
    this.onmessage?.({ data: JSON.stringify(welcome) });
  }
}

const WELCOME = { t: 'welcome', v: 1, minClientVersion: 0, seq: 0, you: { seat: 1, bound: null }, room: {}, view: null, chat: { ms: 3000, perMin: 10, max: 30 } };

function client(onChat = true) {
  const got: unknown[] = [];
  const errs: string[] = [];
  const c = new RoomClient({
    url: 'wss://x.test/rooms/123456/ws',
    onMessage: (m) => got.push(m),
    ...(onChat ? { onChat: (seat: number, text: string, masked: boolean) => got.push({ seat, text, masked }), onChatError: (code: string) => errs.push(code) } : {}),
    WebSocketImpl: FakeWs as unknown as { new (url: string): WebSocketLike },
    setTimer: () => 0,
    clearTimer: () => undefined,
  });
  return { c, ws: FakeWs.last, got, errs };
}

describe('RoomClient 的聊天', () => {
  it('传了 onChat 才带 chat=1；收到的聊天交给 onChat、不进 onMessage；聊天专有的拒绝交给 onChatError', () => {
    expect(new URL(client(false).ws.url).searchParams.get('chat')).toBeNull();
    const { ws, got, errs } = client();
    expect(new URL(ws.url).searchParams.get('chat')).toBe('1');
    ws.open(WELCOME);
    got.length = 0;
    ws.onmessage!({ data: JSON.stringify({ t: 'chat', seat: 2, text: '**吧', masked: true }) });
    ws.onmessage!({ data: JSON.stringify({ t: 'error', code: 'chat_blocked' }) });
    expect(got).toEqual([{ seat: 2, text: '**吧', masked: true }]);
    expect(errs).toEqual(['chat_blocked']);
  });

  it('chat()：本地先挡（空、太长、导流、节奏、没连上），行就发原文', () => {
    const { c, ws } = client();
    expect(c.chat('你好', 1_000)).toEqual({ ok: false, code: 'chat_offline' });
    ws.open(WELCOME);
    expect(c.chat('  ', 1_000)).toEqual({ ok: false, code: 'chat_empty' });
    expect(c.chat('好'.repeat(31), 1_000)).toEqual({ ok: false, code: 'chat_too_long' });
    expect(c.chat('www.a.com', 1_000)).toEqual({ ok: false, code: 'chat_blocked', why: 'link' });
    expect(c.chat('傻逼 你好', 1_000)).toEqual({ ok: true });
    expect(JSON.parse(ws.sent.at(-1)!)).toEqual({ t: 'chat', text: '傻逼 你好' });
    expect(c.chat('再说', 2_000)).toEqual({ ok: false, code: 'chat_too_fast', waitMs: 2_000 });
    expect(c.chatWait(3_500)).toBe(500);
    expect(c.chat('再说', 4_000)).toEqual({ ok: true });
    c.close();
  });

  it('没传 onChat：chat() 回 chat_off，不发', () => {
    const { c, ws } = client(false);
    ws.open(WELCOME);
    expect(c.chat('你好')).toEqual({ ok: false, code: 'chat_off' });
    expect(ws.sent.some((s) => s.includes('"chat"'))).toBe(false);
    c.close();
  });
});

describe('单机聊天 localChat（0.18.1）', () => {
  it('过滤和房间一样：打码照发、导流拒发、空的太长的拒发；行的才调 say', () => {
    const said: [string, boolean][] = [];
    let t = 1_000_000;
    const send = localChat((s, m) => said.push([s, m]), { words: ['土豆泥'], now: () => t });
    expect(send('  ')).toEqual({ ok: false, code: 'chat_empty' });
    expect(send('好'.repeat(31))).toEqual({ ok: false, code: 'chat_too_long' });
    expect(send('加我 138 0013 8000')).toMatchObject({ ok: false, code: 'chat_blocked' });
    expect(send('www.a.com')).toEqual({ ok: false, code: 'chat_blocked', why: 'link' });
    expect(said).toEqual([]);
    expect(send('傻逼 土豆泥')).toEqual({ ok: true });
    t += 3_000;
    expect(send('赢了 1,000,000')).toEqual({ ok: true });
    expect(said).toEqual([['** ***', true], ['赢了 1,000,000', false]]);
  });

  it('限速两道（默认同房间：3 秒一条、一分钟 10 条），拒发的不占条数，waitMs 说还要等多久', () => {
    let t = 5_000_000;
    let n = 0;
    const send = localChat(() => n++, { now: () => t });
    expect(send('1')).toEqual({ ok: true });
    t += 1_000;
    expect(send('2')).toEqual({ ok: false, code: 'chat_too_fast', waitMs: 2_000 });
    // 被拒（太快、导流）都不占条数
    expect(send('13800138000')).toMatchObject({ code: 'chat_blocked' });
    t += 2_000;
    for (let i = 2; i <= 10; i++) {
      expect(send(String(i)), String(i)).toEqual({ ok: true });
      t += 3_000;
    }
    expect(n).toBe(10);
    // 第 1 条在 30 秒前：这一分钟满了，要等到第 1 条满一分钟
    expect(send('11')).toEqual({ ok: false, code: 'chat_too_fast', waitMs: 60_000 - 30_000 });
    t += 30_000;
    expect(send('12')).toEqual({ ok: true });
    expect(n).toBe(11);
  });

  it('ms / perMin 能改，0 不限', () => {
    let n = 0;
    const send = localChat(() => n++, { ms: 0, perMin: 0, now: () => 0 });
    for (let i = 0; i < 30; i++) expect(send('好')).toEqual({ ok: true });
    expect(n).toBe(30);
  });
});
