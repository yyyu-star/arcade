import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS,
  CALENDAR,
  DIFFICULTIES,
  EVENTS,
  ITEMS,
  PERSONAS,
  STOCKS,
  THEMES,
  chatView,
  codex,
  createRun,
  dispatch,
  eventById,
  eventView,
  holdingCards,
  rewardView,
  rngFor,
  runSummary,
  themeBoard,
  topBar,
  validate,
  type Action,
  type GameState,
  KNOWLEDGE,
  bankView,
  buyOptions,
  knowledgeView,
  positionsView,
} from '../src/core/index.ts';

/**
 * 0.3.1 文案检查：面向玩家的文案只用 docs/design.md 第 2 节词表左边的说法。
 * 下面这些 A 股术语一律不得出现（股票名里的"ST"除外，比如"ST摆烂"）。
 */
const BANNED = [
  'T+1',
  '龙头',
  '跟风',
  '白马',
  '妖股',
  '题材',
  '拐点',
  '炸板',
  '连板',
  '换仓',
  '两融',
  '打新',
  '中签',
  '低吸',
  '萌芽',
  '发酵',
  '主升',
  '高潮',
  '退潮',
  '大盘',
  '月供',
  '说中',
  '封板',
  '主力',
  '洗盘',
  '接盘',
  '横盘',
  '追高',
  '割肉',
  '仓位',
  '满仓',
  '空仓',
  // 0.4 C："加仓"是玩法按钮的名字（docs/design.md 第 6.2 节），不再禁用
  '基本面',
  '利好',
  '利空',
  '回调',
  '看盘',
  '盯盘',
  '打板',
  '游资',
  '止损',
  '止盈',
  'K线',
  // 0.11.0："杠杆"是实盘的玩法名（稳健 1× / 进取 2× / 疯狂 3×），和"加仓"一样放开；"爆仓""融资"仍然不许，说"清零线""利息"
  '喊单',
  // 0.3.1 小白试读补充
  '爆仓',
  '种子',
  '随机波动',
  '摘帽',
];

/** 只能出现在括注里解释的词（"（公司给股东发的钱，也叫分红）"可以，正文直接说"分红"不行）。 */
const BANNED_OUTSIDE_NOTES = ['分红'];

/**
 * "拉"只许用在"拉你去……""被拉进群""拉扯"这类意思上，不许当"拉升"讲（"有人要拉了"）。
 * 写法：拉后面必须跟下面这些字；以后新加别的用法时要在这里加上，并确认不是"拉升"的意思。
 */
const LA_PUMP = /拉(?![你我他她进群扯黑])/;

/**
 * "群主"只当身份标签用（FriendDef.title 单独出现，或图鉴里"群主：……"打头）；
 * 其余文案一律叫"韭菜收割机"（群里显示的名字），免得新手以为是两个人。
 */
function qunzhuInText(text: string): boolean {
  const rest = text === '群主' ? '' : text.startsWith('群主：') ? text.slice(3) : text;
  return rest.includes('群主');
}
const ST_OUTSIDE_NAMES = new RegExp(`ST(?!${STOCKS.filter((d) => d.name.startsWith('ST')).map((d) => d.name.slice(2)).join('|')})`);

/** 0.4 C：押跌、抵押一律大白话，这些词哪儿都不能出现（小知识的"真实世界里叫……"也不行）。 */
const BANNED_C = ['保证金', '维持', 'Reg T', 'margin call', 'Margin', '融资融券', '融资', '融券', '追保', '杠杆率'];

function offending(text: string): string[] {
  const c = BANNED_C.filter((w) => text.includes(w));
  // 小知识卡片的"真实世界里叫……"一行可以出现真实说法（docs/design.md 第 6.1、6.5 节）
  if (text.startsWith('真实世界里')) return c;
  const out = [...c, ...BANNED.filter((w) => text.includes(w))];
  if (ST_OUTSIDE_NAMES.test(text)) out.push('ST');
  const body = text.replace(/（[^（）]*）/g, '');
  out.push(...BANNED_OUTSIDE_NOTES.filter((w) => body.includes(w)));
  if (LA_PUMP.test(text)) out.push('拉');
  if (qunzhuInText(text)) out.push('群主');
  return out;
}

/** 规则层里放面向玩家文案的源码：内容表、标签、查询、引擎（报错、通知）、新闻 / 台词 / 归因。 */
const sources = import.meta.glob(
  ['../src/core/content/*.ts', '../src/core/labels.ts', '../src/core/queries.ts', '../src/core/engine.ts', '../src/core/meta.ts', '../src/core/chat.ts', '../src/core/story.ts', '../src/core/explain.ts', '../src/core/format.ts'],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>;

/** 去掉注释后取出所有字符串字面量（'…'、"…"、`…`）。 */
function literals(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out.push(src.slice(i + 1, j));
      i = j + 1;
      continue;
    }
    i++;
  }
  return out;
}

function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
  return out;
}

/** 一个简单的玩法（会买、会卖、奖励拿第一张、事件交替选），收集运行时拼出来的文案。 */
function playTexts(seed: string): string[] {
  let s: GameState = createRun(seed, { items: ['margin', 'diversify', 'zhisun', 'zhiying', 'genfeng', 'longtou', 'yaogu', 'baima', 'ipo', 'fan_qunzhu', 'night_review'], account: 1e6 }).state;
  const out: string[] = [];
  for (let i = 0; i < 1200 && s.phase !== 'won' && s.phase !== 'lost'; i++) {
    out.push(...strings([topBar(s), chatView(s), themeBoard(s), holdingCards(s)]));
    if (s.phase === 'reward') out.push(...strings(rewardView(s)));
    if (s.phase === 'event') out.push(...strings(eventView(s)));
    let a: Action = { type: 'open' };
    if (s.phase === 'reward') a = validate(s, { type: 'pickReward', index: 0 }) === null ? { type: 'pickReward', index: 0 } : { type: 'skipReward' };
    else if (s.phase === 'event') a = { type: 'choose', option: i % 2 };
    else {
      const old = s.slots.findIndex((h, k) => h !== null && s.dayIndex - h.boughtDay > 4 && validate(s, { type: 'sell', slot: k }) === null);
      const rec = s.today.recs.findIndex((r) => !r.taken);
      if (old >= 0) a = { type: 'sell', slot: old };
      else if (rec >= 0 && validate(s, { type: 'buy', rec }) === null) a = { type: 'buy', rec };
      out.push(...[0, 1, 2].map((k) => validate(s, { type: 'sell', slot: k }) ?? ''));
    }
    const r = dispatch(s, a);
    s = r.state;
    out.push(...strings(r.events));
  }
  out.push(...strings(runSummary(s)));
  return out;
}

describe('文案只用新说法（第 2 节词表）', () => {
  it('源码里面向玩家的字符串没有 A 股术语', () => {
    for (const [path, src] of Object.entries(sources)) {
      for (const lit of literals(src)) {
        // 开发者报错（throw new Error）、id、类型名等不含中文的字符串跳过
        if (!/[一-鿿]/.test(lit)) continue;
        expect(offending(lit), `${path}：${lit}`).toEqual([]);
      }
    }
  });

  it('内容表（名字、说明、风味文字、事件文案）', () => {
    const all = strings([THEMES, STOCKS.map((d) => d.name), ACHIEVEMENTS, CALENDAR, DIFFICULTIES, codex()]);
    for (const d of ITEMS) all.push(d.name, d.desc(), d.flavor);
    for (const d of PERSONAS) all.push(d.name, d.title, d.desc(), d.flavor);
    for (const d of DIFFICULTIES) all.push(d.desc, d.detail ?? '');
    const s = createRun('terms-events').state;
    for (const d of EVENTS) {
      const data = eventById(d.id).prepare({ state: s, rng: rngFor('terms', d.id), month: 3 });
      if (!data) continue;
      s.phase = 'event';
      s.event = { ...data, id: d.id, month: 3 };
      all.push(...strings(eventView(s)));
    }
    for (const t of all) expect(offending(t), t).toEqual([]);
  });

  it('玩几局时出现的所有文案（结算、群聊、新闻、台词、归因、看板、按钮报错、结束页）', () => {
    for (const seed of ['terms-a', 'terms-b', 'terms-c']) {
      for (const t of playTexts(seed)) expect(offending(t), t).toEqual([]);
    }
    // 要真玩三局：机器忙（几个任务同时跑）时会超过默认的 5 秒
  }, 30_000);

  it('0.4 C：押跌、借钱、仓位的文案（银行、持仓、买入选项、事件、结束页、故事、小知识）', () => {
    for (const seed of ['terms-c1', 'terms-c2']) {
      let s: GameState = createRun(seed, { items: ['short_permit', 'sunglasses', 'banker', 'pyramid'], difficulty: 5 }, { ext: true }).state;
      const out: string[] = [];
      for (let i = 0; i < 1500 && s.phase !== 'won' && s.phase !== 'lost'; i++) {
        out.push(...strings([bankView(s), positionsView(s), holdingCards(s), chatView(s), topBar(s)]));
        if (s.phase === 'reward') out.push(...strings(rewardView(s)));
        if (s.phase === 'event') out.push(...strings(eventView(s)));
        let a: Action = { type: 'open' };
        if (s.phase === 'reward') a = { type: 'skipReward' };
        else if (s.phase === 'event') a = { type: 'choose', option: i % 2 };
        else {
          out.push(...strings(s.today.recs.map((_, k) => buyOptions(s, k))));
          const tries: Action[] = [
            { type: 'borrow', id: 'house' },
            { type: 'borrow', id: 'car' },
            { type: 'buy', rec: 0, size: 'heavy', short: i % 3 === 0 },
            { type: 'buy', rec: 1, size: 'half' },
            { type: 'trim', slot: 0 },
            { type: 'add', slot: 1 },
            { type: 'sell', slot: 0 },
            { type: 'repay', id: 'car' },
          ];
          const ok = tries.filter((x) => validate(s, x) === null);
          if (ok.length > 0 && i % 4 !== 3) a = ok[i % ok.length] as Action;
        }
        const r = dispatch(s, a);
        s = r.state;
        out.push(...strings(r.events));
      }
      out.push(...strings(runSummary(s)), ...strings(knowledgeView(KNOWLEDGE.map((k) => k.id))));
      for (const t of out) expect(offending(t), t).toEqual([]);
    }
  });
});
