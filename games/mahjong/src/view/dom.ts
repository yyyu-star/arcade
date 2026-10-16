/** 建 DOM 的小工具 */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', parent?: HTMLElement | null, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

export function button(cls: string, parent: HTMLElement, text: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', cls, parent, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/**
 * 按钮发请求时显示"加载中"（样式见 style.css 的 aria-busy）：禁用、转圈，请求回来（成功失败都算）再放开。
 * 转着的时候再点不会发第二次
 */
export async function busy(b: HTMLButtonElement, task: () => Promise<unknown>): Promise<void> {
  if (b.getAttribute('aria-busy') === 'true') return;
  b.disabled = true;
  b.setAttribute('aria-busy', 'true');
  try {
    await task();
  } finally {
    b.disabled = false;
    b.removeAttribute('aria-busy');
  }
}

export function clear(e: HTMLElement): void {
  e.replaceChildren();
}
