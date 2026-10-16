/** D1 的薄包装：每次调用都把 meta 记进计量（按类别），并累计这个请求写了、读了几行（测试用来断言 7.2 的写入行数和读榜的读取上限）。 */
import { type Category, CATEGORIES, meter } from './meter';

/**
 * D1 出错的两类"不是我们的 bug、等一会儿就好"（Cloudflare 文档 d1/observability/debug-d1 的错误表，2026-08 版）：
 * transient：文档写"重试即可"的几种（存储被重置、断网、远端节点暂时不可用）；
 * overloaded：过载、存储操作超时，文档说不要马上重试。
 * 只读查询 D1 自己会再试两次（d1/best-practices/retry-queries），所以这里只重试调用方声明幂等的写。
 */
const TRANSIENT = ['Network connection lost', 'storage caused object to be reset', 'reset because its code was updated', 'Replica disconnected from primary', 'transient issue on remote node'];
const OVERLOADED = ['D1 DB is overloaded', 'exceeded timeout'];

export function d1Trouble(e: unknown): 'transient' | 'overloaded' | null {
  const msg = e instanceof Error ? e.message : '';
  if (TRANSIENT.some((t) => msg.includes(t))) return 'transient';
  if (OVERLOADED.some((t) => msg.includes(t))) return 'overloaded';
  return null;
}

/** 幂等写最多试几次、第一次重试前等多久（之后翻倍，加最多一倍的随机抖动，免得一起重试又撞上） */
const WRITE_TRIES = 3;
const WRITE_BACKOFF_MS = 40;

export interface RequestStats {
  rowsWritten: number;
  rowsRead: number;
  byCategory: Record<Category, number>;
}

export function newStats(): RequestStats {
  return { rowsWritten: 0, rowsRead: 0, byCategory: Object.fromEntries(CATEGORIES.map((k) => [k, 0])) as Record<Category, number> };
}

export class Db {
  constructor(
    readonly raw: D1Database,
    readonly stats: RequestStats,
    private cat: Category,
  ) {}

  /** 同一个请求里，顺带的写入（如 last_seen_at）记到别的类别。 */
  as(cat: Category): Db {
    return new Db(this.raw, this.stats, cat);
  }

  stmt(sql: string, ...binds: unknown[]): D1PreparedStatement {
    return this.raw.prepare(sql).bind(...binds);
  }

  async all<T>(s: D1PreparedStatement): Promise<T[]> {
    const r = await s.all<T>();
    this.track(r.meta);
    return r.results;
  }

  async first<T>(s: D1PreparedStatement): Promise<T | null> {
    return (await this.all<T>(s))[0] ?? null;
  }

  /**
   * opts.idempotent：这条写重复执行结果不变（带 rev 条件的 UPDATE、ON CONFLICT DO NOTHING 的 INSERT），
   * 遇到 transient 错误就退避重试。第一次其实写成了、只是回话丢了的话，重试写 0 行，调用方按"被抢先"重读就对了。
   */
  async run(s: D1PreparedStatement, opts: { idempotent?: boolean } = {}): Promise<D1Meta> {
    for (let i = 1; ; i++) {
      try {
        const r = await s.run();
        this.track(r.meta);
        return r.meta;
      } catch (e) {
        if (!opts.idempotent || i >= WRITE_TRIES || d1Trouble(e) !== 'transient') throw e;
        const wait = WRITE_BACKOFF_MS * 2 ** (i - 1);
        await new Promise((r) => setTimeout(r, wait + Math.random() * wait));
      }
    }
  }

  async batch<T = Record<string, unknown>>(stmts: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    const rs = await this.raw.batch<T>(stmts);
    for (const r of rs) this.track(r.meta);
    return rs;
  }

  private track(meta: D1Meta | undefined): void {
    if (!meta) return;
    meter.addD1(this.cat, meta);
    const n = meta.rows_written ?? 0;
    this.stats.rowsWritten += n;
    this.stats.rowsRead += meta.rows_read ?? 0;
    this.stats.byCategory[this.cat] += n;
  }
}
