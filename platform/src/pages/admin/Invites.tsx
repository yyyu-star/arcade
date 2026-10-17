/**
 * 管理后台的"邀请码"分区（0.20.0，docs/platform-backend.md 15.20）：四个数（普通用户额度、管理员额度、有效期、每天最多生成几个）、
 * 单独给某人改额度、全站最近 100 个码和撤回。改了即时生效，不用发版。
 */
import { useEffect, useState } from 'react';
import { api, errorText, type AdminInviteCode, type AdminUser, type InviteRules, type InviteRulesState } from '../../api.ts';
import { Field, FormError, Panel, SubmitButton, useSubmit, useWritable } from '../../ui.tsx';
import { num, timeText } from './common.ts';

const KEYS = ['userQuota', 'adminQuota', 'ttlDays', 'perDay'] as const;
const TEXT: Record<keyof InviteRules, string> = {
  userQuota: '普通用户每人几个',
  adminQuota: '管理员每人几个',
  ttlDays: '码的有效期（天）',
  perDay: '每人 24 小时最多生成几个',
};

function RulesPanel() {
  const [state, setState] = useState<InviteRulesState | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState('');
  const [saved, setSaved] = useState(false);
  const writable = useWritable();
  const take = (s: InviteRulesState) => {
    setState(s);
    setDraft(Object.fromEntries(KEYS.map((k) => [k, String(s.rules[k])])));
  };
  useEffect(() => {
    let alive = true;
    api.admin.inviteRules().then(
      (r) => alive && take(r),
      (e: unknown) => alive && setLoadError(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, []);
  const changed = state ? KEYS.filter((k) => draft[k] !== String(state.rules[k])) : [];
  const bad = state
    ? changed.find((k) => {
        const v = Number(draft[k]);
        return draft[k] === '' || !Number.isSafeInteger(v) || v < state.range[k][0] || v > state.range[k][1];
      })
    : undefined;
  const { busy, error, onSubmit } = useSubmit(async () => {
    if (!state || !changed.length || bad) return;
    const body: Partial<InviteRules> = {};
    for (const k of changed) body[k] = Number(draft[k]);
    take(await api.admin.setInviteRules(body));
    setSaved(true);
  });
  return (
    <Panel icon="people" title="邀请额度">
      {loadError && <FormError text={loadError} />}
      {!state && !loadError && <p className="note">正在读取…</p>}
      {state && (
        <form className="form" onSubmit={(e) => { setSaved(false); void onSubmit(e); }} data-testid="invite-rules">
          {KEYS.map((k) => (
            <Field
              key={k}
              label={TEXT[k]}
              hint={`默认 ${num(state.defaults[k])}，能调 ${num(state.range[k][0])}–${num(state.range[k][1])}`}
              name={k}
              type="number"
              inputMode="numeric"
              min={state.range[k][0]}
              max={state.range[k][1]}
              required
              value={draft[k] ?? ''}
              onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
            />
          ))}
          <p className="note">额度 = 已用的码 + 还有效的码；过期、撤回的没用的码会还回来。改了马上生效。</p>
          <FormError text={bad && state ? `「${TEXT[bad]}」要是 ${num(state.range[bad][0])} 到 ${num(state.range[bad][1])} 的整数` : error} />
          {saved && !changed.length && <p className="ok">改好了，已经生效</p>}
          <SubmitButton busy={busy} disabled={!changed.length || !!bad || !writable}>
            {changed.length ? `保存（改 ${changed.length} 条）` : '没有改动'}
          </SubmitButton>
        </form>
      )}
    </Panel>
  );
}

/** 单独给某个人改额度：从账号列表里挑人，填数字或留空恢复默认 */
function UserQuotaPanel() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [userId, setUserId] = useState('');
  const [quota, setQuota] = useState('');
  const [done, setDone] = useState('');
  const writable = useWritable();
  useEffect(() => {
    let alive = true;
    void api.admin.users().then((r) => alive && setUsers(r.users), () => alive && setUsers([]));
    return () => {
      alive = false;
    };
  }, []);
  const { busy, error, onSubmit } = useSubmit(async () => {
    setDone('');
    const v = quota.trim() === '' ? null : Number(quota);
    const r = await api.admin.setInviteQuota(userId, v);
    const who = users?.find((u) => u.id === userId)?.displayName ?? '';
    setDone(r.custom ? `${who} 的额度改成 ${r.quota} 个` : `${who} 恢复按默认额度`);
  });
  return (
    <Panel icon="people" title="单独改额度">
      <form className="form" onSubmit={(e) => void onSubmit(e)} data-testid="invite-quota">
        <label className="field">
          <span className="field__label">谁</span>
          <select required value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">选一个账号</option>
            {(users ?? []).map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}（{u.username}）
              </option>
            ))}
          </select>
        </label>
        <Field label="额度" hint="0–1000；留空恢复按角色的默认" name="quota" type="number" inputMode="numeric" min={0} max={1000} value={quota} onChange={(e) => setQuota(e.target.value)} />
        <FormError text={error} />
        {done && <p className="ok">{done}</p>}
        <SubmitButton busy={busy} disabled={!userId || !writable}>
          保存
        </SubmitButton>
      </form>
    </Panel>
  );
}

const STATUS_TEXT: Record<AdminInviteCode['status'], string> = { unused: '没用', used: '已用', expired: '过期', revoked: '撤回' };

function CodesPanel() {
  const [status, setStatus] = useState<'all' | 'unused' | 'used'>('all');
  const [codes, setCodes] = useState<AdminInviteCode[] | null>(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    setCodes(null);
    api.admin.inviteCodes(status).then(
      (r) => alive && setCodes(r.codes),
      (e: unknown) => alive && setError(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, [status, version]);
  return (
    <Panel icon="people" title="全站的邀请码（最近 100 个）">
      <div className="seg" role="group" aria-label="看哪些">
        {(['all', 'unused', 'used'] as const).map((s) => (
          <button key={s} type="button" className={status === s ? 'seg__on' : ''} aria-pressed={status === s} onClick={() => setStatus(s)}>
            {s === 'all' ? '全部' : s === 'unused' ? '没用的' : '已用的'}
          </button>
        ))}
      </div>
      {error && <FormError text={error} />}
      {!codes && !error && <p className="note">正在读取…</p>}
      {codes && codes.length === 0 && <p className="note">还没有。</p>}
      {codes && codes.length > 0 && (
        <table className="stats-table cards-on-phone" data-testid="invite-code-table">
          <thead>
            <tr>
              <th>码</th>
              <th>谁发的</th>
              <th>状态</th>
              <th>谁用的</th>
              <th>生成于</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {codes.map((c) => (
              <tr key={c.id}>
                <td data-label="码" className="mono">{c.hint}</td>
                <td data-label="谁发的">{c.owner ? `${c.owner.displayName}（${c.owner.username}）` : '已注销'}</td>
                <td data-label="状态">{STATUS_TEXT[c.status]}</td>
                <td data-label="谁用的">{c.status === 'used' ? (c.usedBy ? `${c.usedBy.displayName}（${c.usedBy.username}）` : '已注销') : ''}</td>
                <td data-label="生成于">{timeText(c.createdAt)}</td>
                <td>{c.status === 'unused' && <RevokeButton id={c.id} onDone={() => setVersion((v) => v + 1)} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function RevokeButton({ id, onDone }: { id: string; onDone: () => void }) {
  const writable = useWritable();
  const { busy, error, onSubmit } = useSubmit(async () => {
    await api.admin.revokeInviteCode(id);
    onDone();
  });
  return (
    <>
      <button className="btn btn--small" type="button" disabled={busy || !writable} onClick={() => void onSubmit()}>
        撤回
      </button>
      <FormError text={error} />
    </>
  );
}

export function InvitesSection() {
  return (
    <div className="console__grid console__grid--2">
      <div className="console__col">
        <RulesPanel />
        <UserQuotaPanel />
      </div>
      <CodesPanel />
    </div>
  );
}
