/**
 * 可插拔的存储（0.21.0，自托管 PostgreSQL 模式，需求见自托管代理的 selfhost-kit-persistence）。
 *
 * 两种实现，按 env 里有没有 KIT_STORE 绑定选（和 ARCADE 决定平台 / 独立模式一样，游戏代码、wrangler.jsonc 不用改）：
 * - 没有：kit 照旧直接用 ctx.storage.sql、ctx.storage 的 KV 和闹钟，同表同列、同样的 SQL，Cloudflare 和自托管 SQLite 模式逐字不变。
 *   这条路不经过本文件（房间、计量里原来的代码原样留着），零退化靠的就是"根本没换"；
 * - 有（自托管 PG 模式，workerd 的内存存储下 ctx.storage.sql 直接抛错，进程重启内存全清）：用 MirrorStore。
 *   同步读写全打内存镜像，"一步之内没有 await"的规矩不变；这一步写的脏行和对象当前的闹钟在 flush 时经 KIT_STORE 一次事务提交，
 *   flush 在广播之前（房间把这一步的 send/close 排队，提交成功才发出去，等于 Cloudflare 输出门的语义）。
 *
 * KIT_STORE 是生成器注入的服务绑定（props 里带游戏 id，游戏自己改不了），PG 那边主键 (game, ns, name, table, key)：
 * - ns 是 kit 的角色（room / meter / match），不是游戏子类的类名（打包后可能被改名）；
 * - name 是 idFromName 用的名字（房间码、kit-meter、kit-miss:<key>、kit-match:<档位>），kit 自己记、调 DO 时自己带，不依赖 ctx.id.name；
 * - key 一律字符串，v 是字符串（JSON）。
 * 进程重启后宿主按存着的 alarmAt 逐个调 kitWake(name)，kit 在里面 open() 并重设闹钟（过期的马上响）。
 */

/** 一行：[表, 键, 值] */
export type StoreRow = [table: string, key: string, v: string];

/** 宿主（arcade-host）给的 KIT_STORE 服务绑定的 RPC 形状 */
export interface KitStoreRpc {
  load(ns: StoreRole, name: string): Promise<{ rows: StoreRow[]; alarmAt: number | null }>;
  /** 一次事务；alarmAt 是这个对象当前的完整闹钟（null = 没有）。失败抛错，kit 不重试，下一步自然重写 */
  commit(ns: StoreRole, name: string, puts: StoreRow[], deletes: [table: string, key: string][], alarmAt: number | null): Promise<unknown>;
  /** 删这个对象的全部行和闹钟 */
  wipe(ns: StoreRole, name: string): Promise<unknown>;
}

export type StoreRole = 'room' | 'meter' | 'match';

/** env 里的 KIT_STORE；没有（或不像）就是 null，走原来的 ctx.storage */
export function kitStoreOf(env: unknown): KitStoreRpc | null {
  const s = (env as { KIT_STORE?: Partial<KitStoreRpc> } | undefined)?.KIT_STORE;
  return s && typeof s.load === 'function' && typeof s.commit === 'function' && typeof s.wipe === 'function' ? (s as KitStoreRpc) : null;
}

/**
 * RPC 的回话用完就释放：Workers 的 RPC 结果带着 Symbol.dispose，不释放的话这条 RPC 会话一直挂着，
 * 对象空闲了也不能被驱逐（本地 workerd 实测：驱逐一直等着）
 */
function disposeResult(r: unknown): void {
  // Symbol.dispose 不在 kit 的 lib（es2023）里，按运行时有没有取
  const sym = (Symbol as unknown as { dispose?: symbol }).dispose;
  if (!sym || r === null || typeof r !== 'object') return;
  const d = (r as Record<symbol, unknown>)[sym];
  if (typeof d === 'function') d.call(r);
}

const k = (table: string, key: string | number): string => `${table}\u0000${String(key)}`;

/**
 * 内存镜像 + 异步提交。读写都是同步的（打镜像），只有 open、flush、wipe 会 await。
 * 提交失败时整份镜像作废（下次 open 重新从 PG 读），和 sql 模式"写存储失败就作废缓存"一样：内存里不留没落盘的东西。
 */
export class MirrorStore {
  private rows = new Map<string, string>();
  /** 这一步改过的行：值为 null 是删掉 */
  private dirty = new Map<string, { table: string; key: string; v: string | null }>();
  private loading: Promise<void> | null = null;
  private loaded = false;
  /** PG 里存着的闹钟（上次提交成功的） */
  private savedAlarm: number | null = null;
  /** 记下来的名字（idFromName 用的）；第一次 open 时定 */
  private myName: string | null = null;

  constructor(
    private readonly rpc: KitStoreRpc,
    readonly role: StoreRole,
  ) {}

  get name(): string | null {
    return this.myName;
  }

  /** 镜像是不是已经从 PG 读进来了（没读进来时同步读写会抛错，免得拿空镜像当"没有房间"） */
  get ready(): boolean {
    return this.loaded;
  }

  /** 读进来时 PG 里存着的闹钟（kitWake 按它重设） */
  get storedAlarm(): number | null {
    return this.savedAlarm;
  }

  /**
   * 把这个对象的全部行读进镜像（已经读过就什么都不做；同时来的几个入口共用一次读）。
   * name 和以前记下的不一样是 kit 自己的错（同一个对象只有一个 idFromName 的名字），按出错处理
   */
  async open(name: string): Promise<void> {
    if (this.myName !== null && this.myName !== name) throw new Error(`kit store: name mismatch (${this.myName} vs ${name})`);
    this.myName = name;
    if (this.loaded) return;
    this.loading ??= (async () => {
      try {
        const r = await this.rpc.load(this.role, name);
        disposeResult(r);
        this.rows = new Map(r.rows.map(([t, key, v]) => [k(t, key), v]));
        this.dirty.clear();
        this.savedAlarm = r.alarmAt;
        this.loaded = true;
      } finally {
        this.loading = null;
      }
    })();
    await this.loading;
  }

  private need(): void {
    if (!this.loaded) throw new Error('kit store: not open');
  }

  get(table: string, key: string | number): string | null {
    this.need();
    return this.rows.get(k(table, key)) ?? null;
  }

  /** 返回写了几行（和 sql 的 rowsWritten 一样记进"每步 ≤ 2 行"） */
  put(table: string, key: string | number, v: string): number {
    this.need();
    this.rows.set(k(table, key), v);
    this.dirty.set(k(table, key), { table, key: String(key), v });
    return 1;
  }

  /** 删掉一行；本来就没有的不算写（和 SQLite 的 DELETE 一样回 0） */
  delete(table: string, key: string | number): number {
    this.need();
    if (!this.rows.delete(k(table, key))) return 0;
    this.dirty.set(k(table, key), { table, key: String(key), v: null });
    return 1;
  }

  /** 这一步有没有要提交的（脏行，或者闹钟和 PG 里的不一样） */
  pending(alarmAt: number | null): boolean {
    return this.dirty.size > 0 || alarmAt !== this.savedAlarm;
  }

  /**
   * 提交这一步：没有脏行、闹钟也没变就不调（守每步 ≤ 2 行，少一次往返）。
   * 失败往外抛，镜像整份作废（没落盘的改动不能留在内存里冒充已经存了）；kit 不重试，下一步自然重写
   */
  async flush(alarmAt: number | null): Promise<void> {
    // 镜像在这一步中间被作废（同时进来的另一步提交失败了）：这一步的改动也跟着丢了，照实报失败
    if (!this.loaded || this.myName === null) throw new Error('kit store: dropped');
    if (!this.pending(alarmAt)) return;
    const puts: StoreRow[] = [];
    const deletes: [string, string][] = [];
    for (const d of this.dirty.values()) {
      if (d.v === null) deletes.push([d.table, d.key]);
      else puts.push([d.table, d.key, d.v]);
    }
    this.dirty.clear();
    try {
      disposeResult(await this.rpc.commit(this.role, this.myName, puts, deletes, alarmAt));
      this.savedAlarm = alarmAt;
    } catch (e) {
      this.drop();
      throw e;
    }
  }

  /** 作废镜像：下次 open 重新从 PG 读 */
  drop(): void {
    this.rows.clear();
    this.dirty.clear();
    this.loaded = false;
  }

  /** 删掉这个对象的全部行和闹钟（关房） */
  async wipe(): Promise<void> {
    this.rows.clear();
    this.dirty.clear();
    this.savedAlarm = null;
    if (this.myName !== null) disposeResult(await this.rpc.wipe(this.role, this.myName));
  }
}
