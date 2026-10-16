// 数据管线用到的最小 Node 声明（项目未安装 @types/node，见 tools/node-env.d.ts 和 tools/art/node-art.d.ts）。
// 与 node-art.d.ts 里同名模块的声明会合并；这里只补管线额外需要的函数。
declare module 'node:fs' {
  export interface ReadStreamLike {
    on(ev: string, cb: (...args: unknown[]) => void): ReadStreamLike;
  }
  export function createReadStream(path: string, opts?: { highWaterMark?: number }): ReadStreamLike;
  export function openSync(path: string, flags: string): number;
  export function writeSync(fd: number, data: string): number;
  export function closeSync(fd: number): void;
  export function statSync(path: string): { size: number; mtimeMs: number };
}
declare module 'node:readline' {
  export function createInterface(opts: { input: unknown; crlfDelay?: number }): AsyncIterable<string> & { close(): void };
}
declare module 'node:zlib' {
  export function gzipSync(data: string | Uint8Array, opts?: { level?: number }): Uint8Array;
}
declare module 'node:child_process' {
  export function spawnSync(cmd: string, args: string[], opts?: { stdio?: string }): { status: number | null };
}

// common.ts 算原始数据的默认目录（模块里的 .data/wiki-prices）用
declare module 'node:path' {
  export function join(...parts: string[]): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}
