/**
 * 图鉴和成就（DESIGN.md 3.8）：怪物、法器、成就三个标签，顶上是总收集度。
 * 数据每次 show 时重新读（传进来的是取数函数），所以结算后再打开就是最新的。
 * 没见过的怪画成黑影加问号，没用过的法器同理。图标只用图集里已有的帧（key 找不到时 icons 自己兜底）。
 */
import { ACHIEVEMENTS, rewardCoins } from '../../content/achievements.ts';
import { ENEMIES, type EnemyKind } from '../../content/enemies.ts';
import { MERGES, PASSIVES, WEAPONS, type WeaponId } from '../../content/weapons.ts';
import { collection, type Records } from '../../meta/records.ts';
import './codex.css';

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** 怪的名字和一句话（图集里的帧名 = 怪的 kind） */
export const MONSTER_INFO: Record<EnemyKind, { name: string; tag: string; blurb: string }> = {
  paper: { name: '纸人', tag: '常规', blurb: '成群结队，很脆，怕火' },
  wisp: { name: '小鬼火', tag: '常规', blurb: '又快又脆，成串飘来' },
  jiangshi: { name: '跳尸', tag: '常规', blurb: '一蹦一蹦，落地会停一下；怕火怕铃' },
  lantern: { name: '灯笼鬼', tag: '常规', blurb: '远远停下吐火球；刀剑伤不了它，怕水' },
  fox: { name: '狐妖', tag: '常规', blurb: '停一下，然后猛冲过来' },
  horse: { name: '纸马', tag: '常规', blurb: '排成一列直直冲来，怕火' },
  water: { name: '水鬼', tag: '常规', blurb: '从地里冒出来，抓住你会拖慢脚步；怕土' },
  bone: { name: '枯骨', tag: '常规', blurb: '打碎后散成两只小的；怕铃声' },
  bat: { name: '蝙蝠精', tag: '常规', blurb: '飞得快，乱晃，成群来' },
  scarecrow: { name: '稻草人', tag: '常规', blurb: '站着不动，走近才醒，很硬；怕火' },
  weasel: { name: '黄鼠狼', tag: '常规', blurb: '偷地上的铜钱就跑，追上打死加倍还' },
  snow: { name: '雪魅', tag: '常规', blurb: '远处丢冰锥，打中会变慢；怕火' },
  shishi: { name: '石狮怪', tag: '精英', blurb: '又大又慢又硬，刀剑砍不动' },
  general: { name: '跳尸将军', tag: '精英', blurb: '会召唤小跳尸；怕火怕铃' },
  whitefox: { name: '白狐', tag: '精英', blurb: '一口气连冲三下' },
  palanquin: { name: '纸轿', tag: '精英', blurb: '四个纸人抬着，打碎放出一群纸人' },
  lord: { name: '纸扎老爷', tag: 'Boss', blurb: '撒纸钱，召纸轿；约 8 分钟现身' },
  patrol: { name: '巡夜将', tag: '精英', blurb: '夜探里守着铜箱和院子，看见就追；6 分钟、11 分钟还有游荡的' },
  beast: { name: '镇门石兽', tag: 'Boss', blurb: '夜探里守着金箱，会扑、会甩尾；血少一半连扑两下' },
  boss: { name: '尸王', tag: 'Boss', blurb: '跳砸、召唤、尸气，血越少越凶；14 分钟现身' },
};

type Tab = 'monster' | 'weapon' | 'achv';
const TABS: [Tab, string][] = [
  ['monster', '怪物'],
  ['weapon', '法器'],
  ['achv', '成就'],
];

export class Codex {
  readonly root: HTMLDivElement;
  private tab: Tab = 'monster';
  private readonly icons: (k: string) => string;
  private readonly getRecords: () => Records;
  onClose: () => void = () => undefined;

  /** icons：图集帧名 → 图片地址；getRecords：取最新的累计统计 */
  constructor(parent: HTMLElement, icons: (k: string) => string, getRecords: () => Records) {
    this.icons = icons;
    this.getRecords = getRecords;
    this.root = document.createElement('div');
    this.root.className = 'yx-screen yx-codex';
    this.root.style.display = 'none';
    parent.appendChild(this.root);
    this.root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
      if (!el || !this.root.contains(el)) return;
      if (el.dataset.a === 'close') this.onClose();
      else if (el.dataset.a === 'tab') {
        this.tab = el.dataset.t as Tab;
        this.render();
      }
    });
  }

  show(tab?: Tab): void {
    if (tab) this.tab = tab;
    this.render();
    this.root.style.display = '';
  }

  hide(): void {
    this.root.style.display = 'none';
  }

  private render(): void {
    const rec = this.getRecords();
    const col = collection(rec);
    const body = this.tab === 'monster' ? this.monsters(rec) : this.tab === 'weapon' ? this.weapons(rec) : this.achievements(rec);
    const tabs = TABS.map(([t, n]) => `<button type="button" class="yx-tab${t === this.tab ? ' on' : ''}" data-a="tab" data-t="${t}">${n}</button>`).join('');
    this.root.innerHTML =
      '<div class="yx-panel yx-codex-panel">' +
      `<div class="yx-panel-head"><b class="yx-brush">图鉴</b><em>收集度 <strong>${col.percent}%</strong>（${col.done}/${col.total}）</em></div>` +
      `<div class="yx-cbar"><i style="width:${col.percent}%"></i></div>` +
      `<div class="yx-tabs">${tabs}</div>` +
      `<div class="yx-cbody">${body}</div>` +
      '<div class="yx-row3"><button type="button" class="yx-big ghost" data-a="close">返回</button></div>' +
      '</div>';
  }

  private monsters(rec: Records): string {
    const seenN = ENEMIES.filter((e) => rec.seen.includes(e.kind)).length;
    const cards = ENEMIES.map((e) => {
      const info = MONSTER_INFO[e.kind];
      const seen = rec.seen.includes(e.kind);
      const n = rec.killed[e.kind] ?? 0;
      if (!seen) return `<div class="yx-ccard lock"><img class="sil" alt="" src="${this.icons(e.kind)}"><b>？？？</b><span>${info.tag}</span><em>还没见过</em></div>`;
      return `<div class="yx-ccard${n > 0 ? ' done' : ''}"><img alt="" src="${this.icons(e.kind)}"><b>${esc(info.name)}</b><span>${info.tag}</span><p>${esc(info.blurb)}</p><em>${n > 0 ? `打倒 ${n.toLocaleString('zh-CN')} 只` : '见过，还没打倒'}</em></div>`;
    }).join('');
    return `<div class="yx-csub">见过 ${seenN}/${ENEMIES.length}</div><div class="yx-cgrid">${cards}</div>`;
  }

  private weapons(rec: Records): string {
    const ids = Object.keys(WEAPONS) as WeaponId[];
    const badge = (on: boolean, t: string): string => `<i class="${on ? 'on' : ''}">${t}</i>`;
    const cards = ids
      .map((id) => {
        const w = WEAPONS[id];
        const used = rec.weaponsUsed.includes(id);
        const evo = rec.weaponsEvolved.includes(id);
        if (!used) return `<div class="yx-ccard lock"><img class="sil" alt="" src="${this.icons(w.icon)}"><b>？？？</b><span>${w.el}·${w.type}</span><em>还没用过</em></div>`;
        const evoName = w.evolve ? (evo ? w.evolve.name : '？？？') : '';
        return (
          `<div class="yx-ccard${evo ? ' done' : ''}"><img alt="" src="${this.icons(evo && w.evolve ? w.evolve.icon : w.icon)}"><b>${esc(w.name)}</b><span>${w.el}·${w.type}</span>` +
          `<p>${esc(w.desc)}</p>${evoName ? `<p class="evo">进化：${esc(evoName)}${evo || !w.evolve ? '' : `（满级 + ${esc(PASSIVES[w.evolve.with].name)}）`}</p>` : ''}` +
          `<div class="yx-badges">${badge(true, '用过')}${badge(rec.weaponsMaxed.includes(id), '满级')}${badge(evo, '进化')}</div></div>`
        );
      })
      .join('');
    const merges = MERGES.map((m) => {
      const done = rec.merges.includes(m.id);
      const ic = WEAPONS[m.a].icon;
      return done
        ? `<div class="yx-ccard done"><img alt="" src="${this.icons(ic)}"><b>${esc(m.name)}</b><span>合成</span><p>${esc(m.desc)}</p><em>合成过</em></div>`
        : `<div class="yx-ccard lock"><img class="sil" alt="" src="${this.icons(ic)}"><b>？？？</b><span>合成</span><em>两件进化后的法器在宝箱里合成</em></div>`;
    }).join('');
    const usedN = rec.weaponsUsed.length;
    return `<div class="yx-csub">用过 ${usedN}/${ids.length} · 满级 ${rec.weaponsMaxed.length} · 进化 ${rec.weaponsEvolved.length} · 合成 ${rec.merges.length}/${MERGES.length}</div><div class="yx-cgrid">${cards}${merges}</div>`;
  }

  private achievements(rec: Records): string {
    const got = new Set(rec.achievements);
    const gotCoins = rewardCoins(rec.achievements);
    const groups = [...new Set(ACHIEVEMENTS.map((a) => a.group))];
    const html = groups
      .map((g) => {
        const rows = ACHIEVEMENTS.filter((a) => a.group === g)
          .map((a) => {
            const on = got.has(a.id);
            return (
              `<div class="yx-arow${on ? ' done' : ''}"><span class="mark">${on ? '✓' : ''}</span><div><b>${esc(a.name)}</b>${a.title ? `<u>称号「${esc(a.title)}」</u>` : ''}<p>${esc(a.desc)}</p></div>` +
              `<em>${a.coins} 铜钱</em></div>`
            );
          })
          .join('');
        return `<h4>${g}</h4><div class="yx-alist">${rows}</div>`;
      })
      .join('');
    return `<div class="yx-csub">已达成 ${got.size}/${ACHIEVEMENTS.length} · 已得 ${gotCoins.toLocaleString('zh-CN')} 铜钱</div>${html}`;
  }
}

/**
 * 解锁成就的小提示条：贴在顶部，一条 3 秒，几条排队依次出。不挡操作（pointer-events: none）。
 * 用法：结算时 `toast.show(unlocked)`；对局中解锁也可以随时调。
 */
export class AchievementToast {
  private readonly root: HTMLDivElement;
  private queue: string[] = [];
  private busy = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'yx-atoast';
    parent.appendChild(this.root);
  }

  show(ids: readonly string[]): void {
    this.queue.push(...ids.filter((id) => ACHIEVEMENTS.some((a) => a.id === id)));
    if (!this.busy) this.next();
  }

  clear(): void {
    this.queue = [];
    this.root.innerHTML = '';
    this.busy = false;
  }

  private next(): void {
    const id = this.queue.shift();
    const a = id ? ACHIEVEMENTS.find((x) => x.id === id) : undefined;
    if (!a) {
      this.busy = false;
      return;
    }
    this.busy = true;
    const el = document.createElement('div');
    el.className = 'yx-atoast-item';
    el.innerHTML = `<span class="k">成就达成</span><b>${esc(a.name)}</b><span class="s">${esc(a.desc)} · +${a.coins} 铜钱${a.title ? ` · 称号「${esc(a.title)}」` : ''}</span>`;
    this.root.appendChild(el);
    setTimeout(() => el.classList.add('out'), 2700);
    setTimeout(() => {
      el.remove();
      this.next();
    }, 3100);
  }
}
