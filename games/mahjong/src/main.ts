/**
 * 页面入口：选桌页、好友房的等人页、牌桌，接钱包、单机、好友房、声音和看得见的区域。
 * 规则在 src/core，单机的流程在 solo.ts，好友房的连接在 online.ts，这里只把它们和画面连起来。
 */
import { createRoom } from 'arcade-kit/client';
import { DEFAULT_OPTS, TURN_MS, type XzAction, type XzOpts, type XzView } from './core/variants/sichuan-xuezhan/index.ts';
import { stakesOf, type StakesId } from './game/stakes.ts';
import { getWallet, maybeApplied, randomId, type WalletReply, type WalletView } from './net/wallet.ts';
import { createError, Online, type OnlineState } from './online.ts';
import { PERSONAS } from './ai/personas.ts';
import { SEATS, type RoomView } from './room/rules.ts';
import { loadSolo, newSolo, Solo, unsettled } from './solo.ts';
import { closeDialog, confirmBox, dialog } from './view/dialog.ts';
import { button, el } from './view/dom.ts';
import { GUIDE_KEY, showGuide, showRules } from './view/guide.ts';
import { Comms, type CommsEvent } from './view/comms.ts';
import { renderLobby } from './view/lobby.ts';
import { renderWaiting, roomNotice, rulesLine, shareRoom } from './view/room.ts';
import { play, setSound, unlockAudio } from './view/sound.ts';
import { TableUi, type CommonAct, type SeatMeta } from './view/table.ts';
import { GAME_NAME, num, PHRASES, VARIANT_NAME, walletError } from './view/text.ts';
import { matchSummary, roundSummary } from './view/variants/sichuan-xuezhan/summary.ts';
import { xuezhanUi } from './view/variants/sichuan-xuezhan/ui.ts';
import { watchViewport } from './view/viewport.ts';
import './view/style.css';

// ---------- 设置 ----------

const PREFS_KEY = 'mahjong.prefs';
interface Prefs {
  sound: boolean;
  fast: boolean;
  stakes: StakesId;
  opts: XzOpts;
}

function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
    return { sound: p.sound !== false, fast: p.fast === true, stakes: stakesOf(p.stakes)?.id ?? 'fun', opts: { ...DEFAULT_OPTS, ...(p.opts ?? {}) } };
  } catch {
    return { sound: true, fast: false, stakes: 'fun', opts: { ...DEFAULT_OPTS } };
  }
}
const prefs = loadPrefs();
function savePrefs(): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // 存不上就这一次有效
  }
}
setSound(prefs.sound);

// ---------- 骨架 ----------

const app = document.getElementById('app')!;
const stage = el('div', 'stage', app);
const top = el('div', 'topbar', stage);
const home = el('a', 'home', top);
home.href = '/';
home.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11 12 3l9 8v10h-6v-6H9v6H3z"/></svg><span>大厅</span>';
const title = el('span', 'title', top, `${GAME_NAME} · ${VARIANT_NAME['sichuan-xuezhan']}`);
el('span', 'spacer', top);
const walletChip = el('span', 'wallet-chip', top);
const speedBtn = button('icon', top, '', () => {
  prefs.fast = !prefs.fast;
  savePrefs();
  paintTop();
  if (solo) solo.speed = prefs.fast ? 0.5 : 1;
});
const soundBtn = button('icon', top, '', () => {
  prefs.sound = !prefs.sound;
  setSound(prefs.sound);
  savePrefs();
  paintTop();
});
button('icon', top, '规则', () => showRules(stage));
const shareBtn = button('pill share', top, '叫朋友', () => void share());
const leaveBtn = button('pill leave', top, '离开', () => void leave());
const screen = el('div', 'screen', stage);

function paintTop(): void {
  speedBtn.textContent = prefs.fast ? '快' : '慢';
  speedBtn.title = prefs.fast ? '电脑出牌快' : '电脑出牌慢';
  soundBtn.textContent = prefs.sound ? '声' : '静';
  leaveBtn.hidden = !solo && !online;
  speedBtn.hidden = !solo;
  shareBtn.hidden = !online || online.state.room?.status === 'over';
}

let toastTimer = 0;
function toast(text: string): void {
  let t = stage.querySelector<HTMLElement>('.toast');
  if (!t) t = el('div', 'toast', stage);
  t.textContent = text;
  t.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (t!.hidden = true), 2_600);
}

watchViewport(app, stage, () => {});
document.addEventListener('pointerdown', unlockAudio, { capture: true });

// ---------- 钱包 ----------

let wallet: WalletView | null = null;
let walletNote: string | null = null;

async function refreshWallet(): Promise<void> {
  const r = await getWallet();
  if (r.ok && r.wallet) {
    wallet = r.wallet;
    walletNote = null;
    walletChip.textContent = `钱包 ${num(wallet.balance)}`;
  } else {
    wallet = null;
    walletNote = r.ok ? null : `${walletError(r.error).text}。实盘先不能选，娱乐照常玩。`;
    walletChip.textContent = '';
  }
}

let myName = '我';
async function loadMe(): Promise<void> {
  try {
    const r = await fetch('/api/me', { credentials: 'same-origin' });
    const b = (await r.json()) as { user?: { displayName?: string } | null };
    if (b.user?.displayName) myName = b.user.displayName;
  } catch {
    // 没登录（开发时）就叫"我"
  }
}

function showError(text: string, fix?: string): void {
  dialog(stage, 'error', (box) => {
    el('p', '', box, text);
    if (fix === 'less' || fix === 'wallet') {
      const a = el('a', 'act soft', box, '去大厅领补给') as HTMLAnchorElement;
      a.href = '/';
    }
    if (fix === 'refresh') button('act soft', box, '刷新', () => location.reload());
    button('act go', box, '知道了', closeDialog);
  });
}

// ---------- 选桌页 ----------

let solo: Solo | null = null;
let table: TableUi<XzView, XzAction> | null = null;

function lobby(friends = false): void {
  stopFollow();
  arrive = null;
  solo?.stop();
  solo = null;
  online?.close();
  online = null;
  comms?.destroy();
  comms = null;
  setRoomInUrl(null);
  table?.destroy();
  table = null;
  title.textContent = `${GAME_NAME} · ${VARIANT_NAME['sichuan-xuezhan']}`;
  paintTop();
  screen.className = 'screen lobby';
  renderLobby(screen, {
    wallet,
    walletNote,
    stakes: prefs.stakes,
    opts: prefs.opts,
    canResume: loadSolo() !== null,
    onSolo: (stakes, opts) => void startSolo(stakes, opts),
    onResume: () => void resumeSolo(),
    onRules: () => showRules(stage),
    onRoom: (stakes, opts) => void openRoom(stakes, opts),
    onJoin: (code) => (/^\d{6}$/.test(code) ? enterRoom(code, false) : toast('房间号是 6 位数字')),
    friends,
  });
}

async function startSolo(stakes: StakesId, opts: XzOpts): Promise<void> {
  prefs.stakes = stakes;
  prefs.opts = opts;
  savePrefs();
  // 上一场实盘还没结回钱包：先结了再开，不然新的一场会盖掉它的存档（自审 C1）
  const old = loadSolo();
  if (unsettled(old)) {
    if (!(await confirmBox(stage, '上一场实盘还没结算完。先把上一场的筹码结回钱包，再开新的一场？', '先结算', '不了'))) return;
    const r = await new Solo(old!, quietUi).finish();
    if (!old!.done) return showError(`上一场还没结上：${walletError(r && !r.ok ? r.error : 'network').text}`);
  }
  const st = stakesOf(stakes)!;
  let chips = st.share;
  if (!st.wallet) return playSolo(new Solo(newSolo(stakes, opts, myName, null, chips), soloUi));
  await refreshWallet();
  if (!wallet) return showError(walletNote ?? walletError('unavailable').text);
  chips = Math.min(st.share, wallet.balance);
  if (chips <= 0) return showError(walletError('no_funds').text, 'less');
  if (chips < st.share && !(await confirmBox(stage, `钱包只有 ${num(chips)}，不够一份（${num(st.share)}）。带 ${num(chips)} 上桌？`, '带上桌', '不了'))) return;
  // 带入前先存"带入中"（ref、操作号），回包丢了下次用同一个号重发（自审 C3）
  const save = newSolo(stakes, opts, myName, randomId(), chips);
  save.buying = { op: randomId(), amount: chips };
  const s = new Solo(save, soloUi);
  const r = await s.buyin();
  if (!r.ok) return buyinFailed(r);
  if (r.wallet) wallet = r.wallet;
  playSolo(s);
}

/** 带入没成：明确被拒的照说原因；没回话的告诉他下次会自动再确认，不会多扣 */
function buyinFailed(r: Extract<WalletReply, { ok: false }>): void {
  if (maybeApplied(r.error)) return showError('钱包这次没回话，不知道筹码扣了没有。下次点"接着打上一场"会自动再确认一次，不会多扣。');
  const e = walletError(r.error, r.retryAfter);
  showError(e.text, e.fix);
}

/** 选桌页"接着打上一场"：带入还没确认的先确认；已经离开、只差结回的只结回、不接着打（自审 C2、C3） */
async function resumeSolo(): Promise<void> {
  const save = loadSolo();
  if (!save) return;
  const s = new Solo(save, soloUi);
  if (save.settle) return settleLeftover(s);
  if (save.buying) {
    const r = await s.buyin();
    if (!r.ok) {
      lobby();
      return buyinFailed(r);
    }
  }
  playSolo(s);
}

/** 上一场已经离开、结回没成：再结一次，成了说一声 */
async function settleLeftover(s: Solo): Promise<void> {
  const r = await s.finish();
  if (screen.classList.contains('lobby')) lobby();
  if (r?.ok) toast('上一场的筹码已经结回钱包');
  else if (r) toast(`上一场的筹码还没结上：${walletError(r.error).text}`);
}

/** 不画牌桌的单机（结旧的一场用）：结回的结果由调用的人说 */
const quietUi = {
  frame(): void {},
  roundEnd(): void {},
  settled(): void {
    void refreshWallet();
  },
};

// ---------- 好友房 ----------

let online: Online | null = null;
/** 这个房间是我开的（房间不下发房主是谁） */
let hosting = false;
/** 上一次画的牌局走到第几步：同一步重画（有人坐下、掉线）不再放一遍动画和音效 */
let shownN = -1;
/** 上一次画的时候我这个座位的筹码是不是我的（变了就刷新钱包） */
let ownShown = false;
/** 好友房的交流（短语、表情、道具、催促炸弹） */
let comms: Comms | null = null;
/** 跟着"再来一场"进新房间：娱乐自动坐到 seat，实盘只把那个座位亮一下、自己点了才坐（坐下的人开打时带入） */
let arrive: { seat: number; sit: boolean } | null = null;
/** 别人开了新房间：几秒后跟过去（让大家先看清结算） */
let followTimer = 0;
const FOLLOW_MS = 5_000;
function stopFollow(): void {
  window.clearTimeout(followTimer);
  followTimer = 0;
}

/** 房间号放在地址栏：刷新、分享、登录跳回来都靠它（不另存） */
function setRoomInUrl(code: string | null): void {
  const u = new URL(location.href);
  if (code) u.searchParams.set('room', code);
  else u.searchParams.delete('room');
  history.replaceState(null, '', u);
}

async function openRoom(stakes: StakesId, opts: XzOpts): Promise<void> {
  prefs.stakes = stakes;
  prefs.opts = opts;
  savePrefs();
  const st = stakesOf(stakes)!;
  if (st.wallet) {
    await refreshWallet();
    if (!wallet) return showError(walletNote ?? walletError('unavailable').text);
    if (wallet.balance <= 0) return showError(walletError('no_funds').text, 'less');
  }
  const r = await createRoom('rooms', { variant: 'sichuan-xuezhan', stakes, rules: opts });
  if ('error' in r) return showError(createError(r.error), r.error === 'login' ? 'refresh' : undefined);
  enterRoom(r.code, true);
}

function enterRoom(code: string, host: boolean, from: { seat: number; sit: boolean } | null = null): void {
  stopFollow();
  arrive = from;
  solo?.stop();
  solo = null;
  online?.close();
  comms?.destroy();
  comms = null;
  table?.destroy();
  table = null;
  hosting = host;
  shownN = -1;
  ownShown = false;
  setRoomInUrl(code);
  closeDialog();
  screen.className = 'screen room';
  screen.replaceChildren();
  el('p', 'room-hint', screen, '正在进房……');
  online = new Online(code, onlineUi);
  paintTop();
}

const onlineUi = {
  draw(s: OnlineState, fresh: boolean): void {
    paintTop();
    if (!s.room) return;
    if (s.room.status === 'waiting' && arrive?.sit && s.you && s.you.seat === null) {
      // 跟过来的娱乐房：坐回和上一场一样的相对位置（被人占了就不坐，留在等人页自己挑）
      if (s.room.seats[arrive.seat]?.kind === 'empty') online?.sit(arrive.seat);
      arrive = { ...arrive, sit: false };
    }
    if (s.room.status === 'waiting' || !s.view) return drawWaiting(s);
    drawRoomTable(s, s.view, fresh);
  },
  toast,
  emote(seat: number, id: number, to?: number): void {
    comms?.receive(seat, id, to);
  },
  ended(text: string): void {
    void refreshWallet();
    dialog(stage, 'error', (box) => {
      el('p', '', box, text);
      button('act go', box, '回选桌', () => {
        closeDialog();
        lobby();
      });
    }, false);
  },
};

function drawWaiting(s: OnlineState): void {
  title.textContent = `${GAME_NAME} · 好友房`;
  screen.className = 'screen room';
  renderWaiting(screen, {
    code: s.code,
    room: s.room!,
    you: s.you,
    opts: s.opts,
    host: hosting || s.you?.seat === 0,
    suggest: s.you?.seat === null && arrive ? arrive.seat : null,
    onSit: (seat) => online?.sit(seat),
    onStart: () => online?.start(),
    onShare: () => void share(),
    // 等人页离开：先离座再断开（只断开的话 kit 只记掉线、座位还占着，房主开打会照样从他钱包带一份，自审 C4）
    onLeave: () => {
      if (s.you?.seat !== null && s.you?.seat !== undefined) online?.leaveSeat();
      lobby();
    },
  });
}

function seatMetas(s: OnlineState, g: XzView): SeatMeta[] {
  // 实盘桌的电脑都是同一个最强性格：重名的按座位编号，免得"火锅婆婆点炮火锅婆婆"分不清
  const named = g.seats.map((x) => PERSONAS[x.persona]?.name ?? '电脑');
  const bots = s.room!.seats.map((x, i) => (x.kind === 'human' || x.name ? null : named[i]!));
  return s.room!.seats.map((x, i): SeatMeta => {
    const same = bots.filter((b) => b === bots[i]).length > 1;
    const persona = same ? `${named[i]}${bots.slice(0, i + 1).filter((b) => b === bots[i]).length}` : named[i]!;
    // 绑了人、主人离座了的座位：电脑代他打
    const name = x.kind === 'human' ? (x.name ?? '玩家') : x.name ? `电脑（代${x.name}）` : persona;
    return { name, bot: x.kind !== 'human', away: x.away, auto: x.auto };
  });
}

function drawRoomTable(s: OnlineState, rv: RoomView, fresh: boolean): void {
  const g = rv.g as XzView;
  if (!table) {
    screen.className = 'screen game';
    screen.replaceChildren();
    const st = stakesOf(rv.stakes)!;
    title.textContent = `好友房 ${s.code} · ${st.wallet ? `实盘 ${num(st.share)}` : '娱乐'}`;
    table = new TableUi<XzView, XzAction>(screen, xuezhanUi, (a: CommonAct | XzAction) => online?.play(a));
    lastPrompt = false;
    const t = table;
    comms = new Comms(
      screen,
      {
        me: () => online?.state.you?.seat ?? null,
        avatarRect: (seat) => t.avatarRect(seat),
        avatarEl: (seat) => t.avatarEl(seat),
        bubble: (seat, text) => t.bubble(seat, text),
        occupied: (seat) => (online?.state.room?.seats[seat]?.kind ?? 'empty') !== 'empty',
      },
      (id, to) => online?.emote(id, to),
    );
  }
  // 同一步重画：事件已经放过了
  const replay = fresh || rv.n === shownN;
  shownN = rv.n;
  const v: XzView = replay ? { ...g, events: [] } : g;
  const turn = s.room!.turn;
  const pause = s.room!.pause;
  table.render({
    v,
    seats: seatMetas(s, g),
    timer: turn?.deadline ? { seats: turn.seats ?? [turn.seat], until: turn.deadline } : pause ? { seats: [], until: pause.until } : null,
  });
  const seat = s.you?.seat ?? null;
  // 带入到账、结回了：顶栏的钱包跟着变
  const mine = seat !== null && rv.own[seat] === true;
  if (mine !== ownShown) void refreshWallet();
  ownShown = mine;
  table.root.querySelector('.room-note')?.remove();
  const n = roomNotice(rv, seat, () => online?.rebuy());
  if (n) table.root.appendChild(n);
  if (!replay) comms?.events(v.events.flatMap((e): CommsEvent[] => (e.e === 'hu' ? [{ e: 'hu', seat: e.seat, from: e.from }] : e.e === 'kan' ? [{ e: 'kan', seat: e.seat }] : [])));
  // 催促炸弹：别的真人一个人在想（轮到他打牌），想够 8 秒才冒出来
  const thinking = g.phase === 'turn' && g.turn !== seat && s.room!.seats[g.turn]?.kind === 'human' && turn?.deadline ? g.turn : null;
  comms?.urge(thinking, thinking === null ? 0 : turn!.deadline! - TURN_MS.turn);
  alertTurn(v);
  roomRoundEnd(s, rv, g, replay);
}

/** 一局打完：房间停 8 秒自动发下一局，结算摆着不用点；一场打完给总结算 */
function roomRoundEnd(s: OnlineState, rv: RoomView, g: XzView, replay: boolean): void {
  const names = seatMetas(s, g).map((x) => x.name);
  const wallet = !!stakesOf(rv.stakes)?.wallet && !rv.unrated;
  const unit = wallet ? '' : ' 分';
  if (g.phase === 'over' || rv.done) {
    const me = s.you?.seat ?? null;
    if (!(replay && document.querySelector('.mask.end'))) {
      dialog(stage, 'end', (box) => {
        box.appendChild(roundSummary(g, names, unit));
        box.appendChild(matchSummary(g, names, unit));
        if (rv.cut) el('div', 'settle-note', box, '只剩一个人在下注，实盘这一场提前结束（实盘至少要两个人）');
        if (wallet) el('div', 'settle-note', box, '桌上的筹码已经结回钱包');
        else if (rv.unrated) el('div', 'settle-note', box, '实盘只有一个人，这一场不计输赢、没动钱包');
        const row = el('div', 'row end-acts', box);
        button('act soft', row, '回选桌', () => {
          closeDialog();
          lobby();
        });
        // 再来一场：我开个同样规则的新房间，这一桌跟过来。房间等 3 分钟，过了再点就自己先去新房间、再叫朋友
        if (me !== null && s.room?.seats[me]?.kind === 'human' && !rv.next) {
          const b = button('act go rematch', row, '再来一场', () => void rematch(b));
          if (stakesOf(rv.stakes)?.wallet) el('p', 'room-hint', box, '新房间里各人自己坐下，开打时才从钱包带一份');
        }
      }, false);
      play((g.result?.seats[g.me?.seat ?? 0]?.net ?? 0) >= 0 ? 'win' : 'lose');
      void refreshWallet();
    }
    // 别人开了新房间：结算上写一句，几秒后跟过去（娱乐坐回原来的相对位置，实盘只亮座位、自己点了才坐）
    if (rv.next && rv.next.by !== me && !followTimer) {
      const next = rv.next;
      const from = me === null ? null : { seat: (me - next.by + SEATS) % SEATS, sit: !stakesOf(rv.stakes)?.wallet };
      const go = (): void => enterRoom(next.code, false, from);
      followTimer = window.setTimeout(go, FOLLOW_MS);
      const box = document.querySelector<HTMLElement>('.mask.end .dialog');
      const row = box?.querySelector<HTMLElement>('.end-acts');
      if (box && row) {
        row.querySelector('.rematch')?.remove();
        row.before(el('p', 'room-hint', null, `${names[next.by]} 开了新房间 ${next.code}，马上跟过去`));
        button('act go', row, '现在过去', go);
      }
    }
    return;
  }
  if (g.phase === 'end') {
    if (replay && document.querySelector('.mask.end')) return;
    dialog(stage, 'end', (box) => {
      box.appendChild(roundSummary(g, names, unit));
      el('p', 'room-hint', box, '几秒后自动开下一局');
    });
    return;
  }
  if (document.querySelector('.mask.end')) closeDialog();
}

async function rematch(b: HTMLButtonElement): Promise<void> {
  const opts = online?.state.opts;
  if (!online || !opts) return;
  b.disabled = true;
  const r = await createRoom('rooms', opts);
  if ('error' in r) {
    b.disabled = false;
    return toast(createError(r.error));
  }
  // 先把房间号发给这一桌（关连接前发出去的会先送到），自己马上过去当房主坐 0 号
  online.next(r.code);
  enterRoom(r.code, true);
}

async function share(): Promise<void> {
  if (!online) return;
  const r = await shareRoom(online.state.code, GAME_NAME);
  if (r === 'copied') toast('链接已复制，发给朋友');
  else if (r === 'failed') toast(`房间号 ${online.state.code}，告诉朋友在选桌页输入`);
}

// ---------- 牌桌（单机） ----------

let lastPrompt = false;

const soloUi = {
  frame(v: XzView, names: string[]): void {
    if (!table) return;
    table.render({ v, seats: names.map((name, i): SeatMeta => ({ name, bot: i !== 0 })) });
    chatter(v);
    alertTurn(v);
  },
  roundEnd(v: XzView, names: string[]): void {
    const unit = stakesOf(solo?.stakes)?.wallet ? '' : ' 分';
    // 停一下再弹结算：这期间回了选桌、又开了新的一场，就不弹到新牌桌上（自审 C8）
    const mine = solo;
    window.setTimeout(() => {
      if (!solo || solo !== mine) return;
      if (v.phase === 'over') {
        dialog(stage, 'end', (box) => {
          box.appendChild(roundSummary(v, names, unit));
          box.appendChild(matchSummary(v, names, unit));
          el('div', 'settle-note', box);
          const row = el('div', 'row', box);
          button('act soft', row, '回选桌', () => {
            closeDialog();
            lobby();
          });
          button('act go', row, '再来一场', () => {
            closeDialog();
            void startSolo(prefs.stakes, prefs.opts);
          });
        }, false);
        play((v.result?.seats[v.me!.seat]?.net ?? 0) >= 0 ? 'win' : 'lose');
        return;
      }
      dialog(stage, 'end', (box) => {
        box.appendChild(roundSummary(v, names, unit));
        button('act go', box, '下一局', () => {
          closeDialog();
          solo?.next();
        });
      }, false);
    }, TURBO ? 50 : 1_400 * (prefs.fast ? 0.5 : 1));
  },
  settled(r: WalletReply): void {
    const box = document.querySelector('.settle-note');
    const text = r.ok
      ? `已结回钱包${r.credited !== undefined ? ` ${num(r.credited)}` : ''}${r.capped ? `；今天单机实盘赢够了，多出的 ${num(r.capped)} 没进钱包，好友房不限` : ''}`
      : walletError(r.error).text;
    if (box) box.textContent = text;
    void refreshWallet();
  },
};

/** 冒烟用：?turbo 让电脑几乎不停顿（npm run smoke） */
const TURBO = new URLSearchParams(location.search).has('turbo');

function playSolo(s: Solo): void {
  solo = s;
  s.speed = TURBO ? 0.01 : prefs.fast ? 0.5 : 1;
  paintTop();
  closeDialog();
  screen.className = 'screen game';
  screen.replaceChildren();
  const st = stakesOf(s.stakes)!;
  title.textContent = `${VARIANT_NAME['sichuan-xuezhan']} · ${st.wallet ? `实盘 ${num(st.share)}` : '娱乐'}`;
  table = new TableUi<XzView, XzAction>(screen, xuezhanUi, (a: CommonAct | XzAction) => {
    const err = s.act(a as XzAction);
    if (err && err !== 'busy') play('click');
  });
  lastPrompt = false;
  s.resume();
  if (!localStorage.getItem(GUIDE_KEY)) showGuide(stage);
}

/** 轮到我（出现了要我做的事）：提示音、振动，页面在后台时标题闪 */
function alertTurn(v: XzView): void {
  const now = !!v.prompt && v.phase !== 'swap' && v.phase !== 'que';
  if (now && !lastPrompt) {
    play('turn');
    navigator.vibrate?.(60);
    if (document.hidden) flashTitle();
  }
  lastPrompt = now;
}

let flashing = 0;
function flashTitle(): void {
  if (flashing) return;
  const base = document.title;
  let on = false;
  flashing = window.setInterval(() => {
    on = !on;
    document.title = on ? '【轮到你了】' : base;
  }, 800);
  const stop = (): void => {
    if (document.hidden) return;
    window.clearInterval(flashing);
    flashing = 0;
    document.title = base;
    document.removeEventListener('visibilitychange', stop);
  };
  document.addEventListener('visibilitychange', stop);
}

/** 电脑的台词：只由公开的事触发（胡了、点炮、杠），和手牌无关 */
function chatter(v: XzView): void {
  if (!table) return;
  for (const e of v.events) {
    let seat = -1;
    let pool: number[] = [];
    if (e.e === 'hu' && e.seat !== 0) [seat, pool] = [e.seat, [1, 8, 0]];
    else if (e.e === 'hu' && e.from !== null && e.from !== 0) [seat, pool] = [e.from, [10, 13, 2]];
    else if (e.e === 'kan' && e.seat !== 0) [seat, pool] = [e.seat, [5, 0]];
    else if (e.e === 'pon' && e.seat !== 0) [seat, pool] = [e.seat, [4, 6]];
    if (seat < 0 || Math.random() > 0.45) continue;
    const say = pool[Math.floor(Math.random() * pool.length)]!;
    window.setTimeout(() => table?.bubble(seat, PHRASES[say]!), 500);
  }
}

/** 好友房里离开：开打了先确认（实盘马上结回），座位交给电脑 */
async function leaveRoom(): Promise<void> {
  const s = online!.state;
  const v = s.view;
  const playing = s.room?.status === 'playing' && v && !v.done && s.you?.seat !== null && s.you?.seat !== undefined;
  if (playing) {
    const wallet = stakesOf(v.stakes)?.wallet;
    const ok = await confirmBox(stage, wallet ? '现在离开会马上把手上的筹码结回钱包，座位交给电脑接着打。离开吗？' : '离开后座位交给电脑接着打。离开吗？', '离开', '接着打');
    if (!ok) return;
    online!.leaveSeat();
    // 等房间收到离座再断开（结回由房间办，断开也不影响）
    await new Promise((r) => window.setTimeout(r, 300));
  }
  lobby();
}

async function leave(): Promise<void> {
  if (online) return leaveRoom();
  if (!solo) return lobby();
  const st = stakesOf(solo.stakes)!;
  const over = solo.save.state.phase === 'over';
  if (!over) {
    const ok = await confirmBox(stage, st.wallet ? '现在离开会马上结算：按手上的筹码结回钱包。离开吗？' : '这一场还没打完，离开就不算了。离开吗？', '离开', '接着打');
    if (!ok) return;
    const s = solo;
    await s.leave();
    lobby();
    // 结回没成（断网、平台忙）：说清楚下次会自动再结（自审 C2）
    if (st.wallet && !s.save.done) showError('筹码这次没结回钱包（网络不好）。下次打开雀馆会自动再结，按你离开时手上的数，不会少。');
    return;
  }
  lobby();
}

// 对局中点"大厅"先确认一次（实盘马上结算）
home.addEventListener('click', (e) => {
  if (online) {
    e.preventDefault();
    void leaveRoom().then(() => {
      if (!online) location.href = '/';
    });
    return;
  }
  if (!solo || solo.save.state.phase === 'over') return;
  e.preventDefault();
  void leave().then(() => {
    if (!solo) location.href = '/';
  });
});

// ---------- 开始 ----------

void (async () => {
  paintTop();
  await Promise.all([loadMe(), refreshWallet()]);
  // 朋友发来的房间链接（登录后平台按 next 原样带回来）、刷新：直接进房。
  // 平台大厅的"好友房"按钮带 ?online=1：直接摆出开房、进房（用完就从地址栏去掉，刷新不再亮）
  const q = new URLSearchParams(location.search);
  const code = q.get('room');
  const friends = q.get('online') === '1';
  if (q.has('online')) {
    const u = new URL(location.href);
    u.searchParams.delete('online');
    history.replaceState(null, '', u);
  }
  if (code && /^\d{6}$/.test(code)) return enterRoom(code, false);
  lobby(friends);
  // 上一场单机实盘离开时没结上：打开就自动再结一次（自审 C2）
  const left = loadSolo();
  if (left?.settle && !left.done) void settleLeftover(new Solo(left, quietUi));
  if (!localStorage.getItem(GUIDE_KEY) && !loadSolo()) showGuide(stage);
})();

