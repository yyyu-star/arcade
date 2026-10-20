/**
 * 测试用：生成发布目录、起真的 workerd（本包钉死版本的二进制）、停掉重起。临时目录在 os.tmpdir() 下，测完删掉。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, type GenerateOptions } from '../src/gen/generate.ts';
import type { Site } from '../src/gen/site.ts';
import workerdPath from 'workerd';

export const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), 'fixture');
/** workerd 的真二进制（workerd 包的默认导出是按平台装好的那个文件；不经 node 包装，停进程时停的就是它） */
export const workerdBin = (): string => workerdPath;

export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

export interface Running {
  base: string;
  admin: string;
  dir: string;
  data: string;
  log: () => string;
  stop(): Promise<void>;
  restart(): Promise<void>;
  cleanup(): Promise<void>;
}

export async function startSite(site: Site, opts: Omit<GenerateOptions, 'out' | 'listen' | 'adminListen'> = {}, env: Record<string, string> = {}): Promise<Running> {
  const dir = mkdtempSync(join(tmpdir(), 'arcade-host-test-'));
  const out = join(dir, 'release');
  const data = join(dir, 'data');
  const [port, adminPort] = [await freePort(), await freePort()];
  mkdirSync(data);
  generate(site, { ...opts, out, listen: `127.0.0.1:${port}`, adminListen: `127.0.0.1:${adminPort}` });
  const base = `http://127.0.0.1:${port}`;
  let child: ChildProcess | null = null;
  let logs = '';
  const start = async () => {
    const args = ['serve', 'config.capnp'];
    if ((opts.storage ?? 'sqlite') === 'sqlite') args.push('--directory-path', `data=${data}`);
    child = spawn(workerdBin(), args, { cwd: out, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout!.on('data', (d) => (logs += d));
    child.stderr!.on('data', (d) => (logs += d));
    const deadline = Date.now() + 10_000;
    for (;;) {
      try {
        if ((await fetch(`${base}/__health`)).ok) return;
      } catch {
        // 还没起来
      }
      if (child.exitCode !== null) throw new Error(`workerd 起不来：\n${logs}`);
      if (Date.now() > deadline) throw new Error(`workerd 10 秒没起来：\n${logs}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const stop = async () => {
    const c = child;
    if (!c || c.exitCode !== null) return;
    await new Promise<void>((resolve) => {
      c.once('exit', () => resolve());
      c.kill('SIGTERM');
    });
    child = null;
  };
  await start();
  return {
    base,
    admin: `http://127.0.0.1:${adminPort}`,
    dir: out,
    data,
    log: () => logs,
    stop,
    restart: async () => {
      await stop();
      await start();
    },
    cleanup: async () => {
      await stop();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** 测试站点：probe（DO、D1、变量、Secret、RPC、定时任务）挂 /games/probe，home（静态资源 + 兜底的 Worker）兜底 */
export function fixtureSite(): Site {
  return {
    fallback: 'home',
    workers: [
      {
        name: 'probe',
        main: join(FIXTURE, 'worker.js'),
        compatibility_date: '2026-10-01',
        vars: { TEXT: 'plain', OBJ: { a: 1, nested: { b: [1, 2] } }, CN: '中文变量' },
        secrets: ['PROBE_SECRET'],
        services: [
          { binding: 'SELF_RPC', service: 'probe', entrypoint: 'Hello', props: { game: 'probe' } },
          { binding: 'SELF_DEFAULT', service: 'probe' },
        ],
        durable_objects: [{ name: 'PROBE', class_name: 'Probe' }],
        d1_databases: [{ binding: 'DB', database_name: 'probe', migrations_dir: join(FIXTURE, 'migrations') }],
        crons: ['17 19 * * *'],
        routes: ['/games/probe', '/games/probe/*'],
      },
      {
        name: 'home',
        main: join(FIXTURE, 'home.js'),
        compatibility_date: '2026-10-01',
        assets: { directory: join(FIXTURE, 'assets'), binding: 'ASSETS', not_found_handling: 'none' },
        crons: ['* * * * *'],
      },
    ],
  };
}
