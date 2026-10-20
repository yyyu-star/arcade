/**
 * 游戏目录：平台上能玩的小游戏。
 *
 * 每个游戏是总仓库 games/<id>/ 下的独立模块，独立构建、独立部署到同一域名下的 `/games/<id>/`（见仓库根 AGENTS.md）。
 * 平台只负责展示和跳转；账号、云存档、好友、排行榜通过同域的 `/api/*` 提供给各游戏。
 * 接口也读这份目录：GAME_IDS 是云存档、分数榜、钱包的游戏白名单，也是保留用户名（worker/api/validate.ts），所以这里不放只有浏览器才有的东西。
 * 新游戏想先接钱包、存档，再正式上大厅：先登记成 status 'coming'（大厅显示"即将上线"，进不去），上线时改成 'playable'。
 */
export type GameStatus = 'playable' | 'coming';

export interface GameEntry {
  id: string;
  name: string;
  /** 一句话卖点 */
  tagline: string;
  /** 两三句介绍 */
  desc: string;
  tags: string[];
  /** 封面（平台 public/covers 下） */
  cover: string;
  /** 线上路径，同域 */
  path: string;
  /** 本地开发时的地址（游戏自己的开发服务器） */
  devUrl?: string;
  status: GameStatus;
  /**
   * 不按日期的固定排行榜（如 endless），名字只用小写字母、数字、短横线，不以 daily 开头。
   * 每日榜 daily-YYYY-MM-DD 不用登记；没登记的榜交分一律不收（防止随便开榜把库撑大）。
   * 写成 {id, name} 的（0.23.0）在排行页"各游戏总榜"里各有一个标签，名字就是 name；只写 id 的按"<游戏名>·<id>"兜底。
   * 分数怎么显示读游戏的 /games/<id>/boards.json（格式同 daily.json，src/scores.ts）。
   */
  boards?: readonly (string | FixedBoard)[];
  /**
   * 有每日挑战榜（daily-YYYY-MM-DD，规则改版时加 -v<n>，15.5）：排行榜页给它一个"<名字>每日"标签页，显示今天版本最大的那个榜。
   * 分数怎么显示由游戏自己的 /games/<id>/daily.json 给（src/daily.ts），平台不知道各游戏的分数怎么编码。
   * 一天有几个每日榜的（平台 0.16.0，比如夜巡的守夜、夜探）写子榜列表：榜名是 daily-YYYY-MM-DD-<子榜 id>[-v<n>]，
   * 每个子榜一个"<名字>每日·<子榜名>"标签，daily.json 里按子榜给显示方式（boards.<子榜 id>）。写了子榜的游戏不再收不带子榜的每日榜。
   */
  daily?: true | readonly DailySub[];
  /**
   * 不用平台钱包的游戏（只有娱乐模式）写 false：排行榜的"本周净赢"不给它开标签，管理页的筹码趋势不给它开一列（都只会是空的）。
   * 只管界面上的这两处；接口的白名单仍是 GAME_IDS
   */
  wallet?: false;
}

/** 每日挑战的子榜：id 只用小写字母和数字、字母开头、不像版本号（v2），name 是标签上的中文名 */
export interface DailySub {
  id: string;
  name: string;
}
export const DAILY_SUB_RE = /^(?!v\d)[a-z][a-z0-9]{0,15}$/;

/** 固定榜：id 是交分用的榜名，name 是排行页标签上的中文名 */
export interface FixedBoard {
  id: string;
  name: string;
}

export const GAMES: readonly GameEntry[] = [
  {
    id: 'kaipan',
    name: '开盘',
    tagline: '散户的一年：看群聊、追风口、还月供',
    desc: '每天看群里的小道消息，挑股票放进持仓，看它们跟着风口涨跌。每个月底要还上一笔钱，还不上就游戏结束。12 个月后，看你是韭菜还是股神。',
    tags: ['模拟炒股', '肉鸽', '单人', '约 15 分钟一局'],
    cover: '/covers/kaipan.webp',
    path: '/games/kaipan/',
    devUrl: 'http://localhost:5173/',
    status: 'playable',
    daily: true,
  },
  {
    // 牌馆：一个游戏里两种打法，id 还是 guandan（存档、钱包、榜单都按 id 记，不改）
    id: 'guandan',
    name: '牌馆',
    tagline: '掼蛋、斗地主，凑一桌就开打',
    desc: '两种打法一个馆。掼蛋：两副牌、四个人，对家一队，逢人配、进贡还贡一样不少，打过 A 就赢；斗地主：三个人抢地主，炸弹、春天翻倍。可以和电脑牌友打，也能开好友房，叫朋友一起来。',
    tags: ['牌类', '掼蛋', '斗地主', '好友房'],
    // 每日挑战只有斗地主（全国同一套牌）；掼蛋没有每日
    daily: [{ id: 'ddz', name: '斗地主' }],
    cover: '/covers/guandan.webp',
    path: '/games/guandan/',
    devUrl: 'http://localhost:5174/',
    status: 'playable',
  },
  {
    id: 'texas',
    name: '德州扑克',
    tagline: '两张底牌、五张公共牌，敢不敢全下',
    desc: '无限注德州扑克，一桌 2 到 9 人。和稳哥、阿飙、虎子、叨叨这些性格各不相同的电脑过招，也能开好友房，叫朋友一起来。筹码来自平台钱包，只用来玩，不能买、不能换。',
    tags: ['牌类', '好友房', '随时离桌'],
    cover: '/covers/texas.webp',
    path: '/games/texas/',
    devUrl: 'http://localhost:5175/',
    status: 'playable',
  },
  {
    id: 'mahjong',
    name: '雀馆',
    tagline: '川麻·血战到底、立直麻将',
    desc: '两种玩法一个馆。四川麻将血战到底：开局换三张、定缺，有人胡了接着打，打到只剩一家；立直麻将：立直、宝牌、役满，听牌前门清更值钱。和电脑搓一桌，也能开好友房，叫朋友一起搓。',
    tags: ['麻将', '川麻', '立直', '好友房'],
    cover: '/covers/mahjong.webp',
    path: '/games/mahjong/',
    devUrl: 'http://localhost:5176/',
    status: 'playable',
  },
  {
    // 外部贡献者的游戏（0.10.22 先登记成"即将上线"，0.10.24 游戏线上验证后改成能玩）
    id: 'racing',
    name: '飞驰',
    tagline: '回合制卡牌赛车：换挡、控热、抢弯道',
    desc: '出牌换挡、算好热量，过弯超速就会打滑，跟车还能吃尾流。三条赛道，和性格各异的电脑比，也能开好友房，叫朋友一起来。',
    tags: ['赛车', '卡牌', '好友房'],
    cover: '/covers/racing.webp',
    path: '/games/racing/',
    devUrl: 'http://localhost:5177/',
    status: 'playable',
    // 只有娱乐模式，不碰钱包（游戏 README）
    wallet: false,
  },
  {
    // 夜巡 1.0 整体验收通过后才登记上线（主线 2026-10-16：不先登记"即将上线"）。榜名照夜巡交分用的（games/yexun/src/online/score.ts）
    id: 'yexun',
    name: '夜巡',
    tagline: '雪夜古镇，只管走位，撑到天亮',
    desc: '道士夜巡雪夜古镇：只管走位，符咒、桃木剑自己出手，升级三选一、法器进化。守夜是成群的跳尸纸人扑上来，撑到天亮；夜探是进镇搜宝，趁镇门开着撤出去。',
    tags: ['动作', '单人', '守夜·夜探', '约 15 分钟一局'],
    cover: '/covers/yexun.webp',
    path: '/games/yexun/',
    devUrl: 'http://localhost:5178/',
    status: 'playable',
    boards: [
      { id: 'vigil', name: '夜巡守夜' },
      { id: 'raid', name: '夜巡夜探' },
      { id: 'endless', name: '夜巡无尽' },
    ],
    daily: [
      { id: 'vigil', name: '守夜' },
      { id: 'raid', name: '夜探' },
    ],
  },
];

/** 登记过的游戏 id：接口的游戏白名单（云存档、分数榜、钱包），只从上面这一份派生 */
export const GAME_IDS: ReadonlySet<string> = new Set(GAMES.map((g) => g.id));

/** 用平台钱包的游戏（界面上按游戏列筹码的地方用） */
export const WALLET_GAMES: readonly GameEntry[] = GAMES.filter((g) => g.wallet !== false);

/** 登记的固定榜，统一成 {id, name}（只写了 id 的名字按"<游戏名>·<id>"兜底） */
export function fixedBoards(g: GameEntry): FixedBoard[] {
  return (g.boards ?? []).map((b) => (typeof b === 'string' ? { id: b, name: `${g.name}·${b}` } : b));
}

/** 排行榜上的一个每日挑战标签：没有子榜的游戏一个（key 是游戏 id），有子榜的每个子榜一个（key 是"游戏 id:子榜 id"） */
export interface DailyTab {
  key: string;
  game: GameEntry;
  sub: DailySub | null;
  label: string;
}

export function dailyTabs(games: readonly GameEntry[] = GAMES): DailyTab[] {
  return games.flatMap((g): DailyTab[] =>
    !g.daily
      ? []
      : g.daily === true
        ? [{ key: g.id, game: g, sub: null, label: `${g.name}每日` }]
        : g.daily.map((sub) => ({ key: `${g.id}:${sub.id}`, game: g, sub, label: `${g.name}每日·${sub.name}` })),
  );
}

