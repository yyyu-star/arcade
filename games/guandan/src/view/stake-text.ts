/**
 * 实盘的几句话（docs/stake.md 2.4、第 5 节）。和 quota-text.ts 一样不依赖别的文件：页面和实盘冒烟（tools/stake-smoke.ts，在 Node 里直接跑）共用，
 * 冒烟按这些字核对。
 */

/** 档位的名字 */
export const TIER_NAME = { small: '小档', mid: '中档', big: '大档', lux: '豪华档' } as const;

/** 电脑多强：1–4 颗星（仓库 docs/balance.md 第 5 节，四个游戏一样的写法） */
export function stars(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, 4 - n));
}

/**
 * 娱乐三档的卡（docs/ai.md 第 2 节）：电脑多强、一局多久、适合谁。娱乐一局打到过 A，随时存档；
 * 时长按模拟的中位数（新手档 8 副约 20 分钟，普通、高手 11 副约 30 分钟；我每手 4 秒估）
 */
export const LEVEL_CARD = {
  novice: { name: '新手', stars: 1, time: '一局约 20 分钟，随时存档', who: '刚学掼蛋，先赢几把找感觉' },
  normal: { name: '普通', stars: 2, time: '一局约 30 分钟，随时存档', who: '会打，想认真赢' },
  pro: { name: '高手', stars: 4, time: '一局约 30 分钟，随时存档', who: '老手，电脑全记牌、配合好' },
} as const;

/** 实盘四档的卡：电脑多强；一场 8 副约 20 分钟（docs/stake.md 1.4） */
export const TIER_CARD = {
  small: { stars: 1 },
  mid: { stars: 2 },
  big: { stars: 3 },
  lux: { stars: 4 },
  time: '约 20 分钟',
} as const;

/**
 * 钱包被拒、没连上时页面说的话（按 error）：照平台的错误码对照表（docs/platform-backend.md 15.10，0.10.2），
 * 每句都说清楚出了什么事、怎么办。掼蛋一份的大小跟档位走，"少带一点"就是换小一点的档
 */
export const STAKE_ERROR: Record<string, string> = {
  no_funds: '钱包里的筹码不够这一档，换小一点的档，或者去大厅领补给',
  limit: '今天开局太多了，明早 0 点恢复；桌上的照常结回，娱乐局照常玩',
  at_table: '这一桌带的是别的档，换一桌再开',
  expired: '这一份放太久了（超过 24 小时），已经原样退回钱包',
  no_stake: '这一份已经结过了',
  busy: '服务器今天有点忙，先不能带筹码开局；娱乐局照常玩，明早恢复',
  internal: '出了点问题，筹码没动，过一会儿再试',
  /** 掼蛋的 Worker 连不上钱包（RPC 抛异常） */
  unavailable: '钱包暂时连不上，筹码没动，过一会儿再试',
  login: '登录过期了，回大厅重新登录一下',
  /** bad_request、bad_amount 之类：程序写错了 */
  bad: '出了点问题，这一份筹码没动，刷新一下再试',
};

export function stakeError(error: string): string {
  return STAKE_ERROR[error] ?? STAKE_ERROR['bad']!;
}

export const STAKE_TEXT = {
  /** 选档页、结算页底下的小字（economy.md 第 0 节：界面写明） */
  noCash: '筹码只在游戏里用，无任何现金价值',
  walletDown: '钱包暂时连不上，实盘先开不了；娱乐局照常玩',
  lowFunds: '钱包里的筹码不够的档灰掉了：选小一点的档，或者去大厅领补给',
  /** 平台 0.9.5 起同一个游戏能同时有好几份：别处那一份不挡开新的，只是给个退回的办法 */
  elsewhere: '你在别的设备上还有一场掼蛋实盘没打完，不影响开新的；不想要了可以原样退回',
  refundAsk: '实盘还没开始计分，现在退出会把一份原样退回',
  settleLater: '钱包暂时连不上，结果存着，下次打开会接着结算',
  gone: '这一场已经结算过了',
  capped: (n: number) => `今天单机实盘赢够了，多出的 ${fmtChips(n)} 没进钱包；好友房不限`,
} as const;

/** 好友房实盘：这个座位这一场不计输赢的原因（房间的 why：钱包的错误码，或 need_two） */
export function roomWhy(why: string): string {
  if (why === 'need_two') return '开局时真人不到两个，这一场不计输赢';
  if (why === 'left') return '你中途离开过，那一份已经按当时的分结回';
  // 带入被拒（0.6.0 起旁边有"重新带入"）：照平台的对照表说清楚为什么、怎么办
  if (why === 'no_funds') return '钱包里的筹码不够这一档，没带上；去大厅领补给后点"重新带入"';
  if (why === 'limit') return '今天开局太多了，没带上；明早 0 点恢复，这局照常打';
  if (why === 'busy') return '服务器今天有点忙，没带上；这局照常打，过一会儿点"重新带入"';
  return '钱包暂时连不上，没带上；过一会儿点"重新带入"';
}

export const ROOM_STAKE_TEXT = {
  needTwo: '实盘好友房至少要两个人；一个人想玩实盘，去单机',
  bots: '电脑一律最强',
  /** 0.6.0 起离开立即结算 */
  leave: '离开房间？按现在的分马上结回钱包，之后电脑接着打，输赢不再算你的；回来会重新带入一份',
  pending: '带入在办，到账之前的分归庄家',
} as const;

/** 中途结算那一行（0.11.2）：按现在的分结回多少（back = 带入的一份加输赢，调用方用 stake 的 payout 算） */
export function settleNowText(points: number, chips: number, back: number): string {
  return `现在结算：按 ${signed(points)} 分（${signed(chips)}）结回 ${fmtChips(back)} 筹码`;
}

/**
 * 好友房实盘离开：把数字写出来。两副之间（结算页）当场结回（0.6.0）；一副打到一半走的，这一副电脑替他打完、输赢照算，打完按那时的分结回（0.12.4）
 */
export function roomLeaveText(points: number, chips: number, back: number, midDeal = false): string {
  if (midDeal) return `离开房间？这一副电脑替你打完、输赢照算，打完按那时的分结回（现在 ${signed(points)} 分，${signed(chips)}）；之后输赢不再算你的，回来会重新带入一份`;
  return `离开房间？按现在的 ${signed(points)} 分（${signed(chips)}）马上结回 ${fmtChips(back)} 筹码，之后电脑接着打，输赢不再算你的；回来会重新带入一份`;
}

/** 筹码数：千分位（不用 toLocaleString，免得跟着系统区域变） */
export function fmtChips(n: number): string {
  const s = String(Math.abs(Math.round(n))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return n < 0 ? `−${s}` : s;
}

/** 带符号的数：+1,500 / −1,500 / 0 */
export function signed(n: number): string {
  return n > 0 ? `+${fmtChips(n)}` : fmtChips(n);
}
