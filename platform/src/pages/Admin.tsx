/**
 * /admin：管理界面。今日概况（0.10.7）、大厅公告（0.10.8）、开关注册（0.8.0）、钱包规则（0.10.6）、给朋友建号、重设密码、删号（维护者 2026-10-14 定）、
 * 账号的钱包和战绩（0.10.7）、筹码统计（0.9.0）。
 * 只有管理员看得到入口；接口另有服务端检查（worker/api/admin.ts），这里挡人只是不让普通用户看到空页面。
 * 管理员账号本身在这里动不了（接口也不许），要用管理命令行工具。
 * 这里只排版和显示建号后的账号卡片，各块在 admin/ 下：概况 Overview、设置 Settings、账号 Users、筹码统计 WalletStats。
 */
import { useCallback, useEffect, useState } from 'react';
import { navigate, useLeaveGuard } from '../router.tsx';
import { useSession } from '../session.tsx';
import { Panel } from '../ui.tsx';
import { AdminChipsButton } from './admin/AdminChips.tsx';
import type { Credentials } from './admin/common.ts';
import { Overview } from './admin/Overview.tsx';
import { NoticePanel, RegistrationSwitch, WalletRulesPanel } from './admin/Settings.tsx';
import { CreateUser, UserList } from './admin/Users.tsx';
import { WalletStats } from './admin/WalletStats.tsx';

export function AdminPage() {
  const { loading, user, service } = useSession();
  const allowed = !!user?.isAdmin;
  const [card, setCard] = useState<Credentials | null>(null);
  // 列表在建号、删号后重读
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    // 停服、连不上时读不到账号，不算"不是管理员"，别把人赶走
    if (!loading && service !== 'off' && service !== 'unreachable' && !allowed) navigate('/', true);
  }, [loading, service, allowed]);

  if (loading) return <Panel title="管理"><p className="note">正在读取…</p></Panel>;
  if (service === 'off' || service === 'unreachable') return <Panel title="管理"><p className="note">现在连不上账号服务，过一会儿再来。</p></Panel>;
  if (!allowed) return null;
  if (card) {
    return (
      <Panel title={card.title}>
        <CredentialCard card={card} onDone={() => setCard(null)} />
      </Panel>
    );
  }
  return (
    <>
      {service === 'readonly' && <p className="banner">服务器有点忙，现在只能看、不能改，明天再来。</p>}
      <Overview />
      <Panel title="筹码">
        <div className="admin-entry">
          <AdminChipsButton className="btn btn--primary" />
          <span className="note">给人加减筹码（正数加、负数扣），有记录。</span>
        </div>
      </Panel>
      <NoticePanel />
      <RegistrationSwitch />
      <WalletRulesPanel />
      <CreateUser
        onDone={(c) => {
          setCard(c);
          reload();
        }}
      />
      <UserList version={version} selfId={user!.id} onCard={setCard} onChanged={reload} />
      <WalletStats />
    </>
  );
}

/** 要发给朋友的一段话：游戏地址、用户名、密码、恢复码。 */
function messageOf(c: Credentials): string {
  return [
    `游戏地址：${location.origin}`,
    `用户名：${c.username}`,
    `密码：${c.password}`,
    ...(c.recoveryCode ? [`恢复码：${c.recoveryCode}（忘了密码时用它找回，存好，别给别人看）`] : []),
    '登录后可以在"我的账号"改密码。',
    // 恢复码经过聊天记录，对方最好换一个只有自己知道的
    ...(c.recoveryCode ? ['恢复码是聊天发给你的，登录后可以在"我的账号"换一个新的。'] : []),
  ].join('\n');
}

/**
 * 密码和恢复码只显示这一次：复制成一段话发给朋友，勾上"已经发出去了"才能关掉。
 * 没勾之前离开这一页（点别的链接、后退、刷新、关页面）都先提醒，和恢复码卡片一样。
 */
function CredentialCard({ card, onDone }: { card: Credentials; onDone: () => void }) {
  const [sent, setSent] = useState(false);
  const [copyState, setCopy] = useState<'idle' | 'done' | 'failed'>('idle');
  const text = messageOf(card);
  useLeaveGuard(sent ? null : '账号和密码还没发出去，离开后就再也看不到了。确定要离开吗？');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopy('done');
    } catch {
      setCopy('failed');
    }
  };

  return (
    <div className="recovery">
      <p className="recovery__lead">
        下面这些<strong>只显示这一次</strong>，复制后发给对方。对方登录后可以自己改密码。
      </p>
      <dl className="facts">
        <dt>用户名</dt>
        <dd className="mono" data-testid="cred-username">{card.username}</dd>
        <dt>密码</dt>
        <dd className="mono" data-testid="cred-password">{card.password}</dd>
        {card.recoveryCode && (
          <>
            <dt>恢复码</dt>
            <dd className="mono" data-testid="cred-recovery">{card.recoveryCode}</dd>
          </>
        )}
      </dl>
      <pre className="message" data-testid="cred-message">{text}</pre>
      <div className="row">
        <button className="btn" type="button" onClick={() => void copy()}>
          {copyState === 'done' ? '已复制' : '复制成一段话'}
        </button>
      </div>
      {copyState === 'failed' && (
        <p className="form-error" role="alert">
          复制不了，长按上面那段话手动复制
        </p>
      )}
      <label className="check">
        <input type="checkbox" checked={sent} onChange={(e) => setSent(e.target.checked)} />
        已经发给对方了（或者记下来了）
      </label>
      <button className="btn btn--primary" type="button" disabled={!sent} onClick={onDone}>
        好了
      </button>
    </div>
  );
}
