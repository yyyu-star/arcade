/** 牌桌互动组件的演示：单机接法（send 直接回给 receive，电脑由组件按性格反应）。冒烟由脚本调 window.fun。 */
import { checkChat } from '../src/chat.ts';
import { playFunSound } from '../src/fun.ts';
import { demoTheme } from './theme.ts';
import { TableFun, type FunSeat, type FunTemper } from '../src/table-fun.ts';

const $ = (id: string): HTMLElement => document.getElementById(id)!;
let ac: AudioContext | null = null;
const PHRASES = ['好牌！', '漂亮！', '快点吧', '就这？', '等着瞧', '稳住'];
const who: [string, boolean, FunTemper][] = [
  ['我', false, 'normal'],
  ['右家', true, 'rowdy'],
  ['对家', true, 'normal'],
  ['左家', true, 'cool'],
];
const log: string[] = [];

const fun = new TableFun({
  storageKey: 'demo',
  theme: demoTheme,
  phrases: PHRASES,
  named: [3, 4, 2],
  seats: (): FunSeat[] =>
    who.map(([name, bot, temper], i) => ({ rect: $(`s${i}`).getBoundingClientRect(), plate: $(`s${i}`).querySelector('span')!.getBoundingClientRect(), name, me: i === 0, bot, temper })),
  avoid: () => [$('hand').getBoundingClientRect(), $('act').getBoundingClientRect()],
  button: () => {
    const r = $('s0').getBoundingClientRect();
    return { left: r.right + 10, top: r.top + 16, width: 56, height: 56 };
  },
  send: (id, to) => fun.receive(0, id, to),
  localBots: true,
  sound: (p, phase) => {
    ac ??= new AudioContext();
    playFunSound(ac, ac.destination, p, phase);
  },
  onHit: (seat) => {
    const el = $(`s${seat}`);
    el.classList.remove('hit');
    void el.offsetWidth;
    el.classList.add('hit');
  },
  log: (line) => log.push(line),
  // 聊天（0.18.0）：真游戏只在好友房接（client.chat），演示页在本地过一遍过滤就自己收下，右家隔一秒回一句，看气泡和记录的样子
  chat: (text) => {
    const c = checkChat(text);
    if (!c.ok) return c;
    fun.chat(0, c.text, c.masked);
    setTimeout(() => fun.chat(1, '收到收到，这把稳了'), 1000);
    return { ok: true };
  },
});

// 弹幕和记录的样子（0.19.0）：三家电脑轮流说一句
const LINES = ['这把牌不错', '谁先出？', '我要炸了啊', '稳住稳住，别急', '哈哈哈哈', '今天手气真好', '下一把我来带飞，都跟上', '你们打得太快了'];
let n = 0;
$('chatter').onclick = () => {
  for (let k = 0; k < 6; k++) setTimeout(() => fun.chat(1 + (n % 3), LINES[n++ % LINES.length]!), k * 700);
};

$('moment').onclick = () => {
  fun.banner('炸弹！', '我 炸了 右家');
  fun.moment({ kind: 'moment', moment: 'bomb', winners: [0], losers: [1, 3], hand: Date.now() });
};

(window as unknown as { fun: unknown }).fun = { fun, log };
