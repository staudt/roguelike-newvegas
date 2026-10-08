import type { AttackProfile, Combatant } from '../combat/Combatant';
import { createLimbs } from '../combat/Limbs';
import type { Carrier } from '../items/Loadout';
import type { Point } from '../utils/geometry';
import { startsHostile, traitsOf, type CreatureDef, type CreatureTraits } from './CreatureData';
import type { FactionId, Nerve, Temperament } from './Factions';
import type { Monster } from './Monster';
import type { Npc } from './Npc';

/**
 * What NPCs and monsters have in common: they can fight, notice you, and be hostile or not. What
 * they do beyond that (open doors, raise the alarm, wander far) is in the traits, from their kind.
 */
export interface CreatureStats extends Combatant, Carrier, CreatureTraits {
  /** The creature kind (see CreatureData) its stats, traits and loot come from. */
  defId: string;
  /** Where the map put it: idle wandering stays within `wanderRadius` of it. */
  home: Point;
  name: string;
  /** Proper names ("Sunny Smiles") take no article; "gecko" becomes "the gecko". */
  proper: boolean;
  hostile: boolean;
  /** Which organised group or kind of beast it belongs to; null for an ordinary civilian. */
  faction: FactionId | null;
  /** How it treats strangers: attack on sight, guard its patch, or leave them be. */
  temperament: Temperament;
  /** How it holds up once provoked: stands and fights, runs, or somewhere between. */
  nerve: Nerve;
  /** How far away it notices you. */
  awareness: number;
  /** Once it has noticed you it keeps hunting, even round a corner. */
  alerted: boolean;
  /**
   * Was peaceful and has been drawn into the fight (attacked, or saw a provoked neighbour). Unlike a
   * creature that is hostile by nature, a provoked one makes witnesses turn on the player too.
   */
  provoked: boolean;
  /** A noise to go and check out: a peaceful heard trouble and walks there to see. */
  investigate: Point | null;
  /**
   * Heard a scream or a call for help. `pending`: alerted, and will pass it on with their next action;
   * `done`: already passed on (so a call is never relayed twice by the same person).
   */
  alarm: 'pending' | 'done' | null;
  /**
   * How a provoked person fights, decided the first time they act: `flee` (unarmed and frightened)
   * or `fight` (armed, or the unarmed few who stand and brawl). Null until decided or when not provoked.
   */
  stance: 'flee' | 'fight' | null;
  /** Natural weapon (teeth, fists): used when nothing is wielded. */
  attack: AttackProfile;
  /** Damage Threshold of its hide or shell, on top of any armor worn. */
  naturalDT: number;
}

export type Creature = Monster | Npc;

/** Everything a fresh creature of `def` starts with at (x, y), whether placed as a monster or named as an NPC. */
export function creatureStatsFrom(def: CreatureDef, x: number, y: number) {
  return {
    defId: def.id,
    home: { x, y },
    glyph: def.glyph,
    fg: def.fg,
    x,
    y,
    name: def.name,
    proper: false,
    hostile: startsHostile(def),
    faction: def.faction,
    temperament: def.temperament,
    nerve: def.nerve ?? 'steady',
    ...traitsOf(def),
    awareness: def.awareness,
    alerted: false,
    provoked: false,
    investigate: null,
    alarm: null,
    stance: null,
    attack: {
      ...def.attack,
      damage: { ...def.attack.damage },
      hitProfile: { ...def.attack.hitProfile },
    },
    hp: def.hp,
    maxHp: def.hp,
    ac: def.ac,
    agility: def.agility,
    strength: def.strength,
    speed: def.speed,
    size: def.size ?? 'medium',
    ...(def.mass !== undefined ? { mass: def.mass } : {}),
    // Empty bank: a fresh creature waits for its first tick like everyone else, so a normal-speed
    // creature gets exactly one action per turn (a full bank gave it a free extra swing).
    energy: 0,
    limbs: createLimbs(def.bodyPlan, def.hp),
    naturalDT: def.dt ?? 0,
    inventory: [],
    wielded: null,
    readied: null,
    worn: [],
  } satisfies Omit<CreatureStats, 'id' | 'kind'> & { glyph: string; fg: string; x: number; y: number };
}

export function theName(creature: Pick<CreatureStats, 'name' | 'proper'>): string {
  return creature.proper ? creature.name : `the ${creature.name}`;
}

/** The creature standing on a world cell of a space, if any. Monsters and NPCs never overlap. */
export function creatureAt(
  space: { monsters: Monster[]; npcs: Npc[] },
  x: number,
  y: number,
): Creature | undefined {
  return (
    space.monsters.find((m) => m.x === x && m.y === y) ?? space.npcs.find((n) => n.x === x && n.y === y)
  );
}
