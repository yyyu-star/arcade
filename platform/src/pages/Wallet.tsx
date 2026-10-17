/**
 * /wallet：我的筹码。余额、领每日补给、桌上的筹码（在哪个游戏、怎么拿回来）、今天实盘还能赢多少。
 * 规则见 docs/economy.md 第 3、4 节；筹码不能买、不能换、不能转（docs/project.md 底线）。
 * 电脑上（0.23.0）左边一列是余额、补给、桌上的、今天的实盘，右边是这周的输赢和"最近进出"（能按游戏筛）。
 */
import { useEffect, useState } from 'react';
import { api, errorText, type Stake, type Wallet } from '../api.ts';
import { gameName, num, signed, timeText, tone } from '../format.ts';
import { GAMES } from '../games.ts';
import { LedgerList } from '../ledger.tsx';
import { playUrl } from '../play.ts';
import { Link } from '../router.tsx';
import { useSession } from '../session.tsx';
import { Empty, FormError, Panel, Skeleton, useSubmit, useWritable } from '../ui.tsx';
import { useWallet } from '../wallet.tsx';
import { CoinIcon } from '../icons.tsx';

const gameOf = (id: string) => GAMES.find((g) => g.id === id);

/** 领不了补给的原因（服务端的判断见 worker/api/wallet.ts 的 relief，这里按同样的顺序说） */
function reliefBlocked(w: Wallet, reliefTo: number): string | null {
  if (w.canRelief && w.writesLeft > 0) return null;
  const onTable = w.stakes.reduce((t, s) => t + s.amount, 0);
  if (w.balance + onTable >= reliefTo) {
    return onTable ? `钱包加桌上的还有 ${num(w.balance + onTable)}，不到 ${num(reliefTo)} 才能领` : `筹码还够用，不到 ${num(reliefTo)} 才能领`;
  }
  if (w.writesLeft <= 0) return '今天操作太多了，明早 0 点再领';
  return '今天领过了，明天再来';
}

function StakeRow({ s }: { s: Stake }) {
  const g = gameOf(s.game);
  const room = s.mode === 'server';
  return (
    <li className="stake">
      <div className="stake__head">
        <strong>{gameName(s.game)}</strong>
        <span className="stake__mode">{room ? '好友房' : '单机'}</span>
        <span className="stake__amount">{num(s.amount)}</span>
      </div>
      <p className="note">
        {timeText(s.at)} 带上桌。
        {room
          ? '回房间点“离开房间”，这一手打完就结回；直接关了页面的话，房间里没人约 10 分钟后自动结回。'
          : `回那一桌离桌；放着不管，${timeText(s.until)} 原样退回。`}
      </p>
      {g && (
        <a className="inline-link" href={playUrl(g)}>
          去{g.name}
        </a>
      )}
    </li>
  );
}

/** 今天各游戏实盘的净赢和上限，一句话一个游戏 */
function capsText(game: string, c: { net: number; cap: number }): string {
  const left = Math.max(0, c.cap - c.net);
  const today = c.net >= 0 ? `赢了 ${num(c.net)}` : `输了 ${num(-c.net)}`;
  return left > 0 ? `${gameName(game)}：今天实盘${today}，还能再赢 ${num(left)}。` : `${gameName(game)}：今天实盘${today}，到顶了，明天再来赢。`;
}

/**
 * 这周带筹码的局赢了多少（接口的 week，和排行页"本周净赢"同一个数）：合计一个大数，每个游戏一根横条，赢的往右绿、输的往左红。
 * "今天"不放：流水只留最近 30 笔，拿它算今天的会对不上（主线 2026-10-17）
 */
function WeekSummary({ week }: { week: Record<string, number> }) {
  const list = Object.entries(week).filter(([, v]) => v !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  const total = list.reduce((t, [, v]) => t + v, 0);
  const max = Math.max(1, ...list.map(([, v]) => Math.abs(v)));
  return (
    <div className="week-sum" data-testid="week-summary">
      <p className="week-sum__total">
        <span className="note">本周净赢</span>
        <strong className={tone(total) ?? ''}>{signed(total)}</strong>
      </p>
      {list.length === 0 ? (
        <p className="note">这周还没打带筹码的局。</p>
      ) : (
        <ul className="week-bars">
          {list.map(([g, v]) => (
            <li key={g} className="week-bars__row">
              <span className="week-bars__name">{gameName(g)}</span>
              <span className="week-bars__track" aria-hidden="true">
                <span className={`week-bars__bar ${v > 0 ? 'week-bars__bar--up' : 'week-bars__bar--down'}`} style={{ width: `${(Math.abs(v) / max) * 50}%` }} />
              </span>
              <span className={`week-bars__value ${tone(v) ?? ''}`}>{signed(v)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="note">北京时间每周一 0 点清零，和排行榜的"本周净赢"一样。</p>
    </div>
  );
}

const OTHER = '_other';

export function WalletPage() {
  const { loading, user, service } = useSession();
  const { wallet, reliefTo, winUnits, ledger, week, error, refresh, set } = useWallet();
  const [only, setOnly] = useState<string | null>(null);
  const writable = useWritable();
  const relief = useSubmit(async () => {
    try {
      set((await api.relief()).wallet);
      // 再问一次，"最近进出"里才有刚领的这笔（一天就一次，不在补给接口里多回流水）
      void refresh();
    } catch (e) {
      // 被拒时多半是别处刚改了钱包（比如游戏里刚带入）：刷新一下，按钮和原因跟着对上
      void refresh();
      throw e;
    }
  });
  // 打开钱包页时刷新一次（顶栏的余额是登录时问的）
  useEffect(() => {
    if (user) void refresh();
  }, [user, refresh]);

  if (loading) return <Panel icon="coin" title="我的筹码"><Skeleton rows={3} /></Panel>;
  if (service === 'off') return <Panel icon="coin" title="我的筹码"><p className="note">账号服务暂时休息，过一会儿再来看。</p></Panel>;
  if (service === 'unreachable') return <Panel icon="coin" title="我的筹码"><p className="note">连不上服务器，点上面的"重试"。</p></Panel>;
  if (!user) {
    return (
      <Panel icon="coin" title="我的筹码">
        <p>还没登录。</p>
        <Link className="btn btn--primary" href="/login">
          去登录
        </Link>
      </Panel>
    );
  }
  if (!wallet) {
    return (
      <Panel icon="coin" title="我的筹码">
        {error ? (
          <>
            <p className="note">{errorText(error)}</p>
            <button className="btn" type="button" onClick={() => void refresh()}>
              再试一次
            </button>
          </>
        ) : (
          <Skeleton rows={3} />
        )}
      </Panel>
    );
  }
  const blocked = reliefBlocked(wallet, reliefTo);
  const caps = Object.entries(wallet.caps);
  // 筛选：流水里出现过的游戏各一个，没有游戏的（补给、新号、管理员调整）归"其他"
  const games = [...new Set(ledger.flatMap((e) => (e.g ? [e.g] : [])))];
  const hasOther = ledger.some((e) => !e.g);
  const shown = only === null ? ledger : ledger.filter((e) => (only === OTHER ? !e.g : e.g === only));
  return (
    <div className="desk">
      {service === 'readonly' && <p className="banner">服务器有点忙，现在只能看、不能改，明天再来。</p>}
      <div className="desk__col">
      <Panel icon="coin" title="我的筹码">
        <p className="wallet__balance" data-testid="wallet-balance">
          <CoinIcon size={36} />
          {num(wallet.balance)}
        </p>
        <p className="note">筹码无任何现金价值：不能买、不能换钱换物、不能转给别人。</p>
        {wallet.fresh && <p className="note">新号送的 {num(wallet.balance)}，第一次在游戏里用时到账。</p>}
        <div className="wallet__relief">
          <button className="btn btn--primary" type="button" aria-busy={relief.busy} disabled={!!blocked || relief.busy || !writable} onClick={() => void relief.onSubmit()}>
            {relief.busy ? '请稍等…' : `领每日补给（连桌上的补到 ${num(reliefTo)}）`}
          </button>
          {blocked && <p className="note" data-testid="relief-why">{blocked}</p>}
          <FormError text={relief.error} />
        </div>
      </Panel>
      <Panel icon="coin" title="桌上的筹码">
        {wallet.stakes.length === 0 ? (
          <p className="note">没有筹码在桌上，都在钱包里。</p>
        ) : (
          <ul className="stakes" data-testid="stakes">
            {wallet.stakes.map((s) => (
              <StakeRow key={`${s.game}:${s.ref}`} s={s} />
            ))}
          </ul>
        )}
      </Panel>
      {caps.length > 0 && (
        <Panel icon="coin" title="今天的实盘">
          {caps.map(([g, c]) => (
            <p key={g} className="note">
              {capsText(g, c)}
            </p>
          ))}
          <p className="note">单机实盘每个游戏每天最多赢 {winUnits} 份（一份按今天带上桌最多的那一次算），好友房不限。</p>
        </Panel>
      )}
      </div>
      <div className="desk__col">
        <Panel icon="coin" title="这周的输赢">
          <WeekSummary week={week} />
        </Panel>
        <Panel icon="coin" title="最近进出">
          {games.length + (hasOther ? 1 : 0) > 1 && (
            <div className="chips" role="group" aria-label="看哪个游戏">
              {[[null, '全部'] as const, ...games.map((g) => [g, gameName(g)] as const), ...(hasOther ? [[OTHER, '补给和其他'] as const] : [])].map(([id, label]) => (
                <button key={id ?? 'all'} type="button" className={only === id ? 'chips__on' : ''} aria-pressed={only === id} onClick={() => setOnly(id)}>
                  {label}
                </button>
              ))}
            </div>
          )}
          {shown.length > 0 ? <LedgerList key={only ?? 'all'} entries={shown} /> : <Empty>还没有进出，去玩一局带筹码的吧。</Empty>}
          <p className="note">只留最近 30 笔；10 月 16 日以前的没记下来。</p>
        </Panel>
      </div>
    </div>
  );
}
