import { describe, expect, it } from 'vitest';
import { loadSave, recordRun } from '../src/platform/save.ts';

// 测试环境没有 localStorage：读档退回空档、写档静默失败，正好也测了"存储不可用照常能玩"
describe('本机存档', () => {
  it('没有存储时给空档', () => {
    const s = loadSave();
    expect(s.runs).toBe(0);
    expect(s.difficulty).toBe('easy');
  });
  it('纪录：赢了的比没赢的好，同样没赢比撑的时间；认输只记局数', () => {
    const s = loadSave();
    expect(recordRun(s, 'normal', { ticks: 300, kills: 10, won: false })).toBe(true);
    expect(recordRun(s, 'normal', { ticks: 200, kills: 99, won: false })).toBe(false);
    expect(recordRun(s, 'normal', { ticks: 9000, kills: 1, won: false }, false)).toBe(false);
    expect(s.best.normal?.ticks).toBe(300);
    expect(recordRun(s, 'normal', { ticks: 27000, kills: 5, won: true })).toBe(true);
    expect(recordRun(s, 'normal', { ticks: 400, kills: 500, won: false })).toBe(false);
    expect(s.runs).toBe(5);
    expect(s.wins).toBe(1);
  });
});
