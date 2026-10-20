/**
 * 静态资源：一个模块一个这样的 Worker（同一份代码，配置不同），两个入口：
 *   - 默认入口 = Cloudflare 的"路由层"：run_worker_first 命中的给模块的 Worker；否则有这个资源（或单页回退）就回资源，没有再给 Worker；
 *   - Assets 入口 = 模块 Worker 里的 env.ASSETS：只管按路径回文件，回不出来就 404。
 * 判断规则逐条照 Cloudflare 的 asset-worker 和 router-worker（workers-shared，随 miniflare 发布）移植：
 * html_handling 的 auto-trailing-slash（/a/index.html 307 到 /a/ 之类）、not_found_handling、_headers、_redirects、ETag 和 304。
 * CI 拿 miniflare 的结果逐条对照（test/assets-parity）。
 *
 * 文件本身在磁盘上（FILES 是 workerd 的 DiskDirectory 服务，路径启动时用 --directory-path 给），
 * 有哪些文件、每个文件的内容哈希（当 ETag，也用来判断"这两个路径是不是同一个文件"）由生成器在构建时算好放进 CONFIG。
 */
import { WorkerEntrypoint } from 'cloudflare:workers';
import { contentType } from './mime';
import { globRegExp, matchRule, type HeaderRule, type RedirectRule } from './rules';

export interface AssetsConfig {
  html_handling: 'auto-trailing-slash' | 'force-trailing-slash' | 'drop-trailing-slash' | 'none';
  not_found_handling: 'none' | 'single-page-application' | '404-page';
  /** run_worker_first 写成数组时的规则（! 开头的是反过来：一定走资源）；true 表示全部先给 Worker */
  run_worker_first: string[] | boolean;
  headers: HeaderRule[];
  redirects: RedirectRule[];
  /** 路径（以 / 开头，解码后的）→ 内容哈希 */
  manifest: Record<string, string>;
}

interface Env {
  CONFIG: AssetsConfig;
  FILES: Fetcher;
  /** 模块自己的 Worker；只有静态资源、没有 Worker 的模块没有 */
  USER?: Fetcher;
}

type Intent = { asset: { eTag: string; path: string; status: 200 | 404 } | null; redirect: string | null };

const CACHE_CONTROL = 'public, max-age=0, must-revalidate';

export class Assets extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Promise<Response> {
    return serve(request, this.env);
  }
}

export default class Front extends WorkerEntrypoint<Env> {
  override async fetch(request: Request): Promise<Response> {
    const { CONFIG: config, USER: user } = this.env;
    const path = new URL(request.url).pathname;
    const rwf = config.run_worker_first;
    if (Array.isArray(rwf)) {
      // 和 Cloudflare 一样：! 规则先看（一定走资源），再看先给 Worker 的
      if (rwf.some((r) => r.startsWith('!') && globRegExp(r.slice(1)).test(path))) return serve(request, this.env);
      if (user && rwf.some((r) => !r.startsWith('!') && globRegExp(r).test(path))) return user.fetch(request);
    } else if (rwf && user) {
      return user.fetch(request);
    }
    if (!user) return serve(request, this.env);
    // 没写 run_worker_first 数组时，单页回退只给浏览器的页面跳转（Sec-Fetch-Mode: navigate），别的请求找不到文件就交给 Worker
    const staticRouting = Array.isArray(rwf);
    const probe =
      staticRouting || request.headers.get('Sec-Fetch-Mode') === 'navigate' ? config : { ...config, not_found_handling: 'none' as const };
    const found = await resolve(request, probe);
    return found ? serve(request, this.env) : user.fetch(request);
  }
}

/** Assets 入口和路由层共用：按配置回资源或重定向；什么都对不上回 404 */
async function serve(request: Request, env: Env): Promise<Response> {
  const config = env.CONFIG;
  const result = await resolve(request, config);
  let response: Response;
  if (result instanceof Response) {
    response = result;
  } else if (!result) {
    response = new Response(null, { status: 404 });
  } else {
    response = await fetchFile(request, env, result);
  }
  return attachHeaders(request, response, config.headers);
}

/** 返回要回的文件、重定向（Response），或 null（没有这个资源） */
async function resolve(request: Request, config: AssetsConfig): Promise<Response | { eTag: string; path: string; status: 200 | 404 } | null> {
  const url = new URL(request.url);
  let pathname = url.pathname;
  let proxied = false;
  const redirect = matchRedirect(config.redirects, pathname);
  if (redirect) {
    if (redirect.status === 200) {
      pathname = new URL(redirect.to, request.url).pathname;
      proxied = true;
    } else {
      return new Response(null, { status: redirect.status, headers: { Location: redirect.to + (redirect.keepSearch ? url.search : '') } });
    }
  }
  const decoded = decodePath(pathname);
  const exists = (p: string): string | null => config.manifest[p] ?? null;
  const intent = getIntent(decoded, config, exists, false);
  if (!intent) return proxied ? new Response(null, { status: 404 }) : null;
  // 方法不对先回 405，再看要不要跳转（和 Cloudflare 的顺序一样）
  if (!['GET', 'HEAD'].includes(request.method.toUpperCase())) return new Response(null, { status: 405 });
  const destination = intent.redirect ?? decoded;
  const encoded = encodePath(destination);
  if ((encoded !== pathname && intent.asset) || intent.redirect !== null) {
    return new Response(null, { status: 307, headers: { Location: encoded + url.search } });
  }
  return intent.asset;
}

async function fetchFile(request: Request, env: Env, asset: { eTag: string; path: string; status: 200 | 404 }): Promise<Response> {
  const headers = new Headers({ ETag: `"${asset.eTag}"` });
  const type = contentType(asset.path);
  if (type) headers.set('Content-Type', type);
  if (!request.headers.has('Authorization') && !request.headers.has('Range')) headers.set('Cache-Control', CACHE_CONTROL);
  const inm = request.headers.get('If-None-Match') ?? '';
  if (inm === `"${asset.eTag}"` || inm === `W/"${asset.eTag}"`) return new Response(null, { status: 304, headers });
  if (request.method.toUpperCase() === 'HEAD') return new Response(null, { status: asset.status, headers });
  const file = await env.FILES.fetch(`http://files${encodePath(asset.path)}`);
  if (!file.ok) return new Response(null, { status: 404 });
  return new Response(file.body, { status: asset.status, headers });
}

// ---- html_handling（照 workers-shared 的 asset-worker/src/handler.ts） ----

function found(eTag: string, path: string, status: 200 | 404 = 200): Intent {
  return { asset: { eTag, path, status }, redirect: null };
}

function getIntent(pathname: string, config: AssetsConfig, exists: (p: string) => string | null, skip: boolean): Intent | null {
  switch (config.html_handling) {
    case 'none': {
      const e = exists(pathname);
      return e ? found(e, pathname) : notFound(pathname, config, exists);
    }
    case 'auto-trailing-slash':
      return autoTrailingSlash(pathname, config, exists, skip);
    default:
      // 本仓库没有模块用 force/drop-trailing-slash；生成器遇到会直接报错，不会走到这里
      throw new Error(`不支持的 html_handling：${config.html_handling}`);
  }
}

function autoTrailingSlash(p: string, config: AssetsConfig, exists: (p: string) => string | null, skip: boolean): Intent | null {
  const redirect = (file: string, dest: string) => safeRedirect(file, dest, config, exists, skip);
  const exact = exists(p);
  let r: Intent | null;
  if (p.endsWith('/index')) {
    if (exact) return found(exact, p);
    if ((r = redirect(`${p}.html`, p.slice(0, -5)))) return r;
    if ((r = redirect(`${p.slice(0, -6)}.html`, p.slice(0, -6)))) return r;
  } else if (p.endsWith('/index.html')) {
    if ((r = redirect(p, p.slice(0, -10)))) return r;
    if ((r = redirect(`${p.slice(0, -11)}.html`, p.slice(0, -11)))) return r;
  } else if (p.endsWith('/')) {
    const e = exists(`${p}index.html`);
    if (e) return found(e, `${p}index.html`);
    if ((r = redirect(`${p.slice(0, -1)}.html`, p.slice(0, -1)))) return r;
  } else if (p.endsWith('.html')) {
    if ((r = redirect(p, p.slice(0, -5)))) return r;
    if ((r = redirect(`${p.slice(0, -5)}/index.html`, `${p.slice(0, -5)}/`))) return r;
  }
  if (exact) return found(exact, p);
  const html = exists(`${p}.html`);
  if (html) return found(html, `${p}.html`);
  if ((r = redirect(`${p}/index.html`, `${p}/`))) return r;
  return notFound(p, config, exists);
}

/** 只有"跳过去以后回的正是 file 这个文件"才重定向（按内容哈希比） */
function safeRedirect(file: string, dest: string, config: AssetsConfig, exists: (p: string) => string | null, skip: boolean): Intent | null {
  if (skip || exists(dest)) return null;
  const intent = getIntent(dest, config, exists, true);
  const target = exists(file);
  return intent?.asset && target && intent.asset.eTag === target ? { asset: null, redirect: dest } : null;
}

function notFound(p: string, config: AssetsConfig, exists: (p: string) => string | null): Intent | null {
  if (config.not_found_handling === 'single-page-application') {
    const e = exists('/index.html');
    return e ? found(e, '/index.html') : null;
  }
  if (config.not_found_handling === '404-page') {
    for (let cwd = p; cwd; ) {
      cwd = cwd.slice(0, cwd.lastIndexOf('/'));
      const e = exists(`${cwd}/404.html`);
      if (e) return found(e, `${cwd}/404.html`, 404);
    }
  }
  return null;
}

function decodePath(p: string): string {
  return p
    .split('/')
    .map((x) => {
      try {
        return decodeURIComponent(x);
      } catch {
        return x;
      }
    })
    .join('/')
    .replace(/\/+/g, '/');
}

function encodePath(p: string): string {
  return p
    .split('/')
    .map((x) => encodeURIComponent(x))
    .join('/');
}

// ---- _redirects、_headers ----

function matchRedirect(rules: RedirectRule[], pathname: string): { to: string; status: number; keepSearch: boolean } | null {
  for (const rule of rules) {
    const m = matchRule(rule.from, pathname);
    if (m) {
      const to = m.replace(rule.to);
      // 目标里没写查询参数的，原样带上请求的（和 Cloudflare 一样）
      return { to, status: rule.status, keepSearch: !to.includes('?') };
    }
  }
  return null;
}

function attachHeaders(request: Request, response: Response, rules: HeaderRule[]): Response {
  const pathname = new URL(request.url).pathname;
  const matched = rules.flatMap((rule) => {
    const m = matchRule(rule.path, pathname);
    return m ? [{ set: Object.entries(rule.set).map(([k, v]) => [k, m.replace(v)] as const), unset: rule.unset }] : [];
  });
  if (!matched.length) return response;
  const out = new Response(response.body, response);
  const setOnce = new Set<string>();
  for (const { set, unset } of matched) {
    for (const k of unset) out.headers.delete(k);
    for (const [k, v] of set) {
      // 同一个头在几条规则里都写了：第一次覆盖原值，之后追加（和 Cloudflare 一样）
      const key = k.toLowerCase();
      if (setOnce.has(key)) out.headers.append(k, v);
      else {
        out.headers.set(k, v);
        setOnce.add(key);
      }
    }
  }
  return out;
}
