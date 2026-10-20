/**
 * 一拍的模拟（DESIGN.md 5.1）。`step(w, dir, choice)` 原地推进 World，事件写进 w.ev。
 * 顺序固定：主角走 → 刷怪 → 怪的行为和移动 → 重建格子、推挤 → 法器 → 子弹 → 挨打 → 掉落 → 升级 → 结束。
 * 只用四则运算、方向表和 fsqrt；随机都走 World 上分好流的 Rng。
 */
import {
  BAMBOO_KING,
  BAT,
  BONE,
  BOSS,
  CRAB,
  DROWN,
  ENEMIES,
  ENEMY_BY_KIND,
  FOX,
  FROSTSOUL,
  GENERAL,
  HEBO,
  HOP_AIR,
  HOP_PERIOD,
  HOP_SPEED_MUL,
  ICEGOLEM,
  ICICLE,
  TEMPLEGHOST,
  LANTERN,
  LORD,
  MONK,
  NIGHTWATCH,
  PALANQUIN,
  PLAYER_SLOW,
  SCARECROW,
  SNAKE,
  SNOW,
  SPROUT,
  WATER,
  WEASEL,
  WHITEFOX,
  type EnemyKind,
} from '../content/enemies.ts';
import { BOMB, CHEST, DROPS, MERCY, PICKUP, PLAYER, PROPS, PURSE, xpNeed } from '../content/player.ts';
import { inRects, MAPS, pushOut, TERRAIN, type Block } from '../content/maps.ts';
import { BlockIndex, type RaidBlock } from '../explore/blocks.ts';
import { GUARD_MOVE, guardStep } from '../explore/guards.ts';
import { raidMinute, raidSpawnPoint, raidZoneMul } from '../explore/spawn.ts';
import type { Raid } from '../explore/raid.ts';
import { RAID_REGIONS, VIGIL_REGIONS, EMERGE_KINDS, regionKind, regionTotal, type Region } from '../content/regions.ts';
import { CALM, DAWN_TICK, dangerDef, EARLY_TICKS, EVENTS, FIRST_RUN_GUARD, lampShare, MINUTES, OPEN_TICKS, SCALE, TWIN_BOSS_HP, type WaveEvent } from '../content/waves.ts';
import { ASSIST, CHAR_FX, CHARACTERS, CURSE_FX, PERK_FX, REVIVE, type PerkId } from '../content/meta.ts';
import {
  MAX_PASSIVES,
  MAX_WEAPON_LEVEL,
  MAX_WEAPONS,
  DUAL_FX,
  PAPER_FX,
  MERGES,
  PASSIVE_IDS,
  PASSIVES,
  WEAPON_IDS,
  WEAPONS,
  weaponStats,
  NEXT_ELEMENT,
  TYPE_SETS,
  type Element,
  type PassiveId,
  type WeaponId,
  type WeaponStats,
  type WeaponType,
} from '../content/weapons.ts';
import { Ev } from './events.ts';
import { DIR_N } from './dirs.ts';
import { clamp, dcos, dirIndex, dsin, fsqrt, inputCos, inputSin } from './fmath.ts';
import { Grid } from './grid.ts';
import { baseStats, Drop, MAX_DROPS, MAX_ENEMIES, MAX_PROPS, MAX_SHOTS, Pick, Shot, WEAPON_SLOTS, World, type Choice, type Setup } from './state.ts';

/** 法器在事件里的编号 */
export const WEAPON_CODE: Record<WeaponId, number> = Object.fromEntries(WEAPON_IDS.map((id, i) => [id, i])) as Record<WeaponId, number>;
/** 宝箱事件里合成的编号：200 + MERGES 下标 */
export const MERGE_CODE = 200;
export const PASSIVE_CODE: Record<PassiveId, number> = Object.fromEntries(PASSIVE_IDS.map((id, i) => [id, 100 + i])) as Record<PassiveId, number>;

const grids = new WeakMap<World, Grid>();
function gridOf(w: World): Grid {
  let g = grids.get(w);
  if (!g) {
    g = new Grid(w.arenaW, w.arenaH);
    grids.set(w, g);
  }
  return g;
}

/** 查询结果要在遍历时再查别的，先拷到这里 */
const scratch = new Int32Array(MAX_ENEMIES);
const scratch2 = new Int32Array(MAX_ENEMIES);
/** 双修：到点要炸的符 */
const sealDue = new Int32Array(MAX_ENEMIES);

export function createWorld(setup: Setup): World {
  const w = new World(setup);
  w.schedule = schedule(w);
  addWeapon(w, CHARACTERS[w.setup.character ?? 'xiaodao'].start);
  w.hp = w.stats.hpMax;
  if (!w.raid) scatterProps(w);
  return w;
}

/** 这一档、这几条咒印下的定点事件：精英按危险档晚到、多来几只，危险 5 两只尸王；按时间重排 */
function schedule(w: World): WaveEvent[] {
  const d = dangerDef(w.setup.mode, w.setup.danger);
  const extra = d.eliteExtra + (w.setup.curses?.includes('elites') ? 1 : 0);
  // 图专属精英（content/regions.ts）按时间插进定点事件；没登记的图什么都不加
  const own = VIGIL_REGIONS[w.setup.map ?? 'snow']?.elites?.map((e): WaveEvent => ({ at: e.at, kind: 'elite', enemy: e.enemy, count: e.count })) ?? [];
  const out = [...EVENTS, ...own].map((e): WaveEvent => {
    if (e.kind === 'elite') return { ...e, at: e.at + d.eliteLate, count: e.count + extra };
    return e;
  });
  // 稳定排序：同一拍的事件保持原来的先后
  return out.map((e, k) => ({ e, k })).sort((a, b) => a.e.at - b.e.at || a.k - b.k).map((x) => x.e);
}

function has(w: World, c: 'fast' | 'noheal' | 'more'): boolean {
  return w.setup.curses?.includes(c) ?? false;
}

function perk(w: World, id: PerkId): number {
  return w.setup.perks?.[id] ?? 0;
}

// ───────────────────────── 一拍 ─────────────────────────

export function step(w: World, dir: number, choice = -1): void {
  w.ev.n = 0;
  if (w.phase === 'over') return;
  if (w.phase === 'choose') {
    if (choice >= 0 && choice < w.choices.length) applyChoice(w, w.choices[choice]!);
    else if (choice === Pick.Reroll && w.rerolls > 0) {
      w.rerolls--;
      openChoices(w);
    } else if (choice >= Pick.Ban && choice < Pick.Ban + w.choices.length && w.bans > 0) {
      // 封禁：这张以后不再出现，三张重新抽
      const c = w.choices[choice - Pick.Ban]!;
      if (c.kind !== 'coins') {
        w.bans--;
        w.banned.push(c.id as WeaponId | PassiveId);
        openChoices(w);
      }
    } else if (choice === Pick.Skip) {
      // 跳过：换一点魂（这一级要的经验的 15%），不选
      w.pendingLevels--;
      w.choices = [];
      w.phase = 'play';
      gainXp(w, xpNeed(w.level, w.raid !== null) * 0.15);
      if (w.pendingLevels > 0) openChoices(w);
    }
    return;
  }
  w.tick++;
  w.px = w.x;
  w.py = w.y;
  w.ePX.set(w.eX);
  w.ePY.set(w.eY);
  w.sPX.set(w.sX);
  w.sPY.set(w.sY);
  w.dPX.set(w.dX);
  w.dPY.set(w.dY);

  movePlayer(w, dir);
  if (w.marks > 0) clearDeadSeals(w);
  spawnWaves(w);
  const g = gridOf(w);
  markSlow(w, g);
  moveEnemies(w);
  g.build(w);
  separate(w, g);
  if (w.blocks.length) blockEnemies(w);
  fireWeapons(w, g);
  moveShots(w, g);
  dualTick(w, g);
  touchPlayer(w, g);
  if (w.quake) quake(w, g, w.x, w.y, CHAR_FX.pangArea, CHAR_FX.pangKnock);
  if (w.setup.character === 'gengfu' && w.tick > 0 && w.tick % CHAR_FX.gongEvery === 0) gong(w, g);
  movePickups(w);
  if (!w.raid) props(w);
  regen(w);
  if (w.phase !== 'play') return;
  if (w.raid) {
    // 夜探：撤出算赢，倒下、天亮还在镇里算输（DESIGN.md 2.3）
    const raid = w.raid;
    raid.tick(w);
    while (raid.takeUpgrade()) openChest(w);
    if (w.hp <= 0 && w.revives > 0) revive(w, g);
    if (w.hp <= 0) {
      raid.die(w.tick);
      return end(w, false);
    }
    if (raid.outcome === 'escaped') return end(w, true);
    if (raid.outcome === 'lost') return end(w, false);
    if (w.pendingLevels > 0) openChoices(w);
    return;
  }
  if (w.hp <= 0 && w.revives > 0) revive(w, g);
  if (w.hp <= 0) return end(w, false);
  if (!w.setup.endless && w.tick >= DAWN_TICK) return end(w, true);
  if (w.pendingLevels > 0) openChoices(w);
}

/** 把 (x, y) 半径 r 里的怪往外推（不伤血） */
function quake(w: World, g: Grid, x: number, y: number, r: number, knock: number): void {
  w.quake = false;
  const n = g.query(w, x, y, r);
  for (let q = 0; q < n; q++) {
    const i = g.out[q]!;
    const dx = w.eX[i]! - x;
    const dy = w.eY[i]! - y;
    const d = fsqrt(dx * dx + dy * dy);
    if (d <= 0) continue;
    const k = (knock * (1 - ENEMIES[w.eKind[i]!]!.steady)) / d / 3;
    w.eKX[i]! += dx * k;
    w.eKY[i]! += dy * k;
  }
}

/**
 * 更夫的锣：全屏的怪往后退（Boss 也退，只是退得少：steady）并挨一下，金钟罩补一层。
 * 伤害按等级涨，前期一声锣能清一片杂兵，后期是个定时的小清场，不靠它撑全场。
 */
function gong(w: World, g: Grid): void {
  quake(w, g, w.x, w.y, CHAR_FX.gongArea, CHAR_FX.gongKnock);
  const r2 = CHAR_FX.gongArea * CHAR_FX.gongArea;
  const dmg = CHAR_FX.gongDmg + CHAR_FX.gongPerLevel * w.level;
  for (let i = 0; i < MAX_ENEMIES; i++) {
    if (!w.eAlive[i]) continue;
    const dx = w.eX[i]! - w.x;
    const dy = w.eY[i]! - w.y;
    if (dx * dx + dy * dy <= r2) hitEnemy(w, i, dmg, -1, 0, 0, 0, 0, -1);
  }
  if (w.shield < w.shieldMax) w.shield++;
  w.ev.push(Ev.Gong, w.x, w.y, 0, CHAR_FX.gongArea);
}

/** 永久加成"复活"：原地站起来，半血，短暂无敌，震开身边 */
function revive(w: World, g: Grid): void {
  w.revives--;
  w.hp = Math.max(1, Math.round(w.stats.hpMax * REVIVE.hp));
  w.invuln = REVIVE.invuln;
  quake(w, g, w.x, w.y, REVIVE.area, REVIVE.knock);
  w.ev.push(Ev.Revive, w.x, w.y, w.revives, REVIVE.area);
}

/** 推出挡路的块：夜探的块几百个，走分桶的索引（推法和 maps.ts 的 pushOut 逐位一样） */
function push(w: World, p: { x: number; y: number }, r: number): boolean {
  return w.raid ? w.raid.map.index.pushOut(p, r) : w.index ? w.index.pushOut(p, r) : pushOut(w.blocks as readonly Block[], p, r);
}

function end(w: World, won: boolean): void {
  w.phase = 'over';
  w.won = won;
  w.ev.push(Ev.End, w.x, w.y, won ? 1 : 0, w.bossKilled ? 1 : 0);
}

// ───────────────────────── 主角 ─────────────────────────

function movePlayer(w: World, dir: number): void {
  w.moving = dir !== 0;
  const ice = w.ice.length > 0 && inRects(w.ice, w.x, w.y);
  if (dir !== 0) w.face = ((dir - 1) * (DIR_N / 32)) & (DIR_N - 1);
  if (ice) slidePlayer(w, dir);
  else {
    w.pvx = 0;
    w.pvy = 0;
    if (dir !== 0) {
      let sp = w.stats.speed * (w.tick < w.slowUntil ? PLAYER_SLOW : 1);
      if (w.water.length > 0 && inRects(w.water, w.x, w.y)) sp *= TERRAIN.waterMul;
      w.x = clamp(w.x + inputCos(dir) * sp, 20, w.arenaW - 20);
      w.y = clamp(w.y + inputSin(dir) * sp, 20, w.arenaH - 20);
      if (w.blocks.length) push(w, w, PLAYER.r);
    }
  }
  if (w.invuln > 0) w.invuln--;
}

/** 冰上：速度逐拍往输入方向靠，松手按摩擦慢慢停；撞到块的那个方向速度清零 */
function slidePlayer(w: World, dir: number): void {
  const sp = w.stats.speed * (w.tick < w.slowUntil ? PLAYER_SLOW : 1);
  if (dir !== 0) {
    w.pvx += (inputCos(dir) * sp - w.pvx) * TERRAIN.iceAccel;
    w.pvy += (inputSin(dir) * sp - w.pvy) * TERRAIN.iceAccel;
  } else {
    w.pvx *= 1 - TERRAIN.iceFriction;
    w.pvy *= 1 - TERRAIN.iceFriction;
    // 速度小到看不出来就停（免得指纹里永远拖着一串小数）
    if (w.pvx * w.pvx + w.pvy * w.pvy < 0.0004) {
      w.pvx = 0;
      w.pvy = 0;
    }
  }
  if (w.pvx === 0 && w.pvy === 0) return;
  const x0 = w.x;
  const y0 = w.y;
  w.x = clamp(x0 + w.pvx, 20, w.arenaW - 20);
  w.y = clamp(y0 + w.pvy, 20, w.arenaH - 20);
  if (w.blocks.length) push(w, w, PLAYER.r);
  // 被墙、石头、边界挡下的那一轴速度清零，不然会一直顶着滑
  if (Math.abs(w.x - x0 - w.pvx) > 0.01) w.pvx = 0;
  if (Math.abs(w.y - y0 - w.pvy) > 0.01) w.pvy = 0;
}

function regen(w: World): void {
  w.inIncense = w.incense.length > 0 && inRects(w.incense, w.x, w.y);
  const rate = w.stats.regen + (w.inIncense ? TERRAIN.incenseRegen : 0);
  if (rate <= 0 || w.hp >= w.stats.hpMax) return;
  w.regenAcc += (rate * (has(w, 'noheal') ? CURSE_FX.noheal : 1)) / 30;
  if (w.regenAcc >= 1) {
    w.hp = Math.min(w.stats.hpMax, w.hp + 1);
    w.regenAcc -= 1;
  }
}

function heal(w: World, n: number): void {
  w.hp = Math.min(w.stats.hpMax, w.hp + n);
}

/** by：谁打的（怪的编号；远程弹 = SHOT_BY + 弹种），只记给模拟器的死因统计，不进指纹、不影响结算 */
function hurt(w: World, dmg: number, by = -1): void {
  if (w.invuln > 0 || w.phase !== 'play') return;
  w.hurtBy = by;
  if (w.shield > 0) {
    // 金钟罩挡下这一下，碎的时候震开身边（下一拍出手时结算，那时有格子）
    w.shield--;
    w.shieldBurst = true;
    w.invuln = PLAYER.invuln;
    return;
  }
  const diff = dangerDef(w.setup.mode, w.setup.danger);
  const d = Math.max(1, Math.round(dmg * diff.dmgMul * (w.tick < EARLY_TICKS ? diff.earlyDmg : 1) * (w.setup.assist ? ASSIST.dmg : 1) - w.stats.armor));
  w.hp -= d;
  // 胖师叔：挨打时震开身边（下一拍有格子时结算）
  if (w.setup.character === 'pang') w.quake = true;
  // 第一局 3 分钟前不会死：血最少留 1
  if (w.setup.firstRun && w.tick < FIRST_RUN_GUARD && w.hp < 1) w.hp = 1;
  w.invuln = PLAYER.invuln;
  w.ev.push(Ev.Hurt, w.x, w.y, d);
}

// ───────────────────────── 刷怪 ─────────────────────────

function minuteOf(w: World): number {
  return w.tick / (60 * 30);
}

function freeEnemySlot(w: World): number {
  for (let i = 0; i < MAX_ENEMIES; i++) if (!w.eAlive[i]) return i;
  // 满了：把离主角最远的一只普通怪收掉（不掉东西），给新来的让位
  let far = -1;
  let fd = -1;
  for (let i = 0; i < MAX_ENEMIES; i++) {
    const def = ENEMIES[w.eKind[i]!]!;
    if (def.elite || def.boss) continue;
    const dx = w.eX[i]! - w.x;
    const dy = w.eY[i]! - w.y;
    const d = dx * dx + dy * dy;
    if (d > fd) {
      fd = d;
      far = i;
    }
  }
  if (far >= 0) {
    w.eAlive[far] = 0;
    w.eCount--;
  }
  return far;
}

function spawnEnemy(w: World, kind: EnemyKind, x: number, y: number): number {
  const i = freeEnemySlot(w);
  if (i < 0) return -1;
  const def = ENEMY_BY_KIND[kind];
  const diff = dangerDef(w.setup.mode, w.setup.danger);
  const min = minuteOf(w);
  const big = def.elite || def.boss;
  const size = big ? 1 : 0.88 + w.rSpawn.next() * 0.24;
  const twin = kind === 'boss' && diff.twinBoss ? TWIN_BOSS_HP : 1;
  // 夜探：离镇子中心越近，刷出来的怪越硬、下手越重
  const zone = w.raid ? raidZoneMul(w.raid.map, x, y) : null;
  const zHp = zone ? zone.hp : 1;
  const zDmg = zone ? zone.dmg : 1;
  const hp = (def.boss ? def.hp * diff.hpMul * twin : def.hp * (1 + SCALE.hpPerMin * min) * diff.hpMul) * zHp;
  w.eAlive[i] = 1;
  w.eGen[i]!++;
  w.eKind[i] = def.code;
  w.eX[i] = clamp(x, 10, w.arenaW - 10);
  w.eY[i] = clamp(y, 10, w.arenaH - 10);
  w.ePX[i] = w.eX[i]!;
  w.ePY[i] = w.eY[i]!;
  w.eKX[i] = 0;
  w.eKY[i] = 0;
  w.eVX[i] = 0;
  w.eVY[i] = 0;
  w.eHp[i] = hp;
  w.eHpMax[i] = hp;
  // 引魂灯：每级怪快 5%
  w.eSpeed[i] = def.speed * (big ? 1 : 0.9 + w.rSpawn.next() * 0.2) * (1 + 0.05 * w.stats.curse) * (has(w, 'fast') ? CURSE_FX.fastSpeed : 1);
  w.eDmg[i] = def.dmg * (1 + SCALE.dmgPerMin * min) * zDmg;
  w.eR[i] = def.r * size;
  w.eSize[i] = size;
  // 石兽的技能计时由夜探绑定守卫时设
  w.eT[i] = kind === 'boss' ? BOSS.every[0]! : kind === 'lord' ? LORD.every[0]! : kind === 'beast' ? 0 : w.rSpawn.int(HOP_PERIOD);
  w.ePhase[i] = 0;
  w.eS[i] = 0;
  w.eAX[i] = 0;
  w.eAY[i] = 0;
  w.eSlow[i] = 0;
  w.eBind[i] = 0;
  w.eV[i] = 0;
  if (kind === 'water') w.eT[i] = WATER.emerge;
  else if (kind === 'weasel') w.eAX[i] = -1;
  else if (kind === 'bamsprout') {
    // 竹精：先在地上冒一个圈，SPROUT.warn 拍后出土
    w.eT[i] = SPROUT.warn;
    w.ev.push(Ev.Mob, w.eX[i]!, w.eY[i]!, 0, SPROUT.r, SPROUT.warn);
  } else if (kind === 'drown') w.eT[i] = DROWN.emerge;
  else if (kind === 'bambooking') w.eT[i] = BAMBOO_KING.every[0]!;
  else if (kind === 'hebo') w.eT[i] = HEBO.every;
  else if (kind === 'frostsoul') w.eT[i] = FROSTSOUL.every;
  else if (kind === 'icicle') w.eT[i] = ICICLE.every;
  else if (kind === 'templeghost') w.eT[i] = TEMPLEGHOST.every;
  else if (kind === 'nightwatch') w.eT[i] = NIGHTWATCH.every;
  else if (kind === 'stonemonk') w.eT[i] = MONK.every;
  w.eHitAt.fill(0, i * WEAPON_SLOTS, (i + 1) * WEAPON_SLOTS);
  w.eCount++;
  if (big) w.ev.push(Ev.Arrive, w.eX[i]!, w.eY[i]!, def.code);
  if (def.boss) w.bossSlot = i;
  return i;
}

/**
 * 刷怪的一圈：刚好在屏幕外（横屏一屏约 1000 × 560 到 1080 × 500 单位，画面层 viewport.ts 的 worldZoom），
 * 椭圆横向宽；竖屏开的局（setup.tall）转 90°，纵向宽。出了场地就换到对面。
 */
export const RING = { long: 600, short: 360 };
function ringPoint(w: World, a: number, scale = 1): [number, number] {
  const rx = w.setup.tall ? RING.short : RING.long;
  const ry = w.setup.tall ? RING.long : RING.short;
  let x = w.x + dcos(a) * rx * scale;
  let y = w.y + dsin(a) * ry * scale;
  if (x < 10 || x > w.arenaW - 10) x = w.x - dcos(a) * rx * scale;
  if (y < 10 || y > w.arenaH - 10) y = w.y - dsin(a) * ry * scale;
  return [x, y];
}

function pickKind(w: World, mix: Partial<Record<EnemyKind, number>>): EnemyKind {
  // 地图偏好（义庄尸类多）乘在比例上
  const bias = MAPS[w.setup.map ?? 'snow'].mix;
  let total = 0;
  for (const k in mix) total += mix[k as EnemyKind]! * (bias?.[k as EnemyKind] ?? 1);
  let r = w.rSpawn.next() * total;
  let last: EnemyKind = 'paper';
  for (const k in mix) {
    last = k as EnemyKind;
    r -= mix[last]! * (bias?.[last] ?? 1);
    if (r < 0) return last;
  }
  return last;
}

/** 特色怪：本分钟合计占 total，抽中了返回那种怪，没抽中返回 null（交给原来的分钟表）；没登记的地图不抽随机数 */
function regionPick(w: World, region: Region | undefined, minute: number): EnemyKind | null {
  if (!region) return null;
  const t = regionTotal(region, minute);
  if (t <= 0) return null;
  const r = w.rSpawn.next();
  return r < t ? regionKind(region, minute, r) : null;
}

/** 刷在主角附近的钻地怪（水鬼、竹精、溺鬼）的落点 */
function nearPoint(w: World): [number, number] {
  const a = w.rSpawn.int(DIR_N);
  const d = WATER.near + w.rSpawn.next() * (WATER.far - WATER.near);
  return [w.x + dcos(a) * d, w.y + dsin(a) * d * 0.8];
}

/** 夜探的刷怪：先刷排队的守卫（开局地图上的、6:00 和 11:00 游荡的巡夜将），再按夜探的刷怪表补怪；没有尸王、老爷和收获期 */
function spawnRaid(w: World, raid: Raid): void {
  for (let gi = raid.takeSpawn(); gi >= 0; gi = raid.takeSpawn()) {
    const s = raid.guardSpawn(gi);
    const i = spawnEnemy(w, s.kind, s.x, s.y);
    if (i >= 0) raid.bindGuard(gi, i, w);
  }
  const m = raidMinute(w.tick);
  const diff = dangerDef(w.setup.mode, w.setup.danger);
  const curse = (1 + 0.1 * w.stats.curse) * (has(w, 'more') ? CURSE_FX.moreCount : 1);
  // 离镇子中心越近怪越多（按主角站的地方）
  const zone = raidZoneMul(raid.map, w.x, w.y).count;
  const keep = m.keep * diff.countMul * curse * zone;
  if (w.eCount >= keep) return;
  w.spawnAcc += ((w.eCount < keep / 2 ? 2 : 1) * m.rate * diff.countMul * curse * zone) / 30;
  while (w.spawnAcc >= 1) {
    w.spawnAcc -= 1;
    const kind = regionPick(w, RAID_REGIONS[raid.setup.template], Math.floor(w.tick / 1800)) ?? pickKind(w, m.mix);
    const [x, y] = EMERGE_KINDS.has(kind) ? nearPoint(w) : ringPoint(w, w.rSpawn.int(DIR_N));
    spawnP.x = x;
    spawnP.y = y;
    // 刷在墙里的这只就不刷了（推三次还压着墙）
    if (raidSpawnPoint(raid, spawnP)) spawnEnemy(w, kind, spawnP.x, spawnP.y);
  }
}
const spawnP = { x: 0, y: 0 };

function spawnWaves(w: World): void {
  if (w.raid) return spawnRaid(w, w.raid);
  // 定点事件
  while (w.nextEvent < w.schedule.length && w.tick >= w.schedule[w.nextEvent]!.at) {
    const e = w.schedule[w.nextEvent++]!;
    if (e.kind === 'boss') {
      const n = e.enemy === 'boss' && dangerDef(w.setup.mode, w.setup.danger).twinBoss ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const [x, y] = ringPoint(w, w.rSpawn.int(DIR_N), 0.8);
        spawnEnemy(w, e.enemy, x, y);
      }
    } else if (e.kind === 'front') {
      for (let k = 0; k < e.count; k++) {
        const a = w.face + w.rSpawn.int(44) - 22;
        const d = 260 + w.rSpawn.next() * 60;
        spawnEnemy(w, e.enemy, w.x + dcos(a) * d, w.y + dsin(a) * d);
      }
    } else if (e.kind === 'ring') {
      for (let k = 0; k < e.count; k++) {
        const a = (k * DIR_N) / e.count;
        spawnEnemy(w, e.enemy, w.x + dcos(a) * e.radius, w.y + dsin(a) * e.radius * 0.8);
      }
      w.calmUntil = Math.max(w.calmUntil, w.tick + CALM.afterSpike);
    } else if (e.kind === 'line') {
      const side = w.rSpawn.chance(0.5) ? -1 : 1;
      for (let k = 0; k < e.count; k++) {
        const i = spawnEnemy(w, e.enemy, w.x + side * 720, w.y + (k - e.count / 2) * 30);
        // 纸马排成一列横着冲过去（不追人）
        if (i >= 0 && e.enemy === 'horse') {
          w.eS[i] = 1;
          w.eAX[i] = -side;
          w.eAY[i] = 0;
        }
      }
      w.calmUntil = Math.max(w.calmUntil, w.tick + CALM.afterSpike);
    } else {
      for (let k = 0; k < e.count; k++) {
        const [x, y] = ringPoint(w, w.rSpawn.int(DIR_N), 0.85);
        spawnEnemy(w, e.enemy, x, y);
      }
    }
  }
  // 按分钟补怪
  const mi = Math.min(MINUTES.length - 1, Math.floor(minuteOf(w)));
  const m = MINUTES[mi]!;
  const diff = dangerDef(w.setup.mode, w.setup.danger);
  // 危险 0：怪种比例晚一分钟（更难的常规怪晚出）
  let mix = MINUTES[Math.max(0, Math.min(MINUTES.length - 1, mi + diff.mixShift))]!.mix;
  // 提灯鬼：危险 3 起第 5 分钟后占一成半到两成半（原来的比例整体让出这一份）；其余情形 mix 原样不动
  const lamp = lampShare(w.setup.mode, w.setup.danger, minuteOf(w));
  if (lamp > 0) {
    const next: Partial<Record<EnemyKind, number>> = {};
    let sum = 0;
    for (const k in mix) sum += mix[k as EnemyKind]!;
    for (const k in mix) next[k as EnemyKind] = (mix[k as EnemyKind]! / sum) * (1 - lamp);
    next.lampghost = lamp;
    mix = next;
  }
  // 引魂灯：每级怪多 10%；咒印"众"：多 25%
  const curse = (1 + 0.1 * w.stats.curse) * (has(w, 'more') ? CURSE_FX.moreCount : 1);
  const calm = w.tick < w.calmUntil ? CALM.keepMul : 1;
  // 香火引怪（荒庙）：站在香炉边，怪的上限和来的速度都往上加
  const lure = w.inIncense ? TERRAIN.incenseKeep : 1;
  const keep = m.keep * diff.countMul * curse * calm * lure;
  if (w.eCount >= keep) return;
  w.spawnAcc += ((w.eCount < keep / 2 ? 2 : 1) * m.rate * diff.countMul * curse * calm * (w.inIncense ? TERRAIN.incenseRate : 1)) / 30;
  while (w.spawnAcc >= 1) {
    w.spawnAcc -= 1;
    const kind = regionPick(w, VIGIL_REGIONS[w.setup.map ?? 'snow'], Math.max(0, mi + diff.mixShift)) ?? pickKind(w, mix);
    if (EMERGE_KINDS.has(kind)) {
      // 水鬼、竹精、溺鬼从主角附近的地里冒出来
      const [x, y] = nearPoint(w);
      spawnEnemy(w, kind, x, y);
    } else {
      const [x, y] = ringPoint(w, w.rSpawn.int(DIR_N));
      spawnEnemy(w, kind, x, y);
    }
  }
}

// ───────────────────────── 怪 ─────────────────────────

function markSlow(w: World, g: Grid): void {
  w.eSlow.fill(0);
  w.bellArea = 0;
  // 格子只有减速的查询要用（移动完会重建）：没有镇 3 件也没有镇魂铃就不建
  let built = false;
  // 镇 3 件：靠近主角（120 以内）的怪减速 20%（记 3；镇魂铃的光环更狠，后写覆盖）
  if (w.stats.nearSlow) {
    g.build(w);
    built = true;
    const n = g.query(w, w.x, w.y, 120);
    for (let j = 0; j < n; j++) w.eSlow[g.out[j]!] = 3;
  }
  for (let k = 0; k < w.weapons.length; k++) {
    const o = w.weapons[k]!;
    if (o.id !== 'bell') continue;
    const area = w.wstats[k]!.area * w.stats.areaMul;
    // 阴阳镇魂：光环里减速一半（记 2）；往生铃：光环里的怪死了回血（记下半径）
    const mark = w.merges.includes('yinyang') ? 2 : 1;
    if (o.evolved) w.bellArea = area;
    if (!built) {
      g.build(w);
      built = true;
    }
    const n = g.query(w, w.x, w.y, area);
    for (let j = 0; j < n; j++) w.eSlow[g.out[j]!] = mark;
  }
}

/** 守卫的技能打到主角走核心的 hurt；不在热路径上分配对象 */
const guardFx = {
  w: null as World | null,
  hurt(d: number): void {
    hurt(this.w!, d);
  },
};

function moveEnemies(w: World): void {
  // 开局减速对每只怪都一样，循环外算一次
  const openMul = w.tick < OPEN_TICKS ? dangerDef(w.setup.mode, w.setup.danger).openSlow : 1;
  for (let i = 0; i < MAX_ENEMIES; i++) {
    if (!w.eAlive[i]) continue;
    if (w.eBind[i]! > w.tick) {
      // 被捆住：原地不动，只吃击退
      w.eX[i] = clamp(w.eX[i]! + w.eKX[i]!, 10, w.arenaW - 10);
      w.eY[i] = clamp(w.eY[i]! + w.eKY[i]!, 10, w.arenaH - 10);
      w.eKX[i]! *= 0.72;
      w.eKY[i]! *= 0.72;
      continue;
    }
    const def = ENEMIES[w.eKind[i]!]!;
    const kind = def.kind;
    let dx = w.x - w.eX[i]!;
    let dy = w.y - w.eY[i]!;
    const d = fsqrt(dx * dx + dy * dy) || 1;
    dx /= d;
    dy /= d;
    // 离得太远的普通怪挪到主角前面的圈上（一直有压力，也不会被甩开）
    if (kind === 'weasel' && w.eS[i] === 1 && d > WEASEL.lose) {
      // 叼着铜钱跑远了：连钱一起没了
      w.eAlive[i] = 0;
      w.eCount--;
      continue;
    }
    if (d > 900 && !def.boss && !def.elite && !(kind === 'weasel' && w.eS[i] === 1)) {
      if (kind === 'horse') w.eS[i] = 0;
      const [x, y] = ringPoint(w, w.face + w.rAi.int(64) - 32);
      w.eX[i] = x;
      w.eY[i] = y;
      w.ePX[i] = x;
      w.ePY[i] = y;
      continue;
    }
    const slow = w.eSlow[i];
    let sp = w.eSpeed[i]! * (slow === 2 ? 0.5 : slow === 1 ? 0.62 : slow === 3 ? 0.8 : 1) * openMul;
    let vx = dx;
    let vy = dy;
    // 夜探的守卫：守在原地、追人、回家由 explore/guards.ts 算；own 为真时照这种怪自己的行为走（比如守铜箱的白狐追人时照常连冲）
    const gi = w.raid ? w.raid.guardAt(i, w.eGen[i]!) : -1;
    let own = true;
    if (gi >= 0) {
      guardFx.w = w;
      if (w.raid!.goblinGone(gi, w.tick)) {
        // 宝妖到点钻地跑了：不算击杀、不掉东西
        w.ev.push(Ev.Goblin, w.eX[i]!, w.eY[i]!, 1);
        w.eAlive[i] = 0;
        w.eCount--;
        continue;
      }
      const gs = guardStep(w.raid!, gi, w, i, guardFx);
      if (!GUARD_MOVE.own) {
        own = false;
        // 减速照样算（镇魂铃、镇 3 件对守卫也有用）
        sp = w.eSpeed[i]! > 0 ? (gs * sp) / w.eSpeed[i]! : gs;
        vx = GUARD_MOVE.vx;
        vy = GUARD_MOVE.vy;
      }
    }
    if (own) switch (kind) {
      case 'jiangshi':
      case 'general': {
        const t = (w.eT[i]! + 1) % HOP_PERIOD;
        w.eT[i] = t;
        sp = t < HOP_AIR ? sp * HOP_SPEED_MUL : 0;
        if (kind === 'general') {
          w.eS[i]!++;
          if (w.eS[i]! >= GENERAL.every) {
            w.eS[i] = 0;
            for (let k = 0; k < GENERAL.count; k++) {
              const a = (k * DIR_N) / GENERAL.count;
              spawnEnemy(w, 'jiangshi', w.eX[i]! + dcos(a) * GENERAL.ring, w.eY[i]! + dsin(a) * GENERAL.ring);
            }
          }
        }
        break;
      }
      case 'lantern': {
        if (d < LANTERN.range) sp = 0;
        w.eT[i]!--;
        if (w.eT[i]! <= 0 && d < LANTERN.range + 80) {
          w.eT[i] = LANTERN.every;
          addShot(w, Shot.Fireball, w.eX[i]!, w.eY[i]! - 20, dx * LANTERN.speed, dy * LANTERN.speed, LANTERN.life, LANTERN.dmg, LANTERN.r, 0, -1, 0);
        }
        break;
      }
      case 'fox':
      case 'whitefox': {
        // 0 走近 1 蓄力 2 冲刺；白狐连冲 WHITEFOX.chain 下（eV 记冲了几下）
        if (w.eS[i] === 0) {
          if (w.eT[i]! > 0) w.eT[i]!--;
          else if (d < FOX.trigger) {
            w.eS[i] = 1;
            w.eT[i] = FOX.windup;
            w.eAX[i] = dx;
            w.eAY[i] = dy;
          }
        } else if (w.eS[i] === 1) {
          sp = 0;
          if (--w.eT[i]! <= 0) {
            w.eS[i] = 2;
            w.eT[i] = FOX.dash;
          }
        } else {
          sp = FOX.dashSpeed;
          vx = w.eAX[i]!;
          vy = w.eAY[i]!;
          if (--w.eT[i]! <= 0) {
            if (kind === 'whitefox' && ++w.eV[i]! < WHITEFOX.chain) {
              w.eS[i] = 1;
              w.eT[i] = WHITEFOX.rewind;
              w.eAX[i] = dx;
              w.eAY[i] = dy;
            } else {
              w.eS[i] = 0;
              w.eV[i] = 0;
              w.eT[i] = FOX.rest;
            }
          }
        }
        break;
      }
      case 'horse':
        // 认准一个方向冲过去，不拐弯
        if (w.eS[i] === 0) {
          w.eS[i] = 1;
          w.eAX[i] = dx;
          w.eAY[i] = dy;
        }
        vx = w.eAX[i]!;
        vy = w.eAY[i]!;
        break;
      case 'water':
        if (w.eT[i]! > 0) {
          w.eT[i]!--;
          sp = 0;
        }
        break;
      case 'bat': {
        // 侧着乱晃：每 BAT.every 拍换一次（eAX 是侧向的分量）
        if (--w.eT[i]! <= 0) {
          w.eT[i] = BAT.every + w.rAi.int(BAT.every);
          w.eAX[i] = (w.rAi.next() - 0.5) * 2 * BAT.wobble;
        }
        const j = w.eAX[i]!;
        const n = 1 / fsqrt(1 + j * j);
        vx = (dx - dy * j) * n;
        vy = (dy + dx * j) * n;
        break;
      }
      case 'scarecrow':
        if (w.eS[i] === 0) {
          if (d < SCARECROW.wake) w.eS[i] = 1;
          else sp = 0;
        }
        break;
      case 'weasel':
        weaselAct(w, i, d);
        if (w.eS[i] === 1) {
          // 叼着钱往远处跑
          vx = -dx;
          vy = -dy;
          sp *= WEASEL.flee;
        } else if (w.eAX[i]! >= 0) {
          const t = w.eAX[i]!;
          const tx = w.dX[t]! - w.eX[i]!;
          const ty = w.dY[t]! - w.eY[i]!;
          const td = fsqrt(tx * tx + ty * ty) || 1;
          vx = tx / td;
          vy = ty / td;
        }
        break;
      case 'snow': {
        if (d < SNOW.range) sp = 0;
        w.eT[i]!--;
        if (w.eT[i]! <= 0 && d < SNOW.range + 80) {
          w.eT[i] = SNOW.every;
          addShot(w, Shot.Fireball, w.eX[i]!, w.eY[i]! - 20, dx * SNOW.speed, dy * SNOW.speed, SNOW.life, SNOW.dmg, SNOW.r, 1, -1, 0);
        }
        break;
      }
      case 'palanquin':
        if (++w.eS[i]! >= PALANQUIN.every) {
          w.eS[i] = 0;
          for (let k = 0; k < PALANQUIN.drop; k++) spawnEnemy(w, 'paper', w.eX[i]! - dx * 50 + (k - 1) * 24, w.eY[i]! - dy * 50);
        }
        break;
      case 'lord':
        lordAct(w, i, dx, dy);
        break;
      case 'bamsprout':
      case 'snakespirit':
      case 'bambooking':
      case 'drown':
      case 'crab':
      case 'hebo':
      case 'icegolem':
      case 'icicle':
      case 'templeghost':
      case 'frostsoul':
      case 'nightwatch':
      case 'stonemonk':
        mv.vx = vx;
        mv.vy = vy;
        mv.sp = sp;
        mobAct(w, i, kind, d, dx, dy);
        vx = mv.vx;
        vy = mv.vy;
        sp = mv.sp;
        break;
      case 'boss':
        sp = bossAct(w, i, sp);
        if (w.eS[i] === 1) {
          vx = w.eAX[i]!;
          vy = w.eAY[i]!;
        }
        break;
      default:
        break;
    }
    let mx = vx * sp;
    let my = vy * sp;
    let kd = 0.72;
    if (w.water.length + w.ice.length > 0 && !FLIES.has(kind)) {
      const ex = w.eX[i]!;
      const ey = w.eY[i]!;
      if (w.water.length > 0 && inRects(w.water, ex, ey)) {
        mx *= TERRAIN.waterMul;
        my *= TERRAIN.waterMul;
      }
      if (w.ice.length > 0) {
        if (inRects(w.ice, ex, ey)) {
          // 冰上：速度往想去的方向靠，停不住；击退也滑得远
          w.eVX[i]! += (mx - w.eVX[i]!) * TERRAIN.iceEnemyAccel;
          w.eVY[i]! += (my - w.eVY[i]!) * TERRAIN.iceEnemyAccel;
          mx = w.eVX[i]!;
          my = w.eVY[i]!;
          kd = TERRAIN.iceKnock;
        } else {
          w.eVX[i] = mx;
          w.eVY[i] = my;
        }
      }
    }
    w.eX[i] = clamp(w.eX[i]! + mx + w.eKX[i]!, 10, w.arenaW - 10);
    w.eY[i] = clamp(w.eY[i]! + my + w.eKY[i]!, 10, w.arenaH - 10);
    w.eKX[i]! *= kd;
    w.eKY[i]! *= kd;
  }
}

/** 飞的、水里的、冰上的怪不受水和冰影响（水鬼、溺鬼、河蟹、河伯在水里本来就自在，冰傀、冰锥、冰魄生在冰湖） */
const FLIES = new Set<EnemyKind>(['bat', 'water', 'drown', 'crab', 'hebo', 'icegolem', 'icicle', 'frostsoul']);
const tmpP = { x: 0, y: 0 };

/** 墙和棺材挡路：怪挪完、互相挤完以后再推出来（Boss 跳砸在空中，不挡） */
function blockEnemies(w: World): void {
  const boss = ENEMY_BY_KIND.boss.code;
  for (let i = 0; i < MAX_ENEMIES; i++) {
    if (!w.eAlive[i] || (w.eKind[i] === boss && w.eS[i] === 1)) continue;
    tmpP.x = w.eX[i]!;
    tmpP.y = w.eY[i]!;
    if (push(w, tmpP, w.eR[i]! * 0.7)) {
      w.eX[i] = tmpP.x;
      w.eY[i] = tmpP.y;
    }
  }
}

/** 特色怪这一拍对方向和速度的改动（moveEnemies 先填进来，mobAct 改完再取走） */
const mv = { vx: 0, vy: 0, sp: 0 };

function nearPlayer(w: World, i: number, r: number): boolean {
  const dx = w.x - w.eX[i]!;
  const dy = w.y - w.eY[i]!;
  return dx * dx + dy * dy < r * r;
}

/** 在 (x, y) 半径 r 里的主角挨 dmg（走 hurt，吃无敌帧和危险档倍数） */
function areaHurt(w: World, x: number, y: number, r: number, dmg: number, by: number): boolean {
  const dx = w.x - x;
  const dy = w.y - y;
  if (dx * dx + dy * dy >= r * r) return false;
  hurt(w, dmg, by);
  return true;
}

/** 在主角四周 ring 远的一圈上种 n 个怪（kind），起点角度随机 */
function surroundPlayer(w: World, kind: EnemyKind, n: number, ring: number): void {
  const off = w.rAi.int(DIR_N);
  for (let k = 0; k < n; k++) {
    const a = off + Math.floor((k * DIR_N) / n);
    spawnEnemy(w, kind, w.x + dcos(a) * ring, w.y + dsin(a) * ring * 0.8);
  }
}

/**
 * 各地区特色怪的行为（regions.ts 登记的怪）。每种的状态记在 eT / eS / eV / eAX / eAY：
 * - 竹精：eT 是出土前的倒数，出土那一拍砸一下圈里的人，之后就是追人的小怪；
 * - 蛇精：eS 0 藏着慢游 1 盘身 2 窜出（eAX/eAY 是方向）3 歇着；
 * - 竹王：eT 倒数到下一次破土；
 * - 溺鬼：eT 是冒出来的倒数，eS 2 = 抓着人（eV 是还剩几拍），eAX 是下次能抓的拍数；
 * - 河蟹：eT 数到 swap 换横走方向（eS 0/1）；河伯：eT 倒数到下一次涨潮；
 * - 冰凌：eT 倒数到下一次标点，eS 是落冰刺前的倒数（eAX/eAY 是落点）；
 * - 冰魄：eT 倒数到下一次蓄力，eS 是蓄力倒数，eV 数放了几次霜；
 * - 更夫鬼：eT 倒数到下一次敲梆；石僧：eT 倒数到停下蓄力，eS 是蓄力倒数。
 */
function mobAct(w: World, i: number, kind: EnemyKind, d: number, dx: number, dy: number): void {
  const x = w.eX[i]!;
  const y = w.eY[i]!;
  switch (kind) {
    case 'bamsprout':
      if (w.eT[i]! > 0) {
        mv.sp = 0;
        if (--w.eT[i]! === 0) {
          w.ev.push(Ev.Mob, x, y, 1, SPROUT.r);
          areaHurt(w, x, y, SPROUT.r, SPROUT.dmg, w.eKind[i]!);
        }
      }
      break;
    case 'snakespirit':
      if (w.eS[i] === 0) {
        mv.sp *= SNAKE.creep;
        if (d < SNAKE.trigger) {
          w.eS[i] = 1;
          w.eT[i] = SNAKE.windup;
          w.eAX[i] = dx;
          w.eAY[i] = dy;
        }
      } else if (w.eS[i] === 1) {
        mv.sp = 0;
        if (--w.eT[i]! <= 0) {
          w.eS[i] = 2;
          w.eT[i] = SNAKE.lunge;
          w.ev.push(Ev.Mob, x, y, 6, 0);
        }
      } else if (w.eS[i] === 2) {
        mv.sp = SNAKE.lungeSpeed;
        mv.vx = w.eAX[i]!;
        mv.vy = w.eAY[i]!;
        if (--w.eT[i]! <= 0) {
          w.eS[i] = 3;
          w.eT[i] = SNAKE.rest;
        }
      } else if (--w.eT[i]! <= 0) w.eS[i] = 0;
      break;
    case 'bambooking': {
      const phase = w.eHp[i]! * 2 < w.eHpMax[i]! ? 1 : 0;
      if (--w.eT[i]! <= 0) {
        w.eT[i] = BAMBOO_KING.every[phase]!;
        w.ev.push(Ev.Mob, x, y, 13, 0);
        surroundPlayer(w, 'bamsprout', BAMBOO_KING.sprouts[phase]!, BAMBOO_KING.ring);
      }
      break;
    }
    case 'drown':
      if (w.eT[i]! > 0) {
        mv.sp = 0;
        if (--w.eT[i]! === 0) w.ev.push(Ev.Mob, x, y, 2, 0, 0);
      } else if (w.eS[i] === 2) {
        // 抓着人：站住，把人往自己身边拖，脚下发沉
        mv.sp = 0;
        w.slowUntil = Math.max(w.slowUntil, w.tick + DROWN.slowTicks);
        if (d > 22) {
          w.x -= dx * DROWN.pull;
          w.y -= dy * DROWN.pull;
          if (w.blocks.length) push(w, w, PLAYER.r);
        }
        if (--w.eV[i]! <= 0) {
          w.eS[i] = 0;
          w.eAX[i] = w.tick + DROWN.cool;
        }
      } else if (d < DROWN.grab && w.tick >= w.eAX[i]! && w.phase === 'play') {
        w.eS[i] = 2;
        w.eV[i] = DROWN.hold;
        w.ev.push(Ev.Mob, x, y, 2, DROWN.grab, 1);
      }
      break;
    case 'crab': {
      if (++w.eT[i]! >= CRAB.swap) {
        w.eT[i] = 0;
        w.eS[i] = 1 - w.eS[i]!;
      }
      if (d > CRAB.pinch) {
        // 横着走：大半的力气用在绕圈上，只留一点往前蹭
        const sgn = w.eS[i] === 0 ? 1 : -1;
        const vx = dx * (1 - CRAB.side) - dy * CRAB.side * sgn;
        const vy = dy * (1 - CRAB.side) + dx * CRAB.side * sgn;
        const n = fsqrt(vx * vx + vy * vy) || 1;
        mv.vx = vx / n;
        mv.vy = vy / n;
      }
      break;
    }
    case 'hebo':
      if (--w.eT[i]! <= 0) {
        w.eT[i] = HEBO.every;
        w.ev.push(Ev.Mob, x, y, 7, 150);
        const off = w.rAi.int(DIR_N);
        for (let k = 0; k < HEBO.ring; k++) {
          const a = off + Math.floor((k * DIR_N) / HEBO.ring);
          addShot(w, Shot.Fireball, x, y - 24, dcos(a) * HEBO.shotSpeed, dsin(a) * HEBO.shotSpeed, HEBO.shotLife, HEBO.shotDmg, 11, 0, -1, 0);
        }
        surroundPlayer(w, 'drown', HEBO.drowns, HEBO.near);
      }
      break;
    case 'icicle':
      if (d < ICICLE.range) mv.sp = 0;
      if (w.eS[i]! > 0) {
        if (--w.eS[i]! === 0) {
          w.ev.push(Ev.Mob, w.eAX[i]!, w.eAY[i]!, 5, ICICLE.r);
          areaHurt(w, w.eAX[i]!, w.eAY[i]!, ICICLE.r, ICICLE.dmg, w.eKind[i]!);
        }
      } else if (--w.eT[i]! <= 0 && d < ICICLE.range + 80) {
        w.eT[i] = ICICLE.every;
        w.eS[i] = ICICLE.warn;
        w.eAX[i] = w.x;
        w.eAY[i] = w.y;
        w.ev.push(Ev.Mob, w.x, w.y, 4, ICICLE.r, ICICLE.warn);
      }
      break;
    case 'templeghost':
      // 庙祝鬼：远远站住，往主角脚下撒香灰（先画灰圈，落地迷眼走慢）；和冰凌一个路数，但会让人走慢，逼你离开香炉
      if (d < TEMPLEGHOST.range) mv.sp = 0;
      if (w.eS[i]! > 0) {
        if (--w.eS[i]! === 0) {
          w.ev.push(Ev.Mob, w.eAX[i]!, w.eAY[i]!, 15, TEMPLEGHOST.r);
          if (areaHurt(w, w.eAX[i]!, w.eAY[i]!, TEMPLEGHOST.r, TEMPLEGHOST.dmg, w.eKind[i]!)) w.slowUntil = Math.max(w.slowUntil, w.tick + TEMPLEGHOST.slowTicks);
        }
      } else if (--w.eT[i]! <= 0 && d < TEMPLEGHOST.range + 80) {
        w.eT[i] = TEMPLEGHOST.every;
        w.eS[i] = TEMPLEGHOST.warn;
        w.eAX[i] = w.x;
        w.eAY[i] = w.y;
        w.ev.push(Ev.Mob, w.x, w.y, 14, TEMPLEGHOST.r, TEMPLEGHOST.warn);
      }
      break;
    case 'frostsoul':
      if (w.eS[i]! > 0) {
        mv.sp = 0;
        if (--w.eS[i]! === 0) {
          w.ev.push(Ev.Mob, x, y, 9, FROSTSOUL.r);
          if (areaHurt(w, x, y, FROSTSOUL.r, FROSTSOUL.dmg, w.eKind[i]!)) w.slowUntil = Math.max(w.slowUntil, w.tick + FROSTSOUL.slowTicks);
          if (++w.eV[i]! % 2 === 0) {
            for (let k = 0; k < FROSTSOUL.golems; k++) spawnEnemy(w, 'icegolem', x + (k === 0 ? -50 : 50), y + 20);
          }
        }
      } else if (--w.eT[i]! <= 0) {
        w.eT[i] = FROSTSOUL.every;
        w.eS[i] = FROSTSOUL.warn;
        w.ev.push(Ev.Mob, x, y, 8, FROSTSOUL.r, FROSTSOUL.warn);
      }
      break;
    case 'nightwatch':
      if (--w.eT[i]! <= 0) {
        w.eT[i] = NIGHTWATCH.every;
        w.ev.push(Ev.Mob, x, y, 10, 0);
        if (w.eCount < NIGHTWATCH.cap) for (let k = 0; k < NIGHTWATCH.calls; k++) spawnEnemy(w, 'wisp', x + (k === 0 ? -34 : 34), y - 10);
      }
      break;
    case 'stonemonk':
      if (w.eS[i]! > 0) {
        mv.sp = 0;
        if (--w.eS[i]! === 0) {
          w.ev.push(Ev.Mob, x, y, 12, MONK.r);
          areaHurt(w, x, y, MONK.r, MONK.dmg, w.eKind[i]!);
        }
      } else if (--w.eT[i]! <= 0) {
        w.eT[i] = MONK.every;
        // 走近了才蓄力，远远的不白费
        if (nearPlayer(w, i, MONK.r + 60)) {
          w.eS[i] = MONK.warn;
          w.ev.push(Ev.Mob, x, y, 11, MONK.r, MONK.warn);
        }
      }
      break;
    default:
      break;
  }
}

/**
 * 竹子挨砍：以 (x, y) 为圆心、r 为半径的圈碰到哪丛竹子就扣血（法器的伤害 × 主角的威力），同一丛 chopGap 拍内只算一次；
 * 血到 0 就倒：从 w.blocks 里拿掉（怪和主角都能走过去），不再长回来。别的图 blockHp 是空的，直接返回。
 */
function chop(w: World, x: number, y: number, r: number, dmg: number): void {
  const hp = w.blockHp;
  if (hp.length === 0) return;
  let fell = false;
  const all = w.allBlocks;
  for (let k = 0; k < all.length; k++) {
    const h = hp[k]!;
    if (h <= 0 || h === Infinity || w.blockAt[k]! > w.tick) continue;
    const b = all[k]!;
    const nx = x < b.x ? b.x : x > b.x + b.w ? b.x + b.w : x;
    const ny = y < b.y ? b.y : y > b.y + b.h ? b.y + b.h : y;
    const dx = x - nx;
    const dy = y - ny;
    if (dx * dx + dy * dy > r * r) continue;
    w.blockAt[k] = w.tick + TERRAIN.chopGap;
    const left = h - Math.max(1, dmg * w.stats.might);
    hp[k] = left > 0 ? left : 0;
    w.ev.push(Ev.Chop, b.x + b.w / 2, b.y + b.h, k, left > 0 ? left / b.hp! : 0, left > 0 ? 0 : 1);
    if (left <= 0) fell = true;
  }
  if (fell) {
    w.blocks = all.filter((_b, k) => hp[k]! > 0);
    w.index = new BlockIndex(w.blocks as readonly RaidBlock[], w.arenaW);
  }
}

/**
 * 黄鼠狼：eAX 是盯上的那枚铜钱（掉落数组下标，-1 = 没盯上），eS 1 = 叼到了在跑，eV 是叼走了几枚。
 * 每 WEASEL.scan 拍找一次附近的铜钱；碰到就叼走。
 */
function weaselAct(w: World, i: number, d: number): void {
  if (w.eS[i] === 1) return;
  let t = w.eAX[i]!;
  if (t >= 0 && (!w.dAlive[t] || w.dKind[t] !== Drop.Coin || w.dPull[t] !== 0)) t = w.eAX[i] = -1;
  if (t >= 0) {
    const tx = w.dX[t]! - w.eX[i]!;
    const ty = w.dY[t]! - w.eY[i]!;
    if (tx * tx + ty * ty < 18 * 18) {
      w.eV[i]! += w.dVal[t]!;
      w.dAlive[t] = 0;
      w.dCount--;
      w.eS[i] = 1;
      w.eAX[i] = -1;
      w.ev.push(Ev.Steal, w.eX[i]!, w.eY[i]!, w.eV[i]!);
    }
    return;
  }
  if (--w.eT[i]! > 0 || d > WEASEL.range * 1.5) return;
  w.eT[i] = WEASEL.scan;
  let bd = WEASEL.range * WEASEL.range;
  for (let s = 0; s < MAX_DROPS; s++) {
    if (!w.dAlive[s] || w.dKind[s] !== Drop.Coin || w.dPull[s] !== 0) continue;
    const dx = w.dX[s]! - w.eX[i]!;
    const dy = w.dY[s]! - w.eY[i]!;
    const dd = dx * dx + dy * dy;
    if (dd < bd) {
      bd = dd;
      w.eAX[i] = s;
    }
  }
}

/**
 * 尸王：eT 倒数到下一个技能；eS = 1 时正在跳砸（eAX/eAY 是每拍的位移方向，速度另算）。
 * 跳砸：在主角站的地方画圈警告，boss 用 stompWarn 拍跳过去，落地一圈伤害。
 */
function bossAct(w: World, i: number, sp: number): number {
  const phase = bossPhase(w, i, BOSS.phaseAt);
  const raged = phase === 2;
  const stompR = BOSS.stompRadius * (raged ? BOSS.ragedStomp : 1);
  if (w.eS[i] === 1) {
    // 跳砸中：直线飞向落点
    if (--w.eT[i]! <= 0) {
      w.eS[i] = 0;
      w.eT[i] = BOSS.every[phase]!;
      w.ev.push(Ev.Boss, w.eX[i]!, w.eY[i]!, 1, stompR);
      const dx = w.x - w.eX[i]!;
      const dy = w.y - w.eY[i]!;
      if (dx * dx + dy * dy < stompR * stompR) hurt(w, BOSS.stompDmg, w.eKind[i]!);
      return 0;
    }
    return w.eV[i]!;
  }
  if (--w.eT[i]! > 0) return sp;
  // 一段只有跳砸和召唤；二段起加尸气
  const skill = w.rAi.int(phase === 0 ? 2 : 3);
  if (skill === 0) {
    // 落点：主角现在的位置；每拍走 (距离 / 拍数)，这一跳的速度记在 eV
    const tx = w.x;
    const ty = w.y;
    const dx = tx - w.eX[i]!;
    const dy = ty - w.eY[i]!;
    const d = fsqrt(dx * dx + dy * dy) || 1;
    w.eS[i] = 1;
    w.eT[i] = BOSS.stompWarn;
    w.eAX[i] = dx / d;
    w.eAY[i] = dy / d;
    w.eV[i] = d / BOSS.stompWarn;
    w.ev.push(Ev.Boss, tx, ty, 0, stompR);
    return 0;
  }
  w.eT[i] = BOSS.every[phase]!;
  if (skill === 1) {
    w.ev.push(Ev.Boss, w.eX[i]!, w.eY[i]!, 2, 90);
    const n = raged ? BOSS.ragedSummon : BOSS.summon;
    for (let k = 0; k < n; k++) {
      const a = (k * DIR_N) / n;
      spawnEnemy(w, 'jiangshi', w.eX[i]! + dcos(a) * 90, w.eY[i]! + dsin(a) * 90);
    }
  } else {
    w.ev.push(Ev.Boss, w.eX[i]!, w.eY[i]!, 3, 0);
    // 三段：两圈，第二圈错开半格、慢一点
    for (let ring = 0; ring < (raged ? 2 : 1); ring++) {
      const n = BOSS.breath + 6 * ring;
      const off = w.rAi.int(DIR_N);
      const v = BOSS.breathSpeed * (ring === 0 ? 1 : 0.7);
      for (let k = 0; k < n; k++) {
        const a = off + Math.floor((k * DIR_N) / n);
        addShot(w, Shot.Fireball, w.eX[i]!, w.eY[i]! - 30, dcos(a) * v, dsin(a) * v, 240, BOSS.breathDmg, 12, 0, -1, 0);
      }
    }
  }
  return sp;
}

/** Boss 现在是第几段（血线 at 从高到低）；刚进新一段时发一个事件（a = 4，b = 段号），画面层吼一声、出横幅 */
function bossPhase(w: World, i: number, at: readonly number[]): number {
  const f = w.eHp[i]! / w.eHpMax[i]!;
  let p = 0;
  while (p < at.length && f < at[p]!) p++;
  if (p > w.ePhase[i]!) {
    w.ePhase[i] = p;
    w.ev.push(Ev.Boss, w.eX[i]!, w.eY[i]!, 4, p, w.eKind[i]!);
  }
  return w.ePhase[i]!;
}

/** 纸扎老爷：eT 倒数到下一个技能，eS 数放了几个技能（二段每第三个召纸轿），eAX 是纸钱圈转到的方向 */
function lordAct(w: World, i: number, dx: number, dy: number): void {
  const phase = bossPhase(w, i, [0.5]);
  if (--w.eT[i]! > 0) return;
  w.eT[i] = LORD.every[phase]!;
  w.eS[i]!++;
  if (phase === 1 && w.eS[i]! % 3 === 0) {
    let have = 0;
    for (let k = 0; k < MAX_ENEMIES; k++) if (w.eAlive[k] && w.eKind[k] === PALANQUIN_CODE) have++;
    if (have < LORD.maxPalanquin) {
      // 召来的纸轿不掉宝箱（eV = 1）
      const j = spawnEnemy(w, 'palanquin', w.eX[i]! - dx * 90, w.eY[i]! - dy * 90);
      if (j >= 0) w.eV[j] = 1;
      w.ev.push(Ev.Boss, w.eX[i]!, w.eY[i]!, 5, 0);
      return;
    }
  }
  // 撒纸钱：一圈（二段两圈，第二圈错开半格）慢慢旋开
  w.ev.push(Ev.Boss, w.eX[i]!, w.eY[i]!, 6, 0);
  w.eAX[i] = (w.eAX[i]! + 5) & (DIR_N - 1);
  for (let ring = 0; ring <= phase; ring++) {
    const off = w.eAX[i]! + ring * (DIR_N / LORD.money / 2);
    const v = LORD.moneySpeed * (ring === 0 ? 1 : 0.8);
    for (let k = 0; k < LORD.money; k++) {
      const a = off + Math.floor((k * DIR_N) / LORD.money);
      addShot(w, Shot.Fireball, w.eX[i]!, w.eY[i]! - 40, dcos(a) * v, dsin(a) * v, LORD.moneyLife, LORD.moneyDmg, LORD.moneyR, 2, -1, ring);
    }
  }
}
const PALANQUIN_CODE = ENEMY_BY_KIND.palanquin.code;

/**
 * 挤开的力度：每次推的比例。原来每拍推 0.5，现在隔一拍推一次，补成 2 倍（平均力度不变：实测对局里重叠对数、重叠深度和每拍推 0.5 时一致）。
 * 两只怪互相推的份额加起来正好是重叠的深度，所以 1.0 一次最多推到刚好不重叠，不会过冲。
 */
const SEP_PUSH = 1.0;

/** 怪与怪之间轻推挤：只和同格、邻格的比；隔一拍做一次（按拍的奇偶），省一半的格子扫描 */
function separate(w: World, g: Grid): void {
  if ((w.tick & 1) === 0) return;
  const alive = w.eAlive;
  const bind = w.eBind;
  const ex = w.eX;
  const ey = w.eY;
  const er = w.eR;
  const start = g.start;
  const items = g.items;
  const cols = g.cols;
  const tick = w.tick;
  let left = w.eCount;
  for (let i = 0; i < MAX_ENEMIES && left > 0; i++) {
    if (!alive[i]) continue;
    left--;
    // 被捆住的像钉在地上：别的怪挤它，它不让开（挤的那只自己绕开）
    if (bind[i]! > tick) continue;
    // 和 g.query 一样的格子范围和顺序；候选的判断用挤之前的位置（xi, yi），挤的时候只改 i 自己，
    // 所以边找边挤和"先找齐再挤"结果逐位相同，省掉中间的结果数组
    const xi = ex[i]!;
    const yi = ey[i]!;
    const ri = er[i]!;
    g.span(xi, yi, ri + 50);
    const cx0 = g.x0;
    const cx1 = g.x1;
    const cy0 = g.y0;
    const cy1 = g.y1;
    for (let cy = cy0; cy <= cy1; cy++) {
      const k1 = start[cy * cols + cx1 + 1]!;
      for (let k = start[cy * cols + cx0]!; k < k1; k++) {
        const o = items[k]!;
        if (alive[o] === 0) continue;
        const rr = ri + er[o]!;
        const qx = ex[o]! - xi;
        const qy = ey[o]! - yi;
        if (qx * qx + qy * qy > rr * rr) continue;
        if (o === i) continue;
        const dx = ex[i]! - ex[o]!;
        const dy = ey[i]! - ey[o]!;
        const d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
        if (d2 < 1e-6) {
          // 完全重叠：按槽位号错开，方向确定
          ex[i]! += i < o ? -0.5 : 0.5;
          continue;
        }
        const d = fsqrt(d2);
        // 大的推小的：按半径分配
        const share = er[o]! / rr;
        const push = ((rr - d) / d) * SEP_PUSH * share;
        ex[i]! += dx * push;
        ey[i]! += dy * push;
      }
    }
  }
}

// ───────────────────────── 打怪 ─────────────────────────

/** 打一下。slot 是法器槽（同一件法器对同一只有冷却），-1 不算冷却。返回打没打到 */
/** slot：法器槽位（同一件法器对同一只怪 rehit 拍内只打一次；-1 不限）；credit：伤害记到哪件法器名下 */
function hitEnemy(w: World, i: number, dmg: number, slot: number, kx: number, ky: number, knock: number, rehit: number, credit = slot): boolean {
  if (!w.eAlive[i]) return false;
  if (slot >= 0) {
    const k = i * WEAPON_SLOTS + slot;
    if (w.eHitAt[k]! > w.tick) return false;
    w.eHitAt[k] = w.tick + rehit;
  }
  const crit = w.rHit.next() < PLAYER.crit * (1 + w.stats.luck) + w.stats.critAdd + (w.moving && w.setup.character === 'jianxia' ? CHAR_FX.jianxiaCrit : 0);
  // 捆仙绳：捆住的挨打加倍
  const bound = w.stats.bindDouble && w.eBind[i]! > w.tick ? 2 : 1;
  // 镇 3 件：被减速（近身、镇魂铃光环）的怪挨打 +25%
  const pinned = w.stats.nearSlow && w.eSlow[i] !== 0 ? 1.25 : 1;
  // 怪对这件法器的克制（类型、五行）
  const owner = credit >= 0 ? w.weapons[credit] : undefined;
  const vs = owner ? VS[w.eKind[i]! * WEAPON_IDS.length + WEAPON_CODE[owner.id]]! : 1;
  const d = Math.max(1, Math.round(dmg * bound * pinned * vs * w.stats.might * (crit ? PLAYER.critMul + w.stats.critDmg : 1)));
  w.eHp[i]! -= d;
  // 结算页的"每件法器打了多少"：只记，不影响规则
  const owned = owner;
  if (owned) owned.dmg += d;
  const def = ENEMIES[w.eKind[i]!]!;
  const kd = fsqrt(kx * kx + ky * ky);
  if (kd > 0 && knock > 0) {
    const k = (knock * (1 - def.steady)) / kd / 3;
    w.eKX[i]! += kx * k;
    w.eKY[i]! += ky * k;
  }
  w.eLastHit[i] = w.tick;
  w.eLastBy[i] = credit;
  // b：1 暴击，2 打在怕的地方，4 被扛住（画面层换数字颜色）
  w.ev.push(Ev.Hit, w.eX[i]!, w.eY[i]!, d, (crit ? 1 : 0) | (vs > 1 ? 2 : vs < 1 ? 4 : 0), i);
  if (w.eHp[i]! <= 0) {
    if (owned) owned.kills++;
    const x = w.eX[i]!;
    const y = w.eY[i]!;
    killEnemy(w, i);
    // 千鹤引魂：纸鹤啄死的怪变成一只小纸鹤（同时最多 12 只，飞 5 秒）
    if (owned && owned.id === 'crane' && owned.evolved) spawnMiniCrane(w, credit, x, y);
  }
  return true;
}

/** 克制表：怪种类 × 法器 → 伤害倍数（类型和五行连乘），开局算一次，命中时查表 */
const VS = (() => {
  const t = new Float64Array(ENEMIES.length * WEAPON_IDS.length).fill(1);
  for (const e of ENEMIES) {
    if (!e.vs) continue;
    WEAPON_IDS.forEach((id, k) => {
      const def = WEAPONS[id];
      t[e.code * WEAPON_IDS.length + k] = (e.vs![def.type] ?? 1) * (e.vs![def.el] ?? 1);
    });
  }
  return t;
})();

function spawnMiniCrane(w: World, k: number, x: number, y: number): void {
  let n = 0;
  for (let s = 0; s < MAX_SHOTS; s++) if (w.sAlive[s] && w.sKind[s] === Shot.Crane && w.sIdx[s]! >= MINI_CRANE) n++;
  if (n >= 12) return;
  const s = addShot(w, Shot.Crane, x, y - 30, 0, 0, 0, eff(w, w.wstats[k]!).dmg * 0.6, 22, 0, k, MINI_CRANE + n);
  if (s >= 0) w.sDist[s] = 150;
}

/** 小纸鹤的编号从这里起（和常驻的纸鹤分开：不算数量、到时候就散） */
const MINI_CRANE = 1000;

function otherBoss(w: World): number {
  for (let j = 0; j < MAX_ENEMIES; j++) if (w.eAlive[j] && ENEMIES[w.eKind[j]!]!.boss) return j;
  return -1;
}

function killEnemy(w: World, i: number): void {
  const def = ENEMIES[w.eKind[i]!]!;
  w.eAlive[i] = 0;
  w.eCount--;
  w.kills++;
  const x = w.eX[i]!;
  const y = w.eY[i]!;
  w.ev.push(Ev.Kill, x, y, def.code, def.elite ? 1 : 0, i);
  // 往生铃：光环里死的怪给主角回 1 点血，最多每 6 拍一次
  if (w.bellArea > 0 && w.tick >= w.bellHealAt) {
    const dx = x - w.x;
    const dy = y - w.y;
    if (dx * dx + dy * dy <= w.bellArea * w.bellArea) {
      heal(w, 1);
      w.bellHealAt = w.tick + 6;
    }
  }
  if (w.bossSlot === i) w.bossSlot = otherBoss(w);
  // 夜探：宝妖掉宝物（不掉升级宝箱）、钥匙（explore/raid.ts）
  if (w.raid && w.raid.onKill(i, w.eGen[i]!, !!def.elite || !!def.boss, x, y, w)) {
    for (let k = 0; k < 4; k++) addDrop(w, Drop.Soul, x + (w.rDrop.next() - 0.5) * 50, y + (w.rDrop.next() - 0.5) * 36, def.xp / 4);
    return;
  }
  if (def.kind === 'boss') {
    // 危险 5 两只尸王：两只都倒了才算
    for (let j = 0; j < MAX_ENEMIES; j++) if (w.eAlive[j] && ENEMIES[w.eKind[j]!]!.kind === 'boss') return;
    w.bossKilled = true;
    if (w.phase === 'play') end(w, true);
    return;
  }
  if (def.kind === 'lord') {
    // 中期 Boss：掉宝箱和一把魂珠，进收获期
    w.calmUntil = Math.max(w.calmUntil, w.tick + CALM.afterElite);
    addDrop(w, Drop.Chest, x, y, chestSize(w, CHEST.lordMin));
    for (let k = 0; k < 10; k++) addDrop(w, Drop.Soul, x + (w.rDrop.next() - 0.5) * 90, y + (w.rDrop.next() - 0.5) * 60, def.xp / 10);
    return;
  }
  if (def.elite) {
    w.calmUntil = Math.max(w.calmUntil, w.tick + CALM.afterElite);
    if (def.kind === 'palanquin') {
      for (let k = 0; k < PALANQUIN.burst; k++) {
        const a = (k * DIR_N) / PALANQUIN.burst;
        spawnEnemy(w, 'paper', x + dcos(a) * 40, y + dsin(a) * 32);
      }
    }
    // 纸扎老爷召来的纸轿（eV = 1）不掉宝箱
    if (!(def.kind === 'palanquin' && w.eV[i] === 1)) addDrop(w, Drop.Chest, x, y, w.raid ? 1 : chestSize(w, 1));
    for (let k = 0; k < 6; k++) addDrop(w, Drop.Soul, x + (w.rDrop.next() - 0.5) * 60, y + (w.rDrop.next() - 0.5) * 40, def.xp / 6);
    return;
  }
  // 枯骨散成两只小的（小的不再散）
  if (def.kind === 'bone' && w.eSize[i]! > BONE.size + 0.1) {
    const hp = w.eHpMax[i]! * BONE.hp;
    for (let k = 0; k < BONE.split; k++) {
      const j = spawnEnemy(w, 'bone', x + (k === 0 ? -14 : 14), y);
      if (j < 0) continue;
      w.eSize[j] = BONE.size;
      w.eR[j] = def.r * BONE.size;
      w.eHp[j] = hp;
      w.eHpMax[j] = hp;
    }
  }
  // 冰傀碎成两个小的（小的不再碎）
  if (def.kind === 'icegolem' && w.eSize[i]! > ICEGOLEM.size + 0.1) {
    const hp = w.eHpMax[i]! * ICEGOLEM.hp;
    w.ev.push(Ev.Mob, x, y, 3, 36);
    for (let k = 0; k < 2; k++) {
      const j = spawnEnemy(w, 'icegolem', x + (k === 0 ? -16 : 16), y);
      if (j < 0) continue;
      w.eSize[j] = ICEGOLEM.size;
      w.eR[j] = def.r * ICEGOLEM.size;
      w.eHp[j] = hp;
      w.eHpMax[j] = hp;
    }
  }
  // 黄鼠狼：叼走的铜钱双倍还回来
  if (def.kind === 'weasel' && w.eS[i] === 1) addDrop(w, Drop.Coin, x, y, w.eV[i]! * WEASEL.payback);
  addDrop(w, Drop.Soul, x, y, def.xp);
  const r = w.rDrop.next();
  const more = w.tick < w.calmUntil ? CALM.dropMul : 1;
  // 受伤补偿：血低时肉包多掉，补出来的那部分有冷却
  const mercy = w.hp < w.stats.hpMax * MERCY.hp && w.tick >= w.mercyAt ? MERCY.bun : 1;
  if (r < DROPS.scroll) addDrop(w, Drop.Scroll, x + 8, y, 1);
  else if (r < DROPS.scroll + DROPS.bun * more * mercy) {
    if (r >= DROPS.scroll + DROPS.bun * more) w.mercyAt = w.tick + MERCY.gap;
    addDrop(w, Drop.Bun, x + 8, y, DROPS.bunHeal);
  }
  else if (r < DROPS.scroll + DROPS.bun * more * mercy + DROPS.coin * more) addDrop(w, Drop.Coin, x + 8, y, 1);
  else if (r < DROPS.scroll + DROPS.bun * more * mercy + DROPS.coin * more + DROPS.bomb) addDrop(w, Drop.Bomb, x + 8, y, 1);
  else if (r < DROPS.scroll + DROPS.bun * more * mercy + DROPS.coin * more + DROPS.bomb + DROPS.purse) addDrop(w, Drop.Purse, x + 8, y, 1);
}

/** 精英宝箱升几件：1 / 3 / 5（至少 min） */
function chestSize(w: World, min: number): number {
  const r = w.rChest.next();
  const n = r < CHEST.five ? 5 : r < CHEST.five + CHEST.three ? 3 : 1;
  return n < min ? min : n;
}

function eff(w: World, s: WeaponStats): { dmg: number; cd: number; area: number; amount: number } {
  return { dmg: s.dmg, cd: Math.max(4, Math.round(s.cd * w.stats.cdMul)), area: s.area * w.stats.areaMul, amount: s.amount + w.stats.amount };
}

/** 离 (x, y) 最近的怪（r 以内），没有为 -1 */
function nearest(w: World, g: Grid, x: number, y: number, r: number, skip = -1): number {
  const n = g.query(w, x, y, r);
  let best = -1;
  let bd = Infinity;
  for (let j = 0; j < n; j++) {
    const i = g.out[j]!;
    if (i === skip) continue;
    const dx = w.eX[i]! - x;
    const dy = w.eY[i]! - y;
    const d = dx * dx + dy * dy;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

function fireWeapons(w: World, g: Grid): void {
  for (let k = 0; k < w.weapons.length; k++) {
    const wp = w.weapons[k]!;
    const s = w.wstats[k]!;
    const e = eff(w, s);
    switch (wp.id) {
      case 'sword':
        if (--wp.timer <= 0) {
          wp.timer = e.cd;
          swordSwing(w, g, k, s, e);
        }
        break;
      case 'talisman':
        if (--wp.timer <= 0) {
          wp.timer = e.cd;
          fireTalismans(w, g, k, s, e);
        }
        break;
      case 'coins':
        coinsTick(w, k, wp, s, e);
        break;
      case 'flysword':
        flyTick(w, g, k, wp, s, e);
        break;
      case 'thunder':
        if (--wp.timer <= 0) {
          wp.timer = e.cd;
          thunder(w, g, k, s, e);
        }
        break;
      case 'bell':
        if (--wp.timer <= 0) {
          wp.timer = e.cd;
          w.ev.push(Ev.Bell, w.x, w.y, 0, e.area);
          const n = g.query(w, w.x, w.y, e.area);
          for (let j = 0; j < n; j++) scratch[j] = g.out[j]!;
          for (let j = 0; j < n; j++) {
            const i = scratch[j]!;
            hitEnemy(w, i, e.dmg, k, w.eX[i]! - w.x, w.eY[i]! - w.y, s.knock, s.rehit);
          }
        }
        break;
      case 'mirror':
        if (--wp.timer <= 0) {
          wp.timer = e.cd;
          w.ev.push(Ev.Fire, w.x, w.y, WEAPON_CODE.mirror);
          // 几道光波一起放出去，后面的晚 8 拍（起始半径是负的）
          // 阴阳镇魂：光波从镇魂铃光环的边上放出去
          const from = w.merges.includes('yinyang') ? w.bellArea : 0;
          for (let j = 0; j < e.amount; j++) {
            const i = addShot(w, Shot.Wave, w.x, w.y, 0, 0, 1 << 30, e.dmg, from - j * 8 * s.speed, wp.evolved ? 1 : 0, k, j);
            if (i >= 0) w.sDist[i] = e.area + from;
            w.ev.push(Ev.Wave, w.x, w.y, j * 8, e.area + from, s.speed);
          }
        }
        break;
      case 'gourd':
        gourdTick(w, g, k, wp, s, e);
        break;
      case 'rope':
        if (--wp.timer <= 0) wp.timer = rope(w, g, k, s, e) ? e.cd : 10;
        // 捆住的怪被勒着：每半秒挨一半的伤害（只捆不打的话镇守流派杀不动人）
        if (w.tick % 15 === 0) {
          for (let i = 0; i < MAX_ENEMIES; i++) if (w.eAlive[i] && w.eBind[i]! > w.tick) hitEnemy(w, i, e.dmg * 0.5, -1, 0, 0, 0, 0, k);
        }
        break;
      case 'petals':
        if (--wp.timer <= 0) {
          wp.timer = e.cd;
          // 这一阵最多回 2 点血（十里桃林 5 点；记在 phase 上，花瓣砸中时扣）
          wp.phase = wp.evolved ? 5 : 2;
          w.ev.push(Ev.Fire, w.x, w.y, WEAPON_CODE.petals);
          // 一半以上的花瓣落在范围里的怪头上（带点偏），其余随手撒；全随机的话大多砸在空地上
          const n = g.query(w, w.x, w.y, e.area);
          for (let q = 0; q < n; q++) scratch[q] = g.out[q]!;
          for (let j = 0; j < e.amount; j++) {
            let px: number;
            let py: number;
            if (n > 0 && j % 3 !== 2) {
              const t = scratch[w.rWeapon.int(n)]!;
              px = w.eX[t]! + (w.rWeapon.next() - 0.5) * 30;
              py = w.eY[t]! + (w.rWeapon.next() - 0.5) * 24;
            } else {
              const a = w.rWeapon.int(DIR_N);
              const r = fsqrt(w.rWeapon.next()) * e.area;
              px = w.x + dcos(a) * r;
              py = w.y + dsin(a) * r * 0.8;
            }
            addShot(w, Shot.Petal, px, py, 0, 0, s.duration + j * 2, e.dmg, 34, 0, k, j);
          }
        }
        break;
      case 'shield':
        shieldTick(w, g, k, wp, s, e);
        break;
      case 'crane':
        craneTick(w, g, k, wp, s, e);
        break;
      case 'zhibing':
        paperTick(w, k, wp, s, e);
        break;
    }
  }
}

/** 火葫芦：没在喷时找最近的怪定方向；喷的那几拍，扇面里的怪隔 rehit 拍挨一下 */
function gourdTick(w: World, g: Grid, k: number, wp: { timer: number; phase: number; angle: number; evolved: boolean }, s: WeaponStats, e: { dmg: number; cd: number; area: number; amount: number }): void {
  if (wp.phase > 0) {
    wp.phase--;
    // 火舌跟着最近的怪转（每 6 拍重新瞄一次）：人一直在走，定死方向的话喷一会儿就喷空了
    if (wp.phase % 6 === 0) {
      const t = nearest(w, g, w.x, w.y, e.area * 1.2);
      if (t >= 0) wp.angle = dirIndex(w.eX[t]! - w.x, w.eY[t]! - w.y);
    }
    const ux = dcos(wp.angle);
    const uy = dsin(wp.angle);
    // 半宽：基础 ±28°，扇面每宽 1 级多 6°（换算成方向表格数）
    const half = Math.round(((28 + 6 * (e.amount - 1)) * DIR_N) / 360);
    const c = dcos(half);
    const c2 = c * c;
    if (wp.phase % 2 === 0) w.ev.push(Ev.Flame, w.x, w.y - 18, wp.angle, e.area, half);
    chop(w, w.x + ux * e.area * 0.55, w.y + uy * e.area * 0.55, e.area * 0.45, e.dmg);
    // 三昧真火：每 6 拍在火舌中段留一摊火
    if (wp.evolved && wp.phase % 6 === 0) {
      const a = wp.angle + w.rWeapon.int(half * 2 + 1) - half;
      const r = e.area * (0.35 + w.rWeapon.next() * 0.45);
      const life = Math.round(90 * w.stats.durMul);
      const bx = w.x + dcos(a) * r;
      const by = w.y + dsin(a) * r;
      addShot(w, Shot.Burn, bx, by, 0, 0, life, e.dmg * 0.5, 40, 0, k, 0);
      w.ev.push(Ev.Burn, bx, by, 0, 40, life);
    }
    const n = g.query(w, w.x, w.y, e.area);
    for (let q = 0; q < n; q++) scratch[q] = g.out[q]!;
    for (let q = 0; q < n; q++) {
      const i = scratch[q]!;
      const dx = w.eX[i]! - w.x;
      const dy = w.eY[i]! - w.y;
      const dot = dx * ux + dy * uy;
      if (dot <= 0 || dot * dot < c2 * (dx * dx + dy * dy)) continue;
      hitEnemy(w, i, e.dmg, k, ux, uy, s.knock, s.rehit);
    }
    // 火舌把扇面里飞来的冰锥、纸钱、火球都烧掉（火流派没有飞剑和铜钱，靠这个顶远程怪）
    const r2 = e.area * e.area;
    for (let q = 0; q < MAX_SHOTS; q++) {
      if (!w.sAlive[q] || w.sKind[q] !== Shot.Fireball) continue;
      const dx = w.sX[q]! - w.x;
      const dy = w.sY[q]! + 16 - w.y;
      const d2 = dx * dx + dy * dy;
      const dot = dx * ux + dy * uy;
      if (d2 > r2 || dot <= 0 || dot * dot < c2 * d2) continue;
      w.ev.push(Ev.Block, w.sX[q]!, w.sY[q]!);
      killShot(w, q);
    }
    return;
  }
  if (--wp.timer > 0) return;
  const t = nearest(w, g, w.x, w.y, e.area * 1.4);
  if (t < 0) {
    wp.timer = 6;
    return;
  }
  wp.angle = dirIndex(w.eX[t]! - w.x, w.eY[t]! - w.y);
  wp.phase = Math.round(s.duration * w.stats.durMul);
  wp.timer = e.cd;
  w.ev.push(Ev.Fire, w.x, w.y, WEAPON_CODE.gourd);
}

/** 缚妖索：从最近的一只开始，一只接一只往外找最近的没捆的，捆住一串；Boss 捆不住，精英只捆一半时间。没有怪返回 false */
function rope(w: World, g: Grid, k: number, s: WeaponStats, e: { dmg: number; area: number; amount: number }): boolean {
  let cx = w.x;
  let cy = w.y;
  let reach = 320;
  let got = 0;
  for (let j = 0; j < e.amount; j++) {
    const n = g.query(w, cx, cy, reach);
    let best = -1;
    let bd = Infinity;
    for (let q = 0; q < n; q++) {
      const i = g.out[q]!;
      if (ENEMIES[w.eKind[i]!]!.boss || w.eBind[i]! > w.tick) continue;
      const dx = w.eX[i]! - cx;
      const dy = w.eY[i]! - cy;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best < 0) break;
    if (got === 0) w.ev.push(Ev.Fire, w.x, w.y, WEAPON_CODE.rope);
    const elite = ENEMIES[w.eKind[best]!]!.elite;
    const t = Math.round(s.duration * w.stats.durMul);
    w.eBind[best] = w.tick + (elite ? t >> 1 : t);
    w.ev.push(Ev.Bind, w.eX[best]!, w.eY[best]!, got, 0, best);
    hitEnemy(w, best, e.dmg, k, 0, 0, 0, s.rehit);
    got++;
    cx = w.eX[best]!;
    cy = w.eY[best]!;
    reach = e.area;
  }
  return got > 0;
}

/** 金钟罩：不满就按冷却回一层；碎了的下一拍震开身边 */
function shieldTick(w: World, g: Grid, k: number, wp: { timer: number }, s: WeaponStats, e: { dmg: number; cd: number; area: number; amount: number }): void {
  w.shieldMax = e.amount;
  if (w.shield > w.shieldMax) w.shield = w.shieldMax;
  if (w.shieldBurst) {
    w.shieldBurst = false;
    w.ev.push(Ev.Shield, w.x, w.y, 0, e.area);
    chop(w, w.x, w.y, e.area, e.dmg);
    if (w.merges.includes('fenzhong')) shieldFire(w);
    const n = g.query(w, w.x, w.y, e.area);
    for (let q = 0; q < n; q++) scratch[q] = g.out[q]!;
    for (let q = 0; q < n; q++) {
      const i = scratch[q]!;
      hitEnemy(w, i, e.dmg, k, w.eX[i]! - w.x, w.eY[i]! - w.y, s.knock, s.rehit);
    }
  }
  if (w.shield >= w.shieldMax) {
    wp.timer = e.cd;
    return;
  }
  // 墨斗：回层更快
  const cd = Math.max(4, Math.round(e.cd / w.stats.durMul));
  if (wp.timer > cd) wp.timer = cd;
  if (--wp.timer > 0) return;
  wp.timer = cd;
  // 不坏金身：一回就回满
  w.shield = (w.weapons[k]!.evolved ? w.shieldMax : w.shield + 1);
  w.ev.push(Ev.Shield, w.x, w.y, 1, e.area);
}

/** 纸鹤：常驻盘旋，轮流俯冲到最近的怪那里啄一下（落点一小圈），再飞回来 */
function craneTick(w: World, g: Grid, k: number, wp: { timer: number; phase: number }, s: WeaponStats, e: { cd: number; amount: number; dmg: number; area: number }): void {
  let have = 0;
  for (let i = 0; i < MAX_SHOTS; i++) if (w.sAlive[i] && w.sKind[i] === Shot.Crane && w.sSlot[i] === k && w.sIdx[i]! < MINI_CRANE) have++;
  for (let j = have; j < e.amount; j++) addShot(w, Shot.Crane, w.x, w.y - 60, 0, 0, 0, e.dmg, 26, 0, k, j);
  if (--wp.timer > 0) return;
  const target = nearest(w, g, w.x, w.y, e.area);
  if (target < 0) {
    wp.timer = 6;
    return;
  }
  for (let tries = 0; tries < e.amount; tries++) {
    const idx = wp.phase % e.amount;
    wp.phase++;
    for (let i = 0; i < MAX_SHOTS; i++) {
      if (!w.sAlive[i] || w.sKind[i] !== Shot.Crane || w.sSlot[i] !== k || w.sIdx[i] !== idx || w.sState[i] !== 0) continue;
      const dx = w.eX[target]! - w.sX[i]!;
      const dy = w.eY[target]! - w.sY[i]!;
      const d = fsqrt(dx * dx + dy * dy) || 1;
      w.sState[i] = 1;
      w.sVX[i] = (dx / d) * s.speed;
      w.sVY[i] = (dy / d) * s.speed;
      w.sLife[i] = Math.max(1, Math.ceil(d / s.speed));
      w.sDmg[i] = e.dmg;
      w.ev.push(Ev.Fire, w.sX[i]!, w.sY[i]!, WEAPON_CODE.crane);
      wp.timer = Math.max(3, Math.round(e.cd / e.amount));
      return;
    }
  }
  wp.timer = 4;
}

/** 纸兵：不够数就隔 cd 拍在主角身边补一个（剪刀让它活得更久） */
function paperTick(w: World, k: number, wp: { timer: number; phase: number }, s: WeaponStats, e: { cd: number; amount: number; dmg: number }): void {
  if (--wp.timer > 0) return;
  let have = 0;
  for (let i = 0; i < MAX_SHOTS; i++) if (w.sAlive[i] && w.sKind[i] === Shot.Paper && w.sSlot[i] === k) have++;
  if (have >= e.amount) {
    wp.timer = 6;
    return;
  }
  wp.timer = e.cd;
  const life = Math.round(s.duration * w.stats.durMul * (1 + PAPER_FX.jiandaoLife * (w.passives.jiandao ?? 0)));
  const a = (wp.phase++ * 37) & (DIR_N - 1);
  addShot(w, Shot.Paper, w.x + dcos(a) * 40, w.y + dsin(a) * 30, 0, 0, life, e.dmg, 20, 0, k, have);
  w.ev.push(Ev.Fire, w.x, w.y, WEAPON_CODE.zhibing);
}

/**
 * 纸兵这一拍：找 area 内最近的怪走过去，贴上了就停下顶住——每 rehit 拍打一下、把怪往回顶；
 * 贴身时每拍多折 1 拍寿（挡怪是要付代价的）。没有怪就跟在主角身边。寿尽倒下：撒豆成兵炸开、火兵留火、鸣兵震开。
 */
function movePaper(w: World, g: Grid, i: number, k: number, s: WeaponStats): void {
  const x = w.sX[i]!;
  const y = w.sY[i]!;
  const area = s.area * w.stats.areaMul;
  const t = nearest(w, g, x, y, area);
  let touching = false;
  if (t >= 0) {
    const dx = w.eX[t]! - x;
    const dy = w.eY[t]! - y;
    const d = fsqrt(dx * dx + dy * dy) || 1;
    const reach = w.sR[i]! + ENEMIES[w.eKind[t]!]!.r * w.eSize[t]!;
    if (d > reach) {
      w.sX[i] = x + (dx / d) * s.speed;
      w.sY[i] = y + (dy / d) * s.speed;
    } else touching = true;
  } else {
    // 没有怪：回到主角身边（按编号错开站位）
    const a = (w.sIdx[i]! * 41) & (DIR_N - 1);
    const tx = w.x + dcos(a) * 60;
    const ty = w.y + dsin(a) * 40;
    const dx = tx - x;
    const dy = ty - y;
    const d = fsqrt(dx * dx + dy * dy);
    if (d > s.speed) {
      w.sX[i] = x + (dx / d) * s.speed * 1.4;
      w.sY[i] = y + (dy / d) * s.speed * 1.4;
    }
  }
  if (touching) {
    const n = g.query(w, w.sX[i]!, w.sY[i]!, w.sR[i]! + 24);
    for (let q = 0; q < n; q++) scratch[q] = g.out[q]!;
    for (let q = 0; q < n; q++) {
      const j = scratch[q]!;
      hitEnemy(w, j, w.sDmg[i]!, k, w.eX[j]! - w.sX[i]!, w.eY[j]! - w.sY[i]!, s.knock, s.rehit);
    }
    w.sLife[i]!--;
    if (w.merges.includes('huobing') && --w.sDist[i]! <= 0) {
      w.sDist[i] = DUAL_FX.paperFire.every;
      addShot(w, Shot.Burn, w.sX[i]!, w.sY[i]!, 0, 0, DUAL_FX.paperFire.life, w.sDmg[i]! * DUAL_FX.paperFire.mul, DUAL_FX.paperFire.r, 0, k, 0);
    }
  }
  if (--w.sLife[i]! > 0) return;
  paperFall(w, g, i, k, s);
  killShot(w, i);
}

function paperFall(w: World, g: Grid, i: number, k: number, s: WeaponStats): void {
  const x = w.sX[i]!;
  const y = w.sY[i]!;
  const dmg = w.sDmg[i]!;
  const evolved = w.weapons[k]?.evolved ?? false;
  w.ev.push(Ev.Paper, x, y, 0, 0);
  const ring = (r: number, d: number, knock: number, kind: number): void => {
    w.ev.push(Ev.Paper, x, y, kind, r);
    const n = g.query(w, x, y, r);
    for (let q = 0; q < n; q++) scratch[q] = g.out[q]!;
    for (let q = 0; q < n; q++) hitEnemy(w, scratch[q]!, d, -1, w.eX[scratch[q]!]! - x, w.eY[scratch[q]!]! - y, knock, 0, k);
  };
  if (evolved) ring(PAPER_FX.boomR * w.stats.areaMul, dmg * PAPER_FX.boomMul, s.knock, 1);
  if (w.merges.includes('mingbing')) ring(DUAL_FX.paperBell.r * w.stats.areaMul, dmg * DUAL_FX.paperBell.mul, DUAL_FX.paperBell.knock, 2);
  if (w.merges.includes('huobing')) addShot(w, Shot.Burn, x, y, 0, 0, DUAL_FX.paperFire.deathLife, dmg * DUAL_FX.paperFire.mul, DUAL_FX.paperFire.deathR, 0, k, 0);
}

/**
 * 桃木剑：第 j 道的方向——0 面前、1 身后、2 面前偏上、3 身后偏下……扇形 ±75°。
 * 进化后（斩妖剑）砍中回血，每一挥最多回 4 点。
 */
function swordSwing(w: World, g: Grid, k: number, s: WeaponStats, e: { dmg: number; area: number; amount: number }): void {
  const evolved = w.weapons[k]!.evolved;
  let healed = 0;
  w.ev.push(Ev.Fire, w.x, w.y, WEAPON_CODE.sword);
  for (let j = 0; j < e.amount; j++) {
    const base = j % 2 === 0 ? w.face : w.face + DIR_N / 2;
    const tilt = j < 2 ? 0 : ((j >> 1) % 2 === 1 ? -1 : 1) * 22;
    const a = base + tilt;
    const ux = dcos(a);
    const uy = dsin(a);
    w.ev.push(Ev.Slash, w.x, w.y, a & (DIR_N - 1), e.area, evolved ? 1 : 0);
    chop(w, w.x + ux * e.area * 0.55, w.y + uy * e.area * 0.55, e.area * 0.5, e.dmg);
    const n = g.query(w, w.x, w.y, e.area);
    for (let q = 0; q < n; q++) scratch[q] = g.out[q]!;
    for (let q = 0; q < n; q++) {
      const i = scratch[q]!;
      const dx = w.eX[i]! - w.x;
      const dy = w.eY[i]! - w.y;
      const dot = dx * ux + dy * uy;
      // cos 75° ≈ 0.26：dot ≥ 0.26 × |d|，两边平方免得开方
      if (dot < 0 || dot * dot < 0.0676 * (dx * dx + dy * dy)) continue;
      if (hitEnemy(w, i, e.dmg, k, ux, uy, s.knock, s.rehit) && evolved && healed < 4) {
        heal(w, 1);
        healed++;
      }
    }
  }
  // 诛邪剑阵：挥剑时待命的飞剑一起射出去
  if (w.merges.includes('zhuxie')) {
    const kf = w.weapons.findIndex((o) => o.id === 'flysword');
    const t = kf >= 0 ? nearest(w, g, w.x, w.y, 420) : -1;
    if (t >= 0) launchAllFly(w, kf, w.wstats[kf]!, eff(w, w.wstats[kf]!).dmg, w.eX[t]!, w.eY[t]! - 20);
  }
}

function fireTalismans(w: World, g: Grid, k: number, s: WeaponStats, e: { dmg: number; area: number; amount: number }): void {
  // 依次瞄最近的几只（不重复），没有怪就朝面前飞
  const n = g.query(w, w.x, w.y, 520);
  for (let q = 0; q < n; q++) scratch[q] = g.out[q]!;
  let taken = 0;
  w.ev.push(Ev.Fire, w.x, w.y, WEAPON_CODE.talisman);
  // 符师：每第 4 次出符多发一张
  const amount = e.amount + (w.setup.character === 'fushi' && ++w.weapons[k]!.phase % CHAR_FX.fushiEvery === 0 ? 1 : 0);
  for (let j = 0; j < amount; j++) {
    let best = -1;
    let bd = Infinity;
    for (let q = taken; q < n; q++) {
      const i = scratch[q]!;
      const dx = w.eX[i]! - w.x;
      const dy = w.eY[i]! - w.y;
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = q;
      }
    }
    let vx = dcos(w.face + j * 9);
    let vy = dsin(w.face + j * 9);
    if (best >= 0) {
      const i = scratch[best]!;
      scratch[best] = scratch[taken]!;
      scratch[taken++] = i;
      const dx = w.eX[i]! - w.x;
      const dy = w.eY[i]! - (w.y - 24);
      const d = fsqrt(dx * dx + dy * dy) || 1;
      vx = dx / d;
      vy = dy / d;
    }
    addShot(w, Shot.Talisman, w.x, w.y - 24, vx * s.speed, vy * s.speed, s.duration, e.dmg, e.area, 1, k, j);
  }
}

function coinsTick(w: World, k: number, wp: { timer: number; phase: number; angle: number; evolved: boolean }, s: WeaponStats, e: { area: number; amount: number; dmg: number }): void {
  if (wp.evolved) {
    // 金钱阵：两圈铜钱常驻，不歇
    wp.angle = (wp.angle + s.speed) & (DIR_N - 1);
    let have = 0;
    for (let i = 0; i < MAX_SHOTS; i++) if (w.sAlive[i] && w.sKind[i] === Shot.Coin && w.sSlot[i] === k) have++;
    for (let j = have; j < e.amount; j++) addShot(w, Shot.Coin, w.x, w.y, 0, 0, 1 << 30, e.dmg, 12, 0, k, j);
    return;
  }
  // 墨斗：转得更久
  const dur = Math.round(s.duration * w.stats.durMul);
  if (wp.phase > 0) {
    wp.phase--;
    wp.angle = (wp.angle + s.speed) & (DIR_N - 1);
    if (wp.phase === 0) {
      removeShots(w, Shot.Coin, k);
      wp.timer = Math.max(4, Math.round((s.cd - s.duration) * w.stats.cdMul));
    }
    return;
  }
  if (--wp.timer > 0) return;
  wp.phase = dur;
  w.ev.push(Ev.Fire, w.x, w.y, WEAPON_CODE.coins);
  for (let j = 0; j < e.amount; j++) addShot(w, Shot.Coin, w.x, w.y, 0, 0, dur + 1, e.dmg, 12, 0, k, j);
}

/** 把这一格所有待命的飞剑一起射向 (tx, ty)，排成扇面（万剑归宗、诛邪剑阵） */
function launchAllFly(w: World, k: number, s: WeaponStats, dmg: number, tx: number, ty: number): number {
  let n = 0;
  for (let i = 0; i < MAX_SHOTS; i++) if (w.sAlive[i] && w.sKind[i] === Shot.Fly && w.sSlot[i] === k && w.sState[i] === 0) n++;
  if (n === 0) return 0;
  const base = dirIndex(tx - w.x, ty - w.y);
  let j = 0;
  for (let i = 0; i < MAX_SHOTS; i++) {
    if (!w.sAlive[i] || w.sKind[i] !== Shot.Fly || w.sSlot[i] !== k || w.sState[i] !== 0) continue;
    // 扇面：每把错开 6 格（约 8°）
    const a = base + Math.round((j - (n - 1) / 2) * 6);
    w.sState[i] = 1;
    w.sVX[i] = dcos(a) * s.speed;
    w.sVY[i] = dsin(a) * s.speed;
    w.sDist[i] = 0;
    w.sDmg[i] = dmg;
    j++;
  }
  w.ev.push(Ev.Fire, w.x, w.y, WEAPON_CODE.flysword);
  return n;
}

function flyTick(w: World, g: Grid, k: number, wp: { timer: number; phase: number; evolved: boolean }, s: WeaponStats, e: { cd: number; amount: number; dmg: number }): void {
  // 飞剑常驻：数量不够就补上（升级、令牌加数量时）
  let have = 0;
  for (let i = 0; i < MAX_SHOTS; i++) if (w.sAlive[i] && w.sKind[i] === Shot.Fly && w.sSlot[i] === k) have++;
  for (let j = have; j < e.amount; j++) addShot(w, Shot.Fly, w.x, w.y, 0, 0, 1 << 30, e.dmg, 14, 0, k, j);
  if (--wp.timer > 0) return;
  // 轮到下一把待命的飞出去
  const target = nearest(w, g, w.x, w.y, s.duration * 0.9);
  if (target < 0) {
    wp.timer = 6;
    return;
  }
  if (wp.evolved) {
    // 万剑归宗：一次全射出去
    wp.timer = launchAllFly(w, k, s, e.dmg, w.eX[target]!, w.eY[target]! - 20) > 0 ? e.cd : 4;
    return;
  }
  for (let tries = 0; tries < e.amount; tries++) {
    const idx = wp.phase % e.amount;
    wp.phase++;
    for (let i = 0; i < MAX_SHOTS; i++) {
      if (!w.sAlive[i] || w.sKind[i] !== Shot.Fly || w.sSlot[i] !== k || w.sIdx[i] !== idx || w.sState[i] !== 0) continue;
      const dx = w.eX[target]! - w.sX[i]!;
      const dy = w.eY[target]! - 20 - w.sY[i]!;
      const d = fsqrt(dx * dx + dy * dy) || 1;
      w.sState[i] = 1;
      w.sVX[i] = (dx / d) * s.speed;
      w.sVY[i] = (dy / d) * s.speed;
      w.sDist[i] = 0;
      w.sDmg[i] = e.dmg;
      w.ev.push(Ev.Fire, w.sX[i]!, w.sY[i]!, WEAPON_CODE.flysword);
      wp.timer = Math.max(3, Math.round((Math.max(4, Math.round(s.cd * w.stats.cdMul)) / e.amount) * 1.2));
      return;
    }
  }
  wp.timer = 4;
}

function thunder(w: World, g: Grid, k: number, s: WeaponStats, e: { dmg: number; area: number; amount: number }): void {
  const n = g.query(w, w.x, w.y, s.duration);
  if (n === 0) return;
  for (let q = 0; q < n; q++) scratch[q] = g.out[q]!;
  w.ev.push(Ev.Fire, w.x, w.y, WEAPON_CODE.thunder);
  // 五雷正法：每道雷劈完再连着往最近的没劈过的跳，一共五下
  const chain = w.weapons[k]!.evolved ? 5 : 1;
  for (let j = 0; j < e.amount; j++) {
    let t = scratch[w.rWeapon.int(n)]!;
    let px = w.eX[t]!;
    let py = w.eY[t]! - 400;
    for (let c = 0; c < chain && t >= 0; c++) {
      const tx = w.eX[t]!;
      const ty = w.eY[t]!;
      w.ev.push(Ev.Thunder, tx, ty, c, e.area, c === 0 ? 0 : 1);
      if (c > 0) w.ev.push(Ev.Chain, px, py, 0, tx, ty);
      strike(w, g, k, tx, ty, e.dmg, e.area, s.knock);
      px = tx;
      py = ty;
      t = c + 1 < chain ? nearestUnhit(w, g, tx, ty, 220, k) : -1;
    }
  }
}

/** 一道雷落在 (x, y)：一圈都挨打（雷符、雷火符箓） */
function strike(w: World, g: Grid, k: number, x: number, y: number, dmg: number, area: number, knock: number): void {
  chop(w, x, y, area, dmg);
  const m = g.query(w, x, y, area);
  const local = scratch2;
  for (let q = 0; q < m; q++) local[q] = g.out[q]!;
  for (let q = 0; q < m; q++) {
    const i = local[q]!;
    hitEnemy(w, i, dmg, -1, w.eX[i]! - x, w.eY[i]! - y, knock, 0, k);
  }
}

/** 离 (x, y) 最近、这一拍还没被这件法器打过的怪（连锁雷用） */
function nearestUnhit(w: World, g: Grid, x: number, y: number, r: number, k: number): number {
  const n = g.query(w, x, y, r);
  let best = -1;
  let bd = Infinity;
  for (let j = 0; j < n; j++) {
    const i = g.out[j]!;
    if (w.eLastHit[i] === w.tick && w.eLastBy[i] === k) continue;
    const dx = w.eX[i]! - x;
    const dy = w.eY[i]! - y;
    const d = dx * dx + dy * dy;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

// ───────────────────────── 子弹 ─────────────────────────

function addShot(w: World, kind: Shot, x: number, y: number, vx: number, vy: number, life: number, dmg: number, r: number, state: number, slot: number, idx: number): number {
  let i = -1;
  for (let s = 0; s < MAX_SHOTS; s++) {
    if (!w.sAlive[s]) {
      i = s;
      break;
    }
  }
  if (i < 0) return -1;
  w.sAlive[i] = 1;
  w.sGen[i]!++;
  w.sKind[i] = kind;
  w.sX[i] = x;
  w.sY[i] = y;
  w.sPX[i] = x;
  w.sPY[i] = y;
  w.sVX[i] = vx;
  w.sVY[i] = vy;
  w.sLife[i] = life;
  w.sDmg[i] = dmg;
  w.sR[i] = r;
  w.sState[i] = state;
  w.sSlot[i] = slot;
  w.sIdx[i] = idx;
  w.sDist[i] = 0;
  w.sCount++;
  return i;
}

function killShot(w: World, i: number): void {
  w.sAlive[i] = 0;
  w.sCount--;
}

function removeShots(w: World, kind: Shot, slot: number): void {
  for (let i = 0; i < MAX_SHOTS; i++) if (w.sAlive[i] && w.sKind[i] === kind && w.sSlot[i] === slot) killShot(w, i);
}

/** 这一拍在转的铜钱（挡弹用；每拍开头收一次，免得每颗弹都扫一遍子弹表） */
const coinList = new Int32Array(MAX_SHOTS);
let coinN = 0;
function blockedByCoin(w: World, i: number): boolean {
  for (let q = 0; q < coinN; q++) {
    const c = coinList[q]!;
    if (!w.sAlive[c]) continue;
    const dx = w.sX[c]! - w.sX[i]!;
    const dy = w.sY[c]! - w.sY[i]!;
    const rr = w.sR[c]! + w.sR[i]! + 4;
    if (dx * dx + dy * dy < rr * rr) return true;
  }
  return false;
}

const MONEY_COS = dcos(LORD.moneyTurn);
const MONEY_SIN = dsin(LORD.moneyTurn);

function moveShots(w: World, g: Grid): void {
  coinN = 0;
  for (let i = 0; i < MAX_SHOTS; i++) if (w.sAlive[i] && w.sKind[i] === Shot.Coin) coinList[coinN++] = i;
  for (let i = 0; i < MAX_SHOTS; i++) {
    if (!w.sAlive[i]) continue;
    const kind = w.sKind[i] as Shot;
    if (kind === Shot.Fireball) {
      if (w.sState[i] === 2) {
        // 纸钱：速度方向每拍转一点，旋成涡（两圈反着转）
        const c = MONEY_COS;
        const sn = w.sIdx[i] === 0 ? MONEY_SIN : -MONEY_SIN;
        const vx = w.sVX[i]!;
        w.sVX[i] = vx * c - w.sVY[i]! * sn;
        w.sVY[i] = vx * sn + w.sVY[i]! * c;
      }
      w.sX[i]! += w.sVX[i]!;
      w.sY[i]! += w.sVY[i]!;
      // 铜钱剑挡弹：转着的铜钱碰到就消掉（远程清场时它也不是摆设）
      if (blockedByCoin(w, i)) {
        w.ev.push(Ev.Block, w.sX[i]!, w.sY[i]!);
        killShot(w, i);
        continue;
      }
      const dx = w.sX[i]! - w.x;
      const dy = w.sY[i]! + 16 - w.y;
      const rr = w.sR[i]! + PLAYER.r;
      if (dx * dx + dy * dy < rr * rr && w.invuln === 0) {
        hurt(w, w.sDmg[i]!, SHOT_BY + w.sKind[i]!);
        if (w.sState[i] === 1) w.slowUntil = w.tick + SNOW.slowTicks;
        killShot(w, i);
        continue;
      }
      if (--w.sLife[i]! <= 0) killShot(w, i);
      continue;
    }
    const k = w.sSlot[i]!;
    const wp = w.weapons[k];
    const s = w.wstats[k];
    if (!wp || !s) {
      killShot(w, i);
      continue;
    }
    // 竹子：飞出去的和转着的法器碰到就砍（待命的飞剑、纸鹤不算）
    if (w.blockHp.length && ((kind !== Shot.Fly && kind !== Shot.Crane) || w.sState[i] !== 0)) chop(w, w.sX[i]!, w.sY[i]!, w.sR[i]! + 4, w.sDmg[i]!);
    if (kind === Shot.Talisman) {
      // 追踪：慢慢转向离符最近的怪（进化后转得更快）
      const t = nearest(w, g, w.sX[i]!, w.sY[i]!, 260);
      if (t >= 0) {
        const dx = w.eX[t]! - w.sX[i]!;
        const dy = w.eY[t]! - 20 - w.sY[i]!;
        const d = fsqrt(dx * dx + dy * dy) || 1;
        const turn = wp.evolved ? 0.35 : 0.18;
        w.sVX[i] = w.sVX[i]! + ((dx / d) * s.speed - w.sVX[i]!) * turn;
        w.sVY[i] = w.sVY[i]! + ((dy / d) * s.speed - w.sVY[i]!) * turn;
      }
      w.sX[i]! += w.sVX[i]!;
      w.sY[i]! += w.sVY[i]!;
      const hit = nearest(w, g, w.sX[i]!, w.sY[i]! + 20, 10);
      if (hit >= 0) {
        // 爆开：一圈都挨打
        const bx = w.sX[i]!;
        const by = w.sY[i]! + 20;
        w.ev.push(Ev.Burst, bx, by, 0, w.sR[i]!);
        const n = g.query(w, bx, by, w.sR[i]!);
        for (let q = 0; q < n; q++) scratch[q] = g.out[q]!;
        for (let q = 0; q < n; q++) {
          const e = scratch[q]!;
          hitEnemy(w, e, w.sDmg[i]!, k, w.sVX[i]!, w.sVY[i]!, s.knock, s.rehit);
        }
        // 雷火符箓：爆开的地方再落一道雷
        if (w.merges.includes('leihuo')) {
          const kt = w.weapons.findIndex((o) => o.id === 'thunder');
          if (kt >= 0) {
            const te = eff(w, w.wstats[kt]!);
            w.ev.push(Ev.Thunder, bx, by, 0, te.area, 0);
            strike(w, g, kt, bx, by, te.dmg, te.area, w.wstats[kt]!.knock);
          }
        }
        killShot(w, i);
        continue;
      }
      if (--w.sLife[i]! <= 0) killShot(w, i);
      continue;
    }
    if (kind === Shot.Coin) {
      const e = eff(w, s);
      let a: number;
      let r = e.area;
      if (wp.evolved) {
        // 两圈：单号在外圈反着转
        const outer = w.sIdx[i]! & 1;
        const per = (e.amount + 1) >> 1;
        const j = w.sIdx[i]! >> 1;
        if (w.sIdx[i]! >= e.amount) {
          killShot(w, i);
          continue;
        }
        a = (outer ? -wp.angle : wp.angle) + Math.floor((j * DIR_N) / per) + (outer ? DIR_N / (2 * per) : 0);
        if (outer) r *= 1.55;
      } else a = wp.angle + Math.floor((w.sIdx[i]! * DIR_N) / e.amount);
      w.sX[i] = w.x + dcos(a) * r;
      w.sY[i] = w.y - 16 + dsin(a) * r * 0.8;
      const n = g.query(w, w.sX[i]!, w.sY[i]! + 16, w.sR[i]!);
      for (let q = 0; q < n; q++) scratch[q] = g.out[q]!;
      for (let q = 0; q < n; q++) {
        const en = scratch[q]!;
        hitEnemy(w, en, w.sDmg[i]!, k, w.eX[en]! - w.x, w.eY[en]! - w.y, s.knock, s.rehit);
      }
      continue;
    }
    if (kind === Shot.Wave) {
      // 光波往外扩，扫过的环带（最外 24 单位）里的怪挨一下、往外推
      w.sR[i]! += s.speed;
      const r = w.sR[i]!;
      if (r > 0) {
        const cx = w.sX[i]!;
        const cy = w.sY[i]!;
        const n = g.query(w, cx, cy, r);
        for (let q = 0; q < n; q++) scratch[q] = g.out[q]!;
        const inner = r > 24 ? (r - 24) * (r - 24) : 0;
        for (let q = 0; q < n; q++) {
          const en = scratch[q]!;
          const dx = w.eX[en]! - cx;
          const dy = w.eY[en]! - cy;
          if (dx * dx + dy * dy < inner) continue;
          hitEnemy(w, en, w.sDmg[i]!, k, dx, dy, s.knock, s.rehit);
        }
        // 太极镜：扫掉环带里怪的火球
        if (w.sState[i] === 1) {
          const outer = r * r;
          for (let f = 0; f < MAX_SHOTS; f++) {
            if (!w.sAlive[f] || w.sKind[f] !== Shot.Fireball) continue;
            const dx = w.sX[f]! - cx;
            const dy = w.sY[f]! - cy;
            const d2 = dx * dx + dy * dy;
            if (d2 >= inner && d2 <= outer) {
              w.ev.push(Ev.Burst, w.sX[f]!, w.sY[f]!, 1, 20);
              killShot(w, f);
            }
          }
        }
      }
      if (r >= w.sDist[i]!) killShot(w, i);
      continue;
    }
    if (kind === Shot.Paper) {
      movePaper(w, g, i, k, s);
      continue;
    }
    if (kind === Shot.Burn) {
      const n = g.query(w, w.sX[i]!, w.sY[i]!, w.sR[i]!);
      for (let q = 0; q < n; q++) scratch[q] = g.out[q]!;
      for (let q = 0; q < n; q++) hitEnemy(w, scratch[q]!, w.sDmg[i]!, k, 0, 0, 0, 10);
      if (--w.sLife[i]! <= 0) killShot(w, i);
      continue;
    }
    if (kind === Shot.Petal) {
      if (w.merges.includes('linghua')) homePetal(w, g, i);
      if (--w.sLife[i]! > 0) continue;
      const cx = w.sX[i]!;
      const cy = w.sY[i]!;
      w.ev.push(Ev.Petal, cx, cy, 0, w.sR[i]!);
      const n = g.query(w, cx, cy, w.sR[i]!);
      for (let q = 0; q < n; q++) scratch[q] = g.out[q]!;
      let hit = false;
      for (let q = 0; q < n; q++) if (hitEnemy(w, scratch[q]!, w.sDmg[i]!, k, w.eX[scratch[q]!]! - cx, w.eY[scratch[q]!]! - cy, s.knock, s.rehit)) hit = true;
      if (hit && wp.phase > 0) {
        wp.phase--;
        heal(w, 1);
      }
      killShot(w, i);
      continue;
    }
    if (kind === Shot.Crane) {
      const amount = eff(w, s).amount;
      const mini = w.sIdx[i]! >= MINI_CRANE;
      if (mini ? --w.sDist[i]! <= 0 : w.sIdx[i]! >= amount) {
        killShot(w, i);
        continue;
      }
      const cs = w.sState[i]!;
      if (cs === 0 && mini) {
        // 小纸鹤不盘旋：找最近的怪直接扑过去，没有就原地等
        const t = nearest(w, g, w.sX[i]!, w.sY[i]!, s.area);
        if (t >= 0) {
          const dx = w.eX[t]! - w.sX[i]!;
          const dy = w.eY[t]! - w.sY[i]!;
          const d = fsqrt(dx * dx + dy * dy) || 1;
          w.sState[i] = 1;
          w.sVX[i] = (dx / d) * s.speed;
          w.sVY[i] = (dy / d) * s.speed;
          w.sLife[i] = Math.max(1, Math.ceil(d / s.speed));
        }
        continue;
      }
      if (cs === 2 && mini) {
        w.sState[i] = 0;
        continue;
      }
      if (cs === 0) {
        // 盘旋：比飞剑高、圈更大、转得慢
        const a = w.tick * 2 + Math.floor((w.sIdx[i]! * DIR_N) / amount);
        const tx = w.x + dcos(a) * 70;
        const ty = w.y - 64 + dsin(a) * 26;
        w.sX[i] = w.sX[i]! + (tx - w.sX[i]!) * 0.25;
        w.sY[i] = w.sY[i]! + (ty - w.sY[i]!) * 0.25;
        continue;
      }
      if (cs === 1) {
        w.sX[i]! += w.sVX[i]!;
        w.sY[i]! += w.sVY[i]!;
        if (--w.sLife[i]! > 0) continue;
        // 啄：落点一小圈
        const n = g.query(w, w.sX[i]!, w.sY[i]!, w.sR[i]!);
        for (let q = 0; q < n; q++) scratch[q] = g.out[q]!;
        for (let q = 0; q < n; q++) hitEnemy(w, scratch[q]!, w.sDmg[i]!, k, w.sVX[i]!, w.sVY[i]!, s.knock, s.rehit);
        w.sState[i] = 2;
        continue;
      }
      const dx = w.x - w.sX[i]!;
      const dy = w.y - 64 - w.sY[i]!;
      const d = fsqrt(dx * dx + dy * dy) || 1;
      const sp = s.speed * 0.8;
      if (d <= sp + 30) {
        w.sState[i] = 0;
        continue;
      }
      w.sVX[i] = (dx / d) * sp;
      w.sVY[i] = (dy / d) * sp;
      w.sX[i]! += w.sVX[i]!;
      w.sY[i]! += w.sVY[i]!;
      continue;
    }
    // 飞剑
    const st = w.sState[i]!;
    if (st === 0) {
      // 待命：绕身转，几把均匀分布
      const amount = eff(w, s).amount;
      if (w.sIdx[i]! >= amount) {
        killShot(w, i);
        continue;
      }
      const a = w.tick * 3 + Math.floor((w.sIdx[i]! * DIR_N) / amount);
      const tx = w.x + dcos(a) * 46;
      const ty = w.y - 30 + dsin(a) * 30;
      w.sX[i] = w.sX[i]! + (tx - w.sX[i]!) * 0.35;
      w.sY[i] = w.sY[i]! + (ty - w.sY[i]!) * 0.35;
      continue;
    }
    if (st === 1) {
      w.sX[i]! += w.sVX[i]!;
      w.sY[i]! += w.sVY[i]!;
      w.sDist[i]! += s.speed;
      const n = g.query(w, w.sX[i]!, w.sY[i]! + 20, w.sR[i]!);
      for (let q = 0; q < n; q++) scratch[q] = g.out[q]!;
      for (let q = 0; q < n; q++) if (hitEnemy(w, scratch[q]!, w.sDmg[i]!, k, w.sVX[i]!, w.sVY[i]!, s.knock, s.rehit)) sealEnemy(w, scratch[q]!);
      if (w.sDist[i]! >= s.duration) w.sState[i] = 2;
      continue;
    }
    // 飞回来：朝主角身边飞，路上照样打
    const dx = w.x - w.sX[i]!;
    const dy = w.y - 30 - w.sY[i]!;
    const d = fsqrt(dx * dx + dy * dy) || 1;
    const sp = s.speed * 1.1;
    if (d <= sp + 40) {
      w.sState[i] = 0;
      continue;
    }
    w.sVX[i] = (dx / d) * sp;
    w.sVY[i] = (dy / d) * sp;
    w.sX[i]! += w.sVX[i]!;
    w.sY[i]! += w.sVY[i]!;
    const n = g.query(w, w.sX[i]!, w.sY[i]! + 20, w.sR[i]!);
    for (let q = 0; q < n; q++) scratch[q] = g.out[q]!;
    for (let q = 0; q < n; q++) if (hitEnemy(w, scratch[q]!, w.sDmg[i]!, k, w.sVX[i]!, w.sVY[i]!, s.knock, s.rehit)) sealEnemy(w, scratch[q]!);
  }
}

// ───────────────────────── 挨打 ─────────────────────────

/** hurtBy 里远程弹的编号从这里起（加弹种），和怪的编号分开 */
export const SHOT_BY = 1000;
const WATER_CODE = ENEMY_BY_KIND.water.code;
const SPROUT_CODE = ENEMY_BY_KIND.bamsprout.code;
const DROWN_CODE = ENEMY_BY_KIND.drown.code;
function touchPlayer(w: World, g: Grid): void {
  if (w.invuln > 0) return;
  const n = g.query(w, w.x, w.y, PLAYER.r);
  let worst = 0;
  let by = -1;
  for (let j = 0; j < n; j++) {
    const i = g.out[j]!;
    if (w.eKind[i] === WATER_CODE) {
      // 还在冒的水鬼不伤人；冒出来了抓住主角拖慢
      if (w.eT[i]! > 0) continue;
      w.slowUntil = w.tick + WATER.grabTicks;
    } else if ((w.eKind[i] === SPROUT_CODE || w.eKind[i] === DROWN_CODE) && w.eT[i]! > 0) continue; // 还没钻出来的不伤人
    if (w.eDmg[i]! > worst) {
      worst = w.eDmg[i]!;
      by = w.eKind[i]!;
    }
  }
  if (worst > 0) hurt(w, worst, by);
}

// ───────────────────────── 掉落 ─────────────────────────

/** 离主角最远的一颗魂珠（没有就 -1） */
function farthestSoul(w: World): number {
  let far = -1;
  let fd = -1;
  for (let s = 0; s < MAX_DROPS; s++) {
    if (!w.dAlive[s] || w.dKind[s] !== Drop.Soul) continue;
    const dx = w.dX[s]! - w.x;
    const dy = w.dY[s]! - w.y;
    const d = dx * dx + dy * dy;
    if (d > fd) {
      fd = d;
      far = s;
    }
  }
  return far;
}

function addDrop(w: World, kind: Drop, x: number, y: number, val: number): void {
  // 地上的魂珠超过上限：新掉的经验并进离主角最远的那颗（变成大珠），满地珠子不抢怪和特效的眼（主线 2b 意见，VS 的做法）
  if (kind === Drop.Soul && w.soulCount >= PICKUP.soulCap) {
    const far = farthestSoul(w);
    if (far >= 0) {
      w.dVal[far]! += val;
      return;
    }
  }
  let i = -1;
  for (let s = 0; s < MAX_DROPS; s++) {
    if (!w.dAlive[s]) {
      i = s;
      break;
    }
  }
  if (i < 0) {
    // 满了：魂珠加到离主角最远的那颗魂珠上（不丢经验）；别的东西挤掉最远的魂珠
    const far = farthestSoul(w);
    if (far < 0) return;
    if (kind === Drop.Soul) {
      w.dVal[far]! += val;
      return;
    }
    i = far;
    w.dCount--;
    w.soulCount--;
  }
  w.dAlive[i] = 1;
  w.dGen[i]!++;
  w.dKind[i] = kind;
  tmpP.x = clamp(x, 10, w.arenaW - 10);
  tmpP.y = clamp(y, 10, w.arenaH - 10);
  // 掉在棺材、墙里的（宝箱、肉包要走过去捡）挪到边上
  if (w.blocks.length) push(w, tmpP, 16);
  w.dX[i] = tmpP.x;
  w.dY[i] = tmpP.y;
  w.dPX[i] = w.dX[i]!;
  w.dPY[i] = w.dY[i]!;
  w.dVal[i] = val;
  w.dPull[i] = 0;
  w.dCount++;
  if (kind === Drop.Soul) w.soulCount++;
}

function movePickups(w: World): void {
  // 磁吸半径随等级涨（每级 +1.5%，40 级封顶 +60%）：后期怪多、走位忙，不用一颗颗去碰
  const m = w.stats.magnet * dangerDef(w.setup.mode, w.setup.danger).magnetMul * (1 + PICKUP.magnetPerLevel * (w.level < 41 ? w.level - 1 : 40));
  const m2 = m * m;
  for (let i = 0; i < MAX_DROPS; i++) {
    if (!w.dAlive[i]) continue;
    const dx = w.x - w.dX[i]!;
    const dy = w.y - 12 - w.dY[i]!;
    const d2 = dx * dx + dy * dy;
    if (w.dPull[i] === 0) {
      // 宝箱、肉包、符纸卷要走过去才捡（魂珠和铜钱会被吸）
      const kind = w.dKind[i];
      const reach = kind === Drop.Soul || kind === Drop.Coin ? m2 : PICKUP.grab * PICKUP.grab * 4;
      if (d2 > reach) continue;
      w.dPull[i] = PICKUP.pull;
    }
    const d = fsqrt(d2);
    if (d <= w.dPull[i]! + PICKUP.grab) {
      collect(w, i);
      continue;
    }
    w.dX[i]! += (dx / d) * w.dPull[i]!;
    w.dY[i]! += (dy / d) * w.dPull[i]!;
    w.dPull[i]! += PICKUP.pullAccel;
  }
}

function collect(w: World, i: number): void {
  const kind = w.dKind[i] as Drop;
  const val = w.dVal[i]!;
  w.dAlive[i] = 0;
  w.dCount--;
  if (kind === Drop.Soul) w.soulCount--;
  w.ev.push(Ev.Pickup, w.dX[i]!, w.dY[i]!, kind, val);
  switch (kind) {
    case Drop.Soul:
      gainXp(w, val);
      break;
    case Drop.Coin:
      // 引魂灯：有一定概率多给一枚（铜钱保持整数）
      {
        const c = val + (w.stats.coinBonus > 0 && w.rDrop.next() < w.stats.coinBonus ? 1 : 0);
        w.coins += c;
        w.coinBy.drop += c;
      }
      break;
    case Drop.Purse: {
      const c = PURSE.min + w.rDrop.int(PURSE.span);
      w.coins += c;
      w.coinBy.purse += c;
      break;
    }
    case Drop.Bomb:
      bomb(w, w.x, w.y);
      break;
    case Drop.Bun:
      heal(w, val * (has(w, 'noheal') ? CURSE_FX.noheal : 1) * (w.setup.character === 'caiyao' ? CHAR_FX.caiyaoBun : 1));
      break;
    case Drop.Scroll:
      for (let s = 0; s < MAX_DROPS; s++) if (w.dAlive[s] && w.dKind[s] === Drop.Soul) w.dPull[s] = PICKUP.pull;
      break;
    case Drop.Chest: {
      // 守夜的精英箱一次升 val 件（1 / 3 / 5）；夜探的箱子另有一套（explore/raid.ts）
      const n = Math.max(1, val);
      w.chests++;
      w.ev.push(Ev.ChestBig, w.x, w.y, n);
      for (let k = 0; k < n; k++) openChest(w);
      break;
    }
  }
}

function gainXp(w: World, v: number): void {
  w.xp += v * w.stats.xpMul;
  for (;;) {
    const need = xpNeed(w.level, w.raid !== null);
    if (w.xp < need) break;
    w.xp -= need;
    w.level++;
    w.pendingLevels++;
    w.ev.push(Ev.LevelUp, w.x, w.y, w.level);
    if (w.setup.character === 'xiaodao' && w.level % CHAR_FX.xiaodaoEvery === 0) recompute(w);
  }
}

// ───────────────────────── 摆设、炸弹 ─────────────────────────

/** 开局在场地里散摆设：离出生点 300 以外，避开墙和棺材 */
function scatterProps(w: World): void {
  for (let k = 0; k < PROPS.start; k++) {
    const x = 60 + w.rProp.next() * (w.arenaW - 120);
    const y = 60 + w.rProp.next() * (w.arenaH - 120);
    const dx = x - w.x;
    const dy = y - w.y;
    if (dx * dx + dy * dy < 300 * 300) continue;
    addProp(w, x, y);
  }
  w.propAt = PROPS.every;
}

function addProp(w: World, x: number, y: number): void {
  for (let i = 0; i < MAX_PROPS; i++) {
    if (w.pAlive[i]) continue;
    tmpP.x = clamp(x, 40, w.arenaW - 40);
    tmpP.y = clamp(y, 40, w.arenaH - 40);
    if (w.blocks.length) push(w, tmpP, PROPS.r + 6);
    w.pAlive[i] = 1;
    w.pGen[i]!++;
    w.pKind[i] = w.rProp.int(2);
    w.pX[i] = tmpP.x;
    w.pY[i] = tmpP.y;
    return;
  }
}

/** 每拍：主角碰到的摆设碎掉掉东西；隔一阵在主角附近补摆设，走到哪都有得砸 */
function props(w: World): void {
  const rr = (PROPS.r + PLAYER.r) * (PROPS.r + PLAYER.r);
  for (let i = 0; i < MAX_PROPS; i++) {
    if (!w.pAlive[i]) continue;
    const dx = w.pX[i]! - w.x;
    const dy = w.pY[i]! - w.y;
    if (dx * dx + dy * dy > rr) continue;
    w.pAlive[i] = 0;
    w.propsBroken++;
    const x = w.pX[i]!;
    const y = w.pY[i]!;
    const L = PROPS.loot;
    const r = w.rProp.next();
    let got: number = 0;
    if (r < L.bun) (got = Drop.Bun), addDrop(w, Drop.Bun, x, y, DROPS.bunHeal);
    else if (r < L.bun + L.coins) {
      got = Drop.Coin;
      for (let k = 0; k < PROPS.coins; k++) addDrop(w, Drop.Coin, x + (w.rProp.next() - 0.5) * 40, y + (w.rProp.next() - 0.5) * 30, 1);
    } else if (r < L.bun + L.coins + L.scroll) (got = Drop.Scroll), addDrop(w, Drop.Scroll, x, y, 1);
    else if (r < L.bun + L.coins + L.scroll + L.bomb) (got = Drop.Bomb), addDrop(w, Drop.Bomb, x, y, 1);
    else if (r < L.bun + L.coins + L.scroll + L.bomb + L.purse) (got = Drop.Purse), addDrop(w, Drop.Purse, x, y, 1);
    w.ev.push(Ev.Prop, x, y, w.pKind[i]!, got);
  }
  if (w.tick < w.propAt) return;
  w.propAt = w.tick + PROPS.every;
  let near = 0;
  for (let i = 0; i < MAX_PROPS; i++) {
    if (!w.pAlive[i]) continue;
    const dx = w.pX[i]! - w.x;
    const dy = w.pY[i]! - w.y;
    if (dx * dx + dy * dy < PROPS.nearR * PROPS.nearR) near++;
  }
  if (near >= PROPS.near) return;
  const a = w.rProp.int(DIR_N);
  const d = PROPS.minR + w.rProp.next() * (PROPS.nearR - PROPS.minR);
  addProp(w, w.x + dcos(a) * d, w.y + dsin(a) * d);
}

/** 符咒炸弹：半径内的小怪全倒（照常掉魂珠、算击杀），精英和 Boss 掉一截血 */
function bomb(w: World, x: number, y: number): void {
  w.ev.push(Ev.Bomb, x, y, 0, BOMB.r);
  chop(w, x, y, BOMB.r * 0.6, 400);
  const hit: number[] = [];
  for (let i = 0; i < MAX_ENEMIES; i++) {
    if (!w.eAlive[i]) continue;
    const dx = w.eX[i]! - x;
    const dy = w.eY[i]! - y;
    if (dx * dx + dy * dy <= BOMB.r * BOMB.r) hit.push(i);
  }
  for (const i of hit) {
    const def = ENEMIES[w.eKind[i]!]!;
    const big = def.elite || def.boss || def.kind === 'lord';
    hitEnemy(w, i, big ? w.eHpMax[i]! * BOMB.eliteFrac : w.eHp[i]! + 1, -1, w.eX[i]! - x, w.eY[i]! - y, 30, 0, -1);
  }
}

// ───────────────────────── 升级、宝箱 ─────────────────────────

function recompute(w: World): void {
  const p = (id: PassiveId): number => w.passives[id] ?? 0;
  const s = baseStats();
  s.might = 1 + 0.1 * p('zhusha');
  s.cdMul = 1 - 0.08 * p('xianglu');
  s.speed = PLAYER.speed * (1 + 0.1 * p('caoxie'));
  // 仙桃每级血上限 +15、每秒回 0.25（原来 +20、0.3：满级血翻倍还每秒回 1.5，是最强的一件被动，见 CHANGELOG）
  s.hpMax = PLAYER.hp + 15 * p('xiantao');
  s.regen = 0.25 * p('xiantao');
  s.magnet = PLAYER.magnet * (1 + 0.3 * p('luopan'));
  s.armor = p('daopao');
  s.areaMul = 1 + 0.1 * p('nianzhu');
  s.amount = p('lingpai');
  s.luck = 0.1 * p('huangli');
  s.xpMul = 1 + 0.08 * p('lingzhi') + 0.12 * p('yinhun');
  s.coinBonus = 0.12 * p('yinhun');
  s.durMul = 1 + 0.1 * p('modou') + 0.06 * p('jiandao');
  s.curse = p('yinhun');
  s.bindDouble = w.weapons.some((o) => o.id === 'rope' && o.evolved);
  // 永久加成（实盘为空）
  s.might *= 1 + PERK_FX.liliang * perk(w, 'liliang');
  s.armor += PERK_FX.huti * perk(w, 'huti');
  s.hpMax += PERK_FX.tipo * perk(w, 'tipo');
  s.speed *= 1 + PERK_FX.shenxing * perk(w, 'shenxing');
  s.cdMul *= 1 - PERK_FX.lingqi * perk(w, 'lingqi');
  s.xpMul += PERK_FX.wuxing * perk(w, 'wuxing');
  s.luck += PERK_FX.fuyuan * perk(w, 'fuyuan');
  s.coinBonus += PERK_FX.fuyuan * perk(w, 'fuyuan');
  // 角色被动
  const ch = w.setup.character;
  if (ch === 'xiaodao') {
    const up = 1 + CHAR_FX.xiaodaoStep * Math.floor(w.level / CHAR_FX.xiaodaoEvery);
    s.might *= up;
    s.areaMul *= up;
    s.durMul *= up;
    s.speed *= up;
  } else if (ch === 'caiyao') {
    s.xpMul += CHAR_FX.caiyaoXp;
    s.regen += CHAR_FX.caiyaoRegen;
  } else if (ch === 'pang') {
    s.hpMax += CHAR_FX.pangHp;
    s.speed *= CHAR_FX.pangSpeed;
  }
  // 套装：按类型和五行数件数
  const types: Partial<Record<WeaponType, number>> = {};
  const els: Partial<Record<Element, number>> = {};
  for (const o of w.weapons) {
    const d = WEAPONS[o.id];
    types[d.type] = (types[d.type] ?? 0) + 1;
    els[d.el] = (els[d.el] ?? 0) + 1;
  }
  const t = (k: WeaponType): number => types[k] ?? 0;
  w.sets = [];
  for (const k of Object.keys(TYPE_SETS) as WeaponType[]) if (t(k) >= 2) w.sets.push(`${k}${t(k) >= 3 ? 3 : 2}`);
  if (t('剑') >= 2) s.critAdd = 0.08;
  if (t('剑') >= 3) s.critDmg = 0.5;
  if (ch === 'jianxia') s.critDmg += CHAR_FX.jianxiaCritDmg;
  if (t('符') >= 2) s.cdMul *= 0.92;
  if (t('镇') >= 2) s.areaMul *= 1.12;
  if (t('镇') >= 3) s.nearSlow = true;
  if (t('灵') >= 2) s.durMul *= 1.15;
  const elMul: Partial<Record<Element, number>> = {};
  for (const e of Object.keys(els) as Element[]) {
    const n = els[e]!;
    if (n < 2) continue;
    w.sets.push(`${e}${n >= 3 ? 3 : 2}`);
    elMul[e] = (elMul[e] ?? 1) + 0.1;
    if (n >= 3) elMul[NEXT_ELEMENT[e]] = (elMul[NEXT_ELEMENT[e]] ?? 1) + 0.1;
  }
  const grow = s.hpMax - w.stats.hpMax;
  w.stats = s;
  if (grow > 0) w.hp += grow;
  w.wstats = w.weapons.map((o) => {
    const ws = weaponStats(o.id, o.level, o.evolved);
    const d = WEAPONS[o.id];
    ws.dmg *= (elMul[d.el] ?? 1) * (d.type === '灵' && t('灵') >= 3 ? 1.25 : 1);
    if (d.type === '符' && t('符') >= 3) ws.amount += 1;
    if (d.type === '符' && ch === 'fushi') ws.cd *= CHAR_FX.fushiCd;
    return ws;
  });
}

// ───────────────────────── 双修（DESIGN.md 3.3b；数值在 DUAL_FX） ─────────────────────────

/** 符剑合璧：飞剑打中的怪贴一张符（已有就不重贴），DUAL_FX.seal.delay 拍后炸 */
function sealEnemy(w: World, i: number): void {
  if (w.eMark[i]! > 0 || !w.eAlive[i] || !w.merges.includes('fujian')) return;
  w.eMark[i] = w.tick + DUAL_FX.seal.delay;
  w.marks++;
  w.ev.push(Ev.Seal, w.eX[i]!, w.eY[i]!, 0, 0, i);
}

/** 怪没了（被打死、被清掉）就把它身上的符一并去掉；在刷怪之前跑，免得符落到顶替它的新怪身上 */
function clearDeadSeals(w: World): void {
  for (let i = 0; i < MAX_ENEMIES; i++) {
    if (w.eMark[i]! > 0 && !w.eAlive[i]) {
      w.eMark[i] = 0;
      w.marks--;
    }
  }
}

/** 双修每拍要做的事：贴着的符到点就炸；焚天金钟的火环 */
function dualTick(w: World, g: Grid): void {
  if (w.marks > 0) {
    const kt = w.weapons.findIndex((o) => o.id === 'talisman');
    const dmg = kt >= 0 ? eff(w, w.wstats[kt]!).dmg * DUAL_FX.seal.mul : 0;
    const area = DUAL_FX.seal.area * w.stats.areaMul;
    // 先收齐到点的，再统一炸（炸的时候怪可能死，不能边扫边改）
    let due = 0;
    for (let i = 0; i < MAX_ENEMIES; i++) {
      if (w.eMark[i]! === 0) continue;
      if (!w.eAlive[i]) {
        w.eMark[i] = 0;
        w.marks--;
      } else if (w.tick >= w.eMark[i]!) sealDue[due++] = i;
    }
    for (let q = 0; q < due; q++) {
      const i = sealDue[q]!;
      w.eMark[i] = 0;
      w.marks--;
      if (!w.eAlive[i] || kt < 0) continue;
      const bx = w.eX[i]!;
      const by = w.eY[i]!;
      w.ev.push(Ev.Seal, bx, by, 1, area, i);
      const n = g.query(w, bx, by, area);
      for (let r = 0; r < n; r++) scratch2[r] = g.out[r]!;
      for (let r = 0; r < n; r++) hitEnemy(w, scratch2[r]!, dmg, -1, w.eX[scratch2[r]!]! - bx, w.eY[scratch2[r]!]! - by, 0, 0, kt);
    }
  }
  if (w.shield > 0 && w.tick % DUAL_FX.ring.every === 0 && w.merges.includes('fenzhong')) {
    const kg = w.weapons.findIndex((o) => o.id === 'gourd');
    if (kg < 0) return;
    const R = DUAL_FX.ring.radius * w.stats.areaMul;
    const inner = R * DUAL_FX.ring.inner;
    const dmg = eff(w, w.wstats[kg]!).dmg * DUAL_FX.ring.mul;
    w.ev.push(Ev.FireRing, w.x, w.y, 0, R);
    const n = g.query(w, w.x, w.y, R);
    for (let q = 0; q < n; q++) scratch[q] = g.out[q]!;
    for (let q = 0; q < n; q++) {
      const i = scratch[q]!;
      const dx = w.eX[i]! - w.x;
      const dy = w.eY[i]! - w.y;
      if (dx * dx + dy * dy < inner * inner) continue;
      hitEnemy(w, i, dmg, -1, dx, dy, 0, 0, kg);
    }
  }
}

/** 焚天金钟：盾碎时在外圈留几摊火（用火葫芦的火摊，伤害按葫芦算） */
function shieldFire(w: World): void {
  const kg = w.weapons.findIndex((o) => o.id === 'gourd');
  if (kg < 0) return;
  const F = DUAL_FX.ring;
  const dmg = eff(w, w.wstats[kg]!).dmg * F.poolMul;
  const life = Math.round(F.poolLife * w.stats.durMul);
  const r = F.radius * w.stats.areaMul * 0.8;
  for (let j = 0; j < F.pools; j++) {
    const a = Math.floor((j * DIR_N) / F.pools) + w.face;
    const bx = w.x + dcos(a) * r;
    const by = w.y + dsin(a) * r;
    addShot(w, Shot.Burn, bx, by, 0, 0, life, dmg, F.poolR, 0, kg, 0);
    w.ev.push(Ev.Burn, bx, by, 0, F.poolR, life);
  }
}

/** 铃落桃花：空中的花瓣朝最近的怪挪过去（挪到头顶就停），落地时的圈也大一点 */
function homePetal(w: World, g: Grid, i: number): void {
  const P = DUAL_FX.petal;
  if (w.sR[i]! < 34 + P.bonusR) w.sR[i] = 34 + P.bonusR;
  const t = nearest(w, g, w.sX[i]!, w.sY[i]!, P.reach);
  if (t < 0) return;
  const dx = w.eX[t]! - w.sX[i]!;
  const dy = w.eY[t]! - w.sY[i]!;
  const d = fsqrt(dx * dx + dy * dy);
  if (d <= P.speed) {
    w.sX[i] = w.eX[t]!;
    w.sY[i] = w.eY[t]!;
  } else {
    w.sX[i]! += (dx / d) * P.speed;
    w.sY[i]! += (dy / d) * P.speed;
  }
}

/** 测试和调试用：开局直接给一件法器（到某一级、可直接进化）。规则照常，只是跳过选卡 */
export function grantWeapon(w: World, id: WeaponId, level = 1, evolved = false): void {
  const o = w.weapons.find((x) => x.id === id);
  if (!o) addWeapon(w, id);
  const owned = w.weapons.find((x) => x.id === id)!;
  owned.level = Math.max(owned.level, Math.min(MAX_WEAPON_LEVEL, level));
  if (evolved && WEAPONS[id].evolve) owned.evolved = true;
  recompute(w);
}

/** 测试和调试用：在 (x, y) 放一只怪，返回编号 */
export function spawnNow(w: World, kind: EnemyKind, x: number, y: number): number {
  return spawnEnemy(w, kind, x, y);
}

/** 测试和调试用：当场开一个宝箱 */
export function openChestNow(w: World): void {
  openChest(w);
}

function addWeapon(w: World, id: WeaponId): void {
  w.weapons.push({ id, level: 1, evolved: false, timer: 8, phase: 0, angle: 0, dmg: 0, kills: 0 });
  recompute(w);
}

function upgradeWeapon(w: World, id: WeaponId): void {
  const o = w.weapons.find((x) => x.id === id);
  if (!o) return addWeapon(w, id);
  if (o.level < MAX_WEAPON_LEVEL) o.level++;
  recompute(w);
}

function upgradePassive(w: World, id: PassiveId): void {
  w.passives[id] = Math.min(PASSIVES[id].max, (w.passives[id] ?? 0) + 1);
  recompute(w);
}

/** 三选一的候选：手上没满级的法器、还能拿的新法器、被动同理 */
/** 实盘局不进卡池的新内容（Setup.live） */
const LIVE_HIDDEN: readonly string[] = ['zhibing', 'jiandao'];

function choicePool(w: World): { c: Choice; weight: number }[] {
  const pool: { c: Choice; weight: number }[] = [];
  const hide = w.setup.live ? LIVE_HIDDEN : [];
  for (const id of WEAPON_IDS) {
    if (w.banned.includes(id) || hide.includes(id)) continue;
    const o = w.weapons.find((x) => x.id === id);
    if (o) {
      // 黄历：手上东西的升级更容易出（好卡）
      if (!o.evolved && o.level < MAX_WEAPON_LEVEL) pool.push({ c: { kind: 'weapon', id }, weight: 1.3 * (1 + w.stats.luck) });
    } else if (w.weapons.length < MAX_WEAPONS + w.merges.length) pool.push({ c: { kind: 'weapon', id }, weight: 1 });
  }
  const owned = Object.keys(w.passives).length;
  for (const id of PASSIVE_IDS) {
    if (w.banned.includes(id) || hide.includes(id)) continue;
    const lv = w.passives[id];
    if (lv !== undefined) {
      if (lv < PASSIVES[id].max) pool.push({ c: { kind: 'passive', id }, weight: 1 + w.stats.luck });
    } else if (owned < MAX_PASSIVES) pool.push({ c: { kind: 'passive', id }, weight: 0.8 });
  }
  return pool;
}

function openChoices(w: World): void {
  const pool = choicePool(w);
  const picks: Choice[] = [];
  // 新手档前几次升级：先从法器里抽两张，保证有能打的（主线 #144）
  const arms = w.level <= dangerDef(w.setup.mode, w.setup.danger).armsFirst + 1 ? 2 : 0;
  while (picks.length < w.cardCount && pool.length > 0) {
    const only = picks.length < arms && pool.some((p) => p.c.kind === 'weapon');
    let total = 0;
    for (const p of pool) if (!only || p.c.kind === 'weapon') total += p.weight;
    let r = w.rUp.next() * total;
    let k = -1;
    for (let q = 0; q < pool.length; q++) {
      if (only && pool[q]!.c.kind !== 'weapon') continue;
      k = q;
      r -= pool[q]!.weight;
      if (r < 0) break;
    }
    picks.push(pool[k]!.c);
    pool.splice(k, 1);
  }
  if (picks.length === 0) picks.push({ kind: 'coins', id: 'coins' });
  w.choices = picks;
  w.phase = 'choose';
}

function applyChoice(w: World, c: Choice): void {
  if (c.kind === 'weapon') upgradeWeapon(w, c.id as WeaponId);
  else if (c.kind === 'passive') upgradePassive(w, c.id as PassiveId);
  else {
    w.coins += 25;
    heal(w, 20);
  }
  w.pendingLevels--;
  w.choices = [];
  w.phase = 'play';
  if (w.pendingLevels > 0) openChoices(w);
}

/** 宝箱：能合成先合成，能进化就进化；不然随机升一件手上的东西（黄历：有概率再升一件）；都满了给铜钱和回血 */
function openChest(w: World): void {
  for (let m = 0; m < MERGES.length; m++) {
    const def = MERGES[m]!;
    if (w.merges.includes(def.id) || (def.dual && w.setup.noDual)) continue;
    const a = w.weapons.find((o) => o.id === def.a);
    const b = w.weapons.find((o) => o.id === def.b);
    // 老的三个合成要两件都进化；双修（1.1）门槛低一点：一件进化、另一件满级就行（机器人每 20 局只合成 1–2 次，玩家更难见到）
    const ok = def.dual
      ? !!a && !!b && ((a.evolved && (b.evolved || b.level >= MAX_WEAPON_LEVEL)) || (b.evolved && a.level >= MAX_WEAPON_LEVEL))
      : !!a?.evolved && !!b?.evolved;
    if (ok) {
      w.merges.push(def.id);
      recompute(w);
      w.ev.push(Ev.Merge, w.x, w.y, m);
      w.ev.push(Ev.Chest, w.x, w.y, MERGE_CODE + m);
      return;
    }
  }
  for (const o of w.weapons) {
    const evo = WEAPONS[o.id].evolve;
    if (!o.evolved && evo && o.level >= MAX_WEAPON_LEVEL && (w.passives[evo.with] ?? 0) > 0) {
      o.evolved = true;
      recompute(w);
      w.ev.push(Ev.Evolve, w.x, w.y, WEAPON_CODE[o.id]);
      w.ev.push(Ev.Chest, w.x, w.y, WEAPON_CODE[o.id]);
      return;
    }
  }
  w.chestUps++;
  if (!chestUpgrade(w)) {
    w.coins += 40;
    w.coinBy.chest += 40;
    heal(w, 30);
    w.ev.push(Ev.Chest, w.x, w.y, -1);
    return;
  }
  if (w.stats.luck > 0 && w.rChest.next() < w.stats.luck) chestUpgrade(w);
}

/** 宝箱里随机升一件手上没满的；没有可升的返回 false */
function chestUpgrade(w: World): boolean {
  const pool: Choice[] = [];
  for (const o of w.weapons) if (!o.evolved && o.level < MAX_WEAPON_LEVEL) pool.push({ kind: 'weapon', id: o.id });
  for (const id of PASSIVE_IDS) if ((w.passives[id] ?? 0) > 0 && w.passives[id]! < PASSIVES[id].max) pool.push({ kind: 'passive', id });
  if (pool.length === 0) return false;
  const c = pool[w.rChest.int(pool.length)]!;
  if (c.kind === 'weapon') upgradeWeapon(w, c.id as WeaponId);
  else upgradePassive(w, c.id as PassiveId);
  w.ev.push(Ev.Chest, w.x, w.y, c.kind === 'weapon' ? WEAPON_CODE[c.id as WeaponId] : PASSIVE_CODE[c.id as PassiveId]);
  return true;
}
