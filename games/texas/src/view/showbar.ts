/**
 * 主动亮牌（0.19.0）：一手打完、两手之间那一栏前面的一小块，摆着我刚才的两张牌，点哪张亮哪张，"都亮"两张一起。
 * 只给 5 秒（SHOW_MS）：单机从这一栏出来算，好友房从房间停顿开始算（停顿 7 秒，前 5 秒能亮）。
 * 服务端（好友房）允许整个停顿期间亮，5 秒只是页面给的节奏（主线 2026-10-17，DESIGN.md 8.12）。
 */
import type { Card } from '../core/cards.ts';
import { makeCard, setCard } from './art.ts';
import { el, toggle } from './dom.ts';

export const SHOW_MS = 5_000;

export class ShowBar {
  readonly root: HTMLDivElement;
  private readonly cards: HTMLButtonElement[] = [];
  private readonly both: HTMLButtonElement;
  private timer = 0;
  /** 现在摆着的是哪一手、到几点为止（同一手重画不重新计时） */
  private key = '';

  constructor(parent: HTMLElement, onShow: (cards: number[]) => void) {
    this.root = el('div', 'show-cards hidden', parent);
    parent.prepend(this.root);
    el('span', 'sc-label', this.root, '亮牌');
    for (let k = 0; k < 2; k++) {
      const b = el('button', 'sc-card', this.root);
      b.type = 'button';
      b.appendChild(makeCard('small'));
      b.addEventListener('click', () => onShow([k]));
      this.cards.push(b);
    }
    this.both = el('button', 'sc-both', this.root, '都亮');
    this.both.type = 'button';
    this.both.addEventListener('click', () => onShow([0, 1]));
  }

  /**
   * kept：我刚才的两张（不能亮时不给）；shown：已经亮了的那几张；key：哪一手（换手重新计时）；until：到几点不能亮（null 是从现在起 SHOW_MS）
   */
  draw(kept: readonly Card[] | undefined, shown: readonly Card[], key: string, until: number | null = null): void {
    if (!kept || kept.length !== 2 || shown.length >= 2) return this.hide();
    if (key !== this.key) {
      this.key = key;
      window.clearTimeout(this.timer);
      const end = until ?? Date.now() + SHOW_MS;
      if (end <= Date.now()) return this.hide();
      this.timer = window.setTimeout(() => this.hide(), end - Date.now());
    } else if (!this.timer) return;
    toggle(this.root, 'hidden', false);
    kept.forEach((c, k) => {
      const b = this.cards[k]!;
      setCard(b.firstElementChild as HTMLElement, c);
      b.disabled = shown.includes(c);
      b.setAttribute('aria-label', `亮这张：${b.firstElementChild!.getAttribute('aria-label')}`);
    });
    toggle(this.both, 'hidden', shown.length > 0);
  }

  hide(): void {
    window.clearTimeout(this.timer);
    this.timer = 0;
    toggle(this.root, 'hidden', true);
  }
}
