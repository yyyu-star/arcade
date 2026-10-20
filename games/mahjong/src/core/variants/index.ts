/**
 * 玩法登记表（DESIGN.md 3.4）：id → 玩法。房间和单机按开房选项里的 variant 选；加日麻就在这里加一行。
 */
import { riichi } from './riichi/index.ts';
import { sichuanXuezhan } from './sichuan-xuezhan/index.ts';
import type { Variant } from './types.ts';

// 各玩法的状态、动作、视图类型不同，登记表只认统一接口，用到具体玩法的地方再按 id 收窄
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyVariant = Variant<any, any, any, any>;

export const VARIANTS: Readonly<Record<string, AnyVariant>> = {
  [sichuanXuezhan.id]: sichuanXuezhan,
  [riichi.id]: riichi,
};

export const DEFAULT_VARIANT = sichuanXuezhan.id;

export function variantOf(id: unknown): AnyVariant | null {
  return typeof id === 'string' && Object.hasOwn(VARIANTS, id) ? VARIANTS[id]! : null;
}
