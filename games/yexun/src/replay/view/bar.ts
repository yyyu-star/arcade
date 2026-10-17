/**
 * 回放时盖在画面底部的控制条：暂停 / 继续、1× 2× 4×、进度、退出。
 * 主代理接：`const bar = new ReplayBar(root, player, { onExit })`，每帧 `player.advance(dt); bar.update()`。
 */
import { OUTDATED_TEXT } from '../describe.ts';
import type { ReplayPlayer, Speed } from '../player.ts';
import './replay.css';

export class ReplayBar {
  private readonly root: HTMLDivElement;
  private readonly pause: HTMLButtonElement;
  private readonly speeds = new Map<Speed, HTMLButtonElement>();
  private readonly fill: HTMLElement;
  private readonly tail: HTMLElement;

  private readonly player: ReplayPlayer;

  constructor(parent: HTMLElement, player: ReplayPlayer, opts: { onExit(): void }) {
    this.player = player;
    this.root = document.createElement('div');
    this.root.className = 'yx-replaybar';
    this.pause = btn('暂停', () => {
      player.paused = !player.paused;
      this.update();
    });
    this.root.appendChild(this.pause);
    for (const s of [1, 2, 4] as const) {
      const b = btn(`${s}×`, () => {
        player.speed = s;
        this.update();
      });
      this.speeds.set(s, b);
      this.root.appendChild(b);
    }
    const bar = document.createElement('div');
    bar.className = 'bar';
    this.fill = document.createElement('i');
    bar.appendChild(this.fill);
    this.tail = document.createElement('span');
    this.root.append(bar, this.tail, btn('退出', opts.onExit));
    parent.appendChild(this.root);
    this.update();
  }

  /** 每帧或状态变了调；只改变了的才写 DOM */
  update(): void {
    const p = this.player;
    set(this.pause, p.paused ? '继续' : '暂停');
    for (const [s, b] of this.speeds) b.classList.toggle('on', p.speed === s);
    const w = `${Math.round(p.progress * 100)}%`;
    if (this.fill.style.width !== w) this.fill.style.width = w;
    const t = p.done ? (p.exact === false ? '放歪了（规则变过）' : '放完了') : p.outdated ? OUTDATED_TEXT : '';
    this.tail.className = p.outdated || p.exact === false ? 'warn' : '';
    set(this.tail, t);
  }

  destroy(): void {
    this.root.remove();
  }
}

function btn(text: string, on: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.onclick = on;
  return b;
}

function set(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
