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
  /** 代码所在仓库（私有；游戏在总仓库的 games/<id>/ 下） */
  repo?: string;
  /**
   * 不按日期的固定排行榜（如 endless），名字只用小写字母、数字、短横线，不以 daily 开头。
   * 每日榜 daily-YYYY-MM-DD 不用登记；没登记的榜交分一律不收（防止随便开榜把库撑大）。
   */
  boards?: readonly string[];
  /**
   * 有每日挑战榜（daily-YYYY-MM-DD，规则改版时加 -v<n>，15.5）：排行榜页给它一个"<名字>每日"标签页，显示今天版本最大的那个榜。
   * 分数怎么显示由游戏自己的 /games/<id>/daily.json 给（src/daily.ts），平台不知道各游戏的分数怎么编码
   */
  daily?: boolean;
  /**
   * 好友房入口：大厅卡片上"进入游戏"旁边多一个按钮，链到游戏地址加上 query（游戏自己认这个参数，掼蛋把 online=1 当作直接打开好友房面板）。
   * 平台不做开关：游戏关掉联机时这个链接照样打开游戏首页。登录后才露（好友房要登录）
   */
  online?: { label: string; query: string };
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
    repo: 'yyyu-star/arcade',
    daily: true,
  },
  {
    id: 'guandan',
    name: '掼蛋',
    tagline: '两副牌、四个人，对家一队打到过 A',
    desc: '正宗掼蛋：逢人配、钢板、同花顺、天王炸，进贡还贡一样不少，打过 A 就赢。可以和三个电脑牌友打，也能开好友房，叫朋友一起来。',
    tags: ['牌类', '好友房', '约 20 分钟一局'],
    cover: '/covers/guandan.webp',
    path: '/games/guandan/',
    devUrl: 'http://localhost:5174/',
    status: 'playable',
    repo: 'yyyu-star/arcade',
    online: { label: '好友房', query: 'online=1' },
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
    repo: 'yyyu-star/arcade',
    online: { label: '好友房', query: 'online=1' },
  },
  {
    id: 'mahjong',
    name: '雀馆',
    tagline: '川麻·血战到底',
    desc: '四川麻将血战到底：开局换三张、定缺，有人胡了接着打，打到只剩一家。和三个四川味的电脑搓一桌，也能开好友房，叫朋友一起搓。',
    tags: ['麻将', '好友房', '川麻'],
    cover: '/covers/mahjong.webp',
    path: '/games/mahjong/',
    devUrl: 'http://localhost:5176/',
    status: 'playable',
    repo: 'yyyu-star/arcade',
    // 麻将 PR③ 起认 ?online=1 直接进好友房；之前打开的是选桌页，那里本来就有"好友房"入口（维护者 2026-10-16）
    online: { label: '好友房', query: 'online=1' },
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
    repo: 'yyyu-star/arcade',
    online: { label: '好友房', query: 'online=1' },
  },
];

/** 登记过的游戏 id：接口的游戏白名单（云存档、分数榜、钱包），只从上面这一份派生 */
export const GAME_IDS: ReadonlySet<string> = new Set(GAMES.map((g) => g.id));
