/**
 * 守卫的行为（DESIGN.md 2.3、3.5）：守铜箱的精英、守金箱的巡夜将、守最值钱院子的镇门石兽、夜里游荡的巡夜将。
 * - 守卫：主角走近它守的地方（或离它很近）就追；追出离家 leash 远就回去，回去的路上主角再靠近又追。追不出院子，甩得掉。
 * - 巡夜将会追人：比主角慢一点，停下来搜箱就会被追上。
 * - 镇门石兽：扑击（先在落点画圈，再扑过去）、甩尾扫一圈（原地蓄力画圈）；血少于一半进二段，更勤、圈更大、连扑两下。
 * - 游荡的巡夜将：沿街在路口之间走，看见主角就追，主角跑远了就接着走。
 *
 * 读写的是核心的怪数组（GuardHost）；石兽的技能状态借用 eS（0 没放技能 1 扑击预警 2 扑在空中 3 甩尾预警）、eT（倒数）、
 * eAX / eAY（扑的方向）、eV（扑的速度）、ePhase（第几段）。随机用 raid.rAi。
 */
import { BEAST, RAID_LATE, ROAM_SPEED } from '../content/explore.ts';
import { dist, fsqrt } from '../core/fmath.ts';
import { RaidEv, type GuardFx, type GuardHost } from './host.ts';
import { guardCfg, Role, type Raid } from './raid.ts';

/** 这一拍守卫往哪走（单位向量）；own = 照这种怪自己的行为走（守铜箱的精英在追人时） */
export const GUARD_MOVE = { vx: 0, vy: 0, own: false };

const Idle = 0;
const Chase = 1;
const Home = 2;

/** 守卫 g（在怪槽位 i）这一拍：返回走多远，方向在 GUARD_MOVE */
export function guardStep(raid: Raid, g: number, h: GuardHost, i: number, fx: GuardFx): number {
  const M = GUARD_MOVE;
  M.vx = 0;
  M.vy = 0;
  M.own = false;
  const role = raid.gRole[g]!;
  if (role === Role.beast && h.eS[i] !== 0) return beastSkill(raid, g, h, i, fx);
  if (role === Role.roamer) return roam(raid, g, h, i);
  if (role === Role.goblin) {
    // 宝妖：主角 flee 以内就背着人跑（比主角慢一点，被墙角堵住就跑不掉），远了原地蹲着
    const ex = h.eX[i]!;
    const ey = h.eY[i]!;
    if (dist(h.x - ex, h.y - ey) > RAID_LATE.goblin.flee) return 0;
    head(ex, ey, 2 * ex - h.x, 2 * ey - h.y);
    return h.eSpeed[i]!;
  }

  const cfg = guardCfg(role);
  const ex = h.eX[i]!;
  const ey = h.eY[i]!;
  const hx = raid.gHomeX[g]!;
  const hy = raid.gHomeY[g]!;
  const dHome = dist(ex - hx, ey - hy);
  const sees = dist(h.x - hx, h.y - hy) < cfg.aggro || dist(h.x - ex, h.y - ey) < cfg.aggro * 0.6;
  const sp = h.eSpeed[i]!;
  let st = raid.gState[g]!;

  if (st === Chase && dHome > cfg.leash) st = Home;
  else if (st !== Chase && sees && dHome < cfg.leash) {
    st = Chase;
    h.ev.push(RaidEv.Alert, ex, ey, role, 0, i);
  }
  raid.gState[g] = st;

  if (st === Home) {
    if (dHome < 12) {
      raid.gState[g] = Idle;
      return 0;
    }
    head(ex, ey, hx, hy);
    return sp * cfg.homeSpeed;
  }
  if (st === Idle) {
    // 待着：被推开了就慢慢走回原位
    if (dHome < 12) return 0;
    head(ex, ey, hx, hy);
    return sp * 0.5;
  }
  // 追
  if (role === Role.copper) {
    M.own = true;
    return sp;
  }
  if (role === Role.beast) return beastChase(raid, h, i, sp);
  head(ex, ey, h.x, h.y);
  return sp;
}

function head(x: number, y: number, tx: number, ty: number): void {
  const dx = tx - x;
  const dy = ty - y;
  const d = fsqrt(dx * dx + dy * dy);
  if (d <= 0) return;
  GUARD_MOVE.vx = dx / d;
  GUARD_MOVE.vy = dy / d;
}

/** 石兽现在第几段（刚进二段发一个 Beast 事件 a = 4） */
function beastPhase(h: GuardHost, i: number): number {
  if (h.ePhase[i] === 0 && h.eHp[i]! < h.eHpMax[i]! * BEAST.phaseAt) {
    h.ePhase[i] = 1;
    h.ev.push(RaidEv.Beast, h.eX[i]!, h.eY[i]!, 4, 1);
  }
  return h.ePhase[i]!;
}

/** 石兽追人：边走边倒数，到点放技能（近了甩尾、远了扑） */
function beastChase(raid: Raid, h: GuardHost, i: number, sp: number): number {
  const phase = beastPhase(h, i);
  const ex = h.eX[i]!;
  const ey = h.eY[i]!;
  head(ex, ey, h.x, h.y);
  if (--h.eT[i]! > 0) return sp;
  const d = dist(h.x - ex, h.y - ey);
  const sweepR = phase ? BEAST.sweep.ragedRadius : BEAST.sweep.radius;
  if (d < sweepR * 1.1 && (d < BEAST.pounce.radius || raid.rAi.next() < 0.7)) {
    h.eS[i] = 3;
    h.eT[i] = BEAST.sweep.warn;
    h.ev.push(RaidEv.Beast, ex, ey, 2, sweepR);
    return 0;
  }
  if (d < BEAST.pounce.range) {
    startPounce(h, i, phase);
    return 0;
  }
  // 太远：再走一会儿
  h.eT[i] = 10;
  return sp;
}

function startPounce(h: GuardHost, i: number, phase: number): void {
  h.eS[i] = 1;
  h.eT[i] = BEAST.pounce.warn;
  // 落点：主角现在站的地方
  h.eAX[i] = h.x;
  h.eAY[i] = h.y;
  h.ev.push(RaidEv.Beast, h.x, h.y, 0, BEAST.pounce.radius * (phase ? 1.25 : 1));
}

/** 石兽放技能中（预警、扑在空中、甩尾蓄力）：放完才管别的 */
function beastSkill(raid: Raid, g: number, h: GuardHost, i: number, fx: GuardFx): number {
  const M = GUARD_MOVE;
  const phase = h.ePhase[i]!;
  const s = h.eS[i]!;
  const ex = h.eX[i]!;
  const ey = h.eY[i]!;
  if (s === 1) {
    if (--h.eT[i]! > 0) return 0;
    // 起跳：朝落点，fly 拍飞到
    const dx = h.eAX[i]! - ex;
    const dy = h.eAY[i]! - ey;
    const d = fsqrt(dx * dx + dy * dy);
    h.eS[i] = 2;
    h.eT[i] = BEAST.pounce.fly;
    h.eAX[i] = d > 0 ? dx / d : 0;
    h.eAY[i] = d > 0 ? dy / d : 0;
    h.eV[i] = d / BEAST.pounce.fly;
    M.vx = h.eAX[i]!;
    M.vy = h.eAY[i]!;
    return h.eV[i]!;
  }
  if (s === 2) {
    if (--h.eT[i]! > 0) {
      M.vx = h.eAX[i]!;
      M.vy = h.eAY[i]!;
      return h.eV[i]!;
    }
    const r = BEAST.pounce.radius * (phase ? 1.25 : 1);
    h.ev.push(RaidEv.Beast, ex, ey, 1, r);
    if (dist(h.x - ex, h.y - ey) < r) fx.hurt(BEAST.pounce.dmg);
    // 二段：连扑
    if (phase && raid.gChain[g]! + 1 < BEAST.ragedChain) {
      raid.gChain[g]!++;
      startPounce(h, i, phase);
      return 0;
    }
    raid.gChain[g] = 0;
    h.eS[i] = 0;
    h.eT[i] = BEAST.every[phase]!;
    return 0;
  }
  // 甩尾
  if (--h.eT[i]! > 0) return 0;
  const r = phase ? BEAST.sweep.ragedRadius : BEAST.sweep.radius;
  h.ev.push(RaidEv.Beast, ex, ey, 3, r);
  if (dist(h.x - ex, h.y - ey) < r) fx.hurt(BEAST.sweep.dmg);
  h.eS[i] = 0;
  h.eT[i] = BEAST.every[phase]!;
  return 0;
}

/** 游荡的巡夜将：沿街走路口，看见就追，跑远了放弃 */
function roam(raid: Raid, g: number, h: GuardHost, i: number): number {
  const cfg = guardCfg(Role.roamer);
  const ex = h.eX[i]!;
  const ey = h.eY[i]!;
  const dP = dist(h.x - ex, h.y - ey);
  const sp = h.eSpeed[i]!;
  if (raid.gState[g] === Chase) {
    if (dP > cfg.leash) {
      raid.gState[g] = Idle;
      raid.gNode[g] = nearestNode(raid, ex, ey);
      raid.gPrev[g] = -1;
    } else {
      head(ex, ey, h.x, h.y);
      return sp;
    }
  } else if (dP < cfg.aggro) {
    raid.gState[g] = Chase;
    h.ev.push(RaidEv.Alert, ex, ey, Role.roamer, 0, i);
    head(ex, ey, h.x, h.y);
    return sp;
  }
  const nodes = raid.map.nodes;
  let k = raid.gNode[g]!;
  if (k < 0) k = raid.gNode[g] = nearestNode(raid, ex, ey);
  if (k < 0) return 0;
  const node = nodes[k]!;
  if (dist(node.x - ex, node.y - ey) < 24) {
    // 到了路口：挑一条连着的街走（不走回头路，除非是死胡同）
    const links = raid.map.links[k]!;
    const prev = raid.gPrev[g]!;
    let next = -1;
    if (links.length === 1) next = links[0]!;
    else if (links.length > 1) {
      const pick = raid.rAi.int(links.length - (prev >= 0 && links.includes(prev) ? 1 : 0));
      let seen = 0;
      for (const l of links) {
        if (l === prev) continue;
        if (seen++ === pick) {
          next = l;
          break;
        }
      }
    }
    if (next < 0) return 0;
    raid.gPrev[g] = k;
    raid.gNode[g] = next;
    k = next;
  }
  const to = nodes[k]!;
  head(ex, ey, to.x, to.y);
  return sp * ROAM_SPEED;
}

function nearestNode(raid: Raid, x: number, y: number): number {
  let best = -1;
  let bd = Infinity;
  const nodes = raid.map.nodes;
  for (let k = 0; k < nodes.length; k++) {
    const d = dist(nodes[k]!.x - x, nodes[k]!.y - y);
    if (d < bd) {
      bd = d;
      best = k;
    }
  }
  return best;
}
