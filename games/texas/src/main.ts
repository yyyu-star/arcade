/**
 * 页面入口：大厅（标题页）和牌桌两屏，接钱包、云存档、声音和看得见的区域。
 * 规则在 src/core，流程在 solo.ts，这里只把它们和画面连起来。
 */
import { CLOSE } from 'arcade-kit/protocol';
import { stakesOf, type StakesId } from './core/stakes.ts';
import type { Action, Table } from './core/table.ts';
import { view, type View } from './core/view.ts';
import { createCloud, type Cloud } from './net/cloud.ts';
import { createError, createRoom, isRoomCode, Online, type OnlineState, type OnlineUi, type SavedRoom } from './online.ts';
import { OPENING_MS, PROP_BASE, STICKER_BASE, TAUNT_COUNT, TURN_MS, type RoomView } from './room/rules.ts';
import { getWallet, relief as reliefApi, texasStakes, walletApi, walletError, type WalletApi, type WalletReply, type WalletView } from './net/wallet.ts';
import { KEYS, patchSettings, readJson, readSettings, remove, writeJson } from './store.ts';
import { ME, SESSION_KEY, Solo, type SoloDeps, type Step } from './solo.ts';
import { ActionBar } from './view/actions.ts';
import { myTurn, notMyTurn, tickUntil } from './view/alert.ts';
import { askTopUp, closeDialog, dialog } from './view/dialog.ts';
import { roomSummary, soloSummary, type RoomSummaryRow } from './view/summary.ts';
import { el, setText, toggle } from './view/dom.ts';
import { Lobby } from './view/lobby.ts';
import { createFunLayer, PROPS, propSvg, showSticker, STICKERS, stickerSvg, throwAt, type PropId } from 'arcade-kit/fun';
import { loadFun, saveFun, suggest, TAUNTS } from './view/fun.ts';
import { readLines, Reads, styleTag } from './view/reads.ts';
import { RoomPanel } from './view/room.ts';
import { funSound, play, setSound, unlockAudio } from './view/sound.ts';
import { TableView } from './view/table.ts';
import { chips, personaName } from './view/text.ts';
import { handOver, showcase, showcaseText, Tally } from './view/titles.ts';
import { watchViewport } from './view/viewport.ts';
import './view/style.css';

interface Settings {
  sound: boolean;
  fast: boolean;
  /** 单机一手打完，结果摆几秒后自己发下一手（默认关：所有者要"点了才发"） */
  autoNext: boolean;
}

function loadSettings(): Settings {
  const s = readSettings() as Partial<Settings>;
  return { sound: s.sound !== false, fast: s.fast === true, autoNext: s.autoNext === true };
}
function saveSettings(): void {
  patchSettings({ ...settings });
}

const settings = loadSettings();
setSound(settings.sound);
const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const pace = (): number => (reduced ? 0.3 : settings.fast ? 0.55 : 1);
/** 自动下一手：结果摆这么久再发（按动画快慢缩放） */
const AUTO_NEXT_MS = 3_500;

// ---------- 骨架 ----------

const app = document.getElementById('app')!;
const stage = el('div', 'stage', app);
const top = el('div', 'topbar', stage);
const home = el('a', 'home', top);
home.href = '/';
home.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11 12 3l9 8v10h-6v-6H9v6H3z"/></svg><span>大厅</span>';
const where = el('span', 'where', top);
const walletChip = el('span', 'wallet-chip', top);
el('span', 'spacer', top);
const cloudBtn = el('button', 'icon cloud', top);
cloudBtn.type = 'button';
cloudBtn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 18h10a4 4 0 0 0 .6-7.95A6 6 0 0 0 6.1 9.1 4.5 4.5 0 0 0 7 18z"/></svg><i class="dot"></i>';
const speedBtn = el('button', 'icon speed', top);
speedBtn.type = 'button';
const soundBtn = el('button', 'icon sound', top);
soundBtn.type = 'button';
const leaveBtn = el('button', 'pill leave', top, '离桌');
leaveBtn.type = 'button';

const screen = el('div', 'screen', stage);
/** 好友房的乐子（0.3.0）：总开关、屏蔽了谁（本机 texas.fun） */
const fun = loadFun(localStorage);
/** kit 的道具、表情层（挂在 body 上；德州弹窗开着时 CSS 收起） */
const funLayer = createFunLayer();
/**
 * 表情包盖在头像上（头像"做表情"）：kit 默认冒在头像右上方，那里不是这个人亮出来的牌、就是动作标签或者屏幕上沿
 * （0.3.0 实打截图 03、07）。kit 按矩形中心往右上偏 0.45、0.55 个头像，这里先反着挪回来
 */
const onFace = (r: DOMRect): DOMRect => new DOMRect(r.x - r.width * 0.45, r.y + r.height * 0.55, r.width, r.height);
const tableView = new TableView(screen, {
  myName: () => myName,
  pace,
  onSeat: (i) => void takeSeat(i),
  quiet: () => fun.off,
  // 电脑说话配的表情包，和真人发的同一套（kit 的 STICKERS）
  sticker: (seat, id) => {
    const r = tableView.avatarRect(seat);
    if (r && !fun.off) void showSticker(funLayer, onFace(r), id);
  },
  bombIcon: () => propSvg('bomb'),
});
/** 看对手（0.2.2）：每个座位这一场的数，点头像看 */
const reads = new Reads();
/** 称号（0.3.0）：这一场公开发生的事，好友房结算页给 */
const tally = new Tally();
const hud = el('div', 'hud', screen);
const handNo = el('span', 'hand-no', hud);
const topUpBtn = el('button', 'pill', hud, '补码');
topUpBtn.type = 'button';
const sitBtn = el('button', 'pill', hud, '歇一手');
sitBtn.type = 'button';
// 好友房：离座以后回到自己的座位；没坐下的人看着时的提示
const backSeatBtn = el('button', 'pill go hidden', hud, '回到我的座位');
backSeatBtn.type = 'button';
const spectate = el('span', 'spectate hidden', hud, '点亮着蓝圈的电脑座位接管它，下一手起用你自己的筹码');
// 好友房嘲讽（0.3.0）：左下角一个按钮开面板；一手打完按公开发生的事冒 1–2 句提示，一点就发。都在左下，不挡底牌和操作区
const funBtn = el('button', 'pill fun-btn hidden', hud, '嘲讽');
// 开打以后也能叫人（0.3.0）：朋友点开链接看着，点亮着的电脑座位就能接管
const inviteBtn = el('button', 'pill invite-btn hidden', hud, '叫朋友来');
inviteBtn.type = 'button';
inviteBtn.addEventListener('click', () => void invite());
funBtn.type = 'button';
const funHints = el('div', 'fun-hints hidden', hud);
// 面板三个页签（0.3.0）：嘲讽、表情、道具。点别人头像打开时带着"对谁"：嘲讽点名、道具扔给他
const funPanel = el('div', 'fun-panel hidden', screen);
const fpHead = el('div', 'fp-head', funPanel);
const FUN_TABS = [
  ['taunt', '嘲讽'],
  ['sticker', '表情'],
  ['prop', '道具'],
] as const;
type FunTab = (typeof FUN_TABS)[number][0];
const fpTabs = new Map<FunTab, HTMLButtonElement>();
for (const [k, label] of FUN_TABS) {
  const b = el('button', 'fp-tab', fpHead, label);
  b.type = 'button';
  b.addEventListener('click', () => openFun(k, funTarget));
  fpTabs.set(k, b);
}
const fpTo = el('span', 'fp-to', fpHead);
const funGrid = el('div', 'fp-grid', funPanel);
const funOff = el('label', 'fp-off', funPanel);
const funOffBox = el('input', '', funOff);
funOffBox.type = 'checkbox';
el('span', '', funOff, '不看嘲讽和道具（电脑说话也不看）');
let funTab: FunTab = 'taunt';
let funTarget: number | null = null;
// 两手之间（0.1.1）：单机一手打完停着，点"下一手"才发（开着"自动下一手"时倒数几秒自己发）；好友房是房间定的停顿，大家看同一个倒计时
const RING = '<svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" pathLength="100"/></svg>';
const betweenBar = el('div', 'between hidden', screen);
const roomPause = el('div', 'room-pause hidden', betweenBar);
roomPause.innerHTML = `${RING}<span>下一手马上开始</span>`;
const autoBtn = el('button', 'auto-next', betweenBar, '自动下一手');
autoBtn.type = 'button';
const nextBtn = el('button', 'next-hand', betweenBar);
nextBtn.type = 'button';
nextBtn.innerHTML = `<span class="next-ring hidden">${RING}</span><span>下一手</span>`;
// 好友房带入被拒（0.2.5）：一直挂在我的座位上面，写清楚为什么、怎么办，点了重新带入。原来只弹一句，人就卡在空座位上
const rebuyBox = el('div', 'rebuy-cta hidden', screen);
const rebuyText = el('span', 'rc-why', rebuyBox);
const rebuyWallet = el('a', 'rc-link hidden', rebuyBox, '去钱包');
rebuyWallet.href = '/wallet';
const rebuyBtn = el('button', 'rc-go', rebuyBox);
rebuyBtn.type = 'button';
rebuyBtn.addEventListener('click', () => online?.act({ t: 'rebuy', ...(rebuyAmount ? { amount: rebuyAmount } : {}) }));
const toastEl = el('div', 'toast', stage);
const bar = new ActionBar(screen, (a) => void act(a), (r) => tableView.avoid(r));
const lobby = new Lobby(stage, { start, resume, relief, openRoom, joinRoom, backToRoom });
const roomPanel = new RoomPanel(stage, {
  sit: (i) => online?.sit(i),
  start: () => online?.start(),
  invite: () => void invite(),
  leave: () => void leaveRoom(false),
  retry: () => online?.retry(),
});
el('div', 'rotate', app).innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="14" y="6" width="20" height="36" rx="3"/><path d="M38 30a14 14 0 0 1-10 10m10-10-4 1m4-1 1 4"/></svg><span>把手机横过来玩</span>';

const getFit = watchViewport(app, stage, (f) => tableView.layout(f.w));
tableView.layout(getFit().w);

// ---------- 状态 ----------

let cloud: Cloud;
let myName = '我';
let wallet: WalletView | null = null;
let walletNote: string | null = null;
let solo: Solo | null = null;
/** 好友房（和单机不会同时开着） */
let online: Online | null = null;
/** 牌桌按这个人数、这个座位摆的（好友房里换了座位要重摆） */
let laidOut = { size: 0, me: -1 };
let lastRefused: string | null = null;
let wasBuying = false;
let animating = 0;
let busy = false;
let retryTimer = 0;
/** 自动下一手的倒计时（同一时间只有一个） */
let autoTimer = 0;
let countdown: Animation | null = null;
/** 输光了：结果先摆一会儿，再问补码 */
let bustTimer = 0;
/** 钱包里还有好友房那一份时，标题页隔一会儿再看一次钱包（结回了提示就收起） */
let stakeTimer = 0;

/** 钱包那一笔连不上（请求可能已经到了、只是回话丢了）：这一桌留在本机，隔这么久用同一个操作 id 再办 */
const RETRY_MS = 15_000;
const PENDING_NOTE = '钱包暂时连不上，稍后会自动重试';
const LOGIN_NOTE = '登录过期了：这一桌的筹码先记在本机，刷新页面登录后自动结回钱包';

const deps: SoloDeps = {
  wallet: tracked(walletApi),
  store: localStorage,
  entropy: () => Array.from(crypto.getRandomValues(new Uint32Array(8))),
  newId: () => crypto.randomUUID(),
  think,
  wait: (ms) => new Promise((ok) => window.setTimeout(ok, ms)),
  onStep,
};

/** 钱包的回话顺手记下最新余额 */
function tracked(api: WalletApi): WalletApi {
  const keep = (r: WalletReply): WalletReply => {
    if (r.ok) wallet = r.wallet;
    return r;
  };
  return {
    buyin: async (...a) => keep(await api.buyin(...a)),
    cashout: async (...a) => keep(await api.cashout(...a)),
  };
}

/**
 * 电脑想多久（0.1.1 所有者："看都看不清"）：看得清谁在想（头像上的光圈），每次不一样，像对面坐着个人。
 * 只按局面定快慢（翻牌前有没有人加注、要跟多少、第几轮），不按它的牌：快慢跟着牌走，就成了漏牌的信号。
 * - 翻牌前没人加注（只补一个大盲、过牌，或者弃）：顺手的事，0.25–0.5 秒（0.3.0 实打：原来弃牌也想 1.5–2.3 秒，
 *   大家都弃的一手也要 18–27 秒，6 人桌平均每手 41 秒、9 人桌 48 秒；目标 30 秒以内）；
 * - 其他：按性格 0.45–0.9 秒起，面对下注、翻牌以后多想一会儿；
 * - 难的决定（要跟的比池子大，或者占了手里三分之一以上）再想一会儿，最多 3.8 秒——久想本身就是个信号（0.2.3）
 */
function think(t: Table, seat: number): number {
  const s = t.seats[seat]!;
  const owe = Math.min(s.stack, t.currentBet - s.bet);
  // 7–9 人桌一圈要等七八个电脑：整体再快一档（0.3.0 连拍、实打量的）
  const crowd = t.seats.filter((x) => x.owner !== 'none').length >= 7 ? 0.7 : 1;
  if (t.board.length === 0 && owe <= t.bb) return (250 + Math.random() * 250) * crowd * pace();
  // 顺序同 PERSONAS：稳哥、阿飙、老好、慢慢、算盘、江湖、虎子、老鹰、叨叨、小白
  const base = [650, 450, 700, 900, 750, 600, 450, 600, 550, 800][s.persona] ?? 650;
  const facing = owe > 0 ? 300 : 0;
  const later = t.board.length ? 100 : 0;
  const pot = t.seats.reduce((a, x) => a + x.total, 0);
  const hard = owe > 0 && (owe >= pot || owe * 3 >= s.stack) ? 800 + Math.random() * 600 : 0;
  return Math.min(hard ? 3_800 : 2_200, (base + facing + later + Math.random() * 400) * crowd + hard) * pace();
}

// ---------- 大厅 ----------

async function boot(): Promise<void> {
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });
  drawTop();
  showLobby();
  cloud = createCloud({
    fetch: (...a) => fetch(...a),
    storage: localStorage,
    now: () => Date.now(),
    loggedInHint: () => /(?:^|;\s*)__Host-arcade_li=1/.test(document.cookie),
    setTimeout: (f, ms) => window.setTimeout(f, ms),
    clearTimeout: (h) => window.clearTimeout(h as number),
  });
  cloud.onChange(drawCloud);
  await Promise.all([cloud.start(), refreshWallet()]);
  drawCloud();
  await me();

  const s = Solo.load(localStorage, cloud.userId());
  if (s) {
    solo = new Solo(s, deps);
    // 上次有一笔没办完：用同一个操作 id 再办一次
    if (s.pending) await settlePending();
    if (solo && !s.practice && !s.pending && wallet && !texasStakes(wallet).some((x) => x.ref === s.id)) {
      // 钱包里已经没有这一桌了：单机只在本机结回，几乎都是放太久、平台原样退回了（15.10 的 expired）
      remove(SESSION_KEY);
      solo = null;
      walletNote = walletError('expired');
    }
  }
  // 邀请链接 ?room=123456 直接进；平台大厅的"好友房"按钮 ?online=1（和掼蛋同一个约定）。
  // 刷新前在房间里的不自动拉回去（0.2.3 所有者："每次进去自动进入一个房间…完全打不了"）：标题页给"回到房间"，点了才进
  const q = new URLSearchParams(location.search);
  const code = q.get('room');
  const wantOnline = q.get('online') === '1';
  if (q.has('room') || q.has('online')) history.replaceState(null, '', location.pathname);
  // 0.2.2 及以前"我开的房间"的记录：现在开房一律去开新的，旧记录清掉
  remove(KEYS.hosted);
  if (code && isRoomCode(code)) joinRoom(code);
  else if (wantOnline) lobby.showFriends();
  drawLobby();
}

/**
 * 办本机这一桌还没回话的那一笔。连不上就留着、隔一会儿自动再办；办完（或者钱包明确拒了）刷新钱包。
 * 第一笔买入被拒的，这一桌从没开过，直接作废
 */
async function settlePending(): Promise<void> {
  const s = solo;
  if (!s?.session.pending) return;
  window.clearTimeout(retryTimer);
  const err = await s.settle();
  if (!Solo.load(localStorage, cloud.userId())) solo = null;
  else if (!s.session.pending && !s.session.practice && s.table.seats[ME]!.owner === 'none') {
    remove(SESSION_KEY);
    solo = null;
  }
  await refreshWallet();
  if (s.session.pending && err === 'login') {
    // 登录过期：重试也是 401，等刷新登录后打开页面再结
    walletNote = LOGIN_NOTE;
  } else if (s.session.pending) {
    walletNote = PENDING_NOTE;
    retryTimer = window.setTimeout(() => void settlePending().then(drawLobby), RETRY_MS);
  } else if (err) walletNote = walletError(err);
}

async function me(): Promise<void> {
  try {
    const r = await fetch('/api/me', { headers: { accept: 'application/json' } });
    const b = (await r.json()) as { user?: { displayName?: string } | null };
    if (b.user?.displayName) myName = b.user.displayName;
  } catch {
    // 拿不到昵称就叫"我"
  }
}

async function refreshWallet(): Promise<void> {
  const r = await getWallet();
  wallet = r.ok ? r.wallet : null;
  walletNote = r.ok ? null : walletError(r.error, r.retryAfter, 'api');
  drawTop();
}

function showLobby(): void {
  stage.classList.remove('at-table');
  notMyTurn();
  closeDialog();
  drawLobby();
}

function drawLobby(): void {
  const s = solo?.session;
  // "回到房间"横幅只在两种时候有（0.2.3）：钱包里有好友房那一份（以 /api/wallet 的 stakes 为准）；
  // 或者刷新、关页面前还在房间里（没点"离开房间"，6 小时内）。点了才进，不点照常玩单机。
  // 平台 0.9.5 起德州可以同时有好几份（单机一份、每个房间各一份）：好友房的合起来说
  const rooms = texasStakes(wallet, 'server');
  const inRoom = rooms.length ? { amount: rooms.reduce((a, x) => a + x.amount, 0) } : null;
  const back = inRoom ? (savedRoom() ?? lastRoom()) : savedRoom();
  const settle = '在房间里点"离开房间"马上结回；直接关了页面的话，房间里没人以后约 10 分钟自动结回';
  window.clearTimeout(stakeTimer);
  if (inRoom && !stage.classList.contains('at-table') && !online) stakeTimer = window.setTimeout(() => void refreshWallet().then(drawLobby), 10_000);
  lobby.update({
    wallet,
    // 本机不知道是哪个房间（别的设备进的）：没有按钮，只说一句
    note: walletNote ?? (inRoom && !back ? `好友房那一桌还没结回钱包（带上桌 ${chips(inRoom.amount)}）。${settle}` : null),
    resume: s ? { stakes: s.table.stakes, size: s.table.seats.length, practice: s.practice, waiting: s.pending !== null } : null,
    orphan: texasStakes(wallet, 'client').find((x) => x.ref !== s?.id) ?? null,
    busy,
    room: back
      ? { code: back.code, text: inRoom ? `好友房 ${back.code} 里还有 ${chips(inRoom.amount)} 在桌上。${settle}` : `刚才在好友房 ${back.code}` }
      : null,
  });
  drawTop();
}

async function start(stakes: StakesId, size: number, amount: number, practice: boolean): Promise<void> {
  if (busy) return;
  busy = true;
  drawLobby();
  const r = await Solo.open(deps, { userId: cloud.userId(), stakes, size, amount, practice });
  busy = false;
  if ('error' in r) {
    await refreshWallet();
    if (r.pending) {
      // 连不上：这一桌留着（钱包可能已经扣了），自动再办
      solo = r.pending;
      await settlePending();
    } else walletNote = walletError(r.error);
    drawLobby();
    return;
  }
  solo = r;
  enterTable();
}

async function resume(): Promise<void> {
  if (busy || !solo) return;
  // 那一笔还没回话：先办完（买入到账才上桌；离桌的结算结完这一桌就没了）
  if (solo.session.pending) {
    busy = true;
    drawLobby();
    await settlePending();
    busy = false;
    if (solo?.session.pending) return drawLobby();
  }
  if (solo) enterTable();
  else drawLobby();
}

async function relief(): Promise<void> {
  if (busy) return;
  busy = true;
  const r = await reliefApi();
  busy = false;
  if (r.ok) {
    wallet = r.wallet;
    play('chip');
  } else walletNote = walletError(r.error, r.retryAfter, 'api');
  drawLobby();
}

// ---------- 牌桌 ----------

function enterTable(): void {
  const s = solo!;
  reads.clear();
  tally.clear();
  stage.classList.add('at-table');
  tableView.setup(s.table.seats.length, ME);
  tableView.show(view(s.table, ME));
  drawTop();
  refresh();
  // 先看完提示再发第一手（刚坐下的桌一张牌都没发）；接着打的桌从停下的地方接着
  void tips().then(() => drive(s.table.handNo === 0 && s.between ? s.next() : s.flush()));
}

/** 发下一手（点了"下一手"、自动下一手倒数完） */
function nextHand(): void {
  stopCountdown();
  toggle(betweenBar, 'hidden', true);
  if (online || !solo?.between || animating > 0) return;
  void drive(solo.next());
}

function stopCountdown(): void {
  window.clearTimeout(autoTimer);
  autoTimer = 0;
  countdown?.cancel();
  countdown = null;
}

/** 圈在 ms 里走完 */
function drain(ring: Element, ms: number): Animation | null {
  const c = ring.querySelector('circle');
  return c ? c.animate([{ strokeDashoffset: '0' }, { strokeDashoffset: '100' }], { duration: Math.max(0, ms), fill: 'forwards' }) : null;
}

/** 单机两手之间的那一栏：下一手 + 自动下一手（开着就倒数） */
function drawBetween(show: boolean): void {
  toggle(betweenBar, 'hidden', !show);
  toggle(roomPause, 'hidden', true);
  toggle(nextBtn, 'hidden', false);
  toggle(autoBtn, 'hidden', false);
  toggle(autoBtn, 'sel', settings.autoNext);
  autoBtn.setAttribute('aria-pressed', String(settings.autoNext));
  const ring = nextBtn.querySelector('.next-ring')!;
  toggle(ring, 'hidden', !settings.autoNext);
  if (!show || !settings.autoNext) return stopCountdown();
  if (autoTimer) return;
  const ms = AUTO_NEXT_MS * pace();
  countdown = drain(ring, ms);
  autoTimer = window.setTimeout(nextHand, ms);
}

async function act(a: Action): Promise<void> {
  if (online) {
    online.act(a);
    return;
  }
  if (!solo) return;
  await drive(solo.act(a));
}

/** 等这一串（我出手、电脑接着出手）做完，再看轮到谁 */
async function drive(p: Promise<unknown>): Promise<void> {
  await p;
  refresh();
}

/** 摆操作区和左下角；轮到我且有预选就直接做；输光了问补码 */
function refresh(): void {
  const s = solo;
  if (!s || !stage.classList.contains('at-table')) return;
  const v = view(s.table, ME);
  const meSeat = s.table.seats[ME]!;
  setText(handNo, v.handNo ? `第 ${v.handNo} 手` : '');
  // 冒烟脚本看这个判断牌桌停没停
  stage.dataset.phase = v.phase;
  const out = meSeat.status === 'out' && v.phase === 'idle';
  // 钱包里连一个大盲都没有就不给补码（点了也补不上）
  const st = stakesOf(s.table.stakes);
  toggle(topUpBtn, 'hidden', !(out && meSeat.stack < st.max && (s.session.practice || (wallet?.balance ?? 0) >= st.bb)));
  setText(sitBtn, meSeat.away ? '回来' : '歇一手');
  toggle(sitBtn, 'sel', meSeat.away);
  toggle(sitBtn, 'hidden', s.busted);
  drawTop();
  // 第一手由进桌时看完提示自己发，不给"下一手"
  drawBetween(s.between && v.handNo > 0 && animating === 0 && !s.busted && !asking);
  const auto = bar.update(v, animating === 0 && !s.closing);
  if (auto) {
    void drive(s.act(auto));
    return;
  }
  // 输光了：先让人看清这一手怎么输的，再问补码
  if (s.busted && animating === 0 && !asking && !bustTimer && !s.toppingUp) {
    bustTimer = window.setTimeout(() => {
      bustTimer = 0;
      if (solo === s && s.busted && animating === 0) void offerTopUp(true);
    }, 2_000 * pace());
  }
}

async function onStep(st: Step): Promise<void> {
  // 坐下那一笔买入回话时牌桌还没摆出来，进桌时会整个摆一遍；离桌时电脑快进打完的那一手不用播
  if (!stage.classList.contains('at-table') || st.action?.t === 'leave') return;
  animating++;
  bar.update(view(st.prev, ME), false);
  drawBetween(false);
  try {
    const prev = view(st.prev, ME);
    const next = view(st.next, ME);
    if (next.handNo !== prev.handNo) setText(handNo, `第 ${next.handNo} 手`);
    await tableView.play(prev, next, st.seat, st.action);
    record(prev, next);
    reads.observe(prev, next, who(prev));
    handDone(prev, next, ME);
  } finally {
    animating--;
  }
  const v = view(st.next, ME);
  bar.update(v, false);
  // 轮到我了：提示音、振动、后台时标题闪（单机没有计时，不嘀嗒）
  if (v.toAct === ME) myTurn(`s${v.handNo}:${v.log.length}`);
  else notMyTurn();
}

/** 座位上是谁（看对手按它分开数：电脑换了性格、好友房换了人就重新数） */
function who(v: View): (i: number) => string {
  const room = online?.state.room;
  return (i) => {
    const s = v.seats[i]!;
    const info = room?.seats[i];
    return `${i}:${s.owner === 'house' ? `h${s.persona}` : info?.kind === 'human' && info.name ? info.name : s.owner}`;
  };
}

/** 点了别人的头像：弹这一场的数 */
function showRead(i: number): void {
  const v = online ? online.state.view : solo ? view(solo.table, ME) : null;
  if (!v?.seats[i]) return;
  const r = reads.get(who(v)(i));
  // 好友房里（0.3.0）：我坐着就能对他扔道具、点名嘲讽（电脑也行）；别的真人还能屏蔽（按昵称记在本机）
  const s = online?.state;
  const info = s?.room?.seats[i];
  const me = s?.you?.seat ?? null;
  const acts: { label: string; run: () => void; icon?: string }[] = [];
  if (s && me !== null && i !== me && !fun.off) {
    PROPS.forEach((k, n) => acts.push({ label: PROP_NAMES[k], icon: propSvg(k), run: () => sendFun(PROP_BASE + n, i) }));
    acts.push({ label: '嘲讽他', run: () => openFun('taunt', i) });
  }
  const name = info?.kind === 'human' && i !== me ? info.name : null;
  if (name) {
    const muted = fun.muted.includes(name);
    acts.push({ label: muted ? '取消屏蔽' : '屏蔽他', run: () => setMuted(name, !muted) });
  }
  tableView.showCard(i, styleTag(r), readLines(r), acts);
}

// ---------- 好友房的乐子（0.3.0，DESIGN.md 13.4）：嘲讽、顺手提示、名场面、称号、屏蔽 ----------

/** 座位上的人怎么称呼（名场面横幅、称号）：我是"你"，好友房真人用昵称，电脑用性格名 */
function nameAt(v: View, i: number, me: number | null): string {
  if (i === me) return '你';
  const info = online?.state.room?.seats[i];
  if (info?.kind === 'human' && info.name) return info.name;
  return personaName(v.seats[i]!.persona);
}

/** 一手打完：名场面横幅、记称号的数（单机、好友房都有）；好友房给我顺手提示 */
function handDone(prev: View, next: View, me: number | null): void {
  const h = handOver(prev, next);
  if (!h) return;
  const sc = showcase(h.r, h.log);
  if (sc) tableView.banner(showcaseText(sc, nameAt(prev, sc.seat, me), h.r));
  // 称号的数单机、好友房都记（0.3.0 实打后单机结算页也给称号）
  const key = who(prev);
  tally.observe(h.r, h.log, (i) => ({ key: key(i), name: i === me ? myName : nameAt(prev, i, null) }));
  if (!online) return;
  if (me !== null && !fun.off) showHints(suggest(h.r, h.log, me));
}

let hintTimer = 0;
function showHints(ids: number[]): void {
  window.clearTimeout(hintTimer);
  funHints.textContent = '';
  for (const id of ids) {
    const b = el('button', 'fun-hint', funHints, TAUNTS[id]!);
    b.type = 'button';
    b.addEventListener('click', () => sendTaunt(id));
  }
  toggle(funHints, 'hidden', !ids.length);
  hintTimer = window.setTimeout(() => toggle(funHints, 'hidden', true), 6_000);
}

/**
 * 发一句、一个表情、扔一个道具：限频交给 kit（令牌桶，客户端自己排队静默发），这里不另设限制、不提示"太快"。
 * to 是对哪个座位（点名嘲讽、扔道具、催促炸弹）
 */
function sendFun(id: number, to: number | null = null): void {
  if (!online) return;
  online.emote(id, to ?? undefined);
  toggle(funPanel, 'hidden', true);
  toggle(funHints, 'hidden', true);
}
const sendTaunt = (id: number): void => sendFun(id, funTarget);

/** 打开面板：哪个页签、对谁（null 是对全桌；道具要先点人） */
function openFun(tab: FunTab, target: number | null): void {
  funTab = tab;
  funTarget = target;
  funOffBox.checked = fun.off;
  for (const [k, b] of fpTabs) toggle(b, 'sel', k === tab);
  const v = online?.state.view;
  setText(fpTo, target !== null && v ? `对 ${nameAt(v, target, null)}` : '');
  funGrid.textContent = '';
  funGrid.className = `fp-grid ${tab}`;
  if (tab === 'taunt') {
    TAUNTS.forEach((t, id) => {
      const b = el('button', 'fp-say', funGrid, t);
      b.type = 'button';
      b.addEventListener('click', () => sendTaunt(id));
    });
  } else if (tab === 'sticker') {
    STICKERS.forEach((k, i) => {
      const b = el('button', 'fp-icon', funGrid);
      b.type = 'button';
      b.innerHTML = stickerSvg(k);
      b.setAttribute('aria-label', k);
      b.addEventListener('click', () => sendFun(STICKER_BASE + i));
    });
  } else if (target === null) {
    el('div', 'fp-hint', funGrid, '点别人的头像，就能对他扔');
  } else {
    PROPS.forEach((k, i) => {
      const b = el('button', 'fp-icon', funGrid);
      b.type = 'button';
      b.innerHTML = propSvg(k);
      b.setAttribute('aria-label', PROP_NAMES[k]);
      b.title = PROP_NAMES[k];
      b.addEventListener('click', () => sendFun(PROP_BASE + i, target));
    });
  }
  toggle(funPanel, 'hidden', false);
}

const PROP_NAMES: Record<PropId, string> = { tomato: '番茄', egg: '鸡蛋', stinkyEgg: '臭鸡蛋', slipper: '拖鞋', bomb: '炸弹', rose: '玫瑰', like: '点赞', cheers: '干杯' };

/** 屏蔽了这个座位上的人（按昵称） */
const mutedSeat = (seat: number): boolean => {
  const name = online?.state.room?.seats[seat]?.name;
  return !!name && fun.muted.includes(name);
};

/**
 * 房间转发来的嘲讽、表情、道具：关了总开关、屏蔽了发的人的不显示。
 * 都只是画面（不暂停、不碰计时），kit 的层点击穿透，不挡我的底牌和按钮
 */
function showFun(seat: number, id: number, to?: number): void {
  if (fun.off || mutedSeat(seat)) return;
  const v = online?.state.view;
  if (id < TAUNT_COUNT) {
    const text = TAUNTS[id];
    if (text) tableView.bubble(seat, to !== undefined && v ? `@${nameAt(v, to, online?.state.you?.seat ?? null)} ${text}` : text);
    return;
  }
  const from = tableView.avatarRect(seat);
  if (id < PROP_BASE) {
    const k = STICKERS[id - STICKER_BASE];
    if (k && from) void showSticker(funLayer, onFace(from), k);
    return;
  }
  const prop = PROPS[id - PROP_BASE];
  const dest = to === undefined ? null : tableView.avatarRect(to);
  if (!prop || !from || !dest || to === undefined) return;
  void throwAt(funLayer, from, dest, prop, { sound: funSound, onHit: () => tableView.hit(to), target: to });
}

function setMuted(name: string, on: boolean): void {
  fun.muted = on ? [...fun.muted.filter((x) => x !== name), name] : fun.muted.filter((x) => x !== name);
  saveFun(localStorage, fun);
  toast(on ? `不看 ${name} 的嘲讽和道具了` : `又能看到 ${name} 的了`);
}

funBtn.addEventListener('click', () => {
  if (!funPanel.classList.contains('hidden')) return void toggle(funPanel, 'hidden', true);
  openFun(funTab === 'prop' ? 'taunt' : funTab, null);
});
funOffBox.addEventListener('change', () => {
  fun.off = funOffBox.checked;
  saveFun(localStorage, fun);
  if (fun.off) toggle(funHints, 'hidden', true);
});

/** 一手打完记战绩（云存档的 stats 槽）；me 是我坐的座位 */
function record(prev: View, next: View, me = ME): void {
  const r = next.lastHand;
  if (!r || r.handNo !== prev.handNo || prev.phase === 'idle') return;
  const meSeat = prev.seats[me];
  if (!meSeat || meSeat.status === 'out') return;
  const won = r.pots.reduce((a, p) => a + (p.winners.find((w) => w.seat === me)?.won ?? 0), 0);
  const shown = r.byFold ? undefined : r.shown.find((x) => x.seat === me);
  const pot = r.pots.reduce((a, p) => a + p.amount, 0);
  cloud.update((s) => ({
    ...s,
    hands: s.hands + 1,
    won: s.won + (won > 0 ? 1 : 0),
    biggestPot: won > 0 ? Math.max(s.biggestPot, pot) : s.biggestPot,
    best: shown ? Math.max(s.best, shown.value) : s.best,
    showdowns: s.showdowns + (shown ? 1 : 0),
    showdownWins: s.showdownWins + (shown && won > 0 ? 1 : 0),
  }));
}

let asking = false;
async function offerTopUp(busted: boolean): Promise<void> {
  const s = solo;
  if (!s || asking || s.toppingUp) return;
  const st = stakesOf(s.table.stakes);
  const stack = s.table.seats[ME]!.stack;
  const room = st.max - stack;
  const bal = s.session.practice ? Infinity : (wallet?.balance ?? 0);
  const min = busted ? st.min : st.bb;
  if (bal < min || room < min) {
    // 补不了：直接结这一场，结算页里温和地说一句（快乐为主，docs/economy.md 第 0 节）
    if (busted) await leave();
    return;
  }
  asking = true;
  drawBetween(false);
  const amount = await askTopUp(stage, { min, max: Math.min(room, bal), step: st.bb, balance: s.session.practice ? 0 : bal, busted });
  asking = false;
  if (amount === null) {
    if (busted) await leave();
    else refresh();
    return;
  }
  const err = await s.topUp(amount);
  if (err && s.toppingUp) return waitTopUp(s);
  await toppedUp(s, err);
}

/** 补码办完了（补上了，或者钱包明确拒了） */
async function toppedUp(s: Solo, err: string | null): Promise<void> {
  if (err) {
    await dialog(stage, '没补上', walletError(err), [{ label: '好', value: 'ok', primary: true }]);
    refresh();
    return;
  }
  void refreshWallet();
  await drive(s.flush());
}

/** 补码那一笔没回话时，最多在牌桌上停着等多久、隔多久用同一个操作 id 再办一次（0.3.4） */
const TOPUP_WAIT_MS = 60_000;
const TOPUP_RETRY_MS = 5_000;

/**
 * 补码时钱包连不上：钱可能已经扣了，牌桌停住等回话（Solo.toppingUp），弹窗说清楚在等什么、等了多久、最多等多久，不让人以为卡死了。
 * 等到了就接着打；等够了还没回话（或者人点了"先回大厅"），这一桌和那一笔留在本机，大厅里接着自动重试，点"接着打"回来
 */
async function waitTopUp(s: Solo): Promise<void> {
  const body = document.createElement('div');
  const msg = el('p', '', body, '钱包连不上，补码还没补上。钱可能已经从钱包扣了，所以牌桌先停在这儿等它回话：连上了自动补上、接着打，不会重复扣。');
  const clock = el('p', 'sum-note', body);
  const t0 = Date.now();
  let closed = false;
  void dialog(stage, '补码在路上', body, [{ label: '先回大厅', value: 'lobby' }]).then(() => (closed = true));
  let err: string | null = null;
  while (!closed && s.toppingUp && Date.now() - t0 < TOPUP_WAIT_MS) {
    setText(clock, `已经等了 ${Math.round((Date.now() - t0) / 1000)} 秒，最多等 ${TOPUP_WAIT_MS / 1000} 秒`);
    await new Promise((r) => window.setTimeout(r, TOPUP_RETRY_MS));
    if (!closed) err = await s.settle();
  }
  if (!s.toppingUp) {
    if (!closed) closeDialog();
    return toppedUp(s, err);
  }
  if (!closed) {
    setText(msg, '等了一分钟，钱包还是连不上。先回大厅：这一桌和这一笔补码记在本机，钱包连上后自动补上，点"接着打"回到这一桌。');
    setText(clock, '');
    await dialog(stage, '补码在路上', body, [{ label: '回大厅', value: 'lobby', primary: true }]);
  }
  if (solo !== s || !s.toppingUp) return refresh();
  stopCountdown();
  walletNote = '补码还在路上：钱包连上后自动补上，点"接着打"回到这一桌';
  window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(() => void settlePending().then(drawLobby), RETRY_MS);
  showLobby();
}

/** 离桌回大厅：手里有牌就弃，筹码结回钱包 */
async function leave(): Promise<boolean> {
  const s = solo;
  if (!s) return true;
  const inHand = s.table.seats[ME]!.status === 'active';
  if (!s.busted && !s.closing) {
    const ok = await dialog(stage, '离桌', inHand ? '这一手会弃牌，桌上的筹码带回钱包。' : '桌上的筹码带回钱包。', [
      { label: '接着打', value: 'no' },
      { label: '离桌', value: 'yes', primary: true },
    ]);
    if (ok !== 'yes') return false;
  }
  stopCountdown();
  toggle(betweenBar, 'hidden', true);
  const busted = s.busted;
  const err = await s.leave();
  if (s.toppingUp) {
    // 补码那一笔还没回话，先不走（钱包可能已经扣了，离桌的结回会把它覆盖掉，0.3.4）
    await dialog(stage, '先等补码', err === 'login' ? walletError('login') : '补码还在路上：钱包连不上，钱可能已经扣了。等它回话再离桌，这一笔才不会丢；连上后自动补上。', [{ label: '好', value: 'ok', primary: true }]);
    refresh();
    return false;
  }
  await refreshWallet();
  // 这一场的结算页。今天德州 client 模式的净赢到了上限（docs/economy.md 第 4 节）：多赢的照常算在牌桌上，只是不进钱包
  const st = s.stats;
  await soloSummary(stage, {
    practice: s.session.practice,
    buyin: st.buyin,
    out: s.closing || err ? null : s.left - s.capped,
    left: s.left,
    // 结回没办成：登录过期的等登录后再结；钱包明确拒了的（放太久已经退回、别处结过）照实说（0.3.3：原来照样显示结回了多少）
    ...(s.closing && err === 'login' ? { pending: '登录后自动结回' } : {}),
    ...(err && !s.closing ? { refused: walletError(err) } : {}),
    hands: st.hands,
    won: st.won,
    best: st.best,
    capped: s.capped,
    busted,
    // 称号（0.3.0 实打后单机也给）：诈唬王、天选之人、跟注站按全桌；输赢只知道我的，赢了给"大赢家"，输了不点名（单机就一个真人）
    titles: tally.titles(s.left > st.buyin ? [{ name: myName, net: s.left - st.buyin }] : []),
  });
  if (err && s.closing) {
    walletNote = err === 'login' ? LOGIN_NOTE : '钱包暂时连不上：这一桌的筹码先记在本机，稍后会自动结回钱包';
    if (err !== 'login') retryTimer = window.setTimeout(() => void settlePending().then(drawLobby), RETRY_MS);
  } else {
    solo = null;
  }
  showLobby();
  return true;
}

async function tips(): Promise<void> {
  if (cloud.stats().tips) return;
  const steps = [
    ['你坐在正下方', '两张底牌只有你看得见。大家轮流说话，最后用两张底牌加中间五张公共牌，凑出最大的五张。'],
    ['轮到你时', '右下角出现按钮：弃牌、过牌或跟注、加注。加注可以拖滑杆，或者点"½池""1池"这些快捷键。'],
    ['牌型从大到小', '同花顺 › 四条 › 葫芦 › 同花 › 顺子 › 三条 › 两对 › 一对 › 高牌。筹码只是积分，放开打！'],
  ];
  for (const [i, [t, b]] of steps.entries()) {
    const v = await dialog(stage, `${i + 1}/3 ${t}`, b!, [
      { label: '跳过', value: 'skip' },
      { label: i < 2 ? '下一步' : '开打', value: 'next', primary: true },
    ]);
    if (v !== 'next') break;
  }
  cloud.update((s) => ({ ...s, tips: true }));
}

// ---------- 顶栏 ----------

function drawTop(): void {
  if (online) return drawRoomTop(online.state);
  const at = stage.classList.contains('at-table') && solo;
  setText(where, at ? `${solo!.session.practice ? `娱乐 · ${stakesOf(solo!.table.stakes).name}` : stakesOf(solo!.table.stakes).name} · 盲注 ${chips(solo!.table.sb)}/${chips(solo!.table.bb)}` : '');
  setText(walletChip, wallet && at && !solo!.session.practice ? `钱包 ${chips(wallet.balance)}` : '');
  toggle(leaveBtn, 'hidden', !at);
  soundBtn.innerHTML = settings.sound
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l5 6m0-6-5 6" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  soundBtn.setAttribute('aria-label', settings.sound ? '关声音' : '开声音');
  speedBtn.textContent = settings.fast ? '快' : '慢';
  speedBtn.setAttribute('aria-label', settings.fast ? '动画：快' : '动画：正常');
  toggle(speedBtn, 'sel', settings.fast);
}

function drawCloud(): void {
  if (!cloud) return;
  const st = cloud.state();
  cloudBtn.dataset.state = st;
  const note = cloud.note();
  toggle(cloudBtn, 'alert', note !== null || st === 'paused');
  const label = { anon: '没登录，战绩只存在本机', synced: '战绩已同步', syncing: '正在同步战绩', pending: '战绩待上传', merged: '本机战绩已并进账号', paused: '战绩暂停同步' }[st];
  cloudBtn.setAttribute('aria-label', note ? `${label}：${note}` : label);
  cloudBtn.title = cloudBtn.getAttribute('aria-label')!;
}

soundBtn.addEventListener('click', () => {
  settings.sound = !settings.sound;
  setSound(settings.sound);
  saveSettings();
  drawTop();
});
speedBtn.addEventListener('click', () => {
  settings.fast = !settings.fast;
  saveSettings();
  drawTop();
});
cloudBtn.addEventListener('click', () => {
  if (cloud.state() === 'anon') location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`;
  else void dialog(stage, '战绩', cloudBtn.title, [{ label: '好', value: 'ok', primary: true }]);
});
leaveBtn.addEventListener('click', () => void (online ? leaveRoom(false) : leave()));
nextBtn.addEventListener('click', nextHand);
autoBtn.addEventListener('click', () => {
  settings.autoNext = !settings.autoNext;
  saveSettings();
  stopCountdown();
  refresh();
});
home.addEventListener('click', (e) => {
  if (online) {
    e.preventDefault();
    void leaveRoom(true);
    return;
  }
  if (!solo || !stage.classList.contains('at-table')) return;
  e.preventDefault();
  void leave().then((left) => {
    if (left && !solo) {
      cloud.flush();
      location.href = '/';
    }
  });
});
topUpBtn.addEventListener('click', () => void (online ? roomRebuy() : offerTopUp(false)));
backSeatBtn.addEventListener('click', () => {
  const b = online?.state.you?.bound;
  if (b !== null && b !== undefined) online!.sit(b);
});
sitBtn.addEventListener('click', () => {
  if (online) {
    const v = online.state.view;
    const me = online.state.you?.seat;
    if (v && me !== null && me !== undefined) online.act({ t: v.seats[me]!.away ? 'back' : 'away' });
    return;
  }
  const s = solo;
  if (!s) return;
  void drive(s.sitOut(!s.table.seats[ME]!.away));
});

// 切后台：补传战绩；离桌的结算还没回话就用 keepalive 再发一次
const hidden = (): void => {
  cloud?.flush();
  if (solo?.closing) void solo.settle(true);
};
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') hidden();
  else void cloud?.recheck();
});
window.addEventListener('pagehide', hidden);
window.addEventListener('focus', () => void cloud?.recheck());
window.addEventListener('storage', (e) => {
  cloud?.onStorage({ key: e.key, newValue: e.newValue });
  if (e.key === SESSION_KEY) otherTab();
});

/**
 * 另一个标签页动了本机这一桌单机（0.3.5）：两个页面各打各的、各自存盘会互相覆盖，一边离桌了另一边再离桌就对不上。
 * 这一页在牌桌上就停下回标题页、说一句；在标题页就按存盘重读，"接着打"接的是最新的那一桌
 */
function otherTab(): void {
  if (online || busy) return;
  const atTable = solo !== null && stage.classList.contains('at-table');
  solo?.stop();
  if (atTable) {
    stopCountdown();
    closeDialog();
    walletNote = '这一桌在另一个页面打开了：在那边接着打，或者关掉那边再回来';
  }
  const s = Solo.load(localStorage, cloud.userId());
  solo = s ? new Solo(s, deps) : null;
  // 标题页上开着的弹窗（结算、补给）不关，只重画
  if (atTable) showLobby();
  else drawLobby();
}

// ---------- 好友房（DESIGN.md 6） ----------

/** 刷新页面后多久以内自动回到上次的房间（房间最长活 6 小时） */
const ROOM_REMEMBER_MS = 6 * 3_600_000;

/** 读本机记着的房间：码不对、不是这个账号的、过了 6 小时的都当没有 */
function readRoom(key: string): SavedRoom | null {
  const r = readJson<SavedRoom>(key);
  return r && isRoomCode(r.code) && r.userId === cloud.userId() && Date.now() - r.at < ROOM_REMEMBER_MS ? r : null;
}

const savedRoom = (): SavedRoom | null => readRoom(KEYS.room);

function saveRoom(r: SavedRoom | null): void {
  // 存不上：刷新后从大厅输码回来
  if (r) writeJson(KEYS.room, r);
  else remove(KEYS.room);
}

async function openRoom(stakes: StakesId, size: number): Promise<void> {
  if (busy) return;
  // 一律开新的（0.2.4：同时能开 5 个，没真人的房间马上结束、还名额），不再把人送回旧房间
  busy = true;
  drawLobby();
  const r = await createRoom({ stakes, size });
  busy = false;
  if ('code' in r && !('error' in r)) enterRoom({ code: r.code, userId: cloud.userId(), host: true, at: Date.now() });
  else {
    walletNote = createError('error' in r ? r.error : 'unavailable');
    drawLobby();
  }
}

function joinRoom(code: string): void {
  if (!isRoomCode(code)) return;
  const old = savedRoom();
  enterRoom(old?.code === code ? old : { code, userId: cloud.userId(), host: false, at: Date.now() });
}

function backToRoom(): void {
  const r = savedRoom() ?? lastRoom();
  if (r) enterRoom(r);
}

/** 上一次进的好友房（离开后也留着，标题页说"那一桌还没结回"时给回去的按钮） */
const lastRoom = (): SavedRoom | null => readRoom(KEYS.lastRoom);

/** 点了"离开房间"、房间关了、房间没了：本机关于这个房间的记录全清掉 */
function forgetRoom(): void {
  saveRoom(null);
  remove(KEYS.lastRoom); // 清不掉：6 小时后自己过期
}

function enterRoom(r: SavedRoom): void {
  // 本机还有一桌单机没打完也能进（0.3.0）：那一桌存在本机，回标题页还能接着打；钱包里两份互不影响（平台 0.9.5）
  saveRoom({ ...r, at: Date.now() });
  reads.clear();
  tally.clear();
  // 存不上：标题页只是不给"回到房间"
  writeJson(KEYS.lastRoom, { ...r, at: Date.now() });
  online?.close();
  lastRefused = null;
  wasBuying = false;
  laidOut = { size: 0, me: -1 };
  stage.classList.add('in-room');
  closeDialog();
  // 换了房间、离开以后，旧连接还没播完的帧和状态回调一律不理
  const o: Online = new Online(r, roomUi(() => online === o));
  online = o;
  drawRoom(o.state);
}

/** 离开房间：坐着的先离座（这一手弃牌，打完结回钱包），再断开 */
async function leaveRoom(goHome: boolean): Promise<void> {
  const o = online;
  if (!o) return;
  const st = o.state;
  const seated = st.you?.seat !== null && st.you?.seat !== undefined;
  const playing = st.room?.status === 'playing';
  // 断线时离座的消息发不出去（kit 没连上就丢），座位和筹码还留在房间里：不能说"马上结回"，也不能把回房间的路清掉（0.3.4）
  if (seated && st.status !== 'open') {
    const how = await dialog(
      stage,
      '网络断了',
      '现在连不上房间，"离开"发不出去：你还坐着，掉线由电脑代打，筹码还在桌上。等连上了再点离开，筹码马上结回；先回大厅也行，回来点"回到房间"再离开。',
      [
        { label: '等连上', value: 'wait', primary: true },
        { label: '先回大厅', value: 'lobby' },
      ],
    );
    if (how !== 'lobby' || online !== o) return;
    o.close();
    // 不 forgetRoom：上一次进的房间留着，标题页按钱包里那一份给"回到房间"
    exitRoom('你还坐在好友房里（掉线由电脑代打）：连上网后点"回到房间"再离开，桌上的筹码才会结回');
    if (goHome) {
      cloud.flush();
      location.href = '/';
    }
    return;
  }
  const ok = await dialog(
    stage,
    '离开房间',
    seated && playing ? '这一手弃牌，桌上的筹码马上结回钱包。' : seated ? '离开后座位空出来。' : '不看了？',
    [
      { label: '留下', value: 'no' },
      { label: '离开', value: 'yes', primary: true },
    ],
  );
  if (ok !== 'yes' || online !== o) return;
  // 确认的这一会儿断了：按断线的说
  if (seated && o.state.status !== 'open') return leaveRoom(goHome);
  const rows = summaryRows(o.state, true);
  if (seated) o.leaveSeat();
  // 离座的消息先发出去再断开
  await new Promise((done) => window.setTimeout(done, 300));
  o.close();
  forgetRoom();
  // 还没结回的那一份由标题页按钱包说（drawLobby），这里不另记一句：记了会一直挂着，和钱包对不上
  exitRoom(null);
  if (rows && !goHome) await roomSummary(stage, '这一场', null, rows, tally.titles(rows));
  if (goHome) {
    cloud.flush();
    location.href = '/';
  }
}

/**
 * 好友房这一场每个人的输赢（房间按座位记的账，RoomView.net）。没人带过筹码时 null。
 * leaving：我正要离开，手里这一手会弃牌，已经下的注算输
 */
function summaryRows(s: OnlineState, leaving: boolean): RoomSummaryRow[] | null {
  const v = s.view;
  const room = s.room;
  if (!v || !room) return null;
  const me = s.you?.seat ?? s.you?.bound ?? null;
  const rows = v.net.flatMap((net, i): RoomSummaryRow[] => {
    if (net === null) return [];
    const info = room.seats[i];
    const lost = leaving && i === me && v.seats[i]!.status === 'active' ? v.seats[i]!.total : 0;
    const name = i === me ? myName : info?.kind === 'human' && info.name ? info.name : `${i + 1} 号座（走了）`;
    return [{ name, net: net - lost, me: i === me }];
  });
  return rows.length ? rows : null;
}

/** 回到大厅（离开、房间关了） */
/** keep：被别的页面顶掉（4001）时不清本机记着的房间（0.3.5）：那条记录是另一个页面还在用的，清了它刷新后就不知道自己是房主 */
function exitRoom(note: string | null, keep = false): void {
  online = null;
  if (!keep) saveRoom(null);
  stage.classList.remove('in-room', 'at-table');
  toggle(backSeatBtn, 'hidden', true);
  toggle(spectate, 'hidden', true);
  tableView.setPeople(null);
  tableView.setClock(null, null, 1);
  drawRoomPause(null);
  toggle(betweenBar, 'hidden', true);
  drawRebuy(null);
  for (const e of [funBtn, funPanel, funHints, inviteBtn]) toggle(e, 'hidden', true);
  drawUrge(null, null);
  notMyTurn();
  roomPanel.draw(null);
  walletNote = note;
  // 钱包回来只重画标题页：不能再 showLobby，它会关掉紧接着弹的"这一场"结算（结算一闪就没）
  void refreshWallet().then(() => {
    if (note) walletNote = note;
    drawLobby();
  });
  showLobby();
}

const roomUi = (mine: () => boolean): OnlineUi => ({
  draw: (s) => {
    if (mine()) drawRoom(s);
  },
  async play(prev, next, last) {
    const o = online;
    if (!o || !mine()) return;
    stage.classList.add('at-table');
    // 刚进来、换了座位：直接摆，不播
    if (layOut(next.size, o.mySeat) || !prev) {
      tableView.show(next);
      return;
    }
    animating++;
    bar.update(prev, false);
    try {
      const action = last && last.action.t !== 'rebuy' ? (last.action as Action) : null;
      await tableView.play(prev, next, last?.seat ?? null, action);
      const me = o.state.you?.seat;
      if (me !== null && me !== undefined) record(prev, next, me);
      reads.observe(prev, next, who(prev));
      handDone(prev, next, me ?? null);
    } finally {
      animating--;
    }
  },
  toast: (text) => {
    if (mine()) toast(text);
  },
  emote: (seat, id, to) => {
    if (mine()) showFun(seat, id, to);
  },
  ended: (text, code) => {
    const o = online;
    if (!mine() || !o) return;
    // 房间关了、没有这个房间：本机记着的都清掉，标题页不再给"回到房间"
    if (code === CLOSE.noRoom || code === CLOSE.roomClosed) forgetRoom();
    // 房间关了是这一场打完了：给每个人的输赢；别的（被顶掉、连不上）只说一句
    const rows = code === CLOSE.roomClosed ? summaryRows(o.state, false) : null;
    exitRoom(null, code === CLOSE.replaced);
    if (rows) void roomSummary(stage, '这一场', text, rows, tally.titles(rows));
    else void dialog(stage, '好友房', text, [{ label: '好', value: 'ok', primary: true }]);
  },
  wait: (ms) => new Promise((ok) => window.setTimeout(ok, ms * pace())),
});

/** 人数或我的座位变了：重摆牌桌（我永远在正下方）；摆了回 true */
function layOut(size: number, me: number): boolean {
  if (laidOut.size === size && laidOut.me === me) return false;
  laidOut = { size, me };
  tableView.setup(size, me);
  return true;
}

function drawRoom(s: OnlineState): void {
  roomPanel.draw(s);
  const v = s.view;
  const playing = s.room?.status === 'playing' && v !== null;
  stage.classList.toggle('at-table', playing);
  drawRoomTop(s);
  if (!playing || !s.room) {
    bar.update(null, false);
    drawUrge(null, null);
    return;
  }
  if (layOut(v.size, online!.mySeat)) tableView.show(v);
  const me = s.you?.seat ?? null;
  const spectator = me === null && (s.you?.bound ?? null) === null;
  const room = s.room;
  const people = v.seats.map((_, i) => {
    const info = room.seats[i]!;
    const human = info.kind === 'human';
    return {
      // 离座的人的座位已经换成电脑（庄家的筹码），按电脑的名字显示
      name: human ? info.name : null,
      // 中途坐下、接管电脑座位的人：钱到账了还要等这一手打完（0.2.5 写清楚，不让人以为卡住了）
      tag: human && info.auto ? '电脑代打' : human && info.away ? '掉线' : v.next?.[i] ? '下一手上桌' : v.buying[i] ? '带入中' : null,
      takeable: spectator && info.kind === 'ai' && !info.reserved,
    };
  });
  tableView.setPeople(people);
  const turn = s.room.turn;
  // 一手和一手之间也在计时的，是开打时在等这个人的买入（OPENING_MS）
  tableView.setClock(s.busy ? null : (turn?.seat ?? null), turn?.deadline ?? null, v.phase === 'idle' ? OPENING_MS : TURN_MS);
  drawRoomPause(s.busy || animating > 0 ? null : (s.room.pause?.until ?? null));
  if (!s.busy && animating === 0) tableView.show(v);

  setText(handNo, v.handNo ? `第 ${v.handNo} 手` : '');
  stage.dataset.phase = v.phase;
  const mine = me === null ? null : v.seats[me]!;
  // 被拒了、还没上桌的用座位上面那个大按钮；坐着的人补码（被拒了也一样）还是左下角的小按钮，被拒时冒一句（0.3.3：
  // 原来坐着补码被拒也挂出"没带上桌"的大框，按满额写、还把小按钮藏了）
  const seated = mine?.owner === 'player';
  const refusedOut = v.canRebuy && v.refused !== null && !seated;
  toggle(topUpBtn, 'hidden', !v.canRebuy || refusedOut);
  drawRebuy(refusedOut ? v : null);
  toggle(sitBtn, 'hidden', !mine || mine.owner !== 'player');
  setText(sitBtn, mine?.away ? '回来' : '歇一手');
  toggle(sitBtn, 'sel', !!mine?.away);
  toggle(backSeatBtn, 'hidden', me !== null || (s.you?.bound ?? null) === null);
  // 嘲讽只有坐着的人能发（kit：旁观的不能发，免得刷屏）
  toggle(funBtn, 'hidden', me === null);
  toggle(inviteBtn, 'hidden', false);
  if (me === null) toggle(funPanel, 'hidden', true);
  toggle(spectate, 'hidden', !people.some((p) => p.takeable));

  // 我的买入、补码办完了：钱包的数变了
  const buyingNow = me !== null && v.buying[me]!;
  if (wasBuying && !buyingNow) void refreshWallet();
  wasBuying = buyingNow;

  // 买入被钱包拒了：钱包的数可能变了（比如别处已经结回），刷新一下，座位上面那块按新的数说
  if (v.refused && v.refused !== lastRefused) {
    void refreshWallet().then(() => online && drawRoom(online.state));
    if (seated) toast(`没补上：${walletError(v.refused, undefined, 'room')}`);
  }
  lastRefused = v.refused;

  const auto = bar.update(v, !s.busy && animating === 0 && s.status === 'open' && me !== null);
  if (auto) online!.act(auto);
  drawUrge(me, v.phase === 'idle' ? null : turn);
  // 画面播完、真轮到我了：提醒一次，按房间的期限在最后 5 秒嘀嗒（0.3.0）
  if (!s.busy && animating === 0) {
    if (!auto && me !== null && v.toAct === me && turn?.seat === me) {
      myTurn(`r${v.handNo}:${v.log.length}`);
      tickUntil(turn.deadline ?? null);
    } else notMyTurn();
  }
}

/** 钱包够带多少（按大盲取整，最多 full）；不知道钱包时按 full */
const affordable = (full: number, bb: number): number => (wallet ? Math.min(full, Math.floor(wallet.balance / bb) * bb) : full);

/** 带入被拒时按钮带多少（null 是带满） */
let rebuyAmount: number | null = null;
/** 被拒的那一次刷过钱包没有（被拒时页面上的余额多半是旧的） */
let rebuyChecked = '';

/**
 * 带入被拒、还没上桌：为什么、怎么办，和"带入 2,000 上桌"（v 为 null 时收起）。
 * 钱包不够一整份（平台 0.10.2 起开一份只要求余额够这次带入）：按钮改成钱包够的数，最少这一档的最少买入
 */
function drawRebuy(v: RoomView | null): void {
  toggle(rebuyBox, 'hidden', !v);
  if (!v) {
    rebuyChecked = '';
    return;
  }
  const st = stakesOf(v.stakes);
  const poor = v.refused === 'no_funds';
  if (poor && rebuyChecked !== online?.state.code) {
    rebuyChecked = online?.state.code ?? '';
    void refreshWallet().then(() => {
      const w = online?.state.view;
      drawRebuy(w?.canRebuy && w.refused !== null ? w : null);
    });
  }
  const can = affordable(st.max, st.bb);
  rebuyAmount = poor && can >= st.min && can < st.max ? can : null;
  setText(rebuyText, poor ? `${walletError('no_funds')}（钱包里有 ${wallet ? chips(wallet.balance) : '—'}）` : `没带上桌：${walletError(v.refused!, undefined, 'room')}`);
  toggle(rebuyWallet, 'hidden', !poor);
  setText(rebuyBtn, `带入 ${chips(rebuyAmount ?? st.max)} 上桌`);
}

/**
 * 催促炸弹（0.3.0 朋友们："谁出得慢就炸他"）：轮到的是别的真人（不是电脑、不是电脑代打）、他已经想了 8 秒以上，
 * 他头像旁边冒一个小炸弹，我坐着就能点：对他扔 bomb（kit 的道具，走 emote 带 to）。不缩短他的计时、不碰规则
 */
const URGE_AFTER_MS = 8_000;
let urgeTimer = 0;
let urgeFor = '';
function drawUrge(me: number | null, turn: { seat: number; deadline?: number | null } | null): void {
  const info = turn ? online?.state.room?.seats[turn.seat] : null;
  const ok = !!turn && turn.deadline != null && me !== null && turn.seat !== me && info?.kind === 'human' && !info.auto && !fun.off;
  const key = ok ? `${turn!.seat}:${turn!.deadline}` : '';
  if (key === urgeFor) return;
  urgeFor = key;
  window.clearTimeout(urgeTimer);
  tableView.urge(null, () => {});
  if (!ok) return;
  const seat = turn!.seat;
  const at = turn!.deadline! - TURN_MS + URGE_AFTER_MS;
  urgeTimer = window.setTimeout(() => tableView.urge(seat, () => sendFun(PROP_BASE + PROPS.indexOf('bomb'), seat)), Math.max(0, at - Date.now()));
}

/** 好友房两手之间（房间的停顿，kit RoomInfo.pause）：大家看同一个倒计时，走完房间自己发下一手 */
let pauseUntil: number | null = null;
function drawRoomPause(until: number | null): void {
  toggle(betweenBar, 'hidden', until === null);
  toggle(roomPause, 'hidden', until === null);
  toggle(nextBtn, 'hidden', true);
  toggle(autoBtn, 'hidden', true);
  if (until === pauseUntil) return;
  pauseUntil = until;
  countdown?.cancel();
  countdown = until === null ? null : drain(roomPause, until - Date.now());
}

function drawRoomTop(s: OnlineState): void {
  const v = s.view;
  const o = v ? { stakes: v.stakes, size: v.size } : s.opts;
  const st = o ? stakesOf(o.stakes) : null;
  setText(where, `好友房 ${s.code}${st ? ` · ${st.name} · 盲注 ${chips(st.sb)}/${chips(st.bb)}` : ''}`);
  setText(walletChip, wallet ? `钱包 ${chips(wallet.balance)}` : '');
  toggle(leaveBtn, 'hidden', false);
  setText(leaveBtn, '离开');
}

/** 点了一个座位：看着的人可以接管没人的电脑座位 */
async function takeSeat(i: number): Promise<void> {
  const s = online?.state;
  // 单机、不能接管的座位：看这个人这一场的数
  if (!s?.view || !s.room) return showRead(i);
  const info = s.room.seats[i];
  const spectator = (s.you?.seat ?? null) === null && (s.you?.bound ?? null) === null;
  if (!spectator || info?.kind !== 'ai' || info.reserved) return showRead(i);
  const st = stakesOf(s.view.stakes);
  const ok = await dialog(stage, '接管这个座位', `电脑这一手弃牌，下一手起你坐这里：从钱包带 ${chips(st.max)} 上桌，离开时结回钱包。`, [
    { label: '算了', value: 'no' },
    { label: '坐下', value: 'yes', primary: true },
  ]);
  if (ok === 'yes') online?.sit(i);
}

async function roomRebuy(): Promise<void> {
  const v = online?.state.view;
  if (!v?.canRebuy) return;
  const st = stakesOf(v.stakes);
  // 桌上还有的补到满（0.3.0）；这一手打着的，打完才上桌
  const mine = v.me === null ? null : v.seats[v.me];
  const seated = mine?.owner === 'player';
  const full = seated ? st.max - mine.stack : st.max;
  // 钱包不够补满：补钱包够的（平台 0.10.2），最少一个大盲（没坐上的最少这一档的最少买入）
  const add = Math.max(Math.min(full, seated ? st.bb : st.min), affordable(full, st.bb));
  const later = mine?.status !== 'out' && v.phase !== 'idle' ? '，这一手打完上桌' : '';
  const to = seated ? `补到 ${chips(mine.stack + add)}` : '上桌';
  const ok = await dialog(stage, '补码', `从钱包带 ${chips(add)} ${to}${later}（钱包里有 ${wallet ? chips(wallet.balance) : '—'}）。`, [
    { label: '算了', value: 'no' },
    { label: '补码', value: 'yes', primary: true },
  ]);
  if (ok === 'yes') online?.act({ t: 'rebuy', ...(add < full ? { amount: add } : {}) });
}

/**
 * 叫朋友来（0.3.0）：链接只带房间码（档位、人数进房后房间会告诉他）。手机上弹系统分享（微信、短信……），
 * 没有就复制；都不行把链接摆出来让人自己复制。朋友没登录的，登录完平台跳回原链接（登录页的 next），照样进房
 */
async function invite(): Promise<void> {
  const s = online?.state;
  if (!s) return;
  const u = new URL(location.pathname, location.origin);
  u.searchParams.set('room', s.code);
  const url = u.toString();
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: '来打德州', text: `好友房 ${s.code}，点开就进`, url });
      return;
    } catch (e) {
      // 自己点了取消：什么都不做；别的错退回复制
      if (e instanceof DOMException && e.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast('链接复制好了，发给朋友，点开就进');
  } catch {
    await dialog(stage, '叫朋友来', url, [{ label: '好', value: 'ok', primary: true }]);
  }
}


let toastTimer = 0;
function toast(text: string): void {
  if (!text) return;
  setText(toastEl, text);
  toastEl.classList.add('on');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl.classList.remove('on'), 2600);
}

void boot();
