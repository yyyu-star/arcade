/**
 * 屏幕上的横幅和提示层（DOM）：精英 / 尸王出场的预警条、里程碑（100 / 500 / 1000 杀）、宝箱和进化的演出、低血红框、天亮。
 * 宝箱和进化演出 ≤ 2 秒、点一下就跳过（手感清单第 6 条）。
 */
import './banner.css';

export class Banners {
  private readonly root: HTMLDivElement;
  private readonly low: HTMLDivElement;
  private readonly flash: HTMLDivElement;
  private readonly bossBar: HTMLDivElement;
  private readonly bossFill: HTMLElement;
  private showTimer: ReturnType<typeof setTimeout> | null = null;
  private skip: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'yx-banners';
    parent.appendChild(this.root);
    this.low = document.createElement('div');
    this.low.className = 'yx-lowhp';
    parent.appendChild(this.low);
    this.flash = document.createElement('div');
    this.flash.className = 'yx-flash';
    parent.appendChild(this.flash);
    this.bossBar = document.createElement('div');
    this.bossBar.className = 'yx-bossbar';
    this.bossBar.innerHTML = '<span>尸王</span><div><b></b></div>';
    this.bossFill = this.bossBar.querySelector('b')!;
    this.bossBar.style.display = 'none';
    parent.appendChild(this.bossBar);
  }

  /** 收起所有横幅、血条和红框（结算、重开时） */
  clear(): void {
    this.root.innerHTML = '';
    this.setLow(false);
    this.setBoss(null);
  }

  /** 一行横幅，几秒后自己收起；kind 决定配色 */
  say(text: string, kind: 'warn' | 'gold' | 'ink' = 'ink', ms = 1800, sub?: string): void {
    const el = document.createElement('div');
    el.className = `yx-banner ${kind}`;
    el.innerHTML = `<span class="t">${text}</span>${sub ? `<span class="s">${sub}</span>` : ''}`;
    this.root.appendChild(el);
    setTimeout(() => el.classList.add('out'), ms);
    setTimeout(() => el.remove(), ms + 400);
  }

  /** 宝箱 / 进化演出：图标 + 名字，全屏闪一下（进化），≤ 2 秒或点一下结束，结束时回调 */
  reveal(icon: string, title: string, sub: string, evolve: boolean, done: () => void): void {
    this.endReveal();
    const el = document.createElement('div');
    el.className = `yx-reveal${evolve ? ' evolve' : ''}`;
    el.innerHTML = `<div class="rays"></div><img alt="" src="${icon}"><span class="t">${title}</span><span class="s">${sub}</span><span class="k">点一下继续</span>`;
    this.root.appendChild(el);
    if (evolve) this.whiteFlash();
    const finish = (): void => {
      if (this.skip !== finish) return;
      this.skip = null;
      if (this.showTimer) clearTimeout(this.showTimer);
      el.classList.add('out');
      setTimeout(() => el.remove(), 200);
      done();
    };
    this.skip = finish;
    el.addEventListener('pointerdown', finish);
    this.showTimer = setTimeout(finish, evolve ? 1900 : 1300);
  }

  /** 演出中按任意键也跳过 */
  skipReveal(): boolean {
    if (!this.skip) return false;
    this.skip();
    return true;
  }

  private endReveal(): void {
    this.skip?.();
  }

  whiteFlash(): void {
    this.flash.classList.remove('on');
    void this.flash.offsetWidth;
    this.flash.classList.add('on');
  }

  setLow(on: boolean): void {
    this.low.classList.toggle('on', on);
  }

  setBoss(name: string | null, frac = 1): void {
    if (name === null) {
      this.bossBar.style.display = 'none';
      return;
    }
    this.bossBar.style.display = '';
    this.bossBar.querySelector('span')!.textContent = name;
    this.bossFill.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  }
}
