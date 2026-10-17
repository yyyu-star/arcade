import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadDailyFormat, loadScoreFormat } from '../src/scores';

// 每个用例用不同的游戏 id：src/gamefile.ts 一个页面里同一个文件只读一次
function serve(body: unknown, status = 200) {
  vi.stubGlobal('fetch', async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
}

describe('每日榜分数的写法（游戏的 daily.json）', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('从上往下取第一条能用的，{n} 是减去 from 后按千分位写', async () => {
    serve({ note: '每天一样的行情', score: [{ from: 1e11, text: '通关 · {n} 元' }, { text: '撑了 {n} 个月' }] });
    const f = await loadDailyFormat('a');
    expect([f.score(1e11 + 3_820_000), f.score(1e11), f.score(7), f.note]).toEqual(['通关 · 3,820,000 元', '通关 · 0 元', '撑了 7 个月', '每天一样的行情']);
  });

  it('读不到、不是对象、规则不合格、没有一条能用：直接按千分位写，不显示说明', async () => {
    serve('not found', 404);
    expect((await loadDailyFormat('b')).score(12_345)).toBe('12,345');
    serve('[1, 2]');
    expect((await loadDailyFormat('c')).note).toBeNull();
    serve({ note: 3, score: [{ text: '没有占位' }, { from: 'x', text: '{n}' }, { from: 100, text: '{n} 分' }] });
    const f = await loadDailyFormat('d');
    expect([f.score(150), f.score(99), f.note]).toEqual(['50 分', '99', null]);
  });

  it('总榜的 boards.json（0.23.0）：按榜分开写；fields 把复合编码拆开，fmt 写成分:秒，没写 fields 照旧 {n}', async () => {
    serve({
      boards: {
        vigil: { score: [{ fields: { d: [1e10, null], s: [1e4, 1e6], k: [1, 1e4] }, fmt: { s: 'mmss' }, text: '危险{d} · {s} · 斩 {k}' }] },
        endless: { score: [{ fields: { s: [1e4, null], k: [1, 1e4] }, text: '撑 {s} 秒 · 斩 {k}' }] },
        raid: { note: '带出最多', score: [{ text: '带出 {n} 铜钱' }] },
      },
    });
    const vigil = await loadScoreFormat('e', 'boards.json', 'vigil');
    expect(vigil.score(2 * 1e10 + 754 * 1e4 + 1_234)).toBe('危险2 · 12:34 · 斩 1,234');
    expect((await loadScoreFormat('e', 'boards.json', 'endless')).score(1_250 * 1e4 + 88)).toBe('撑 1,250 秒 · 斩 88');
    const raid = await loadScoreFormat('e', 'boards.json', 'raid');
    expect([raid.score(5_600), raid.note]).toEqual(['带出 5,600 铜钱', '带出最多']);
  });

  it('fields 不合格的那条不用：除数不是正整数、取模不对、字段名不对、text 里一个数都没有', async () => {
    serve({
      score: [
        { fields: { s: [0, null] }, text: '{s}' },
        { fields: { s: [1, -1] }, text: '{s}' },
        { fields: { Bad: [1, null] }, text: '{Bad}' },
        { fields: { s: [1, null] }, text: '没有占位' },
        { from: 10, fields: { s: [2, null] }, text: '{s} 双' },
      ],
    });
    const f = await loadScoreFormat('f', 'boards.json');
    expect([f.score(30), f.score(9)]).toEqual(['10 双', '9']);
  });
});
