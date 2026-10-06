import {
  AIM_ZONES,
  CROWD_PENALTY_MAX,
  CROWD_PENALTY_PER_HOSTILE,
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
  const closeRange = Math.floor((a.effectiveRange * 2) / 3);
  if (distance <= closeRange) return a.closeBonus;
  if (distance <= a.effectiveRange) {
    const t = (distance - closeRange) / (a.effectiveRange - closeRange);
    return a.closeBonus + (a.effectiveBonus - a.closeBonus) * t;
  }
  return a.effectiveBonus - a.falloffPerCell * (distance - a.effectiveRange);
}

/** Multiplier on the gun's non-torso hit weights at this distance (see AIM_ZONES). */
export function aimSpread(a: ShotAccuracy, distance: number): number {
  const range = a.effectiveRange;
  if (distance * 3 <= range) return AIM_ZONES.point;
  if (distance * 3 <= range * 2) return AIM_ZONES.sweet;
  if (distance <= range) return AIM_ZONES.far;
  return AIM_ZONES.beyond;
}

/** To-hit points lost to hostiles crowding the shooter. Only shots at range (2+ cells) suffer. */
export function crowdPenalty(adjacentHostiles: number, distance: number): number {
  if (distance < 2) return 0;
  return Math.min(CROWD_PENALTY_MAX, adjacentHostiles * CROWD_PENALTY_PER_HOSTILE);
}

/** Gun to-hit modifier from the target's size and (current, not crippled) speed. */
export function targetEvasion(target: Pick<Combatant, 'size' | 'speed'>): number {
  const size = SIZE_TO_HIT_MODIFIER[target.size ?? 'medium'];
  const speed =
    target.speed > EVASION_SPEED_THRESHOLD ? -(target.speed - EVASION_SPEED_THRESHOLD) * EVASION_PER_SPEED : 0;
  return size + speed;
}
