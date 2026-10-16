/**
 * /wallet：我的筹码。余额、领每日补给、桌上的筹码（在哪个游戏、怎么拿回来）、今天实盘还能赢多少。
 * 规则见 docs/economy.md 第 3、4 节；筹码不能买、不能换、不能转（docs/project.md 底线）。
 */
import { useEffect } from 'react';
import { api, errorText, type Stake, type Wallet } from '../api.ts';
import { gameName, num, timeText } from '../format.ts';
import { GAMES } from '../games.ts';
import { LedgerList } from '../ledger.tsx';
import { playUrl } from '../play.ts';
import { Link } from '../router.tsx';
import { useSession } from '../session.tsx';
import { Empty, FormError, Panel, useSubmit, useWritable } from '../ui.tsx';
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

export function WalletPage() {
  const { loading, user, service } = useSession();
  const { wallet, reliefTo, winUnits, ledger, error, refresh, set } = useWallet();
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

  if (loading) return <Panel icon="coin" title="我的筹码"><p className="note">正在读取…</p></Panel>;
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
          <p className="note">正在读取…</p>
        )}
      </Panel>
    );
  }
  const blocked = reliefBlocked(wallet, reliefTo);
  const caps = Object.entries(wallet.caps);
  return (
    <>
      {service === 'readonly' && <p className="banner">服务器有点忙，现在只能看、不能改，明天再来。</p>}
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
          <p className="note">单机实盘每个游戏每天最多赢 {winUnits} 份（按今天带过的最高档算），好友房不限。</p>
        </Panel>
      )}
      <Panel icon="coin" title="最近进出">
        {ledger.length > 0 ? <LedgerList entries={ledger} gameName={gameName} /> : <Empty>还没有进出。</Empty>}
        <p className="note">只留最近 30 笔；10 月 16 日以前的没记下来。</p>
      </Panel>
    </>
  );
}
