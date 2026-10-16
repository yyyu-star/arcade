/**
 * 一条命令起本地联机栈：先 npm run build:cf，再用 wrangler dev 同时跑掼蛋 Worker（含房间 Durable Object、静态资源）和假平台
 * （tools/fake-platform，名字 arcade，服务绑定 ARCADE 连到它，按 cookie __Host-sid=<userId> 认人）。
 *
 *   node tools/online-dev.ts                 端口由系统分配
 *   node tools/online-dev.ts --port 0 --no-build
 *   npm run online-dev
 *
 * 浏览器里先设 cookie 再打开页面：document.cookie = '__Host-sid=u1; Secure; Path=/'（每个标签页/浏览器配置用不同的 id 就是不同的人）。
 * 冒烟脚本里 import { startOnlineStack } from './online-dev.ts'，拿到 origin 后给浏览器上下文加 cookie __Host-sid=<id>。
 *
 * 几个要点：
 * - --local-upstream 指回本地端口，请求的 Host、Origin 保持本地地址（配置里有路由时 wrangler dev 会改写成路由的域名），
 *   和 --var SITE_ORIGIN 对得上（不然开房 403）。所以端口要先定下来（系统分配一个空闲端口再交给 wrangler）；
 * - GATE=off（首页不问平台），ONLINE=on；房间状态存在系统临时目录里，每次启动都是新的，停的时候删掉；
 * - 已知：进一个不存在的房间码时，房间接受连接后马上 4004 关掉，这个关闭帧经 wrangler dev 的本地代理到不了浏览器（只看到 open，
 *   之后没有消息）；在 Worker 里就拒掉的（码格式不对 4004、没登录 4401、别的网站 4403）能收到。vitest 里（tests/room）直连 workerd 能收到。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

interface Proc {
  argv: string[];
  pid: number;
  kill(pid: number, signal?: string): boolean;
  on(event: 'SIGINT' | 'SIGTERM', cb: () => void): void;
  exit(code?: number): never;
}
const proc = (globalThis as unknown as { process: Proc }).process;

/** 模块目录（tools/ 的上一级） */
const MODULE_DIR = fileURLToPath(new URL('..', import.meta.url));

export interface OnlineStackOptions {
  /** 端口；0 或不给由系统分配 */
  port?: number;
  /** 先跑 npm run build:cf（默认 true）；产物已经是新的可以跳过 */
  build?: boolean;
  /** wrangler 的输出（默认丢掉；出错时会带在异常里） */
  log?: (line: string) => void;
  /** 等 wrangler 起来的最长时间（默认 90 秒） */
  readyTimeoutMs?: number;
  /** 另加的环境变量（--var 名:值），比如额度冒烟把 KIT_QUOTA 调得很紧 */
  vars?: Record<string, string>;
}

export interface OnlineStack {
  /** 本机地址，例如 http://127.0.0.1:43123（页面在 origin + /games/guandan/?online=1） */
  origin: string;
  stop(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const srv = createServer();
    srv.once('error', fail);
    srv.listen(0, '127.0.0.1', () => {
      const a = srv.address();
      const port = typeof a === 'object' && a ? a.port : 0;
      srv.close(() => (port ? ok(port) : fail(new Error('拿不到空闲端口'))));
    });
  });
}

function run(cmd: string, args: string[], log?: (s: string) => void): Promise<void> {
  return new Promise((ok, fail) => {
    const child = spawn(cmd, args, { cwd: MODULE_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const take = (c: { toString(): string }) => {
      out += c.toString();
      log?.(c.toString());
    };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);
    child.once('error', fail);
    child.once('exit', (code) => (code === 0 ? ok() : fail(new Error(`${cmd} ${args.join(' ')} 退出码 ${code}\n${out.slice(-2000)}`))));
  });
}

/** 结束 wrangler 和它起的 workerd：detached 起的，整个进程组一起发 SIGTERM，5 秒不走再 SIGKILL */
async function killGroup(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null) return;
  const gone = new Promise<void>((ok) => child.once('exit', () => ok()));
  try {
    proc.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
  const timer = new Promise<'late'>((ok) => setTimeout(() => ok('late'), 5_000));
  if ((await Promise.race([gone, timer])) === 'late') {
    try {
      proc.kill(-child.pid, 'SIGKILL');
    } catch {
      // 已经没了
    }
  }
}

export async function startOnlineStack(opts: OnlineStackOptions = {}): Promise<OnlineStack> {
  if (opts.build !== false) await run('npm', ['run', 'build:cf'], opts.log);
  const port = opts.port || (await freePort());
  const origin = `http://127.0.0.1:${port}`;
  const state = mkdtempSync(join(tmpdir(), 'guandan-online-'));
  const args = [
    'dev',
    '-c', 'wrangler.jsonc',
    '-c', 'tools/fake-platform/wrangler.jsonc',
    '--ip', '127.0.0.1',
    '--port', String(port),
    '--local-upstream', `127.0.0.1:${port}`,
    '--upstream-protocol', 'http',
    '--var', `SITE_ORIGIN:${origin}`,
    '--var', 'GATE:off',
    '--var', 'ONLINE:on',
    ...Object.entries(opts.vars ?? {}).flatMap(([k, v]) => ['--var', `${k}:${v}`]),
    '--persist-to', state,
    '--show-interactive-dev-session=false',
  ];
  const child = spawn(join(MODULE_DIR, 'node_modules', '.bin', 'wrangler'), args, {
    cwd: MODULE_DIR,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
    env: { ...(globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env, WRANGLER_SEND_METRICS: 'false' },
  });
  let out = '';
  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await killGroup(child);
    rmSync(state, { recursive: true, force: true });
  };
  try {
    await new Promise<void>((ok, fail) => {
      const timer = setTimeout(() => fail(new Error(`wrangler dev ${opts.readyTimeoutMs ?? 90_000} 毫秒没起来`)), opts.readyTimeoutMs ?? 90_000);
      const take = (c: { toString(): string }) => {
        const s = c.toString();
        out += s;
        opts.log?.(s);
        if (out.includes('Ready on')) {
          clearTimeout(timer);
          ok();
        }
      };
      child.stdout?.on('data', take);
      child.stderr?.on('data', take);
      child.once('error', fail);
      child.once('exit', (code) => fail(new Error(`wrangler dev 退出了（${code}）`)));
    });
    // 起来以后实际问一下：页面能打开、没登录开房回 401（说明房间路由和假平台都接上了）
    const page = await fetch(`${origin}/games/guandan/?online=1`);
    if (page.status !== 200) throw new Error(`页面 ${page.status}`);
    const anon = await fetch(`${origin}/games/guandan/room/rooms`, { method: 'POST', headers: { origin } });
    if (anon.status !== 401) throw new Error(`没登录开房应当 401，实际 ${anon.status}`);
  } catch (e) {
    await stop();
    throw new Error(`${e instanceof Error ? e.message : String(e)}\n--- wrangler 输出（最后 3000 字）---\n${out.slice(-3000)}`);
  }
  return { origin, stop };
}

function arg(name: string): string | undefined {
  const i = proc.argv.indexOf(`--${name}`);
  return i >= 0 ? proc.argv[i + 1] : undefined;
}

if (proc.argv[1] && fileURLToPath(import.meta.url) === proc.argv[1]) {
  const stack = await startOnlineStack({ port: Number(arg('port') ?? 0), build: !proc.argv.includes('--no-build') });
  const { origin } = stack;
  console.log(
    [
      `本地联机栈起来了：${origin}`,
      `  页面：${origin}/games/guandan/?online=1`,
      `  开房：POST ${origin}/games/guandan/room/rooms（Origin 要是 ${origin}，带 cookie __Host-sid=<userId>）`,
      `  认人：浏览器控制台里 document.cookie = '__Host-sid=u1; Secure; Path=/'（不同的人用不同的 id；__Host-sid=down 模拟平台不可用）`,
      `  例：curl -X POST -H 'origin: ${origin}' -H 'cookie: __Host-sid=u1' ${origin}/games/guandan/room/rooms`,
      'Ctrl-C 结束（会关掉 wrangler 和 workerd、删掉临时房间数据）',
    ].join('\n'),
  );
  let quitting = false;
  const quit = () => {
    if (quitting) return;
    quitting = true;
    void stack.stop().then(() => proc.exit(0));
  };
  proc.on('SIGINT', quit);
  proc.on('SIGTERM', quit);
}
