import { describe, expect, it } from 'vitest';
import { createRun, dispatch, isQuietDay, stockById, type GameState, type Message } from '../src/core/index.ts';

/** 走到某月第二天以后、格子满着的盘前，再把今天的消息、推荐、空格按用例改掉 */
function midMonth(): GameState {
  let s = createRun('quiet-day', { themes: ['ai', 'newenergy', 'consumer', 'pharma', 'lowalt', 'pig'], holdings: ['ai_leader', 'con_blue', 'pig_leader'] }, { tempo: true }).state;
  for (let i = 0; i < 200 && !(s.phase === 'premarket' && s.dayInMonth > 0 && !s.notice); i++) {
    const r = dispatch(s, s.phase === 'reward' ? { type: 'skipReward' } : s.phase === 'event' ? { type: 'choose', option: 0 } : { type: 'open' });
    s = r.state;
  }
  expect(s.phase).toBe('premarket');
  return structuredClone(s);
}
const msg = (theme: string, claim: Message['claim'], extra: Partial<Message> = {}): Message => ({ friendId: 'laowang', theme: theme as Message['theme'], claim, text: '', ...extra });

describe('0.19.4 盘前平淡日（自动快进）', () => {
  it('有空格但今天买不了（次数用完 / 推荐都买过）不算有事；还能买才停下', () => {
    const s = midMonth();
    s.today.messages = [];
    s.slots[s.slots.length - 1] = null;
    s.today.buysLeft = 0;
    expect(isQuietDay(s)).toBe(true);
    s.today.buysLeft = 1;
    s.today.recs = s.today.recs.map((r) => ({ ...r, taken: true }));
    expect(isQuietDay(s)).toBe(true);
    s.today.recs = [{ stockId: s.slots.find((h) => h)!.stockId, friendId: 'laowang', text: '', taken: false }];
    expect(isQuietDay(s)).toBe(false);
  });

  it('聊拿着的风口：顺着说的不停，说反了、说拐点的停；没拿着的风口随便说', () => {
    const s = midMonth();
    s.today.recs = [];
    const held = s.slots.find((h) => h && !h.short)!;
    const theme = stockById(held.stockId).theme;
    s.today.messages = [msg(theme, 'up')];
    expect(isQuietDay(s)).toBe(true);
    s.today.messages = [msg(theme, 'down')];
    expect(isQuietDay(s)).toBe(false);
    // 反着信群主：说涨按跌读
    s.today.messages = [msg(theme, 'up', { reverse: true })];
    expect(isQuietDay(s)).toBe(false);
    s.today.messages = [msg(theme, 'up', { turn: 'top' as Message['turn'] })];
    expect(isQuietDay(s)).toBe(false);
    s.today.messages = [msg(theme, 'up', { big: true })];
    expect(isQuietDay(s)).toBe(false);
  });
});
