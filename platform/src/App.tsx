import { lazy, Suspense, useEffect, useState, useSyncExternalStore, type ComponentType } from 'react';
import { GAMES, type GameEntry } from './games.ts';
import { CoinIcon, EmptyArt, LogoMark, PeopleIcon, ShieldIcon, SpeakerIcon, TrophyIcon } from './icons.tsx';
import { setSoundOn, soundOn, subscribeSound } from './sound.ts';
import { playUrl } from './play.ts';
import { Link, useLocation } from './router.tsx';
import { api, type Overtake } from './api.ts';
import { useSession } from './session.tsx';
import { FeedButton } from './feed.tsx';
import { InviteBar, useHasInvites, useInvitePolling } from './invites.tsx';
import { useLobbyPresence } from './presence.ts';
import { FormError, useSubmit, useWritable } from './ui.tsx';
import { useWallet } from './wallet.tsx';
import { num, signed } from './format.ts';

/**
 * 各页面按需加载：大厅首屏只带首页要用的（React 加卡片），点进哪页再下那一页的代码。
 * 大多数人打开大厅就直接进游戏了，用不到管理、好友、账号这些页面。
 */
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] }), reloadForNewVersion));

/** 同一个地址上次因为分块加载失败而重载的时间（sessionStorage，平台的 key 加 arcade. 前缀） */
const RELOADED_KEY = 'arcade.reloaded';
const RELOAD_WINDOW_MS = 10_000;

/**
 * 分块加载失败多半是发版了：一天部署好几次，旧的分块文件随之没了，开着没刷新的大厅再点进别的页就是 404。
 * 整页重载这个地址拿新版；同一个地址 10 秒内只重载一次，再失败（真断网，或存不了记录）就停下来让人自己刷新，免得来回重载。
 */
function reloadForNewVersion(): Promise<{ default: ComponentType }> {
  const href = location.href;
  const now = Date.now();
  try {
    const last = JSON.parse(sessionStorage.getItem(RELOADED_KEY) ?? 'null') as { href?: string; at?: number } | null;
    const recent = last?.href === href && typeof last.at === 'number' && now - last.at >= 0 && now - last.at < RELOAD_WINDOW_MS;
    if (!recent) {
      sessionStorage.setItem(RELOADED_KEY, JSON.stringify({ href, at: now }));
      location.assign(href);
      // 页面马上要换掉：一直停在"正在打开…"
      return new Promise(() => {});
    }
  } catch {
    // 存不了记录就不自动重载
  }
  return Promise.resolve({ default: PageLoadFailed });
}

function PageLoadFailed() {
  return (
    <p className="note" data-testid="page-load-failed">
      网络不好，刷新试试。{' '}
      <button className="btn btn--small" type="button" onClick={() => location.reload()}>
        刷新
      </button>
    </p>
  );
}
const LoginPage = page(() => import('./pages/Login.tsx'), 'LoginPage');
const InviteLinkPage = page(() => import('./pages/Login.tsx'), 'InviteLinkPage');
const ForgotPage = page(() => import('./pages/Forgot.tsx'), 'ForgotPage');
const MePage = page(() => import('./pages/Me.tsx'), 'MePage');
const PrivacyPage = page(() => import('./pages/Privacy.tsx'), 'PrivacyPage');
const AdminPage = page(() => import('./pages/Admin.tsx'), 'AdminPage');
const FriendsPage = page(() => import('./pages/Friends.tsx'), 'FriendsPage');
const FriendCodePage = page(() => import('./pages/Friends.tsx'), 'FriendCodePage');
const WalletPage = page(() => import('./pages/Wallet.tsx'), 'WalletPage');
const StatsPage = page(() => import('./pages/Stats.tsx'), 'StatsPage');
const BoardsPage = page(() => import('./pages/Boards.tsx'), 'BoardsPage');
const FeedPage = page(() => import('./pages/Feed.tsx'), 'FeedPage');

/** 账号相关的页面；不在表里的地址都当首页。 */
const ACCOUNT_PAGES: Record<string, ComponentType> = {
  '/login': LoginPage,
  '/forgot': ForgotPage,
  '/me': MePage,
  '/privacy': PrivacyPage,
  '/admin': AdminPage,
  '/friends': FriendsPage,
  '/wallet': WalletPage,
  '/me/stats': StatsPage,
  '/boards': BoardsPage,
  '/feed': FeedPage,
};

/** 带参数的页面：/f/<好友码>、/i/<邀请码>（0.20.0）、/u/<用户 id>（别人的战绩）。 */
function pageFor(pathname: string): ComponentType | undefined {
  if (/^\/f\/[^/]+$/.test(pathname)) return FriendCodePage;
  if (/^\/i\/[0-9A-Za-z-]{1,20}$/.test(pathname)) return InviteLinkPage;
  if (/^\/u\/[A-Za-z0-9_-]{22}$/.test(pathname)) return StatsPage;
  return ACCOUNT_PAGES[pathname];
}

function GameCard({ game }: { game: GameEntry }) {
  const playable = game.status === 'playable';
  const { loading, slow, user, service } = useSession();
  // 问 /api/me 超时、连不上时不知道登没登录：照样给"进入游戏"，游戏自己有登录闸门，没登录会跳去登录页
  const unknown = !user && (slow || service === 'unreachable');
  // 今天带筹码上过桌的人数：跟着钱包一起问的（只有登录了才有），没有就不显示
  const { playing: counts, week } = useWallet();
  const playing = counts[game.id] ?? 0;
  // 本周净赢（0.10.12）：这周在这个游戏带筹码玩过才有
  const wnet = Object.hasOwn(week, game.id) ? week[game.id]! : null;
  return (
    <article className={`card${playable ? '' : ' card--coming'}`}>
      <img className="card__cover" src={game.cover} alt={`${game.name}封面`} width={800} height={450} loading="lazy" decoding="async" />
      <div className="card__body">
        {/* 人数牌子骑在封面和正文的分界线上：原来压在封面右上角，挡住封面上的标题字 */}
        {playable && playing > 0 && (
          <span className="card__playing" data-testid={`playing-${game.id}`}>
            <PeopleIcon />
            今天 {playing} 人玩过
          </span>
        )}
        <h2 className="card__title">
          {game.name}
          {wnet !== null && (
            <span className={`card__week${wnet > 0 ? ' up' : wnet < 0 ? ' down' : ''}`} data-testid={`week-${game.id}`}>
              本周 {signed(wnet)}
            </span>
          )}
        </h2>
        <p className="card__tagline">{game.tagline}</p>
        <p className="card__desc">{game.desc}</p>
        <ul className="card__tags">
          {game.tags.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        {!playable ? (
          <span className="card__play card__play--disabled">敬请期待</span>
        ) : loading && !slow ? (
          <span className="card__play card__play--disabled">请稍等…</span>
        ) : user || unknown ? (
          // 只有一个按钮（0.25.1，所有者 10-18）：好友房在游戏里开、进；叫人、邀请、好友页的"加入"都直接链到游戏的 ?room=
          <a className="card__play" href={playUrl(game)}>
            进入游戏
          </a>
        ) : (
          // 测试期要登录才能玩（游戏那边也会挡）：登录后直接回这个游戏
          <Link className="card__play" href={`/login?from=${game.id}`}>
            登录后才能玩
          </Link>
        )}
      </div>
    </article>
  );
}

/**
 * 最近玩过的排前面（0.10.12）：按流水和桌上筹码里最后一次碰这个游戏的时间；
 * 没玩过的（或 0.10.7 以前玩的，流水里没有）保持 games.ts 的顺序（sort 是稳定的）。
 */
function byRecent(games: readonly GameEntry[], ledger: readonly { at: number; g?: string }[], stakes: readonly { game: string; at: number }[]): GameEntry[] {
  const last: Record<string, number> = {};
  for (const e of ledger) if (e.g) last[e.g] = Math.max(last[e.g] ?? 0, e.at);
  for (const s of stakes) last[s.game] = Math.max(last[s.game] ?? 0, s.at);
  return [...games].sort((a, b) => (last[b.id] ?? 0) - (last[a.id] ?? 0));
}

function Home({ deleted }: { deleted: boolean }) {
  const { user, notice: announcement } = useSession();
  const { wallet, ledger } = useWallet();
  const games = byRecent(GAMES, ledger, wallet?.stakes ?? []);
  // 横幅只在注销后这一次显示：记下来，再把 ?deleted=1 从网址里去掉，刷新或分享出去都不会再冒出来
  const [notice] = useState(deleted);
  useEffect(() => {
    if (!deleted) return;
    const url = new URL(location.href);
    url.searchParams.delete('deleted');
    history.replaceState(history.state, '', url.pathname + url.search + url.hash);
  }, [deleted]);
  return (
    <div className="lobby">
      {notice && <p className="banner">账号已经注销，数据都删掉了。</p>}
      <LobbyNudge />
      {user && <OvertakeNudge />}
      {user && announcement && (
        <p className="banner banner--notice" data-testid="notice">
          <strong className="banner__tag">公告</strong>
          {announcement.text}
        </p>
      )}
      <main className="grid">
        {games.map((g) => (
          <GameCard key={g.id} game={g} />
        ))}
        <article className="card card--coming card--placeholder">
          <div className="card__body">
            <EmptyArt />
            <h2 className="card__title">更多小游戏</h2>
            <p className="card__tagline">正在路上</p>
          </div>
        </article>
      </main>
    </div>
  );
}

/**
 * 大厅提醒（0.10.11）：有筹码压在桌上时直达那个游戏；筹码见底能领补给时就地领，不用先进钱包页。
 * 都用登录时已经问过的 /api/wallet，不多发请求；从游戏回大厅是整页加载，会重新问。
 */
function LobbyNudge() {
  const { user } = useSession();
  const { wallet, reliefTo, set, refresh } = useWallet();
  const writable = useWritable();
  const relief = useSubmit(async () => {
    try {
      set((await api.relief()).wallet);
    } finally {
      // 成功了"最近进出"要有这一笔；被拒多半是别处刚改过钱包，对一下
      void refresh();
    }
  });
  if (!user || !wallet) return null;
  const { stakes } = wallet;
  const onTable = stakes.reduce((t, s) => t + s.amount, 0);
  const canRelief = wallet.canRelief && wallet.writesLeft > 0;
  if (!stakes.length && !canRelief) return null;
  // 同一个游戏可以有好几份（0.9.5 起，比如德州单机加好友房）：按不同的游戏算，只有一个游戏就直达它
  const games = new Set(stakes.map((s) => s.game));
  const g = games.size === 1 ? GAMES.find((x) => games.has(x.id)) : undefined;
  const where = stakes.length === 1 && stakes[0]!.mode === 'server' ? '好友房' : '';
  const parts = stakes.length > 1 ? `（${stakes.length} 份）` : '';
  return (
    <div className="nudges" data-testid="nudges">
      {stakes.length > 0 && (
        // 手机上这一条变成底部固定条（0.24.1，样式见 .nudge--stake）：字太长时中间那段先省略，游戏名和数字留着
        <p className="banner nudge nudge--stake" data-testid="nudge-stake">
          <span className="nudge__what">
            <span className="nudge__keep">{g ? g.name : games.size > 1 ? `${games.size} 个游戏` : ''}</span>
            <span className="nudge__mid">{g ? `${where}桌上还有` : games.size > 1 ? '的桌上还有' : '桌上还有'}</span>
            <span className="nudge__keep">
              {' '}
              {num(onTable)}
              {parts}
            </span>
          </span>
          {g ? (
            <a className="inline-link" href={playUrl(g)}>
              回去接着打
            </a>
          ) : (
            <Link className="inline-link" href="/wallet">
              去看看
            </Link>
          )}
        </p>
      )}
      {canRelief && (
        <div className="banner nudge" data-testid="nudge-relief">
          <span>筹码不多了，每天能领一次补给，{onTable ? '连桌上的' : ''}补到 {num(reliefTo)}</span>
          <button className="btn btn--primary btn--small" type="button" aria-busy={relief.busy} disabled={relief.busy || !writable} onClick={() => void relief.onSubmit()}>
            {relief.busy ? '请稍等…' : '领补给'}
          </button>
          <FormError text={relief.error} />
        </div>
      )}
    </div>
  );
}

/**
 * 好友超过了我这周的每日挑战纪录（0.15.0，docs/social.md 1.5）：打开大厅时问一次，读的时候比、不存；有好几个游戏只提第一个。
 * 问失败就不提，不打扰。
 */
function OvertakeNudge() {
  const [o, setO] = useState<Overtake | null>(null);
  useEffect(() => {
    let alive = true;
    api.overtakes().then((r) => alive && setO(r.overtakes[0] ?? null), () => {});
    return () => {
      alive = false;
    };
  }, []);
  const g = o && GAMES.find((x) => x.id === o.gameId);
  if (!o || !g) return null;
  // 一天几个每日榜的游戏（0.16.0）说是哪个子榜："夜巡·守夜"
  const sub = Array.isArray(g.daily) ? g.daily.find((x) => x.id === o.board) : undefined;
  return (
    <p className="banner nudge" data-testid="nudge-overtake">
      <span>
        <strong>{o.by.displayName}</strong>超过了你这周的{g.name}
        {sub ? `·${sub.name}` : ''}每日挑战纪录
      </span>
      <a className="inline-link" href={playUrl(g)}>
        去挑战
      </a>
    </p>
  );
}

/** 右上角：没登录是"登录"，登录了是头像（昵称第一个字）加昵称；管理员前面多一个"管理"。 */
function AccountButton() {
  const { loading, user, service } = useSession();
  const path = useLocation().pathname;
  if (loading) return <span className="topbar"><span className="account account--loading" aria-hidden="true" /></span>;
  // 停服档登也登不上，连不上时不知道登没登录：顶上的提示已经说明了，不放入口
  if (service === 'off' || service === 'unreachable') return null;
  // 已经在登录、找回页上了，右上角再放一个"登录"是多余的
  if (!user && (path === '/login' || path === '/forgot')) return null;
  if (!user) {
    return (
      <span className="topbar">
        <Link className="account" href="/login">
          登录
        </Link>
      </span>
    );
  }
  return (
    <span className="topbar">
      {user.isAdmin && (
        <Link className="account account--admin" href="/admin">
          <ShieldIcon />
          管理
        </Link>
      )}
      <Link className="account" href="/boards">
        <TrophyIcon />
        排行
      </Link>
      <FeedButton me={user.id} />
      <FriendsLink />
      <WalletBadge />
      <Link className="account" href="/me" title="我的账号">
        <span className="account__avatar" aria-hidden="true">
          {Array.from(user.displayName)[0]}
        </span>
        <span className="account__name">{user.displayName}</span>
      </Link>
    </span>
  );
}

/** 顶栏的"好友"：有还没过期的邀请时带红点（0.14.0，docs/social.md 1.3） */
function FriendsLink() {
  const dot = useHasInvites();
  return (
    <Link className="account" href="/friends" data-testid="friends-link">
      <PeopleIcon />
      好友
      {dot && <span className="dot" role="img" aria-label="有人叫你" data-testid="invite-dot" />}
    </Link>
  );
}

/** 顶栏的筹码小牌子：点开进钱包页。还没读到余额时只写"筹码"，入口照样在 */
function WalletBadge() {
  const { wallet } = useWallet();
  return (
    <Link className="account account--chips" href="/wallet" title="我的筹码" data-testid="wallet-badge">
      <CoinIcon />
      <span>{wallet ? num(wallet.balance) : '筹码'}</span>
    </Link>
  );
}

/** 页脚的声音开关：大厅点按的那一声"嗒"（src/sound.ts） */
function SoundToggle() {
  const on = useSyncExternalStore(subscribeSound, soundOn);
  return (
    <button className="foot__sound" type="button" data-sound-toggle aria-pressed={on} data-testid="sound-toggle" onClick={() => setSoundOn(!on)}>
      <SpeakerIcon on={on} />
      {on ? '声音：开' : '声音：关'}
    </button>
  );
}

/** 做好了电脑版排版的页面（0.23.0）：电脑上主区放开成两栏（styles.css 的 .desk），手机上照旧是中间一窄列 */
const DESK_PAGES = new Set(['/wallet', '/boards', '/friends', '/me', '/me/stats', '/feed']);
const isDesk = (path: string) => DESK_PAGES.has(path) || path.startsWith('/u/');

export function App() {
  const loc = useLocation();
  const { service, refresh, loading, slow, user } = useSession();
  useLobbyPresence(!!user);
  useInvitePolling(!!user);
  const Page = pageFor(loc.pathname);
  return (
    <div className={!Page ? 'page' : loc.pathname === '/admin' ? 'page page--wide' : 'page page--narrow'}>
      <header className="top">
        <Link className="top__home" href="/">
          <h1 className="top__logo">
            <LogoMark />
            小游戏街机厅
          </h1>
        </Link>
        <p className="top__sub">挑一个，开一局。</p>
        <AccountButton />
      </header>
      <InviteBar />
      {loading && slow && <p className="banner" data-testid="reconnecting">网络有点慢，正在重连…</p>}
      {service === 'off' && <p className="banner">账号服务暂时休息，游戏也要登录才能玩，过一会儿再来。</p>}
      {service === 'unreachable' && (
        <p className="banner">
          连不上服务器，检查一下网络。{' '}
          <button className="btn btn--small" type="button" disabled={loading} onClick={() => void refresh()}>
            {loading ? '正在连…' : '重试'}
          </button>
        </p>
      )}
      {Page ? (
        // 管理页是控制台布局，要整页宽；其余账号页面都是中间一栏
        <main className={loc.pathname === '/admin' ? 'wide' : isDesk(loc.pathname) ? 'narrow narrow--desk' : 'narrow'}>
          <Suspense fallback={<p className="note page-loading">正在打开…</p>}>
            <Page />
          </Suspense>
        </main>
      ) : (
        <Home deleted={loc.searchParams.get('deleted') === '1'} />
      )}
      <footer className="foot">
        全部游戏内容均为虚构 · 美术与音频为原创程序生成
        {' · '}
        <Link href="/privacy">隐私说明</Link>
        {' · '}
        <SoundToggle />
      </footer>
    </div>
  );
}
