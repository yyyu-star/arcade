/**
 * 管理命令行工具：邀请制下由维护者给朋友建号、重设密码，开关注册。新部署的站点没有任何账号、注册默认关着，第一个管理员也用它建。
 *
 *   npm run admin -- list
 *   npm run admin -- create <用户名> <昵称> [--admin] [--password=<密码>]
 *   npm run admin -- reset <用户名> [--new-recovery-code] [--password=<密码>]
 *   npm run admin -- registration open|close|status   开关注册（0.8.0）
 *
 * 不给 --password 时由服务器生成一个好记的密码（推荐：命令行里的密码会留在 shell 历史里）。
 * 令牌只从环境变量 ARCADE_ADMIN_TOKEN 读，不读文件、不打印。生成的密码和恢复码会打印在终端，要转给对方。
 * 站点地址必须给：--base=<地址> 或环境变量 ARCADE_BASE_URL（比如 https://game.example.com；本地 wrangler dev 是 http://localhost:5181）。
 */

interface AdminUser {
  id: string;
  username: string;
  displayName: string;
  role: 'user' | 'admin';
  createdAt: number;
  lastSeenAt: number;
}

const USAGE = `用法：
  npm run admin -- list
  npm run admin -- create <用户名> <昵称> [--admin] [--password=<密码>]
  npm run admin -- reset <用户名> [--new-recovery-code] [--password=<密码>]
  npm run admin -- registration open|close|status
令牌放在环境变量 ARCADE_ADMIN_TOKEN 里；站点地址用 --base=<地址> 或环境变量 ARCADE_BASE_URL 给（必须给）。`;

class Fail extends Error {}

function parse(argv: string[]) {
  const flags = new Map<string, string | true>();
  const args: string[] = [];
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/s.exec(a);
    if (m) flags.set(m[1]!, m[2] ?? true);
    else args.push(a);
  }
  const known = new Set(['admin', 'password', 'new-recovery-code', 'base']);
  for (const k of flags.keys()) if (!known.has(k)) throw new Fail(`不认识的选项 --${k}\n${USAGE}`);
  return { args, flags };
}

/** 接口地址：只许 https，或者本机（冒烟、本地开发）的 http；令牌不能明文发到别处。 */
function baseOf(flag: string | true | undefined): string {
  if (flag === true) throw new Fail('--base 后面要跟 =<地址>');
  const raw = flag ?? process.env.ARCADE_BASE_URL?.trim();
  if (!raw) throw new Fail(`不知道站点地址：用 --base=<地址> 或环境变量 ARCADE_BASE_URL 给，比如 https://game.example.com\n${USAGE}`);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Fail('--base 不是一个网址');
  }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Fail('--base 只能是 https 地址，或者本机的 http://localhost');
  return url.origin;
}

async function main(): Promise<void> {
  const { args, flags } = parse(process.argv.slice(2));
  const token = process.env.ARCADE_ADMIN_TOKEN?.trim();
  if (!token) throw new Fail('没有令牌：先把 ARCADE_ADMIN_TOKEN 放进环境变量（值不要写在命令行里）');
  // 和服务端的请求头格式一样：只许可见 ASCII。含换行等字符时 fetch 的报错会带上整个请求头，所以先挡住，也不回显原文
  if (!/^[\x21-\x7e]{1,256}$/.test(token)) throw new Fail('令牌格式不对（只能是 1–256 个可见 ASCII 字符），检查 ARCADE_ADMIN_TOKEN');
  const base = baseOf(flags.get('base'));
  const password = flags.get('password');
  if (password === true) throw new Fail('--password 后面要跟 =<密码>');

  const call = async <T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> => {
    let res: Response;
    try {
      res = await fetch(`${base}${path}`, {
        method,
        headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      // 只给错误类型：底层报错的原文可能带着请求头（也就是令牌）
      throw new Fail(`连不上 ${base}（${e instanceof Error ? e.name : '未知错误'}）`);
    }
    const text = await res.text();
    let data: Record<string, unknown> = {};
    try {
      data = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      throw new Fail(`${res.status}：回来的不是接口的 JSON（可能被网关拦了）`);
    }
    if (!res.ok) {
      const hint = res.status === 401 ? '（令牌不对，或者线上还没设 ADMIN_TOKEN）' : '';
      const code = typeof data.error === 'string' ? data.error : '';
      const msg = typeof data.message === 'string' ? data.message : '出错了';
      throw new Fail(`${res.status} ${code}：${msg}${hint}`);
    }
    return data as T;
  };

  const findUser = async (username: string): Promise<AdminUser> => {
    const { users } = await call<{ users: AdminUser[] }>('GET', '/api/admin/users');
    // 和服务端 normalizeUsername 一样：NFKC 再转小写（全角字母也能找到）
    const want = username.trim().normalize('NFKC').toLowerCase();
    const u = users.find((x) => x.username === want);
    if (!u) throw new Fail(`没有用户名为 ${want} 的账号（列表最多 500 条）`);
    return u;
  };

  /** 发给对方的一段话，和管理界面"复制成一段话"一样。 */
  const message = (username: string, pw: string, recoveryCode?: string) =>
    [
      `游戏地址：${base}`,
      `用户名：${username}`,
      `密码：${pw}`,
      ...(recoveryCode ? [`恢复码：${recoveryCode}（忘了密码时用它找回，存好，别给别人看）`] : []),
      '登录后可以在"我的账号"改密码。',
      ...(recoveryCode ? ['恢复码是聊天发给你的，登录后可以在"我的账号"换一个新的。'] : []),
    ].join('\n');

  const [cmd, ...rest] = args;
  if (cmd === 'list' && rest.length === 0) {
    const { users } = await call<{ users: AdminUser[] }>('GET', '/api/admin/users');
    const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
    console.log(`共 ${users.length} 个账号（新的在前）：`);
    for (const u of users) {
      const seen = u.lastSeenAt > u.createdAt ? `${day(u.lastSeenAt)} 来过` : '还没来过';
      console.log(`  ${u.username}\t${u.displayName}\t${u.role === 'admin' ? '管理员' : '普通'}\t${day(u.createdAt)} 建\t${seen}`);
    }
    return;
  }
  if (cmd === 'create' && rest.length === 2) {
    const [username, displayName] = rest as [string, string];
    const r = await call<{ user: AdminUser; password?: string; recoveryCode: string }>('POST', '/api/admin/users', {
      username,
      displayName,
      ...(typeof password === 'string' ? { password } : {}),
      ...(flags.get('admin') === true ? { role: 'admin' } : {}),
    });
    const pw = r.password ?? (password as string);
    console.log(`建好了${r.user.role === 'admin' ? '（管理员）' : ''}：${r.user.displayName}\n\n${message(r.user.username, pw, r.recoveryCode)}`);
    return;
  }
  if (cmd === 'reset' && rest.length === 1) {
    const u = await findUser(rest[0]!);
    const r = await call<{ password?: string; recoveryCode?: string }>('POST', `/api/admin/users/${u.id}/password`, {
      ...(typeof password === 'string' ? { password } : {}),
      newRecoveryCode: flags.get('new-recovery-code') === true,
    });
    const pw = r.password ?? (password as string);
    console.log(`重设好了：${u.displayName}（所有设备都已退出）\n\n${message(u.username, pw, r.recoveryCode)}`);
    return;
  }
  if (cmd === 'registration' && rest.length === 1 && ['open', 'close', 'status'].includes(rest[0]!)) {
    interface State {
      open: boolean;
      switchOpen: boolean;
      forcedOff: boolean;
      updatedAt: number | null;
    }
    const path = '/api/admin/settings/registration';
    const s = rest[0] === 'status' ? await call<State>('GET', path) : await call<State>('POST', path, { open: rest[0] === 'open' });
    const when = s.updatedAt ? `（上次改动 ${new Date(s.updatedAt).toLocaleString('zh-CN', { hour12: false })}）` : '（还没改过，默认关着）';
    console.log(`注册现在：${s.open ? '开放' : '关着'}${when}`);
    if (s.forcedOff) console.log(`服务器总闸 REGISTRATION 不是 "switch"，开关暂时不起作用；开关上记的是"${s.switchOpen ? '打开' : '关闭'}"。`);
    return;
  }
  throw new Fail(USAGE);
}

main().catch((e: unknown) => {
  console.error(e instanceof Fail ? e.message : e);
  process.exitCode = 1;
});
