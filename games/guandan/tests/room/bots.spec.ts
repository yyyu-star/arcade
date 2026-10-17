/**
 * 真的房间里机器人对打整局（验收 a）：4 个真人座位各一条 WebSocket；再来一组 1 真人 + 3 电脑（电脑在房间里批量出）。
 * 每局断言：零规则错误、零卡死、每步写入 ≤ 2 行（开房那步如实 4 行）、所有连接看到的 seq 一致、下行消息不漏别人的牌。
 * 统计每局写入行数、入站条数、每条连接的下行条数、闹钟次数，给额度估算用。
 *
 * 局数：ROOM_GAMES / ROOM_GAMES_SOLO（默认各 4 局，npm run room-bulk 各 200 局）；故意不出等超时的比例 ROOM_IDLE_RATE（默认 0.02）。
 */
import { describe, expect, inject, it } from 'vitest';
import { env } from 'cloudflare:workers';
import { dist, freezeClock } from './helpers.ts';
import { Table, type TableStats } from './table.ts';
import { bank } from './wallet.ts';

/** 搭子战绩（0.16.0）：这个房间报上来的场（kit 交给 waitUntil，稍等一下再看） */
async function togethersOf(code: string, want: number): Promise<{ op: string; players: { userId: string; team: number; win: boolean }[] }[]> {
  let got: { op: string; players: { userId: string; team: number; win: boolean }[] }[] = [];
  for (let i = 0; i < 40; i++) {
    const all = ((await bank(env).snapshot()) as unknown as { togethers: typeof got }).togethers;
    got = all.filter((x) => x.op.startsWith(`${code}-`));
    if (got.length >= want) break;
    await new Promise((ok) => setTimeout(ok, 10));
  }
  return got;
}

const HOUR = 3_600_000;

async function series(label: string, games: number, humans: 1 | 4): Promise<TableStats[]> {
  const idleRate = inject('roomIdleRate');
  const out: TableStats[] = [];
  const t0 = performance.now();
  for (let g = 0; g < games; g++) {
    freezeClock();
    // 单数局打完一个真人点"再来一场"（0.6.2），双数局没人点、等房间停够了自己结束
    const table = new Table({ humans, tag: `${humans === 4 ? 'q' : 'solo'}${g}`, idleRate, spectator: humans === 4 && g % 10 === 0, again: g % 2 === 1 });
    try {
      await table.open();
      const st = await table.playToEnd();
      out.push(st);
      if (st.problems.length) throw new Error(`第 ${g} 局（房间 ${st.code}）：\n${st.problems.slice(0, 5).join('\n')}`);
      // 打完一整局报一次搭子战绩：4 个真人都在、先过 A 的那队两个人赢；1 个真人不报
      if (!st.closedEarly) {
        const tg = await togethersOf(st.code, humans === 4 ? 1 : 0);
        expect(tg.length, `房间 ${st.code} 报了几次`).toBe(humans === 4 ? 1 : 0);
        if (humans === 4) {
          const p = tg[0]!.players;
          expect(p.map((x) => x.team)).toEqual([0, 1, 0, 1]);
          const winners = p.filter((x) => x.win);
          expect(winners).toHaveLength(2);
          expect(winners[0]!.team).toBe(winners[1]!.team);
        }
      }
    } finally {
      table.close();
    }
    if ((g + 1) % 20 === 0 || g + 1 === games) {
      console.log(`[${label}] ${g + 1}/${games} 局，用时 ${((performance.now() - t0) / 1000).toFixed(0)} 秒`);
    }
  }
  report(label, out, (performance.now() - t0) / 1000);
  return out;
}

function report(label: string, s: TableStats[], sec: number): void {
  const done = s.filter((x) => !x.closedEarly);
  const early = s.filter((x) => x.closedEarly);
  const flat = (f: (x: TableStats) => number[]) => s.flatMap(f);
  console.log(
    [
      `==== ${label}：${s.length} 局（打完 ${done.length}，被房间硬限制关掉 ${early.length}），真实用时 ${sec.toFixed(0)} 秒 ====`,
      `每局步数：${dist(done.map((x) => x.steps))}；副数：${dist(done.map((x) => x.deals))}`,
      `每局写入行数（含开房 4 行）：${dist(s.map((x) => x.writes))}；开房那步：${[...new Set(s.map((x) => x.createWrites))].join('/')} 行；其余每步最多：${Math.max(...s.map((x) => x.maxStepWrites))} 行`,
      `每局入站消息（入座+开局+出手）：${dist(s.map((x) => x.inbound))}；其中出手：${dist(s.map((x) => x.acts))}`,
      `每条入座连接的下行条数：${dist(flat((x) => x.down))}；下行字节：${dist(flat((x) => x.downBytes))}`,
      `第一条连接收到的电脑互动条数：${dist(s.map((x) => x.botEmotes))}`,
      `每局闹钟次数：${dist(s.map((x) => x.alarms))}；其中故意不出等超时代出：${dist(s.map((x) => x.idleTimeouts))}`,
      `假时钟上每局时长（分钟）：${dist(s.map((x) => Math.round(x.fakeMs / 60_000)))}`,
      ...early.map((x) => `  被关掉：房间 ${x.code}，已发入站 ${x.closedEarly!.inbound} 条`),
    ].join('\n'),
  );
}

function check(s: TableStats[]): void {
  for (const x of s) {
    expect(x.problems).toEqual([]);
    expect(x.createWrites).toBe(4);
    expect(x.maxStepWrites).toBeLessThanOrEqual(2);
    // 没打完的只能是房间的硬限制（一生 3000 条入站、3 小时寿命），不是卡死
    if (x.closedEarly) expect(x.closedEarly.inbound >= 2990 || x.fakeMs >= 3 * HOUR).toBe(true);
  }
}

describe('机器人对打（真的 Durable Object）', () => {
  it(`4 真人：每人一条 WebSocket，本地算一手按 act 发出`, { timeout: 8 * HOUR }, async () => {
    const s = await series('4真人', inject('roomGames'), 4);
    check(s);
    expect(s.every((x) => x.botEmotes === 0)).toBe(true);
  });

  it(`1 真人 + 3 电脑：电脑在房间里批量出`, { timeout: 8 * HOUR }, async () => {
    const s = await series('1真人3电脑', inject('roomGamesSolo'), 1);
    check(s);
    // 电脑按公开事件（炸弹、头游、双下）说话（0.7.1）：几局下来一条都没有，就是 onStep 没接上
    expect(s.reduce((n, x) => n + x.botEmotes, 0)).toBeGreaterThan(0);
  });
});
