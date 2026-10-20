/**
 * 假的自托管 PG 后端（0.21.0，只给 vitest.pg.config.ts 用）：照 arcade-host 的 KIT_STORE 形状（store.ts 的 KitStoreRpc），
 * 服务绑定带 props.game，主键 (game, ns, name, table, key)，闹钟 (game, ns, name) 一行。
 * 数据放在一个 DO（FakePg）的存储里：房间对象被驱逐、内存存储清掉（模拟进程重启）后还在，和真的 PG 一样。
 * 测试能让提交变慢、失败，能看每次提交写了几行。
 */
import { DurableObject, WorkerEntrypoint } from 'cloudflare:workers';
import type { StoreRole, StoreRow } from '../src/store.ts';

export interface CommitLog {
  ns: string;
  name: string;
  rows: number;
  alarmAt: number | null;
}

interface PgEnv {
  FAKE_PG: DurableObjectNamespace<FakePg>;
}

const rk = (game: string, ns: string, name: string) => `${game}|${ns}|${name}`;

export class FakePg extends DurableObject {
  private delayMs = 0;
  private failing = 0;
  private failingLoads = 0;
  private commits: CommitLog[] = [];

  async load(game: string, ns: StoreRole, name: string): Promise<{ rows: StoreRow[]; alarmAt: number | null }> {
    if (this.failingLoads > 0) {
      this.failingLoads--;
      throw new Error('fake pg: load failed');
    }
    const rows = ((await this.ctx.storage.get<Record<string, string>>(`rows:${rk(game, ns, name)}`)) ?? {}) as Record<string, string>;
    const alarmAt = (await this.ctx.storage.get<number | null>(`alarm:${rk(game, ns, name)}`)) ?? null;
    return { rows: Object.entries(rows).map(([tk, v]) => [...(tk.split('\u0000') as [string, string]), v] as StoreRow), alarmAt };
  }

  async commit(game: string, ns: StoreRole, name: string, puts: StoreRow[], deletes: [string, string][], alarmAt: number | null): Promise<{ ok: true }> {
    if (this.delayMs) await new Promise((ok) => setTimeout(ok, this.delayMs));
    if (this.failing > 0) {
      this.failing--;
      throw new Error('fake pg: commit failed');
    }
    const key = `rows:${rk(game, ns, name)}`;
    const rows = ((await this.ctx.storage.get<Record<string, string>>(key)) ?? {}) as Record<string, string>;
    for (const [t, k, v] of puts) rows[`${t}\u0000${k}`] = v;
    for (const [t, k] of deletes) delete rows[`${t}\u0000${k}`];
    await this.ctx.storage.put(key, rows);
    await this.ctx.storage.put(`alarm:${rk(game, ns, name)}`, alarmAt);
    this.commits.push({ ns, name, rows: puts.length + deletes.length, alarmAt });
    return { ok: true };
  }

  async wipe(game: string, ns: StoreRole, name: string): Promise<void> {
    await this.ctx.storage.delete([`rows:${rk(game, ns, name)}`, `alarm:${rk(game, ns, name)}`]);
  }

  // ---------- 测试控制 ----------

  async control(c: { delayMs?: number; fail?: number; failLoad?: number; clearLog?: boolean }): Promise<void> {
    if (c.delayMs !== undefined) this.delayMs = c.delayMs;
    if (c.fail !== undefined) this.failing = c.fail;
    if (c.failLoad !== undefined) this.failingLoads = c.failLoad;
    if (c.clearLog) this.commits = [];
  }

  async log(): Promise<CommitLog[]> {
    return this.commits;
  }

  /** 存着闹钟的对象（宿主启动时按它 kitWake） */
  async alarms(game: string): Promise<{ ns: string; name: string; alarmAt: number }[]> {
    const all = await this.ctx.storage.list<number | null>({ prefix: `alarm:${game}|` });
    return [...all].flatMap(([k, at]) => {
      if (at === null || at === undefined) return [];
      const [, ns, name] = k.slice('alarm:'.length).split('|') as [string, string, string];
      return [{ ns, name, alarmAt: at }];
    });
  }

  /** 清空一个 ns 下的全部数据（测试开头重置计量用） */
  async wipeNs(game: string, ns: string): Promise<void> {
    const keys = [...(await this.ctx.storage.list({ prefix: `rows:${game}|${ns}|` })).keys(), ...(await this.ctx.storage.list({ prefix: `alarm:${game}|${ns}|` })).keys()];
    if (keys.length) await this.ctx.storage.delete(keys);
  }
}

export function fakePg(env: PgEnv): DurableObjectStub<FakePg> {
  return env.FAKE_PG.get(env.FAKE_PG.idFromName('pg'));
}

/** KIT_STORE 服务绑定（生成器注入的那种，props.game 是游戏 id） */
export class FakeKitStore extends WorkerEntrypoint<PgEnv, { game: string }> {
  load(ns: StoreRole, name: string) {
    return fakePg(this.env).load(this.ctx.props.game, ns, name);
  }
  commit(ns: StoreRole, name: string, puts: StoreRow[], deletes: [string, string][], alarmAt: number | null) {
    return fakePg(this.env).commit(this.ctx.props.game, ns, name, puts, deletes, alarmAt);
  }
  wipe(ns: StoreRole, name: string) {
    return fakePg(this.env).wipe(this.ctx.props.game, ns, name);
  }
}
