/**
 * /me：我的账号。昵称、好友码、各游戏的云存档；改密码、换恢复码、退出、退出其他设备、注销。
 * 动账号安全的操作都要再输一次当前密码（docs/platform-backend.md 5.2），这些只放在平台页。
 */
import { useEffect, useState } from 'react';
import { api, ApiFail, errorText, type SaveSlot, type User } from '../api.ts';
import { fullDateText, timeText } from '../format.ts';
import { GAMES } from '../games.ts';
import { confirmLeave, Link, navigate } from '../router.tsx';
import { useSession } from '../session.tsx';
import { Field, FormError, Panel, RecoveryCodeCard, SubmitButton, useSubmit } from '../ui.tsx';

/** 再验证（输当前密码）时 bad_credentials 只可能是密码错，别说"用户名或密码不对"。 */
const REAUTH = { bad_credentials: '密码不对' };


export function MePage() {
  const { loading, user, service } = useSession();
  if (loading) return <Panel icon="user" title="我的账号"><p className="note">正在读取…</p></Panel>;
  // 停服、连不上时读不到账号（不是没登录）：顶上已有提示，这里别让人去登录
  if (service === 'off') return <Panel icon="user" title="我的账号"><p className="note">账号服务暂时休息，过一会儿再来看。</p></Panel>;
  if (service === 'unreachable') return <Panel icon="user" title="我的账号"><p className="note">连不上服务器，点上面的"重试"。</p></Panel>;
  if (!user) {
    return (
      <Panel icon="user" title="我的账号">
        <p>还没登录。</p>
        <Link className="btn btn--primary" href="/login">
          去登录
        </Link>
      </Panel>
    );
  }
  return (
    <>
      {service === 'readonly' && <p className="banner">服务器有点忙，现在只能看、不能改，明天再来。</p>}
      <Panel icon="user" title="我的账号">
        <dl className="facts">
          <dt>昵称</dt>
          <dd>{user.displayName}</dd>
          <dt>用户名</dt>
          <dd>{user.username}</dd>
          <dt>好友码</dt>
          <dd>
            <span className="mono">{user.friendCode}</span>{' '}
            <Link className="inline-link" href="/friends">
              去好友页
            </Link>
          </dd>
          <dt>战绩</dt>
          <dd>
            <Link className="inline-link" href="/me/stats">
              看我的战绩和称号
            </Link>
          </dd>
          <dt>注册于</dt>
          <dd>{fullDateText(user.createdAt)}</dd>
        </dl>
        <Rename />
        <LogoutButton />
      </Panel>
      <Panel icon="people" title="好友能看到什么">
        <PrivacySwitch
          field="showWhere"
          label="让好友看到我在线、在玩哪个游戏、在哪个房间"
          onNote="好友在好友页能看到你在不在线、在哪，能一键加入你的房间。"
          offNote="好友只看到你几天前来过，看不到你在不在线、在哪。"
          save={api.setShowWhere}
          testId="show-where"
        />
        <PrivacySwitch
          field="showFeed"
          label="让好友看到我的动态（实盘赢了、新称号、游戏里的名场面）"
          onNote="好友在好友页能看到你最近 7 天的动态，能点赞、扔道具。"
          offNote="不再生成你的动态，已有的好友也看不到。"
          save={api.setShowFeed}
          testId="show-feed"
        />
      </Panel>
      <Saves />
      <Panel icon="lock" title="账号安全">
        <ChangePassword />
        <NewRecoveryCode />
        <LogoutOthers />
        <DeleteAccount />
      </Panel>
    </>
  );
}

function Rename() {
  const { user, setUser } = useSession();
  const [name, setName] = useState(user!.displayName);
  const [done, setDone] = useState(false);
  const { busy, error, onSubmit } = useSubmit(async () => {
    setDone(false);
    const r = await api.rename(name);
    setUser(r.user);
    setDone(true);
  });
  return (
    <details className="fold">
      <summary>改昵称</summary>
      <form className="form" onSubmit={onSubmit}>
        <Field label="新昵称" hint="2–12 个字，每天最多改 10 次" name="displayName" required value={name} onChange={(e) => setName(e.target.value)} />
        <FormError text={error} />
        {done && <p className="ok">改好了</p>}
        <SubmitButton busy={busy}>保存</SubmitButton>
      </form>
    </details>
  );
}

/**
 * "好友能看到什么"里的开关：点了马上存（和改昵称共用每天 10 次）。
 * - 在哪（0.13.0，docs/social.md 1.2）：关了好友那边只看到"几天前来过"；
 * - 好友动态（0.17.0，第 2 节）：关了不再生成，已有的好友也看不到。
 */
function PrivacySwitch({ field, label, onNote, offNote, save, testId }: {
  field: 'showWhere' | 'showFeed';
  label: string;
  onNote: string;
  offNote: string;
  save: (on: boolean) => Promise<{ user: User }>;
  testId: string;
}) {
  const { user, setUser } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // 先按点的显示，存不上再退回：等回话再变，勾选框看着像没点上
  const [shown, setShown] = useState<boolean | null>(null);
  const on = shown ?? user![field] !== false;
  const flip = async (next: boolean) => {
    setShown(next);
    setBusy(true);
    setError('');
    try {
      setUser((await save(next)).user);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setShown(null);
      setBusy(false);
    }
  };
  return (
    <>
      <label className="check">
        <input type="checkbox" checked={on} disabled={busy} onChange={(e) => void flip(e.target.checked)} data-testid={testId} />
        {label}
      </label>
      <p className="note">{on ? onNote : offNote}</p>
      <FormError text={error} />
    </>
  );
}

function LogoutButton() {
  const { setUser } = useSession();
  const { busy, error, onSubmit } = useSubmit(async () => {
    // 刚换的恢复码还没存好时先问：退出以后卡片就没了
    if (!confirmLeave()) return;
    await api.logout();
    setUser(null);
    navigate('/', false, true);
  });
  return (
    <div className="row">
      <button className="btn" type="button" disabled={busy} onClick={() => void onSubmit()}>
        退出登录
      </button>
      <FormError text={error} />
    </div>
  );
}

/** 各游戏存了什么：只显示份数、大小和更新时间，内容是游戏自己的格式。 */
function Saves() {
  const { savesPaused } = useSession();
  // 每个游戏单独读：一个游戏读不到（出错、超限）不连累别的
  const [rows, setRows] = useState<{ id: string; name: string; slots: SaveSlot[] | null; error: string }[]>(
    GAMES.map((g) => ({ id: g.id, name: g.name, slots: null, error: '' })),
  );
  useEffect(() => {
    let alive = true;
    void Promise.allSettled(GAMES.map((g) => api.saves(g.id))).then((results) => {
      if (!alive) return;
      setRows(
        GAMES.map((g, i) => {
          const r = results[i]!;
          return r.status === 'fulfilled'
            ? { id: g.id, name: g.name, slots: r.value.saves, error: '' }
            : { id: g.id, name: g.name, slots: null, error: r.reason instanceof ApiFail ? r.reason.message : '读不到，过一会儿再试' };
        }),
      );
    });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <Panel icon="user" title="云存档">
      <p className="note">游戏里登录后，档案、战绩和新手教程进度会自动存到这里，换台设备也能接着玩。打到一半的那一局不存。</p>
      {savesPaused && (
        <p className="banner banner--inline" data-testid="saves-paused">
          服务器有点忙，云存档先暂停了。游戏里的进度先存在这台设备上，过后再同步。
        </p>
      )}
      <ul className="saves">
        {rows.map((r) => (
          <li key={r.id} data-testid={`saves-${r.id}`}>
            <span className="saves__game">{r.name}</span>
            <span className={`saves__info${r.error ? ' saves__info--error' : ''}`}>
              {r.error
                ? r.error
                : r.slots === null
                  ? '读取中…'
                  : r.slots.length === 0
                    ? '还没有存档'
                    : `${r.slots.length} 份 · ${kb(r.slots)} · 最近 ${timeText(Math.max(...r.slots.map((s) => s.updatedAt)))}`}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function kb(slots: SaveSlot[]): string {
  const bytes = slots.reduce((n, s) => n + new TextEncoder().encode(JSON.stringify(s.data)).byteLength, 0);
  return bytes < 1024 ? `${bytes} 字节` : `${(bytes / 1024).toFixed(1)} KB`;
}

function ChangePassword() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, onSubmit } = useSubmit(async () => {
    setDone(false);
    await api.changePassword(current, next);
    setCurrent('');
    setNext('');
    setDone(true);
  }, REAUTH);
  return (
    <details className="fold">
      <summary>改密码</summary>
      <form className="form" onSubmit={onSubmit}>
        <Field label="现在的密码" name="currentPassword" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        <Field label="新密码" hint="至少 8 位，别用常见密码" name="newPassword" type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
        <FormError text={error} />
        {done && <p className="ok">改好了，别的设备都已退出</p>}
        <SubmitButton busy={busy}>改密码</SubmitButton>
      </form>
    </details>
  );
}

function NewRecoveryCode() {
  const { user } = useSession();
  const [current, setCurrent] = useState('');
  const [code, setCode] = useState('');
  const { busy, error, onSubmit } = useSubmit(async () => {
    const r = await api.newRecoveryCode(current);
    setCurrent('');
    setCode(r.recoveryCode);
  }, REAUTH);
  return (
    <details className="fold">
      <summary>换一个恢复码</summary>
      {code ? (
        <RecoveryCodeCard code={code} username={user!.username} doneText="好了" onDone={() => setCode('')} />
      ) : (
        <form className="form" onSubmit={onSubmit}>
          <p className="note">旧恢复码丢了或者给别人看到了，就换一个。换了以后旧的立刻作废。</p>
          <Field label="现在的密码" name="currentPassword" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
          <FormError text={error} />
          <SubmitButton busy={busy}>换恢复码</SubmitButton>
        </form>
      )}
    </details>
  );
}

function LogoutOthers() {
  const [current, setCurrent] = useState('');
  const [done, setDone] = useState(false);
  const { busy, error, onSubmit } = useSubmit(async () => {
    setDone(false);
    await api.logoutOthers(current);
    setCurrent('');
    setDone(true);
  }, REAUTH);
  return (
    <details className="fold">
      <summary>退出其他设备</summary>
      <form className="form" onSubmit={onSubmit}>
        <p className="note">在别人的电脑上登录过、忘了退出，就用这个。这台设备不受影响。</p>
        <Field label="现在的密码" name="currentPassword" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        <FormError text={error} />
        {done && <p className="ok">别的设备都已退出</p>}
        <SubmitButton busy={busy}>退出其他设备</SubmitButton>
      </form>
    </details>
  );
}

function DeleteAccount() {
  const { setUser } = useSession();
  const [useCode, setUseCode] = useState(false);
  const [secret, setSecret] = useState('');
  const [sure, setSure] = useState(false);
  const { busy, error, setError, onSubmit } = useSubmit(async () => {
    await api.deleteAccount(useCode ? { recoveryCode: secret } : { currentPassword: secret });
    setUser(null);
    // 账号已经删了，刚换的恢复码也跟着作废，不用再提醒
    navigate('/?deleted=1', false, true);
  }, useCode ? { bad_credentials: '恢复码不对' } : REAUTH);
  return (
    <details className="fold fold--danger">
      <summary>注销账号</summary>
      <form className="form" onSubmit={onSubmit}>
        <p className="note">账号、昵称、好友和所有云存档会马上删掉，找不回来。各游戏存在这台设备上的进度不受影响。</p>
        {useCode ? (
          <Field label="恢复码" name="recoveryCode" autoComplete="off" autoCapitalize="characters" spellCheck={false} required value={secret} onChange={(e) => setSecret(e.target.value)} />
        ) : (
          <Field label="现在的密码" name="currentPassword" type="password" autoComplete="current-password" required value={secret} onChange={(e) => setSecret(e.target.value)} />
        )}
        <button
          className="linkish"
          type="button"
          onClick={() => {
            setUseCode(!useCode);
            setSecret('');
            setError('');
          }}
        >
          {useCode ? '改用密码' : '忘了密码？用恢复码'}
        </button>
        <label className="check">
          <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
          我知道删了就找不回来
        </label>
        <FormError text={error} />
        <SubmitButton busy={busy} danger disabled={!sure}>
          注销账号
        </SubmitButton>
      </form>
    </details>
  );
}
