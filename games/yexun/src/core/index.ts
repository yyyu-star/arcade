/**
 * 规则核心的对外接口（DESIGN.md 5.1）：画面层、机器人、测试都从这里拿。
 */
export { createWorld, grantWeapon, openChestNow, spawnNow, step, WEAPON_CODE, PASSIVE_CODE, MERGE_CODE } from './step.ts';
export { World, Drop, Pick, Shot, RULES_VERSION, TICKS_PER_SECOND, MAX_ENEMIES, MAX_SHOTS, MAX_DROPS, type Setup, type Choice, type OwnedWeapon } from './state.ts';
export { Ev, Events } from './events.ts';
export { fingerprint } from './fingerprint.ts';
export { INPUT_DIRS } from './fmath.ts';
