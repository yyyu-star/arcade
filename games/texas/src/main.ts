/**
 * 页面入口：大厅（标题页）和牌桌两屏，接钱包、云存档、声音和看得见的区域。
 * 单独部署（没有平台，DESIGN.md 10.1，site.ts）时不接钱包和云存档，"大厅"回游戏首页。
 * 规则在 src/core，流程在 solo.ts，这里只把它们和画面连起来。
 */
import { detectPlatform, MATCH_TEXT, MatchClient } from 'arcade-kit/client';
import { localChat } from 'arcade-kit/chat';
import { CLOSE } from 'arcade-kit/protocol';
import { chatFont, chatMode as chatLayout } from 'arcade-kit/fun-logic';
import { feedMoment, shouldReport, type FeedMoment } from './core/feed.ts';
import { DIFFICULTY_NAME, difficultyOf, FUN_STAKES, stakesOf, type StakesId } from './core/stakes.ts';
import type { Action, Table } from './core/table.ts';
import { view, type View } from './core/view.ts';
import { createCloud, type Cloud } from './net/cloud.ts';
import { createError, createRoom, isRoomCode, matchUrl, Online, type OnlineState, type OnlineUi, type SavedRoom } from './online.ts';
import { MATCH_TABLE, matchTierOf } from './room/match.ts';
import { HAND_PAUSE_MS, OPENING_MS, TURN_MS, TWO_NOTE, type RoomView } from './room/rules.ts';
import { getWallet, relief as reliefApi, texasStakes, walletApi, walletError, type WalletApi, type WalletReply, type WalletView } from './net/wallet.ts';
import { site, twoText } from './site.ts';
import { KEYS, patchSettings, readJson, readSettings, remove, writeJson } from './store.ts';
import { ME, SESSION_KEY, Solo, type SoloDeps, type Step } from './solo.ts';
import { ActionBar } from './view/actions.ts';
import { myTurn, notMyTurn, tickUntil } from './view/alert.ts';
import { momentOf, temperOf } from './fun/moments.ts';
import { tauntId, TAUNTS } from './fun/taunts.ts';
import { askTopUp, closeDialog, dialog } from './view/dialog.ts';
import { roomSummary, soloSummary, type RoomSummaryRow, type SoloSummary } from './view/summary.ts';
import { roomCard, soloCard } from './view/share.ts';
import { prepareShare, type ShareCard } from 'arcade-kit/share';
import { mountSocial, openInvite, postMoment, type Presence, type SocialHandle } from 'arcade-kit/social';
import { el, setText, toggle } from './view/dom.ts';
import { Lobby, topBuyIn } from './view/lobby.ts';
import { ROOM_NAME, setRoom } from './view/rooms.ts';
import { mountScene } from './view/scene.ts';
import { propSvg, showSticker } from 'arcade-kit/fun';
import { PROPS, propId, TableFun, type FunSeat } from 'arcade-kit/table-fun';
import { loadFunOff, saveFunOff, suggest } from './view/fun.ts';
import { readLines, Reads, styleTag } from './view/reads.ts';
import { RoomPanel } from './view/room.ts';
import { SHOW_MS, ShowBar } from './view/showbar.ts';
import { funSound, play, setSound, setVolume, unlockAudio } from './view/sound.ts';
import { TableView } from './view/table.ts';
import { chips, personaName } from './view/text.ts';
import { handOver, showcase, showcaseText, Tally } from './view/titles.ts';
import { watchViewport } from './view/viewport.ts';
import './view/style.css';
// 夜场牌桌的皮（0.10.0）：材质、光影、颜色都在这里，压在 style.css 的布局上
import './view/skin.css';
// 分层背景（0.18.0，docs/art-v3.md）：墙、散景、吊灯吧台、光锥，在舞台后面
import './view/scene.css';
// 主题房（0.18.1）：四个档位各一间，只换颜色和材质
import './view/rooms.css';

interface Settings {
  sound: boolean;
  /** 总音量（0.10.0）：点喇叭在 大声 → 小声 → 静音 之间轮换，静音就是 sound 关掉 */
  volume: number;
  fast: boolean;
  /** 单机一手打完，结果摆几秒后自己发下一手（默认关：试玩时大家要"点了才发"） */
  autoNext: boolean;
}

function loadSettings(): Settings {
  const s = readSettings() as Partial<Settings>;
  return { sound: s.sound !== false, volume: s.volume === 0.35 ? 0.35 : 0.8, fast: s.fast === true, autoNext: s.autoNext === true };
}
function saveSettings(): void {
  patchSettings({ ...settings });
}

const settings = loadSettings();
setSound(settings.sound);
setVolume(settings.volume);
const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const pace = (): number => (reduced ? 0.3 : settings.fast ? 0.55 : 1);
/** 自动下一手：结果摆这么久再发（按动画快慢缩放） */
const AUTO_NEXT_MS = 3_500;

// ---------- 骨架 ----------

const app = document.getElementById('app')!;
const stage = el('div', 'stage', app);
const scene = mountScene(app, stage);
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
// 互动总开关（docs/table-fun.md 第 5 节"互动：开 / 不看"）：0.13.0 起面板是 kit 的，开关挪到顶栏，和声音、快慢放在一起
const funOffBtn = el('button', 'icon fun-toggle', top);
funOffBtn.type = 'button';
// 聊天开关（0.19.0，kit 0.18 的"聊天：开 / 不看"，和互动分开）：进桌时显示（0.19.3 起单机也有聊天）
const chatBtn = el('button', 'icon chat-toggle hidden', top);
chatBtn.type = 'button';
const soundBtn = el('button', 'icon sound', top);
soundBtn.type = 'button';
const leaveBtn = el('button', 'pill leave', top, '离桌');
leaveBtn.type = 'button';

const screen = el('div', 'screen', stage);
/** 互动"不看"（texas.fun）。菜单、面板、冷却、连击回敬、按人屏蔽、首次提示、电脑的反应都是 kit 的 TableFun（0.13.0，docs/table-fun.md 第 0 节） */
let funOff = loadFunOff(localStorage, sessionStorage);
/** 聊天"不看"（texas.settings 的 chatOff）：别人说的不冒气泡、不进记录，自己也没有聊天页 */
let chatOff = readSettings().chatOff === true;
/** 快速匹配桌上和陌生人聊不聊（0.20.0，texas.settings 的 strangerChat，默认聊）：不聊时进匹配桌不带 chat=1，好友房、单机照常 */
let strangerChat = readSettings().strangerChat !== false;
/** 牌桌上的互动组件：进桌时建、离桌时拆；单机的电脑由它在本地反应，好友房的由房间算（worker/room.ts） */
let tf: TableFun | null = null;
/**
 * 表情包盖在头像上（头像"做表情"）：kit 默认冒在头像右上方，那里不是这个人亮出来的牌、就是动作标签或者屏幕上沿
 * （0.3.0 实打截图 03、07）。kit 按矩形中心往右上偏 0.45、0.55 个头像，这里先反着挪回来。只用于电脑说话配的表情（view/talk.ts）
 */
const onFace = (r: DOMRect): DOMRect => new DOMRect(r.x - r.width * 0.45, r.y + r.height * 0.55, r.width, r.height);
const tableView = new TableView(screen, {
  myName: () => myName,
  pace,
  onSeat: (i) => void takeSeat(i),
  quiet: () => funOff,
  muted: (seat) => !!tf?.isBlocked(seat),
  // 电脑说话配的表情包，和真人发的同一套（kit 的 STICKERS），画在 kit 的效果层上
  sticker: (seat, id) => {
    const r = tableView.avatarRect(seat);
    if (r && tf && !funOff && !tf.isBlocked(seat)) {
      play('emote');
      void showSticker(tf.layer, onFace(r), id);
    }
  },
  bombIcon: () => propSvg('bomb'),
});
/** 看对手（0.2.2）：每个座位这一场的数，点名牌看（0.13.0 起点头像是 kit 的互动菜单） */
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
// 旁观（docs/social.md 1.4）：座位满了、已经开打时进来的人只看。有电脑座位能接管时给"坐下"（接第一个亮着蓝圈的，也可以直接点那个座位）
const sitDownBtn = el('button', 'pill go hidden', hud, '坐下');
sitDownBtn.type = 'button';
sitDownBtn.addEventListener('click', () => {
  const room = online?.state.room;
  const i = room?.seats.findIndex((x) => x.kind === 'ai' && !x.reserved) ?? -1;
  if (i >= 0) void takeSeat(i);
});
const spectate = el('span', 'spectate hidden', hud, '也可以点蓝圈的座位');
// 互动（docs/table-fun.md 第 1 节）：左下角的"互动"按钮由 kit 画，这里只占个位置（funSlot 的屏幕矩形交给 TableFun 的 button）；
// 一手打完按公开发生的事冒 1–2 句顺手提示，一点就发。都在左下，不挡底牌和操作区
const funSlot = el('div', 'fun-slot hidden', hud);
// 放在这一行最前面：后面的"补码""歇一手"一显一隐，这个位置也不挪（kit 的按钮按矩形摆，挪了会压到别的按钮）
hud.prepend(funSlot);
// 手机横屏的"聊天"按钮（kit 0.19 的 chatButton）也在这一行占个位，挨着"互动"：不给的话 kit 把它摆在互动右边，压住"第几手""歇一手"（10-18 手机横屏截图）。
// 电脑是聊天框、竖屏 kit 摆在互动下面，都不占这个位
const chatSlot = el('div', 'fun-slot chat-slot hidden', hud);
funSlot.after(chatSlot);
// 开打以后也能叫人（0.3.0）：朋友点开链接看着，点亮着的电脑座位就能接管
const inviteBtn = el('button', 'pill invite-btn hidden', hud, '叫朋友来');
inviteBtn.type = 'button';
inviteBtn.addEventListener('click', () => invite());
const funHints = el('div', 'fun-hints hidden', hud);
// 两手之间（0.1.1）：单机一手打完停着，点"下一手"才发（开着"自动下一手"时倒数几秒自己发）；好友房是房间定的停顿，大家看同一个倒计时
const RING = '<svg viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" pathLength="100"/></svg>';
const betweenBar = el('div', 'between hidden', screen);
const roomPause = el('div', 'room-pause hidden', betweenBar);
roomPause.innerHTML = `${RING}<span>下一手马上开始</span>`;
// 好友房能打的真人不到两个（0.4.0）：牌桌停着不发牌，这里说为什么
const twoNote = el('div', 'two-note hidden', betweenBar, TWO_NOTE);
const autoBtn = el('button', 'auto-next', betweenBar, '自动下一手');
autoBtn.type = 'button';
const nextBtn = el('button', 'next-hand', betweenBar);
nextBtn.type = 'button';
nextBtn.innerHTML = `<span class="next-ring hidden">${RING}</span><span>下一手</span>`;
// 主动亮牌（0.19.0）：放在这一栏最前面
const showBar = new ShowBar(betweenBar, (cards) => showMine(cards));
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
/** 选桌上选中的那一间（标题页时背景按它） */
let lobbyRoom: StakesId | null = null;
const lobby = new Lobby(stage, {
  start,
  resume,
  relief,
  openRoom,
  match: (stakes, fun, level) => void quickMatch(stakes, fun, level),
  joinRoom,
  backToRoom,
  preview: (id) => {
    lobbyRoom = id;
    drawRoomTheme();
  },
});
const roomPanel = new RoomPanel(stage, {
  sit: (i) => online?.sit(i),
  start: () => online?.start(),
  invite: () => invite(),
  leave: () => void leaveRoom(false),
  retry: () => online?.retry(),
});

const getFit = watchViewport(app, stage, (f) => {
  tableView.layout(f);
  syncFun();
});
tableView.layout(getFit());

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
 * 电脑想多久（0.1.1 试玩反馈："看都看不清"）：看得清谁在想（头像上的光圈），每次不一样，像对面坐着个人。
 * 只按局面定快慢（翻牌前有没有人加注、要跟多少、第几轮），不按它的牌：快慢跟着牌走，就成了漏牌的信号。
 * - 翻牌前没人加注（只补一个大盲、过牌，或者弃）：顺手的事，0.25–0.5 秒（0.3.0 实打：原来弃牌也想 1.5–2.3 秒，
 *   大家都弃的一手也要 18–27 秒，6 人桌平均每手 41 秒、9 人桌 48 秒；目标 30 秒以内）；
 * - 其他：按性格 0.45–0.9 秒起，面对下注、翻牌以后多想一会儿；
 * - 难的决定（要跟的比池子大，或者占了手里三分之一以上）再想一会儿，最多 3.8 秒——久想本身就是个信号（0.2.3）；
 * - 这一场的状态（0.5.0，SeatState.form 的第 4 个数）：同一个性格这一场整体快一点或慢一点（×0.8–1.25），和它的打法一起浮动
 */
function think(t: Table, seat: number): number {
  const s = t.seats[seat]!;
  const mood = (s.form?.[3] ?? 1000) / 1000;
  const owe = Math.min(s.stack, t.currentBet - s.bet);
  // 7–9 人桌一圈要等七八个电脑：整体再快一档（0.3.0 连拍、实打量的）
  const crowd = t.seats.filter((x) => x.owner !== 'none').length >= 7 ? 0.7 : 1;
  if (t.board.length === 0 && owe <= t.bb) return (250 + Math.random() * 250) * crowd * mood * pace();
  // 顺序同 PERSONAS：稳哥、阿飙、老好、慢慢、算盘、江湖、虎子、老鹰、叨叨、小白
  const base = [650, 450, 700, 900, 750, 600, 450, 600, 550, 800][s.persona] ?? 650;
  const facing = owe > 0 ? 300 : 0;
  const later = t.board.length ? 100 : 0;
  const pot = t.seats.reduce((a, x) => a + x.total, 0);
  const hard = owe > 0 && (owe >= pot || owe * 3 >= s.stack) ? 800 + Math.random() * 600 : 0;
  return Math.min(hard ? 3_800 : 2_200, ((base + facing + later + Math.random() * 400) * crowd + hard) * mood) * pace();
}

// ---------- 大厅 ----------

async function boot(): Promise<void> {
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  // 点按声（0.10.0）：界面上的按钮轻轻"嗒"一下；出牌按钮、喇叭自己有声音，不叠
  document.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('button') : null;
    if (b && !b.disabled && !b.matches('.act, .qbet, .icon.sound')) play('tap');
  });
  window.addEventListener('keydown', unlockAudio, { once: true });
  // 云存档先建好再画大厅（0.3.7）：画大厅要读本机记着的房间，按 cloud.userId() 认是不是这个账号的。
  // 原来先画大厅、后建 cloud，刷新前在好友房里的（记着房间）一打开页面就报错、大厅画不出来
  // 有没有平台（10.1），顺带拿昵称（平台的 /api/me）；问不到（平台抖了一下）按有平台算
  const p = await detectPlatform();
  site.standalone = p.platform === false;
  const u = p.platform === true ? (p.user as { displayName?: unknown } | null) : null;
  if (typeof u?.displayName === 'string' && u.displayName) myName = u.displayName;
  if (site.standalone) standaloneUi();
  // 报位置、收邀请（docs/social.md 1.2、1.3，kit 的 social）：没平台、没登录 kit 回 null，一个请求都不发
  void mountSocial({ platform: p, where: presence, gameName: (id) => (id === 'texas' ? '德州扑克' : undefined), onGo: (inv) => void goInvite(inv.game, inv.room) }).then((h) => (social = h));
  cloud = createCloud({
    fetch: (...a) => fetch(...a),
    storage: localStorage,
    now: () => Date.now(),
    loggedInHint: () => /(?:^|;\s*)__Host-arcade_li=1/.test(document.cookie),
    setTimeout: (f, ms) => window.setTimeout(f, ms),
    clearTimeout: (h) => window.clearTimeout(h as number),
  });
  drawTop();
  showLobby();
  cloud.onChange(drawCloud);
  if (!site.standalone) await Promise.all([cloud.start(), refreshWallet()]);
  drawCloud();

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
  // 刷新前在房间里的不自动拉回去（0.2.3 试玩反馈："每次进去自动进入一个房间…完全打不了"）：标题页给"回到房间"，点了才进
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

/** 单独部署：藏起云存档（登录）和钱包，"大厅"回游戏首页，几句说法换成不记账的 */
function standaloneUi(): void {
  home.href = hall();
  toggle(cloudBtn, 'hidden', true);
  toggle(walletChip, 'hidden', true);
  setText(twoNote, twoText());
  lobby.standalone();
}

/** "大厅"：有平台回平台首页；单独部署回游戏自己的首页 */
const hall = (): string => (site.standalone ? './' : '/');

/** 单独部署时好友房带的昵称；有平台时用平台的，不带 */
const nickname = (): string | null => (site.standalone ? lobby.nickname() || null : null);

async function refreshWallet(): Promise<void> {
  if (site.standalone) return;
  const r = await getWallet();
  wallet = r.ok ? r.wallet : null;
  walletNote = r.ok ? null : walletError(r.error, r.retryAfter, 'api');
  drawTop();
}

function showLobby(): void {
  stage.classList.remove('at-table');
  lobby.home();
  notMyTurn();
  closeFun();
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
    resume: s ? { stakes: s.table.stakes, size: s.table.seats.length, practice: s.practice, level: s.table.level, waiting: s.pending !== null } : null,
    orphan: texasStakes(wallet, 'client').find((x) => x.ref !== s?.id) ?? null,
    busy,
    stats: cloud.stats(),
    room: back
      ? { code: back.code, text: inRoom ? `好友房 ${back.code} 里还有 ${chips(inRoom.amount)} 在桌上。${settle}` : `刚才在好友房 ${back.code}` }
      : null,
  });
  drawTop();
}

async function start(stakes: StakesId, size: number, amount: number, practice: boolean, level?: number): Promise<void> {
  if (busy) return;
  busy = true;
  drawLobby();
  const r = await Solo.open(deps, { userId: cloud.userId(), stakes, size, amount, practice, ...(level !== undefined ? { level } : {}) });
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
  drawLobby();
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
  feedSent.clear();
  stage.classList.add('at-table');
  tableView.setup(s.table.seats.length, ME);
  tableView.show(view(s.table, ME));
  // 单机也有互动（0.6.0）：对电脑扔道具、点名、发表情，电脑在本机按 kit 的 botReact 回
  openFun('solo');
  drawTop();
  refresh();
  // 先看完提示再发第一手（刚坐下的桌一张牌都没发）；接着打的桌从停下的地方接着
  void tips().then(() => drive(s.table.handNo === 0 && s.between ? s.next() : s.flush()));
}

/** 亮我刚才的牌：好友房交给房间，单机在本机做 */
function showMine(cards: number[]): void {
  if (online) online.act({ t: 'show', cards });
  else if (solo) void solo.showCards(cards).then(() => refresh());
}

/** 亮牌那一块：一手打完停着、我在这一手里、摊牌时没亮过才有；key 换了（新的一手）重新计时 */
function drawShow(v: View, key: string, until: number | null): void {
  const me = v.me;
  if (!v.hold || me === null || v.lastHand?.shown.some((x) => x.seat === me)) return showBar.hide();
  showBar.draw(v.kept, v.lastHand?.showed?.find((x) => x.seat === me)?.cards ?? [], key, until);
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
  if (!v.hold) showBar.hide();
  else if (animating === 0) drawShow(v, `s${v.handNo}`, null);
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
  // 亮牌只翻牌：不收两手之间那一栏、不停自动下一手的倒数
  if (st.action?.t === 'show') return tableView.play(view(st.prev, ME), view(st.next, ME), st.seat, st.action);
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
  syncFun();
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

/** 点了别人的名牌（关了互动、没坐下时点头像也是）：弹这一场的数（看对手，0.2.2） */
function showRead(i: number): void {
  const v = curView();
  if (!v?.seats[i]) return;
  const r = reads.get(who(v)(i));
  tableView.showCard(i, styleTag(r), readLines(r));
}

// ---------- 互动（kit 的 TableFun，0.13.0，DESIGN.md 13.7）、顺手提示、名场面、称号 ----------

/** 现在桌上的视图（好友房、单机）和我坐的座位；不在桌上是 null */
function curView(): View | null {
  return online ? online.state.view : solo ? view(solo.table, ME) : null;
}
function mySeat(): number | null {
  return online ? (online.state.you?.seat ?? null) : solo ? ME : null;
}

/** 座位上的人怎么称呼（名场面横幅、称号）：我是"你"，好友房真人用昵称，电脑用性格名 */
function nameAt(v: View, i: number, me: number | null): string {
  if (i === me) return '你';
  const info = online?.state.room?.seats[i];
  if (info?.kind === 'human' && info.name) return info.name;
  return personaName(v.seats[i]!.persona);
}

/** 头像菜单里的三句点名短语：一句挑衅、一句激将、一句服气 */
const MENU_SAYS = ['就这？', '跟啊，怕了？', '好牌，服了'] as const;

/**
 * 进桌（单机、好友房）时建互动组件。座位、按钮、禁区每次用到时现问：
 * 头像矩形按实际画出来的算（舞台整体缩放过，getBoundingClientRect 就是屏幕上的）；名字用屏蔽名单的那个（真人昵称、电脑性格名、我自己的昵称）
 */
function openFun(scope: string): void {
  tf?.destroy();
  // 单机这时牌桌已经摆好，量得出挤不挤；好友房还在等人页，等座位坐满再量（drawRoom）
  crowded = online ? null : !dockFitsNow();
  tf = new TableFun({
    storageKey: 'texas',
    phrases: TAUNTS,
    named: MENU_SAYS.map((t) => tauntId(t)),
    seats: () => {
      const v = curView();
      const me = mySeat();
      return (v?.seats ?? []).map((s, i): FunSeat | null => {
        const rect = s.owner === 'none' ? null : tableView.avatarRect(i);
        if (!rect) return null;
        const bot = s.owner === 'house';
        const plate = tableView.plateRect(i);
        return { rect, ...(plate ? { plate } : {}), name: i === me ? myName : nameAt(v!, i, null), me: i === me, bot, ...(bot ? { temper: temperOf(s.persona) } : {}) };
      });
    },
    avoid: () => tableView.keepOut(),
    // kit 0.19 的聊天：中间的公共牌、底池弹幕不横穿；省内存的设备弹幕默认关（scene.ts 判断，根上的 .lowfx）
    center: () => tableView.centerRects(),
    lite: () => document.documentElement.classList.contains('lowfx'),
    // 电脑版聊天框：自己挑一个不压座位、不压下注按钮的地方（顶栏、左下"互动"那一排、两手之间那一栏也算在要躲的里面）
    chatDock: () => {
      const d = dockSize();
      return chatFolded() ? tableView.chatDock(120, 48, dockAvoid()) : tableView.chatDock(d.w, d.h, dockAvoid());
    },
    // 玩家自己没点过收起、展开时：放不下就默认收着（kit 0.20.1）
    chatFolded: () => crowded === true,
    // 大屏上舞台放大到 1.5–2 倍，"互动""聊天"按钮的字（13 px）和图标（22 px）跟着放大，手机上不缩小（kit 0.20.1）
    buttonStyle: () => {
      const k = Math.max(1, getFit().scale);
      return { fontSize: Math.round(13 * k), icon: Math.round(22 * k) };
    },
    button: () => (funSlot.classList.contains('hidden') ? null : funSlot.getBoundingClientRect()),
    send: (id, to) => {
      toggle(funHints, 'hidden', true);
      if (online) online.emote(id, to);
      else tf?.receive(ME, id, to);
    },
    canSend: () => funReady(),
    enabled: () => !funOff,
    // 好友房才有聊天（kit 0.18）：房间过滤、限速后只转发，不进状态、不存
    // 聊天（kit 0.18）：好友房经房间转发；单机（0.19.3，所有者要求）用 kit 的 localChat 在本机过一遍和房间一样的过滤、限速，
    // 只冒在我自己头上。电脑不读聊天（公平：说什么都不影响电脑怎么打、怎么起哄）
    chat: online ? (text: string) => online!.chat(text) : localChat((text, masked) => tf?.chat(ME, text, masked)),
    chatEnabled: chatOn,
    chatButton: () => (chatSlot.classList.contains('hidden') ? null : chatSlot.getBoundingClientRect()),
    scope: () => scope,
    localBots: !online,
    sound: (prop, phase) => funSound(prop, phase),
    onHit: (seat) => tableView.hit(seat),
  });
  toggle(chatBtn, 'hidden', false);
  drawChatBtn();
  syncFun();
}

/**
 * kit 的电脑版聊天框多大：画出来了按实际的量；还没画时按 kit 的字号估（宽是字号的 17 倍，高约 12 倍）。
 * 0.21.1 以前写死 340×220，kit 0.20.2 的聊天框在 1920 上高到 237，底边压住了左下座位的"大盲"（10-18 截图）
 */
function dockSize(): { w: number; h: number } {
  const el = document.querySelector<HTMLElement>('[data-key="chat:dock"]');
  if (el && el.offsetHeight > 0) return { w: el.offsetWidth, h: el.offsetHeight };
  const font = chatFont({ width: window.innerWidth, height: window.innerHeight });
  return { w: Math.round(font * 17), h: Math.round(font * 12) };
}

const dockFitsNow = (): boolean => {
  const d = dockSize();
  return tableView.dockFits(d.w, d.h, dockAvoid());
};

/** 聊天框要躲的：顶栏、左下"互动"那一排、两手之间那一栏 */
function dockAvoid(): DOMRect[] {
  return [top, betweenBar, ...hud.children].map((e) => e.getBoundingClientRect());
}

/**
 * 这一桌的电脑版聊天框放不下（1280×720 的 6 人桌，哪儿都要盖住座位、按钮或公共牌）：进桌时量一次，量完不再变，免得座位一变聊天框一会儿收一会儿开。
 * null 是好友房还没坐满、没量
 */
let crowded: boolean | null = null;

/** 电脑版聊天框现在是收着的（玩家自己点过的以 kit 记的设置 texas.chat 为准，没点过看 crowded）：收着时只给小按钮找位置 */
function chatFolded(): boolean {
  const own = readJson<{ folded?: unknown }>(KEYS.chat)?.folded;
  return typeof own === 'boolean' ? own : crowded === true;
}

/** 聊天开关三档（0.20.0）：开 → 不和陌生人（快速匹配桌不聊，好友房、单机照常）→ 不看 */
type ChatMode = 'on' | 'friends' | 'off';
const chatMode = (): ChatMode => (chatOff ? 'off' : strangerChat ? 'on' : 'friends');
const CHAT_MODE: Record<ChatMode, { label: string; next: ChatMode; tip: string }> = {
  on: { label: '聊天：开', next: 'friends', tip: '聊天：开' },
  friends: { label: '聊天：不和陌生人', next: 'off', tip: '聊天：不和陌生人（快速匹配的桌上不聊，好友房照常）' },
  off: { label: '聊天：不看', next: 'on', tip: '聊天：不看（别人说的话不显示，自己也不能说）' },
};

function drawChatBtn(): void {
  const m = chatMode();
  const mark =
    m === 'off'
      ? '<path d="M4 4l16 16" stroke="currentColor" stroke-width="2"/>'
      : m === 'friends'
        ? '<circle cx="12" cy="10.5" r="1.6" fill="currentColor"/>'
        : '<path d="M8 10.5h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>';
  chatBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16v10H10l-4.5 3.5V15.5H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>${mark}</svg>`;
  chatBtn.setAttribute('aria-label', `${CHAT_MODE[m].label}（点一下换）`);
  chatBtn.title = chatBtn.getAttribute('aria-label')!;
  chatBtn.dataset.mode = m;
  toggle(chatBtn, 'sel', m !== 'off');
}

chatBtn.addEventListener('click', () => {
  const next = CHAT_MODE[chatMode()].next;
  chatOff = next === 'off';
  strangerChat = next === 'on';
  patchSettings({ chatOff, strangerChat });
  drawChatBtn();
  syncFun();
  // kit 每次开面板、每收到一句都现问 chatEnabled，不用重建组件（重建会丢掉内存里的聊天记录）。
  // 匹配桌上从"不和陌生人"换回"开"：这次连接没带 chat=1，下回进桌才收得到
  toast(CHAT_MODE[next].tip);
});

function closeFun(): void {
  tf?.destroy();
  tf = null;
  toggle(chatBtn, 'hidden', true);
  toggle(funHints, 'hidden', true);
  toggle(funSlot, 'hidden', true);
  document.body.classList.remove('texas-fun-idle');
}

/** 这会儿有没有聊天（kit 每次开面板、每收到一句都现问） */
function chatOn(): boolean {
  return !chatOff && (!online?.match || (online.chatOn && strangerChat));
}

/** 我坐着、没关互动：头像点开的是 kit 的菜单；不然（旁观、关了）头像的点按穿过去给牌桌（看对手、接管座位） */
function funReady(): boolean {
  return mySeat() !== null && !funOff;
}

/** 座位、按钮、开关变了：重摆 kit 的热区和按钮 */
function syncFun(): void {
  if (!tf) return;
  toggle(funSlot, 'hidden', !funReady());
  const phoneRow = chatLayout({ width: window.innerWidth, height: window.innerHeight }) === 'phone' && !stage.classList.contains('tall');
  toggle(chatSlot, 'hidden', !(funReady() && chatOn() && phoneRow));
  document.body.classList.toggle('texas-fun-idle', !funReady());
  tf.refresh();
}

/** 一手打完：名场面横幅、记称号的数（单机、好友房都有）；给我顺手提示；名场面交给 kit，单机的电脑按性格起哄 */
function handDone(prev: View, next: View, me: number | null): void {
  const h = handOver(prev, next);
  if (!h) return;
  const sc = showcase(h.r, h.log);
  if (sc && tf && !funOff) {
    play('banner');
    tf.banner(showcaseText(sc, nameAt(prev, sc.seat, me), h.r));
  }
  // 称号的数单机、好友房都记（0.3.0 实打后单机结算页也给称号）
  const key = who(prev);
  tally.observe(h.r, h.log, (i) => ({ key: key(i), name: i === me ? myName : nameAt(prev, i, null) }));
  if (me !== null) reportMoment(feedMoment(h.r, h.log, me, stakesOf(prev.stakes).bb));
  if (funOff || !tf) return;
  if (me !== null) showHints(suggest(h.r, h.log, me));
  // 好友房的电脑由房间替它反应（worker/room.ts），这里只在单机报
  const m = online ? null : momentOf(h.r, h.log);
  if (m) tf.moment({ kind: 'moment', moment: m.moment, winners: [m.winner], losers: m.losers, hand: h.r.handNo });
}

let hintTimer = 0;
function showHints(ids: number[]): void {
  window.clearTimeout(hintTimer);
  funHints.textContent = '';
  for (const id of ids) {
    const b = el('button', 'fun-hint', funHints, TAUNTS[id]!);
    b.type = 'button';
    b.addEventListener('click', () => funSend(id));
  }
  toggle(funHints, 'hidden', !ids.length);
  hintTimer = window.setTimeout(() => toggle(funHints, 'hidden', true), 6_000);
}

/** 不经 kit 菜单发的（顺手提示、催促炸弹）：和菜单走同一条路，好友房经房间转发，单机直接交给组件播 */
function funSend(id: number, to?: number): void {
  if (!tf || !funReady()) return;
  toggle(funHints, 'hidden', true);
  if (online) online.emote(id, to);
  else tf.receive(ME, id, to);
}

funOffBtn.addEventListener('click', () => {
  funOff = !funOff;
  saveFunOff(localStorage, funOff);
  if (funOff) {
    tf?.closeAll();
    toggle(funHints, 'hidden', true);
  }
  toast(funOff ? '互动：不看（别人的道具、表情、短语和电脑说话都不显示）' : '互动：开');
  syncFun();
  drawTop();
});

function drawFunToggle(): void {
  funOffBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="8.8" cy="10" r="1.4" fill="currentColor"/><circle cx="15.2" cy="10" r="1.4" fill="currentColor"/>${funOff ? '<path d="M4 4l16 16" stroke="currentColor" stroke-width="2"/>' : '<path d="M7.8 14.2c1 1.7 2.5 2.6 4.2 2.6s3.2-.9 4.2-2.6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'}</svg>`;
  funOffBtn.setAttribute('aria-label', funOff ? '互动：不看（点一下打开）' : '互动：开（点一下不看）');
  funOffBtn.title = funOffBtn.getAttribute('aria-label')!;
  toggle(funOffBtn, 'sel', !funOff);
}

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
    const back = s.session.practice ? '' : '桌上的筹码带回钱包。';
    const ok = await dialog(stage, '离桌', inHand ? `这一手会弃牌。${back}` : back || '回大厅，这一桌就结束了。', [
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
  // 称号（0.3.0 实打后单机也给）：诈唬王、天选之人、跟注站按全桌；输赢只知道我的，赢了给"大赢家"，输了不点名（单机就一个真人）
  const titles = tally.titles(s.left > st.buyin ? [{ name: myName, net: s.left - st.buyin }] : []);
  const sum: SoloSummary = {
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
    titles,
  };
  // 分享卡（docs/social.md 1.1）：单独部署没有，还没打完一手的也不给
  await soloSummary(stage, site.standalone || !st.hands ? sum : { ...sum, share: shareIt(soloCard(sum, soloWhere(s), myName)) });
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

/**
 * 主题房（0.18.1，view/rooms.ts）：好友房按房间的档位，单机实盘按这一桌的档位，娱乐都在小桌那一间；
 * 标题页按选桌上选中的那一档（主页是小桌那一间）
 */
function drawRoomTheme(): void {
  const v = online?.state.view;
  const id = online ? (v?.stakes ?? online.state.opts?.stakes ?? null) : stage.classList.contains('at-table') && solo ? (solo.session.practice ? null : solo.table.stakes) : lobbyRoom;
  setRoom([stage, scene], id);
  tableView.setMark(ROOM_NAME[id ?? 'small']);
}

function drawTop(): void {
  drawFunToggle();
  drawRoomTheme();
  if (online) return drawRoomTop(online.state);
  const at = stage.classList.contains('at-table') && solo;
  const diff = solo?.session.practice ? difficultyOf(solo.table.level) : null;
  setText(where, at ? `${solo!.session.practice ? `娱乐 · ${diff ? DIFFICULTY_NAME[diff] : stakesOf(solo!.table.stakes).name}` : stakesOf(solo!.table.stakes).name} · 盲注 ${chips(solo!.table.sb)}/${chips(solo!.table.bb)}` : '');
  setText(walletChip, wallet && at && !solo!.session.practice ? `钱包 ${chips(wallet.balance)}` : '');
  toggle(leaveBtn, 'hidden', !at);
  const loud = settings.volume > 0.5;
  soundBtn.innerHTML = settings.sound
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 8.5a5 5 0 0 1 0 7${loud ? 'M18.5 6a8.5 8.5 0 0 1 0 12' : ''}" fill="none" stroke="currentColor" stroke-width="2"/></svg>`
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l5 6m0-6-5 6" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  soundBtn.setAttribute('aria-label', !settings.sound ? '静音（点一下开大声）' : loud ? '大声（点一下调小）' : '小声（点一下静音）');
  soundBtn.title = soundBtn.getAttribute('aria-label')!;
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
  // 大声 → 小声 → 静音 → 大声
  if (!settings.sound) Object.assign(settings, { sound: true, volume: 0.8 });
  else if (settings.volume > 0.5) settings.volume = 0.35;
  else settings.sound = false;
  setSound(settings.sound);
  setVolume(settings.volume);
  if (settings.sound) play('tap');
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
      location.href = hall();
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
  const r = await createRoom({ stakes, size }, nickname());
  busy = false;
  if ('code' in r && !('error' in r)) enterRoom({ code: r.code, userId: cloud.userId(), host: true, at: Date.now() });
  else {
    walletNote = createError('error' in r ? r.error : 'unavailable');
    drawLobby();
  }
}

// ---------- 快速匹配（kit 0.20.0，DESIGN.md 6.11） ----------

/** 正在排的队（同一时间只排一个） */
let matcher: MatchClient | null = null;

/**
 * 这一档排队找真人：排队卡写"正在找人 · 已有 n/6 人 · 还剩 s 秒"，"不等了，和电脑打"和"取消"都是 cancel。
 * 排到了进匹配桌（藏起房间码、叫人、选座、开打）；已经有开着的房间就回那一桌；只剩自己、今天的局数用完、联机忙时说一句（MATCH_TEXT），
 * 过一秒多转成同一档的单机（照常从钱包带入）。被同一个账号别处的排队顶掉（replaced）不开单机。
 * 娱乐档（fun，0.21.0）：所有难度排同一队，排到的是不记筹码的娱乐房间；转单机时按选的难度开娱乐单机
 */
async function quickMatch(stakes: StakesId, fun: boolean, level: number): Promise<void> {
  if (busy || matcher) return;
  const st = stakesOf(fun ? FUN_STAKES : stakes);
  const body = el('div', 'match-card');
  el('div', 'mc-tier', body, fun ? `娱乐 · 筹码不算数 · ${MATCH_TABLE} 人桌` : `实盘 · ${st.name} · 盲注 ${chips(st.sb)}/${chips(st.bb)} · ${MATCH_TABLE} 人桌`);
  const line = el('div', 'mc-wait', body);
  el('div', 'mc-tip', body, '找到几个算几个，空位电脑补；只剩你一个就先和电脑打');
  // 冒烟看排队卡说过什么（排到、转单机时卡片马上就关了）
  const said = ((window as { __said?: string[] }).__said ??= []);
  const say = (t: string): void => {
    setText(line, t);
    said.push(t);
  };
  let tick = 0;
  /** 排到了、回原来的房间：卡片由这里关，之后什么都不做 */
  let entered = false;
  /** 房间说转单机：说完那句话一秒多后关卡片、开单机；这一秒里点了"取消"就不开 */
  let soloNow = false;
  let soloTimer = 0;
  let count = 0;
  let seats = MATCH_TABLE;
  let until = 0;
  const draw = (): void => say(`正在找人 · 已有 ${count}/${seats} 人 · 还剩 ${Math.max(0, Math.ceil((until - Date.now()) / 1000))} 秒`);
  const stop = (): void => {
    window.clearInterval(tick);
    matcher?.cancel();
    matcher = null;
  };
  say('正在找人…');
  const mc = new MatchClient({
    url: matchUrl(matchTierOf(stakes, fun)),
    onWaiting: (n, size, leftMs) => {
      count = n;
      seats = size;
      until = Date.now() + leftMs;
      draw();
      if (!tick) tick = window.setInterval(draw, 1_000);
    },
    onMatched: (code) => {
      stop();
      entered = true;
      closeDialog();
      enterRoom({ code, userId: cloud.userId(), host: false, at: Date.now(), match: true, ...(fun ? { fun: true as const } : {}) });
    },
    onHasRoom: (code) => {
      stop();
      entered = true;
      closeDialog();
      joinRoom(code);
    },
    onSolo: (why) => {
      stop();
      say(MATCH_TEXT[why]);
      if (why === 'replaced') return;
      soloNow = true;
      soloTimer = window.setTimeout(closeDialog, 1_200);
    },
  });
  matcher = mc;
  mc.start();
  const pick = await dialog(
    stage,
    '快速匹配',
    body,
    [
      { label: '不等了，和电脑打', value: 'solo' },
      { label: '取消', value: 'cancel', primary: true },
    ],
    true,
  );
  window.clearTimeout(soloTimer);
  if (entered) return;
  stop();
  // 人点了"不等了"，或者房间说转单机、卡片到点自己关了（pick 是 null）；点了"取消"什么都不开
  if (pick === 'solo' || (pick === null && soloNow)) void matchSolo(stakes, fun, level);
}

/** 匹配没排到人：同一档开一桌单机，6 人桌，钱包够就带满一份（不够少带一点，和选桌一样） */
function matchSolo(stakes: StakesId, fun: boolean, level: number): Promise<void> {
  if (fun) return start(FUN_STAKES, MATCH_TABLE, stakesOf(FUN_STAKES).max, true, level);
  const st = stakesOf(stakes);
  return start(stakes, MATCH_TABLE, topBuyIn(st, wallet?.balance ?? 0), false);
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
  feedSent.clear();
  // 存不上：标题页只是不给"回到房间"
  writeJson(KEYS.lastRoom, { ...r, at: Date.now() });
  online?.close();
  lastRefused = null;
  wasBuying = false;
  laidOut = { size: 0, me: -1 };
  stage.classList.add('in-room');
  closeDialog();
  // 换了房间、离开以后，旧连接还没播完的帧和状态回调一律不理
  const o: Online = new Online(r, roomUi(() => online === o), { name: nickname(), chat: !r.match || strangerChat });
  online = o;
  openFun(`room:${r.code}`);
  social?.presenceNow(true);
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
      location.href = hall();
    }
    return;
  }
  const ok = await dialog(
    stage,
    '离开房间',
    seated && playing ? (noWallet() ? '这一手弃牌，离开后座位空出来。' : '这一手弃牌，桌上的筹码马上结回钱包。') : seated ? '离开后座位空出来。' : '不看了？',
    [
      { label: '留下', value: 'no' },
      { label: '离开', value: 'yes', primary: true },
    ],
  );
  if (ok !== 'yes' || online !== o) return;
  // 确认的这一会儿断了：按断线的说
  if (seated && o.state.status !== 'open') return leaveRoom(goHome);
  const rows = summaryRows(o.state, true);
  // 回大厅的不出结算页，也就不用先画分享卡
  const share = rows && !goHome ? roomShare(o.state, rows, true) : undefined;
  if (seated) o.leaveSeat();
  // 离座的消息先发出去再断开
  await new Promise((done) => window.setTimeout(done, 300));
  o.close();
  forgetRoom();
  // 还没结回的那一份由标题页按钱包说（drawLobby），这里不另记一句：记了会一直挂着，和钱包对不上
  exitRoom(null);
  if (rows && !goHome) await roomSummary(stage, '这一场', null, rows, tally.awards(rows), share);
  if (goHome) {
    cloud.flush();
    location.href = hall();
  }
}

/**
 * 好友房这一场每个人的输赢（房间按座位记的账，RoomView.net）。没人带过筹码时 null。
 * leaving：我正要离开，手里这一手会弃牌，已经下的注算输
 */
/** 报位置、收邀请的部件（mountSocial 回来以后才有；没平台、没登录一直是 null） */
let social: SocialHandle | null = null;

/** 我在哪（kit 每次报之前现问）：在好友房里报房间码和"真人/座位数"，别的时候报在玩德州 */
function presence(): Presence {
  const s = online?.state;
  // 快速匹配桌（0.20.0）进不去（不是这一桌的人房间回 4004），不报房间码
  if (!s?.room || online?.match) return { place: 'game', game: 'texas' };
  const humans = s.room.seats.filter((x) => x.kind === 'human').length;
  const size = s.view?.size ?? s.opts?.size ?? s.room.seats.length;
  return { place: 'room', game: 'texas', room: s.code, seats: `${humans}/${size}` };
}

/** 点了邀请横条的"去"：正在牌桌上的先问一句（单机这一桌留在本机，回来接着打；好友房的座位照旧，掉线算歇着） */
async function goInvite(game: string, room: string): Promise<void> {
  if (stage.classList.contains('at-table')) {
    const ok = await dialog(stage, '去朋友的房间', '先离开这一桌？单机这一桌会留着，回来接着打。', [
      { label: '留下', value: 'no' },
      { label: '去', value: 'yes', primary: true },
    ]);
    if (ok !== 'yes') return;
  }
  cloud.flush();
  location.assign(`/games/${game}/?room=${room}`);
}

/** 单机这一桌怎么称呼（分享卡的标题）：娱乐写难度，实盘写档位 */
function soloWhere(s: Solo): string {
  const diff = s.session.practice ? difficultyOf(s.table.level) : null;
  return s.session.practice ? `娱乐 · ${diff ? DIFFICULTY_NAME[diff] : stakesOf(s.table.stakes).name}` : stakesOf(s.table.stakes).name;
}

/** 好友房结算页的"分享"：单独部署没有；withRoom 时链接带房间码（房间还开着，朋友点了能进来看） */
function roomShare(s: OnlineState, rows: RoomSummaryRow[], withRoom: boolean): (() => void) | undefined {
  const v = s.view;
  if (site.standalone || !v) return undefined;
  const card = roomCard(rows, tally.awards(rows), `${stakesOf(v.stakes).name} · ${v.size} 人桌`, myName);
  return card ? shareIt(card, withRoom && !online?.match ? s.code : null) : undefined;
}

/**
 * 分享卡交给 kit（系统分享或预览层）；链接是游戏首页，好友房带房间码。
 * 结算页一出来就先画好（kit 0.12.3）：iOS 只许在点击那一下里调系统分享，点了再画就过期了，所以点击里不能先 await
 */
function shareIt(card: ShareCard, room: string | null = null): () => void {
  const url = `${location.origin}${location.pathname}${room ? `?room=${room}` : ''}`;
  const p = prepareShare(card, { url });
  return () => void p.share().catch((e: unknown) => console.warn('texas: share failed', e));
}

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
  social?.presenceNow(true);
  if (!keep) saveRoom(null);
  stage.classList.remove('in-room', 'at-table');
  toggle(backSeatBtn, 'hidden', true);
  toggle(spectate, 'hidden', true);
  toggle(sitDownBtn, 'hidden', true);
  tableView.setPeople(null);
  tableView.setClock(null, null, 1);
  drawRoomPause(null);
  toggle(betweenBar, 'hidden', true);
  toggle(twoNote, 'hidden', true);
  drawRebuy(null);
  toggle(inviteBtn, 'hidden', true);
  drawUrge(null, null);
  botQueue.length = 0;
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
    if (animating === 0 && botQueue.length) flushBots();
    syncFun();
  },
  toast: (text) => {
    if (mine()) toast(text);
  },
  // 真人发的即时画；房间替电脑发的（0.6.1，kit 0.10 的 botEmote）房间一算完就到：一手打完那一下页面多半还在播这一手，排着播完再交给 kit
  // （kit 收到电脑座位发来的会再晚 0.9 秒播、配一句话，像人看一眼再回）
  chat: (seat, text, masked) => {
    if (mine()) tf?.chat(seat, text, masked);
  },
  chatError: (code) => {
    if (mine()) tf?.chatError(code);
  },
  emote: (seat, id, to, bot) => {
    if (!mine()) return;
    if (!bot) return tf?.receive(seat, id, to);
    botQueue.push([seat, id, to]);
    if (animating === 0) flushBots();
  },
  ended: (text, code) => {
    const o = online;
    if (!mine() || !o) return;
    // 房间关了、没有这个房间：本机记着的都清掉，标题页不再给"回到房间"
    if (code === CLOSE.noRoom || code === CLOSE.roomClosed) forgetRoom();
    // 房间关了是这一场打完了：给每个人的输赢；别的（被顶掉、连不上）只说一句
    const rows = code === CLOSE.roomClosed ? summaryRows(o.state, false) : null;
    // 房间关了：分享链接不带房间码（进不去了）
    const share = rows ? roomShare(o.state, rows, false) : undefined;
    exitRoom(null, code === CLOSE.replaced);
    if (rows) void roomSummary(stage, '这一场', text, rows, tally.awards(rows), share);
    else void dialog(stage, '好友房', text, [{ label: '好', value: 'ok', primary: true }]);
  },
  wait: (ms) => new Promise((ok) => window.setTimeout(ok, ms * pace())),
});

/** 房间替电脑发的、等这一手播完再画的（seat、id、to） */
const botQueue: [number, number, number | undefined][] = [];
function flushBots(): void {
  for (const [seat, id, to] of botQueue.splice(0)) tf?.receive(seat, id, to);
}

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
      takeable: spectator && !online!.match && info.kind === 'ai' && !info.reserved,
    };
  });
  tableView.setPeople(people);
  const turn = s.room.turn;
  // 一手和一手之间也在计时的，是开打时在等这个人的买入（OPENING_MS）
  tableView.setClock(s.busy ? null : (turn?.seat ?? null), turn?.deadline ?? null, v.phase === 'idle' ? OPENING_MS : TURN_MS);
  drawRoomPause(s.busy || animating > 0 ? null : (s.room.pause?.until ?? null));
  // 亮牌：房间停顿的前 SHOW_MS（停顿从这一手最后一帧播完算，和倒计时圈同一个起点）
  const until = s.room.pause?.until;
  if (!v.hold) showBar.hide();
  else if (until && !s.busy && animating === 0) drawShow(v, `${s.code}:${v.handNo}`, until - (HAND_PAUSE_MS - SHOW_MS));
  toggle(twoNote, 'hidden', !v.needTwo);
  if (v.needTwo) toggle(betweenBar, 'hidden', false);
  if (!s.busy && animating === 0) tableView.show(v);
  // 进房时还在等人页、牌桌没排座位，量不出聊天框挤不挤：等座位都坐上人（真人带入完）再量一次，kit 下次摆的时候按它收不收
  if (crowded === null && !s.busy && animating === 0 && v.seats.every((x) => x.owner !== 'none')) {
    crowded = !dockFitsNow();
    tf?.refresh();
  }

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
  // 互动只有坐着的人能发（kit：旁观的不能发，免得刷屏）
  syncFun();
  // 快速匹配桌叫不进人（0.20.0）
  toggle(inviteBtn, 'hidden', online!.match);
  toggle(spectate, 'hidden', !people.some((p) => p.takeable));
  toggle(sitDownBtn, 'hidden', !people.some((p) => p.takeable));

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

/** 这一桌的筹码不碰钱包：单独部署，或者娱乐房间（0.21.0） */
const noWallet = (): boolean => site.standalone || online?.fun === true;

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
  const ok = !!turn && turn.deadline != null && me !== null && turn.seat !== me && info?.kind === 'human' && !info.auto && !funOff;
  const key = ok ? `${turn!.seat}:${turn!.deadline}` : '';
  if (key === urgeFor) return;
  urgeFor = key;
  window.clearTimeout(urgeTimer);
  tableView.urge(null, () => {});
  if (!ok) return;
  const seat = turn!.seat;
  const at = turn!.deadline! - TURN_MS + URGE_AFTER_MS;
  urgeTimer = window.setTimeout(() => tableView.urge(seat, () => funSend(propId(TAUNTS.length, PROPS.indexOf('bomb')), seat)), Math.max(0, at - Date.now()));
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
  // 旁观中（docs/social.md 1.4）：开打了、我没坐下也没绑着座位（离座回来的有"回到我的座位"）
  const watching = s.room?.status === 'playing' && (s.you?.seat ?? null) === null && (s.you?.bound ?? null) === null;
  const kind = online?.match ? '快速匹配' : `好友房 ${s.code}`;
  // 娱乐房间（0.21.0）不写档位：筹码不算数，盲注照小桌
  const table = online?.fun ? ' · 娱乐 · 筹码不算数' : st ? ` · ${st.name} · 盲注 ${chips(st.sb)}/${chips(st.bb)}` : '';
  setText(where, `${watching ? '旁观中 · ' : ''}${kind}${table}`);
  toggle(where, 'watching', watching);
  setText(walletChip, wallet && !online?.fun ? `钱包 ${chips(wallet.balance)}` : '');
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
  const how = site.standalone ? `带 ${chips(st.max)} 上桌。` : `从钱包带 ${chips(st.max)} 上桌，离开时结回钱包。`;
  const ok = await dialog(stage, '接管这个座位', `电脑这一手弃牌，下一手起你坐这里：${how}`, [
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
  const add = noWallet() ? full : Math.max(Math.min(full, seated ? st.bb : st.min), affordable(full, st.bb));
  const later = mine?.status !== 'out' && v.phase !== 'idle' ? '，这一手打完上桌' : '';
  const to = seated ? `补到 ${chips(mine.stack + add)}` : '上桌';
  const msg = noWallet() ? `带 ${chips(add)} ${to}${later}。` : `从钱包带 ${chips(add)} ${to}${later}（钱包里有 ${wallet ? chips(wallet.balance) : '—'}）。`;
  const ok = await dialog(stage, '补码', msg, [
    { label: '算了', value: 'no' },
    { label: '补码', value: 'yes', primary: true },
  ]);
  if (ok === 'yes') online?.act({ t: 'rebuy', ...(add < full ? { amount: add } : {}) });
}

/**
 * 叫朋友来（0.14.0 起用 kit 的面板）：有平台、已登录的列好友、一人一个"叫他来"，底下复制链接（手机上弹系统分享）；
 * 没挂上 social（单独部署、没登录）只有复制链接。链接按这一页自己的路径拼、只带房间码（档位、人数进房后房间会告诉他）；
 * 朋友没登录的，登录完平台跳回原链接（登录页的 next），照样进房
 */
function invite(): void {
  const s = online?.state;
  if (!s) return;
  const u = new URL(location.pathname, location.origin);
  u.searchParams.set('room', s.code);
  const o = { game: 'texas', room: s.code, url: u.toString(), text: `来打德州，好友房 ${s.code}，点开就进` };
  if (social) social.openInvite(o);
  else openInvite({ ...o, friends: false });
}

/** 这一局（坐上一桌到离开，进一个房间到离开）已经报过的名场面 */
const feedSent = new Set<FeedMoment>();

/**
 * 好友动态的名场面（0.16.0，平台 15.17 第 2 条）：只报编号和数字，文字由 public/moments.json 的模板拼。
 * 只在有平台、已登录（social 挂上了）时报；单机、好友房都报；失败不管（平台每人每天也只收 10 条，超了静默丢）
 */
function reportMoment(m: { moment: FeedMoment; n: number } | null): void {
  if (!m || !social || !shouldReport(feedSent, m.moment)) return;
  feedSent.add(m.moment);
  void postMoment('texas', m.moment, m.n).catch(() => {});
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
