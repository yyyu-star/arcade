#!/usr/bin/env node
/**
 * 构建作业的最后一步：把 `wrangler deploy --dry-run --outdir <产物>/worker` 打好的 Worker 旁边，再放上静态资源目录，
 * 一起作为 artifact 交给部署作业。
 *
 * 构建作业跑的是合并进来的模块代码，拿不到任何凭证；它产出的东西部署作业一律当不可信数据重新检查（deploy.mjs），
 * 所以这里不做把关，只负责按约定的目录摆好：
 *   <产物>/worker/<入口名>.js   wrangler 打包好的 Worker（入口名 = 配置里 main 的文件名换成 .js）
 *   <产物>/assets/              配置里 assets.directory 指的目录
 * 部署用的配置不从这里拿：部署作业直接读 main 上这次提交里的 wrangler.jsonc（审过的那份），构建怎么改配置都影响不到部署。
 *
 * 用法（在模块目录里，npm ci 和构建之后）：node <仓库>/tools/deployer/pack.mjs <产物目录>
 * 读配置用的是模块自己装的 wrangler（这一步本来就在不可信的作业里，不需要钉死版本）。
 */
import { cpSync, existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const out = process.argv[2];
if (!out) {
  console.error('用法：node tools/deployer/pack.mjs <产物目录>（在模块目录里执行）');
  process.exit(1);
}
const require = createRequire(join(process.cwd(), 'package.json'));
const { experimental_readRawConfig } = require('wrangler');
const { rawConfig } = experimental_readRawConfig({ config: 'wrangler.jsonc' });

if (!existsSync(join(out, 'worker'))) {
  console.error(`pack：${out}/worker 不存在，先跑 wrangler deploy --dry-run --outdir ${out}/worker`);
  process.exit(1);
}
const assets = rawConfig.assets?.directory;
if (assets) {
  const src = resolve(assets);
  if (!existsSync(src) || !statSync(src).isDirectory()) {
    console.error(`pack：静态资源目录 ${assets} 不存在，构建没跑？`);
    process.exit(1);
  }
  cpSync(src, join(out, 'assets'), { recursive: true });
}
console.log(`pack：产物已摆好在 ${out}（worker/${assets ? '、assets/' : ''}）`);
