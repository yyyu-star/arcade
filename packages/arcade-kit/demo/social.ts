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
  if (u === '/api/invites') return new Response(JSON.stringify({ invites }), { headers: { 'content-type': 'application/json' } });
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
Object.assign(window, { social: { calls, log, went, handle, mounted: !!handle } });
