/**
 * 好友房的大厅（DOM 层，输房间码用原生输入框，手机上好打字）：开房、输码进房、选座、房主开局；牌桌上的"重连中"横条。
 * 标题页一直有"好友房"（0.3.0 起）；?online=1 启动后直接打开这个面板（平台大厅的入口）。房间、牌局都在服务端，这里只发意图、照房间的信息画。
 * 每天的额度（arcade-kit 0.2.0）：已经有房间给"回到房间"，今天开房次数用完、今天人太多都说成一句话，单机照常。
 * 快速匹配（0.26.0，kit 0.20.0 的 MatchClient，设计在 kit 的 docs/match.md）：排队也画在这张卡上；排到了照好友房进房，只是不给房间码、邀请、开局。
 */
import { MATCH_TEXT, MatchClient, type MatchSoloWhy } from 'arcade-kit/client';
import { CLOSE } from 'arcade-kit/protocol';
import { app } from './app.ts';
import { NetSession, createRoom, errorText, forgetRoom, isFinalForRoom, myRoom, roomInUrl, savedRoom } from './net.ts';
import { MATCH_PATH, matchTierOf } from '../net/match.ts';
import { parseRoomOpts } from '../net/stake.ts';
import { ROOM_DEALS, TIERS, TIER_IDS, pointValue, type TierId } from '../stake/index.ts';
import { ROOM_STAKE_TEXT, STAKE_TEXT, TIER_NAME, fmtChips } from './stake-text.ts';
import { fetchWallet } from './stake.ts';
import { standalone, withNick } from './platform.ts';
import { openInvitePanel, presenceNow } from './social.ts';
import { getNick, setNick } from './store.ts';
import { loginUrl } from './ui/cloud.ts';
import { mountThemeCss } from './theme.ts';

const TEAM = ['#d9443a', '#3a78c8'];

let root: HTMLElement | null = null;
let ses: NetSession | null = null;
let offSes: (() => void) | null = null;
let note = '';

function style(): void {
  mountThemeCss();
  if (document.getElementById('online-style')) return;
  const st = document.createElement('style');
  st.id = 'online-style';
  st.textContent = `
#online { position: fixed; inset: 0; z-index: 8500; display: flex; align-items: center; justify-content: center; background: rgba(10, 6, 4, 0.72);
  font: 16px/1.5 var(--gd-font); color: var(--gd-ink); font-variant-numeric: tabular-nums;
  padding: env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px); box-sizing: border-box; }
#online .ol-card { width: min(560px, calc(100vw - var(--gd-s6))); max-height: calc(100% - var(--gd-s4)); overflow: auto; box-sizing: border-box; padding: var(--gd-s4) var(--gd-s6);
  border-radius: var(--gd-r-lg); background: var(--gd-paper); border: 6px solid var(--gd-wood);
  box-shadow: 0 0 0 2px var(--gd-gold) inset, 0 0 0 7px var(--gd-paper) inset, 0 0 0 8px #d8c39a inset, 0 12px 32px rgba(0, 0, 0, 0.45);
  display: flex; flex-direction: column; gap: var(--gd-s3); }
/* 标题做成和画布里弹窗一样的红飘带（art-v3） */
#online h2 { align-self: center; margin: 0 0 var(--gd-s1); padding: var(--gd-s1) var(--gd-s8); font-size: 22px; line-height: 1.3; color: #ffe9c2;
  background: linear-gradient(#c8323a, #8a1a20); border: 2px solid var(--gd-gold); border-radius: var(--gd-r-sm); box-shadow: var(--gd-shadow); letter-spacing: 2px; }
#online .ol-code { font: bold 34px/1.1 var(--gd-font-num); letter-spacing: 6px; color: var(--gd-red); }
#online .ol-row { display: flex; gap: var(--gd-s2); flex-wrap: wrap; align-items: center; }
#online input { flex: 1; min-width: 120px; min-height: var(--gd-hit); box-sizing: border-box; padding: 0 var(--gd-s3); border: 2px solid #c8a878; border-radius: var(--gd-r-md);
  font: bold 22px var(--gd-font-num); letter-spacing: 4px; background: #fffaf0; color: var(--gd-ink); }
#online input:focus-visible { outline: 3px solid var(--gd-focus); outline-offset: 1px; }
#online .ol-seats { display: grid; grid-template-columns: 1fr 1fr; gap: var(--gd-s2); }
#online .ol-seat { display: flex; align-items: center; justify-content: space-between; gap: var(--gd-s2); min-height: 52px; min-width: 0; padding: var(--gd-s1) var(--gd-s2) var(--gd-s1) var(--gd-s3);
  border-radius: var(--gd-r-md); background: #f1e4c6; border-left: 6px solid var(--team); }
#online .ol-seat > div { min-width: 0; overflow: hidden; }
#online .ol-seat b { display: block; font-size: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#online .ol-seat small { display: block; color: var(--gd-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#online .ol-seat .gd-btn, #online #ol-tiers .gd-btn { flex: none; padding: 0 var(--gd-s3); font-size: 15px; }
#online .ol-note { min-height: 1.5em; color: var(--gd-red-dark); font-weight: bold; }
#online .ol-tip { color: var(--gd-muted); font-size: 14px; }
#online .ol-wait { font: bold 20px/1.4 var(--gd-font); text-align: center; }
#online .ol-stake { padding: var(--gd-s1) var(--gd-s3); border-radius: var(--gd-r-sm); background: #f6dcc8; color: var(--gd-red-dark); font-weight: bold; }
#net-banner { position: fixed; z-index: 8400; left: 50%; top: max(var(--gd-s2), env(safe-area-inset-top, 0px)); transform: translateX(-50%); display: none;
  padding: var(--gd-s2) var(--gd-s4); border-radius: var(--gd-r-pill); background: rgba(43, 22, 10, 0.92); border: 2px solid var(--gd-gold); color: #ffe9c2;
  font: bold 15px/1.3 var(--gd-font); pointer-events: none; }
#net-banner.on { display: block; }`;
  document.head.appendChild(st);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text) e.textContent = text;
  return e;
}

/** 面板里的按钮都用 THEME_CSS 的 .gd-btn；cls 是 gd-2（次要）、gd-big（大号确认） */
function button(label: string, onClick: () => void, cls = '', id = ''): HTMLButtonElement {
  const b = el('button', { type: 'button', class: cls ? `gd-btn ${cls}` : 'gd-btn', ...(id ? { id } : {}) }, label);
  b.addEventListener('click', onClick);
  return b;
}

function card(): HTMLElement {
  style();
  if (!root) {
    root = el('div', { id: 'online' });
    document.body.appendChild(root);
  }
  root.replaceChildren();
  const c = el('div', { class: 'ol-card' });
  root.appendChild(c);
  return c;
}

function close(): void {
  stopMatch();
  root?.remove();
  root = null;
}

function noteEl(): HTMLElement {
  return el('div', { class: 'ol-note', id: 'ol-note' }, note);
}

/** 好友房入口：开房 / 输码进房 / 回到刚才的房间 */
export function openOnline(): void {
  const c = card();
  c.appendChild(el('h2', {}, '好友房'));
  c.appendChild(el('div', { class: 'ol-tip' }, '开个房间把房间码发给朋友，4 个人一起打；人不够电脑补上。'));
  // 回到刚才的房间：先问平台现在是谁，是这个账号记下的才给（换了账号的人看不到）
  const slot = el('div');
  c.appendChild(slot);
  void myRoom().then((back) => {
    if (back && slot.isConnected) slot.appendChild(button(`回到刚才的房间 ${back.code}`, () => join(back.code, back.host), '', 'ol-back'));
  });
  // 单独部署（0.8.0）没有账号：别人看到的名字自己填，开房、进房的地址上带着（不填就叫"游客"加数字）
  if (standalone()) {
    const row = el('label', { class: 'ol-row' });
    row.appendChild(el('span', {}, '你的昵称'));
    const nick = el('input', { id: 'ol-nick', maxlength: '12', placeholder: '不填就叫"游客"', autocomplete: 'nickname' });
    nick.value = getNick();
    nick.addEventListener('change', () => setNick(nick.value.trim()));
    row.appendChild(nick);
    c.appendChild(row);
  }
  const make = el('div', { class: 'ol-row' });
  make.appendChild(button('开个房间', () => void create(null), '', 'ol-create'));
  // 实盘房间（0.5.0，docs/stake.md 第 3 节）：开房时选档位，之后不能改。单独部署没有钱包，不摆
  if (!standalone()) make.appendChild(button('开实盘房间', () => pickTier(tiers), 'gd-2', 'ol-create-stake'));
  c.appendChild(make);
  const tiers = el('div', { class: 'ol-row', id: 'ol-tiers' });
  c.appendChild(tiers);
  const row = el('div', { class: 'ol-row' });
  const input = el('input', { id: 'ol-code', inputmode: 'numeric', maxlength: '6', placeholder: '6 位房间码', autocomplete: 'off' });
  input.addEventListener('input', () => (input.value = input.value.replace(/\D/g, '').slice(0, 6)));
  row.appendChild(input);
  row.appendChild(
    button('进房', () => {
      if (!/^\d{6}$/.test(input.value)) return setNote('房间码是 6 位数字');
      join(input.value, false);
    }, '', 'ol-join'),
  );
  c.appendChild(row);
  c.appendChild(noteEl());
  c.appendChild(button('关掉', () => {
    note = '';
    close();
  }, 'gd-2'));
}

function setNote(t: string): void {
  note = t;
  const n = document.getElementById('ol-note');
  if (n) n.textContent = t;
}

/** 实盘房间：每档一个按钮，钱包不够一份的灰掉（钱包连不上时不拦，开局时带入被拒就是这个人不计输赢） */
function pickTier(box: HTMLElement): void {
  box.replaceChildren(el('div', { class: 'ol-tip' }, `选档位：打 ${ROOM_DEALS} 副，输赢最多一份；${ROOM_STAKE_TEXT.bots}。${STAKE_TEXT.noCash}`));
  const btns = TIER_IDS.map((t) => {
    const b = button(`${TIER_NAME[t]} ${fmtChips(TIERS[t])}`, () => void create(t), '', `ol-tier-${t}`);
    box.appendChild(b);
    return [t, b] as const;
  });
  void fetchWallet().then((w) => {
    if (!w || !box.isConnected) return;
    for (const [t, b] of btns) b.disabled = w.balance < TIERS[t];
    if (w.balance < TIERS.small) setNote(STAKE_TEXT.lowFunds);
  });
}

/** "开个房间"永远开新的（0.6.0）：不再因为有一个开着的就把人送回旧房间 */
async function create(stake: TierId | null): Promise<void> {
  setNote('正在开房…');
  // 等回话时按钮转圈、不能再点（连点会开出两个房间）
  const btn = document.getElementById(stake === null ? 'ol-create' : 'ol-create-stake');
  btn?.classList.add('is-loading');
  const r = await createRoom(fetch, stake).finally(() => btn?.classList.remove('is-loading'));
  if ('code' in r) {
    note = '';
    join(r.code, true);
    return;
  }
  setNote(r.error);
  if (r.login) window.setTimeout(() => (window.location.href = loginUrl()), 1200);
}

/**
 * 叫朋友来：手机上弹系统分享（微信、短信……），不支持的复制链接；朋友点开链接就进这个房间（没登录的先登录、登录完回来），
 * 开打了就接管电脑的座位。返回要给人看的一句话（弹了系统分享、或者自己关掉了分享面板时没有）。大厅和牌桌（0.6.1）共用
 */

/** 进房（含房主自己）：连上后画房间。prefer：再来一场跟过来的，想坐的真实座位；match：快速匹配排到的桌 */
export function join(code: string, host: boolean, prefer: number | null = null, match = false): void {
  offSes?.();
  ses?.close();
  const s = new NetSession(code, host, match ? { match } : {});
  s.prefer = prefer;
  ses = s;
  roomInUrl(code);
  app.net = null;
  // 进了房间（第一次连上）马上报一次位置，好友那边看得到"在掼蛋好友房 3/4"
  let told = false;
  offSes = s.on((k) => {
    if (!told && k === 'reset') {
      told = true;
      presenceNow();
    }
    renderRoom();
  });
  renderRoom();
}

function seatLabel(i: number, mine: number | null): string {
  if (mine === null) return `${i + 1} 号位`;
  if (i === mine) return '你';
  return (i - mine + 4) % 2 === 0 ? '对家（和你一队）' : (i - mine + 4) % 4 === 1 ? '下家' : '上家';
}

function renderRoom(): void {
  const s = ses;
  if (!s) return;
  // 开打了、我也坐下了：进牌桌
  if (s.canEnterTable && app.game) {
    enterTable(s);
    return;
  }
  const c = card();
  const match = s.match;
  c.appendChild(el('h2', {}, match ? '快速匹配' : '好友房'));
  if (s.status === 'closed' || s.status === 'failed') {
    c.appendChild(el('div', { class: 'ol-note' }, s.linkText()));
    // 回不去了（房间散了、码不对、满了、在别处进了……）：地址栏里的房间码也去掉，免得刷新又撞上
    if (isFinalForRoom(s.closeCode)) roomInUrl(null);
    const row = el('div', { class: 'ol-row' });
    // 登录完回到这个房间（地址栏里的房间码上面刚去掉了，按房间码拼）
    // 单独部署：游客 cookie 是打开首页时发的，刷新一下（带着房间码）就有了
    if (s.closeCode === CLOSE.unauthorized) {
      if (standalone()) row.appendChild(button('刷新再进', () => window.location.assign(`./?room=${s.code}`)));
      else row.appendChild(button('去登录', () => (window.location.href = loginUrl(`?room=${s.code}`))));
    }
    if (s.status === 'failed') row.appendChild(button('再试一次', () => s.retry()));
    row.appendChild(button('好', () => (match ? close() : openOnline()), 'gd-2', 'ol-ok'));
    c.appendChild(row);
    return;
  }
  // 匹配桌只给排到的人进（别人拿着码也是 4004）：房间码、叫朋友都不摆
  if (!match) {
    const head = el('div', { class: 'ol-row' });
    head.appendChild(el('span', {}, '房间码'));
    head.appendChild(el('span', { class: 'ol-code', id: 'ol-room-code' }, s.code));
    c.appendChild(head);
    if (s.room?.status !== 'over') c.appendChild(button('叫朋友来', () => void openInvitePanel(s.code), 'gd-big', 'ol-share'));
  }
  // 实盘房间：开房时定的档位，进房的人都看得到
  const stake = parseRoomOpts(s.room?.opts)?.stake ?? null;
  if (stake) {
    c.appendChild(
      el('div', { class: 'ol-stake', id: 'ol-stake' }, `实盘 · ${TIER_NAME[stake]}（一份 ${fmtChips(TIERS[stake])}，每分 ${fmtChips(pointValue(stake))}）· 打 ${ROOM_DEALS} 副 · ${ROOM_STAKE_TEXT.bots}`),
    );
  }
  if (s.status !== 'open' || !s.room) {
    c.appendChild(el('div', { class: 'ol-tip' }, s.status === 'reconnecting' ? s.linkText() : '正在进房…'));
    c.appendChild(button('离开', () => leave(), 'gd-2'));
    return;
  }
  const room = s.room;
  const seats = el('div', { class: 'ol-seats' });
  room.seats.forEach((st, i) => {
    const box = el('div', { class: 'ol-seat', 'data-seat': String(i) });
    box.style.setProperty('--team', TEAM[i % 2]!);
    const who = el('div');
    // 电脑座位带 name 的是绑了人、主人离座了，电脑在替他打
    const name =
      st.kind === 'human' ? (i === s.mySeat ? `${st.name ?? ''}（你）` : (st.name ?? '玩家')) : st.kind === 'ai' ? (st.name !== null ? `电脑代 ${st.name} 打` : '电脑') : '空位';
    who.appendChild(el('b', { title: name }, name));
    who.appendChild(el('small', {}, `${seatLabel(i, s.mySeat)}${st.kind === 'human' && st.away ? ' · 掉线了' : ''}`));
    box.appendChild(who);
    if (room.status === 'waiting' && st.kind === 'empty' && !match) box.appendChild(button(s.mySeat === null ? '坐这里' : '换到这', () => s.sit(i), '', `ol-sit-${i}`));
    if (room.status === 'playing' && s.mySeat === null) {
      // 开打后座位绑人（arcade-kit 0.1.1）：坐过的人只能回自己的座位；没坐过的人只能接管没绑人的电脑座位
      if (s.bound === i) box.appendChild(button('回到我的座位', () => s.sit(i), '', `ol-sit-${i}`));
      else if (s.bound === null && st.kind === 'ai' && !st.reserved) box.appendChild(button('接管', () => s.sit(i), '', `ol-sit-${i}`));
    }
    seats.appendChild(box);
  });
  c.appendChild(seats);
  if (room.status === 'waiting' && match) {
    // 匹配桌：排到的人都坐好了，到齐就开；20 秒还没来的座位电脑替他打（kit 的 matchJoinMs）
    c.appendChild(el('div', { class: 'ol-tip', id: 'ol-match-tip' }, '排到了！人到齐就开打，没来的座位电脑替他打'));
  } else if (room.status === 'waiting') {
    if (s.host) {
      // 实盘至少两个真人（3.1）：房间开局时不够也会整场不计输赢，这里先把按钮灰掉
      const humans = room.seats.filter((st) => st.kind === 'human').length;
      const go = button('开局（空位电脑补）', () => s.start(), '', 'ol-start');
      go.disabled = s.mySeat === null || (stake !== null && humans < 2);
      c.appendChild(go);
      const tip = s.mySeat === null ? '先选个座位坐下' : stake !== null && humans < 2 ? ROOM_STAKE_TEXT.needTwo : stake !== null ? '人到齐了就能开；开局时每人从钱包带一份' : '朋友进来选好座位就能开；一个人也能开，和电脑打';
      c.appendChild(el('div', { class: 'ol-tip', id: 'ol-start-tip' }, tip));
    } else c.appendChild(el('div', { class: 'ol-tip' }, s.mySeat === null ? '选个座位坐下，等开房的人开局' : '等开房的人开局…'));
  } else if (room.status === 'playing' && s.mySeat === null) {
    const free = room.seats.some((st) => st.kind === 'ai' && !st.reserved);
    c.appendChild(
      el('div', { class: 'ol-tip' }, s.bound !== null ? '电脑在替你打，点"回到我的座位"接着打' : free ? '已经开打了，选一个电脑的座位接管' : '已经开打了，座位都有主人，换个房间吧'),
    );
  } else if (room.status === 'over') {
    c.appendChild(el('div', { class: 'ol-tip' }, match ? '这局已经打完了，再排一次吧' : '这局已经打完了，开个新房间再来'));
  }
  c.appendChild(noteEl());
  c.appendChild(button('离开房间', () => leave(), 'gd-2', 'ol-leave'));
  const err = s.lastError;
  // 其余的（座位被占 not_your_seat / seat_reserved 等）用和牌桌上一样的大白话
  if (err) setNote(err === 'seat_taken' ? '这个座位刚被别人坐了' : errorText(err));
}

function leave(): void {
  const match = ses?.match ?? false;
  offSes?.();
  offSes = null;
  ses?.leave();
  ses = null;
  app.net = null;
  presenceNow();
  note = '';
  // 匹配桌是从选档页排来的：离开就回标题页（好友房面板和它不相干）
  if (match) close();
  else openOnline();
}

let matcher: MatchClient | null = null;
let tick: number | null = null;

function stopMatch(): void {
  matcher?.cancel();
  matcher = null;
  if (tick !== null) window.clearInterval(tick);
  tick = null;
}

/**
 * 快速匹配（0.26.0）：stake 是档位（娱乐 null），solo 是转同档单机（标题页给：娱乐按现在的设置开一局、实盘按这一档带入）。
 * 排队连接只建一条、不轮询；人数变了服务端推一次（带剩余毫秒数），倒计时页面自己数。15 秒只剩自己、联机忙、今天局数用完都转单机；
 * 排到了用好友房同一套进房（match = true）
 */
export function openMatch(stake: TierId | null, solo: () => void): void {
  stopMatch();
  const c = card();
  c.appendChild(el('h2', {}, '快速匹配'));
  c.appendChild(
    el('div', { class: 'ol-stake', id: 'ol-match-tier' }, stake ? `实盘 · ${TIER_NAME[stake]}（一份 ${fmtChips(TIERS[stake])}）· 打 ${ROOM_DEALS} 副` : '娱乐 · 打过 A · 不计战绩'),
  );
  const wait = el('div', { class: 'ol-wait', id: 'ol-match-wait' }, '正在找人…');
  c.appendChild(wait);
  c.appendChild(el('div', { class: 'ol-tip' }, '找到几个算几个，空位电脑补；只剩你一个就先和电脑打'));
  const row = el('div', { class: 'ol-row' });
  const cancel = button('取消', () => close(), 'gd-2', 'ol-match-cancel');
  const now = button('不等了，和电脑打', () => (close(), solo()), '', 'ol-match-solo');
  row.appendChild(now);
  row.appendChild(cancel);
  c.appendChild(row);
  let n = 1;
  let seats = 4;
  let until = 0;
  const paint = (): void => {
    const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
    wait.textContent = until ? `正在找人 · 已有 ${n}/${seats} 人 · 还剩 ${left} 秒` : '正在找人…';
  };
  const done = (t: string, then: (() => void) | null): void => {
    stopMatch();
    wait.textContent = t;
    now.remove();
    cancel.remove();
    if (then) window.setTimeout(() => root?.contains(wait) && (close(), then()), 1200);
    else row.appendChild(button('好', () => close(), 'gd-2', 'ol-ok'));
  };
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const m = new MatchClient({
    url: withNick(`${proto}//${window.location.host}${MATCH_PATH}/${matchTierOf(stake)}`),
    onWaiting: (count, size, leftMs) => {
      [n, seats, until] = [count, size, Date.now() + leftMs];
      paint();
    },
    onMatched: (code) => {
      stopMatch();
      join(code, false, null, true);
    },
    // 已经有一个开着的房间（kit 入队前先问计量）：带他回去，是他开的好友房还当房主
    onHasRoom: (code) => {
      stopMatch();
      const saved = savedRoom();
      join(code, saved?.code === code && saved.host);
    },
    // 别的页面排上了：这里不排了，也不替他开单机
    onSolo: (why: MatchSoloWhy) => done(MATCH_TEXT[why], why === 'replaced' ? null : solo),
  });
  matcher = m;
  tick = window.setInterval(paint, 1000);
  m.start();
}

function enterTable(s: NetSession): void {
  close();
  offSes?.();
  offSes = null;
  app.net = s;
  s.autoplay = !!app.params?.autoplay;
  mountNetBanner(s);
  // 还在载入（字体、纹理没烘完）：不打断，BootScene 载完看到 app.net 会自己进牌桌
  if (!app.ready) return;
  const game = app.game!;
  const active = game.scene.getScenes(true)[0];
  if (active?.scene.key === 'table') active.scene.restart();
  else game.scene.getScenes(true).forEach((sc) => sc.scene.start('table'));
}

let bannerOff: (() => void) | null = null;

/** 牌桌上方的连接状态：断线重连中；房间关了、被顶掉时弹一句话 */
function mountNetBanner(s: NetSession): void {
  style();
  bannerOff?.();
  let b = document.getElementById('net-banner');
  if (!b) {
    b = el('div', { id: 'net-banner' });
    document.body.appendChild(b);
  }
  const banner = b;
  const paint = (): void => {
    if (app.net !== s) {
      banner.classList.remove('on');
      return;
    }
    const t = s.linkText(true);
    banner.textContent = t;
    banner.classList.toggle('on', !!t);
    banner.style.pointerEvents = s.status === 'failed' ? 'auto' : 'none';
  };
  banner.onclick = () => s.status === 'failed' && s.retry();
  const off = s.on((k) => k === 'status' && paint());
  bannerOff = () => {
    off();
    banner.classList.remove('on');
  };
  paint();
}

/** 启动时：URL 带 room=xxxxxx 就直接进那个房间 */
export async function autoJoin(code: string | null): Promise<void> {
  if (!code || !/^\d{6}$/.test(code)) return;
  // 房主标记只给记下它的那个账号（同一台设备换了账号，链接里的房间照进，但不是房主）
  const saved = await myRoom();
  join(code, saved?.code === code ? saved.host : false);
}

/** 大厅里（还没进牌桌）的联机会话，给调试桥看状态用 */
export function lobbySession(): NetSession | null {
  return ses;
}

export { forgetRoom };
