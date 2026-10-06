import type { AttackProfile, Combatant } from '../combat/Combatant';
import type { Carrier } from '../items/Loadout';
import type { Point } from '../utils/geometry';
import type { Monster } from './Monster';
import type { Npc } from './Npc';

/** What NPCs and monsters have in common: they can fight, notice you, and be hostile or not. */
export interface CreatureStats extends Combatant, Carrier {
  name: string;
  /** Proper names ("Sunny Smiles") take no article; "gecko" becomes "the gecko". */
  proper: boolean;
  hostile: boolean;
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
}

export type Creature = Monster | Npc;

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
