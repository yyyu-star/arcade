/**
 * 同桌几个人之间的屏蔽关系（0.25.0，docs/platform-backend.md 15.8）：只经 ARCADE 服务绑定的 RPC，只读、一条查询。
 */
import { exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { blockedAmongStats } from '../worker/api/blocked-among';
import Arcade from '../worker/index';
import { call, env, resetAll } from './helpers';

beforeEach(() => resetAll());

const arcade = (exports as unknown as { default: { blockedAmong(ids: unknown): Promise<[string, string][]> } }).default;
const A = 'AAAAAAAAAAAAAAAAAAAAAA';
const B = 'BBBBBBBBBBBBBBBBBBBBBB';
const C = 'CCCCCCCCCCCCCCCCCCCCCC';
const D = 'DDDDDDDDDDDDDDDDDDDDDD';

async function block(blocker: string, blocked: string) {
  await env.DB.prepare('INSERT INTO blocks (blocker, blocked, created_at) VALUES (?1, ?2, 1)').bind(blocker, blocked).run();
}
const sorted = (pairs: [string, string][]) => pairs.map((p) => p.join('>')).sort();
const last = () => blockedAmongStats.last;

describe('ARCADE.blockedAmong', () => {
  it('空列表、一个人：不查，回空', async () => {
    await block(A, B);
    expect(await arcade.blockedAmong([])).toEqual([]);
    expect(await arcade.blockedAmong([A])).toEqual([]);
    expect(await arcade.blockedAmong([A, A, A])).toEqual([]);
  });

  it('单向屏蔽：只回屏蔽的那一对；一条查询、一行不写', async () => {
    await block(A, B);
    expect(await arcade.blockedAmong([A, B, C])).toEqual([[A, B]]);
    expect(last().queries).toBe(1);
    expect(last().rowsWritten).toBe(0);
  });

  it('互相屏蔽：两对都回', async () => {
    await block(A, B);
    await block(B, A);
    expect(sorted(await arcade.blockedAmong([B, A]))).toEqual([`${A}>${B}`, `${B}>${A}`]);
  });

  it('只查这几个人之间：和名单外的人的屏蔽不回', async () => {
    await block(A, D);
    await block(D, B);
    await block(C, A);
    expect(await arcade.blockedAmong([A, B, C])).toEqual([[C, A]]);
  });

  it('去重、不像用户编号的忽略', async () => {
    await block(A, B);
    expect(await arcade.blockedAmong([A, A, 'x y', 42, null, '', B, B])).toEqual([[A, B]]);
    expect(await arcade.blockedAmong('AB')).toEqual([]);
    expect(await arcade.blockedAmong(null)).toEqual([]);
  });

  it('超过 9 个人：不查，回空；去重后不超过 9 个照常查', async () => {
    await block(A, B);
    const ten = [A, B, ...Array.from({ length: 8 }, (_, i) => String(i).repeat(22))];
    blockedAmongStats.last.queries = -1;
    expect(await arcade.blockedAmong(ten)).toEqual([]);
    expect(last().queries).toBe(-1);
    expect(await arcade.blockedAmong([...ten.slice(0, 9), ...ten.slice(0, 9)])).toEqual([[A, B]]);
  });

  it('浏览器碰不到：/api 里没有这条路', async () => {
    expect((await call('/api/blocked-among')).status).toBe(404);
    expect((await call('/api/blocked-among', { body: [A, B] })).status).toBe(404);
  });

  // RPC 只认原型上的方法：scheduled 写成实例字段，游戏经绑定调不到（定时触发照常找得到，worker/index.ts）
  it('默认入口经 RPC 只露出 fetch、blockedAmong', () => {
    expect(Object.getOwnPropertyNames(Arcade.prototype).sort()).toEqual(['blockedAmong', 'constructor', 'fetch']);
  });
});
