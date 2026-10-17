/**
 * 夜探的宝物（DESIGN.md 2.3、3.8、13.1）：45 件，分四档（凡 / 良 / 珍 / 绝）。
 * 都是虚构的旧物件，不用真实朝代、人名、宗教器物。价值按铜钱算：娱乐模式撤出后背包按价值换铜钱，
 * 实盘按带出的价值算结回倍数（`src/explore/settle.ts`）。图标名给画面层（程序画），同一个图标可以换色复用。
 *
 * 编号 = 数组下标（背包、录像里存编号），已有的不挪，新的往后加。
 */

export type TreasureTier = 'fan' | 'liang' | 'zhen' | 'jue';

export const TIERS: readonly TreasureTier[] = ['fan', 'liang', 'zhen', 'jue'];

/** 每档的显示名和颜色（画面层用；颜色是 0xRRGGBB） */
export const TIER_INFO: Record<TreasureTier, { name: string; color: number }> = {
  fan: { name: '凡', color: 0xb8b0a0 },
  liang: { name: '良', color: 0x5fa86a },
  zhen: { name: '珍', color: 0x4a7fd0 },
  jue: { name: '绝', color: 0xe0a030 },
};

export interface TreasureDef {
  id: string;
  name: string;
  /** 一句说明（藏宝阁里显示） */
  blurb: string;
  tier: TreasureTier;
  /** 铜钱价值 */
  value: number;
  /** 图标名（画面层按它画） */
  icon: string;
}

export const TREASURES: readonly TreasureDef[] = [
  // 凡 15 件：2–6 铜钱
  { id: 'thimble', name: '铜顶针', blurb: '针线笸箩里滚出来的，磨得发亮', tier: 'fan', value: 2, icon: 'ring' },
  { id: 'abacus_bead', name: '算盘珠', blurb: '账房先生的算盘散了架', tier: 'fan', value: 2, icon: 'bead' },
  { id: 'chipped_bowl', name: '缺口瓷碗', blurb: '缺了个口，还能盛饭', tier: 'fan', value: 3, icon: 'bowl' },
  { id: 'wood_comb', name: '桃木梳', blurb: '梳齿掉了两根', tier: 'fan', value: 3, icon: 'comb' },
  { id: 'brass_lock', name: '黄铜锁', blurb: '锁还在，钥匙没了', tier: 'fan', value: 4, icon: 'lock' },
  { id: 'oil_lamp', name: '油灯盏', blurb: '灯芯还有一截', tier: 'fan', value: 3, icon: 'lamp' },
  { id: 'candle_stub', name: '半截红烛', blurb: '谁家办喜事剩下的', tier: 'fan', value: 2, icon: 'candle' },
  { id: 'grass_cricket', name: '草编蚱蜢', blurb: '小孩子编的，编得真像', tier: 'fan', value: 2, icon: 'cricket' },
  { id: 'pouch', name: '绣花荷包', blurb: '里面空空的，绣工不错', tier: 'fan', value: 4, icon: 'pouch' },
  { id: 'clay_jar', name: '粗陶罐', blurb: '腌过咸菜，味道还在', tier: 'fan', value: 3, icon: 'jar' },
  { id: 'coin_string', name: '一串旧钱', blurb: '绳子快断了，数一数正好一百文', tier: 'fan', value: 6, icon: 'coins' },
  { id: 'bamboo_fly', name: '竹蜻蜓', blurb: '搓一下能飞过屋檐', tier: 'fan', value: 2, icon: 'propeller' },
  { id: 'cloth_tiger', name: '布老虎', blurb: '给娃娃辟邪用的，眼睛缝歪了', tier: 'fan', value: 4, icon: 'tiger' },
  { id: 'tin_flask', name: '锡酒壶', blurb: '更夫揣在怀里暖身子的', tier: 'fan', value: 5, icon: 'flask' },
  { id: 'iron_shears', name: '铁剪子', blurb: '剪纸人的剪子，刃口锃亮', tier: 'fan', value: 5, icon: 'shears' },
  // 良 14 件：8–16 铜钱
  { id: 'celadon_vase', name: '青瓷小瓶', blurb: '釉色像雨后的天', tier: 'liang', value: 12, icon: 'vase' },
  { id: 'silver_pin', name: '银簪', blurb: '簪头一朵梅花', tier: 'liang', value: 10, icon: 'pin' },
  { id: 'hand_stove', name: '铜手炉', blurb: '雪夜里最想要的东西', tier: 'liang', value: 11, icon: 'stove' },
  { id: 'sandal_fan', name: '檀木扇', blurb: '一扇开，满屋香', tier: 'liang', value: 13, icon: 'fan' },
  { id: 'jade_ring', name: '玉扳指', blurb: '戴在拇指上拉弓用的', tier: 'liang', value: 14, icon: 'ring' },
  { id: 'embroidered_shoe', name: '绣鞋', blurb: '只有一只，另一只不知去向', tier: 'liang', value: 8, icon: 'shoe' },
  { id: 'lacquer_box', name: '漆木食盒', blurb: '三层，最下层还有块糕', tier: 'liang', value: 9, icon: 'box' },
  { id: 'ink_box', name: '铜墨盒', blurb: '盖上刻着一行小字，看不清了', tier: 'liang', value: 10, icon: 'box' },
  { id: 'dominoes', name: '骨牌一副', blurb: '少了一张天牌', tier: 'liang', value: 9, icon: 'tiles' },
  { id: 'snuff_bottle', name: '鼻烟壶', blurb: '内画一只小狐狸', tier: 'liang', value: 15, icon: 'bottle' },
  { id: 'shadow_puppet', name: '皮影人', blurb: '灯一照，会自己动？', tier: 'liang', value: 12, icon: 'puppet' },
  { id: 'clay_teapot', name: '紫砂壶', blurb: '养了几十年，光润如玉', tier: 'liang', value: 16, icon: 'teapot' },
  { id: 'silver_lock', name: '银长命锁', blurb: '给小孩戴的，刻着"长命百岁"', tier: 'liang', value: 14, icon: 'lock' },
  { id: 'bronze_mirror', name: '铜镜', blurb: '照得出人，也照得出别的', tier: 'liang', value: 13, icon: 'mirror' },
  // 珍 10 件：25–45 铜钱
  { id: 'night_pearl', name: '夜明珠', blurb: '雪夜里自己会发光', tier: 'zhen', value: 42, icon: 'pearl' },
  { id: 'jade_bangle', name: '翡翠镯', blurb: '一汪春水绿', tier: 'zhen', value: 36, icon: 'bangle' },
  { id: 'gold_hairpin', name: '金步摇', blurb: '走一步，摇三摇', tier: 'zhen', value: 32, icon: 'pin' },
  { id: 'old_zither', name: '古琴', blurb: '断了一根弦，弹出来的声音很冷', tier: 'zhen', value: 40, icon: 'zither' },
  { id: 'red_coral', name: '红珊瑚枝', blurb: '从海那边来的，不知怎么到了山里', tier: 'zhen', value: 38, icon: 'coral' },
  { id: 'white_qilin', name: '白玉麒麟', blurb: '镇纸用的，压得住字也压得住邪', tier: 'zhen', value: 45, icon: 'qilin' },
  { id: 'gilt_sachet', name: '錾金香囊', blurb: '镂空的金球，里面的香还没散', tier: 'zhen', value: 30, icon: 'sachet' },
  { id: 'scroll_painting', name: '山水残卷', blurb: '只剩半幅，山还在，水没了', tier: 'zhen', value: 28, icon: 'scroll' },
  { id: 'enamel_box', name: '掐丝珐琅盒', blurb: '蓝底金丝，开合无声', tier: 'zhen', value: 34, icon: 'box' },
  { id: 'amber_cicada', name: '琥珀蝉', blurb: '一只蝉睡在里面，睡了很久', tier: 'zhen', value: 26, icon: 'amber' },
  // 绝 6 件：90–150 铜钱
  { id: 'dragon_seal', name: '盘龙玉印', blurb: '印文是谁也认不得的古字', tier: 'jue', value: 150, icon: 'seal' },
  { id: 'star_plate', name: '星图铜盘', blurb: '转一转，星星跟着动', tier: 'jue', value: 120, icon: 'plate' },
  { id: 'gold_toad', name: '镇宅金蟾', blurb: '三条腿，嘴里衔着一枚钱', tier: 'jue', value: 110, icon: 'toad' },
  { id: 'snow_ginseng', name: '千年雪参', blurb: '挖出来的时候它好像动了一下', tier: 'jue', value: 100, icon: 'ginseng' },
  { id: 'phoenix_crown', name: '凤冠', blurb: '点翠嵌珠，谁家新娘没戴上', tier: 'jue', value: 135, icon: 'crown' },
  { id: 'nine_furnace', name: '九转铜炉', blurb: '炉灰里还有一点火星', tier: 'jue', value: 90, icon: 'furnace' },
];

export const TREASURE_BY_ID: Record<string, TreasureDef> = Object.fromEntries(TREASURES.map((t) => [t.id, t]));

/** 每档的宝物编号（按数组顺序，抽宝物时用） */
export const TREASURES_BY_TIER: Record<TreasureTier, readonly number[]> = {
  fan: TREASURES.flatMap((t, i) => (t.tier === 'fan' ? [i] : [])),
  liang: TREASURES.flatMap((t, i) => (t.tier === 'liang' ? [i] : [])),
  zhen: TREASURES.flatMap((t, i) => (t.tier === 'zhen' ? [i] : [])),
  jue: TREASURES.flatMap((t, i) => (t.tier === 'jue' ? [i] : [])),
};
