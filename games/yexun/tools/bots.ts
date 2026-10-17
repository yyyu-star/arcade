/**
 * 配平用的玩家模型（DESIGN.md 第 8 节，docs/balance.md 第 1 节）：确定性（带种子），只看主角周围一屏以内的东西。
 * - 小白：每 10 拍才重新决定方向，躲得粗、带噪声，见什么捡什么；升级挑"看起来最强"的（不看配方）。
 * - 普通：每 3 拍决定一次，按"怪的推力 + 魂珠的拉力 + 离墙的推力"走（势场），会躲火球；升级按流派挑，奔着进化去。
 * 流派（普通玩家选卡的偏好）：剑阵、符箓、镇守、木（五雷）、火，见 DESIGN.md 3.4；普通玩家三张都不想要时先刷新，刷新用完再跳过。
 */
import { ENEMIES } from '../src/content/enemies.ts';
import { ARENA } from '../src/content/player.ts';
import { MERGES, WEAPONS, type PassiveId, type WeaponId } from '../src/content/weapons.ts';
import { inputCos, inputSin } from '../src/core/fmath.ts';
import { Drop, MAX_DROPS, MAX_ENEMIES, MAX_PROPS, MAX_SHOTS, Pick, Shot, type Choice, type World } from '../src/core/index.ts';
import { Rng } from '../src/core/rng.ts';
import { mergeHint } from '../src/view/ui/mergeHint.ts';

export type Skill = 'novice' | 'normal';
export type Build = 'sword' | 'talisman' | 'ward' | 'wood' | 'fire';
export const BUILD_IDS: Build[] = ['sword', 'talisman', 'ward', 'wood', 'fire'];

/** 各流派想要的法器（按先后）和被动（进化要的放前面；仙桃谁都会拿，排第三） */
export const BUILDS: Record<Build, { weapons: WeaponId[]; passives: PassiveId[] }> = {
  // 剑阵：剑类三件（剑 3 件暴击伤害），金 2 件
  sword: { weapons: ['sword', 'flysword', 'coins', 'thunder', 'bell'], passives: ['zhusha', 'caoxie', 'lingpai', 'xianglu', 'nianzhu', 'xiantao'] },
  // 符箓：符类三件（符 3 件多发一张）
  talisman: { weapons: ['talisman', 'thunder', 'crane', 'sword', 'flysword'], passives: ['xianglu', 'nianzhu', 'xiantao', 'yinhun', 'zhusha', 'lingpai'] },
  // 镇守：镇类四件（镇 3 件近身减速），靠光环和光波
  ward: { weapons: ['bell', 'mirror', 'shield', 'rope', 'sword'], passives: ['xiantao', 'daopao', 'huangli', 'modou', 'nianzhu', 'zhusha'] },
  // 木（五雷）：雷符、桃木剑、桃花雨，木 3 件（相生到火）
  wood: { weapons: ['thunder', 'sword', 'petals', 'talisman', 'gourd'], passives: ['nianzhu', 'zhusha', 'xiantao', 'lingzhi', 'xianglu', 'luopan'] },
  // 火：符咒、火葫芦，火 2 件
  fire: { weapons: ['talisman', 'gourd', 'thunder', 'sword', 'petals'], passives: ['xianglu', 'luopan', 'xiantao', 'zhusha', 'nianzhu', 'lingpai'] },
};

const VIEW = 560;

export class Bot {
  readonly skill: Skill;
  readonly build: Build;
  private readonly rng: Rng;
  private dir = 0;
  private wait = 0;

  /** 会不会去凑双修的另一半（1.1 起模拟默认凑；13.3 的节奏验收按不凑的老口径量，见 tests/pace.test.ts） */
  readonly dual: boolean;

  constructor(skill: Skill, build: Build, seed: number, opts: { dual?: boolean } = {}) {
    this.dual = opts.dual ?? true;
    this.skill = skill;
    this.build = build;
    this.rng = new Rng(seed, `bot-${skill}-${build}`);
  }

  /** 夜探：要去的方向（RaidBot 给的 1–32），有就代替"捡掉落"的拉力；-1 = 站着搜箱子（不往哪拉）；0 = 守夜照旧。躲怪照旧 */
  goal = 0;
  /** 夜探：顺路捡附近的魂珠和掉落（要撤的时候关掉，不然捡个没完走不到门） */
  detour = true;

  /** 复用同一个结果对象（每拍一个新对象会让模拟器多花几个百分点在垃圾回收上）：调用方当拍用完，不要留着 */
  private readonly res = { dir: 0, choice: -1 };

  /** 这一拍的输入：方向（0–32）和升级选择（-1 不选） */
  act(w: World): { dir: number; choice: number } {
    const r = this.res;
    if (w.phase === 'choose') {
      r.dir = 0;
      r.choice = this.choose(w);
      return r;
    }
    r.choice = -1;
    if (--this.wait > 0) {
      r.dir = this.dir;
      return r;
    }
    this.wait = this.skill === 'normal' ? 3 : 10;
    this.dir = this.steer(w);
    r.dir = this.dir;
    return r;
  }

  private steer(w: World): number {
    const normal = this.skill === 'normal';
    let fx = 0;
    let fy = 0;
    // 怪的推力：贴身那一圈（快碰到了）推得很狠，再外一圈轻推；普通玩家看得更远、躲得更早
    const danger = normal ? 75 : 45;
    const aware = normal ? 170 : 90;
    let threat = 0;
    // 夜探的守卫（巡夜将、石兽）单算：不封顶、看得更远（危险 2 起机器人多半死在它们手里）
    let hx = 0;
    let hy = 0;
    for (let i = 0; i < MAX_ENEMIES; i++) {
      if (!w.eAlive[i]) continue;
      const dx = w.x - w.eX[i]!;
      const dy = w.y - w.eY[i]!;
      const d = Math.hypot(dx, dy) - w.eR[i]!;
      const kind = ENEMIES[w.eKind[i]!]!.kind;
      const guard = w.raid !== null && (kind === 'patrol' || kind === 'beast');
      const far = guard && normal ? 280 : aware;
      if (d > far) continue;
      const dmg = ENEMIES[w.eKind[i]!]!.dmg + 4;
      const k = d < danger ? (dmg * 3) / Math.max(4, d) : dmg / (far * 2);
      const n = Math.max(1, Math.hypot(dx, dy));
      if (guard) {
        hx += (dx / n) * k * 2;
        hy += (dy / n) * k * 2;
      } else {
        fx += (dx / n) * k;
        fy += (dy / n) * k;
      }
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
      if (w.dKind[i] === Drop.Chest || w.dKind[i] === Drop.Bun || w.dKind[i] === Drop.Bomb || w.dKind[i] === Drop.Purse) d2 *= 0.25;
      if (d2 < bd) {
        bd = d2;
        best = i;
      }
    }
    let tx = best >= 0 ? w.dX[best]! : 0;
    let ty = best >= 0 ? w.dY[best]! : 0;
    // 摆设：顺路的碰碎（算得比魂珠远一点，不专门绕远路）
    for (let i = 0; i < MAX_PROPS; i++) {
      if (!w.pAlive[i]) continue;
      const dx = w.pX[i]! - w.x;
      const dy = w.pY[i]! - w.y;
      const d2 = (dx * dx + dy * dy) * 1.5;
      if (d2 < bd) {
        bd = d2;
        best = MAX_DROPS + i;
        tx = w.pX[i]!;
        ty = w.pY[i]!;
      }
    }
    // 夜探：隔着墙的魂珠不去捡（按直线距离挑最近的，魂珠在墙那边就一直往墙上顶）
    if (best >= 0 && w.raid && blockedBy(w, w.x, w.y, tx, ty)) best = -1;
    let gx = 0;
    let gy = 0;
    // 夜探沿路走：怪的推力封顶。窄街里怪成群，不封顶就被推来推去原地打转（10 分钟开不了一个箱子）；
    // 玩家在夜探里是顶着怪沿路走、边走边打
    if (this.goal > 0 && w.raid) {
      const f = Math.hypot(fx, fy);
      const cap = 1.1;
      if (f > cap) {
        fx *= cap / f;
        fy *= cap / f;
      }
    }
    fx += hx;
    fy += hy;
    // 夜探：沿 RaidBot 的路走时墙由它绕；离开路去捡东西时照守夜的办法推开墙。
    // 身边有怪也捡贴脚的魂珠：危险 2 起身边几乎一直有怪，只在没怪时捡的话杀了几百只还是 3 级
    let following = this.goal < 0;
    if (this.goal < 0) {
      // 站着搜箱子：不加拉力，只躲怪
    } else if (this.goal > 0 && !(this.detour && best >= 0 && bd < (threat === 0 ? 300 * 300 : 170 * 170))) {
      following = true;
      // 夜探的路绕着墙走：拉力太弱时怪的推力会把人钉在墙上（10 分钟原地不动）
      const pull = threat > 0 ? 0.8 : 1;
      gx = inputCos(this.goal) * pull;
      gy = inputSin(this.goal) * pull;
    } else if (best >= 0) {
      const dx = tx - w.x;
      const dy = ty - w.y;
      const d = Math.hypot(dx, dy) || 1;
      const pull = threat > 0 ? 0.3 : 1;
      gx = (dx / d) * pull;
      gy = (dy / d) * pull;
    }
    // 墙：离边 300 以内往里推
    const wall = (p: number, size: number): number => (p < 300 ? (300 - p) / 300 : p > size - 300 ? -(p - (size - 300)) / 300 : 0);
    const AW = w.raid ? w.arenaW : ARENA.w;
    const AH = w.raid ? w.arenaH : ARENA.h;
    let vx = fx + gx + wall(w.x, AW) * 1.5;
    let vy = fy + gy + wall(w.y, AH) * 1.5;
    // 地图上的墙和棺材（义庄）：离得近就往外推，免得顶着墙走不动
    // 沿路走时只推贴得很近的（再远就和路抢方向，来回抖）
    const reach = following ? 28 : 70;
    for (const b of w.blocks) {
      // 远的块先快速跳过（竹林有九十来丛，每拍都算 hypot 太费）
      if (w.x < b.x - reach || w.x > b.x + b.w + reach || w.y < b.y - reach || w.y > b.y + b.h + reach) continue;
      const nx = Math.max(b.x, Math.min(w.x, b.x + b.w));
      const ny = Math.max(b.y, Math.min(w.y, b.y + b.h));
      const dx = w.x - nx;
      const dy = w.y - ny;
      const d = Math.hypot(dx, dy);
      if (d > reach || d < 1e-6) continue;
      vx += (dx / d) * (70 - d) / 35;
      vy += (dy / d) * (70 - d) / 35;
    }
    // 河滩：离水 70 以内往岸上推（水里走得慢，会被怪追上）；桥是水区之间的缺口，从缺口里走不受影响
    for (const r of w.water) {
      const nx = Math.max(r.x, Math.min(w.x, r.x + r.w));
      const ny = Math.max(r.y, Math.min(w.y, r.y + r.h));
      const dx = w.x - nx;
      const dy = w.y - ny;
      const d = Math.hypot(dx, dy);
      if (d > 70) continue;
      // 已经在水里（d = 0）：朝最近的边外推
      if (d < 1e-6) {
        const l = w.x - r.x;
        const rr = r.x + r.w - w.x;
        const t = w.y - r.y;
        const b = r.y + r.h - w.y;
        const m = Math.min(l, rr, t, b);
        if (m === l) vx -= 1.2;
        else if (m === rr) vx += 1.2;
        else if (m === t) vy -= 1.2;
        else vy += 1.2;
        continue;
      }
      vx += (dx / d) * (70 - d) / 50;
      vy += (dy / d) * (70 - d) / 50;
    }
    // 没什么事：绕着场地中心慢慢兜圈（站着不动会被围死）
    if (Math.hypot(vx, vy) < 0.2 && this.goal === 0) {
      const cx = AW / 2 - w.x;
      const cy = AH / 2 - w.y;
      vx += -cy * 0.002 + cx * 0.0005;
      vy += cx * 0.002 + cy * 0.0005;
    }
    // 小白：方向带噪声，偶尔走错
    if (!normal) {
      if (this.rng.next() < 0.15) return 1 + this.rng.int(32);
      vx += (this.rng.next() - 0.5) * 0.8;
      vy += (this.rng.next() - 0.5) * 0.8;
    }
    if (Math.hypot(vx, vy) < (this.goal < 0 ? 0.2 : 1e-6)) return 0;
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
      // 认得合成配方（和卡上的提示同一个纯函数）：正好凑成的先拿，差一步的往前排（1.1，双修以前机器人很少凑得齐）
      const h = mergeHint(w, c);
      const s = this.score(w, c, plan) + (h ? (h.ready ? 30 : 12) : 0) + this.dualPartner(w, c);
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

  /**
   * 双修配方的另一半：手上有配方的一件、还没合成，这张卡是另一件（新拿或升级）就加分，分量和流派单子里靠前的法器差不多。
   * 真人看得到卡上的"双"字提示会去凑；机器人按流派单子拿，不加这一条时配方另一半几乎从不进手（1.1 第一轮每 20 局不到 1 次）。
   */
  private dualPartner(w: World, c: Choice): number {
    if (!this.dual || c.kind !== 'weapon') return 0;
    for (const m of MERGES) {
      if (!m.dual || w.merges.includes(m.id)) continue;
      const other = c.id === m.a ? m.b : c.id === m.b ? m.a : null;
      if (other && w.weapons.some((o) => o.id === other)) return 20;
    }
    return 0;
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

/** 线段 (x0,y0)–(x1,y1) 穿不穿过某块墙（按 8 单位一步取点，墙最薄 26） */
function blockedBy(w: World, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 8));
  for (const b of w.blocks) {
    if (Math.max(x0, x1) < b.x || Math.min(x0, x1) > b.x + b.w || Math.max(y0, y1) < b.y || Math.min(y0, y1) > b.y + b.h) continue;
    for (let s = 0; s <= steps; s++) {
      const x = x0 + (dx * s) / steps;
      const y = y0 + (dy * s) / steps;
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return true;
    }
  }
  return false;
}
