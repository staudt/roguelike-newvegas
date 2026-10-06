import type { Limb, LimbKind } from './Limbs';

export interface DamageRange {
  min: number;
  max: number;
}

/**
 * How likely each kind of limb is to be struck, as relative weights. This is the weapon's doing,
 * not the attacker's: a bat swings high, a knife goes for the middle. Weight for a kind is split
 * evenly across the creature's limbs of that kind (two legs share the leg weight).
 */
export type HitProfile = Record<LimbKind, number>;

/** Everything a melee blow needs to know about the weapon (or fists, or teeth) delivering it. */
export interface AttackProfile {
  /** Shown in the log, without a possessive: "bare hands", "combat knife", "teeth". */
  weaponName: string;
  damage: DamageRange;
  accuracyBonus: number;
  hitProfile: HitProfile;
  /** Whether the wielder's Strength adds to damage (true for muscle, false for a gun butt). */
  strengthBonus: boolean;
}

/** Shared by the player, NPCs and monsters — anything that can be hit and can hit back. */
export interface Combatant {
  hp: number;
  maxHp: number;
  ac: number;
  agility: number;
  strength: number;
  /** Aim with guns. Falls back to agility for creatures that do not define it. */
  perception?: number;
  /** Base speed in NetHack terms: 12 is a normal human, 24 acts twice per turn. */
  speed: number;
  /** Banked movement; spending NORMAL_SPEED buys one action. */
  energy: number;
  limbs: Limb[];
}
