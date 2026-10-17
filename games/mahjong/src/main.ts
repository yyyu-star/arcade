/**
 * 页面入口：选桌页、好友房的等人页、牌桌，接钱包、单机、好友房、声音和看得见的区域。
 * 规则在 src/core，单机的流程在 solo.ts，好友房的连接在 online.ts，这里只把它们和画面连起来。
 */
import { createRoom, detectPlatform, withNickname, type PlatformInfo } from 'arcade-kit/client';
import { inviteUrl, mountSocial, openInvite, type Invite, type Presence, type SocialHandle } from 'arcade-kit/social';
import { DEFAULT_OPTS, type XzAction, type XzOpts, type XzView } from './core/variants/sichuan-xuezhan/index.ts';
import { stakesOf, type StakesId } from './game/stakes.ts';
import { getWallet, maybeApplied, randomId, type WalletReply, type WalletView } from './net/wallet.ts';
import { createError, Online, roomUrl, type OnlineState } from './online.ts';
import { PERSONAS } from './ai/personas.ts';
import { funMoments, highlightsOf, momentsOf, type Highlight } from './game/banter.ts';
import { SEATS, type RoomView } from './room/rules.ts';
import { loadSolo, newSolo, Solo, unsettled } from './solo.ts';
import { closeDialog, confirmBox, dialog, dialogHooks } from './view/dialog.ts';
import { button, el } from './view/dom.ts';
import { GUIDE_KEY, rotateTip, showGuide, showRules } from './view/guide.ts';
import { createFun, funOff, setFunOff } from './view/fun.ts';
import type { FunSeat, FunTemper, TableFun } from 'arcade-kit/table-fun';
import { renderLobby } from './view/lobby.ts';
import { renderWaiting, roomNotice, type Watching } from './view/room.ts';
import { play, setSound, setVolume, unlockAudio } from './view/sound.ts';
import { TableUi, type CommonAct, type SeatMeta } from './view/table.ts';
import { cardOf, prepareCard } from './view/share.ts';
import { GAME_NAME, HIGHLIGHT_NAME, LEVEL_NAME, num, STAKES_NAME, VARIANT_NAME, walletError } from './view/text.ts';
import { LEVELS, type Level } from './ai/venues.ts';
import { fameSummary, matchSummary, roundSummary } from './view/variants/sichuan-xuezhan/summary.ts';
import { xuezhanUi } from './view/variants/sichuan-xuezhan/ui.ts';
import { watchViewport } from './view/viewport.ts';
import './view/style.css';
import './view/art.css';
import { installArt } from './view/art.ts';
import { wallUrl } from './view/tiles.ts';

// ---------- 设置 ----------

const PREFS_KEY = 'mahjong.prefs';
interface Prefs {
  sound: boolean;
  /** 总音量 0–1（静音另算：sound 关着时一点声音都不出） */
  volume: number;
  fast: boolean;
  stakes: StakesId;
  /** 单机娱乐的难度：第一次玩默认新手 */
  level: Level;
  opts: XzOpts;
}

function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
    const vol = typeof p.volume === 'number' && p.volume >= 0 && p.volume <= 1 ? p.volume : 0.8;
    const level = LEVELS.includes(p.level as Level) ? (p.level as Level) : 'easy';
    return { sound: p.sound !== false, volume: vol, fast: p.fast === true, stakes: stakesOf(p.stakes)?.id ?? 'fun', level, opts: { ...DEFAULT_OPTS, ...(p.opts ?? {}) } };
  } catch {
    return { sound: true, volume: 0.8, fast: false, stakes: 'fun', level: 'easy', opts: { ...DEFAULT_OPTS } };
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
setVolume(prefs.volume);
// 牌桌、选桌页的画（art.css 用的 --art-* 变量）
installArt();
// 牌墙的立体牌背：只生成一次，写成变量给 style.css 的 .opp-hand .back 用
document.documentElement.style.setProperty('--wall-h', `url("${wallUrl('h')}")`);
document.documentElement.style.setProperty('--wall-v', `url("${wallUrl('v')}")`);

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
// 声音：点"声"打开一个小面板（音量滑块 + 静音），再点或点别处收起
const soundBtn = button('icon', top, '', () => {
  volBox.hidden = !volBox.hidden;
});
const volBox = el('div', 'vol', stage);
volBox.hidden = true;
const volRange = el('input', '', volBox) as HTMLInputElement;
volRange.type = 'range';
volRange.min = '0';
volRange.max = '100';
volRange.value = String(Math.round(prefs.volume * 100));
volRange.setAttribute('aria-label', '音量');
volRange.addEventListener('input', () => {
  prefs.volume = Number(volRange.value) / 100;
  setVolume(prefs.volume);
  if (prefs.volume > 0 && !prefs.sound) {
    prefs.sound = true;
    setSound(true);
  }
  paintTop();
});
volRange.addEventListener('change', () => {
  savePrefs();
  play('button');
});
const muteBtn = button('act soft', volBox, '', () => {
  prefs.sound = !prefs.sound;
  setSound(prefs.sound);
  savePrefs();
  paintTop();
});
// 互动的总开关也放这儿（docs/table-fun.md 第 5 节）：关了别人的一律不播，单机电脑也不反应
const funBtn = button('act soft', volBox, '', () => {
  setFunOff(!funOff());
  if (funOff()) fun?.closeAll();
  paintTop();
});
document.addEventListener('pointerdown', (e) => {
  if (!volBox.hidden && !volBox.contains(e.target as Node) && e.target !== soundBtn) volBox.hidden = true;
});
button('icon', top, '规则', () => showRules(stage));
const shareBtn = button('pill share', top, '叫朋友', () => share());
const leaveBtn = button('pill leave', top, '离开', () => void leave());
const screen = el('div', 'screen', stage);

function paintTop(): void {
  speedBtn.textContent = prefs.fast ? '快' : '慢';
  speedBtn.title = prefs.fast ? '电脑出牌快' : '电脑出牌慢';
  soundBtn.textContent = prefs.sound && prefs.volume > 0 ? '声' : '静';
  muteBtn.textContent = prefs.sound ? '静音' : '开声';
  funBtn.textContent = funOff() ? '互动：不看' : '互动：开';
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
// 按钮点按一律轻响一下（手牌出牌有自己的声音，不在这里）
document.addEventListener('click', (e) => {
  const b = (e.target as Element | null)?.closest('button');
  if (b && !b.disabled) play('button');
});

// ---------- 钱包 ----------

let wallet: WalletView | null = null;
let walletNote: string | null = null;

async function refreshWallet(): Promise<void> {
  // 单独部署没有平台钱包：不问，实盘也不摆
  if (standalone) return;
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
/**
 * 单独部署（没有平台，kit 的 detectPlatform 回 false）：没有登录、钱包和实盘，"大厅"回游戏首页，好友房用游客身份（昵称自己填，存 NICK_KEY）。
 * 平台暂时连不上（unknown）照有平台处理：实盘按钱包连不上不给选，和原来一样
 */
let standalone = false;
const NICK_KEY = 'mahjong.nick';
function nick(): string {
  try {
    return localStorage.getItem(NICK_KEY) ?? '';
  } catch {
    return '';
  }
}
function setNick(name: string): void {
  try {
    if (name) localStorage.setItem(NICK_KEY, name);
    else localStorage.removeItem(NICK_KEY);
  } catch {
    // 存不上就这一次有效
  }
  myName = name || '我';
}

/** detectPlatform 的结果：social 部件直接用，省一次 /api/me */
let platformInfo: PlatformInfo | undefined;

async function loadMe(): Promise<void> {
  const p = await detectPlatform();
  platformInfo = p;
  if (p.platform === false) {
    standalone = true;
    myName = nick() || '我';
    home.href = './';
    home.querySelector('span')!.textContent = '首页';
    if (prefs.stakes !== 'fun') prefs.stakes = 'fun';
    return;
  }
  const name = p.platform === true ? (p.user as { displayName?: unknown } | null)?.displayName : undefined;
  if (typeof name === 'string' && name) myName = name;
}

/** 开房、进房的地址：单独部署时带上昵称（服务端会清洗，不合格就叫"游客1234"） */
const withNick = (url: string): string => (standalone ? withNickname(url, nick()) : url);

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
  // 从房间回来：马上告诉好友我不在房里了
  if (reported !== null) {
    reported = null;
    social?.presenceNow(true);
  }
  stopFollow();
  arrive = null;
  solo?.stop();
  solo = null;
  online?.close();
  online = null;
  dropFun();
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
    level: prefs.level,
    opts: prefs.opts,
    canResume: loadSolo() !== null,
    onSolo: startSolo,
    onResume: () => void resumeSolo(),
    onRules: () => showRules(stage),
    onRoom: openRoom,
    onJoin: (code) => (/^\d{6}$/.test(code) ? enterRoom(code, false) : toast('房间号是 6 位数字')),
    friends,
    ...(standalone ? { standalone: { nick: nick(), onNick: setNick } } : {}),
  });
}

async function startSolo(stakes: StakesId, opts: XzOpts, level: Level = prefs.level): Promise<void> {
  prefs.stakes = stakes;
  prefs.level = level;
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
  if (!st.wallet) return playSolo(new Solo(newSolo(stakes, opts, myName, null, chips, level), soloUi));
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
/** 牌桌互动（单机、好友房同一个） */
let fun: TableFun | null = null;
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
  const r = await createRoom(withNick('rooms'), { variant: 'sichuan-xuezhan', stakes, rules: opts });
  if ('error' in r) return showError(createError(r.error), r.error === 'login' ? 'refresh' : undefined);
  enterRoom(r.code, true);
}

function enterRoom(code: string, host: boolean, from: { seat: number; sit: boolean } | null = null): void {
  stopFollow();
  arrive = from;
  solo?.stop();
  solo = null;
  online?.close();
  dropFun();
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
  online = new Online(code, onlineUi, { url: withNick(roomUrl(code)) });
  paintTop();
}

const onlineUi = {
  draw(s: OnlineState, fresh: boolean): void {
    paintTop();
    if (!s.room) return;
    // 进了房间（房间信息到了才知道几个人）：马上报一次位置
    if (reported !== s.code) {
      reported = s.code;
      social?.presenceNow(true);
    }
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
    fun?.receive(seat, id, to);
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
    onShare: () => share(),
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
    rotateTip(stage);
    lastPrompt = false;
    fame = [];
    fun = newFun(
      table,
      () => online?.state.you?.seat ?? null,
      (seat) => (online?.state.room?.seats[seat]?.kind === 'ai' ? (PERSONAS[(online.state.view?.g as XzView | undefined)?.seats[seat]?.persona ?? -1]?.fun ?? 'normal') : null),
      (id, to) => online?.emote(id, to),
      s.code,
      false,
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
  const n = roomNotice(rv, seat, () => online?.rebuy(), seat === null ? watching(s, g) : null);
  if (n) table.root.appendChild(n);
  fun?.refresh();
  if (!replay) publicMoments(v, seatMetas(s, g).map((x) => x.name), false);
  alertTurn(v);
  roomRoundEnd(s, rv, g, replay);
}

/** 没入座：回自己坐过的座位，或者能接管的电脑座位（没绑人的；实盘房间旁观只看，不给坐） */
function watching(s: OnlineState, g: XzView): Watching {
  const metas = seatMetas(s, g);
  return {
    back: s.you?.bound ?? null,
    free: s.room!.seats.flatMap((x, i) => (x.kind === 'ai' && !x.reserved ? [{ seat: i, name: metas[i]!.name }] : [])),
    wallet: !!stakesOf(s.view?.stakes)?.wallet,
    onSit: (seat) => online?.sit(seat),
  };
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
        if (fame.length) box.appendChild(fameSummary(fame, names));
        if (rv.cut) el('div', 'settle-note', box, '只剩一个人在下注，实盘这一场提前结束（实盘至少要两个人）');
        if (wallet) el('div', 'settle-note', box, '桌上的筹码已经结回钱包');
        else if (rv.unrated) el('div', 'settle-note', box, '实盘只有一个人，这一场不计输赢、没动钱包');
        const row = el('div', 'row end-acts', box);
        button('act soft', row, '回选桌', () => {
          closeDialog();
          lobby();
        });
        // 分享卡带房间码：房间已经结束的话，朋友打开就是游戏首页
        shareButton(row, g, `好友房 · ${wallet ? `实盘${STAKES_NAME[rv.stakes]}档` : '娱乐'} · ${g.opts.rounds} 局`, wallet, new URL(`?room=${s.code}`, location.href).toString());
        // 再来一场：我开个同样规则的新房间，这一桌跟过来。房间等 3 分钟，过了再点就自己先去新房间、再叫朋友
        if (me !== null && s.room?.seats[me]?.kind === 'human' && !rv.next) {
          const b = button('act go rematch', row, '再来一场', () => void rematch(b));
          if (stakesOf(rv.stakes)?.wallet) el('p', 'room-hint', box, '新房间里各人自己坐下，开打时才从钱包带一份');
        }
      }, false);
      if (g.me) play((g.result?.seats[g.me.seat]?.net ?? 0) >= 0 ? 'win' : 'lose');
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

/** 结算页的"分享"（docs/social.md 1.1）：只有坐着打完的人有（旁观的没有自己的战绩） */
function shareButton(row: HTMLElement, v: XzView, title: string, wallet: boolean, url: string): void {
  const card = cardOf(v, { title, unit: wallet ? '筹码' : '分', name: myName, fame });
  if (!card) return;
  // 结算页出来就画好，点的那一下直接调系统分享（iOS 要求，见 view/share.ts）
  const p = prepareCard(card, url);
  button('act soft share-card', row, '分享', () => void p.share());
}

async function rematch(b: HTMLButtonElement): Promise<void> {
  const opts = online?.state.opts;
  if (!online || !opts) return;
  b.disabled = true;
  const r = await createRoom(withNick('rooms'), opts);
  if ('error' in r) {
    b.disabled = false;
    return toast(createError(r.error));
  }
  // 先把房间号发给这一桌（关连接前发出去的会先送到），自己马上过去当房主坐 0 号
  online.next(r.code);
  enterRoom(r.code, true);
}

/**
 * 叫朋友来（docs/social.md 1.3，kit 的"叫朋友来"面板）：登录了列好友、每人一个"叫他来"，底下复制邀请链接；
 * 单独部署、没登录（social 没挂上）只有复制邀请链接（能系统分享就分享）。链接带房间号，朋友点开登录后直接进房
 */
function share(): void {
  if (!online) return;
  const code = online.state.code;
  const log = import.meta.env.DEV ? (l: string) => ((window as { __socialLog?: string[] }).__socialLog ??= []).push(l) : undefined;
  const o = { game: GAME_ID, room: code, url: new URL(`?room=${code}`, location.href).toString(), text: `来${GAME_NAME}打一把，房间号 ${code}`, ...(log ? { log } : {}) };
  if (social) social.openInvite(o);
  else openInvite({ ...o, friends: false });
}

// ---------- 牌桌（单机） ----------

let lastPrompt = false;

const soloUi = {
  frame(v: XzView, names: string[]): void {
    if (!table) return;
    table.render({ v, seats: names.map((name, i): SeatMeta => ({ name, bot: i !== 0 })) });
    fun?.refresh();
    publicMoments(v, names, true);
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
          if (fame.length) box.appendChild(fameSummary(fame, names));
          el('div', 'settle-note', box);
          const row = el('div', 'row', box);
          button('act soft', row, '回选桌', () => {
            closeDialog();
            lobby();
          });
          const st = stakesOf(mine.stakes)!;
          const kind = st.wallet ? `实盘${STAKES_NAME[st.id]}档` : `娱乐·${LEVEL_NAME[mine.save.level ?? 'easy']}`;
          shareButton(row, v, `${kind} · ${v.opts.rounds} 局`, !!st.wallet, `${location.origin}${location.pathname}`);
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
    if (r.ok) play('chips');
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
  title.textContent = `${VARIANT_NAME['sichuan-xuezhan']} · ${st.wallet ? `实盘 ${num(st.share)}` : `娱乐·${LEVEL_NAME[s.save.level ?? 'easy']}`}`;
  table = new TableUi<XzView, XzAction>(screen, xuezhanUi, (a: CommonAct | XzAction) => {
    const err = s.act(a as XzAction);
    if (err && err !== 'busy') play('click');
  });
  rotateTip(stage);
  lastPrompt = false;
  fame = [];
  dropFun();
  const kinds = s.save.state.kinds;
  const personas = s.save.state.personas;
  // 单机没有房间：自己发的直接交回组件播，电脑怎么回由组件按 kit 的 botReact 算
  fun = newFun(table, () => 0, (seat) => (kinds[seat] === 'ai' ? (PERSONAS[personas[seat]!]?.fun ?? 'normal') : null), (id, to) => fun?.receive(0, id, to), 'solo', true);
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

// ---------- 互动（kit 的 table-fun，单机、好友房同一套，见 view/fun.ts） ----------

/** 这一场的名场面（一场的总结算里列出来） */
let fame: Highlight[] = [];
/** 名场面横幅等胡牌的牌面放完再挂 */
const funTimers = new Set<number>();

/**
 * 接上牌桌：头像矩形、名字、谁是电脑和互动性格每次现问牌桌；temper 给电脑座位的性格（真人 null）。
 * 自己的弹窗打开时把互动藏起来（菜单、热区盖在弹窗上面会挡点击）
 */
function newFun(t: TableUi<XzView, XzAction>, me: () => number | null, temper: (seat: number) => FunTemper | null, send: (id: number, to?: number) => void, scope: string, localBots: boolean): TableFun {
  const f = createFun({
    seats: () =>
      [0, 1, 2, 3].map((seat): FunSeat | null => {
        const m = t.seatMeta(seat);
        if (!m || m.empty) return null;
        const tp = temper(seat);
        return { rect: t.avatarRect(seat), name: m.name, me: seat === me(), bot: m.bot, ...(tp ? { temper: tp } : {}) };
      }),
    avoid: () => t.avoidRects(),
    button: () => (me() === null ? null : t.funSlot()),
    send,
    canSend: () => me() !== null,
    scope: () => scope,
    localBots,
  });
  dialogHooks({ open: () => f.hide(), close: () => f.show() });
  // 冒烟按 kit 的 controls() 点（开发服务器上才挂）
  if (import.meta.env.DEV) (window as { __fun?: TableFun }).__fun = f;
  return f;
}

function dropFun(): void {
  for (const t of funTimers) window.clearTimeout(t);
  funTimers.clear();
  dialogHooks({ open() {}, close() {} });
  fun?.destroy();
  fun = null;
}

/** 两边都有的：有名场面就挂横幅（胡牌的牌面先放完）、记进这一场；单机里再交给 kit 让电脑起哄（好友房的电脑在房间里起哄） */
function publicMoments(v: XzView, names: string[], local: boolean): void {
  const hus = v.events.filter((e) => e.e === 'hu').length;
  for (const h of highlightsOf(v.events, v.round, v.opts.cap)) {
    fame.push(h);
    const t = window.setTimeout(() => {
      funTimers.delete(t);
      fun?.banner(HIGHLIGHT_NAME[h.id], names[h.seat] ?? '');
    }, 600 + hus * 2_400);
    funTimers.add(t);
  }
  if (!local || !fun) return;
  for (const ev of funMoments(momentsOf(v.events), v.seats.map((x) => !x.won), v.round)) fun.moment(ev);
}

/** 好友房里离开：开打了先确认（实盘这一局由电脑替他打完再结回），座位交给电脑 */
async function leaveRoom(): Promise<void> {
  const s = online!.state;
  const v = s.view;
  const playing = s.room?.status === 'playing' && v && !v.done && s.you?.seat !== null && s.you?.seat !== undefined;
  if (playing) {
    const wallet = stakesOf(v.stakes)?.wallet;
    const ok = await confirmBox(stage, wallet ? '现在离开，这一局由电脑替你打完（输赢照算），打完这一局把筹码结回钱包。离开吗？' : '离开后座位交给电脑接着打。离开吗？', '离开', '接着打');
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
      if (!online) location.href = home.href;
    });
    return;
  }
  if (!solo || solo.save.state.phase === 'over') return;
  e.preventDefault();
  void leave().then(() => {
    if (!solo) location.href = home.href;
  });
});

// ---------- 好友：报位置、收邀请（docs/social.md 1.2、1.3，kit 的 arcade-kit/social；没平台、没登录时不挂） ----------

/** 模块 id（平台登记、邀请链接 /games/<id>/ 用的就是它） */
const GAME_ID = 'mahjong';
let social: SocialHandle | null = null;
/** 上次报的是哪个房间（null：不在房间） */
let reported: string | null = null;

/** 我在哪：好友房里报房间号和几个真人，别的时候是"在玩雀馆" */
function whereAmI(): Presence {
  const s = online?.state;
  if (!s?.room) return { place: 'game', game: GAME_ID };
  const humans = s.room.seats.filter((x) => x.kind === 'human').length;
  return { place: 'room', game: GAME_ID, room: s.code, seats: `${humans}/${s.room.seats.length}` };
}

/** 点邀请的"去"：打到一半先照常确认离开（实盘的结回照旧），取消了就留下 */
async function goInvite(inv: Invite): Promise<void> {
  if (online) await leaveRoom();
  else if (solo && solo.save.state.phase !== 'over') await leave();
  if (online || (solo && solo.save.state.phase !== 'over')) return;
  if (inv.game === GAME_ID) enterRoom(inv.room, false);
  else location.assign(inviteUrl(inv));
}

async function startSocial(): Promise<void> {
  const log = import.meta.env.DEV ? (l: string) => ((window as { __socialLog?: string[] }).__socialLog ??= []).push(l) : undefined;
  social = await mountSocial({
    ...(platformInfo ? { platform: platformInfo } : {}),
    where: whereAmI,
    // kit 不认识任何游戏；别的游戏叫什么只有平台知道，横条上就说"一起玩"
    gameName: (id) => (id === GAME_ID ? GAME_NAME : undefined),
    onGo: (inv) => void goInvite(inv),
    ...(log ? { log } : {}),
  });
}

// ---------- 开始 ----------

void (async () => {
  paintTop();
  // 先看有没有平台：单独部署时不去问钱包
  await loadMe();
  if (!standalone) void startSocial();
  await refreshWallet();
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

