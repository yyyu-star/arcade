/**
 * 静态资源对照：同一个目录、同一份配置，分别交给 wrangler dev（miniflare 里跑的就是 Cloudflare 的 asset-worker 和 router-worker）
 * 和本包的 assets.ts，一批请求逐条比状态码、跳转地址、Content-Type、正文、_headers 加的头、Cache-Control。
 * ETag 的值两边算法不同（Cloudflare 用 blake3），只比有没有，以及带上自己的 ETag 再请求是不是 304。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unstable_startWorker } from 'wrangler';
import { afterAll, describe, expect, it } from 'vitest';
import { FIXTURE, startSite, type Running } from './harness.ts';

type Nf = 'none' | 'single-page-application' | '404-page';
const CASES: { name: string; not_found_handling: Nf; run_worker_first?: string[] | boolean }[] = [
  { name: 'none，没有 run_worker_first', not_found_handling: 'none' },
  { name: '单页回退 + run_worker_first 数组（平台的写法）', not_found_handling: 'single-page-application', run_worker_first: ['/api/*', '!/api/static/*', '/via-assets'] },
  { name: '单页回退，没有 run_worker_first', not_found_handling: 'single-page-application' },
  { name: '404-page', not_found_handling: '404-page' },
  { name: 'run_worker_first: true', not_found_handling: 'none', run_worker_first: true },
];

const PATHS = [
  '/',
  '/index.html',
  '/index',
  '/about',
  '/about.html',
  '/about/',
  '/about/index.html',
  '/sub',
  '/sub/',
  '/sub/index.html',
  '/sub/index',
  '/sub.html',
  '/app.css',
  '/data.json',
  '/noext',
  '/404.html',
  '/missing',
  '/missing.html',
  '/sub/missing',
  '/api/x',
  '/api/static/x',
  '/old',
  '/blog/a',
  '/via-assets',
  '/%61bout',
  '/about?x=1',
  '/sub?y=2',
];
const VARIANTS: { label: string; init: RequestInit }[] = [
  { label: 'GET', init: {} },
  { label: 'navigate', init: { headers: { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' } } },
  { label: 'HEAD', init: { method: 'HEAD' } },
  { label: 'POST', init: { method: 'POST', body: 'x' } },
];
const HEADERS = ['content-type', 'location', 'x-test', 'x-sub', 'x-from', 'cache-control'];

async function snapshot(base: string, path: string, init: RequestInit) {
  const r = await fetch(base + path, { ...init, redirect: 'manual' });
  const headers = Object.fromEntries(HEADERS.map((h) => [h, normalizeLocation(r.headers.get(h), base)]));
  const body = await r.text();
  return { status: r.status, headers, body, etag: r.headers.has('etag') };
}

/** 跳转地址两边可能一个写相对路径、一个写绝对地址，统一成相对的 */
function normalizeLocation(v: string | null, base: string): string | null {
  return v && v.startsWith(base) ? v.slice(base.length) : v;
}

describe.each(CASES)('静态资源对照：$name', (c) => {
  const cleanups: (() => Promise<void>)[] = [];
  afterAll(async () => {
    for (const f of cleanups) await f();
  });

  it('每条请求和 wrangler dev 一样', async () => {
    const ours: Running = await startSite({
      fallback: 'home',
      workers: [
        {
          name: 'home',
          main: join(FIXTURE, 'home.js'),
          compatibility_date: '2026-10-01',
          assets: { directory: join(FIXTURE, 'assets'), binding: 'ASSETS', not_found_handling: c.not_found_handling, run_worker_first: c.run_worker_first },
        },
      ],
    });
    cleanups.push(() => ours.cleanup());

    const dir = mkdtempSync(join(tmpdir(), 'arcade-host-wrangler-'));
    cleanups.push(async () => rmSync(dir, { recursive: true, force: true }));
    const config = join(dir, 'wrangler.json');
    writeFileSync(
      config,
      JSON.stringify({
        name: 'home',
        main: join(FIXTURE, 'home.js'),
        compatibility_date: '2026-10-01',
        assets: {
          directory: join(FIXTURE, 'assets'),
          binding: 'ASSETS',
          not_found_handling: c.not_found_handling,
          ...(c.run_worker_first !== undefined ? { run_worker_first: c.run_worker_first } : {}),
        },
      }),
    );
    const worker = await unstable_startWorker({ config, dev: { server: { hostname: '127.0.0.1', port: 0 }, inspector: false, persist: join(dir, 'state'), logLevel: 'none' } });
    cleanups.push(() => worker.dispose());
    await worker.ready;
    const theirs = (await worker.url).origin;

    const diffs: string[] = [];
    for (const path of PATHS) {
      for (const v of VARIANTS) {
        const [a, b] = [await snapshot(ours.base, path, v.init), await snapshot(theirs, path, v.init)];
        if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`${v.label} ${path}\n  本包    ${JSON.stringify(a)}\n  wrangler ${JSON.stringify(b)}`);
      }
    }
    // 带上自己给的 ETag 再请求：304（全部先给 Worker 时 /app.css 也是 Worker 回的，没有 ETag）
    for (const base of c.run_worker_first === true ? [] : [ours.base, theirs]) {
      const first = await fetch(`${base}/app.css`);
      const again = await fetch(`${base}/app.css`, { headers: { 'if-none-match': first.headers.get('etag')! } });
      expect(again.status).toBe(304);
    }
    expect(diffs.join('\n')).toBe('');
  }, 60_000);
});
