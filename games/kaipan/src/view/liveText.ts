/**
 * 0.6.0 实盘的文字（docs/design-live.md 第 5 节）：结算、确认框、开局失败的说法都在这里，测试按词表检查（不出现"回本""再来一把"之类）。
 * 只说事实、输了说安慰话，不催、不倒计时、不推荐更高的档位。不依赖 Phaser，测试直接读。
 */
import { liveReturn } from '../core/liveTiers.ts';
import type { LiveRecord } from '../platform/live.ts';
import { group } from '../core/format.ts';

/** 筹码数：千分位（不用 toLocaleString：各浏览器的分隔符不一样） */
export function chips(n: number): string {
  return group(Math.trunc(n));
}

/** 带正负号的差额：+120 / −360（减号用全角的 −，和游戏里的钱一致） */
export function chipsDiff(n: number): string {
  return n > 0 ? `+${chips(n)}` : n < 0 ? `−${chips(-n)}` : '±0';
}

export const LIVE_RULE = '打半年，按最后的资产结回：赚了最多拿回 3 份，赔光就是这一份';
export const LIVE_WALLET_NOTE = '无任何现金价值';

/** 回大厅：实盘局不算退出，回来接着打完再结 */
export const LIVE_LOBBY_CONFIRM = { title: '回大厅？', body: '这局实盘会存着，回来接着打完再结算。', ok: '回大厅' } as const;

/** 实盘没打完时开别的局 */
export const LIVE_GUARD = {
  title: '实盘这局还没打完',
  body: '先回去打完再开别的。不想打了也可以提前收手，按现在的资产结算。',
  ok: '继续这局',
  quit: '提前收手',
} as const;

/** 「提前收手」的确认：还没开盘就原样退回，开盘以后按现在的资产结 */
export function quitConfirm(beforeOpen: boolean, stake: number, value: number): { title: string; body: string; ok: string } {
  return beforeOpen
    ? { title: '提前收手？', body: `还没开盘，这一份 ${chips(stake)} 筹码原样退回钱包。\n这局就到这里了。`, ok: '收手' }
    : { title: '提前收手？', body: `按现在的资产结算：约 ${chips(value)} 筹码。\n这局就到这里了。`, ok: '收手' };
}

/**
 * 带入没成的说法：标题、正文；wallet 表示给一个「去领补给」（钱包页）的按钮。
 * 0.6.5 照平台的错误码对照表（docs/platform-backend.md 15.10）：每种都说清出了什么事、怎么办。
 * code 是重试类（busy、internal）里钱包回的错误码。
 */
export function buyinFailText(error: string, why?: 'offline' | 'login', code?: string): { title: string; body: string; wallet?: boolean } {
  if (error === 'retry') {
    if (why === 'login') return { title: '还没登录', body: '登录以后才能玩实盘。娱乐模式随便玩。' };
    if (code === 'busy') return { title: '服务器今天有点忙', body: '服务器今天有点忙，先不能带筹码开局，明早恢复。娱乐模式照常玩。' };
    if (code === 'internal') return { title: '出了点问题', body: '出了点问题，筹码没动，过一会儿再试。可以先玩娱乐模式。' };
    return { title: '钱包暂时连不上', body: '钱包暂时连不上，这局没开成；要是那一份已经扣了，下次打开实盘时会自动退回。可以先玩娱乐模式。' };
  }
  switch (error) {
    case 'no_funds':
      return { title: '钱包里的筹码不够', body: '钱包里的筹码不够这一档。换小一档少带一点，或者去大厅领补给。', wallet: true };
    case 'at_table':
      return { title: '这一桌带的是别的档', body: '这一桌带的是别的档，换一桌再开：回开始菜单重新点「实盘」。' };
    case 'limit':
      return { title: '今天开局太多了', body: '今天开局太多了，明早 0 点恢复；桌上的照常结回。娱乐模式照常能玩。' };
    case 'pending':
      return { title: '上一局实盘还没结完', body: '上一局实盘的成绩记下了，联网后会自动结回，结完再开新的。' };
    default:
      return { title: '出了点问题', body: '出了点问题，这一份筹码没动，刷新一下再试。可以先玩娱乐模式。' };
  }
}

/** 结算的说法：head 是一行大字（结回多少），body 是一两句话。won 是打满了半年（不是破产、不是提前收手）。 */
export function liveEndText(r: Readonly<LiveRecord>, won: boolean): { head: string; body: string } {
  const bp = r.bp ?? 0;
  if (r.step === 'settling' || r.step === 'playing') {
    const body = r.wait === 'login' ? '成绩记下了，登录后自动结回。' : '成绩记下了，联网后自动结回。';
    return { head: r.kind === 'refund' ? `退回 ${chips(r.stake)} 筹码` : `约结回 ${chips(liveReturn(r.stake, bp))} 筹码`, body };
  }
  if (r.step === 'void') {
    return r.error === 'no_stake'
      ? { head: '这一份已经结过了', body: '这一份已经结过了，看看钱包里的余额。这局可以接着玩，但不再算筹码。' }
      : { head: '本金已原样退回', body: '这一份放了超过一天，已经原样退回钱包；可以接着玩，但不再算筹码。' };
  }
  // 结回被拒成开盘自己的 bug：那一份还在桌上，过一天钱包会原样退回
  if (r.step === 'error' || r.step === 'buying') return { head: '结算出了点问题', body: '出了点问题，这一份筹码没动；一天后会原样退回钱包。' };
  // done
  if (r.kind === 'refund') return { head: `退回 ${chips(r.credited ?? r.stake)} 筹码`, body: '还没开盘就收手了，这一份原样退回钱包。' };
  // 大字是进了钱包的数（回话里的 credited）；到顶没进的另说一句
  const got = r.credited ?? 0;
  const capped = r.capped ?? 0;
  const head = `结回 ${chips(got)} 筹码（${chipsDiff(got - r.stake)}）`;
  const times = `×${(bp / 10_000).toFixed(2)}`;
  const span = won ? '半年下来' : '这局';
  let body: string;
  if (got === 0 && capped === 0) body = `这次本金赔光了。炒股本来就有赢有输，别往心里去。钱包每天能领补给，明天还能来玩；也可以去玩娱乐模式，不花筹码。`;
  else if (got + capped < r.stake) body = `${span}小亏，资产 ${times}。行情有起有落，下次换个档位或换个打法试试。`;
  else body = `${span}资产 ${times}。`;
  if (capped > 0) body += `\n今天单机实盘赢够了：这局多出的 ${chips(capped)} 筹码没进钱包，明天再来。`;
  return { head, body };
}

/** 开始菜单在局外说一次结果（提前收手、离开结束页之后才结完、到期作废）的标题 */
export function liveNoticeTitle(r: Readonly<LiveRecord>): string {
  if (r.step === 'void') return '实盘这局不算筹码了';
  if (r.step === 'error') return '实盘结算出了点错';
  if (r.step === 'settling') return '实盘成绩记下了';
  return '实盘结算';
}
