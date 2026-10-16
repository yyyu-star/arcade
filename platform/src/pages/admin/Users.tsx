/** 管理页：账号，给朋友建号、账号列表、看钱包和战绩、重设密码、删号。 */
import { useEffect, useState } from 'react';
import { api, type AdminUser, errorText } from '../../api.ts';
import { LedgerList } from '../../ledger.tsx';
import { Field, FormError, Panel, SubmitButton, useSubmit } from '../../ui.tsx';
import { chips, type Credentials, dateText, gameName } from './common.ts';

export function CreateUser({ onDone }: { onDone: (c: Credentials) => void }) {
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
    <Panel icon="user" title="给朋友建个账号">
      <form className="form" onSubmit={onSubmit}>
        <Field label="用户名" hint="登录用，3–20 位小写字母、数字或下划线" name="username" autoComplete="off" autoCapitalize="none" spellCheck={false} required value={username} onChange={(e) => setUsername(e.target.value)} />
        <Field label="昵称" hint="别人看到的名字，2–12 个字，对方以后可以自己改" name="displayName" autoComplete="off" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        <Field label="密码" hint="留空就自动生成一个好记的" name="password" autoComplete="new-password" spellCheck={false} value={password} onChange={(e) => setPassword(e.target.value)} />
        <FormError text={error} />
        <SubmitButton busy={busy}>建号</SubmitButton>
      </form>
    </Panel>
  );
}

export function UserList({ version, selfId, onCard, onChanged }: { version: number; selfId: string; onCard: (c: Credentials) => void; onChanged: () => void }) {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState('');
  /** 正在操作哪一行、做什么：一次只展开一个。 */
  const [open, setOpen] = useState<{ id: string; action: 'reset' | 'delete' | 'detail' } | null>(null);
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

  const toggle = (id: string, action: 'reset' | 'delete' | 'detail') => {
    setNotice('');
    setOpen(open?.id === id && open.action === action ? null : { id, action });
  };

  return (
    <Panel icon="user" title={users ? `账号（${users.length}）` : '账号'}>
      {error && <FormError text={error} />}
      {notice && <p className="ok" role="status">{notice}</p>}
      {!users && !error && <p className="note">正在读取…</p>}
      <ul className="users">
        {users?.map((u) => (
          <li key={u.id} className="users__item" data-testid={`user-${u.username}`}>
            <div className="users__head">
              <span className="users__name">
                {u.displayName}
                {u.id === selfId && <span className="tag">你</span>}
                {u.role === 'admin' && u.id !== selfId && <span className="tag">管理员</span>}
              </span>
              <span className="users__meta">
                <span className="mono">{u.username}</span> · {dateText(u.createdAt)} 建 · {u.lastSeenAt > u.createdAt ? `${dateText(u.lastSeenAt)} 来过` : '还没来过'}
              </span>
              {u.wallet && <span className="users__meta" data-testid="user-wallet">{walletLine(u.wallet)}</span>}
            </div>
            <button
              className="linkish users__detail"
              type="button"
              aria-expanded={open?.id === u.id && open.action === 'detail'}
              onClick={() => toggle(u.id, 'detail')}
            >
              {open?.id === u.id && open.action === 'detail' ? '收起' : '钱包和战绩'}
            </button>
            {open?.id === u.id && open.action === 'detail' && <UserDetail username={u.username} />}
            {u.id === selfId ? (
              <p className="note">你自己的密码去"我的账号"改。</p>
            ) : u.role === 'admin' ? (
              <p className="note">管理员账号要用管理命令行工具来改。</p>
            ) : (
              <div className="row">
                <button className="btn btn--small" type="button" aria-expanded={open?.id === u.id && open.action === 'reset'} onClick={() => toggle(u.id, 'reset')}>
                  重设密码
                </button>
                <button className="btn btn--small" type="button" aria-expanded={open?.id === u.id && open.action === 'delete'} onClick={() => toggle(u.id, 'delete')}>
                  删号
                </button>
              </div>
            )}
            {open?.id === u.id && open.action === 'reset' && (
              <ResetPassword user={u} onDone={onCard} />
            )}
            {open?.id === u.id && open.action === 'delete' && (
              <DeleteUser
                user={u}
                onDone={() => {
                  setOpen(null);
                  setNotice(`已经删掉「${u.displayName}」（${u.username}）`);
                  onChanged();
                }}
              />
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** 账号列表里的一行钱包摘要 */
function walletLine(w: NonNullable<AdminUser['wallet']>): string {
  if (w.balance === null) return '还没用过钱包';
  const played = Object.entries(w.played)
    .map(([g, n]) => `${gameName(g)} ${n} 次`)
    .join('、');
  return `余额 ${chips(w.balance)}${w.onTable ? ` · 桌上 ${chips(w.onTable)}` : ''}${played ? ` · ${played}` : ''}`;
}

/** 展开一个人：战绩（各游戏）和钱包流水（最近 30 条，新的在前） */
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
  if (!data) return <p className="note">正在读取…</p>;
  const career = Object.entries(data.career ?? {});
  return (
    <div className="user-detail" data-testid="user-detail">
      <p className="note">
        余额 {chips(data.wallet.balance)}
        {data.wallet.stakes.length ? ` · 桌上 ${data.wallet.stakes.map((s) => `${gameName(s.game)} ${chips(s.amount)}`).join('、')}` : ''}
        {data.wallet.fresh ? '（还没用过钱包）' : ''}
      </p>
      {career.length > 0 && (
        <table className="stats-table">
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
                <td>{gameName(g)}</td>
                <td>{c.n}</td>
                <td>{c.rounds || '—'}</td>
                <td>{c.rounds ? `${Math.round((c.wins / c.rounds) * 100)}%` : '—'}</td>
                <td>{c.best ? chips(c.best) : '—'}</td>
                <td>{chips(c.wnet)}</td>
                <td>{chips(c.net)}</td>
                <td>{c.titles.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data.ledger && data.ledger.length > 0 ? (
        <LedgerList entries={data.ledger} gameName={gameName} />
      ) : (
        <p className="note">还没有流水（0.10.7 以前的操作没记）。</p>
      )}
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
