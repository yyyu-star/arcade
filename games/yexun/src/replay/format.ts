/**
 * 录像格式（DESIGN.md 5.4）：规则版本 + 设置快照 + 种子 + 每一拍的方向（游程压缩）+ 升级选择（按拍号）。
 * 方向 0–32 各用一个符号，一段连续相同的方向写成「重复拍数（36 进制）+ 符号」；一局 15 分钟 27,000 拍，压缩后几 KB。
 */
import type { OnlineSetup } from '../online/types.ts';

/** 33 个符号：0 = 不动，1–32 = 32 向。都不是数字和小写字母，和 36 进制的拍数不会混 */
const DIR_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ!#$%&*+';

export interface ReplayRecord {
  v: 1;
  /** 录像的唯一 id（开局时间 + 种子） */
  id: string;
  /** 录制时的规则版本；和现在的不一样就标"旧版本" */
  rules: number;
  /** 开局时间（毫秒时间戳，显示用） */
  at: number;
  setup: OnlineSetup;
  /** 方向游程串 */
  dirs: string;
  /** 一共多少拍（只算推进时间的拍） */
  ticks: number;
  /** 升级时的选择，按先后：「拍号:选择」逗号隔开（选择 0–2 是三张卡，100+ 刷新，200+ 封禁，300 跳过） */
  picks: string;
  /** 打完时的状态指纹：重放到同一拍的指纹对不上就说明放歪了（规则变了） */
  fp: number;
  /** 结果小结（列表里显示，不用重放就能看） */
  summary: { won: boolean; quit: boolean; seconds: number; kills: number; level: number; bossKilled: boolean; loot: number; daily: string | null };
  /** 这是哪些榜自己最好的一局（榜名，如 vigil、daily-2026-10-17-raid）；空 = 普通的最近局 */
  bestFor: string[];
  /** 这一局在那些榜上的分数（给 bestFor 比较用） */
  scores: Record<string, number>;
}

export function encodeDirs(dirs: ArrayLike<number>): string {
  let out = '';
  let i = 0;
  while (i < dirs.length) {
    const d = dirs[i]!;
    let j = i + 1;
    while (j < dirs.length && dirs[j] === d) j++;
    out += (j - i).toString(36) + DIR_CHARS[d]!;
    i = j;
  }
  return out;
}

/** 解开；格式不对返回 null */
export function decodeDirs(s: string, ticks: number): Uint8Array | null {
  if (!Number.isSafeInteger(ticks) || ticks < 0 || ticks > 2_000_000) return null;
  const out = new Uint8Array(ticks);
  let at = 0;
  let i = 0;
  while (i < s.length) {
    let j = i;
    while (j < s.length && /[0-9a-z]/.test(s[j]!)) j++;
    const run = parseInt(s.slice(i, j), 36);
    const d = DIR_CHARS.indexOf(s[j] ?? '');
    if (j === i || d < 0 || !Number.isSafeInteger(run) || run < 1 || at + run > ticks) return null;
    out.fill(d, at, at + run);
    at += run;
    i = j + 1;
  }
  return at === ticks ? out : null;
}

export function encodePicks(picks: readonly { tick: number; choice: number }[]): string {
  return picks.map((p) => `${p.tick}:${p.choice}`).join(',');
}

export function decodePicks(s: string): { tick: number; choice: number }[] | null {
  if (s === '') return [];
  const out: { tick: number; choice: number }[] = [];
  for (const part of s.split(',')) {
    const m = /^(\d{1,7}):(\d{1,3})$/.exec(part);
    if (!m) return null;
    out.push({ tick: Number(m[1]), choice: Number(m[2]) });
  }
  return out;
}
