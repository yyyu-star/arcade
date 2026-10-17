/** 管理页：全站设置，大厅公告、开放注册、钱包规则。 */
import { useEffect, useState } from 'react';
import { api, errorText, type NoticeState, type RegistrationState, type WalletRules, type WalletRulesState } from '../../api.ts';
import { Field, FormError, Panel, Skeleton, SubmitButton, useSubmit, useWritable } from '../../ui.tsx';
import { num, timeText } from './common.ts';

/** 大厅公告（0.10.8）：发了以后登录的人在大厅顶上看到，别的服务器最多晚 30 秒 */
export function NoticePanel() {
  const [state, setState] = useState<NoticeState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [text, setText] = useState('');

  useEffect(() => {
    let alive = true;
    api.admin.notice().then(
      (r) => {
        if (!alive) return;
        setState(r);
        setText(r.notice?.text ?? '');
      },
      (e: unknown) => alive && setLoadError(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, []);

  const len = Array.from(text.trim()).length;
  const tooLong = state ? len > state.max : false;
  const publish = useSubmit(async () => {
    if (!text.trim()) return;
    const r = await api.admin.setNotice(text);
    setState(r);
    setText(r.notice?.text ?? '');
  });
  const writable = useWritable();
  const takeDown = useSubmit(async () => {
    if (!window.confirm('撤下以后大厅就不显示了，确定吗？')) return;
    setState(await api.admin.setNotice(''));
    setText('');
  });

  return (
    <Panel icon="shield" title="大厅公告">
      {loadError && <FormError text={loadError} />}
      {!state && !loadError && <Skeleton rows={3} />}
      {state && (
        <form className="form" onSubmit={publish.onSubmit} data-testid="notice-admin">
          <p className={state.notice ? 'ok' : 'note'} role="status">
            {state.notice ? `现在挂着：${state.notice.by} 在 ${timeText(state.notice.at)} 发的` : '现在没有公告'}
          </p>
          <Field
            label="公告内容"
            hint={tooLong ? `太长了，最多 ${state.max} 个字（现在 ${len}）` : `登录的人在大厅最上面看到，一行就好；最多 ${state.max} 个字`}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <FormError text={publish.error || takeDown.error} />
          <SubmitButton busy={publish.busy} disabled={!text.trim() || tooLong || text.trim() === state.notice?.text}>
            {state.notice ? '换成这条' : '发布'}
          </SubmitButton>
          {state.notice && (
            <button className="btn btn--danger" type="button" disabled={takeDown.busy || !writable} onClick={() => void takeDown.onSubmit()}>
              撤下公告
            </button>
          )}
        </form>
      )}
    </Panel>
  );
}

/** 开放注册的开关：切换前确认一次；服务器总闸关着时按钮置灰并说明原因，不会显示"开着"却注册不了。 */
export function RegistrationSwitch() {
  const [state, setState] = useState<RegistrationState | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let alive = true;
    api.admin.registration().then(
      (r) => alive && setState(r),
      (e: unknown) => alive && setLoadError(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, []);

  const next = !state?.switchOpen;
  const { busy, error, onSubmit } = useSubmit(async () => {
    const ask = next
      ? '打开注册以后，任何人都能在登录页自己注册账号。确定打开吗？'
      : '关闭注册以后，新的人就注册不了了，已有的账号不受影响。确定关闭吗？';
    if (!window.confirm(ask)) return;
    setState(await api.admin.setRegistration(next));
  });

  return (
    <Panel icon="shield" title="开放注册">
      {loadError && <FormError text={loadError} />}
      {!state && !loadError && <Skeleton rows={3} />}
      {state && (
        <form className="form" onSubmit={onSubmit} data-testid="registration-switch">
          <p className={state.open ? 'ok' : 'note'} role="status">
            {state.open ? '现在：开放注册，谁都能自己注册' : '现在：只邀请，账号只能在这里建'}
          </p>
          <p className="note">{state.updatedAt ? `上次改动：${timeText(state.updatedAt)}` : '还没改过（默认关着）'}</p>
          {state.forcedOff && (
            <p className="note">
              服务器上的注册总闸关着，这个开关暂时不起作用{state.switchOpen ? '（开关记的是"打开"，总闸放开后才生效）' : ''}。要放开总闸得改部署配置，找维护者。
            </p>
          )}
          <FormError text={error} />
          <SubmitButton busy={busy} danger={!next} disabled={state.forcedOff}>
            {next ? '打开注册' : '关闭注册'}
          </SubmitButton>
        </form>
      )}
    </Panel>
  );
}

const RULE_TEXT: Record<keyof WalletRules, { label: string; hint: string }> = {
  reliefTo: { label: '每日补给补到', hint: '钱包加桌上的不到这个数时，每天能领一次，补到这个数；0 就是不发补给' },
  winUnits: { label: '单机实盘每天最多赢几份', hint: '每个游戏单算，份按当天带上桌最多的那一份（不超过档位的一份）；好友房不限' },
  newBalance: { label: '新号送多少', hint: '只管以后第一次用钱包的人，已有的钱包不变' },
  adminAdjustMax: { label: '管理员单次最多加减', hint: '防手滑多打几个 0' },
};
const RULE_KEYS = Object.keys(RULE_TEXT) as (keyof WalletRules)[];

/** 钱包规则（0.10.6）：改了即时生效，不用发版；别的服务器实例最多晚 30 秒跟上。每次改动都有记录。 */
export function WalletRulesPanel() {
  const [state, setState] = useState<WalletRulesState | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loadError, setLoadError] = useState('');
  const [saved, setSaved] = useState(false);
  const writable = useWritable();
  const take = (s: WalletRulesState) => {
    setState(s);
    setDraft(Object.fromEntries(RULE_KEYS.map((k) => [k, String(s.rules[k])])));
  };
  useEffect(() => {
    let alive = true;
    api.admin.walletRules().then(
      (r) => alive && take(r),
      (e: unknown) => alive && setLoadError(errorText(e)),
    );
    return () => {
      alive = false;
    };
  }, []);
  const changed = state ? RULE_KEYS.filter((k) => draft[k] !== String(state.rules[k])) : [];
  // 边输边查：不合格的直接说，不发请求
  const bad = state
    ? changed.find((k) => {
        const v = Number(draft[k]);
        return draft[k] === '' || !Number.isSafeInteger(v) || v < state.range[k][0] || v > state.range[k][1];
      })
    : undefined;
  const { busy, error, onSubmit } = useSubmit(async () => {
    if (!state || !changed.length || bad) return;
    const body: Partial<WalletRules> = {};
    for (const k of changed) body[k] = Number(draft[k]);
    const lines = changed.map((k) => `${RULE_TEXT[k].label}：${num(state.rules[k])} → ${num(body[k]!)}`).join('\n');
    if (!window.confirm(`马上对所有人生效：\n${lines}\n确定吗？`)) return;
    take(await api.admin.setWalletRules(body));
    setSaved(true);
  });
  return (
    <Panel icon="coin" title="钱包规则">
      {loadError && <FormError text={loadError} />}
      {!state && !loadError && <Skeleton rows={3} />}
      {state && (
        <form className="form" onSubmit={(e) => { setSaved(false); void onSubmit(e); }} data-testid="wallet-rules">
          {RULE_KEYS.map((k) => (
            <Field
              key={k}
              label={RULE_TEXT[k].label}
              hint={`${RULE_TEXT[k].hint}。默认 ${num(state.defaults[k])}`}
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
          <FormError text={bad && state ? `「${RULE_TEXT[bad].label}」要是 ${num(state.range[bad][0])} 到 ${num(state.range[bad][1])} 的整数` : error} />
          {saved && !changed.length && <p className="ok">改好了，已经生效</p>}
          <SubmitButton busy={busy} disabled={!changed.length || !!bad || !writable}>
            {changed.length ? `保存（改 ${changed.length} 条）` : '没有改动'}
          </SubmitButton>
          {state.log.length > 0 && (
            <details className="fold">
              <summary>改动记录（{state.log.length}）</summary>
              <ul className="rules-log" data-testid="rules-log">
                {state.log.map((l) => (
                  <li key={l.at}>
                    {timeText(l.at)} {l.by}：
                    {Object.entries(l.changes)
                      .map(([k, [from, to]]) => `${RULE_TEXT[k as keyof WalletRules].label} ${num(from)} → ${num(to)}`)
                      .join('；')}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </form>
      )}
    </Panel>
  );
}
