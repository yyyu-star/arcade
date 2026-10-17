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
  /** 尸王的技能：x, y, a = 0 跳砸警告 1 砸下 2 召唤 3 尸气, b = 半径 */
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
