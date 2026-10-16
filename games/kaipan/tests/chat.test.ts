import { describe, expect, it } from 'vitest';
import {
  BALANCE,
  DIRS,
  FRIENDS,
  HAND_TAILS,
  MESSAGE_LINES,
  TURN_LINES,
  chatView,
  credibility,
  createRun,
  dirOf,
  dispatch,
  effectiveDH,
  feelOf,
  messageCred,
  recCredibility,
  rulesOf,
  stockById,
  themeById,
  topicsOf,
  turnOf,
  turnTalk,
  type Dir,
  type GameState,
} from '../src/core/index.ts';
import { withBalance } from './helpers.ts';

/** 跑若干天（只开盘），对每条消息回调（消息、当天开盘前的局面）。 */
function eachMessage(seeds: number, days: number, setup: Parameters<typeof createRun>[1], fn: (s: GameState, i: number) => void): void {
  for (let k = 0; k < seeds; k++) {
    let s = createRun(`chat-${k}`, { account: 1e9, ...setup }).state;
    for (let d = 0; d < days && s.phase !== 'won'; d++) {
      if (s.phase === 'premarket') s.today.messages.forEach((_, i) => fn(s, i));
      const a = s.phase === 'premarket' ? { type: 'open' as const } : s.phase === 'reward' ? { type: 'skipReward' as const } : { type: 'choose' as const, option: 1 };
      s = dispatch(s, a, { inPlace: true, events: false }).state;
    }
  }
}

function truthOf(s: GameState, i: number): Dir {
  const m = s.today.messages[i];
  if (!m) throw new Error('no message');
  const t = s.themes[m.theme];
  return dirOf(t ? effectiveDH(t.heat, s.today.plan.dH[m.theme] ?? 0) : 0);
}

describe('群聊消息', () => {
  it('每天 2–4 条，来自不同群友；说的是本局登场的题材', () => {
    eachMessage(5, 40, {}, (s) => {
      const ids = s.today.messages.map((m) => m.friendId);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.length).toBeGreaterThanOrEqual(BALANCE.messages[0]);
      expect(ids.length).toBeLessThanOrEqual(BALANCE.messages[1]);
      for (const m of s.today.messages) {
        expect(s.themeIds).toContain(m.theme);
        expect(m.text.length).toBeGreaterThan(0);
      }
    });
  });

  it('统计性质：说中的概率等于可信度；说错时两种错法各占一半', () => {
    const stat = new Map<string, { n: number; hit: number; cred: number }>();
    const wrong = new Map<string, number>();
    eachMessage(60, 58, {}, (s, i) => {
      const m = s.today.messages[i];
      if (!m) return;
      const cred = messageCred(s, m.friendId, m.theme, rulesOf(s));
      const key = `${m.friendId}@${cred}`;
      const a = stat.get(key) ?? { n: 0, hit: 0, cred };
      const truth = truthOf(s, i);
      a.n += 1;
      if (m.claim === truth) a.hit += 1;
      else {
        // 把两种错法按"真相之后的第一个 / 第二个"归类
        const others = DIRS.filter((d) => d !== truth);
        const k = others.indexOf(m.claim);
        wrong.set(String(k), (wrong.get(String(k)) ?? 0) + 1);
      }
      stat.set(key, a);
    });
    let checked = 0;
    for (const [key, a] of stat) {
      if (a.n < 300) continue;
      checked += 1;
      const p = a.hit / a.n;
      // 4 个标准差以内
      const sd = Math.sqrt((a.cred * (1 - a.cred)) / a.n);
      expect(Math.abs(p - a.cred), `${key} 实际 ${p.toFixed(3)}（${a.n} 条）`).toBeLessThan(4 * sd + 0.005);
    }
    expect(checked).toBeGreaterThanOrEqual(6);
    const w0 = wrong.get('0') ?? 0;
    const w1 = wrong.get('1') ?? 0;
    expect(Math.abs(w0 / (w0 + w1) - 0.5)).toBeLessThan(0.03);
  });

  it('拐点：题材今天刚启动、见顶、退潮时，被聊到的概率明显更高', () => {
    const seen = new Map<string, [number, number]>();
    for (let k = 0; k < 40; k++) {
      let s = createRun(`turn-${k}`, { account: 1e9 }).state;
      for (let d = 0; d < 58 && s.phase !== 'won'; d++) {
        if (s.phase === 'premarket') {
          for (const id of s.themeIds) {
            const t = s.themes[id];
            if (!t) continue;
            const kind = turnOf(t) === null ? 'none' : turnOf(t) === 'fizzle' ? 'fizzle' : 'turn';
            const x = seen.get(kind) ?? [0, 0];
            x[0] += s.today.messages.some((m) => m.theme === id) ? 1 : 0;
            x[1] += 1;
            seen.set(kind, x);
          }
        }
        const a = s.phase === 'premarket' ? { type: 'open' as const } : s.phase === 'reward' ? { type: 'skipReward' as const } : { type: 'choose' as const, option: 1 };
        s = dispatch(s, a, { inPlace: true, events: false }).state;
      }
    }
    const rate = (k: string): number => {
      const x = seen.get(k) ?? [0, 1];
      return x[0] / x[1];
    };
    expect((seen.get('turn') ?? [0, 0])[1]).toBeGreaterThan(300);
    expect(rate('turn')).toBeGreaterThan(rate('none') * 1.8);
  });

  it('拐点不改消息语义：仍然说今天热度的方向；拐点说法只由方向和公开体感决定', () => {
    let turns = 0;
    eachMessage(20, 58, {}, (s, i) => {
      const m = s.today.messages[i];
      if (!m) return;
      expect(DIRS).toContain(m.claim);
      const want = turnTalk(m.claim, feelOf(s.themes[m.theme]?.history ?? []));
      expect(m.turn ?? null).toBe(want);
      const pool = want ? TURN_LINES[m.friendId]?.[want] : MESSAGE_LINES[m.friendId]?.[m.claim];
      const name = themeById(m.theme).name;
      // 0.7.0：手气好坏时句尾可能多一句口气（HAND_TAILS），前面还是按方向挑的台词
      const tails = Object.values(HAND_TAILS[m.friendId] ?? {}).flat();
      const body = tails.reduce((t, o) => (t.endsWith(o) ? t.slice(0, -o.length) : t), m.text);
      expect(pool?.map((line) => line.replaceAll('{theme}', name))).toContain(body);
      if (want) turns += 1;
    });
    expect(turns).toBeGreaterThan(50);
    expect(turnTalk('up', 'cold')).toBe('start');
    expect(turnTalk('up', 'cooling')).toBe('start');
    expect(turnTalk('flat', 'hot')).toBe('top');
    expect(turnTalk('flat', 'warming')).toBeNull();
    expect(turnTalk('down', 'overheated')).toBe('ebb');
    expect(turnTalk('down', 'warming')).toBe('ebb');
    expect(turnTalk('up', 'hot')).toBeNull();
    expect(turnTalk('down', 'cold')).toBeNull();
  });

  it('拐点台词：每个群友三种说法都有', () => {
    for (const f of FRIENDS) for (const k of ['start', 'top', 'ebb'] as const) expect(TURN_LINES[f.id]?.[k]?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('靠谱群友在擅长题材的拐点上可以额外加可信度（turnCred，默认值见 BALANCE）', () => {
    withBalance((b) => {
      b.chat.turnCred = 0.1;
    }, () => {
      let checked = 0;
      eachMessage(20, 58, {}, (s, i) => {
        const m = s.today.messages[i];
        if (!m) return;
        const t = s.themes[m.theme];
        const base = credibility(s, m.friendId, m.theme, rulesOf(s));
        const reliable = (BALANCE.cred[m.friendId]?.[0] ?? 0) >= BALANCE.chat.reliable;
        const f = s.friends.find((x) => x.id === m.friendId);
        const expert = !!f && topicsOf(s, f).includes(m.theme);
        const turning = !!t && turnOf(t) !== null;
        const want = reliable && expert && turning ? Math.min(1, base + 0.1) : base;
        expect(messageCred(s, m.friendId, m.theme, rulesOf(s))).toBeCloseTo(want, 9);
        if (want !== base) checked += 1;
      });
      expect(checked).toBeGreaterThan(5);
    });
  });

  it('可信度表：擅长 / 其他；群主 0.3（反指）；大V谈最热的题材；靠谱的开局群友聊擅长题材时消息更准（荐股不加）', () => {
    const s = createRun('cred', { themes: ['ai', 'newenergy', 'consumer', 'finance', 'gaming', 'pig'] }).state;
    const r = rulesOf(s);
    const { expertMsg, credMax } = BALANCE.chat;
    expect(expertMsg).toBeGreaterThan(0);
    expect(credMax).toBeLessThan(1);
    expect(credibility(s, 'xiaoli', 'ai', r)).toBeCloseTo(Math.min(0.75 + expertMsg, credMax));
    expect(recCredibility(s, 'xiaoli', 'ai', r)).toBe(0.75);
    expect(credibility(s, 'xiaoli', 'finance', r)).toBe(0.5);
    expect(credibility(s, 'laowang', 'finance', r)).toBeCloseTo(Math.min(0.85 + expertMsg, credMax));
    expect(credibility(s, 'laowang', 'finance', r)).toBeLessThan(1); // 老王的小本本"必中"仍然有用
    expect(recCredibility(s, 'laowang', 'finance', r)).toBe(0.85);
    expect(credibility(s, 'laowang', 'ai', r)).toBe(0.55);
    expect(credibility(s, 'qunzhu', 'ai', r)).toBe(0.3);
    expect(credibility(s, 'dav', 'pig', r)).toBe(0.55);
    const dav = s.friends.find((f) => f.id === 'dav');
    expect(dav && topicsOf(s, dav)).toHaveLength(1);
  });

  it('没有道具指定时可信度封顶 credMax：人设加成叠上去也不会"必中"，消息也不标"必中"', () => {
    const { credMax } = BALANCE.chat;
    for (const persona of ['retiree', 'mom'] as const) {
      for (let i = 0; i < 20; i++) {
        const s = createRun(`cap-${persona}-${i}`, { persona }).state;
        const r = rulesOf(s);
        for (const f of s.friends) for (const t of s.themeIds) expect(credibility(s, f.id, t, r), `${persona} ${f.id} ${t}`).toBeLessThanOrEqual(credMax);
        expect(chatView(s).messages.every((m) => !m.certain)).toBe(true);
      }
    }
    // 实际说中率也不是 100%：老周的老王谈金融 / 大消费、芳姐的张姐谈医药 / 大消费
    let n = 0;
    let hit = 0;
    for (const [persona, friend] of [
      ['retiree', 'laowang'],
      ['mom', 'zhangjie'],
    ] as const) {
      eachMessage(40, 40, { persona }, (s, i) => {
        const m = s.today.messages[i];
        if (m?.friendId !== friend || !topicsOf(s, s.friends.find((f) => f.id === friend)!).includes(m.theme) || turnOf(s.themes[m.theme]!) !== null) return;
        n += 1;
        if (m.claim === truthOf(s, i)) hit += 1;
      });
    }
    expect(n).toBeGreaterThan(100);
    expect(hit).toBeLessThan(n);
  });

  it('老王的小本本：老王的消息必中', () => {
    let n = 0;
    eachMessage(30, 58, { items: ['notebook'] }, (s, i) => {
      const m = s.today.messages[i];
      if (m?.friendId !== 'laowang') return;
      n += 1;
      expect(m.claim).toBe(truthOf(s, i));
    });
    expect(n).toBeGreaterThan(50);
  });

  it('内幕哥（付费群）：只谈入群时随机的两个题材，可信度 0.9', () => {
    let n = 0;
    let hit = 0;
    eachMessage(40, 58, { items: ['paid_group'] }, (s, i) => {
      const m = s.today.messages[i];
      if (m?.friendId !== 'neimu') return;
      const f = s.friends.find((x) => x.id === 'neimu');
      expect(f?.topics).toHaveLength(2);
      expect(f?.topics).toContain(m.theme);
      n += 1;
      if (m.claim === truthOf(s, i)) hit += 1;
    });
    expect(n).toBeGreaterThan(300);
    expect(hit / n).toBeCloseTo(0.9, 1);
  });

  it('收盘后揭晓：群友战绩按说中次数累计', () => {
    let s = createRun('record').state;
    const msgs = s.today.messages.map((m) => ({ ...m }));
    const truths = msgs.map((_, i) => truthOf(s, i));
    const r = dispatch(s, { type: 'open' });
    s = r.state;
    const judged = r.events.filter((e) => e.type === 'messageJudged');
    expect(judged).toHaveLength(msgs.length);
    msgs.forEach((m, i) => {
      const f = s.friends.find((x) => x.id === m.friendId);
      expect(f?.total).toBe(1);
      expect(f?.hits).toBe(m.claim === truths[i] ? 1 : 0);
    });
    expect(r.events.some((e) => e.type === 'comment')).toBe(true);
  });
});

describe('推荐', () => {
  it('每天 3 只，不重复、不推已持有的、不推退市的；每只附推荐人和理由', () => {
    for (let k = 0; k < 20; k++) {
      let s = createRun(`recs-${k}`, { holdings: [] }).state;
      for (let d = 0; d < 20 && s.phase === 'premarket'; d++) {
        const ids = s.today.recs.map((r) => r.stockId);
        expect(ids).toHaveLength(3);
        expect(new Set(ids).size).toBe(3);
        for (const r of s.today.recs) {
          expect(s.slots.some((h) => h?.stockId === r.stockId)).toBe(false);
          expect(s.stocks[r.stockId]?.delisted).toBe(false);
          expect(s.friends.map((f) => f.id)).toContain(r.friendId);
          expect(r.text).toContain(stockById(r.stockId).name);
        }
        const buy = dispatch(s, { type: 'buy', rec: 0 });
        s = buy.error ? s : buy.state;
        s = dispatch(s, { type: 'open' }).state;
      }
    }
  });

  it('群主专挑高位的题材喊单（反指）；靠谱群友推的多是今天会涨的题材', () => {
    let qn = 0;
    let qHigh = 0;
    let gn = 0;
    let gUp = 0;
    let all = 0;
    let allUp = 0;
    let allHigh = 0;
    for (let k = 0; k < 60; k++) {
      let s = createRun(`shill-${k}`, { account: 1e9 }).state;
      for (let d = 0; d < 58 && s.phase !== 'won'; d++) {
        if (s.phase === 'premarket') {
          for (const t of s.themeIds) {
            all += 1;
            const th = s.themes[t];
            if (th && dirOf(effectiveDH(th.heat, s.today.plan.dH[t] ?? 0)) === 'up') allUp += 1;
            if (th && (th.stage === 'climax' || th.stage === 'ebb')) allHigh += 1;
          }
          for (const r of s.today.recs) {
            const th = s.themes[stockById(r.stockId).theme];
            if (!th) continue;
            if (r.friendId === 'qunzhu') {
              qn += 1;
              if (th.stage === 'climax' || th.stage === 'ebb') qHigh += 1;
            } else if (r.friendId === 'laowang' || r.friendId === 'xiaoli' || r.friendId === 'zhangjie') {
              gn += 1;
              if (dirOf(effectiveDH(th.heat, s.today.plan.dH[stockById(r.stockId).theme] ?? 0)) === 'up') gUp += 1;
            }
          }
        }
        const a = s.phase === 'premarket' ? { type: 'open' as const } : s.phase === 'reward' ? { type: 'skipReward' as const } : { type: 'choose' as const, option: 1 };
        s = dispatch(s, a, { inPlace: true, events: false }).state;
      }
    }
    expect(qHigh / qn).toBeGreaterThan(allHigh / all + 0.15);
    expect(gUp / gn).toBeGreaterThan(allUp / all + 0.2);
  });

  it('关闭群聊（模拟用）：没有消息，推荐来自行情软件', () => {
    const s = createRun('nochat', { noChat: true }).state;
    expect(s.today.messages).toEqual([]);
    expect(s.today.recs).toHaveLength(3);
    for (const r of s.today.recs) expect(r.friendId).toBe('');
  });
});
