/** /forgot：用户名 + 恢复码重设密码。成功后旧恢复码作废、别的设备都退出，给一串新恢复码。 */
import { useState } from 'react';
import { api } from '../api.ts';
import { Link, navigate } from '../router.tsx';
import { useSession } from '../session.tsx';
import { Field, FormError, Panel, RecoveryCodeCard, SubmitButton, useSubmit } from '../ui.tsx';

export function ForgotPage() {
  const { setUser } = useSession();
  const [username, setUsername] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [fresh, setFresh] = useState<{ code: string; username: string } | null>(null);
  const { busy, error, onSubmit } = useSubmit(async () => {
    const r = await api.recover(username, code, password);
    setUser(r.user);
    setFresh({ code: r.recoveryCode, username: r.user.username });
  }, { bad_credentials: '用户名或恢复码不对' });

  if (fresh) {
    return (
      <Panel icon="key" title="密码改好了">
        <p className="note">旧的恢复码不能用了，别的设备也都退出了。下面是新的恢复码：</p>
        <RecoveryCodeCard code={fresh.code} username={fresh.username} doneText="回首页" onDone={() => navigate('/')} />
      </Panel>
    );
  }
  return (
    <Panel icon="key" title="忘了密码">
      <form className="form" onSubmit={onSubmit}>
        <p className="note">输入用户名和注册时拿到的恢复码，设一个新密码。</p>
        <Field label="用户名" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required value={username} onChange={(e) => setUsername(e.target.value)} />
        <Field label="恢复码" hint="20 位字母和数字，横线可有可无" name="recoveryCode" autoComplete="off" autoCapitalize="characters" spellCheck={false} required value={code} onChange={(e) => setCode(e.target.value)} />
        <Field label="新密码" hint="至少 8 位，别用常见密码" name="newPassword" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <FormError text={error} />
        <SubmitButton busy={busy}>重设密码</SubmitButton>
        <p className="note">
          恢复码也丢了？那就找不回来了，只能 <Link href="/login?tab=register">重新注册</Link>。
        </p>
      </form>
    </Panel>
  );
}
