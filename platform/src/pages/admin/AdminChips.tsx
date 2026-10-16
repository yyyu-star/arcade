/**
 * 管理页里的"管理筹码"小窗口（0.9.4，维护者给朋友加减筹码）：只有管理员看得到。
 * 查人 → 填数量（正数加、负数扣）和备注 → 确认一次 → 显示新余额；下面列全站最近 10 次调整。
 * 规则在服务端（worker/api/wallet.ts 的 admin 一步）：扣到 0 为止、不碰桌上那一份；单次上限管理员可调（钱包规则），超了服务端回的文案里带着现在的数。
 */
import { useEffect, useState, type FormEvent } from 'react';
import { api, errorText, type AdminAdjust, type Wallet } from '../../api.ts';
import { num, signed, timeText } from '../../format.ts';
import { FormError } from '../../ui.tsx';


/** "管理筹码"按钮，点了弹小窗口。只放在 /admin 最上面（维护者 0.9.7：外面重复了，只留管理页里的） */
export function AdminChipsButton({ className }: { className: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className} type="button" onClick={() => setOpen(true)} data-testid="admin-chips-open">
        管理筹码
      </button>
      {open && <ChipsDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function ChipsDialog({ onClose }: { onClose: () => void }) {
  const [username, setUsername] = useState('');
  const [found, setFound] = useState<{ username: string; displayName: string; wallet: Wallet } | null>(null);
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [recent, setRecent] = useState<AdminAdjust[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const loadRecent = () =>
    api.admin.recentAdjustments().then(
      (r) => setRecent(r.recent),
      () => setRecent([]),
    );
  useEffect(() => {
    void loadRecent();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(errorText(e, { not_found: '没有这个用户名' }));
    } finally {
      setBusy(false);
    }
  };

  const lookup = (e: FormEvent) => {
    e.preventDefault();
    setDone('');
    void run(async () => {
      setFound(null);
      const r = await api.admin.walletOf(username.trim());
      setFound({ ...r.user, wallet: r.wallet });
    });
  };

  const adjust = (e: FormEvent) => {
    e.preventDefault();
    if (!found) return;
    const n = Number(amount.replace(/[,，\s]/g, ''));
    if (!Number.isSafeInteger(n) || n === 0) return setError('数量要是非零整数，正数加、负数扣');
    if (!window.confirm(`给 ${found.displayName}（${found.username}）${n > 0 ? '加' : '扣'} ${num(Math.abs(n))}？`)) return;
    void run(async () => {
      const r = await api.admin.adjust(found.username, n, note.trim());
      setFound({ ...found, wallet: r.wallet });
      setDone(`${r.credited > 0 ? '加了' : '扣了'} ${num(Math.abs(r.credited))}，现在余额 ${num(r.wallet.balance)}`);
      setAmount('');
      setNote('');
      void loadRecent();
    });
  };

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="管理筹码" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__box" data-testid="admin-chips">
        <div className="modal__head">
          <h2>管理筹码</h2>
          <button className="btn btn--small" type="button" onClick={onClose}>
            关闭
          </button>
        </div>
        <form className="modal__row" onSubmit={lookup}>
          <input className="field__input" placeholder="用户名" aria-label="用户名" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
          <button className="btn" type="submit" disabled={busy || !username.trim()}>
            查
          </button>
        </form>
        {found && (
          <>
            <p className="modal__who">
              <strong>{found.displayName}</strong>（{found.username}）余额 <strong data-testid="admin-chips-balance">{num(found.wallet.balance)}</strong>
              {found.wallet.fresh && '（还没用过钱包，调整时先送新号的 10,000）'}
              {found.wallet.stakes.length > 0 && `；桌上还有 ${num(found.wallet.stakes.reduce((a, s) => a + s.amount, 0))}（不受调整影响）`}
            </p>
            <form className="modal__form" onSubmit={adjust}>
              <input className="field__input" inputMode="numeric" placeholder="数量：5000 是加，-5000 是扣" aria-label="数量" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <input className="field__input" placeholder="备注（可不填），比如：同学测试" aria-label="备注" maxLength={40} value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn btn--primary" type="submit" disabled={busy || !amount.trim()}>
                确认
              </button>
            </form>
          </>
        )}
        {done && <p className="modal__done">{done}</p>}
        <FormError text={error} />
        <h3>最近 10 次调整</h3>
        {recent === null ? (
          <p className="note">正在读取…</p>
        ) : recent.length === 0 ? (
          <p className="note">还没有调整过。</p>
        ) : (
          <ul className="adjusts" data-testid="admin-chips-recent">
            {recent.map((r, i) => (
              <li key={i}>
                <span>{timeText(r.at)}</span> <strong>{r.displayName ?? r.username}</strong> <span className={r.amount > 0 ? 'plus' : 'minus'}>{signed(r.amount)}</span>
                {r.note && <span className="note"> · {r.note}</span>}
                <span className="note"> · {r.by}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
