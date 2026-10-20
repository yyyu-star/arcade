/**
 * 弹窗：确认框、结算、规则。同一时间只显示一个；打开时把 kit 的好玩图层藏起来（它在舞台外面，z-index 夹不到中间，见 kit README）。
 * 结算是"压着的"（sticky）：结算开着时再开别的（规则、确认框），结算先藏着，那个关了结算再出来——
 * 结算弹窗不挡顶栏（DESIGN.md 8"结算"），顶栏的"规则""离开"点得到。
 */
import { button, el } from './dom.ts';

let current: HTMLElement | null = null;
/** 被别的弹窗压在下面的结算 */
let parked: HTMLElement | null = null;
let hooks: { open(): void; close(): void } = { open() {}, close() {} };

export function dialogHooks(h: { open(): void; close(): void }): void {
  hooks = h;
}

export function closeDialog(): void {
  if (!current) return;
  current.remove();
  current = null;
  if (parked) {
    current = parked;
    parked = null;
    current.hidden = false;
    return;
  }
  hooks.close();
}

/** 换页面时：连压着的结算一起关掉 */
export function closeAllDialogs(): void {
  parked?.remove();
  parked = null;
  closeDialog();
}

/** 开一个弹窗，内容由 fill 画；返回内容盒子。sticky 的（结算）被后开的弹窗压着，那个关了再出来 */
export function dialog(parent: HTMLElement, cls: string, fill: (box: HTMLElement) => void, closable = true, sticky = false): HTMLElement {
  if (current?.dataset.sticky && !sticky) {
    parked?.remove();
    parked = current;
    parked.hidden = true;
    current = null;
  } else closeDialog();
  const mask = el('div', `mask ${cls}`, parent);
  if (sticky) mask.dataset.sticky = '1';
  const box = el('div', 'dialog', mask);
  if (closable) {
    button('x', box, '×', closeDialog);
    mask.addEventListener('click', (e) => e.target === mask && closeDialog());
  }
  fill(box);
  current = mask;
  hooks.open();
  return box;
}

export function confirmBox(parent: HTMLElement, text: string, yes: string, no: string): Promise<boolean> {
  return new Promise((resolve) => {
    dialog(
      parent,
      'confirm',
      (box) => {
        el('p', '', box, text);
        const row = el('div', 'row', box);
        button('act soft', row, no, () => {
          closeDialog();
          resolve(false);
        });
        button('act go', row, yes, () => {
          closeDialog();
          resolve(true);
        });
      },
      false,
    );
  });
}
