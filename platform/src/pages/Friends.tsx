/**
 * /friends：好友页；/f/<码>：别人分享的好友链接（docs/platform-backend.md 5.6、5.7）。
 * 不按昵称搜人，只能靠好友码或链接加；对别人只显示昵称，不显示用户名。
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, ApiFail, errorText, type FriendLists, type Profile, type Relation } from '../api.ts';
import { Link, navigate, useLocation } from '../router.tsx';
import { useSession } from '../session.tsx';
import { Empty, Field, FormError, Panel, useWritable } from '../ui.tsx';

/** "今天来过 / 昨天来过 / N 天前来过"（服务端按北京时间算天，不给精确时间）。 */
function lastSeenText(days: number): string {
  if (days <= 0) return '今天来过';
  if (days === 1) return '昨天来过';
  return `${days} 天前来过`;
}

function Avatar({ name }: { name: string }) {
  return (
    <span className="account__avatar" aria-hidden="true">
      {Array.from(name)[0]}
    </span>
  );
}

/** 没登录、停服、连不上时好友页和好友链接都显示的提示；返回 null 表示可以往下走。 */
function useGate(from: string): ReactNode | null {
  const { loading, user, service } = useSession();
  if (loading) return <p className="note">正在读取…</p>;
  if (service === 'off') return <p className="note">账号服务暂时休息，过一会儿再来看。</p>;
  if (service === 'unreachable') return <p className="note">连不上服务器，点上面的"重试"。</p>;
  if (!user) {
    return (
      <>
        <p>登录后才能加好友。</p>
        <Link className="btn btn--primary" href={`/login?from=${encodeURIComponent(from)}`}>
          去登录
        </Link>
      </>
    );
  }
  return null;
}

/** 一个按钮点了做一件事：防重复点，出错显示一句话。 */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export function FriendsPage() {
  const gate = useGate('friends');
  if (gate) return <Panel icon="people" title="好友">{gate}</Panel>;
  return <Friends />;
}

function Friends() {
  const { service } = useSession();
  const [data, setData] = useState<FriendLists | null>(null);
  const [blocks, setBlocks] = useState<Profile[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    let alive = true;
    void Promise.all([api.friends(), api.blocks()]).then(
      ([f, b]) => {
        if (!alive) return;
        setData(f);
        setBlocks(b.blocks);
        setLoadError('');
      },
      (e: unknown) => alive && setLoadError(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, [version]);

  return (
    <>
      {service === 'readonly' && <p className="banner">服务器有点忙，现在只能看、不能改，明天再来。</p>}
      <MyCode />
      <AddByCode />
      {loadError && <FormError text={loadError} />}
      {!data && !loadError && (
        <Panel icon="people" title="好友">
          <p className="note">正在读取…</p>
        </Panel>
      )}
      {data && data.incoming.length > 0 && (
        <Panel icon="people" title={`想加你的人（${data.incoming.length}）`}>
          <ul className="people">
            {data.incoming.map((p) => (
              <Incoming key={p.userId} p={p} onChanged={reload} />
            ))}
          </ul>
        </Panel>
      )}
      {data && (
        <Panel icon="people" title={`好友（${data.friends.length}）`}>
          {data.friends.length === 0 ? (
            <Empty>还没有好友。把上面的好友链接发给朋友，对方点开就能加你。</Empty>
          ) : (
            <ul className="people">
              {data.friends.map((p) => (
                <Friend key={p.userId} p={p} onChanged={reload} />
              ))}
            </ul>
          )}
        </Panel>
      )}
      {data && data.outgoing.length > 0 && (
        <Panel icon="people" title={`等对方接受（${data.outgoing.length}）`}>
          <ul className="people">
            {data.outgoing.map((p) => (
              <Outgoing key={p.userId} p={p} onChanged={reload} />
            ))}
          </ul>
        </Panel>
      )}
      {blocks && blocks.length > 0 && (
        <Panel icon="people" title={`屏蔽的人（${blocks.length}）`}>
          <p className="note">屏蔽的人发来的请求你看不到，也加不了你。对方不会知道自己被屏蔽了。</p>
          <ul className="people">
            {blocks.map((p) => (
              <Blocked key={p.userId} p={p} onChanged={reload} />
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}

/** 我的好友码和分享链接；可以换一个（旧链接马上失效）。 */
function MyCode() {
  const { user, setUser } = useSession();
  const writable = useWritable();
  const [copy, setCopy] = useState<'idle' | 'done' | 'failed'>('idle');
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();
  const link = `${location.origin}/f/${user!.friendCode}`;
  const copyLink = () =>
    navigator.clipboard.writeText(link).then(
      () => setCopy('done'),
      () => setCopy('failed'),
    );
  // 手机上用系统的分享面板（微信、QQ 都在里面）；电脑上没有就直接复制
  const canShare = typeof navigator.share === 'function';
  const share = () =>
    navigator.share({ title: '小游戏街机厅', text: `${user!.displayName} 叫你来街机厅一起玩，点链接加我好友：`, url: link }).catch((e: unknown) => {
      // 用户自己关了分享面板不算失败；别的原因（比如不让分享）退回复制
      if (!(e instanceof DOMException && e.name === 'AbortError')) void copyLink();
    });
  return (
    <Panel icon="people" title="我的好友码">
      <p className="code-big" data-testid="my-friend-code">
        {user!.friendCode}
      </p>
      <p className="note">
        把链接发给朋友，对方点开就能加你：
        <br />
        <span className="mono link-text" data-testid="my-friend-link">
          {link}
        </span>
      </p>
      <div className="row">
        <button className="btn btn--primary btn--big" type="button" data-testid="share-link" onClick={() => void (canShare ? share() : copyLink())}>
          {canShare ? '分享给朋友' : copy === 'done' ? '已复制，发给朋友吧' : '复制我的好友链接'}
        </button>
        {canShare && (
          <button className="btn" type="button" onClick={() => void copyLink()}>
            {copy === 'done' ? '已复制' : '复制链接'}
          </button>
        )}
      </div>
      {copy === 'failed' && <p className="form-error">复制不了，长按上面的链接手动复制</p>}
      <details className="fold">
        <summary>换一个好友码</summary>
        <div className="form">
          <p className="note">链接发给了不想加的人，就换一个。换了以后旧链接马上失效，已经加上的好友不受影响。每天最多换 3 次。</p>
          <FormError text={error} />
          {done && <p className="ok">换好了</p>}
          <button
            className="btn btn--primary"
            type="button"
            aria-busy={busy}
            disabled={busy || !writable}
            onClick={() =>
              void run(async () => {
                setDone(false);
                const r = await api.newFriendCode();
                setUser({ ...user!, friendCode: r.friendCode });
                setCopy('idle');
                setDone(true);
              })
            }
          >
            {busy ? '请稍等…' : '换好友码'}
          </button>
        </div>
      </details>
    </Panel>
  );
}

/** 手里有好友码（比如朋友念给你听）：输进来，去 /f/<码> 看看是谁。 */
function AddByCode() {
  const [code, setCode] = useState('');
  return (
    <Panel icon="people" title="加好友">
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const c = code.replace(/[\s-]/g, '');
          if (c) navigate(`/f/${encodeURIComponent(c)}`);
        }}
      >
        <Field label="对方的好友码" hint="8 位，不分大小写" name="friendCode" autoComplete="off" autoCapitalize="characters" spellCheck={false} required value={code} onChange={(e) => setCode(e.target.value)} />
        <button className="btn btn--primary" type="submit">
          查找
        </button>
      </form>
    </Panel>
  );
}

/** 一行人：头像、昵称、说明，右边是按钮；confirm 展开时在下面要求确认。 */
function Person({ p, sub, children, confirm, stats }: { p: Profile; sub?: string; children: ReactNode; confirm?: ReactNode; stats?: boolean }) {
  return (
    <li className="people__item" data-testid={`person-${p.displayName}`}>
      <div className="people__row">
        <Avatar name={p.displayName} />
        <span className="people__text">
          {stats ? (
            // 0.10.5：点好友的名字看对方的战绩
            <Link className="people__name people__link" href={`/u/${p.userId}`}>
              {p.displayName}
            </Link>
          ) : (
            <span className="people__name">{p.displayName}</span>
          )}
          {sub && <span className="people__sub">{sub}</span>}
        </span>
      </div>
      <div className="row">{children}</div>
      {confirm}
    </li>
  );
}

function Incoming({ p, onChanged }: { p: Profile; onChanged: () => void }) {
  const writable = useWritable();
  const { busy, error, run } = useAction();
  const [blocking, setBlocking] = useState(false);
  return (
    <Person
      p={p}
      sub="想加你为好友"
      confirm={
        <>
          {blocking && <BlockConfirm p={p} onDone={onChanged} />}
          <FormError text={error} />
        </>
      }
    >
      <button className="btn btn--small btn--primary" type="button" disabled={busy || !writable} onClick={() => void run(async () => (await api.acceptFriend(p.userId), onChanged()))}>
        接受
      </button>
      <button className="btn btn--small" type="button" disabled={busy || !writable} onClick={() => void run(async () => (await api.declineFriend(p.userId), onChanged()))}>
        拒绝
      </button>
      <button className="btn btn--small" type="button" disabled={!writable} aria-expanded={blocking} onClick={() => setBlocking(!blocking)}>
        屏蔽
      </button>
    </Person>
  );
}

function Friend({ p, onChanged }: { p: FriendLists['friends'][number]; onChanged: () => void }) {
  const writable = useWritable();
  const [open, setOpen] = useState<'remove' | 'block' | null>(null);
  const toggle = (what: 'remove' | 'block') => setOpen(open === what ? null : what);
  return (
    <Person
      p={p}
      stats
      sub={lastSeenText(p.lastSeenDaysAgo)}
      confirm={
        open === 'remove' ? (
          <Confirm label={`确定不再和「${p.displayName}」做好友`} button="删好友" action={() => api.removeFriend(p.userId)} onDone={onChanged} />
        ) : open === 'block' ? (
          <BlockConfirm p={p} onDone={onChanged} />
        ) : null
      }
    >
      <button className="btn btn--small" type="button" disabled={!writable} aria-expanded={open === 'remove'} onClick={() => toggle('remove')}>
        删好友
      </button>
      <button className="btn btn--small" type="button" disabled={!writable} aria-expanded={open === 'block'} onClick={() => toggle('block')}>
        屏蔽
      </button>
    </Person>
  );
}

function Outgoing({ p, onChanged }: { p: Profile; onChanged: () => void }) {
  const writable = useWritable();
  const { busy, error, run } = useAction();
  return (
    <Person p={p} sub="已发送，等对方接受" confirm={<FormError text={error} />}>
      <button className="btn btn--small" type="button" disabled={busy || !writable} onClick={() => void run(async () => (await api.removeFriend(p.userId), onChanged()))}>
        撤回
      </button>
    </Person>
  );
}

function Blocked({ p, onChanged }: { p: Profile; onChanged: () => void }) {
  const writable = useWritable();
  const { busy, error, run } = useAction();
  return (
    <Person p={p} confirm={<FormError text={error} />}>
      <button className="btn btn--small" type="button" disabled={busy || !writable} onClick={() => void run(async () => (await api.unblock(p.userId), onChanged()))}>
        解除屏蔽
      </button>
    </Person>
  );
}

function BlockConfirm({ p, onDone }: { p: Profile; onDone: () => void }) {
  return (
    <Confirm
      label={`确定屏蔽「${p.displayName}」：删掉好友和请求，以后看不到对方的请求`}
      button="屏蔽"
      action={() => api.block(p.userId)}
      onDone={onDone}
    />
  );
}

/** 要先勾确认才能点的危险操作。 */
function Confirm({ label, button, action, onDone }: { label: string; button: string; action: () => Promise<void>; onDone: () => void }) {
  const writable = useWritable();
  const [sure, setSure] = useState(false);
  const { busy, error, run } = useAction();
  return (
    <div className="form people__confirm">
      <label className="check">
        <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
        {label}
      </label>
      <FormError text={error} />
      <button className="btn btn--danger" type="button" aria-busy={busy} disabled={!sure || busy || !writable} onClick={() => void run(async () => (await action(), onDone()))}>
        {busy ? '请稍等…' : button}
      </button>
    </div>
  );
}

/** 坏的百分号编码（如 /f/%E0）不让整页崩：原样交给服务端，它会回"没找到"。 */
function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** /f/<码>：看看这是谁，加好友。 */
export function FriendCodePage() {
  const loc = useLocation();
  const code = safeDecode(loc.pathname.slice('/f/'.length));
  const gate = useGate(`f/${code}`);
  if (gate) return <Panel icon="people" title="加好友">{gate}</Panel>;
  return <FriendCode key={code} code={code} />;
}

type Lookup = { state: 'loading' } | { state: 'missing' } | { state: 'error'; text: string } | { state: 'ok'; user: Profile; relation: Relation; blocked: boolean };

function FriendCode({ code }: { code: string }) {
  const writable = useWritable();
  const [look, setLook] = useState<Lookup>({ state: 'loading' });
  const [version, setVersion] = useState(0);
  const { busy, error, run } = useAction();

  useEffect(() => {
    let alive = true;
    api.lookupFriendCode(code).then(
      (r) => alive && setLook({ state: 'ok', user: r.user, relation: r.relation, blocked: !!r.blocked }),
      (e: unknown) => {
        if (!alive) return;
        if (e instanceof ApiFail && e.code === 'not_found') setLook({ state: 'missing' });
        else setLook({ state: 'error', text: errorText(e) });
      },
    );
    return () => {
      alive = false;
    };
  }, [code, version]);

  const toFriends = (
    <Link className="btn" href="/friends">
      去好友页
    </Link>
  );
  if (look.state === 'loading') return <Panel icon="people" title="加好友"><p className="note">正在查…</p></Panel>;
  if (look.state === 'missing') {
    return (
      <Panel icon="people" title="加好友">
        <p>没有找到这个好友码，可能对方换了新的。问问对方要一个新链接。</p>
        <div className="row">{toFriends}</div>
      </Panel>
    );
  }
  if (look.state === 'error') {
    return (
      <Panel icon="people" title="加好友">
        <FormError text={look.text} />
        <div className="row">{toFriends}</div>
      </Panel>
    );
  }
  const { user, relation, blocked } = look;
  const send = () =>
    void run(async () => {
      const r = await api.sendFriendRequest(code);
      setLook({ ...look, relation: r.status === 'friends' ? 'friends' : 'pending_out' });
    });
  let body: ReactNode;
  if (relation === 'self') body = <p>这是你自己的好友码。把链接发给朋友，对方点开就能加你。</p>;
  else if (blocked) {
    body = (
      <>
        <p>你屏蔽了对方。要加好友，先解除屏蔽。</p>
        <button className="btn btn--primary" type="button" disabled={busy || !writable} onClick={() => void run(async () => (await api.unblock(user.userId), setVersion((v) => v + 1)))}>
          解除屏蔽
        </button>
      </>
    );
  } else if (relation === 'friends') body = <p className="ok">你们已经是好友了。</p>;
  else if (relation === 'pending_out') body = <p className="ok">已发送，等对方接受。</p>;
  else {
    body = (
      <>
        {relation === 'pending_in' && <p>对方也想加你为好友。</p>}
        <button className="btn btn--primary" type="button" disabled={busy || !writable} onClick={send}>
          {relation === 'pending_in' ? '接受，成为好友' : '加好友'}
        </button>
      </>
    );
  }
  return (
    <Panel icon="people" title="加好友">
      <div className="people__row people__row--big">
        <Avatar name={user.displayName} />
        <span className="people__name">{user.displayName}</span>
      </div>
      <div className="form">
        {body}
        <FormError text={error} />
      </div>
      <div className="row">{toFriends}</div>
    </Panel>
  );
}
