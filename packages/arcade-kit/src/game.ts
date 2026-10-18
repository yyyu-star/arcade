/**
 * 游戏要提供的规则接口，和给游戏自己测"快照多大"的小工具。
 * 这个文件不依赖 Workers 运行时，游戏的规则测试（普通 Node 里的 vitest）也能直接引用。
 */
import { PROTOCOL_VERSION, type RoomInfo, type SeatKind, type WelcomeMsg } from './protocol.js';
import type { Entropy } from './rng.js';

export type { Entropy } from './rng.js';

/** 开局时房间告诉游戏的（0.3.0）：房主选的选项、每个座位坐的是谁（电脑补满以后；seatCount 以外的座位是 empty）。 */
export interface RoomSetup<O> {
  /** options() 校验过的选项；游戏没写 options 时是 undefined */
  opts: O | undefined;
  seats: SeatKind[];
}

/**
 * 一笔要房间去外面办的事（0.3.0，比如从玩家的钱包扣买入、把筹码结回去），游戏在状态里记着，办完前一直在 effects() 里。
 * id 在这一局里唯一、不重用：房间可能因为断线、被驱逐把同一笔办两次，办事的一方要按 id 去重（幂等）。
 * seat 是为谁办：房间把这个座位绑定的 userId 交给 perform（没绑人的电脑座位是 null）。
 */
export interface RoomEffect {
  id: string;
  seat: number;
}

/**
 * 一个游戏的规则，纯函数（浏览器和房间共用，4.3）。S 状态、A 操作、V 某个座位看到的视图。
 * 房间只通过这些函数碰游戏状态，自己不懂规则。
 */
export interface RoomGame<S, A, V, O = unknown, E extends RoomEffect = RoomEffect> {
  /** 座位数（掼蛋 4） */
  seats: number;
  /** 规则版本：开局时记进状态，进行中的牌局按开局时的版本打完（4.3） */
  rulesVersion: number;
  /**
   * 开局（0.2.0 起推荐）：entropy 是房间用 crypto.getRandomValues 现生成的 256 位熵（8 个 u32），只给这一次、房间不存。
   * 用它当 arcade-kit/rng 的 ChaCha20 密钥发牌；后面每一副也从这把密钥分出的流里取（stream(key, 'deal', 第几副)），
   * 所以密钥要放进自己的状态——状态只在服务端，view 绝不能带上它。谁拿到密钥谁就知道全桌的牌（9.1）。
   * 写了 begin，房间就不再调 start
   */
  begin?(entropy: Entropy, rulesVersion: number, setup?: RoomSetup<O>): S;
  /**
   * @deprecated 0.2.0：32 位种子只有约 43 亿种，玩家拿自己的手牌逐个试，几分钟就能反推出全桌的牌。新游戏写 begin；
   * 这里只为 0.1.x 的游戏升级 kit 时照常能开局（房间会记一条警告日志），游戏都换成 begin 以后去掉。
   * 已经开打的房间不会再调开局，按开局时记下的规则版本打完
   */
  start(seed: number, rulesVersion: number): S;
  /** 校验客户端发来的操作的形状，不合格返回 null（不进 apply） */
  parse(raw: unknown): A | null;
  /**
   * 做一步；不合法返回 { error }，状态不变。
   * error 会原样发给出手的人，所以只能是固定的错误码（小写字母、数字、下划线，最长 32），不能带牌面之类的隐藏信息；
   * 不合这个格式的一律换成 illegal_move 再发。
   */
  apply(state: S, seat: number, action: A): S | { error: string };
  /** 现在该谁出手；null 表示不在等任何人（比如一局打完）。写了 actors 时房间只看 actors，不再用它 */
  turn(state: S): number | null;
  /**
   * 这一刻可以出手的座位（0.1.1；不写就是 [turn(state)]，和 0.1.0 一样）。多于一个时是"一组"，比如结算页大家点继续：
   * - 电脑、托管座位由房间立刻用 ai() 代出；真人谁先发都收，不用排队；
   * - 组里有人出手不重新计时：时限从进入这组时起算，到点对还没出的真人逐个用 timeout() 代出；
   * - 组里先出手的人改了局面，后出的人照样能出（不判 stale），只有在这组开始之前做的决定才是 stale。
   * 怎么算"还是同一组"：
   * - 推荐返回 { seats, group }，group 是这一组的标识（比如 'settle-3'，第几副的结算）：出手前后 group 一样、而且出手的人离开了名单、
   *   没有新座位加入，才是同一组，否则是新的一手（所以一个人一手的阶段给同一个 group 也没关系，每一手照样重新计时）；
   * - 只返回座位数组时由房间推断：出手的那个座位离开名单、其他座位原样留着（不多不少）才算同一组。所以组里每个人出手后都要从名单里拿掉。
   *   这有歧义：[2, 3] 里 2 出完剩 [3]，和"新的一手只有 3 能出"分不清（会被当成同一组），有这种情况的游戏要给 group。
   * 名单里不合法的座位号、重复的会被忽略。牌局没打完（over 为 false）时名单不能是空的，空了房间按游戏出错处理：记日志、当作打完。
   */
  actors?(state: S): number[] | { seats: number[]; group: string };
  /**
   * 这一手（或这一组）的时限毫秒（0.1.1；不写、或给的不是正数，就用 RoomLimits.turnMs）。
   * 按当前局面现算，同一组里要一直给同一个数
   */
  turnMs?(state: S): number;
  /** 这个座位能看到的东西。seat 为 null 是没入座的人，只能给公开信息 */
  view(state: S, seat: number | null): V;
  /** 电脑出手（电脑座位、掉线托管），必须合法 */
  ai(state: S, seat: number): A;
  /** 超时代出（真人 30 秒没出、掉线时轮到他），只看该座位能看到的；不给就用 ai。被 apply 拒了房间会再用 ai 试一次 */
  timeout?(state: S, seat: number): A;
  /** 整场打完了 */
  over(state: S): boolean;
  /**
   * 这一刻是不是一段的结尾，适合收场（0.2.0，可选）：比如掼蛋一副打完、停在结算页。
   * 当天全站写入到了 stopWrites（meter.ts）时，在打的房间走到这里就停下电脑、把这一步发给大家，然后以 4000 加原因 quota 关房。
   * 不写的游戏没有"这一段"可等，房间知道要收场时马上关
   */
  breakPoint?(state: S): boolean;

  // ---------- 0.3.0：全部可选，不写就和 0.2.0 一样 ----------

  /**
   * 开局选项：房主发 start 时带的 opts（任意 JSON），在这里校验形状，不合格返回 null（房间回 bad_options、不开局）。
   * 0.4.0 起也可以开房时就定（acceptCreate 的 options）：开房时校验、存进房间、经 RoomInfo.opts 发给所有人，之后 start 带的不看。
   * 校验过的选项经 begin 的 setup.opts 交给游戏；游戏要用就放进自己的状态
   */
  options?(raw: unknown): O | null;
  /**
   * 这一局用几个座位（1 到 seats）：比如德州 2–6 人一桌、座位数按选项定。只用前面这么多个座位，
   * 开局时只给它们补电脑，后面的座位一直空着、谁也坐不进去；有真人坐在后面的座位上时房间回 seat_closed、不开局。不写就是 seats
   */
  seatCount?(opts: O | undefined): number;
  /**
   * 开打以后座位换了人（纯函数）：有人坐下或接管电脑的座位（human）、离座交给电脑（ai）。
   * 和那一步（入座、离座）一起写 1 行。游戏可以借它记"这个座位现在是真人买入的"之类；不需要就不写。
   * 托管（掉线超过宽限由电脑代打）不算换人，不调它：座位还是那个人的。
   * 开打后座位绑人，离座的主人回到自己的座位也会以 human 调一次：房间不把 userId 交给规则，游戏按自己的状态判断
   * （比如这个座位原来就是真人的，就什么都不做）
   */
  seated?(state: S, seat: number, kind: 'human' | 'ai'): S;
  /**
   * 现在还没办完的对外的事（见 RoomEffect）。房间每一步之后看一眼，把没在办的交给房间子类的 perform 去办，
   * 办完用 settled 把结果写回状态（1 行）；办失败了按退避重试（用那唯一的闹钟）。结果写回以后这笔就不该再出现在这里
   */
  effects?(state: S): E[];
  /** 一笔对外的事办完了（纯函数）：result 是 perform 的返回值，游戏自己校验。id 已经不在 effects() 里的，房间不会调 */
  settled?(state: S, id: string, result: unknown): S;
  /**
   * 房间要关了（寿命到、没人、额度满、入站用完）：给游戏最后一次机会把要办的事记下来（比如把所有人桌上的筹码结回钱包）。
   * 写了 effects 才会调。返回的状态里还有 effects 的话，房间先断开所有人、留着存储把它们办完再删；办不完（一直失败）最多等 closingMs
   */
  closing?(state: S): S;
  /**
   * 不轮流的操作（比如离桌、暂离回来；只是冒个气泡的用 0.6.0 的 emotes，不写存储）：入座的人什么时候都能发，不看轮没轮到他、不判 stale，
   * 不改这一手的期限和 turnSeq（除非它让该谁出手变了）。照样过 parse、apply，照样占令牌桶和入站额度
   */
  free?(action: A): boolean;

  // ---------- 0.3.2 ----------

  /**
   * 牌局没打完、这一刻谁也不用出手，在等外面的事（0.3.2，可选）：比如德州的牌桌上能打的人不够两个，等有人坐下、补码、从暂离回来，
   * 或者买入到账。返回 true 时 actors（turn）可以是空的：房间不当作出错，不计时、不驱动电脑、不设这一手的闹钟，一行也不写；
   * 等到有人发不轮流的操作、座位换人、对外的事办完，牌局变了再看该谁出手。只在没人能出手时才问它；不写就和以前一样，空了按出错处理
   */
  waiting?(state: S): boolean;

  // ---------- 0.5.0 ----------

  /**
   * 这一刻是不是"停一会儿再接着来"（比如一手打完停几秒让大家看清结果，再自动发下一手）：返回要停的毫秒数（正的有限数），不是就返回 null。
   * 不能等所有人点（有人走开就卡住），也不能指给某个座位计时（电脑、托管的座位会被房间立刻代出，停不住），所以由房间来停。
   * 只在没人能出手（actors / turn 为空）时才问它，优先于 waiting。停顿从进入这个状态那一刻算（电脑连着出完进来的，从播放完算），
   * 停顿期间不轮流的操作、座位换人、对外的事办完都不重新计时；按当前局面现算，同一个停顿里要一直给同一个数。
   * 页面看 RoomInfo.pause.until 画倒计时（这时 RoomInfo.turn 是 null）
   */
  pause?(state: S): number | null;
  /**
   * 停够了（纯函数）：房间到点用那唯一的闹钟调它做一步（和这一步一起最多写 2 行），比如发下一手；之后电脑照常接着出。
   * 返回的状态不能还在停（要连着停两段，就在一次 pause 里给总时长）：还在停、或者抛错，房间记日志、不用它的结果，过 60 秒再试。
   * 写了 pause 就必须写 resume，只写 pause 的当作没有停顿（记一次日志）
   */
  resume?(state: S): S;

  // ---------- 0.6.0 ----------

  /**
   * 快捷短语表有几句（0.6.0，可选）：入座的人可以发 0 到 emotes - 1 的编号，房间只转发给所有人（EmotedMsg），不进状态、不写存储。
   * 短语的文字、图标由游戏自己在页面里定，房间不知道内容。不写（或不是正整数）就是没有短语，发了回 no_emotes
   */
  emotes?: number;

  // ---------- 0.18.0 ----------

  /**
   * 好友房聊天（docs/chat.md）：true 时入座的人能发自由文字（一条 ≤ 30 个字），房间过滤、限速后只转发，不进状态、不写存储。
   * 不写就没有聊天，发了回 chat_off，welcome 里也不带节奏
   */
  chat?: boolean;
  /** 聊天打码时在 kit 的词表（chat-words.ts）之外再加的词；只能加，删不了 kit 的 */
  chatWords?: readonly string[];
}

/**
 * 进房、重连时发的全量快照有多大（字节，取所有座位和"没入座"里最大的那个）。
 * 重连一律发全量快照（4.5），快照太大会拖慢手机重连、多占出站流量；游戏在自己的测试里挑几个最大的局面断言一个上限。
 * 座位信息按最坏情况算：全是真人、昵称都是 16 个汉字。
 */
export function snapshotBytes<S, A, V, O, E extends RoomEffect>(game: RoomGame<S, A, V, O, E>, state: S): number {
  const room: RoomInfo = {
    code: '000000',
    status: 'playing',
    seats: Array.from({ length: game.seats }, () => ({ kind: 'human', name: '牌'.repeat(16), away: true, auto: true, reserved: true })),
    turn: {
      seat: 0,
      deadline: 9_999_999_999_999,
      ...(game.actors ? { seats: Array.from({ length: game.seats }, (_, i) => i) } : {}),
    },
    // 停顿和 turn 不会同时有，这里两样都算上，偏大一点（0.5.0）
    ...(game.pause ? { pause: { until: 9_999_999_999_999 } } : {}),
  };
  let max = 0;
  for (const seat of [null, ...Array.from({ length: game.seats }, (_, i) => i)]) {
    const msg: WelcomeMsg<V> = {
      t: 'welcome',
      v: PROTOCOL_VERSION,
      minClientVersion: 0,
      seq: 999_999,
      you: { seat, bound: seat ?? 0 },
      room,
      view: game.view(state, seat),
      // 有短语的游戏多带一个节奏（0.7.0）
      ...(game.emotes ? { emote: { ms: 999_999, burst: 99 } } : {}),
      ...(game.chat ? { chat: { ms: 999_999, perMin: 99, max: 99 } } : {}),
    };
    max = Math.max(max, new TextEncoder().encode(JSON.stringify(msg)).byteLength);
  }
  return max;
}

/**
 * 快速匹配的配置对不对得上房间（0.20.0，安全审阅）：每个开放的档位，排队那边的 tableSize（一桌几个真人）和 roomOptions（开桌带的选项）
 * 要过得了这张桌的 RoomGame。对不上的话房间每桌都回 bad / bad_options、排到的人都转单机，线上只看得到日志。
 * 游戏在自己的测试里调：`expect(matchConfigErrors(game, tiers, (t) => queue.tableSize(t), (t) => queue.roomOptions(t))).toEqual([])`。
 * 返回每个问题一句话，没问题是空数组。纯函数，不碰运行时（普通 Node 测试能用）
 */
export function matchConfigErrors<S, A, V, O, E extends RoomEffect>(
  game: RoomGame<S, A, V, O, E>,
  tiers: readonly string[],
  tableSize: (tier: string) => number,
  roomOptions: (tier: string) => unknown = () => undefined,
): string[] {
  const out: string[] = [];
  for (const tier of tiers) {
    const raw = roomOptions(tier);
    let opts: O | undefined;
    if (raw !== undefined) {
      if (!game.options) {
        out.push(`${tier}: roomOptions given but the game has no options()`);
        continue;
      }
      const o = game.options(raw);
      if (o === null) {
        out.push(`${tier}: roomOptions rejected by game.options()`);
        continue;
      }
      opts = o;
    } else if (game.options && game.options(undefined) === null) {
      out.push(`${tier}: game.options() needs roomOptions for this tier`);
      continue;
    }
    const count = game.seatCount ? game.seatCount(opts) : game.seats;
    const size = tableSize(tier);
    if (!Number.isInteger(size) || size < 2) out.push(`${tier}: tableSize ${size} must be an integer ≥ 2`);
    else if (size > count) out.push(`${tier}: tableSize ${size} is more than the ${count} seats this table plays`);
    else if (size > 9) out.push(`${tier}: tableSize ${size} is more than 9 (blockedAmong limit)`);
  }
  return out;
}
