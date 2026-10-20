import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GLOSSARY } from '../src/view/glossary.ts';

/**
 * 画面层文案检查（docs/design.md 第 3 节）：src/view 里面向玩家的字符串不出现 A 股行话，不用 emoji。
 * 词典（glossary.ts）里的原词括注除外；音频目录只有内部 cue 名，不显示给玩家。
 */
const ROOT = decodeURIComponent(new URL('../src/view/', import.meta.url).pathname);
const SKIP = [/glossary\.ts$/, /[\\/]audio[\\/]/];
/** 和规则层的 tests/content-terms.test.ts 用同一张词表（那边改了这里跟着改）。 */
// 0.11.0："杠杆"是实盘的玩法名，放开（见 tests/content-terms.test.ts）
const TERMS = [
  'T+1', '龙头', '跟风', '白马', '妖股', '题材', '拐点', '炸板', '连板', '换仓', '两融', '打新', '中签', '低吸', '萌芽', '发酵', '主升', '高潮', '退潮',
  '大盘', '月供', '说中', '封板', '主力', '洗盘', '接盘', '横盘', '追高', '割肉', '仓位', '满仓', '空仓', '基本面', '利好', '利空', '回调',
  '看盘', '盯盘', '打板', '游资', '止损', '止盈', 'K线', '喊单', '持有', '冷门', '升温', '过热',
  '爆仓', '种子', '随机波动', '摘帽',
  // 0.4 C：押跌、借钱一律大白话（"加仓"是玩法按钮的名字，和规则层一起放开）
  '保证金', '维持', 'Reg T', 'margin', '融资', '融券', '做空', '强平', '平仓', '追保',
];
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/u;

function walk(d: string): string[] {
  return readdirSync(d, { recursive: true })
    .filter((f) => f.endsWith('.ts'))
    .map((f) => `${d}${f}`);
}

/** 取出源码里的字符串字面量（含模板字符串的文字部分），跳过注释。 */
export function literals(code: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  let i = 0;
  let line = 1;
  const stack: number[] = [];
  let depth = 0;
  while (i < code.length) {
    const c = code[i]!;
    if (c === '\n') {
      line++;
      i++;
      continue;
    }
    if (c === '/' && code[i + 1] === '/') {
      while (i < code.length && code[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && code[i + 1] === '*') {
      const e = code.indexOf('*/', i + 2);
      for (let k = i; k < e; k++) if (code[k] === '\n') line++;
      i = e + 2;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = '';
      while (j < code.length && code[j] !== c) {
        if (code[j] === '\\') {
          s += code[j + 1];
          j += 2;
        } else s += code[j++];
      }
      out.push({ text: s, line });
      i = j + 1;
      continue;
    }
    if (c === '`' || (c === '}' && stack.length > 0 && stack[stack.length - 1] === depth)) {
      if (c === '}') stack.pop();
      let j = i + 1;
      let s = '';
      const l0 = line;
      while (j < code.length && code[j] !== '`' && !(code[j] === '$' && code[j + 1] === '{')) {
        if (code[j] === '\n') line++;
        if (code[j] === '\\') {
          s += code[j + 1];
          j += 2;
        } else s += code[j++];
      }
      out.push({ text: s, line: l0 });
      if (code[j] === '$') {
        stack.push(depth);
        i = j + 2;
      } else i = j + 1;
      continue;
    }
    if (c === '{') depth++;
    if (c === '}') depth--;
    i++;
  }
  return out;
}

function hits(): string[] {
  const out: string[] = [];
  for (const file of walk(ROOT)) {
    if (SKIP.some((r) => r.test(file))) continue;
    for (const { text, line } of literals(readFileSync(file, 'utf8'))) {
      const bad = TERMS.filter((w) => text.includes(w));
      if (/(^|[^A-Za-z_])ST([^A-Za-z_]|$)/.test(text)) bad.push('ST');
      if (EMOJI.test(text)) bad.push('emoji');
      if (bad.length > 0) out.push(`${file.slice(ROOT.length)}:${line} [${bad.join(',')}] ${text.slice(0, 60)}`);
    }
  }
  return out;
}

describe('画面层文案：说人话', () => {
  it('字面量提取跳过注释、拆开模板字符串', () => {
    const r = literals("// 龙头\nconst a = '题材'; /* 白马 */ const b = `x${'y'}z`;");
    expect(r.map((x) => x.text)).toEqual(['题材', 'x', 'y', 'z']);
  });
  it('面向玩家的字符串不出现行话，也不用 emoji', () => {
    expect(hits()).toEqual([]);
  });
  it('词典里每个词都有原词、解释和例子，不重复', () => {
    const words = GLOSSARY.map((t) => t.word);
    expect(new Set(words).size).toBe(words.length);
    for (const t of GLOSSARY) {
      expect(t.explain.length, t.word).toBeGreaterThan(8);
      expect(t.example.length, t.word).toBeGreaterThan(4);
      // 游戏自创的说法（风口状态）没有 A 股原词，留空
      expect(EMOJI.test(`${t.word}${t.explain}${t.example}`), t.word).toBe(false);
    }
  });
});
