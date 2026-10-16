/** 弹窗：确认离开、补码、新手提示。同一时间只有一个，点遮罩等于取消（sticky 的不理遮罩，只认按钮）。 */
import { el } from './dom.ts';
import { chips } from './text.ts';

export interface Choice {
  label: string;
  value: string;
  primary?: boolean;
}

let open: { root: HTMLElement; done: (v: string | null) => void } | null = null;

export function closeDialog(): void {
  open?.done(null);
}

export function dialog(parent: HTMLElement, title: string, body: string | HTMLElement, choices: Choice[], sticky = false): Promise<string | null> {
  closeDialog();
  return new Promise((resolve) => {
    const mask = el('div', 'mask', parent);
    const box = el('div', 'dialog', mask);
    box.setAttribute('role', 'dialog');
    el('div', 'd-title', box, title);
    const b = el('div', 'd-body', box);
    if (typeof body === 'string') b.textContent = body;
    else b.appendChild(body);
    const row = el('div', 'd-buttons', box);
    const done = (v: string | null): void => {
      if (open?.root === mask) open = null;
      mask.remove();
      document.body.classList.toggle('texas-dialog', open !== null);
      resolve(v);
    };
    for (const c of choices) {
      const btn = el('button', c.primary ? 'd-btn primary' : 'd-btn', row, c.label);
      btn.type = 'button';
      btn.addEventListener('click', () => done(c.value));
    }
    mask.addEventListener('click', (e) => {
      if (e.target === mask && !sticky) done(null);
    });
    open = { root: mask, done };
    // 好友房的道具动画层（kit fun，挂在 body 上、压在整个牌桌上面）：弹窗开着时收起，不压确认框（0.3.0）
    document.body.classList.add('texas-dialog');
    (row.querySelector('.primary') as HTMLElement | null)?.focus();
  });
}

/** 补码：选补多少（默认补满），返回 null 是不补 */
export async function askTopUp(parent: HTMLElement, opts: { min: number; max: number; step: number; balance: number; busted: boolean }): Promise<number | null> {
  const wrap = document.createElement('div');
  wrap.className = 'topup';
  const line = el('div', 'topup-line', wrap);
  const slider = el('input', 'slider', line);
  slider.type = 'range';
  slider.min = String(opts.min);
  slider.max = String(opts.max);
  slider.step = String(opts.step);
  slider.value = String(opts.max);
  const amt = el('span', 'buy-amt', line, chips(opts.max));
  slider.addEventListener('input', () => {
    amt.textContent = chips(Number(slider.value));
  });
  el('div', 'topup-note', wrap, `钱包里还有 ${chips(opts.balance)}`);
  // 输光了的时候"不补"就是离桌结算：不让点到遮罩就走了（0.3.5），只认按钮
  const v = await dialog(
    parent,
    opts.busted ? '筹码输光了' : '补码',
    wrap,
    [
      { label: opts.busted ? '离桌' : '算了', value: 'no' },
      { label: '补上', value: 'yes', primary: true },
    ],
    opts.busted,
  );
  return v === 'yes' ? Number(slider.value) : null;
}
