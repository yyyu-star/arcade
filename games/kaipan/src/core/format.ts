/** 展示用格式化（不影响逻辑与确定性）。 */

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s;
}

/** 整数加千分位（不用 toLocaleString：各浏览器的分隔符不一样）。 */
export function group(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 超过 max 个字符就截成 max-1 个字加「…」（按字符数，多字节字符算一个）。 */
export function ellipsize(text: string, max: number): string {
  const cs = Array.from(text);
  return cs.length > max ? `${cs.slice(0, max - 1).join('')}…` : text;
}

/** 保留 2 位小数，整数部分加千分位。 */
function fixed2(v: number): string {
  const [int = '0', frac = '00'] = v.toFixed(2).split('.');
  return `${group(Number(int))}.${frac}`;
}

/**
 * 金额（账户、月供）：绝对值不到 1 万精确到元（¥9,531、-¥203）；
 * 1 万到 1 亿用「万」，1 亿到 1 万亿用「亿」，1 万亿及以上用「万亿」，都保留 2 位小数、整数部分加千分位。
 * 按舍入后的值选单位，避免出现 ¥10,000 或 ¥10,000.00万。sign 为 true 时正数带 + 号。
 */
export function formatMoney(v: number, opts: { sign?: boolean } = {}): string {
  const a = Math.abs(v);
  const yuan = Math.round(a);
  const sign = yuan === 0 ? '' : v < 0 ? '-' : opts.sign ? '+' : '';
  if (yuan >= 1e4) {
    // 9,999.995万 舍入后会变成 10,000.00万，此时改用亿；亿同理
    if (a < 1e8 && (a / 1e4).toFixed(2) !== '10000.00') return `${sign}¥${fixed2(a / 1e4)}万`;
    if (a < 1e12 && (a / 1e8).toFixed(2) !== '10000.00') return `${sign}¥${fixed2(a / 1e8)}亿`;
    return `${sign}¥${fixed2(a / 1e12)}万亿`;
  }
  return `${sign}¥${group(yuan)}`;
}

/** 小数比例 → 百分比文字：0.0123 → +1.2%。 */
export function formatPct(v: number, digits = 1, sign = true): string {
  const s = (v * 100).toFixed(digits);
  return `${sign && v > 0 ? '+' : ''}${s}%`;
}

/** 百分点 → 文字：1.8 → +1.8%；超过 1000 个点时加千分位并去掉小数。 */
export function formatPoints(v: number, digits = 1, sign = true): string {
  const plus = sign && v > 0 ? '+' : '';
  if (Math.abs(v) >= 1000) return `${plus}${v < 0 ? '-' : ''}${group(Math.round(Math.abs(v)))}%`;
  return `${plus}${v.toFixed(digits)}%`;
}

export function formatMult(v: number): string {
  return `×${trimZeros(v.toFixed(2))}`;
}
