/**
 * /login：登录、注册两个页签；注册成功后先给恢复码，存好了才继续（docs/platform-backend.md 5.7）。
 * 注册关闭时（测试期邀请制）只有登录，不露"注册"两个字。
 */
import { useEffect, useState } from 'react';
import { api } from '../api.ts';
import { LogoMark } from '../icons.tsx';
import { safeNext } from '../next.ts';
import { gameOfPath, playUrl, returnFriendPath, returnGame } from '../play.ts';
import { Link, navigate, useLocation } from '../router.tsx';
import { useSession } from '../session.tsx';
import { Field, FormError, Panel, RecoveryCodeCard, SubmitButton, useSubmit } from '../ui.tsx';

/**
 * 登录或注册完成后去哪：带了合格的 next 就回那里（整页跳转：游戏是另一个应用，房间码在查询里）；
 * 否则从游戏来的回游戏，从好友链接来的回那个链接，再否则回首页。
 */
function leave(from: string | null, next: string | null): void {
  if (next) return location.assign(next);
  const game = returnGame(from);
  if (game) location.assign(playUrl(game));
  else navigate(returnFriendPath(from) ?? '/');
}

export function LoginPage() {
  const loc = useLocation();
  const from = loc.searchParams.get('from');
  const next = safeNext(loc.searchParams.get('next'), location.origin);
  const tab = loc.searchParams.get('tab') === 'register' ? 'register' : 'login';
  const { user } = useSession();
  const [fresh, setFresh] = useState<{ code: string; username: string } | null>(null);
  const game = next ? gameOfPath(next) : returnGame(from);
  const back = next ? !game : !!returnFriendPath(from);
  const done = () => leave(from, next);
  const registration = useRegistration();

  if (fresh) {
    return (
      <Panel icon="key" title="注册好了">
        <RecoveryCodeCard code={fresh.code} username={fresh.username} doneText={game ? `回到${game.name}` : '开始玩'} onDone={done} />
      </Panel>
    );
  }
  if (user) {
    // 从游戏点"登录"过来、其实已经登录着（比如在别的页签登的）：给一个直接回游戏的按钮
    return (
      <Panel icon="key" title="已经登录了">
        <p className="note">
          你现在是 <strong>{user.displayName}</strong>。
        </p>
        <div className="row">
          {(game || back) && (
            <a className="btn btn--primary" href={next ?? (game ? playUrl(game) : (returnFriendPath(from) ?? '/'))}>
              {game ? `回到${game.name}` : '回到刚才那一页'}
            </a>
          )}
          <Link className="btn" href="/me">
            去我的账号
          </Link>
        </div>
      </Panel>
    );
  }

  if (registration !== 'open') {
    return (
      <Panel icon="key" title="登录">
        <Welcome />
        {game && <p className="note">登录后回到「{game.name}」，存档会自动同步。</p>}
        {back && <p className="note">登录后回到刚才那一页。</p>}
        <p className="note" data-testid="invite-only">
          现在只对受邀的朋友开放，账号找邀请你的人要。
        </p>
        <LoginForm onDone={done} />
      </Panel>
    );
  }

  const tabHref = (t: string) => `/login?${new URLSearchParams({ ...(from ? { from } : {}), ...(next ? { next } : {}), ...(t === 'register' ? { tab: t } : {}) })}`;
  return (
    <Panel icon="key" title={tab === 'login' ? '登录' : '注册'}>
      <Welcome />
      {game && <p className="note">登录后回到「{game.name}」，存档会自动同步。</p>}
      {back && <p className="note">登录后回到刚才那一页。</p>}
      <nav className="tabs" aria-label="登录或注册">
        <Link href={tabHref('login')} className={tab === 'login' ? 'tabs__on' : ''} aria-current={tab === 'login' ? 'page' : undefined}>
          登录
        </Link>
        <Link href={tabHref('register')} className={tab === 'register' ? 'tabs__on' : ''} aria-current={tab === 'register' ? 'page' : undefined}>
          注册
        </Link>
      </nav>
      {tab === 'login' ? <LoginForm onDone={done} /> : <RegisterForm onDone={setFresh} />}
    </Panel>
  );
}

/** 登录页顶上的欢迎：一台小街机加一句话 */
function Welcome() {
  return (
    <div className="welcome">
      <LogoMark size={64} />
      <p>欢迎来街机厅，登录后挑一个开一局。</p>
    </div>
  );
}

/**
 * 注册开没开：问一次 /api/me（只读，不写库）。问到之前、问不到时都当关着，只给登录：
 * 关着的时候露了注册页签，点进去只会碰一鼻子灰。
 */
function useRegistration(): 'open' | 'closed' | null {
  const [value, setValue] = useState<'open' | 'closed' | null>(null);
  useEffect(() => {
    let alive = true;
    api.me().then(
      (r) => alive && setValue(r.registration),
      () => alive && setValue('closed'),
    );
    return () => {
      alive = false;
    };
  }, []);
  return value;
}

function LoginForm({ onDone }: { onDone: () => void }) {
  const { setUser } = useSession();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const { busy, error, onSubmit } = useSubmit(async () => {
    const { user } = await api.login(username, password);
    setUser(user);
    onDone();
  });
  return (
    <form className="form" onSubmit={onSubmit}>
      <Field label="用户名" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={username} onChange={(e) => setUsername(e.target.value)} />
      <Field label="密码" name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      <FormError text={error} />
      <SubmitButton busy={busy}>登录</SubmitButton>
      <p className="note">
        忘了密码？<Link href="/forgot">用恢复码找回</Link>
      </p>
    </form>
  );
}

function RegisterForm({ onDone }: { onDone: (r: { code: string; username: string }) => void }) {
  const { setUser } = useSession();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const { busy, error, setError, onSubmit } = useSubmit(async () => {
    const r = await api.register(username, password, displayName);
    setUser(r.user);
    onDone({ code: r.recoveryCode, username: r.user.username });
  });
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (password !== again) {
          setError('两次输的密码不一样');
          return;
        }
        void onSubmit();
      }}
    >
      <p className="note">不收手机号和邮箱。注册后会给你一串恢复码，忘了密码只能靠它。</p>
      <Field label="用户名" hint="登录用，3–20 位小写字母、数字或下划线" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={username} onChange={(e) => setUsername(e.target.value)} />
      <Field label="昵称" hint="别人看到的名字，2–12 个字" name="displayName" autoComplete="nickname" required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      <Field label="密码" hint="至少 8 位，别用常见密码" name="password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      <Field label="再输一遍密码" name="again" type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.target.value)} />
      <FormError text={error} />
      <SubmitButton busy={busy}>注册</SubmitButton>
    </form>
  );
}
