/**
 * 战绩页（0.10.3，docs/platform-backend.md 5.10）：/me/stats 是自己的，/u/<用户 id> 是别人的（好友列表、排行榜点进来）。
 * 每个游戏的局数、胜率、最大一把、本周净赢，加一面称号墙。战绩对登录的人公开，余额不在这里。
 */
import { useEffect, useState } from 'react';
import { api, errorText, type CareerView, type Relation, type StatsResponse } from '../api.ts';
import { dateText, gameName, num, signed, tone } from '../format.ts';
import { GAMES } from '../games.ts';
import { Link, useLocation } from '../router.tsx';
import { useSession } from '../session.tsx';
import { loadTitles, type TitleCatalog } from '../titles.ts';
import { Empty, FormError, Panel, useSubmit, useWritable } from '../ui.tsx';

/** 按大厅的顺序排，大厅里没有的放最后 */
const order = (id: string) => {
  const i = GAMES.findIndex((g) => g.id === id);
  return i < 0 ? GAMES.length : i;
};

/** /me/stats → me；/u/<id> → id */
function statsTarget(pathname: string): string | null {
  if (pathname === '/me/stats') return 'me';
  const m = /^\/u\/([A-Za-z0-9_-]{22})$/.exec(pathname);
  return m ? m[1]! : null;
}

function GameStats({ game, c }: { game: string; c: CareerView }) {
  const rate = c.rounds > 0 ? `${Math.round((c.wins / c.rounds) * 100)}%` : '—';
  return (
    <li className="career" data-testid={`career-${game}`}>
      <div className="career__head">
        <strong>{gameName(game)}</strong>
        <span className={`career__week${c.wnet > 0 ? ' up' : c.wnet < 0 ? ' down' : ''}`} title="本周净赢（北京时间周一清零）">
          本周 {signed(c.wnet)}
        </span>
      </div>
      <dl className="career__facts">
        <div>
          <dt>局数</dt>
          <dd>{c.rounds > 0 ? num(c.rounds) : '—'}</dd>
        </div>
        <div>
          <dt>胜率</dt>
          <dd>{rate}</dd>
        </div>
        <div>
          <dt>最大一把</dt>
          <dd>{c.best > 0 ? num(c.best) : '—'}</dd>
        </div>
        <div>
          <dt>上桌</dt>
          <dd>{num(c.n)} 次</dd>
        </div>
      </dl>
    </li>
  );
}

/** 一个游戏的称号：拿到的亮着（带日期），目录里还没拿到的灰着 */
function TitleShelf({ game, earned }: { game: string; earned: CareerView['titles'] }) {
  const [catalog, setCatalog] = useState<TitleCatalog | null>(null);
  useEffect(() => {
    let alive = true;
    void loadTitles(game).then((c) => alive && setCatalog(c));
    return () => {
      alive = false;
    };
  }, [game]);
  const have = new Set(earned.map((t) => t.id));
  const missing = catalog ? Object.entries(catalog).filter(([id]) => !have.has(id)) : [];
  if (!earned.length && !missing.length) return null;
  return (
    <div className="shelf">
      <h3 className="shelf__game">
        {gameName(game)}
        <span className="shelf__count">
          {earned.length}
          {catalog && Object.keys(catalog).length ? ` / ${Object.keys(catalog).length}` : ''}
        </span>
      </h3>
      <ul className="titles">
        {earned.map((t) => {
          const info = catalog?.[t.id];
          return (
            <li key={t.id} className="title" title={info?.desc}>
              <span className="title__name">{info ? info.name : '神秘称号'}</span>
              <span className="title__date">{dateText(t.at)}</span>
            </li>
          );
        })}
        {missing.map(([id, info]) => (
          <li key={id} className="title title--locked" title={info.desc}>
            <span className="title__name">{info.name}</span>
            <span className="title__date">还没拿到</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 别人的战绩页上：加好友、接受请求，或者说明现在是什么关系（0.10.5） */
function FriendAction({ userId, relation, onChange }: { userId: string; relation: Relation; onChange: (r: Relation) => void }) {
  const writable = useWritable();
  const add = useSubmit(async () => {
    const r = await api.sendFriendRequestTo(userId);
    onChange(r.status === 'friends' ? 'friends' : 'pending_out');
  });
  const accept = useSubmit(async () => {
    await api.acceptFriend(userId);
    onChange('friends');
  });
  if (relation === 'friends') return <p className="note">你们是好友。</p>;
  if (relation === 'pending_out') return <p className="note" data-testid="friend-pending">已经发了好友请求，等对方接受。</p>;
  const act = relation === 'pending_in' ? accept : add;
  return (
    <div className="row">
      <button className="btn btn--primary" type="button" data-testid="add-friend" aria-busy={act.busy} disabled={act.busy || !writable} onClick={() => void act.onSubmit()}>
        {act.busy ? '请稍等…' : relation === 'pending_in' ? '对方想加你，接受' : '加好友'}
      </button>
      <FormError text={act.error} />
    </div>
  );
}

export function StatsPage() {
  const loc = useLocation();
  const who = statsTarget(loc.pathname);
  const { loading, user } = useSession();
  const [data, setData] = useState<StatsResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!user || !who) return;
    let alive = true;
    setData(null);
    setError(null);
    api.stats(who).then(
      (r) => alive && setData(r),
      (e: unknown) => alive && setError(e),
    );
    return () => {
      alive = false;
    };
  }, [user, who]);

  if (loading) return <Panel icon="trophy" title="战绩"><p className="note">正在读取…</p></Panel>;
  if (!user) {
    return (
      <Panel icon="trophy" title="战绩">
        <p>登录以后才能看战绩。</p>
        <Link className="btn btn--primary" href={`/login?next=${encodeURIComponent(loc.pathname)}`}>
          去登录
        </Link>
      </Panel>
    );
  }
  if (error) return <Panel icon="trophy" title="战绩"><p className="note">{errorText(error, { not_found: '没有找到这个人' })}</p></Panel>;
  if (!data) return <Panel icon="trophy" title="战绩"><p className="note">正在读取…</p></Panel>;

  const mine = data.relation === 'self';
  const games = Object.entries(data.games).sort(([a], [b]) => order(a) - order(b));
  const week = games.reduce((t, [, c]) => t + c.wnet, 0);
  const titles = games.reduce((t, [, c]) => t + c.titles.length, 0);
  return (
    <>
      <Panel icon="trophy" title={mine ? '我的战绩' : `${data.user.displayName} 的战绩`}>
        {!mine && <FriendAction userId={data.user.userId} relation={data.relation} onChange={(relation) => setData({ ...data, relation })} />}
        {games.length === 0 ? (
          <Empty testId="career-empty">{mine ? '还没有战绩。带筹码玩一局单机实盘或好友房，这里就有了。' : '还没有战绩。'}</Empty>
        ) : (
          <>
            <p className="career__summary">
              <span>
                本周净赢 <strong className={tone(week)}>{signed(week)}</strong>
              </span>
              <span>
                称号 <strong>{titles}</strong> 个
              </span>
            </p>
            <ul className="careers">
              {games.map(([g, c]) => (
                <GameStats key={g} game={g} c={c} />
              ))}
            </ul>
          </>
        )}
        {mine && (
          <div className="row">
            <Link className="btn" href="/wallet">
              我的筹码
            </Link>
            <Link className="btn" href="/friends">
              好友
            </Link>
          </div>
        )}
      </Panel>
      {games.length > 0 && (
        <Panel icon="trophy" title="称号墙">
          {games.map(([g, c]) => (
            <TitleShelf key={g} game={g} earned={c.titles} />
          ))}
          {titles === 0 && <p className="note">还没拿到称号。打出名场面，游戏会发给你。</p>}
        </Panel>
      )}
    </>
  );
}
