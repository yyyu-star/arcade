import type { Comment, Dir, FriendDef, TurnTalk } from '../types.ts';

/**
 * 群友（M0：开局 6 个，道具或奖励可带来 2 个）。可信度、说话频率在 BALANCE.cred / BALANCE.chat。
 * 台词全部虚构；{theme} 换成风口名，{stock} 换成股票名。
 * 0.7.0：每个池子扩到一局里不怎么撞车的大小（一个话多的群友一局要开口六七十次），口吻跟着性格走。
 */
export const FRIENDS: readonly FriendDef[] = [
  { id: 'xiaoli', name: '小李', title: '大学生', topics: ['ai', 'gaming'], desc: '冲！起飞！', founding: true },
  { id: 'laowang', name: '老王', title: '退休教师', topics: ['finance', 'consumer'], desc: '话少，稳', founding: true },
  { id: 'zhangjie', name: '张姐', title: '宝妈', topics: ['pharma', 'consumer'], desc: '转发妈妈群的消息', founding: true },
  { id: 'qunzhu', name: '韭菜收割机', title: '群主', topics: 'all', desc: '天天喊人买股票、卖课', founding: true },
  { id: 'laozhao', name: '老赵', title: '老股民', topics: ['lowalt'], memes: true, desc: '懂的都懂', founding: true },
  { id: 'dav', name: '股市小诸葛', title: '大V', topics: 'hottest', desc: '直播口头禅不离嘴', founding: true },
  { id: 'neimu', name: '内幕哥', title: '神秘人', topics: 'random2', desc: '消息看完就撤回', founding: false },
  { id: 'zhuchang', name: '猪场老板', title: '养猪大户', topics: ['pig'], desc: '最懂猪的人', founding: false },
  // 0.4 C：能押跌之后入群；说错的时候一律唱空
  { id: 'kongjun', name: '空军老周', title: '职业唱空', topics: 'all', desc: '什么都觉得要跌', founding: false },
];

/** 风口消息台词。 */
export const MESSAGE_LINES: Record<string, Record<Dir, readonly string[]>> = {
  xiaoli: {
    up: [
      '{theme}要起飞了！冲冲冲！',
      '{theme}今天必涨，我把下个月生活费都押上了',
      '室友说{theme}今天有大动作，火箭已经加满油了',
      '{theme}！上车上车！',
      '{theme}今天要涨，我连泡面都换成桶装的了',
      '刷到好几个视频都在说{theme}，冲就完事了',
      '{theme}今天红红火火，我先上为敬',
      '直觉告诉我{theme}今天要涨，直觉没骗过我（大概）',
    ],
    down: [
      '{theme}今天要凉，先跑为敬',
      '{theme}有点虚，我卖了换奶茶',
      '{theme}今天别碰，我刚被教育了（哭）',
      '{theme}今天怕是要跌，我先溜了',
      '{theme}看着就危险，跟我的期末考试一样',
      '学长说{theme}今天要绿，我信学长',
      '{theme}今天别追，追了就是下一个我',
      '{theme}要掉下来了，宿舍已经集体撤退',
    ],
    flat: [
      '{theme}今天应该没啥动静，我去上课了',
      '{theme}今天不动，像我的绩点',
      '{theme}今天摸鱼，我也摸鱼',
      '{theme}今天大概原地踏步，跟我减肥一样',
      '{theme}今天没戏，我去食堂了',
      '{theme}今天估计横着走，螃蟹附体',
      '{theme}今天不温不火，像我的恋爱',
      '{theme}今天没啥看头，我回去补觉',
    ],
  },
  laowang: {
    up: ['{theme}，可以。', '{theme}，看涨。', '{theme}，买点。', '{theme}，可以少买点。', '{theme}，形势不错。', '{theme}，看好。别贪。', '{theme}，今天偏强。', '{theme}，有机会。'],
    down: ['{theme}，该走了。', '{theme}，不碰。', '{theme}，回避。', '{theme}，今天偏弱。', '{theme}，先放放。', '{theme}，风险大。', '{theme}，别追。', '{theme}，减一点。'],
    flat: ['{theme}，再等等。', '{theme}，没变化。', '{theme}，不急。', '{theme}，今天平。', '{theme}，观望。', '{theme}，耐心。', '{theme}，没机会。', '{theme}，等信号。'],
  },
  zhangjie: {
    up: [
      '【转发】妈妈群里都在说{theme}今天要涨！',
      '幼儿园家长群都在聊{theme}，应该要涨吧？',
      '【转发】重磅！{theme}今天有喜事！！',
      '【转发】{theme}今天大吉，收到的家人都发财！',
      '楼下李姐说{theme}今天要涨，她儿子在证券公司',
      '【转发】好消息！{theme}今天要红，转给十个群',
      '小区群里都在买{theme}，我也凑个热闹',
      '【转发】专家提示：{theme}今天看好！',
    ],
    down: [
      '【转发】紧急！{theme}今天千万别碰！！',
      '听小区王阿姨说{theme}要跌，我信她',
      '【转发】速看！{theme}风险提示，看完记得转给家人',
      '【转发】{theme}今天有风险，宁可错过不能做错',
      '我妈说{theme}今天别碰，老人家的话要听',
      '【转发】注意！{theme}今天要往下走，速速转发',
      '同事的表姐说{theme}今天要跌，我先卖了',
      '【转发】{theme}今天别买！这条一定要看完',
    ],
    flat: [
      '【转发】专家说{theme}今天波澜不惊',
      '{theme}今天平平淡淡，像我家孩子的成绩',
      '【转发】{theme}今天静悄悄',
      '【转发】{theme}今天风平浪静，大家安心带娃',
      '{theme}今天没动静，我去接孩子了',
      '【转发】{theme}今天原地不动，专家建议多喝热水',
      '王阿姨说{theme}今天睡大觉',
      '{theme}今天不涨不跌，跟菜价一样稳',
    ],
  },
  qunzhu: {
    up: [
      '【独家】{theme}今天要大涨！想上车的私聊我进 VIP 群',
      '{theme}起飞在即，听我的没错，错了算我的（不算）',
      '{theme}今天必涨！课程第三讲讲过！',
      '{theme}今天要涨！跟上的扣 1，没跟上的报班',
      '{theme}大户已经进场，VIP 群里早就买好了',
      '{theme}今天必红，错过的人下个月课程见',
      '内部消息：{theme}今天要涨，不报班的别说我没提醒',
      '{theme}今天起飞，这是我今年第 99 次说准',
    ],
    down: [
      '{theme}今天要跌，赶紧卖，别问为什么',
      '大户在{theme}偷偷卖了，课程里都讲过',
      '{theme}今天大跌，VIP 群早就跑了',
      '{theme}今天要砸盘，课程第七讲讲过怎么逃顶',
      '{theme}今天危险，VIP 群已经清仓',
      '大户今天要在{theme}出货，跑不掉的来报班',
      '{theme}今天大跌，现在报名立减 200',
      '{theme}今天要吓人，心态不好的赶紧卖',
    ],
    flat: [
      '{theme}今天不动，正是学习的好时机，课程限时 8 折',
      '{theme}不动，是大户在故意吓唬我们这种小散，懂？',
      '{theme}今天不动，适合报个班',
      '{theme}今天不动，大户在悄悄吸筹，懂？',
      '{theme}今天横着，正好用来学技术分析',
      '{theme}今天没方向？报了班就有方向',
      '{theme}今天磨人，课程第六讲专治磨人',
      '{theme}今天不动，适合交学费',
    ],
  },
  laozhao: {
    up: ['{theme}，懂的都懂。', '{theme}今天有钱进来，不多说。', '{theme}，干就完了。', '{theme}，今天有人抬。', '{theme}，量起来了。', '{theme}，跟着钱走。', '{theme}，这波有搞头。', '{theme}，我老赵先进为敬。'],
    down: ['{theme}，撤了。懂的都懂。', '{theme}的钱已经跑了。', '{theme}，别当最后一个买的人。', '{theme}，有人在出货。', '{theme}，量不对劲。', '{theme}，大户撤了。', '{theme}，见好就收吧。', '{theme}，这种盘我见多了，跑。'],
    flat: ['{theme}今天没人玩。', '{theme}，看戏。', '{theme}，没意思。', '{theme}，今天大户放假。', '{theme}，没量。', '{theme}，磨。', '{theme}，玩不起来。', '{theme}，炒股二十年，这种天就该喝茶。'],
  },
  dav: {
    up: [
      '家人们！{theme}今天必须冲！点赞过万我再买！',
      '老铁们，{theme}这波我看到天花板之上！',
      '{theme}今天要涨，信我，关注不迷路',
      '家人们！{theme}今天上车的扣个 666！',
      '{theme}今天有戏！直播间人数破万我就加仓',
      '老铁们，{theme}这一波我看好，主页有详细分析',
      '{theme}今天必红，没关注的点个关注',
      '家人们，{theme}今天这个形态，教科书级别',
    ],
    down: [
      '家人们注意！{theme}今天风险大，先撤！',
      '{theme}今天要往下走，直播间的家人们别上头',
      '{theme}今天危险，这是我的个人观点，不构成建议',
      '家人们，{theme}今天先撤，保住本金最重要',
      '{theme}今天要往回落，直播间提醒过的',
      '老铁们，{theme}今天别抄底，听我的',
      '{theme}今天有风险，仅代表个人观点哈',
      '{theme}今天要下跌，没撤的家人扣个 1',
    ],
    flat: [
      '{theme}今天不动，家人们别急',
      '{theme}今天休息一下，下播了',
      '{theme}今天没方向，等我晚上直播细聊',
      '{theme}今天震荡，家人们先喝口水',
      '{theme}今天没行情，我先去带货了',
      '家人们，{theme}今天等一等，晚上细讲',
      '{theme}今天横着走，直播间抽奖继续',
      '{theme}今天休息，家人们也休息',
    ],
  },
  neimu: {
    up: [
      '（看完就撤回）{theme}今天有好消息。',
      '表舅的同学的邻居说{theme}今天要涨。',
      '{theme}，今天涨，别问。',
      '{theme}，今天有人要抬，别问谁。',
      '（消息来源保密）{theme}今天红。',
      '{theme}，今天上。看完删。',
      '我朋友的朋友在{theme}里面，今天有好事。',
      '（马上撤回）{theme}，买。',
    ],
    down: [
      '（别外传）{theme}今天有坏消息。',
      '{theme}今天要跌，我只说一遍。',
      '（已撤回）{theme}，跑。',
      '{theme}，今天有人要砸。',
      '（消息来源保密）{theme}今天绿。',
      '{theme}，今天下。看完删。',
      '（马上撤回）{theme}，别碰。',
      '{theme}里面的人今天在跑。',
    ],
    flat: [
      '{theme}今天没消息，安静等着。',
      '{theme}今天平静，别乱动。',
      '{theme}，今天无事。',
      '{theme}，今天没人动它。',
      '（消息来源保密）{theme}今天平。',
      '{theme}，今天按兵不动。',
      '（马上撤回）{theme}，等。',
      '{theme}今天没内幕，我也很无奈。',
    ],
  },
  zhuchang: {
    up: [
      '猪价今天要涨，{theme}跟着涨！',
      '我家猪今天吃得特别香，{theme}要涨',
      '猪贩子都在抢货，{theme}稳了',
      '今天出栏价不错，{theme}有戏',
      '我家母猪今天下了一窝十二只，{theme}要涨',
      '今天去集上，猪贩子都乐呵呵的，{theme}稳',
      '我家猪今天叫得特别欢，{theme}要涨',
      '收猪的车排到村口了，{theme}要起来',
    ],
    down: [
      '猪价要跌，{theme}快跑',
      '我家猪今天绝食了，不是好兆头',
      '猪贩子都在压价，{theme}悬了',
      '猪价今天要往下走，{theme}小心',
      '我家猪今天不吃饭，{theme}悬',
      '今天收猪的压价压得狠，{theme}要跌',
      '猪都在拱墙，{theme}要出事',
      '隔壁猪场在抛售，{theme}要跌',
    ],
    flat: [
      '猪价今天平稳，{theme}没啥动静',
      '猪在睡觉，{theme}也在睡觉',
      '{theme}今天平平，猪也平平',
      '今天猪价没动，{theme}也没动',
      '猪吃了睡、睡了吃，{theme}也一样',
      '{theme}今天平稳，跟我家猪的体重一样',
      '猪贩子今天没来，{theme}没啥行情',
      '猪今天懒洋洋的，{theme}也懒洋洋的',
    ],
  },
  kongjun: {
    up: [
      '{theme}今天会涨，我承认。就今天。',
      '{theme}涨吧，涨得越高摔得越疼。',
      '{theme}今天我不空它。',
      '{theme}今天要涨？行，让它涨，我等着。',
      '{theme}今天涨我也不追，等它回来。',
      '{theme}今天看涨，这是我今年第一次。',
      '{theme}今天可能涨，但我墨镜不摘。',
      '{theme}今天涨，涨完总会跌的。',
    ],
    down: [
      '{theme}要跌，押它跌。',
      '{theme}？泡沫，迟早破。',
      '{theme}这价格，谁买谁站岗。',
      '{theme}，这个价，空它。',
      '{theme}要掉了，墨镜戴好。',
      '{theme}全是泡沫，今天就破。',
      '{theme}，买的人都在山顶吹风。',
      '{theme}今天跌，信空军。',
    ],
    flat: [
      '{theme}今天没劲，空都懒得空。',
      '{theme}横着，等它往下。',
      '{theme}，看它表演。',
      '{theme}今天横着，空军在等。',
      '{theme}没动静，跌是迟早的事。',
      '{theme}今天憋着，憋完就往下。',
      '{theme}，今天懒得说。',
      '{theme}磨来磨去，最后还是跌。',
    ],
  },
};

/**
 * "要变天了"的说法：消息说的方向和眼下的公开走势相反时用（start：冷清时喊涨；top：火热时喊不动；ebb：火热时喊跌）。
 */
export const TURN_LINES: Record<string, Record<TurnTalk, readonly string[]>> = {
  xiaoli: {
    start: ['{theme}要起飞了！！我闻到了火箭燃料的味道', '{theme}冷了这么久，今天要醒了！冲！', '{theme}发射倒计时 3、2、1，点火！', '{theme}终于要醒了！我等这天等了一整个学期', '{theme}冷了这么久，要回暖了吧？冲！'],
    top: ['{theme}差不多到顶了吧？我有点恐高', '{theme}涨不动了，我先观望一下下', '{theme}好像在山顶，风好大，腿有点软', '{theme}涨这么高，我手都在抖', '{theme}是不是到天花板了？我先下车看看'],
    ebb: ['{theme}该跑了！！室友已经跑没影了', '{theme}要凉，快跑，不跑就是下一个我（哭）', '{theme}，撤撤撤！', '{theme}要降温了，我先上岸', '{theme}凉了凉了，快跑啊'],
  },
  laowang: {
    start: ['{theme}，要起来了。', '{theme}，到时候了。', '{theme}，可以动了。', '{theme}，冷够了，该起了。', '{theme}，底部到了。'],
    top: ['{theme}，差不多了。', '{theme}，到顶了。', '{theme}，见好就收。', '{theme}，太热了。', '{theme}，该收了。'],
    ebb: ['{theme}，该跑了。', '{theme}，走。', '{theme}，别留恋。', '{theme}，退了。', '{theme}，快走，别回头。'],
  },
  zhangjie: {
    start: ['【转发】{theme}要起飞了！妈妈群已经炸了！', '王阿姨说{theme}憋了这么久终于要动了！', '【转发】重大好消息！{theme}马上要火了！！', '【转发】{theme}要转运了！收到请回复', '妈妈群里突然都在聊{theme}，是不是要起来了'],
    top: ['【转发】{theme}到顶了？专家说要见好就收', '妈妈群里都在晒{theme}的收益了，是不是到顶了', '【转发】{theme}涨多了，看完记得转给家人', '【转发】{theme}太火了，专家说该收收了', '王阿姨说{theme}涨到头了，她卖了'],
    ebb: ['【转发】紧急！{theme}该跑了！！', '王阿姨已经把{theme}全卖了，我也跟了', '【转发】{theme}降温预警，速看！', '【转发】{theme}降温了！赶紧转给家人', '妈妈群都在说{theme}该跑了'],
  },
  qunzhu: {
    start: ['{theme}起飞信号出现！VIP 群已经上车！', '{theme}大户进场了，课程第五讲讲过！', '{theme}要火了，现在报名送内部票！', '{theme}底部信号！VIP 群今天已经抄底', '{theme}要启动了，报班的同学准备好'],
    top: ['{theme}到顶了？不，这是在攒劲，课程第四讲', '{theme}今天歇口气，大户在故意吓唬我们这种小散，懂？', '{theme}在高处不动，懂的人已经报班了', '{theme}还能涨！现在卖的人都是没听课的', '{theme}只是中场休息，课程第八讲'],
    ebb: ['{theme}该跑了，VIP 群昨天就跑了', '{theme}的大户在偷偷卖，不听课的人就当最后一个买的吧', '{theme}要崩，赶紧卖，卖完来听课', '{theme}要跌了，VIP 群三天前就撤了', '{theme}该走了，来听我的逃顶课'],
  },
  laozhao: {
    start: ['{theme}，有人要把它往上抬了。懂的都懂。', '{theme}，钱进来了。', '{theme}，起来了。', '{theme}，底下有人吸货了。', '{theme}，要动了。懂的都懂。'],
    top: ['{theme}，差不多了，我在找出口。', '{theme}，顶了。', '{theme}，再买就是最后一个了。', '{theme}，太挤了，我准备下车。', '{theme}，人太多了。'],
    ebb: ['{theme}，该跑了。', '{theme}，我已经走了。懂的都懂。', '{theme}，散了。', '{theme}，大户跑了。', '{theme}，别抄底。'],
  },
  dav: {
    start: ['家人们！{theme}要起飞了！今晚直播细聊！', '{theme}跌到头了，要翻身了！家人们注意了！', '老铁们，{theme}这一波要开始了！', '家人们！{theme}底部确认！直播间第一时间通知！', '{theme}要反转了，老铁们关注我不迷路'],
    top: ['家人们，{theme}差不多到顶了，别再追着买了', '{theme}涨到我说的价位了，家人们注意', '{theme}涨太高了，家人们管住手', '家人们，{theme}到了我说的目标位，该收了', '{theme}涨得太猛，家人们别追着买'],
    ebb: ['家人们快跑！{theme}要降温了！', '{theme}该跑了，直播间的家人们听我一句', '{theme}风险极大，先撤，个人观点', '家人们，{theme}趋势变了，先走', '{theme}要降温了，直播间的家人赶紧撤'],
  },
  neimu: {
    start: ['（看完就撤回）{theme}要火了。', '{theme}，今天开始。别外传。', '表舅的同学说{theme}要动了。', '（看完删）{theme}，有人开始进了。', '{theme}，要起来了，我只说一次。'],
    top: ['（别外传）{theme}差不多到顶了。', '{theme}，到顶了，我只说一遍。', '{theme}，该收手了。', '（马上撤回）{theme}，该走了。', '{theme}，里面的人准备收手了。'],
    ebb: ['（已撤回）{theme}，该跑了。', '{theme}，快走。', '{theme}，里面的人都在出来。', '（别外传）{theme}，有人在砸。', '{theme}，人都走光了。'],
  },
  zhuchang: {
    start: ['猪价要起飞了，{theme}也要起飞！', '猪贩子突然排长队，{theme}要动了', '我家猪今天特别兴奋，{theme}要起来了', '猪价见底了，{theme}也该起来了', '猪贩子又开始抢猪了，{theme}要动'],
    top: ['猪价到顶了，{theme}差不多了', '猪都吃撑了，{theme}也该歇歇了', '猪贩子不抢了，{theme}到头了', '猪价太高了，{theme}也该到顶了', '大家都在补栏，{theme}差不多了'],
    ebb: ['猪价要崩，{theme}该跑了', '我家猪开始减肥了，{theme}快跑', '猪贩子都跑了，{theme}也跑吧', '猪价跳水了，{theme}快跑', '都在抛猪，{theme}也该跑了'],
  },
  kongjun: {
    start: ['{theme}要起来？我先不空了，躲一躲。', '{theme}反弹，空头暂时撤退。', '{theme}，这波我认怂。', '{theme}要起来？我暂时闭嘴。', '{theme}这次好像真要涨，我先躲躲。'],
    top: ['{theme}到顶了，墨镜已经戴好。', '{theme}，我闻到了下跌的味道。', '{theme}涨不动了，准备押跌。', '{theme}到顶了，空军准备起飞。', '{theme}，高处不胜寒啊。'],
    ebb: ['{theme}开始跌了，空军出击！', '{theme}，早说了要跌。', '{theme}散了，押跌的吃肉。', '{theme}开跌了，空军的春天到了。', '{theme}跌吧，我等这一天很久了。'],
  },
};

/** 推荐股票的理由。 */
export const REC_LINES: Record<string, readonly string[]> = {
  xiaoli: ['{stock}，名字就很有未来感，冲！', '{stock}！刷视频刷到好几次了，冲', '{stock}，宿舍全员上车', '{stock}，宿舍楼下都在讨论', '{stock}，名字好听，先买为敬', '{stock}，我直觉它要火', '{stock}，学长强烈推荐', '{stock}！冲就完了', '{stock}，评论区都在喊冲', '{stock}，我用奶茶钱买了一点'],
  laowang: ['{stock}，可以拿。', '{stock}，这家公司还行。', '{stock}，我自己也有一点。', '{stock}，稳。', '{stock}，可以看看。', '{stock}，少买点。', '{stock}，公司底子还行。', '{stock}，拿得住就拿。', '{stock}，不急，慢慢拿。', '{stock}，可以留意。'],
  zhangjie: ['【转发】{stock}，妈妈群一致推荐', '{stock}，我家孩子很喜欢它家的东西', '{stock}，楼下超市都卖断货了', '【转发】{stock}，专家推荐的', '{stock}，我们小区好多人在买', '{stock}，王阿姨买了，我也跟了', '【转发】{stock}，收到的都发财', '{stock}，孩子同学家长推荐的', '{stock}，我妈也买了', '【转发】{stock}，好东西要分享'],
  qunzhu: ['{stock}！VIP 群内部票，今天免费送给大家', '{stock}能涨到现在的三倍，上车！', '{stock}，课程学员人手一只', '{stock}！VIP 群今天主推', '{stock}，课程里重点讲过', '{stock}，今天不上车明天后悔', '{stock}，学员已经翻倍了', '{stock}，报班送这只票的分析', '{stock}，VIP 群的同学都拿着', '{stock}，错过这只再等一年'],
  laozhao: ['{stock}，懂的都懂。', '{stock}，今天有大户要进。', '{stock}，少买点玩玩。', '{stock}，有人在吸货。', '{stock}，我老赵有一点。', '{stock}，看量。', '{stock}，玩玩可以。', '{stock}，别重仓。', '{stock}，有人在里面。', '{stock}，快进快出。'],
  dav: ['{stock}是今天直播间的福利票！', '{stock}，家人们一键三连！', '{stock}，我自己也买了不少（之一）', '{stock}，直播间家人们都在买！', '{stock}，今天福利，免费分享', '{stock}，我主页有分析，点个关注', '{stock}，家人们冲！', '{stock}，这是我的个人观点哈', '{stock}，今晚直播重点讲', '{stock}，评论区呼声最高的一只'],
  neimu: ['{stock}，别问，买。', '{stock}，消息可靠，看完就删。', '{stock}，我就说这一次。', '{stock}，有人要抬。', '{stock}，看完删。', '{stock}，内部消息。', '（马上撤回）{stock}。', '{stock}，信不信由你。'],
  zhuchang: ['{stock}，跟我家猪一样有前途', '{stock}，我自己也买了', '{stock}，猪都说好', '{stock}，猪场边上就是它家厂', '{stock}，我家猪都看好', '{stock}，比养猪赚钱', '{stock}，跟着猪价走', '{stock}，猪贩子都在买'],
  kongjun: ['{stock}，押它跌。', '{stock}涨上天了，押跌！', '{stock}，我赌它要掉下来。', '{stock}，泡沫太大，押跌。', '{stock}，谁买谁站岗，押跌。', '{stock}，迟早要掉，押跌。', '{stock}这价格？押跌。', '{stock}，我空它。'],
};

/**
 * 0.7.0 这局手气（看本局公开战绩，见 chat.ts 的 handOf）：手气好的时候话里带点得意，手气差的时候找补一句，
 * 接在消息句尾（气泡只显示一行，开头要留给风口和方向）。只说口气，不改消息本身。
 */
export const HAND_TAILS: Record<string, Record<'hot' | 'cold', readonly string[]>> = {
  xiaoli: { hot: ['（又说对了吧）', '（最近连着说对）', '（股神上线）'], cold: ['（这次一定准……）', '（再信我一次）', '（最近有点背）'] },
  laowang: { hot: ['（照旧）', '（还是那句）'], cold: ['（仅供参考）', '（最近看错过）'] },
  zhangjie: { hot: ['（妈妈群最近很准）', '（王阿姨的消息）'], cold: ['（这次亲自核实过）', '（上次的不算）'] },
  qunzhu: { hot: ['（看看我最近的战绩）', '（现在报班还来得及）'], cold: ['（之前是大户在针对我）', '（别看最近，看长期）'] },
  laozhao: { hot: ['（最近手感不错）', '（老规矩）'], cold: ['（最近手生）', '（看走眼几回了）'] },
  dav: { hot: ['（最近说对多少次了）', '（战绩说话）'], cold: ['（之前是意外）', '（这次认真的）'] },
  neimu: { hot: ['（消息最近准吧）', '（老规矩，看完删）'], cold: ['（换了个消息源）', '（这回问清楚了）'] },
  zhuchang: { hot: ['（猪最近很灵）', '（我家猪又发话了）'], cold: ['（猪最近有点迷糊）', '（换了头猪问问）'] },
  kongjun: { hot: ['（最近空得很准）', '（墨镜戴好）'], cold: ['（最近被轧了几次）', '（空军不认输）'] },
};

/** 不分方向的得意（三个方向共用）。 */
function same(lines: readonly string[]): Record<Dir, readonly string[]> {
  return { up: lines, down: lines, flat: lines };
}

/** 收盘后说对的群友得意，按他早上说的方向分（说"不动"说对了，就不能喊"起飞"）。 */
export const BRAG_LINES: Record<string, Record<Dir, readonly string[]>> = {
  xiaoli: {
    up: ['看吧！我说什么来着！起飞！', '室友说我是股神，我谦虚地同意了', '{theme}涨了！我宣布，今天的我是全宿舍最靠谱的人', '{theme}涨了吧！今晚加个蛋', '看吧，跟我冲的都赚了', '{theme}没让我失望，我也没让你们失望'],
    down: ['看吧，我就说{theme}今天要凉，幸好我跑得快', '跌了吧！我早就说了（得意）', '{theme}跌了，我宣布，今天的我是全宿舍最靠谱的人', '{theme}果然下去了，幸好我溜得快', '我说要凉吧！今晚奖励自己一杯奶茶', '{theme}掉下来了，我的直觉还是准的'],
    flat: ['看吧，我就说它今天躺平', '{theme}果然在摸鱼，跟我一样', '我宣布，今天的我是全宿舍最靠谱的人', '{theme}果然原地踏步', '说它没动静就没动静，我真是天才', '{theme}一整天都在发呆，跟我说的一样'],
  },
  laowang: same(['嗯。', '正常。', '意料之中。', '嗯，没错。', '早说过。', '{theme}，如此。', '按部就班。', '{theme}，没看错。', '如所料。']),
  zhangjie: same(['妈妈群果然靠谱！', '我就说王阿姨不会错', '【转发】今天的消息又对了，大家记得点赞', '王阿姨又说对了！', '【转发】妈妈群的消息就是准', '{theme}的消息靠谱，我去买菜了', '看来以后还得多看妈妈群', '【转发】{theme}的消息果然靠谱', '还是妈妈们消息灵通', '王阿姨说下回有消息还第一个告诉我']),
  qunzhu: {
    up: ['看到没？这就是专业！课程还有名额', '跟着我有肉吃', '今天说对的，明天收费', '{theme}涨了！报班的同学都赚到了', '看到没，这就是课程的威力', '跟我走的都吃肉了'],
    down: ['看到没？我说跌就跌，课程还有名额', '听我的人今天都躲过去了', '今天说对的，明天收费', '{theme}跌了，听课的人早就跑了', '看到没？课程第七讲诚不欺我', '没报班的今天交学费了吧'],
    flat: ['看到没？我说不动就不动，这就是专业', '{theme}今天就是不动，课程里讲过', '今天说对的，明天收费', '{theme}原地踏步，课程里讲过的', '看到没？我说它磨，它就磨', '这就是专业，学费不白交'],
  },
  laozhao: same(['懂的都懂。', '基本操作。', '早说了。', '老赵什么时候说错过。', '{theme}，看对了。', '小场面。', '二十年不是白混的。']),
  dav: same(['家人们，我说的对不对？点个赞！', '又被我说对了，关注不迷路', '截图保存，以后都是我的战绩', '家人们，又说对了！双击！', '{theme}被我说对了，截图了吗？', '直播间的家人们今天都赚了吧', '关注我的不迷路']),
  neimu: same(['（已撤回）', '消息准吧。', '下次还找我。', '（看完删）准吧。', '我的消息，你懂的。', '{theme}，说了你又不信。', '下次早点信我。', '{theme}的事，我从来不乱说。', '信我的今天都赚了吧。', '（此消息已过期）准吧。', '早跟你说了{theme}。']),
  zhuchang: {
    up: ['猪从来不骗人。', '我家猪说的，没错吧', '养了二十年猪，这点眼光还是有的', '{theme}涨了，猪没骗我', '猪比专家准', '养猪的眼光，炒股照样用'],
    down: ['猪从来不骗人。', '我家猪说要跌，没错吧', '养了二十年猪，这点眼光还是有的', '{theme}下去了，猪早就知道', '猪比专家准', '养猪的眼光，炒股照样用'],
    flat: ['猪从来不骗人。', '我家猪说今天没动静，没错吧', '养了二十年猪，这点眼光还是有的', '{theme}没动静，跟猪一样淡定', '猪比专家准', '养猪的眼光，炒股照样用'],
  },
  kongjun: {
    up: ['涨就涨吧，我说了今天会涨。', '偶尔也要说点好听的。', '我也会看涨的。', '我说了今天涨，没骗你吧。', '难得看多一次，还说对了。', '{theme}涨了，我也不是只会唱空。'],
    down: ['我说什么来着？跌了吧。', '空军永不为奴。', '墨镜戴上，开香槟。', '跌了，空军永远是对的。', '{theme}跌了，墨镜戴稳。', '早就说了要掉。'],
    flat: ['横着，正如我所料。', '它不动，我就不慌。', '看吧，没劲。', '{theme}没动静，跟我说的一样。', '原地踏步，意料之中。', '它磨，我也磨。'],
  },
};

/** 收盘后说错的群友甩锅。 */
export const BLAME_LINES: Record<string, readonly string[]> = {
  xiaoli: ['这不怪我，是{theme}不争气（哭）', '我室友的消息，找他去', '{theme}辜负了我的青春', '我宣布今天不算', '{theme}背叛了我', '下次一定准（发誓）', '{theme}今天不给面子', '我收回早上说的话（哭）'],
  laowang: ['意外。', '再看看。', '我的错。', '看错了。', '{theme}，失算。', '下次谨慎。'],
  zhangjie: ['【转发】的消息有误，大家别当真', '王阿姨说她也是听别人说的', '妈妈群今天集体沉默了', '这条消息我也是转的……', '王阿姨说她那个群也传错了', '以后转发前我先问问专家'],
  qunzhu: ['大户太狡猾了，这是在故意吓唬我们这种小散', '跌是给你们上车的机会，懂？', '没听课的人才会觉得我说错了', '大户太狡猾了，这次不算', '{theme}被人砸了，跟课程无关', '没报班的看不懂这波操作', '{theme}今天不按课程走，是它的问题', '这是大户在考验大家的信心', '说错的那几位，私聊我领补课名额', '我说的是下周，下周！'],
  laozhao: ['有人在使劲卖。', '意外，不多说。', '{theme}，看走眼了。', '{theme}，大户变卦了。', '这把认了。', '老马也有失蹄的时候。'],
  dav: ['今天的走势超出了所有人的预期（包括我）', '家人们，这是意外中的意外！', '我说的是长期，长期！', '家人们，市场有风险，我也是', '{theme}这波属于黑天鹅', '这次是意外，关注我下次准'],
  neimu: ['消息变了。', '（撤回了一条消息）', '我什么都没说过。', '消息源出问题了。', '（撤回了一条消息）（又撤回了一条）', '{theme}，内部变了。'],
  zhuchang: ['猪也有失手的时候', '今天的猪不太对劲', '{theme}的事，猪也说不准', '猪今天状态不好', '{theme}比猪还难懂', '猪也会看走眼'],
  kongjun: ['涨是暂时的，跌是永恒的。', '再涨我也不认。', '{theme}这是回光返照。', '涨上去的迟早要还。', '{theme}，我等它回来。', '今天不算，明天再看。'],
};

/** 持仓涨停时的道贺（任一群友）。 */
export const CHEER_LINES: readonly string[] = [
  '{stock}涨停了！发红包发红包！',
  '恭喜！{stock}涨停了，撒花！',
  '{stock}涨停！今晚加鸡腿',
  '{stock}这是要上天啊',
  '{stock}涨停了，你今天是不是穿了红袜子？',
  '{stock}涨满了！明天还请不请客？',
];

/** 持仓跌停时的调侃（任一群友）。 */
export const MOCK_LINES: readonly string[] = [
  '{stock}跌停了……喝杯奶茶压压惊',
  '{stock}：我只是躺一会儿',
  '{stock}跌停，就当交学费了',
  '别慌，{stock}只是去地下室看看',
  '{stock}跌停了，要不今晚吃顿好的安慰一下',
  '{stock}今天跌满了，明天总不会更差了吧……吧？',
];

/** 0.3.1：今天账户大赚时的道贺（任一群友）。{amount} 是赚到的钱。 */
export const BIG_WIN_LINES: readonly string[] = [
  '今天赚了{amount}？请客请客！',
  '{amount}到手，今晚的火锅你包了',
  '一天赚{amount}，比我一个月工资还多，酸了',
  '赚了{amount}，记得落袋，别又全亏回去',
  '{amount}！你是不是偷偷报了韭菜收割机的课？',
];

/** 0.3.1：今天账户大亏时的安慰（任一群友）。{amount} 是亏掉的钱。 */
export const BIG_LOSS_LINES: readonly string[] = [
  '今天亏了{amount}……抱抱，明天会好的',
  '{amount}没了，就当给市场交了学费',
  '亏了{amount}，先别看软件了，出去走走',
  '一天亏{amount}，我替你心疼了三秒',
  '没事，亏{amount}而已，还没到月底呢',
];

/** 0.3.1：某个风口涨疯了你一只都没有（任一群友）。 */
export const MISS_LINES: readonly string[] = [
  '{theme}今天涨疯了，你手里一只都没有？',
  '{theme}起飞了，你在哪儿？',
  '我早说{theme}要火，你不听',
  '{theme}热度大涨，下次记得早点上车',
  '错过{theme}没关系，下一个风口还会来',
];

/**
 * 0.7.0 收盘后群里按局面接一句：谁接话看性格（只从有台词的、在群里的人里挑），说法跟着人走。
 * 占位：{amount} 今天赚亏的钱，{stock} 股票名，{theme} 风口名，{bill} 本月账单，{n} 翻了几倍或连赚几天。
 *   bigWin / bigLoss 今天大赚、大亏；cheer / mock 持仓涨停、跌停；miss 某个风口涨疯了你一只都没有；
 *   bill 月底前两天还不够还月供；record 账户第一次到开局的 2、3、5、10……倍；streak 连赚 3 天以上；
 *   slump 这个月已经亏了两成以上；bull / bear 大盘今天转牛、转熊。
 */
export type ReactMoment = 'bigWin' | 'bigLoss' | 'cheer' | 'mock' | 'miss' | 'bill' | 'record' | 'streak' | 'slump' | 'bull' | 'bear';

export const REACT_LINES: Record<ReactMoment, Partial<Record<string, readonly string[]>>> = {
  bigWin: {
    xiaoli: ['赚了{amount}！大佬带带我', '{amount}！你这是要请全宿舍吃饭的节奏', '一天{amount}，我一学期的生活费'],
    laowang: ['赚了{amount}，见好就收。', '不错。别飘。', '{amount}，落袋为安。'],
    zhangjie: ['赚了{amount}？给孩子报个兴趣班吧', '这么多！记得存一点起来', '{amount}！够交好几个月的学费了'],
    qunzhu: ['赚了{amount}？都是课程教得好', '赚这么多，VIP 年费了解一下', '{amount}，下回记得给老师发红包'],
    laozhao: ['{amount}，手气不错。', '今天的钱拿稳了。', '{amount}，别急着加仓。'],
    dav: ['家人们看看！有人一天赚了{amount}！', '{amount}！这就是格局！', '赚了{amount}，记得来直播间分享心得'],
    neimu: ['赚了{amount}，低调。', '闷声发财。'],
    zhuchang: ['{amount}，够买好几头猪了', '赚了{amount}，比我卖一圈猪还多'],
    kongjun: ['赚了{amount}？趁早落袋，别被套', '涨的时候都开心，跌的时候再说'],
  },
  bigLoss: {
    xiaoli: ['亏{amount}……我陪你一起吃泡面', '亏了{amount}，抱抱（我也亏了）', '{amount}没了，我替你哭一会儿'],
    laowang: ['亏了{amount}，先停一停。', '早说过要稳。', '亏了就少动。'],
    zhangjie: ['亏{amount}，没事，钱还能再赚', '抱抱，今晚早点睡', '亏了{amount}？先别跟家里人说'],
    qunzhu: ['亏{amount}？没报班的代价', '跌了就是上车的机会，懂？', '亏{amount}，说明你需要系统学习'],
    laozhao: ['亏{amount}，正常，谁没亏过。', '缓两天再说。', '{amount}，交学费了。'],
    dav: ['家人们，今天有人亏了{amount}，大家引以为戒', '亏{amount}不要紧，心态最重要', '亏了{amount}，下回少买点'],
    zhuchang: ['亏了{amount}，跟猪瘟那年差不多', '别慌，猪价也有低的时候'],
    kongjun: ['亏了{amount}，我就说要跌', '下次跟我一起空'],
  },
  cheer: {
    xiaoli: ['{stock}涨停了！！带我一个！', '{stock}涨停，你是天选之人'],
    laowang: ['{stock}，涨停了。好。', '{stock}涨停，别急着卖。'],
    zhangjie: ['{stock}涨停了！发到妈妈群炫耀一下', '恭喜恭喜，{stock}涨停了'],
    qunzhu: ['{stock}涨停？我课上讲过它', '{stock}涨停了，要不要来 VIP 群'],
    laozhao: ['{stock}涨满了，懂的都懂。', '{stock}，有点东西。'],
    dav: ['家人们！{stock}涨停了！', '{stock}涨停，直播间沸腾了'],
    kongjun: ['{stock}涨停了？明天见分晓', '涨得越高摔得越疼，{stock}'],
  },
  mock: {
    xiaoli: ['{stock}跌停了……我陪你哭', '{stock}今天是自由落体'],
    laowang: ['{stock}，跌停了。该认就认。', '{stock}跌停，别硬扛。'],
    zhangjie: ['{stock}跌停了，抱抱', '没事没事，{stock}明天会好的'],
    qunzhu: ['{stock}跌停是大户在吓人，拿住！', '{stock}跌停，没听课吧'],
    laozhao: ['{stock}，被砸了。', '{stock}跌停，大户下手狠。'],
    dav: ['家人们，{stock}跌停，大家冷静', '{stock}跌停了，个人观点：别慌'],
    kongjun: ['{stock}跌停，我早说了。', '{stock}掉下来了，墨镜借你'],
  },
  miss: {
    xiaoli: ['{theme}涨疯了，你居然没上车？', '{theme}起飞了，我们都在天上，你在哪'],
    laowang: ['{theme}，错过了就错过了。', '没追{theme}也好，稳。'],
    zhangjie: ['{theme}今天好火，妈妈群都在晒', '{theme}涨了好多，你没买吗'],
    qunzhu: ['{theme}涨疯了，没听我的吧？', '错过{theme}？报班就不会错过'],
    laozhao: ['{theme}，你没进？可惜。', '{theme}这波，懂的都赚了。'],
    dav: ['家人们，{theme}今天大涨，你上车了吗', '{theme}起飞，直播间说过的'],
    kongjun: ['{theme}涨那么多，等着看它摔', '没买{theme}？好事，省得站岗'],
  },
  bill: {
    xiaoli: ['月底了，{bill}的账单凑齐了吗？我的花呗也在哭', '要还{bill}？要不先卖一只'],
    laowang: ['月底了，先把{bill}的账还上。', '账单要紧，股票其次。'],
    zhangjie: ['月底要还{bill}，现金留够没？', '我每个月这时候都在算账，你也算算'],
    qunzhu: ['账单？涨一个就回来了，懂？', '还差钱？说明该报班了'],
    laozhao: ['月底了，{bill}凑不齐就先减仓。', '还钱要紧。'],
    dav: ['家人们月底了，记得留钱还账', '月底了，量力而行'],
    kongjun: ['月底还{bill}，股票能卖就卖吧', '月底了，别等跌了再卖'],
  },
  record: {
    xiaoli: ['账户翻了{n}倍！大佬请收下我的膝盖', '{n}倍了！你是不是开了挂'],
    laowang: ['{n}倍了。见好就收。', '账户{n}倍，守住。'],
    zhangjie: ['{n}倍！我得去妈妈群宣传一下', '翻{n}倍了，记得给家里人买点东西'],
    qunzhu: ['{n}倍了？这都是课程的功劳', '翻{n}倍，下期课程请你当讲师'],
    laozhao: ['{n}倍，有点东西。', '{n}倍，老赵都服了。'],
    dav: ['家人们！有人账户翻了{n}倍！', '{n}倍！这才叫格局！'],
    neimu: ['{n}倍了，低调。', '翻{n}倍，别声张。'],
    zhuchang: ['翻{n}倍了，能盖个新猪场了', '{n}倍！猪都替你高兴'],
    kongjun: ['{n}倍了，该下车了。', '翻{n}倍？小心坐过山车'],
  },
  streak: {
    xiaoli: ['连赚{n}天了！你是不是有内幕', '{n}连胜！宿舍都在膜拜你'],
    laowang: ['连赚{n}天，别飘。', '{n}天了，留点余地。'],
    zhangjie: ['连着赚了{n}天，手气真好', '{n}天都在赚，记得存钱'],
    qunzhu: ['连赚{n}天？肯定偷偷看了我的课', '{n}连胜，VIP 群欢迎你'],
    laozhao: ['连着{n}天，手感来了。', '{n}天红，懂的都懂。'],
    dav: ['家人们，有人连赚{n}天了！', '{n}连胜！双击！'],
    kongjun: ['连赚{n}天？连得越长，摔得越疼', '{n}天了，该歇歇了'],
  },
  slump: {
    xiaoli: ['这个月有点惨……要不要一起吃顿好的', '这个月亏得我都不敢看了，你还好吗'],
    laowang: ['这个月不顺，少动。', '亏多了，先停一停。'],
    zhangjie: ['这个月不顺，没事，下个月会好的', '抱抱，钱没了还能再赚'],
    qunzhu: ['这个月亏了？说明该报班了', '亏是因为没跟我'],
    laozhao: ['这个月手风不顺，缓缓。', '亏了就少做。'],
    dav: ['家人们，这个月行情难做，大家稳住', '亏了不要紧，留得青山在'],
    kongjun: ['这个月亏了吧？下次跟我空', '早说了要跌'],
  },
  bull: {
    xiaoli: ['大环境转好了！冲冲冲', '牛来了！我闻到了'],
    laowang: ['大环境转强了。', '行情好了，也要稳。'],
    zhangjie: ['【转发】牛市来了！大家都在说', '最近好多人在聊炒股，是不是要涨'],
    qunzhu: ['牛市来了！VIP 群开放报名', '行情起来了，跟我上车'],
    laozhao: ['行情起来了，钱进场了。', '牛来了。懂的都懂。'],
    dav: ['家人们！大环境转好！', '行情来了，家人们准备好'],
    kongjun: ['大家都在涨？我先忍几天。', '牛市？都是假象。'],
  },
  bear: {
    xiaoli: ['大环境变脸了……我先躲躲', '怎么全绿了（哭）'],
    laowang: ['大环境转弱，少动。', '行情差了，守住。'],
    zhangjie: ['【转发】大环境不好了，大家注意', '最近好像不太行，我先不买了'],
    qunzhu: ['大家都在跌，正是上车的机会', '熊市？课程里有专门的熊市课'],
    laozhao: ['行情弱了，钱在跑。', '熊来了，少动。'],
    dav: ['家人们，大环境转弱，少买点', '行情变了，大家注意风险'],
    kongjun: ['转熊了，空军的春天来了！', '跌吧，我等很久了'],
  },
};

/** 0.7.0 接话时的表情：缺省普通；幸灾乐祸的、自己也难受的单独标。 */
export const REACT_MOOD: Partial<Record<ReactMoment, Partial<Record<string, Comment['mood']>>>> = {
  bigLoss: { xiaoli: 'awkward', qunzhu: 'smug', kongjun: 'smug' },
  mock: { xiaoli: 'awkward', qunzhu: 'smug', kongjun: 'smug' },
  slump: { qunzhu: 'smug', kongjun: 'smug' },
  bear: { xiaoli: 'awkward', kongjun: 'smug' },
  bull: { kongjun: 'awkward' },
  cheer: { kongjun: 'awkward' },
  record: { qunzhu: 'smug', dav: 'smug' },
  streak: { qunzhu: 'smug' },
  bill: { xiaoli: 'awkward' },
};

/** 0.4 C：群友对重仓、押跌、抵押的反应（mood 对应头像表情）。 */
export const EXT_REACT_LINES: Record<string, readonly { friendId: string; text: string; mood: 'smug' | 'awkward' | 'normal' }[]> = {
  heavy: [
    { friendId: 'xiaoli', text: '一把梭？兄弟你这是要上天台还是上天堂', mood: 'normal' },
    { friendId: 'laowang', text: '年轻人，鸡蛋别放一个篮子里', mood: 'normal' },
    { friendId: 'dav', text: '家人们看看！这才是格局！', mood: 'smug' },
    { friendId: 'zhangjie', text: '全买一只？我买菜都不敢这么买', mood: 'awkward' },
    { friendId: 'laozhao', text: '重仓一只，懂的都懂，不懂的别学', mood: 'normal' },
  ],
  short: [
    { friendId: 'kongjun', text: '欢迎加入空军，墨镜领一副', mood: 'smug' },
    { friendId: 'xiaoli', text: '你居然押它跌？大家都在买啊', mood: 'awkward' },
    { friendId: 'laozhao', text: '押跌，懂的都懂', mood: 'normal' },
    { friendId: 'qunzhu', text: '押跌？课程里没教过这个，自求多福', mood: 'normal' },
    { friendId: 'laowang', text: '押跌风险大，少押点。', mood: 'normal' },
  ],
  squeeze: [
    { friendId: 'xiaoli', text: '哈哈哈涨停了！押跌的兄弟还好吗', mood: 'smug' },
    { friendId: 'kongjun', text: '被轧了……不慌，涨得越高摔得越疼', mood: 'awkward' },
    { friendId: 'dav', text: '空头被打爆了！家人们这就是信仰的力量！', mood: 'smug' },
    { friendId: 'laowang', text: '押跌碰上涨停，认了吧。', mood: 'normal' },
  ],
  shortWin: [
    { friendId: 'kongjun', text: '跌停！空军今晚加鸡腿', mood: 'smug' },
    { friendId: 'laozhao', text: '押跌押到跌停，懂的都懂', mood: 'smug' },
    { friendId: 'xiaoli', text: '别人跌停哭，你跌停笑，你是魔鬼吗', mood: 'normal' },
    { friendId: 'zhangjie', text: '原来跌了也能赚钱？我得学学', mood: 'normal' },
  ],
  borrow: [
    { friendId: 'laowang', text: '借钱炒股？你爸妈知道吗', mood: 'awkward' },
    { friendId: 'zhangjie', text: '我当年就是这么把房子炒没的', mood: 'awkward' },
    { friendId: 'qunzhu', text: '有魄力！借来的钱跟我买，稳赚', mood: 'smug' },
    { friendId: 'xiaoli', text: '借钱炒股，我只敢借室友的饭卡', mood: 'normal' },
  ],
  call: [
    { friendId: 'laowang', text: '银行都打电话了，还不赶紧减点？', mood: 'awkward' },
    { friendId: 'xiaoli', text: '我手机也响了……哦是外卖', mood: 'normal' },
    { friendId: 'zhangjie', text: '银行的电话要接，别躲', mood: 'awkward' },
  ],
  seized: [
    { friendId: 'zhangjie', text: '抱抱，我懂这种感觉', mood: 'awkward' },
    { friendId: 'kongjun', text: '借钱炒股，涨的时候是翅膀，跌的时候是绞索', mood: 'normal' },
    { friendId: 'laowang', text: '东西没了就没了，人没事就好。', mood: 'awkward' },
  ],
  redeem: [
    { friendId: 'laowang', text: '赎回来就好，知进退', mood: 'smug' },
    { friendId: 'xiaoli', text: '牛啊，空手套白狼还把狼还回去了', mood: 'smug' },
    { friendId: 'zhangjie', text: '赎回来了！晚上加个菜', mood: 'normal' },
  ],
};
