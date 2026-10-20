/**
 * 玩法说明（所有者 10-20）：六页，大白话，多用图标和小例子，每页一屏左右。
 * 名字、配方、数值全从内容表现取（weapons / enemies / maps / meta / waves / explore / live / guide），以后加法器、地图、流派自动跟上；
 * 只有讲道理的句子写在这里。主页和暂停面板都能打开，关掉回到打开它的地方。
 */
import { PICKS } from '../../content/picks.ts';
import type { EnemyKind } from '../../content/enemies.ts';
import { GATE_WINDOWS, RAID_DAWN, RAID_LATE } from '../../content/explore.ts';
import { GUIDE_EXAMPLES, ROLE_NAME, ROLE_TIP, SCHOOLS, WEAPON_ROLE, type Role, type SchoolId } from '../../content/guide.ts';
import { LIVE_MAP_CLOSED, LIVE_MAX_BP, LIVE_TIER_IDS, LIVE_TIERS } from '../../content/live.ts';
import { MAP_IDS, MAP_UNLOCK, MAPS } from '../../content/maps.ts';
import { CHARACTER_IDS, CHARACTERS, CURSE_COIN_BONUS, MAX_CURSES, PERK_IDS, PERKS } from '../../content/meta.ts';
import { DANGER_IDS, DANGERS, DAWN_TICK, EVENTS } from '../../content/waves.ts';
import {
  ELEMENT_SET, MAX_PASSIVES, MAX_WEAPON_LEVEL, MAX_WEAPONS, MERGES, NEXT_ELEMENT, PASSIVES, TYPE_SETS, WEAPONS,
  type MergeDef, type WeaponId, type WeaponType,
} from '../../content/weapons.ts';
import { MONSTER_INFO } from './codex.ts';
import { counters } from './counters.ts';
import './guide.css';

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export type GuideTab = 'play' | 'grow' | 'build' | 'team' | 'modes' | 'eg';
const TABS: [GuideTab, string][] = [
  ['play', '怎么玩'],
  ['grow', '发育'],
  ['build', '搭配'],
  ['team', '配合'],
  ['modes', '模式'],
  ['eg', '例子'],
];

/** 拍数 → "14:00" */
const clock = (ticks: number): string => {
  const s = Math.round(ticks / 30);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];

export class Guide {
  readonly root: HTMLDivElement;
  private tab: GuideTab = 'play';
  private readonly icons: (k: string) => string;
  onClose: () => void = () => undefined;

  constructor(parent: HTMLElement, icons: (k: string) => string) {
    this.icons = icons;
    this.root = document.createElement('div');
    this.root.className = 'yx-screen yx-guide';
    this.root.style.display = 'none';
    parent.appendChild(this.root);
    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (!el || !this.root.contains(el)) return;
      if (el.dataset.a === 'close') this.onClose();
      else if (el.dataset.a === 'tab') {
        this.tab = el.dataset.t as GuideTab;
        this.render();
        this.root.querySelector('.yx-gbody')?.scrollTo(0, 0);
      }
    });
  }

  get open(): boolean {
    return this.root.style.display !== 'none';
  }

  show(tab?: GuideTab): void {
    if (tab) this.tab = tab;
    this.render();
    this.root.style.display = '';
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  private render(): void {
    const tabs = TABS.map(([t, n]) => `<button type="button" class="yx-tab${t === this.tab ? ' on' : ''}" data-a="tab" data-t="${t}">${n}</button>`).join('');
    const body = { play: this.play, grow: this.grow, build: this.build, team: this.team, modes: this.modes, eg: this.examples }[this.tab].call(this);
    this.root.innerHTML =
      '<div class="yx-panel yx-guide-panel">' +
      '<div class="yx-panel-head"><b class="yx-brush">玩法</b><em>六页看完就会玩</em></div>' +
      `<div class="yx-tabs yx-gtabs">${tabs}</div>` +
      `<div class="yx-gbody">${body}</div>` +
      '<div class="yx-row3"><button type="button" class="yx-big ghost" data-a="close">返回</button></div>' +
      '</div>';
  }

  // ── 小零件 ──
  private img(k: string, cls = ''): string {
    return `<img class="yx-gi${cls ? ` ${cls}` : ''}" alt="" src="${this.icons(k)}">`;
  }
  private w(id: WeaponId): string {
    return `<span class="yx-gw">${this.img(WEAPONS[id].icon)}<b>${esc(WEAPONS[id].name)}</b></span>`;
  }
  private evo(id: WeaponId): string {
    const e = WEAPONS[id].evolve;
    return e ? `<span class="yx-gw evo">${this.img(e.icon)}<b>${esc(e.name)}</b></span>` : '';
  }
  private p(id: keyof typeof PASSIVES): string {
    return `<span class="yx-gw">${this.img(PASSIVES[id].icon)}<b>${esc(PASSIVES[id].name)}</b></span>`;
  }
  private mob(k: EnemyKind): string {
    return `<span class="yx-gw">${this.img(k)}<b>${esc(MONSTER_INFO[k].name)}</b></span>`;
  }
  private recipe(id: WeaponId): string {
    const e = WEAPONS[id].evolve;
    if (!e) return '';
    return `<div class="yx-grecipe">${this.w(id)}<i>满级 +</i>${this.p(e.with)}<i>→</i>${this.evo(id)}</div>`;
  }
  private merge(m: MergeDef): string {
    return (
      `<div class="yx-gmerge${m.dual ? ' dual' : ''}" style="--mc:${m.color}">` +
      `<div class="yx-grecipe">${this.evo(m.a) || this.w(m.a)}<i>+</i>${m.dual ? this.w(m.b) : this.evo(m.b) || this.w(m.b)}<i>→</i><span class="yx-gw evo">${this.img(m.icon)}<b>${esc(m.name)}</b></span>${m.dual ? '<em class="yx-gtag">双修</em>' : ''}</div>` +
      `<p>${esc(m.desc)}</p></div>`
    );
  }
  private sec(title: string, inner: string): string {
    return `<section class="yx-gsec"><h3>${title}</h3>${inner}</section>`;
  }

  // ── ① 怎么玩 ──
  private play(): string {
    const boss = EVENTS.find((e) => e.kind === 'boss' && e.enemy === 'boss');
    const mid = EVENTS.find((e) => e.kind === 'boss' && e.enemy !== 'boss');
    return (
      this.sec(
        '只管走',
        '<ul class="yx-glist">' +
          '<li><b>走位</b>电脑用 WASD 或方向键，手机按住屏幕任意处拖出摇杆。</li>' +
          `<li>${this.img(WEAPONS.sword.icon)}法器自己出手，不用点。最多带 ${MAX_WEAPONS} 件法器、${MAX_PASSIVES} 件被动。</li>` +
          `<li>${this.img('soul')}怪倒下掉魂火，走近自动吸，吸满就升级。</li>` +
          '</ul>',
      ) +
      this.sec(
        `撑到天亮（${clock(DAWN_TICK)}）`,
        '<ul class="yx-glist">' +
          (mid ? `<li>${this.img(mid.enemy)}离天亮还剩 ${clock(DAWN_TICK - mid.at)}，${esc(MONSTER_INFO[mid.enemy].name)}来闹一场。</li>` : '') +
          (boss ? `<li>${this.img('boss')}还剩 ${clock(DAWN_TICK - boss.at)}，${esc(MONSTER_INFO.boss.name)}现身；打倒它天亮得更早，奖励也多。</li>` : '') +
          `<li>${this.img('chest')}精英倒下掉宝箱：法器升级，凑齐了就进化。</li>` +
          '</ul>',
      ) +
      this.sec(
        '三条保命心得',
        '<ol class="yx-glist num"><li>别站着不动，绕着圈走。</li><li>别往墙角、栅栏边钻，被围住最容易倒。</li><li>地上出圈（绿、蓝、灰）就是要砸下来了，走出圈。</li></ol>',
      )
    );
  }

  // ── ② 怎么发育 ──
  private grow(): string {
    const perks = PERK_IDS.map((id) => `<li><b>${esc(PERKS[id].name)}</b>${esc(PERKS[id].text)}<small>最多 ${PERKS[id].cost.length} 级</small></li>`).join('');
    const chars = CHARACTER_IDS.map((id) => {
      const c = CHARACTERS[id];
      return `<li>${this.img(WEAPONS[c.start].icon)}<b>${esc(c.name)}</b>${esc(c.perkName)}<small>${esc(c.unlock)}；小特权：${esc(c.privilege)}</small></li>`;
    }).join('');
    const maps = MAP_IDS.map((id) => `<li><b>${esc(MAPS[id].name)}</b>${esc(MAPS[id].blurb)}<small>${MAP_UNLOCK[id] ? esc(MAP_UNLOCK[id]!.text) : '一开始就有'}</small></li>`).join('');
    const dangers = DANGER_IDS.map((d) => `<li><b>${DANGERS[d].name}</b>${esc(DANGERS[d].blurb)}</li>`).join('');
    return (
      this.sec(
        '升级三选一',
        '<div class="yx-gcards"><span>新法器</span><span>法器升一级</span><span>被动</span></div>' +
          `<ul class="yx-glist"><li><b>刷新</b>三张都不想要，整批换掉。起步 ${PICKS.rerolls} 次，进化一件、打倒精英或首领各补 1 次，最多攒 ${PICKS.rerollMax} 次。</li><li><b>封禁</b>先点它再点一张卡，这张整局不再出现。起步 ${PICKS.bans} 次。</li><li><b>跳过</b>不拿，随机拿个小奖：铜钱、回血、下次多一张卡、刷新 +1。</li></ul>` +
          '<p class="yx-gnote">卡上写着拿了以后能凑成什么，留意「凑成」「再拿 X」。</p>',
      ) +
      this.sec('铜钱和加成', `<p>局里捡的铜钱打完存进账户（实盘也一样），每局结束还按撑了多久、打了多少、有没有天亮另给，回主页买永久加成（实盘不生效）：</p><ul class="yx-glist two">${perks}</ul>`) +
      this.sec('角色（选角页）', `<p>每个角色的血量、移速、伤害等初始数值不同，选角页有对比条。</p><ul class="yx-glist two">${chars}</ul>`) +
      this.sec('地图', `<ul class="yx-glist two">${maps}</ul>`) +
      this.sec('危险档', `<p>通关一档开下一档，越往上怪越硬、铜钱越多。还能挂最多 ${MAX_CURSES} 条咒印，每条铜钱 +${Math.round(CURSE_COIN_BONUS * 100)}%。</p><ul class="yx-glist two">${dangers}</ul>`)
    );
  }

  // ── ③ 怎么搭配 ──
  private build(): string {
    const types = (Object.keys(TYPE_SETS) as WeaponType[]).map((t) => {
      const ws = WEAPON_IDS.filter((id) => WEAPONS[id].type === t);
      return `<li><b>${t}</b>${ws.map((id) => this.img(WEAPONS[id].icon)).join('')}<small>2 件：${esc(TYPE_SETS[t][0])}；3 件：${esc(TYPE_SETS[t][1])}</small></li>`;
    }).join('');
    const cycle = (Object.keys(NEXT_ELEMENT) as (keyof typeof NEXT_ELEMENT)[]).map((e) => `${e}→${NEXT_ELEMENT[e]}`).join('　');
    const ex = WEAPONS.sword;
    const exC = counters(ex.type, ex.el);
    return (
      this.sec(
        '流派 = 同一类、同一行凑套装',
        '<p>每件法器卡上有两个字：类型（剑、符、镇、灵）和五行（金木水火土）。凑够 2 件、3 件有套装：</p>' +
          `<ul class="yx-glist">${types}</ul>` +
          `<p class="yx-gnote">同一行（五行）2 件：${esc(ELEMENT_SET[0])}；3 件：${esc(ELEMENT_SET[1])}。相生：${cycle}。</p>`,
      ) +
      this.sec(
        `进化：满级（${MAX_WEAPON_LEVEL} 级）+ 配对的被动，下一个宝箱就进化`,
        `<div class="yx-grecipes">${WEAPON_IDS.map((id) => this.recipe(id)).join('')}</div>`,
      ) +
      this.sec(
        '合成和双修：两件凑齐，宝箱里合成一件，空出一格',
        '<p>合成要两件都进化；双修（跨流派）一件进化、另一件满级就行。卡上有「凑成」两个字时就差这一张。</p>' +
          MERGES.map((m) => this.merge(m)).join(''),
      ) +
      this.sec(
        '卡上的「克 · 怕」',
        `<p>每种怪对法器的类型和五行有强有弱。比如 ${this.w('sword')}：</p>` +
          `<div class="yx-grecipe">${exC.strong.length ? `<i>克</i>${exC.strong.map((k) => this.mob(k)).join('')}` : ''}${exC.weak.length ? `<i>怕</i>${exC.weak.map((k) => this.mob(k)).join('')}` : ''}</div>` +
          '<p class="yx-gnote">「怕」的怪多了，就该补一件别的类型。</p>',
      )
    );
  }

  // ── ④ 怎么配合 ──
  private team(): string {
    const roles = (['crowd', 'single', 'guard'] as Role[]).map((r) => {
      const ws = WEAPON_IDS.filter((id) => WEAPON_ROLE[id] === r);
      return `<div class="yx-grole"><h4>${ROLE_NAME[r]}</h4><p>${ROLE_TIP[r]}</p><div class="yx-grecipe">${ws.map((id) => this.w(id)).join('')}</div></div>`;
    }).join('');
    return (
      this.sec('一套好搭配 = 三样活都有人干', `<div class="yx-groles">${roles}</div><p class="yx-gnote">前期先拿清群的；精英多起来前补一件单体；手上最好一直有一件保命的。</p>`) +
      this.sec(
        '什么时候拿被动',
        '<ol class="yx-glist num">' +
          '<li>手上法器的进化被动，见到就拿（卡上会标）。</li>' +
          `<li>保命：${this.p('xiantao')}${this.p('daopao')}，血少时先拿。</li>` +
          `<li>输出：${this.p('zhusha')}${this.p('xianglu')}${this.p('nianzhu')}，前期都划算；${this.p('lingpai')}只有 ${PASSIVES.lingpai.max} 级，但法器数量 +1 很值。</li>` +
          `<li>${this.p('yinhun')}是赌：${esc(PASSIVES.yinhun.text)}，稳了再拿。</li>` +
          '</ol>' +
          `<p class="yx-gnote">格子有限：${MAX_WEAPONS} 件法器、${MAX_PASSIVES} 件被动。别全占满却一件都没升满。</p>`,
      )
    );
  }

  // ── ⑤ 三种模式 ──
  private modes(): string {
    const left = (t: number): string => clock(RAID_DAWN - t);
    // 屏幕上是"离天亮"倒计时，所以按倒计时写：倒计时从 A 走到 B 这段时间里开门
    const gates = GATE_WINDOWS.map((g) => `倒计时 ${left(g.from)} 到 ${left(g.to)}${g.all ? ' 四门全开' : ' 开一座门'}`).join('；');
    const tiers = LIVE_TIER_IDS.map((t) => `${LIVE_TIERS[t].name}档 ${LIVE_TIERS[t].stake.toLocaleString('zh-CN')}`).join('、');
    const closed = LIVE_MAP_CLOSED.map((m) => MAPS[m].name).join('、');
    return (
      this.sec('守夜', `<p>选地图和危险档，撑到天亮（${clock(DAWN_TICK)}）。打倒尸王提前天亮。也可以选「天亮不收工」一直打到倒下。</p>`) +
      this.sec(
        '夜探：搜宝、打怪、找门撤离',
        '<ul class="yx-glist">' +
          `<li>${this.img('chest')}进镇子开宝箱（站在箱子边读条），宝物放进背包。</li>` +
          `<li><b>撤离门</b>${gates}。站进门圈 3 秒撤出，背包带回家。</li>` +
          `<li><b>鬼市</b>倒计时 ${left(RAID_LATE.market.from)} 到 ${left(RAID_LATE.market.to)} 镇中心摆摊，用局里的铜钱买宝物。</li>` +
          `<li><b>宝库</b>倒计时 ${left(RAID_LATE.vault.at)} 开封，要钥匙；钥匙是倒计时 ${left(RAID_LATE.vault.keyFrom)} 以后第一只倒下的精英或守卫掉的，里面 ${RAID_LATE.vault.items} 件好东西。</li>` +
          '<li>天亮还在镇里，背包全丢。屏幕边的箭头指着最近开着的门。</li>' +
          '</ul>',
      ) +
      this.sec(
        '实盘：带一份筹码',
        '<ul class="yx-glist">' +
          `<li>档位：${tiers}。撑得越久结回越多，最多 ${LIVE_MAX_BP / 10_000} 份；太早倒下就亏。</li>` +
          '<li>不带永久加成和咒印；角色和地图可以选已经解锁的。' + (closed ? `${esc(closed)}暂不开放。` : '') + '</li>' +
          '<li>筹码不能买、不能换、不能转。</li>' +
          '</ul>',
      )
    );
  }

  // ── ⑥ 例子 ──
  private examples(): string {
    return GUIDE_EXAMPLES.map((id, i) => this.school(id, i === 0)).join('');
  }

  private school(id: SchoolId, full: boolean): string {
    const s = SCHOOLS[id];
    const core = s.weapons.slice(0, 3);
    const first = WEAPONS[s.weapons[0]!];
    const char = CHARACTER_IDS.find((c) => CHARACTERS[c].start === s.weapons[0]);
    const merges = MERGES.filter((m) => (s.weapons.includes(m.a) && s.weapons.includes(m.b)) || (m.dual && (core.includes(m.a) || core.includes(m.b))));
    const c = counters(first.type, first.el);
    const fear = c.weak.length ? `<i>怕</i>${c.weak.map((k) => this.mob(k)).join('')}` : '';
    const like = c.strong.length ? `<i>克</i>${c.strong.map((k) => this.mob(k)).join('')}` : '';
    if (!full) {
      return this.sec(
        `${esc(s.name)}`,
        `<div class="yx-grecipe">${s.weapons.slice(0, 3).map((w) => this.w(w)).join('')}</div>` +
          `<p>被动：${s.passives.slice(0, 3).map((p) => this.p(p)).join('')}</p>` +
          `<div class="yx-grecipe">${like}${fear}</div>` +
          (merges[0] ? this.merge(merges[0]) : '') +
          `<p class="yx-gnote">${esc(s.tip)}</p>`,
      );
    }
    return this.sec(
      `${esc(s.name)}怎么玩（一条完整路线）`,
      '<ol class="yx-glist num yx-gsteps">' +
        `<li><b>起手</b>${char ? `选${esc(CHARACTERS[char].name)}，` : ''}带${this.w(s.weapons[0]!)}。</li>` +
        `<li><b>前期</b>拿齐${core.map((w) => this.w(w)).join('')}，被动先拿${s.passives.slice(0, 3).map((p) => this.p(p)).join('')}。${esc(first.type)} 3 件：${esc(TYPE_SETS[first.type][1])}。</li>` +
        `<li><b>中期</b>把它们升满、配齐进化被动：</li>` +
        '</ol>' +
        `<div class="yx-grecipes">${core.map((w) => this.recipe(w)).join('')}</div>` +
        `<p><b>后期</b>空格补${s.weapons.slice(3).map((w) => this.w(w)).join('')}，凑合成或双修：</p>` +
        merges.map((m) => this.merge(m)).join('') +
        `<p><b>看怪</b></p><div class="yx-grecipe">${like}${fear}</div>` +
        `<p class="yx-gnote">${esc(s.tip)}</p>`,
    );
  }
}
