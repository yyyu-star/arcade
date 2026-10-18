/**
 * 规则配置项：有地方差异或官方原文未核实的点做成开关，默认值见 docs/rules.md。
 */
export interface Options {
  /**
   * 三带二的"二"能否是一对王（两张小王或两张大王）。默认 true：规则把对王列为对子、三带二 = 三同张 + 对子，
   * 按定义推出可以带；没有找到明文，见 docs/rules.md。
   */
  fullHouseJokerPair: boolean;
  /** 炸弹最多几张。两副牌同点最多 8 张，加两张逢人配为 10。 */
  maxBombSize: number;
  /** 打 A 连续失败几次退回打 2；0 表示不退回。 */
  aFailLimit: number;
  /** 还贡最大能还到几（按本位点数）；级牌一律不能还。 */
  returnMaxRank: number;
  /** 双下时两人合计两张大王也算抗贡（默认 true，单人有两张大王一定抗贡）。 */
  antiTributeCombined: boolean;
  /**
   * 打到几结束（0.25.0，单机娱乐的"短局"）：14（A，默认）是标准打法，要打 A 时拿头游、对家不是末游才算过 A；
   * 小于 14 时一副打完某队升到这一级（或更高）就赢下整局，不用"过"。短局是 10（约 10 分钟）。实盘、好友房不改，一律按默认
   */
  endLevel: number;
}

export const DEFAULT_OPTIONS: Readonly<Options> = Object.freeze({
  fullHouseJokerPair: true,
  maxBombSize: 10,
  aFailLimit: 3,
  returnMaxRank: 10,
  antiTributeCombined: true,
  endLevel: 14,
});

/** 短局的终点（0.25.0）：升到 10 就赢 */
export const SHORT_END_LEVEL = 10;

export function resolveOptions(partial?: Partial<Options>): Options {
  return { ...DEFAULT_OPTIONS, ...(partial ?? {}) };
}
