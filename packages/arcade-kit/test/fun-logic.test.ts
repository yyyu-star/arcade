/**
 * 牌桌互动的规则（0.11.0）：冷却、护盾、连击、回敬、电脑反应、菜单放哪、编号。
 * 都是纯函数和小类，时间和随机数由测试给：概率用带种子的 mulberry32 跑几千次看比例（固定种子，所以结果可复现、不会偶发失败），
 * 需要"一定触发"的地方用脚本化的随机数，避免靠碰运气。
 */
import { describe, expect, it } from 'vitest';
import {
  placeBubble,
  DANMAKU,
  barBottom,
  chatFont,
  chatMode,
  danmakuLanes,
  danmakuSpeed,
  pickLane,
  placeBeside,
  placeDock,
  seatColor,
  BOT_REACT,
  COUNTER,
  FUN_TIMING,
  FunCooldown,
  FunTally,
  botEmoteIds,
  botReact,
  funIdCount,
  hitEvent,
  stickerMood,
  PROPS,
  STICKERS,
  funItem,
  newBotState,
  fitMenuWidth,
  placeMenu,
  propId,
  stickerId,
  type Box,
  type BotAction,
  type FunBot,
  type FunEvent,
  type FunTemper,
} from '../src/fun-logic.ts';

/** 固定种子的随机数，让比例测试每次一样 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 按顺序吐出给定的值，用完后一直吐最后一个：精确控制"先掷哪个骰子" */
const script =
  (...xs: number[]) =>
  () =>
    xs.length > 1 ? xs.shift()! : xs[0]!;
const zero = (): number => 0;

const N = 2000;
const TOL = 0.04;
const T0 = 100_000;

describe('FunCooldown', () => {
  it('道具 1500 毫秒、表情短语 1000 毫秒，各算各的', () => {
    const c = new FunCooldown();
    expect(c.total('prop')).toBe(1500);
    expect(c.total('talk')).toBe(1000);
    expect(c.take('prop', 0)).toBe(true);
    // 道具在冷却，不影响说话
    expect(c.take('talk', 10)).toBe(true);
    expect(c.take('prop', 1499)).toBe(false);
    expect(c.take('talk', 1009)).toBe(false);
    expect(c.take('talk', 1010)).toBe(true);
    expect(c.take('prop', 1500)).toBe(true);
  });

  it('冷却中被拒不重置计时：照原来的点放行', () => {
    const c = new FunCooldown();
    c.take('prop', 0);
    // 要是被拒也记下，1400 那次会把冷却顶到 2900，1500 就放不了
    expect(c.take('prop', 1400)).toBe(false);
    expect(c.take('prop', 1500)).toBe(true);
  });

  it('left 倒数到 0，没发过时是 0', () => {
    const c = new FunCooldown();
    expect(c.left('prop', 5)).toBe(0);
    c.take('prop', 1000);
    expect(c.left('prop', 1000)).toBe(1500);
    expect(c.left('prop', 1600)).toBe(900);
    expect(c.left('prop', 2500)).toBe(0);
    expect(c.left('prop', 99_999)).toBe(0);
  });

  it('可以自定义毫秒数', () => {
    const c = new FunCooldown({ prop: 200, talk: 50 });
    expect(c.total('prop')).toBe(200);
    c.take('prop', 0);
    c.take('talk', 0);
    expect(c.left('prop', 100)).toBe(100);
    expect(c.take('prop', 199)).toBe(false);
    expect(c.take('prop', 200)).toBe(true);
    expect(c.take('talk', 50)).toBe(true);
  });
});

describe('FunTally', () => {
  it('连击要连续扔同一个人：中途换了目标就断，回来从 ×1 算', () => {
    const t = new FunTally();
    expect(t.hit(1, 0, 0).combo).toBe(1);
    expect(t.hit(1, 2, 500).combo).toBe(1);
    expect(t.hit(1, 0, 1000).combo).toBe(1);
    expect(t.hit(1, 0, 1500).combo).toBe(2);
  });
  it('同一个人 10 秒内被扔到第 7 下亮护盾，且不计入', () => {
    const t = new FunTally();
    for (let i = 0; i < 6; i++) expect(t.hit(1, 0, i * 100).shield).toBe(false);
    expect(t.hit(1, 0, 600).shield).toBe(true);
    expect(t.hit(2, 0, 700).shield).toBe(true);
    // 被护盾挡掉的不记：最早的一下（t=0）出窗后，名额只多出一个而不是被挡的几下占着
    expect(t.hit(1, 0, FUN_TIMING.shieldWindowMs).shield).toBe(false);
    expect(t.hit(1, 0, FUN_TIMING.shieldWindowMs + 1).shield).toBe(true);
  });

  it('窗口是滑动的：旧的扔出 10 秒就腾出名额', () => {
    const t = new FunTally();
    for (let i = 0; i < 6; i++) t.hit(1, 0, i * 1000); // 0..5000
    expect(t.hit(1, 0, 9999).shield).toBe(true);
    expect(t.hit(1, 0, 10_000).shield).toBe(false); // t=0 那下刚好出窗
    expect(t.hit(1, 0, 10_500).shield).toBe(true); // 窗里又满 6 个（1000..5000 + 10000）
    expect(t.hit(1, 0, 11_000).shield).toBe(false); // t=1000 出窗
  });

  it('护盾按被扔的人分开，别人不受影响', () => {
    const t = new FunTally();
    for (let i = 0; i < 6; i++) t.hit(1, 0, i);
    expect(t.hit(1, 0, 10).shield).toBe(true);
    expect(t.hit(1, 2, 10).shield).toBe(false);
    expect(t.hit(1, 3, 10).shield).toBe(false);
  });

  it('护盾那一下 combo 是 1、revenge 是 false', () => {
    const t = new FunTally();
    for (let i = 0; i < 6; i++) t.hit(1, 0, i);
    expect(t.hit(1, 0, 10)).toEqual({ shield: true, combo: 1, revenge: false });
  });

  it('连击：3 秒内同一个人连扔同一个人，第 2、3 下是 ×2、×3', () => {
    const t = new FunTally();
    expect(t.hit(1, 0, 0).combo).toBe(1);
    expect(t.hit(1, 0, 1000).combo).toBe(2);
    expect(t.hit(1, 0, 2500).combo).toBe(3);
    // 正好隔 3 秒还算连着
    expect(t.hit(1, 0, 5500).combo).toBe(4);
  });

  it('连击：超过 3 秒、或换了目标、换了人就重新数', () => {
    const t = new FunTally();
    t.hit(1, 0, 0);
    expect(t.hit(1, 0, 3001).combo).toBe(1);
    expect(t.hit(1, 2, 3500).combo).toBe(1);
    expect(t.hit(1, 0, 7000).combo).toBe(1); // 隔了 3 秒以上，换目标前的链早断了
    expect(t.hit(3, 0, 7500).combo).toBe(1); // 别人扔同一个目标不算我的连击
    expect(t.hit(1, 0, 8000).combo).toBe(2);
  });

  it('回敬：只有扔回给刚扔过自己的人、且 3 秒内才算', () => {
    const t = new FunTally();
    expect(t.hit(1, 0, 0).revenge).toBe(false);
    expect(t.hit(0, 1, 1000).revenge).toBe(true); // 0 被 1 扔过，扔回 1
    // 0 扔别人不算
    const t2 = new FunTally();
    t2.hit(1, 0, 0);
    expect(t2.hit(0, 2, 500).revenge).toBe(false);
    // 超时不算
    const t3 = new FunTally();
    t3.hit(1, 0, 0);
    expect(t3.hit(0, 1, 3001).revenge).toBe(false);
    // 以"最近一个"为准：2 后来又扔了 0，0 回敬 1 就不算
    const t4 = new FunTally();
    t4.hit(1, 0, 0);
    t4.hit(2, 0, 500);
    expect(t4.hit(0, 1, 1000).revenge).toBe(false);
    expect(t4.hit(0, 2, 1100).revenge).toBe(true);
  });
});

describe('botReact：被扔', () => {
  const hit = (prop?: FunEvent extends infer E ? (E extends { kind: 'hit'; prop?: infer P } ? P : never) : never): FunEvent => ({ kind: 'hit', from: 0, to: 3, ...(prop ? { prop } : {}) });

  function trials(temper: FunTemper, ev: FunEvent = hit('tomato')): BotAction[] {
    const rand = mulberry32(12345);
    const out: BotAction[] = [];
    for (let i = 0; i < N; i++) {
      const a = botReact(ev, { seat: 3, temper }, newBotState(), T0, rand);
      if (a) out.push(a);
    }
    return out;
  }

  it.each([
    ['normal', 0.6],
    ['rowdy', 0.9],
    ['cool', 0.18],
  ] as const)('%s 性格的回应率约 %f', (temper, rate) => {
    expect(Math.abs(trials(temper).length / N - rate)).toBeLessThan(TOL);
  });

  it('回应里约 25% 直接回敬道具，其余只有表情', () => {
    const rs = trials('normal');
    const share = rs.filter((a) => a.prop !== undefined).length / rs.length;
    expect(Math.abs(share - 0.25)).toBeLessThan(TOL);
  });

  it('每个回应都看得见（有表情和情绪）、延迟在区间内、目标是扔的人', () => {
    for (const a of trials('rowdy')) {
      expect(a.sticker).toBeTruthy();
      expect(a.mood).toBeTruthy();
      expect(a.delay).toBeGreaterThanOrEqual(800);
      expect(a.delay).toBeLessThanOrEqual(2000);
      expect(a.to).toBe(0);
      expect(a.from).toBe(3);
    }
  });

  it('回敬的对应：鸡蛋还拖鞋、番茄还番茄，善意的还善意的', () => {
    // 脚本：延迟、要回应（0 < p）、要回敬（0 < 0.25）
    const go = (prop?: Parameters<typeof hit>[0]) => botReact(hit(prop), { seat: 3, temper: 'normal' }, newBotState(), T0, script(0.5, 0, 0));
    expect(go('egg')?.prop).toBe('slipper');
    expect(go('tomato')?.prop).toBe('tomato');
    expect(COUNTER.egg).toBe('slipper');
    for (const p of ['rose', 'like', 'cheers'] as const) {
      const a = go(p);
      expect(a?.prop).toBe(p);
      expect(a?.mood).toBe('love');
      expect(a?.sticker).toBe('love');
    }
  });

  it('被扔脏东西：情绪是生气或冒汗；善意道具只回爱心', () => {
    const moods = new Set<string>();
    for (const p of ['tomato', 'egg', 'stinkyEgg', 'slipper', 'bomb'] as const) {
      for (const a of trials('normal', hit(p))) moods.add(a.mood);
    }
    expect([...moods].sort()).toEqual(['angry', 'sweat']);
    for (const p of ['rose', 'like', 'cheers'] as const) {
      for (const a of trials('normal', hit(p))) expect(a.mood).toBe('love');
    }
  });

  it('点名短语（没有道具）被回敬时扔番茄', () => {
    const a = botReact(hit(), { seat: 3, temper: 'normal' }, newBotState(), T0, script(0.5, 0, 0));
    expect(a?.prop).toBe('tomato');
    expect(a?.mood).toBe('angry');
  });

  it('回敬上限：20 秒内最多 2 次，之后只回表情；过了窗口又能回敬', () => {
    const bot: FunBot = { seat: 3, temper: 'normal' };
    const st = newBotState();
    const run = (now: number) => botReact(hit('tomato'), bot, st, now, zero);
    expect(run(T0)?.prop).toBe('tomato');
    expect(run(T0 + 1000)?.prop).toBe('tomato');
    const third = run(T0 + 2000);
    expect(third).not.toBeNull();
    expect(third?.prop).toBeUndefined();
    expect(third?.sticker).toBeTruthy();
    // 第一次回敬在 T0，T0+20000 出窗，名额回来一个
    expect(run(T0 + 20_000)?.prop).toBe('tomato');
    // 别的电脑的账是分开的
    expect(botReact({ kind: 'hit', from: 0, to: 2 }, { seat: 2, temper: 'normal' }, st, T0 + 2000, zero)?.prop).toBe('tomato');
  });

  it('同一个电脑 1 秒内不能连着反应，过了就行', () => {
    const bot: FunBot = { seat: 3, temper: 'normal' };
    const st = newBotState();
    expect(botReact(hit('tomato'), bot, st, T0, zero)).not.toBeNull();
    expect(botReact(hit('tomato'), bot, st, T0 + 999, zero)).toBeNull();
    expect(botReact(hit('tomato'), bot, st, T0 + 1000, zero)).not.toBeNull();
  });

  it('没有回应（骰子没中）不占 minGap', () => {
    const bot: FunBot = { seat: 3, temper: 'normal' };
    const st = newBotState();
    expect(botReact(hit('tomato'), bot, st, T0, script(0.5, 0.99))).toBeNull();
    expect(botReact(hit('tomato'), bot, st, T0 + 1, zero)).not.toBeNull();
  });

  it('不是冲自己来的、或自己扔的，一律不理', () => {
    const bot: FunBot = { seat: 3, temper: 'rowdy' };
    expect(botReact({ kind: 'hit', from: 0, to: 2, prop: 'egg' }, bot, newBotState(), T0, zero)).toBeNull();
    expect(botReact({ kind: 'hit', from: 3, to: 3, prop: 'egg' }, bot, newBotState(), T0, zero)).toBeNull();
    expect(BOT_REACT.minGapMs).toBe(1000);
  });
});

describe('botReact：名场面', () => {
  const moment = (hand: string | number = 1): FunEvent => ({ kind: 'moment', moment: 'big-win', winners: [0], losers: [1], hand });

  function rate(bot: FunBot, ev: FunEvent): { acts: BotAction[] } {
    const rand = mulberry32(777);
    const acts: BotAction[] = [];
    for (let i = 0; i < N; i++) {
      const a = botReact(ev, bot, newBotState(), T0, rand);
      if (a) acts.push(a);
    }
    return { acts };
  }

  it.each([
    ['normal', 0.4],
    ['rowdy', 0.6],
    ['cool', 0.12],
  ] as const)('输家 %s 冲赢家发作的概率约 %f', (temper, p) => {
    const { acts } = rate({ seat: 1, temper }, moment());
    expect(Math.abs(acts.length / N - p)).toBeLessThan(TOL);
    for (const a of acts) {
      expect(a.to).toBe(0);
      expect(a.sticker).toBeTruthy();
      expect(a.mood).toBeTruthy();
    }
  });

  it.each([
    ['normal', 0.3],
    ['rowdy', 0.45],
    ['cool', 0.09],
  ] as const)('赢家 %s 得意的概率约 %f，只冒表情、不扔不点名', (temper, p) => {
    const { acts } = rate({ seat: 0, temper }, moment());
    expect(Math.abs(acts.length / N - p)).toBeLessThan(TOL);
    for (const a of acts) {
      expect(a.prop).toBeUndefined();
      expect(a.to).toBeUndefined();
      expect(a.mood).toBe('smug');
      expect(['smug', 'cool', 'lol']).toContain(a.sticker);
    }
  });

  it('输家有时扔道具（番茄、鸡蛋、拖鞋），有时只冒表情', () => {
    const { acts } = rate({ seat: 1, temper: 'rowdy' }, moment());
    const thrown = acts.filter((a) => a.prop);
    expect(thrown.length).toBeGreaterThan(0);
    expect(thrown.length).toBeLessThan(acts.length);
    for (const a of thrown) expect(['tomato', 'egg', 'slipper']).toContain(a.prop);
  });

  it('每手最多 2 次：第三个被问的电脑拿到 null，换一手就重新数', () => {
    const st = newBotState();
    const ev: FunEvent = { kind: 'moment', moment: 'bomb', winners: [0], losers: [1, 2, 3], hand: 'h1' };
    // 骰子永远给 0，要不是上限就一定会触发
    expect(botReact(ev, { seat: 1, temper: 'normal' }, st, T0, zero)).not.toBeNull();
    expect(botReact(ev, { seat: 2, temper: 'normal' }, st, T0, zero)).not.toBeNull();
    expect(botReact(ev, { seat: 3, temper: 'normal' }, st, T0, zero)).toBeNull();
    const next: FunEvent = { ...ev, hand: 'h2' };
    expect(botReact(next, { seat: 3, temper: 'normal' }, st, T0, zero)).not.toBeNull();
    // 数字手号也一样换手重数
    const n1: FunEvent = { ...ev, hand: 7 };
    expect(botReact(n1, { seat: 1, temper: 'normal' }, st, T0 + 5000, zero)).not.toBeNull();
  });

  it('骰子没中的不占每手的名额', () => {
    const st = newBotState();
    const ev: FunEvent = { kind: 'moment', moment: 'bomb', winners: [0], losers: [1, 2, 3], hand: 'h1' };
    expect(botReact(ev, { seat: 1, temper: 'normal' }, st, T0, script(0.5, 0.99))).toBeNull();
    expect(st.n).toBe(0);
  });

  it('既不是赢家也不是输家的电脑不动；没有赢家时输家也不冲谁', () => {
    expect(botReact(moment(), { seat: 2, temper: 'rowdy' }, newBotState(), T0, zero)).toBeNull();
    const none: FunEvent = { kind: 'moment', moment: 'x', winners: [], losers: [1], hand: 1 };
    expect(botReact(none, { seat: 1, temper: 'rowdy' }, newBotState(), T0, zero)).toBeNull();
  });
});

describe('placeBubble（0.18.2）', () => {
  const view = { width: 390, height: 844 };
  const me = { left: 20, top: 700, width: 60, height: 60 };
  it('没东西挡：朝屏幕中心那侧、和头像顶边对齐（和以前一样）', () => {
    expect(placeBubble(me, 120, 30, view)).toEqual({ left: 86, top: 694 });
    const right = { left: 310, top: 300, width: 60, height: 60 };
    expect(placeBubble(right, 120, 30, view)).toEqual({ left: 184, top: 294 });
  });
  it('右边是"互动"按钮（竖屏自己）：换到头像上方，不压按钮', () => {
    const btn = { left: 86, top: 700, width: 60, height: 60 };
    const at = placeBubble(me, 120, 30, view, [btn]);
    expect(at.top + 30).toBeLessThanOrEqual(me.top);
    expect(at.left + 120 <= btn.left || at.top + 30 <= btn.top).toBe(true);
  });
  it('朝中心那侧是对家的名牌：换一侧，不盖名字和筹码', () => {
    const top = { left: 165, top: 80, width: 60, height: 60 };
    const plate = { left: 231, top: 74, width: 100, height: 40 };
    const at = placeBubble(top, 90, 30, view, [plate]);
    expect(at.left + 90).toBeLessThanOrEqual(top.left);
  });
  it('四边都挡：选压得最少的，夹在屏幕里', () => {
    const all = [{ left: 0, top: 0, width: 390, height: 844 }];
    const at = placeBubble(me, 120, 30, view, all);
    expect(at.left).toBeGreaterThanOrEqual(4);
    expect(at.top + 30).toBeLessThanOrEqual(840);
  });
});

describe('placeMenu', () => {
  const view = { width: 800, height: 600 };
  const W = 200;
  const H = 150;
  const hits = (a: Box, b: Box): boolean => a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
  const box = (p: { left: number; top: number }): Box => ({ ...p, width: W, height: H });

  it('朝屏幕中心放：靠左边的头像菜单在右边，靠右边的在左边，顶上居中的在下面', () => {
    const l = placeMenu({ left: 0, top: 270, width: 60, height: 60 }, W, H, view);
    expect(l.left).toBeGreaterThanOrEqual(60);
    const r = placeMenu({ left: 740, top: 270, width: 60, height: 60 }, W, H, view);
    expect(r.left + W).toBeLessThanOrEqual(740);
    const t = placeMenu({ left: 370, top: 0, width: 60, height: 60 }, W, H, view);
    expect(t.top).toBeGreaterThanOrEqual(60);
    // 底下居中的头像菜单在上面
    const b = placeMenu({ left: 370, top: 540, width: 60, height: 60 }, W, H, view);
    expect(b.top + H).toBeLessThanOrEqual(540);
  });

  it('不出可见区，留 margin，有空位时不压头像', () => {
    const anchors: Box[] = [];
    for (const left of [0, 100, 370, 600, 740]) for (const top of [0, 100, 270, 450, 540]) anchors.push({ left, top, width: 60, height: 60 });
    for (const a of anchors) {
      const p = placeMenu(a, W, H, view, [], 8);
      expect(p.left).toBeGreaterThanOrEqual(8);
      expect(p.top).toBeGreaterThanOrEqual(8);
      expect(p.left + W).toBeLessThanOrEqual(view.width - 8);
      expect(p.top + H).toBeLessThanOrEqual(view.height - 8);
      expect(hits(box(p), a)).toBe(false);
    }
  });

  it('首选那侧被禁区（手牌、按钮）占了，另有空位就换一侧', () => {
    const anchor: Box = { left: 0, top: 270, width: 60, height: 60 };
    const first = placeMenu(anchor, W, H, view);
    const avoid: Box = { left: 70, top: 200, width: 200, height: 100 };
    expect(hits(box(first), avoid)).toBe(true); // 前提：不避的话确实压住
    const p = placeMenu(anchor, W, H, view, [avoid]);
    expect(hits(box(p), avoid)).toBe(false);
    expect(hits(box(p), anchor)).toBe(false);
  });

  it('四面都压时选压得最少的，不会没有结果', () => {
    const everywhere: Box = { left: 0, top: 0, width: 800, height: 600 };
    const p = placeMenu({ left: 370, top: 270, width: 60, height: 60 }, W, H, view, [everywhere]);
    expect(Number.isFinite(p.left) && Number.isFinite(p.top)).toBe(true);
  });

  it('窄屏（390 竖屏，0.11.2）：440 宽的面板、432 宽的菜单收窄到 100vw − 16px，左右都不伸出屏幕；宽屏照旧', () => {
    expect(fitMenuWidth(440, 390)).toBe(374);
    expect(fitMenuWidth(432, 390)).toBe(374);
    expect(fitMenuWidth(328, 390)).toBe(328);
    expect(fitMenuWidth(440, 1280)).toBe(440);
    const phone = { width: 390, height: 844 };
    // 头像在左边、右边、正中，面板都夹在 [8, 382] 里
    for (const left of [0, 160, 330]) {
      for (const top of [20, 400, 780]) {
        const a: Box = { left, top, width: 60, height: 60 };
        for (const want of [440, 432, 328]) {
          const p = placeMenu(a, want, 300, phone);
          const w = fitMenuWidth(want, phone.width);
          expect(p.left).toBeGreaterThanOrEqual(8);
          expect(p.left + w).toBeLessThanOrEqual(382);
        }
      }
    }
  });
});

describe('编号', () => {
  const P = 10;

  it('短语 0..P-1，表情 P..P+11，道具 P+12..P+19', () => {
    expect(funIdCount(P)).toBe(P + 20);
    expect(funItem(0, P)).toEqual({ kind: 'phrase', index: 0 });
    expect(funItem(P - 1, P)).toEqual({ kind: 'phrase', index: P - 1 });
    expect(funItem(P, P)).toEqual({ kind: 'sticker', index: 0 });
    expect(funItem(P + 11, P)).toEqual({ kind: 'sticker', index: 11 });
    expect(funItem(P + 12, P)).toEqual({ kind: 'prop', index: 0 });
    expect(funItem(P + 19, P)).toEqual({ kind: 'prop', index: 7 });
  });

  it('越界、负数、小数、NaN 都是 null', () => {
    for (const bad of [-1, P + 20, 9999, 1.5, NaN, Infinity]) expect(funItem(bad, P)).toBeNull();
  });

  it('stickerId、propId 和 funItem 互逆', () => {
    for (let i = 0; i < 12; i++) expect(funItem(stickerId(P, i), P)).toEqual({ kind: 'sticker', index: i });
    for (let i = 0; i < 8; i++) expect(funItem(propId(P, i), P)).toEqual({ kind: 'prop', index: i });
  });

  it('没有短语时（P=0）也成立', () => {
    expect(funIdCount(0)).toBe(20);
    expect(funItem(0, 0)).toEqual({ kind: 'sticker', index: 0 });
    expect(funItem(12, 0)).toEqual({ kind: 'prop', index: 0 });
  });
});

describe('房间用的换算', () => {
  const P = 6;

  it('hitEvent：冲人来的道具带上道具名，点名短语不带；表情、不点名、冲自己的不算', () => {
    expect(hitEvent(propId(P, PROPS.indexOf('egg')), P, 0, 2)).toEqual({ kind: 'hit', from: 0, to: 2, prop: 'egg' });
    expect(hitEvent(3, P, 0, 2)).toEqual({ kind: 'hit', from: 0, to: 2 });
    expect(hitEvent(stickerId(P, 0), P, 0, 2)).toBeNull();
    expect(hitEvent(3, P, 0)).toBeNull();
    expect(hitEvent(3, P, 2, 2)).toBeNull();
    expect(hitEvent(funIdCount(P), P, 0, 2)).toBeNull();
  });

  it('botEmoteIds：先表情，回扔时再加道具，编号能被 funItem 原样认回来', () => {
    const only = botEmoteIds({ from: 1, to: 0, delay: 900, sticker: 'sweat', mood: 'sweat' }, P);
    expect(only).toEqual([{ id: stickerId(P, STICKERS.indexOf('sweat')) }]);
    const back = botEmoteIds({ from: 1, to: 0, delay: 900, sticker: 'angry', mood: 'angry', prop: 'slipper' }, P);
    expect(back.map((e) => funItem(e.id, P))).toEqual([
      { kind: 'sticker', index: STICKERS.indexOf('angry') },
      { kind: 'prop', index: PROPS.indexOf('slipper') },
    ]);
    expect(back[1]!.to).toBe(0);
  });

  it('stickerMood：botReact 会给的表情都认得出情绪（页面据此配一句话），别的表情回 null', () => {
    const seen = new Set<string>();
    const rand = mulberry32(7);
    for (let i = 0; i < 3000; i++) {
      const st = newBotState();
      const ev = i % 2 ? { kind: 'hit' as const, from: 0, to: 1, prop: PROPS[i % 8]! } : { kind: 'moment' as const, moment: 'bomb', winners: [0], losers: [1], hand: i };
      const a = botReact(ev, { seat: 1, temper: 'rowdy' }, st, 1e6, rand);
      if (a) {
        seen.add(a.sticker);
        expect(stickerMood(a.sticker)).toBe(a.mood);
      }
    }
    expect(seen.size).toBeGreaterThan(3);
    expect(stickerMood('sleep')).toBeNull();
  });
});

describe('聊天的版式（0.19.0）', () => {
  const desk = { width: 1920, height: 1080 };
  const phone = { width: 390, height: 844 };
  const overlaps = (a: { left: number; top: number; width: number; height: number }, b: typeof a): boolean =>
    a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;

  it('电脑 / 手机按可见区分：宽 ≥ 960 且高 ≥ 560 是电脑；手机横屏、窄窗口都是手机', () => {
    expect(chatMode(desk)).toBe('desk');
    expect(chatMode({ width: 1280, height: 720 })).toBe('desk');
    expect(chatMode({ width: 1024, height: 768 })).toBe('desk');
    expect(chatMode(phone)).toBe('phone');
    expect(chatMode({ width: 844, height: 390 })).toBe('phone');
    expect(chatMode({ width: 1280, height: 500 })).toBe('phone');
  });

  it('字号：电脑 18–22px 跟着短边，手机 ≥ 15px', () => {
    expect(chatFont(desk)).toBe(22);
    expect(chatFont({ width: 1280, height: 720 })).toBe(18);
    expect(chatFont({ width: 3840, height: 2160 })).toBe(22);
    expect(chatFont(phone)).toBe(15);
    expect(chatFont({ width: 1024, height: 600 }, 'phone')).toBe(16);
    for (const v of [desk, phone, { width: 844, height: 390 }, { width: 1280, height: 720 }]) {
      const f = chatFont(v);
      expect(chatMode(v) === 'desk' ? f >= 18 && f <= 22 : f >= 15).toBe(true);
    }
  });

  it('弹幕速度：横穿一屏约 8 秒，夹在上下限里', () => {
    expect(danmakuSpeed(1920)).toBeCloseTo(0.24);
    expect(danmakuSpeed(390)).toBeCloseTo(DANMAKU.minSpeed / 1000);
    expect(danmakuSpeed(10_000)).toBeCloseTo(DANMAKU.maxSpeed / 1000);
  });

  it('弹幕轨道：不压名牌、头像、中间信息区；互不重叠；多了均匀挑', () => {
    const area = { left: 0, top: 100, width: 1000, height: 400 };
    const plate = { left: 20, top: 180, width: 120, height: 60 };
    const center = { left: 400, top: 300, width: 200, height: 120 };
    const lanes = danmakuLanes(area, 40, [plate, center], 6);
    expect(lanes.length).toBeGreaterThanOrEqual(2);
    for (const t of lanes) {
      const row = { left: 0, top: t, width: 1000, height: 40 };
      expect(overlaps(row, plate) || overlaps(row, center), `lane ${t}`).toBe(false);
    }
    for (let i = 1; i < lanes.length; i++) expect(lanes[i]! - lanes[i - 1]!).toBeGreaterThanOrEqual(40);
    expect(danmakuLanes(area, 40, [], 3)).toHaveLength(3);
  });

  it('弹幕轨道：整片都被挡时只取压得最少的一条；区域放不下一行或 max 为 0 时没有轨道', () => {
    const area = { left: 0, top: 0, width: 100, height: 100 };
    const lanes = danmakuLanes(area, 20, [{ left: 0, top: 0, width: 100, height: 60 }, { left: 0, top: 60, width: 30, height: 40 }], 4);
    expect(lanes).toEqual([60]);
    expect(danmakuLanes({ ...area, height: 10 }, 20, [], 4)).toEqual([]);
    expect(danmakuLanes(area, 20, [], 0)).toEqual([]);
  });

  it('挑轨道：从上往下第一条空出来的，都没空 -1', () => {
    expect(pickLane([0, 0], 5)).toBe(0);
    expect(pickLane([10, 3], 5)).toBe(1);
    expect(pickLane([10, 9], 5)).toBe(-1);
    expect(pickLane([], 5)).toBe(-1);
  });

  it('电脑版聊天框：左下被手牌占了就去右下、再去上面；上面两个角从屏高 9% 往下（不压顶栏）', () => {
    const hand = { left: 0, top: 800, width: 1500, height: 280 };
    expect(placeDock(desk, 360, 300, [])).toEqual({ left: 12, top: 1080 - 12 - 300 });
    expect(placeDock(desk, 360, 300, [hand])).toEqual({ left: 1920 - 12 - 360, top: 768 });
    const right = { left: 1500, top: 700, width: 420, height: 380 };
    expect(placeDock(desk, 360, 300, [hand, right])).toEqual({ left: 12, top: 97 });
  });

  it('手机输入条：贴在下半屏手牌、按钮上面；它们占了大半屏就贴屏幕底', () => {
    const hand = { left: 0, top: 760, width: 390, height: 84 };
    const btn = { left: 140, top: 700, width: 60, height: 50 };
    const avatarTop = { left: 0, top: 100, width: 60, height: 60 };
    expect(barBottom(phone, 120, [hand, btn, avatarTop])).toBe(692);
    expect(barBottom(phone, 120, [])).toBe(836);
    expect(barBottom(phone, 120, [{ left: 0, top: 350, width: 390, height: 494 }])).toBe(342);
    expect(barBottom({ width: 844, height: 390 }, 140, [{ left: 0, top: 170, width: 844, height: 220 }])).toBe(382);
  });

  it('"聊天"按钮挨着"互动"按钮：先右后左再上下，避开禁区', () => {
    const btn = { left: 100, top: 700, width: 60, height: 50 };
    expect(placeBeside(btn, 60, 50, phone, [])).toEqual({ left: 168, top: 700 });
    expect(placeBeside(btn, 60, 50, phone, [{ left: 160, top: 690, width: 200, height: 80 }])).toEqual({ left: 32, top: 700 });
  });

  it('名字颜色按座位，循环使用，负数也不出错', () => {
    expect(seatColor(0)).toBe(seatColor(8));
    expect(seatColor(1)).not.toBe(seatColor(2));
    expect(seatColor(-1)).toMatch(/^#/);
  });
});
