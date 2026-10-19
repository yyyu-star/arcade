/** 账号页面共用的小部件：输入框、提交按钮的忙碌和出错状态、恢复码卡片。 */
import { useId, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from 'react';
import { errorText, type ErrorTexts } from './api.ts';
import { CoinIcon, EmptyArt, KeyIcon, LockIcon, PeopleIcon, ShieldIcon, TrophyIcon, UserIcon } from './icons.tsx';
import { useLeaveGuard } from './router.tsx';
import { useSession } from './session.tsx';

/** 输入框：标签只放标题，提示用 aria-describedby 关联，读屏时名字不会混进一长串提示。 */
export function Field({ label, hint, ...input }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <input className="field__input" id={id} aria-describedby={hint ? `${id}-hint` : undefined} {...input} />
      {hint && (
        <span className="field__hint" id={`${id}-hint`}>
          {hint}
        </span>
      )}
    </div>
  );
}

/**
 * 一个表单的提交：防重复点、出错时显示一句话。texts 按错误码换掉服务端的通用说法
 * （比如再验证时 bad_credentials 说"密码不对"，不说"用户名或密码不对"）。
 */
export function useSubmit(action: () => Promise<void>, texts?: ErrorTexts) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const onSubmit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (err) {
      setError(errorText(err, texts));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, setError, onSubmit };
}

export function FormError({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p className="form-error" role="alert">
      {text}
    </p>
  );
}

/** 只读档、停服档时写不进去，按钮直接灰掉（顶上有提示），省得点了再报错。 */
export function useWritable(): boolean {
  const { service } = useSession();
  return service === 'ok' || service === 'unreachable';
}

export function SubmitButton({ busy, children, danger = false, disabled = false }: { busy: boolean; children: ReactNode; danger?: boolean; disabled?: boolean }) {
  const writable = useWritable();
  return (
    <button className={`btn ${danger ? 'btn--danger' : 'btn--primary'}`} type="submit" aria-busy={busy} disabled={busy || disabled || !writable}>
      {busy ? '请稍等…' : children}
    </button>
  );
}

/**
 * 恢复码只给看这一次：可以复制、可以存成图片，勾上"我已经存好了"才能继续。
 * 存图用 canvas 现画，不经过服务器。
 */
export function RecoveryCodeCard({ code, username, onDone, doneText }: { code: string; username: string; onDone: () => void; doneText: string }) {
  const [saved, setSaved] = useState(false);
  const [copyState, setCopy] = useState<'idle' | 'done' | 'failed'>('idle');
  // 没勾"我已经存好了"之前，离开这一页（点别的链接、后退、刷新、关页面）都先提醒
  useLeaveGuard(saved ? null : '恢复码还没存好，离开后就再也看不到了。确定要离开吗？');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopy('done');
    } catch {
      // 剪贴板不让用（权限、老浏览器、内嵌网页）：让玩家自己选中复制
      setCopy('failed');
    }
  };

  const saveImage = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 360;
    const g = canvas.getContext('2d');
    if (!g) return;
    g.fillStyle = '#fdf6e8';
    g.fillRect(0, 0, 720, 360);
    g.strokeStyle = '#2b1d14';
    g.lineWidth = 6;
    g.strokeRect(12, 12, 696, 336);
    g.fillStyle = '#2b1d14';
    g.font = 'bold 30px system-ui, sans-serif';
    g.fillText('小游戏街机厅 · 恢复码', 48, 80);
    g.font = '22px system-ui, sans-serif';
    g.fillText(`用户名：${username}`, 48, 130);
    g.font = 'bold 40px ui-monospace, monospace';
    g.fillStyle = '#f07a3a';
    g.fillText(code, 48, 210);
    g.fillStyle = '#7a6a70';
    g.font = '20px system-ui, sans-serif';
    g.fillText('忘了密码时，凭用户名和这串码重设密码。别给别人看。', 48, 270);
    g.fillText(`${location.host} · ${new Date().toLocaleDateString('zh-CN')}`, 48, 310);
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `恢复码-${username}.png`;
    a.click();
  };

  return (
    <div className="recovery">
      <p className="recovery__lead">
        这是你的<strong>恢复码</strong>。忘了密码时，只能靠它找回账号。我们不收手机号和邮箱，它<strong>只显示这一次</strong>。
      </p>
      <p className="recovery__code" data-testid="recovery-code">
        {code}
      </p>
      <div className="row">
        <button className="btn" type="button" onClick={() => void copy()}>
          {copyState === 'done' ? '已复制' : '复制'}
        </button>
        <button className="btn" type="button" onClick={saveImage}>
          存成图片
        </button>
      </div>
      {copyState === 'failed' && (
        <p className="form-error" role="alert">
          复制不了，长按上面的码手动复制
        </p>
      )}
      <label className="check">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
        我已经存好了
      </label>
      <button className="btn btn--primary" type="button" disabled={!saved} onClick={onDone}>
        {doneText}
      </button>
    </div>
  );
}

const PANEL_ICONS = { key: KeyIcon, user: UserIcon, lock: LockIcon, people: PeopleIcon, coin: CoinIcon, trophy: TrophyIcon, shield: ShieldIcon };

/** 页面外框：标题（前面一个小图标，按这一块讲的是什么选）+ 卡片。 */
/** action：放在标题行右边的按钮（管理页概览的"管理筹码"） */
export function Panel({ title, icon, action, className, children }: { title: string; icon?: keyof typeof PANEL_ICONS; action?: ReactNode; className?: string; children: ReactNode }) {
  const Icon = icon && PANEL_ICONS[icon];
  const heading = (
    <h2 className="panel__title">
      {Icon && (
        <span className="panel__icon">
          <Icon />
        </span>
      )}
      {title}
    </h2>
  );
  return (
    <section className={className ? `panel ${className}` : 'panel'}>
      {action ? (
        <div className="panel__head">
          {heading}
          {action}
        </div>
      ) : (
        heading
      )}
      {children}
    </section>
  );
}

/** 空列表：一张小插画加一句话（排行榜、好友、战绩、流水还没有东西时） */
/** 读取中：几条灰色的占位条（0.23.0），代替"正在读取…"那一行字，读完换成内容时不跳不闪 */
export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-busy="true" aria-label="正在读取" data-testid="skeleton">
      {Array.from({ length: rows }, (_, i) => (
        <span key={i} className="skeleton__row" />
      ))}
    </div>
  );
}

export function Empty({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="empty" data-testid={testId}>
      <EmptyArt />
      <p className="note">{children}</p>
    </div>
  );
}
