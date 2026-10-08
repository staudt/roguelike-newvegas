import type { AttackProfile, CreatureSize } from '../combat/Combatant';
import type { BodyPlanId } from '../combat/Limbs';
import { NPC_WANDER_CHANCE, NPC_WANDER_RADIUS, NORMAL_SPEED, PEACEFUL_WANDER_CHANCE } from '../config/constants';
import { PALETTE } from '../config/palette';
import { BARE_HANDS } from '../items/ItemData';
import { hostileToPlayer, startingStanding, type FactionId, type Nerve, type Temperament } from './Factions';

/**
 * A kind of creature: the beasts and the people alike. Map files place them by id (unnamed: "the
 * gecko", "the townsperson"), and a named NPC takes its stats from one too (see NpcData). What a
 * creature does beyond fighting comes from the flags here, never from whether it is an NPC.
 */
export interface CreatureDef {
  id: string;
  name: string;
  glyph: string;
  fg: string;
  hp: number;
  ac: number;
  agility: number;
  strength: number;
  /** 12 is normal; the fast and the slow are the point of the speed system. */
  speed: number;
  /** Gun to-hit size class; default medium. */
  size?: CreatureSize;
  /** Knockback mass when it differs from what its size implies. */
  mass?: number;
  bodyPlan: BodyPlanId;
  attack: AttackProfile;
  awareness: number;
  /** Null for an ordinary civilian (see Factions). */
  faction: FactionId | null;
  temperament: Temperament;
  /** How it holds up once provoked; default steady. */
  nerve?: Nerve;
  /** Opens closed doors in its way (people); animals path round them. */
  opensDoors?: boolean;
  /**
   * Behaves like a person among people: hears screams and calls for help and passes them on, goes to
   * look at gunshots, joins a provoked neighbour's fight, cries out when hit, and once provoked decides
   * to fight or flee (by `nerve`) and keeps its distance with a gun.
   */
  social?: boolean;
  /** Percent chance per idle action to take a step; default by `social` (people mostly stay put). */
  wanderChance?: number;
  /** How far (Chebyshev) idle wandering may take it from where the map put it; default 3 for people, none for animals. */
  wanderRadius?: number;
  /** Things it may leave behind when it dies, each rolled independently. */
  loot?: LootEntry[];
}

export interface LootEntry {
  defId: string;
  /** Percent chance 1-100. */
  chance: number;
  /** Stack size for ammunition (inclusive range); ignored for other items. */
  count?: { min: number; max: number };
}

/**
 * Glyphs follow NetHack's letters for the kind of thing, colors tell them apart: `g` for the
 * lizards, `a` for insects, `r` for rodents-and-roaches, `q` for the cattle.
 */
export const CREATURES: Record<string, CreatureDef> = {
  gecko: {
    id: 'gecko',
    size: 'small',
    name: 'gecko',
    glyph: 'g',
    fg: '#7fbf5f',
    hp: 12,
    ac: 4,
    agility: 6,
    strength: 4,
    speed: 12,
    bodyPlan: 'quadruped',
    attack: {
      weaponName: 'teeth',
      damage: { min: 2, max: 4 },
      accuracyBonus: 0,
      hitProfile: { head: 15, torso: 45, arm: 0, leg: 40 },
      strengthBonus: false,
    },
    awareness: 8,
    faction: 'wildlife',
    temperament: 'aggressive',
    loot: [{ defId: 'gecko-hide', chance: 35 }],
  },
  bloatfly: {
    id: 'bloatfly',
    size: 'tiny',
    name: 'bloatfly',
    glyph: 'a',
    fg: '#c9b84a',
    hp: 5,
    ac: 3,
    agility: 7,
    strength: 2,
    // Fast and flimsy: closes ground quickly and stings more than once per turn.
    speed: 24,
    bodyPlan: 'insect',
    attack: {
      weaponName: 'stinger',
      damage: { min: 1, max: 2 },
      accuracyBonus: -5,
      hitProfile: { head: 20, torso: 60, arm: 0, leg: 20 },
      strengthBonus: false,
    },
    awareness: 9,
    faction: 'wildlife',
    temperament: 'aggressive',
  },
  radroach: {
    id: 'radroach',
    size: 'small',
    name: 'radroach',
    glyph: 'r',
    fg: '#a0724a',
    hp: 8,
    ac: 5,
    agility: 4,
    strength: 3,
    // Slow: you can outwalk it, and it gets a swing only every other turn once it catches up.
    speed: 8,
    bodyPlan: 'insect',
    attack: {
      weaponName: 'mandibles',
      damage: { min: 2, max: 5 },
      accuracyBonus: 0,
      hitProfile: { head: 25, torso: 55, arm: 0, leg: 20 },
      strengthBonus: false,
    },
    awareness: 6,
    faction: 'wildlife',
    temperament: 'territorial',
  },
  ghoul: {
    id: 'ghoul',
    // Wiry and light: a kick sends it flying, and it is back on you in no time.
    size: 'medium',
    mass: 3,
    name: 'ghoul',
    glyph: 'Z',
    fg: '#8fa86a',
    hp: 22,
    ac: 4,
    agility: 5,
    strength: 6,
    speed: 16,
    bodyPlan: 'humanoid',
    attack: {
      weaponName: 'claws',
      damage: { min: 3, max: 6 },
      accuracyBonus: 0,
      hitProfile: { head: 15, torso: 45, arm: 25, leg: 15 },
      strengthBonus: false,
    },
    awareness: 7,
    faction: 'ghouls',
    temperament: 'aggressive',
  },
  brahmin: {
    id: 'brahmin',
    size: 'large',
    name: 'brahmin',
    glyph: 'q',
    fg: '#d8b88a',
    hp: 30,
    ac: 3,
    agility: 3,
    strength: 7,
    speed: 9,
    bodyPlan: 'quadruped',
    attack: {
      weaponName: 'horns',
      damage: { min: 3, max: 6 },
      accuracyBonus: 0,
      hitProfile: { head: 15, torso: 55, arm: 0, leg: 30 },
      strengthBonus: true,
    },
    awareness: 4,
    faction: 'wildlife',
    temperament: 'peaceful',
  },
  // Anyone in town: the default for named NPCs, and placeable as an unnamed local.
  townsperson: {
    id: 'townsperson',
    name: 'townsperson',
    glyph: '@',
    fg: PALETTE.npcFg,
    hp: 24,
    ac: 7,
    agility: 5,
    strength: 5,
    speed: NORMAL_SPEED,
    bodyPlan: 'humanoid',
    attack: BARE_HANDS,
    awareness: 8,
    faction: null,
    temperament: 'peaceful',
    opensDoors: true,
    social: true,
  },
};

/** The traits a creature carries at runtime, with the defaults filled in. */
export interface CreatureTraits {
  opensDoors: boolean;
  social: boolean;
  wanderChance: number;
  /** Null: roams freely. */
  wanderRadius: number | null;
}

export function traitsOf(def: CreatureDef): CreatureTraits {
  const social = def.social ?? false;
  return {
    opensDoors: def.opensDoors ?? false,
    social,
    wanderChance: def.wanderChance ?? (social ? NPC_WANDER_CHANCE : PEACEFUL_WANDER_CHANCE),
    wanderRadius: def.wanderRadius ?? (social ? NPC_WANDER_RADIUS : null),
  };
}

/** Does this kind attack on sight when the game begins (before any provoking or standing changes)? */
export function startsHostile(def: CreatureDef): boolean {
  return hostileToPlayer(def.faction, def.temperament, startingStanding());
}

export function creatureDef(defId: string): CreatureDef {
  const def = CREATURES[defId];
  if (!def) throw new Error(`Unknown monster "${defId}"`);
  return def;
}
