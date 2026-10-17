/** 管理页：账号，给朋友建号、账号列表、看钱包和战绩、重设密码、删号。 */
import { useEffect, useState } from 'react';
import { api, type AdminUser, errorText } from '../../api.ts';
import { LedgerList } from '../../ledger.tsx';
import { Empty, Field, FormError, Panel, Skeleton, SubmitButton, useSubmit } from '../../ui.tsx';
import { signed, tone } from '../../format.ts';
import { num, type Credentials, dateText, gameName } from './common.ts';

/** 建号表单：在详情的位置打开（手机上整页），顶上"返回列表" */
function CreateUser({ onBack, onDone }: { onBack: () => void; onDone: (c: Credentials) => void }) {
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, onSubmit } = useSubmit(async () => {
    const r = await api.admin.create(username, displayName, password);
    setUsername('');
    setDisplayName('');
    setPassword('');
    onDone({ title: '账号建好了', username: r.user.username, password: r.password ?? password, recoveryCode: r.recoveryCode });
  });
  return (
    <section className="panel user-panel" data-testid="create-user">
      <button className="linkish users-split__back" type="button" onClick={onBack}>
        ← 返回列表
      </button>
      <h2 className="panel__title">给朋友建个账号</h2>
      <form className="form" onSubmit={onSubmit}>
        <Field label="用户名" hint="登录用，3–20 位小写字母、数字或下划线" name="username" autoComplete="off" autoCapitalize="none" spellCheck={false} required value={username} onChange={(e) => setUsername(e.target.value)} />
        <Field label="昵称" hint="别人看到的名字，2–12 个字，对方以后可以自己改" name="displayName" autoComplete="off" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <Field label="密码" hint="留空就自动生成一个好记的" name="password" autoComplete="new-password" spellCheck={false} value={password} onChange={(e) => setPassword(e.target.value)} />
        <FormError text={error} />
        <SubmitButton busy={busy}>建号</SubmitButton>
      </form>
    </section>
  );
}

/**
 * 账号：左边列表、右边选中那个人的详情（钱包、战绩、流水、重设密码、删号），或者"+ 建号"打开的建号表单。
 * 手机上一次只看一边：点一个人（或建号）进详情，详情顶上"返回列表"。
 */
export function UserList({ version, selfId, onCard, onChanged }: { version: number; selfId: string; onCard: (c: Credentials) => void; onChanged: () => void }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState('');
  /** 选中的人的 id；'new' 是建号表单 */
  const [picked, setPicked] = useState<string | null>(null);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let alive = true;
    api.admin.users().then(
      (r) => {
        if (!alive) return;
        setUsers(r.users);
        setError('');
      },
      (e: unknown) => alive && setError(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, [version]);

  const current = users?.find((u) => u.id === picked) ?? null;
  const creating = picked === 'new';
  return (
    <div className={`users-split${current || creating ? ' users-split--picked' : ''}`}>
      <Panel icon="user" title={users ? `账号（${users.length}）` : '账号'}>
        <button
          className="btn btn--primary btn--small users__new"
          type="button"
          data-testid="new-user"
          aria-pressed={creating}
          onClick={() => {
            setNotice('');
            setPicked('new');
          }}
        >
          + 建号
        </button>
        {error && <FormError text={error} />}
        {notice && <p className="ok" role="status">{notice}</p>}
        {!users && !error && <Skeleton rows={3} />}
        <ul className="users">
          {users?.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                className={`users__item${u.id === picked ? ' users__item--on' : ''}`}
                data-testid={`user-${u.username}`}
                aria-pressed={u.id === picked}
                onClick={() => {
                  setNotice('');
                  setPicked(u.id);
                }}
              >
                <span className="account__avatar" aria-hidden="true">
                  {Array.from(u.displayName)[0]}
                </span>
                <span className="users__head">
                  <span className="users__name">
                    {u.displayName}
                    {u.id === selfId && <span className="tag">你</span>}
                    {u.role === 'admin' && u.id !== selfId && <span className="tag">管理员</span>}
                  </span>
                  <span className="users__meta">
                    <span className="mono">{u.username}</span> · {u.lastSeenAt > u.createdAt ? `${dateText(u.lastSeenAt)} 来过` : '还没来过'}
                  </span>
                  {u.wallet && <span className="users__meta" data-testid="user-wallet">{walletLine(u.wallet)}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      <div className="users-split__detail">
        {creating ? (
          <CreateUser
            onBack={() => setPicked(null)}
            onDone={(c) => {
              setPicked(null);
              onCard(c);
              onChanged();
            }}
          />
        ) : current ? (
          <UserPanel
            key={current.id}
            user={current}
            self={current.id === selfId}
            onBack={() => setPicked(null)}
            onCard={onCard}
            onDeleted={() => {
              setPicked(null);
              setNotice(`已经删掉「${current.displayName}」（${current.username}）`);
              onChanged();
            }}
          />
        ) : (
          users && users.length > 0 && (
            <div className="users-split__hint">
              <Empty>点左边的一个人，看钱包、战绩和流水。</Empty>
            </div>
          )
        )}
      </div>
    </div>
  );
}

/** 账号列表里的一行钱包摘要 */
function walletLine(w: NonNullable<AdminUser['wallet']>): string {
  if (w.balance === null) return '还没用过钱包';
  const played = Object.entries(w.played)
    .map(([g, n]) => `${gameName(g)} ${n} 次`)
    .join('、');
  return `余额 ${num(w.balance)}${w.onTable ? ` · 桌上 ${num(w.onTable)}` : ''}${played ? ` · ${played}` : ''}`;
}

/** 右边的详情：头部、钱包和战绩、流水、操作（一次只展开一个操作） */
function UserPanel({ user: u, self, onBack, onCard, onDeleted }: { user: AdminUser; self: boolean; onBack: () => void; onCard: (c: Credentials) => void; onDeleted: () => void }) {
  const [action, setAction] = useState<'reset' | 'delete' | null>(null);
  const toggle = (a: 'reset' | 'delete') => setAction(action === a ? null : a);
  return (
    <section className="panel user-panel" data-testid={`detail-${u.username}`}>
      <button className="linkish users-split__back" type="button" onClick={onBack}>
        ← 返回列表
      </button>
      <div className="people__row people__row--big">
        <span className="account__avatar" aria-hidden="true">
          {Array.from(u.displayName)[0]}
        </span>
        <span className="people__text">
          <span className="people__name">
            {u.displayName} {u.role === 'admin' && <span className="tag">管理员</span>}
          </span>
          <span className="people__sub">
            <span className="mono">{u.username}</span> · {dateText(u.createdAt)} 建 · {u.lastSeenAt > u.createdAt ? `${dateText(u.lastSeenAt)} 来过` : '还没来过'}
          </span>
        </span>
      </div>
      <UserDetail username={u.username} />
      {self ? (
        <p className="note">你自己的密码去"我的账号"改。</p>
      ) : u.role === 'admin' ? (
        <p className="note">管理员账号要用管理命令行工具来改。</p>
      ) : (
        <div className="row user-panel__actions">
          <button className="btn btn--small" type="button" aria-expanded={action === 'reset'} onClick={() => toggle('reset')}>
            重设密码
          </button>
          <button className="btn btn--small" type="button" aria-expanded={action === 'delete'} onClick={() => toggle('delete')}>
            删号
          </button>
        </div>
      )}
      {action === 'reset' && <ResetPassword user={u} onDone={onCard} />}
      {action === 'delete' && <DeleteUser user={u} onDone={onDeleted} />}
    </section>
  );
}

/** 一个人的钱包摘要、各游戏战绩和钱包流水（最近 30 条，新的在前） */
function UserDetail({ username }: { username: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.admin.walletOf>> | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    api.admin.walletOf(username).then(
      (r) => alive && setData(r),
      (e: unknown) => alive && setError(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, [username]);
  if (error) return <FormError text={error} />;
  if (!data) return <Skeleton rows={3} />;
  const career = Object.entries(data.career ?? {});
  return (
    <div className="user-detail" data-testid="user-detail">
      <dl className="tiles tiles--small">
        <div className="tile">
          <dt>余额</dt>
          <dd>{num(data.wallet.balance)}</dd>
        </div>
        <div className="tile">
          <dt>桌上</dt>
          <dd>{num(data.wallet.stakes.reduce((t, s) => t + s.amount, 0))}</dd>
        </div>
      </dl>
      {(data.wallet.stakes.length > 0 || data.wallet.fresh) && (
        <p className="note">
          {data.wallet.stakes.map((s) => `${gameName(s.game)} ${num(s.amount)}`).join('、')}
          {data.wallet.fresh ? '还没用过钱包' : ''}
        </p>
      )}
      {career.length > 0 && (
        <table className="stats-table cards-on-phone">
          <thead>
            <tr>
              <th>游戏</th>
              <th>上桌</th>
              <th>局数</th>
              <th>胜率</th>
              <th>最大一把</th>
              <th>本周</th>
              <th>累计</th>
              <th>称号</th>
            </tr>
          </thead>
          <tbody>
            {career.map(([g, c]) => (
              <tr key={g}>
                <td data-label="游戏">{gameName(g)}</td>
                <td data-label="上桌">{c.n}</td>
                <td data-label="局数">{c.rounds || '—'}</td>
                <td data-label="胜率">{c.rounds ? `${Math.round((c.wins / c.rounds) * 100)}%` : '—'}</td>
                <td data-label="最大一把">{c.best ? num(c.best) : '—'}</td>
                <td data-label="本周" className={tone(c.wnet)}>{signed(c.wnet)}</td>
                <td data-label="累计" className={tone(c.net)}>{signed(c.net)}</td>
                <td data-label="称号">{c.titles.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <h3 className="user-detail__title">钱包流水</h3>
      {data.ledger && data.ledger.length > 0 ? <LedgerList entries={data.ledger} /> : <Empty>还没有流水。</Empty>}
    </div>
  );
}

function ResetPassword({ user, onDone }: { user: AdminUser; onDone: (c: Credentials) => void }) {
  const [password, setPassword] = useState('');
  const [newCode, setNewCode] = useState(false);
  const { busy, error, onSubmit } = useSubmit(async () => {
    const r = await api.admin.resetPassword(user.id, password, newCode);
    onDone({ title: '密码重设好了', username: user.username, password: r.password ?? password, recoveryCode: r.recoveryCode });
  });
  return (
    <form className="form users__panel" onSubmit={onSubmit}>
      <p className="note">重设以后，「{user.displayName}」在所有设备上都会退出，要用新密码重新登录。</p>
      <Field label="新密码" hint="留空就自动生成一个好记的" name="password" autoComplete="new-password" spellCheck={false} value={password} onChange={(e) => setPassword(e.target.value)} />
      <label className="check">
        <input type="checkbox" checked={newCode} onChange={(e) => setNewCode(e.target.checked)} />
        恢复码也换一个（对方的恢复码丢了才需要）
      </label>
      <FormError text={error} />
      <SubmitButton busy={busy}>重设密码</SubmitButton>
    </form>
  );
}

function DeleteUser({ user, onDone }: { user: AdminUser; onDone: () => void }) {
  const [sure, setSure] = useState(false);
  const { busy, error, onSubmit } = useSubmit(async () => {
    await api.admin.remove(user.id);
    onDone();
  });
  return (
    <form className="form users__panel" onSubmit={onSubmit}>
      <label className="check">
        <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
        确定删掉「{user.displayName}」的账号和云存档，删了找不回来
      </label>
      <FormError text={error} />
      <SubmitButton busy={busy} danger disabled={!sure}>
        删号
      </SubmitButton>
    </form>
  );
}
