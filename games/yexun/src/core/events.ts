/**
 * 核心每一拍产生的事件：画面拿它放特效和声音，规则不读它。
 * 用定长的并列数组存（一拍几百个命中也不分配对象）；每拍开始清零。
 */
export const Ev = {
  /** 打中：x, y, a = 伤害, b = 1 暴击, c = 怪的槽位 */
  Hit: 1,
  /** 打死：x, y, a = 怪的种类编号, b = 精英 1, c = 槽位 */
  Kill: 2,
  /** 桃木剑一道斩：x, y, a = 方向表下标, b = 半径, c = 1 进化 */
  Slash: 3,
  /** 天雷：x, y, a = 连锁的第几下, b = 半径, c = 1 是连锁跳过来的（不从天上劈） */
  Thunder: 4,
  /** 镇魂铃响一下：x, y, b = 半径 */
  Bell: 5,
  /** 法器出手（放声音）：a = 法器编号（weaponCode） */
  Fire: 6,
  /** 捡到：x, y, a = 掉落种类（Drop）, b = 值 */
  Pickup: 7,
  /** 升级：a = 新等级 */
  LevelUp: 8,
  /** 挨打：x, y, a = 掉的血 */
  Hurt: 9,
  /** 开宝箱：x, y, a = 法器或被动的编号（< 0 表示铜钱和回血） */
  Chest: 10,
  /** 进化：a = 法器编号 */
  Evolve: 11,
  /** 精英或尸王出场：x, y, a = 种类编号 */
  Arrive: 12,
  /** Boss 的技能：x, y, a = 0 跳砸警告 1 砸下 2 召唤 3 尸气（b = 半径）；4 进下一段（b = 段号，c = 怪种类）；纸扎老爷 5 召纸轿 6 撒纸钱 */
  Boss: 13,
  /** 一局结束：a = 1 赢（天亮）, b = 1 打倒了尸王 */
  End: 14,
  /** 符咒爆开：x, y, b = 半径 */
  Burst: 15,
  /** 八卦镜放一道光波：x, y, a = 晚几拍放, b = 推到多远, c = 每拍扩多少 */
  Wave: 16,
  /** 火葫芦喷火：x, y, a = 方向表下标, b = 火舌长, c = 半宽（方向表格数） */
  Flame: 17,
  /** 缚妖索捆住一只：x, y, a = 这一串里第几只, c = 怪的槽位 */
  Bind: 18,
  /** 桃花落地：x, y, b = 半径 */
  Petal: 19,
  /** 金钟罩：x, y, a = 0 碎了震开 1 回了一层, b = 震的半径 */
  Shield: 20,
  /** 连锁雷的一跳：从 (x, y) 到 (b, c) */
  Chain: 21,
  /** 合成：a = MERGES 的下标 */
  Merge: 22,
  /** 三昧真火在地上留了一摊火：x, y, b = 半径, c = 烧几拍 */
  Burn: 23,
  /** 黄鼠狼叼走铜钱：a = 一共叼了几枚 */
  Steal: 24,
  /** 铜钱挡下一颗敌方的弹 */
  Block: 25,
  /** 更夫敲锣，全屏的怪往后退：x, y, b = 半径 */
  Gong: 26,
  /** 复活：x, y, a = 还剩几次, b = 震开的半径 */
  Revive: 27,
  /** 守夜开宝箱（精英、老爷掉的）：x, y, a = 一共升几件（1 / 3 / 5） */
  ChestBig: 28,
  /** 碰碎摆设：x, y, a = 摆设种类（0 灯笼架 1 纸扎）, b = 掉了什么（Drop，0 没掉） */
  Prop: 29,
  /** 符咒炸弹炸开：x, y, b = 半径 */
  Bomb: 30,
  /**
   * 特色怪的技能（content/regions.ts 的怪）：x, y, a = 子类, b = 半径, c = 预警拍数。
   * 0 竹精预警 1 竹精出土 2 溺鬼拖住 3 冰傀碎裂 4 冰刺预警 5 冰刺落下 6 蛇精窜出 7 河伯涨潮
   * 8 冰魄预警 9 冰魄霜环 10 更夫敲梆 11 石僧预警 12 石僧掌击 13 竹王破土
   */
  Mob: 31,
  /** 竹子挨了一下：x, y = 竹丛脚底中心, a = 第几块（MapDef.blocks 的下标）, b = 剩下的血占几分之几（0–1）, c = 1 倒了 */
  Chop: 32,
  /** 符剑合璧：飞剑给怪贴了一张符：x, y；a = 1 炸了，b = 半径 */
  Seal: 33,
  /** 焚天金钟：外圈火环烧一下：x, y, b = 半径 */
  FireRing: 34,
  // 40–54 是夜探的（含义见 src/explore/host.ts 的 RaidEv，编号两边一致，测试锁住）
  GateOpen: 40,
  GateClose: 41,
  ChestOpen: 42,
  Loot: 43,
  Escape: 44,
  Dawn: 45,
  Lost: 46,
  Alert: 47,
  Beast: 48,
  Roamer: 49,
  Restock: 50,
  Goblin: 51,
  Market: 52,
  Key: 53,
  Vault: 54,
  /** 纸兵倒下：a = 0 倒下 / 1 撒豆成兵炸开 / 2 鸣兵震开；b = 半径 */
  Paper: 55,
  /** 跳过选卡拿到的小奖：a = 0 铜钱 / 1 回血 / 2 下次多一张卡 / 3 刷新 +1，b = 数量 */
  Skip: 56,
  /** 补了一次刷新：a = 0 进化 / 1 打倒精英或首领 */
  Reroll: 57,
  /** 守夜夜市：x, y = 中间那摊；a = 0 预告 / 1 开市 / 2 收市 / 3 买下（b = 第几摊，c = 货在 MARKET_GOODS 里的序号） */
  NightMarket: 58,
} as const;
export type Ev = (typeof Ev)[keyof typeof Ev];

export const EV_CAP = 4096;

export class Events {
  n = 0;
  readonly type = new Int8Array(EV_CAP);
  readonly x = new Float64Array(EV_CAP);
  readonly y = new Float64Array(EV_CAP);
  readonly a = new Float64Array(EV_CAP);
  readonly b = new Float64Array(EV_CAP);
  readonly c = new Float64Array(EV_CAP);

  push(t: Ev, x: number, y: number, a = 0, b = 0, c = 0): void {
    const i = this.n;
    if (i >= EV_CAP) return;
    this.type[i] = t;
    this.x[i] = x;
    this.y[i] = y;
    this.a[i] = a;
    this.b[i] = b;
    this.c[i] = c;
    this.n = i + 1;
  }
}
