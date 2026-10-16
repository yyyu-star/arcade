/**
 * 生成正式部署用的 wrangler 配置：照抄 wrangler.jsonc，只给绑定 DB 的 D1 填上正式库的 id。
 *
 *   D1_DATABASE_ID=<id> node tools/deploy-config.ts   → 写出 wrangler.deploy.json（不进 Git），迁移和部署都用 -c 指向它
 *
 * 为什么要这一步：仓库公开，wrangler.jsonc 里不写正式库的 id（一键部署时 Cloudflare 自动建库）；
 * 而 wrangler 碰到没有 id 的 D1 会自己新建一个库——正式部署绝不能这样，所以 id 为空或不像 id 就直接失败，不写文件。
 * 输出放在本目录：wrangler 按配置文件所在目录解析 main、assets、migrations_dir 这些相对路径。
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'wrangler.jsonc';
const OUT = 'wrangler.deploy.json';

function fail(msg: string): never {
  console.error(`deploy-config：${msg}`);
  process.exit(1);
}

/** 去掉 JSONC 的 // 和 块注释，字符串里的不动 */
function stripJsonComments(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      const start = i;
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === '\\') i++;
      out += text.slice(start, i + 1);
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end < 0) fail(`${SRC} 里有没闭合的注释`);
      i = end + 1;
    } else {
      out += c;
    }
  }
  return out;
}

const id = (process.env.D1_DATABASE_ID ?? '').trim();
if (!id) fail('D1_DATABASE_ID 没设：不能部署（没有 id 时 wrangler 会新建一个空库）');
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) fail('D1_DATABASE_ID 不像 D1 的 id（应是 UUID）');

const config = JSON.parse(stripJsonComments(readFileSync(SRC, 'utf8'))) as { d1_databases?: { binding?: string; database_id?: string }[] };
const dbs = (config.d1_databases ?? []).filter((d) => d.binding === 'DB');
if (dbs.length !== 1) fail(`${SRC} 里绑定名 DB 的 D1 应该正好一个，现在是 ${dbs.length} 个`);
dbs[0]!.database_id = id;
writeFileSync(OUT, `${JSON.stringify(config, null, 2)}\n`);
console.log(`deploy-config：已写出 ${OUT}（D1 绑定 DB 指向正式库）`);
