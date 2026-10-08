import {
  ARMOR_DT_AT_ZERO,
  GUN_DAMAGE_AT_ZERO,
  JAM_BELOW,
  JAM_CHANCE_AT_ZERO,
  MELEE_DAMAGE_AT_ZERO,
  WORN_GUN_ACCURACY_PENALTY,
} from '../config/constants';
import { randomInt, type RNG } from '../utils/RNG';
import type { Item } from './Item';
import { isDurable, itemDef, type DurableDef } from './ItemData';

/**
 * Item condition, New Vegas style: weapons, guns and armor have condition points (`durability`
 * when new) that wear with use. A worn weapon hits softer, a worn gun also sprays and below half
 * condition can jam, worn armor stops less. At 0 the thing is broken: it comes off and can't be
 * used until repaired. Pure rules over an item; the engine decides when wear happens.
 */

function durableDef(item: Item): DurableDef | null {
  const def = itemDef(item.defId);
  return isDurable(def) ? def : null;
}

/** Condition points left (full durability when never worn); 0 for things that don't wear. */
export function conditionPoints(item: Item): number {
  const def = durableDef(item);
  if (!def) return 0;
  return item.condition ?? def.durability;
}

/** Condition as a fraction 0..1; 1 for things that don't wear. */
export function conditionFraction(item: Item): number {
  const def = durableDef(item);
  if (!def) return 1;
  return Math.max(0, Math.min(1, conditionPoints(item) / def.durability));
}

/** "62%", or null for things that don't wear. */
export function conditionPercent(item: Item): string | null {
  return durableDef(item) ? `${Math.round(conditionFraction(item) * 100)}%` : null;
}

export function isBroken(item: Item): boolean {
  return durableDef(item) !== null && conditionPoints(item) <= 0;
}

/** Sets condition from a percent (map data says "40" for 40%); never above full, never below 0. */
export function setConditionPercent(item: Item, percent: number): void {
  const def = durableDef(item);
  if (!def) return;
  const points = Math.round((def.durability * Math.max(0, Math.min(100, percent))) / 100);
  if (points >= def.durability) delete item.condition;
  else item.condition = points;
}

/** Gives a fresh durable item a condition rolled in a percent range (map placement, loot). */
export function rollCondition(item: Item, rng: RNG, range: { min: number; max: number }): void {
  if (durableDef(item)) setConditionPercent(item, randomInt(rng, range.min, range.max));
}

/** Takes `points` of wear. Returns true when this wear broke it (it was usable and now is not). */
export function wear(item: Item, points: number): boolean {
  if (!durableDef(item) || points <= 0 || isBroken(item)) return false;
  item.condition = Math.max(0, conditionPoints(item) - points);
  return item.condition === 0;
}

/** Damage multiplier for a weapon in this condition: guns keep more of their punch than blades and clubs. */
export function damageFactor(item: Item): number {
  const def = durableDef(item);
  if (!def || def.kind === 'armor') return 1;
  const floor = def.kind === 'gun' ? GUN_DAMAGE_AT_ZERO : MELEE_DAMAGE_AT_ZERO;
  return floor + (1 - floor) * conditionFraction(item);
}

/** To-hit points a gun in this condition loses. */
export function accuracyPenalty(item: Item): number {
  return Math.round((1 - conditionFraction(item)) * WORN_GUN_ACCURACY_PENALTY);
}

/**
 * Does this shot jam? Only guns below JAM_BELOW roll at all (so a gun in good shape never touches
 * the RNG); the chance climbs to JAM_CHANCE_AT_ZERO percent at 0%.
 */
export function rollJam(item: Item, rng: RNG): boolean {
  const def = durableDef(item);
  if (!def || def.kind !== 'gun') return false;
  const c = conditionFraction(item);
  if (c >= JAM_BELOW) return false;
  const chance = JAM_CHANCE_AT_ZERO * ((JAM_BELOW - c) / JAM_BELOW);
  return randomInt(rng, 1, 100) <= chance;
}

/** Damage Threshold this armor piece gives now: full when new, ARMOR_DT_AT_ZERO of it when nearly gone, none when broken. */
export function armorDT(item: Item): number {
  const def = durableDef(item);
  if (!def || def.kind !== 'armor' || isBroken(item)) return 0;
  return def.dt * (ARMOR_DT_AT_ZERO + (1 - ARMOR_DT_AT_ZERO) * conditionFraction(item));
}
