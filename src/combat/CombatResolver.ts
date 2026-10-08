import { MIN_DAMAGE_FRACTION } from '../config/constants';
import type { ShotProfile } from '../items/ItemData';
import { aimSpread, computeToHit, crowdPenalty, rangeAccuracyBonus, strengthDamageBonus, targetEvasion } from './CombatFormulas';
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
  /** Damage the defender's Damage Threshold stopped (0 on a miss or with no DT): what wears armor. */
  absorbed: number;
}

function missed(): AttackResult {
  return { hit: false, damage: 0, limb: null, limbBefore: null, limbAfter: null, killed: false, absorbed: 0 };
}

/**
 * Damage Threshold, New Vegas style: `dt` comes off the blow, but at least MIN_DAMAGE_FRACTION of
 * it always lands (and never less than 1). Returns what lands and what was stopped.
 */
export function applyThreshold(damage: number, dt: number): { damage: number; absorbed: number } {
  if (dt <= 0) return { damage, absorbed: 0 };
  const landed = Math.max(1, Math.ceil(damage * MIN_DAMAGE_FRACTION), Math.round(damage - dt));
  const final = Math.min(damage, landed);
  return { damage: final, absorbed: damage - final };
}

/** Chooses which limb a blow lands on, weighted by the weapon's hit profile. */
export function pickLimb(
  rng: RNG,
  defender: Combatant,
  attack: Pick<AttackProfile, 'hitProfile'>,
): Limb {
  const perKind = new Map<string, number>();
  for (const limb of defender.limbs) perKind.set(limb.kind, (perKind.get(limb.kind) ?? 0) + 1);

  const entries = defender.limbs.map((limb) => ({
    item: limb,
    weight: attack.hitProfile[limb.kind] / perKind.get(limb.kind)!,
  }));
  return pickWeighted(rng, entries);
}

/**
 * One melee blow: roll to hit, pick the limb, roll damage, take off the defender's Damage
 * Threshold `dt`, and apply it to both the limb and the defender's HP. Mutates `defender`. Pure
 * apart from that — all randomness comes from `rng`.
 */
export function resolveMelee(
  rng: RNG,
  attacker: Combatant,
  defender: Combatant,
  attack: AttackProfile,
  dt = 0,
): AttackResult {
  const chance = computeToHit(
    attacker.agility,
    attack.accuracyBonus,
    limbAccuracyPenalty(attacker.limbs),
    defender.ac,
  );

  if (randomInt(rng, 1, 100) > chance) return missed();

  const limb = pickLimb(rng, defender, attack);
  let damage = scaled(randomInt(rng, attack.damage.min, attack.damage.max), attack.damageFactor);
  if (attack.strengthBonus) damage += strengthDamageBonus(attacker.strength);
  if (limb.kind === 'head') damage = Math.round(damage * HEAD_DAMAGE_MULTIPLIER);
  const blow = applyThreshold(Math.max(1, damage), dt);
  damage = blow.damage;

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
    absorbed: blow.absorbed,
  };
}

/** A rolled damage scaled by a weapon's condition factor (absent = untouched). */
function scaled(roll: number, factor: number | undefined): number {
  return factor === undefined || factor === 1 ? roll : Math.max(1, Math.round(roll * factor));
}

/**
 * One bullet at a target `distanceCells` away (1 = adjacent). Aim is Perception (Agility for
 * creatures without one). Range, target size and speed shift the chance (see ShotAccuracy); far
 * shots also concentrate on the torso. No Strength bonus; heads hurt more, as in melee. Mutates
 * `target`.
 */
export function resolveShot(
  rng: RNG,
  shooter: Combatant,
  target: Combatant,
  shot: ShotProfile,
  distanceCells: number,
  adjacentHostiles = 0,
  dt = 0,
): AttackResult {
  const chance = computeToHit(
    shooter.perception ?? shooter.agility,
    shot.accuracyBonus + rangeAccuracyBonus(shot.accuracy, distanceCells) + targetEvasion(target),
    limbAccuracyPenalty(shooter.limbs) + crowdPenalty(adjacentHostiles, distanceCells),
    target.ac,
  );

  if (randomInt(rng, 1, 100) > chance) return missed();

  const spread = aimSpread(shot.accuracy, distanceCells);
  const p = shot.hitProfile;
  const limb = pickLimb(rng, target, {
    hitProfile: { head: p.head * spread, torso: p.torso, arm: p.arm * spread, leg: p.leg * spread },
  });
  let damage = scaled(randomInt(rng, shot.damage.min, shot.damage.max), shot.damageFactor);
  if (limb.kind === 'head') damage = Math.round(damage * HEAD_DAMAGE_MULTIPLIER);
  const blow = applyThreshold(Math.max(1, damage), dt);
  damage = blow.damage;

  const limbBefore = limbCondition(limb);
  limb.hp = Math.max(0, limb.hp - damage);
  target.hp -= damage;

  return {
    hit: true,
    damage,
    limb,
    limbBefore,
    limbAfter: limbCondition(limb),
    killed: target.hp <= 0,
    absorbed: blow.absorbed,
  };
}
