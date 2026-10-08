import { creatureStatsFrom, type CreatureStats } from './Creature';
import { creatureDef } from './CreatureData';
import type { Entity } from './Entity';

/** An unnamed creature placed from the creature table: "the gecko", "the townsperson". */
export interface Monster extends Entity, CreatureStats {
  kind: 'monster';
}

export function createMonster(id: string, defId: string, x: number, y: number): Monster {
  return { id, kind: 'monster', ...creatureStatsFrom(creatureDef(defId), x, y) };
}
