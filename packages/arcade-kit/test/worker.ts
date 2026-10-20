/**
 * 测试用的游戏 Worker：一个最小的"比大小"规则，加上开房、进房两个路由，照游戏 Worker 的真实写法用 kit（worker + room）。
 * 只在测试里用，不部署。
 */
import type { RoomGame } from '../src/game.ts';
import { shuffle, stream } from '../src/rng.ts';
import { DEFAULT_LIMITS, GameRoom, type RoomLimits } from '../src/room.ts';
import { acceptCreate, acceptJoin, acceptMatch, type GateOptions, type KitEnv } from '../src/worker.ts';
import { MatchQueue } from '../src/match.ts';

// 计量照游戏的写法从 kit 原样导出（wrangler.jsonc 的 class_name 是 RoomMeter）
export { RoomMeter } from '../src/meter.ts';
import { RoomMeter } from '../src/meter.ts';
// 0.3.0 的可选接口用"记账桌"测（test/ledger.ts）
export { LedgerRoom, ToyBank } from './ledger.ts';
import type { ToyBank } from './ledger.ts';
// 0.5.0 的"停一会儿再接着来"用"歇一下的比大小"测（test/pause.ts）
export { NoResumeRoom, PauseRoom } from './pause.ts';
// 0.8.0 的假钱包照游戏的写法原样导出（WALLET 绑回这个 Worker 的 WalletService）
export { FakeBank, WalletService } from '../src/testing.ts';
// 0.21.0 自托管 PG 模式的假后端（只有 vitest.pg.config.ts 绑了 KIT_STORE、FAKE_PG）
export { FakeKitStore, FakePg } from './fake-pg.ts';
import type { FakeKitStore, FakePg } from './fake-pg.ts';
import { type KitStoreRpc, MirrorStore } from '../src/store.ts';
import type { FakeBank, WalletService } from '../src/testing.ts';

export interface Env {
  ROOM: DurableObjectNamespace;
  ARCADE: Fetcher;
  METER: DurableObjectNamespace;
  FLAKY_ROOM: DurableObjectNamespace;
  FLAKY_METER: DurableObjectNamespace;
  LEDGER_ROOM: DurableObjectNamespace;
  BANK: DurableObjectNamespace<ToyBank>;
  PAUSE_ROOM: DurableObjectNamespace;
  NORESUME_ROOM: DurableObjectNamespace;
  FAKE_BANK: DurableObjectNamespace<FakeBank>;
  CHATTY_ROOM: DurableObjectNamespace;
  MATCH: DurableObjectNamespace;
  /** props.game = "toy" */
  WALLET: Service<WalletService>;
  /** 没写 props.game */
  WALLET_BARE: Service<WalletService>;
  /** 只有自托管 PG 模式的那一遍测试有（vitest.pg.config.ts，0.21.0） */
  KIT_STORE?: Service<FakeKitStore>;
  KIT_STORE_FLAKY?: Service<FakeKitStore>;
  FAKE_PG?: DurableObjectNamespace<FakePg>;
}

export const SITE = 'https://game.example.com';
// 不给 siteOrigin、meUrl：测的就是默认值（按请求自己的 origin，0.9.0）
const GATE: GateOptions = {};

/** 每人 3 张暗牌（1–99），按座位轮流出一张；全出完结束。手牌只有自己看得到。 */
export interface ToyState {
  /** begin 拿到的 256 位熵（服务端才有，view 不带）；旧写法 start 开的局没有 */
  key?: number[];
  hands: number[][];
  played: { seat: number; card: number }[];
  turn: number;
  rules: number;
}
export type ToyAction = { card: number };
export interface ToyView {
  /** 自己的手牌；没入座的人为 null */
  mine: number[] | null;
  counts: number[];
  played: { seat: number; card: number }[];
  turn: number;
}

/** 确定性的小随机（种子 → 发牌），规则核心不用 Math.random。 */
function deal(seed: number): number[][] {
  let x = seed >>> 0 || 1;
  const next = () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x;
  };
  return Array.from({ length: 4 }, () => Array.from({ length: 3 }, () => (next() % 99) + 1));
}

export const toyGame: RoomGame<ToyState, ToyAction, ToyView> = {
  seats: 4,
  rulesVersion: 1,
  // 0.2.0 的写法：256 位熵当 ChaCha20 密钥，1–99 洗一遍，每家 3 张
  begin: (entropy, rules) => {
    const deck = shuffle(Array.from({ length: 99 }, (_, i) => i + 1), stream(entropy, 'deal', 0));
    return { key: [...entropy], hands: Array.from({ length: 4 }, (_, s) => deck.slice(s * 3, s * 3 + 3)), played: [], turn: 0, rules };
  },
  // 0.1.x 的旧写法（32 位种子），FlakyRoom 的规则去掉 begin 时用它
  start: (seed, rules) => ({ hands: deal(seed), played: [], turn: 0, rules }),
  parse: (raw) => {
    const r = raw as { card?: unknown } | null;
    return r && typeof r === 'object' && typeof r.card === 'number' && Number.isInteger(r.card) ? { card: r.card } : null;
  },
  apply: (s, seat, a) => {
    if (s.turn !== seat) return { error: 'not_your_turn' };
    const hand = s.hands[seat]!;
    const i = hand.indexOf(a.card);
    // 故意写错的游戏：错误码里夹带了手牌，房间要把它换掉
    if (a.card === 0) return { error: `need one of ${hand.join(',')}` };
    if (i < 0) return { error: 'no_such_card' };
    const hands = s.hands.map((h, k) => (k === seat ? h.filter((_, j) => j !== i) : h));
    return { ...s, hands, played: [...s.played, { seat, card: a.card }], turn: (s.turn + 1) % 4 };
  },
  turn: (s) => (s.hands.every((h) => h.length === 0) ? null : s.turn),
  view: (s, seat) => ({ mine: seat === null ? null : s.hands[seat]!, counts: s.hands.map((h) => h.length), played: s.played, turn: s.turn }),
  ai: (s, seat) => ({ card: Math.min(...s.hands[seat]!) }),
  timeout: (s, seat) => ({ card: Math.min(...s.hands[seat]!) }),
  over: (s) => s.hands.every((h) => h.length === 0),
  // 0.6.0：6 句快捷短语（编号 0–5），房间只转发
  emotes: 6,
  // 0.18.0：开着聊天，加一个游戏自己的打码词
  chat: true,
  chatWords: ['土豆泥'],
};

export class ToyRoom extends GameRoom<ToyState, ToyAction, ToyView, Env> {
  protected readonly game = toyGame;
  protected override readonly limits: RoomLimits = { ...DEFAULT_LIMITS, minClientVersion: 1 };
}

/**
 * 计量的测试替身：和 RoomMeter 一样，只是 down 为 true 时所有调用都抛错（"连不上"）。测试用 runInDurableObject 拨这个开关。
 */
export class FlakyMeter extends RoomMeter {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env as never);
    // PG 那一遍（0.21.0）：和全站计量（METER）是两个类，线上一个游戏只有一个计量；测试里给它单独一个游戏 id，PG 里的行不撞
    if (env.KIT_STORE_FLAKY) (this as unknown as { pg: MirrorStore }).pg = new MirrorStore(env.KIT_STORE_FLAKY as unknown as KitStoreRpc, 'meter');
  }
  down = false;
  /** 收到过几次 kitReport（测"攒够一批才报"） */
  reports = 0;
  /** 断线时拒掉了几次 kitRelease（测试等房间真的试过、被拒了，再恢复计量） */
  refusedReleases = 0;
  private check(): void {
    if (this.down) throw new Error('meter down');
  }
  // 单人的 kitReserve / kitRelease 也经这两个（0.20.0），拦这里就都拦住了
  override async kitReserveMany(...a: Parameters<RoomMeter['kitReserveMany']>) {
    this.check();
    return super.kitReserveMany(...a);
  }
  override async kitReleaseMany(...a: Parameters<RoomMeter['kitReleaseMany']>) {
    if (this.down) this.refusedReleases++;
    this.check();
    return super.kitReleaseMany(...a);
  }
  override async kitPeek(...a: Parameters<RoomMeter['kitPeek']>) {
    this.check();
    return super.kitPeek(...a);
  }
  override async kitReport(...a: Parameters<RoomMeter['kitReport']>) {
    this.check();
    this.reports++;
    return super.kitReport(...a);
  }
  override async kitLevel() {
    this.check();
    return super.kitLevel();
  }
}

/**
 * 每一轮第二家（座位 1，电脑）出完是"一段的结尾"：计量说满了，房间在这里收场。
 * 故意放在电脑连出的中间，测房间到了收场点会停下电脑（不然座位 2、3 会接着出）。
 */
export const toyRoundsGame: RoomGame<ToyState, ToyAction, ToyView> = {
  ...toyGame,
  // 顺便覆盖只有 start 的旧游戏：房间照旧给 32 位种子
  begin: undefined,
  // 没开聊天的游戏（0.18.0 测 chat_off）
  chat: undefined,
  breakPoint: (s) => s.played.length % 4 === 2,
};

/**
 * 0.10.0 "电脑也会互动"：每一步之后看最后出牌的座位，让它（如果是电脑）发 0 号短语。结果记在 botTries 里（真人座位应当是 false）。
 * 只看公开的出牌记录，不看手牌，也不看真人的短语
 */
export class ChattyRoom extends ToyRoom {
  botTries: { seat: number; ok: boolean }[] = [];
  protected override onStep(state: ToyState): void {
    const last = state.played.at(-1);
    if (last) this.botTries.push({ seat: last.seat, ok: this.botEmote(last.seat, 0) });
  }
  /** 0.10.1：收到过的真人短语（只记座位和编号，测钩子调了几次）；电脑的 botEmote 不该出现在这里 */
  heard: { from: number; id: number; to?: number }[] = [];
  /** 真人发 4 号短语时，2 号位（电脑）回一句 5 号、冲着发的人 */
  protected override onEmote(from: number, id: number, to?: number): void {
    this.heard.push(to === undefined ? { from, id } : { from, id, to });
    if (id === 4) this.botEmote(2, 5, from);
  }
  /** 测试直接调（runInDurableObject） */
  tryBotEmote(seat: number, id: number, to?: number): boolean {
    return this.botEmote(seat, id, to);
  }
  /** 0.13.0 搭子战绩：测试直接调（runInDurableObject） */
  tryReportMatch(players: { seat: number; team?: number; win: boolean }[], match: number): number {
    return this.reportMatch(players, match);
  }
}

/** 用 FlakyMeter、每 5 行报一次的房间：测分批报数、计量断线、在收场点关房。 */
export class FlakyRoom extends GameRoom<ToyState, ToyAction, ToyView, Env> {
  protected readonly game = toyRoundsGame;
  protected override readonly limits: RoomLimits = { ...DEFAULT_LIMITS, minClientVersion: 1, meterBatch: 5 };
  protected override meterNamespace(): DurableObjectNamespace {
    return this.env.FLAKY_METER;
  }
}

/**
 * 0.20.0 快速匹配：一桌最多 4 个真人（档位 duo 是 2 个），每小时最多排 5 次（测上限不用连 31 次）。
 * fakeBlocks 不为 null 时代替平台的 blockedAmong（测试用 runInDurableObject 设）；默认空名单，免得每次凑桌都去调测试里只会 fetch 的假平台、刷一屏 workerd 的报错
 */
export class ToyQueue extends MatchQueue<Env> {
  protected readonly seats = 4;
  protected override readonly perHour = 5;
  protected override readonly callMs = 300;
  fakeBlocks: [string, string][] | null = [];
  /** 为真时屏蔽名单、建房都一直不回（测凑桌的超时） */
  hang: { blocks?: boolean; create?: boolean } = {};
  protected override tableSize(tier: string): number {
    return tier === 'duo' ? 2 : this.seats;
  }
  protected override blockedAmong(ids: string[]): Promise<[string, string][]> {
    if (this.hang.blocks) return new Promise(() => {});
    return this.fakeBlocks ? Promise.resolve(this.fakeBlocks) : super.blockedAmong(ids);
  }
  protected override createMatchRoom(...a: Parameters<MatchQueue<Env>['createMatchRoom']>) {
    return this.hang.create ? new Promise<never>(() => {}) : super.createMatchRoom(...a);
  }
}

async function bodyOpts(request: Request): Promise<unknown> {
  const text = await request.text().catch(() => '');
  return text ? (JSON.parse(text) as { opts?: unknown }).opts : undefined;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    // /flaky/… 用 FlakyRoom（ROOM 换成 FLAKY_ROOM），/ledger/… 用 LedgerRoom，/pause/…、/noresume/… 用 PauseRoom、NoResumeRoom，其余照常
    const prefixes = { flaky: env.FLAKY_ROOM, ledger: env.LEDGER_ROOM, pause: env.PAUSE_ROOM, noresume: env.NORESUME_ROOM, chatty: env.CHATTY_ROOM };
    const hit = (Object.keys(prefixes) as (keyof typeof prefixes)[]).find((k) => url.pathname.startsWith(`/${k}/`));
    const path = hit ? url.pathname.slice(hit.length + 1) : url.pathname;
    let e: KitEnv = hit ? { ...env, ROOM: prefixes[hit] } : env;
    let p = path;
    // 0.10.0 独立模式：/guest/… 是没绑 ARCADE 的部署（游客），/guest-login/… 是没绑 ARCADE 却写了 GATE=login（应当 fail-closed）
    const solo = /^\/(guest|guest-login)(\/.*)$/.exec(path);
    if (solo) {
      e = { ROOM: env.ROOM, METER: env.METER, ...(solo[1] === 'guest-login' ? { GATE: 'login' } : {}) };
      p = solo[2]!;
    }
    const gate: GateOptions = solo ? { ...GATE, guest: { reserved: ['老王'] } } : GATE;
    // 开房请求体 { opts } 是这个测试 Worker 自己的约定（游戏 Worker 各自决定怎么带），原样交给 kit（0.4.0）
    const mt = /^\/match\/([^/]+)$/.exec(p);
    if (mt) return acceptMatch(request, { ...e, MATCH: env.MATCH }, mt[1]!, { ...gate, tiers: ['four', 'duo'] });
    if (p === '/rooms') return acceptCreate(request, e, { ...gate, options: await bodyOpts(request) });
    const m = /^\/rooms\/([^/]+)\/ws$/.exec(p);
    if (m) return acceptJoin(request, e, m[1]!, gate);
    return new Response('not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
