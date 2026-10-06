import type { AttackProfile, CreatureSize } from '../combat/Combatant';
import type { BodyPlanId } from '../combat/Limbs';
import { hostileToPlayer, startingStanding, type FactionId, type Temperament } from './Factions';

export interface MonsterDef {
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
  faction: FactionId;
  temperament: Temperament;
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
export const MONSTERS: Record<string, MonsterDef> = {
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
};

/** Does this kind attack on sight when the game begins (before any provoking or standing changes)? */
export function monsterStartsHostile(def: MonsterDef): boolean {
  return hostileToPlayer(def.faction, def.temperament, startingStanding());
}

export function monsterDef(defId: string): MonsterDef {
  const def = MONSTERS[defId];
  if (!def) throw new Error(`Unknown monster "${defId}"`);
  return def;
}
