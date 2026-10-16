/**
 * 部署配置（wrangler.jsonc）里不能悄悄丢的东西：计量的绑定和门槛、钱包的绑定。
 * 没绑 METER 时 arcade-kit 不限额（只为升级期兼容），所以误删绑定不会报错，只会变成没有额度保护——这里让 CI 挂掉。
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/** JSONC → JSON：去掉字符串外面的 // 和 /* *\/ 注释、结尾多余的逗号。 */
function parseJsonc(text: string): unknown {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && text[i + 1] === '*') {
      i = text.indexOf('*/', i + 2) + 1;
    } else {
      out += c;
    }
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

interface Wrangler {
  services?: unknown;
  workers_dev: boolean;
  preview_urls: boolean;
  assets: { run_worker_first: string[] };
  durable_objects: { bindings: { name: string; class_name: string }[] };
  migrations: { tag: string; new_sqlite_classes?: string[] }[];
  vars: Record<string, unknown>;
}

const conf = parseJsonc(readFileSync(fileURLToPath(new URL('../wrangler.jsonc', import.meta.url)), 'utf8')) as Wrangler;
const main = readFileSync(fileURLToPath(new URL('../worker/main.ts', import.meta.url)), 'utf8');

describe('wrangler.jsonc', () => {
  it('绑了房间和计量（METER → RoomMeter），入口导出了 RoomMeter，两个类都有 SQLite 迁移', () => {
    expect(conf.durable_objects.bindings).toEqual(
      expect.arrayContaining([
        { name: 'ROOM', class_name: 'Room' },
        { name: 'METER', class_name: 'RoomMeter' },
      ]),
    );
    expect(main).toMatch(/export \{ RoomMeter \} from 'arcade-kit\/meter'/);
    const sqlite = conf.migrations.flatMap((m) => m.new_sqlite_classes ?? []);
    expect(sqlite).toEqual(expect.arrayContaining(['Room', 'RoomMeter']));
    // 已经上线的 v1 不能改
    expect(conf.migrations[0]).toEqual({ tag: 'v1', new_sqlite_classes: ['Room'] });
  });

  it('掼蛋的写入门槛：5 万停开新房、6 万收场（全账户 10 万，各游戏怎么分见仓库 docs/platform-backend.md 4.7）；每人同时 5 个房间、每天 100 个（0.6.0）', () => {
    // 整个对象比对：字段名写错（kit 会忽略、用默认值）也会挂
    expect(conf.vars.KIT_QUOTA).toEqual({ busyWrites: 50_000, stopWrites: 60_000, roomsPerUser: 5, dailyRoomsPerUser: 100 });
  });

  it('联机开着（ONLINE 是一键关的开关）', () => {
    expect(conf.vars.ONLINE).toBe('on');
  });

  it('独立配置（0.8.0）：不写平台绑定和 GATE（本站部署时由部署工具补），开 workers.dev、关预览地址；站点根和实盘接口先进 Worker', () => {
    expect(conf.services).toBeUndefined();
    expect(conf.vars.GATE).toBeUndefined();
    expect(conf.workers_dev).toBe(true);
    expect(conf.preview_urls).toBe(false);
    expect(conf.assets.run_worker_first).toEqual(expect.arrayContaining(['/', '/api/me', '/games/guandan/api/stake/*']));
  });
});
