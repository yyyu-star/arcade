/**
 * /admin：管理界面（0.11.0 起是控制台布局）。电脑上左边分区导航、右边内容，手机上导航在顶上一排；分区记在地址的 ?s= 里，后退能回来。
 * - 概览：顶上一排数字卡片、近 7 天趋势图、各游戏今天的情况、"管理筹码"入口；
 * - 用户：建号，左边账号列表、右边选中那个人的钱包、战绩、流水和操作（手机上点进去看）；
 * - 钱包统计：全站筹码每天一行；
 * - 邀请码（0.20.0）：四个数、单独改额度、全站的码和撤回；
 * - 设置：大厅公告、开放注册、钱包规则。
 * 只有管理员看得到入口；接口另有服务端检查（worker/api/admin.ts），这里挡人只是不让普通用户看到空页面。
 * 管理员账号本身在这里动不了（接口也不许），要用管理命令行工具。
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, navigate, useLeaveGuard, useLocation } from '../router.tsx';
import { useSession } from '../session.tsx';
import { Panel, Skeleton } from '../ui.tsx';
import type { Credentials } from './admin/common.ts';
import { InvitesSection } from './admin/Invites.tsx';
import { Overview } from './admin/Overview.tsx';
import { NoticePanel, RegistrationSwitch, WalletRulesPanel } from './admin/Settings.tsx';
import { UserList } from './admin/Users.tsx';
import { WalletStats } from './admin/WalletStats.tsx';
import './admin/admin.css';

const SECTIONS = [
  ['overview', '概览'],
  ['users', '用户'],
  ['stats', '钱包统计'],
  ['invites', '邀请码'],
  ['settings', '设置'],
] as const;
type Section = (typeof SECTIONS)[number][0];

export function AdminPage() {
  const { loading, user, service } = useSession();
  const loc = useLocation();
  const allowed = !!user?.isAdmin;
  const [card, setCard] = useState<Credentials | null>(null);
  // 列表在建号、删号后重读
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const asked = loc.searchParams.get('s');
  const section: Section = SECTIONS.some(([id]) => id === asked) ? (asked as Section) : 'overview';

  useEffect(() => {
    // 停服、连不上时读不到账号，不算"不是管理员"，别把人赶走
    if (!loading && service !== 'off' && service !== 'unreachable' && !allowed) navigate('/', true);
  }, [loading, service, allowed]);

  if (loading) return <Panel icon="shield" title="管理"><Skeleton rows={3} /></Panel>;
  if (service === 'off' || service === 'unreachable') return <Panel icon="shield" title="管理"><p className="note">现在连不上账号服务，过一会儿再来。</p></Panel>;
  if (!allowed) return null;
  if (card) {
    return (
      <div className="console__single">
        <Panel title={card.title}>
          <CredentialCard card={card} onDone={() => setCard(null)} />
        </Panel>
      </div>
    );
  }
  return (
    <div className="console">
      <nav className="console__nav" aria-label="管理分区">
        {SECTIONS.map(([id, label]) => (
          <Link key={id} href={id === 'overview' ? '/admin' : `/admin?s=${id}`} className={section === id ? 'console__on' : ''} aria-current={section === id ? 'page' : undefined}>
            {label}
          </Link>
        ))}
      </nav>
      <div className="console__main" data-testid={`admin-${section}`}>
        {service === 'readonly' && <p className="banner">服务器有点忙，现在只能看、不能改，明天再来。</p>}
        {section === 'overview' && <Overview />}
        {section === 'users' && (
          <UserList version={version} selfId={user!.id} onCard={setCard} onChanged={reload} />
        )}
        {section === 'stats' && <WalletStats />}
        {section === 'invites' && <InvitesSection />}
        {section === 'settings' && (
          <div className="console__grid console__grid--2">
            <div className="console__col">
              <NoticePanel />
              <RegistrationSwitch />
            </div>
            <WalletRulesPanel />
          </div>
        )}
      </div>
    </div>
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
