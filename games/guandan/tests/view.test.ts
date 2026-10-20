import { describe, expect, it } from 'vitest';
import { createGame, isWild, makeCard, parseCards } from '../src/variants/guandan/core/index.ts';
import { columnsFor } from '../src/view/table/columns.ts';
import { KEYS } from '../src/view/store.ts';
import { playLabel } from '../src/view/labels.ts';
import { interpret, DEFAULT_OPTIONS } from '../src/variants/guandan/core/index.ts';
import { worldWidthFor } from '../src/view/theme.ts';

/** 画面层源码（以文本导入，不执行）。 */
const viewSources = import.meta.glob(['../src/view/**/*.ts', '../src/debug/**/*.ts', '../src/main.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('手牌分列', () => {
  const hands = Array.from({ length: 40 }, (_, i) => createGame(`cols-${i}`).state.hands);
  it('每种理牌方式都不丢牌、不重复，每列不超过 5 张', () => {
    for (const hs of hands) {
      for (const hand of hs) {
        for (const mode of ['rank', 'type'] as const) {
          const cols = columnsFor(hand, 2, mode);
          const flat = cols.flat();
          expect(flat.length).toBe(hand.length);
          expect(new Set(flat).size).toBe(hand.length);
          expect(Math.max(...cols.map((c) => c.length))).toBeLessThanOrEqual(5);
          // 横向放得下时画面用一列最多 4 张（手机上每张露得更多）
          const short = columnsFor(hand, 2, mode, 4);
          expect(short.flat().sort()).toEqual([...hand].sort());
          expect(Math.max(...short.map((c) => c.length))).toBeLessThanOrEqual(4);
        }
      }
    }
  });
  it('按点数：大牌在左，逢人配单独一列', () => {
    const hand = parseCards('♠3 ♥3 ♣A 大王 ♥7 ♠7 ♣7');
    const cols = columnsFor(hand, 7, 'rank');
    expect(cols[0]).toEqual([makeCard(17, 0)]);
    expect(cols[1]!.every((c) => isWild(c, 7))).toBe(true);
    expect(cols[cols.length - 1]!.length).toBe(2);
  });
  it('一列 8 张（炸弹）拆成相邻两列', () => {
    const hand = parseCards('♠9 ♠9 ♥9 ♥9 ♣9 ♣9 ♦9 ♦9');
    expect(columnsFor(hand, 2, 'rank').map((c) => c.length)).toEqual([4, 4]);
  });
});

describe('存储与画面约定', () => {
  it('存储 key 全部带 guandan. 前缀', () => {
    for (const k of Object.values(KEYS)) expect(k.startsWith('guandan.')).toBe(true);
  });
  it('画面层只在 store.ts 里碰 localStorage、sessionStorage', () => {
    for (const [path, src] of Object.entries(viewSources)) {
      if (path.endsWith('/store.ts') || path.endsWith('main.ts')) continue;
      expect(/(localStorage|sessionStorage)\.(getItem|setItem|removeItem)/.test(src), path).toBe(false);
    }
  });
  it('画面层不改核心状态（只通过 dispatch 推进，调试跳转除外）', () => {
    for (const [path, src] of Object.entries(viewSources)) {
      if (path.includes('/debug/')) continue;
      expect(/state\.(hands|levels|phase|turn|trick)\s*=[^=]/.test(src), path).toBe(false);
    }
  });
  it('牌型名：炸弹带张数', () => {
    const bomb = interpret(parseCards('♠9 ♥9 ♣9 ♦9 ♠9 ♥9'), 2, DEFAULT_OPTIONS)[0]!;
    expect(playLabel(bomb)).toBe('炸弹×6');
  });
  it('世界宽度随宽高比在 1280..1720 之间', () => {
    expect(worldWidthFor(1280, 720)).toBe(1280);
    expect(worldWidthFor(844, 390)).toBeGreaterThan(1500);
    expect(worldWidthFor(3000, 600)).toBe(1720);
    expect(worldWidthFor(1024, 768)).toBe(1280);
  });
});

describe('内嵌标题字体', () => {
  const fontText = import.meta.glob('../src/view/fonts/*.txt', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const titleChars = new Set([...fontText['../src/view/fonts/title-chars.txt']!]);
  const svgChars = new Set([...fontText['../src/view/fonts/svg-chars.txt']!]);
  const cjk = (s: string) => [...s].filter((c) => c.codePointAt(0)! > 0x7f);

  it('用标题字体的文字（大字、横幅、弹窗标题）在子集字表里都有，不会一半宋体一半黑体', () => {
    const missing = new Set<string>();
    for (const src of Object.values(viewSources)) {
      for (const line of src.split('\n')) {
        if (!/bigWord\(|banner\(|font: 'title'|modal\((scene|this)|panel\((scene|this)/.test(line) || /export (async )?function/.test(line)) continue;
        for (const m of line.matchAll(/'([^'\n]*)'|`([^`]*)`/g)) for (const c of cjk(m[1] ?? m[2]!)) if (!titleChars.has(c)) missing.add(c);
      }
    }
    // 动态拼进来的：牌型名、名次、人名
    const dynamic = ['炸弹×', '同花顺', '天王炸', '三连对', '钢板', '三带二', '顺子', '单张', '对子', '三张', '头游二游三游末游', '老张小美阿强你'];
    for (const s of dynamic) for (const c of cjk(s)) if (!titleChars.has(c)) missing.add(c);
    expect([...missing].join('')).toBe('');
  });

  it('SVG 美术里的宋体字在内嵌小字体里都有', () => {
    const missing = cjk('掼蛋单机版福级配大王小王头游二游三游末游').filter((c) => !svgChars.has(c));
    expect(missing.join('')).toBe('');
  });
});
