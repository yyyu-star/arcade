/**
 * 标题页兼选桌：左边标题和一手同花顺，右边钱包、每日补给，先选"娱乐 / 实盘"（docs/economy.md 第 1 节），再选档位、人数、带多少。
 * 娱乐不碰钱包、随便玩；实盘从钱包带一份上桌、离桌结回。钱包常驻一行"无任何现金价值"（DESIGN.md 5.3）；钱包连不上时实盘不可选，娱乐照常。
 */
import { STAKES, stakesOf, type StakesId } from '../core/stakes.ts';
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
  resume: { stakes: StakesId; size: number; practice: boolean; waiting: boolean } | null;
  /** 钱包里有一桌单机，但本机没有（另一台设备上的） */
  orphan: Stake | null;
  busy: boolean;
  /** 回到好友房的横幅（钱包里有那一份，或者刷新前还在房间里）：码和一句说明 */
  room: { code: string; text: string } | null;
}

export interface LobbyHandlers {
  start(stakes: StakesId, size: number, amount: number, practice: boolean): void;
  resume(): void;
  relief(): void;
  /** 好友房：用现在选的档位和人数开一个；输码进房；回到上次的房间 */
  openRoom(stakes: StakesId, size: number): void;
  joinRoom(code: string): void;
  backToRoom(): void;
}

type Mode = 'fun' | 'real';

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
  private stakes: StakesId = 'small';
  private size = 6;
  private mode: Mode = 'real';
  private s: LobbyState = { wallet: null, note: null, resume: null, orphan: null, busy: true, room: null };
  private readonly h: LobbyHandlers;

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
    const wallet = el('div', 'wallet', panel);
    el('span', 'w-label', wallet, '我的筹码');
    this.balance = el('span', 'w-balance', wallet, '…');
    this.reliefBtn = button(wallet, 'relief', '领今日补给', () => h.relief());
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
    ] as const) {
      this.modeBtns.set(m, button(modes, 'mode', name, () => this.pickMode(m)));
    }
    this.modeNote = el('div', 'mode-note', modes);

    const grid = el('div', 'stakes', panel);
    for (const st of STAKES) {
      const t = button(grid, 'tile', '', () => this.pick(st.id));
      t.innerHTML = `<b>${st.name}</b><span>盲注 ${chips(st.sb)}/${chips(st.bb)}</span><small>买入 ${short(st.min)}–${short(st.max)}</small>`;
      this.tiles.set(st.id, t);
    }
    const sizeRow = el('div', 'sizes', panel);
    el('span', 'label', sizeRow, '人数');
    for (let n = 2; n <= MAX_SEATS; n++) {
      const b = button(sizeRow, 'size', String(n), () => this.pickSize(n));
      this.sizes.push(b);
    }
    const buy = el('div', 'buyin', panel);
    el('span', 'label', buy, '带上桌');
    this.slider = el('input', 'slider', buy);
    this.slider.type = 'range';
    this.slider.addEventListener('input', () => this.draw());
    this.buyAmt = el('span', 'buy-amt', buy);
    const go = el('div', 'go-row', panel);
    this.startBtn = button(go, 'start', '坐下开打', () => this.h.start(this.stakes, this.size, Number(this.slider.value), this.mode === 'fun'));

    // 好友房：开房用上面选的档位和人数，买入固定是这一档的满买入
    const fr = (this.friends = el('div', 'friends', panel));
    el('span', 'label', fr, '好友房');
    this.openBtn = button(fr, 'pill', '开房间', () => h.openRoom(this.stakes, this.size));
    this.codeIn = el('input', 'code-in', fr);
    Object.assign(this.codeIn, { type: 'text', inputMode: 'numeric', maxLength: 6, placeholder: '6 位房间码', autocomplete: 'off' });
    this.codeIn.addEventListener('input', () => {
      this.codeIn.value = this.codeIn.value.replace(/\D/g, '').slice(0, 6);
      this.draw();
    });
    this.codeIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !this.joinBtn.disabled) h.joinRoom(this.codeIn.value);
    });
    this.joinBtn = button(fr, 'pill', '进房间', () => h.joinRoom(this.codeIn.value));

    // 设置坏了就用默认的（readSettings 坏了给空）
    const saved = readSettings() as { stakes?: StakesId; size?: number; mode?: Mode };
    if (saved.stakes && STAKES.some((x) => x.id === saved.stakes)) this.stakes = saved.stakes;
    if (saved.size && saved.size >= 2 && saved.size <= MAX_SEATS) this.size = saved.size;
    if (saved.mode === 'fun' || saved.mode === 'real') this.mode = saved.mode;
  }

  update(s: LobbyState): void {
    this.s = s;
    this.draw();
  }

  /**
   * 从平台大厅的"好友房"进来（?online=1）：开房、进房就是这一行，滚到看得见、亮一下；
   * 有鼠标的直接把光标放进房间码，触屏不放（免得一进来就弹键盘盖住半屏）
   */
  showFriends(): void {
    this.friends.scrollIntoView({ block: 'nearest' });
    this.friends.classList.remove('spot');
    void this.friends.offsetWidth;
    this.friends.classList.add('spot');
    if (matchMedia('(pointer: fine)').matches) this.codeIn.focus({ preventScroll: true });
  }

  private pick(id: StakesId): void {
    this.stakes = id;
    // 换档就按这一档的满买入（draw 里先改了上下限再设值，不然值会被旧的上限截住）
    this.slider.dataset.init = '';
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
    patchSettings({ stakes: this.stakes, size: this.size, mode: this.mode });
  }

  private draw(): void {
    const { wallet, note, resume, orphan, busy } = this.s;
    const bal = wallet?.balance ?? null;
    setText(this.balance, bal === null ? '—' : chips(bal));
    toggle(this.reliefBtn, 'hidden', !wallet?.canRelief);
    setText(this.noteEl, note ?? '');
    toggle(this.noteEl, 'hidden', !note);
    toggle(this.resumeBox, 'hidden', !resume);
    if (resume) setText(this.resumeText, `${resume.practice ? '娱乐' : '实盘'} · ${stakesOf(resume.stakes).name} · ${resume.size} 人，${resume.waiting ? '等钱包回话' : '上次没打完'}`);
    toggle(this.orphanBox, 'hidden', !orphan || !!resume);
    if (orphan) setText(this.orphanText, `另一台设备上还有一桌没打完（带上桌 ${chips(orphan.amount)}）：回那台设备离桌就能结回；放着不管，24 小时后原样退回钱包`);

    // 钱包连不上：实盘不可选，娱乐照常
    const fun = this.mode === 'fun' || !wallet;
    for (const [m, b] of this.modeBtns) {
      toggle(b, 'sel', (m === 'fun') === fun);
      b.disabled = m === 'real' && !wallet;
    }
    setText(this.modeNote, fun ? '不碰钱包，筹码不算数，随便玩' : '从钱包带筹码上桌，离桌结回；最多输掉带上去的');
    // 实盘新开一份只要钱包够这次带入（平台 0.10.2）：够这一档的最少买入就能开，不够一整份就少带一点
    for (const st of STAKES) {
      const t = this.tiles.get(st.id)!;
      toggle(t, 'sel', st.id === this.stakes);
      toggle(t, 'locked', !fun && bal !== null && bal < st.min);
    }
    this.sizes.forEach((b, i) => toggle(b, 'sel', i + 2 === this.size));
    const st = stakesOf(this.stakes);
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
    const room = this.s.room;
    // 开房只看钱包够不够这一档的最少买入（坐下就要带；不够一整份的，坐下时少带一点）；单机没打完、别处还有一份都不拦
    // （0.3.0：好友房不设多余的限制）
    this.openBtn.disabled = busy || !wallet || (bal ?? 0) < st.min;
    this.openBtn.title = !wallet ? '钱包连不上，稍后再试' : (bal ?? 0) < st.min ? `这一档最少带 ${chips(st.min)}：去大厅领补给，或者换小一档` : '';
    this.joinBtn.disabled = busy || this.codeIn.value.length !== 6;
    toggle(this.roomBox, 'hidden', !room);
    if (room) {
      setText(this.roomText, room.text);
      setText(this.backBtn, `回到房间 ${room.code}`);
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
