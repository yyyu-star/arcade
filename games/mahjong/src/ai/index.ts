/** 各玩法的电脑（按玩法 id）。规则核心不 import 这里，由房间和单机把它交给玩法的 auto、timeout */
import type { VariantAi } from '../core/variants/types.ts';
import { riichiAi } from './riichi.ts';
import { xuezhanAi } from './xuezhan.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const AIS: Readonly<Record<string, VariantAi<any, any>>> = {
  'sichuan-xuezhan': xuezhanAi,
  riichi: riichiAi,
};
