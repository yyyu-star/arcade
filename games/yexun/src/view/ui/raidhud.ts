/**
 * 夜探专用的 HUD 部件（DOM + 一张小地图画布）：
 * - 目标条：开着的门"东门 · 12 秒"，没有门开时"北门 48 秒后开"；天亮前最后阶段再加一行后果（红）；
 * - 背包面板：点背包（电脑上悬停）展开，每件一个图标 + 档位色边 + 名字 + 价值；
 * - 小地图：左下角、半透明、不拦点击：院子、河、宝箱（没开的）、门、守卫、自己。
 * 由 GameScene 每帧喂数据（字符串、签名没变就不碰 DOM）。规则一概不在这里算。
 */
import './raidhud.css';
import { TIER_INFO, TREASURES } from '../../content/treasures.ts';
import type { RaidMap } from '../../explore/mapgen.ts';
import { treasureIconKey } from '../art/sprites8.ts';

export interface RaidHudState {
  /** 开着的最近一座门：名字、走过去几秒；没有开着的是 null */
  gate: { name: string; secs: number } | null;
  /** 没有门开时，下一批门的名字和几秒后开（全开完了是 null） */
  next: { names: string; secs: number } | null;
  /** 0 平时，1 14:00 起，2 最后 30 秒 */
  level: 0 | 1 | 2;
  teach: boolean;
  /** 背包里的宝物编号 */
  bag: readonly number[];
  /** 小地图要的动态数据：主角位置、没开的宝箱下标、开着的门、守卫位置（x, y 交替） */
  hx: number;
  hy: number;
  chestOpen: Uint8Array;
  gateOpen: Uint8Array;
  guards: number[];
}

const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent.appendChild(e);
  return e;
};

export class RaidHud {
  private readonly strip: HTMLDivElement;
  private readonly line1: HTMLDivElement;
  private readonly line2: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  private readonly mm: HTMLCanvasElement;
  private readonly mmCtx: CanvasRenderingContext2D;
  private readonly mmBase: HTMLCanvasElement;
  private readonly map: RaidMap;
  private readonly icons: (key: string, px?: number) => string;
  private readonly btn: HTMLElement;
  private bagSig = '';
  private last = { l1: '', l2: '', cls: '' };
  private frame = 0;
  private readonly boss = document.querySelector<HTMLElement>('.yx-bossbar');
  private readonly off: () => void;

  constructor(root: HTMLElement, bagBtn: HTMLElement, icons: (key: string, px?: number) => string, map: RaidMap) {
    this.map = map;
    this.icons = icons;
    this.btn = bagBtn;
    this.strip = el('div', 'yx-rs', root);
    this.line1 = el('div', 'yx-rs-1', this.strip);
    this.line2 = el('div', 'yx-rs-2', this.strip);
    this.panel = el('div', 'yx-bagpanel', root);
    this.panel.style.display = 'none';
    // 小地图：画布按 2 倍画（手机高清屏不糊），CSS 大小在样式里
    this.mm = el('canvas', 'yx-mm', root);
    this.mm.width = 240;
    this.mm.height = 240;
    this.mmCtx = this.mm.getContext('2d')!;
    this.mmBase = document.createElement('canvas');
    this.mmBase.width = 240;
    this.mmBase.height = 240;
    this.drawBase();
    // 背包：点一下开关；电脑上悬停也看得到；点别处收起
    const toggle = (): void => {
      this.panel.style.display = this.panel.style.display === 'none' ? '' : 'none';
    };
    const onDown = (e: PointerEvent): void => {
      if (this.panel.style.display === 'none') return;
      const t = e.target as Node;
      if (!this.panel.contains(t) && !bagBtn.contains(t)) this.panel.style.display = 'none';
    };
    const enter = (): void => {
      if (window.matchMedia('(hover: hover)').matches) this.panel.style.display = '';
    };
    const leave = (): void => {
      if (window.matchMedia('(hover: hover)').matches) this.panel.style.display = 'none';
    };
    bagBtn.addEventListener('click', toggle);
    bagBtn.addEventListener('mouseenter', enter);
    bagBtn.addEventListener('mouseleave', leave);
    document.addEventListener('pointerdown', onDown);
    // HUD 是整场共用的，这一局结束要把挂在背包按钮上的监听拿掉
    this.off = () => {
      document.removeEventListener('pointerdown', onDown);
      bagBtn.removeEventListener('click', toggle);
      bagBtn.removeEventListener('mouseenter', enter);
      bagBtn.removeEventListener('mouseleave', leave);
    };
  }

  destroy(): void {
    this.off();
    this.strip.remove();
    this.panel.remove();
    this.mm.remove();
  }

  /** 小地图底图：院子、河、台阶墙，画一次 */
  private drawBase(): void {
    const c = this.mmBase.getContext('2d')!;
    const k = 240 / this.map.size;
    c.fillStyle = '#26304a';
    c.fillRect(0, 0, 240, 240);
    const col: Record<string, string> = { yard: '#4b5a78', plaza: '#5a6a86', ruin: '#39435c', temple: '#8a4a42', vault: '#5a5f8a' };
    for (const y of this.map.yards) {
      c.fillStyle = col[y.kind] ?? '#4b5a78';
      c.fillRect(y.x * k, y.y * k, y.w * k, y.h * k);
    }
    for (const b of this.map.blocks) {
      if (b.look === 'river') {
        c.fillStyle = '#2f78b0';
        c.fillRect(b.x * k, b.y * k, Math.max(1, b.w * k), Math.max(1, b.h * k));
      } else if (b.look === 'terrace') {
        c.fillStyle = '#b7c0cf';
        c.fillRect(b.x * k, b.y * k - 1, Math.max(1, b.w * k), 3);
      }
    }
    c.strokeStyle = 'rgba(246,239,220,0.85)';
    c.lineWidth = 3;
    c.strokeRect(1.5, 1.5, 237, 237);
  }

  private drawMap(s: RaidHudState): void {
    const c = this.mmCtx;
    const k = 240 / this.map.size;
    c.drawImage(this.mmBase, 0, 0);
    const dot = (x: number, y: number, r: number, fill: string): void => {
      c.beginPath();
      c.arc(x * k, y * k, r, 0, Math.PI * 2);
      c.fillStyle = fill;
      c.fill();
      c.lineWidth = 1.6;
      c.strokeStyle = '#17131c';
      c.stroke();
    };
    this.map.chests.forEach((ch, i) => {
      if (s.chestOpen[i] === 1) return;
      dot(ch.x, ch.y, ch.tier === 'gold' ? 5 : 4, ch.tier === 'gold' ? '#ffd23a' : ch.tier === 'copper' ? '#ff9a3a' : '#e8dcc0');
    });
    for (let i = 0; i + 1 < s.guards.length; i += 2) dot(s.guards[i]!, s.guards[i + 1]!, 4.2, '#e0322e');
    this.map.gates.forEach((g, i) => {
      const open = s.gateOpen[i] === 1;
      c.save();
      c.translate(g.x * k, g.y * k);
      c.rotate(Math.PI / 4);
      c.fillStyle = open ? '#fff0a0' : '#7a8296';
      c.strokeStyle = '#17131c';
      c.lineWidth = 1.8;
      const r = open ? 7 : 5.5;
      c.fillRect(-r, -r, r * 2, r * 2);
      c.strokeRect(-r, -r, r * 2, r * 2);
      c.restore();
    });
    dot(s.hx, s.hy, 5.6, '#ffffff');
    c.beginPath();
    c.arc(s.hx * k, s.hy * k, 9.5, 0, Math.PI * 2);
    c.strokeStyle = 'rgba(255,255,255,0.7)';
    c.lineWidth = 2;
    c.stroke();
  }

  update(s: RaidHudState): void {
    // 目标条
    let l1: string;
    let tone: string;
    if (s.gate) {
      l1 = `撤离 · ${s.gate.name} · ${s.gate.secs} 秒`;
      tone = 'go';
    } else if (s.next) {
      l1 = `门还没开 · ${s.next.names} ${s.next.secs} 秒后开`;
      tone = 'wait';
    } else {
      l1 = '门都关了';
      tone = 'wait';
    }
    // 教学镇一直挂着名字：玩家要知道这是练手的小镇子，不是正式的
    const l2 = s.teach ? '教学镇 · 没撤出去也不丢背包' : s.level === 0 ? '' : s.level === 2 ? '天亮还没撤出，背包全丢' : '天亮前撤出，不然背包全丢';
    // 石兽的血条在同一个位置：它在的时候目标条往下让一格
    const lower = this.boss !== null && this.boss.style.display !== 'none';
    const cls = `yx-rs ${tone}${lower ? ' lower' : ''}${s.level === 2 ? ' red' : s.level === 1 ? ' warn' : ''}`;
    if (cls !== this.last.cls) {
      this.last.cls = cls;
      this.strip.className = cls;
    }
    if (l1 !== this.last.l1) {
      this.last.l1 = l1;
      this.line1.textContent = l1;
    }
    if (l2 !== this.last.l2) {
      this.last.l2 = l2;
      this.line2.textContent = l2;
      this.line2.style.display = l2 ? '' : 'none';
    }
    // 背包面板
    const sig = s.bag.join(',');
    if (sig !== this.bagSig) {
      this.bagSig = sig;
      let total = 0;
      const rows = s.bag
        .map((id) => {
          const t = TREASURES[id]!;
          total += t.value;
          return `<div class="it" style="--tc:${hex(TIER_INFO[t.tier].color)}"><img alt="" src="${this.icons(treasureIconKey(t.icon), 48)}"><span class="n">${t.name}</span><span class="v">${t.value}</span><i>${TIER_INFO[t.tier].name}</i></div>`;
        })
        .join('');
      this.panel.innerHTML = `<div class="hd">背包 ${s.bag.length} 件 · 共 ${total} 铜钱</div>${rows || '<div class="empty">还没有宝物。打开宝箱，把东西带出门。</div>'}`;
      this.btn.dataset.value = String(total);
    }
    // 小地图：每 6 帧重画
    if (this.frame++ % 6 === 0) this.drawMap(s);
  }
}
