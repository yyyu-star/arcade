/**
 * 页面入口：选桌页、好友房的等人页、赛道，接单机、好友房、声音和看得见的区域。
 * 规则在 src/core，单机的流程在 solo.ts，好友房的连接在 online.ts，这里只把它们和画面连起来。
 */
import { PERSONAS } from './ai/personas.ts';
import { DEFAULT_OPTS, checkOpts } from './core/rules.ts';
import { Banter, factsOf, react, reply, snapOf, urge, type Snap, type Talk } from './game/banter.ts';
import type { Action, Ev, Opts, Plan } from './core/types.ts';
import type { View } from './core/view.ts';
import { detectPlatform } from 'arcade-kit/client';
import { clockSkew, createError, createRoom, Online, setNickname, type OnlineState } from './online.ts';
import { clearSolo, loadSolo, ME, newSolo, Solo } from './solo.ts';
import { TUTORIAL_KEY, TUTORIAL_OPTS, TUTORIAL_STORE } from './game/tutorial.ts';
import { Tutor } from './tutor.ts';
import { getTrack } from './track/index.ts';
import { Board } from './view/board.ts';
import { Comms } from './view/comms.ts';
import { Dash, type Presets } from './view/dash.ts';
import { closeAllDialogs, closeDialog, confirmBox, dialog } from './view/dialog.ts';
import { button, el } from './view/dom.ts';
import { showRules } from './view/guide.ts';
import { renderLobby } from './view/lobby.ts';
import { renderWaiting, rulesLine, shareRoom } from './view/room.ts';
import { renderSide, type SeatName } from './view/side.ts';
import { play, setSound, unlockAudio, type Sfx } from './view/sound.ts';
import { CAR_COLORS, GAME_NAME, MOVE_ERROR } from './view/text.ts';
import { watchViewport } from './view/viewport.ts';
import './view/style.css';

// ---------- 设置 ----------

const PREFS_KEY = 'racing.prefs';
interface Prefs {
  sound: boolean;
  fast: boolean;
  opts: Opts;
  presets: Presets;
}
const DEFAULT_PRESETS: Presets = { boost: 'ask', adren: 'ask', slip: 'ask', markDiscard: true };
/** 新手教程：一律"问我"，好让冲刺、尾流、拼劲、弃牌的提问都出现（弃牌只问第一次，tutor.ts 的 plan）；不动玩家存的预设 */
const TUTORIAL_PRESETS: Presets = { boost: 'ask', adren: 'ask', slip: 'ask', markDiscard: false };

function loadPrefs(): Prefs {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>;
    return { sound: p.sound !== false, fast: p.fast === true, opts: checkOpts(p.opts) ?? { ...DEFAULT_OPTS }, presets: { ...DEFAULT_PRESETS, ...(p.presets ?? {}) } };
  } catch {
    return { sound: true, fast: false, opts: { ...DEFAULT_OPTS }, presets: { ...DEFAULT_PRESETS } };
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

/** 冒烟用：?turbo 让动画和电脑几乎不停顿 */
const TURBO = new URLSearchParams(location.search).has('turbo');
const reduceMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
/** 冲线的动画放完以后停一会儿再弹结算，看得到冲线（DESIGN.md 8"结算"）；减少动态效果时不等 */
function resultDelay(): number {
  return TURBO ? 50 : reduceMotion() ? 0 : 1_200;
}

// ---------- 骨架 ----------

const app = document.getElementById('app')!;
const stage = el('div', 'stage', app);
const top = el('div', 'topbar', stage);
const home = el('a', 'home', top);
home.href = '/';
home.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11 12 3l9 8v10h-6v-6H9v6H3z"/></svg><span>大厅</span>';
const title = el('span', 'title', top, GAME_NAME);
el('span', 'spacer', top);
const speedBtn = button('icon', top, '', () => {
  prefs.fast = !prefs.fast;
  savePrefs();
  paintTop();
  applySpeed();
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
  speedBtn.title = prefs.fast ? '动画快' : '动画慢';
  soundBtn.textContent = prefs.sound ? '声' : '静';
  leaveBtn.hidden = !solo && !online;
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
// 纹理（public/art/，scripts/art.ts 生成）给 CSS 用：写成绝对地址的变量，开发时和打包后（base './'）都对
for (const t of ['paper', 'wood']) document.documentElement.style.setProperty(`--tex-${t}`, `url("${new URL(`art/${t}.webp`, document.baseURI).href}")`);
document.addEventListener('pointerdown', unlockAudio, { capture: true });

let myName = '我';
/**
 * 独立部署（没有平台，kit 的 detectPlatform 说 platform: false）：没有登录和大厅，"大厅"改成回游戏首页；
 * 昵称是自己在选桌页填的（存 racing.name，地址上的 ?name= 优先），开房、进房时带上。平台连不上（unknown）按有平台处理
 */
let standalone = false;
const NAME_KEY = 'racing.name';
let homeUrl = '/';

async function loadMe(): Promise<void> {
  const p = await detectPlatform();
  if (p.platform === true) {
    const u = p.user as { displayName?: string } | null;
    if (u?.displayName) myName = u.displayName;
    return;
  }
  if (p.platform !== false) return;
  standalone = true;
  homeUrl = './';
  home.href = homeUrl;
  home.querySelector('span')!.textContent = '首页';
  let name = new URLSearchParams(location.search).get('name');
  try {
    name ??= localStorage.getItem(NAME_KEY);
  } catch {
    // 读不到就没有
  }
  setGuestName(name);
}

function setGuestName(name: string | null): void {
  const n = name?.trim().slice(0, 12) || null;
  myName = n ?? '我';
  setNickname(n);
  try {
    if (n) localStorage.setItem(NAME_KEY, n);
    else localStorage.removeItem(NAME_KEY);
  } catch {
    // 存不上就这一次有效
  }
}

function showError(text: string, refresh = false): void {
  dialog(stage, 'error', (box) => {
    el('p', '', box, text);
    if (refresh) button('act soft', box, '刷新', () => location.reload());
    button('act go', box, '知道了', closeDialog);
  });
}

// ---------- 赛道画面（单机、好友房共用） ----------

const SFX: Partial<Record<Ev['e'], Sfx>> = { boost: 'boost', spin: 'spin', finish: 'finish' };

class RaceUi {
  readonly root: HTMLElement;
  readonly board: Board;
  readonly side: HTMLElement;
  readonly dash: Dash;
  private prompted = false;

  constructor(parent: HTMLElement, opts: Opts, hooks: { plan(p: Plan): void; answer(a: Action): void }, tutorial = false) {
    const track = getTrack(opts.track)!;
    this.root = el('div', 'race', parent);
    this.board = new Board(this.root, track);
    this.side = el('div', 'side', this.root);
    this.dash = new Dash(this.root, tutorial ? TUTORIAL_PRESETS : prefs.presets, {
      plan: (p) => {
        play('go');
        hooks.plan(p);
      },
      answer: (a) => {
        play('click');
        hooks.answer(a);
      },
      preview: (pos, lane, kind) => this.board.preview(pos, lane, kind),
      presets: (p) => {
        if (tutorial) return;
        prefs.presets = p;
        savePrefs();
      },
    }, tutorial);
    this.board.speed = speedOf();
  }

  destroy(): void {
    this.dash.destroy();
    this.root.remove();
  }

  rowEl(seat: number): HTMLElement | null {
    return this.side.querySelector<HTMLElement>(`[data-seat="${seat}"]`);
  }

  /** 放这一步的动画（fresh 是整桌重画，不放），再把最新的局面摆上 */
  async show(v: View, names: SeatName[], o: { fresh: boolean; thinking: number[]; until: number | null }): Promise<void> {
    if (!o.fresh && v.events.length) {
      for (const e of v.events) {
        if (e.e === 'move' && e.why === 'cards' && e.seat === v.me?.seat) play('move');
        else if (e.e === 'move' && e.why === 'slip') play('slip');
        else if (e.e === 'corner' && e.paid > 0 && e.seat === v.me?.seat) play('heat');
        else if (SFX[e.e]) play(SFX[e.e]!);
      }
      await this.board.play(v.events);
    }
    this.board.setCars(
      v.cars.map((c) => ({ seat: c.seat, pos: c.pos, lane: c.lane, out: c.rank !== null })),
      v.me?.seat ?? null,
    );
    this.board.newRound(v.round);
    renderSide(this.side, v, names, o.thinking);
    this.dash.render(v, names.map((n) => n.name));
    this.dash.setTimer(o.until);
    const mine = !!v.me && ((v.phase === 'plan' && !v.me.plan && v.cars[v.me.seat]!.rank === null) || (v.phase === 'act' && v.cur === v.me.seat));
    if (mine && !this.prompted) {
      play('turn');
      navigator.vibrate?.(40);
    }
    this.prompted = mine;
  }
}

/**
 * 单机里电脑的互动（game/banter.ts，DESIGN.md 6.2）：每一步放完动画，按公开快照的变化让电脑说一句；
 * 我冲哪个电脑扔道具、点名说话，它按脾气回；我出牌想了 15 秒还没出，话最多的电脑催一下（每回合一次，只有画面和声音，单机本来不限时）。
 * 好友房里这些由房间发（worker/room.ts），页面不自己算。
 */
const URGE_MS = 15_000;

class SoloTalk {
  private prev: Snap[] | null = null;
  private readonly banter = new Banter();
  private urgeTimer = 0;
  private urgedRound = -1;
  private readonly comms: Comms;
  /** 新手教程里不催：阿驰在讲的时候电脑别插嘴催出牌 */
  private readonly urges: boolean;

  constructor(comms: Comms, urges = true) {
    this.comms = comms;
    this.urges = urges;
  }

  destroy(): void {
    window.clearTimeout(this.urgeTimer);
  }

  private say(t: Talk, delay: number): void {
    if (!this.banter.pass(t, Date.now())) return;
    window.setTimeout(() => this.comms.receive(t.seat, t.id, t.to), TURBO ? 0 : delay);
  }

  step(v: View): void {
    const cur = snapOf(v.cars);
    react(factsOf(this.prev, cur), cur, (seat) => seat !== ME, v.n).forEach((t, i) => this.say(t, 300 + 700 * i));
    this.prev = cur;
    window.clearTimeout(this.urgeTimer);
    const waiting = v.phase === 'plan' && !!v.me && !v.me.plan && v.cars[ME]!.rank === null;
    if (waiting && this.urges && this.urgedRound !== v.round) {
      const round = v.round;
      this.urgeTimer = window.setTimeout(() => {
        const t = urge(cur, ME);
        this.urgedRound = round;
        if (t) this.say(t, 0);
      }, URGE_MS);
    }
  }

  /** 我发的：先自己显示，冲着电脑的等一会儿它回 */
  heard(id: number, to?: number): void {
    this.comms.receive(ME, id, to);
    if (to === undefined || to === ME) return;
    const t = reply(to, this.prev?.[to]?.persona ?? -1, ME, id, (this.prev?.length ?? 0) * 7919 + id * 31 + to + Date.now());
    if (t) this.say(t, 900);
  }
}

function speedOf(): number {
  return TURBO ? 0.02 : prefs.fast ? 0.5 : 1;
}

function applySpeed(): void {
  if (race) race.board.speed = speedOf();
  if (solo) solo.speed = speedOf();
}

let race: RaceUi | null = null;

function clearScreen(): void {
  tutor?.destroy();
  tutor = null;
  window.clearTimeout(overTimer);
  overTimer = 0;
  race?.destroy();
  race = null;
  soloTalk?.destroy();
  soloTalk = null;
  comms?.destroy();
  comms = null;
  closeAllDialogs();
  screen.replaceChildren();
}

/** 结算等着弹（冲线后停一会儿）的计时 */
let overTimer = 0;
/** 新手教程（src/tutor.ts）；不在教程里是 null */
let tutor: Tutor | null = null;

// ---------- 选桌页 ----------

let solo: Solo | null = null;

function lobby(friends = false): void {
  stopFollow();
  arrive = null;
  solo?.stop();
  solo = null;
  online?.close();
  online = null;
  setRoomInUrl(null);
  clearScreen();
  title.textContent = GAME_NAME;
  paintTop();
  screen.className = 'screen lobby';
  renderLobby(screen, {
    opts: prefs.opts,
    nickname: standalone ? { value: myName === '我' ? '' : myName, onChange: setGuestName } : null,
    canResume: loadSolo() !== null,
    friends,
    firstTime: !readFlag(TUTORIAL_STORE),
    onTutorial: () => startTutorial(),
    onSolo: (o) => startSolo(o),
    onResume: () => {
      const save = loadSolo();
      if (save) playSolo(new Solo(save, soloUi));
    },
    onRoom: (o) => void openRoom(o),
    onJoin: (code) => (/^\d{6}$/.test(code) ? enterRoom(code, false) : toast('房间号是 6 位数字')),
    onRules: () => showRules(stage),
  });
}

function startSolo(o: Opts): void {
  prefs.opts = o;
  savePrefs();
  clearSolo();
  playSolo(new Solo(newSolo(o, myName), soloUi));
}

function readFlag(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * 新手教程（DESIGN.md 8.1）：环湖 1 圈、两个新手电脑、写死的密钥。是一场不存续玩的单机：
 * 不碰 racing.solo（玩家正在跑的那场照样能接着跑）、racing.prefs（选项和预设）。
 * 一进来就记下 racing.tutorial：跑完、中途退出、关页面都算来过，选桌页不再冒"第一次来？"
 */
function startTutorial(): void {
  try {
    localStorage.setItem(TUTORIAL_STORE, '1');
  } catch {
    // 存不上就下回再冒一次气泡
  }
  playSolo(new Solo(newSolo(TUTORIAL_OPTS, myName, [...TUTORIAL_KEY]), soloUi, false), true);
}

// ---------- 单机 ----------

function soloNames(): SeatName[] {
  return (solo?.save.names ?? []).map((name, i) => ({ name: i === ME && name !== '我' ? `${name}（我）` : name, bot: i !== ME }));
}

const soloUi = {
  async frame(v: View): Promise<void> {
    if (!race) return;
    await race.show(v, soloNames(), { fresh: false, thinking: [], until: null });
    soloTalk?.step(v);
    await tutor?.frame(v);
  },
  over(v: View): void {
    window.clearTimeout(overTimer);
    overTimer = window.setTimeout(() => {
      overTimer = 0;
      if (!solo || solo.save.state.phase !== 'over') return;
      if (tutor) {
        // 教程：阿驰的毕业气泡先出（"正式开跑""再练一次"在它上面），结算随后在下边出来，只看成绩（还有"大厅"）
        const t = tutor;
        t.graduate(v);
        overTimer = window.setTimeout(() => {
          overTimer = 0;
          if (tutor === t) showResult(v, soloNames(), []);
        }, TURBO ? 0 : 600);
        return;
      }
      showResult(v, soloNames(), [
        ['回选桌', 'soft', () => lobby()],
        ['再来一场', 'go', () => startSolo(prefs.opts)],
      ]);
    }, resultDelay());
  },
};

function playSolo(s: Solo, tutorial = false): void {
  solo = s;
  applySpeed();
  clearScreen();
  screen.className = 'screen game';
  const o = s.save.state.opts;
  title.textContent = `${tutorial ? '新手教程 · ' : ''}${getTrack(o.track)?.name ?? ''} · ${o.laps} 圈`;
  paintTop();
  race = new RaceUi(
    screen,
    o,
    {
      plan: (p) => {
        tutor?.planned();
        void act({ t: 'plan', ...(tutor ? tutor.plan(p) : p) });
      },
      answer: (a) => void act(a),
    },
    tutorial,
  );
  const r = race;
  comms = new Comms(
    screen,
    {
      me: () => ME,
      rowEl: (seat) => r.rowEl(seat),
      name: (seat) => soloNames()[seat]?.name ?? `${seat + 1} 号`,
      occupied: (seat) => seat < o.cars,
      seats: () => o.cars,
    },
    (id, to) => soloTalk?.heard(id, to),
  );
  soloTalk = new SoloTalk(comms, !tutorial);
  if (tutorial)
    tutor = new Tutor({
      stage,
      me: ME,
      board: () => race?.board ?? null,
      exit: () => lobby(),
      again: () => startTutorial(),
    });
  applySpeed();
  void s.resume();
}

async function act(a: Action): Promise<void> {
  if (!solo) return;
  const err = await solo.act(a);
  if (err && err !== 'busy') toast(MOVE_ERROR[err] ?? '这一步不行');
}

/**
 * 结算：名次、每辆车这一场的数（DESIGN.md 8"结算"）。
 * 不挡赛道中间：靠下边放（盖驾驶台，赛道露着），不压暗、不挡顶栏；"收起"只剩一条，看看赛道和冲线，"展开"回来。
 * 弹窗里也有"大厅"，和顶栏那个一样走 goHome（独立部署时回游戏首页）
 */
function showResult(v: View, names: SeatName[], acts: [string, 'go' | 'soft', () => void][]): void {
  screen.querySelector('.race')?.classList.add('over');
  dialog(stage, 'end', (box) => {
    const me = v.me?.seat ?? null;
    const mine = me === null ? null : v.cars[me]!.rank;
    const head = el('div', 'end-head', box);
    el('h2', '', head, mine === 0 ? '冠军！' : mine !== null ? `第 ${mine + 1} 名` : '比赛结束');
    const fold = button('end-fold', head, '收起，看看赛道', () => {
      const mask = box.parentElement!;
      const folded = mask.classList.toggle('folded');
      fold.textContent = folded ? '展开' : '收起，看看赛道';
    });
    const tb = el('table', 'result', box);
    const hr = el('tr', '', tb);
    for (const h of ['名次', '车手', '冲刺', '尾流', '打滑', '付热量', '最快']) el('th', '', hr, h);
    for (const seat of v.finished) {
      const c = v.cars[seat]!;
      const tr = el('tr', seat === me ? 'me' : '', tb);
      el('td', '', tr, String((c.rank ?? 0) + 1));
      const td = el('td', 'who', tr);
      const dot = el('span', 'dot', td);
      dot.style.background = CAR_COLORS[seat]!.body;
      el('span', '', td, names[seat]?.name ?? `车${seat + 1}`);
      for (const n of [c.stats.boosts, c.stats.slips, c.stats.spins, c.stats.heat, c.stats.top]) el('td', '', tr, String(n));
    }
    const row = el('div', 'row end-acts', box);
    button('act soft end-home', row, home.querySelector('span')?.textContent ?? '大厅', () => goHome());
    for (const [text, kind, fn] of acts)
      button(`act ${kind}`, row, text, () => {
        closeDialog();
        fn();
      });
  }, false, true);
  const mine = v.me ? v.cars[v.me.seat]!.rank : null;
  play(mine !== null && mine <= Math.floor(v.cars.length / 2) - 1 ? 'win' : 'lose');
}

// ---------- 好友房 ----------

let online: Online | null = null;
let hosting = false;
let shownN = -1;
let comms: Comms | null = null;
let soloTalk: SoloTalk | null = null;
/** 本地时钟比服务端快多少（进房时量一次，online.ts 的 clockSkew） */
let skew = 0;
let arrive: { seat: number; sit: boolean } | null = null;
let followTimer = 0;
const FOLLOW_MS = 5_000;
function stopFollow(): void {
  window.clearTimeout(followTimer);
  followTimer = 0;
}

function setRoomInUrl(code: string | null): void {
  const u = new URL(location.href);
  if (code) u.searchParams.set('room', code);
  else u.searchParams.delete('room');
  history.replaceState(null, '', u);
}

async function openRoom(o: Opts): Promise<void> {
  prefs.opts = o;
  savePrefs();
  const r = await createRoom(o);
  if ('error' in r) return showError(createError(r.error), r.error === 'login');
  enterRoom(r.code, true);
}

function enterRoom(code: string, host: boolean, from: { seat: number; sit: boolean } | null = null): void {
  stopFollow();
  arrive = from;
  solo?.stop();
  solo = null;
  online?.close();
  clearScreen();
  hosting = host;
  shownN = -1;
  setRoomInUrl(code);
  screen.className = 'screen room';
  el('p', 'room-hint', screen, '正在进房……');
  online = new Online(code, onlineUi);
  void clockSkew().then((ms) => (skew = ms));
  paintTop();
}

const onlineUi = {
  async draw(s: OnlineState, fresh: boolean): Promise<void> {
    paintTop();
    if (!s.room) return;
    if (s.room.status === 'waiting' && arrive?.sit && s.you && s.you.seat === null) {
      if (s.room.seats[arrive.seat]?.kind === 'empty') online?.sit(arrive.seat);
      arrive = { ...arrive, sit: false };
    }
    if (s.room.status === 'waiting' || !s.view) return drawWaiting(s);
    await drawRoomRace(s, fresh);
  },
  toast,
  emote(seat: number, id: number, to?: number): void {
    comms?.receive(seat, id, to);
  },
  ended(text: string): void {
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
  if (race) clearScreen();
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
    onLeave: () => lobby(),
  });
}

function roomNames(s: OnlineState, v: View): SeatName[] {
  return v.cars.map((c, i): SeatName => {
    const x = s.room!.seats[i];
    const persona = PERSONAS[c.persona]?.name ?? '电脑';
    const me = s.you?.seat === i;
    const name = x?.kind === 'human' ? `${x.name ?? '玩家'}${me ? '（我）' : ''}` : x?.name ? `电脑（代${x.name}）` : persona;
    return { name, bot: x?.kind !== 'human', away: !!(x?.away || x?.auto) };
  });
}

async function drawRoomRace(s: OnlineState, fresh: boolean): Promise<void> {
  const rv = s.view!;
  const v = rv.g;
  if (!race) {
    screen.replaceChildren();
    screen.className = 'screen game';
    title.textContent = `好友房 ${s.code} · ${rulesLine(s.opts)}`;
    race = new RaceUi(screen, v.opts, {
      plan: (p) => online?.play({ t: 'plan', ...p }),
      answer: (a) => online?.play(a),
    });
    const r = race;
    comms = new Comms(
      screen,
      {
        me: () => online?.state.you?.seat ?? null,
        rowEl: (seat) => r.rowEl(seat),
        name: (seat) => roomNames(online!.state, online!.state.view!.g)[seat]?.name ?? `${seat + 1} 号`,
        occupied: (seat) => (online?.state.room?.seats[seat]?.kind ?? 'empty') !== 'empty',
        seats: () => v.cars.length,
      },
      (id, to) => online?.emote(id, to),
    );
  }
  // 同一步重画（有人坐下、掉线）不再放一遍动画
  const replay = fresh || v.n === shownN;
  shownN = v.n;
  const turn = s.room!.turn;
  await race.show(replay ? { ...v, events: [] } : v, roomNames(s, v), {
    fresh: replay,
    thinking: turn?.seats ?? (turn ? [turn.seat] : []),
    until: turn?.deadline ? turn.deadline + skew : null,
  });
  roomOver(s);
}

function roomOver(s: OnlineState): void {
  const v = s.view!.g;
  if (v.phase !== 'over') return;
  if (document.querySelector('.mask.end')) return followNext(s);
  // 冲线动画放完停一会儿再弹（和单机一样）；等着的时候来了"再来一场"，弹出来以后一起补上
  if (overTimer) return;
  const room = online;
  overTimer = window.setTimeout(() => {
    overTimer = 0;
    if (!room || online !== room || !room.state.view) return;
    const st = room.state;
    const me = st.you?.seat ?? null;
    const acts: [string, 'go' | 'soft', () => void][] = [['回选桌', 'soft', () => lobby()]];
    if (me !== null && st.room?.seats[me]?.kind === 'human' && !st.view!.next) acts.push(['再来一场', 'go', () => void rematch()]);
    showResult(st.view!.g, roomNames(st, st.view!.g), acts);
    followNext(st);
  }, resultDelay());
}

/** 有人开了新房间（再来一场）：结算上写一句，5 秒后跟过去 */
function followNext(s: OnlineState): void {
  const rv = s.view!;
  const v = rv.g;
  const me = s.you?.seat ?? null;
  const names = roomNames(s, v);
  if (rv.next && rv.next.by !== me && !followTimer) {
    const next = rv.next;
    const from = me === null ? null : { seat: (me - next.by + v.cars.length) % v.cars.length, sit: true };
    const go = (): void => enterRoom(next.code, false, from);
    followTimer = window.setTimeout(go, FOLLOW_MS);
    const box = document.querySelector<HTMLElement>('.mask.end .dialog');
    const row = box?.querySelector<HTMLElement>('.end-acts');
    if (box && row) {
      row.before(el('p', 'room-hint', null, `${names[next.by]?.name ?? '有人'} 开了新房间 ${next.code}，马上跟过去`));
      button('act go', row, '现在过去', go);
    }
  }
}

async function rematch(): Promise<void> {
  const opts = online?.state.opts;
  if (!online || !opts) return;
  const r = await createRoom(opts);
  if ('error' in r) return toast(createError(r.error));
  online.next(r.code);
  enterRoom(r.code, true);
}

async function share(): Promise<void> {
  if (!online) return;
  const r = await shareRoom(online.state.code, GAME_NAME);
  if (r === 'copied') toast('链接已复制，发给朋友');
  else if (r === 'failed') toast(`房间号 ${online.state.code}，告诉朋友在选桌页输入`);
}

async function leaveRoom(): Promise<void> {
  const s = online!.state;
  const playing = s.room?.status === 'playing' && s.view && !s.view.done && s.you?.seat !== null && s.you?.seat !== undefined;
  if (playing) {
    const ok = await confirmBox(stage, '离开后你的车交给电脑接着开。离开吗？', '离开', '接着开');
    if (!ok) return;
    online!.leaveSeat();
    await new Promise((r) => window.setTimeout(r, 300));
  }
  lobby();
}

/** 比赛中离开先确认一次（单机存着下次接着跑；教程不存，问一句退不退）；where 是"回选桌"还是"回大厅" */
async function confirmQuit(where: '回选桌' | '回大厅'): Promise<boolean> {
  if (!solo || solo.save.state.phase === 'over') return true;
  if (tutor) return confirmBox(stage, `教程还没跑完，下次从头来。现在${where}吗？`, where, '接着学');
  return confirmBox(stage, `这一场还没跑完，存着下次接着跑。现在${where}吗？`, where, '接着跑');
}

async function leave(): Promise<void> {
  if (online) return leaveRoom();
  if (await confirmQuit('回选桌')) lobby();
}

/** 回大厅：顶栏的"大厅"和结算弹窗里的"大厅"都走这里（好友房先离座；独立部署时 homeUrl 是游戏首页） */
function goHome(): void {
  if (online) {
    void leaveRoom().then(() => {
      if (!online) location.href = homeUrl;
    });
    return;
  }
  void confirmQuit('回大厅').then((ok) => {
    if (ok) location.href = homeUrl;
  });
}

// 比赛中点"大厅"先确认一次；没在比赛就照链接走
home.addEventListener('click', (e) => {
  if (!online && (!solo || solo.save.state.phase === 'over')) return;
  e.preventDefault();
  goHome();
});

// ---------- 开始 ----------

void (async () => {
  paintTop();
  await loadMe();
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
})();
