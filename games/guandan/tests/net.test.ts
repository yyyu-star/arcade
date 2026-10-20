/**
 * 联机规则适配（src/net/rules.ts）和视角旋转（src/net/rotate.ts）。
 * 房间怎么驱动规则（turn → ai/timeout → apply）照 arcade-kit 的写法在这里模拟一遍：零错误、零卡死、视图不漏别人的牌。
 * 真的 Durable Object（写入行数、WebSocket、闹钟）在 tests/room/ 里用 workerd 跑。
 */
import { snapshotBytes } from 'arcade-kit/game';
import { describe, expect, it } from 'vitest';
import { shuffle, stream } from 'arcade-kit/rng';
import { HAND_SIZE, RULES_VERSION, canPass, fullDeck, legalPlays, sortHand, teamOf, type Card, type PlayerView } from '../src/variants/guandan/core/index.ts';
import { testKey, AGAIN_MS, ERROR_TEXT, IDLE_AFTER, IDLE_MS, READY_MS, TURN_MS, guandanRoom as R, parseNetAction, type NetAction, type NetState, type NetView } from '../src/variants/guandan/net/rules.ts';
import { rotateNetView, rotateView, rotation, toReal } from '../src/variants/guandan/net/rotate.ts';

const CODE_RE = /^[a-z][a-z0-9_]{0,31}$/;

/** 照房间的样子把一整局打完：轮到谁就由 pick 决定是电脑出、超时代出还是"真人"（这里也用电脑）。 */
function playRoom(seed: number, pick: (i: number) => 'ai' | 'timeout' = () => 'ai', each?: (s: NetState, i: number) => void): NetState[] {
  let s = R.begin(testKey(seed), R.rulesVersion);
  const out = [s];
  for (let i = 0; !R.over(s); i++) {
    if (i > 20000) throw new Error(`种子 ${seed} 打了 2 万步还没完（卡死）`);
    const seat = R.turn(s);
    if (seat === null) throw new Error(`种子 ${seed} 第 ${i} 步：没结束但不等任何人`);
    const a = pick(i) === 'ai' ? R.ai(s, seat) : R.timeout!(s, seat);
    // 能原样过 parse（idle 是房间代出时自己带的记号，浏览器发不了，parse 去掉；房间代出不经过 parse，照原样用）
    const { idle: _idle, ...sent } = a;
    expect(R.parse(JSON.parse(JSON.stringify(a)))).toEqual(sent);
    const next = R.apply(s, seat, a);
    if ('error' in next) throw new Error(`种子 ${seed} 第 ${i} 步 ${JSON.stringify(a)}：${next.error}`);
    s = next;
    out.push(s);
    each?.(s, i);
  }
  return out;
}

/** 电脑一直出到这一副打完（停在结算页）。 */
function findDealEnd(start: NetState): NetState {
  let s = start;
  for (let i = 0; s.g.phase !== 'dealEnd'; i++) {
    if (i > 5000) throw new Error('一副打了 5000 步还没完');
    const seat = R.turn(s)!;
    const n = R.apply(s, seat, R.ai(s, seat));
    if ('error' in n) throw new Error(n.error);
    s = n;
  }
  return s;
}

/** 结算页上大家都点"继续"，开下一副。 */
function next(s: NetState): NetState {
  let cur = s;
  for (const seat of R.actors(s).seats) {
    const n = R.apply(cur, seat, { type: 'ready' });
    if ('error' in n) throw new Error(n.error);
    cur = n;
  }
  return cur;
}

/** 视图里所有带牌的字段 */
function cardsIn(nv: NetView): Card[] {
  const v = nv.view;
  const out: Card[] = [...v.hand];
  for (const h of v.history) if (h.play) out.push(...h.play.cards);
  if (v.trick.last) out.push(...v.trick.last.play.cards);
  for (const e of v.tribute?.entries ?? []) {
    if (e.card !== null) out.push(e.card);
    if (e.back !== null) out.push(e.back);
  }
  if (v.myTribute) out.push(...v.myTribute.allowed);
  for (const e of nv.events) {
    if (e.type === 'play') out.push(...e.play.cards);
    if (e.type === 'tribute') out.push(e.card);
    if (e.type === 'returnCard' && e.card !== null) out.push(e.card);
  }
  return out;
}

/**
 * 按规则这个座位（-1 = 没入座）该看到的贡牌、还贡牌：从真实状态算，不看它自己的视图里有什么。
 * 贡牌分配了（to ≥ 0）就公开，分配前只有交的人看得到；还贡牌只有双方（from、to）看得到；没入座的人只看得到分配过的贡牌。
 */
function allowedTribute(s: NetState, seat: number): { card: (Card | null)[]; back: (Card | null)[]; all: Set<Card> } {
  const entries = s.g.tribute?.entries ?? [];
  const seated = seat >= 0;
  const card = entries.map((e) => (e.to >= 0 || (seated && e.from === seat) ? e.card : null));
  const back = entries.map((e) => (seated && (e.from === seat || e.to === seat) ? e.back : null));
  const all = new Set<Card>();
  for (const c of [...card, ...back]) if (c !== null) all.add(c);
  return { card, back, all };
}

/** 视图（房间下发的帧或进房快照里的那份）是不是只含这个座位按规则该看到的东西 */
function assertViewOk(s: NetState, seat: number, nv: NetView, where = ''): void {
  const ok = allowedTribute(s, seat);
  const tag = `${where}座位 ${seat} 第 ${s.g.step} 步`;
  // 贡牌、还贡牌逐项对：该看的看到，不该看的是 null
  const entries = nv.view.tribute?.entries ?? [];
  expect(entries.length, tag).toBe(s.g.tribute?.entries.length ?? 0);
  entries.forEach((e, i) => {
    expect(e.card, `${tag} 贡牌 ${i}`).toBe(ok.card[i]);
    expect(e.back, `${tag} 还贡牌 ${i}`).toBe(ok.back[i]);
  });
  for (const e of nv.events) {
    if (e.type === 'tribute') expect(ok.all.has(e.card), `${tag} 贡牌事件 ${e.card}`).toBe(true);
    if (e.type === 'returnCard' && e.card !== null) expect(ok.all.has(e.card), `${tag} 还贡事件 ${e.card}`).toBe(true);
  }
  // 兜底：出现的任何一张牌都不在别人手里，除非按规则看得到
  const own = new Set(seat >= 0 ? s.g.hands[seat]! : []);
  for (const c of cardsIn(nv)) {
    if (own.has(c) || ok.all.has(c)) continue;
    for (let o = 0; o < 4; o++) {
      if (o === seat) continue;
      expect(s.g.hands[o]!.includes(c), `${tag} 看到了座位 ${o} 手里的牌 ${c}`).toBe(false);
    }
  }
}

/** 这个座位（-1 = 没入座）的帧和进房快照都不漏：没有种子、没有别人的手牌、贡牌按规则给 */
function assertNoLeak(s: NetState, seat: number): void {
  const nv = R.view(s, seat < 0 ? null : seat);
  expect(JSON.stringify(nv)).not.toMatch(/seed|hands|"key"/);
  for (const w of s.g.key ?? []) expect(JSON.stringify(nv)).not.toContain(String(w));
  assertViewOk(s, seat, nv, '帧 ');
  // 进房快照（welcome）走同一个 view，按下发的样子过一遍 JSON 再查
  const welcome = JSON.parse(JSON.stringify({ t: 'welcome', seq: 1, you: { seat: seat < 0 ? null : seat }, view: R.view(s, seat < 0 ? null : seat) })) as { view: NetView };
  expect(JSON.stringify(welcome)).not.toMatch(/seed|hands|"key"/);
  assertViewOk(s, seat, welcome.view, '快照 ');
}

/** 从各个种子开局往后走（电脑出），找第一个满足条件的局面 */
function findState(pred: (s: NetState) => boolean, seeds = 400): NetState {
  for (let seed = 1; seed <= seeds; seed++) {
    let s = R.begin(testKey(seed), R.rulesVersion);
    for (let i = 0; i < 20000 && !R.over(s); i++) {
      if (pred(s)) return s;
      const seat = R.turn(s)!;
      const next = R.apply(s, seat, R.ai(s, seat));
      if ('error' in next) throw new Error(next.error);
      s = next;
    }
  }
  throw new Error('没找到这样的局面');
}

describe('联机规则适配', () => {
  it('电脑和超时代出混着打完整局：零错误、零卡死；一副结束时四个人都点了"继续"才开下一副', () => {
    for (let g = 0; g < 6; g++) {
      const states = playRoom(1000 + g, (i) => ((i + g) % 4 === 0 ? 'timeout' : 'ai'));
      const last = states[states.length - 1]!;
      expect(last.g.phase).toBe('gameOver');
      expect(R.turn(last)).toBeNull();
      for (const s of states) {
        if (s.g.phase !== 'dealEnd') {
          expect(s.next).toBeNull();
          continue;
        }
        expect(s.next).not.toBeNull();
        expect(s.ready).not.toBeNull();
        expect(R.actors(s).seats).toEqual([0, 1, 2, 3].filter((i) => !s.ready![i]));
        expect(R.turn(s)).toBe(R.actors(s).seats[0]);
        expect(R.turnMs(s)).toBe(READY_MS);
      }
    }
  }, 30_000); // 六局完整对打，机器忙时超过默认 5 秒

  // 按座位拆开（整局打一遍再逐步查五个座位，CI 上一条要 5.7 秒，超过默认的 5 秒），每条另给 20 秒
  it.each([-1, 0, 1, 2, 3])('任何时刻座位 %i（-1 是没入座的人）的视图里都没有别人的手牌、没有种子和密钥', (seat) => {
    playRoom(2024, () => 'ai', (s, i) => {
      if (i % 3 !== 0 && s.g.phase === 'play') return;
      assertNoLeak(s, seat);
    });
  }, 20_000);

  it('联机开局用 256 位密钥发牌：状态里没有能反推牌的种子；同一把密钥结果一样，换一把就不一样', () => {
    const a = R.begin(testKey(1), R.rulesVersion);
    expect(a.g.seed).toBe('');
    expect(a.g.key).toEqual(testKey(1));
    expect(a.g.rules).toBe(RULES_VERSION);
    // 状态里没有别的数能当种子：除了密钥本身，没有任何 32 位以上的整数（牌号、级数、步数都很小）
    const big: number[] = [];
    JSON.stringify({ ...a, g: { ...a.g, key: undefined } }, (_k, v) => (typeof v === 'number' && v > 0xffff && big.push(v), v));
    expect(big).toEqual([]);
    expect(R.begin(testKey(1), R.rulesVersion).g.hands).toEqual(a.g.hands);
    expect(R.begin(testKey(2), R.rulesVersion).g.hands).not.toEqual(a.g.hands);
    // 发牌只看密钥，不看种子：手动塞一个种子进去，下一副照样从密钥发
    const s1 = findDealEnd(a);
    const s2 = findDealEnd({ ...a, g: { ...a.g, seed: 'whatever' } });
    expect(next(s2).g.hands).toEqual(next(s1).g.hands);
    // 每一副都从 stream(key, 'deal', 第几副) 取：和直接用 kit 的流洗出来的一样
    const d2 = next(s1).g;
    expect(d2.dealNo).toBe(2);
    expect([...d2.hands.flat()].sort((x, y) => x - y)).toEqual([...shuffle(fullDeck(), stream(d2.key!, 'deal', 2))].sort((x, y) => x - y));
    expect(d2.hands[0]).toEqual(sortHand(shuffle(fullDeck(), stream(d2.key!, 'deal', 2)).slice(0, HAND_SIZE), d2.level));
  });

  it('房间不会用 32 位种子开局（start 直接报错）', () => {
    expect(() => R.start(1, R.rulesVersion)).toThrow();
  });

  it('一副打完停在结算页是收场点（额度满了时房间在这里关）', () => {
    const s = findDealEnd(R.begin(testKey(3), R.rulesVersion));
    expect(R.breakPoint(s)).toBe(true);
    expect(R.breakPoint(R.begin(testKey(3), R.rulesVersion))).toBe(false);
  });

  it('没入座的人：还贡阶段看不到还贡牌；双下进贡时没分配的贡牌看不到，分配后公开', () => {
    const ret = findState((s) => s.g.phase === 'return' && s.g.tribute!.kind === 'single');
    for (const seat of [-1, 0, 1, 2, 3]) assertNoLeak(ret, seat);
    expect(R.view(ret, null).view.tribute!.entries.every((e) => e.back === null)).toBe(true);
    // 双下：一家交了、受贡人还没定（to = -1）
    const half = findState((s) => s.g.phase === 'tribute' && s.g.tribute!.kind === 'double' && s.g.tribute!.entries.some((e) => e.card !== null && e.to < 0));
    for (const seat of [-1, 0, 1, 2, 3]) assertNoLeak(half, seat);
    const paid = half.g.tribute!.entries.find((e) => e.card !== null)!;
    expect(R.view(half, null).view.tribute!.entries.every((e) => e.card === null && e.back === null)).toBe(true);
    expect(R.view(half, paid.from).view.tribute!.entries.find((e) => e.from === paid.from)!.card).toBe(paid.card);
    // 双下分配完、进到还贡：贡牌所有人（含没入座的）都看得到，还贡牌只有双方
    const dbl = findState((s) => s.g.phase === 'return' && s.g.tribute!.kind === 'double' && s.g.tribute!.entries.some((e) => e.back !== null));
    for (const seat of [-1, 0, 1, 2, 3]) assertNoLeak(dbl, seat);
    expect(R.view(dbl, null).view.tribute!.entries.every((e) => e.card !== null && e.back === null)).toBe(true);
  });

  it('每一步：没打完时 actors 不空、轮到的每个座位用 timeout 代出都合法；同一组里时限不变', () => {
    for (const seed of [11, 12, 13]) {
      playRoom(seed, (i) => (i % 3 === 0 ? 'timeout' : 'ai'), (s) => {
        const act = R.actors(s);
        if (R.over(s)) {
          expect(act.seats).toEqual([]);
          return;
        }
        expect(act.seats.length, `${s.g.phase} 没有人能出手`).toBeGreaterThan(0);
        for (const seat of act.seats) {
          const r = R.apply(s, seat, R.timeout(s, seat));
          expect('error' in r ? r.error : null, `${s.g.phase} 座位 ${seat} 的 timeout 不合法`).toBeNull();
          if ('error' in r) continue;
          // 组里还有人没出：还是同一组（同名、少了他、其他人原样）、时限一样
          const after = R.actors(r);
          if (after.group === act.group) {
            expect(after.seats).toEqual(act.seats.filter((x) => x !== seat));
            expect(R.turnMs(r)).toBe(R.turnMs(s));
          }
        }
      });
    }
  }, 20_000); // 三局完整对打，机器忙时超过默认 5 秒

  it('结算：玩家不能直接开下一副（next 不认）；谁都能点继续、只能点一次；最后一个人点完那一步开下一副', () => {
    expect(R.parse({ type: 'next' })).toBeNull();
    expect(R.parse({ type: 'nextDeal' })).toBeNull();
    const states = playRoom(77);
    const end = states.find((s) => s.g.phase === 'dealEnd' && s.ready!.every((r) => !r))!;
    expect(R.turnMs(end)).toBe(READY_MS);
    let s = end;
    for (const seat of [2, 0, 3]) {
      const r = R.apply(s, seat, { type: 'ready' });
      if ('error' in r) throw new Error(r.error);
      expect(R.apply(r, seat, { type: 'ready' })).toEqual({ error: 'already_ready' });
      // 局面没变：同一个 step、没有新事件，结算页停着
      expect(r.g).toEqual(end.g);
      expect(r.ev).toEqual([]);
      s = r;
    }
    expect(R.actors(s).seats).toEqual([1]);
    const r = R.apply(s, 1, { type: 'ready' });
    if ('error' in r) throw new Error(r.error);
    expect(r.g.phase).not.toBe('dealEnd');
    expect(r.g.dealNo).toBe(end.g.dealNo + 1);
    expect(r.ready).toBeNull();
    expect(R.turnMs(r)).toBe(TURN_MS);
    const play = states.find((x) => x.g.phase === 'play')!;
    expect(R.apply(play, R.turn(play)!, { type: 'ready' })).toEqual({ error: 'wrong_phase' });
    const notTurn = (R.turn(play)! + 1) % 4;
    expect(R.apply(play, notTurn, { type: 'pass' })).toEqual({ error: 'not_your_turn' });
  });

  it('1 真人 + 3 电脑：电脑拿了头游，结算页也停着，等真人点继续或 20 秒到点才开下一副', () => {
    // 照 arcade-kit 0.1.1 的 actors 走：电脑座位立刻代出，真人（0 号位）不出就等着
    const human = 0;
    const runAuto = (x: NetState): NetState => {
      for (let i = 0; i < 20000; i++) {
        const auto = R.actors(x).seats.find((a) => a !== human);
        if (auto === undefined) return x;
        const r = R.apply(x, auto, R.ai(x, auto));
        if ('error' in r) throw new Error(r.error);
        x = r;
      }
      throw new Error('电脑一直在出（卡死）');
    };
    // 找一副电脑拿头游的：真人轮到时也用电脑的出法，一直打到这样一个结算
    let s = runAuto(R.begin(testKey(5), R.rulesVersion));
    for (let i = 0; i < 20000 && !(s.g.phase === 'dealEnd' && s.g.lastDeal!.order[0] !== human); i++) {
      const r = R.apply(s, human, R.ai(s, human));
      if ('error' in r) throw new Error(r.error);
      s = runAuto(r);
    }
    expect(s.g.phase).toBe('dealEnd');
    expect(s.g.lastDeal!.order[0]).not.toBe(human);
    // 电脑都准备好了，只差真人：还停在结算
    expect(s.ready).toEqual([false, true, true, true]);
    expect(R.actors(s).seats).toEqual([human]);
    // 真人点继续 → 开下一副
    const ok = R.apply(s, human, { type: 'ready' });
    if ('error' in ok) throw new Error(ok.error);
    expect(ok.g.dealNo).toBe(s.g.dealNo + 1);
    // 或者 20 秒到点：房间替他点
    const t = R.apply(s, human, R.timeout!(s, human));
    if ('error' in t) throw new Error(t.error);
    expect(t.g.dealNo).toBe(s.g.dealNo + 1);
  });

  it('双下进贡、还贡时两个人同时等（actors），一手的时限 30 秒', () => {
    const dbl = findState((s) => s.g.phase === 'tribute' && s.g.tribute!.kind === 'double' && s.g.tribute!.entries.every((e) => e.card === null));
    expect(R.actors(dbl).seats.length).toBe(2);
    expect(R.turnMs(dbl)).toBe(TURN_MS);
    // 后面那个人先交也收
    const second = R.actors(dbl).seats[1]!;
    const r = R.apply(dbl, second, R.ai(dbl, second));
    expect('error' in r).toBe(false);
  });

  it('错误码都是固定短码，都有大白话', () => {
    const s = playRoom(5)[3]!;
    const seat = R.turn(s)!;
    const v = R.view(s, seat).view;
    const bad: NetAction[] = [
      { type: 'play', cards: [107] },
      { type: 'tribute', card: v.hand[0]! },
      { type: 'return', card: v.hand[0]! },
      canPass(v) ? { type: 'play', cards: [v.hand[0]!, v.hand[v.hand.length - 1]!] } : { type: 'pass' },
    ];
    for (const a of bad) {
      const r = R.apply(s, seat, a);
      expect('error' in r).toBe(true);
      const code = (r as { error: string }).error;
      expect(code).toMatch(CODE_RE);
      expect(ERROR_TEXT[code], code).toBeTruthy();
    }
  });

  it('parse 只收认得的形状', () => {
    expect(parseNetAction({ type: 'pass', seat: 3 })).toEqual({ type: 'pass' });
    expect(parseNetAction({ type: 'play', cards: [1, 2], as: { type: 'pair', rank: 3 } })).toEqual({ type: 'play', cards: [1, 2], as: { type: 'pair', rank: 3 } });
    for (const raw of [
      null, 1, 'pass', {}, { type: 'nextDeal' }, { type: 'play' }, { type: 'play', cards: [] }, { type: 'play', cards: [1, 1] },
      { type: 'play', cards: [108] }, { type: 'play', cards: [1.5] }, { type: 'play', cards: new Array(28).fill(0).map((_, i) => i) },
      { type: 'play', cards: [1], as: { type: 'boom', rank: 3 } }, { type: 'play', cards: [1], as: { type: 'single', rank: 99 } },
      { type: 'tribute' }, { type: 'return', card: -1 },
    ]) expect(parseNetAction(raw), JSON.stringify(raw)).toBeNull();
  });

  it('再来一场（0.6.2）：娱乐房间打完一整场先停着等人点，点了或者停够了才结束；实盘、没真人、旧局照旧打完就结束', () => {
    const done = playRoom(5).at(-1)!;
    expect(done.g.phase).toBe('gameOver');
    // 0.6.0 以前开的局（不知道谁是真人）：照旧打完就结束
    expect(R.over(done)).toBe(true);
    const s: NetState = { ...done, humans: [true, false, true, false] };
    expect(R.over(s)).toBe(false);
    expect(R.actors(s).seats).toEqual([]);
    expect(R.pause!(s)).toBe(AGAIN_MS);
    expect(R.view(s, 0).again).toBeUndefined();
    // 不轮流的操作，谁点都收；房间码交给所有人（没入座的也看得到），之后再点就拒
    expect(R.free!({ type: 'again', code: '123456' })).toBe(true);
    const a = R.apply(s, 2, { type: 'again', code: '123456' });
    if ('error' in a) throw new Error(a.error);
    expect(a.again).toEqual({ code: '123456', by: 2 });
    expect(R.over(a)).toBe(true);
    expect(R.pause!(a)).toBeNull();
    expect(R.view(a, 0).again).toEqual({ code: '123456', by: 2 });
    expect(R.view(a, null).again).toEqual({ code: '123456', by: 2 });
    expect(rotateNetView(R.view(a, 0), 2).again).toEqual({ code: '123456', by: 0 });
    expect(R.apply(a, 0, { type: 'again', code: '654321' })).toEqual({ error: 'cannot_again' });
    // 停够了没人点：结束、还名额
    const late = R.resume!(s);
    expect(late.again).toBeNull();
    expect(R.over(late)).toBe(true);
    expect(R.apply(late, 0, { type: 'again', code: '654321' })).toEqual({ error: 'cannot_again' });
    // 真人都走了、实盘房间：打完就结束，不等
    expect(R.over({ ...s, humans: [false, false, false, false] })).toBe(true);
    expect(R.over({ ...s, stake: { over: false, pending: [] } as unknown as NonNullable<NetState['stake']> })).toBe(true);
    // 牌局没打完不能点
    const mid = findState((x) => x.g.phase === 'play');
    expect(R.apply({ ...mid, humans: [true, true, true, true] }, 0, { type: 'again', code: '123456' })).toEqual({ error: 'cannot_again' });
    expect(ERROR_TEXT['cannot_again']).toBeTruthy();
    expect(parseNetAction({ type: 'again', code: '123456', by: 3 })).toEqual({ type: 'again', code: '123456' });
    for (const code of [undefined, 123456, '12345', '1234567', 'abcdef', '12345a']) expect(parseNetAction({ type: 'again', code })).toBeNull();
  });

  it('走开了（0.6.3）：连着两手到点被代出，之后轮到他只等 3 秒；自己出一手或者点"我回来了"恢复；电脑代出不算', () => {
    const start = R.begin(testKey(11), R.rulesVersion, { opts: undefined, seats: ['human', 'human', 'human', 'human'] });
    expect(start.idle).toEqual([0, 0, 0, 0]);
    expect(R.view(start, 0).afk).toEqual([false, false, false, false]);
    let s = start;
    // 第一个出牌的人连着两手到点被代出（中间别人自己出）
    const first = R.turn(s)!;
    const go = (who: number, a: NetAction): void => {
      const r = R.apply(s, who, a);
      if ('error' in r) throw new Error(r.error);
      s = r;
    };
    while (s.idle![first]! < IDLE_AFTER) {
      const who = R.turn(s)!;
      expect(R.turnMs(s)).toBe(TURN_MS);
      go(who, who === first ? R.timeout(s, who) : R.ai(s, who));
    }
    expect(R.view(s, 2).afk![first]).toBe(true);
    // 再轮到他：只等 IDLE_MS；别人的手照旧 30 秒
    while (R.turn(s) !== first) {
      expect(R.turnMs(s)).toBe(TURN_MS);
      const who = R.turn(s)!;
      go(who, R.ai(s, who));
    }
    expect(R.turnMs(s)).toBe(IDLE_MS);
    // 点"我回来了"（不轮流）：清零、恢复 30 秒；没走开时点被拒
    expect(R.free!({ type: 'back' })).toBe(true);
    const back = R.apply(s, first, { type: 'back' });
    if ('error' in back) throw new Error(back.error);
    expect(back.idle![first]).toBe(0);
    expect(R.turnMs(back)).toBe(TURN_MS);
    expect(R.apply(back, first, { type: 'back' })).toEqual({ error: 'not_away' });
    // 不点、自己出一手也一样清零
    const own = R.apply(s, first, R.ai(s, first));
    if ('error' in own) throw new Error(own.error);
    expect(own.idle![first]).toBe(0);
    // 浏览器发来的带不了 idle 记号（parse 去掉）；规则核心看不到它
    expect(parseNetAction({ type: 'pass', idle: true })).toEqual({ type: 'pass' });
    expect(parseNetAction({ type: 'back', idle: true })).toEqual({ type: 'back' });
    expect(ERROR_TEXT['not_away']).toBeTruthy();
    // 0.6.3 以前开的局（没有 idle）：不记、不缩短
    const old: NetState = { ...s, idle: undefined } as NetState;
    delete old.idle;
    expect(R.turnMs(old)).toBe(TURN_MS);
    const o = R.apply(old, first, R.timeout(old, first));
    if ('error' in o) throw new Error(o.error);
    expect(o.idle).toBeUndefined();
    expect(R.view(o, 0).afk).toBeUndefined();
  });

  it('进房快照不超过 11 KB（整局每一步都量）', () => {
    // 2026-10-14 实测种子 1..20 整局每一步：最大 7356 字节（种子 7），各局最大 6.3–7.4 KB。上限取实测的 1.5 倍左右，
    // 比 8 KB 宽：快照里有整副的出牌记录，一副打得长就大，8 KB 只留 1.1 倍余量，规则稍改就会误报
    let max = 0;
    for (const g of [1, 7]) for (const s of playRoom(g)) max = Math.max(max, snapshotBytes(R, s));
    expect(max).toBeGreaterThan(6000);
    expect(max).toBeLessThan(11 * 1024);
  });
});

describe('视角旋转（转 0–3 格）', () => {
  const samples = playRoom(31, (i) => (i % 5 === 0 ? 'timeout' : 'ai')).filter((_, i) => i % 7 === 0);
  // 一副结束、进贡阶段都要有
  expect(samples.some((s) => s.g.phase === 'dealEnd' || s.g.lastDeal)).toBe(true);

  it('我总在 0；座位、张数、出牌记录一一对上；按队记的级数跟着队伍走', () => {
    for (const s of samples) {
      for (let me = 0; me < 4; me++) {
        const raw = R.view(s, me).view;
        const r = rotation(me);
        const v = rotateView(raw, r);
        expect(v.seat).toBe(0);
        for (let real = 0; real < 4; real++) {
          const shown = r.seat(real);
          expect(toReal(me, shown)).toBe(real);
          expect(v.counts[shown]).toBe(raw.counts[real]);
          expect(v.trick.passed[shown]).toBe(raw.trick.passed[real]);
          // 同一个人的队伍级数：转前按真实队伍查，转后按画面队伍查，得到同一个数
          expect(v.levels[teamOf(shown)]).toBe(raw.levels[teamOf(real)]);
          expect(v.aFails[teamOf(shown)]).toBe(raw.aFails[teamOf(real)]);
          if (raw.declarer >= 0) expect(v.declarer === teamOf(shown)).toBe(raw.declarer === teamOf(real));
          if (raw.winner >= 0) expect(v.winner === teamOf(shown)).toBe(raw.winner === teamOf(real));
        }
        expect(v.turn).toBe(r.seat(raw.turn));
        expect(v.history.map((h) => h.seat)).toEqual(raw.history.map((h) => r.seat(h.seat)));
        expect(v.finished).toEqual(raw.finished.map(r.seat));
        if (raw.lastDeal) {
          // 头游所在的队 = 赢的队（转完也成立）
          expect(v.lastDeal!.winnerTeam).toBe(teamOf(v.lastDeal!.order[0]!));
          for (const t of [0, 1] as const) {
            const realTeam = teamOf(toReal(me, t));
            expect(v.lastDeal!.levelsAfter[teamOf(t)]).toBe(raw.lastDeal.levelsAfter[realTeam]);
          }
        }
        for (const e of v.tribute?.entries ?? []) expect(raw.tribute!.entries.some((x) => r.seat(x.from) === e.from && r.seat(x.to) === e.to)).toBe(true);
        // 规则上的判断不受旋转影响
        expect(legalPlays(v)).toEqual(legalPlays({ ...raw, seat: raw.seat } as PlayerView).length ? legalPlays(raw) : []);
        expect(canPass(v)).toBe(canPass(raw));
      }
    }
  });

  it('转过去再转回来是原样；事件和预告也一样', () => {
    for (const s of samples) {
      for (let me = 0; me < 4; me++) {
        const nv = R.view(s, me);
        const there = rotateNetView(nv, me);
        const back = rotateNetView(there, (4 - me) % 4);
        expect(back).toEqual(nv);
        for (const e of there.events) {
          if (e.type === 'dealEnd') expect(e.result.winnerTeam).toBe(teamOf(e.result.order[0]!));
          if (e.type === 'gameOver') expect(e.levels[e.winner]).toBe(14);
        }
        if (there.next && !there.next.anti && there.next.payers.length === 1) expect(there.next.to).toBe(there.view.lastDeal!.order[0]);
      }
    }
  });
});
