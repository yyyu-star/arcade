/** 社交的演示：假平台记下每个请求；邀请一条 6 秒后过期、一条 10 分钟。冒烟由脚本读 window.social */
import { mountSocial, type Invite } from '../src/social.ts';

const t0 = Date.now();
const invites: Invite[] = [
  { id: 'soon', from: { id: 'u1', name: '老王' }, game: 'cards', room: 'ABC123', until: t0 + 6_000 },
  { id: 'later', from: { id: 'u2', name: '小李' }, game: 'other', room: 'XYZ789', until: t0 + 600_000 },
  { id: 'third', from: { id: 'u3', name: '阿明' }, game: 'cards', room: 'QQQ111', until: t0 + 600_001 },
  { id: 'here', from: { id: 'u4', name: '同桌' }, game: 'demo', room: 'ROOM01', until: t0 + 1_000 },
];
const calls: string[] = [];
const log: string[] = [];
const fake = (async (url: RequestInfo | URL, init?: RequestInit) => {
  const u = String(url);
  calls.push(`${init?.method ?? 'GET'} ${u} ${(init?.headers as Record<string, string> | undefined)?.['x-arcade'] ?? '-'}`);
  document.getElementById('log')!.textContent = calls.join('\n');
  if (u === '/api/me') return new Response(JSON.stringify({ user: { id: 'me' } }), { headers: { 'content-type': 'application/json' } });
  if (u === '/api/invites' && init?.method === 'POST') {
    const to = (JSON.parse(String(init.body)) as { to: string }).to;
    // 小李被屏蔽了（403 not_friend），阿明今天叫满了（429 等 1 小时）
    if (to === 'u2') return new Response(JSON.stringify({ error: 'not_friend' }), { status: 403, headers: { 'content-type': 'application/json' } });
    if (to === 'u3') return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '3600' } });
    return new Response(JSON.stringify({ id: `i-${to}` }), { headers: { 'content-type': 'application/json' } });
  }
  if (u === '/api/invites') return new Response(JSON.stringify({ invites }), { headers: { 'content-type': 'application/json' } });
  if (u === '/api/friends') {
    // 平台的真实形状：公开资料 + lastSeenDaysAgo + online、where
    const friends = [
      { userId: 'u1', displayName: '老王', avatar: null, lastSeenDaysAgo: 0, online: true, where: { place: 'room', game: 'cards', room: 'ABC123', seats: '3/4' } },
      { userId: 'u2', displayName: '小李', avatar: null, lastSeenDaysAgo: 0, online: true, where: { place: 'lobby' } },
      { userId: 'u4', displayName: '一个名字特别特别长的好友啊啊啊', avatar: null, lastSeenDaysAgo: 3, online: false },
      { userId: 'u3', displayName: '阿明', avatar: null, lastSeenDaysAgo: 0, online: true, where: { place: 'game', game: 'cards' } },
    ];
    return new Response(JSON.stringify({ friends, incoming: [], outgoing: [] }), { headers: { 'content-type': 'application/json' } });
  }
  const m = /^\/api\/invites\/([^/]+)\/dismiss$/.exec(u);
  if (m) {
    const i = invites.findIndex((v) => v.id === m[1]);
    if (i >= 0) invites.splice(i, 1);
  }
  return new Response(null, { status: 204 });
}) as typeof fetch;

const went: string[] = [];
const handle = await mountSocial({
  fetchImpl: fake,
  where: () => ({ place: 'room', game: 'demo', room: 'ROOM01', seats: '3/4' }),
  gameName: (id) => ({ cards: '打牌' })[id],
  onGo: (v) => went.push(`${v.game}/${v.room}`),
  log: (l) => log.push(l),
});
const openPanel = (): void => void handle?.openInvite({ game: 'demo', room: 'ROOM01', log: (l) => log.push(l) });
document.getElementById('invite')?.addEventListener('click', openPanel);
Object.assign(window, { social: { calls, log, went, handle, mounted: !!handle, openPanel } });
