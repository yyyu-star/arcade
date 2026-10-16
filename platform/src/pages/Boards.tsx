/**
 * /boards 排行榜（0.10.4，docs/platform-backend.md 15.12）：本周净赢（总榜 + 每个游戏）、各游戏的每日挑战（现有的每日榜，15.5；games.ts 登记了 daily 的才有）、称号收集。
 * "全部 / 只看好友"一键切换；点名字进那个人的战绩页。数据最多晚 5 分钟（服务端每个 isolate 的缓存）。
 */
import { useEffect, useState } from 'react';
import { api, errorText, type LeaderboardResponse, type ScoreBoard } from '../api.ts';
import { type DailyFormat, loadDailyFormat } from '../daily.ts';
import { signed } from '../format.ts';
import { GAMES, type GameEntry, WALLET_GAMES } from '../games.ts';
import { Link } from '../router.tsx';
import { useSession } from '../session.tsx';
import { Empty, Panel } from '../ui.tsx';

type Scope = 'all' | 'friends';
/** 'week'、'titles'，或者有每日榜的游戏 id */
type Tab = string;

const PLAYABLE = GAMES.filter((g) => g.status === 'playable');
const WEEK_BOARDS = [{ id: 'total', name: '总榜' }, ...WALLET_GAMES.filter((g) => g.status === 'playable').map((g) => ({ id: g.id, name: g.name }))];
const DAILY_GAMES = PLAYABLE.filter((g) => g.daily);
const TABS: (readonly [Tab, string])[] = [['week', '本周净赢'], ...DAILY_GAMES.map((g) => [g.id, `${g.name}每日`] as const), ['titles', '称号收集']];

interface Row {
  rank: number | null;
  userId: string;
  displayName: string;
  isMe: boolean;
  text: string;
  tone?: 'up' | 'down';
}

function RankList({ rows, me, empty }: { rows: Row[]; me: Row | null; empty: string }) {
  if (!rows.length) return <Empty testId="board-empty">{empty}</Empty>;
  return (
    <>
      <ol className="ranks" data-testid="ranks">
        {rows.map((r) => (
          <li key={r.userId} className={`rank${r.isMe ? ' rank--me' : ''}`}>
            <span className={`rank__no${r.rank !== null && r.rank <= 3 ? ` rank__no--${r.rank}` : ''}`}>{r.rank ?? '—'}</span>
            <Link className="rank__name" href={`/u/${r.userId}`}>
              {r.displayName}
              {r.isMe && <span className="rank__me">我</span>}
            </Link>
            <span className={`rank__value${r.tone ? ` ${r.tone}` : ''}`}>{r.text}</span>
          </li>
        ))}
      </ol>
      {me && !rows.some((r) => r.isMe) && (
        <p className="rank__mine" data-testid="my-rank">
          我：{me.rank === null ? '50 名以后' : `第 ${me.rank} 名`} · {me.text}
        </p>
      )}
    </>
  );
}

function DailyBoard({ game, board, scope }: { game: GameEntry; board: string | null; scope: Scope }) {
  const [data, setData] = useState<{ board: ScoreBoard; format: DailyFormat } | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!board) return;
    let alive = true;
    setData(null);
    setError(null);
    Promise.all([api.board(game.id, board, scope), loadDailyFormat(game.id)]).then(
      ([b, format]) => alive && setData({ board: b, format }),
      (e: unknown) => alive && setError(e),
    );
    return () => {
      alive = false;
    };
  }, [game.id, board, scope]);
  const empty = `今天还没人打${game.name}的每日挑战，去当第一个！`;
  if (!board) return <Empty testId="board-empty">{empty}</Empty>;
  if (error) return <p className="note">{errorText(error)}</p>;
  if (!data) return <p className="note">正在读取…</p>;
  const { board: b, format } = data;
  const rows = b.entries.map((e) => ({ ...e, text: format.score(e.score) }));
  const me = b.me ? { rank: b.me.rank, userId: '', displayName: '', isMe: true, text: format.score(b.me.score) } : null;
  return (
    <>
      <RankList rows={rows} me={me} empty={empty} />
      {format.note && <p className="note">{game.name}的每日挑战：{format.note}</p>}
    </>
  );
}

export function BoardsPage() {
  const { loading, user } = useSession();
  const [scope, setScope] = useState<Scope>('all');
  const [tab, setTab] = useState<Tab>('week');
  const [weekBoard, setWeekBoard] = useState('total');
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    setError(null);
    api.leaderboard(scope).then(
      (r) => alive && setData(r),
      (e: unknown) => alive && setError(e),
    );
    return () => {
      alive = false;
    };
  }, [user, scope]);

  if (loading) return <Panel icon="trophy" title="排行榜"><p className="note">正在读取…</p></Panel>;
  if (!user) {
    return (
      <Panel icon="trophy" title="排行榜">
        <p>登录以后才能看排行榜。</p>
        <Link className="btn btn--primary" href="/login?next=%2Fboards">
          去登录
        </Link>
      </Panel>
    );
  }

  const toggle = (
    <div className="seg" role="group" aria-label="看谁">
      {(['all', 'friends'] as const).map((s) => (
        <button key={s} type="button" className={scope === s ? 'seg__on' : ''} aria-pressed={scope === s} onClick={() => setScope(s)}>
          {s === 'all' ? '全部' : '只看好友'}
        </button>
      ))}
    </div>
  );
  const tabs = (
    <nav className="tabs" aria-label="哪个榜">
      {TABS.map(([t, label]) => (
        <a
          key={t}
          href={`#${t}`}
          className={tab === t ? 'tabs__on' : ''}
          aria-current={tab === t ? 'page' : undefined}
          onClick={(e) => {
            e.preventDefault();
            setTab(t);
          }}
        >
          {label}
        </a>
      ))}
    </nav>
  );

  const daily = DAILY_GAMES.find((g) => g.id === tab);
  let body;
  if (error) body = <p className="note">{errorText(error)}</p>;
  else if (!data) body = <p className="note">正在读取…</p>;
  else if (daily) body = <DailyBoard game={daily} board={data.daily[daily.id] ?? null} scope={scope} />;
  else {
    const b = data.boards[tab === 'week' ? weekBoard : 'titles'] ?? { entries: [], me: null };
    const fmt = (v: number) => (tab === 'week' ? { text: signed(v), tone: v > 0 ? ('up' as const) : v < 0 ? ('down' as const) : undefined } : { text: `${v} 个` });
    const rows = b.entries.map((e) => ({ ...e, ...fmt(e.value) }));
    const me = b.me ? { rank: b.me.rank, userId: '', displayName: '', isMe: true, ...fmt(b.me.value) } : null;
    body = (
      <>
        {tab === 'week' && (
          <div className="chips" role="group" aria-label="哪个游戏">
            {WEEK_BOARDS.map((w) => (
              <button key={w.id} type="button" className={weekBoard === w.id ? 'chips__on' : ''} aria-pressed={weekBoard === w.id} onClick={() => setWeekBoard(w.id)}>
                {w.name}
              </button>
            ))}
          </div>
        )}
        <RankList rows={rows} me={me} empty={tab === 'week' ? '这周还没人上榜，去玩一局带筹码的！' : '还没人拿到称号。'} />
        <p className="note">
          {tab === 'week'
            ? '比的是这周带筹码的局（单机实盘、好友房）赢了多少，北京时间每周一 0 点清零。不比谁的筹码多。'
            : '各游戏的称号加在一起，拿过的都算。'}
          数据最多晚 5 分钟。
        </p>
      </>
    );
  }
  return (
    <Panel icon="trophy" title="排行榜">
      {toggle}
      {tabs}
      {body}
    </Panel>
  );
}
