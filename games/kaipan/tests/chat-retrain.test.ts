import { describe, expect, it } from 'vitest';
import { BALANCE } from '../src/core/balance.ts';
import { credibility, friendForm, handOf, makeComments } from '../src/core/chat.ts';
import { BIG_LOSS_LINES, HAND_TAILS, REACT_LINES, type ReactMoment } from '../src/core/content/index.ts';
import { MOOD_QUIPS } from '../src/core/content/quips.ts';
import { createRun } from '../src/core/engine.ts';
import { formatMoney } from '../src/core/format.ts';
import { rulesOf } from '../src/core/market.ts';
import { quipLines } from '../src/core/story.ts';
import type { DayReport, FriendState, GameEvent, GameState } from '../src/core/types.ts';
import { botByName, playRun, useExt, useMarket } from '../tools/bots.ts';
import { loadSegment, segmentForSeed, segmentIndex } from '../tools/segments-disk.ts';
import { withBalance } from './helpers.ts';

/** 0.7.0 群友再打磨：每局状态、这局手气、按局面接话、股票小人按大盘说话、台词不怎么重复。 */

const seg = loadSegment(segmentIndex().segments[0]!.id);
const track = (seed: string): GameState => ({ seed, real: { track: true } }) as unknown as GameState;

describe('每局状态：按种子浮动，均值不变', () => {
  it('范围、均值、确定性；合成行情（离线兜底）没有浮动', () => {
    const { cred, talk } = BALANCE.chat.form;
    let sumC = 0;
    let sumT = 0;
    let n = 0;
    for (let k = 0; k < 500; k++) {
      for (const id of ['xiaoli', 'laowang', 'qunzhu']) {
        const f = friendForm(track(`form-${k}`), id);
        expect(Math.abs(f.cred)).toBeLessThanOrEqual(cred);
        expect(Math.abs(f.talk - 1)).toBeLessThanOrEqual(talk);
        sumC += f.cred;
        sumT += f.talk;
        n++;
      }
    }
    // 均匀分布的标准误：cred/√3/√n ≈ 0.0007，留足余量
    expect(Math.abs(sumC / n)).toBeLessThan(0.004);
    expect(Math.abs(sumT / n - 1)).toBeLessThan(0.02);
    expect(friendForm(track('same'), 'xiaoli')).toEqual(friendForm(track('same'), 'xiaoli'));
    expect(friendForm(track('same'), 'xiaoli')).not.toEqual(friendForm(track('same'), 'laowang'));
    expect(friendForm(createRun('synthetic').state, 'xiaoli')).toEqual({ cred: 0, talk: 1 });
  });

  it('真实行情下消息可信度正好挪了这一局的浮动（没碰到上下限时）', () => {
    let checked = 0;
    for (let k = 0; k < 20; k++) {
      const s = createRun(`form-cred-${k}`, { account: 1e9 }, { segment: seg }).state;
      const rules = rulesOf(s);
      for (const f of s.friends) {
        const theme = s.themeIds[0]!;
        const withForm = credibility(s, f.id, theme, rules);
        const without = withBalance((b) => (b.chat.form = { cred: 0, talk: 0 }), () => credibility(s, f.id, theme, rules));
        if (withForm <= 0.01 || withForm >= BALANCE.chat.credMax - 0.01 || without >= BALANCE.chat.credMax - 0.06) continue;
        const noise = rules.msgNoise > 0 ? 1 - rules.msgNoise : 1;
        expect(withForm - without).toBeCloseTo(friendForm(s, f.id).cred * noise, 9);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(50);
  });
});

describe('这局手气：只看本局公开战绩', () => {
  const f = (hits: number, total: number): FriendState => ({ id: 'xiaoli', hits, total, topics: [] });
  it('揭晓的消息够多才算；七成以上手气好，三成五以下手气差', () => {
    expect(handOf(f(3, 3))).toBeNull();
    expect(handOf(f(3, 4))).toBe('hot');
    expect(handOf(f(5, 10))).toBeNull();
    expect(handOf(f(1, 4))).toBe('cold');
    expect(handOf(f(7, 20))).toBe('cold');
  });
});

/** 一天的收盘结果：缺省没持仓、账户不动、大盘不变。 */
function report(s: GameState, day: number, over: Partial<DayReport> & { before?: number; after?: number; ret?: number } = {}): DayReport {
  const before = over.before ?? s.account;
  const after = over.after ?? before;
  return {
    day,
    month: s.month,
    dayInMonth: 0,
    market: { moodBefore: 'flat', mood: 'flat', ret: 0 },
    themes: [],
    stocks: [],
    holdings: [],
    messages: [],
    ...over,
    account: { before, after, gross: after - before, ret: over.ret ?? Math.round(((after - before) / before) * 10000) / 100, effects: [] },
  } as unknown as DayReport;
}

/** 这个时机下，某个人可能说的话（他自己的 + 能用通用台词的时机的通用台词）。 */
function canSay(moment: ReactMoment, id: string, vars: Record<string, string>, generic: readonly string[] = []): string[] {
  const fill = (t: string): string => t.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
  return [...(REACT_LINES[moment][id] ?? []), ...generic].map(fill);
}

describe('收盘按局面接话，接话的人看性格', () => {
  it('账户第一次到开局的 2 倍：有人接一句，说的是他自己的话', () => {
    const s = createRun('react-record', { account: 1e5 }).state;
    for (let day = 1; day <= 20; day++) {
      const c = makeComments(s, report(s, day, { before: 1.9e5, after: 2.1e5, ret: 2 }))[0];
      expect(c, `day ${day}`).toBeDefined();
      expect(s.friends.map((f) => f.id)).toContain(c!.friendId);
      expect(canSay('record', c!.friendId, { n: '2' })).toContain(c!.text);
    }
  });

  it('大亏：按性格挑人，也有一部分随便谁说一句通用的；至少三个人开过口', () => {
    const s = createRun('react-loss', { account: 1e5 }).state;
    const speakers = new Set<string>();
    let personal = 0;
    let generic = 0;
    for (let day = 1; day <= 80; day++) {
      const r = report(s, day, { before: 1e5, after: 9e4, ret: -10, holdings: [{ stockId: 'ai_leader', slot: 0 }] as DayReport['holdings'] });
      const c = makeComments(s, r)[0]!;
      const vars = { amount: formatMoney(1e4) };
      speakers.add(c.friendId);
      const mine = canSay('bigLoss', c.friendId, vars).includes(c.text);
      const gen = canSay('bigLoss', '', vars, BIG_LOSS_LINES).includes(c.text);
      expect(mine || gen, `${c.friendId}：${c.text}`).toBe(true);
      if (mine) personal++;
      if (gen) generic++;
    }
    expect(speakers.size).toBeGreaterThanOrEqual(3);
    expect(personal).toBeGreaterThan(generic);
    expect(generic).toBeGreaterThan(0);
  });

  it('月底前两天钱不够还账单、大盘转熊、连赚、这个月亏多了：各有说法，按概率说、不天天念叨', () => {
    const s = createRun('react-more', { account: 1e5 }).state;
    const days = BALANCE.monthDays[s.month - 1] ?? 5;
    const seen = new Map<string, number>();
    const count = (k: string): void => void seen.set(k, (seen.get(k) ?? 0) + 1);
    for (let day = 1; day <= 60; day++) {
      s.bill = { ...s.bill, month: s.month, amount: 1e9 };
      const bill = makeComments(s, report(s, day, { dayInMonth: days - 1 }))[0];
      if (bill) {
        expect(canSay('bill', bill.friendId, { bill: formatMoney(1e9) })).toContain(bill.text);
        count('bill');
      }
      s.bill = { ...s.bill, amount: 0 };
      const bear = makeComments(s, report(s, day, { market: { moodBefore: 'flat', mood: 'bear', ret: -1 } }))[0]!;
      expect(canSay('bear', bear.friendId, {})).toContain(bear.text);
      count('bear');
      s.tempo = { ...s.tempo!, streak: 4 };
      const streak = makeComments(s, report(s, day, { before: 1e5, after: 1.01e5, ret: 1, holdings: [{ stockId: 'ai_leader', slot: 0 }] as DayReport['holdings'] }))[0];
      if (streak) {
        expect(canSay('streak', streak.friendId, { n: '5' })).toContain(streak.text);
        count('streak');
      }
      s.tempo = { ...s.tempo!, streak: 0 };
      s.stats = { ...s.stats, monthOpen: 1e5 };
      const slump = makeComments(s, report(s, day, { before: 7e4, after: 7e4, dayInMonth: 2 }))[0];
      if (slump) {
        expect(canSay('slump', slump.friendId, {})).toContain(slump.text);
        count('slump');
      }
    }
    expect(seen.get('bear')).toBe(60);
    for (const k of ['bill', 'streak', 'slump']) {
      expect(seen.get(k) ?? 0, k).toBeGreaterThan(10);
      expect(seen.get(k) ?? 0, k).toBeLessThan(50);
    }
  });

  it('台词表：每种时机开局的六个群友至少五个有话说，每人至少两句', () => {
    const founding = ['xiaoli', 'laowang', 'zhangjie', 'qunzhu', 'laozhao', 'dav'];
    for (const [moment, byFriend] of Object.entries(REACT_LINES)) {
      expect(founding.filter((id) => (byFriend[id]?.length ?? 0) >= 2).length, moment).toBeGreaterThanOrEqual(5);
    }
    for (const [id, pools] of Object.entries(HAND_TAILS)) for (const k of ['hot', 'cold'] as const) expect(pools[k].length, `${id} ${k}`).toBeGreaterThanOrEqual(2);
  });
});

describe('股票小人按大盘说话', () => {
  it('牛市、熊市多几句，平淡时只用原来的', () => {
    const flat = quipLines('ai_leader', 'limitUp');
    expect(quipLines('ai_leader', 'limitUp', 'flat')).toEqual(flat);
    for (const mood of ['bull', 'bear'] as const) {
      const lines = quipLines('ai_leader', 'limitUp', mood);
      for (const t of MOOD_QUIPS[mood].limitUp ?? []) expect(lines).toContain(t);
      for (const t of flat) expect(lines).toContain(t);
    }
  });
});

describe('正式局（真实行情）的群聊：确定性、不怎么重复', () => {
  useMarket((seed: string) => segmentForSeed(seed));
  useExt(true);

  /** 一局里玩家看到的群聊（盘前消息、推荐、收盘吐槽）和股票小人的台词。 */
  function texts(seed: string): { chat: string[]; quips: string[] } {
    const chat: string[] = [];
    const quips: string[] = [];
    let last = -1;
    playRun(seed, botByName('normal'), null, (s: GameState, evs: readonly GameEvent[]) => {
      if (s.phase === 'premarket' && s.today.day !== last) {
        last = s.today.day;
        for (const m of s.today.messages) chat.push(m.text);
        for (const r of s.today.recs) chat.push(r.text);
      }
      for (const e of evs) {
        if (e.type === 'comment') chat.push(e.text);
        if (e.type === 'quip') quips.push(e.text);
      }
    });
    return { chat, quips };
  }

  function repeats(all: readonly string[]): { max: number; rate: number } {
    const counts = new Map<string, number>();
    for (const t of all) counts.set(t, (counts.get(t) ?? 0) + 1);
    return { max: Math.max(0, ...counts.values()), rate: all.length === 0 ? 0 : 1 - counts.size / all.length };
  }

  it('同种子同打法，群聊和小人台词一字不差', () => {
    expect(texts('retrain-det')).toEqual(texts('retrain-det'));
  });

  it('一局里同一句话最多出现 5 次；群聊重复率低于 15%、小人台词低于 30%；手气好坏时消息句尾带口气', () => {
    const tails = Object.values(HAND_TAILS).flatMap((p) => [...p.hot, ...p.cold]);
    let withTail = 0;
    for (let k = 0; k < 4; k++) {
      const { chat, quips } = texts(`retrain-rep-${k}`);
      const c = repeats(chat);
      const q = repeats(quips);
      expect(c.max, `retrain-rep-${k} 群聊`).toBeLessThanOrEqual(5);
      expect(c.rate, `retrain-rep-${k} 群聊`).toBeLessThan(0.15);
      expect(q.max, `retrain-rep-${k} 小人`).toBeLessThanOrEqual(5);
      expect(q.rate, `retrain-rep-${k} 小人`).toBeLessThan(0.3);
      withTail += chat.filter((t) => tails.some((o) => t.endsWith(o))).length;
    }
    expect(withTail).toBeGreaterThan(20);
  });
});
