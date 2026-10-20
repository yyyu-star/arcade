/**
 * KIT_STORE 的宿主侧（PG 模式）：kit 0.21 的 KitStore 接口在 PG 模式下的实现，房间、计量、排队的状态存进 PostgreSQL，
 * DO 本身用 workerd 的内存存储（不落盘）。接口和 kit 持有者定的一样（2026-10-20）：
 *   load(ns, name)                          → { rows: [table, key, v][], alarmAt }
 *   commit(ns, name, puts, deletes, alarmAt) → { ok: true }，一个事务；alarmAt 每次都是这个对象完整的闹钟（null = 没有），整行覆盖；失败抛错
 *   wipe(ns, name)                           删这个对象的全部行和闹钟
 * ns 是 kit 的角色（room / meter / match），name 是 idFromName 用的名字；哪个游戏由绑定的 props.game 定（生成器注入，游戏自己改不了），
 * 所以不同游戏的同名房间码不会撞。
 *
 * 重启后唤醒：内存存储的闹钟重启就没了。router 起来后第一次请求调这里的 /wake：查出存了闹钟的对象，
 * 按角色找到那个游戏的 DO 命名空间（kit 依赖的绑定名：room → ROOM，meter → METER，match → MATCH），逐个调 kitWake(name)；
 * kit 在里面重新读状态、按存的闹钟重设（过期的立刻响）。
 */
import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
import postgres from 'postgres';

type Row = [table: string, key: string, v: string];
type Key = [table: string, key: string];

export interface KitStoreEnv {
  STORE: DurableObjectNamespace<KitStorePg>;
  PG_URL: string | null;
  /** [[游戏 id, 角色, DO 绑定名], ...]：唤醒时按它找命名空间 */
  WAKE: [string, string, string][];
  [binding: string]: unknown;
}

const ROLES = new Set(['room', 'meter', 'match']);

function store(env: KitStoreEnv) {
  return env.STORE.get(env.STORE.idFromName('kit'));
}

/** 游戏 Worker 的 KIT_STORE 绑定指向这里，props.game 是游戏 id */
export class KitStore extends WorkerEntrypoint<KitStoreEnv, { game: string }> {
  private game(ns: unknown, name: unknown): string {
    const game = this.ctx.props?.game;
    if (typeof game !== 'string' || !game) throw new Error('KIT_STORE 绑定没有 props.game');
    if (typeof ns !== 'string' || !ROLES.has(ns)) throw new Error(`KIT_STORE：ns 只许 room / meter / match`);
    if (typeof name !== 'string' || !name) throw new Error('KIT_STORE：name 不能为空');
    return game;
  }
  load(ns: string, name: string) {
    return store(this.env).load(this.game(ns, name), ns, name);
  }
  commit(ns: string, name: string, puts: Row[], deletes: Key[], alarmAt: number | null) {
    return store(this.env).commit(this.game(ns, name), ns, name, puts, deletes, alarmAt);
  }
  wipe(ns: string, name: string) {
    return store(this.env).wipe(this.game(ns, name), ns, name);
  }
}

/** 默认入口只给 router 调 /wake（不在站点路由上，也不在任何游戏的绑定里） */
export default {
  async fetch(request: Request, env: KitStoreEnv): Promise<Response> {
    if (new URL(request.url).pathname !== '/wake' || request.method !== 'POST') return new Response(null, { status: 404 });
    const pending = await store(env).pendingAlarms();
    let woke = 0;
    const failed: string[] = [];
    for (const { game, ns, name } of pending) {
      const binding = env.WAKE.find(([g, r]) => g === game && r === ns)?.[2];
      const target = binding ? (env[`wake:${game}:${binding}`] as DurableObjectNamespace | undefined) : undefined;
      if (!target) {
        failed.push(`${game}/${ns}/${name}（没有对应的命名空间）`);
        continue;
      }
      try {
        await (target.get(target.idFromName(name)) as unknown as { kitWake(name: string): Promise<unknown> }).kitWake(name);
        woke++;
      } catch (e) {
        failed.push(`${game}/${ns}/${name}：${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (pending.length) console.log(JSON.stringify({ msg: 'kitstore wake', woke, failed }));
    return Response.json({ woke, failed });
  },
};

export class KitStorePg extends DurableObject<KitStoreEnv> {
  private pg: postgres.Sql;
  private ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: KitStoreEnv) {
    super(ctx, env);
    if (!env.PG_URL) throw new Error('PG 模式要设 ARCADE_PG_URL');
    this.pg = postgres(env.PG_URL, {
      max: 4,
      idle_timeout: 60,
      types: { int8: { to: 20, from: [20], serialize: (x: unknown) => String(x), parse: (x: string) => Number(x) } },
      onnotice: () => {},
    });
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    await this.pg.unsafe(`
      CREATE TABLE IF NOT EXISTS arcade_kit_rows (
        game TEXT NOT NULL, ns TEXT NOT NULL, name TEXT NOT NULL, tbl TEXT NOT NULL, key TEXT NOT NULL, v TEXT NOT NULL,
        PRIMARY KEY (game, ns, name, tbl, key));
      CREATE TABLE IF NOT EXISTS arcade_kit_alarms (
        game TEXT NOT NULL, ns TEXT NOT NULL, name TEXT NOT NULL, alarm_at BIGINT NOT NULL,
        PRIMARY KEY (game, ns, name));`);
  }

  private async db(): Promise<postgres.Sql> {
    try {
      await this.ready;
    } catch (e) {
      this.ready = this.init();
      throw e;
    }
    return this.pg;
  }

  async load(game: string, ns: string, name: string): Promise<{ rows: Row[]; alarmAt: number | null }> {
    const pg = await this.db();
    const rows = await pg`SELECT tbl, key, v FROM arcade_kit_rows WHERE game = ${game} AND ns = ${ns} AND name = ${name}`;
    const [alarm] = await pg`SELECT alarm_at FROM arcade_kit_alarms WHERE game = ${game} AND ns = ${ns} AND name = ${name}`;
    return { rows: rows.map((r) => [r.tbl, r.key, r.v] as Row), alarmAt: alarm ? Number(alarm.alarm_at) : null };
  }

  async commit(game: string, ns: string, name: string, puts: Row[], deletes: Key[], alarmAt: number | null): Promise<{ ok: true }> {
    if (alarmAt !== null && !Number.isFinite(alarmAt)) throw new Error('KIT_STORE：alarmAt 只许数字或 null');
    // kit 每步交的是最后的样子，同一个键不会又写又删；真出现了说明 kit 那边乱了，不猜谁先谁后
    const deleted = new Set(deletes.map(([t, k]) => `${t}\u0000${k}`));
    if (puts.some(([t, k]) => deleted.has(`${t}\u0000${k}`))) throw new Error('KIT_STORE：同一个键不能在一次 commit 里又写又删');
    const pg = await this.db();
    await pg.begin(async (tx) => {
      for (const [tbl, key] of deletes) {
        await tx`DELETE FROM arcade_kit_rows WHERE game = ${game} AND ns = ${ns} AND name = ${name} AND tbl = ${tbl} AND key = ${String(key)}`;
      }
      for (const [tbl, key, v] of puts) {
        await tx`INSERT INTO arcade_kit_rows (game, ns, name, tbl, key, v) VALUES (${game}, ${ns}, ${name}, ${tbl}, ${String(key)}, ${v})
                 ON CONFLICT (game, ns, name, tbl, key) DO UPDATE SET v = excluded.v`;
      }
      if (alarmAt === null) await tx`DELETE FROM arcade_kit_alarms WHERE game = ${game} AND ns = ${ns} AND name = ${name}`;
      else {
        await tx`INSERT INTO arcade_kit_alarms (game, ns, name, alarm_at) VALUES (${game}, ${ns}, ${name}, ${alarmAt})
                 ON CONFLICT (game, ns, name) DO UPDATE SET alarm_at = excluded.alarm_at`;
      }
    });
    return { ok: true };
  }

  async wipe(game: string, ns: string, name: string): Promise<{ ok: true }> {
    const pg = await this.db();
    await pg.begin(async (tx) => {
      await tx`DELETE FROM arcade_kit_rows WHERE game = ${game} AND ns = ${ns} AND name = ${name}`;
      await tx`DELETE FROM arcade_kit_alarms WHERE game = ${game} AND ns = ${ns} AND name = ${name}`;
    });
    return { ok: true };
  }

  async pendingAlarms(): Promise<{ game: string; ns: string; name: string }[]> {
    const pg = await this.db();
    return (await pg`SELECT game, ns, name FROM arcade_kit_alarms ORDER BY alarm_at`).map((r) => ({ game: r.game, ns: r.ns, name: r.name }));
  }
}
