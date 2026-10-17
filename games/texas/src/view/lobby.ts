/**
 * 标题页兼选桌：左边标题和一手同花顺，右边钱包、每日补给，先选"娱乐 / 实盘 / 好友房"（docs/economy.md 第 1 节），再选档位、人数、带多少。
 * 娱乐不碰钱包、随便玩；实盘从钱包带一份上桌、离桌结回；好友房（0.17.4 和前两个并排，手机第一屏就看得见）选档位和人数后开房间、输码进房。
 * 钱包常驻一行"无任何现金价值"（DESIGN.md 5.3）；钱包连不上时实盘不可选，娱乐照常。
 * 单独部署（没有平台，10.1）：藏起钱包和实盘，只有娱乐和好友房；好友房下面多一个昵称框。
 */
import { DIFFICULTIES, DIFFICULTY_NAME, difficultyOf, FUN_LEVEL, FUN_STAKES, STAKES, stakesOf, type Difficulty, type StakesId } from '../core/stakes.ts';
import { MAX_SEATS } from '../core/table.ts';
import type { Stake, WalletView } from '../net/wallet.ts';
import { patchSettings, readSettings } from '../store.ts';
import { makeCard, setCard } from './art.ts';
import { el, setText, toggle } from './dom.ts';
import { chips } from './text.ts';

export interface LobbyState {
  wallet: WalletView | null;
  /** 钱包连不上、只读时的说明 */
  note: string | null;
  /** 本机有一桌没打完；waiting：那一笔钱包还没回话（买入在路上，或者离桌的结算还没结回去） */
  resume: { stakes: StakesId; size: number; practice: boolean; level?: number | undefined; waiting: boolean } | null;
  /** 钱包里有一桌单机，但本机没有（另一台设备上的） */
  orphan: Stake | null;
  busy: boolean;
  /** 回到好友房的横幅（钱包里有那一份，或者刷新前还在房间里）：码和一句说明 */
  room: { code: string; text: string } | null;
}

export interface LobbyHandlers {
  /** level：娱乐按难度给电脑的强弱档；实盘不给 */
  start(stakes: StakesId, size: number, amount: number, practice: boolean, level?: number): void;
  resume(): void;
  relief(): void;
  /** 好友房：用现在选的档位和人数开一个；输码进房；回到上次的房间 */
  openRoom(stakes: StakesId, size: number): void;
  joinRoom(code: string): void;
  backToRoom(): void;
}

type Mode = 'fun' | 'real' | 'room';

export class Lobby {
  readonly root: HTMLDivElement;
  private readonly balance: HTMLSpanElement;
  private readonly reliefBtn: HTMLButtonElement;
  private readonly noteEl: HTMLDivElement;
  private readonly resumeBox: HTMLDivElement;
  private readonly resumeText: HTMLSpanElement;
  private readonly orphanBox: HTMLDivElement;
  private readonly orphanText: HTMLSpanElement;
  private readonly modeBtns = new Map<Mode, HTMLButtonElement>();
  private readonly modeNote: HTMLDivElement;
  private readonly tiles = new Map<StakesId, HTMLButtonElement>();
  private readonly diffTiles = new Map<Difficulty, HTMLButtonElement>();
  private readonly grid: HTMLDivElement;
  private readonly sizes: HTMLButtonElement[] = [];
  private readonly slider: HTMLInputElement;
  private readonly buyAmt: HTMLSpanElement;
  private readonly startBtn: HTMLButtonElement;
  private readonly openBtn: HTMLButtonElement;
  private readonly codeIn: HTMLInputElement;
  private readonly joinBtn: HTMLButtonElement;
  private readonly roomBox: HTMLDivElement;
  private readonly roomText: HTMLSpanElement;
  private readonly backBtn: HTMLButtonElement;
  private readonly friends: HTMLDivElement;
  private readonly openRow: HTMLDivElement;
  private readonly buyRow: HTMLDivElement;
  private readonly goRow: HTMLDivElement;
  private readonly walletBox: HTMLDivElement;
  private readonly nickRow: HTMLDivElement;
  private readonly nickIn: HTMLInputElement;
  /** 单独部署：没有钱包，只有娱乐 */
  private alone = false;
  private stakes: StakesId = 'small';
  private diff: Difficulty = 'easy';
  private size = 6;
  /** 第一次来默认娱乐·新手（docs/balance.md 第 3 节）；记过的按记的 */
  private mode: Mode = 'fun';
  private s: LobbyState = { wallet: null, note: null, resume: null, orphan: null, busy: true, room: null };
  private readonly h: LobbyHandlers;
  /** 最后点的那个要等回话的按钮：忙着的时候它转圈（0.9.0） */
  private pending: HTMLButtonElement | null = null;

  constructor(parent: HTMLElement, h: LobbyHandlers) {
    this.h = h;
    this.root = el('div', 'lobby', parent);
    const hero = el('div', 'hero', this.root);
    el('div', 'title', hero, '德州扑克');
    el('div', 'subtitle', hero, '无限注 · 2–9 人 · 和电脑过过招');
    const fan = el('div', 'fan', hero);
    [48, 44, 40, 36, 32].forEach((c, i) => {
      const card = makeCard('fan-card');
      setCard(card, c + 3);
      card.style.setProperty('--k', String(i - 2));
      fan.appendChild(card);
    });
    el('div', 'ver', hero, `v${__TEXAS_VERSION__}`);

    const panel = el('div', 'panel', this.root);
    const wallet = (this.walletBox = el('div', 'wallet', panel));
    el('span', 'w-label', wallet, '我的筹码');
    this.balance = el('span', 'w-balance', wallet, '…');
    this.reliefBtn = button(wallet, 'relief', '领今日补给', () => this.wait(this.reliefBtn, () => h.relief()));
    el('div', 'disclaimer', panel, '筹码无任何现金价值：不能买、不能换钱换物、不能转给别人');
    this.noteEl = el('div', 'note', panel);

    this.resumeBox = el('div', 'banner resume', panel);
    this.resumeText = el('span', '', this.resumeBox);
    button(this.resumeBox, 'go', '接着打', () => h.resume());
    // 另一台设备上的那一桌这里不给放弃：看不到那边还剩多少（2026-10-15 定）
    this.orphanBox = el('div', 'banner orphan', panel);
    this.orphanText = el('span', '', this.orphanBox);
    // 好友房不自动进（0.2.3）：横幅点了才回去
    this.roomBox = el('div', 'banner room', panel);
    this.roomText = el('span', '', this.roomBox);
    this.backBtn = button(this.roomBox, 'go', '回到房间', () => h.backToRoom());

    const modes = el('div', 'modes', panel);
    for (const [m, name] of [
      ['fun', '娱乐'],
      ['real', '实盘'],
      ['room', '好友房'],
    ] as const) {
      this.modeBtns.set(m, button(modes, 'mode', name, () => this.pickMode(m)));
    }
    this.modeNote = el('div', 'mode-note', modes);

    // 好友房：输码进房紧跟在选项下面（进别人的房不用选档位），手机第一屏就看得见
    const fr = (this.friends = el('div', 'friends join', panel));
    this.codeIn = el('input', 'code-in', fr);
    Object.assign(this.codeIn, { type: 'text', inputMode: 'numeric', maxLength: 6, placeholder: '朋友给的 6 位房间码', autocomplete: 'off' });
    this.codeIn.addEventListener('input', () => {
      this.codeIn.value = this.codeIn.value.replace(/\D/g, '').slice(0, 6);
      this.draw();
    });
    this.codeIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !this.joinBtn.disabled) this.wait(this.joinBtn, () => h.joinRoom(this.codeIn.value));
    });
    this.joinBtn = button(fr, 'pill', '进房间', () => this.wait(this.joinBtn, () => h.joinRoom(this.codeIn.value)));
    // 单独部署时好友房里别人看到的名字（kit 的 ?name=，服务端清洗，不合格就是"游客1234"）；有平台时用平台的昵称，不显示
    this.nickRow = el('div', 'nick-row hidden', panel);
    el('span', 'label', this.nickRow, '昵称');
    this.nickIn = el('input', 'code-in nick-in', this.nickRow);
    Object.assign(this.nickIn, { type: 'text', maxLength: 12, placeholder: '好友房里显示的名字，可不填', autocomplete: 'nickname' });
    this.nickIn.addEventListener('change', () => patchSettings({ nick: this.nickname() }));

    // 每档一张卡（docs/balance.md 第 5 节）：电脑多强（★）、一场约多久、一场最多输赢；实盘四档、娱乐三个难度
    const grid = (this.grid = el('div', 'stakes', panel));
    for (const st of STAKES) {
      const t = button(grid, 'tile', '', () => this.pick(st.id));
      t.innerHTML = card(st.name, STARS[st.id], `盲注 ${chips(st.sb)}/${chips(st.bb)}`, [`最多输 ${short(st.max)}`, `赢很少过 ${short(3 * st.max)}`]);
      this.tiles.set(st.id, t);
    }
    for (const d of DIFFICULTIES) {
      const t = button(grid, 'tile diff', '', () => this.pickDiff(d));
      t.innerHTML = card(DIFFICULTY_NAME[d], FUN_STARS[d], FOR_WHOM[d], ['不碰钱包', '筹码不算数']);
      this.diffTiles.set(d, t);
    }
    const sizeRow = el('div', 'sizes', panel);
    el('span', 'label', sizeRow, '人数');
    for (let n = 2; n <= MAX_SEATS; n++) {
      const b = button(sizeRow, 'size', String(n), () => this.pickSize(n));
      this.sizes.push(b);
    }
    const buy = (this.buyRow = el('div', 'buyin', panel));
    el('span', 'label', buy, '带上桌');
    this.slider = el('input', 'slider', buy);
    this.slider.type = 'range';
    this.slider.addEventListener('input', () => this.draw());
    this.buyAmt = el('span', 'buy-amt', buy);
    const go = (this.goRow = el('div', 'go-row', panel));
    this.startBtn = button(go, 'start', '坐下开打', () =>
      this.wait(this.startBtn, () => (this.fun() ? this.h.start(FUN_STAKES, this.size, Number(this.slider.value), true, FUN_LEVEL[this.diff]) : this.h.start(this.stakes, this.size, Number(this.slider.value), false))),
    );

    // 好友房（0.17.4）：开房间放在"坐下开打"的位置，用上面选的档位和人数，买入固定是这一档的满买入
    const open = (this.openRow = el('div', 'friends open', panel));
    this.openBtn = button(open, 'pill go', '开房间', () => this.wait(this.openBtn, () => h.openRoom(this.stakes, this.size)));

    // 设置坏了就用默认的（readSettings 坏了给空）
    const saved = readSettings() as { stakes?: StakesId; size?: number; mode?: Mode; diff?: Difficulty };
    if (saved.stakes && STAKES.some((x) => x.id === saved.stakes)) this.stakes = saved.stakes;
    if (saved.diff && DIFFICULTIES.includes(saved.diff)) this.diff = saved.diff;
    if (saved.size && saved.size >= 2 && saved.size <= MAX_SEATS) this.size = saved.size;
    if (saved.mode === 'fun' || saved.mode === 'real' || saved.mode === 'room') this.mode = saved.mode;
    if (typeof (saved as { nick?: unknown }).nick === 'string') this.nickIn.value = (saved as { nick: string }).nick;
  }

  /** 单独部署（开局时问过没有平台）：藏起钱包和实盘，好友房里露出昵称框 */
  standalone(): void {
    this.alone = true;
    toggle(this.walletBox, 'hidden', true);
    toggle(this.modeBtns.get('real')!, 'hidden', true);
    this.draw();
  }

  /** 选的是好友房（房间都是实盘，用实盘的档位；单独部署时筹码不记账） */
  private room(): boolean {
    return this.mode === 'room';
  }

  /** 单机是不是娱乐：钱包连不上、单独部署时只有娱乐（记着的是实盘也一样，开桌按这个） */
  private fun(): boolean {
    return !this.room() && (this.mode === 'fun' || !this.s.wallet || this.alone);
  }

  /** 单独部署时的昵称（没填是空的） */
  nickname(): string {
    return this.nickIn.value.trim();
  }

  update(s: LobbyState): void {
    this.s = s;
    this.draw();
  }

  /**
   * 从平台大厅的"好友房"进来（?online=1）：切到好友房，开房、进房那一行滚到看得见、亮一下；
   * 有鼠标的直接把光标放进房间码，触屏不放（免得一进来就弹键盘盖住半屏）
   */
  showFriends(): void {
    this.pickMode('room');
    this.friends.scrollIntoView({ block: 'nearest' });
    this.friends.classList.remove('spot');
    void this.friends.offsetWidth;
    this.friends.classList.add('spot');
    if (matchMedia('(pointer: fine)').matches) this.codeIn.focus({ preventScroll: true });
  }

  private wait(b: HTMLButtonElement, go: () => void): void {
    this.pending = b;
    go();
  }

  private pick(id: StakesId): void {
    this.stakes = id;
    // 换档就按这一档的满买入（draw 里先改了上下限再设值，不然值会被旧的上限截住）
    this.slider.dataset.init = '';
    this.remember();
    this.draw();
  }

  private pickDiff(d: Difficulty): void {
    this.diff = d;
    this.remember();
    this.draw();
  }

  private pickMode(m: Mode): void {
    this.mode = m;
    this.slider.dataset.init = '';
    this.remember();
    this.draw();
  }

  private pickSize(n: number): void {
    this.size = n;
    this.remember();
    this.draw();
  }

  private remember(): void {
    patchSettings({ stakes: this.stakes, size: this.size, mode: this.mode, diff: this.diff });
  }

  private draw(): void {
    const { wallet, note, resume, orphan, busy } = this.s;
    const bal = wallet?.balance ?? null;
    setText(this.balance, bal === null ? '—' : chips(bal));
    toggle(this.reliefBtn, 'hidden', !wallet?.canRelief);
    setText(this.noteEl, note ?? '');
    toggle(this.noteEl, 'hidden', !note);
    toggle(this.resumeBox, 'hidden', !resume);
    const rd = resume?.practice ? difficultyOf(resume.level) : null;
    if (resume) setText(this.resumeText, `${resume.practice ? '娱乐' : '实盘'} · ${rd ? DIFFICULTY_NAME[rd] : stakesOf(resume.stakes).name} · ${resume.size} 人，${resume.waiting ? '等钱包回话' : '上次没打完'}`);
    toggle(this.orphanBox, 'hidden', !orphan || !!resume);
    if (orphan) setText(this.orphanText, `另一台设备上还有一桌没打完（带上桌 ${chips(orphan.amount)}）：回那台设备离桌就能结回；放着不管，24 小时后原样退回钱包`);

    // 钱包连不上：实盘不可选，娱乐、好友房（进别人的房）照常
    const room = this.room();
    const fun = this.fun();
    const now: Mode = room ? 'room' : fun ? 'fun' : 'real';
    for (const [m, b] of this.modeBtns) {
      toggle(b, 'sel', m === now);
      b.disabled = m === 'real' && !wallet;
    }
    setText(
      this.modeNote,
      room ? '和朋友一桌：开个房间把房间码发给他们，或者输朋友给的码' : this.alone ? '筹码不算数，随便玩' : fun ? '不碰钱包，筹码不算数，随便玩' : '从钱包带筹码上桌，离桌结回；最多输掉带上去的',
    );
    // 好友房：档位、人数照旧选，下面换成开房间、输码进房；单机的带多少、坐下开打收起来
    toggle(this.buyRow, 'hidden', room);
    toggle(this.goRow, 'hidden', room);
    toggle(this.friends, 'hidden', !room);
    toggle(this.openRow, 'hidden', !room);
    toggle(this.nickRow, 'hidden', !(room && this.alone));
    // 实盘新开一份只要钱包够这次带入（平台 0.10.2）：够这一档的最少买入就能开，不够一整份就少带一点
    for (const st of STAKES) {
      const t = this.tiles.get(st.id)!;
      toggle(t, 'sel', st.id === this.stakes);
      toggle(t, 'locked', !fun && !this.alone && bal !== null && bal < st.min);
      toggle(t, 'hidden', fun);
    }
    toggle(this.grid, 'fun', fun);
    for (const [d, t] of this.diffTiles) {
      toggle(t, 'sel', d === this.diff);
      toggle(t, 'hidden', !fun);
    }
    this.sizes.forEach((b, i) => toggle(b, 'sel', i + 2 === this.size));
    // 娱乐按小桌的盲注和买入打（难度只管电脑）；好友房照旧用实盘选的档位
    const st = stakesOf(fun ? FUN_STAKES : this.stakes);
    const ok = fun || (bal ?? 0) >= st.min;
    const top = fun ? st.max : Math.max(st.min, Math.min(st.max, Math.floor((bal ?? 0) / st.bb) * st.bb));
    this.slider.min = String(st.min);
    this.slider.max = String(top);
    this.slider.step = String(st.bb);
    if (!this.slider.dataset.init || Number(this.slider.value) > top) {
      this.slider.value = String(top);
      this.slider.dataset.init = '1';
    }
    this.slider.disabled = !ok;
    setText(this.buyAmt, ok ? chips(Number(this.slider.value)) : `钱包要有 ${chips(st.min)}`);
    // 本机一次只摆一桌单机（没打完的先接着打）；钱包里别处还有德州的份不影响（平台 0.9.5 起可以同时有好几份）
    this.startBtn.disabled = busy || !ok || !!resume;
    const back = this.s.room;
    // 开房只看钱包够不够这一档的最少买入（坐下就要带；不够一整份的，坐下时少带一点）；单机没打完、别处还有一份都不拦
    // （0.3.0：好友房不设多余的限制）
    // 单独部署没有钱包：好友房的筹码不记账，不看钱包
    this.openBtn.disabled = busy || (!this.alone && (!wallet || (bal ?? 0) < st.min));
    this.openBtn.title = this.alone ? '' : !wallet ? '钱包连不上，稍后再试' : (bal ?? 0) < st.min ? `这一档最少带 ${chips(st.min)}：去大厅领补给，或者换小一档` : '';
    this.joinBtn.disabled = busy || this.codeIn.value.length !== 6;
    for (const b of [this.startBtn, this.openBtn, this.joinBtn, this.reliefBtn]) toggle(b, 'loading', busy && b === this.pending);
    toggle(this.roomBox, 'hidden', !back);
    if (back) {
      setText(this.roomText, back.text);
      setText(this.backBtn, `回到房间 ${back.code}`);
    }
  }
}

function button(parent: HTMLElement, cls: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', cls, parent, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** 格子窄，一万以上写成"4万" */
const short = (n: number): string => (n >= 10_000 && n % 10_000 === 0 ? `${n / 10_000}万` : chips(n));

/** 电脑多强（1–4 颗星，四个游戏一样的画法）：实盘按档位，娱乐按难度（高手和豪华桌是同一档电脑） */
const STARS: Readonly<Record<StakesId, number>> = { small: 1, mid: 2, big: 3, lux: 4 };
const FUN_STARS: Readonly<Record<Difficulty, number>> = { easy: 1, normal: 2, hard: 4 };
const FOR_WHOM: Readonly<Record<Difficulty, string>> = { easy: '刚学会，先赢几把', normal: '会看牌、会弃牌', hard: '想和最强的电脑过招' };

/**
 * 选档卡：名字、星、一句（盲注或适合谁）、一场约多久、最多输赢（娱乐写不碰钱包）。
 * "赢很少过 3 份"是配平模拟量的（DESIGN.md 4.10：一场赢超过 3 份的不到 1%），规则不封顶，所以不写"最多赢"
 */
function card(name: string, stars: number, line: string, stake: readonly string[]): string {
  return (
    `<b>${name}</b><span class="stars" aria-label="电脑强度 ${stars}/4">${'★'.repeat(stars)}${'☆'.repeat(4 - stars)}</span>` +
    `<span>${line}</span><small>一场约 20 分钟</small>${stake.map((x) => `<small>${x}</small>`).join('')}`
  );
}
