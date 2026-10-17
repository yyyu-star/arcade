/**
 * 好友房一场结束的颁奖（docs/social.md 第 2 节"结束颁奖"，DESIGN.md 第 6 节）：只按结算里本来就公开的数评，不挂筹码、不进钱包。
 * - 本场 MVP：净赢最多的（要赢了才有）；
 * - 手气最背：净输最多的（要输了才有，和 MVP 不是同一个人）；
 * - 麻将特色：杠王（一场杠得最多、至少 2 个）；没人够数就看自摸王（自摸最多、至少 2 次）。
 * 一样多时按胡的局数、再按座位号定，同一场结果永远同一组奖。电脑座位也评（它们也是桌上的一家）。
 */

export type AwardId = 'mvp' | 'unlucky' | 'gang' | 'zimo';

export interface Award {
  id: AwardId;
  seat: number;
  /** 这个奖看的数：MVP 净赢、手气最背净输（正数）、杠王杠数、自摸王自摸次数 */
  n: number;
}

/** 每家公开的一场小计（视图里 seats[].stats 的一部分） */
export interface PublicTally {
  wins: number;
  zimo: number;
  gangs: number;
}

/** 特色奖的门槛：一场杠 2 个、自摸 2 次才算"王" */
const MIN_KING = 2;

export function awardsOf(nets: readonly number[], tally: readonly PublicTally[]): Award[] {
  const seats = nets.map((_, i) => i);
  // 先比 key，一样多比胡的局数，再一样按座位号（小的在前）
  const best = (key: (i: number) => number): number =>
    seats.reduce((a, b) => (key(b) > key(a) || (key(b) === key(a) && tally[b]!.wins > tally[a]!.wins) ? b : a));
  const out: Award[] = [];
  const mvp = best((i) => nets[i]!);
  if (nets[mvp]! > 0) out.push({ id: 'mvp', seat: mvp, n: nets[mvp]! });
  const worst = best((i) => -nets[i]!);
  if (nets[worst]! < 0 && worst !== mvp) out.push({ id: 'unlucky', seat: worst, n: -nets[worst]! });
  const gang = best((i) => tally[i]!.gangs);
  const zimo = best((i) => tally[i]!.zimo);
  if (tally[gang]!.gangs >= MIN_KING) out.push({ id: 'gang', seat: gang, n: tally[gang]!.gangs });
  else if (tally[zimo]!.zimo >= MIN_KING) out.push({ id: 'zimo', seat: zimo, n: tally[zimo]!.zimo });
  return out;
}
