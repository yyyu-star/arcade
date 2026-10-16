/**
 * 部署配置的读取和白名单检查：PR 上的快速检查（tools/check-deploy-config.mjs）和部署前的严格检查（deploy.mjs）共用。
 *
 * 为什么要钉死 wrangler 的解析器：自己写的 JSONC 解析和 wrangler 用的 jsonc-parser 在边角上不一致（单独的 \r 也能结束 // 注释、
 * 嵌套的 "__proto__" 会被 jsonc-parser 当成原型而不是普通的键），检查看到的和真正部署的就不是同一份东西。这里一律用
 * tools/deployer 里钉死版本的 wrangler 自己的 experimental_readRawConfig 读，再额外拒掉这两类写法，让两边没有歧义。
 *
 * 白名单的思路：只放行本仓库现在真用到的字段和绑定，每种绑定逐键列出；别的（KV、R2、队列、tail_consumers、limits、
 * observability 的 destinations、DO 迁移里的 transferred/deleted/renamed_classes……）一律拒绝，真需要时由维护者放宽这里。
 * vars 名（按模块）、compatibility_flags 和全局拒绝的 vars 名单独放在 tools/deploy-allowlist.json，同样由维护者改。
 */
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { experimental_readRawConfig, unstable_readConfig } from 'wrangler';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKERS_FILE = join(REPO_ROOT, 'tools', 'workers.json');
/** vars 名、兼容开关的白名单和全局拒绝的 vars 名（维护者管） */
const ALLOWLIST_FILE = join(REPO_ROOT, 'tools', 'deploy-allowlist.json');

/** 平台 Worker 公开的 RPC 入口（platform/worker 里 extends WorkerEntrypoint 的类）。新增入口时由维护者加进来 */
export const KNOWN_ENTRYPOINTS = new Set(['WalletService']);

/** 所有模块都可以用的顶层字段 */
const COMMON_KEYS = new Set([
  '$schema', 'name', 'main', 'compatibility_date', 'compatibility_flags', 'workers_dev', 'preview_urls',
  'assets', 'observability', 'vars', 'services', 'durable_objects', 'migrations', 'placement',
]);
/** 只有平台可以多用的字段：账号数据的 D1、每天的定时任务 */
const PLATFORM_KEYS = new Set(['d1_databases', 'triggers']);
/** 一看就知道不该出现的字段，给出具体原因（其余不认识的字段统一报"不在白名单"） */
const WHY_NOT = {
  routes: '路由由部署流程按 SITE_HOST 注入', route: '路由由部署流程按 SITE_HOST 注入',
  account_id: '账户由部署凭证决定', env: '每个模块只有一个正式 Worker，不用 wrangler 环境',
  limits: '不许改 CPU、子请求上限', tail_consumers: '不许把日志转给别的 Worker', logpush: '不许推日志',
  no_bundle: '打包方式由部署流程决定', find_additional_modules: '只上传部署流程认可的打包产物',
  rules: '只上传部署流程认可的打包产物', base_dir: '只上传部署流程认可的打包产物',
  upload_source_maps: 'source map 不上传（由部署流程关掉）',
};
/**
 * 部署流程写进最终配置、并要求 wrangler 读回来正好是这些值的打包开关（源配置里不许写，见 WHY_NOT）：
 *   no_bundle：产物已经由构建作业打好，原样上传；
 *   find_additional_modules：wrangler 4.151 在 --no-bundle 时这一项没写就默认打开（noBundleWorker 的默认参数），
 *     会把入口所在目录里按规则匹配到的 .js/.mjs/.wasm/.txt/.html/.sql 等文件全部当作附加模块上传；
 *   upload_source_maps：打开时 wrangler 会按入口末尾的 sourceMappingURL 去读文件一起上传，这个路径由不可信的构建作业决定。
 */
export const FINAL_BUNDLE_FLAGS = Object.freeze({ no_bundle: true, find_additional_modules: false, upload_source_maps: false });
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BINDING = /^[A-Z][A-Z0-9_]*$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function allowedWorkers() {
  return JSON.parse(readFileSync(WORKERS_FILE, 'utf8')).workers;
}

function allowlist() {
  return JSON.parse(readFileSync(ALLOWLIST_FILE, 'utf8'));
}

/** 模块路径（相对仓库根）→ { mod, id, isPlatform }；不是可部署的模块就抛错 */
export function moduleInfo(mod) {
  const m = mod.replace(/\/+$/, '');
  if (m === 'platform') return { mod: m, id: 'arcade', isPlatform: true };
  const g = /^games\/([a-z][a-z0-9-]*)$/.exec(m);
  if (g) return { mod: m, id: g[1], isPlatform: false };
  throw new Error(`${mod} 不是可部署的模块（只认 platform 和 games/<id>）`);
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * 用钉死的 wrangler 读一份配置（.json 或 .jsonc），读之前先拒掉会让解析器之间出分歧的写法。
 * 返回 { raw, errors }：errors 非空时 raw 不可信，不要再往下用。
 */
export function readConfigStrict(file, label = file) {
  const errors = [];
  const bad = (msg) => errors.push(`${label}：${msg}`);
  if (!/\.jsonc?$/.test(file)) return { raw: null, errors: [`${label}：只认 .json / .jsonc（wrangler 碰到别的扩展名会当成空配置）`] };
  let st;
  try {
    st = lstatSync(file);
  } catch {
    return { raw: null, errors: [`${label}：文件不存在`] };
  }
  if (!st.isFile()) return { raw: null, errors: [`${label}：必须是普通文件（不能是符号链接或目录）`] };
  const text = readFileSync(file, 'utf8');
  // \r、U+2028/2029 之类的换行符在不同解析器里结束注释的规则不同；只许 \n 和 \t 这两个控制字符
  if (/[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029\ufeff]/.test(text)) bad('只许用 \\n 换行（不能有 \\r、U+2028/2029、BOM 或别的控制字符）');
  if (/__proto__|\\u/.test(text)) bad('不许出现 "__proto__" 和 \\u 转义（会被解析成原型或绕过键名检查）');
  if (errors.length) return { raw: null, errors };
  let raw;
  try {
    raw = experimental_readRawConfig({ config: file }).rawConfig;
  } catch (e) {
    return { raw: null, errors: [`${label}：wrangler 解析不了：${e.message}`] };
  }
  if (!isPlainObject(raw)) return { raw: null, errors: [`${label}：顶层必须是对象`] };
  // 任何层级：对象的原型必须是普通对象，键名不能是 __proto__ / constructor / prototype
  const walk = (v, path) => {
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, `${path}[${i}]`));
    if (v === null || typeof v !== 'object') return;
    if (Object.getPrototypeOf(v) !== Object.prototype) bad(`${path} 的原型被改过（"__proto__" 之类的键）`);
    for (const k of Object.keys(v)) {
      if (DANGEROUS_KEYS.has(k)) bad(`${path} 里不许有键 ${k}`);
      walk(v[k], `${path}.${k}`);
    }
  };
  walk(raw, '配置');
  return { raw: errors.length ? null : raw, errors };
}

/**
 * 按白名单检查一份已读出的配置。
 *   stage = 'source'：仓库里模块根目录的 wrangler.jsonc；路径相对 baseDir（模块目录）解析，必须留在模块里；
 *   stage = 'final' ：部署流程生成的最终配置；main、assets.directory、migrations_dir 必须正好等于 expect 里给的绝对路径，
 *                     D1 必须带上正式库的 id。
 */
export function checkConfig(c, { mod, id, isPlatform, stage, baseDir, label, expect = {} }) {
  const errors = [];
  const bad = (msg) => errors.push(`${label}：${msg}`);
  const insideBase = (p) => {
    if (typeof p !== 'string' || !p) return false;
    const abs = resolve(baseDir, p);
    return abs === baseDir || abs.startsWith(baseDir + sep);
  };
  const onlyKeys = (obj, allowed, where) => {
    if (!isPlainObject(obj)) return bad(`${where} 必须是对象`), false;
    for (const k of Object.keys(obj)) if (!allowed.includes(k)) bad(`${where} 里不许有 ${k}（只许 ${allowed.join('、')}）`);
    return true;
  };

  // —— 顶层字段 ——
  for (const key of Object.keys(c)) {
    if (COMMON_KEYS.has(key) || (isPlatform && PLATFORM_KEYS.has(key))) continue;
    if (stage === 'final' && key in FINAL_BUNDLE_FLAGS) continue;
    if (key === '$schema' && stage === 'final') continue;
    bad(`不许用 ${key}（${WHY_NOT[key] ?? '不在 tools/deployer/lib.mjs 的白名单里；确实需要时由维护者放宽'}）`);
  }
  if (stage === 'final' && '$schema' in c) bad('最终配置里不该有 $schema');
  if (stage === 'final') {
    for (const [k, v] of Object.entries(FINAL_BUNDLE_FLAGS)) if (c[k] !== v) bad(`${k} 必须是 ${v}，现在是 ${JSON.stringify(c[k])}`);
  }
  const allow = allowlist();

  if (c.name !== id) bad(`name 必须是 "${id}"（模块 id），现在是 ${JSON.stringify(c.name)}`);
  if (!allowedWorkers().includes(id)) bad(`Worker "${id}" 不在 tools/workers.json 的名单里：新 Worker 由维护者确认账户里没有同名的之后再加`);
  if (c.workers_dev !== false) bad('workers_dev 必须写成 false（只经站点的域名访问）');
  if (c.preview_urls !== false) bad('preview_urls 必须写成 false（预览地址绕过网关）');
  if (typeof c.compatibility_date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(c.compatibility_date)) bad('compatibility_date 必须是 YYYY-MM-DD');
  // 兼容开关会改变运行时的行为（比如 nodejs_compat 打开 Node API），只许名单里的
  if ('compatibility_flags' in c) {
    if (!Array.isArray(c.compatibility_flags)) bad('compatibility_flags 必须是数组');
    else for (const f of c.compatibility_flags) {
      if (!allow.compatibility_flags.includes(f)) {
        bad(`compatibility_flags 里的 ${JSON.stringify(f)} 不在 tools/deploy-allowlist.json 的名单里（现在只许 ${allow.compatibility_flags.join('、') || '不写'}；新增由维护者加）`);
      }
    }
  }
  if ('$schema' in c && typeof c.$schema !== 'string') bad('$schema 必须是字符串');

  // —— main：入口必须在模块（最终配置：打包产物）里 ——
  if (stage === 'source') {
    if (!insideBase(c.main)) bad(`main 必须是模块目录里的相对路径，现在是 ${JSON.stringify(c.main)}`);
  } else if (c.main !== expect.main) bad(`main 必须是打包产物 ${expect.main}，现在是 ${JSON.stringify(c.main)}`);

  // —— 静态资源 ——
  if ('assets' in c && onlyKeys(c.assets, ['directory', 'binding', 'not_found_handling', 'html_handling', 'run_worker_first'], 'assets')) {
    const a = c.assets;
    if (stage === 'source') {
      if (!insideBase(a.directory) || resolve(baseDir, a.directory) === baseDir) bad(`assets.directory 必须是模块目录里的子目录，现在是 ${JSON.stringify(a.directory)}`);
    } else if (a.directory !== expect.assets) bad(`assets.directory 必须是 ${expect.assets}，现在是 ${JSON.stringify(a.directory)}`);
    if ('binding' in a && !(typeof a.binding === 'string' && BINDING.test(a.binding))) bad('assets.binding 必须是大写标识符');
    if ('not_found_handling' in a && !['none', 'single-page-application', '404-page'].includes(a.not_found_handling)) bad('assets.not_found_handling 取值不对');
    if ('html_handling' in a && !['auto-trailing-slash', 'force-trailing-slash', 'drop-trailing-slash', 'none'].includes(a.html_handling)) bad('assets.html_handling 取值不对');
    if ('run_worker_first' in a && !(typeof a.run_worker_first === 'boolean' || (Array.isArray(a.run_worker_first) && a.run_worker_first.every((r) => typeof r === 'string')))) {
      bad('assets.run_worker_first 必须是布尔或字符串数组');
    }
  } else if (stage === 'final' && expect.assets && !('assets' in c)) bad('最终配置缺 assets');

  // —— 日志：只许开关和采样率，不许 destinations（会把日志发到别处） ——
  if ('observability' in c && onlyKeys(c.observability, ['enabled', 'head_sampling_rate', 'logs', 'traces'], 'observability')) {
    const o = c.observability;
    if ('enabled' in o && typeof o.enabled !== 'boolean') bad('observability.enabled 必须是布尔');
    for (const sub of ['logs', 'traces']) {
      if (sub in o && onlyKeys(o[sub], ['enabled', 'head_sampling_rate', 'invocation_logs'], `observability.${sub}`)) {
        for (const [k, v] of Object.entries(o[sub])) {
          if (k === 'head_sampling_rate' ? typeof v !== 'number' : k !== 'destinations' && typeof v !== 'boolean') bad(`observability.${sub}.${k} 类型不对`);
        }
      }
    }
    if ('head_sampling_rate' in o && typeof o.head_sampling_rate !== 'number') bad('observability.head_sampling_rate 必须是数字');
  }

  // —— 环境变量：只许名单里的名字，值是普通的 JSON 值。平台的 Secret 名和 SITE_ORIGIN 任何模块都不许写：
  //    vars 和 Secret 同名时会互相覆盖（比如写一个 ADMIN_TOKEN 把正式的令牌换成已知值），SITE_ORIGIN 只由部署流程注入 ——
  if ('vars' in c && isPlainObject(c.vars)) {
    const names = Object.hasOwn(allow.vars, id) ? allow.vars[id] : [];
    for (const [k, v] of Object.entries(c.vars)) {
      if (k === 'SITE_ORIGIN') bad('vars 里不许写 SITE_ORIGIN：正式站的地址由部署流程注入');
      else if (allow.forbiddenVars.includes(k)) bad(`vars 里不许写 ${k}：它是平台的 Secret 名，同名的 vars 会顶替 Secret`);
      else if (!names.includes(k)) bad(`vars.${k} 不在 tools/deploy-allowlist.json 里 ${id} 的名单（现在只许 ${names.join('、') || '没有'}；新增由维护者加）`);
      if (!['string', 'number', 'boolean'].includes(typeof v) && !isPlainObject(v)) bad(`vars.${k} 只许字符串、数字、布尔或对象`);
    }
  } else if ('vars' in c) bad('vars 必须是对象');

  // —— 服务绑定：只许指向平台 arcade；钱包只能以自己的身份记账 ——
  if ('services' in c) {
    if (isPlatform) bad('平台不许有服务绑定');
    else if (!Array.isArray(c.services)) bad('services 必须是数组');
    else for (const [i, s] of c.services.entries()) {
      const where = `services[${i}]`;
      if (!onlyKeys(s, ['binding', 'service', 'entrypoint', 'props'], where)) continue;
      if (!(typeof s.binding === 'string' && BINDING.test(s.binding))) bad(`${where}.binding 必须是大写标识符`);
      if (s.service !== 'arcade') bad(`${where}（${s.binding}）只能指向平台 arcade，现在指向 ${JSON.stringify(s.service)}`);
      if ('entrypoint' in s && !KNOWN_ENTRYPOINTS.has(s.entrypoint)) bad(`${where}.entrypoint 只许 ${[...KNOWN_ENTRYPOINTS].join('、')}，现在是 ${JSON.stringify(s.entrypoint)}`);
      if ('props' in s && onlyKeys(s.props, ['game'], `${where}.props`) && s.props.game !== id) bad(`${where}.props.game 必须是 "${id}"（不能冒充别的游戏）`);
      if (s.entrypoint === 'WalletService' && s.props?.game !== id) bad(`${where}：钱包绑定必须带 props.game = "${id}"`);
    }
  }

  // —— Durable Object：只许本 Worker 自己的类 ——
  if ('durable_objects' in c && onlyKeys(c.durable_objects, ['bindings'], 'durable_objects')) {
    const list = c.durable_objects.bindings;
    if (!Array.isArray(list)) bad('durable_objects.bindings 必须是数组');
    else for (const [i, d] of list.entries()) {
      if (!onlyKeys(d, ['name', 'class_name'], `durable_objects.bindings[${i}]`)) continue;
      if (!(typeof d.name === 'string' && BINDING.test(d.name))) bad(`durable_objects.bindings[${i}].name 必须是大写标识符`);
      if (!(typeof d.class_name === 'string' && IDENT.test(d.class_name))) bad(`durable_objects.bindings[${i}].class_name 必须是标识符`);
    }
  }

  // —— DO 迁移：只许新建类。transferred_classes 能把别的 Worker 的 DO 连数据搬过来，deleted/renamed 会清掉或改掉数据 ——
  if ('migrations' in c) {
    if (!Array.isArray(c.migrations)) bad('migrations 必须是数组');
    else for (const [i, m] of c.migrations.entries()) {
      if (!onlyKeys(m, ['tag', 'new_classes', 'new_sqlite_classes'], `migrations[${i}]`)) continue;
      if (typeof m.tag !== 'string' || !m.tag) bad(`migrations[${i}].tag 必须是非空字符串`);
      for (const k of ['new_classes', 'new_sqlite_classes']) {
        if (k in m && !(Array.isArray(m[k]) && m[k].every((x) => typeof x === 'string' && IDENT.test(x)))) bad(`migrations[${i}].${k} 必须是类名数组`);
      }
    }
  }

  if ('placement' in c && onlyKeys(c.placement, ['mode'], 'placement') && !['smart', 'off'].includes(c.placement.mode)) bad('placement.mode 只许 smart 或 off');

  // —— 平台：一个 D1、一个定时任务 ——
  if ('d1_databases' in c) {
    const dbs = c.d1_databases;
    const keys = stage === 'final' ? ['binding', 'database_name', 'database_id', 'migrations_dir'] : ['binding', 'database_name', 'migrations_dir'];
    if (!Array.isArray(dbs) || dbs.length !== 1) bad('平台只许有一个 D1');
    else if (onlyKeys(dbs[0], keys, 'd1_databases[0]')) {
      const d = dbs[0];
      if (d.binding !== 'DB' || d.database_name !== 'arcade') bad('D1 只许绑定 DB、库名 arcade');
      if (stage === 'source') {
        if ('database_id' in d) bad('不许写 database_id：正式库的 id 由部署流程注入');
        if (!insideBase(d.migrations_dir ?? 'migrations')) bad('d1_databases[0].migrations_dir 必须在模块目录里');
      } else {
        if (!UUID.test(d.database_id ?? '')) bad('最终配置的 D1 必须带正式库的 id（UUID）');
        if (d.migrations_dir !== expect.migrations) bad(`d1_databases[0].migrations_dir 必须是 ${expect.migrations}`);
      }
    }
  }
  if ('triggers' in c && onlyKeys(c.triggers, ['crons'], 'triggers')) {
    if (!(Array.isArray(c.triggers.crons) && c.triggers.crons.every((x) => typeof x === 'string'))) bad('triggers.crons 必须是字符串数组');
  }
  return errors;
}

/**
 * 最终配置再过一遍 wrangler 自己的规范化（unstable_readConfig），确认 wrangler 眼里的配置和白名单看到的一致：
 * 没有被重定向、没有路由、只有放行的那几类绑定。
 */
export function checkNormalized(file, { id, isPlatform, label }) {
  const errors = [];
  const bad = (msg) => errors.push(`${label}（wrangler 规范化后）：${msg}`);
  let n;
  try {
    n = unstable_readConfig({ config: file }, { hideWarnings: true });
  } catch (e) {
    return [`${label}：wrangler 读不通：${e.message}`];
  }
  if (n.name !== id) bad(`name 是 ${JSON.stringify(n.name)}`);
  if (n.configPath !== file) bad(`wrangler 读的是 ${n.configPath}，不是 ${file}`);
  for (const [k, v] of Object.entries(FINAL_BUNDLE_FLAGS)) if (n[k] !== v) bad(`${k} 是 ${JSON.stringify(n[k])}，必须是 ${v}`);
  if (n.route || n.routes?.length) bad('不该有路由');
  if (n.workers_dev !== false || n.preview_urls !== false) bad('workers_dev / preview_urls 必须是 false');
  if (n.durable_objects?.bindings?.some((d) => d.script_name || d.environment)) bad('Durable Object 指向了别的 Worker');
  if (n.services?.some((s) => s.service !== 'arcade' || s.environment)) bad('服务绑定指向了别的 Worker');
  if (n.migrations?.some((m) => m.renamed_classes?.length || m.deleted_classes?.length || m.transferred_classes?.length)) bad('DO 迁移里有改名、删除或转移');
  if (n.tail_consumers?.length || n.streaming_tail_consumers?.length || n.logpush) bad('不许转发日志');
  if (n.observability?.destinations?.length || n.observability?.logs?.destinations?.length || n.observability?.traces?.destinations?.length) bad('不许把日志发到别处');
  // 不该出现的绑定类型：规范化后它们都是空数组/空对象
  const allowedArrays = new Set(['services', 'migrations', 'compatibility_flags', ...(isPlatform ? ['d1_databases'] : [])]);
  for (const [k, v] of Object.entries(n)) {
    if (Array.isArray(v) && v.length && !allowedArrays.has(k) && !['routes'].includes(k)) bad(`${k} 不该有内容`);
  }
  if (!isPlatform && n.d1_databases?.length) bad('游戏不许绑 D1');
  return errors;
}

/** 模块根目录的 wrangler.jsonc：读 + 白名单（PR 检查和部署共用） */
export function checkSourceConfig(file, info) {
  const label = `${info.mod}/wrangler.jsonc`;
  const { raw, errors } = readConfigStrict(file, label);
  if (!raw) return { raw: null, errors };
  return { raw, errors: checkConfig(raw, { ...info, stage: 'source', baseDir: dirname(resolve(file)), label }) };
}

