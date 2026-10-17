/**
 * /boards 排行榜（0.10.4，docs/platform-backend.md 15.12）：本周净赢（总榜 + 每个游戏）、各游戏的每日挑战（现有的每日榜，15.5；games.ts 登记了 daily 的才有）、
 * 各游戏总榜（0.23.0，games.ts 登记的固定榜，比如夜巡守夜）、称号收集。
 * "全部 / 只看好友"一键切换；点名字进那个人的战绩页。数据最多晚 5 分钟（服务端每个 isolate 的缓存）。
 * 电脑上（≥960）左边一列竖排的榜单分组、右边是榜；手机上分组一排排摆在上面。
 */
import { useEffect, useState } from 'react';
import { api, errorText, type LeaderboardResponse, type ScoreBoard } from '../api.ts';
import { loadDailyFormat, loadScoreFormat, type ScoreFormat } from '../scores.ts';
import { signed, tone } from '../format.ts';
import { type DailyTab, dailyTabs, fixedBoards, type GameEntry, GAMES, WALLET_GAMES } from '../games.ts';
import { Link } from '../router.tsx';
import { useSession } from '../session.tsx';
import { Empty, Panel, Skeleton } from '../ui.tsx';
import { friendLink, rankCard, ShareButton } from '../share.tsx';
import './boards.css';

type Scope = 'all' | 'friends';
/** 'week'、'titles'、每日榜的 DailyTab.key，或者总榜的 'fixed:<游戏>:<榜>' */
type Tab = string;

const PLAYABLE = GAMES.filter((g) => g.status === 'playable');
const WEEK_BOARDS = [{ id: 'total', name: '总榜' }, ...WALLET_GAMES.filter((g) => g.status === 'playable').map((g) => ({ id: g.id, name: g.name }))];
/** 每日挑战：每个游戏一个标签，一天几个每日榜的每个子榜一个（0.16.0，"夜巡每日·守夜"） */
const DAILY_TABS = dailyTabs(PLAYABLE);
/** 各游戏总榜（0.23.0）：登记了固定榜的游戏每个榜一个标签 */
interface FixedTab {
  key: string;
  game: GameEntry;
  id: string;
  label: string;
}
const FIXED_TABS: FixedTab[] = PLAYABLE.flatMap((g) => fixedBoards(g).map((b) => ({ key: `fixed:${g.id}:${b.id}`, game: g, id: b.id, label: b.name })));
interface Group {
  name: string;
  tabs: (readonly [Tab, string])[];
}
const GROUPS: Group[] = ([
  { name: '周榜', tabs: [['week', '本周净赢']] },
  { name: '每日挑战', tabs: DAILY_TABS.map((t) => [t.key, t.label] as const) },
  { name: '各游戏总榜', tabs: FIXED_TABS.map((t) => [t.key, t.label] as const) },
  { name: '称号', tabs: [['titles', '称号收集']] },
] satisfies Group[]).filter((g) => g.tabs.length > 0);

interface Row {
  rank: number | null;
  userId: string;
  displayName: string;
  isMe: boolean;
  text: string;
  tone?: 'up' | 'down';
}

/** 晒名次（0.21.0）：全站前 10 名，或者只看好友时第一名，自己那行旁边给一个按钮 */
const SHARE_TOP = 10;

function MyShare({ r, share }: { r: Row; share?: { board: string; friends: boolean } }) {
  const { user } = useSession();
  if (!share || !user || r.rank === null || r.rank > (share.friends ? 1 : SHARE_TOP)) return null;
  return (
    <ShareButton
      card={rankCard(user.displayName, share.board, r.rank, r.text, share.friends)}
      url={friendLink(user.friendCode)}
      label="晒名次"
      testId="share-rank"
    />
  );
}

/**
 * 排行：前三名站上领奖台（第二、第一、第三从左到右，第一最高），后面的一行一个；自己那行高亮。
 * 并列时名次一样，领奖台按名单顺序取前三个名次在 3 以内的人。
 */
function RankList({ rows, me, empty, share }: { rows: Row[]; me: Row | null; empty: string; share?: { board: string; friends: boolean } }) {
  if (!rows.length) return <Empty testId="board-empty">{empty}</Empty>;
  const top = rows.slice(0, 3).filter((r) => r.rank !== null && r.rank <= 3);
  const rest = rows.slice(top.length);
  // 领奖台的站位：第二在左、第一在中、第三在右
  const stand = top.length === 3 ? [top[1]!, top[0]!, top[2]!] : top.length === 2 ? [top[1]!, top[0]!] : top;
  // 自己的名次写在最上面（0.24.0）：手机第一屏只放得下领奖台，第 4 名往后的自己要往下翻才看得到；站上领奖台了就不用写
  const inList = rows.some((r) => r.isMe);
  const mine = me && !top.some((r) => r.isMe) ? me : null;
  return (
    <div data-testid="ranks">
      {mine && (
        <p className={`rank__mine${inList ? ' rank__mine--in' : ''}`} data-testid="my-rank">
          我：{mine.rank === null ? '50 名以后' : `第 ${mine.rank} 名`} · {mine.text}
        </p>
      )}
      {stand.length > 0 && (
        <ol className={`podium podium--${stand.length}`}>
          {stand.map((r) => (
            <li key={r.userId} className={`rank podium__item podium__item--${r.rank}${r.isMe ? ' rank--me' : ''}`}>
              <span className={`rank__no rank__no--${r.rank}`}>{r.rank}</span>
              <span className="podium__avatar" aria-hidden="true">
                {Array.from(r.displayName || '我')[0]}
              </span>
              <Link className="rank__name" href={`/u/${r.userId}`}>
                {r.displayName}
                {r.isMe && <span className="rank__me">我</span>}
              </Link>
              <span className={`rank__value${r.tone ? ` ${r.tone}` : ''}`}>{r.text}</span>
              {r.isMe && <MyShare r={r} share={share} />}
              <span className="podium__step" aria-hidden="true" />
            </li>
          ))}
        </ol>
      )}
      {rest.length > 0 && (
        <ol className="ranks" start={top.length + 1}>
          {rest.map((r) => (
            <li key={r.userId} className={`rank${r.isMe ? ' rank--me' : ''}`}>
              <span className={`rank__no${r.rank !== null && r.rank <= 3 ? ` rank__no--${r.rank}` : ''}`}>{r.rank ?? '—'}</span>
              <Link className="rank__name" href={`/u/${r.userId}`}>
                {r.displayName}
                {r.isMe && <span className="rank__me">我</span>}
              </Link>
              <span className={`rank__value${r.tone ? ` ${r.tone}` : ''}`}>{r.text}</span>
              {r.isMe && <MyShare r={r} share={share} />}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function DailyBoard({ tab, board, scope }: { tab: DailyTab; board: string | null; scope: Scope }) {
  const { game } = tab;
  const sub = tab.sub?.id ?? null;
  const title = tab.sub ? `${game.name}·${tab.sub.name}` : game.name;
  const [data, setData] = useState<{ board: ScoreBoard; format: ScoreFormat } | null>(null);
  const [error, setError] = useState<unknown>(null);
  // 只看好友时比的是这周（北京时间周一 0 点起）每人最好的一天（0.15.0，docs/social.md 1.5），今天没人打也有榜
  const week = scope === 'friends';
  useEffect(() => {
    if (!board && !week) return;
    let alive = true;
    setData(null);
    setError(null);
    Promise.all([week ? api.friendsWeek(game.id, sub) : api.board(game.id, board!, scope), loadDailyFormat(game.id, sub)]).then(
      ([b, format]) => alive && setData({ board: b, format }),
      (e: unknown) => alive && setError(e),
    );
    return () => {
      alive = false;
    };
  }, [game.id, sub, board, scope, week]);
  const empty = week ? `这周你和好友都还没打${title}的每日挑战，去当第一个！` : `今天还没人打${title}的每日挑战，去当第一个！`;
  if (!board && !week) return <Empty testId="board-empty">{empty}</Empty>;
  if (error) return <p className="note">{errorText(error)}</p>;
  if (!data) return <Skeleton rows={5} />;
  const { board: b, format } = data;
  const rows = b.entries.map((e) => ({ ...e, text: format.score(e.score) }));
  const me = b.me ? { rank: b.me.rank, userId: '', displayName: '', isMe: true, text: format.score(b.me.score) } : null;
  return (
    <>
      <RankList rows={rows} me={me} empty={empty} share={{ board: `${title}每日挑战${week ? '（本周）' : ''}`, friends: week }} />
      {week && <p className="note">只看好友时比的是这周每人最好的一天，北京时间每周一 0 点清零。</p>}
      {format.note && <p className="note">{title}的每日挑战：{format.note}</p>}
    </>
  );
}

/** 各游戏总榜（0.23.0）：读现有的 GET /api/boards/<游戏>/<榜>，分数写法读游戏的 boards.json */
function FixedBoardView({ tab, scope }: { tab: FixedTab; scope: Scope }) {
  const [data, setData] = useState<{ board: ScoreBoard; format: ScoreFormat } | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    setError(null);
    Promise.all([api.board(tab.game.id, tab.id, scope), loadScoreFormat(tab.game.id, 'boards.json', tab.id)]).then(
      ([board, format]) => alive && setData({ board, format }),
      (e: unknown) => alive && setError(e),
    );
    return () => {
      alive = false;
    };
  }, [tab.game.id, tab.id, scope]);
  if (error) return <p className="note">{errorText(error)}</p>;
  if (!data) return <Skeleton rows={5} />;
  const { board: b, format } = data;
  const rows = b.entries.map((e) => ({ ...e, text: format.score(e.score) }));
  const me = b.me ? { rank: b.me.rank, userId: '', displayName: '', isMe: true, text: format.score(b.me.score) } : null;
  const empty = scope === 'friends' ? `你和好友都还没上${tab.label}，去当第一个！` : `还没人上${tab.label}，去当第一个！`;
  return (
    <>
      <RankList rows={rows} me={me} empty={empty} share={{ board: tab.label, friends: scope === 'friends' }} />
      <p className="note">
        {format.note ? `${tab.label}：${format.note}` : `${tab.label}：每人只留最好的一次，一直累计、不清零。`}
{' '}
        <a className="inline-link" href={tab.game.path}>
          去{tab.game.name}
        </a>
      </p>
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

  if (loading) return <Panel icon="trophy" title="排行榜"><Skeleton rows={6} /></Panel>;
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
    <nav className="board-nav" aria-label="哪个榜">
      {GROUPS.map((g) => (
        <section key={g.name} className="board-nav__group">
          <h3 className="board-nav__name">{g.name}</h3>
          <div className="tabs">
            {g.tabs.map(([t, label]) => (
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
          </div>
        </section>
      ))}
    </nav>
  );

  const daily = DAILY_TABS.find((t) => t.key === tab);
  const fixed = FIXED_TABS.find((t) => t.key === tab);
  let body;
  // 总榜不读 /api/leaderboard，不用等它
  if (fixed) body = <FixedBoardView tab={fixed} scope={scope} />;
  else if (error) body = <p className="note">{errorText(error)}</p>;
  else if (!data) body = <Skeleton rows={6} />;
  else if (daily) body = <DailyBoard tab={daily} board={data.daily[daily.key] ?? null} scope={scope} />;
  else {
    const b = data.boards[tab === 'week' ? weekBoard : 'titles'] ?? { entries: [], me: null };
    const fmt = (v: number) => (tab === 'week' ? { text: signed(v), tone: tone(v) } : { text: `${v} 个` });
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
        <RankList
          rows={rows}
          me={me}
          empty={tab === 'week' ? '这周还没人上榜，去玩一局带筹码的！' : '还没人拿到称号。'}
          share={{
            board: tab === 'week' ? `本周净赢·${WEEK_BOARDS.find((w) => w.id === weekBoard)?.name ?? '总榜'}` : '称号收集',
            friends: scope === 'friends',
          }}
        />
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
      <div className="boards">
        {tabs}
        <div className="boards__body" data-testid="board-body">
          {body}
        </div>
      </div>
    </Panel>
  );
}
