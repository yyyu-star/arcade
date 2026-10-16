#!/usr/bin/env node
/**
 * 部署作业唯一执行的程序：检查 → 生成最终配置 → 用钉死的 wrangler 部署。它和它用的 wrangler 都来自 main 上这次提交的 tools/
 * （维护者管的目录），部署作业里不 checkout、不安装、不执行任何模块代码。
 *
 * 输入有两份，信任程度不同：
 *   - 仓库里的 <模块>/wrangler.jsonc（平台还有 migrations/*.sql）：部署作业用 sparse-checkout 只取这几个文件，是审过、合进 main 的内容，
 *     只当数据读，用钉死的 wrangler 解析后按白名单查（lib.mjs）；
 *   - 构建作业交来的 artifact（worker/<入口名>.js + assets/）：构建作业跑的是模块代码，产物可能被改成任何样子，
 *     这里只当数据：查目录结构（只许普通文件，不许符号链接、隐藏文件、多余的东西），不执行里面的任何东西，
 *     打包好的入口复制到工作目录（去掉末尾的 sourceMappingURL 注释）后作为唯一的 Worker 模块上传（--no-bundle，
 *     不找附加模块、不传 source map，见 lib.mjs 的 FINAL_BUNDLE_FLAGS）。
 * 最终配置由这里从审过的 wrangler.jsonc 逐字段拷出白名单里的内容生成（main 指向打包产物、assets 指向资源目录、
 * D1 填上正式库的 id），写成纯 JSON 后再用钉死的 wrangler 读回来查一遍，通过了才部署；路由、域名、SITE_ORIGIN 用命令行注入。
 *
 * wrangler 的运行环境：工作目录是新建的空目录（只有最终配置），--env-file 指向 /dev/null（wrangler 4.151 只在没给 --env-file 时
 * 才读当前目录的 .env/.env.local），环境变量只传必需的几个，CLOUDFLARE_API_BASE_URL 写死成官方地址，HOME 也换成新建的空目录。
 *
 * 用法：node tools/deployer/deploy.mjs --module <platform|games/<id>> --artifact <目录> --work <新目录> [--dry-run]
 *   环境变量：SITE_HOST（正式站主机名）、平台还要 D1_DATABASE_ID；正式部署要 CLOUDFLARE_API_TOKEN、CLOUDFLARE_ACCOUNT_ID。
 *   --dry-run：只跑 wrangler deploy --dry-run（不连 Cloudflare、不迁移 D1），本机验证用。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { FINAL_BUNDLE_FLAGS, REPO_ROOT, checkConfig, checkNormalized, checkSourceConfig, moduleInfo, readConfigStrict } from './lib.mjs';

const API_BASE = 'https://api.cloudflare.com/client/v4';
const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * 去掉入口末尾的 //# sourceMappingURL=（以及旧写法 //@）注释。从末尾往前看的规则照抄 wrangler 4.151 的 getSourceMappingUrl：
 * 跳过空行，碰到既不是 //# 也不是 //@ 开头的行就停。
 * 为什么去掉而不是只查它指向哪里：upload_source_maps 已经关掉，这行本来就不起作用；去掉以后不管 wrangler 哪条路径
 * （上传、本地堆栈）都没有可以跟着去读的文件路径，也不用再判断 ../、绝对路径、data: 之类的写法算不算合规。
 */
function stripSourceMapComment(text) {
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    if (!line.startsWith('//#') && !line.startsWith('//@')) break;
    if (/^\/\/[#@]\s*source(Mapping)?URL=/.test(line)) lines.splice(i, 1);
  }
  return lines.join('\n');
}

function fail(msg) {
  console.error(`::error::deploy：${msg}`);
  process.exit(1);
}

const { values: args } = parseArgs({
  options: { module: { type: 'string' }, artifact: { type: 'string' }, work: { type: 'string' }, 'dry-run': { type: 'boolean', default: false } },
  strict: true,
});
if (!args.module || !args.artifact || !args.work) fail('用法：deploy.mjs --module <模块> --artifact <目录> --work <新目录> [--dry-run]');
const dryRun = args['dry-run'];
let info;
try {
  info = moduleInfo(args.module);
} catch (e) {
  fail(e.message);
}
const { mod, id, isPlatform } = info;

// —— 1. 钉死的 wrangler 确实是 package.json 里写的那个版本 ——
const deployerDir = join(REPO_ROOT, 'tools', 'deployer');
const pinned = JSON.parse(readFileSync(join(deployerDir, 'package.json'), 'utf8')).dependencies.wrangler;
const wranglerPkg = JSON.parse(readFileSync(join(deployerDir, 'node_modules', 'wrangler', 'package.json'), 'utf8'));
if (wranglerPkg.version !== pinned) fail(`tools/deployer 里装的 wrangler 是 ${wranglerPkg.version}，不是钉死的 ${pinned}（用 npm ci --ignore-scripts 装）`);
const wranglerBin = join(deployerDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

// —— 2. 注入的值 ——
const host = (process.env.SITE_HOST ?? '').trim().toLowerCase();
if (!HOST.test(host)) fail('SITE_HOST 没设或不像主机名（只要主机名，不带协议和路径）');
const d1Id = (process.env.D1_DATABASE_ID ?? '').trim();
if (isPlatform && !UUID.test(d1Id)) fail('D1_DATABASE_ID 没设或不像 D1 的 id（UUID）：没有 id 时 wrangler 会新建一个空库，不能部署');
if (!dryRun && !(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID)) fail('CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID 没设');

// —— 3. 仓库里审过的 wrangler.jsonc ——
const sourceFile = join(REPO_ROOT, mod, 'wrangler.jsonc');
const { raw: source, errors: sourceErrors } = checkSourceConfig(sourceFile, info);
if (sourceErrors.length) fail(`部署配置检查没过：\n  ${sourceErrors.join('\n  ')}`);

// —— 4. artifact：只当数据，查结构 ——
const artifact = resolve(args.artifact);
const entryName = `${basename(source.main, extname(source.main))}.js`;
const problems = [];
function walk(dir, rel) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    const st = lstatSync(p);
    if (name.startsWith('.')) problems.push(`${r}：产物里不许有隐藏文件`);
    if (st.isSymbolicLink()) problems.push(`${r}：产物里不许有符号链接`);
    else if (st.isDirectory()) walk(p, r);
    else if (!st.isFile()) problems.push(`${r}：不是普通文件`);
  }
}
if (!existsSync(artifact) || !lstatSync(artifact).isDirectory()) fail(`artifact 目录 ${artifact} 不存在`);
walk(artifact, '');
const wantTop = source.assets ? ['assets', 'worker'] : ['worker'];
for (const name of readdirSync(artifact)) if (!wantTop.includes(name)) problems.push(`${name}：产物顶层只许有 ${wantTop.join('、')}`);
for (const name of wantTop) if (!existsSync(join(artifact, name)) || !lstatSync(join(artifact, name)).isDirectory()) problems.push(`缺少 ${name}/`);
const workerDir = join(artifact, 'worker');
if (existsSync(workerDir) && lstatSync(workerDir).isDirectory()) {
  // wrangler --dry-run --outdir 的输出：入口、它的 source map、一份说明。部署只用入口（复制出去，见下面第 6 步），别的都不上传；
  // 多出来的文件（wasm、附加模块之类）说明打包方式变了，先停下
  const allowed = new Set([entryName, `${entryName}.map`, 'README.md']);
  for (const name of readdirSync(workerDir)) if (!allowed.has(name)) problems.push(`worker/${name}：打包产物只许有 ${[...allowed].join('、')}`);
  if (!existsSync(join(workerDir, entryName))) problems.push(`缺少打包好的入口 worker/${entryName}`);
}
if (problems.length) fail(`artifact 不对：\n  ${problems.join('\n  ')}`);

// —— 5. 平台的 D1 迁移：来自仓库（审过的 SQL），只许普通的 .sql 文件 ——
let migrationsDir;
if (isPlatform) {
  migrationsDir = resolve(REPO_ROOT, mod, source.d1_databases[0].migrations_dir ?? 'migrations');
  if (!existsSync(migrationsDir) || !lstatSync(migrationsDir).isDirectory()) fail(`${mod} 的迁移目录不存在（部署作业的 sparse-checkout 要包含它）`);
  for (const name of readdirSync(migrationsDir)) {
    const st = lstatSync(join(migrationsDir, name));
    if (!st.isFile() || !/^\d{4}_[a-z0-9_]+\.sql$/.test(name)) fail(`迁移目录里只许有 NNNN_名字.sql 这样的普通文件：${name}`);
  }
}

// —— 6. 生成最终配置：只拷白名单检查过的字段，路径换成产物的绝对路径 ——
const work = resolve(args.work);
if (existsSync(work)) fail(`工作目录 ${work} 已存在：必须是新建的空目录`);
const configDir = join(work, 'config');
const homeDir = join(work, 'home');
mkdirSync(configDir, { recursive: true });
mkdirSync(homeDir, { recursive: true });
// 入口单独复制到一个只有它的目录：即使附加模块的查找被打开，这个目录里也没有别的东西可上传
const bundleDir = join(work, 'bundle');
mkdirSync(bundleDir);
writeFileSync(join(bundleDir, entryName), stripSourceMapComment(readFileSync(join(workerDir, entryName), 'utf8')));
const expect = {
  main: join(bundleDir, entryName),
  assets: source.assets ? join(artifact, 'assets') : undefined,
  migrations: migrationsDir,
};
const final = { ...structuredClone(source), ...FINAL_BUNDLE_FLAGS };
delete final.$schema;
final.main = expect.main;
if (final.assets) final.assets.directory = expect.assets;
if (isPlatform) Object.assign(final.d1_databases[0], { database_id: d1Id, migrations_dir: migrationsDir });
const finalFile = join(configDir, 'wrangler.json');
writeFileSync(finalFile, `${JSON.stringify(final, null, 2)}\n`);

// —— 7. 用钉死的 wrangler 把最终配置读回来再查一遍：白名单 + wrangler 规范化后的结果 ——
const label = `${mod} 的最终配置`;
const { raw: reread, errors: rereadErrors } = readConfigStrict(finalFile, label);
const finalErrors = reread
  ? [...checkConfig(reread, { ...info, stage: 'final', baseDir: configDir, label, expect }), ...checkNormalized(finalFile, { id, isPlatform, label })]
  : rereadErrors;
if (finalErrors.length) fail(`最终配置检查没过：\n  ${finalErrors.join('\n  ')}`);
console.log(`deploy：${label}检查通过（wrangler ${wranglerPkg.version}）`);

// —— 8. 部署 ——
const env = {
  PATH: process.env.PATH,
  HOME: homeDir,
  TMPDIR: process.env.RUNNER_TEMP || process.env.TMPDIR || '/tmp',
  CI: 'true',
  WRANGLER_SEND_METRICS: 'false',
  WRANGLER_SEND_ERROR_REPORTS: 'false',
  CLOUDFLARE_API_BASE_URL: API_BASE,
  ...(dryRun ? {} : { CLOUDFLARE_API_TOKEN: process.env.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: process.env.CLOUDFLARE_ACCOUNT_ID }),
};
function wrangler(argv) {
  const full = [...argv, '-c', finalFile, '--env-file', '/dev/null'];
  console.log(`$ wrangler ${full.join(' ').replaceAll(host, '<SITE_HOST>')}`);
  const r = spawnSync(process.execPath, [wranglerBin, ...full], { cwd: configDir, env, stdio: 'inherit' });
  if (r.status !== 0) fail(`wrangler ${argv[0]} 失败（退出码 ${r.status ?? r.signal}）`);
}

if (isPlatform) {
  // 先迁移再部署：新代码依赖新表，反过来 /api 会 fail-closed 返回 503。迁移只增不删，旧代码碰上新表结构照常运行
  if (dryRun) console.log(`deploy：--dry-run 不迁移 D1（迁移目录 ${migrationsDir}，${readdirSync(migrationsDir).length} 个文件）`);
  else wrangler(['d1', 'migrations', 'apply', 'DB', '--remote']);
}
const inject = isPlatform
  ? ['--domain', host]
  : ['--route', `${host}/games/${id}`, '--route', `${host}/games/${id}/*`];
wrangler(['deploy', '--no-bundle', ...(dryRun ? ['--dry-run'] : []), ...inject, '--var', `SITE_ORIGIN:https://${host}`]);
