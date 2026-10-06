import { NORMAL_SPEED } from '../config/constants';
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
