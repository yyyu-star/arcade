/** 电脑对手的公开入口。 */
export { decide, suggest, type BotConfig, type Difficulty, type PersonaId, type Tuning } from './bot.ts';
export { DIFFICULTIES, PERSONAS, PERSONA_IDS, SEAT_PERSONA, STYLE_SCALE, TUNING, formOf, situationOf, styleOf, tiltOf, tuningFor, type Persona, type Situation } from './persona.ts';
export { hintList } from './hints.ts';
export { randomAction } from './random.ts';
export { planHand, type HandPlan, type Group } from './plan.ts';
