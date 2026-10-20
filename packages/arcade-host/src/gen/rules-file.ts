/**
 * _headers、_redirects 的解析（构建时），格式照 Cloudflare 的文档和 workers-shared 的解析器：
 *   _headers：顶格一行是路径规则，下面缩进的 `名: 值` 是要加的头，`! 名` 是要去掉的头；# 开头是注释；
 *   _redirects：一行 `来源 目标 [状态码]`，状态码默认 302，200 是改写（不跳转）。
 * 带主机名的规则（https://…）不支持：本站只有一个主机名，写了直接报错。
 */
import type { HeaderRule, RedirectRule } from '../runtime/rules.ts';

export function parseHeaders(src: string): HeaderRule[] {
  const rules: HeaderRule[] = [];
  let current: HeaderRule | null = null;
  for (const [i, raw] of src.split(/\r?\n/).entries()) {
    const line = raw.trimEnd();
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      const path = line.trim();
      if (!path.startsWith('/')) throw new Error(`_headers 第 ${i + 1} 行：只支持以 / 开头的路径规则`);
      rules.push((current = { path, set: {}, unset: [] }));
      continue;
    }
    if (!current) throw new Error(`_headers 第 ${i + 1} 行：头写在了路径规则前面`);
    const t = line.trim();
    if (t.startsWith('!')) {
      current.unset.push(t.slice(1).trim().toLowerCase());
      continue;
    }
    const colon = t.indexOf(':');
    if (colon <= 0) throw new Error(`_headers 第 ${i + 1} 行：不是 名: 值`);
    const name = t.slice(0, colon).trim().toLowerCase();
    const value = t.slice(colon + 1).trim();
    current.set[name] = current.set[name] ? `${current.set[name]}, ${value}` : value;
  }
  return rules;
}

export function parseRedirects(src: string): RedirectRule[] {
  const rules: RedirectRule[] = [];
  for (const [i, raw] of src.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [from, to, status, ...rest] = line.split(/\s+/);
    if (!from || !to || rest.length) throw new Error(`_redirects 第 ${i + 1} 行：要写成 来源 目标 [状态码]`);
    if (!from.startsWith('/')) throw new Error(`_redirects 第 ${i + 1} 行：来源只支持以 / 开头的路径`);
    const code = status === undefined ? 302 : Number(status);
    if (![200, 301, 302, 303, 307, 308].includes(code)) throw new Error(`_redirects 第 ${i + 1} 行：状态码 ${status} 不支持`);
    rules.push({ from, to, status: code });
  }
  return rules;
}
