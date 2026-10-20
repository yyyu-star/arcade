/** 规则核心的公开入口。画面层和电脑对手只从这里 import。 */
export * from './cards.ts';
export * from './options.ts';
export * from './patterns.ts';
export * from './game.ts';
export { hashSeed, rngFor, type Rng } from '../../../core/rng.ts';
