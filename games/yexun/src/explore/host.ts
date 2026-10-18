/**
 * 夜探和规则核心之间的接口（第 6 步）。夜探的规则写在 `src/explore/`，核心按这里的约定调用；核心里的改动由主代理接（见本文件末尾的清单）。
 *
 * 设计取舍：
 * - 夜探的状态（宝箱、门、背包、守卫）放在一个 `Raid` 对象里（`raid.ts`），挂在 World 上；核心不用懂宝物和撤离，只在固定时机调几个钩子。
 * - 怪的数据仍在 World 的并列数组里；守卫（巡夜将、石兽、守铜箱的精英）的移动由 `guards.ts` 算，读写的就是那几个数组，
 *   所以 `GuardHost` 是 World 的一个子集（World 结构上直接满足它，不用适配）。
 * - 一拍里的顺序和随机流都固定：夜探只用自己的四条流（raid-map、raid-loot、raid-gate、raid-ai），不动核心已有的流，
 *   守夜的录像和金标准指纹不受影响。
 */
import type { RaidLiveTier, RaidTemplateId } from '../content/explore.ts';
import type { CharacterId } from '../content/meta.ts';

/** 开一局夜探要的东西（核心的 Setup 里加 `mode: 'raid'` 和 `raid: RaidSetup`） */
export interface RaidSetup {
  seed: number;
  template: RaidTemplateId;
  /** 危险 0–5（第 5 步之前核心只有 easy / normal / hard 三档：主代理按 0 / 2 / 4 对上）。危险 0 第 3 分钟开第一座门 */
  danger: number;
  /** 实盘档位；娱乐不填。教学镇不能开实盘 */
  live?: RaidLiveTier;
  /** 出战角色：实盘结回按它乘角色系数（RAID_LIVE.charBp）；玩法本身不看它（核心的角色在 Setup.character） */
  character?: CharacterId;
}

/** 事件出口：核心的 `Events`（结构上满足） */
export interface EvSink {
  push(t: number, x: number, y: number, a?: number, b?: number, c?: number): void;
}

/** 每拍夜探要看的主角状态（World 结构上满足） */
export interface RaidPlayerView {
  readonly tick: number;
  readonly x: number;
  readonly y: number;
  readonly ev: EvSink;
  /** 身上的铜钱（鬼市花） */
  coins: number;
}

/** 守卫移动要读写的怪数组（World 结构上满足；下标 i 是怪的槽位） */
export interface GuardHost {
  readonly tick: number;
  readonly x: number;
  readonly y: number;
  readonly ev: EvSink;
  readonly eAlive: Uint8Array;
  readonly eGen: Uint32Array;
  readonly eX: Float64Array;
  readonly eY: Float64Array;
  readonly eHp: Float64Array;
  readonly eHpMax: Float64Array;
  readonly eSpeed: Float64Array;
  readonly eT: Int32Array;
  readonly eS: Int32Array;
  readonly eAX: Float64Array;
  readonly eAY: Float64Array;
  readonly eV: Float64Array;
  readonly ePhase: Uint8Array;
}

/** 守卫的技能打到主角：核心的 hurt（走难度倍数、无敌帧、金钟罩那一套） */
export interface GuardFx {
  hurt(dmg: number): void;
}

/**
 * 夜探新加的事件（核心的 `Ev` 照这些编号加上；画面层放提示、音效）。
 * 编号从 40 起，给核心自己以后加的事件留出 26–39。
 */
export const RaidEv = {
  /** 门开了：x, y 是门的位置, a = 门的下标（0 北 1 东 2 南 3 西，名字在 map.gates[a].name）——全屏提示一次"东门开了" */
  GateOpen: 40,
  /** 门关了：a = 门的下标 */
  GateClose: 41,
  /** 开箱：x, y, a = 宝箱下标, b = 档（0 木 1 铜 2 金）, c = 出了几件 */
  ChestOpen: 42,
  /** 捡到一件宝物：x, y, a = 宝物编号, b = 宝物的档（0 凡 1 良 2 珍 3 绝） */
  Loot: 43,
  /** 撤出：x, y, a = 门的下标 */
  Escape: 44,
  /** 天亮倒计时：a = 0 开始（14:00，顶上换成倒计时）, 1 最后 30 秒（变红、心跳音） */
  Dawn: 45,
  /** 天亮还在镇里：迷失 */
  Lost: 46,
  /** 守卫发现主角追上来：x, y, a = 0 守铜箱的精英 1 巡夜将 2 石兽 3 游荡的巡夜将, c = 怪的槽位 */
  Alert: 47,
  /** 石兽的技能：x, y, a = 0 扑击预警（落点）1 扑下 2 甩尾预警 3 甩尾 4 进二段（吼一声）, b = 半径 */
  Beast: 48,
  /** 游荡的巡夜将出来了：x, y */
  Roamer: 49,
  /** 补刷：x, y, a = 宝箱下标（这个箱子重新封上了）；a = −1 时是这一波的汇总，b = 封上了几个 */
  Restock: 50,
  /** 宝妖：x, y, a = 0 出来了 1 钻地跑了 2 被打倒（宝物另发 Loot） */
  Goblin: 51,
  /** 鬼市：x, y, a = 0 开市 1 收市 2 买下一件（b = 摊子） */
  Market: 52,
  /** 拿到宝库钥匙：x, y */
  Key: 53,
  /** 宝库开封的时刻到了：x, y, a = 宝库下标, b = 有没有钥匙 */
  Vault: 54,
} as const;

/*
 * ───────────── 对核心的接口需求（主代理按这份改 src/core/、src/content/） ─────────────
 *
 * 1. state.ts `Setup`：`mode: 'vigil' | 'raid'`，加 `raid?: RaidSetup`；difficulty 照旧（危险档接好后用 raid.danger）。
 * 2. state.ts `World`：加 `raid: Raid | null`（createWorld 时 `mode === 'raid'` 就 `new Raid(setup.raid)`）；
 *    场地边长不再写死 ARENA：夜探用 `raid.map.size`（movePlayer、spawnEnemy、moveEnemies 的 clamp，ringPoint 出界换边都按它）；
 *    `blocks` 用 `raid.map.blocks`，推挤改用 `raid.map.index.pushOut(p, r)`（几百块，分桶；推法和 maps.ts 的 pushOut 逐位一样）；
 *    主角出生在 `raid.map.spawn`。
 * 3. content/enemies.ts：把 `RAID_ENEMIES.patrol`、`RAID_ENEMIES.beast`（content/explore.ts）接进 ENEMIES，kind 'patrol' / 'beast'，编号 18 / 19。
 *    spawnEnemy：`kind === 'beast'` 时 eT 由 `raid.bindGuard` 设（不要用 HOP_PERIOD 的随机），血按 Boss 的规矩不随时间涨。
 * 4. step.ts 刷怪（spawnWaves）：夜探不用 MINUTES / EVENTS，改用 `raidMinute(tick)`（spawn.ts，形状同 Minute）；
 *    刷出来的点过一遍 `raidSpawnPoint(raid, p)`（推出墙、夹进场地）；血、伤害、刷怪量再乘 `raidZoneMul(map, x, y)`（离镇中心越近越凶）。
 *    每拍刷怪时先把守卫刷出来：`for (let g; (g = raid.takeSpawn()) >= 0;) { const s = raid.guardSpawn(g); const i = spawnEnemy(w, s.kind, s.x, s.y); if (i >= 0) raid.bindGuard(g, i, w); }`
 *    （开局刷地图上的守卫，6:00、11:00 刷游荡的巡夜将；Raid 自己排队）。夜探不刷尸王、纸扎老爷，没有收获期事件。
 * 5. step.ts moveEnemies：`const g = raid?.guardAt(i, w.eGen[i]) ?? -1`；g ≥ 0 时速度和方向用 `guardStep(raid, g, w, i, fx)`
 *    （返回这一拍走多远，方向在 `GUARD_MOVE.vx/vy`；`GUARD_MOVE.own` 为真时照这种怪自己的行为走，比如守铜箱的白狐追人时照常连冲）。
 *    fx.hurt 就是核心的 hurt。守卫不参加"离太远挪到主角前面"（精英和 Boss 本来就不挪）。
 * 6. step.ts 一拍末尾（movePickups、regen 之后、判结束之前）：`raid.tick(w)`；然后 `while (raid.takeUpgrade()) openChestNow(w)`（铜箱、金箱另给一次升级宝箱）。
 * 7. 结束条件（夜探替换守夜的那三行）：
 *    - `w.hp <= 0` → `raid.die()`，end(false)；
 *    - `raid.outcome === 'escaped'` → end(true)；
 *    - `raid.outcome === 'lost'`（Raid 在 RAID_DAWN 拍自己判）→ end(false)；夜探不走守夜的 DAWN_TICK 天亮胜利。
 *    End 事件照旧（a = 1 撤出）。结算用 `settleRaid(raid, w.coins)`（settle.ts）。
 * 8. events.ts：照 `RaidEv` 的编号加进 Ev（40–49）。
 * 9. fingerprint.ts：夜探时把 `raidFingerprint(raid)` 混进指纹（宝箱、背包、门、撤离进度、守卫和四条随机流）。
 * 10. 精英掉的宝箱照旧是升级宝箱（Drop.Chest）；夜探的宝物只从地图上的宝箱出。
 * 11. 画面层（主代理接 main.ts / 对局场景）：读 `raid.map`（块、院子、宝箱、门）、`raid.chestOpen`、`raid.searchProgress()`、`raid.exitProgress()`、
 *     `raid.gateOpen`、`raid.bag`；撤离指引用 `guide(raid, x, y, out)`（guide.ts：最近的开着的门、沿路距离、直线方向、脚印）。
 */
