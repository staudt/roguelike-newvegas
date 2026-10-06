import type { AttackProfile, Combatant } from '../combat/Combatant';
import type { Monster } from './Monster';
import type { Npc } from './Npc';

/** What NPCs and monsters have in common: they can fight, notice you, and be hostile or not. */
export interface CreatureStats extends Combatant {
  name: string;
  /** Proper names ("Sunny Smiles") take no article; "gecko" becomes "the gecko". */
  proper: boolean;
  hostile: boolean;
  /** How far away it notices you. */
  awareness: number;
  /** Once it has noticed you it keeps hunting, even round a corner. */
  alerted: boolean;
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
