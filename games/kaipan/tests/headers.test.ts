import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * 0.13.1 安全头（public/_headers 的 /* 那一段）：锁住几条底线，改 CSP 时不会不小心放宽。
 * 实际放了哪些来源、为什么，写在 _headers 的注释里；冒烟（tools/shot.ts）照同一份文件给开发服务器加头，有违规算失败。
 */
function pageHeaders(): Record<string, string> {
  const out: Record<string, string> = {};
  let inBlock = false;
  for (const line of readFileSync('public/_headers', 'utf8').split('\n')) {
    if (!line.startsWith(' ')) inBlock = line.trim() === '/*';
    else if (inBlock) {
      const i = line.indexOf(':');
      if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return out;
}

const directives = (csp: string): Map<string, string[]> =>
  new Map(
    csp
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((d) => d[0])
      .map(([name, ...v]) => [name!, v]),
  );

describe('安全头', () => {
  const h = pageHeaders();
  const csp = directives(h['Content-Security-Policy'] ?? '');

  it('CSP 是正式生效的（不是 Report-Only）', () => {
    expect(h['Content-Security-Policy']).toBeTruthy();
    expect(h['Content-Security-Policy-Report-Only']).toBeUndefined();
  });

  it('只许同源嵌入', () => {
    expect(csp.get('frame-ancestors')).toEqual(["'self'"]);
    expect(h['X-Frame-Options']).toBe('SAMEORIGIN');
  });

  it('脚本不放内联和 eval，只多放统计 beacon 一个来源', () => {
    expect(csp.get('script-src')).toEqual(["'self'", 'https://static.cloudflareinsights.com']);
    expect(csp.get('default-src')).toEqual(["'self'"]);
    expect(csp.get('object-src')).toEqual(["'none'"]);
  });

  it('请求只认同域，外加统计 beacon 的上报地址', () => {
    expect(csp.get('connect-src')).toEqual(["'self'", 'https://cloudflareinsights.com']);
  });
});
