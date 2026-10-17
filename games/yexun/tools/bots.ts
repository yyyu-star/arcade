/**
 * 配平用的玩家模型（DESIGN.md 第 8 节，docs/balance.md 第 1 节）：确定性（带种子），只看主角周围一屏以内的东西。
 * - 小白：每 10 拍才重新决定方向，躲得粗、带噪声，见什么捡什么；升级挑"看起来最强"的（不看配方）。
 * - 普通：每 3 拍决定一次，按"怪的推力 + 魂珠的拉力 + 离墙的推力"走（势场），会躲火球；升级按流派挑，奔着进化去。
 * 流派（普通玩家选卡的偏好）：剑阵、符箓、镇守、木（五雷）、火，见 DESIGN.md 3.4；普通玩家三张都不想要时先刷新，刷新用完再跳过。
 */
import { ENEMIES } from '../src/content/enemies.ts';
import { ARENA } from '../src/content/player.ts';
import { WEAPONS, type PassiveId, type WeaponId } from '../src/content/weapons.ts';
import { Drop, MAX_DROPS, MAX_ENEMIES, MAX_SHOTS, Pick, Shot, type Choice, type World } from '../src/core/index.ts';
import { Rng } from '../src/core/rng.ts';

export type Skill = 'novice' | 'normal';
export type Build = 'sword' | 'talisman' | 'ward' | 'wood' | 'fire';
export const BUILD_IDS: Build[] = ['sword', 'talisman', 'ward', 'wood', 'fire'];

/** 各流派想要的法器（按先后）和被动（进化要的放前面） */
const BUILDS: Record<Build, { weapons: WeaponId[]; passives: PassiveId[] }> = {
  // 剑阵：剑类三件（剑 3 件暴击伤害），金 2 件
  sword: { weapons: ['sword', 'flysword', 'coins', 'thunder', 'bell'], passives: ['zhusha', 'caoxie', 'lingpai', 'xianglu', 'nianzhu', 'xiantao'] },
  // 符箓：符类三件（符 3 件多发一张）
  talisman: { weapons: ['talisman', 'thunder', 'crane', 'sword', 'flysword'], passives: ['xianglu', 'nianzhu', 'yinhun', 'zhusha', 'lingpai', 'caoxie'] },
  // 镇守：镇类四件（镇 3 件近身减速），靠光环和光波
  ward: { weapons: ['bell', 'mirror', 'shield', 'rope', 'sword'], passives: ['xiantao', 'daopao', 'huangli', 'modou', 'nianzhu', 'zhusha'] },
  // 木（五雷）：雷符、桃木剑、桃花雨，木 3 件（相生到火）
  wood: { weapons: ['thunder', 'sword', 'petals', 'talisman', 'gourd'], passives: ['nianzhu', 'zhusha', 'lingzhi', 'xianglu', 'luopan', 'xiantao'] },
  // 火：符咒、火葫芦，火 2 件
  fire: { weapons: ['talisman', 'gourd', 'thunder', 'sword', 'petals'], passives: ['xianglu', 'luopan', 'zhusha', 'nianzhu', 'lingpai', 'caoxie'] },
};

const VIEW = 560;

export class Bot {
  readonly skill: Skill;
  readonly build: Build;
  private readonly rng: Rng;
  private dir = 0;
  private wait = 0;

  constructor(skill: Skill, build: Build, seed: number) {
    this.skill = skill;
    this.build = build;
    this.rng = new Rng(seed, `bot-${skill}-${build}`);
  }

  /** 这一拍的输入：方向（0–32）和升级选择（-1 不选） */
  act(w: World): { dir: number; choice: number } {
    if (w.phase === 'choose') return { dir: 0, choice: this.choose(w) };
    if (--this.wait > 0) return { dir: this.dir, choice: -1 };
    this.wait = this.skill === 'normal' ? 3 : 10;
    this.dir = this.steer(w);
    return { dir: this.dir, choice: -1 };
  }

  private steer(w: World): number {
    const normal = this.skill === 'normal';
    let fx = 0;
    let fy = 0;
    // 怪的推力：贴身那一圈（快碰到了）推得很狠，再外一圈轻推；普通玩家看得更远、躲得更早
    const danger = normal ? 75 : 45;
    const aware = normal ? 170 : 90;
    let threat = 0;
    for (let i = 0; i < MAX_ENEMIES; i++) {
      if (!w.eAlive[i]) continue;
      const dx = w.x - w.eX[i]!;
      const dy = w.y - w.eY[i]!;
      const d = Math.hypot(dx, dy) - w.eR[i]!;
      if (d > aware) continue;
      const dmg = ENEMIES[w.eKind[i]!]!.dmg + 4;
      const k = d < danger ? (dmg * 3) / Math.max(4, d) : dmg / (aware * 2);
      const n = Math.max(1, Math.hypot(dx, dy));
      fx += (dx / n) * k;
      fy += (dy / n) * k;
      if (d < danger) threat++;
    }
    // 火球、蓄力要冲的狐狸（小白不看）：狐狸蹲下蓄力时往它冲的方向的侧面躲
    if (normal) {
      for (let i = 0; i < MAX_ENEMIES; i++) {
        if (!w.eAlive[i] || w.eS[i] !== 1) continue;
        const kind = ENEMIES[w.eKind[i]!]!.kind;
        if (kind !== 'fox' && kind !== 'whitefox') continue;
        const dx = w.x - w.eX[i]!;
        const dy = w.y - w.eY[i]!;
        const d = Math.hypot(dx, dy);
        if (d > 300 || d < 1) continue;
        // 冲的方向是 (eAX, eAY)；往垂直方向推，选离自己现在更近的那一侧
        const px = -w.eAY[i]!;
        const py = w.eAX[i]!;
        const side = dx * px + dy * py >= 0 ? 1 : -1;
        fx += px * side * 6;
        fy += py * side * 6;
      }
      for (let i = 0; i < MAX_SHOTS; i++) {
        if (!w.sAlive[i] || w.sKind[i] !== Shot.Fireball) continue;
        const dx = w.x - w.sX[i]!;
        const dy = w.y - w.sY[i]!;
        const d = Math.hypot(dx, dy);
        if (d > 110 || d < 1) continue;
        fx += (dx / d) * (40 / Math.max(10, d));
        fy += (dy / d) * (40 / Math.max(10, d));
      }
    }
    // 魂珠、宝箱、肉包的拉力：挑"近而且路上不挤"的（宝箱、肉包算得更近）
    let best = -1;
    let bd = (normal ? VIEW : 300) ** 2;
    for (let i = 0; i < MAX_DROPS; i++) {
      if (!w.dAlive[i]) continue;
      const dx = w.dX[i]! - w.x;
      const dy = w.dY[i]! - w.y;
      let d2 = dx * dx + dy * dy;
      if (w.dKind[i] === Drop.Chest || w.dKind[i] === Drop.Bun) d2 *= 0.25;
      if (d2 < bd) {
        bd = d2;
        best = i;
      }
    }
    let gx = 0;
    let gy = 0;
    if (best >= 0) {
      const dx = w.dX[best]! - w.x;
      const dy = w.dY[best]! - w.y;
      const d = Math.hypot(dx, dy) || 1;
      const pull = threat > 0 ? 0.3 : 1;
      gx = (dx / d) * pull;
      gy = (dy / d) * pull;
    }
    // 墙：离边 300 以内往里推
    const wall = (p: number, size: number): number => (p < 300 ? (300 - p) / 300 : p > size - 300 ? -(p - (size - 300)) / 300 : 0);
    let vx = fx + gx + wall(w.x, ARENA.w) * 1.5;
    let vy = fy + gy + wall(w.y, ARENA.h) * 1.5;
    // 没什么事：绕着场地中心慢慢兜圈（站着不动会被围死）
    if (Math.hypot(vx, vy) < 0.2) {
      const cx = ARENA.w / 2 - w.x;
      const cy = ARENA.h / 2 - w.y;
      vx += -cy * 0.002 + cx * 0.0005;
      vy += cx * 0.002 + cy * 0.0005;
    }
    // 小白：方向带噪声，偶尔走错
    if (!normal) {
      if (this.rng.next() < 0.15) return 1 + this.rng.int(32);
      vx += (this.rng.next() - 0.5) * 0.8;
      vy += (this.rng.next() - 0.5) * 0.8;
    }
    if (Math.hypot(vx, vy) < 1e-6) return 0;
    // 量化成 32 向（工具里可以用 Math.atan2：机器人不在规则核心里，只要自己确定）
    const a = Math.atan2(vy, vx);
    return 1 + (((Math.round((a / (Math.PI * 2)) * 32) % 32) + 32) % 32);
  }

  private choose(w: World): number {
    const cs = w.choices;
    if (this.skill === 'novice') {
      // 小白：只挑"看起来最强"的——法器先于被动，被动里挑字面上加伤害、加数量的；不看配方，带点随手（主线 #144）
      let k = 0;
      let ks = -Infinity;
      cs.forEach((c, i) => {
        const s = looksStrong(w, c) + this.rng.next() * 12;
        if (s > ks) {
          ks = s;
          k = i;
        }
      });
      return k;
    }
    const plan = BUILDS[this.build];
    let best = 0;
    let bs = -Infinity;
    cs.forEach((c, i) => {
      const s = this.score(w, c, plan);
      if (s > bs) {
        bs = s;
        best = i;
      }
    });
    // 三张都不在计划里（分数很低）：先刷新，刷新用完再跳过；还没凑够法器时不跳（拿到什么都比没有强）
    if (bs < 12) {
      if (w.rerolls > 0) return Pick.Reroll;
      if (w.weapons.length >= 4) return Pick.Skip;
    }
    return best;
  }

  private score(w: World, c: Choice, plan: { weapons: WeaponId[]; passives: PassiveId[] }): number {
    if (c.kind === 'coins') return 0;
    if (c.kind === 'weapon') {
      const id = c.id as WeaponId;
      const rank = plan.weapons.indexOf(id);
      const o = w.weapons.find((x) => x.id === id);
      if (o) return (rank >= 0 ? 60 - rank * 5 : 30) + (8 - o.level);
      return rank >= 0 ? 50 - rank * 6 : 10;
    }
    const id = c.id as PassiveId;
    // 进化要的被动：手上有对应法器时优先
    for (const o of w.weapons) if (WEAPONS[o.id].evolve?.with === id) return 58;
    const rank = plan.passives.indexOf(id);
    return rank >= 0 ? 40 - rank * 4 : 5;
  }
}

/** 小白眼里的"强"：新法器 > 升级手上的法器 > 写着伤害、数量、冷却的被动 > 其余被动 */
const LOOKS_STRONG: Partial<Record<PassiveId, number>> = { zhusha: 16, lingpai: 16, xianglu: 12, nianzhu: 10, xiantao: 8, daopao: 6 };
function looksStrong(w: World, c: Choice): number {
  if (c.kind === 'coins') return 0;
  if (c.kind === 'weapon') return w.weapons.some((x) => x.id === c.id) ? 20 : 24;
  return LOOKS_STRONG[c.id as PassiveId] ?? 2;
}
