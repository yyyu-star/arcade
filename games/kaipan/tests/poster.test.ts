import { describe, expect, it } from 'vitest';
import { createRun, runSummary } from '../src/core/index.ts';
import { gameLink, posterContent, wrapText } from '../src/view/poster.ts';
import { botByName, playRun } from '../tools/bots.ts';

/** 0.6.5 结局海报：写什么（画在 canvas 上的部分靠冒烟截图看）。 */
describe('结局海报', () => {
  it('通关局：结局、称号、打法评语、四格数字、最赚的一笔、编号', () => {
    const s = playRun('poster-1', botByName('smart'), null);
    const sum = runSummary(s);
    const c = posterContent(sum);
    expect(c.result).toBe(sum.won ? '通关' : '出局');
    expect(c.title).toBe(sum.title);
    expect(c.styleTag).toBe(sum.style.tag);
    expect(c.styleLine).toBe(sum.style.line);
    expect(c.stats).toHaveLength(4);
    expect(c.best?.name).toBe(sum.bestTrade?.name);
    expect(c.footer).toContain('#poster-1');
    expect(c.badge).toBeNull();
  });

  it('每日挑战：标签带日期，读到名次再带名次；底下一行和分享标题是邀请（0.6.10）', () => {
    const sum = { ...runSummary(createRun('poster-daily').state), daily: '2026-10-15' };
    const plain = posterContent(sum);
    expect(plain.badge).toBe('每日挑战 10/15');
    expect(plain.footer).toContain('所有人同一局');
    expect(plain.shareTitle).toBe('开盘每日挑战，同一局你来试试');
    const ranked = posterContent(sum, 3);
    expect(ranked.badge).toBe('每日挑战 10/15 · 第3名');
    expect(ranked.shareTitle).toContain('今天第 3 名');
    // 名次读不到（1 万名以外）就不写
    expect(posterContent(sum, null).badge).toBe('每日挑战 10/15');
    expect(posterContent(runSummary(createRun('poster-plain').state), 3).shareTitle).toBe('开盘 · 我的这一局');
  });

  it('分享文字里的游戏地址：按当前页面推，去掉参数，归到游戏首页（0.6.11）', () => {
    expect(gameLink('https://game.example.com/games/kaipan/?debug=1#x')).toBe('https://game.example.com/games/kaipan/');
    expect(gameLink('https://game.example.com/games/kaipan/index.html?seed=1')).toBe('https://game.example.com/games/kaipan/');
    expect(gameLink('https://game.example.com/games/kaipan')).toBe('https://game.example.com/games/kaipan/');
    expect(gameLink('http://127.0.0.1:5173/')).toBe('http://127.0.0.1:5173/');
  });

  it('一笔没买：没有最赚的一笔', () => {
    const s = createRun('poster-zen').state;
    s.phase = 'lost';
    expect(posterContent(runSummary(s)).best).toBeNull();
  });

  it('折行：按宽度断字，超出行数的最后一行加省略号', () => {
    const m = (x: string): number => Array.from(x).length * 10;
    expect(wrapText(m, '一二三四五六七', 30, 3)).toEqual(['一二三', '四五六', '七']);
    expect(wrapText(m, '一二三四五六七', 30, 2)).toEqual(['一二三', '四五…']);
  });
});
