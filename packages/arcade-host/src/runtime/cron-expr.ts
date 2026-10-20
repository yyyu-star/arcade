/**
 * 五段式 cron（分 时 日 月 周，UTC），和 Cloudflare 的 triggers.crons 同样的写法：* 、数字、a-b、a,b、*\/n、a-b/n；
 * 周日写 0 或 7；日和周都限定了的时候两个满足一个就跑（标准 cron 的规矩）。不支持 L、W、#、月份和星期的英文缩写，
 * 遇到直接报错（生成器在构建时就会解析一遍，报错不会拖到线上）。
 */
export interface CronSpec {
  minute: Set<number>;
  hour: Set<number>;
  dom: Set<number>;
  month: Set<number>;
  dow: Set<number>;
  domAny: boolean;
  dowAny: boolean;
}

const RANGES: [number, number][] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];

const cache = new Map<string, CronSpec>();

export function parseCron(expr: string): CronSpec {
  const hit = cache.get(expr);
  if (hit) return hit;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`cron 必须是五段：${expr}`);
  const sets = parts.map((p, i) => field(p, RANGES[i]!, expr));
  const dow = new Set([...sets[4]!].map((d) => d % 7));
  const spec: CronSpec = {
    minute: sets[0]!,
    hour: sets[1]!,
    dom: sets[2]!,
    month: sets[3]!,
    dow,
    domAny: parts[2] === '*',
    dowAny: parts[4] === '*',
  };
  cache.set(expr, spec);
  return spec;
}

function field(text: string, [lo, hi]: [number, number], expr: string): Set<number> {
  const out = new Set<number>();
  for (const item of text.split(',')) {
    const m = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(item);
    if (!m) throw new Error(`cron 看不懂 ${JSON.stringify(item)}：${expr}`);
    const step = m[4] ? Number(m[4]) : 1;
    let a = m[1] === '*' ? lo : Number(m[2]);
    let b = m[1] === '*' ? hi : m[3] !== undefined ? Number(m[3]) : m[4] ? hi : a;
    if (a < lo || b > hi || a > b || step < 1) throw new Error(`cron 超出范围 ${JSON.stringify(item)}：${expr}`);
    for (; a <= b; a += step) out.add(a);
  }
  return out;
}

export function matches(spec: CronSpec, t: number): boolean {
  const d = new Date(t);
  if (!spec.minute.has(d.getUTCMinutes()) || !spec.hour.has(d.getUTCHours()) || !spec.month.has(d.getUTCMonth() + 1)) return false;
  return dayMatches(spec, d);
}

/** from 及以后第一个该跑的整分钟（毫秒）；五年内都没有回 Infinity（比如 2 月 30 日） */
export function nextFire(spec: CronSpec, from: number): number {
  let t = Math.ceil(from / 60_000) * 60_000;
  const end = t + 5 * 366 * 86_400_000;
  while (t < end) {
    const d = new Date(t);
    if (!spec.month.has(d.getUTCMonth() + 1) || !dayMatches(spec, d)) {
      t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
      continue;
    }
    if (!spec.hour.has(d.getUTCHours())) {
      t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours() + 1);
      continue;
    }
    if (spec.minute.has(d.getUTCMinutes())) return t;
    t += 60_000;
  }
  return Infinity;
}

function dayMatches(spec: CronSpec, d: Date): boolean {
  const dom = spec.dom.has(d.getUTCDate());
  const dow = spec.dow.has(d.getUTCDay());
  if (spec.domAny && spec.dowAny) return true;
  if (spec.domAny) return dow;
  if (spec.dowAny) return dom;
  return dom || dow;
}
