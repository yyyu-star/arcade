/**
 * 分享卡（0.12.0）：排版用到的纯函数。画布本身在浏览器里看（demo/share.html），这里没有 DOM；
 * import share.ts 不碰 DOM 这一条也靠这个文件守着（workerd 里没有 document，碰了就报错）。
 */
import { describe, expect, it } from 'vitest';
import { CARD_H, CARD_W, MAX_STATS, accentOf, artRect, cardDate, clip, normalizeCard, prepareShare, shade, wrapLines } from '../src/share.ts';

describe('分享卡的字', () => {
  it('尺寸是 1080×1350', () => {
    expect([CARD_W, CARD_H]).toEqual([1080, 1350]);
  });

  it('截短按码点算，不切坏表情', () => {
    expect(clip('  牌局  ', 5)).toBe('牌局');
    expect(clip('一二三四五六', 4)).toBe('一二三…');
    expect(clip('😀😀😀', 2)).toBe('😀…');
    expect([...clip('😀😀😀', 2)]).toHaveLength(2);
  });

  it('主题色只认 #rrggbb', () => {
    expect(accentOf('#A1B2C3')).toBe('#a1b2c3');
    expect(accentOf('red')).toBe('#9b2f24');
    expect(accentOf('#abc')).toBe('#9b2f24');
    expect(accentOf('url(x)')).toBe('#9b2f24');
  });

  it('变深变浅', () => {
    expect(shade('#808080', -1)).toBe('#000000');
    expect(shade('#808080', 1)).toBe('#ffffff');
    expect(shade('#808080', 0)).toBe('#808080');
    expect(shade('#ff0000', -0.5)).toBe('#800000');
  });

  it('日期按北京时间', () => {
    // UTC 10-15 17:00 = 北京 10-16 01:00
    expect(cardDate(new Date(Date.UTC(2026, 9, 15, 17, 0)))).toBe('2026.10.16');
    expect(cardDate(new Date(Date.UTC(2026, 0, 1, 3, 0)))).toBe('2026.01.01');
  });

  it('小数据最多三条，字都截短', () => {
    const c = normalizeCard({
      game: '游戏',
      title: '一'.repeat(40),
      big: { value: '+12', label: '份' },
      stats: [1, 2, 3, 4, 5].map((i) => ({ label: `第${i}`, value: String(i) })),
      accent: 'nope',
      player: { name: '玩家', badge: '' },
    });
    expect(c.stats).toHaveLength(MAX_STATS);
    expect([...c.title]).toHaveLength(20);
    expect(c.accent).toBe('#9b2f24');
    expect(c.line).toBe('');
    expect(c.player).toEqual({ name: '玩家' });
    expect(c.date).toBeInstanceOf(Date);
  });
});

describe('折行', () => {
  const m = (s: string): number => [...s].length * 10; // 每个字 10 宽

  it('放得下就一行', () => {
    expect(wrapLines('一二三', 100, m, 2)).toEqual(['一二三']);
  });

  it('中文逐字折，英文按词', () => {
    expect(wrapLines('一二三四五六七', 30, m, 3)).toEqual(['一二三', '四五六', '七']);
    expect(wrapLines('ab cd ef', 50, m, 3)).toEqual(['ab cd', 'ef']);
  });

  it('超过行数，最后一行补省略号', () => {
    const out = wrapLines('一二三四五六七八九十', 30, m, 2);
    expect(out).toHaveLength(2);
    expect(out[1]!.endsWith('…')).toBe(true);
    expect(m(out[1]!)).toBeLessThanOrEqual(30);
  });

  it('一个字都放不下也不死循环', () => {
    expect(wrapLines('一二', 5, m, 2)).toEqual(['一', '二']);
  });
});

describe('图怎么放', () => {
  const box = { x: 10, y: 20, w: 100, h: 100 };

  it('contain：整张放进、居中', () => {
    expect(artRect({ w: 200, h: 100 }, box, 'contain')).toEqual([0, 0, 200, 100, 10, 45, 100, 50]);
  });

  it('cover：铺满、裁中间', () => {
    expect(artRect({ w: 200, h: 100 }, box, 'cover')).toEqual([50, 0, 100, 100, 10, 20, 100, 100]);
  });

  it('图集切片：按 crop 算', () => {
    const crop = { x: 64, y: 32, w: 32, h: 64 };
    expect(artRect({ w: 512, h: 512 }, box, 'contain', crop)).toEqual([64, 32, 32, 64, 35, 20, 50, 100]);
    expect(artRect({ w: 512, h: 512 }, box, 'cover', crop)).toEqual([64, 48, 32, 32, 10, 20, 100, 100]);
  });
});

describe('折行：正好放得下', () => {
  const m = (s: string): number => [...s].length * 10;

  it('英文两行正好放下，不多补省略号', () => {
    expect(wrapLines('ab cd ef gh', 50, m, 2)).toEqual(['ab cd', 'ef gh']);
  });

  it('最后剩的是空白不算截断', () => {
    expect(wrapLines('一二三四五六 ', 30, m, 2)).toEqual(['一二三', '四五六']);
  });
});

describe('折行：收尾的引号、标点不单独成行（0.12.3）', () => {
  const m = (s: string): number => [...s].length * 10;

  it('名场面结尾的引号跟着最后一个字走', () => {
    // 一行 6 个字：以前是 ['“一二三四五', '”']
    expect(wrapLines('“一二三四五”', 60, m, 2)).toEqual(['“一二三四', '五”']);
  });

  it('中间的逗号、句号也不放行首', () => {
    expect(wrapLines('一二三，四五六。', 30, m, 3)).toEqual(['一二', '三，四', '五六。']);
  });

  it('带下来的那一行正好是最后一行、后面还有字：照样截断补省略号', () => {
    const out = wrapLines('“一二三四五”六七八', 60, m, 1);
    expect(out).toHaveLength(1);
    expect(out[0]!.endsWith('…')).toBe(true);
  });

  it('行里只有一个字放不下标点：不硬拆，标点照常换行', () => {
    expect(wrapLines('一”', 10, m, 2)).toEqual(['一', '”']);
  });
});

describe('先画好的卡（prepareShare，0.12.3）', () => {
  it('没有 DOM 画不了：ready 照样 resolve（不抛），点分享时才报错', async () => {
    const p = prepareShare({ game: 'g', title: 't', big: { value: '1', label: 'x' }, accent: '#123456' }, { url: 'https://game.example.com/' });
    await expect(p.ready).resolves.toBeUndefined();
    await expect(p.share()).rejects.toBeTruthy();
  });
});
