/**
 * 生成器：站点描述（site.ts）→ 一个能直接交给 workerd 的发布目录。
 *
 *   <out>/config.capnp          workerd 配置（下面的文件都用相对路径 embed 进去）
 *   <out>/runtime/*.js          本包的运行时：router、assets、d1、cron-entry、admin
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
  /**
   * D1 的后端：sqlite（默认，DO 里的 SQLite）或 pg（PostgreSQL，连接串运行时从 ARCADE_PG_URL 取）。
   * v2.1 的 PG 模式是 db: 'pg' + storage: 'memory'：什么都不落盘，DO 的状态经 KIT_STORE 存进 PG（kit 0.21 起）。
   */
  db?: 'sqlite' | 'pg';
  /** 监听地址；运行时可以用 --socket-addr http=<地址> 覆盖 */
  listen?: string;
  /** 内部管理入口（备份、恢复、手动跑定时任务）的监听地址，只许回环地址（没有认证）。容器里也只听容器内的 127.0.0.1，用 docker exec 进去调 */
  adminListen?: string;
  /** 写进 release.json 的版本说明（比如 git 提交） */
  version?: string;
  /** 本包运行时的目录（默认是本包 dist/runtime，要先 npm run build） */
  runtimeDir?: string;
}

const RUNTIME = ['router', 'assets', 'd1', 'd1pg', 'kitstore', 'cron-entry', 'admin'] as const;
/** kit 的角色 → kit 依赖的 DO 绑定名（kit 的 internal.ts 就按这几个名字找命名空间） */
const KIT_ROLES = [
  ['room', 'ROOM'],
  ['meter', 'METER'],
  ['match', 'MATCH'],
] as const;
/** 定时任务的 DO 类名：加进有 crons 的 Worker，模块自己不许有同名的导出 */
const CRON_CLASS = 'ArcadeHostCron';
/** 管理入口没有认证，只许听回环地址 */
export const LOOPBACK = /^(127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost|\[::1\]):\d+$/;
/** 这些文件 wrangler 不当静态资源上传（解析进配置，或者是忽略规则本身） */
const NOT_ASSETS = new Set(['_headers', '_redirects', '.assetsignore', '_worker.js']);

export function generate(site: Site, opts: GenerateOptions): { config: string } {
  const out = opts.out;
  const storage = opts.storage ?? 'sqlite';
  const db = opts.db ?? 'sqlite';
  // 内存存储下 SQLite 版的 D1 重启就清空：平台库必须在 PG
  if (storage === 'memory' && db === 'sqlite' && site.workers.some((w) => w.d1_databases?.length)) {
    throw new Error('storage: memory 时 D1 必须用 db: pg（不然平台库重启就没了）');
  }
  const runtimeDir = opts.runtimeDir ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist', 'runtime');
  validate(site);
  if (opts.adminListen !== undefined && !LOOPBACK.test(opts.adminListen)) {
    throw new Error(`管理入口没有认证，只许听回环地址（127.x、localhost、[::1]）：${opts.adminListen}`);
  }
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
  const cronWorkers: string[] = [];
  const kitStore = db === 'pg' && storage === 'memory';
  /** [游戏, kit 角色, DO 绑定名, 类名]：重启后唤醒存了闹钟的对象用 */
  const wake: [string, string, string, string][] = [];
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
    if (kitStore && w.durable_objects?.length) {
      // PG 模式：kit 看到 KIT_STORE 就把房间、计量、排队的状态存进 PG（kit 0.21）；props.game 定这是哪个游戏，游戏自己改不了
      bindings.push({ name: 'KIT_STORE', service: { name: 'kitstore', entrypoint: 'KitStore', props: { json: JSON.stringify({ game: w.name }) } } });
      for (const [role, b] of KIT_ROLES) {
        const d = w.durable_objects.find((x) => x.name === b);
        if (d) wake.push([w.name, role, b, d.class_name]);
      }
    }

    for (const d of w.d1_databases ?? []) {
      const svc = `d1-${w.name}-${d.binding}`;
      d1List.push(svc);
      const readMigrations = (dirPath: string) =>
        existsSync(dirPath)
          ? readdirSync(dirPath)
              .filter((f) => f.endsWith('.sql'))
              .sort()
              .map((f) => [f, readFileSync(join(dirPath, f), 'utf8')] as [string, string])
          : [];
      const migrations = readMigrations(d.migrations_dir);
      if (db === 'sqlite') {
        const f = join(dir, `d1-${d.binding}-migrations.json`);
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
      } else {
        if (!d.pg) throw new Error(`${w.name} 的 D1 ${d.binding} 没有 PG 版（d1_databases[].pg）`);
        const pgMigrations = readMigrations(d.pg.migrations_dir);
        // PG 版迁移和 SQLite 版一一对应：平台加了迁移忘了写 PG 版，生成时就挡住
        const names = (l: [string, string][]) => l.map(([n]) => n).join(',');
        if (names(pgMigrations) !== names(migrations)) {
          throw new Error(`${w.name} 的 PG 版迁移和 SQLite 版对不上：SQLite ${names(migrations)}；PG ${names(pgMigrations)}`);
        }
        const fm = join(dir, `d1pg-${d.binding}-migrations.json`);
        writeFileSync(fm, JSON.stringify(pgMigrations));
        const fo = join(dir, `d1pg-${d.binding}-overrides.json`);
        writeFileSync(fo, d.pg.overrides ? readFileSync(d.pg.overrides, 'utf8') : '{}');
        services.push({
          name: svc,
          worker: {
            modules: [{ name: 'd1pg.js', esModule: embed('runtime/d1pg.js') }],
            compatibilityDate: w.compatibility_date,
            // postgres.js 的 workerd 版要 node:buffer、node:stream、node:events：nodejs_compat 从 compat date 2026-08-04 起默认就开着，
            // 再写一遍 workerd 会报错（本站的模块都是 2026-10-01）
            bindings: [
              { name: 'DB_OBJECT', durableObjectNamespace: { className: 'D1Pg' } },
              { name: 'PG_URL', fromEnvironment: 'ARCADE_PG_URL' },
              { name: 'MIGRATIONS', json: embed(rel(fm)) },
              { name: 'OVERRIDES', json: embed(rel(fo)) },
            ],
            // 对象只放连接池，不存东西
            durableObjectNamespaces: [{ className: 'D1Pg', uniqueKey: svc }],
            globalOutbound: 'pg-network',
            durableObjectStorage: { inMemory: VOID },
          },
        });
      }
      bindings.push({
        name: d.binding,
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

    const classes = [...new Set((w.durable_objects ?? []).map((d) => d.class_name))];
    const modules: Capnp[] = [{ name: 'main.js', esModule: embed(rel(join(dir, 'main.js'))) }];
    const namespaces: Capnp[] = classes.map((c) => ({ className: c, uniqueKey: `${w.name}-${c}`, enableSql: true }));
    if (w.crons?.length) {
      // 有定时任务的 Worker：主模块换成 cron-entry（原样转出 main.js 的全部导出），多一个 DO 类 ArcadeHostCron 在 Worker 里面调 scheduled
      writeFileSync(join(dir, 'crons.js'), `export default ${JSON.stringify(w.crons)};\n`);
      modules.unshift({ name: 'arcade-host-entry.js', esModule: embed('runtime/cron-entry.js') });
      modules.push({ name: 'arcade-host-crons.js', esModule: embed(rel(join(dir, 'crons.js'))) });
      namespaces.push({ className: CRON_CLASS, uniqueKey: `${w.name}-${CRON_CLASS}`, enableSql: true });
      cronWorkers.push(w.name);
    }
    services.push({
      name: w.name,
      worker: {
        modules,
        compatibilityDate: w.compatibility_date,
        compatibilityFlags: w.compatibility_flags?.length ? w.compatibility_flags : undefined,
        bindings,
        durableObjectNamespaces: namespaces.length ? namespaces : undefined,
        durableObjectStorage: namespaces.length ? doStorage : undefined,
      },
    });

    routerBindings.push({ name: w.name, service: front });
    for (const r of w.routes ?? []) routes.push([r, w.name]);
  }

  const date = site.workers[0]!.compatibility_date;
  // 路由层和管理入口找各 Worker 的定时任务对象：绑定名 cron:<Worker 名>
  const cronBindings = cronWorkers.map((w) => ({ name: `cron:${w}`, durableObjectNamespace: { className: CRON_CLASS, serviceName: w } }));
  if (kitStore) {
    services.push({
      name: 'kitstore',
      worker: {
        modules: [{ name: 'kitstore.js', esModule: embed('runtime/kitstore.js') }],
        compatibilityDate: date,
        bindings: [
          { name: 'STORE', durableObjectNamespace: { className: 'KitStorePg' } },
          { name: 'PG_URL', fromEnvironment: 'ARCADE_PG_URL' },
          { name: 'WAKE', json: JSON.stringify(wake.map(([g, r, b]) => [g, r, b])) },
          ...wake.map(([g, , b, c]) => ({ name: `wake:${g}:${b}`, durableObjectNamespace: { className: c, serviceName: g } })),
        ],
        durableObjectNamespaces: [{ className: 'KitStorePg', uniqueKey: 'arcade-host-kitstore' }],
        globalOutbound: 'pg-network',
        durableObjectStorage: { inMemory: VOID },
      },
    });
  }
  // 精确路径在前，前缀按长度从长到短：/games/texas 和 /games/texas/* 谁先都一样，但以后有嵌套前缀时长的要先
  routes.sort((a, b) => Number(b[0].endsWith('/*') ? 0 : 1) - Number(a[0].endsWith('/*') ? 0 : 1) || b[0].length - a[0].length);
  services.push({
    name: 'router',
    worker: {
      modules: [{ name: 'router.js', esModule: embed('runtime/router.js') }],
      compatibilityDate: date,
      bindings: [
        { name: 'ROUTES', json: JSON.stringify(routes) },
        { name: 'FALLBACK', text: site.fallback },
        { name: 'CRON_WORKERS', json: JSON.stringify(cronWorkers) },
        ...cronBindings,
        ...(kitStore ? [{ name: 'KITSTORE', service: 'kitstore' }] : []),
        ...routerBindings,
      ],
    },
  });
  services.push({
    name: 'admin',
    worker: {
      modules: [{ name: 'admin.js', esModule: embed('runtime/admin.js') }],
      compatibilityDate: date,
      bindings: [
        { name: 'D1_LIST', json: JSON.stringify(d1List) },
        ...d1List.map((svc) => ({ name: svc, durableObjectNamespace: { className: db === 'pg' ? 'D1Pg' : 'D1Sqlite', serviceName: svc } })),
        { name: 'CRON_WORKERS', json: JSON.stringify(cronWorkers) },
        ...cronBindings,
      ],
    },
  });
  if (storage === 'sqlite') services.push({ name: 'data', disk: { writable: true } });
  // workerd 默认的出站网络只许公网地址（防 SSRF）；PG 常在本机或内网，只给连 PG 的两个 Worker 放开，模块自己的 Worker 不变
  if (db === 'pg') services.push({ name: 'pg-network', network: { allow: ['public', 'private', 'local'] } });

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
        db,
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
  const reserved = new Set(['router', 'admin', 'data', 'internet', 'kitstore', 'pg-network']);
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
    if (w.crons?.length && w.durable_objects?.some((d) => d.class_name === CRON_CLASS)) throw new Error(`${w.name}：DO 类名 ${CRON_CLASS} 是生成器保留的`);
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
