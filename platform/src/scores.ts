/**
 * 榜上的分数怎么显示（docs/platform-backend.md 15.12）：各游戏的分数编码不一样（比如把"通关"编进高位），平台不去知道，
 * 由游戏自己的公开文件给：每日榜读 /games/<id>/daily.json（0.10.18），各游戏总榜读 /games/<id>/boards.json（0.23.0），格式一样：
 *   {"note"?: "一句玩法说明", "score": [{"from"?: 100000000000, "text": "通关 · {n} 元"}, {"text": "撑了 {n} 个月"}]}
 * score 从上往下取第一条能用的：没写 from 的总能用，写了的要分数 ≥ from；{n} 是分数减去 from（没写就是分数）按千分位写。
 * 一个文件管几个榜的（每日子榜 0.16.0、总榜 0.23.0）按榜分开给：{"boards": {"vigil": {"note", "score"}, …}}；某个榜没写就用最外层的。
 * 复合编码的分数（0.23.0，夜巡守夜 = 危险档 × 1e10 + 秒数 × 1e4 + 击杀）一条规则可以写 fields 拆成几个数：
 *   {"fields": {"d": [1e10, null], "s": [1e4, 1e6], "k": [1, 1e4]}, "fmt": {"s": "mmss"}, "text": "危险{d} · {s} · 斩 {k}"}
 * 每个字段 = floor((分数 − from) / 除数) % 取模（取模写 null 就不取模），text 里写 {字段名}；fmt 可以把某个字段写成"分:秒"。
 * 读不到、格式不对、没有一条能用：分数直接按千分位写，不显示说明。
 */
import { num } from './format.ts';
import { loadGameFile } from './gamefile.ts';

interface Rule {
  from: number | null;
  text: string;
  fields: [string, number, number | null, 'mmss' | null][];
}

export interface ScoreFormat {
  note: string | null;
  score: (s: number) => string;
}

const FIELD_RE = /^[a-z]{1,8}$/;
const MAX_FIELDS = 6;

function parseFields(raw: unknown, fmt: unknown): Rule['fields'] | null {
  if (raw === undefined) return [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const fmts = fmt && typeof fmt === 'object' ? (fmt as Record<string, unknown>) : {};
  const out: Rule['fields'] = [];
  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!FIELD_RE.test(name) || name === 'n' || !Array.isArray(v) || v.length !== 2) return null;
    const [div, mod] = v as unknown[];
    if (typeof div !== 'number' || !(div >= 1) || !Number.isSafeInteger(div)) return null;
    if (mod !== null && (typeof mod !== 'number' || !(mod >= 1) || !Number.isSafeInteger(mod))) return null;
    out.push([name, div, mod, fmts[name] === 'mmss' ? 'mmss' : null]);
  }
  return out.length <= MAX_FIELDS ? out : null;
}

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

function render(r: Rule, s: number): string {
  const base = s - (r.from ?? 0);
  let text = r.text.replace('{n}', num(base));
  for (const [name, div, mod, fmt] of r.fields) {
    let v = Math.floor(base / div);
    if (mod !== null) v %= mod;
    text = text.replaceAll(`{${name}}`, fmt === 'mmss' ? mmss(v) : num(v));
  }
  return text;
}

/** file 是 daily.json 或 boards.json；sub 是文件里 boards 下的哪个榜（每日子榜 id、总榜 id） */
export async function loadScoreFormat(game: string, file: 'daily.json' | 'boards.json', sub: string | null = null): Promise<ScoreFormat> {
  const data = await loadGameFile(game, file);
  const boards = data?.boards as Record<string, unknown> | undefined;
  const one = sub !== null && boards && typeof boards === 'object' ? boards[sub] : undefined;
  const raw = (one && typeof one === 'object' ? one : data) as Record<string, unknown> | null | undefined;
  const rules: Rule[] = [];
  for (const r of Array.isArray(raw?.score) ? (raw.score as unknown[]) : []) {
    const { from, text, fields: f, fmt } = (r ?? {}) as { from?: unknown; text?: unknown; fields?: unknown; fmt?: unknown };
    const fields = parseFields(f, fmt);
    if (typeof text !== 'string' || !fields || (from !== undefined && !Number.isFinite(from))) continue;
    // 每条至少要显示出一个数：{n}，或者写了的某个字段
    if (!text.includes('{n}') && !fields.some(([name]) => text.includes(`{${name}}`))) continue;
    rules.push({ from: typeof from === 'number' ? from : null, text: text.slice(0, 30), fields });
  }
  return {
    note: typeof raw?.note === 'string' && raw.note ? raw.note.slice(0, 80) : null,
    score: (s) => {
      const r = rules.find((x) => x.from === null || s >= x.from);
      return r ? render(r, s) : num(s);
    },
  };
}

/** 每日榜（0.10.18 起的叫法） */
export const loadDailyFormat = (game: string, sub: string | null = null) => loadScoreFormat(game, 'daily.json', sub);
export type DailyFormat = ScoreFormat;
