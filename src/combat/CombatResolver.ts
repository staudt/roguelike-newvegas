import { computeToHit, strengthDamageBonus } from './CombatFormulas';
import type { AttackProfile, Combatant } from './Combatant';
import { limbAccuracyPenalty, limbCondition, type Limb, type LimbCondition } from './Limbs';
import { pickWeighted, randomInt, type RNG } from '../utils/RNG';

/** Head shots hurt more. Everything else is straight damage. */
const HEAD_DAMAGE_MULTIPLIER = 1.5;

export interface AttackResult {
  hit: boolean;
  damage: number;
  /** The limb struck; null on a miss. */
  limb: Limb | null;
  limbBefore: LimbCondition | null;
  limbAfter: LimbCondition | null;
  killed: boolean;
}

/** Chooses which limb a blow lands on, weighted by the weapon's hit profile. */
export function pickLimb(rng: RNG, defender: Combatant, attack: AttackProfile): Limb {
  const perKind = new Map<string, number>();
  for (const limb of defender.limbs) perKind.set(limb.kind, (perKind.get(limb.kind) ?? 0) + 1);

  const entries = defender.limbs.map((limb) => ({
    item: limb,
    weight: attack.hitProfile[limb.kind] / perKind.get(limb.kind)!,
  }));
  return pickWeighted(rng, entries);
}

/**
 * One melee blow: roll to hit, pick the limb, roll damage, and apply it to both the limb and the
 * defender's HP. Mutates `defender`. Pure apart from that — all randomness comes from `rng`.
 */
export function resolveMelee(
  rng: RNG,
  attacker: Combatant,
  defender: Combatant,
  attack: AttackProfile,
): AttackResult {
  const chance = computeToHit(
    attacker.agility,
    attack.accuracyBonus,
    limbAccuracyPenalty(attacker.limbs),
    defender.ac,
  );

  if (randomInt(rng, 1, 100) > chance) {
    return { hit: false, damage: 0, limb: null, limbBefore: null, limbAfter: null, killed: false };
  }

  const limb = pickLimb(rng, defender, attack);
  let damage = randomInt(rng, attack.damage.min, attack.damage.max);
  if (attack.strengthBonus) damage += strengthDamageBonus(attacker.strength);
  if (limb.kind === 'head') damage = Math.round(damage * HEAD_DAMAGE_MULTIPLIER);
  damage = Math.max(1, damage);

  const limbBefore = limbCondition(limb);
  limb.hp = Math.max(0, limb.hp - damage);
  defender.hp -= damage;

  return {
    hit: true,
    damage,
    limb,
    limbBefore,
    limbAfter: limbCondition(limb),
    killed: defender.hp <= 0,
  };
}
