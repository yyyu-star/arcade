/**
 * _headers、_redirects、run_worker_first 的路径匹配，照 workers-shared 的 utils/rules-engine：
 * `*` 是 splat（可以跨 /），`:name` 是一段占位符（不跨 /），整条路径从头匹配到尾；替换时 `:splat`、`:name` 换成匹配到的值。
 * 只认路径规则：带主机名的规则（https://…）生成器直接拒绝，本站只有一个主机名。
 */
export interface HeaderRule {
  path: string;
  set: Record<string, string>;
  unset: string[];
}
export interface RedirectRule {
  from: string;
  to: string;
  status: number;
}

const ESCAPE = /[.+?^${}()|[\]\\]/g;

/** run_worker_first 的规则只有 *，没有占位符 */
export function globRegExp(rule: string): RegExp {
  return new RegExp(`^${rule.replace(ESCAPE, '\\$&').replace(/\*/g, '.*')}$`);
}

function ruleRegExp(rule: string): RegExp {
  let splat = false;
  const body = rule
    .replace(ESCAPE, '\\$&')
    .replace(/\*/g, () => {
      // 只有第一个 * 有名字，后面的照样匹配但不取值（和 Cloudflare 一样）
      if (splat) return '.*';
      splat = true;
      return '(?<splat>.*)';
    })
    .replace(/:([A-Za-z]\w*)/g, '(?<$1>[^/]+)');
  return new RegExp(`^${body}$`);
}

const cache = new Map<string, RegExp>();

export function matchRule(rule: string, pathname: string): { replace(template: string): string } | null {
  let re = cache.get(rule);
  if (!re) cache.set(rule, (re = ruleRegExp(rule)));
  const m = re.exec(pathname);
  if (!m) return null;
  const groups = m.groups ?? {};
  return {
    replace: (template) => template.replace(/:([A-Za-z]\w*)/g, (all, name: string) => groups[name] ?? all),
  };
}
