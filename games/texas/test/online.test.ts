/**
 * 好友房页面一侧的帧播放（src/online.ts）：切回前台、重连追上最新状态时不重播旧操作，也不会先摆新的再摆旧的。
 * 用假 WebSocket 喂房间消息，假的 ui 记每次 play 的 prev / next。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Online, type OnlineUi } from '../src/online.ts';
import type { RoomView } from '../src/room/rules.ts';

type Handler = ((ev: { data: string }) => void) | null;
class FakeWs {
  static last: FakeWs;
  readyState = 1;
  onopen: (() => void) | null = null;
  onmessage: Handler = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly url: string;
  constructor(url: string) {
    this.url = url;
    FakeWs.last = this;
    queueMicrotask(() => this.onopen?.());
  }
  send(): void {}
  close(): void {}
  push(m: unknown): void {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
}

const view = (n: number): RoomView => ({ n }) as unknown as RoomView;
const room = { status: 'playing', seats: [], opts: {} };
const you = { seat: 0, bound: 0 };
const flush = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe('Online 帧播放', () => {
  let hiddenNow = false;
  const listeners: (() => void)[] = [];
  let calls: [number | null, number][];
  let gates: (() => void)[];
  let skips: boolean[];
  let online: Online;

  const ui: OnlineUi = {
    draw: () => {},
    // 每一步都卡在门上，测试按需放行（模拟动画在播）
    play: (prev, next) => {
      calls.push([prev ? (prev as unknown as { n: number }).n : null, (next as unknown as { n: number }).n]);
      return new Promise((ok) => gates.push(ok));
    },
    toast: () => {},
    emote: () => {},
    chat: () => {},
    chatError: () => {},
    ended: () => {},
    wait: () => Promise.resolve(),
    skip: (on) => skips.push(on),
  };
  const release = async (): Promise<void> => {
    while (gates.length) {
      gates.shift()!();
      await flush();
    }
  };
  const setHidden = (h: boolean): void => {
    hiddenNow = h;
    for (const l of listeners) l();
  };

  beforeEach(() => {
    calls = [];
    gates = [];
    skips = [];
    hiddenNow = false;
    listeners.length = 0;
    vi.stubGlobal('WebSocket', FakeWs);
    vi.stubGlobal('location', { href: 'http://localhost/games/texas/' });
    vi.stubGlobal('document', {
      get hidden() {
        return hiddenNow;
      },
      addEventListener: (t: string, f: () => void) => t === 'visibilitychange' && listeners.push(f),
      removeEventListener: () => {},
    });
    vi.stubGlobal('window', { addEventListener: () => {}, removeEventListener: () => {} });
    online = new Online({ code: '123456', userId: null, host: true, at: 0 }, ui);
  });
  afterEach(() => {
    online.close();
    vi.unstubAllGlobals();
  });

  const welcome = (seq: number) => ({ t: 'welcome', seq, room, you, view: view(seq), now: 0 });
  const state = (seq: number, ns: number[]) => ({ t: 'state', seq, room, you, frames: ns.map((n) => ({ view: view(n), delay: 1600 })), now: 0 });

  it('后台时落下的几帧，切回前台直接摆最新的，不一帧一帧重播', async () => {
    await flush();
    FakeWs.last.push(welcome(1));
    await flush();
    await release();
    // 第一帧正在播（动画卡着），后台时又来了 4 帧（没超过 MAX_BACKLOG，原来会一帧一帧播完）
    FakeWs.last.push(state(2, [2]));
    await flush();
    setHidden(true);
    FakeWs.last.push(state(6, [3, 4, 5, 6]));
    await flush();
    setHidden(false);
    await release();
    await release();
    const replayed = calls.filter(([prev, next]) => prev !== null && next > 2);
    expect(replayed).toEqual([]);
    expect(calls.at(-1)).toEqual([null, 6]);
    expect(skips).toContain(true);
  });

  it('重连拿到比已经摆出的更旧的快照，不倒退', async () => {
    await flush();
    FakeWs.last.push(welcome(10));
    await flush();
    await release();
    FakeWs.last.push(welcome(4));
    await flush();
    await release();
    expect(calls.map((c) => c[1])).toEqual([10]);
  });

  it('重连的快照盖过还没播的帧：正在播的那一步瞬间走完，再直接摆快照', async () => {
    await flush();
    FakeWs.last.push(welcome(1));
    await flush();
    await release();
    FakeWs.last.push(state(3, [2, 3]));
    await flush();
    FakeWs.last.push(welcome(9));
    await flush();
    await release();
    await release();
    expect(calls.at(-1)).toEqual([null, 9]);
    expect(calls.filter((c) => c[1] === 3)).toEqual([]);
    expect(skips).toContain(true);
  });
});
