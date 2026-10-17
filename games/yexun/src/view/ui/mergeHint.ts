/**
 * 三选一卡片上的合成提示：拿了这张，离某个合成（含双修）只差一步或正好凑成，就在卡上标出来。
 * 一个合成要两件法器各自：在手、升到满级、有进化用的那件被动（进化后宝箱里合成）。
 * 把这些"缺口"数一遍：这张卡补上一个缺口、补完剩 0 个 = "凑成"；剩 1 个 = "再拿 X"。纯函数，单测在 tests/mergehint.test.ts。
 */
import { MAX_WEAPON_LEVEL, MERGES, PASSIVES, WEAPONS, type MergeDef, type WeaponId } from '../../content/weapons.ts';
import type { Choice, World } from '../../core/index.ts';

export interface MergeHint {
  /** 卡上的短字："凑成 诛邪剑阵！" / "再拿 朱砂 → 诛邪剑阵" */
  text: string;
  /** 凑成了（缺口为 0） */
  ready: boolean;
  id: MergeDef['id'];
  color: string;
  dual: boolean;
}

/** 一件法器离"能拿去合成"还缺什么；card 是假设拿了的这张卡 */
function gaps(w: World, id: WeaponId, card: Choice | null): string[] {
  const def = WEAPONS[id];
  const o = w.weapons.find((x) => x.id === id);
  if (o?.evolved) return [];
  const takes = card?.kind === 'weapon' && card.id === id;
  const out: string[] = [];
  if (!o && !takes) out.push(def.name);
  const level = (o?.level ?? 0) + (takes ? 1 : 0);
  if (level < MAX_WEAPON_LEVEL) out.push(`${def.name}满级`);
  const evo = def.evolve;
  if (evo && (w.passives[evo.with] ?? 0) === 0 && !(card?.kind === 'passive' && card.id === evo.with)) out.push(PASSIVES[evo.with].name);
  return out;
}

export function mergeHint(w: World, card: Choice): MergeHint | null {
  if (card.kind === 'coins') return null;
  let best: { m: MergeDef; left: string[] } | null = null;
  for (const m of MERGES) {
    if (w.merges.includes(m.id)) continue;
    const before = [...gaps(w, m.a, null), ...gaps(w, m.b, null)];
    const left = [...gaps(w, m.a, card), ...gaps(w, m.b, card)];
    // 这张卡得真补上一个缺口，而且补完最多只剩一个
    if (left.length >= before.length || left.length > 1) continue;
    if (!best || left.length < best.left.length) best = { m, left };
  }
  if (!best) return null;
  const { m, left } = best;
  return {
    text: left.length === 0 ? `凑成 ${m.name}！` : `再拿 ${left[0]} → ${m.name}`,
    ready: left.length === 0,
    id: m.id,
    color: m.color,
    dual: !!m.dual,
  };
}
