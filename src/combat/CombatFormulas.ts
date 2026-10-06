import {
  EVASION_PER_SPEED,
  EVASION_SPEED_THRESHOLD,
  NORMAL_SPEED,
  SIZE_TO_HIT_MODIFIER,
} from '../config/constants';
import type { ShotAccuracy } from '../items/ItemData';
import type { Combatant } from './Combatant';
import { legSpeedFactor } from './Limbs';

export function computeMaxHP(endurance: number): number {
  return 20 + endurance * 4;
}

export function computeAC(agility: number): number {
  return 5 + Math.floor(agility / 2);
}

/** Percent chance to land a blow, clamped so nothing is ever certain or impossible. */
export function computeToHit(
  agility: number,
  accuracyBonus: number,
  limbPenalty: number,
  targetAC: number,
): number {
  const raw = 50 + (agility - 5) * 5 + accuracyBonus - limbPenalty - targetAC * 2;
  return Math.max(5, Math.min(95, raw));
}

/** Flat damage added to a melee blow by Strength. Average Strength (5) adds 1. */
export function strengthDamageBonus(strength: number): number {
  return Math.max(0, Math.floor((strength - 3) / 2));
}

/** Movement banked per world tick: base speed, throttled by crippled legs. */
export function effectiveSpeed(c: Pick<Combatant, 'speed' | 'limbs'>): number {
  return c.speed * legSpeedFactor(c.limbs);
}

/** How many actions a creature of this speed gets per turn, on average — for display/tests. */
export function actionsPerTurn(c: Pick<Combatant, 'speed' | 'limbs'>): number {
  return effectiveSpeed(c) / NORMAL_SPEED;
}

/** To-hit points a gun gains or loses from range: flat when close, sliding to the good range, then falling off. */
export function rangeAccuracyBonus(a: ShotAccuracy, distance: number): number {
  if (distance <= a.closeRange) return a.closeBonus;
  if (distance <= a.effectiveRange) {
    const t = (distance - a.closeRange) / (a.effectiveRange - a.closeRange);
    return a.closeBonus + (a.effectiveBonus - a.closeBonus) * t;
  }
  return a.effectiveBonus - a.falloffPerCell * (distance - a.effectiveRange);
}

/** Fraction (aimFloor..1) of the gun's non-torso hit weights kept at this distance. */
export function aimSpread(a: ShotAccuracy, distance: number): number {
  if (distance <= a.closeRange) return 1;
  return Math.max(a.aimFloor, 1 - a.aimFalloffPerCell * (distance - a.closeRange));
}

/** Gun to-hit modifier from the target's size and (current, not crippled) speed. */
export function targetEvasion(target: Pick<Combatant, 'size' | 'speed'>): number {
  const size = SIZE_TO_HIT_MODIFIER[target.size ?? 'medium'];
  const speed =
    target.speed > EVASION_SPEED_THRESHOLD ? -(target.speed - EVASION_SPEED_THRESHOLD) * EVASION_PER_SPEED : 0;
  return size + speed;
}
