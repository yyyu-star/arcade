/**
 * 把普通的 JS 值写成 workerd 配置用的 Cap'n Proto 文本格式。只覆盖 workerd.capnp 用得到的那点语法：
 * 结构体 (a = 1, b = "x")、列表 [..]、字符串、布尔、数字、Void、embed "文件"（相对配置文件）。
 * 字符串只许 ASCII 可见字符：capnp 文本的转义规则和 JSON 不完全一样，非 ASCII 的内容（中文变量值、迁移 SQL）一律放进 embed 的文件。
 */
export const VOID: unique symbol = Symbol('void');
export class Embed {
  readonly file: string;
  constructor(file: string) {
    this.file = file;
  }
}
export const embed = (file: string) => new Embed(file);

export type Capnp = string | number | boolean | typeof VOID | Embed | Capnp[] | { [k: string]: Capnp | undefined };

export function text(v: Capnp, indent = ''): string {
  if (v === VOID) return 'void';
  if (v instanceof Embed) return `embed ${str(v.file)}`;
  if (typeof v === 'string') return str(v);
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const inner = `${indent}  `;
  if (Array.isArray(v)) {
    if (!v.length) return '[]';
    return `[\n${v.map((x) => inner + text(x, inner)).join(',\n')}\n${indent}]`;
  }
  const entries = Object.entries(v).filter(([, x]) => x !== undefined) as [string, Capnp][];
  if (!entries.length) return '()';
  return `(\n${entries.map(([k, x]) => `${inner}${k} = ${text(x, inner)}`).join(',\n')}\n${indent})`;
}

function str(s: string): string {
  if (!/^[\x20-\x7e]*$/.test(s)) throw new Error(`capnp 字符串只许 ASCII：${JSON.stringify(s)}（非 ASCII 的内容放进 embed 文件）`);
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
