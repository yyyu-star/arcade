/**
 * 状态指纹：把一局的全部状态哈希成一个 32 位数。重放测试逐拍比它（同种子 + 同输入 → 逐位相同，模块 AGENTS.md 第 3 节）。
 * 浮点按 IEEE 754 的位来哈希（Float64Array 的底层字节），差最后一位也看得出来。
 */
import type { World } from './state.ts';

function mix(h: number, v: number): number {
  h ^= v;
  return Math.imul(h, 0x01000193) >>> 0;
}

function arr(h: number, a: ArrayBufferView): number {
  const u = new Uint32Array(a.buffer, a.byteOffset, a.byteLength >>> 2);
  for (let i = 0; i < u.length; i++) h = mix(h, u[i]!);
  // 长度不是 4 的倍数的（Uint8Array）补上尾巴
  const tail = new Uint8Array(a.buffer, a.byteOffset + (u.length << 2), a.byteLength & 3);
  for (let i = 0; i < tail.length; i++) h = mix(h, tail[i]!);
  return h;
}

const f64 = new Float64Array(1);
function num(h: number, v: number): number {
  f64[0] = v;
  return arr(h, f64);
}

export function fingerprint(w: World): number {
  let h = 0x811c9dc5;
  for (const v of [w.tick, w.x, w.y, w.hp, w.face, w.invuln, w.level, w.xp, w.pendingLevels, w.kills, w.coins, w.spawnAcc, w.nextEvent, w.regenAcc, w.slowUntil, w.calmUntil]) h = num(h, v);
  h = mix(h, w.phase === 'play' ? 1 : w.phase === 'choose' ? 2 : 3);
  for (const o of w.weapons) for (const v of [o.level, o.evolved ? 1 : 0, o.timer, o.phase, o.angle]) h = num(h, v);
  for (const [k, v] of Object.entries(w.passives).sort()) h = num(h ^ k.charCodeAt(0), v ?? 0);
  for (const r of [w.rSpawn, w.rDrop, w.rUp, w.rChest, w.rAi, w.rHit, w.rWeapon]) for (const v of r.snapshot()) h = mix(h, v >>> 0);
  for (const a of [w.eAlive, w.eKind, w.eX, w.eY, w.eKX, w.eKY, w.eHp, w.eT, w.eS, w.ePhase, w.eHitAt, w.sAlive, w.sKind, w.sX, w.sY, w.sVX, w.sVY, w.sLife, w.sState, w.dAlive, w.dKind, w.dX, w.dY, w.dVal, w.dPull]) h = arr(h, a);
  return h >>> 0;
}
