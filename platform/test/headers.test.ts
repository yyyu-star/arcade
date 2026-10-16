/**
 * public/_headers 的 CSP（docs/platform-backend.md 5.2）：本地冒烟拿不到 Cloudflare 注入的统计脚本，所以在这里锁住每条指令。
 * 只许 script-src 多出 Web Analytics 的脚本来源（维护者 2026-10-14 定"游戏站也要统计"；上报走同源，不用放），别的指令一个来源都不能多。
 */
import { describe, expect, it } from 'vitest';
import headers from '../public/_headers?raw';

/**
 * 按 Cloudflare 的 _headers 语法分块：顶格的是路径行，缩进的是上一个路径的头，# 开头是注释。
 * 头那一行丢了缩进就会变成一个"路径"，所以按块解析才抓得住；以 ! 开头的行会把前面块里的同名头摘掉。
 */
function blocks(): { path: string; headers: string[] }[] {
  const out: { path: string; headers: string[] }[] = [];
  for (const line of headers.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (/^\s/.test(line)) {
      expect(out.length, `头出现在任何路径之前：${line}`).toBeGreaterThan(0);
      out.at(-1)!.headers.push(line.trim());
    } else {
      out.push({ path: line.trim(), headers: [] });
    }
  }
  return out;
}

function csp(): Map<string, string[]> {
  const lines = blocks().flatMap((b) => b.headers.filter((h) => /^content-security-policy:/i.test(h)));
  expect(lines, 'CSP 应该正好一条').toHaveLength(1);
  const value = lines[0]!.split(':').slice(1).join(':');
  return new Map(
    value
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter((d) => d[0])
      .map(([name, ...sources]) => [name!, sources]),
  );
}

describe('静态页面的 CSP', () => {
  it('每条指令的来源和预期完全一致：只多了 Cloudflare Web Analytics 的脚本来源', () => {
    expect(Object.fromEntries(csp())).toEqual({
      'default-src': ["'self'"],
      'script-src': ["'self'", 'https://static.cloudflareinsights.com'],
      'style-src': ["'self'"],
      'img-src': ["'self'", 'data:', 'blob:'],
      'font-src': ["'self'"],
      // 自动注入的 beacon 上报到同源 /cdn-cgi/rum（2026-10-14 线上实测），不用放 cloudflareinsights.com
      'connect-src': ["'self'"],
      'frame-ancestors': ["'none'"],
      'base-uri': ["'none'"],
      'form-action': ["'self'"],
      'object-src': ["'none'"],
    });
  });

  it('没有 unsafe-inline、unsafe-eval，也没有通配来源', () => {
    for (const [name, sources] of csp()) {
      for (const s of sources) expect([name, s]).not.toEqual([name, expect.stringMatching(/unsafe-|\*/)]);
    }
  });

  it('整个文件只有一个块 /*：头都缩进在它下面，CSP 正好一条，没有 ! 摘头的行；另外两个安全头还在', () => {
    const all = blocks();
    expect(all.map((b) => b.path)).toEqual(['/*']);
    expect(headers.split('\n').filter((l) => l.trim().startsWith('!'))).toEqual([]);
    expect(all[0]!.headers.map((h) => h.split(':')[0])).toEqual(['Content-Security-Policy', 'X-Content-Type-Options', 'Referrer-Policy']);
    expect(all[0]!.headers).toContain('X-Content-Type-Options: nosniff');
    expect(all[0]!.headers).toContain('Referrer-Policy: same-origin');
  });
});
