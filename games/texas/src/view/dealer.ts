/**
 * 荷官（0.18.3，docs/art-v3.md 第 8 节主线拍板）：程序画的半身像，站在桌子顶边后面（下半身被桌边挡住），
 * 发牌时抬手（.dealing），平时隔几秒眨一下眼。竖屏、7–9 人桌没地方站、顶栏挡着就不出现（layout.ts 的 dealerSpots、table.ts 的 placeCroupier）。
 * 动画只动 transform；省内存（.lowfx）、减少动态效果时不眨眼、不抬手。名字不登记：荷官不说话，不是电脑人物。
 */
import { el } from './dom.ts';

/** viewBox 0 0 80 96：头顶在 4，桌边大约压在 78（腰） */
const SVG =
  '<svg viewBox="0 0 80 96" aria-hidden="true">' +
  // 身子：白衬衫、黑马甲、红领结
  '<path d="M10 96 C10 70 22 60 40 60 C58 60 70 70 70 96 Z" fill="#141b17"/>' +
  '<path d="M33 60 L40 78 L47 60 Z" fill="#f4efe1"/>' +
  '<path d="M33 62 L40 66 L33 70 Z M47 62 L40 66 L47 70 Z" fill="#b3262c"/>' +
  '<circle cx="40" cy="66" r="2" fill="#7a1418"/>' +
  '<path d="M26 64 L34 96 M54 64 L46 96" stroke="#c9973a" stroke-width="1.2" opacity=".6"/>' +
  // 左手放在桌边上
  '<path d="M14 82 Q12 74 18 70 L22 72 Q18 78 20 84 Z" fill="#141b17"/>' +
  '<ellipse cx="21" cy="86" rx="6" ry="4" fill="#f0c9a2"/>' +
  // 右手（发牌那只）：绕肩膀转起来
  '<g class="arm"><path d="M66 82 Q68 74 62 70 L58 72 Q62 78 60 84 Z" fill="#141b17"/>' +
  '<ellipse cx="59" cy="86" rx="6" ry="4" fill="#f0c9a2"/>' +
  '<rect x="54" y="82" width="9" height="12" rx="1.5" fill="#a8232b" stroke="#e4b858" stroke-width=".8" transform="rotate(-12 58 88)"/></g>' +
  // 头：脸、梳得服帖的头发、耳朵
  '<rect x="35" y="50" width="10" height="11" fill="#e3b58e"/>' +
  '<ellipse cx="25.5" cy="36" rx="3" ry="4.5" fill="#e3b58e"/><ellipse cx="54.5" cy="36" rx="3" ry="4.5" fill="#e3b58e"/>' +
  '<ellipse cx="40" cy="34" rx="15" ry="18" fill="#f0c9a2"/>' +
  '<path d="M24.5 32 C24 14 34 10 41 10 C50 10 57 15 55.5 32 C53 22 46 19 38 20 C31 21 27 24 24.5 32 Z" fill="#20170f"/>' +
  '<path d="M36 13 Q44 11 50 17" stroke="#4a3626" stroke-width="1.4" fill="none"/>' +
  // 眉、眼（眨眼动眼皮）、胡子、笑
  '<path d="M30 28 Q34 26 37 28 M43 28 Q46 26 50 28" stroke="#20170f" stroke-width="1.4" fill="none" stroke-linecap="round"/>' +
  '<g class="eyes"><ellipse cx="34" cy="33" rx="2" ry="2.4" fill="#20170f"/><ellipse cx="46" cy="33" rx="2" ry="2.4" fill="#20170f"/></g>' +
  '<path d="M33 43 Q40 40 47 43 Q40 45 33 43 Z" fill="#20170f"/>' +
  '<path d="M35 46.5 Q40 49.5 45 46.5" stroke="#9c4a3a" stroke-width="1.3" fill="none" stroke-linecap="round"/>' +
  '</svg>';

export class Dealer {
  readonly root: HTMLDivElement;
  private timer = 0;

  /** before：放在它前面（桌子），桌边就压在荷官的腰上 */
  constructor(parent: HTMLElement, before: Element) {
    this.root = el('div', 'dealer-guy hidden');
    this.root.innerHTML = SVG;
    parent.insertBefore(this.root, before);
  }

  /** 摆到桌边上的点（null：这桌没地方站） */
  place(p: { x: number; y: number } | null): void {
    this.root.classList.toggle('hidden', !p);
    if (p) {
      this.root.style.left = `${p.x}px`;
      this.root.style.top = `${p.y}px`;
    }
  }

  visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  /** 发牌：手抬起来，ms 以后放下（连着发就一直抬着） */
  deal(ms: number): void {
    this.root.classList.add('dealing');
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.root.classList.remove('dealing'), Math.max(200, ms));
  }
}
