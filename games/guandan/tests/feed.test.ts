/**
 * 好友动态的名场面（0.15.0，src/view/feed.ts、public/moments.json）：挑哪条、一局最多几条；模板只用平台认的占位符、不超过 40 字，每个编号都有模板
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FEED_MAX, feedPick } from '../src/view/feed.ts';
import type { Highlight } from '../src/view/highlights.ts';

const hl = (kind: Highlight['kind'], seat: number, n?: number): Highlight => (n === undefined ? { kind, seat } : { kind, seat, n });

describe('挑哪条报', () => {
  it('我做到的：按精彩程度第一条', () => {
    expect(feedPick([hl('jokerBomb', 0), hl('bombs3', 0, 4)], [])).toEqual({ moment: 'joker_bomb' });
    expect(feedPick([hl('bombs3', 0, 4)], [])).toEqual({ moment: 'bombs', n: 4 });
  });

  it('别人做到的跳过；双下、翻盘是对家做到的也算我这一队', () => {
    expect(feedPick([hl('jokerBomb', 1), hl('bombOnBomb', 2), hl('quick', 3, 5)], [])).toBeNull();
    expect(feedPick([hl('jokerBomb', 1), hl('doubleDown', 2)], [])).toEqual({ moment: 'double_down' });
    expect(feedPick([hl('comeback', 2, 4)], [])).toEqual({ moment: 'comeback', n: 4 });
    expect(feedPick([hl('doubleDown', 1)], [])).toBeNull();
  });

  it('同一种一局只报一次，报够了不报', () => {
    expect(feedPick([hl('bombOnBomb', 0), hl('quick', 0, 6)], ['bomb_on_bomb'])).toEqual({ moment: 'quick', n: 6 });
    expect(feedPick([hl('quick', 0, 6)], ['bomb_on_bomb', 'double_down'])).toBeNull();
    expect(FEED_MAX).toBe(2);
  });
});

describe('public/moments.json（平台按编号读模板）', () => {
  const raw = JSON.parse(readFileSync(fileURLToPath(new URL('../public/moments.json', import.meta.url)), 'utf8')) as Record<string, { text: string }>;
  const kinds: Highlight['kind'][] = ['jokerBomb', 'bombOnBomb', 'bombs3', 'comeback', 'doubleDown', 'quick'];

  it('每条：编号合格、只用 {name}{n}{n2}{n3}、不超过 40 字、带了数字的编号模板里有 {n}', () => {
    for (const [id, v] of Object.entries(raw)) {
      expect(id).toMatch(/^[a-z][a-z0-9_]{0,23}$/);
      expect([...v.text].length).toBeLessThanOrEqual(40);
      expect(v.text.replace(/\{(name|n|n2|n3)\}/g, '')).not.toMatch(/[{}]/);
      expect(v.text).toContain('{name}');
    }
    expect(raw['bombs']!.text).toContain('{n}');
    expect(raw['quick']!.text).toContain('{n}');
    expect(raw['comeback']!.text).toContain('{n}');
  });

  it('feedPick 能挑出来的编号都有模板', () => {
    for (const k of kinds) {
      const m = feedPick([hl(k, 0, 3)], []);
      if (m) expect(raw[m.moment], m.moment).toBeDefined();
    }
  });
});
