/**
 * 驾驶台（DESIGN.md 2.2、2.7、第 8 节）：照一回合的顺序排，玩家一眼看出现在该做哪一步。
 * - 最上面一条步骤条：① 挂挡 → ② 出牌 → ③ 亮牌移动 → ④ 冲刺 / 拼劲 → ⑤ 尾流 → ⑥ 过弯 → ⑦ 弃牌、补牌，亮着的是现在这一步；
 * - 左边是自己的玩家板：半圆的挡位盘（现在的挡上放一枚标记；1、2 挡标着散热，跳两挡标着要 1 张热量）、引擎热量（一个火苗 × 张数）；
 * - 中间是出牌区（挂几挡就有几个空位）和手牌：点手牌放进出牌区，点出牌区的牌拿回来；
 * - 右边只放这一步要做的事：① 先挂挡，挂好了才去出牌；② 出牌时预览落点、过弯、热量，交之前可以预设后面几步；
 *   亮牌以后轮到自己时，换成那一步的问题（冲刺？多走 1 格？吸尾流？弃哪几张？）。
 * 预览只用自己的视图算（手抖按 1–4 的范围），算出来的格子交给赛道画一辆虚影车。
 */
import { HEAT, STRESS, discardable, faceValue } from '../core/cards.ts';
import { crossedCorners, gearOptions } from '../core/rules.ts';
import type { Action, Ask, Plan, Pre } from '../core/types.ts';
import type { View } from '../core/view.ts';
import { getTrack } from '../track/index.ts';
import { backSvg, cardSvg, flameSvg } from './cards.ts';
import { closeDialog, dialog } from './dialog.ts';
import { button, el } from './dom.ts';
import { ASK_TEXT, kindLabel } from './text.ts';

export interface Presets {
  boost: Pre;
  adren: Pre;
  slip: Pre;
  /** true：出牌时顺手标要弃的牌；false：每回合轮到时问 */
  markDiscard: boolean;
}

export interface DashHooks {
  plan(p: Plan): void;
  answer(a: Action): void;
  /** 落点预览（null 是不画） */
  preview(pos: number | null, lane: number, kind: 'ok' | 'pay' | 'spin'): void;
  /** 预设改了（存进 racing.prefs） */
  presets(p: Presets): void;
}

/** 步骤条的七步；问题对应到第几步 */
const STEPS = ['挂挡', '出牌', '亮牌移动', '冲刺·拼劲', '尾流', '过弯', '弃牌·补牌'] as const;
const ASK_STEP: Record<Ask, number> = { boost: 3, adren: 3, slip: 4, discard: 6 };
/** 挡位盘上每一挡的位置（viewBox 0 0 120 104）：圆心 (60, 90)、半径 48 的半圆上，从左往右 1–4 挡 */
const GATE: Record<number, [number, number]> = { 1: [15.7, 71.6], 2: [41.6, 45.7], 3: [78.4, 45.7], 4: [104.3, 71.6] };
const INK = '#2b2622';
const COOL: Record<number, string> = { 1: '散热 3', 2: '散热 1', 3: '', 4: '' };

interface Preview {
  min: number;
  max: number;
  /** 最好、最坏情况下过弯付几张；会不会打滑 */
  pay: [number, number];
  spin: 'no' | 'maybe' | 'yes';
  corners: number[];
  cool: number;
  shiftPaid: number;
}

export class Dash {
  readonly root: HTMLElement;
  private v: View | null = null;
  private names: string[] = [];
  /** 交计划这一回合里自己走到哪一步：先挂挡，再出牌 */
  private step: 'gear' | 'cards' = 'gear';
  private gear = 1;
  private sel: number[] = [];
  private marks: number[] = [];
  private markMode = false;
  /** 这一回合是不是已经初始化过（新回合重置） */
  private round = -1;
  private until: number | null = null;
  private timerEl: HTMLElement | null = null;
  private tick = 0;
  private presets: Presets;
  private readonly hooks: DashHooks;
  /** 新手教程：预设一律"问我"，不显示预设小签（好让冲刺、尾流、拼劲、弃牌的提问都出现） */
  private readonly lockPresets: boolean;

  constructor(parent: HTMLElement, presets: Presets, hooks: DashHooks, lockPresets = false) {
    this.presets = presets;
    this.hooks = hooks;
    this.lockPresets = lockPresets;
    this.root = el('div', 'dash', parent);
    this.tick = window.setInterval(() => this.paintTimer(), 250);
  }

  destroy(): void {
    window.clearInterval(this.tick);
    this.root.remove();
  }

  /** 这一手的截止时间（好友房；单机不计时） */
  setTimer(until: number | null): void {
    this.until = until;
    this.paintTimer();
  }

  private paintTimer(): void {
    if (!this.timerEl) return;
    if (this.until === null) {
      this.timerEl.hidden = true;
      return;
    }
    const left = Math.max(0, this.until - Date.now());
    this.timerEl.hidden = false;
    this.timerEl.textContent = `${Math.ceil(left / 1000)} 秒`;
    this.timerEl.classList.toggle('hurry', left < 5_000);
  }

  render(v: View, names: string[] = []): void {
    this.v = v;
    this.names = names;
    const me = v.me;
    this.root.replaceChildren();
    this.timerEl = null;
    if (!me) {
      el('div', 'dash-note', this.root, '旁观中');
      this.hooks.preview(null, 0, 'ok');
      return;
    }
    const car = v.cars[me.seat]!;
    if (this.round !== v.round) {
      this.round = v.round;
      this.step = 'gear';
      this.gear = car.gear;
      this.sel = [];
      this.marks = [];
      this.markMode = false;
    }
    // 这一回合交过了：摆着自己交的
    if (me.plan && v.phase === 'plan') {
      this.gear = me.plan.gear;
      this.sel = me.plan.cards.slice();
      this.marks = me.plan.discard === 'ask' ? [] : me.plan.discard.slice();
    }
    const planning = v.phase === 'plan' && !me.plan && car.rank === null;
    const asked = v.phase === 'act' && v.cur === me.seat && v.ask !== null;
    // 现在亮的是第几步
    const at = car.rank !== null ? -1 : planning ? (this.step === 'gear' ? 0 : 1) : asked ? ASK_STEP[v.ask!] : v.phase === 'act' ? 2 : 1;
    this.steps(at, planning || asked);
    this.timerEl = el('div', 'dash-timer', this.root);
    this.paintTimer();

    const rig = el('div', 'rig', this.root);
    const center = el('div', 'dash-center', this.root);
    const action = el('div', 'dash-action', this.root);
    const usable = me.hand.filter((h) => h.kind !== HEAT);
    const gears = gearOptions({ gear: car.gear, engine: car.engine });
    if (planning && !gears.includes(this.gear)) this.gear = car.gear;
    const stall = planning && usable.length < this.gear;

    // ---------- 左边：挡位箱、引擎、牌堆 ----------
    const shownGear = planning || (v.phase === 'plan' && me.plan) ? this.gear : car.gear;
    this.gearbox(rig, shownGear, planning && this.step === 'gear' ? gears : null, car.gear);
    this.engine(rig, car.engine);

    // ---------- 中间：出牌区和手牌 ----------
    // 上面一排：左边出牌区（或这回合亮出来的牌），右边牌堆区、弃牌区
    const top = el('div', 'center-top', center);
    const slotsShown = planning ? this.gear : v.phase === 'plan' && me.plan ? me.plan.gear : 0;
    if (slotsShown > 0) this.slots(top, slotsShown, planning && this.step === 'cards', !planning);
    else if (car.speed !== null && car.play.length) this.played(top, car.play, car.speed);
    else el('div', 'slots-note', top, car.rank !== null ? '' : '等别人……');
    this.zones(top, car.deck, me.discard, me.pool);
    this.hand(center, planning && this.step === 'cards', asked && v.ask === 'discard', stall);

    // ---------- 右边：这一步要做的事 ----------
    if (car.rank !== null) {
      el('div', 'dash-note big', action, `冲线！第 ${car.rank + 1} 名`);
      this.hooks.preview(null, 0, 'ok');
    } else if (planning && this.step === 'gear') this.gearStep(action, car.gear, usable.length);
    else if (planning) this.cardStep(action, stall);
    else if (asked) this.askStep(action);
    else {
      this.hooks.preview(null, 0, 'ok');
      const who = v.cur !== null ? this.names[v.cur] : null;
      el('div', 'dash-note', action, v.phase === 'plan' ? '出好了，等别人出牌……' : who ? `等 ${who} 决定……` : '车在走……');
    }
  }

  // ---------- 步骤条 ----------

  private steps(at: number, mine: boolean): void {
    const bar = el('ol', 'steps', this.root);
    STEPS.forEach((name, i) => {
      const li = el('li', `step${i === at ? ' now' : ''}${i < at ? ' done' : ''}${i === at && mine ? ' mine' : ''}`, bar);
      el('b', '', li, String(i + 1));
      el('span', '', li, name);
    });
  }

  // ---------- 车台 ----------

  /** 挡位盘：印在玩家板上的半圆，现在的挡上放一枚塑料标记。choose 不是 null 时能点（能挂的挡），否则只显示 */
  private gearbox(parent: HTMLElement, gear: number, choose: number[] | null, from: number): void {
    const box = el('div', `gearbox${choose ? ' live' : ''}`, parent);
    const [kx, ky] = GATE[gear] ?? GATE[1]!;
    const nums = [1, 2, 3, 4].map((g) => `<text x="${GATE[g]![0]}" y="${GATE[g]![1] + 4.5}" font-size="13" font-weight="900" text-anchor="middle" fill="${INK}">${g}</text>`).join('');
    box.innerHTML = `<svg viewBox="0 0 120 104" aria-hidden="true">
<path d="M12 90A48 48 0 0 1 108 90" fill="none" stroke="${INK}" stroke-width="24" stroke-linecap="round"/>
<path d="M12 90A48 48 0 0 1 108 90" fill="none" stroke="#e7dcc0" stroke-width="20" stroke-linecap="round"/>
${nums}<text x="60" y="86" font-size="11" font-weight="800" text-anchor="middle" fill="${INK}">挡位</text>
<circle cx="${kx + 1.5}" cy="${ky + 2.5}" r="11" fill="#000" opacity=".35"/>
<circle cx="${kx}" cy="${ky}" r="11" fill="#e0483f" stroke="#8c1d22" stroke-width="1.2"/>
<circle cx="${kx}" cy="${ky}" r="11" fill="url(#rb-plast)"/>
<text x="${kx}" y="${ky + 4.5}" font-size="13" font-weight="900" text-anchor="middle" fill="#fff">${gear}</text></svg>`;
    for (let g = 1; g <= 4; g++) {
      const [x, y] = GATE[g]!;
      const ok = choose?.includes(g) ?? false;
      const b = button(`gate-btn${g === gear ? ' on' : ''}`, box, '', () => {
        this.gear = g;
        if (this.sel.length > g) this.sel = this.sel.slice(0, g);
        this.render(this.v!, this.names);
      });
      b.style.left = `${(x / 120) * 100}%`;
      b.style.top = `${(y / 104) * 100}%`;
      b.disabled = !ok;
      b.setAttribute('aria-label', `${g} 挡`);
      if (choose) {
        if (Math.abs(g - from) === 2 && ok) el('i', 'cost', b).innerHTML = `${flameSvg()}−1`;
        else if (COOL[g]) el('i', 'cool', b, COOL[g]);
      }
    }
  }

  /** 引擎热量：一个火苗 × 张数（用光了火苗是灰的） */
  private engine(parent: HTMLElement, engine: number): void {
    const box = el('div', 'engine', parent);
    el('span', 'lbl', box, '引擎热量');
    const count = el('div', `count${engine <= 1 ? ' low' : ''}`, box);
    el('i', '', count).innerHTML = flameSvg(engine > 0);
    el('span', 'x', count, '×');
    el('b', '', count, String(engine));
    box.title = `引擎里还有 ${engine} 张热量：跳挡、冲刺、过弯超速都从这里付`;
  }

  /**
   * 牌堆区、弃牌区：牌堆是盖着的一摞（标着还剩几张），弃牌区摆着最上面那张。
   * 点弃牌区翻看自己这一场用过、弃过的牌（新的在前）；点牌堆看还剩哪些牌（只有种类和张数，顺序谁也不知道）
   */
  private zones(parent: HTMLElement, deck: number, discard: readonly number[], pool: readonly number[]): void {
    const box = el('div', 'zones', parent);
    const d = button('zone deck', box, '', () => this.showDeck(pool, discard));
    d.innerHTML = `${deck > 0 ? backSvg() : ''}<b>${deck}</b>`;
    d.title = '牌堆：点开看还剩哪些牌';
    el('span', 'zone-lbl', d, '牌堆');
    const t = button('zone discard', box, '', () => this.showDiscard(discard));
    const top = discard.at(-1);
    t.innerHTML = `${top === undefined ? '' : cardSvg(top)}<b>${discard.length}</b>`;
    t.title = '弃牌区：点开看这一场用过的牌';
    el('span', 'zone-lbl', t, '弃牌区');
    if (discard.length === 0) t.disabled = true;
  }

  private stageEl(): HTMLElement {
    return (this.root.closest('.stage') as HTMLElement | null) ?? document.body;
  }

  private showDiscard(discard: readonly number[]): void {
    dialog(this.stageEl(), 'pile', (box) => {
      el('h2', '', box, `弃牌区 · ${discard.length} 张`);
      el('p', 'pile-note', box, '这一场打过、弃过、付掉的牌，新的在前；牌堆抓完了会把这里洗回去');
      this.counts(box, discard);
      const row = el('div', 'pile-cards', box);
      for (const k of [...discard].reverse()) el('span', 'mini', row).innerHTML = cardSvg(k);
      button('act go', box, '知道了', closeDialog);
    });
  }

  private showDeck(pool: readonly number[], discard: readonly number[]): void {
    const left: number[] = [];
    pool.forEach((n, k) => {
      const used = discard.filter((x) => x === k).length;
      for (let i = 0; i < n - used; i++) left.push(k);
    });
    dialog(this.stageEl(), 'pile', (box) => {
      el('h2', '', box, `牌堆 · 还剩 ${left.length} 张`);
      el('p', 'pile-note', box, '只知道还剩哪些，不知道顺序；手抖牌翻牌、冲刺都从这里翻');
      this.counts(box, left);
      button('act go', box, '知道了', closeDialog);
    });
  }

  /** 按种类数一数：每种一张小牌加"×几" */
  private counts(box: HTMLElement, kinds: readonly number[]): void {
    const row = el('div', 'pile-counts', box);
    for (const k of [0, 1, 2, 3, 4, 5, HEAT, STRESS]) {
      const n = kinds.filter((x) => x === k).length;
      if (!n) continue;
      const c = el('span', 'count', row);
      el('span', 'mini', c).innerHTML = cardSvg(k);
      el('b', '', c, `×${n}`);
      c.title = kindLabel(k);
    }
    if (!row.childElementCount) el('span', 'pile-note', row, '空的');
  }

  // ---------- 出牌区和手牌 ----------

  /** 出牌区：挂几挡几个空位。live 时点牌拿回手里；faceDown 时盖着（交了、等别人） */
  private slots(parent: HTMLElement, n: number, live: boolean, faceDown: boolean): void {
    const me = this.v!.me!;
    const row = el('div', 'slots', parent);
    el('span', 'lbl', row, `出牌区 · ${n} 张`);
    for (let i = 0; i < n; i++) {
      const id = this.sel[i];
      const h = id === undefined ? undefined : me.hand.find((x) => x.id === id);
      const s = el('button', `slot${h ? ' full' : ''}`, row);
      s.type = 'button';
      if (h) s.innerHTML = faceDown ? backSvg() : cardSvg(h.kind);
      if (live && h) s.addEventListener('click', () => {
        this.sel = this.sel.filter((x) => x !== id);
        this.render(this.v!, this.names);
      });
      else s.disabled = true;
    }
  }

  /** 亮牌以后：这回合打出的牌和速度 */
  private played(parent: HTMLElement, kinds: number[], speed: number): void {
    const row = el('div', 'slots', parent);
    el('span', 'lbl', row, `这回合 · 速度 ${speed}`);
    for (const k of kinds) {
      const s = el('div', 'slot full', row);
      s.innerHTML = cardSvg(k);
    }
  }

  /** 手牌：pick 时点了放进出牌区（或标弃）；discard 时点了标要弃的 */
  private hand(parent: HTMLElement, pick: boolean, discard: boolean, stall: boolean): void {
    const v = this.v!;
    const me = v.me!;
    const row = el('div', `hand${pick || discard ? ' live' : ''}`, parent);
    for (const h of me.hand) {
      if (this.sel.includes(h.id) && (pick || (v.phase === 'plan' && me.plan))) continue;
      const c = el('button', 'card', row);
      c.type = 'button';
      c.dataset.kind = String(h.kind);
      c.innerHTML = cardSvg(h.kind);
      if (h.kind === HEAT) c.classList.add('heat');
      if (this.marks.includes(h.id)) c.classList.add('mark');
      const canPick = pick && !stall && (this.markMode ? discardable(h.kind) : h.kind !== HEAT);
      const canMark = discard && discardable(h.kind);
      if (canPick || canMark) {
        c.addEventListener('click', () => {
          if (canMark || this.markMode) this.marks = this.marks.includes(h.id) ? this.marks.filter((x) => x !== h.id) : [...this.marks, h.id];
          else if (this.sel.length < this.gear) {
            this.sel.push(h.id);
            this.marks = this.marks.filter((x) => x !== h.id);
          }
          this.render(v, this.names);
        });
      } else {
        c.disabled = true;
        if (pick || discard) c.classList.add('off');
      }
    }
  }

  // ---------- 右边：每一步 ----------

  /** ① 挂挡 */
  private gearStep(box: HTMLElement, from: number, usable: number): void {
    this.hooks.preview(null, 0, 'ok');
    const g = this.gear;
    el('div', 'act-title', box, `1. 挂挡：${g} 挡`);
    const lines: string[] = [`这回合出 ${g} 张牌`];
    const range = this.speedRange(g);
    if (range) lines.push(`能跑 ${range[0]}–${range[1]} 格`);
    if (g <= 2) lines.push(`走完散热 ${g === 1 ? 3 : 1} 张`);
    if (Math.abs(g - from) === 2) lines.push('跳两挡，付 1 张热量');
    el('div', 'hint', box, lines.join(' · '));
    if (usable < g) el('div', 'warn', box, `能打的牌只有 ${usable} 张，挂 ${g} 挡会熄火`);
    el('div', 'hint', box, `现在 ${from} 挡：升降 1 挡免费，2 挡要热量`);
    button('act go', box, '挂好了，出牌 →', () => {
      this.step = 'cards';
      this.render(this.v!, this.names);
    });
  }

  /** ② 出牌：预览、预设、出牌 */
  private cardStep(box: HTMLElement, stall: boolean): void {
    const v = this.v!;
    const me = v.me!;
    const car = v.cars[me.seat]!;
    const head = el('div', 'act-head', box);
    el('div', 'act-title', head, `2. 出牌：${this.gear} 挡`);
    button('back', head, '← 换挡', () => {
      this.step = 'gear';
      this.sel = [];
      this.render(v, this.names);
    });
    const p = stall ? null : this.sel.length === this.gear ? this.previewOf(this.gear, this.sel) : null;
    const info = el('div', 'preview', box);
    if (stall) {
      el('div', 'warn', info, `能打的牌不够 ${this.gear} 张：会熄火（车不动，回 1 挡）`);
      this.hooks.preview(null, 0, 'ok');
    } else if (!p) {
      el('div', 'hint', info, `点手牌放进出牌区，还差 ${this.gear - this.sel.length} 张`);
      this.hooks.preview(null, 0, 'ok');
    } else {
      el('div', 'speed', info, p.min === p.max ? `速度 ${p.min}` : `速度 ${p.min}–${p.max}`);
      const line: string[] = [];
      if (p.shiftPaid) line.push('跳挡 −1 热量');
      if (p.cool) line.push(`散热 ${p.cool}`);
      if (p.corners.length) line.push(`过弯 ${p.corners.map((l) => `限${l}`).join('、')}`);
      if (line.length) el('div', 'hint', info, line.join(' · '));
      const pay = p.pay[0] === p.pay[1] ? `${p.pay[0]}` : `${p.pay[0]}–${p.pay[1]}`;
      if (p.spin === 'yes') el('div', 'warn', info, '热量不够，会打滑！');
      else if (p.spin === 'maybe') el('div', 'warn', info, `手气差会打滑（付 ${pay}）`);
      else if (p.pay[1] > 0) el('div', 'pay', info).innerHTML = `${flameSvg()}过弯付 ${pay} 张热量`;
      const mid = Math.round((p.min + p.max) / 2);
      this.hooks.preview(car.pos + mid, car.lane, p.spin !== 'no' ? 'spin' : p.pay[1] > 0 ? 'pay' : 'ok');
    }

    // 后面几步的预设：亮牌以后轮到我时直接照办，不再停下来问
    const chips = el('div', 'chips', box);
    el('span', 'lbl', chips, '后面几步');
    const chip = (label: string, key: 'boost' | 'adren' | 'slip', values: Pre[], names: Record<Pre, string>): void => {
      const cur = this.presets[key];
      button(`chip p-${cur}`, chips, `${label}：${names[cur]}`, () => {
        const i = values.indexOf(cur);
        this.presets = { ...this.presets, [key]: values[(i + 1) % values.length]! };
        this.hooks.presets(this.presets);
        this.render(v, this.names);
      });
    };
    chip('冲刺', 'boost', ['ask', 'no'], { ask: '问我', no: '不冲', yes: '冲' });
    if (car.adren) chip('拼劲', 'adren', ['ask', 'yes', 'no'], { ask: '问我', yes: '多走 1 格', no: '不用' });
    chip('尾流', 'slip', ['ask', 'yes', 'no'], { ask: '问我', yes: '能吸就吸', no: '不吸' });
    button(`chip ${this.presets.markDiscard ? 'p-yes' : 'p-ask'}`, chips, this.presets.markDiscard ? '弃牌：现在标' : '弃牌：轮到时问', () => {
      this.presets = { ...this.presets, markDiscard: !this.presets.markDiscard };
      this.markMode = false;
      this.marks = [];
      this.hooks.presets(this.presets);
      this.render(v, this.names);
    });
    if (this.presets.markDiscard) {
      button(`chip mark-mode${this.markMode ? ' on' : ''}`, chips, this.markMode ? `点手牌标弃（${this.marks.length}）· 完成` : `标要弃的牌${this.marks.length ? `（${this.marks.length}）` : ''}`, () => {
        this.markMode = !this.markMode;
        this.render(v, this.names);
      });
    }

    if (this.lockPresets) chips.remove();
    const go = button('act go', box, stall ? '熄火' : '出牌', () => {
      const plan: Plan = {
        gear: this.gear,
        cards: stall ? [] : this.sel.slice(),
        boost: this.presets.boost,
        adren: this.presets.adren,
        slip: this.presets.slip,
        discard: this.presets.markDiscard ? this.marks.filter((id) => !this.sel.includes(id)) : 'ask',
      };
      this.hooks.preview(null, 0, 'ok');
      this.hooks.plan(plan);
    });
    go.disabled = !stall && this.sel.length !== this.gear;
  }

  /** ④–⑦ 轮到自己回答 */
  private askStep(box: HTMLElement): void {
    const v = this.v!;
    const me = v.me!;
    const car = v.cars[me.seat]!;
    const ask = v.ask!;
    this.hooks.preview(null, 0, 'ok');
    const q = el('div', 'ask', box);
    el('div', 'act-title', q, `${ASK_STEP[ask] + 1}. ${ask === 'boost' ? '冲刺' : ask === 'adren' ? '拼劲' : ask === 'slip' ? '尾流' : '弃牌'}`);
    el('div', 'ask-q', q, ASK_TEXT[ask]);
    if (ask !== 'discard') el('div', 'hint', q, `这回合速度 ${car.speed ?? 0} · 引擎热量 ${car.engine}`);
    const row = el('div', 'row', q);
    if (ask === 'discard') {
      button('act soft', row, '不弃', () => this.hooks.answer({ t: 'discard', cards: [] }));
      const b = button('act go', row, this.marks.length ? `弃掉 ${this.marks.length} 张` : '弃掉', () => {
        const cards = this.marks.slice();
        this.marks = [];
        this.hooks.answer({ t: 'discard', cards });
      });
      b.disabled = this.marks.length === 0;
      return;
    }
    const yes = ask === 'boost' ? '冲刺' : ask === 'adren' ? '多走 1 格' : '吸尾流';
    button('act soft', row, '不了', () => this.hooks.answer({ t: ask, yes: false }));
    button('act go', row, yes, () => this.hooks.answer({ t: ask, yes: true }));
  }

  /** 挂 g 挡、用手里的牌最慢和最快能跑几格（手抖按 1–4 算）；牌不够这一挡是 null */
  private speedRange(g: number): [number, number] | null {
    const vals = this.v!.me!.hand.filter((h) => h.kind !== HEAT).map((h) => (h.kind === STRESS ? [1, 4] : [faceValue(h.kind), faceValue(h.kind)]) as [number, number]);
    if (vals.length < g) return null;
    const lo = vals.map((x) => x[0]).sort((a, b) => a - b);
    const hi = vals.map((x) => x[1]).sort((a, b) => b - a);
    return [lo.slice(0, g).reduce((a, b) => a + b, 0), hi.slice(0, g).reduce((a, b) => a + b, 0)];
  }

  private previewOf(gear: number, cards: number[]): Preview | null {
    const v = this.v!;
    const me = v.me!;
    const car = v.cars[me.seat]!;
    const track = getTrack(v.opts.track);
    if (!track) return null;
    const kinds = cards.map((id) => me.hand.find((h) => h.id === id)?.kind ?? 0);
    const fixed = kinds.reduce((a, k) => a + (k === STRESS ? 0 : faceValue(k)), 0);
    const stress = kinds.filter((k) => k === STRESS).length;
    const basics = [1, 2, 3, 4].filter((k) => (me.pool[k] ?? 0) > 0);
    const lo = basics.length ? Math.min(...basics) : 0;
    const hi = basics.length ? Math.max(...basics) : 0;
    const min = fixed + stress * lo;
    const max = fixed + stress * hi;
    const shiftPaid = Math.abs(gear - car.gear) === 2 ? 1 : 0;
    const heatInHand = me.hand.filter((h) => h.kind === HEAT).length;
    const cool = Math.min((gear === 1 ? 3 : gear === 2 ? 1 : 0) + (car.adren ? 1 : 0), heatInHand);
    const engine = car.engine - shiftPaid + cool;
    let payMin = Infinity;
    let payMax = 0;
    let spins = 0;
    const lines = new Set<number>();
    for (let s = min; s <= max; s++) {
      let left = engine;
      let pay = 0;
      let spun = false;
      for (const k of crossedCorners(track, v.finish, car.pos, car.pos + s)) {
        lines.add(k.limit);
        const over = s - k.limit;
        if (over <= 0) continue;
        if (left < over) {
          spun = true;
          break;
        }
        left -= over;
        pay += over;
      }
      if (spun) spins++;
      else {
        payMin = Math.min(payMin, pay);
        payMax = Math.max(payMax, pay);
      }
    }
    const n = max - min + 1;
    return {
      min,
      max,
      pay: [payMin === Infinity ? 0 : payMin, payMax],
      spin: spins === 0 ? 'no' : spins === n ? 'yes' : 'maybe',
      corners: [...lines],
      cool,
      shiftPaid,
    };
  }
}
