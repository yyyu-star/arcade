#!/usr/bin/env node
/**
 * 自托管的发布目录：把各模块打好的产物（和部署作业收的是同一种 artifact）加上本站的叠加规则，交给 packages/arcade-host 的生成器。
 *
 * 和 Cloudflare 部署走同一套规则，不另写一份：
 *   - 读模块根目录的 wrangler.jsonc，用 tools/deployer/lib.mjs 的白名单检查（checkSourceConfig），不过就不生成；
 *   - 接平台的游戏按 tools/workers.json 叠加平台绑定和 GATE=login（platformOverlay，和 deploy.mjs 同一个函数）；
 *   - 路由按 deploy.mjs 注入的那两条：/games/<id> 和 /games/<id>/*，平台不写路由（兜底）；
 *   - SITE_ORIGIN：deploy.mjs 用 --var 注入，这里改成运行时从环境变量取（同一份发布包换域名不用重新生成）；
 *   - 平台的 Secret（tools/deploy-allowlist.json 的 forbiddenVars，去掉 SITE_ORIGIN）运行时从同名环境变量取；
 *   - --db pg：平台库放 PostgreSQL（连接串运行时从 ARCADE_PG_URL 取），PG 版迁移和覆盖表在 tools/selfhost/pg/（平台的 SQL 一条不改，
 *     哪些语句走覆盖表、为什么，见 pg/check-sql.mjs，CI 每次都在真的 PG 上查一遍）。
 *
 * 用法（仓库根，先 npm ci --ignore-scripts --prefix tools/deployer，packages/arcade-host 里 npm ci && npm run build）：
 *   node tools/selfhost/build.mjs --artifacts <目录> --out <发布目录> [--only arcade,texas] [--storage sqlite|memory] [--db sqlite|pg] [--version <说明>] [--listen 127.0.0.1:8787] [--admin-listen 127.0.0.1:8788]
 * <目录>/<Worker 名>/ 下是 pack.mjs 摆好的 worker/ 和 assets/（tools/selfhost/pack-all.sh 一次打全部）。
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { checkSourceConfig, moduleInfo, platformOverlay, REPO_ROOT, workerRegistry } from '../deployer/lib.mjs';

const { values: args } = parseArgs({
  options: {
    artifacts: { type: 'string' },
    out: { type: 'string' },
    only: { type: 'string' },
    storage: { type: 'string', default: 'sqlite' },
    db: { type: 'string', default: 'sqlite' },
    version: { type: 'string' },
    listen: { type: 'string' },
    'admin-listen': { type: 'string' },
  },
});
const fail = (msg) => {
  console.error(`selfhost build：${msg}`);
  process.exit(1);
};
if (!args.artifacts || !args.out) fail('要 --artifacts <目录> 和 --out <发布目录>');
if (!['sqlite', 'memory'].includes(args.storage)) fail('--storage 只许 sqlite 或 memory');
if (!['sqlite', 'pg'].includes(args.db)) fail('--db 只许 sqlite 或 pg');

const pgDir = join(REPO_ROOT, 'tools', 'selfhost', 'pg');

const artifacts = resolve(args.artifacts);
const registry = workerRegistry();
const only = args.only ? new Set(args.only.split(',')) : null;
if (only) for (const n of only) if (!registry.has(n)) fail(`--only 里的 ${n} 不在 tools/workers.json`);
if (only && !only.has('arcade')) fail('--only 必须包含平台 arcade（兜底路由和游戏的平台绑定都指向它）');

const allow = JSON.parse(readFileSync(join(REPO_ROOT, 'tools', 'deploy-allowlist.json'), 'utf8'));
const platformSecrets = allow.forbiddenVars.filter((v) => v !== 'SITE_ORIGIN');

const workers = [];
for (const [name, reg] of registry) {
  if (only && !only.has(name)) continue;
  const info = moduleInfo(reg.isPlatform ? 'platform' : `games/${name}`);
  const modDir = join(REPO_ROOT, info.mod);
  const { raw, errors } = checkSourceConfig(join(modDir, 'wrangler.jsonc'), info);
  if (errors.length) fail(`${info.mod}/wrangler.jsonc 没过部署检查：\n  ${errors.join('\n  ')}`);
  const c = platformOverlay(raw, name);
  const art = join(artifacts, name);
  const workerDir = join(art, 'worker');
  const mainName = c.main.replace(/^.*\//, '').replace(/\.[cm]?[jt]sx?$/, '.js');
  const main = join(workerDir, mainName);
  if (!existsSync(main)) fail(`${main} 不存在：先打包这个模块（tools/selfhost/pack-all.sh）`);
  const extra = readdirSync(workerDir).filter((f) => f !== mainName && !f.endsWith('.map') && f !== 'README.md');
  if (extra.length) fail(`${workerDir} 里除了入口还有 ${extra.join('、')}：只支持打成单个文件的 Worker（和 deploy.mjs 的要求一样）`);
  if (args.storage === 'memory' && c.durable_objects?.bindings?.length) {
    // 不落盘时 DO 的状态只能经 KIT_STORE 进 PG，这是 kit 0.21.0 才有的；旧 kit 的房间重启就没了，宁可不生成
    const lock = JSON.parse(readFileSync(join(modDir, 'package-lock.json'), 'utf8'));
    const kit = lock.packages?.['node_modules/arcade-kit']?.version;
    const [maj, min] = (kit ?? '0.0').split('.').map(Number);
    if (!kit || (maj === 0 && min < 21)) {
      fail(`${info.mod} 有 Durable Object，可它的 arcade-kit 是 ${kit ?? '（没有）'}：--storage memory 要 kit 0.21.0 起（KIT_STORE），不然房间重启就丢`);
    }
  }
  const { SITE_ORIGIN: _ignored, ...vars } = c.vars ?? {};
  workers.push({
    name,
    main,
    compatibility_date: c.compatibility_date,
    compatibility_flags: c.compatibility_flags,
    vars,
    secrets: ['SITE_ORIGIN', ...(reg.isPlatform ? platformSecrets : [])],
    services: c.services,
    durable_objects: c.durable_objects?.bindings,
    d1_databases: c.d1_databases?.map((d) => {
      // PG 版只给平台库写了；以后别的模块有 D1，在 pg/ 下按 Worker 名和绑定名加一套
      if (args.db === 'pg' && !(reg.isPlatform && d.binding === 'DB')) fail(`${name} 的 D1 ${d.binding} 没有 PG 版（tools/selfhost/pg/）`);
      return {
        ...d,
        migrations_dir: join(modDir, d.migrations_dir ?? 'migrations'),
        ...(args.db === 'pg' ? { pg: { migrations_dir: join(pgDir, 'migrations') } } : {}),
      };
    }),
    assets: c.assets && {
      ...c.assets,
      directory: join(art, 'assets'),
    },
    crons: c.triggers?.crons,
    routes: reg.isPlatform ? [] : [`/games/${name}`, `/games/${name}/*`],
  });
}

const { generate } = await import(join(REPO_ROOT, 'packages', 'arcade-host', 'src', 'gen', 'generate.ts'));
// 覆盖表的正本带说明和对照参数（pg/overrides.json，check-sql.mjs 用）；运行时只要"规范化的 SQLite 原文 → PG 版"
const tmp = mkdtempSync(join(tmpdir(), 'arcade-selfhost-'));
if (args.db === 'pg') {
  const overrides = join(tmp, 'overrides.json');
  const list = JSON.parse(readFileSync(join(pgDir, 'overrides.json'), 'utf8'));
  writeFileSync(overrides, JSON.stringify(Object.fromEntries(list.map((o) => [o.sqlite, Array.isArray(o.pg) ? o.pg.join('\n') : o.pg]))));
  for (const w of workers) for (const d of w.d1_databases ?? []) if (d.pg) d.pg.overrides = overrides;
}
let config;
try {
  ({ config } = generate(
    { fallback: 'arcade', workers },
    { out: resolve(args.out), storage: args.storage, db: args.db, version: args.version, listen: args.listen, adminListen: args['admin-listen'] },
  ));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`selfhost build：${workers.map((w) => w.name).join('、')} → ${config}`);
