/**
 * 生成器：站点描述（site.ts）→ 一个能直接交给 workerd 的发布目录。
 *
 *   <out>/config.capnp          workerd 配置（下面的文件都用相对路径 embed 进去）
 *   <out>/runtime/*.js          本包的运行时：router、assets、d1、cron
 *   <out>/workers/<名>/main.js  各模块打好的 Worker
 *   <out>/workers/<名>/*.json   非 ASCII 的变量值、静态资源配置、D1 迁移
 *   <out>/assets/<名>/          各模块的静态资源（不含 _headers、_redirects，它们已经解析进配置）
 *   <out>/release.json          生成时的版本信息（给 /__health 之外的人看：哪一版、哪些模块）
 *
 * 运行：在 <out> 里执行 `workerd serve config.capnp --directory-path data=<数据目录>`（静态资源目录按相对当前目录找，
 * 所以必须在 <out> 里起；tools/selfhost 的 systemd 单元和 Dockerfile 都是这么做的）。
 *
 * 存储两种（v2.1：部署时二选一）：
 *   - sqlite：Durable Object 存在数据目录（workerd 的 localDisk，每个类一个子目录，名字是固定的 uniqueKey）；D1 也是一个 DO，同一个目录；
 *   - memory：Durable Object 只在内存（PostgreSQL 模式用，房间状态和平台库由别的绑定写进 PG；第一版只生成配置，PG 后端在后面的阶段）。
 */
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { embed, text, VOID, type Capnp } from './capnp.ts';
import { parseHeaders, parseRedirects } from './rules-file.ts';
import type { Site, SiteWorker } from './site.ts';
import { parseCron } from '../runtime/cron-expr.ts';

export interface GenerateOptions {
  out: string;
  storage?: 'sqlite' | 'memory';
  /** 监听地址；运行时可以用 --socket-addr http=<地址> 覆盖 */
  listen?: string;
  /** 内部管理入口（备份、恢复、手动跑定时任务）的监听地址；运行时可以用 --socket-addr admin=<地址> 覆盖。只许回环或容器内网 */
  adminListen?: string;
  /** 写进 release.json 的版本说明（比如 git 提交） */
  version?: string;
  /** 本包运行时的目录（默认是本包 dist/runtime，要先 npm run build） */
  runtimeDir?: string;
}

const RUNTIME = ['router', 'assets', 'd1', 'cron', 'admin'] as const;
/** 这些文件 wrangler 不当静态资源上传（解析进配置，或者是忽略规则本身） */
const NOT_ASSETS = new Set(['_headers', '_redirects', '.assetsignore', '_worker.js']);

export function generate(site: Site, opts: GenerateOptions): { config: string } {
  const out = opts.out;
  const storage = opts.storage ?? 'sqlite';
  const runtimeDir = opts.runtimeDir ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'runtime');
  validate(site);
  if (existsSync(out)) rmSync(out, { recursive: true });
  mkdirSync(join(out, 'runtime'), { recursive: true });
  for (const r of RUNTIME) {
    const src = join(runtimeDir, `${r}.js`);
    if (!existsSync(src)) throw new Error(`没有 ${src}：先在 packages/arcade-host 里 npm run build`);
    cpSync(src, join(out, 'runtime', `${r}.js`));
  }

  const services: Capnp[] = [];
  const doStorage: Capnp = storage === 'sqlite' ? { localDisk: 'data' } : { inMemory: VOID };
  const routes: [string, string][] = [];
  const routerBindings: Capnp[] = [];
  const cronTargets: [string, string][] = [];
  const d1List: string[] = [];

  for (const w of site.workers) {
    const dir = join(out, 'workers', w.name);
    mkdirSync(dir, { recursive: true });
    cpSync(w.main, join(dir, 'main.js'));
    const rel = (f: string) => relative(out, f).split(sep).join('/');
    const bindings: Capnp[] = [];

    for (const [k, v] of Object.entries(w.vars ?? {})) {
      const isText = typeof v === 'string';
      const raw = isText ? v : JSON.stringify(v);
      if (/^[\x20-\x7e]*$/.test(raw)) bindings.push({ name: k, [isText ? 'text' : 'json']: raw });
      else {
        const f = join(dir, `var-${k}.${isText ? 'txt' : 'json'}`);
        writeFileSync(f, raw);
        bindings.push({ name: k, [isText ? 'text' : 'json']: embed(rel(f)) });
      }
    }
    for (const s of w.secrets ?? []) bindings.push({ name: s, fromEnvironment: s });
    for (const s of w.services ?? []) {
      bindings.push({
        name: s.binding,
        service: { name: s.service, entrypoint: s.entrypoint, props: s.props ? { json: JSON.stringify(s.props) } : undefined },
      });
    }
    for (const d of w.durable_objects ?? []) bindings.push({ name: d.name, durableObjectNamespace: { className: d.class_name } });

    for (const db of w.d1_databases ?? []) {
      const svc = `d1-${w.name}-${db.binding}`;
      d1List.push(svc);
      const migrations = existsSync(db.migrations_dir)
        ? readdirSync(db.migrations_dir)
            .filter((f) => f.endsWith('.sql'))
            .sort()
            .map((f) => [f, readFileSync(join(db.migrations_dir, f), 'utf8')])
        : [];
      const f = join(dir, `d1-${db.binding}-migrations.json`);
      writeFileSync(f, JSON.stringify(migrations));
      services.push({
        name: svc,
        worker: {
          modules: [{ name: 'd1.js', esModule: embed('runtime/d1.js') }],
          compatibilityDate: w.compatibility_date,
          bindings: [
            { name: 'DB_OBJECT', durableObjectNamespace: { className: 'D1Sqlite' } },
            { name: 'MIGRATIONS', json: embed(rel(f)) },
          ],
          durableObjectNamespaces: [{ className: 'D1Sqlite', uniqueKey: svc, enableSql: true }],
          durableObjectStorage: doStorage,
        },
      });
      bindings.push({
        name: db.binding,
        wrapped: { moduleName: 'cloudflare-internal:d1-api', innerBindings: [{ name: 'fetcher', service: svc }] },
      });
    }

    let front = w.name;
    if (w.assets) {
      const a = w.assets;
      const assetsDir = join(out, 'assets', w.name);
      const manifest = copyAssets(a.directory, assetsDir);
      const config = {
        html_handling: a.html_handling ?? 'auto-trailing-slash',
        not_found_handling: a.not_found_handling ?? 'none',
        run_worker_first: a.run_worker_first ?? false,
        headers: parseHeaders(readOptional(join(a.directory, '_headers'))),
        redirects: parseRedirects(readOptional(join(a.directory, '_redirects'))),
        manifest,
      };
      const f = join(dir, 'assets.json');
      writeFileSync(f, JSON.stringify(config));
      services.push({ name: `files-${w.name}`, disk: { path: rel(assetsDir) } });
      services.push({
        name: `assets-${w.name}`,
        worker: {
          modules: [{ name: 'assets.js', esModule: embed('runtime/assets.js') }],
          compatibilityDate: w.compatibility_date,
          bindings: [
            { name: 'CONFIG', json: embed(rel(f)) },
            { name: 'FILES', service: `files-${w.name}` },
            { name: 'USER', service: w.name },
          ],
        },
      });
      if (a.binding) bindings.push({ name: a.binding, service: { name: `assets-${w.name}`, entrypoint: 'Assets' } });
      front = `assets-${w.name}`;
    }

    const classes = (w.durable_objects ?? []).map((d) => d.class_name);
    services.push({
      name: w.name,
      worker: {
        modules: [{ name: 'main.js', esModule: embed(rel(join(dir, 'main.js'))) }],
        compatibilityDate: w.compatibility_date,
        compatibilityFlags: w.compatibility_flags?.length ? w.compatibility_flags : undefined,
        bindings,
        durableObjectNamespaces: classes.length
          ? [...new Set(classes)].map((c) => ({ className: c, uniqueKey: `${w.name}-${c}`, enableSql: true }))
          : undefined,
        durableObjectStorage: classes.length ? doStorage : undefined,
      },
    });

    routerBindings.push({ name: w.name, service: front });
    for (const r of w.routes ?? []) routes.push([r, w.name]);
    for (const c of w.crons ?? []) cronTargets.push([w.name, c]);
  }

  const cronDate = site.workers[0]!.compatibility_date;
  if (cronTargets.length) {
    const f = join(out, 'runtime', 'crons.json');
    writeFileSync(f, JSON.stringify(cronTargets));
    services.push({
      name: 'cron',
      worker: {
        modules: [{ name: 'cron.js', esModule: embed('runtime/cron.js') }],
        compatibilityDate: cronDate,
        // 有了这个开关，服务绑定的 scheduled() 才是投一个 scheduled 事件；没有它会被当成 RPC 调 scheduled 方法
        // （平台故意把 scheduled 写成实例字段，不让 RPC 调到，见 platform/worker/index.ts）。miniflare 投定时任务也靠它
        compatibilityFlags: ['service_binding_extra_handlers'],
        bindings: [
          { name: 'CRONS', json: embed('runtime/crons.json') },
          ...[...new Set(cronTargets.map(([w]) => w))].map((w) => ({ name: w, service: w })),
        ],
        durableObjectNamespaces: [{ className: 'Cron', uniqueKey: 'arcade-host-cron', enableSql: true }],
        durableObjectStorage: doStorage,
      },
    });
  }
  // 精确路径在前，前缀按长度从长到短：/games/texas 和 /games/texas/* 谁先都一样，但以后有嵌套前缀时长的要先
  routes.sort((a, b) => Number(b[0].endsWith('/*') ? 0 : 1) - Number(a[0].endsWith('/*') ? 0 : 1) || b[0].length - a[0].length);
  services.push({
    name: 'router',
    worker: {
      modules: [{ name: 'router.js', esModule: embed('runtime/router.js') }],
      compatibilityDate: cronDate,
      bindings: [
        { name: 'ROUTES', json: JSON.stringify(routes) },
        { name: 'FALLBACK', text: site.fallback },
        ...(cronTargets.length ? [{ name: 'CRON', durableObjectNamespace: { className: 'Cron', serviceName: 'cron' } }] : []),
        ...routerBindings,
      ],
    },
  });
  services.push({
    name: 'admin',
    worker: {
      modules: [{ name: 'admin.js', esModule: embed('runtime/admin.js') }],
      compatibilityDate: cronDate,
      bindings: [
        { name: 'D1_LIST', json: JSON.stringify(d1List) },
        ...d1List.map((svc) => ({ name: svc, durableObjectNamespace: { className: 'D1Sqlite', serviceName: svc } })),
        ...(cronTargets.length ? [{ name: 'CRON', durableObjectNamespace: { className: 'Cron', serviceName: 'cron' } }] : []),
      ],
    },
  });
  if (storage === 'sqlite') services.push({ name: 'data', disk: { writable: true } });

  const config = {
    services,
    sockets: [
      { name: 'http', address: opts.listen ?? '127.0.0.1:8787', http: {}, service: 'router' },
      { name: 'admin', address: opts.adminListen ?? '127.0.0.1:8788', http: {}, service: 'admin' },
    ],
  };
  const body = `# 由 packages/arcade-host 的生成器生成，不要手改（改站点描述后重新生成）\nusing Workerd = import "/workerd/workerd.capnp";\n\nconst config :Workerd.Config = ${text(config)};\n`;
  writeFileSync(join(out, 'config.capnp'), body);
  writeFileSync(
    join(out, 'release.json'),
    JSON.stringify(
      {
        version: opts.version ?? null,
        storage,
        workers: site.workers.map((w) => w.name),
        generated: new Date().toISOString(),
      },
      null,
      2,
    ) + '\n',
  );
  return { config: join(out, 'config.capnp') };
}

function validate(site: Site): void {
  const names = new Set<string>();
  const reserved = new Set(['router', 'cron', 'admin', 'data', 'internet']);
  for (const w of site.workers) {
    if (!/^[a-z][a-z0-9-]*$/.test(w.name)) throw new Error(`Worker 名不合规：${w.name}`);
    if (names.has(w.name) || reserved.has(w.name) || /^(assets|files|d1)-/.test(w.name)) throw new Error(`Worker 名重复或和生成器的保留名冲突：${w.name}`);
    names.add(w.name);
    for (const r of w.routes ?? []) {
      if (!r.startsWith('/') || (r.includes('*') && !r.endsWith('/*')) || r.indexOf('*') !== r.lastIndexOf('*')) {
        throw new Error(`${w.name} 的路由只许 /精确路径 或 /前缀/*：${r}`);
      }
    }
    for (const c of w.crons ?? []) parseCron(c);
    const h = w.assets?.html_handling;
    if (h && h !== 'auto-trailing-slash' && h !== 'none') throw new Error(`${w.name}：assets.html_handling 只支持 auto-trailing-slash 和 none`);
  }
  if (!names.has(site.fallback)) throw new Error(`fallback ${site.fallback} 不在 workers 里`);
  for (const w of site.workers) {
    for (const s of w.services ?? []) if (!names.has(s.service)) throw new Error(`${w.name} 的服务绑定 ${s.binding} 指向不存在的 ${s.service}`);
  }
}

function readOptional(f: string): string {
  return existsSync(f) ? readFileSync(f, 'utf8') : '';
}

/** 复制静态资源并算出清单：路径 → 内容哈希（和 Cloudflare 一样，哈希里带扩展名，内容相同、扩展名不同的不算同一个文件） */
function copyAssets(src: string, dest: string): Record<string, string> {
  if (!existsSync(src) || !statSync(src).isDirectory()) throw new Error(`静态资源目录 ${src} 不存在，构建没跑？`);
  if (existsSync(join(src, '.assetsignore'))) throw new Error(`${src}/.assetsignore：生成器还不支持忽略规则`);
  const manifest: Record<string, string> = {};
  const walk = (dir: string, prefix: string) => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full, `${prefix}/${name}`);
      else if (st.isFile() && !(prefix === '' && NOT_ASSETS.has(name))) {
        const path = `${prefix}/${name}`;
        const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
        manifest[path] = createHash('sha256').update(readFileSync(full)).update(ext).digest('hex').slice(0, 32);
        mkdirSync(join(dest, prefix), { recursive: true });
        cpSync(full, join(dest, prefix, name));
      }
    }
  };
  walk(src, '');
  if (!Object.keys(manifest).length) mkdirSync(dest, { recursive: true });
  return manifest;
}
