/** 称号：规则里的每个 id 在 public/titles.json（平台的称号墙读它，docs/platform-backend.md 5.10）和页面上都有中文名，格式合平台的要求 */
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { TITLE_ID } from '../src/core/match/index.ts';
import { TITLE_ORDER as RC_TITLES } from '../src/core/variants/riichi/index.ts';
import { TITLE_ORDER as XZ_TITLES } from '../src/core/variants/sichuan-xuezhan/index.ts';
import { TITLE_NAME } from '../src/view/text.ts';

const TITLE_ORDER: readonly string[] = [...XZ_TITLES, ...RC_TITLES];

test('titles.json 和规则、页面对得上', () => {
  const raw = readFileSync(new URL('../public/titles.json', import.meta.url), 'utf8');
  expect(raw.length).toBeLessThan(32 * 1024);
  const json = JSON.parse(raw) as Record<string, { name: string; desc: string }>;
  expect(Object.keys(json).sort()).toEqual([...TITLE_ORDER].sort());
  for (const id of TITLE_ORDER) {
    expect(TITLE_ID.test(id), id).toBe(true);
    expect(json[id]!.name).toBe(TITLE_NAME[id]);
    expect(json[id]!.desc.length).toBeGreaterThan(0);
  }
});
